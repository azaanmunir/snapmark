// SnapMark — Tauri shell. Tray app: global hotkey -> native screen grab -> pre-loaded overlay per display
// -> copy / save / pin. The pages in src/renderer are shared with the Electron build (kept as a dev/test tool);
// tauri-bridge.js gives them the same `window.snap` API that Electron's preload gives them.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod settings;
mod updates;

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use image::ImageEncoder;
use serde_json::{json, Value};
use tauri::image::Image;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const BRIDGE: &str = include_str!("../../src/renderer/tauri-bridge.js");
const IS_MAC: bool = cfg!(target_os = "macos");

// ---------------------------------------------------------------- state
struct Shot { rgba: Vec<u8> }

#[derive(Clone, Copy)]
struct Geo { x: i32, y: i32, scale: f64 } // overlay's monitor origin (physical px) and scale

struct Pin { png: Vec<u8>, w: f64, h: f64, zoom: f64, scale: f64 }

#[derive(Default)]
struct State {
    capturing: bool,
    t0: Option<Instant>,
    shots: HashMap<String, Shot>,     // overlay label -> frozen screen (RGBA), until handed to the page
    pending: HashMap<String, Value>,  // overlay label -> init payload waiting for the page to load
    loaded: HashSet<String>,          // overlay pages that are listening
    overlays: Vec<String>,            // overlays of the current capture
    geo: HashMap<String, Geo>,
    spares: HashMap<String, String>,  // monitor key -> hidden pre-loaded overlay label
    pins: HashMap<String, Pin>,
    hotkeys_released: bool,
    seq: u32,
    spike_runs: u32,
}
type St = Mutex<State>;

fn st(app: &AppHandle) -> std::sync::MutexGuard<'_, State> {
    app.state::<St>().inner().lock().unwrap()
}

fn next_label(app: &AppHandle, prefix: &str) -> String {
    let mut s = st(app);
    s.seq += 1;
    format!("{prefix}{}", s.seq)
}

// ---------------------------------------------------------------- log / notify / dialogs
pub fn log(msg: &str) {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");
    let line = format!("[{now}] {msg}\n");
    eprint!("{line}");
    let dir = settings::log_dir();
    let _ = std::fs::create_dir_all(&dir);
    let f = dir.join("main.log");
    if std::fs::metadata(&f).map(|m| m.len() > 2_000_000).unwrap_or(false) { let _ = std::fs::rename(&f, dir.join("main.log.old")); }
    if let Ok(mut fh) = std::fs::OpenOptions::new().create(true).append(true).open(f) { let _ = fh.write_all(line.as_bytes()); }
}

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Blocking message box (call off the main thread). With `buttons`, returns true for the first one.
pub fn message(app: &AppHandle, title: &str, body: &str, buttons: Option<(&str, &str)>) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let d = app.dialog().message(body).title(title).kind(MessageDialogKind::Info);
    match buttons {
        Some((ok, cancel)) => d.buttons(MessageDialogButtons::OkCancelCustom(ok.into(), cancel.into())).blocking_show(),
        None => d.blocking_show(),
    }
}

