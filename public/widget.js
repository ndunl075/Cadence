'use strict';

const $ = (selector) => document.querySelector(selector);
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');
const bridge = window.cadence || null;

const state = { provider: 'all', metric: 'signal', report: null, busy: false, flavour: 0 };

// Mirrors what the main process has on disk. Defaults match its own, so the
// panel still behaves sanely when it is opened in a browser with no bridge.
const settings = {
  theme: 'dark',
  scanSeconds: 60,
  launchAtLogin: false,
  rotateComparisons: true,
  barClaude: false,
  barCodex: false,
  barCursor: false,
  pinned: true,
  metric: 'signal',
  provider: 'all',
};

// `signal` is fresh input + output. `tokens` adds cache reads and writes, which
// on a heavy Claude Code workload is ~97% of the volume — a real number, just a
// very different one. The panel shows whichever the user picked last.
const METRICS = {
  signal: { label: 'SIGNAL', note: 'input + output, no cache' },
  tokens: { label: 'TOTAL', note: 'including cache reads and writes' },
};

function level(value, max) {
  if (!value) return 0;
  return Math.min(4, Math.max(1, Math.ceil((Math.log1p(value) / Math.log1p(max || 1)) * 4)));
}

/** Mirrors `owner()` in src/svg.js: the day belongs to whoever ran the most. */
function owner(claude, codex, cursor) {
  if (codex > claude && codex >= cursor) return 'codex';
  if (cursor > claude && cursor > codex) return 'cursor';
  return 'claude';
}

function dayLabel(key) {
  return new Date(`${key}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The panel is resizable and the history only grows, so cell size is derived
 * from the space actually available rather than fixed. Below the floor the grid
 * scrolls instead of shrinking into illegibility.
 */
function fitCells(weeks) {
  const wrap = $('.grid-wrap');
  const available = wrap.clientWidth;
  if (!available || !weeks) return;
  const gap = 2;
  const size = Math.floor((available - (weeks - 1) * gap) / weeks);
  const clamped = Math.max(4, Math.min(11, size));
  document.documentElement.style.setProperty('--cell', `${clamped}px`);
  document.documentElement.style.setProperty('--gap', `${gap}px`);
  wrap.scrollLeft = wrap.scrollWidth; // newest week stays in view
}

/**
 * Month ticks over the columns. A label is only drawn when its month owns
 * enough columns to sit clear of the previous one, so a narrow panel thins the
 * labels out instead of overlapping them. January carries its year.
 */
function buildMonths(daily, offset, weeks) {
  const months = $('#months');
  const cell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell')) || 9;
  const minColumns = Math.max(2, Math.ceil(22 / (cell + 2)));
  const marks = [];
  let previous = -1;
  daily.forEach((day, index) => {
    const date = new Date(`${day.date}T12:00:00`);
    if (date.getMonth() === previous) return;
    previous = date.getMonth();
    marks.push({ column: Math.floor((index + offset) / 7) + 1, date });
  });
  const fragment = document.createDocumentFragment();
  marks.forEach((mark, index) => {
    const next = marks[index + 1];
    const width = (next ? next.column : weeks + 1) - mark.column;
    if (width < minColumns) return;
    const label = document.createElement('span');
    const month = mark.date.toLocaleDateString('en', { month: 'short' }).toUpperCase();
    const january = mark.date.getMonth() === 0;
    label.textContent = january ? `${month} ${mark.date.getFullYear()}` : month;
    if (january) label.className = 'year';
    label.style.gridColumn = `${mark.column} / span ${width}`;
    fragment.append(label);
  });
  months.replaceChildren(fragment);
}

const BAR_PROVIDERS = [
  ['claude', 'CLAUDE', 'barClaude'],
  ['codex', 'CODEX', 'barCodex'],
  ['cursor', 'CURSOR', 'barCursor'],
];

function untilReset(resetsAt) {
  const remaining = resetsAt - Date.now();
  if (!(remaining > 0)) return null;
  const hours = Math.floor(remaining / 3600000);
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${Math.round((remaining % 3600000) / 60000)}m`;
}

/**
 * A row per enabled provider: how much it has run in the last five hours and
 * the last seven days. Codex is the only one that publishes where its own limit
 * sits, so its bar is a real percentage of that; the other two are measured
 * against your own busiest window of the same length, and the hover text says
 * which of the two you are looking at rather than leaving it to be assumed.
 */
function renderBars(report) {
  const host = $('#bars');
  const data = report.windows;
  const rows = BAR_PROVIDERS.filter(([provider, , setting]) => settings[setting]
    // Nothing has ever been recorded for this agent, so a row of zeroes would
    // only take up height. Turning the switch on cannot conjure data.
    && (data?.session?.[provider]?.best || data?.week?.[provider]?.best
      || data?.session?.[provider]?.current || data?.week?.[provider]?.current));
  host.hidden = !data || !rows.length;
  if (host.hidden) return;

  const fragment = document.createDocumentFragment();
  for (const [provider, label] of rows) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.dataset.provider = provider;
    const name = document.createElement('b');
    name.textContent = label;
    row.append(name);
    for (const window of ['session', 'week']) {
      const slot = data[window]?.[provider] || { current: 0, best: 0, percent: 0, basis: 'record' };
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.dataset.basis = slot.basis;
      const fill = document.createElement('i');
      fill.style.width = `${Math.max(slot.percent > 0 ? 2 : 0, slot.percent)}%`;
      bar.append(fill);
      const span = window === 'session' ? 'last 5 hours' : 'last 7 days';
      bar.title = slot.basis === 'limit'
        ? `${label} · ${slot.percent}% of your ${window === 'session' ? 'session' : 'weekly'} limit`
          + `${slot.limit?.resetsAt && untilReset(slot.limit.resetsAt) ? `, resets in ${untilReset(slot.limit.resetsAt)}` : ''}`
          + `\n${full.format(slot.current)} tokens in the ${span}`
        : `${label} · ${full.format(slot.current)} tokens in the ${span}`
          + `\n${slot.percent}% of your busiest ${span.replace('last ', '')} (${full.format(slot.best)})`
          + '\nNo published limit to measure against, so this is your own record.';
      row.append(bar);
    }
    fragment.append(row);
  }
  host.replaceChildren(host.firstElementChild, fragment);
}

