#!/usr/bin/env bash
# Build installers. Output goes to the internal disk because the project lives on an
# exFAT drive, whose "._*" metadata files break asar packaging/codesigning.
#   bash scripts/build.sh mac   -> SnapMark.app + .dmg (arm64 + x64), installs app to /Applications (or ~/Applications)
#   bash scripts/build.sh win   -> NSIS installer + portable .exe (x64)
#   bash scripts/build.sh update -> rebuild only the app code and swap app.asar inside the installed
#                                  /Applications/SnapMark.app. The signed app shell is untouched, so the
#                                  macOS Screen Recording permission survives (use this for day-to-day updates).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${SNAPMARK_OUT:-$HOME/Library/Caches/SnapMark-build}"
case "${1:-mac}" in
  mac)
    npx electron-builder --mac -c.directories.output="$OUT"
    APP="$OUT/mac-arm64/SnapMark.app"
    [ "$(uname -m)" = "x86_64" ] && APP="$OUT/mac/SnapMark.app"
    DEST="/Applications"
    [ -w "$DEST" ] || DEST="$HOME/Applications"
    if [ -d "$DEST/SnapMark.app" ] && [ "${FORCE_INSTALL:-0}" != "1" ]; then
      # replacing the signed app resets macOS Screen Recording permission; swap only the code instead
      pkill -f "SnapMark.app/Contents/MacOS/SnapMark" || true; sleep 1
      cp "$APP/Contents/Resources/app.asar" "$DEST/SnapMark.app/Contents/Resources/app.asar"
      echo "Updated code in existing $DEST/SnapMark.app (FORCE_INSTALL=1 to replace the whole app)"
      open "$DEST/SnapMark.app"
    else
      mkdir -p "$DEST"
      rm -rf "$DEST/SnapMark.app"
      ditto "$APP" "$DEST/SnapMark.app"
      echo "Installed: $DEST/SnapMark.app"
    fi
    ;;
  win)
    npx electron-builder --win --x64 -c.directories.output="$OUT"
    ;;
  update)
    DEST="/Applications/SnapMark.app"
    [ -d "$DEST" ] || DEST="$HOME/Applications/SnapMark.app"
    [ -d "$DEST" ] || { echo "SnapMark.app not installed; run: bash scripts/build.sh mac"; exit 1; }
    ARCH=arm64; [ "$(uname -m)" = "x86_64" ] && ARCH=x64
    npx electron-builder --mac dir --$ARCH -c.directories.output="$OUT"
    SRC="$OUT/mac-arm64/SnapMark.app"; [ "$ARCH" = "x64" ] && SRC="$OUT/mac/SnapMark.app"
    pkill -f "SnapMark.app/Contents/MacOS/SnapMark" || true
    sleep 1
    cp "$SRC/Contents/Resources/app.asar" "$DEST/Contents/Resources/app.asar"
    echo "Updated app code in $DEST (permissions kept)"
    open "$DEST"
    exit 0
    ;;
esac
mkdir -p dist
cp "$OUT"/*.dmg "$OUT"/*.exe dist/ 2>/dev/null || true
echo "Installers copied to ./dist (from $OUT)"
