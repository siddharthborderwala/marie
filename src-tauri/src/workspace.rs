//! Workspace providers: one API over a local folder or a remote folder reached via system `ssh`.

use anyhow::{anyhow, bail, Context, Result};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Files larger than this are not shipped to the webview as text.
pub const MAX_TEXT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug)]
pub enum Location {
    Local { root: PathBuf },
    Ssh { host: String, root: String },
}

#[derive(Clone, Debug)]
pub struct Workspace {
    pub uri: String,
    pub loc: Location,
    pub is_git: bool,
}

/// Single-quote a string for POSIX sh.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn control_path() -> String {
    // Unix socket paths are length-limited (~104 bytes on macOS); keep it short.
    "/tmp/marie-ssh-%C".to_string()
}

/// Common ssh options (connection sharing etc). `batch` disables interactive prompts,
/// which is right for background commands but not for an interactive terminal.
pub fn ssh_args(_host: &str, batch: bool) -> Vec<String> {
    let mut v: Vec<String> = vec![
        "-o".into(),
        "ControlMaster=auto".into(),
        "-o".into(),
        format!("ControlPath={}", control_path()),
        "-o".into(),
        "ControlPersist=10m".into(),
        "-o".into(),
        // On-demand hosts (VMs that wake on connect) can take a while on first contact.
        "ConnectTimeout=30".into(),
        "-o".into(),
        "ServerAliveInterval=15".into(),
    ];
    if batch {
        v.push("-o".into());
        v.push("BatchMode=yes".into());
    }
    v
}

fn ssh_base(host: &str) -> Command {
    let mut c = Command::new("ssh");
    c.args(ssh_args(host, true)).arg(host);
    c
}

impl Workspace {
    pub fn open(uri: &str) -> Result<Self> {
        let loc = parse_uri(uri)?;
        let uri = match &loc {
            Location::Local { root } => root.display().to_string(),
            Location::Ssh { .. } => uri.to_string(),
        };
        let mut ws = Workspace { uri, loc, is_git: false };
        // Verify the root exists and detect git in one round trip.
        // ssh exits 255 on connection failure: retry once, since the first connection
        // to a sleeping host often times out while it boots.
        const PROBE: &str = "test -d . && (git rev-parse --is-inside-work-tree 2>/dev/null || echo nogit)";
        let (mut code, mut out, mut errb) = ws.sh_status(PROBE, None)?;
        if code == 255 && ws.is_remote() {
            (code, out, errb) = ws.sh_status(PROBE, None)?;
        }
        if code != 0 {
            let msg = String::from_utf8_lossy(&errb).trim().to_string();
            bail!("{}", if msg.is_empty() { "folder not found".to_string() } else { msg });
        }
        let probe = out;
        ws.is_git = String::from_utf8_lossy(&probe).trim() == "true";
        Ok(ws)
    }

