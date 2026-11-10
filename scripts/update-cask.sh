#!/usr/bin/env bash
# After publishing GitHub release vX.Y.Z, update the Homebrew cask (packaging/homebrew/snapmark.rb)
# with the new version + DMG checksums and push it to github.com/azaanmunir/homebrew-tap.
# Usage: bash scripts/update-cask.sh 0.2.0
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:?usage: update-cask.sh X.Y.Z}"
digest() { gh release view "v$V" --repo azaanmunir/snapmark --json assets \
  --jq ".assets[] | select(.name == \"$1\") | .digest" | sed 's/^sha256://'; }
ARM="$(digest "SnapMark-$V-arm64.dmg")"; INTEL="$(digest "SnapMark-$V.dmg")"
[ -n "$ARM" ] && [ -n "$INTEL" ] || { echo "release v$V is missing a DMG"; exit 1; }
CASK=packaging/homebrew/snapmark.rb
sed -i '' -E "s/^  version \".*\"/  version \"$V\"/; s/(sha256 arm: +)\"[0-9a-f]+\"/\1\"$ARM\"/; s/(intel: +)\"[0-9a-f]+\"/\1\"$INTEL\"/" "$CASK"
TMP="$(mktemp -d)"
git clone -q https://github.com/azaanmunir/homebrew-tap.git "$TMP"
cp "$CASK" "$TMP/Casks/snapmark.rb"
git -C "$TMP" commit -qam "snapmark $V" && git -C "$TMP" push -q
rm -rf "$TMP"
echo "Cask updated to $V (arm $ARM, intel $INTEL). Commit $CASK in this repo too."
