#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { collect, summarize, PROVIDERS } = require('./usage');
const { comparisons } = require('./comparisons');
const { renderSvg } = require('./svg');
const { columnsFor, renderTerminal, weeksThatFit } = require('./terminal');

const COMMANDS = new Set(['graph', 'json', 'svg', 'help', 'version']);
const MAX_WEEKS = 520;

const HELP = `Cadence — your Claude Code, Codex and Cursor rhythm, in the terminal.

  cadence [graph]            draw the contribution graph (default)
  cadence json               the same report as JSON, for scripting
  cadence svg                the README-ready SVG

Options
  -p, --provider <name>      all (default), claude, codex, or cursor
  -m, --metric <name>        signal (default: input + output) or tokens (adds cache)
  -w, --weeks <n>            show the last n weeks
      --year <yyyy>          show one calendar year
      --since <yyyy-mm-dd>   show everything from a date onwards
      --full                 show all recorded history, even if it wraps
  -o, --out <file>           write to a file instead of stdout
      --ascii                draw with plain ASCII instead of block glyphs
      --no-color             never colourise (also honours NO_COLOR)
      --color                colourise even when stdout is not a terminal
  -h, --help                 this text
  -v, --version              print the version

With no window flag the graph fits your terminal, showing as much recent
history as there is room for. Nothing is uploaded; only local token counts
and timestamps are read.
`;

function fail(message) {
  return { error: message };
}

/**
 * Flags only, no positional arguments beyond the command, and an unknown flag
 * is an error rather than something quietly ignored — a mistyped `--weeks`
 * should not silently redraw the default window.
 */
function parseArgs(argv) {
  const parsed = {
    command: 'graph',
    provider: 'all',
    metric: 'signal',
    window: { kind: 'auto' },
    colour: 'auto',
    glyphs: 'unicode',
    out: null,
  };
  const rest = [...argv];
  if (rest.length && !rest[0].startsWith('-')) {
    const command = rest.shift().toLowerCase();
    if (!COMMANDS.has(command)) return fail(`Unknown command: ${command}`);
    parsed.command = command;
  }
  const next = (flag) => {
    const value = rest.shift();
    return value === undefined || value.startsWith('-') ? fail(`${flag} needs a value`) : value;
  };
  while (rest.length) {
    const flag = rest.shift();
    let value;
    switch (flag) {
      case '-p': case '--provider':
        value = next(flag);
        if (value.error) return value;
        if (value !== 'all' && !PROVIDERS.includes(value)) return fail(`Unknown provider: ${value}`);
        parsed.provider = value;
        break;
      case '-m': case '--metric':
        value = next(flag);
        if (value.error) return value;
        if (value !== 'signal' && value !== 'tokens') return fail(`Unknown metric: ${value}`);
        parsed.metric = value;
        break;
      case '-w': case '--weeks':
        value = next(flag);
        if (value.error) return value;
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_WEEKS) {
          return fail(`--weeks must be between 1 and ${MAX_WEEKS}`);
        }
        parsed.window = { kind: 'weeks', value: Number(value) };
        break;
      case '--year':
        value = next(flag);
        if (value.error) return value;
        if (!/^\d{4}$/.test(value)) return fail('--year must be a four-digit year');
        parsed.window = { kind: 'year', value: Number(value) };
        break;
      case '--since':
        value = next(flag);
        if (value.error) return value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail('--since must be YYYY-MM-DD');
        parsed.window = { kind: 'since', value };
        break;
      case '--full':
        parsed.window = { kind: 'full' };
        break;
      case '-o': case '--out':
        value = next(flag);
        if (value.error) return value;
        parsed.out = value;
        break;
      case '--ascii':
        parsed.glyphs = 'ascii';
        break;
      case '--no-color': case '--no-colour':
        parsed.colour = false;
        break;
      case '--color': case '--colour':
        parsed.colour = true;
        break;
      case '-h': case '--help':
        parsed.command = 'help';
        break;
      case '-v': case '--version':
        parsed.command = 'version';
        break;
      default:
        return fail(`Unknown option: ${flag}`);
    }
  }
  return parsed;
}