/** Draw the current reference line, restarting its swap animation each time. */
function renderFlavour() {
  const list = state.report?.comparisons?.[state.metric] || [];
  const node = $('#flavour-text');
  // The leading ≈ glyph already carries the hedge, so drop the phrase's own "~".
  const text = list.length
    ? list[state.flavour % list.length].replace(/^~/, '')
    : 'not enough tokens to compare yet';
  if (node.textContent === text) return;
  node.textContent = text;
  node.style.animation = 'none';
  void node.offsetWidth; // reflow so the animation replays on the new text
  node.style.animation = '';
}

function render(report) {
  state.report = report;
  document.body.dataset.provider = report.provider;

  const metric = state.metric;
  const grid = $('#grid');
  const daily = report.daily;
  const max = Math.max(...daily.map((day) => day[metric]), 1);
  const todayKey = new Date().toLocaleDateString('en-CA');
  const offset = new Date(`${daily[0].date}T12:00:00`).getDay();

  const cells = document.createDocumentFragment();
  for (let index = 0; index < offset; index += 1) cells.append(document.createElement('span'));
  daily.forEach((day, index) => {
    const cell = document.createElement('span');
    cell.className = 'cell';
    cell.dataset.level = level(day[metric], max);
    cell.dataset.date = day.date;
    cell.dataset.value = day[metric];
    const claude = day.providers.claude[metric];
    const codex = day.providers.codex[metric];
    const cursor = day.providers.cursor?.[metric] || 0;
    cell.dataset.claude = claude;
    cell.dataset.codex = codex;
    cell.dataset.cursor = cursor;
    // Keep the leading provider for tooltip emphasis. Combined-view colour is
    // intentionally a single GitHub-green volume scale.
    if (day[metric] > 0) cell.dataset.owner = owner(claude, codex, cursor);
    if (day.backfilled && day.signal > 0) cell.dataset.backfilled = '1';
    if (day.date === todayKey) cell.dataset.today = '1';
    // Stagger the load bloom by column so the grid fills left to right.
    cell.style.animationDelay = `${Math.min(340, Math.floor((index + offset) / 7) * 5)}ms`;
    cells.append(cell);
  });
  grid.replaceChildren(cells);
  const weeks = Math.ceil((daily.length + offset) / 7);
  fitCells(weeks);
  buildMonths(daily, offset, weeks);

  const today = daily[daily.length - 1];
  $('#total').textContent = compact.format(report.totals[metric]);
  $('#streak').textContent = `${report.longestStreak}d`;
  $('#active').textContent = report.activeDays;
  $('#today').textContent = today && today[metric] ? compact.format(today[metric]) : '—';
  $('#span').textContent = `${dayLabel(report.range.from).toUpperCase()} — ${dayLabel(report.range.to).toUpperCase()}`;

  renderFlavour();
  renderBars(report);
  $('#total-label').textContent = METRICS[metric].label;
  const backfill = report.backfilledDays
    ? `\n${report.backfilledDays} day(s) backfilled from Claude Code's stats cache`
      + (metric === 'tokens' ? ', which records no cache figures' : '')
    : '';
  $('#metric').title =
    `${full.format(report.totals.signal)} — SIGNAL (${METRICS.signal.note})\n`
    + `${full.format(report.totals.tokens)} — TOTAL (${METRICS.tokens.note})\n`
    + `Click to switch.${backfill}`;

  const stamp = new Date(report.refreshedAt || report.generatedAt);
  $('#status-text').textContent = stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toUpperCase();
  document.body.classList.toggle('stale', !bridge);
  if (!bridge) $('#status-text').textContent = 'DEMO';
}