    pub fn name(&self) -> String {
        match &self.loc {
            Location::Local { root } => root
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| root.display().to_string()),
            Location::Ssh { host, root } => {
                // Home folder is stored as "." (ssh starts there) → show just the host.
                let base = root.trim_end_matches('/').rsplit('/').next().unwrap_or(root);
                if root == "." || base.is_empty() {
                    host.clone()
                } else {
                    format!("{base} · {host}")
                }
            }
        }
    }

    pub fn is_remote(&self) -> bool {
        matches!(self.loc, Location::Ssh { .. })
    }

    /// Run a shell snippet with the workspace root as cwd. Fails on non-zero exit.
    pub fn sh(&self, script: &str, stdin: Option<&[u8]>) -> Result<Vec<u8>> {
        let (code, out, err) = self.sh_status(script, stdin)?;
        if code != 0 {
            bail!("{}", String::from_utf8_lossy(&err).trim().to_string());
        }
        Ok(out)
    }

    /// Run a shell snippet, returning (exit code, stdout, stderr).
    pub fn sh_status(&self, script: &str, stdin: Option<&[u8]>) -> Result<(i32, Vec<u8>, Vec<u8>)> {
        let mut cmd = match &self.loc {
            Location::Local { root } => {
                let mut c = Command::new("/bin/sh");
                c.arg("-c").arg(script).current_dir(root);
                c
            }
            Location::Ssh { host, root } => {
                let mut c = ssh_base(host);
                c.arg(format!("cd {} && {}", sh_quote(root), script));
                c
            }
        };
        cmd.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().context("failed to spawn process")?;
        if let Some(data) = stdin {
            let mut si = child.stdin.take().unwrap();
            let data = data.to_vec();
            // Write on a thread so large inputs can't deadlock against stdout.
            std::thread::spawn(move || {
                let _ = si.write_all(&data);
            });
        }
        let out = child.wait_with_output()?;
        Ok((out.status.code().unwrap_or(-1), out.stdout, out.stderr))
    }

    /// git with argv (quoted for the remote shell).
    pub fn git(&self, args: &[&str], stdin: Option<&[u8]>) -> Result<Vec<u8>> {
        let script = std::iter::once("git".to_string())
            .chain(args.iter().map(|a| sh_quote(a)))
            .collect::<Vec<_>>()
            .join(" ");
        self.sh(&script, stdin)
    }

    pub fn git_ok(&self, args: &[&str]) -> Option<String> {
        self.git(args, None).ok().map(|b| String::from_utf8_lossy(&b).trim().to_string())
    }

    fn local_root(&self) -> Option<&Path> {
        match &self.loc {
            Location::Local { root } => Some(root),
            _ => None,
        }
    }

    /// All files, relative paths, respecting .gitignore.
    pub fn list_files(&self) -> Result<Vec<String>> {
        let mut files: Vec<String> = if self.is_git {
            let out = self.git(&["ls-files", "-z", "-co", "--exclude-standard"], None)?;
            out.split(|b| *b == 0)
                .filter(|s| !s.is_empty())
                .map(|s| String::from_utf8_lossy(s).to_string())
                .collect()
        } else if let Some(root) = self.local_root() {
            let mut v = Vec::new();
            for e in ignore::WalkBuilder::new(root).hidden(false).build().flatten() {
                if e.file_type().is_some_and(|t| t.is_file()) {
                    if let Ok(rel) = e.path().strip_prefix(root) {
                        let s = rel.to_string_lossy().to_string();
                        if !s.starts_with(".git/") {
                            v.push(s);
                        }
                    }
                }
                if v.len() > 300_000 {
                    break;
                }
            }
            v
        } else {
            let out = self.sh(
                "find . -type d \\( -name .git -o -name node_modules -o -name target -o -name .venv \\) -prune -o -type f -print0 2>/dev/null | head -c 64000000",
                None,
            )?;
            out.split(|b| *b == 0)
                .filter(|s| !s.is_empty())
                .map(|s| String::from_utf8_lossy(s).trim_start_matches("./").to_string())
                .collect()
        };
        // Deleted-but-tracked files still show in ls-files -c; drop ones missing locally.
        if self.is_git {
            if let Some(root) = self.local_root() {
                files.retain(|f| root.join(f).exists());
            }
        }
        files.sort_unstable();
        files.dedup();
        Ok(files)
    }

    /// Read one working-tree file.
    pub fn read_file(&self, rel: &str) -> Result<Vec<u8>> {
        check_rel(rel)?;
        match &self.loc {
            Location::Local { root } => {
                let p = root.join(rel);
                let meta = std::fs::metadata(&p)?;
                if meta.len() as usize > MAX_TEXT_BYTES {
                    bail!("too-large:{}", meta.len());
                }
                Ok(std::fs::read(p)?)
            }
            Location::Ssh { .. } => {
                let out = self.read_many(&[rel.to_string()])?;
                out.into_iter().next().flatten().ok_or_else(|| anyhow!("file not found"))
            }
        }
    }

    /// Read a file of any size up to `max` bytes.
    pub fn read_bytes(&self, rel: &str, max: u64) -> Result<Vec<u8>> {
        check_rel(rel)?;
        let size = self.file_size(rel)?;
        if size > max {
            bail!("file is too large to preview ({} MB)", size / 1024 / 1024);
        }
        match &self.loc {
            Location::Local { root } => Ok(std::fs::read(root.join(rel))?),
            Location::Ssh { .. } => self.sh(&format!("cat -- {}", sh_quote(rel)), None),
        }
    }

    pub fn file_size(&self, rel: &str) -> Result<u64> {
        check_rel(rel)?;
        match &self.loc {
            Location::Local { root } => Ok(std::fs::metadata(root.join(rel))?.len()),
            Location::Ssh { .. } => {
                let out = self.sh(&format!("wc -c < {}", sh_quote(rel)), None)?;
                Ok(String::from_utf8_lossy(&out).trim().parse()?)
            }
        }
    }

    /// Write a working-tree file (atomic rename locally; `cat >` remotely).
    pub fn write_file(&self, rel: &str, data: &[u8]) -> Result<()> {
        check_rel(rel)?;
        match &self.loc {
            Location::Local { root } => {
                let p = root.join(rel);
                let tmp = p.with_file_name(format!(
                    ".{}.marie-tmp",
                    p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
                ));
                std::fs::write(&tmp, data)?;
                // Keep the original file's permissions (e.g. executable scripts).
                if let Ok(meta) = std::fs::metadata(&p) {
                    let _ = std::fs::set_permissions(&tmp, meta.permissions());
                }
                std::fs::rename(&tmp, &p).or_else(|e| {
                    let _ = std::fs::remove_file(&tmp);
                    Err(e)
                })?;
                Ok(())
            }
            Location::Ssh { .. } => {
                let q = sh_quote(rel);
                // Write through a temp file then mv, so a dropped connection never truncates the file.
                let script = format!(
                    "t={q}.marie-tmp.$$; cat > \"$t\" && {{ chmod --reference={q} \"$t\" 2>/dev/null || chmod $(stat -f %Lp {q} 2>/dev/null || echo 644) \"$t\"; }}; mv -f \"$t\" {q}"
                );
                self.sh(&script, Some(data))?;
                Ok(())
            }
        }
    }

    // ---- file operations (Explorer context menu) ----

    pub fn create_file(&self, rel: &str) -> Result<()> {
        check_rel(rel)?;
        match &self.loc {
            Location::Local { root } => {
                let p = root.join(rel);
                if let Some(parent) = p.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::OpenOptions::new().write(true).create_new(true).open(p)?;
                Ok(())
            }
            Location::Ssh { .. } => {
                let q = sh_quote(rel);
                self.sh(&format!("if [ -e {q} ]; then echo 'already exists' >&2; exit 3; fi; mkdir -p \"$(dirname {q})\" && : > {q}"), None)?;
                Ok(())
            }
        }
    }

    pub fn create_dir(&self, rel: &str) -> Result<()> {
        check_rel(rel)?;
        match &self.loc {
            Location::Local { root } => Ok(std::fs::create_dir_all(root.join(rel))?),
            Location::Ssh { .. } => {
                self.sh(&format!("mkdir -p {}", sh_quote(rel)), None)?;
                Ok(())
            }
        }
    }

    pub fn rename(&self, from: &str, to: &str) -> Result<()> {
        check_rel(from)?;
        check_rel(to)?;
        match &self.loc {
            Location::Local { root } => {
                let dest = root.join(to);
                if dest.exists() {
                    bail!("{to} already exists");
                }
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                Ok(std::fs::rename(root.join(from), dest)?)
            }
            Location::Ssh { .. } => {
                let (f, t) = (sh_quote(from), sh_quote(to));
                self.sh(&format!("if [ -e {t} ]; then echo 'already exists' >&2; exit 3; fi; mkdir -p \"$(dirname {t})\" && mv {f} {t}"), None)?;
                Ok(())
            }
        }
    }

    /// Local: move to the macOS Trash (recoverable, like VS Code). Remote: rm -rf.
    pub fn delete(&self, rel: &str) -> Result<()> {
        check_rel(rel)?;
        if rel.trim_matches('/').is_empty() {
            bail!("refusing to delete the workspace root");
        }
        match &self.loc {
            Location::Local { root } => {
                trash::delete(root.join(rel)).map_err(|e| anyhow!("{e}"))?;
                Ok(())
            }
            Location::Ssh { .. } => {
                self.sh(&format!("rm -rf -- {}", sh_quote(rel)), None)?;
                Ok(())
            }
        }
    }

    /// Read many working-tree files in one round trip. `None` = missing or too large.
    pub fn read_many(&self, rels: &[String]) -> Result<Vec<Option<Vec<u8>>>> {
        if let Some(root) = self.local_root() {
            return Ok(rels
                .iter()
                .map(|r| {
                    let p = root.join(r);
                    match std::fs::metadata(&p) {
                        Ok(m) if m.is_file() && (m.len() as usize) <= MAX_TEXT_BYTES => std::fs::read(p).ok(),
                        _ => None,
                    }
                })
                .collect());
        }
        if rels.is_empty() {
            return Ok(vec![]);
        }
        // Remote: NUL-separated paths on stdin; output is "<size>\n<bytes>" or "-1\n" per path.
        let script = format!(
            "while IFS= read -r -d '' f; do if [ -f \"$f\" ]; then s=$(wc -c < \"$f\" | tr -d ' '); if [ \"$s\" -le {MAX_TEXT_BYTES} ]; then echo \"$s\"; cat -- \"$f\"; else echo -1; fi; else echo -1; fi; done"
        );
        let mut input = Vec::new();
        for r in rels {
            check_rel(r)?;
            input.extend_from_slice(r.as_bytes());
            input.push(0);
        }
        let out = self.sh(&format!("bash -c {}", sh_quote(&script)), Some(&input))?;
        let mut res = Vec::with_capacity(rels.len());
        let mut i = 0;
        for _ in rels {
            let nl = out[i..].iter().position(|b| *b == b'\n').ok_or_else(|| anyhow!("bad remote read"))? + i;
            let n: i64 = std::str::from_utf8(&out[i..nl])?.trim().parse()?;
            i = nl + 1;
            if n < 0 {
                res.push(None);
            } else {
                let n = n as usize;
                res.push(Some(out[i..i + n].to_vec()));
                i += n;
            }
        }
        Ok(res)
    }

    /// Read many git objects ("rev:path") in one `git cat-file --batch` call.
    pub fn cat_objects(&self, specs: &[String]) -> Result<Vec<Option<Vec<u8>>>> {
        if specs.is_empty() {
            return Ok(vec![]);
        }
        let input: Vec<u8> = specs.iter().flat_map(|s| format!("{s}\n").into_bytes()).collect();
        let out = self.git(&["cat-file", "--batch"], Some(&input))?;
        let mut res = Vec::with_capacity(specs.len());
        let mut i = 0;
        for _ in specs {
            let nl = out[i..].iter().position(|b| *b == b'\n').ok_or_else(|| anyhow!("bad cat-file output"))? + i;
            let header = std::str::from_utf8(&out[i..nl])?;
            i = nl + 1;
            let parts: Vec<&str> = header.split(' ').collect();
            if parts.len() == 3 && parts[1] == "blob" {
                let n: usize = parts[2].parse()?;
                res.push(if n <= MAX_TEXT_BYTES { Some(out[i..i + n].to_vec()) } else { None });
                i += n + 1; // content + trailing LF
            } else {
                res.push(None); // "missing" / "ambiguous" etc.
            }
        }
        Ok(res)
    }
}

