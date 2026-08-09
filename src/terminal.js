'use strict';

const { PALETTES, level } = require('./svg');

/**
 * The same graph the widget draws, in a terminal. The ramps and the log scale
 * come from `svg.js` verbatim, so a day is the same colour here as it is on the
 * panel. Only the empty-day step differs: the panel paints level 0 against its
 * own near-black bezel, which disappears on a terminal that brings its own
 * background, so unworked days get a neutral grey dot instead.
 */
const EMPTY = '#4a5058';

const GLYPHS = {
  unicode: { cell: '■', empty: '·', mono: ['·', '░', '▒', '▓', '█'], approx: '≈', dash: '—', dot: '·' },
  ascii: { cell: '#', empty: '.', mono: ['.', '-', '+', '*', '#'], approx: '~', dash: '-', dot: '-' },
};

const ESC = '';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;

const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const GUTTER = 4; // "Mon " — the widest row label plus its separating space
const CELL = 2; // one glyph and one space, so columns read as a grid, not a bar

function ansi(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${ESC}[38;2;${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}m`;
}

function noonOf(key) {
  return new Date(`${key}T12:00:00`);
}

/** Printable columns a string occupies, ignoring the colour codes in it. */
function visibleWidth(text) {
  return text.replace(ANSI, '').length;
}

/**
 * Columns a report needs, including the blank cells before its first day. A
 * report never starts mid-week once `resolveRange` has snapped to Sunday, but
 * an explicit `--since` can, so the offset is measured rather than assumed.
 */
function columnsFor(report) {
  const daily = report.daily || [];
  if (!daily.length) return 0;
  return Math.ceil((daily.length + noonOf(daily[0].date).getDay()) / 7);
}

/** Terminal columns a rendered report will occupy. */
function widthFor(report) {
  return GUTTER + columnsFor(report) * CELL;
}

/** Weeks that fit in `width` terminal columns, floored at something drawable. */
function weeksThatFit(width) {
  return Math.max(4, Math.floor((width - GUTTER) / CELL));
}

function renderTerminal(report, options = {}) {
  const daily = report.daily || [];
  if (!daily.length) return 'No activity recorded yet.';

  const metric = options.metric === 'tokens' ? 'tokens' : 'signal';
  const colour = options.colour !== false;
  const glyphs = GLYPHS[options.glyphs === 'ascii' ? 'ascii' : 'unicode'];
  const palette = PALETTES[report.provider] || PALETTES.all;
  const max = Math.max(...daily.map((day) => day[metric]), 1);
  const offset = noonOf(daily[0].date).getDay();
  const columns = columnsFor(report);
  const faint = (text) => (colour && text.trim() ? `${DIM}${text}${RESET}` : text);

  /** One day as `<glyph><space>`; both modes keep the width identical. */
  function swatch(step, scale) {
    if (!colour) return `${glyphs.mono[step]} `;
    if (!step) return `${DIM}${ansi(EMPTY)}${glyphs.empty}${RESET} `;
    return `${ansi(scale[step])}${glyphs.cell}${RESET} `;
  }

  function cell(day) {
    if (!day) return ' '.repeat(CELL);
    return swatch(level(day[metric], max), palette);
  }

  const rows = DAY_LABELS.map((label, weekday) => {
    let line = faint(label.padEnd(GUTTER));
    for (let column = 0; column < columns; column += 1) {
      const index = column * 7 + weekday - offset;
      line += cell(index >= 0 && index < daily.length ? daily[index] : null);
    }
    return line.trimEnd();
  });

  /**
   * Month ticks over the columns. A label is only drawn when its month owns
   * enough columns to sit clear of the next one, so a narrow window thins the
   * labels out rather than overlapping them. January carries its year.
   */
  const marks = [];
  let previousMonth = -1;
  daily.forEach((day, index) => {
    const date = noonOf(day.date);
    if (date.getMonth() === previousMonth) return;
    previousMonth = date.getMonth();
    marks.push({ column: Math.floor((index + offset) / 7), date });
  });
  let months = '';
  marks.forEach((mark, index) => {
    const label = mark.date.toLocaleDateString('en', { month: 'short' }).toUpperCase()
      + (mark.date.getMonth() === 0 ? ` ${mark.date.getFullYear()}` : '');
    const start = GUTTER + mark.column * CELL;
    const next = marks[index + 1];
    const room = ((next ? next.column : columns) - mark.column) * CELL;
    if (start < months.length + 1 || room < label.length + 1) return;
    months += ' '.repeat(start - months.length) + label;
  });

  const name = report.provider === 'all' ? 'Claude + Codex + Cursor' : report.provider[0].toUpperCase() + report.provider.slice(1);
  const gap = ` ${glyphs.dot} `;
  const headline = [
    `${report.totals[metric].toLocaleString('en')} tokens`,
    `${report.activeDays.toLocaleString('en')} active days`,
    `${report.longestStreak} day streak`,
  ].join(gap);

  // Every view has one Less…More scale; `all` uses GitHub's green ramp.
  const legend = `${faint('Less ')}${[0, 1, 2, 3, 4].map((step) => swatch(step, palette)).join('')}${faint('More')}`;
  const range = `${report.range.from} ${glyphs.dash} ${report.range.to}`;
  // Right-align the range under the graph when the window is wide enough for it
  // to clear the legend; on a narrow terminal it drops to its own line.
  const slack = widthFor(report) - visibleWidth(legend) - range.length;
  const footer = slack >= 2
    ? [legend + ' '.repeat(slack) + faint(range)]
    : [legend, faint(range)];

  const lines = [
    `${colour ? BOLD : ''}${name} cadence${colour ? RESET : ''} ${faint(metric === 'tokens' ? 'TOTAL' : 'SIGNAL')}`,
    faint(headline),
    '',
    faint(months.trimEnd()),
    ...rows,
    '',
    ...footer,
  ];
  if (options.comparison) lines.push(`${glyphs.approx} ${options.comparison.replace(/^~/, '')}`);
  if (options.note) lines.push(faint(options.note));
  return lines.join('\n');
}

module.exports = { CELL, EMPTY, GLYPHS, GUTTER, columnsFor, renderTerminal, weeksThatFit, widthFor };
