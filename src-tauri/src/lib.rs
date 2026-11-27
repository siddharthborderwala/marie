mod cli;
mod git;
mod menu;
mod pty;
mod search;
mod windows;
mod workspace;

use git::{DiffMode, DiffSet, RepoInfo, StatusEntry};
use nucleo_matcher::{
    pattern::{CaseMatching, Normalization, Pattern},
    Config, Matcher, Utf32Str,
};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};
use workspace::Workspace;

#[derive(Default)]
struct AppState {
    ptys: pty::Ptys,
    workspaces: Mutex<HashMap<String, Arc<Workspace>>>,
    files: Mutex<HashMap<String, Arc<Vec<String>>>>,
}

type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn ws(state: &AppState, id: &str) -> Res<Arc<Workspace>> {
    state.workspaces.lock().unwrap().get(id).cloned().ok_or_else(|| format!("workspace not open: {id}"))
}

/// Run blocking work off the main thread.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?
}

#[derive(Serialize)]
struct WorkspaceInfo {
    id: String,
    name: String,
    remote: bool,
    is_git: bool,
}

#[tauri::command]
async fn open_workspace(state: State<'_, AppState>, uri: String) -> Res<WorkspaceInfo> {
    let w = blocking(move || Workspace::open(&uri).map_err(err)).await?;
    let info = WorkspaceInfo { id: w.uri.clone(), name: w.name(), remote: w.is_remote(), is_git: w.is_git };
    state.workspaces.lock().unwrap().insert(w.uri.clone(), Arc::new(w));
    Ok(info)
}

#[tauri::command]
async fn list_files(state: State<'_, AppState>, id: String) -> Res<Arc<Vec<String>>> {
    let w = ws(&state, &id)?;
    let files = Arc::new(blocking(move || w.list_files().map_err(err)).await?);
    state.files.lock().unwrap().insert(id, files.clone());
    Ok(files)
}

#[derive(Serialize)]
struct FileData {
    text: Option<String>,
    binary: bool,
    size: usize,
    too_large: bool,
}

#[tauri::command]
async fn read_file(state: State<'_, AppState>, id: String, path: String) -> Res<FileData> {
    let w = ws(&state, &id)?;
    blocking(move || match w.read_file(&path) {
        Ok(bytes) => {
            let binary = bytes.iter().take(8000).any(|b| *b == 0);
            Ok(FileData {
                size: bytes.len(),
                text: (!binary).then(|| String::from_utf8_lossy(&bytes).into_owned()),
                binary,
                too_large: false,
            })
        }
        Err(e) if e.to_string().starts_with("too-large:") => Ok(FileData {
            text: None,
            binary: false,
            size: e.to_string()[10..].parse().unwrap_or(0),
            too_large: true,
        }),
        Err(e) => Err(err(e)),
    })
    .await
}

#[tauri::command]
async fn git_status(state: State<'_, AppState>, id: String) -> Res<Vec<StatusEntry>> {
    let w = ws(&state, &id)?;
    if !w.is_git {
        return Ok(vec![]);
    }
    blocking(move || git::status(&w).map_err(err)).await
}

#[tauri::command]
async fn repo_info(state: State<'_, AppState>, id: String) -> Res<RepoInfo> {
    let w = ws(&state, &id)?;
    blocking(move || git::repo_info(&w).map_err(err)).await
}

#[tauri::command]
async fn git_diff(state: State<'_, AppState>, id: String, mode: DiffMode, base: Option<String>) -> Res<DiffSet> {
    let w = ws(&state, &id)?;
    blocking(move || git::diff(&w, mode, base).map_err(err)).await
}

#[tauri::command]
async fn git_fetch(state: State<'_, AppState>, id: String) -> Res<()> {
    let w = ws(&state, &id)?;
    blocking(move || w.git(&["fetch", "--quiet", "origin"], None).map(|_| ()).map_err(err)).await
}

/// Raw bytes of a file (for media over ssh; local media streams via the asset protocol).
#[tauri::command]
async fn read_bytes(state: State<'_, AppState>, id: String, path: String) -> Res<tauri::ipc::Response> {
    let w = ws(&state, &id)?;
    blocking(move || w.read_bytes(&path, 200 * 1024 * 1024).map(tauri::ipc::Response::new).map_err(err)).await
}

#[tauri::command]
async fn file_size(state: State<'_, AppState>, id: String, path: String) -> Res<u64> {
    let w = ws(&state, &id)?;
    blocking(move || w.file_size(&path).map_err(err)).await
}

// ---- find in files -----------------------------------------------------------

