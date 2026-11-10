// SnapMark — main process.
// Workflow follows the classic Lightshot-style flow:
//   tray-only app  ->  global hotkey  ->  freeze screen  ->  full-screen overlay per display
//   ->  region selection + draw toolbar + action toolbar  ->  copy / save / pin.
const {
  app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, screen, ipcMain,
  nativeImage, dialog, shell, systemPreferences, Notification,
} = require('electron');
const fs = require('fs');
const { execFile } = require('child_process');
const path = require('path');
const settings = require('./settings');
const clip = require('./clip');

const isMac = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, 'preload.js');
const RENDERER = path.join(__dirname, '..', 'renderer');

let tray = null;
let settingsWin = null;
let capturing = false;
const overlays = new Map(); // webContents.id -> { win, display }
const pins = new Map(); // webContents.id -> { win, png, w, h, zoom }

// ---------------------------------------------------------------- logging
// macOS: ~/Library/Logs/SnapMark/main.log   Windows: %APPDATA%/SnapMark/logs/main.log
let logFile = null;
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`;
  console.log(line);
  try {
    if (!logFile) {
      const dir = app.getPath('logs');
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, 'main.log');
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2e6) fs.renameSync(logFile, `${logFile}.old`);
    }
    fs.appendFileSync(logFile, `${line}\n`);
  } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => log('uncaughtException', String(e && e.stack ? e.stack : e)));
process.on('unhandledRejection', (e) => log('unhandledRejection', String(e && e.stack ? e.stack : e)));

// ---------------------------------------------------------------- boot
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => startCapture());
}

app.whenReady().then(() => {
  if (isMac && app.dock) app.dock.hide(); // like Lightshot's LSUIElement
  log(`start v${app.getVersion()} electron ${process.versions.electron} ${process.platform} ${process.arch}`,
    `exe=${process.execPath}`, `screen=${screenStatus()}`, `displays=${screen.getAllDisplays().length}`);
  createTray();
  if (isMac) setInterval(() => { if (screenStatus() !== lastStatus) refreshTrayMenu(); }, 3000);
  registerHotkeys();
  applyLoginItem();
  screen.on('display-added', closeOverlays);
  screen.on('display-removed', closeOverlays);
  if (process.argv.includes('--capture')) setTimeout(() => startCapture(), 500);
});

app.on('window-all-closed', (e) => e.preventDefault()); // stay alive in the tray
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---------------------------------------------------------------- tray
function trayImage() {
  const file = isMac ? 'trayTemplate.png' : 'tray.png';
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', file));
  if (isMac) img.setTemplateImage(true);
  return img;
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('SnapMark');
  if (!isMac) tray.on('click', () => startCapture());
  refreshTrayMenu();
}

let lastStatus = null;
function refreshTrayMenu() {
  const s = settings.load();
  lastStatus = screenStatus();
  const permItems = isMac ? [
    lastStatus === 'granted'
      ? { label: 'Screen Recording: Allowed', enabled: false }
      : { label: '⚠︎ Screen Recording: Not Allowed — Fix…', click: () => showPermissionHelp() },
    { type: 'separator' },
  ] : [];
  const menu = Menu.buildFromTemplate([
    ...permItems,
    { label: 'Capture Region', accelerator: s.hotkey || undefined, registerAccelerator: false, click: () => startCapture() },
    { label: 'Capture in 3 Seconds', click: () => setTimeout(() => startCapture(), 3000) },
    { label: 'Capture Full Screen → Clipboard', click: () => captureFullScreenToClipboard() },
    { type: 'separator' },
    { label: 'Paste Clipboard Image as Pin', click: () => pinFromClipboard() },
    { label: 'Close All Pins', enabled: pins.size > 0, click: () => [...pins.values()].forEach((p) => p.win.close()) },
    { type: 'separator' },
    { label: 'Open Screenshots Folder', click: () => openSaveDir() },
    { label: 'Settings…', accelerator: isMac ? 'Command+,' : undefined, registerAccelerator: false, click: openSettings },
    { label: 'Show Log File', click: () => logFile && shell.showItemInFolder(logFile) },
    { type: 'separator' },
    { label: 'Quit SnapMark', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

// ---------------------------------------------------------------- hotkeys
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const s = settings.load();
  const failed = [];
  for (const key of [s.hotkey, s.altHotkey].filter(Boolean)) {
    try {
      if (!globalShortcut.register(key, () => { log('hotkey', key); startCapture(); })) failed.push(key);
    } catch (e) {
      log('hotkey error', key, String(e));
      failed.push(key);
    }
  }
  log('hotkeys', { registered: [s.hotkey, s.altHotkey].filter((k) => k && !failed.includes(k)), failed });
  if (failed.length) {
    notify('Hotkey unavailable', `Could not register ${failed.join(', ')}. Another app may own it — change it in Settings.`);
  }
  return failed;
}

function applyLoginItem() {
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.load().launchAtLogin });
  } catch { /* unsupported in dev on some platforms */ }
}

// ---------------------------------------------------------------- capture
function screenStatus() {
  if (!isMac) return 'granted';
  try { return systemPreferences.getMediaAccessStatus('screen'); } catch { return 'unknown'; }
}

function hasScreenPermission() {
  return screenStatus() === 'granted';
}

function requestScreenAccessMac() {
  return new Promise((resolve) => {
    const tmp = path.join(app.getPath('temp'), `snapmark-probe-${process.pid}.png`);
    execFile('/usr/sbin/screencapture', ['-x', '-t', 'png', tmp], { timeout: 15000 }, (err) => {
      if (err) log('screencapture probe', String(err));
      fs.rm(tmp, { force: true }, () => {});
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
        .catch((e) => log('probe error', String(e)))
        .finally(resolve);
    });
  });
}

async function showPermissionHelp() {
  if (isMac) app.focus({ steal: true });
  const r = await dialog.showMessageBox({
    type: 'warning',
    message: 'SnapMark can’t see your screen yet',
    detail: [
      'macOS hasn’t granted Screen Recording to this copy of SnapMark.',
      '',
      '1. Open System Settings → Privacy & Security → Screen & System Audio Recording',
      '2. If SnapMark is listed, select it and click “−” (that entry is from an older build)',
      '3. Click “+”, choose SnapMark in Applications, and switch it ON',
      '4. Click “Quit SnapMark” below, then open SnapMark again',
    ].join('\n'),
    buttons: ['Open System Settings', 'Quit SnapMark', 'Cancel'],
    defaultId: 0,
  });
  if (r.response === 0) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  if (r.response === 1) app.quit();
}

async function grabDisplays() {
  const displays = screen.getAllDisplays();
  let maxW = 0;
  let maxH = 0;
  for (const d of displays) {
    maxW = Math.max(maxW, Math.round(d.size.width * d.scaleFactor));
    maxH = Math.max(maxH, Math.round(d.size.height * d.scaleFactor));
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } });
  return displays.map((d, i) => {
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[i];
    let img = src ? src.thumbnail : nativeImage.createEmpty();
    const wantW = Math.round(d.size.width * d.scaleFactor);
    const sz = img.getSize();
    if (!img.isEmpty() && sz.width !== wantW) img = img.resize({ width: wantW, quality: 'best' });
    return { display: d, image: img };
  });
}

async function startCapture() {
  if (capturing) return;
  capturing = true;
  try {
    log('capture start', `screen=${screenStatus()}`);
    if (!hasScreenPermission()) {
      // Trigger the system prompt so the app shows up in System Settings. Electron's ScreenCaptureKit path can fail
      // silently without prompting, so also run Apple's `screencapture` as a child process: TCC attributes it to
      // SnapMark (the responsible process) and shows the standard "allow screen recording" prompt.
      await requestScreenAccessMac();
      log('after probe', `screen=${screenStatus()}`);
      if (!hasScreenPermission()) {
        capturing = false;
        refreshTrayMenu();
        await showPermissionHelp();
        return;
      }
    }
    const t0 = Date.now();
    const shots = await grabDisplays();
    log('grabbed', shots.map((x) => ({ id: x.display.id, size: x.image.getSize(), empty: x.image.isEmpty() })), `${Date.now() - t0}ms`);
    if (shots.every((x) => x.image.isEmpty())) throw new Error('Screen capture returned no image (Screen Recording permission?)');
    const cursor = screen.getCursorScreenPoint();
    const s = settings.load();
    for (const shot of shots) openOverlay(shot, cursor, s);
    // watchdog: never leave the app stuck in "capturing" if an overlay fails to come up
    setTimeout(() => {
      const stuck = [...overlays.values()].filter((o) => !o.win.isDestroyed() && !o.win.isVisible());
      if (stuck.length && stuck.length === overlays.size) {
        log('watchdog: overlays never became ready, closing');
        closeOverlays();
        notify('Capture failed', 'The capture window did not open. See Show Log File in the menu.');
      }
    }, 6000);
  } catch (e) {
    log('capture error', String(e && e.stack ? e.stack : e));
    capturing = false;
    closeOverlays();
    notify('Capture failed', String(e && e.message ? e.message : e));
  }
}

function openOverlay({ display, image }, cursor, s) {
  const b = display.bounds;
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    show: false, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, enableLargerThanScreen: true,
    alwaysOnTop: true, backgroundColor: '#000000', roundedCorners: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setBounds(b); // macOS: cover the menu bar too
  win.setMenu(null);
  overlays.set(win.webContents.id, { win, display });
  win.on('closed', () => {
    for (const [id, o] of overlays) if (o.win === win) overlays.delete(id);
    if (overlays.size === 0) capturing = false;
  });
  win.webContents.on('console-message', (...args) => {
    const ev = args[0] || {};
    const level = ev.level != null ? ev.level : args[1];
    const message = ev.message != null ? ev.message : args[2];
    if (level === 'error' || level === 'warning' || level >= 2) log('overlay console', level, message);
  });
  win.webContents.on('render-process-gone', (_e, d) => log('overlay renderer gone', d));
  win.webContents.on('did-fail-load', (_e, code, desc) => log('overlay load failed', code, desc));
  win.loadFile(path.join(RENDERER, 'overlay.html'));
  win.webContents.once('did-finish-load', () => {
    const size = image.getSize();
    const cursorHere = cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height;
    win.webContents.send('overlay:init', {
      displayId: display.id,
      width: b.width,
      height: b.height,
      scaleFactor: display.scaleFactor,
      imgW: size.width,
      imgH: size.height,
      bitmap: image.toBitmap(), // raw BGRA, no encode cost
      cursor: cursorHere ? { x: cursor.x - b.x, y: cursor.y - b.y } : null,
      platform: process.platform,
      settings: s,
    });
  });
}

function overlayFor(sender) {
  return overlays.get(sender.id);
}

function closeOverlays() {
  for (const { win } of overlays.values()) if (!win.isDestroyed()) win.destroy();
  overlays.clear();
  capturing = false;
}

function hideOverlays() {
  for (const { win } of overlays.values()) if (!win.isDestroyed()) win.hide();
}

function showOverlays() {
  for (const { win } of overlays.values()) if (!win.isDestroyed()) win.show();
}

async function captureFullScreenToClipboard() {
  if (!hasScreenPermission()) return startCapture(); // shows the permission flow
  const pt = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(pt);
  const shots = await grabDisplays();
  const shot = shots.find((x) => x.display.id === d.id) || shots[0];
  await clip.writePng(shot.image.toPNG());
  if (settings.load().autoSaveCopy) writeToSaveDir(shot.image.toPNG(), 'png');
  notify('Copied full screen', `${shot.image.getSize().width} × ${shot.image.getSize().height} px`);
}

// ---------------------------------------------------------------- files
function pad(n) {
  return String(n).padStart(2, '0');
}

function makeFilename(ext) {
  const d = new Date();
  const map = {
    YYYY: d.getFullYear(), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()),
    HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
  };
  const base = (settings.load().filenamePattern || 'Screenshot').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
  return `${base.replace(/[\\/:*?"<>|]/g, '-')}.${ext}`;
}

function uniquePath(dir, name) {
  let p = path.join(dir, name);
  const { name: stem, ext } = path.parse(name);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${stem} (${i})${ext}`);
  return p;
}

function encode(pngBuf, format) {
  if (format === 'jpg') return nativeImage.createFromBuffer(pngBuf).toJPEG(settings.load().jpgQuality || 92);
  return pngBuf;
}

function writeToSaveDir(pngBuf, format) {
  const dir = settings.load().saveDir;
  fs.mkdirSync(dir, { recursive: true });
  const p = uniquePath(dir, makeFilename(format));
  fs.writeFileSync(p, encode(pngBuf, format));
  return p;
}

async function saveWithDialog(pngBuf, parent) {
  const s = settings.load();
  fs.mkdirSync(s.saveDir, { recursive: true });
  if (isMac) app.focus({ steal: true });
  const opts = {
    title: 'Save Screenshot',
    defaultPath: path.join(s.saveDir, makeFilename(s.format)),
    filters: [
      { name: 'PNG Image', extensions: ['png'] },
      { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
    ],
  };
  if (s.format === 'jpg') opts.filters.reverse();
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  const isJpg = /\.jpe?g$/i.test(r.filePath);
  const filePath = /\.(png|jpe?g)$/i.test(r.filePath) ? r.filePath : `${r.filePath}.png`;
  fs.writeFileSync(filePath, encode(pngBuf, isJpg ? 'jpg' : 'png'));
  settings.save({ saveDir: path.dirname(filePath) });
  return filePath;
}

function openSaveDir() {
  const dir = settings.load().saveDir;
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  if (onClick) n.on('click', onClick);
  n.show();
}

// ---------------------------------------------------------------- overlay IPC
ipcMain.on('overlay:ready', (e) => {
  const o = overlayFor(e.sender);
  if (!o) return;
  log('overlay ready', o.display.id);
  o.win.show();
  o.win.focus();
  if (isMac) app.focus({ steal: true });
});

ipcMain.on('overlay:cancel', () => { log('overlay cancel'); closeOverlays(); });

ipcMain.on('overlay:prefs', (_e, patch) => settings.save(patch));

ipcMain.on('clipboard:text', (_e, text) => clip.writeText(text).catch((e) => log('copy text failed', String(e))));

ipcMain.handle('overlay:finish', async (e, { action, png, rect }) => {
  const o = overlayFor(e.sender);
  log('finish', action, rect, `${png.length} bytes`);
  const buf = Buffer.from(png);
  const s = settings.load();
  if (action === 'copy') {
    await clip.writePng(buf); // throws -> overlay stays open and shows the error
    log('copied to clipboard');
    closeOverlays();
    if (s.autoSaveCopy) writeToSaveDir(buf, s.format);
    return { ok: true };
  }
  if (action === 'quicksave') {
    const p = writeToSaveDir(buf, s.format);
    closeOverlays();
    await clip.writePng(buf).catch((e) => log('quicksave copy failed', String(e)));
    notify('Saved & copied', path.basename(p), () => shell.showItemInFolder(p));
    return { ok: true, path: p };
  }
  if (action === 'save') {
    hideOverlays();
    const p = await saveWithDialog(buf);
    if (!p) {
      showOverlays();
      if (o && !o.win.isDestroyed()) o.win.focus();
      return { ok: false, canceled: true };
    }
    closeOverlays();
    return { ok: true, path: p };
  }
  if (action === 'pin') {
    const b = o ? o.display.bounds : { x: 0, y: 0 };
    closeOverlays();
    createPin(buf, { x: b.x + rect.x, y: b.y + rect.y, width: rect.w, height: rect.h });
    return { ok: true };
  }
  return { ok: false };
});

// ---------------------------------------------------------------- pins (Snipaste-style floating screenshots)
function createPin(png, bounds) {
  const win = new BrowserWindow({
    x: Math.round(bounds.x), y: Math.round(bounds.y),
    width: Math.max(24, Math.round(bounds.width)), height: Math.max(24, Math.round(bounds.height)),
    frame: false, resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: true, show: false, backgroundColor: '#00000000', transparent: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  const entry = { win, png, w: Math.round(bounds.width), h: Math.round(bounds.height), zoom: 1 };
  pins.set(win.webContents.id, entry);
  const id = win.webContents.id;
  win.on('closed', () => { pins.delete(id); refreshTrayMenu(); });
  win.loadFile(path.join(RENDERER, 'pin.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('pin:init', { png, w: entry.w, h: entry.h });
    win.showInactive();
    win.focus();
  });
  refreshTrayMenu();
}

async function pinFromClipboard() {
  const png = await clip.readPng().catch((e) => { log('read clipboard failed', String(e)); return null; });
  if (!png) return notify('No image on clipboard', 'Copy an image first.');
  const img = nativeImage.createFromBuffer(png);
  const pt = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(pt);
  const sz = img.getSize();
  const w = sz.width / d.scaleFactor;
  const h = sz.height / d.scaleFactor;
  createPin(png, { x: pt.x - w / 2, y: pt.y - h / 2, width: w, height: h });
}

ipcMain.on('pin:move', (e, { dx, dy }) => {
  const p = pins.get(e.sender.id);
  if (!p) return;
  const [x, y] = p.win.getPosition();
  p.win.setPosition(Math.round(x + dx), Math.round(y + dy));
});

ipcMain.on('pin:zoom', (e, { factor, cx, cy }) => {
  const p = pins.get(e.sender.id);
  if (!p) return;
  const next = factor === 0 ? 1 : Math.min(8, Math.max(0.1, p.zoom * factor));
  const b = p.win.getBounds();
  const nw = Math.round(p.w * next);
  const nh = Math.round(p.h * next);
  // keep the point under the cursor fixed
  const fx = cx == null ? 0.5 : cx / b.width;
  const fy = cy == null ? 0.5 : cy / b.height;
  p.zoom = next;
  p.win.setBounds({ x: Math.round(b.x + fx * b.width - fx * nw), y: Math.round(b.y + fy * b.height - fy * nh), width: nw, height: nh });
  p.win.webContents.send('pin:zoomed', next);
});

ipcMain.on('pin:opacity', (e, delta) => {
  const p = pins.get(e.sender.id);
  if (!p) return;
  p.win.setOpacity(Math.min(1, Math.max(0.15, p.win.getOpacity() + delta)));
});

async function pinAction(p, action) {
  if (action === 'copy') { await clip.writePng(Buffer.from(p.png)); return 'Copied'; }
  if (action === 'cut') { await clip.writePng(Buffer.from(p.png)); p.win.close(); return null; }
  if (action === 'save') { const f = await saveWithDialog(Buffer.from(p.png), p.win); return f ? 'Saved' : null; }
  if (action === 'quicksave') { const f = writeToSaveDir(Buffer.from(p.png), settings.load().format); return `Saved ${path.basename(f)}`; }
  if (action === 'close') { p.win.close(); return null; }
  return null;
}

ipcMain.handle('pin:action', async (e, action) => {
  const p = pins.get(e.sender.id);
  if (!p) return null;
  return pinAction(p, action);
});

ipcMain.on('pin:menu', (e) => {
  const p = pins.get(e.sender.id);
  if (!p) return;
  const send = (a) => pinAction(p, a)
    .then((msg) => msg && !p.win.isDestroyed() && p.win.webContents.send('pin:toast', msg))
    .catch((err) => { log('pin action failed', a, String(err)); if (!p.win.isDestroyed()) p.win.webContents.send('pin:toast', 'Failed'); });
  Menu.buildFromTemplate([
    { label: 'Copy', accelerator: 'CommandOrControl+C', click: () => send('copy') },
    { label: 'Cut (copy & close)', accelerator: 'CommandOrControl+X', click: () => send('cut') },
    { label: 'Save As…', accelerator: 'CommandOrControl+S', click: () => send('save') },
    { label: 'Quick Save to Folder', accelerator: 'CommandOrControl+Shift+S', click: () => send('quicksave') },
    { type: 'separator' },
    { label: 'Actual Size', accelerator: 'CommandOrControl+0', click: () => ipcMain.emit('pin:zoom', { sender: e.sender }, { factor: 0 }) },
    { label: 'Opacity 100%', click: () => p.win.setOpacity(1) },
    { label: 'Opacity 50%', click: () => p.win.setOpacity(0.5) },
    { type: 'separator' },
    { label: 'Close', accelerator: 'Escape', click: () => p.win.close() },
  ]).popup({ window: p.win });
});

// ---------------------------------------------------------------- settings window
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 520, height: 600, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    title: 'SnapMark Settings', show: false, backgroundColor: '#1c1c1e',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(RENDERER, 'settings.html'));
  settingsWin.once('ready-to-show', () => { settingsWin.show(); if (isMac) app.focus({ steal: true }); });
  settingsWin.on('closed', () => { settingsWin = null; });
}

ipcMain.handle('settings:get', () => ({ settings: settings.load(), platform: process.platform, file: settings.file() }));

ipcMain.handle('settings:set', (_e, patch) => {
  const before = settings.load();
  settings.save(patch);
  const failed = registerHotkeys();
  if (failed.length) {
    // roll back hotkeys that could not be registered
    settings.save({ hotkey: failed.includes(patch.hotkey) ? before.hotkey : settings.load().hotkey,
      altHotkey: failed.includes(patch.altHotkey) ? before.altHotkey : settings.load().altHotkey });
    registerHotkeys();
  }
  applyLoginItem();
  refreshTrayMenu();
  return { settings: settings.load(), failed };
});

ipcMain.handle('settings:chooseDir', async () => {
  const r = await dialog.showOpenDialog(settingsWin || undefined, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: settings.load().saveDir,
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.on('settings:suspendHotkeys', (_e, on) => (on ? globalShortcut.unregisterAll() : registerHotkeys()));
ipcMain.on('settings:openDir', () => openSaveDir());