async function load(provider = state.provider, force = false) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add('busy');
  document.querySelectorAll('.segments button').forEach((button) => {
    button.classList.toggle('active', button.dataset.provider === provider);
  });
  state.provider = provider;
  try {
    if (!bridge) throw new Error('running outside the widget shell');
    render(await (force ? bridge.refresh(provider) : bridge.report(provider)));
  } catch (error) {
    render(demoReport(provider));
    console.error(error);
  } finally {
    state.busy = false;
    document.body.classList.remove('busy');
  }
}

/* ---- settings ---- */

const systemDark = matchMedia('(prefers-color-scheme: dark)');

/**
 * Resolve `system` here rather than leaning on a media query in the stylesheet,
 * so the CSS only ever deals in two concrete themes and the browser demo picks
 * the same one the packaged app would.
 */
function applyTheme(theme) {
  document.documentElement.dataset.theme =
    theme === 'light' || theme === 'dark' ? theme : (systemDark.matches ? 'dark' : 'light');
}
systemDark.addEventListener('change', () => {
  if (settings.theme === 'system') applyTheme('system');
});

function paintControls() {
  document.querySelectorAll('.choice').forEach((group) => {
    const chosen = String(settings[group.dataset.setting]);
    group.querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.value === chosen));
    });
  });
  document.querySelectorAll('.switch').forEach((toggle) => {
    toggle.setAttribute('aria-checked', String(settings[toggle.dataset.setting] === true));
  });
}

/** Adopt whatever the main process says is now in effect — never the optimistic
 *  value the click asked for, since main clamps anything it does not recognise
 *  and the OS can refuse the login item outright. */
