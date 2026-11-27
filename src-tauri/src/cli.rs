//! The `marie` shell command (installed to ~/.local/bin by the app) and the single-instance
//! hand-off: a second `marie …` launch forwards its arguments to the running app, which opens
//! them in a new window (or focuses the window that already shows that folder).

use crate::windows;
use tauri::{AppHandle, Emitter, Manager, Runtime};

const SCRIPT: &str = r#"#!/bin/sh
# Installed by Marie — keep this file; Marie rewrites it if the app moves.
# Usage: marie [folder | file | ssh://host/path]
APP="__APP__"
for a do
  shift
  case "$a" in
    -*|ssh://*) set -- "$@" "$a" ;;
    *)
      if [ -d "$a" ]; then
        set -- "$@" "$(cd -- "$a" && pwd -P)"
      elif [ -f "$a" ]; then
        # a file opens its folder plus the file
        set -- "$@" "$(cd -- "$(dirname -- "$a")" && pwd -P)" "$(basename -- "$a")"
      else
        set -- "$@" "$a"
      fi ;;
  esac
done
[ $# -eq 0 ] && set -- "$(pwd -P)"
if pgrep -xq marie; then
  # Already running: the single-instance plugin forwards these args to it.
  "$APP/Contents/MacOS/marie" "$@" >/dev/null 2>&1 &
else
  open -a "$APP" --args "$@"
fi
"#;

fn bundle_path() -> Option<std::path::PathBuf> {
    // …/Marie.app/Contents/MacOS/marie → …/Marie.app
    let exe = std::env::current_exe().ok()?;
    let app = exe.parent()?.parent()?.parent()?;
    (app.extension()?.to_str()? == "app").then(|| app.to_path_buf())
}

fn target() -> Option<std::path::PathBuf> {
    Some(dirs::home_dir()?.join(".local/bin/marie"))
}

fn on_path(dir: &std::path::Path) -> bool {
    // GUI apps get a minimal PATH; ask the login shell for the real one.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let path = std::process::Command::new(shell)
        .args(["-lic", "printf %s \"$PATH\""])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    path.split(':').any(|p| std::path::Path::new(p) == dir)
}

/// Write ~/.local/bin/marie pointing at this app bundle. Returns (path, dir_on_path).
pub fn install(force: bool) -> Result<(String, bool), String> {
    let app = bundle_path().ok_or("Marie isn't running from an app bundle (dev build?)")?;
    let dest = target().ok_or("no home directory")?;
    let script = SCRIPT.replace("__APP__", &app.display().to_string());
    if !force {
        if let Ok(cur) = std::fs::read_to_string(&dest) {
            if cur == script {
                return Ok((dest.display().to_string(), true));
            }
        }
    }
    let dir = dest.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(&dest, script).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    Ok((dest.display().to_string(), on_path(dir)))
}

/// Silent install/refresh on launch (only for installed builds).
pub fn ensure_installed() {
    if bundle_path().is_some() {
        let _ = install(false);
    }
}

/// argv from a second launch (`marie <folder> [file]`), forwarded by the single-instance plugin.
pub fn handle_second_launch<R: Runtime>(app: &AppHandle<R>, argv: Vec<String>, _cwd: String) {
    let pos: Vec<String> = argv.into_iter().skip(1).filter(|a| !a.starts_with('-')).collect();
    let folder = pos.first().cloned();
    let file = pos.get(1).cloned();
    if let Some(f) = &folder {
        let label = app
            .state::<windows::Windows>()
            .folders
            .lock()
            .unwrap()
            .iter()
            .find(|(_, u)| *u == f)
            .map(|(l, _)| l.clone());
        if let Some(l) = label {
            if let Some(w) = app.get_webview_window(&l) {
                let _ = w.unminimize();
                let _ = w.set_focus();
                if let Some(file) = &file {
                    let _ = w.emit_to(w.label(), "open-file", file.clone());
                }
                return;
            }
        }
    }
    let _ = windows::create_with(app, folder.as_deref(), file.as_deref());
}
