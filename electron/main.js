'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu, nativeTheme, screen, shell } = require('electron');
const { collect, summarize, PROVIDERS } = require('../src/usage');
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

// Sized to the panel's natural content height so the grid is not marooned above
// a band of empty bezel; the user can still drag it larger.
const DEFAULT_BOUNDS = { width: 472, height: 292 };
const MIN_BOUNDS = { width: 344, height: 252 };

let widget = null;
let statePath = null;
let snapshot = null;
let refreshPromise = null;
let refreshedAt = 0;
let tickTimer = null;

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
function normalizeSettings(saved) {
  return {
    // Dark by default: the panel is a floating instrument on a desktop, not a
    // document, and its ramps were cut against the dark bezel first.
    theme: THEMES.includes(saved.theme) ? saved.theme : 'dark',
    scanSeconds: SCAN_SECONDS.includes(saved.scanSeconds) ? saved.scanSeconds : 60,
    launchAtLogin: saved.launchAtLogin === true,
    rotateComparisons: saved.rotateComparisons !== false,
    pinned: saved.pinned !== false,
    metric: saved.metric === 'tokens' ? 'tokens' : 'signal',
    provider: PROVIDERS.includes(saved.provider) ? saved.provider : 'all',
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
 * Push settings out to the things that actually implement them. Reads the login
 * item back from the OS rather than trusting the write, so a policy-blocked or
 * failed registration shows up in the panel as off instead of silently lying.
 */
function applySettings(settings) {
  nativeTheme.themeSource = settings.theme;
  if (widget && !widget.isDestroyed()) widget.setAlwaysOnTop(settings.pinned, 'floating');
  scheduleScans(settings.scanSeconds);
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
function visibleBounds(saved) {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
  const bounds = {
    x: Math.round(saved.x),
    y: Math.round(saved.y),
    width: Math.max(MIN_BOUNDS.width, Math.round(saved.width || DEFAULT_BOUNDS.width)),
    height: Math.max(MIN_BOUNDS.height, Math.round(saved.height || DEFAULT_BOUNDS.height)),
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
    .then((data) => { snapshot = data; refreshedAt = Date.now(); return data; })
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
    sources: data.files,
    refreshedAt: new Date(refreshedAt).toISOString(),
  };
}

function persistBounds() {
  if (!widget || widget.isDestroyed() || widget.isMinimized()) return;
  writeState({ bounds: widget.getBounds() });
}

function createWidget() {
  const saved = readState();
  const bounds = visibleBounds(saved.bounds) || defaultBounds();
  const pinned = saved.pinned !== false;

  widget = new BrowserWindow({
    ...bounds,
    minWidth: MIN_BOUNDS.width,
    minHeight: MIN_BOUNDS.height,
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
   * on whichever signal arrives first, and keep a timer as a last resort.
   */
  let revealed = false;
  const reveal = () => {
    if (revealed || !widget || widget.isDestroyed()) return;
    revealed = true;
    widget.setBounds(bounds);
    widget.show();
  };
  widget.once('ready-to-show', reveal);
  widget.webContents.once('did-finish-load', reveal);
  const revealTimer = setTimeout(reveal, 4000);
  widget.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Cadence failed to load ${url}: ${description} (${code})`);
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
  const next = normalizeSettings({ ...readState(), ...(patch && typeof patch === 'object' ? patch : {}) });
  applySettings(next);
  writeState(next);
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
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!widget) return createWidget();
    if (widget.isMinimized()) widget.restore();
    widget.show();
    widget.focus();
  });

  app.whenReady().then(() => {
    statePath = path.join(app.getPath('userData'), 'widget-state.json');
    Menu.setApplicationMenu(null);
    // Theme has to land before the window exists, or a light-themed panel paints
    // one frame of dark chrome on the way up.
    const settings = normalizeSettings(readState());
    nativeTheme.themeSource = settings.theme;
    createWidget();
    applySettings(settings);
    refresh(true).catch(() => {});
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWidget(); });
  });

  app.on('window-all-closed', () => app.quit());
}
