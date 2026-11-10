cask "snapmark" do
  arch arm: "-arm64"

  version "0.1.0"
  sha256 arm:   "65422eb189b67102b25b8a7447055590b4028559a5e7febd21464c3b6a0aa792",
         intel: "c55a227e0b74b095f9bc69397959f9bc3040ae133b8fc69dba8344ebd70228ec"

  url "https://github.com/azaanmunir/snapmark/releases/download/v#{version}/SnapMark-#{version}#{arch}.dmg"
  name "SnapMark"
  desc "Screenshot and markup tool for designers"
  homepage "https://github.com/azaanmunir/snapmark"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :ventura

  app "SnapMark.app"

  # SnapMark is open source but not notarized (no paid Apple Developer ID yet).
  # Clearing the quarantine flag lets it open without the Gatekeeper "can't verify" prompt.
  postflight_steps do
    run "/usr/bin/xattr",
        args:           ["-dr", "com.apple.quarantine", "{{appdir}}/SnapMark.app"],
        writable_paths: ["SnapMark.app"],
        writable_base:  :appdir
  end

  uninstall quit: "com.azaan.snapmark"

  zap trash: [
    "~/Library/Application Support/SnapMark",
    "~/Library/Logs/SnapMark",
    "~/Library/Preferences/com.azaan.snapmark.plist",
    "~/Library/Saved Application State/com.azaan.snapmark.savedState",
  ]

  caveats <<~EOS
    SnapMark needs Screen Recording permission:
      System Settings → Privacy & Security → Screen & System Audio Recording → enable SnapMark
    If SnapMark is not listed, click "+" and add it from /Applications, then reopen SnapMark.
    Capture with ⌘⇧2.
  EOS
end
