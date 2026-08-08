'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const PROVIDERS = ['claude', 'codex', 'cursor'];
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
  if (!days[key]) days[key] = { claude: blankUsage(), codex: blankUsage(), cursor: blankUsage(), backfilled: false };
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
 * Cursor keeps no transcript files. Its chat history lives in a VS Code style
 * SQLite store, where each assistant turn is a row in `cursorDiskKV` keyed
 * `bubbleId:<chat>:<turn>`, holding a JSON blob with `tokenCount` and
 * `createdAt`. Rows whose count is zero are the user's own turns and the
 * bookkeeping rows around them, so the query drops them at the database rather
 * than parsing tens of thousands of blobs to find the ones that matter.
 */
const CURSOR_QUERY = `
  SELECT key, value FROM cursorDiskKV
  WHERE key LIKE 'bubbleId:%'
    AND value LIKE '%"tokenCount":%'
    AND value NOT LIKE '%"tokenCount":{"inputTokens":0,"outputTokens":0}%'
`;

let sqliteModule;

/**
 * `node:sqlite` is experimental on Node 22 and announces itself on stderr the
 * first time it is loaded. Nobody asked Cadence for a SQLite warning, so it is
 * swallowed here — and only that one. Older runtimes without the module simply
 * lose the Cursor provider rather than failing the whole scan.
 */
function sqlite() {
  if (sqliteModule !== undefined) return sqliteModule;
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
    if (type === 'ExperimentalWarning' && /sqlite/i.test(String(warning))) return;
    emitWarning.call(process, warning, ...rest);
  };
  try { sqliteModule = require('node:sqlite'); } catch { sqliteModule = null; } finally { process.emitWarning = emitWarning; }
  return sqliteModule;
}

/**
 * Cursor's store grows into the gigabytes and the scan has to read every chat
 * blob, so the extracted rows are kept and only recomputed when the file (or
 * the write-ahead log beside it, which is where a running Cursor puts recent
 * turns) actually changes.
 */
const cursorCache = new Map();

function fileSignature(file) {
  const stamp = (candidate) => {
    try {
      const stats = fs.statSync(candidate);
      return `${stats.mtimeMs}:${stats.size}`;
    } catch { return '-'; }
  };
  return `${stamp(file)}|${stamp(`${file}-wal`)}`;
}

/**
 * Read a store into flat per-turn records. Kept synchronous: the warning patch
 * above is process-wide, so nothing else may run while it is installed.
 */
function readCursorStore(file) {
  const signature = fileSignature(file);
  const cached = cursorCache.get(file);
  if (cached && cached.signature === signature) return cached.records;

  const records = [];
  const runtime = sqlite();
  if (runtime) {
    let db = null;
    try {
      db = new runtime.DatabaseSync(file, { readOnly: true });
      for (const row of db.prepare(CURSOR_QUERY).all()) {
        const text = String(row.value);
        const counts = /"tokenCount":\{"inputTokens":(\d+),"outputTokens":(\d+)\}/.exec(text);
        const created = /"createdAt":"([^"]+)"/.exec(text);
        if (!counts || !created) continue;
        records.push({
          // usageUuid is the server's id for the turn, so the same turn seen in
          // two stores (a second Cursor install, a restored profile) counts once.
          id: /"usageUuid":"([^"]+)"/.exec(text)?.[1] || String(row.key),
          chat: String(row.key).split(':')[1] || '',
          timestamp: created[1],
          input: Number(counts[1]),
          output: Number(counts[2]),
        });
      }
    } catch {
      // A store locked by a running Cursor, or one written by a newer schema,
      // costs us Cursor's rows and nothing else.
    } finally {
      try { db?.close(); } catch { /* already gone */ }
    }
  }
  cursorCache.set(file, { signature, records });
  return records;
}

/**
 * Cursor reports no cache breakdown at all — just input and output — and its
 * input is the whole prompt for the turn, context included. There is nothing to
 * subtract, so unlike Codex it cannot be put on the same cache-free footing as
 * Claude, and a Cursor day reads high against a Claude day. Counted as
 * reported, and said plainly in the README rather than silently scaled.
 */
