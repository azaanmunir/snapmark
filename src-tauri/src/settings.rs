// Settings: the same settings.json the Electron build used (%APPDATA%\SnapMark on Windows,
// ~/Library/Application Support/SnapMark on macOS), so existing users keep their hotkeys and folders.
// Kept as a JSON object so unknown keys survive.
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;

static CACHE: Mutex<Option<Map<String, Value>>> = Mutex::new(None);
static PICTURES: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn app_dir() -> PathBuf {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support")).unwrap_or_else(std::env::temp_dir);
    #[cfg(not(any(windows, target_os = "macos")))]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")).unwrap_or_else(std::env::temp_dir);
    base.join("SnapMark")
}

pub fn file() -> PathBuf { app_dir().join("settings.json") }

pub fn log_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    if let Some(h) = std::env::var_os("HOME") { return PathBuf::from(h).join("Library/Logs/SnapMark"); }
    app_dir().join("logs")
}

/// Call once at startup with the user's Pictures folder (OneDrive-aware on Windows).
pub fn set_pictures(p: Option<PathBuf>) { *PICTURES.lock().unwrap() = p; }

fn defaults() -> Map<String, Value> {
    let mac = cfg!(target_os = "macos");
    let pictures = PICTURES.lock().unwrap().clone().or_else(|| std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(|h| PathBuf::from(h).join("Pictures")));
    let save_dir = pictures.unwrap_or_else(std::env::temp_dir).join("SnapMark");
    let v = json!({
        // Lightshot uses PrintScreen on Windows; macOS reserves Cmd+Shift+3/4/5, so we use Cmd+Shift+2.
        "hotkey": if mac { "Command+Shift+2" } else { "PrintScreen" },
        "altHotkey": if mac { "" } else { "Control+Shift+2" },
        "saveDir": save_dir.to_string_lossy(),
        "filenamePattern": "Screenshot {YYYY}-{MM}-{DD} at {HH}.{mm}.{ss}",
        "format": "png",
        "jpgQuality": 92,
        "exportScale": "native",
        "autoSaveCopy": false,
        "launchAtLogin": false,
        "checkUpdates": true,
        "color": "#FF3B30", "width": 4, "fontSize": 20, "numberSize": 20, "pointerSize": 22, "radius": 6,
        "fill": false, "blurStyle": "pixelate", "pointerStyle": "mac", "labelBg": true, "autoLabel": true,
        "customColors": [],
    });
    v.as_object().cloned().unwrap_or_default()
}

pub fn load() -> Map<String, Value> {
    let mut c = CACHE.lock().unwrap();
    if c.is_none() {
        let mut m = defaults();
        if let Ok(txt) = std::fs::read_to_string(file()) {
            if let Ok(Value::Object(saved)) = serde_json::from_str::<Value>(&txt) {
                for (k, v) in saved { m.insert(k, v); }
            }
        }
        *c = Some(m);
    }
    c.clone().unwrap()
}

pub fn save(patch: &Value) -> Map<String, Value> {
    let mut m = load();
    if let Value::Object(p) = patch { for (k, v) in p { m.insert(k.clone(), v.clone()); } }
    let _ = std::fs::create_dir_all(app_dir());
    if let Ok(txt) = serde_json::to_string_pretty(&m) { let _ = std::fs::write(file(), txt); }
    *CACHE.lock().unwrap() = Some(m.clone());
    m
}

pub fn str(key: &str) -> String { load().get(key).and_then(|v| v.as_str()).unwrap_or("").to_string() }
pub fn bool(key: &str) -> bool { load().get(key).and_then(|v| v.as_bool()).unwrap_or(false) }
pub fn num(key: &str, def: f64) -> f64 { load().get(key).and_then(|v| v.as_f64()).unwrap_or(def) }
