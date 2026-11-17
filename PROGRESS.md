# SnapMark progress

Read this first in every new session, and update it before ending one.

## Status (v0.2.0 Windows / v0.1.0 Mac, 2026-11-17, public at https://github.com/azaanmunir/snapmark)
Working MVP. Overlay, all tools and export pass the headless smoke test (`npm test`). The macOS app is built and
installed to `~/Applications/SnapMark.app`, with DMGs in `dist/`. The Windows NSIS installer and portable .exe are built in
`dist/` but haven't been run on Windows yet. The live capture on real screens still needs the owner's
Screen Recording grant and a hands-on check.

## Done
- [x] Studied Lightshot's workflow and UX (private notes in `docs/LIGHTSHOT_ANALYSIS.md`, gitignored, never publish)
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
- [x] Duplicate shapes: Alt+drag, Ctrl/⌘D, Duplicate button, Ctrl/⌘C on a clicked shape → Ctrl/⌘V (works across captures)
- [x] Single-key global hotkeys (e.g. ` or F1), with a warning for typing keys; hotkeys are released while capturing
- [x] Update check (daily, GitHub releases → tray item + notification, Settings toggle + "Check now")
- [x] Faster capture: pre-loaded overlay windows, GDI grab on Windows, no Windows open animation (~540 → ~170 ms)
- [x] Smaller Windows build: English-only locales, unused Chromium DLLs dropped, max compression (~-80 MB installed)

## Next (suggested)
- [x] **Released v0.2.0 for Windows** (2026-11-17): Tauri installer `SnapMark_0.2.0_x64-setup.exe` on GitHub
      (Latest). README sends Mac users to v0.1.0. Homebrew cask is still 0.1.0 (don't run update-cask.sh until a
      Mac 0.2.x DMG is attached to a release).
- [ ] **Mac release**: port Tauri to macOS (or build Electron 0.2.x on the Mac), publish e.g. v0.2.1 with DMGs, then
      `scripts/update-cask.sh` and point the README Mac link back to releases/latest. v0.1.0 users have no update
      check, so they must download once by hand (brew users: `brew upgrade --cask snapmark`).
- [ ] Owner: try v0.2.0 on Windows: hotkey → overlay should feel instant; check no flash/animation
- [x] Tauri rebuild for Windows (2026-11-17): 2.5 MB installer, ~115 ms capture start, all features ported
- [ ] **Port the Tauri build to macOS** (on the Mac): native grab + Screen Recording permission + frame transport +
      blur fallback; then `npm run dist:tauri` there. Until then the Mac keeps the Electron build.
- [x] Tauri build installed on the owner's Windows PC (2026-11-17); 0.1.0 removed by the installer hook
- [ ] Owner: use it for a while and list what feels off (Save As, pin menu/opacity, full screen → clipboard, notifications untested by hand)
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
- **2026-11-10**: Initial build. Studied Lightshot 2.22's workflow, then built the whole app, smoke test, icons and
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
- **2026-11-10 (later)**: Open-sourced it as https://github.com/azaanmunir/snapmark (MIT). Added LICENSE, a public
  README with install steps for unsigned apps, a screenshot and package metadata. The private Lightshot notes were
  removed from git history before the first push and stay local only (gitignored). Published release v0.1.0 with the
  macOS DMGs (arm64/x64) and the Windows installer + portable exe.
  The README screenshot is generated by `npm run demo-shot` (a mock billing page reviewed with the real overlay). Fixed
  the measure label covering vertical lines, and a persisted 2× zoom leaking from demo-shot into `npm test`.
  **Releasing next time:** bump `version` in package.json → `npm run dist:mac && npm run dist:win` → commit → `git tag vX.Y.Z`
  → `git push --follow-tags` → `gh release create vX.Y.Z dist/*.dmg dist/*.exe` → `bash scripts/update-cask.sh X.Y.Z`
  (updates the Homebrew cask at github.com/azaanmunir/homebrew-tap) → commit `packaging/homebrew/snapmark.rb`.
- **2026-11-10 (later)**: Smoothed the macOS install before promoting it. Added a Homebrew cask
  (`packaging/homebrew/snapmark.rb`, tap repo `azaanmunir/homebrew-tap`) that clears the quarantine flag after install.
  It was tested by installing into a scratch appdir with Homebrew 7.0.12 (lint, online audit, install, uninstall).
  Homebrew 7 needs `brew trust --tap azaanmunir/tap` once. The README and release notes now give the macOS 15+ path
  (System Settings → Open Anyway; right-click → Open no longer works on Sequoia) plus the `xattr` one-liner.
  The DMG apps have valid ad-hoc signatures, so users get "can't verify", not "damaged". This Mac has Gatekeeper
  disabled, so the actual warning dialog couldn't be reproduced here.
- **2026-11-10 (later)**: Made a 49 s launch reel for Instagram/TikTok in the SevenT3 explainer's motion style
  (per-character rises, words on beats, spring chips, an orbiting chip ring, a floating 3D window). The pipeline is in
  `marketing/reel/` (see its README): `ui-clips.js` drives the real overlay with scripted input and records it frame by frame,
  `render.js` renders `reel.html` offscreen with 4-sub-frame motion blur, and `audio.py` mixes the music edit + SFX.
  The owner's phone footage (IMG_4379.MOV) is used too. The output goes to `dist/reel/SnapMark_Reel_9x16.mp4` and the
  caption to `marketing/reel/CAPTION.md`. Intermediates are in `~/Library/Caches/SnapMark-reel`. The audio was checked
  by analysis only, not by listening. On the owner's request I added a first-person voiceover using the local Kokoro
  model (`vo.py`, voice am_michael at 1.05×, the model comes from the Survival by Math project). Each line sits on the
  bar grid, all 20 lines were checked with whisper-cli, and the music ducks under the speech. The reel is now 50 s.
  The final VO is in the owner's own ElevenLabs voice ("Azaan", a professional clone) via `vo_eleven.py`. The key is in the repo
  root `.env`, which is now in .gitignore. Takes are cached by request hash, so re-runs cost no credits. The full mix
  transcribes word for word.

- **2026-11-16** (Windows PC): Owner asked for (1) copy/paste/duplicate of text and shapes incl. an Alt shortcut,
  (2) one-key hotkeys, (3) updates for existing users, (4) a smaller app, (5) Lightshot-smooth capture start.
  Done: Alt+drag / Ctrl+D / Duplicate button / Ctrl+C on a *clicked* shape + Ctrl+V (auto-selected shapes don't count,
  so annotate → Ctrl+C still copies the screenshot); step numbers get the next number when copied. Hotkey recorder
  accepts a bare key. `updates.js` (only network request; README + CLAUDE.md updated). Capture: spare overlay windows,
  `thickFrame:false`, Uint32 BGRA→RGBA, and `wingrab.js` (persistent PowerShell + GDI BitBlt, falls back to
  desktopCapturer). Measured on this PC (4K @150%): hotkey → overlay 540 ms → ~170 ms (grab 300 → 70 ms, overlay
  185 → ~100 ms). Size: installed 374 → ~291 MB, download ~117 → ~99 MB (estimate; no Windows build run here).
  Tested with a copy of the installed Windows SnapMark 0.1.0 (Electron 45.2.1) as the runtime: `npm test` equivalent
  passes incl. new DUPLICATE test; real captures timed with a harness; GDI image matched desktopCapturer pixel-for-
  pixel visually; settings recorder checked; update check hit GitHub OK. Not tested: macOS (pre-warm path, no
  wingrab there), multi-monitor mixed DPI with GDI, the visual "glitch" fix by eye, the trimmed build itself.
  Version still 0.1.0 in package.json (bump at release).
  Later checks: a bare-key hotkey (Scroll Lock) really registers, is released during capture and comes back after;
  capture after 6 min idle is still ~195 ms. "Pause" is not a valid Electron key (removed from the recorder).
  Memory cost: idle Electron 174 → ~293 MB (the pre-loaded overlay window), plus the PowerShell helper (~60 MB
  private, trimmed to ~1 MB working set after each grab). `electronLanguages: en-US` keeps mac `en.lproj`
  (checked in app-builder-lib). Test runtime trick: copy the installed SnapMark folder, rename the exe to
  electron.exe, delete resources/app.asar and add resources/app/{package.json,shim.js} that requires $SM_ENTRY.
- **2026-11-17** (Windows PC): Owner asked to do the Tauri rebuild. Installed (after Defender scan + checksum/signature
  checks, logged in ~/.claude/library/library.json): VS 2022 Build Tools (C++), Rust 1.100 (rustup), Tauri CLI 2.12.4.
  Spike first (grab + pre-loaded overlay): IPC hand-off of the 33 MB frame took ~230 ms, so switched to WebView2 shared
  buffers -> ~115 ms hotkey-to-overlay (Electron 0.2.0: ~170 ms, 0.1.0: ~540 ms). Then ported everything to
  `src-tauri/src/main.rs`: tray menu, hotkeys (Electron accelerator strings converted), released during capture,
  copy (arboard: PNG + DIB formats), save dialog, quick save, JPG, pins (zoom/move/opacity/menu/copy/save), full
  screen -> clipboard, pin from clipboard, settings window (same page), login item, single instance (`--capture`,
  `--settings`), update check (ureq), watchdog, log file. NSIS hook removes the Electron install.
  Sizes: installer 2.5 MB (Electron 121 MB), app exe 7.4 MB. Idle memory ~160 MB private (WebView2 is Chromium too, so
  RAM is about the same as Electron with the pre-loaded window; the win is download/disk).
  Tested end to end over WebView2 DevTools (CDP script in the session scratchpad): capture, Ctrl+C (clipboard had
  900x600 image with PNG+DIB formats), arrow + Ctrl+Shift+S quick save (file checked by eye), Ctrl+P pin (image shown,
  Ctrl+C copies, = zooms, Shift+arrow moves, Esc closes), cancel + recapture, --settings, version label, one-key
  hotkey F9 saved: 13/13 pass. Real OS hotkey (Alt+` via keybd_event) after 6 min idle: overlay ready in 141 ms and
  it is the foreground window with document focus; hotkeys come back after cancel. Rust update check ran (log line).
  Security: Defender scanned ~/.cargo and ~/.rustup (clean); OSV on all 555 Cargo.lock crates: only 5 hits, all
  Linux-only crates (glib, zbus/zvariant, proc-macro-error) that aren't in the Windows or macOS builds.
  Electron smoke test still passes with the shared page changes.
  NOT tested: the installer itself (it removes the owner's installed 0.1.0; waiting for OK; rollback = dist/SnapMark
  Setup 0.1.0.exe), Save As dialog, folder chooser, pin right-click menu + opacity, full screen -> clipboard,
  clipboard -> pin, launch at login, notifications, tray clicks by hand, multi-monitor, macOS (not ported).
  `package-lock.json` doesn't list the new `@tauri-apps/cli` devDependency yet: run `npm install` on the Mac
  (not on this PC: the shared node_modules holds the Mac Electron binary).
- **2026-11-17 (later)**: Owner said install it. Ran the Tauri NSIS installer silently (`/S`): exit 0, the hook removed
  Electron 0.1.0 (folder + uninstall key gone), new app in %LOCALAPPDATA%\SnapMark (Start menu shortcut, uninstall entry
  "SnapMark 0.2.0"), settings.json kept. Started it: hotkeys Alt+` and Ctrl+Shift+2 registered; a real Alt+` opened
  the capture screen in 131 ms and Esc closed it. Rollback: dist/SnapMark Setup 0.1.0.exe. Still nothing committed.
- **2026-11-17 (release)**: Committed the Tauri work (513f266), pushed, and published GitHub release v0.2.0
  (Windows only, 2.5 MB installer, SHA-256 026d34dc…ebc5, re-downloaded and verified). Rebuilt the installer first
  because hooks.nsh had changed after the earlier build. README updated: Windows → new installer, Mac → v0.1.0.
  `npm run check` fails under cmd.exe on Windows (bash `for` loop); run the loop in Git Bash instead.