function parseCursorStore(file, days, seen, chats) {
  const chatDays = new Set();
  for (const record of readCursorStore(file)) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    const day = dateKey(record.timestamp);
    if (!day) continue;
    const usage = blankUsage();
    usage.input = record.input;
    usage.output = record.output;
    usage.signal = record.input + record.output;
    usage.tokens = usage.signal;
    usage.messages = 1;
    add(ensureDay(days, day).cursor, usage);
    chats.add(record.chat);
    chatDays.add(`${day}:${record.chat}`);
  }
  for (const entry of chatDays) ensureDay(days, entry.slice(0, 10)).cursor.sessions += 1;
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
  return add(add(add(blankUsage(), day.claude), day.codex), day.cursor);
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
    const recorded = Object.keys(days).filter((key) => PROVIDERS.some((name) => {
      const usage = days[key][name];
      return usage && (usage.signal > 0 || usage.tokens > 0);
    })).sort();
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
    const raw = days[key] || { claude: blankUsage(), codex: blankUsage(), cursor: blankUsage(), backfilled: false };
    const value = provider === 'all' ? mergeProvider(raw) : raw[provider];
    // Only Claude has a stats cache to be backfilled from, so the marker is
    // meaningless on the other providers' own views.
    const backfilled = Boolean(raw.backfilled) && (provider === 'all' || provider === 'claude');
    const row = {
      date: key,
      ...value,
      backfilled,
      // Both metrics per provider so the UI can switch between them without a refetch.
      providers: {
        claude: { signal: raw.claude.signal, tokens: raw.claude.tokens },
        codex: { signal: raw.codex.signal, tokens: raw.codex.tokens },
        cursor: { signal: raw.cursor.signal, tokens: raw.cursor.tokens },
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

/**
 * Both CLIs let you relocate their config directory, and a Cadence build that
 * only knows the default paths would show an empty graph for anyone who has:
 *
 *   CLAUDE_CONFIG_DIR  Claude Code's explicit override (may list several dirs)
 *   XDG_CONFIG_HOME    honoured by Claude Code on Linux
 *   CODEX_HOME         Codex's explicit override
 *
 * Every candidate is probed; missing ones cost a single failed stat.
 */
function configDirs(value) {
  return String(value || '').split(path.delimiter).map((dir) => dir.trim()).filter(Boolean);
}

function claudeRoots(home, env) {
  const roots = configDirs(env.CLAUDE_CONFIG_DIR).map((dir) => path.join(dir, 'projects'));
  roots.push(path.join(home, '.claude', 'projects'));
  if (env.XDG_CONFIG_HOME) roots.push(path.join(env.XDG_CONFIG_HOME, 'claude', 'projects'));
  roots.push(path.join(home, '.config', 'claude', 'projects'));
  return roots;
}

function codexRoots(home, env) {
  const roots = configDirs(env.CODEX_HOME).map((dir) => path.join(dir, 'sessions'));
  roots.push(path.join(home, '.codex', 'sessions'));
  return roots;
}

/**
 * Cursor is an Electron editor, so its store sits where VS Code would keep one:
 * under the OS application-data directory, not in the home dot-directory that
 * holds its extensions and projects. `CURSOR_HOME` overrides the parent of
 * `User/`, matching how CODEX_HOME works.
 */
function cursorStores(home, env) {
  const store = (base) => path.join(base, 'User', 'globalStorage', 'state.vscdb');
  const stores = configDirs(env.CURSOR_HOME).map(store);
  if (process.platform === 'win32') {
    stores.push(store(path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor')));
  } else if (process.platform === 'darwin') {
    stores.push(store(path.join(home, 'Library', 'Application Support', 'Cursor')));
  }
  stores.push(store(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Cursor')));
  return stores;
}

function claudeStatsCaches(home, env) {
  const files = configDirs(env.CLAUDE_CONFIG_DIR).map((dir) => path.join(dir, 'stats-cache.json'));
  files.push(path.join(home, '.claude', 'stats-cache.json'));
  if (env.XDG_CONFIG_HOME) files.push(path.join(env.XDG_CONFIG_HOME, 'claude', 'stats-cache.json'));
  files.push(path.join(home, '.config', 'claude', 'stats-cache.json'));
  return files;
}

/**
 * Candidate roots can overlap — CLAUDE_CONFIG_DIR is often just ~/.claude —
 * and parsing the same transcript twice would double every figure it holds.
 * Key on the resolved path, case-folded where the filesystem is.
 */
function unique(paths) {
  const seen = new Map();
  for (const item of paths) {
    const resolved = path.resolve(item);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

async function collect(options = {}) {
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const roots = {
    claude: unique(options.claudeRoots || claudeRoots(home, env)),
    codex: unique(options.codexRoots || codexRoots(home, env)),
    cursor: unique(options.cursorStores || cursorStores(home, env)),
  };
  const statsCaches = unique(options.statsCaches || claudeStatsCaches(home, env));
  const days = {};
  const files = { claude: [], codex: [] };
  for (const root of roots.claude) files.claude.push(...await listJsonl(root));
  for (const root of roots.codex) files.codex.push(...await listJsonl(root));
  files.claude = unique(files.claude);
  files.codex = unique(files.codex);
  await Promise.all([
    ...files.claude.map((file) => parseClaudeFile(file, days)),
    ...files.codex.map((file) => parseCodexFile(file, days)),
  ]);
  // Cursor keeps one store rather than a file per session, so its count is
  // chats rather than files — the useful number when checking it was found.
  const seenTurns = new Set();
  const chats = new Set();
  for (const store of roots.cursor) {
    if (fs.existsSync(store)) parseCursorStore(store, days, seenTurns, chats);
  }
  // Backfill runs last so it can defer to any day the transcripts already proved.
  let backfilled = 0;
  for (const cache of statsCaches) backfilled += await parseClaudeStatsCache(cache, days);
  return { days, files: { claude: files.claude.length, codex: files.codex.length, cursor: chats.size, backfilled }, roots };
}

module.exports = { blankUsage, claudeRoots, claudeStatsCaches, codexRoots, collect, cursorStores, dateKey, resolveRange, summarize, tokenUsage, PROVIDERS };
