'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { isCliInvocation, parseArgs, run, weeksWindow } = require('../src/cli');

const ESCAPE = /\u001b\[/;

async function fixture(entries) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cadence-cli-'));
  const claude = path.join(root, 'claude');
  const codex = path.join(root, 'codex');
  await fs.promises.mkdir(claude);
  await fs.promises.mkdir(codex);
  await fs.promises.writeFile(path.join(claude, 'session.jsonl'), entries.map(JSON.stringify).join('\n'));
  return { root, collect: { claudeRoots: [claude], codexRoots: [codex], statsCaches: [], cursorStores: [] } };
}

/** A stdout that records what was written, standing in for a terminal. */
function sink(extra = {}) {
  return { text: '', write(chunk) { this.text += chunk; return true; }, ...extra };
}

function claudeDay(date, tokens) {
  return { type: 'assistant', timestamp: `${date}T12:00:00Z`, message: { id: `${date}-1`, usage: { input_tokens: tokens, output_tokens: tokens } } };
}

function codexDay(date, tokens) {
  return { type: 'event_msg', timestamp: `${date}T12:00:00Z`, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: tokens, output_tokens: tokens } } } };
}

/** `n` days before the fixed test date, as YYYY-MM-DD. */
const TODAY = new Date(2026, 2, 11, 12); // a Wednesday, so the last column is partial
function daysAgo(count) {
  const date = new Date(TODAY);
  date.setDate(date.getDate() - count);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

test('parses commands, flags and their short forms', () => {
  assert.deepEqual(parseArgs([]), {
    command: 'graph', provider: 'all', metric: 'signal', window: { kind: 'auto' }, colour: 'auto', glyphs: 'unicode', out: null,
  });
  assert.equal(parseArgs(['json']).command, 'json');
  assert.equal(parseArgs(['-p', 'codex']).provider, 'codex');
  assert.equal(parseArgs(['--metric', 'tokens']).metric, 'tokens');
  assert.deepEqual(parseArgs(['-w', '12']).window, { kind: 'weeks', value: 12 });
  assert.deepEqual(parseArgs(['--year', '2025']).window, { kind: 'year', value: 2025 });
  assert.deepEqual(parseArgs(['--since', '2025-01-31']).window, { kind: 'since', value: '2025-01-31' });
  assert.deepEqual(parseArgs(['--full']).window, { kind: 'full' });
  assert.equal(parseArgs(['--no-color']).colour, false);
  assert.equal(parseArgs(['--ascii']).glyphs, 'ascii');
});

test('rejects bad input instead of quietly redrawing the default', async () => {
  for (const argv of [['nope'], ['--bogus'], ['-p', 'gemini'], ['-m', 'words'], ['-w', '0'], ['-w', 'ten'], ['--year', '26'], ['--since', 'March'], ['--weeks']]) {
    assert.ok(parseArgs(argv).error, `expected ${argv.join(' ')} to be rejected`);
    const stderr = sink();
    assert.equal(await run(argv, { stdout: sink(), stderr }), 2);
    assert.match(stderr.text, /cadence --help/);
  }
});

test('draws a labelled grid for the requested window', async () => {
  const { collect } = await fixture([claudeDay(daysAgo(1), 5000), claudeDay(daysAgo(2), 500), claudeDay(daysAgo(40), 50)]);
  const stdout = sink();
  const code = await run(['graph', '--weeks', '8', '--no-color'], { stdout, collect, today: TODAY });
  assert.equal(code, 0);
  const lines = stdout.text.split('\n');

  assert.match(lines[0], /^Claude \+ Codex \+ Cursor cadence SIGNAL$/);
  assert.match(lines[1], /^11,100 tokens · 3 active days · 2 day streak$/);
  assert.ok(lines.some((line) => /^Wed /.test(line)), 'weekday gutter is labelled');
  assert.ok(lines.some((line) => /JAN|FEB|MAR/.test(line)), 'months are labelled');
  assert.ok(lines.some((line) => line.includes('Less') && line.includes('More')), 'a plain-text graph keeps one scale');
  // Eight weeks back from a Wednesday, snapped to Sunday: 2026-01-18 through today.
  assert.ok(stdout.text.includes('2026-01-18 — 2026-03-11'), stdout.text);
  assert.match(stdout.text, /≈ .+/, 'the reference line is restated in human units');

  const rows = lines.filter((line) => /^(Mon|Wed|Fri|    )[·░▒▓█ ]+$/.test(line));
  assert.equal(rows.length, 7, 'one row per weekday');
  for (const row of rows) assert.ok(row.length <= 4 + 8 * 2, `row overflows its window: ${row.length}`);
});

test('colour is off for a pipe, on for a terminal, and always off with --no-color', async () => {
  const { collect } = await fixture([claudeDay(daysAgo(1), 5000)]);
  const io = { collect, today: TODAY, width: 60, env: {} };

  const piped = sink();
  await run(['--weeks', '4'], { ...io, stdout: piped });
  assert.doesNotMatch(piped.text, ESCAPE, 'a redirected graph stays plain text');

  const terminal = sink({ isTTY: true });
  await run(['--weeks', '4'], { ...io, stdout: terminal });
  assert.match(terminal.text, ESCAPE);
  assert.ok(terminal.text.includes('\u001b[38;2;57;211;83m'), 'busiest combined day uses GitHub green');

  const forced = sink();
  await run(['--weeks', '4', '--color'], { ...io, stdout: forced });
  assert.match(forced.text, ESCAPE);

  const refused = sink({ isTTY: true });
  await run(['--weeks', '4', '--no-color'], { ...io, stdout: refused });
  assert.doesNotMatch(refused.text, ESCAPE);

  const respectful = sink({ isTTY: true });
  await run(['--weeks', '4'], { ...io, stdout: respectful, env: { NO_COLOR: '1' } });
  assert.doesNotMatch(respectful.text, ESCAPE, 'NO_COLOR is honoured without a flag');
});

test('paints a Codex-heavy day in GitHub green in the combined view', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cadence-cli-'));
  const claude = path.join(root, 'claude');
  const codex = path.join(root, 'codex');
  await fs.promises.mkdir(claude);
  await fs.promises.mkdir(codex);
  await fs.promises.writeFile(path.join(claude, 's.jsonl'), JSON.stringify(claudeDay(daysAgo(1), 10)));
  await fs.promises.writeFile(path.join(codex, 'r.jsonl'), JSON.stringify(codexDay(daysAgo(1), 9000)));

  const stdout = sink({ isTTY: true });
  await run(['--weeks', '4'], { stdout, today: TODAY, env: {}, collect: { claudeRoots: [claude], codexRoots: [codex], statsCaches: [], cursorStores: [] } });
  assert.ok(stdout.text.includes('\u001b[38;2;57;211;83m'), 'the busiest combined day is GitHub green');
  assert.ok(stdout.text.includes('\u001b[38;2;14;68;41m'), 'the legend includes GitHub green level one');
});

