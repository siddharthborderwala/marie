//! Native macOS menu bar. Every custom item emits `menu` with its id; the frontend
//! command registry handles it, so menu and palette share one implementation.
//! The Edit menu uses predefined items, which macOS needs for copy/paste in the webview.

use tauri::menu::{AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

fn item<R: Runtime>(app: &AppHandle<R>, id: &str, label: &str, accel: Option<&str>) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, label, true, accel)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let sep = || PredefinedMenuItem::separator(app);

    let app_menu = Submenu::with_items(
        app,
        "Marie",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Marie"), Some(AboutMetadata::default()))?,
            &sep()?,
            &item(app, "app.checkUpdates", "Check for Updates…", None)?,
            &item(app, "app.settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item(app, "file.newUntitled", "New Untitled", Some("CmdOrCtrl+N"))?,
            &item(app, "file.newWindow", "New Window", Some("CmdOrCtrl+Shift+N"))?,
            &item(app, "file.openFolder", "Open Folder…", Some("CmdOrCtrl+O"))?,
            &item(app, "file.openFolderNewWindow", "Open Folder in New Window…", Some("CmdOrCtrl+Alt+O"))?,
            &item(app, "file.connectSsh", "Connect via SSH…", Some("CmdOrCtrl+Shift+O"))?,
            &item(app, "file.closeFolder", "Close Folder", None)?,
            &sep()?,
            &item(app, "file.save", "Save", Some("CmdOrCtrl+S"))?,
            &item(app, "file.saveAs", "Save As…", Some("CmdOrCtrl+Shift+S"))?,
            &item(app, "file.saveAll", "Save All", Some("CmdOrCtrl+Alt+Shift+S"))?,
            &item(app, "file.revert", "Revert File", None)?,
            &sep()?,
            &item(app, "file.copyPath", "Copy Path", Some("CmdOrCtrl+Alt+C"))?,
            &item(app, "file.copyRelativePath", "Copy Relative Path", Some("CmdOrCtrl+Alt+Shift+C"))?,
            &item(app, "file.revealInFinder", "Reveal in Finder", Some("CmdOrCtrl+Alt+R"))?,
            &sep()?,
            &item(app, "file.reopenClosed", "Reopen Closed Tab", Some("CmdOrCtrl+Shift+T"))?,
            &item(app, "file.closeTab", "Close Tab", Some("CmdOrCtrl+W"))?,
            &item(app, "file.closeOthers", "Close Other Tabs", None)?,
            &item(app, "file.closeAll", "Close All Tabs", Some("CmdOrCtrl+Alt+W"))?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            // Custom undo/redo: routed to the Pierre editor when it has focus, else to the webview.
            &item(app, "edit.undo", "Undo", Some("CmdOrCtrl+Z"))?,
            &item(app, "edit.redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item(app, "view.palette", "Command Palette…", Some("CmdOrCtrl+Shift+P"))?,
            &sep()?,
            &item(app, "view.explorer", "Explorer", Some("CmdOrCtrl+Shift+E"))?,
            &item(app, "search.findInFiles", "Search (Find in Files)", Some("CmdOrCtrl+Shift+F"))?,
            &item(app, "view.toggleSidebar", "Toggle Sidebar", Some("CmdOrCtrl+B"))?,
            &item(app, "view.toggleTerminal", "Terminal", Some("CmdOrCtrl+J"))?,
            &item(app, "terminal.new", "New Terminal", Some("Ctrl+Shift+`"))?,
            &sep()?,
            &item(app, "view.zoomIn", "Zoom In", Some("CmdOrCtrl+="))?,
            &item(app, "view.zoomOut", "Zoom Out", Some("CmdOrCtrl+-"))?,
            &item(app, "view.zoomReset", "Reset Zoom", Some("CmdOrCtrl+0"))?,
            &sep()?,
            &item(app, "view.toggleDiffStyle", "Toggle Split / Unified", Some("CmdOrCtrl+Alt+S"))?,
            &item(app, "view.toggleWrap", "Toggle Line Wrap", Some("Alt+Z"))?,
            &item(app, "view.toggleMarkdown", "Toggle Markdown Preview", Some("CmdOrCtrl+Shift+V"))?,
            &sep()?,
            &item(app, "view.selectTheme", "Select Theme…", Some("CmdOrCtrl+K"))?,
            &item(app, "view.toggleAppearance", "Toggle Light / Dark", Some("CmdOrCtrl+Shift+L"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let go = Submenu::with_items(
        app,
        "Go",
        true,
        &[
            &item(app, "go.file", "Go to File…", Some("CmdOrCtrl+P"))?,
            &item(app, "go.line", "Go to Line…", Some("Ctrl+G"))?,
            &item(app, "go.back", "Back", Some("Ctrl+-"))?,
            &item(app, "go.forward", "Forward", Some("Ctrl+Shift+-"))?,
            &item(app, "editor.changeLanguage", "Change Language Mode…", None)?,
            &sep()?,
            &item(app, "go.nextTab", "Next Tab", Some("CmdOrCtrl+Shift+]"))?,
            &item(app, "go.prevTab", "Previous Tab", Some("CmdOrCtrl+Shift+["))?,
        ],
    )?;

    let git = Submenu::with_items(
        app,
        "Git",
        true,
        &[
            &item(app, "git.uncommitted", "Uncommitted Changes", Some("CmdOrCtrl+Shift+G"))?,
            &item(app, "git.branch", "Branch Diff (vs base)", Some("CmdOrCtrl+Shift+B"))?,
            &item(app, "git.pickBase", "Compare with Branch…", None)?,
            &sep()?,
            &item(app, "git.fetch", "Fetch origin", None)?,
            &item(app, "git.refresh", "Refresh", Some("CmdOrCtrl+R"))?,
            &sep()?,
            &item(app, "scratch.viewAsDiff", "View Scratch as Diff", Some("CmdOrCtrl+Shift+D"))?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    // Native Window menu: macOS lists open windows and handles ⌘` cycling.
    #[cfg(target_os = "macos")]
    window.set_as_windows_menu_for_nsapp()?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &go, &git, &window])
}

/// Menu actions go to the focused window only (each window has its own state).
/// With no window open, "New Window" / "Open Folder" still work by creating one.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().0.clone();
    let focused = app.webview_windows().into_values().find(|w| w.is_focused().unwrap_or(false));
    match focused {
        Some(w) => {
            let _ = w.emit_to(w.label(), "menu", id);
        }
        None => {
            if matches!(id.as_str(), "file.newWindow" | "file.openFolder" | "file.openFolderNewWindow" | "file.newUntitled") {
                let _ = crate::windows::create(app, None);
            }
        }
    }
}
