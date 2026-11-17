// Update check: once a day, asks GitHub whether a newer release exists and offers the download.
// SnapMark's only network request; sends nothing about the user. Can be turned off in Settings.
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const REPO: &str = "azaanmunir/snapmark";
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
static AVAILABLE: Mutex<Option<(String, String)>> = Mutex::new(None); // (version, url)

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

/// "1.2.10" > "1.2.9"; pre-release suffixes ignored
pub fn newer(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> Vec<u64> {
        s.trim_start_matches('v').split('-').next().unwrap_or("").split('.').map(|x| x.parse().unwrap_or(0)).collect()
    };
    let (pa, pb) = (parse(a), parse(b));
    for i in 0..3 {
        let (x, y) = (pa.get(i).copied().unwrap_or(0), pb.get(i).copied().unwrap_or(0));
        if x != y { return x > y; }
    }
    false
}

pub fn state() -> Option<(String, String)> { AVAILABLE.lock().unwrap().clone() }

fn fetch_latest() -> Result<Value, String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let mut res = ureq::get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SnapMark-update-check")
        .call()
        .map_err(|e| e.to_string())?;
    res.body_mut().read_json::<Value>().map_err(|e| e.to_string())
}

/// Returns Some(version) when an update exists. `manual` shows "up to date" / errors in a dialog.
pub fn check(app: &AppHandle, manual: bool) -> Option<String> {
    let current = app.package_info().version.to_string();
    match fetch_latest() {
        Ok(rel) => {
            crate::settings::save(&json!({ "lastUpdateCheck": now_ms() }));
            let tag = rel.get("tag_name").and_then(|v| v.as_str()).unwrap_or("");
            let draft = rel.get("draft").and_then(|v| v.as_bool()).unwrap_or(false) || rel.get("prerelease").and_then(|v| v.as_bool()).unwrap_or(false);
            let version = tag.trim_start_matches('v').to_string();
            crate::log(&format!("update check current={current} latest={version}"));
            if draft || version.is_empty() || !newer(&version, &current) {
                *AVAILABLE.lock().unwrap() = None;
                crate::refresh_tray(app);
                if manual { crate::message(app, "SnapMark is up to date", &format!("You have the latest version ({current})."), None); }
                return None;
            }
            let url = rel.get("html_url").and_then(|v| v.as_str()).filter(|u| u.starts_with("https://github.com/"))
                .map(String::from).unwrap_or_else(|| format!("https://github.com/{REPO}/releases/latest"));
            *AVAILABLE.lock().unwrap() = Some((version.clone(), url.clone()));
            crate::settings::save(&json!({ "latestVersion": version, "latestUrl": url }));
            crate::refresh_tray(app);
            if manual { offer(app); }
            else if crate::settings::str("notifiedVersion") != version {
                crate::settings::save(&json!({ "notifiedVersion": version }));
                crate::notify(app, &format!("SnapMark {version} is available"), "Open the SnapMark menu to download it.");
            }
            Some(version)
        }
        Err(e) => {
            crate::log(&format!("update check failed: {e}"));
            if manual { crate::message(app, "Couldn’t check for updates", "Check your internet connection and try again.", None); }
            None
        }
    }
}

pub fn offer(app: &AppHandle) {
    let Some((version, url)) = state() else { return };
    let current = app.package_info().version.to_string();
    let how = if cfg!(target_os = "macos") {
        "Download the new .dmg and drag SnapMark into Applications (replace the old one).\nInstalled with Homebrew? Run: brew upgrade --cask snapmark"
    } else {
        "Download “SnapMark Setup” and run it. It installs over the old version and keeps your settings."
    };
    if crate::message(app, &format!("SnapMark {version} is available"), &format!("You have {current}.\n\n{how}"), Some(("Download", "Later"))) {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

pub fn init(app: &AppHandle) {
    let s = crate::settings::load();
    if let Some(v) = s.get("latestVersion").and_then(|v| v.as_str()) {
        if newer(v, &app.package_info().version.to_string()) {
            let url = s.get("latestUrl").and_then(|v| v.as_str()).unwrap_or("").to_string();
            *AVAILABLE.lock().unwrap() = Some((v.to_string(), url));
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20)); // keep startup quiet
        loop {
            let s = crate::settings::load();
            let enabled = s.get("checkUpdates").and_then(|v| v.as_bool()).unwrap_or(true);
            let last = s.get("lastUpdateCheck").and_then(|v| v.as_u64()).unwrap_or(0);
            if enabled && now_ms().saturating_sub(last) > DAY_MS { check(&app, false); }
            std::thread::sleep(Duration::from_secs(3 * 60 * 60));
        }
    });
}