// ---- file operations ---------------------------------------------------------

#[tauri::command]
async fn fs_op(state: State<'_, AppState>, id: String, op: String, path: String, to: Option<String>) -> Res<()> {
    let w = ws(&state, &id)?;
    blocking(move || {
        match op.as_str() {
            "newFile" => w.create_file(&path),
            "newFolder" => w.create_dir(&path),
            "rename" => match to.as_deref() {
                Some(t) => w.rename(&path, t),
                None => Err(anyhow::anyhow!("missing target")),
            },
            "delete" => w.delete(&path),
            _ => Err(anyhow::anyhow!("unknown op {op}")),
        }
        .map_err(err)
    })
    .await
}

/// Find in Files (ripgrep engine locally; rg / git grep / grep over ssh).
#[tauri::command]
async fn search_workspace(
    state: State<'_, AppState>,
    id: String,
    query: String,
    case_sensitive: bool,
    regex: bool,
    whole_word: bool,
) -> Res<Vec<search::SearchHit>> {
    let w = ws(&state, &id)?;
    if query.is_empty() {
        return Ok(vec![]);
    }
    blocking(move || search::search(&w, &query, case_sensitive, regex, whole_word).map_err(err)).await
}

// ---- terminal -----------------------------------------------------------------

#[tauri::command]
fn pty_spawn(
    window: tauri::Window,
    state: State<'_, AppState>,
    id: Option<String>,
    cols: u16,
    rows: u16,
    on_data: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
    on_exit: tauri::ipc::Channel<Option<u32>>,
) -> Res<u32> {
    let w = match id {
        Some(id) => Some(ws(&state, &id)?),
        None => None,
    };
    state.ptys.spawn(window.label(), w.as_deref(), cols, rows, on_data, on_exit)
}

#[tauri::command]
fn pty_write(state: State<'_, AppState>, pid: u32, data: String) -> Res<()> {
    state.ptys.write(pid, data.as_bytes())
}

#[tauri::command]
fn pty_resize(state: State<'_, AppState>, pid: u32, cols: u16, rows: u16) -> Res<()> {
    state.ptys.resize(pid, cols, rows)
}

#[tauri::command]
fn pty_kill(state: State<'_, AppState>, pid: u32) {
    state.ptys.kill(pid)
}

fn themes_dir() -> Res<std::path::PathBuf> {
    let d = dirs::data_dir().ok_or("no data dir")?.join("marie").join("themes");
    std::fs::create_dir_all(&d).map_err(err)?;
    Ok(d)
}

#[derive(Serialize)]
struct ThemeFile {
    file: String,
    text: String,
}

/// User themes: every *.json in ~/Library/Application Support/marie/themes (VS Code theme format).
#[tauri::command]
fn list_custom_themes() -> Res<Vec<ThemeFile>> {
    let dir = themes_dir()?;
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir).map_err(err)?.flatten() {
        let p = e.path();
        if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("json")) {
            if let Ok(text) = std::fs::read_to_string(&p) {
                out.push(ThemeFile { file: p.file_name().unwrap().to_string_lossy().to_string(), text });
            }
        }
    }
    out.sort_by(|a, b| a.file.cmp(&b.file));
    Ok(out)
}

/// Copy theme files (or every *.json in given folders, e.g. an extension's themes/) into the themes dir.
#[tauri::command]
fn import_themes(paths: Vec<String>) -> Res<usize> {
    let dir = themes_dir()?;
    let mut n = 0;
    let mut copy = |p: &std::path::Path| -> Res<()> {
        if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("json")) {
            std::fs::copy(p, dir.join(p.file_name().unwrap())).map_err(err)?;
            n += 1;
        }
        Ok(())
    };
    for p in paths {
        let p = std::path::PathBuf::from(p);
        if p.is_dir() {
            for e in std::fs::read_dir(&p).map_err(err)?.flatten() {
                copy(&e.path())?;
            }
        } else {
            copy(&p)?;
        }
    }
    Ok(n)
}

#[tauri::command]
fn themes_dir_path() -> Res<String> {
    Ok(themes_dir()?.display().to_string())
}

/// Save a workspace file. If `expected` is given and the file on disk no longer matches it,
/// fail with "conflict" so the UI can ask before overwriting someone else's change.
#[tauri::command]
async fn write_file(
    state: State<'_, AppState>,
    id: String,
    path: String,
    text: String,
    expected: Option<String>,
    force: bool,
) -> Res<()> {
    let w = ws(&state, &id)?;
    blocking(move || {
        if !force {
            if let Some(exp) = expected {
                let current = w.read_many(&[path.clone()]).map_err(err)?.into_iter().next().flatten();
                if let Some(cur) = current {
                    if cur != exp.as_bytes() {
                        return Err("conflict".into());
                    }
                }
            }
        }
        w.write_file(&path, text.as_bytes()).map_err(err)
    })
    .await
}

