'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu, screen, shell } = require('electron');
const { collect, summarize, PROVIDERS } = require('../src/usage');
const { comparisons } = require('../src/comparisons');

// Sized to the panel's natural content height so the grid is not marooned above
// a band of empty bezel; the user can still drag it larger.
const DEFAULT_BOUNDS = { width: 472, height: 292 };
const MIN_BOUNDS = { width: 344, height: 252 };

let widget = null;
let statePath = null;
let snapshot = null;
let refreshPromise = null;
let refreshedAt = 0;

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return {}; }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  try { fs.writeFileSync(statePath, JSON.stringify(next, null, 2)); } catch { /* non-fatal */ }
  return next;
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
  widget.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return widget;
}

ipcMain.handle('cadence:report', (_event, provider) => report(provider));

ipcMain.handle('cadence:refresh', async (_event, provider) => {
  await refresh(true);
  return report(provider);
});

ipcMain.handle('cadence:pin', (_event, pinned) => {
  const next = Boolean(pinned);
  if (widget) widget.setAlwaysOnTop(next, 'floating');
  writeState({ pinned: next });
  return next;
});

ipcMain.handle('cadence:state', () => {
  const saved = readState();
  return {
    pinned: saved.pinned !== false,
    provider: saved.provider || 'all',
    metric: saved.metric === 'tokens' ? 'tokens' : 'signal',
  };
});

ipcMain.handle('cadence:metric', (_event, metric) => {
  const chosen = metric === 'tokens' ? 'tokens' : 'signal';
  writeState({ metric: chosen });
  return chosen;
});

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

if (!app.requestSingleInstanceLock()) {
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
    createWidget();
    refresh(true).catch(() => {});
    setInterval(() => {
      refresh(true)
        .then(() => widget && !widget.isDestroyed() && widget.webContents.send('cadence:tick'))
        .catch(() => {});
    }, 60000);
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWidget(); });
  });

  app.on('window-all-closed', () => app.quit());
}
