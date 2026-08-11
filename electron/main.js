'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, shell } = require('electron');
const { collect, summarize, windows, PROVIDERS } = require('../src/usage');
const { syncDevices, safeDeviceId } = require('../src/sync');
const { comparisons } = require('../src/comparisons');
const { isCliInvocation, run: runCli } = require('../src/cli');

/**
 * The same binary answers `cadence.exe graph` as answers a double-click, so the
 * download does not need a separate CLI. `electron .` puts the script path at
 * argv[1] and a packaged build does not, which `process.defaultApp` is how you
 * tell apart.
 */
const cliArgs = process.defaultApp ? process.argv.slice(2) : process.argv.slice(1);
const cliMode = isCliInvocation(cliArgs);

const THEMES = ['system', 'light', 'dark'];
// Offered as a fixed set rather than a free number so the renderer cannot ask
// for a one-second poll and spin the disk scanning transcripts.
const SCAN_SECONDS = [30, 60, 300, 900];

// Sized to hug the graph rather than leave empty bezel above and below it; the
// user can still drag it larger. Compact drops the stats strip and caption.
const DEFAULT_BOUNDS = { width: 472, height: 248 };
const MIN_BOUNDS = { width: 344, height: 210 };
const COMPACT_DEFAULT_HEIGHT = 178;
const COMPACT_MIN_HEIGHT = 156;

let widget = null;
let statePath = null;
let snapshot = null;
let refreshPromise = null;
let refreshedAt = 0;
let tickTimer = null;
// A second double-click before whenReady must not create a window early — that
// races the real boot path and is a common "exe does nothing" failure mode.
let focusAfterReady = false;
let generatedDeviceId = null;

function logError(message, error) {
  const line = `[${new Date().toISOString()}] ${message}${error ? `: ${error.stack || error.message || error}` : ''}\n`;
  try {
    const dir = statePath ? path.dirname(statePath) : path.join(app.getPath('userData'));
    fs.appendFileSync(path.join(dir, 'cadence-error.log'), line);
  } catch { /* non-fatal */ }
  console.error(line.trim());
}

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return {}; }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  try { fs.writeFileSync(statePath, JSON.stringify(next, null, 2)); } catch { /* non-fatal */ }
  return next;
}

/**
 * Every setting the panel can touch, filtered to a known value. The renderer is
 * the only caller, but it is still the untrusted side of the bridge — anything
 * that reaches disk or the OS goes through here first, so a bad payload falls
 * back to the default instead of being stored.
 */
function ensureDeviceId(saved = {}) {
  const existing = typeof saved.deviceId === 'string' ? safeDeviceId(saved.deviceId) : '';
  if (existing && existing !== 'device') return existing;
  if (!generatedDeviceId) generatedDeviceId = crypto.randomUUID();
  return generatedDeviceId;
}

function normalizeSettings(saved) {
  const syncDir = typeof saved.syncDir === 'string' ? saved.syncDir.trim() : '';
  return {
    // Dark by default: the panel is a floating instrument on a desktop, not a
    // document, and its ramps were cut against the dark bezel first.
    theme: THEMES.includes(saved.theme) ? saved.theme : 'dark',
    scanSeconds: SCAN_SECONDS.includes(saved.scanSeconds) ? saved.scanSeconds : 60,
    launchAtLogin: saved.launchAtLogin === true,
    rotateComparisons: saved.rotateComparisons !== false,
    // One switch per provider, so you can watch the agent you actually pay for
    // without the other two taking up panel height. Off unless asked for: the
    // graph is what the panel is, and each row costs height the graph had.
    barClaude: saved.barClaude === true,
    barCodex: saved.barCodex === true,
    barCursor: saved.barCursor === true,
    // Graph + provider rail + comparison line only — hides the stats strip,
    // date caption, and usage bars so the panel can sit shorter.
    compactView: saved.compactView === true,
    pinned: saved.pinned !== false,
    metric: saved.metric === 'tokens' ? 'tokens' : 'signal',
    provider: PROVIDERS.includes(saved.provider) ? saved.provider : 'all',
    // Optional folder shared via OneDrive/Dropbox/iCloud/git — Cadence only
    // writes daily aggregates into it, never prompts or source.
    syncEnabled: saved.syncEnabled === true && Boolean(syncDir),
    syncDir,
    deviceId: ensureDeviceId(saved),
    deviceName: typeof saved.deviceName === 'string' && saved.deviceName.trim()
      ? saved.deviceName.trim().slice(0, 64)
      : (os.hostname() || 'Cadence'),
  };
}