test('paints a Cursor-heavy day in GitHub green in the combined view', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cadence-cli-'));
  const claude = path.join(root, 'claude');
  await fs.promises.mkdir(claude);
  await fs.promises.writeFile(path.join(claude, 's.jsonl'), JSON.stringify(claudeDay(daysAgo(1), 10)));

  const store = path.join(root, 'state.vscdb');
  const db = new DatabaseSync(store);
  db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)');
  db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)').run('bubbleId:chat:turn', JSON.stringify({
    type: 2, createdAt: `${daysAgo(1)}T12:00:00Z`, usageUuid: 'u1', tokenCount: { inputTokens: 8000, outputTokens: 900 },
  }));
  db.close();

  const stdout = sink({ isTTY: true });
  await run(['--weeks', '4'], {
    stdout, today: TODAY, env: {},
    collect: { claudeRoots: [claude], codexRoots: [], statsCaches: [], cursorStores: [store] },
  });
  assert.ok(stdout.text.includes('\u001b[38;2;57;211;83m'), 'the busiest combined day is GitHub green');
});

test('falls back to the history that fits the terminal, and says so', async () => {
  const { collect } = await fixture([claudeDay(daysAgo(1), 100), claudeDay(daysAgo(200), 100)]);

  const narrow = sink({ columns: 30 });
  await run([], { stdout: narrow, collect, today: TODAY });
  assert.match(narrow.text, /Showing the last 13 weeks of 30 — pass --full for all of it\./);

  const reaches = (text) => /(\d{4}-\d{2}-\d{2}) —/.exec(text)[1] <= daysAgo(200);

  const wide = sink({ columns: 200 });
  await run([], { stdout: wide, collect, today: TODAY });
  assert.doesNotMatch(wide.text, /Showing the last/, 'a terminal wide enough gets the whole history');
  assert.ok(reaches(wide.text), 'the oldest recorded day is still in range');

  const full = sink({ columns: 30 });
  await run(['--full'], { stdout: full, collect, today: TODAY });
  assert.doesNotMatch(full.text, /Showing the last/, '--full overrides the fit');
  assert.ok(reaches(full.text), '--full reaches the oldest recorded day whatever the width');
});

test('serves the same report as the API over stdout', async () => {
  const { collect } = await fixture([claudeDay(daysAgo(1), 700)]);
  const stdout = sink();
  assert.equal(await run(['json', '--year', '2026'], { stdout, collect, today: TODAY }), 0);
  const report = JSON.parse(stdout.text);
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.totals.signal, 1400);
  assert.deepEqual(report.sources, { claude: 1, codex: 0, cursor: 0, backfilled: 0 });
  assert.ok(Array.isArray(report.comparisons.signal));
  assert.equal(report.daily.find((day) => day.date === daysAgo(1)).signal, 1400);
});

test('writes the SVG to a file when asked, leaving stdout for the confirmation', async () => {
  const { root, collect } = await fixture([claudeDay(daysAgo(1), 700)]);
  const target = path.join(root, 'nested', 'cadence.svg');
  const stdout = sink();
  assert.equal(await run(['svg', '--weeks', '6', '--out', target], { stdout, collect, today: TODAY }), 0);
  assert.match(stdout.text, /^Wrote /);
  const svg = await fs.promises.readFile(target, 'utf8');
  assert.match(svg, /^<svg xmlns/);
  assert.match(svg, /1,400 tokens/);
});

test('windows are whole columns ending today', () => {
  const window = weeksWindow(4, new Date(2026, 2, 11, 12)); // Wednesday
  assert.deepEqual(window, { from: '2026-02-15', to: '2026-03-11' });
  assert.equal(new Date(`${window.from}T12:00:00`).getDay(), 0, 'starts on a Sunday');
});

test('tells a CLI invocation apart from a double-click', () => {
  assert.equal(isCliInvocation([]), false, 'no arguments opens the widget');
  assert.equal(isCliInvocation(['--enable-logging']), false, 'a Chromium switch is not ours');
  for (const argv of [['graph'], ['json'], ['--help'], ['-v'], ['--weeks', '10'], ['--enable-logging', '--full']]) {
    assert.equal(isCliInvocation(argv), true, `expected ${argv.join(' ')} to run as CLI`);
  }
});
