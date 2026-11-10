# SnapMark progress

Read this first in every new session, and update it before ending one.

## Status (v0.1.0, 2026-11-10)
Working MVP. Overlay, all tools and export pass the headless smoke test (`npm test`). The macOS app is built and
installed to `~/Applications/SnapMark.app`, with DMGs in `dist/`. The Windows NSIS installer and portable .exe are built in
`dist/` but haven't been run on Windows yet. The live capture on real screens still needs the owner's
Screen Recording grant and a hands-on check.

## Done
- [x] Reverse-engineered the installed Lightshot.app (see `docs/LIGHTSHOT_ANALYSIS.md`)
- [x] Checked for 50k+ star screenshot repos: only `abi/screenshot-to-code` (81k), which converts screenshots to code
      and doesn't capture. ShareX (41k) and Flameshot (31k) are below the bar and GPL, so they were used only as UX references and no code was copied.
- [x] Electron app: tray/menu-bar only, single instance, global hotkeys (configurable), launch at login
- [x] Multi-display frozen-screen overlay, Retina-aware (px + pt badge, physical-pixel snapping)
- [x] Selection: drag, click = full screen, ⌘A, Space to move while dragging, Shift square, Alt from center,
      8 handles + edge dragging, arrow nudge, Alt+arrow resize, crosshair guides, pixel loupe with HEX
- [x] Tools: pen, highlighter, line, arrow, rect (radius, fill), ellipse (fill), text (background pill, re-edit by
      double-click), step numbers, cursor pointer (mac / classic / color / click ripple), blur + pixelate,
      spotlight, measure (px · pt · Δx×Δy), eyedropper (HEX / Shift = rgb)
- [x] Shape editing: select, move, recolor, change stroke/size, delete, cut/paste/duplicate; undo/redo
- [x] Resize handles on selected shapes: 8 handles for rect/ellipse/blur/spotlight (Shift keeps the ratio), endpoint
      handles for line/arrow/measure, corner scale handles for text/number/pointer (font size scales)
- [x] Editable text until copy/save: with the Text tool, click a text box to select it, drag to move, click again or
      double-click to edit. Colors, size and background apply live while typing, and ⌘C / ⌘S / ⌘P work while typing
      (⌘C copies the selected text if some is highlighted)
- [x] Labels on step numbers and cursor pointers: the label editor opens on placement ("Add label on click" toggle),
      the label sits on a colored pill ("Label background" toggle), click again to edit, and it moves/scales with the badge
- [x] Separate remembered sizes for text, numbers and pointers
- [x] Actions: copy, cut, save as (PNG/JPG), quick save to folder, pin to screen, close
- [x] Pins: drag, zoom (wheel/pinch/+/-/0), opacity (Alt+wheel), context menu, copy/cut/save
- [x] Tray: capture, 3 s delayed capture, full screen → clipboard, pin clipboard image, open folder, settings
- [x] Settings window: hotkey recorder ×2, save folder, filename pattern, PNG/JPG, native/1× export,
      keep a copy of every capture, launch at login
- [x] Icons generated, macOS DMG (arm64 + x64) and Windows NSIS + portable build scripts

## Next (suggested)
- [ ] Stable code-signing identity (self-signed cert in the login keychain), so a full reinstall keeps the Screen
      Recording grant. For now, `npm run update:mac` swaps only app.asar and keeps the grant.
- [ ] Owner: grant Screen Recording, try real captures on the Mac, list what feels off
- [ ] Try the Windows build on a real Windows PC (hotkeys, multi-monitor DPI, PrintScreen, **⌘C → paste into Paint/Figma**)
- [ ] Rotate handles; resizing for pen/highlighter strokes
- [ ] Window/element snapping on hover (needs native window list: CGWindowList on mac, EnumWindows on Windows)
- [ ] Capture history panel (recent shots in the save folder)
- [ ] Optional: scrolling capture, screen recording → GIF/MP4

## Ideas backlog (designer-oriented)
- Grid / pixel-grid overlay toggle, rulers on the selection edges
- Color palette extraction from the selection (top 5 colors → copy as CSS/Figma tokens)
- Device-frame mockups / background "beautify" (padding, rounded corners, shadow, gradient)
- Callout boxes, curved arrows, blur by brush
- OCR (copy text from screenshot) via macOS Vision / Windows.Media.Ocr
- Export as WebP/AVIF, "copy as file" for Figma drag-drop

## Session log
- **2026-11-10**: Initial build. Ran static RE on Lightshot 2.22, then built the whole app, smoke test, icons and
  packaging. Electron 45.2.1, electron-builder 26.18.0.
- **2026-11-10 (later)**: Owner reported "permission ON but nothing works". The log showed `screen=denied`: the
  ad-hoc signature changes on every rebuild, so the existing TCC entry was stale. Added a log file
  (`~/Library/Logs/SnapMark/main.log`, tray → Show Log File), a Screen Recording status item plus a fix-it dialog in the
  tray menu, and a watchdog so a failed overlay can't leave capture stuck. **Fix for the owner:** remove SnapMark with
  "−" in Screen Recording settings, reopen it, press the hotkey and re-allow it.
  To stop this recurring: sign builds with a stable self-signed certificate (todo), and iterate with `npm start`.
  The removed entry never came back because macOS didn't prompt again. Fixed by adding the app with "+".
  The app now installs to /Applications. Capture confirmed working on the owner's Mac (3420×2224 grab, copy + quick save).
- **2026-11-10 (later)**: Owner asked for type that stays editable until copy/save (drag, resize, recolor,
  ⌘C/⌘S), and for text on step numbers. Added both, plus resize handles for all box/line shapes. Added
  `scripts/build.sh update` (`npm run update:mac`), which keeps the permission. The smoke test covers text + labels.
- **2026-11-10 (later)**: ⌘C failed with "clipboard.writeImage is not a function". Electron 45 removed the sync
  clipboard API, and its new async `image/png` write is a silent no-op. Added `src/main/clip.js` (macOS raw `public.png`;
  Windows PowerShell DataObject with PNG + bitmap) and `npm run test:clipboard`. Copy, quick-save copy, pin
  copy/cut, full-screen copy and paste-as-pin all use it now. **Windows clipboard path is untested on a real PC.**

