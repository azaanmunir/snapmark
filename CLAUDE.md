# SnapMark: project guide for Claude

A Lightshot-style screenshot + markup tool for a **designer**, for **macOS and Windows**. Plain JS pages (no bundler,
no framework) in two shells: **Tauri** (`src-tauri/`, Rust, the shipping app: 2.5 MB installer, Windows done, macOS
still to port) and **Electron** (`src/main/`, the original; kept for macOS until the port and as the test harness). Owner refines it over many sessions, so **always read `PROGRESS.md` first**
and update it at the end of every session.

## Layout
```
src-tauri/src/main.rs   TAURI shell: tray, hotkeys, GDI grab, pre-loaded overlays, WebView2 shared-memory frame hand-off,
                        copy/save/pin, settings window, login item (Rust). settings.rs / updates.rs beside it.
src-tauri/windows/hooks.nsh  installer hook: removes the old Electron install (%LOCALAPPDATA%\Programs\SnapMark)
src/renderer/tauri-bridge.js  Tauri only: provides the same `window.snap` API as preload.js (injected init script)
src/main/main.js        ELECTRON main process: tray, global hotkeys, capture, overlay windows, pins, save/copy, settings IPC
src/main/settings.js    JSON settings in app.getPath('userData')/settings.json (+ DEFAULTS)
src/main/clip.js        clipboard helpers (Electron 45 workaround, see gotchas)
src/main/wingrab.js     Windows fast screen grab: background PowerShell helper doing GDI BitBlt (~70 ms vs ~300 ms)
src/main/updates.js     daily update check against GitHub releases (tray item + notification + Settings toggle)
scripts/after-pack.js   build hook: drops unused Chromium DLLs from the Windows build (smaller app)
src/main/preload.js     contextBridge API `window.snap` (only channel list; keep it narrow)
src/renderer/overlay.*  the capture UI (one window per display): selection, loupe, tools, toolbars, export
src/renderer/icons.js   inline SVG icon set (window.ICONS / window.icon())
src/renderer/pin.*      floating pinned screenshot window
src/renderer/settings.* settings window (hotkey recorder, folder, format, export scale, login item)
scripts/make-icons.js   draws build/icon.png + assets/tray*.png (npm run icons)
scripts/smoke-test.js   headless overlay test with synthetic screen + input (npm test)
scripts/build.sh        packaging (output on internal disk, see gotchas)
scripts/update-cask.sh  after a GitHub release: bump packaging/homebrew/snapmark.rb and push it to azaanmunir/homebrew-tap
scripts/demo-shot.js    regenerates docs/screenshot.png from scripts/demo/mock.html
docs/LIGHTSHOT_ANALYSIS.md  PRIVATE, gitignored: owner's notes on Lightshot's UX (never commit/publish)
```

## Key design facts
* Capture = `desktopCapturer.getSources` thumbnails at physical resolution, taken **before** overlays show. On Windows
  `wingrab.js` grabs first (GDI) and falls back to desktopCapturer if the helper isn't ready or fails.
* Speed: one hidden, pre-loaded overlay window per display waits for the next capture (`spares` in main.js); it is used
  once, destroyed and replaced. Global hotkeys are released while an overlay is open (single-key hotkeys stay typeable).
  The log shows `grabbed gdi … Nms` and `overlay ready … Nms after hotkey` for timing.
  Raw BGRA (`toBitmap`) is sent to the overlay and converted to RGBA there (fast, lossless).
* Overlay coordinates are **DIP/points**; `K = imgW / W` = physical px per point (2 on Retina). Mouse points are
  snapped to the physical pixel grid. Export renders at native pixels (or 1× if `exportScale === '1x'`).
* Annotations are plain JSON objects in `S.annos`; `drawAnnos(ctx, list)` is shared by screen render and export.
  To add a tool: add to `TOOLS`, `OPTS`, `startDraw/updateDraw`, `bbox`, `hit`, `moveAnno`, `drawAnno`, and
  `handleKind` (box | line | scale | none) for resize handles.
* Text, number and pointer are "live" objects: with their own tool active, clicking one selects/drags it and a second
  click edits it. Numbers and pointers have an optional `label` (see `labelInfo`). There is one shared `<textarea>`
  editor: `S.editing = {a, isNew, field?: 'label'}`, and `commitText()` writes it back.
* Sizes are per tool: prefs `fontSize` (text), `numberSize`, `pointerSize` (`SIZEKEY`).
* Undo = JSON snapshots (`pushUndo()` before any mutation).
* Duplicating: Alt+drag a shape (copy made on first move), Ctrl/⌘D, the Duplicate button, or Ctrl/⌘C on a shape the
  user *clicked* (`S.picked`) then Ctrl/⌘V. Shapes that are only auto-selected after placing/typing don't count, so
  Ctrl/⌘C still copies the screenshot in the normal flow. The copied shape is kept in localStorage for the next capture.