/** Rescan on the user's chosen cadence, telling the panel to redraw each time. */
function scheduleScans(seconds) {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    refresh(true)
      .then(() => widget && !widget.isDestroyed() && widget.webContents.send('cadence:tick'))
      .catch(() => {});
  }, seconds * 1000);
}

/**
 * Compact view drops enough chrome that the previous height looks like empty
 * bezel; grow/shrink toward the matching default when the toggle flips, without
 * fighting a window the user has deliberately dragged larger than either.
 */
function applyCompactLayout(compactView, previous = null) {
  if (!widget || widget.isDestroyed()) return;
  const minHeight = compactView ? COMPACT_MIN_HEIGHT : MIN_BOUNDS.height;
  widget.setMinimumSize(MIN_BOUNDS.width, minHeight);
  if (previous === null || previous === compactView) return;
  const bounds = widget.getBounds();
  if (compactView && bounds.height > COMPACT_DEFAULT_HEIGHT + 24) {
    widget.setBounds({ ...bounds, height: COMPACT_DEFAULT_HEIGHT });
  } else if (!compactView && bounds.height < DEFAULT_BOUNDS.height) {
    widget.setBounds({ ...bounds, height: DEFAULT_BOUNDS.height });
  }
}

/**
 * Push settings out to the things that actually implement them. Reads the login
 * item back from the OS rather than trusting the write, so a policy-blocked or
 * failed registration shows up in the panel as off instead of silently lying.
 */
function applySettings(settings, previous = null) {
  nativeTheme.themeSource = settings.theme;
  if (widget && !widget.isDestroyed()) widget.setAlwaysOnTop(settings.pinned, 'floating');
  scheduleScans(settings.scanSeconds);
  applyCompactLayout(settings.compactView, previous ? previous.compactView : null);
  try {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: [] });
    settings.launchAtLogin = app.getLoginItemSettings().openAtLogin === true;
  } catch {
    settings.launchAtLogin = false; // unsupported or blocked on this platform
  }
  return settings;
}

function currentSettings() {
  return { ...normalizeSettings(readState()), version: app.getVersion() };
}

/**
 * Keep a restored window on a display that still exists — an external monitor
 * may have been unplugged since the position was saved.
 */
function visibleBounds(saved, compactView = false) {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
  const minHeight = compactView ? COMPACT_MIN_HEIGHT : MIN_BOUNDS.height;
  const fallbackHeight = compactView ? COMPACT_DEFAULT_HEIGHT : DEFAULT_BOUNDS.height;
  let height = Math.round(saved.height || fallbackHeight);
  // Older installs saved the pre-tighten default (292). Drop them onto the new
  // hug-the-graph height once so the empty bezel does not stick around forever.
  if (!compactView && height === 292) height = DEFAULT_BOUNDS.height;
  if (compactView && height >= 248) height = COMPACT_DEFAULT_HEIGHT;
  const bounds = {
    x: Math.round(saved.x),
    y: Math.round(saved.y),
    width: Math.max(MIN_BOUNDS.width, Math.round(saved.width || DEFAULT_BOUNDS.width)),
    height: Math.max(minHeight, height),
  };
  const onScreen = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return bounds.x < area.x + area.width && bounds.x + bounds.width > area.x
      && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y;
  });
  return onScreen ? bounds : null;
}

// Tucked into the top-left corner of the work area, clear of the taskbar.
const DEFAULT_MARGIN = 8;

function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + DEFAULT_MARGIN,
    y: area.y + DEFAULT_MARGIN,
    ...DEFAULT_BOUNDS,
  };
}

