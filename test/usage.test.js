'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { collect, dateKey, resolveRange, summarize, tokenUsage } = require('../src/usage');

async function fixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cadence-test-'));
  const claude = path.join(root, 'claude');
  const codex = path.join(root, 'codex');
  await fs.promises.mkdir(claude);
  await fs.promises.mkdir(codex);
  return { root, claude, codex };
}

test('normalizes provider token fields', () => {
  assert.deepEqual(tokenUsage({ input_tokens: 10, output_tokens: 5, cached_input_tokens: 20 }), {
    input: 10, output: 5, cacheRead: 20, cacheWrite: 0, reasoning: 0, signal: 15, tokens: 35, messages: 1, sessions: 0,
  });
});

test('subtracts cached tokens from input when the provider reports it gross', () => {
  // Codex shape: input_tokens is inclusive of cached_input_tokens.
  const codex = tokenUsage(
    { input_tokens: 17966, cached_input_tokens: 11008, output_tokens: 271, total_tokens: 18237 },
    { inputIncludesCache: true },
  );
  assert.equal(codex.input, 6958);
  assert.equal(codex.signal, 7229);
  // Anthropic shape: input_tokens already excludes cache reads, so it is untouched.
  const claude = tokenUsage({ input_tokens: 6958, cache_read_input_tokens: 11008, output_tokens: 271 });
  assert.equal(claude.input, 6958);
  assert.equal(claude.signal, 7229);
});

test('deduplicates Claude message snapshots and differences Codex cumulative totals', async () => {
  const { claude, codex } = await fixture();
  await fs.promises.writeFile(path.join(claude, 'session.jsonl'), [
    { type: 'assistant', timestamp: '2026-01-02T12:00:00Z', message: { id: 'm1', usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: 'assistant', timestamp: '2026-01-02T12:00:01Z', message: { id: 'm1', usage: { input_tokens: 10, output_tokens: 12 } } },
  ].map(JSON.stringify).join('\n'));
  await fs.promises.writeFile(path.join(codex, 'rollout.jsonl'), [
    { type: 'event_msg', timestamp: '2026-01-02T13:00:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } } },
    { type: 'event_msg', timestamp: '2026-01-02T13:01:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 150, output_tokens: 30, total_tokens: 180 } } } },
  ].map(JSON.stringify).join('\n'));

  const result = await collect({ claudeRoots: [claude], codexRoots: [codex], statsCaches: [] });
  const report = summarize(result.days, 'all', { year: 2026 });
  const day = report.daily.find((item) => item.date === '2026-01-02');
  assert.equal(day.providers.claude.signal, 22);
  assert.equal(day.providers.codex.signal, 180);
  assert.equal(day.signal, 202);
  assert.equal(day.providers.codex.tokens, 180, 'both metrics ride along per provider');
  assert.deepEqual(result.files, { claude: 1, codex: 1, backfilled: 0 });
});

test('backfills pruned days from the Claude stats cache without overwriting transcripts', async () => {
  const { root, claude, codex } = await fixture();
  await fs.promises.writeFile(path.join(claude, 'session.jsonl'), JSON.stringify(
    { type: 'assistant', timestamp: '2026-01-02T12:00:00Z', message: { id: 'm1', usage: { input_tokens: 40, output_tokens: 10 } } },
  ));
  const cache = path.join(root, 'stats-cache.json');
  await fs.promises.writeFile(cache, JSON.stringify({
    dailyActivity: [{ date: '2025-11-04', messageCount: 12, sessionCount: 2 }],
    dailyModelTokens: [
      { date: '2025-11-04', tokensByModel: { 'claude-opus-4-5': 700, 'claude-sonnet-4-5': 300 } },
      { date: '2026-01-02', tokensByModel: { 'claude-opus-4-5': 99999 } },
    ],
  }));

  const result = await collect({ claudeRoots: [claude], codexRoots: [codex], statsCaches: [cache] });
  assert.equal(result.files.backfilled, 1, 'only the day transcripts do not cover is backfilled');
  assert.equal(result.days['2025-11-04'].claude.signal, 1000);
  assert.equal(result.days['2025-11-04'].claude.sessions, 2);
  assert.equal(result.days['2025-11-04'].backfilled, true);
  assert.equal(result.days['2026-01-02'].claude.signal, 50, 'transcript day is left alone');
  assert.equal(result.days['2026-01-02'].backfilled, false);
});

test('spans the full recorded history rather than one calendar year', () => {
  const days = {
    '2025-11-04': { claude: { ...blank(), signal: 1000, tokens: 1000 }, codex: blank(), backfilled: true },
    '2026-03-09': { claude: { ...blank(), signal: 20, tokens: 20 }, codex: blank(), backfilled: false },
  };
  const report = summarize(days, 'claude', { today: '2026-03-09' });
  assert.equal(report.range.to, '2026-03-09');
  assert.ok(report.range.from <= '2025-11-04', `expected range to reach 2025-11-04, got ${report.range.from}`);
  assert.equal(report.activeDays, 2, 'the pre-January day survives the window');
  assert.equal(report.backfilledDays, 1);
  assert.equal(new Date(`${report.range.from}T12:00:00`).getDay(), 0, 'window starts on a Sunday so columns align');
});

test('pads a short history out to a full-looking grid', () => {
  const days = { '2026-03-08': { claude: { ...blank(), signal: 5, tokens: 5 }, codex: blank(), backfilled: false } };
  const report = summarize(days, 'claude', { today: '2026-03-09', minWeeks: 26 });
  assert.ok(report.daily.length >= 26 * 7, `expected at least 26 weeks, got ${report.daily.length} days`);
});

test('computes the longest active streak', () => {
  const value = { ...blank(), input: 1, signal: 1, tokens: 1, messages: 1, sessions: 1 };
  const days = {
    '2026-02-01': { claude: value, codex: blank(), backfilled: false },
    '2026-02-02': { claude: value, codex: blank(), backfilled: false },
    '2026-02-04': { claude: value, codex: blank(), backfilled: false },
  };
  assert.equal(summarize(days, 'claude', { year: 2026 }).longestStreak, 2);
});

test('resolveRange honours an explicit trailing window', () => {
  // An explicit ?weeks= must not be widened by the default minimum-width floor.
  const { start, end } = resolveRange({}, { weeks: 12, today: '2026-03-09' });
  assert.equal(dateKey(end), '2026-03-09');
  const days = (end - start) / 86400000;
  assert.ok(days >= 12 * 7 - 7 && days < 13 * 7, `expected ~12 weeks, got ${(days / 7).toFixed(1)}`);
});

function blank() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, signal: 0, tokens: 0, messages: 0, sessions: 0 };
}
