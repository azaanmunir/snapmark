// Clipboard helpers.
// Electron 45 replaced the old sync clipboard API (writeImage/readImage are gone) with an async W3C-style
// API: clipboard.write([new ClipboardItem({...})]). In 45.2.1, writing 'image/png' is silently dropped
// (main and renderer alike), so we write native pasteboard types instead:
//   macOS   -> raw "public.png" (macOS then also offers TIFF/JPEG/PSD to other apps)
//   Windows -> PowerShell/.NET DataObject with "PNG" + bitmap (Paint/Office need CF_DIB, Figma/Slack/Chrome use PNG),
//              after a fast raw "PNG" write so something is on the clipboard immediately
// If a future Electron brings back writeImage, that is used first.
const electron = require('electron');
const { clipboard, nativeImage, app } = electron;
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAW = (fmt) => `electron application/osclipboard;format="${fmt}"`;

async function writeRaw(format, buf) {
  await clipboard.write([new electron.ClipboardItem({ [RAW(format)]: new Blob([buf], { type: 'image/png' }) })]);
}

const PS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bytes = [IO.File]::ReadAllBytes($env:SNAPMARK_PNG)
$img = [System.Drawing.Image]::FromStream((New-Object IO.MemoryStream(,$bytes)))
$do = New-Object System.Windows.Forms.DataObject
$do.SetImage($img)
$do.SetData('PNG', $false, (New-Object IO.MemoryStream(,$bytes)))
[System.Windows.Forms.Clipboard]::SetDataObject($do, $true)
`;

function writeWindows(buf) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(app.getPath('temp'), `snapmark-clip-${process.pid}-${Date.now()}.png`);
    fs.writeFileSync(tmp, buf);
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded],
      { env: { ...process.env, SNAPMARK_PNG: tmp }, windowsHide: true, timeout: 15000 },
      (err, _out, stderr) => {
        fs.rm(tmp, { force: true }, () => {});
        if (err) reject(new Error(`PowerShell clipboard failed: ${stderr || err.message}`)); else resolve();
      });
  });
}

/** Put a PNG (Buffer) on the system clipboard as an image. */
async function writePng(buf) {
  if (typeof clipboard.writeImage === 'function') { // older/newer Electron with the sync API
    clipboard.writeImage(nativeImage.createFromBuffer(buf));
    return;
  }
  if (process.platform === 'darwin') return writeRaw('public.png', buf);
  if (process.platform === 'win32') {
    try { await writeRaw('PNG', buf); } catch { /* PowerShell below covers it */ }
    return writeWindows(buf);
  }
  return writeRaw('image/png', buf);
}

/** Read an image from the clipboard as a PNG Buffer, or null. */
async function readPng() {
  if (typeof clipboard.readImage === 'function') {
    const img = clipboard.readImage();
    return img.isEmpty() ? null : img.toPNG();
  }
  const items = await clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t === 'image/png' || t === RAW('public.png') || t === RAW('PNG'));
    if (!type) continue;
    const blob = await item.getType(type);
    const buf = Buffer.from(await blob.arrayBuffer());
    if (!nativeImage.createFromBuffer(buf).isEmpty()) return buf;
  }
  return null;
}

function writeText(text) {
  const r = clipboard.writeText(String(text));
  if (r && typeof r.catch === 'function') return r;
  return Promise.resolve();
}

module.exports = { writePng, readPng, writeText };
