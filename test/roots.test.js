'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { claudeRoots, claudeStatsCaches, codexRoots, collect } = require('../src/usage');

const has = (list, suffix) => list.some((item) => item.endsWith(path.normalize(suffix)));

test('finds Claude transcripts at the default location', () => {
  const roots = claudeRoots('/home/x', {});
  assert.ok(has(roots, path.join('.claude', 'projects')), roots.join(', '));
});

test('honours CLAUDE_CONFIG_DIR', () => {
  const roots = claudeRoots('/home/x', { CLAUDE_CONFIG_DIR: '/custom/claude' });
  assert.ok(has(roots, path.join('custom', 'claude', 'projects')), roots.join(', '));
  assert.ok(has(roots, path.join('.claude', 'projects')), 'default stays as a fallback');
});

test('accepts several directories in CLAUDE_CONFIG_DIR', () => {
  const roots = claudeRoots('/home/x', { CLAUDE_CONFIG_DIR: ['/a', '/b'].join(path.delimiter) });
  assert.ok(has(roots, path.join('a', 'projects')), roots.join(', '));
  assert.ok(has(roots, path.join('b', 'projects')), roots.join(', '));
});

test('honours XDG_CONFIG_HOME for Claude', () => {
  const roots = claudeRoots('/home/x', { XDG_CONFIG_HOME: '/home/x/.config' });
  assert.ok(has(roots, path.join('.config', 'claude', 'projects')), roots.join(', '));
});

test('honours CODEX_HOME', () => {
  const roots = codexRoots('/home/x', { CODEX_HOME: '/custom/codex' });
  assert.ok(has(roots, path.join('custom', 'codex', 'sessions')), roots.join(', '));
  assert.ok(has(roots, path.join('.codex', 'sessions')), 'default stays as a fallback');
});

test('looks for the stats cache alongside every Claude config dir', () => {
  const files = claudeStatsCaches('/home/x', { CLAUDE_CONFIG_DIR: '/custom/claude' });
  assert.ok(has(files, path.join('custom', 'claude', 'stats-cache.json')), files.join(', '));
  assert.ok(has(files, path.join('.claude', 'stats-cache.json')), files.join(', '));
});

test('overlapping roots do not double-count a transcript', async () => {
  // CLAUDE_CONFIG_DIR is commonly just ~/.claude, which makes the override and
  // the default resolve to the same directory.
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cadence-roots-'));
  const projects = path.join(home, '.claude', 'projects');
  await fs.promises.mkdir(projects, { recursive: true });
  await fs.promises.writeFile(path.join(projects, 'session.jsonl'), JSON.stringify(
    { type: 'assistant', timestamp: '2026-01-02T12:00:00Z', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 20 } } },
  ));

  const result = await collect({ home, env: { CLAUDE_CONFIG_DIR: path.join(home, '.claude') } });
  assert.equal(result.files.claude, 1, 'the same transcript must only be read once');
  assert.equal(result.days['2026-01-02'].claude.signal, 120, 'counted once, not twice');
});

test('an unknown home yields empty data rather than throwing', async () => {
  const result = await collect({ home: path.join(os.tmpdir(), 'cadence-nonexistent-home'), env: {} });
  assert.deepEqual(result.files, { claude: 0, codex: 0, backfilled: 0 });
  assert.deepEqual(result.days, {});
});