async function refresh(force = false) {
  if (!force && snapshot && Date.now() - refreshedAt < 30000) return snapshot;
  if (refreshPromise) return refreshPromise;
  refreshPromise = collect()
    .then((data) => {
      const settings = normalizeSettings(readState());
      const synced = settings.syncEnabled
        ? syncDevices(data, {
          syncDir: settings.syncDir,
          deviceId: settings.deviceId,
          deviceName: settings.deviceName,
        })
        : { ...data, sync: { enabled: false, peers: [] } };
      snapshot = synced;
      refreshedAt = Date.now();
      return synced;
    })
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function report(provider) {
  const data = await refresh();
  const chosen = PROVIDERS.includes(provider) ? provider : 'all';
  const summary = summarize(data.days, chosen);
  return {
    ...summary,
    // Precomputed for both metrics so switching does not need another round trip.
    comparisons: {
      signal: comparisons(summary.totals.signal),
      tokens: comparisons(summary.totals.tokens),
    },
    // The bars answer "how am I doing right now", so they are always the live
    // rolling windows, never the window the graph happens to be showing.
    windows: windows(data.hours, { limits: data.limits }),
    sources: data.files,
    sync: data.sync || { enabled: false, peers: [] },
    refreshedAt: new Date(refreshedAt).toISOString(),
  };
}

/** Raise an existing panel so a second double-click never looks like a no-op. */
function bringToFront() {
  if (!widget || widget.isDestroyed()) return false;
  const settings = normalizeSettings(readState());
  const bounds = visibleBounds(widget.getBounds(), settings.compactView)
    || visibleBounds(readState().bounds, settings.compactView)
    || { ...defaultBounds(), height: settings.compactView ? COMPACT_DEFAULT_HEIGHT : DEFAULT_BOUNDS.height };
  if (widget.isMinimized()) widget.restore();
  widget.setBounds(bounds);
  widget.setAlwaysOnTop(settings.pinned, 'floating');
  widget.show();
  widget.focus();
  try { widget.moveTop(); } catch { /* older Electron */ }
  return true;
}

function ensureWidget() {
  if (bringToFront()) return widget;
  return createWidget();
}

function persistBounds() {
  if (!widget || widget.isDestroyed() || widget.isMinimized()) return;
  writeState({ bounds: widget.getBounds() });
}

function createWidget() {
  const saved = readState();
  const settings = normalizeSettings(saved);
  const bounds = visibleBounds(saved.bounds, settings.compactView) || {
    ...defaultBounds(),
    height: settings.compactView ? COMPACT_DEFAULT_HEIGHT : DEFAULT_BOUNDS.height,
  };
  const pinned = settings.pinned;

  widget = new BrowserWindow({
    ...bounds,
    minWidth: MIN_BOUNDS.width,
    minHeight: settings.compactView ? COMPACT_MIN_HEIGHT : MIN_BOUNDS.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    show: false,
    title: 'Cadence',
    icon: path.join(__dirname, '..', 'assets', 'cadence.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  widget.setAlwaysOnTop(pinned, 'floating');

  /**
   * `ready-to-show` does not reliably fire for a transparent frameless window in
   * a packaged build, which leaves the panel alive but permanently hidden. Show
   * on whichever signal arrives first, and keep a short timer as a last resort
   * — a multi-second wait is what makes a cold start feel like the exe failed.
   */
  let revealed = false;
  const reveal = () => {
    if (revealed || !widget || widget.isDestroyed()) return;
    revealed = true;
    widget.setBounds(bounds);
    widget.show();
    widget.focus();
  };
  widget.once('ready-to-show', reveal);
  widget.webContents.once('did-finish-load', reveal);
  const revealTimer = setTimeout(reveal, 500);
  widget.webContents.on('did-fail-load', (_event, code, description, url) => {
    logError(`failed to load ${url}: ${description} (${code})`);
    reveal(); // surface the blank panel rather than hanging invisibly
  });

  widget.loadFile(path.join(__dirname, '..', 'public', 'widget.html'));

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistBounds, 400);
  };
  widget.on('move', scheduleSave);
  widget.on('resize', scheduleSave);
  widget.on('closed', () => { clearTimeout(revealTimer); clearTimeout(saveTimer); widget = null; });

  // Links in the panel open in the real browser, never inside the widget.
  // openExternal is only ever handed http(s); handing it an arbitrary scheme
  // (file:, ms-msdt:, …) is a known path to running something locally.
  widget.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // The panel is a fixed local page. Nothing should ever navigate it elsewhere,
  // so a navigation attempt means something has gone wrong — refuse it rather
  // than let the renderer end up somewhere with a preload bridge attached.
  widget.webContents.on('will-navigate', (event, url) => {
    if (url !== widget.webContents.getURL()) event.preventDefault();
  });
  widget.webContents.on('will-attach-webview', (event) => event.preventDefault());

  return widget;
}

ipcMain.handle('cadence:report', (_event, provider) => report(provider));

ipcMain.handle('cadence:refresh', async (_event, provider) => {
  await refresh(true);
  return report(provider);
});

ipcMain.handle('cadence:settings', () => currentSettings());

/**
 * Accepts a partial patch, but stores only the normalized whole — so an unknown
 * key is dropped and an out-of-range value snaps back to its default. Returns
 * what was actually applied, which is what the panel renders.
 */
ipcMain.handle('cadence:settings:set', (_event, patch) => {
  const previous = normalizeSettings(readState());
  const next = normalizeSettings({ ...readState(), ...(patch && typeof patch === 'object' ? patch : {}) });
  applySettings(next, previous);
  writeState(next);
  // Turning sync on (or moving the folder) should republish immediately rather
  // than waiting for the next scan tick.
  if (patch && (Object.hasOwn(patch, 'syncEnabled') || Object.hasOwn(patch, 'syncDir'))) {
    snapshot = null;
    refresh(true).catch((error) => logError('sync refresh failed', error));
  }
  return { ...next, version: app.getVersion() };
});

ipcMain.handle('cadence:sync:pickFolder', async () => {
  if (!widget || widget.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(widget, {
    title: 'Cadence sync folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const syncDir = result.filePaths[0];
  const next = normalizeSettings({ ...readState(), syncEnabled: true, syncDir });
  applySettings(next);
  writeState(next);
  snapshot = null;
  refresh(true).catch((error) => logError('sync refresh failed', error));
  return { ...next, version: app.getVersion() };
});

// Provider is not in the settings sheet — it is the rail above the graph — so it
// keeps its own handler. Everything the sheet owns goes through cadence:settings.
ipcMain.handle('cadence:provider', (_event, provider) => {
  const chosen = PROVIDERS.includes(provider) ? provider : 'all';
  writeState({ provider: chosen });
  return chosen;
});

ipcMain.on('cadence:close', () => {
  persistBounds();
  app.quit();
});

ipcMain.on('cadence:minimize', () => widget && widget.minimize());

/**
 * Draw the graph and leave. This runs before the single-instance lock, so
 * asking a running widget's own executable for a graph prints one instead of
 * being bounced as a second instance — and before any window exists, so nothing
 * flashes on screen. Chromium never reaches `whenReady`, so the exit has to be
 * explicit, and stdout is flushed first because a piped write is asynchronous.
 */
async function cli() {
  let code = 1;
  try {
    code = await runCli(cliArgs);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
  }
  await new Promise((resolve) => process.stdout.write('', resolve));
  app.exit(code);
}

if (cliMode) {
  cli();
} else if (!app.requestSingleInstanceLock()) {
  // Another Cadence already holds the lock; this process exits and the first
  // instance's `second-instance` handler raises the existing panel.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!app.isReady()) {
      focusAfterReady = true;
      return;
    }
    ensureWidget();
  });

  process.on('uncaughtException', (error) => logError('uncaughtException', error));
  process.on('unhandledRejection', (error) => logError('unhandledRejection', error));

  app.whenReady().then(() => {
    statePath = path.join(app.getPath('userData'), 'widget-state.json');
    // Persist a device id the first time so sync files stay stable across renames.
    const seeded = normalizeSettings(readState());
    writeState({ deviceId: seeded.deviceId, deviceName: seeded.deviceName });
    Menu.setApplicationMenu(null);
    // Theme has to land before the window exists, or a light-themed panel paints
    // one frame of dark chrome on the way up.
    const settings = normalizeSettings(readState());
    nativeTheme.themeSource = settings.theme;
    createWidget();
    applySettings(settings);
    if (focusAfterReady) bringToFront();
    refresh(true).catch((error) => logError('initial refresh failed', error));
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWidget(); });
  }).catch((error) => logError('whenReady failed', error));

  app.on('window-all-closed', () => app.quit());
}
