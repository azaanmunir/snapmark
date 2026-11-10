// Round-trips a PNG through the real system clipboard using src/main/clip.js.
// NOTE: overwrites your clipboard. Run: npm run test:clipboard
const { app, nativeImage } = require('electron');
const path = require('path');
const clip = require('../src/main/clip');

app.whenReady().then(async () => {
  let ok = false;
  try {
    const png = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).toPNG();
    await clip.writePng(png);
    const back = await clip.readPng();
    const size = back && nativeImage.createFromBuffer(back).getSize();
    console.log('read back', JSON.stringify(size));
    ok = !!size && size.width === 1024 && size.height === 1024;
  } catch (e) {
    console.log('ERROR', e.stack || e);
  }
  console.log(ok ? 'CLIPBOARD OK' : 'CLIPBOARD FAILED');
  app.exit(ok ? 0 : 1);
});