fn bg(f: impl FnOnce() + Send + 'static) { std::thread::spawn(f); }

// ---------------------------------------------------------------- native screen grab
#[cfg(windows)]
mod grab {
    use std::ffi::c_void;
    #[repr(C)]
    struct Bmih { size: u32, w: i32, h: i32, planes: u16, bits: u16, comp: u32, img: u32, xp: i32, yp: i32, used: u32, imp: u32 }
    #[repr(C)]
    struct Bmi { h: Bmih, colors: [u32; 1] }
    #[link(name = "user32")]
    extern "system" {
        fn GetDC(h: isize) -> isize;
        fn ReleaseDC(h: isize, dc: isize) -> i32;
        fn SetThreadDpiAwarenessContext(c: isize) -> isize;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateCompatibleDC(dc: isize) -> isize;
        fn DeleteDC(dc: isize) -> i32;
        fn SelectObject(dc: isize, o: isize) -> isize;
        fn DeleteObject(o: isize) -> i32;
        fn BitBlt(d: isize, x: i32, y: i32, w: i32, h: i32, s: isize, sx: i32, sy: i32, rop: u32) -> i32;
        fn CreateDIBSection(dc: isize, bmi: *const Bmi, usage: u32, bits: *mut *mut c_void, sec: isize, off: u32) -> isize;
    }

    /// Physical-pixel rect of the virtual screen -> RGBA (GDI BitBlt, the method Lightshot uses; ~50 ms for 4K).
    pub fn rect(x: i32, y: i32, w: i32, h: i32) -> Option<Vec<u8>> {
        let mut out = None;
        unsafe {
            let prev = SetThreadDpiAwarenessContext(-4); // per-monitor aware v2: physical pixels everywhere
            let scr = GetDC(0);
            if scr != 0 {
                let mem = CreateCompatibleDC(scr);
                let bmi = Bmi { h: Bmih { size: 40, w, h: -h, planes: 1, bits: 32, comp: 0, img: 0, xp: 0, yp: 0, used: 0, imp: 0 }, colors: [0] };
                let mut bits: *mut c_void = std::ptr::null_mut();
                let dib = CreateDIBSection(scr, &bmi, 0, &mut bits, 0, 0);
                if dib != 0 && !bits.is_null() {
                    let old = SelectObject(mem, dib);
                    if BitBlt(mem, 0, 0, w, h, scr, x, y, 0x00CC_0020 | 0x4000_0000) != 0 {
                        let n = w as usize * h as usize * 4;
                        out = Some(std::slice::from_raw_parts(bits as *const u8, n).to_vec());
                    }
                    SelectObject(mem, old);
                    DeleteObject(dib);
                }
                DeleteDC(mem);
                ReleaseDC(0, scr);
            }
            if prev != 0 { SetThreadDpiAwarenessContext(prev); }
        }
        if let Some(v) = out.as_mut() { super::bgra_to_rgba(v); }
        out
    }
}

/// BGRA -> RGBA with opaque alpha, one u32 per pixel
#[allow(dead_code)]
fn bgra_to_rgba(v: &mut [u8]) {
    let (head, mid, tail) = unsafe { v.align_to_mut::<u32>() };
    for p in mid {
        let x = *p;
        *p = 0xff00_0000 | (x & 0x0000_ff00) | ((x >> 16) & 0xff) | ((x & 0xff) << 16);
    }
    for px in head.chunks_exact_mut(4).chain(tail.chunks_exact_mut(4)) { px.swap(0, 2); px[3] = 255; }
}

fn grab_monitor(m: &tauri::Monitor) -> Option<Vec<u8>> {
    let (p, s) = (*m.position(), *m.size());
    #[cfg(windows)]
    { grab::rect(p.x, p.y, s.width as i32, s.height as i32) }
    #[cfg(not(windows))]
    { let _ = (p, s); None } // macOS capture: to do on the Mac (ScreenCaptureKit)
}

// ---------------------------------------------------------------- images / files / clipboard
fn decode_png(png: &[u8]) -> Result<image::RgbaImage, String> {
    image::load_from_memory_with_format(png, image::ImageFormat::Png).map(|i| i.to_rgba8()).map_err(|e| e.to_string())
}

fn encode_png(rgba: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new_with_quality(&mut out, image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::Adaptive)
        .write_image(rgba, w, h, image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

fn encode_for(png: &[u8], format: &str) -> Result<Vec<u8>, String> {
    if format != "jpg" { return Ok(png.to_vec()); }
    let img = image::load_from_memory_with_format(png, image::ImageFormat::Png).map_err(|e| e.to_string())?.to_rgb8();
    let mut out = Vec::new();
    let q = settings::num("jpgQuality", 92.0).clamp(1.0, 100.0) as u8;
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, q).encode_image(&img).map_err(|e| e.to_string())?;
    Ok(out)
}

fn clip_rgba(rgba: Vec<u8>, w: u32, h: u32) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_image(arboard::ImageData { width: w as usize, height: h as usize, bytes: rgba.into() }).map_err(|e| e.to_string())
}

fn clip_png(png: &[u8]) -> Result<(), String> {
    let img = decode_png(png)?;
    let (w, h) = img.dimensions();
    clip_rgba(img.into_raw(), w, h)
}

fn make_filename(ext: &str) -> String {
    let now = chrono::Local::now();
    let mut name = settings::str("filenamePattern");
    if name.is_empty() { name = "Screenshot".into(); }
    for (k, f) in [("{YYYY}", "%Y"), ("{MM}", "%m"), ("{DD}", "%d"), ("{HH}", "%H"), ("{mm}", "%M"), ("{ss}", "%S")] {
        name = name.replace(k, &now.format(f).to_string());
    }
    let clean: String = name.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '-' } else { c }).collect();
    format!("{clean}.{ext}")
}

fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() { return p; }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Screenshot");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("png");
    (2..).map(|i| dir.join(format!("{stem} ({i}).{ext}"))).find(|p| !p.exists()).unwrap()
}

fn save_dir() -> PathBuf { PathBuf::from(settings::str("saveDir")) }

fn write_to_save_dir(png: &[u8], format: &str) -> Result<PathBuf, String> {
    let dir = save_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ext = if format == "jpg" { "jpg" } else { "png" };
    let p = unique_path(&dir, &make_filename(ext));
    std::fs::write(&p, encode_for(png, ext)?).map_err(|e| e.to_string())?;
    Ok(p)
}

