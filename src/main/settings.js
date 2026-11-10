// Persistent user settings (JSON in Electron's userData folder).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const isMac = process.platform === 'darwin';

const DEFAULTS = {
  // Global hotkeys (Electron accelerator strings).
  // Lightshot uses PrintScreen on Windows; macOS reserves Cmd+Shift+3/4/5, so we use Cmd+Shift+2.
  hotkey: isMac ? 'Command+Shift+2' : 'PrintScreen',
  altHotkey: isMac ? '' : 'Control+Shift+2',
  saveDir: path.join(app.getPath('pictures'), 'SnapMark'),
  filenamePattern: 'Screenshot {YYYY}-{MM}-{DD} at {HH}.{mm}.{ss}',
  format: 'png', // png | jpg
  jpgQuality: 92,
  exportScale: 'native', // native (keep Retina pixels) | 1x (downscale to points)
  autoSaveCopy: false, // also save every copied capture into saveDir
  launchAtLogin: false,
  // Last-used tool options (restored on next capture)
  color: '#FF3B30',
  width: 4,
  fontSize: 20, // text
  numberSize: 20, // step numbers
  pointerSize: 22, // cursor pointers
  radius: 6,
  fill: false,
  blurStyle: 'pixelate',
  pointerStyle: 'mac',
  labelBg: true, // step numbers / pointers: label on a colored pill
  autoLabel: true, // open a label editor right after placing a number / pointer
  customColors: [],
};

let cache = null;
const file = () => path.join(app.getPath('userData'), 'settings.json');

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('settings save failed', e);
  }
  return cache;
}

module.exports = { load, save, DEFAULTS, file };
