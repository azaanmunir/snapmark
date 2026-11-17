#!/usr/bin/env bash
# Build the Tauri version of SnapMark (the small one). Output: installers copied into ./dist
#   Windows: NSIS installer (~2 MB)    macOS: .app + .dmg
# Needs Rust (rustup) and, on Windows, the Visual Studio C++ Build Tools; on macOS, Xcode command line tools.
# Cargo builds on the internal disk because the repo lives on an exFAT drive (see CLAUDE.md).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
if [ "$(uname -s)" = "Darwin" ]; then
  export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/Library/Caches/SnapMark-build/tauri-target}"
  BUNDLES="app,dmg"
else
  export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$LOCALAPPDATA/SnapMark-build/tauri-target}"
  BUNDLES="nsis"
fi
# Tauri CLI: project devDependency if installed, else the copy in the owner's tool library
TAURI="node_modules/.bin/tauri"
[ -x "$TAURI" ] || TAURI="$HOME/.claude/library/repos/tauri-cli/node_modules/.bin/tauri"
"$TAURI" build --bundles "$BUNDLES" "$@"
mkdir -p dist
cp "$CARGO_TARGET_DIR"/release/bundle/nsis/*.exe dist/ 2>/dev/null || true
cp "$CARGO_TARGET_DIR"/release/bundle/dmg/*.dmg dist/ 2>/dev/null || true
ls -la dist | grep -Ei "setup|\.dmg" || true
