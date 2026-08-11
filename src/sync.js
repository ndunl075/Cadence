'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { blankUsage, PROVIDERS } = require('./usage');

const SCHEMA = 1;
const DEVICE_FILE = /^device-([a-z0-9][a-z0-9._-]{0,63})\.json$/i;

function addUsage(into, value) {
  for (const key of Object.keys(into)) into[key] += Number(value?.[key]) || 0;
  return into;
}

function ensureDay(days, key) {
  if (!days[key]) days[key] = { claude: blankUsage(), codex: blankUsage(), cursor: blankUsage(), backfilled: false };
  return days[key];
}

/**
 * Stable filename fragment. Hostnames and UUIDs both fit; anything else is
 * folded down so a hostile or odd device name cannot escape the sync folder.
 */
function safeDeviceId(value) {
  const raw = String(value || '').trim().toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/\.\.+/g, '.')
    .slice(0, 64);
  return cleaned || 'device';
}

function devicePath(syncDir, deviceId) {
  return path.join(syncDir, `device-${safeDeviceId(deviceId)}.json`);
}

/** Compact daily totals only — never prompts, paths, or hour buckets. */
function serializeDays(days) {
  const out = {};
  for (const [key, day] of Object.entries(days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const row = {};
    for (const provider of PROVIDERS) {
      const usage = day[provider];
      if (!usage) continue;
      const signal = Number(usage.signal) || 0;
      const tokens = Number(usage.tokens) || 0;
      if (signal <= 0 && tokens <= 0) continue;
      row[provider] = {
        input: Number(usage.input) || 0,
        output: Number(usage.output) || 0,
        cacheRead: Number(usage.cacheRead) || 0,
        cacheWrite: Number(usage.cacheWrite) || 0,
        reasoning: Number(usage.reasoning) || 0,
        signal,
        tokens,
        messages: Number(usage.messages) || 0,
        sessions: Number(usage.sessions) || 0,
      };
    }
    if (Object.keys(row).length) out[key] = row;
  }
  return out;
}

function readDeviceFile(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!raw || raw.schemaVersion !== SCHEMA || typeof raw.days !== 'object' || !raw.days) return null;
  return {
    deviceId: safeDeviceId(raw.deviceId),
    deviceName: typeof raw.deviceName === 'string' && raw.deviceName.trim() ? raw.deviceName.trim().slice(0, 64) : safeDeviceId(raw.deviceId),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    days: raw.days,
  };
}

/**
 * Write this machine's aggregate into the sync folder. The folder is meant to
 * live in OneDrive / Dropbox / iCloud / a git repo — Cadence itself never
 * opens a network socket for sync.
 */
function publishLocal(syncDir, { deviceId, deviceName, days }) {
  if (!syncDir || !deviceId) return null;
  fs.mkdirSync(syncDir, { recursive: true });
  const id = safeDeviceId(deviceId);
  const payload = {
    schemaVersion: SCHEMA,
    deviceId: id,
    deviceName: (deviceName && String(deviceName).trim().slice(0, 64)) || os.hostname() || id,
    updatedAt: new Date().toISOString(),
    days: serializeDays(days),
  };
  const target = devicePath(syncDir, id);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(temp, target);
  return payload;
}

/**
 * Fold every *other* device's published days into `days`. Local figures stay
 * authoritative for this machine; peers are added on top so a day worked on
 * two machines counts both.
 */
function mergePeers(syncDir, deviceId, days) {
  const peers = [];
  if (!syncDir || !fs.existsSync(syncDir)) return { peers, addedDays: 0 };
  const self = safeDeviceId(deviceId);
  let entries = [];
  try { entries = fs.readdirSync(syncDir); } catch { return { peers, addedDays: 0 }; }

  let addedDays = 0;
  for (const name of entries) {
    const match = DEVICE_FILE.exec(name);
    if (!match) continue;
    if (safeDeviceId(match[1]) === self) continue;
    const peer = readDeviceFile(path.join(syncDir, name));
    if (!peer) continue;
    peers.push({ deviceId: peer.deviceId, deviceName: peer.deviceName, updatedAt: peer.updatedAt });
    for (const [key, row] of Object.entries(peer.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !row || typeof row !== 'object') continue;
      const day = ensureDay(days, key);
      let touched = false;
      for (const provider of PROVIDERS) {
        const usage = row[provider];
        if (!usage) continue;
        const before = day[provider].signal;
        addUsage(day[provider], usage);
        if (day[provider].signal !== before) touched = true;
      }
      if (touched) addedDays += 1;
    }
  }
  peers.sort((a, b) => a.deviceName.localeCompare(b.deviceName));
  return { peers, addedDays };
}

/**
 * Publish this device, then merge peers into the in-memory day map. Hour
 * buckets are left alone — the live 5h/7d bars stay local to this machine.
 */
function syncDevices(data, options = {}) {
  const syncDir = options.syncDir || process.env.CADENCE_SYNC_DIR;
  if (!syncDir || !data?.days) {
    return { ...data, sync: { enabled: false, peers: [] } };
  }
  const deviceId = options.deviceId || process.env.CADENCE_DEVICE_ID || os.hostname() || 'device';
  const deviceName = options.deviceName || process.env.CADENCE_DEVICE_NAME || os.hostname() || deviceId;
  try {
    publishLocal(syncDir, { deviceId, deviceName, days: data.days });
    const { peers, addedDays } = mergePeers(syncDir, deviceId, data.days);
    const files = { ...(data.files || {}), devices: peers.length, syncDays: addedDays };
    return {
      ...data,
      files,
      sync: {
        enabled: true,
        dir: syncDir,
        deviceId: safeDeviceId(deviceId),
        deviceName,
        peers,
      },
    };
  } catch (error) {
    return {
      ...data,
      sync: { enabled: true, dir: syncDir, error: error.message, peers: [] },
    };
  }
}

module.exports = {
  DEVICE_FILE,
  SCHEMA,
  devicePath,
  mergePeers,
  publishLocal,
  safeDeviceId,
  serializeDays,
  syncDevices,
};
