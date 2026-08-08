'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const PROVIDERS = ['claude', 'codex'];
const DAY = 86400000;

function blankUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, signal: 0, tokens: 0, messages: 0, sessions: 0 };
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

/**
 * The two providers disagree about what `input_tokens` means. Anthropic reports
 * it net of cache reads; Codex reports it gross, with `cached_input_tokens` as a
 * subset (17966 input / 11008 cached / 271 output sums to its own total of
 * 18237). Left uncorrected that inflates Codex roughly 35x against Claude on a
 * shared scale, so callers reading Codex pass `inputIncludesCache`.
 */
function tokenUsage(raw = {}, options = {}) {
  const rawInput = number(raw.input_tokens);
  const output = number(raw.output_tokens);
  const cacheRead = number(raw.cache_read_input_tokens ?? raw.cached_input_tokens);
  const cacheWrite = number(raw.cache_creation_input_tokens ?? raw.cache_write_input_tokens);
  const reasoning = number(raw.reasoning_output_tokens);
  const explicit = number(raw.total_tokens);
  const input = options.inputIncludesCache ? Math.max(0, rawInput - cacheRead) : rawInput;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    // signal is the cache-free metric: fresh input plus output. It is the only
    // figure both transcripts and the stats cache can report, and the only one
    // comparable across providers, so the heatmap is scaled against it.
    signal: input + output,
    tokens: explicit || input + output + cacheRead + cacheWrite,
    messages: 1,
    sessions: 0,
  };
}

function add(into, value) {
  for (const key of Object.keys(into)) into[key] += number(value[key]);
  return into;
}

function dateKey(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Resolve any accepted date form to local noon on the intended calendar day.
 * A bare `YYYY-MM-DD` must be split by hand: `new Date('2026-03-09')` is parsed
 * as UTC midnight, which lands on the previous day everywhere west of UTC.
 * Noon keeps the value clear of both DST edges.
 */
function noon(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  if (typeof value === 'string') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (parts) return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12);
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return noon(parsed);
  }
  return new Date(NaN);
}

async function listJsonl(root) {
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    let entries = [];
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
    }
  }
  return files;
}

async function readLines(file, visit) {
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try { visit(JSON.parse(line)); } catch { /* tolerate partial active-session writes */ }
  }
}

function ensureDay(days, key) {
  if (!days[key]) days[key] = { claude: blankUsage(), codex: blankUsage(), backfilled: false };
  return days[key];
}

async function parseClaudeFile(file, days) {
  const messages = new Map();
  const activeDays = new Set();
  let lineNumber = 0;
  await readLines(file, (entry) => {
    lineNumber += 1;
    const raw = entry?.message?.usage;
    const day = dateKey(entry?.timestamp);
    if (!raw || !day) return;
    activeDays.add(day);
    const usage = tokenUsage(raw);
    const id = entry?.message?.id || entry?.requestId || `${file}:${lineNumber}`;
    const key = `${day}:${id}`;
    const previous = messages.get(key);
    if (!previous || usage.tokens > previous.tokens) messages.set(key, usage);
  });
  for (const [key, usage] of messages) add(ensureDay(days, key.slice(0, 10)).claude, usage);
  for (const day of activeDays) ensureDay(days, day).claude.sessions += 1;
}

async function parseCodexFile(file, days) {
  const activeDays = new Set();
  let previousTotal = blankUsage();
  await readLines(file, (entry) => {
    const day = dateKey(entry?.timestamp);
    if (!day || entry?.type !== 'event_msg' || entry?.payload?.type !== 'token_count') return;
    const info = entry.payload.info;
    if (!info) return;
    let usage;
    if (info.total_token_usage) {
      const current = tokenUsage(info.total_token_usage, { inputIncludesCache: true });
      usage = blankUsage();
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'signal', 'tokens']) {
        usage[key] = Math.max(0, current[key] - previousTotal[key]);
      }
      usage.messages = usage.tokens > 0 ? 1 : 0;
      previousTotal = current;
      if (!usage.tokens) return;
    } else if (info.last_token_usage) {
      usage = tokenUsage(info.last_token_usage, { inputIncludesCache: true });
      if (!usage.tokens) return;
    } else return;
    add(ensureDay(days, day).codex, usage);
    activeDays.add(day);
  });
  for (const day of activeDays) ensureDay(days, day).codex.sessions += 1;
}

/**
 * Claude Code prunes old transcripts but keeps a rolling aggregate in
 * stats-cache.json. That file records input + output only (no cache tokens),
 * which is exactly the `signal` metric, so its days slot in beside transcript
 * days on the same scale. Transcripts win wherever both cover a day.
 */
