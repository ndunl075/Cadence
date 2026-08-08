'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const PROVIDERS = ['claude', 'codex'];

function blankUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, tokens: 0, messages: 0, sessions: 0 };
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function tokenUsage(raw = {}) {
  const input = number(raw.input_tokens);
  const output = number(raw.output_tokens);
  const cacheRead = number(raw.cache_read_input_tokens ?? raw.cached_input_tokens);
  const cacheWrite = number(raw.cache_creation_input_tokens ?? raw.cache_write_input_tokens);
  const reasoning = number(raw.reasoning_output_tokens);
  const explicit = number(raw.total_tokens);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
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
  if (typeof timestamp !== 'string') return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  if (!days[key]) days[key] = { claude: blankUsage(), codex: blankUsage() };
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
      const current = tokenUsage(info.total_token_usage);
      usage = blankUsage();
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'tokens']) {
        usage[key] = Math.max(0, current[key] - previousTotal[key]);
      }
      usage.messages = usage.tokens > 0 ? 1 : 0;
      previousTotal = current;
      if (!usage.tokens) return;
    } else if (info.last_token_usage) {
      usage = tokenUsage(info.last_token_usage);
      if (!usage.tokens) return;
    } else return;
    add(ensureDay(days, day).codex, usage);
    activeDays.add(day);
  });
  for (const day of activeDays) ensureDay(days, day).codex.sessions += 1;
}

function mergeProvider(day) {
  return add(add(blankUsage(), day.claude), day.codex);
}

function streaks(rows) {
  let current = 0;
  let longest = 0;
  let previous = null;
  for (const row of rows.filter((item) => item.tokens > 0)) {
    const date = new Date(`${row.date}T12:00:00`);
    const consecutive = previous && (date - previous) / 86400000 === 1;
    current = consecutive ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = date;
  }
  return longest;
}

function summarize(days, provider = 'all', year = new Date().getFullYear()) {
  const start = new Date(year, 0, 1, 12);
  const end = new Date(year, 11, 31, 12);
  const daily = [];
  const totals = blankUsage();
  let peak = null;
  for (let cursor = start; cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKey(cursor.toISOString());
    const raw = days[key] || { claude: blankUsage(), codex: blankUsage() };
    const value = provider === 'all' ? mergeProvider(raw) : raw[provider];
    const row = { date: key, ...value, providers: { claude: raw.claude.tokens, codex: raw.codex.tokens } };
    daily.push(row);
    add(totals, value);
    if (!peak || row.tokens > peak.tokens) peak = row;
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provider,
    year,
    totals,
    activeDays: daily.filter((day) => day.tokens > 0).length,
    longestStreak: streaks(daily),
    peakDay: peak?.tokens ? { date: peak.date, tokens: peak.tokens } : null,
    daily,
  };
}

async function collect(options = {}) {
  const home = options.home || os.homedir();
  const roots = {
    claude: options.claudeRoots || [path.join(home, '.config', 'claude', 'projects'), path.join(home, '.claude', 'projects')],
    codex: options.codexRoots || [path.join(home, '.codex', 'sessions')],
  };
  const days = {};
  const files = { claude: [], codex: [] };
  for (const root of roots.claude) files.claude.push(...await listJsonl(root));
  for (const root of roots.codex) files.codex.push(...await listJsonl(root));
  await Promise.all([
    ...files.claude.map((file) => parseClaudeFile(file, days)),
    ...files.codex.map((file) => parseCodexFile(file, days)),
  ]);
  return { days, files: { claude: files.claude.length, codex: files.codex.length }, roots };
}

module.exports = { blankUsage, collect, dateKey, summarize, tokenUsage, PROVIDERS };