function adopt(next) {
  const metricChanged = next.metric !== settings.metric;
  const barsChanged = BAR_PROVIDERS.some(([, , key]) => key in next && next[key] !== settings[key]);
  Object.assign(settings, next);
  applyTheme(settings.theme);
  paintControls();
  pin.setAttribute('aria-pressed', String(settings.pinned));
  pin.title = settings.pinned ? 'Keep on top' : 'Not on top';
  if (next.version) $('#settings-version').textContent = `CADENCE v${next.version}`;
  if (metricChanged) {
    state.metric = settings.metric;
    if (state.report) render(state.report); // both metrics are already in the payload
  } else if (barsChanged && state.report) {
    renderBars(state.report); // the windows are in the payload too; no refetch
  }
}

async function save(patch) {
  adopt(bridge ? await bridge.saveSettings(patch) : { ...settings, ...patch });
}

const sheet = $('#settings');
const sheetOpen = $('#settings-open');

function showSettings(open) {
  sheet.hidden = !open;
  sheetOpen.setAttribute('aria-expanded', String(open));
  (open ? $('#settings-close') : sheetOpen).focus();
}

sheetOpen.addEventListener('click', () => showSettings(sheet.hidden));
$('#settings-close').addEventListener('click', () => showSettings(false));

document.querySelectorAll('.choice').forEach((group) => {
  group.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const raw = button.dataset.value;
    save({ [group.dataset.setting]: group.hasAttribute('data-number') ? Number(raw) : raw });
  });
});

document.querySelectorAll('.switch').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    save({ [toggle.dataset.setting]: toggle.getAttribute('aria-checked') !== 'true' });
  });
});

/* ---- interactions ---- */

document.querySelectorAll('.segments button').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.provider === state.provider) return;
    settings.provider = button.dataset.provider;
    if (bridge) bridge.setProvider(button.dataset.provider);
    load(button.dataset.provider);
  });
});

$('#flavour').addEventListener('click', () => {
  state.flavour += 1;
  renderFlavour();
});

// Rotate on its own so the panel stays alive to glance at — unless the user has
// asked it to hold still.
setInterval(() => {
  if (document.hidden || !settings.rotateComparisons) return;
  state.flavour += 1;
  renderFlavour();
}, 9000);

$('#metric').addEventListener('click', () => {
  save({ metric: state.metric === 'signal' ? 'tokens' : 'signal' });
});

$('#scan').addEventListener('click', () => load(state.provider, true));
$('#minimize').addEventListener('click', () => bridge && bridge.minimize());
$('#close').addEventListener('click', () => bridge && bridge.close());

const pin = $('#pin');
pin.addEventListener('click', () => save({ pinned: pin.getAttribute('aria-pressed') !== 'true' }));

const tip = $('#tip');
$('#grid').addEventListener('pointerover', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  const value = Number(cell.dataset.value);
  // Emphasise the provider that contributed the most tokens that day.
  const ownedBy = cell.dataset.owner;
  const side = ([key, cls, label]) => {
    const text = `<span class="${cls}">${label} ${compact.format(cell.dataset[key])}</span>`;
    return ownedBy === key ? `<b class="lead">${text}</b>` : text;
  };
  // Three providers would make for a long tooltip, so a side only appears once
  // it has something to report — on a quiet day there is nothing to compare.
  const detail = state.provider === 'all'
    ? [['claude', 'c', 'C'], ['codex', 'x', 'X'], ['cursor', 'u', 'U']]
      .filter(([key]) => Number(cell.dataset[key]) > 0)
      .map(side)
      .join(' · ')
    : `${state.provider.toUpperCase()}`;
  const note = cell.dataset.backfilled
    ? `<i> · from stats cache${state.metric === 'tokens' ? ', no cache data' : ''}</i>`
    : '';
  tip.innerHTML = `<b>${value ? full.format(value) : 'No'} ${METRICS[state.metric].label.toLowerCase()} tokens</b>`
    + `<i>${dayLabel(cell.dataset.date)}</i>${detail ? ` · ${detail}` : ''}${note}`;
  tip.hidden = false;
  const box = cell.getBoundingClientRect();
  const width = tip.offsetWidth;
  tip.style.left = `${Math.max(6, Math.min(box.left + box.width / 2 - width / 2, innerWidth - width - 6))}px`;
  tip.style.top = `${Math.max(4, box.top - tip.offsetHeight - 6)}px`;
});
$('#grid').addEventListener('pointerleave', () => { tip.hidden = true; });

