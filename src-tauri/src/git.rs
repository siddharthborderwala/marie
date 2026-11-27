//! Git queries for diff modes. All heavy lifting is batched into a handful of git calls
//! so that remote (ssh) workspaces stay fast.

use crate::workspace::Workspace;
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_DIFF_FILES: usize = 2000;

#[derive(Serialize, Clone)]
pub struct StatusEntry {
    pub path: String,
    pub status: &'static str,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum DiffMode {
    Uncommitted,
    Staged,
    Unstaged,
    Branch,
}

#[derive(Serialize)]
pub struct DiffFile {
    pub path: String,
    pub old_path: Option<String>,
    /// added | modified | deleted | renamed
    pub status: String,
    pub old: Option<String>,
    pub new: Option<String>,
    /// binary or too large to show
    pub skipped: Option<String>,
    /// identity of old/new content for render caching
    pub old_key: String,
    pub new_key: String,
}

#[derive(Serialize)]
pub struct DiffSet {
    pub mode: String,
    pub base: Option<String>,
    pub base_commit: Option<String>,
    pub head: Option<String>,
    pub files: Vec<DiffFile>,
    pub truncated: bool,
}

#[derive(Serialize)]
pub struct RepoInfo {
    pub branch: Option<String>,
    pub default_base: Option<String>,
    pub branches: Vec<String>,
    /// seconds since last fetch (FETCH_HEAD mtime), if known
    pub fetched_ago: Option<i64>,
}

pub fn status(ws: &Workspace) -> Result<Vec<StatusEntry>> {
    let out = ws.git(&["status", "--porcelain=v1", "-z", "--untracked-files=all"], None)?;
    let mut res = Vec::new();
    let mut parts = out.split(|b| *b == 0).filter(|s| !s.is_empty());
    while let Some(rec) = parts.next() {
        if rec.len() < 4 {
            continue;
        }
        let (x, y) = (rec[0], rec[1]);
        let path = String::from_utf8_lossy(&rec[3..]).to_string();
        let status = match (x, y) {
            (b'?', b'?') => "untracked",
            (b'!', b'!') => "ignored",
            (b'R', _) | (_, b'R') => {
                parts.next(); // original path
                "renamed"
            }
            (b'A', _) => "added",
            (b'D', _) | (_, b'D') => "deleted",
            _ => "modified",
        };
        res.push(StatusEntry { path, status });
    }
    Ok(res)
}

pub fn repo_info(ws: &Workspace) -> Result<RepoInfo> {
    // One round trip for everything.
    let script = "git symbolic-ref --short -q HEAD; echo '\x1e'; \
        git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null; echo '\x1e'; \
        git for-each-ref --format='%(refname:short)' refs/heads refs/remotes; echo '\x1e'; \
        f=\"$(git rev-parse --git-common-dir)/FETCH_HEAD\"; if [ -f \"$f\" ]; then echo $(( $(date +%s) - $(stat -c %Y \"$f\" 2>/dev/null || stat -f %m \"$f\") )); fi";
    let out = String::from_utf8_lossy(&ws.sh(script, None)?).to_string();
    let sec: Vec<&str> = out.split('\x1e').map(|s| s.trim()).collect();
    let branch = sec.first().filter(|s| !s.is_empty()).map(|s| s.to_string());
    let branches: Vec<String> = sec
        .get(2)
        .map(|s| s.lines().filter(|l| !l.is_empty() && !l.ends_with("/HEAD") && *l != "origin").map(String::from).collect())
        .unwrap_or_default();
    let mut default_base = sec.get(1).filter(|s| !s.is_empty()).map(|s| s.to_string());
    if default_base.is_none() {
        for cand in ["origin/main", "origin/master", "main", "master"] {
            if branches.iter().any(|b| b == cand) {
                default_base = Some(cand.to_string());
                break;
            }
        }
    }
    let fetched_ago = sec.get(3).and_then(|s| s.parse().ok());
    Ok(RepoInfo { branch, default_base, branches, fetched_ago })
}

struct Change {
    status: char,
    path: String,
    old_path: Option<String>,
}

fn parse_name_status(out: &[u8]) -> Vec<Change> {
    let mut res = Vec::new();
    let mut it = out.split(|b| *b == 0).filter(|s| !s.is_empty()).map(|s| String::from_utf8_lossy(s).to_string());
    while let Some(code) = it.next() {
        let c = code.chars().next().unwrap_or('M');
        if c == 'R' || c == 'C' {
            let (Some(from), Some(to)) = (it.next(), it.next()) else { break };
            res.push(Change { status: c, path: to, old_path: Some(from) });
        } else {
            let Some(p) = it.next() else { break };
            res.push(Change { status: c, path: p, old_path: None });
        }
    }
    res
}

fn looks_binary(b: &[u8]) -> bool {
    b.iter().take(8000).any(|c| *c == 0)
}

fn to_text(b: Option<Vec<u8>>, skipped: &mut Option<String>) -> Option<String> {
    let b = b?;
    if looks_binary(&b) {
        *skipped = Some("binary".into());
        return None;
    }
    Some(String::from_utf8_lossy(&b).into_owned())
}