fn save_with_dialog(app: &AppHandle, png: &[u8]) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let format = settings::str("format");
    let dir = save_dir();
    let _ = std::fs::create_dir_all(&dir);
    let mut d = app.dialog().file().set_title("Save Screenshot").set_directory(&dir).set_file_name(make_filename(if format == "jpg" { "jpg" } else { "png" }));
    d = if format == "jpg" {
        d.add_filter("JPEG Image", &["jpg", "jpeg"]).add_filter("PNG Image", &["png"])
    } else {
        d.add_filter("PNG Image", &["png"]).add_filter("JPEG Image", &["jpg", "jpeg"])
    };
    let Some(fp) = d.blocking_save_file() else { return Ok(None) };
    let mut path = fp.into_path().map_err(|e| e.to_string())?;
    let lower = path.to_string_lossy().to_lowercase();
    let is_jpg = lower.ends_with(".jpg") || lower.ends_with(".jpeg");
    if !is_jpg && !lower.ends_with(".png") { path.set_extension("png"); }
    std::fs::write(&path, encode_for(png, if is_jpg { "jpg" } else { "png" })?).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() { settings::save(&json!({ "saveDir": parent.to_string_lossy() })); }
    Ok(Some(path))
}

fn open_save_dir_impl(app: &AppHandle) {
    use tauri_plugin_opener::OpenerExt;
    let dir = save_dir();
    let _ = std::fs::create_dir_all(&dir);
    let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
}

// ---------------------------------------------------------------- hotkeys
/// Electron accelerator ("Control+Shift+2", "Alt+`", "PrintScreen") -> global-hotkey syntax
fn to_shortcut(acc: &str) -> String {
    acc.split('+').map(|t| match t {
        "Return" => "Enter", "Plus" => "=", "Esc" => "Escape", "Option" => "Alt",
        "Command" if !IS_MAC => "Super",
        other => other,
    }).collect::<Vec<_>>().join("+")
}

/// Registers the capture hotkeys from settings; returns the ones that failed.
fn register_hotkeys(app: &AppHandle, quiet: bool) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut failed = vec![];
    for key in [settings::str("hotkey"), settings::str("altHotkey")] {
        if key.is_empty() { continue; }
        if let Err(e) = gs.register(to_shortcut(&key).as_str()) {
            log(&format!("hotkey {key} failed: {e}"));
            failed.push(key);
        }
    }
    log(&format!("hotkeys registered (failed: {failed:?})"));
    if !failed.is_empty() && !quiet {
        notify(app, "Hotkey unavailable", &format!("Could not register {}. Another app may own it — change it in Settings.", failed.join(", ")));
    }
    failed
}

// ---------------------------------------------------------------- overlays
fn monitor_key(m: &tauri::Monitor) -> String {
    let (p, s) = (m.position(), m.size());
    format!("{},{} {}x{} @{}", p.x, p.y, s.width, s.height, m.scale_factor())
}

fn make_overlay(app: &AppHandle, label: &str, m: &tauri::Monitor) -> tauri::Result<WebviewWindow> {
    let (pos, size, scale) = (*m.position(), *m.size(), m.scale_factor());
    let w = WebviewWindowBuilder::new(app, label, WebviewUrl::App("overlay.html".into()))
        .title("SnapMark Capture")
        .visible(false)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .visible_on_all_workspaces(true)
        .background_color(tauri::window::Color(0, 0, 0, 255))
        .inner_size(size.width as f64 / scale, size.height as f64 / scale)
        .position(pos.x as f64 / scale, pos.y as f64 / scale)
        .initialization_script(BRIDGE)
        .build()?;
    let _ = w.set_position(PhysicalPosition::new(pos.x, pos.y));
    let _ = w.set_size(PhysicalSize::new(size.width, size.height));
    Ok(w)
}

/// One hidden, fully loaded overlay per display waits for the next capture (used once, then replaced).
fn warm_overlays(app: &AppHandle) {
    let monitors = app.available_monitors().unwrap_or_default();
    let keys: HashSet<String> = monitors.iter().map(monitor_key).collect();
    let stale: Vec<String> = {
        let mut s = st(app);
        let old: Vec<String> = s.spares.keys().filter(|k| !keys.contains(*k)).cloned().collect();
        old.into_iter().filter_map(|k| s.spares.remove(&k)).collect()
    };
    for l in stale { if let Some(w) = app.get_webview_window(&l) { let _ = w.destroy(); } }
    for m in monitors {
        let key = monitor_key(&m);
        {
            let s = st(app);
            if s.capturing || s.spares.contains_key(&key) { continue; }
        }
        let label = next_label(app, "overlay");
        st(app).spares.insert(key.clone(), label.clone());
        if let Err(e) = make_overlay(app, &label, &m) {
            log(&format!("overlay create failed: {e}"));
            st(app).spares.remove(&key);
        }
    }
}

fn warm_later(app: &AppHandle, ms: u64) {
    let app = app.clone();
    bg(move || { std::thread::sleep(Duration::from_millis(ms)); warm_overlays(&app); });
}

/// Hands the frozen screen to the overlay page. Windows: WebView2 shared memory (no copy through IPC: ~0 ms
/// instead of ~230 ms for 4K). Otherwise, or if that fails: an event, and the page pulls the bytes via overlay_frame.
fn send_init(app: &AppHandle, label: &str, payload: Value) {
    #[cfg(windows)]
    {
        let shot = st(app).shots.remove(label);
        if let (Some(shot), Some(win)) = (shot, app.get_webview_window(label)) {
            let meta = payload.to_string();
            let (app2, label2) = (app.clone(), label.to_string());
            let _ = win.with_webview(move |wv| {
                if let Err(e) = unsafe { post_shared(&wv, &shot.rgba, &meta) } {
                    log(&format!("shared buffer failed ({e}), using IPC"));
                    st(&app2).shots.insert(label2.clone(), shot);
                    let _ = app2.emit_to(label2.as_str(), "overlay:init", payload);
                }
            });
            return;
        }
    }
    let _ = app.emit_to(label, "overlay:init", payload);
}

