# SnapMark

A Lightshot-style screenshot and markup tool for designers, for macOS and Windows. It runs from the tray or menu bar, works offline and uploads nothing.

## Install
* **macOS:** open `dist/SnapMark-0.1.0-arm64.dmg` (Apple Silicon) or `dist/SnapMark-0.1.0.dmg` (Intel) and drag SnapMark to Applications.
  On first capture, allow **Screen Recording** in System Settings → Privacy & Security, then relaunch.
* **Windows:** run `dist/SnapMark Setup 0.1.0.exe`, or use the portable `dist/SnapMark 0.1.0.exe`.

## Use
| | macOS | Windows |
|---|---|---|
| Capture | ⌘⇧2 | PrintScreen or Ctrl+Shift+2 |
| Copy & close | ⌘C / Enter / double-click | Ctrl+C / Enter / double-click |
| Save as… / quick save | ⌘S / ⇧⌘S | Ctrl+S / Ctrl+Shift+S |
| Pin on screen | ⌘P | Ctrl+P |
| Cut shape / paste / duplicate | ⌘X / ⌘V / ⌘D | Ctrl+X / Ctrl+V / Ctrl+D |
| Undo / redo | ⌘Z / ⇧⌘Z | Ctrl+Z / Ctrl+Y |
| Cancel | Esc | Esc |

**Tools:** V move, P pen, M highlighter, L line, A arrow, R rectangle, E ellipse, T text, N step number,
U cursor pointer, B blur/pixelate, F spotlight, D measure, I color picker, C copies the HEX under the cursor
(Shift+C copies rgb()).

**While selecting:** Shift makes a square, Alt draws from the center, holding Space moves the selection, and a click selects the full screen.
Arrow keys nudge by 1 px (Shift for 10 px). Alt+arrows resize. Clicking a shape with the move tool selects it so you can drag it, recolor it or press Delete.

**Editable text and labels:** everything you draw stays editable until you copy or save. With the Text (T), Step number (N)
or Pointer (U) tool, click an existing item to select it, drag to move it, and click again to edit its text. Drag a corner
handle to resize it. Color, size and background changes apply to the selected item, or live while you're typing. Step numbers
and pointers open a label as soon as you place them; turn this off with "Add label on click". ⌘/Ctrl+C, S and P
work while you're typing.

**Pins:** drag to move, scroll or pinch to zoom, Alt+scroll changes opacity, double-click resets to 100%, right-click opens a menu,
⌘/Ctrl+C copies, ⌘/Ctrl+X cuts (copies and closes), and Esc closes.

## Develop
```bash
npm install
npm start
npm test
```
See `CLAUDE.md` and `PROGRESS.md`.
