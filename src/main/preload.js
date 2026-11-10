// Narrow, explicit bridge between renderers and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('snap', {
  platform: process.platform,
  // overlay
  onInit: on('overlay:init'),
  ready: () => ipcRenderer.send('overlay:ready'),
  cancel: () => ipcRenderer.send('overlay:cancel'),
  finish: (payload) => ipcRenderer.invoke('overlay:finish', payload),
  savePrefs: (patch) => ipcRenderer.send('overlay:prefs', patch),
  copyText: (text) => ipcRenderer.send('clipboard:text', text),
  // pin
  onPinInit: on('pin:init'),
  onPinZoomed: on('pin:zoomed'),
  onPinToast: on('pin:toast'),
  pinMove: (dx, dy) => ipcRenderer.send('pin:move', { dx, dy }),
  pinZoom: (factor, cx, cy) => ipcRenderer.send('pin:zoom', { factor, cx, cy }),
  pinOpacity: (delta) => ipcRenderer.send('pin:opacity', delta),
  pinAction: (action) => ipcRenderer.invoke('pin:action', action),
  pinMenu: () => ipcRenderer.send('pin:menu'),
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseDir: () => ipcRenderer.invoke('settings:chooseDir'),
  suspendHotkeys: (on) => ipcRenderer.send('settings:suspendHotkeys', on),
  openSaveDir: () => ipcRenderer.send('settings:openDir'),
});