* Overlay → main: `snap.finish({action: copy|save|quicksave|pin, png, rect})`.
* Only the drawing prefs (color/width/size/…) are written back to settings from the overlay.

## Commands
```bash
npm start          # run in dev (tray icon appears; hotkey ⌘⇧2 on mac, PrintScreen / Ctrl+Shift+2 on Windows)
npm test           # headless smoke test, writes PNGs to dist/smoke (or pass a dir)
npm run check      # syntax check all JS
npm run icons      # regenerate icons
npm run update:mac # DAY-TO-DAY: rebuild code, swap app.asar in /Applications/SnapMark.app (keeps Screen Recording grant)
npm run dist:mac   # build .dmg (arm64 + x64); updates the installed app's code (FORCE_INSTALL=1 replaces the whole app)
npm run dist:win   # build NSIS installer + portable .exe (x64)
npm run dist:tauri # TAURI build (Windows: NSIS ~2.5 MB; macOS: .app/.dmg once ported) -> ./dist
```

## Tauri port (2026-11-17)
* Pages are shared. Anything the pages call goes through `window.snap`; add it to BOTH preload.js and tauri-bridge.js
  (+ a `#[tauri::command]` in main.rs and `generate_handler!`).
* Frame hand-off: Windows posts the RGBA frame via WebView2 `PostSharedBufferToScript` (0 ms vs ~230 ms through IPC);
  the page gets `rgba: true` and skips its own BGRA->RGBA. Fallback/other OS: `overlay:init` event + `overlay_frame`
  raw-bytes command. Measured: hotkey -> overlay ready ~115 ms (Electron 0.1: ~540 ms).
* **macOS is NOT ported yet**: `grab_monitor` returns None on mac. Needs (on the Mac): ScreenCaptureKit or
  CGDisplayCreateImage grab, Screen Recording permission flow (see Electron main.js), a fast frame transport for
  WKWebView (no shared buffer: try a custom URI scheme), and a `ctx.filter` fallback for the blur tool (Safari < 18).
* Builds: Rust + VS C++ Build Tools on Windows (installed 2026-11-17), Xcode CLT on mac. Cargo target dir is on the
  internal disk (`scripts/build-tauri.sh`). Direct dependencies + the CLI are pinned to releases >= 3 weeks old;
  transitive crates are whatever resolved on 2026-11-17, held by `src-tauri/Cargo.lock` (commit it).
* Same settings.json/log locations as Electron, so users keep their settings when switching.
* Test the real Tauri app end-to-end through WebView2 DevTools: run it with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` and drive pages over CDP (see PROGRESS.md log).

## Gotchas
* The repo lives on an **exFAT** drive. macOS writes `._*` AppleDouble files there; they break asar packaging, so
  `scripts/build.sh` builds into `~/Library/Caches/SnapMark-build` and copies the installers to `./dist`.
* Electron is pinned to **45.2.1** (it is in the local Electron cache; other versions download slowly).
* **Clipboard:** Electron 45 removed `clipboard.writeImage/readImage` (the API is now async `clipboard.write([new
  ClipboardItem(...)])`), and writing `image/png` is silently dropped. Always use `src/main/clip.js`: `writePng`,
  `readPng`, `writeText`. It writes raw `public.png` on macOS and a PowerShell DataObject (PNG + bitmap) on Windows.
  Verify with `npm run test:clipboard` (overwrites your clipboard).
* macOS needs **Screen Recording** permission. The app is ad-hoc signed and the grant is tied to its code hash, so
  **never replace the installed .app** casually: use `npm run update:mac`, which swaps only `Contents/Resources/app.asar`.
  That breaks the bundle seal, which is harmless here. If the grant does break: remove SnapMark with "−" and add
  /Applications/SnapMark.app back with "+" (macOS won't re-prompt on its own). Check status in
  `~/Library/Logs/SnapMark/main.log` (`screen=granted`).
* `npm start` (dev) runs as "Electron", which needs its own Screen Recording grant.
* Windows: Win11 may bind PrintScreen to Snipping Tool (Settings → Accessibility → Keyboard → "Use the Print
  screen key to open screen capture"). Turn that off or use Ctrl+Shift+2.
* Network: the ONLY request is the update check in `src/main/updates.js` (GET GitHub latest release, once a day,
  toggle in Settings; owner asked for it 2026-11-16). Add nothing else unless the owner asks (privacy for client work).

## Working rules
* Keep the UI dark, compact and precise (designer audience). Tooltips must show the shortcut.
* Run `npm run check && npm test` after changes, and look at the PNGs the smoke test writes.
* Update `PROGRESS.md` (Done / Next / Ideas / Session log) before ending a session.