async function parseClaudeStatsCache(file, days) {
  let parsed;
  try { parsed = JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { return 0; }
  const daily = Array.isArray(parsed?.dailyModelTokens) ? parsed.dailyModelTokens : [];
  const sessionsByDay = new Map();
  for (const row of Array.isArray(parsed?.dailyActivity) ? parsed.dailyActivity : []) {
    if (row?.date) sessionsByDay.set(row.date, row);
  }
  let backfilled = 0;
  for (const row of daily) {
    const day = typeof row?.date === 'string' ? row.date : null;
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const total = Object.values(row.tokensByModel || {}).reduce((sum, value) => sum + number(value), 0);
    if (total <= 0) continue;
    const bucket = ensureDay(days, day);
    if (bucket.claude.signal > 0) continue; // transcripts already cover this day
    const activity = sessionsByDay.get(day);
    bucket.claude.signal += total;
    bucket.claude.tokens += total;
    bucket.claude.messages += number(activity?.messageCount);
    bucket.claude.sessions += Math.max(1, number(activity?.sessionCount));
    bucket.backfilled = true;
    backfilled += 1;
  }
  return backfilled;
}

function mergeProvider(day) {
  return add(add(blankUsage(), day.claude), day.codex);
}

function streaks(rows) {
  let current = 0;
  let longest = 0;
  let previous = null;
  for (const row of rows.filter((item) => item.signal > 0)) {
    const date = noon(row.date);
    const consecutive = previous && (date - previous) / DAY === 1;
    current = consecutive ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = date;
  }
  return longest;
}

/**
 * Resolve the window the graph covers. Defaults to the full recorded history —
 * earliest day that has data through today — rather than a calendar year, so
 * activity before January 1 is not silently dropped. The start is snapped back
 * to a Sunday so week columns line up, and padded to `minWeeks` so a fresh
 * install still renders a full-looking grid.
 */
function resolveRange(days, options = {}) {
  const minWeeks = options.minWeeks ?? 26;
  const today = noon(options.today || new Date());
  let end = options.to ? noon(options.to) : today;
  let start;
  // An explicitly requested window is taken literally; only the default
  // full-history window gets padded out to minWeeks.
  let explicit = true;
  if (options.from) {
    start = noon(options.from);
  } else if (options.year) {
    start = new Date(options.year, 0, 1, 12);
    end = options.to ? end : new Date(options.year, 11, 31, 12);
  } else if (options.weeks) {
    start = new Date(end - (options.weeks * 7 - 1) * DAY);
  } else {
    explicit = false;
    const recorded = Object.keys(days).filter((key) => {
      const day = days[key];
      return day.claude.signal > 0 || day.codex.signal > 0 || day.claude.tokens > 0 || day.codex.tokens > 0;
    }).sort();
    start = recorded.length ? noon(recorded[0]) : new Date(end - (minWeeks * 7 - 1) * DAY);
  }
  const floor = new Date(end - (minWeeks * 7 - 1) * DAY);
  if (!explicit && start > floor) start = floor;
  if (start > end) start = new Date(end);
  start.setDate(start.getDate() - start.getDay()); // snap to Sunday
  return { start, end };
}

function summarize(days, provider = 'all', options = {}) {
  const settings = typeof options === 'number' ? { year: options } : options || {};
  const { start, end } = resolveRange(days, settings);
  const daily = [];
  const totals = blankUsage();
  let peak = null;
  let backfilledDays = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKey(cursor);
    const raw = days[key] || { claude: blankUsage(), codex: blankUsage(), backfilled: false };
    const value = provider === 'all' ? mergeProvider(raw) : raw[provider];
    const backfilled = Boolean(raw.backfilled) && provider !== 'codex';
    const row = {
      date: key,
      ...value,
      backfilled,
      // Both metrics per provider so the UI can switch between them without a refetch.
      providers: {
        claude: { signal: raw.claude.signal, tokens: raw.claude.tokens },
        codex: { signal: raw.codex.signal, tokens: raw.codex.tokens },
      },
    };
    daily.push(row);
    add(totals, value);
    if (backfilled && row.signal > 0) backfilledDays += 1;
    if (!peak || row.signal > peak.signal) peak = row;
  }
  return {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    provider,
    // `signal` scales the graph by default; `tokens` is the cache-inclusive
    // figure. Both ride along on every row so the UI can flip between them.
    metrics: ['signal', 'tokens'],
    range: { from: dateKey(start), to: dateKey(end) },
    year: end.getFullYear(),
    totals,
    activeDays: daily.filter((day) => day.signal > 0).length,
    backfilledDays,
    longestStreak: streaks(daily),
    peakDay: peak?.signal ? { date: peak.date, tokens: peak.signal } : null,
    daily,
  };
}

async function collect(options = {}) {
  const home = options.home || os.homedir();
  const roots = {
    claude: options.claudeRoots || [path.join(home, '.config', 'claude', 'projects'), path.join(home, '.claude', 'projects')],
    codex: options.codexRoots || [path.join(home, '.codex', 'sessions')],
  };
  const statsCaches = options.statsCaches || [
    path.join(home, '.claude', 'stats-cache.json'),
    path.join(home, '.config', 'claude', 'stats-cache.json'),
  ];
  const days = {};
  const files = { claude: [], codex: [] };
  for (const root of roots.claude) files.claude.push(...await listJsonl(root));
  for (const root of roots.codex) files.codex.push(...await listJsonl(root));
  await Promise.all([
    ...files.claude.map((file) => parseClaudeFile(file, days)),
    ...files.codex.map((file) => parseCodexFile(file, days)),
  ]);
  // Backfill runs last so it can defer to any day the transcripts already proved.
  let backfilled = 0;
  for (const cache of statsCaches) backfilled += await parseClaudeStatsCache(cache, days);
  return { days, files: { claude: files.claude.length, codex: files.codex.length, backfilled }, roots };
}

module.exports = { blankUsage, collect, dateKey, resolveRange, summarize, tokenUsage, PROVIDERS };
