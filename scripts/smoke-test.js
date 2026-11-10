// Headless smoke test for the capture overlay (no Screen Recording permission needed).
// Feeds a synthetic "screen", drives selection + every tool with synthetic input, then exports.
// Run: npx electron scripts/smoke-test.js [outDir]
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'smoke'));
const W = 1200, H = 760, K = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeScreen() {
  const w = W * K, h = H * K;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = 236, g = 238, b = 242; // app background
      if (y < 60 * K) { r = 30; g = 30; b = 34; } // title bar
      else if (x < 220 * K) { r = 248; g = 248; b = 250; } // sidebar
      if (x > 300 * K && x < 900 * K && y > 140 * K && y < 520 * K) { r = 255; g = 255; b = 255; } // card
      if (x > 340 * K && x < 600 * K && y > 180 * K && y < 230 * K) { r = 10; g = 132; b = 255; } // button
      if (y > 300 * K && y < 310 * K && x > 340 * K && x < 840 * K) { r = 120; g = 120; b = 128; } // text line
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255; // BGRA
    }
  }
  return buf;
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  ipcMain.on('overlay:ready', () => results.push('ready'));
  ipcMain.on('overlay:prefs', () => {});
  ipcMain.on('clipboard:text', (_e, t) => results.push(`clipboard:${t}`));
  ipcMain.on('overlay:cancel', () => results.push('cancel'));
  ipcMain.handle('overlay:finish', (_e, { action, png, rect }) => {
    fs.writeFileSync(path.join(OUT, `export-${action}.png`), Buffer.from(png));
    results.push(`finish:${action}:${Math.round(rect.w)}x${Math.round(rect.h)}`);
    return { ok: true };
  });

  const win = new BrowserWindow({
    width: W, height: H, show: false, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'), offscreen: true, sandbox: true, contextIsolation: true },
  });
  win.webContents.setFrameRate(60);
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'overlay.html'), { hash: 'test' });
  win.webContents.on('console-message', (e) => console.log('[renderer]', e.message || e));
  win.webContents.send('overlay:init', {
    displayId: 1, width: W, height: H, scaleFactor: K, imgW: W * K, imgH: H * K, bitmap: fakeScreen(),
    cursor: { x: 200, y: 200 }, platform: process.platform,
    settings: { color: '#FF3B30', width: 4, fontSize: 20, radius: 6, fill: false, blurStyle: 'pixelate', pointerStyle: 'mac', customColors: [], exportScale: 'native' },
  });
  await sleep(600);

  const wc = win.webContents;
  const mouse = async (type, x, y, extra = {}) => { wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, ...extra }); await sleep(25); };
  const dragFrom = async (x0, y0, x1, y1, mods = []) => {
    await mouse('mouseMove', x0, y0);
    await mouse('mouseDown', x0, y0, { modifiers: mods });
    for (let i = 1; i <= 8; i++) await mouse('mouseMove', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8, { modifiers: ['leftButtonDown', ...mods] });
    await mouse('mouseUp', x1, y1, { modifiers: mods });
  };
  const click = async (x, y) => { await mouse('mouseMove', x, y); await mouse('mouseDown', x, y); await mouse('mouseUp', x, y); };
  const key = async (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode.length === 1 && !modifiers.some((m) => m === 'meta' || m === 'control')) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(40);
  };
  const type = async (text) => { for (const ch of text) { wc.sendInputEvent({ type: 'char', keyCode: ch }); await sleep(10); } };
  const state = () => wc.executeJavaScript('({phase: __S.phase, sel: __S.sel, tool: __S.tool, n: __S.annos.length, types: __S.annos.map(a => a.type)})');
  const shot = async (name) => { const img = await wc.capturePage(); fs.writeFileSync(path.join(OUT, name), img.toPNG()); };

  await mouse('mouseMove', 420, 260);
  await shot('01-idle-loupe.png');

  await dragFrom(260, 110, 960, 580);
  let s = await state();
  console.log('after select', JSON.stringify(s));

  const draw = [
    ['R', () => dragFrom(330, 170, 620, 240)],
    ['A', () => dragFrom(760, 420, 630, 250)],
    ['E', () => dragFrom(700, 300, 860, 380)],
    ['P', () => dragFrom(340, 440, 520, 480)],
    ['M', () => dragFrom(340, 304, 700, 304)],
    ['L', () => dragFrom(320, 540, 560, 540)],
    ['N', async () => { await click(320, 160); await sleep(80); await key('Escape'); }],
    ['N', async () => { await click(320, 300); await sleep(80); await key('Escape'); }],
    ['U', async () => { await click(600, 230); await sleep(80); await key('Escape'); }],
    ['B', () => dragFrom(720, 160, 880, 220)],
    ['D', () => dragFrom(300, 130, 900, 130)],
  ];
  for (const [k, fn] of draw) { await key(k); await fn(); }
  await key('T');
  await click(600, 450);
  await sleep(100);
  await type('Make this bigger');
  await key('Escape');
  await sleep(50);
  s = await state();
  console.log('after tools', JSON.stringify(s));
  await key('V');
  await shot('02-annotated.png');

  // spotlight in a second pass to verify darkening; then undo it
  await key('F');
  await dragFrom(320, 150, 640, 260);
  await shot('03-spotlight.png');
  await key('Z', [process.platform === 'darwin' ? 'meta' : 'control']);
  s = await state();
  console.log('after undo', JSON.stringify(s));

  // ---- editable text: create, recolor while typing, commit, drag, resize, re-edit, Cmd+S while typing
  const MOD = process.platform === 'darwin' ? 'meta' : 'control';
  const js = (code) => wc.executeJavaScript(code);
  await key('T');
  await click(380, 400);
  await sleep(120);
  await type('Hello');
  await js(`(() => { const sw = document.querySelector('.swatch[data-tip="#0A84FF"]'); sw.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true})); sw.click(); })()`);
  const liveColor = await js('__S.editing && __S.editing.a.color');
  const stillEditing = await js('!!__S.editing && document.activeElement.id === "textEditor"');
  await key('Escape');
  await sleep(50);
  let tx = await js('(() => { const a = __S.annos.find(a => a.id === __S.selectedId); return a && {id: a.id, type: a.type, text: a.text, color: a.color, x: a.x, y: a.y, size: a.size}; })()');
  console.log('text after commit', JSON.stringify(tx), 'liveColor', liveColor, 'stillEditing', stillEditing);
  await dragFrom(tx.x + 10, tx.y + 10, tx.x + 110, tx.y + 50);
  const moved = await js(`__S.annos.find(a => a.id === ${tx.id})`);
  const hs = await js(`__T.annoHandles(__S.annos.find(a => a.id === ${tx.id})).find(h => h.id === 'se')`);
  await dragFrom(hs.x, hs.y, hs.x + 80, hs.y + 40);
  const resized = await js(`__S.annos.find(a => a.id === ${tx.id})`);
  console.log('moved', moved.x - tx.x, moved.y - tx.y, 'resized size', tx.size, '->', resized.size);
  await shot('04-text-selected.png');
  await click(resized.x + 8, resized.y + 8); // click selected text again -> edit
  await sleep(120);
  const reopened = await js('!!__S.editing');
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'End' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'End' });
  await type(' world');
  await key('S', [MOD]);
  for (let i = 0; i < 60 && !results.some((r) => r.startsWith('finish:save')); i++) await sleep(100);
  await sleep(100);
  const finalText = await js(`(__S.annos.find(a => a.id === ${tx.id}) || {}).text`);
  console.log('reopened', reopened, 'final text', JSON.stringify(finalText));
  const textOk = liveColor === '#0A84FF' && stillEditing && tx.color === '#0A84FF' && tx.text === 'Hello'
    && Math.round(moved.x - tx.x) === 100 && resized.size > tx.size && reopened && finalText === 'Hello world'
    && results.some((r) => r.startsWith('finish:save'));
  console.log(textOk ? 'TEXT OK' : 'TEXT FAILED', JSON.stringify({ liveColor, stillEditing, c: tx.color, t: tx.text, dx: moved.x - tx.x, r: resized.size, reopened, finalText, results }));

  // ---- labels on step numbers / pointers
  await key('N');
  await click(640, 470);
  await sleep(120);
  await type('Increase padding');
  await key('Escape');
  await key('U');
  await click(820, 250);
  await sleep(120);
  await type('Click here');
  await key('Escape');
  await sleep(50);
  const labels = await js(`__S.annos.filter(a => a.label).map(a => ({ type: a.type, n: a.n, label: a.label }))`);
  const lastNum = await js(`(() => { const a = __S.annos.filter(a => a.type === 'number').pop(); const b = __T.bbox(a); return { w: b.w, label: a.label }; })()`);
  console.log('labels', JSON.stringify(labels), 'number bbox w', Math.round(lastNum.w));
  const labelOk = labels.length === 2 && labels[0].label === 'Increase padding' && labels[0].n === 3 && labels[1].label === 'Click here' && lastNum.w > 100;
  console.log(labelOk ? 'LABEL OK' : 'LABEL FAILED');
  await key('V');
  await shot('05-labels.png');

  // eyedropper
  await key('I');
  await click(400, 200);

  // export via Copy shortcut
  await key('C', [process.platform === 'darwin' ? 'meta' : 'control']);
  await sleep(800);
  console.log('results', JSON.stringify(results));
  const exp = path.join(OUT, 'export-copy.png');
  if (fs.existsSync(exp)) {
    const { nativeImage } = require('electron');
    console.log('export size', JSON.stringify(nativeImage.createFromPath(exp).getSize()));
  }
  const ok = textOk && labelOk && s.n >= 12 && results.some((r) => r.startsWith('finish:copy')) && results.some((r) => r.startsWith('clipboard:#'));
  console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
  app.exit(ok ? 0 : 1);
});
