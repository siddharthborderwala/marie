//! Multi-window support: window creation (same chrome as the main window), which folder each
//! window shows (to focus instead of duplicating), and session restore across quits.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct Windows {
    /// window label → workspace uri shown in it
    pub folders: Mutex<HashMap<String, String>>,
    next: Mutex<u32>,
}

fn session_file() -> Option<std::path::PathBuf> {
    let d = dirs::data_dir()?.join("marie");
    std::fs::create_dir_all(&d).ok()?;
    Some(d.join("session.json"))
}

/// Persist the folders of all open windows (called when the app is about to quit).
pub fn save_session(w: &Windows) {
    let folders = w.folders.lock().unwrap();
    // main first so it restores into the main window
    let mut list: Vec<(String, String)> = folders.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    list.sort_by_key(|(k, _)| if k == "main" { String::new() } else { k.clone() });
    let uris: Vec<String> = list.into_iter().map(|(_, v)| v).collect();
    if let Some(f) = session_file() {
        let _ = std::fs::write(f, serde_json::to_string(&uris).unwrap_or_default());
    }
}

/// Folders to restore on launch (consumed once).
pub fn take_session() -> Vec<String> {
    let Some(f) = session_file() else { return vec![] };
    let v = std::fs::read_to_string(&f).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let _ = std::fs::remove_file(f);
    v
}

pub fn create<R: Runtime>(app: &AppHandle<R>, folder: Option<&str>) -> tauri::Result<String> {
    create_with(app, folder, None)
}

pub fn create_with<R: Runtime>(app: &AppHandle<R>, folder: Option<&str>, file: Option<&str>) -> tauri::Result<String> {
    let state = app.state::<Windows>();
    let label = {
        let mut n = state.next.lock().unwrap();
        *n += 1;
        format!("win-{}", *n)
    };
    let mut url = String::from("index.html");
    if let Some(f) = folder {
        url.push_str("?folder=");
        url.push_str(&urlencoding(f));
        if let Some(file) = file {
            url.push_str("&file=");
            url.push_str(&urlencoding(file));
        }
    }
    // Cascade from the focused window like macOS document apps.
    let (x, y) = app
        .webview_windows()
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .and_then(|w| {
            let p = w.outer_position().ok()?;
            let s = w.scale_factor().ok()?;
            Some((p.x as f64 / s + 28.0, p.y as f64 / s + 28.0))
        })
        .unwrap_or((120.0, 120.0));
    let mut b = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("Marie")
        .inner_size(1320.0, 860.0)
        .min_inner_size(640.0, 400.0)
        .position(x, y);
    #[cfg(target_os = "macos")]
    {
        b = b
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 24.0));
    }
    let w = b.build()?;
    let _ = w.set_focus();
    Ok(label)
}

fn urlencoding(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// If another window already shows `uri`, focus it and return true.
pub fn focus_existing<R: Runtime>(app: &AppHandle<R>, uri: &str, except: &str) -> bool {
    let state = app.state::<Windows>();
    let label = state
        .folders
        .lock()
        .unwrap()
        .iter()
        .find(|(l, u)| u.as_str() == uri && l.as_str() != except)
        .map(|(l, _)| l.clone());
    if let Some(l) = label {
        if let Some(w) = app.get_webview_window(&l) {
            let _ = w.unminimize();
            let _ = w.set_focus();
            return true;
        }
    }
    false
}