/// Save to an absolute local path (Save As for untitled buffers).
#[tauri::command]
async fn write_abs(path: String, text: String) -> Res<()> {
    blocking(move || std::fs::write(&path, text).map_err(err)).await
}

/// Fuzzy file search over the cached file list (Rust side, so huge repos stay snappy).
#[tauri::command]
async fn find_files(state: State<'_, AppState>, id: String, query: String, limit: usize) -> Res<Vec<String>> {
    let files = state.files.lock().unwrap().get(&id).cloned().unwrap_or_default();
    blocking(move || {
        if query.trim().is_empty() {
            return Ok(files.iter().take(limit).cloned().collect());
        }
        let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
        let pattern = Pattern::parse(&query, CaseMatching::Smart, Normalization::Smart);
        let mut buf = Vec::new();
        let mut scored: Vec<(u32, &String)> = files
            .iter()
            .filter_map(|f| pattern.score(Utf32Str::new(f, &mut buf), &mut matcher).map(|s| (s, f)))
            .collect();
        scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.len().cmp(&b.1.len())));
        Ok(scored.into_iter().take(limit).map(|(_, f)| f.clone()).collect())
    })
    .await
}

#[tauri::command]
fn ssh_hosts() -> Vec<String> {
    workspace::ssh_hosts()
}

#[derive(Serialize)]
struct Launch {
    args: Vec<String>,
    cwd: String,
}

/// Launch arguments + cwd so the frontend can implement `marie [dir|diff ...]`.
// ---- windows ------------------------------------------------------------------

#[tauri::command]
fn new_window(app: tauri::AppHandle, folder: Option<String>) -> Res<String> {
    if let Some(f) = &folder {
        if windows::focus_existing(&app, f, "") {
            return Ok(String::new());
        }
    }
    windows::create(&app, folder.as_deref()).map_err(err)
}

/// Record which folder this window shows (None = empty window).
#[tauri::command]
fn set_window_folder(window: tauri::Window, state: State<'_, windows::Windows>, uri: Option<String>) {
    let mut m = state.folders.lock().unwrap();
    match uri {
        Some(u) => m.insert(window.label().to_string(), u),
        None => m.remove(window.label()),
    };
}

/// If `uri` is open in another window, focus that window and return true.
#[tauri::command]
fn focus_window_for(app: tauri::AppHandle, window: tauri::Window, uri: String) -> bool {
    windows::focus_existing(&app, &uri, window.label())
}

#[derive(Serialize)]
struct CliInstall {
    path: String,
    on_path: bool,
}

#[tauri::command]
async fn install_cli() -> Res<CliInstall> {
    blocking(|| cli::install(true).map(|(path, on_path)| CliInstall { path, on_path })).await
}

/// Folders from the previous session (main window, launched without arguments).
#[tauri::command]
fn take_session() -> Vec<String> {
    windows::take_session()
}

#[tauri::command]
fn launch_args() -> Launch {
    Launch {
        // macOS adds -psn_* when launched from Finder; drop it.
        args: std::env::args().skip(1).filter(|a| !a.starts_with("-psn")).collect(),
        cwd: std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default(),
    }
}

static QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch hands its args to this instance and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| cli::handle_second_launch(app, argv, cwd)))
        .setup(|_app| {
            cli::ensure_installed();
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .manage(windows::Windows::default())
        .menu(menu::build)
        .on_menu_event(menu::on_event)
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            list_files,
            read_file,
            git_status,
            repo_info,
            git_diff,
            git_fetch,
            find_files,
            write_file,
            write_abs,
            read_bytes,
            list_custom_themes,
            search_workspace,
            fs_op,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            import_themes,
            themes_dir_path,
            file_size,
            ssh_hosts,
            launch_args,
            new_window,
            set_window_folder,
            focus_window_for,
            take_session,
            install_cli,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label().to_string();
                // Shells belong to their window.
                window.app_handle().state::<AppState>().ptys.kill_owned_by(&label);
                // Closing a window (not quitting) forgets it for session restore.
                if !QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
                    window.app_handle().state::<windows::Windows>().folders.lock().unwrap().remove(&label);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Marie")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
                windows::save_session(&app.state::<windows::Windows>());
            }
        });
}