pub fn diff(ws: &Workspace, mode: DiffMode, base: Option<String>) -> Result<DiffSet> {
    if !ws.is_git {
        bail!("not a git repository");
    }
    let head = ws.git_ok(&["rev-parse", "--verify", "-q", "HEAD"]).filter(|s| !s.is_empty());
    let head_ref = head.clone().unwrap_or_else(|| EMPTY_TREE.to_string());

    // (old side revision for cat-file; None = index ":path"), new side: working tree or index
    let (old_rev, new_from_index, base_label, base_commit): (Option<String>, bool, Option<String>, Option<String>) = match mode {
        DiffMode::Uncommitted => (Some(head_ref.clone()), false, Some("HEAD".into()), head.clone()),
        DiffMode::Staged => (Some(head_ref.clone()), true, Some("HEAD".into()), head.clone()),
        DiffMode::Unstaged => (None, false, Some("index".into()), None),
        DiffMode::Branch => {
            let base = match base {
                Some(b) => b,
                None => repo_info(ws)?.default_base.ok_or_else(|| anyhow::anyhow!("no base branch found (origin/main, main, …)"))?,
            };
            let mb = ws
                .git_ok(&["merge-base", &base, "HEAD"])
                .filter(|s| !s.is_empty())
                .ok_or_else(|| anyhow::anyhow!("no merge-base between {base} and HEAD"))?;
            (Some(mb.clone()), false, Some(base), Some(mb))
        }
    };

    let mut args: Vec<&str> = vec!["diff", "--name-status", "-z", "-M", "--no-ext-diff"];
    let old_rev_s;
    match mode {
        DiffMode::Staged => {
            args.push("--cached");
            old_rev_s = head_ref.clone();
            args.push(&old_rev_s);
        }
        DiffMode::Unstaged => {}
        _ => {
            old_rev_s = old_rev.clone().unwrap();
            args.push(&old_rev_s);
        }
    }
    let mut changes = parse_name_status(&ws.git(&args, None)?);

    if !matches!(mode, DiffMode::Staged) {
        let untracked = ws.git(&["ls-files", "-z", "--others", "--exclude-standard"], None)?;
        for p in untracked.split(|b| *b == 0).filter(|s| !s.is_empty()) {
            changes.push(Change { status: 'A', path: String::from_utf8_lossy(p).to_string(), old_path: None });
        }
    }
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    let truncated = changes.len() > MAX_DIFF_FILES;
    changes.truncate(MAX_DIFF_FILES);

    // Batch old sides.
    let old_specs: Vec<String> = changes
        .iter()
        .map(|c| {
            let p = c.old_path.as_deref().unwrap_or(&c.path);
            match &old_rev {
                Some(r) => format!("{r}:{p}"),
                None => format!(":{p}"),
            }
        })
        .collect();
    let need_old: Vec<usize> = (0..changes.len()).filter(|&i| changes[i].status != 'A').collect();
    let old_blobs = ws.cat_objects(&need_old.iter().map(|&i| old_specs[i].clone()).collect::<Vec<_>>())?;
    let mut old_map: Vec<Option<Vec<u8>>> = vec![None; changes.len()];
    for (k, &i) in need_old.iter().enumerate() {
        old_map[i] = old_blobs[k].clone();
    }

    // Batch new sides.
    let need_new: Vec<usize> = (0..changes.len()).filter(|&i| changes[i].status != 'D').collect();
    let new_blobs = if new_from_index {
        ws.cat_objects(&need_new.iter().map(|&i| format!(":{}", changes[i].path)).collect::<Vec<_>>())?
    } else {
        ws.read_many(&need_new.iter().map(|&i| changes[i].path.clone()).collect::<Vec<_>>())?
    };
    let mut new_map: Vec<Option<Vec<u8>>> = vec![None; changes.len()];
    for (k, &i) in need_new.iter().enumerate() {
        new_map[i] = new_blobs[k].clone();
    }

    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let files = changes
        .into_iter()
        .enumerate()
        .map(|(i, c)| {
            let mut skipped = None;
            let had_old = old_map[i].is_some();
            let had_new = new_map[i].is_some();
            let old = to_text(old_map[i].take(), &mut skipped);
            let new = to_text(new_map[i].take(), &mut skipped);
            if skipped.is_none() && ((c.status != 'A' && !had_old) || (c.status != 'D' && !had_new)) {
                skipped = Some("too large or unreadable".into());
            }
            let status = match c.status {
                'A' => "added",
                'D' => "deleted",
                'R' | 'C' => "renamed",
                _ => "modified",
            }
            .to_string();
            DiffFile {
                old_key: format!("{}#old", old_specs[i]),
                new_key: format!("{}#{}", c.path, stamp),
                path: c.path,
                old_path: c.old_path,
                status,
                old,
                new,
                skipped,
            }
        })
        .collect();

    Ok(DiffSet {
        mode: format!("{mode:?}").to_lowercase(),
        base: base_label,
        base_commit,
        head,
        files,
        truncated,
    })
}
