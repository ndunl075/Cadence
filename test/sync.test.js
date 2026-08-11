'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { blankUsage } = require('../src/usage');
const { mergePeers, publishLocal, safeDeviceId, serializeDays, syncDevices } = require('../src/sync');

async function tempDir() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'cadence-sync-'));
}

test('safeDeviceId folds hostile names into a filename fragment', () => {
  assert.equal(safeDeviceId('../Evil Name!!'), 'evil-name');
  assert.equal(safeDeviceId(''), 'device');
});

test('serializeDays keeps only dated provider totals', () => {
  const days = {
    '2026-08-10': {
      claude: { ...blankUsage(), signal: 10, tokens: 12, input: 7, output: 3 },
      codex: blankUsage(),
      cursor: blankUsage(),
      backfilled: true,
    },
    nope: { claude: { ...blankUsage(), signal: 99 }, codex: blankUsage(), cursor: blankUsage() },
  };
  assert.deepEqual(serializeDays(days), {
    '2026-08-10': {
      claude: {
        input: 7, output: 3, cacheRead: 0, cacheWrite: 0, reasoning: 0,
        signal: 10, tokens: 12, messages: 0, sessions: 0,
      },
    },
  });
});

test('publish and merge sums peer days without double-counting self', async () => {
  const dir = await tempDir();
  const localDays = {
    '2026-08-10': {
      claude: { ...blankUsage(), signal: 100, tokens: 100 },
      codex: blankUsage(),
      cursor: blankUsage(),
      backfilled: false,
    },
  };
  publishLocal(dir, { deviceId: 'laptop', deviceName: 'Laptop', days: localDays });
  publishLocal(dir, {
    deviceId: 'desktop',
    deviceName: 'Desktop',
    days: {
      '2026-08-10': {
        claude: blankUsage(),
        codex: { ...blankUsage(), signal: 50, tokens: 50 },
        cursor: blankUsage(),
      },
      '2026-08-09': {
        claude: { ...blankUsage(), signal: 20, tokens: 20 },
        codex: blankUsage(),
        cursor: blankUsage(),
      },
    },
  });

  const { peers, addedDays } = mergePeers(dir, 'laptop', localDays);
  assert.equal(peers.length, 1);
  assert.equal(peers[0].deviceName, 'Desktop');
  assert.equal(addedDays, 2);
  assert.equal(localDays['2026-08-10'].claude.signal, 100);
  assert.equal(localDays['2026-08-10'].codex.signal, 50);
  assert.equal(localDays['2026-08-09'].claude.signal, 20);
});

test('syncDevices is a no-op without a sync dir', () => {
  const data = { days: {}, files: { claude: 0 } };
  const next = syncDevices(data, {});
  assert.equal(next.sync.enabled, false);
  assert.equal(next.files.claude, 0);
});

test('syncDevices publishes and reports peers', async () => {
  const dir = await tempDir();
  publishLocal(dir, {
    deviceId: 'other',
    deviceName: 'Other',
    days: {
      '2026-01-01': {
        claude: { ...blankUsage(), signal: 5, tokens: 5 },
        codex: blankUsage(),
        cursor: blankUsage(),
      },
    },
  });
  const data = {
    days: {
      '2026-01-01': {
        claude: { ...blankUsage(), signal: 3, tokens: 3 },
        codex: blankUsage(),
        cursor: blankUsage(),
        backfilled: false,
      },
    },
    files: { claude: 1, codex: 0, cursor: 0, backfilled: 0 },
  };
  const next = syncDevices(data, { syncDir: dir, deviceId: 'me', deviceName: 'Me' });
  assert.equal(next.sync.enabled, true);
  assert.equal(next.sync.peers.length, 1);
  assert.equal(next.days['2026-01-01'].claude.signal, 8);
  assert.equal(next.files.devices, 1);
  assert.ok(fs.existsSync(path.join(dir, 'device-me.json')));
});