#[cfg(windows)]
unsafe fn post_shared(wv: &tauri::webview::PlatformWebview, data: &[u8], meta: &str) -> windows_core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows_core::{Interface, HSTRING};
    let env: ICoreWebView2Environment12 = wv.environment().cast()?;
    let buf = env.CreateSharedBuffer(data.len() as u64)?;
    let mut p: *mut u8 = std::ptr::null_mut();
    buf.Buffer(&mut p)?;
    std::ptr::copy_nonoverlapping(data.as_ptr(), p, data.len());
    let core: ICoreWebView2_17 = wv.controller().CoreWebView2()?.cast()?;
    core.PostSharedBufferToScript(&buf, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE, &HSTRING::from(meta))
}

fn start_capture(app: &AppHandle) {
    let t0 = Instant::now();
    {
        let mut s = st(app);
        if s.capturing { return; }
        s.capturing = true;
        s.t0 = Some(t0);
    }
    log("capture start");
    let monitors = app.available_monitors().unwrap_or_default();
    let cursor = app.cursor_position().ok();
    let prefs = Value::Object(settings::load());
    let mut started = 0;
    for m in monitors {
        let (pos, size, scale) = (*m.position(), *m.size(), m.scale_factor());
        let Some(rgba) = grab_monitor(&m) else { log("grab failed"); continue };
        log(&format!("grabbed {}x{} in {} ms", size.width, size.height, t0.elapsed().as_millis()));
        let key = monitor_key(&m);
        let spare = st(app).spares.remove(&key);
        let label = match spare.filter(|l| app.get_webview_window(l).is_some()) {
            Some(l) => l,
            None => {
                let l = next_label(app, "overlay");
                if let Err(e) = make_overlay(app, &l, &m) { log(&format!("overlay create failed: {e}")); continue; }
                l
            }
        };
        let cur = cursor.and_then(|c| {
            let (cx, cy) = (c.x - pos.x as f64, c.y - pos.y as f64);
            (cx >= 0.0 && cy >= 0.0 && cx < size.width as f64 && cy < size.height as f64).then(|| json!({ "x": cx / scale, "y": cy / scale }))
        });
        let payload = json!({
            "displayId": key, "width": size.width as f64 / scale, "height": size.height as f64 / scale,
            "scaleFactor": scale, "imgW": size.width, "imgH": size.height, "cursor": cur, "rgba": true,
            "platform": if IS_MAC { "darwin" } else { "win32" }, "settings": prefs,
        });
        let send_now = {
            let mut s = st(app);
            s.shots.insert(label.clone(), Shot { rgba });
            s.overlays.push(label.clone());
            s.geo.insert(label.clone(), Geo { x: pos.x, y: pos.y, scale });
            if s.loaded.contains(&label) { true } else { s.pending.insert(label.clone(), payload.clone()); false }
        };
        if send_now { send_init(app, &label, payload); }
        started += 1;
    }
    if started == 0 {
        close_overlays(app);
        notify(app, "Capture failed", "Couldn't capture the screen. See Show Log File in the menu.");
        return;
    }
    // global hotkeys off while capturing, so a one-key hotkey can still be typed in a text box
    let _ = app.global_shortcut().unregister_all();
    st(app).hotkeys_released = true;
    // watchdog: never leave capture stuck if an overlay fails to come up
    let app2 = app.clone();
    bg(move || {
        std::thread::sleep(Duration::from_secs(6));
        let (labels, same) = { let s = st(&app2); (s.overlays.clone(), s.t0 == Some(t0)) };
        if same && !labels.is_empty() && labels.iter().all(|l| app2.get_webview_window(l).map(|w| !w.is_visible().unwrap_or(false)).unwrap_or(true)) {
            log("watchdog: overlays never became ready, closing");
            close_overlays(&app2);
            notify(&app2, "Capture failed", "The capture window did not open. See Show Log File in the menu.");
        }
    });
}

fn close_overlays(app: &AppHandle) {
    let (labels, release) = {
        let mut s = st(app);
        s.capturing = false;
        s.shots.clear();
        let r = std::mem::take(&mut s.hotkeys_released);
        (std::mem::take(&mut s.overlays), r)
    };
    for l in labels {
        if let Some(w) = app.get_webview_window(&l) { let _ = w.destroy(); }
        let mut s = st(app);
        s.loaded.remove(&l);
        s.pending.remove(&l);
        s.geo.remove(&l);
    }
    if release { register_hotkeys(app, true); }
    warm_later(app, 300);
}

