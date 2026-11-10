# SnapMark: project guide for Claude

A Lightshot-style screenshot + markup tool for a **designer**, for **macOS and Windows**. Built with Electron
(plain JS, no bundler, no framework). Owner refines it over many sessions, so **always read `PROGRESS.md` first**
and update it at the end of every session.

## Layout
```
src/main/main.js        main process: tray, global hotkeys, capture, overlay windows, pins, save/copy, settings IPC
src/main/settings.js    JSON settings in app.getPath('userData')/settings.json (+ DEFAULTS)
src/main/clip.js        clipboard helpers (Electron 45 workaround, see gotchas)
src/main/preload.js     contextBridge API `window.snap` (only channel list; keep it narrow)
src/renderer/overlay.*  the capture UI (one window per display): selection, loupe, tools, toolbars, export
src/renderer/icons.js   inline SVG icon set (window.ICONS / window.icon())
src/renderer/pin.*      floating pinned screenshot window
src/renderer/settings.* settings window (hotkey recorder, folder, format, export scale, login item)
scripts/make-icons.js   draws build/icon.png + assets/tray*.png (npm run icons)
scripts/smoke-test.js   headless overlay test with synthetic screen + input (npm test)
scripts/build.sh        packaging (output on internal disk, see gotchas)
docs/LIGHTSHOT_ANALYSIS.md  what was recovered from the installed Lightshot.app
```

## Key design facts
* Capture = `desktopCapturer.getSources` thumbnails at physical resolution, taken **before** overlays show.
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
```

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
* No network code. Keep it that way unless the owner asks (privacy for client work).

## Working rules
* Keep the UI dark, compact and precise (designer audience). Tooltips must show the shortcut.
* Run `npm run check && npm test` after changes, and look at the PNGs the smoke test writes.
* Update `PROGRESS.md` (Done / Next / Ideas / Session log) before ending a session.
