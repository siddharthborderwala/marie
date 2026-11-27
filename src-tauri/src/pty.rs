//! Terminal sessions: a real PTY per terminal (local login shell, or `ssh -t` for remote
//! workspaces), streamed to the webview over a Tauri channel. Rendering happens in the
//! webview with ghostty-web (Ghostty's VT engine compiled to WASM).

use crate::workspace::{sh_quote, ssh_args, Location, Workspace};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

pub struct Session {
    owner: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Ptys {
    next: Mutex<u32>,
    sessions: Mutex<HashMap<u32, Arc<Mutex<Session>>>>,
}


fn user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
}

impl Ptys {
    pub fn spawn(
        &self,
        owner: &str,
        ws: Option<&Workspace>,
        cols: u16,
        rows: u16,
        out: Channel<InvokeResponseBody>,
        on_exit: Channel<Option<u32>>,
    ) -> Result<u32, String> {
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;

        let mut cmd = match ws.map(|w| &w.loc) {
            Some(Location::Ssh { host, root }) => {
                let mut c = CommandBuilder::new("ssh");
                for a in ssh_args(host, false) {
                    c.arg(a);
                }
                c.arg("-t");
                c.arg(host);
                c.arg(format!("cd {} 2>/dev/null; exec \"${{SHELL:-/bin/sh}}\" -l", sh_quote(root)));
                c
            }
            other => {
                let mut c = CommandBuilder::new(user_shell());
                c.arg("-l");
                match other {
                    Some(Location::Local { root }) => c.cwd(root),
                    _ => {
                        if let Some(h) = dirs::home_dir() {
                            c.cwd(h)
                        }
                    }
                }
                c
            }
        };
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "Marie");
        // Finder-launched apps get a minimal locale; make UTF-8 explicit.
        if std::env::var("LANG").is_err() {
            cmd.env("LANG", "en_US.UTF-8");
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let id = {
            let mut n = self.next.lock().unwrap();
            *n += 1;
            *n
        };
        let session = Arc::new(Mutex::new(Session { owner: owner.to_string(), master: pair.master, writer, child }));
        self.sessions.lock().unwrap().insert(id, session.clone());

        std::thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        // Raw bytes → ArrayBuffer on the JS side (no JSON encoding).
                        if out.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                            break;
                        }
                    }
                }
            }
            let code = session.lock().ok().and_then(|mut s| s.child.wait().ok()).map(|st| st.exit_code());
            let _ = on_exit.send(code);
        });
        Ok(id)
    }

    fn get(&self, id: u32) -> Result<Arc<Mutex<Session>>, String> {
        self.sessions.lock().unwrap().get(&id).cloned().ok_or_else(|| "no such terminal".into())
    }

    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), String> {
        let s = self.get(id)?;
        let mut s = s.lock().unwrap();
        s.writer.write_all(data).map_err(|e| e.to_string())?;
        s.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let s = self.get(id)?;
        let s = s.lock().unwrap();
        s.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    }

    /// Kill every shell started by a window (window closed).
    pub fn kill_owned_by(&self, owner: &str) {
        let ids: Vec<u32> = self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, s)| s.lock().map(|s| s.owner == owner).unwrap_or(false))
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            self.kill(id);
        }
    }

    pub fn kill(&self, id: u32) {
        if let Some(s) = self.sessions.lock().unwrap().remove(&id) {
            if let Ok(mut s) = s.lock() {
                let _ = s.child.kill();
            }
        }
    }
}
