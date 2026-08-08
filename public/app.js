'use strict';

const state = { provider: 'all', report: null };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function level(value, max) {
  if (!value) return 0;
  return Math.min(4, Math.max(1, Math.ceil((Math.log1p(value) / Math.log1p(max || 1)) * 4)));
}

function buildMonths(report) {
  const holder = $('#months');
  holder.replaceChildren();
  const firstOffset = new Date(`${report.daily[0].date}T12:00:00`).getDay();
  let previous = -1;
  report.daily.forEach((day, index) => {
    const date = new Date(`${day.date}T12:00:00`);
    if (date.getMonth() === previous || date.getDate() > 7) return;
    previous = date.getMonth();
    const span = document.createElement('span');
    span.textContent = date.toLocaleDateString('en', { month: 'short' }).toUpperCase();
    span.style.gridColumn = String(Math.floor((index + firstOffset) / 7) + 1);
    holder.append(span);
  });
}

function render(report) {
  state.report = report;
  document.body.dataset.provider = report.provider;
  const heatmap = $('#heatmap');
  heatmap.replaceChildren();
  const max = Math.max(...report.daily.map((day) => day.tokens), 1);
  const firstOffset = new Date(`${report.daily[0].date}T12:00:00`).getDay();
  for (let index = 0; index < firstOffset; index += 1) heatmap.append(document.createElement('span'));
  for (const day of report.daily) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.dataset.level = level(day.tokens, max);
    cell.dataset.date = day.date;
    cell.dataset.tokens = day.tokens;
    cell.dataset.claude = day.providers.claude;
    cell.dataset.codex = day.providers.codex;
    cell.setAttribute('aria-label', `${day.date}: ${day.tokens.toLocaleString()} tokens`);
    heatmap.append(cell);
  }
  buildMonths(report);
  $('#tokens').textContent = compact.format(report.totals.tokens);
  $('#active-days').textContent = report.activeDays.toLocaleString();
  $('#streak').textContent = `${report.longestStreak}d`;
  $('#peak').textContent = report.peakDay ? compact.format(report.peakDay.tokens) : '—';
  $('#peak-date').textContent = report.peakDay ? new Date(`${report.peakDay.date}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : 'no activity yet';
  $('#token-mix').textContent = `${compact.format(report.totals.input)} input · ${compact.format(report.totals.output)} output`;
  $('#claude-files').textContent = report.sources?.claude ?? '—';
  $('#codex-files').textContent = report.sources?.codex ?? '—';
  $('#updated').textContent = `UPDATED ${new Date(report.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const suffix = `?provider=${report.provider}`;
  $('#svg-code').textContent = `![Cadence](${location.origin}/api/v1/heatmap.svg${suffix})`;
  $('#json-code').textContent = `${location.origin}/api/v1/usage${suffix}`;
}

async function load(provider = state.provider) {
  state.provider = provider;
  $$('.filters button').forEach((button) => button.classList.toggle('active', button.dataset.provider === provider));
  try {
    const response = await fetch(`/api/v1/usage?provider=${provider}`);
    if (!response.ok) throw new Error('Usage service unavailable');
    render(await response.json());
  } catch (error) {
    render(demoReport(provider));
    $('#updated').textContent = 'DEMO DATA';
    console.error(error);
  }
}

function demoReport(provider) {
  const year = new Date().getFullYear();
  const start = new Date(year, 0, 1, 12);
  const end = new Date(year, 11, 31, 12);
  const today = new Date();
  const daily = [];
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, tokens: 0, messages: 0, sessions: 0 };
  let index = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const future = cursor > today;
    const wave = Math.max(0, Math.sin(index * .43) + Math.cos(index * .17) - .45);
    const claude = future || index % 11 === 0 ? 0 : Math.round(wave * 920000 + (index % 5) * 21000);
    const codex = future || index % 7 === 0 ? 0 : Math.round(Math.max(0, Math.cos(index * .31) - .15) * 680000);
    const tokens = provider === 'claude' ? claude : provider === 'codex' ? codex : claude + codex;
    const date = cursor.toISOString().slice(0, 10);
    daily.push({ date, tokens, input: Math.round(tokens * .68), output: Math.round(tokens * .12), cacheRead: Math.round(tokens * .2), cacheWrite: 0, reasoning: 0, messages: tokens ? 4 : 0, sessions: tokens ? 1 : 0, providers: { claude, codex } });
    totals.tokens += tokens; totals.input += Math.round(tokens * .68); totals.output += Math.round(tokens * .12); totals.cacheRead += Math.round(tokens * .2);
    index += 1;
  }
  const active = daily.filter((day) => day.tokens > 0);
  const peakDay = active.reduce((peak, day) => !peak || day.tokens > peak.tokens ? day : peak, null);
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), provider, year, totals, activeDays: active.length, longestStreak: 9, peakDay, daily, sources: { claude: 0, codex: 0 } };
}

$$('.filters button').forEach((button) => button.addEventListener('click', () => load(button.dataset.provider)));
$$('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
  const code = button.dataset.copy === 'svg' ? $('#svg-code') : $('#json-code');
  await navigator.clipboard.writeText(code.textContent);
  const previous = button.textContent;
  button.textContent = 'COPIED';
  setTimeout(() => { button.textContent = previous; }, 1200);
}));

const tooltip = $('#tooltip');
$('#heatmap').addEventListener('pointermove', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  const detail = state.provider === 'all' ? `<span style="color:#b3653d">C ${compact.format(cell.dataset.claude)}</span> · <span style="color:#237da3">X ${compact.format(cell.dataset.codex)}</span>` : `${state.provider.toUpperCase()} SIGNAL`;
  tooltip.innerHTML = `<b>${Number(cell.dataset.tokens).toLocaleString()} tokens</b>${cell.dataset.date} · ${detail}`;
  tooltip.style.display = 'block';
  tooltip.style.left = `${Math.min(event.clientX + 14, innerWidth - tooltip.offsetWidth - 8)}px`;
  tooltip.style.top = `${event.clientY + 14}px`;
});
$('#heatmap').addEventListener('pointerleave', () => { tooltip.style.display = 'none'; });

$('#year').textContent = new Date().getFullYear();
load();
setInterval(() => load(), 60000);
