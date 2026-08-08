'use strict';

const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'src', 'server.js');

/** Boot the real server on an ephemeral port and tear it down afterwards. */
async function withServer(extraArgs, run) {
  const port = 40000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [ENTRY, '--port', String(port), '--no-open', ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 30000);
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('running at')) { clearTimeout(timer); resolve(); }
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`exited early: ${code}`)); });
    });
    await run(port);
  } finally {
    child.kill();
  }
}

function request(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('does not hand out the API cross-origin by default', async () => {
  await withServer([], async (port) => {
    const res = await request(port, '/api/v1/status');
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], undefined,
      'a page you are browsing must not be able to read local usage');
  });
});

test('--cors opts back in to cross-origin reads', async () => {
  await withServer(['--cors'], async (port) => {
    const res = await request(port, '/api/v1/status');
    assert.equal(res.headers['access-control-allow-origin'], '*');
  });
});

test('refuses requests addressed to a rebound hostname', async () => {
  await withServer([], async (port) => {
    const evil = await request(port, '/api/v1/status', { Host: 'attacker.example.com' });
    assert.equal(evil.status, 403, 'DNS rebinding must not reach a loopback bind');
    const ok = await request(port, '/api/v1/status', { Host: `127.0.0.1:${port}` });
    assert.equal(ok.status, 200);
  });
});

test('does not serve files outside the public directory', async () => {
  await withServer([], async (port) => {
    for (const attempt of [
      '/../package.json',
      '/..%2fpackage.json',
      '/%2e%2e/package.json',
      '/....//package.json',
      '/%2e%2e%2fsrc%2fusage.js',
    ]) {
      const res = await request(port, attempt);
      assert.equal(res.status, 404, `${attempt} should not resolve outside public/`);
      assert.ok(!res.body.includes('"name"') || res.body.includes('Not found'), `${attempt} leaked content`);
    }
  });
});

test('tolerates malformed percent-encoding', async () => {
  await withServer([], async (port) => {
    const res = await request(port, '/%zz');
    assert.equal(res.status, 404);
  });
});

test('still serves its own static assets', async () => {
  await withServer([], async (port) => {
    const res = await request(port, '/widget.css');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/css/);
  });
});
