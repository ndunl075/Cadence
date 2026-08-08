'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { collect, summarize, tokenUsage } = require('../src/usage');

test('normalizes provider token fields', () => {
  assert.deepEqual(tokenUsage({ input_tokens: 10, output_tokens: 5, cached_input_tokens: 20 }), {
    input: 10, output: 5, cacheRead: 20, cacheWrite: 0, reasoning: 0, tokens: 35, messages: 1, sessions: 0,
  });
});

test('deduplicates Claude message snapshots and differences Codex cumulative totals', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cadence-test-'));
  const claude = path.join(root, 'claude');
  const codex = path.join(root, 'codex');
  await fs.promises.mkdir(claude);
  await fs.promises.mkdir(codex);
  await fs.promises.writeFile(path.join(claude, 'session.jsonl'), [
    { type: 'assistant', timestamp: '2026-01-02T12:00:00Z', message: { id: 'm1', usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: 'assistant', timestamp: '2026-01-02T12:00:01Z', message: { id: 'm1', usage: { input_tokens: 10, output_tokens: 12 } } },
  ].map(JSON.stringify).join('\n'));
  await fs.promises.writeFile(path.join(codex, 'rollout.jsonl'), [
    { type: 'event_msg', timestamp: '2026-01-02T13:00:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } } },
    { type: 'event_msg', timestamp: '2026-01-02T13:01:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 150, output_tokens: 30, total_tokens: 180 } } } },
  ].map(JSON.stringify).join('\n'));

  const result = await collect({ claudeRoots: [claude], codexRoots: [codex] });
  const report = summarize(result.days, 'all', 2026);
  const day = report.daily.find((item) => item.date === '2026-01-02');
  assert.equal(day.providers.claude, 22);
  assert.equal(day.providers.codex, 180);
  assert.equal(day.tokens, 202);
  assert.deepEqual(result.files, { claude: 1, codex: 1 });
});

test('computes the longest active streak', () => {
  const value = { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, tokens: 1, messages: 1, sessions: 1 };
  const empty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, tokens: 0, messages: 0, sessions: 0 };
  const days = {
    '2026-02-01': { claude: value, codex: empty },
    '2026-02-02': { claude: value, codex: empty },
    '2026-02-04': { claude: value, codex: empty },
  };
  assert.equal(summarize(days, 'claude', 2026).longestStreak, 2);
});
