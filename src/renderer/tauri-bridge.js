// Tauri build only: gives the pages the same `window.snap` API that src/main/preload.js gives them in Electron,
// so overlay/pin/settings pages run unchanged. Injected by src-tauri as an initialization script.
(() => {
  if (!window.__TAURI_INTERNALS__) return;
  const T = () => window.__TAURI__;
  const invoke = (cmd, args, opts) => T().core.invoke(cmd, args, opts);
  const on = (event) => (cb) => { T().event.listen(event, (e) => cb(e.payload)); };
  const platform = /Mac/.test(navigator.platform) ? 'darwin' : 'win32';
  let opacity = 1;
  const setOpacity = (v) => { opacity = Math.min(1, Math.max(0.15, v)); document.documentElement.style.opacity = String(opacity); };

  window.snap = {
    platform,
    // overlay: metadata arrives as an event, the frozen screen as raw bytes (no JSON) from overlay_frame
    onInit: (cb) => {
      // Windows: the frozen screen arrives as WebView2 shared memory, already RGBA
      const wv = window.chrome && window.chrome.webview;
      if (wv) wv.addEventListener('sharedbufferreceived', (e) => {
        cb({ ...e.additionalData, bitmap: new Uint8Array(e.getBuffer()) });
      });
      return T().event.listen('overlay:init', async (e) => {
        const buf = await invoke('overlay_frame');
        cb({ ...e.payload, bitmap: new Uint8Array(buf) });
      }).then(() => invoke('overlay_loaded')); // tells the app this pre-loaded window can take a capture
    },
    ready: () => invoke('overlay_ready'),
    cancel: () => invoke('overlay_cancel'),
    finish: ({ action, png, rect }) => invoke('overlay_finish', png, {
      headers: { 'x-action': action, 'x-rect': JSON.stringify(rect) },
    }),
    savePrefs: (patch) => invoke('save_prefs', { patch }),
    copyText: (text) => invoke('copy_text', { text }),
    // pin
    onPinInit: async (cb) => { // the image is pulled as raw bytes as soon as the page is up
      T().event.listen('pin:setOpacity', (e) => setOpacity(e.payload));
      const buf = await invoke('pin_png');
      cb({ png: new Uint8Array(buf) });
      invoke('pin_loaded');
    },
    onPinZoomed: on('pin:zoomed'),
    onPinToast: on('pin:toast'),
    pinMove: (dx, dy) => invoke('pin_move', { dx, dy }),
    pinZoom: (factor, cx, cy) => invoke('pin_zoom', { factor, cx: cx == null ? null : cx, cy: cy == null ? null : cy }),
    pinOpacity: (delta) => setOpacity(opacity + delta), // the pin window is transparent; fade the page itself
    pinAction: (action) => invoke('pin_action', { action }),
    pinMenu: () => invoke('pin_menu'),
    // settings
    getSettings: () => invoke('settings_get'),
    setSettings: (patch) => invoke('settings_set', { patch }),
    chooseDir: () => invoke('settings_choose_dir'),
    suspendHotkeys: (on) => invoke('settings_suspend_hotkeys', { on }),
    openSaveDir: () => invoke('open_save_dir'),
    checkUpdates: () => invoke('check_updates'),
  };
})();
