#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { collect, summarize, PROVIDERS } = require('./usage');
const { syncDevices } = require('./sync');
const { renderSvg } = require('./svg');
const { comparisons } = require('./comparisons');

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(valueAfter('--port', process.env.CADENCE_PORT || 4173));
const host = valueAfter('--host', process.env.CADENCE_HOST || '127.0.0.1');
const publicDir = path.resolve(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

// Cross-origin reads are off unless asked for. Without this, any page you
// happen to be browsing could fetch http://127.0.0.1:4173/api/v1/usage and read
// your activity. Publishing the graph deliberately is what --cors is for.
const allowCors = args.includes('--cors');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const loopbackOnly = LOOPBACK.has(host);

/**
 * A loopback bind is only as private as the Host header it answers to: a
 * hostile domain can point its own DNS at 127.0.0.1 and reach this server with
 * the browser still treating it as same-origin. Serve loopback binds only when
 * the request actually addressed one.
 */
function trustedHost(request) {
  if (!loopbackOnly) return true;
  const header = String(request.headers.host || '');
  const name = header.replace(/:\d+$/, '').replace(/^\[|\]$/, '').replace(/\]$/, '');
  return LOOPBACK.has(name);
}

function corsHeaders() {
  return allowCors ? { 'Access-Control-Allow-Origin': '*' } : {};
}

let snapshot = null;
let refreshPromise = null;
let refreshedAt = 0;

async function refresh(force = false) {
  if (!force && snapshot && Date.now() - refreshedAt < 30000) return snapshot;
  if (refreshPromise) return refreshPromise;
  refreshPromise = collect().then((data) => {
    snapshot = syncDevices(data);
    refreshedAt = Date.now();
    return snapshot;
  }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function reportFrom(url, data) {
  const requested = url.searchParams.get('provider') || 'all';
  const provider = PROVIDERS.includes(requested) ? requested : 'all';
  // No year/weeks parameter means the full recorded history.
  const options = {};
  const year = Number(url.searchParams.get('year'));
  const weeks = Number(url.searchParams.get('weeks'));
  if (year) options.year = year;
  if (weeks) options.weeks = weeks;
  return summarize(data.days, provider, options);
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders() });
  response.end(JSON.stringify(body, null, 2));
}

async function handler(request, response) {
  if (!trustedHost(request)) return json(response, 403, { error: 'Forbidden host' });
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/api/v1/usage') {
    const data = await refresh();
    const summary = reportFrom(url, data);
    return json(response, 200, {
      ...summary,
      comparisons: {
        signal: comparisons(summary.totals.signal),
        tokens: comparisons(summary.totals.tokens),
      },
      sources: data.files,
    });
  }
  if (url.pathname === '/api/v1/status') {
    const data = await refresh();
    return json(response, 200, { ok: true, sources: data.files, refreshedAt: new Date(refreshedAt).toISOString(), privacy: 'Local metadata only. Prompts and source code are never read into reports.' });
  }
  if (url.pathname === '/api/v1/refresh' && request.method === 'POST') {
    const data = await refresh(true);
    return json(response, 200, { ok: true, sources: data.files, refreshedAt: new Date(refreshedAt).toISOString() });
  }
  if (url.pathname === '/api/v1/heatmap.svg') {
    const data = await refresh();
    const svg = renderSvg(reportFrom(url, data), {
      title: url.searchParams.get('title') || undefined,
      metric: url.searchParams.get('metric') || undefined,
    });
    response.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders() });
    return response.end(svg);
  }
  let requested;
  try {
    requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  } catch {
    return json(response, 404, { error: 'Not found' }); // malformed percent-encoding
  }
  const file = path.resolve(publicDir, requested);
  // path.relative is the containment test, not startsWith: "public" is a prefix
  // of "public-secret" but not a parent of it.
  const inside = path.relative(publicDir, file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)
      || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return json(response, 404, { error: 'Not found' });
  }
  response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(command[0], command[1], { windowsHide: true }, () => {});
}

async function exportFiles(directory) {
  const data = await refresh(true);
  await fs.promises.mkdir(directory, { recursive: true });
  for (const provider of ['all', ...PROVIDERS]) {
    const report = summarize(data.days, provider);
    await fs.promises.writeFile(path.join(directory, `cadence-${provider}.json`), JSON.stringify(report, null, 2));
    await fs.promises.writeFile(path.join(directory, `cadence-${provider}.svg`), renderSvg(report));
  }
  console.log(`Exported JSON and SVG files to ${path.resolve(directory)}`);
}

async function main() {
  if (args.includes('--help')) {
    console.log([
      'Cadence',
      '',
      '  cadence [--port 4173] [--host 127.0.0.1] [--no-open] [--cors]',
      '  cadence --export <directory>',
      '',
      '  --cors  let any website read the API. Off by default, because otherwise',
      '          a page you are merely browsing could read your local activity.',
      '',
    ].join('\n'));
    return;
  }
  if (args.includes('--export')) return exportFiles(valueAfter('--export', '.'));
  await refresh(true);
  const server = http.createServer((request, response) => handler(request, response).catch((error) => json(response, 500, { error: error.message })));
  server.listen(port, host, () => {
    const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    console.log(`Cadence is running at ${url}`);
    console.log(`Found ${snapshot.files.claude} Claude and ${snapshot.files.codex} Codex session files.`);
    if (!args.includes('--no-open')) openBrowser(url);
  });
  setInterval(() => refresh(true).catch(() => {}), 60000).unref();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