fn set_overlays_visible(app: &AppHandle, on: bool) {
    let labels = st(app).overlays.clone();
    for l in labels {
        if let Some(w) = app.get_webview_window(&l) { let _ = if on { w.show() } else { w.hide() }; }
    }
}

fn capture_full_screen_to_clipboard(app: &AppHandle) {
    let m = app.cursor_position().ok()
        .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(m) = m else { return };
    let Some(rgba) = grab_monitor(&m) else { return notify(app, "Capture failed", "Couldn't capture the screen.") };
    let (w, h) = (m.size().width, m.size().height);
    if settings::bool("autoSaveCopy") {
        if let Ok(png) = encode_png(&rgba, w, h) { let _ = write_to_save_dir(&png, "png"); }
    }
    match clip_rgba(rgba, w, h) {
        Ok(()) => notify(app, "Copied full screen", &format!("{w} × {h} px")),
        Err(e) => notify(app, "Copy failed", &e),
    }
}

// ---------------------------------------------------------------- pins (floating screenshots)
fn create_pin(app: &AppHandle, png: Vec<u8>, x: f64, y: f64, w: f64, h: f64, scale: f64) {
    let label = next_label(app, "pin");
    st(app).pins.insert(label.clone(), Pin { png, w, h, zoom: 1.0, scale });
    let res = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("pin.html".into()))
        .title("SnapMark Pin")
        .visible(false)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .shadow(true)
        .inner_size((w / scale).max(24.0), (h / scale).max(24.0))
        .position(x / scale, y / scale)
        .initialization_script(BRIDGE)
        .build();
    match res {
        Ok(win) => {
            let _ = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
            let _ = win.set_size(PhysicalSize::new(w.round().max(24.0) as u32, h.round().max(24.0) as u32));
            refresh_tray(app);
        }
        Err(e) => { log(&format!("pin create failed: {e}")); st(app).pins.remove(&label); }
    }
}

fn pin_from_clipboard(app: &AppHandle) {
    let img = arboard::Clipboard::new().and_then(|mut c| c.get_image());
    let Ok(img) = img else { return notify(app, "No image on clipboard", "Copy an image first.") };
    let (w, h) = (img.width as u32, img.height as u32);
    let Ok(png) = encode_png(&img.bytes, w, h) else { return };
    let c = app.cursor_position().unwrap_or(PhysicalPosition::new(200.0, 200.0));
    let scale = app.monitor_from_point(c.x, c.y).ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    create_pin(app, png, c.x - w as f64 / 2.0, c.y - h as f64 / 2.0, w as f64, h as f64, scale);
}

fn close_all_pins(app: &AppHandle) {
    let labels: Vec<String> = st(app).pins.keys().cloned().collect();
    for l in labels { close_pin(app, &l); }
}

fn close_pin(app: &AppHandle, label: &str) {
    st(app).pins.remove(label);
    if let Some(w) = app.get_webview_window(label) { let _ = w.destroy(); }
    refresh_tray(app);
}

fn pin_do(app: &AppHandle, label: &str, action: &str) -> Result<Option<String>, String> {
    let Some(png) = st(app).pins.get(label).map(|p| p.png.clone()) else { return Ok(None) };
    match action {
        "copy" => { clip_png(&png)?; Ok(Some("Copied".into())) }
        "cut" => { clip_png(&png)?; close_pin(app, label); Ok(None) }
        "save" => Ok(save_with_dialog(app, &png)?.map(|_| "Saved".into())),
        "quicksave" => {
            let p = write_to_save_dir(&png, &settings::str("format"))?;
            Ok(Some(format!("Saved {}", p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default())))
        }
        "close" => { close_pin(app, label); Ok(None) }
        _ => Ok(None),
    }
}

fn pin_zoom_impl(app: &AppHandle, label: &str, factor: f64, cx: Option<f64>, cy: Option<f64>) {
    let Some(win) = app.get_webview_window(label) else { return };
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.inner_size()) else { return };
    let (next, nw, nh, scale) = {
        let mut s = st(app);
        let Some(p) = s.pins.get_mut(label) else { return };
        let next = if factor == 0.0 { 1.0 } else { (p.zoom * factor).clamp(0.1, 8.0) };
        p.zoom = next;
        (next, (p.w * next).round(), (p.h * next).round(), p.scale)
    };
    // keep the point under the cursor fixed (cx/cy are CSS px inside the window)
    let fx = cx.map(|v| v * scale / size.width as f64).unwrap_or(0.5);
    let fy = cy.map(|v| v * scale / size.height as f64).unwrap_or(0.5);
    let nx = pos.x as f64 + fx * size.width as f64 - fx * nw;
    let ny = pos.y as f64 + fy * size.height as f64 - fy * nh;
    let _ = win.set_position(PhysicalPosition::new(nx.round() as i32, ny.round() as i32));
    let _ = win.set_size(PhysicalSize::new(nw.max(24.0) as u32, nh.max(24.0) as u32));
    let _ = app.emit_to(label, "pin:zoomed", next);
}