/**
 * `--weeks n` and the auto-fitted default both mean "n whole columns ending
 * today", so the start is pinned to the Sunday n-1 weeks back rather than to a
 * count of days — otherwise a mid-week today would round up to an extra column
 * and overflow the terminal it was measured against.
 */
function weeksWindow(weeks, today) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const start = new Date(end);
  start.setDate(start.getDate() - start.getDay() - (weeks - 1) * 7);
  const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { from: key(start), to: key(end) };
}

function summarizeFor(days, provider, window, today) {
  if (window.kind === 'weeks') return summarize(days, provider, { today, ...weeksWindow(window.value, today) });
  if (window.kind === 'year') return summarize(days, provider, { today, year: window.value });
  if (window.kind === 'since') return summarize(days, provider, { today, from: window.value });
  return summarize(days, provider, { today });
}

/**
 * The graph is only legible while its columns fit on one line, so the default
 * window is whatever recent history the terminal has room for. History shorter
 * than the terminal is shown whole; anything longer is trimmed from the left
 * and says so.
 */
function fitToTerminal(days, provider, width, today) {
  const full = summarize(days, provider, { today });
  if (!Number.isFinite(width)) return { report: full };
  const available = weeksThatFit(width);
  const recorded = columnsFor(full);
  if (recorded <= available) return { report: full };
  return {
    report: summarize(days, provider, { today, ...weeksWindow(available, today) }),
    note: `Showing the last ${available} weeks of ${recorded} — pass --full for all of it.`,
  };
}

/** The same payload `/api/v1/usage` serves, so scripts can read either one. */
function withExtras(report, sources) {
  return {
    ...report,
    comparisons: {
      signal: comparisons(report.totals.signal),
      tokens: comparisons(report.totals.tokens),
    },
    sources,
  };
}

/**
 * `stdout` is injected so the Electron build can hand in its own writer, and so
 * the tests can read what was drawn without a terminal.
 */
async function run(argv, io = {}) {
  const out = io.stdout || process.stdout;
  const err = io.stderr || process.stderr;
  const write = (text) => out.write(`${text}\n`);

  const options = parseArgs(argv);
  if (options.error) {
    err.write(`${options.error}\nTry: cadence --help\n`);
    return 2;
  }
  if (options.command === 'help') {
    write(HELP.trimEnd());
    return 0;
  }
  if (options.command === 'version') {
    write(require('../package.json').version);
    return 0;
  }

  const today = io.today || new Date();
  const data = await collect(io.collect || {});
  const fitted = options.window.kind === 'auto'
    ? fitToTerminal(data.days, options.provider, io.width ?? (out.columns || Infinity), today)
    : { report: summarizeFor(data.days, options.provider, options.window, today) };
  const { report, note } = fitted;

  if (options.command === 'json') {
    return finish(write, options, JSON.stringify(withExtras(report, data.files), null, 2));
  }
  if (options.command === 'svg') {
    return finish(write, options, renderSvg(report, { metric: options.metric }));
  }

  // Colour is on for a terminal and off for a pipe, which keeps `cadence graph
  // > file` free of escape codes, and honours the NO_COLOR convention.
  const colour = options.colour === 'auto'
    ? Boolean(out.isTTY) && !(io.env || process.env).NO_COLOR && !options.out
    : options.colour;
  return finish(write, options, renderTerminal(report, {
    metric: options.metric,
    colour,
    glyphs: options.glyphs,
    comparison: comparisons(report.totals[options.metric])[0],
    note,
  }));
}

function finish(write, options, text) {
  if (!options.out) {
    write(text);
    return 0;
  }
  fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
  fs.writeFileSync(options.out, `${text}\n`);
  write(`Wrote ${path.resolve(options.out)}`);
  return 0;
}

/** True when these arguments are a CLI invocation rather than "open the app". */
function isCliInvocation(argv) {
  return argv.some((argument, index) => (index === 0 && COMMANDS.has(argument.toLowerCase()))
    || /^(-p|-m|-w|-o|-h|-v|--provider|--metric|--weeks|--year|--since|--full|--out|--ascii|--no-colou?r|--colou?r|--help|--version)$/.test(argument));
}

module.exports = { HELP, isCliInvocation, parseArgs, run, weeksWindow };

if (require.main === module) {
  run(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
