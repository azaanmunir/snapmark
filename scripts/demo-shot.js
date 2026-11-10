// Renders the README screenshot: a mock billing page (scripts/demo/mock.html) marked up as a design review
// inside the real SnapMark overlay. Output: docs/screenshot.png (2x).
// Run: npm run demo-shot
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const W = 1280, H = 800, K = 2;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshot.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function offscreen(file, hash) {
  const win = new BrowserWindow({
    width: W * K, height: H * K, show: false, useContentSize: true,
    webPreferences: { offscreen: true, zoomFactor: K, preload: path.join(ROOT, 'src', 'main', 'preload.js'), sandbox: true, contextIsolation: true },
  });
  win.webContents.setFrameRate(30);
  await win.loadFile(file, hash ? { hash } : undefined);
  win.webContents.setZoomFactor(K); // CSS viewport W x H at 2x pixels (Chromium remembers this per origin)
  await sleep(300);
  return win;
}

app.whenReady().then(async () => {
  for (const ch of ['overlay:ready', 'overlay:prefs', 'clipboard:text', 'overlay:cancel']) ipcMain.on(ch, () => {});

  // 1) "screen": the mock app
  const mock = await offscreen(path.join(__dirname, 'demo', 'mock.html'));
  const rects = await mock.webContents.executeJavaScript(`(() => {
    const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    return { card: r('card'), inner: r('cardInner'), typo: r('typo'), h1: r('h1t'), win: r('win'), helper: r('helper'), email: r('email'), cta: r('cta'), upgrade: r('upgrade'), side: r('side') };
  })()`);
  const screen = await mock.webContents.capturePage();
  const size = screen.getSize();
  if (size.width !== W * K) throw new Error(`unexpected mock size ${JSON.stringify(size)}`);

  // 2) the real overlay, fed with that screen
  const ov = await offscreen(path.join(ROOT, 'src', 'renderer', 'overlay.html'), 'test');
  ov.webContents.send('overlay:init', {
    displayId: 1, width: W, height: H, scaleFactor: K, imgW: size.width, imgH: size.height, bitmap: screen.toBitmap(),
    cursor: null, platform: 'darwin',
    settings: { color: '#FF3B30', width: 4, fontSize: 20, numberSize: 20, pointerSize: 24, radius: 8, fill: false,
      blurStyle: 'pixelate', pointerStyle: 'click', labelBg: true, autoLabel: true, customColors: [], exportScale: 'native' },
  });
  await sleep(500);

  const { card, inner, typo, h1, helper, email, cta, upgrade, side, win } = rects;
  const RED = '#FF3B30';
  let id = 1000;
  const n = (x, y, num, label) => ({ id: id++, type: 'number', x, y, n: num, size: 20, color: RED, labelBg: true, label });
  const mx = inner.x + 240; // empty strip between "Pro plan" and the price
  const annos = [
    // 1 · typo in the page title
    { id: id++, type: 'marker', color: '#FFCC00', width: 8, pts: [[typo.x - 2, typo.y + typo.h * 0.58], [typo.x + typo.w + 2, typo.y + typo.h * 0.58]] },
    n(h1.x + h1.w + 24, h1.y + h1.h / 2, 1, 'Typo: “Billing”'),
    // 2 · card padding is 16 instead of 24, measured
    { id: id++, type: 'measure', color: RED, width: 2, x1: mx, y1: card.y + 1, x2: mx, y2: inner.y },
    n(mx + 78, card.y - 1, 2, 'Card padding 16 → 24'),
    // 3 · helper text contrast (arrow from the empty space in the Team card)
    { id: id++, type: 'arrow', color: RED, width: 4, x1: side.x + 8, y1: side.y + side.h - 62, x2: helper.x + helper.w + 10, y2: helper.y + helper.h / 2 + 2 },
    n(side.x + 22, side.y + side.h - 62, 3, 'Contrast 1.6:1 · fails AA'),
    // privacy: blur personal data before sharing
    { id: id++, type: 'blur', style: 'pixelate', width: 4, color: RED, x: email.x - 4, y: email.y - 3, w: email.w + 8, h: email.h + 6 },
    // 4 · misaligned primary button
    { id: id++, type: 'rect', color: RED, width: 3, radius: 10, fill: false, x: cta.x - 7, y: cta.y - 14, w: cta.w + 14, h: cta.h + 21 },
    n(cta.x + cta.w + 22, cta.y + cta.h / 2 - 4, 4, 'Baseline off by 7px'),
    // 5 · the real primary action
    { id: id++, type: 'pointer', style: 'click', color: '#0A84FF', size: 26, labelBg: true, x: upgrade.x + upgrade.w * 0.3, y: upgrade.y + upgrade.h * 0.5, label: 'Should be primary' },
    // header note in the empty right side of the title bar
    { id: id++, type: 'text', color: '#1C1C1E', size: 13, fill: true, x: win.x + win.w - 196, y: win.y + 12, text: 'Billing · design review' },
  ];
  await ov.webContents.executeJavaScript(`(() => {
    __S.annos = ${JSON.stringify(annos)};
    __S.sel = { x: 150, y: 58, w: 1000, h: 668 };
    __S.phase = 'edit';
    __S.tool = 'number';
    __S.selectedId = null;
    __S.mouse = { x: -1, y: -1 };
    __T.refresh();
  })()`);
  await sleep(400);
  const img = await ov.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log('wrote', OUT, JSON.stringify(img.getSize()));
  ov.webContents.setZoomFactor(1); // don't leave a persisted 2x zoom for file:// pages (breaks npm test)
  mock.webContents.setZoomFactor(1);
  await sleep(200);
  app.exit(0);
});
