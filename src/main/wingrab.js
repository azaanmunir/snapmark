// Fast screen grab on Windows (~70 ms for 4K instead of ~300 ms with Electron's desktopCapturer).
// A small PowerShell helper stays running in the background with a GDI BitBlt routine compiled in, the same
// method Lightshot uses. Each request sends "x y w h" (physical pixels) on stdin and gets raw BGRA rows back on
// stdout. If the helper is missing, slow or broken, grab() returns null and main.js falls back to desktopCapturer.
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class SnapMarkGrab {
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d, int x, int y, int w, int h, IntPtr s, int sx, int sy, uint rop);
  [StructLayout(LayoutKind.Sequential)] struct BMIH { public int size, w, h; public short planes, bits; public int comp, img, xp, yp, used, imp; }
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BMIH bmi, uint usage, out IntPtr bits, IntPtr sec, uint off);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("psapi.dll")] static extern bool EmptyWorkingSet(IntPtr p);
  // give idle memory back to Windows (the compiler that built this class is no longer needed)
  public static void Trim() { GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect(); EmptyWorkingSet(GetCurrentProcess()); }
  public static void Grab(int x, int y, int w, int h, Stream outp) {
    SetThreadDpiAwarenessContext(new IntPtr(-4)); // per-monitor aware: physical pixels on every display
    IntPtr scr = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(scr);
    BMIH bi = new BMIH(); bi.size = 40; bi.w = w; bi.h = -h; bi.planes = 1; bi.bits = 32;
    IntPtr bits; IntPtr dib = CreateDIBSection(scr, ref bi, 0, out bits, IntPtr.Zero, 0);
    IntPtr old = SelectObject(mem, dib);
    bool ok = BitBlt(mem, 0, 0, w, h, scr, x, y, 0x00CC0020 | 0x40000000); // SRCCOPY | CAPTUREBLT
    byte[] row = new byte[w * 4];
    for (int r = 0; r < h; r++) {
      if (ok) Marshal.Copy(new IntPtr(bits.ToInt64() + (long)r * w * 4), row, 0, row.Length);
      outp.Write(row, 0, row.Length);
    }
    outp.Flush();
    SelectObject(mem, old); DeleteObject(dib); DeleteDC(mem); ReleaseDC(IntPtr.Zero, scr);
    if (!ok) throw new Exception("BitBlt failed");
  }
}
'@
$out = [Console]::OpenStandardOutput()
[SnapMarkGrab]::Trim()
[Console]::Error.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ')
  try { [SnapMarkGrab]::Grab([int]$p[0], [int]$p[1], [int]$p[2], [int]$p[3], $out) } catch { [Console]::Error.WriteLine("error $_") }
  [SnapMarkGrab]::Trim()
}
`;

let proc = null;
let ready = false;
let failures = 0;
let pending = null; // { need, chunks, got, resolve, timer }
let log = () => {};

function start(logger) {
  if (process.platform !== 'win32' || proc || failures >= 5) return; // after 5 failures: desktopCapturer only
  if (logger) log = logger;
  try {
    const file = path.join(app.getPath('userData'), 'grab-helper.ps1');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== SCRIPT) fs.writeFileSync(file, SCRIPT);
    const t0 = Date.now();
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    proc.stderr.on('data', (d) => {
      const s = String(d).trim();
      if (/^ready/m.test(s)) { ready = true; log('grab helper ready', `${Date.now() - t0}ms`); } else log('grab helper', s.slice(0, 300));
    });
    proc.stdout.on('data', (d) => {
      const p = pending;
      if (!p) return;
      p.chunks.push(d);
      p.got += d.length;
      if (p.got >= p.need) { pending = null; clearTimeout(p.timer); p.resolve(Buffer.concat(p.chunks, p.got).subarray(0, p.need)); }
    });
    proc.on('exit', (code) => {
      log('grab helper exited', code);
      proc = null;
      ready = false;
      if (pending) { clearTimeout(pending.timer); pending.resolve(null); pending = null; }
    });
    proc.on('error', (e) => { log('grab helper error', String(e)); failures++; });
  } catch (e) {
    log('grab helper start failed', String(e));
    failures++;
    proc = null;
  }
}

function fail(why) {
  failures++;
  log('grab helper failed:', why);
  if (proc) { try { proc.kill(); } catch { /* ignore */ } }
  proc = null;
  ready = false;
}

// Physical-pixel rect -> raw BGRA Buffer, or null (caller falls back)
function grabRect(x, y, w, h) {
  if (!ready || !proc || pending) return Promise.resolve(null);
  return new Promise((resolve) => {
    pending = {
      need: w * h * 4, chunks: [], got: 0, resolve,
      timer: setTimeout(() => { pending = null; fail('timeout'); resolve(null); }, 2000),
    };
    proc.stdin.write(`${x} ${y} ${w} ${h}\n`);
  });
}

function stop() {
  if (proc) { try { proc.stdin.end(); proc.kill(); } catch { /* ignore */ } }
  proc = null;
  ready = false;
}

module.exports = { start, grabRect, stop, isReady: () => ready };
