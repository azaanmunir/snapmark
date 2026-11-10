// Generates app + tray icons by drawing on a canvas inside a hidden Electron window.
// Run: npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function draw() {
  /* eslint-disable no-undef */
  const out = {};
  const mk = (size) => {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    return [c, c.getContext('2d')];
  };
  // viewfinder corners + center pen dot, drawn in a 0..1 box
  const glyph = (g, s, inset, lw, color) => {
    const a = s * inset, b = s * (1 - inset), L = s * 0.2;
    g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(a, a + L); g.lineTo(a, a); g.lineTo(a + L, a);
    g.moveTo(b - L, a); g.lineTo(b, a); g.lineTo(b, a + L);
    g.moveTo(b, b - L); g.lineTo(b, b); g.lineTo(b - L, b);
    g.moveTo(a + L, b); g.lineTo(a, b); g.lineTo(a, b - L);
    g.stroke();
  };

  // App icon 1024
  {
    const [c, g] = mk(1024);
    const x = 100, w = 824, r = 186;
    const grad = g.createLinearGradient(x, x, x + w, x + w);
    grad.addColorStop(0, '#5E5CE6');
    grad.addColorStop(1, '#FF2D55');
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 40; g.shadowOffsetY = 14;
    g.fillStyle = grad;
    g.beginPath(); g.roundRect(x, x, w, w, r); g.fill();
    g.shadowColor = 'transparent';
    g.save(); g.translate(x, x);
    glyph(g, w, 0.2, 56, '#FFFFFF');
    // cursor arrow in the middle
    g.translate(w * 0.42, w * 0.36); g.scale(w / 70, w / 70);
    g.beginPath();
    [[0, 0], [0, 17], [4.2, 13.2], [7, 19.5], [9.8, 18.3], [7.1, 12.3], [12.6, 12.3]].forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.closePath(); g.fillStyle = '#FFFFFF'; g.fill();
    g.restore();
    out['build/icon.png'] = c.toDataURL('image/png');
  }
  // macOS template tray icons (black + alpha)
  for (const [name, size] of [['assets/trayTemplate.png', 16], ['assets/trayTemplate@2x.png', 32]]) {
    const [c, g] = mk(size);
    glyph(g, size, 0.12, size / 9, '#000');
    g.fillStyle = '#000'; g.beginPath(); g.arc(size / 2, size / 2, size * 0.12, 0, Math.PI * 2); g.fill();
    out[name] = c.toDataURL('image/png');
  }
  // Windows tray icon (colored)
  {
    const size = 32;
    const [c, g] = mk(size);
    const grad = g.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#5E5CE6'); grad.addColorStop(1, '#FF2D55');
    g.fillStyle = grad; g.beginPath(); g.roundRect(1, 1, size - 2, size - 2, 7); g.fill();
    glyph(g, size, 0.24, 2.6, '#fff');
    g.fillStyle = '#fff'; g.beginPath(); g.arc(size / 2, size / 2, 2.6, 0, Math.PI * 2); g.fill();
    out['assets/tray.png'] = c.toDataURL('image/png');
  }
  return out;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const files = await win.webContents.executeJavaScript(`(${draw.toString()})()`);
  for (const [rel, url] of Object.entries(files)) {
    const p = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', rel);
  }
  app.quit();
});