let resizeTimer = null;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.report) return;
    const daily = state.report.daily;
    const offset = new Date(`${daily[0].date}T12:00:00`).getDay();
    const weeks = Math.ceil((daily.length + offset) / 7);
    fitCells(weeks);
    buildMonths(daily, offset, weeks); // label density depends on the new cell size
  }, 90);
});

addEventListener('keydown', (event) => {
  // Escape backs out of the sheet first; it only reaches the window once the
  // panel is already showing the graph.
  if (event.key === 'Escape') {
    if (!sheet.hidden) return showSettings(false);
    return bridge && bridge.minimize();
  }
  if (event.key === ',' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); showSettings(sheet.hidden); }
  if (event.key === 'r' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); load(state.provider, true); }
});

/* ---- boot ---- */

function demoReport(provider) {
  const daily = [];
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, signal: 0, tokens: 0, messages: 0, sessions: 0 };
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const start = new Date(end - 216 * 86400000);
  start.setDate(start.getDate() - start.getDay());
  let index = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const wave = Math.max(0, Math.sin(index * .43) + Math.cos(index * .17) - .45);
    const claude = index % 11 === 0 ? 0 : Math.round(wave * 92000 + (index % 5) * 2100);
    const codex = index % 7 === 0 ? 0 : Math.round(Math.max(0, Math.cos(index * .31) - .15) * 68000);
    const cursor = index % 4 === 0 ? Math.round(Math.max(0, Math.sin(index * .11) + .2) * 74000) : 0;
    const signal = provider === 'all' ? claude + codex + cursor : { claude, codex, cursor }[provider] || 0;
    daily.push({
      date: cursor.toLocaleDateString('en-CA'),
      signal, tokens: signal * 8, input: Math.round(signal * .7), output: Math.round(signal * .3),
      backfilled: index < 60,
      providers: {
        claude: { signal: claude, tokens: claude * 8 },
        codex: { signal: codex, tokens: codex * 8 },
        cursor: { signal: cursor, tokens: cursor * 8 },
      },
    });
    totals.signal += signal;
    totals.tokens += signal * 8;
    index += 1;
  }
  const active = daily.filter((day) => day.signal > 0);
  return {
    schemaVersion: 3, generatedAt: new Date().toISOString(), provider, metrics: ['signal', 'tokens'],
    range: { from: daily[0].date, to: daily[daily.length - 1].date },
    totals, activeDays: active.length, backfilledDays: 24, longestStreak: 9,
    peakDay: null, daily, sources: { claude: 0, codex: 0, cursor: 0, backfilled: 0 },
    windows: {
      session: {
        hours: 5,
        claude: { current: 148000, best: 210000, percent: 70, basis: 'record' },
        codex: { current: 21000, best: 190000, percent: 11, basis: 'record' },
        cursor: { current: 0, best: 160000, percent: 0, basis: 'record' },
      },
      week: {
        hours: 168,
        claude: { current: 2100000, best: 2600000, percent: 81, basis: 'record' },
        codex: { current: 940000, best: 1900000, percent: 49, basis: 'limit', limit: { resetsAt: Date.now() + 2 * 86400000, plan: 'plus' } },
        cursor: { current: 1250000, best: 3000000, percent: 42, basis: 'record' },
      },
    },
    comparisons: {
      signal: ['~4 runs through the Harry Potter series', '~5 passes through all of Shakespeare'],
      tokens: ['~32 runs through the Harry Potter series', '~39 passes through all of Shakespeare'],
    },
  };
}

(async () => {
  adopt(bridge ? await bridge.settings() : settings);
  if (bridge) bridge.onTick(() => load(state.provider));
  await load(settings.provider);
})();