pub fn check_rel(rel: &str) -> Result<()> {
    if rel.starts_with('/') || rel.split('/').any(|c| c == "..") {
        bail!("path escapes workspace: {rel}");
    }
    Ok(())
}

/// `ssh://host/abs/path`, `ssh://host/~/path`, `host:path`-style is not accepted; everything else is local.
pub fn parse_uri(uri: &str) -> Result<Location> {
    if let Some(rest) = uri.strip_prefix("ssh://") {
        let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
        if host.is_empty() {
            bail!("missing host in {uri}");
        }
        let root = if path.is_empty() || path == "~" {
            "~".to_string()
        } else if let Some(p) = path.strip_prefix("~/") {
            format!("~/{p}")
        } else {
            format!("/{path}")
        };
        // `~` must not be quoted; replace with $HOME-relative cd target.
        let root = if root == "~" { ".".into() } else if let Some(p) = root.strip_prefix("~/") { p.to_string() } else { root };
        return Ok(Location::Ssh { host: host.to_string(), root });
    }
    let p = PathBuf::from(shellexpand_home(uri));
    let p = p.canonicalize().with_context(|| format!("cannot open {uri}"))?;
    if !p.is_dir() {
        bail!("{uri} is not a folder");
    }
    Ok(Location::Local { root: p })
}

