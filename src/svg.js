'use strict';

const PALETTES = {
  claude: ['#201a17', '#63351f', '#9d4f28', '#d9773d', '#f4a261'],
  codex: ['#151d29', '#123c60', '#176ca0', '#28a5d6', '#83d8f4'],
  all: ['#181b22', '#38445a', '#5d7696', '#a78375', '#e39158'],
};

function escape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function level(value, max) {
  if (!value) return 0;
  return Math.min(4, Math.max(1, Math.ceil((Math.log1p(value) / Math.log1p(max || 1)) * 4)));
}

function renderSvg(report, options = {}) {
  const palette = PALETTES[report.provider] || PALETTES.all;
  const title = options.title || `${report.provider === 'all' ? 'Claude + Codex' : report.provider[0].toUpperCase() + report.provider.slice(1)} cadence`;
  const cell = 11;
  const gap = 3;
  const left = 45;
  const top = 75;
  const metric = options.metric === 'tokens' ? 'tokens' : 'signal';
  const max = Math.max(...report.daily.map((day) => day[metric]), 1);
  const firstOffset = new Date(`${report.daily[0].date}T12:00:00`).getDay();
  const columns = Math.ceil((report.daily.length + firstOffset) / 7);
  const width = Math.max(842, left + columns * (cell + gap) + 28);
  const height = 210;
  const rects = report.daily.map((day, index) => {
    const position = index + firstOffset;
    const x = left + Math.floor(position / 7) * (cell + gap);
    const y = top + (position % 7) * (cell + gap);
    const fill = palette[level(day[metric], max)];
    const note = day.backfilled && day.signal ? ' (from stats cache)' : '';
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${fill}"><title>${escape(day.date)} · ${day[metric].toLocaleString()} tokens${note}</title></rect>`;
  }).join('');
  const legend = palette.map((color, index) => `<rect x="${width - 126 + index * 17}" y="${height - 28}" width="11" height="11" rx="2" fill="${color}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">
  <style>text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.muted{fill:#8b949e}.bright{fill:#e6edf3}</style>
  <rect width="100%" height="100%" rx="14" fill="#0d1117" stroke="#30363d"/>
  <text x="28" y="34" class="bright" font-size="16" font-weight="700">${escape(title)}</text>
  <text x="28" y="55" class="muted" font-size="11">${report.totals[metric].toLocaleString()} tokens · ${report.activeDays} active days · ${report.longestStreak} day streak</text>
  <text x="25" y="88" class="muted" font-size="9">M</text><text x="25" y="116" class="muted" font-size="9">W</text><text x="25" y="144" class="muted" font-size="9">F</text>
  ${rects}
  <text x="${width - 165}" y="${height - 19}" class="muted" font-size="9">Less</text>${legend}<text x="${width - 31}" y="${height - 19}" class="muted" font-size="9">More</text>
  <text x="28" y="${height - 18}" class="muted" font-size="9">CADENCE · ${escape(report.range?.from || report.year)} — ${escape(report.range?.to || report.year)}</text>
</svg>`;
}

module.exports = { PALETTES, renderSvg };