// ---------------------------------------------------------------- tray
fn pretty_hotkey(acc: &str) -> String {
    if IS_MAC {
        acc.split('+').map(|t| match t { "Command" | "CommandOrControl" => "⌘", "Control" => "⌃", "Alt" | "Option" => "⌥", "Shift" => "⇧", o => o }).collect::<Vec<_>>().join("")
    } else {
        acc.replace("CommandOrControl", "Ctrl").replace("Control", "Ctrl")
    }
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    if let Some((v, _)) = updates::state() {
        menu.append(&MenuItem::with_id(app, "update", format!("⬆ Update Available: {v}…"), true, None::<&str>)?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    let hk = pretty_hotkey(&settings::str("hotkey"));
    let cap = if hk.is_empty() || IS_MAC { "Capture Region".to_string() } else { format!("Capture Region\t{hk}") };
    let has_pins = !st(app).pins.is_empty();
    menu.append(&MenuItem::with_id(app, "capture", cap, true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "capture3", "Capture in 3 Seconds", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "fullclip", "Capture Full Screen → Clipboard", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "pinclip", "Paste Clipboard Image as Pin", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "closepins", "Close All Pins", has_pins, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "folder", "Open Screenshots Folder", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "checkupd", "Check for Updates…", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "log", "Show Log File", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit SnapMark", true, None::<&str>)?)?;
    Ok(menu)
}

pub fn refresh_tray(app: &AppHandle) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let (Some(tray), Ok(menu)) = (app2.tray_by_id("main"), build_tray_menu(&app2)) { let _ = tray.set_menu(Some(menu)); }
    });
}

fn on_menu(app: &AppHandle, ev: MenuEvent) {
    let id = ev.id().as_ref().to_string();
    let app = app.clone();
    if let Some(rest) = id.strip_prefix("pin|") { // pin context menu: "pin|<action>|<label>"
        let mut parts = rest.splitn(2, '|');
        let (action, label) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
        return bg(move || match action.as_str() {
            "zoom1" => pin_zoom_impl(&app, &label, 0.0, None, None),
            "op100" => { let _ = app.emit_to(label.as_str(), "pin:setOpacity", 1.0); }
            "op50" => { let _ = app.emit_to(label.as_str(), "pin:setOpacity", 0.5); }
            a => match pin_do(&app, &label, a) {
                Ok(Some(msg)) => { let _ = app.emit_to(label.as_str(), "pin:toast", msg); }
                Ok(None) => {}
                Err(e) => { log(&format!("pin action failed: {e}")); let _ = app.emit_to(label.as_str(), "pin:toast", "Failed"); }
            },
        });
    }
    bg(move || match id.as_str() {
        "update" => updates::offer(&app),
        "capture" => start_capture(&app),
        "capture3" => { std::thread::sleep(Duration::from_secs(3)); start_capture(&app); }
        "fullclip" => capture_full_screen_to_clipboard(&app),
        "pinclip" => pin_from_clipboard(&app),
        "closepins" => close_all_pins(&app),
        "folder" => open_save_dir_impl(&app),
        "checkupd" => { updates::check(&app, true); }
        "settings" => open_settings(&app),
        "log" => { use tauri_plugin_opener::OpenerExt; let _ = app.opener().reveal_item_in_dir(settings::log_dir().join("main.log")); }
        "quit" => app.exit(0),
        _ => {}
    });
}

// ---------------------------------------------------------------- settings window
fn open_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") { let _ = w.show(); let _ = w.set_focus(); return; }
    let r = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("SnapMark Settings")
        .inner_size(520.0, 720.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .background_color(tauri::window::Color(0x1c, 0x1c, 0x1e, 255))
        .initialization_script(BRIDGE)
        .build();
    if let Err(e) = r { log(&format!("settings window failed: {e}")); }
}

fn apply_login_item(app: &AppHandle) {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    let want = settings::bool("launchAtLogin");
    if want == al.is_enabled().unwrap_or(false) { return; }
    let r = if want { al.enable() } else { al.disable() };
    if let Err(e) = r { log(&format!("login item: {e}")); }
}

// ---------------------------------------------------------------- commands (called by tauri-bridge.js)
#[tauri::command]
fn overlay_loaded(app: AppHandle, window: WebviewWindow) {
    let label = window.label().to_string();
    let payload = {
        let mut s = st(&app);
        s.loaded.insert(label.clone());
        s.pending.remove(&label)
    };
    if let Some(p) = payload { send_init(&app, &label, p); }
}

#[tauri::command]
fn overlay_frame(app: AppHandle, window: WebviewWindow) -> Response {
    let shot = st(&app).shots.remove(window.label());
    Response::new(shot.map(|s| s.rgba).unwrap_or_default())
}

#[tauri::command]
fn overlay_ready(app: AppHandle, window: WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
    let (ms, spike) = {
        let mut s = st(&app);
        let ms = s.t0.map(|t| t.elapsed().as_millis()).unwrap_or(0);
        if s.spike_runs > 0 { s.spike_runs -= 1; (ms, Some(s.spike_runs)) } else { (ms, None) }
    };
    log(&format!("overlay ready {ms} ms after hotkey"));
    if let Some(left) = spike { // test mode (SNAPMARK_SPIKE=n): close after a moment, run again or quit
        let hold = std::env::var("SNAPMARK_SPIKE_HOLD").ok().and_then(|v| v.parse().ok()).unwrap_or(300);
        bg(move || {
            std::thread::sleep(Duration::from_millis(hold));
            close_overlays(&app);
            if left == 0 { std::thread::sleep(Duration::from_millis(500)); app.exit(0); return; }
            std::thread::sleep(Duration::from_millis(1500));
            start_capture(&app);
        });
    }
}

#[tauri::command]
fn overlay_cancel(app: AppHandle) { log("overlay cancel"); close_overlays(&app); }

#[tauri::command]
async fn overlay_finish(app: AppHandle, window: WebviewWindow, request: Request<'_>) -> Result<Value, String> {
    let action = request.headers().get("x-action").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let rect: Value = request.headers().get("x-rect").and_then(|v| v.to_str().ok()).and_then(|s| serde_json::from_str(s).ok()).unwrap_or(Value::Null);
    let png = match request.body() { InvokeBody::Raw(b) => b.clone(), _ => return Err("no image".into()) };
    log(&format!("finish {action} {} bytes", png.len()));
    let format = settings::str("format");
    match action.as_str() {
        "copy" => {
            clip_png(&png)?; // error -> overlay stays open and shows it
            close_overlays(&app);
            if settings::bool("autoSaveCopy") { let _ = write_to_save_dir(&png, &format); }
            Ok(json!({ "ok": true }))
        }
        "quicksave" => {
            let p = write_to_save_dir(&png, &format)?;
            close_overlays(&app);
            if let Err(e) = clip_png(&png) { log(&format!("quicksave copy failed: {e}")); }
            notify(&app, "Saved & copied", &p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default());
            Ok(json!({ "ok": true, "path": p }))
        }
        "save" => {
            set_overlays_visible(&app, false);
            match save_with_dialog(&app, &png)? {
                Some(p) => { close_overlays(&app); Ok(json!({ "ok": true, "path": p })) }
                None => { set_overlays_visible(&app, true); let _ = window.set_focus(); Ok(json!({ "ok": false, "canceled": true })) }
            }
        }
        "pin" => {
            let g = st(&app).geo.get(window.label()).copied().unwrap_or(Geo { x: 0, y: 0, scale: 1.0 });
            let f = |k: &str| rect.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
            close_overlays(&app);
            let (w, h) = (f("w") * g.scale, f("h") * g.scale);
            create_pin(&app, png.to_vec(), g.x as f64 + f("x") * g.scale, g.y as f64 + f("y") * g.scale, w, h, g.scale);
            Ok(json!({ "ok": true }))
        }
        _ => Ok(json!({ "ok": false })),
    }
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_prefs(patch: Value) { settings::save(&patch); }

#[tauri::command]
fn pin_png(app: AppHandle, window: WebviewWindow) -> Response {
    let png = st(&app).pins.get(window.label()).map(|p| p.png.clone()).unwrap_or_default();
    Response::new(png)
}

#[tauri::command]
fn pin_loaded(window: WebviewWindow) { let _ = window.show(); let _ = window.set_focus(); }

#[tauri::command]
fn pin_move(window: WebviewWindow, dx: f64, dy: f64) {
    if let Ok(p) = window.outer_position() {
        let s = window.scale_factor().unwrap_or(1.0);
        let _ = window.set_position(PhysicalPosition::new(p.x + (dx * s).round() as i32, p.y + (dy * s).round() as i32));
    }
}

#[tauri::command]
fn pin_zoom(app: AppHandle, window: WebviewWindow, factor: f64, cx: Option<f64>, cy: Option<f64>) {
    pin_zoom_impl(&app, window.label(), factor, cx, cy);
}

#[tauri::command]
async fn pin_action(app: AppHandle, window: WebviewWindow, action: String) -> Result<Option<String>, String> {
    pin_do(&app, window.label(), &action)
}

#[tauri::command]
fn pin_menu(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let l = window.label().to_string();
    let e = |e: tauri::Error| e.to_string();
    let item = |a: &str, text: &str, accel: &str| {
        let label = if IS_MAC || accel.is_empty() { text.to_string() } else { format!("{text}\t{accel}") };
        MenuItem::with_id(&app, format!("pin|{a}|{l}"), label, true, None::<&str>)
    };
    let menu = Menu::new(&app).map_err(e)?;
    menu.append(&item("copy", "Copy", "Ctrl+C").map_err(e)?).map_err(e)?;
    menu.append(&item("cut", "Cut (copy & close)", "Ctrl+X").map_err(e)?).map_err(e)?;
    menu.append(&item("save", "Save As…", "Ctrl+S").map_err(e)?).map_err(e)?;
    menu.append(&item("quicksave", "Quick Save to Folder", "Ctrl+Shift+S").map_err(e)?).map_err(e)?;
    menu.append(&PredefinedMenuItem::separator(&app).map_err(e)?).map_err(e)?;
    menu.append(&item("zoom1", "Actual Size", "Ctrl+0").map_err(e)?).map_err(e)?;
    menu.append(&item("op100", "Opacity 100%", "").map_err(e)?).map_err(e)?;
    menu.append(&item("op50", "Opacity 50%", "").map_err(e)?).map_err(e)?;
    menu.append(&PredefinedMenuItem::separator(&app).map_err(e)?).map_err(e)?;
    menu.append(&item("close", "Close", "Esc").map_err(e)?).map_err(e)?;
    window.popup_menu(&menu).map_err(e)
}

#[tauri::command]
fn settings_get(app: AppHandle) -> Value {
    json!({
        "settings": settings::load(),
        "platform": if IS_MAC { "darwin" } else { "win32" },
        "file": settings::file(),
        "version": app.package_info().version.to_string(),
    })
}

#[tauri::command]
fn settings_set(app: AppHandle, patch: Value) -> Value {
    let before = settings::load();
    settings::save(&patch);
    let failed = register_hotkeys(&app, true);
    if !failed.is_empty() { // roll back hotkeys that could not be registered
        let mut back = serde_json::Map::new();
        for k in ["hotkey", "altHotkey"] {
            if let Some(v) = patch.get(k).and_then(|v| v.as_str()) {
                if failed.iter().any(|f| f == v) { back.insert(k.into(), before.get(k).cloned().unwrap_or(Value::Null)); }
            }
        }
        settings::save(&Value::Object(back));
        register_hotkeys(&app, true);
    }
    apply_login_item(&app);
    refresh_tray(&app);
    json!({ "settings": settings::load(), "failed": failed })
}

#[tauri::command]
async fn settings_choose_dir(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().set_directory(save_dir()).blocking_pick_folder()
        .and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn settings_suspend_hotkeys(app: AppHandle, on: bool) {
    if on { let _ = app.global_shortcut().unregister_all(); } else { register_hotkeys(&app, true); }
}

#[tauri::command]
fn open_save_dir(app: AppHandle) { open_save_dir_impl(&app); }

#[tauri::command]
async fn check_updates(app: AppHandle) -> bool { updates::check(&app, true).is_some() }

// ---------------------------------------------------------------- main
fn main() {
    let spike_runs: u32 = std::env::var("SNAPMARK_SPIKE").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let app = tauri::Builder::default()
        // must be first: a second launch (or `SnapMark --capture`) starts a capture in the running app
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let app = app.clone();
            if args.iter().any(|a| a == "--settings") { bg(move || open_settings(&app)); } else { bg(move || start_capture(&app)); }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    log(&format!("hotkey {}", shortcut.into_string()));
                    let app = app.clone();
                    bg(move || start_capture(&app));
                }
            })
            .build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(Mutex::new(State { spike_runs, ..Default::default() }))
        .on_menu_event(on_menu)
        .invoke_handler(tauri::generate_handler![
            overlay_loaded, overlay_frame, overlay_ready, overlay_cancel, overlay_finish, copy_text, save_prefs,
            pin_png, pin_loaded, pin_move, pin_zoom, pin_action, pin_menu,
            settings_get, settings_set, settings_choose_dir, settings_suspend_hotkeys, open_save_dir, check_updates,
        ])
        .setup(move |app| {
            let h = app.handle().clone();
            settings::set_pictures(h.path().picture_dir().ok());
            log(&format!("start v{} tauri {} {} {}", h.package_info().version, tauri::VERSION, std::env::consts::OS, std::env::consts::ARCH));
            #[cfg(target_os = "macos")]
            let _ = h.set_activation_policy(tauri::ActivationPolicy::Accessory); // menu-bar only, like Lightshot
            let icon = if IS_MAC { Image::from_bytes(include_bytes!("../../assets/trayTemplate@2x.png"))? } else { Image::from_bytes(include_bytes!("../../assets/tray.png"))? };
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(IS_MAC)
                .tooltip("SnapMark")
                .menu(&build_tray_menu(&h)?)
                .show_menu_on_left_click(IS_MAC)
                .on_tray_icon_event(|tray, ev| {
                    if !IS_MAC {
                        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                            let app = tray.app_handle().clone();
                            bg(move || start_capture(&app));
                        }
                    }
                })
                .build(app)?;
            register_hotkeys(&h, false);
            apply_login_item(&h);
            updates::init(&h);
            warm_later(&h, 800);
            if std::env::args().any(|a| a == "--settings") { open_settings(&h); }
            if spike_runs > 0 || std::env::args().any(|a| a == "--capture") {
                let h2 = h.clone();
                bg(move || { std::thread::sleep(Duration::from_millis(if spike_runs > 0 { 3000 } else { 1200 })); start_capture(&h2); });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building SnapMark");
    app.run(|_app, e| {
        if let RunEvent::ExitRequested { api, code, .. } = e {
            if code.is_none() { api.prevent_exit(); } // stay alive in the tray when windows close
        }
    });
}