fn shellexpand_home(s: &str) -> String {
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(h) = dirs::home_dir() {
            return h.join(rest).display().to_string();
        }
    }
    s.to_string()
}

/// Host aliases from ~/.ssh/config (no wildcards), following simple Include lines.
pub fn ssh_hosts() -> Vec<String> {
    let mut hosts = Vec::new();
    let Some(home) = dirs::home_dir() else { return hosts };
    let mut queue = vec![home.join(".ssh/config")];
    let mut seen = 0;
    while let Some(path) = queue.pop() {
        seen += 1;
        if seen > 32 {
            break;
        }
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        for line in text.lines() {
            let line = line.trim();
            let mut it = line.splitn(2, |c: char| c.is_whitespace() || c == '=');
            let key = it.next().unwrap_or("").to_ascii_lowercase();
            let val = it.next().unwrap_or("").trim();
            match key.as_str() {
                "host" => {
                    for h in val.split_whitespace() {
                        if !h.contains(['*', '?', '!']) && !hosts.iter().any(|x| x == h) {
                            hosts.push(h.to_string());
                        }
                    }
                }
                "include" => {
                    for inc in val.split_whitespace() {
                        let p = if inc.starts_with('/') {
                            PathBuf::from(inc)
                        } else if let Some(r) = inc.strip_prefix("~/") {
                            home.join(r)
                        } else {
                            home.join(".ssh").join(inc)
                        };
                        // Only literal includes (no glob support).
                        if !p.to_string_lossy().contains('*') {
                            queue.push(p);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    hosts
}
