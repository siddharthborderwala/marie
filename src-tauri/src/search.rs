//! Find in Files. Local: ripgrep's engine (grep-searcher + grep-regex) over ignore's parallel,
//! .gitignore-aware walker. Remote: `rg --json`-free plain output from rg if installed on the
//! host, else git grep / grep, parsed into the same shape.

use crate::workspace::{sh_quote, Location, Workspace};
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::UTF8, BinaryDetection, SearcherBuilder};
use grep_matcher::Matcher;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

pub const MAX_HITS: usize = 5000;

#[derive(Serialize, Clone)]
pub struct SearchHit {
    pub path: String,
    pub line: u32,
    pub col: u32,
    pub text: String,
}

fn clip(mut t: String) -> String {
    if t.len() > 400 {
        let mut cut = 400;
        while !t.is_char_boundary(cut) {
            cut -= 1;
        }
        t.truncate(cut);
    }
    t.trim_end_matches(['\n', '\r']).to_string()
}


pub fn search(ws: &Workspace, query: &str, case_sensitive: bool, regex: bool, whole_word: bool) -> anyhow::Result<Vec<SearchHit>> {
    match &ws.loc {
        Location::Local { root } => search_local(root, query, case_sensitive, regex, whole_word),
        Location::Ssh { .. } => search_remote(ws, query, case_sensitive, regex, whole_word),
    }
}

fn search_local(root: &std::path::Path, query: &str, cs: bool, regex: bool, word: bool) -> anyhow::Result<Vec<SearchHit>> {
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!cs)
        .word(word)
        .fixed_strings(!regex)
        .build(query)?;
    let hits = Arc::new(Mutex::new(Vec::new()));
    let count = Arc::new(AtomicUsize::new(0));
    let root = root.to_path_buf();

    ignore::WalkBuilder::new(&root).hidden(false).filter_entry(|e| e.file_name() != ".git").build_parallel().run(|| {
        let matcher = matcher.clone();
        let hits = hits.clone();
        let count = count.clone();
        let root = root.clone();
        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .binary_detection(BinaryDetection::quit(b'\x00'))
            .build();
        Box::new(move |entry| {
            if count.load(Ordering::Relaxed) >= MAX_HITS {
                return ignore::WalkState::Quit;
            }
            let Ok(entry) = entry else { return ignore::WalkState::Continue };
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                return ignore::WalkState::Continue;
            }
            let rel = entry.path().strip_prefix(&root).unwrap_or(entry.path()).to_string_lossy().to_string();
            let mut local = Vec::new();
            let _ = searcher.search_path(
                &matcher,
                entry.path(),
                UTF8(|line_no, line| {
                    let col = matcher.find(line.as_bytes()).ok().flatten().map(|m| m.start() as u32 + 1).unwrap_or(1);
                    local.push(SearchHit { path: rel.clone(), line: line_no as u32, col, text: clip(line.to_string()) });
                    Ok(count.fetch_add(1, Ordering::Relaxed) < MAX_HITS)
                }),
            );
            if !local.is_empty() {
                hits.lock().unwrap().extend(local);
            }
            ignore::WalkState::Continue
        })
    });

    let mut v = Arc::try_unwrap(hits).map(|m| m.into_inner().unwrap()).unwrap_or_default();
    v.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    v.truncate(MAX_HITS);
    Ok(v)
}

fn search_remote(ws: &Workspace, query: &str, cs: bool, regex: bool, word: bool) -> anyhow::Result<Vec<SearchHit>> {
    let q = sh_quote(query);
    let case = if cs { "" } else { "-i" };
    let w = if word { "-w" } else { "" };
    let fixed = if regex { "" } else { "-F" };
    let git = if ws.is_git { format!("git grep -n -I --column {case} {w} {} --untracked -e {q}", if regex { "-E" } else { "-F" }) } else { String::new() };
    let script = format!(
        "if command -v rg >/dev/null 2>&1; then rg -n --column --no-heading --color never {case} {w} {fixed} -e {q} .; \
         elif [ -n \"{has_git}\" ]; then {git}; \
         else grep -rnI {case} {w} {fixed2} --exclude-dir=.git --exclude-dir=node_modules -e {q} .; fi | head -n {MAX_HITS}",
        has_git = if ws.is_git { "1" } else { "" },
        fixed2 = if regex { "-E" } else { "-F" },
    );
    let (code, out, err) = ws.sh_status(&script, None)?;
    if code > 1 && out.is_empty() {
        anyhow::bail!("{}", String::from_utf8_lossy(&err).trim().to_string());
    }
    let text = String::from_utf8_lossy(&out);
    let mut hits = Vec::new();
    for l in text.lines() {
        // rg / git grep --column: path:line:col:text ; grep: path:line:text
        let mut it = l.splitn(4, ':');
        let (Some(path), Some(line)) = (it.next(), it.next()) else { continue };
        let Ok(line) = line.parse::<u32>() else { continue };
        let third = it.next().unwrap_or("");
        let (col, text) = match third.parse::<u32>() {
            Ok(c) => (c, it.next().unwrap_or("").to_string()),
            Err(_) => (1, match it.next() {
                Some(rest) => format!("{third}:{rest}"),
                None => third.to_string(),
            }),
        };
        hits.push(SearchHit { path: path.trim_start_matches("./").to_string(), line, col, text: clip(text) });
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    #[test]
    fn local_search_finds_itself() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let t = std::time::Instant::now();
        let hits = super::search_local(root, "fn search_local", true, false, false).unwrap();
        eprintln!("{} hits in {:?}", hits.len(), t.elapsed());
        assert!(hits.iter().any(|h| h.path.ends_with("search.rs")));
        let rx = super::search_local(root, r"fn \w+_local", true, true, false).unwrap();
        assert!(!rx.is_empty());
    }
}
