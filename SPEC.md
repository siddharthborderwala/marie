# Marie — spec

A fast, keyboard-first macOS **code viewer and diff viewer**. Viewer first; editing is opt-in.
Personal use (ad-hoc signed, no notarization/auto-update for now).

## Stack

| Layer | Choice |
|---|---|
| Shell | Tauri v2 (system WKWebView, Rust backend) |
| Frontend | Vite + React + TypeScript |
| UI kit | shadcn (Base UI preset `b3ro5NR0Ou`) + Tailwind v4 |
| State | Zustand |
| Code / diff rendering | `@pierre/diffs` (`CodeView`, `parseDiffFromFile`, `parsePatchFiles`) |
| Highlighting | `@pierre/highlights` (WASM) via `preferredHighlighter`, Shiki fallback |
| File tree | `@pierre/trees` |
| Markdown | `@pierre/words` (`<Markdown mode="static">` + highlights plugin) |
| Palette | shadcn `Command` (cmdk) |

Rust owns everything outside the webview: filesystem, git, ssh, file index, fuzzy search.
The webview never touches disk or network directly.

## Core concepts

- **Workspace** = a root folder, local (`/path`) or remote (`ssh://host/path`).
  All workspace I/O goes through one `Workspace` provider in Rust with two backends:
  - `Local`: std fs + `git` CLI.
  - `Ssh`: system `ssh` with ControlMaster multiplexing (honours `~/.ssh/config`, agent, ProxyJump).
    Commands run remotely (`git ls-files`, `cat`, `git show`, `git diff --name-status`); nothing is installed on the host.
- **Tab** = file view | diff view | untitled scratch buffer.
- **Git is optional**: plain folders work; git features light up inside a repo.

## Features

### Viewing
- File tree (Trees) with git status decorations. Paths listed by Rust (`git ls-files -co --exclude-standard`, or a gitignore-aware walk for non-git).
- Open file → `CodeView` with highlighting. Large files (> 20 MB or > 300k lines): plain text, banner.
- Markdown files open **rendered** by default; toggle source with ⌘⇧V. Remote images blocked; relative images resolved through the workspace.
- Binary files: "binary file" placeholder.

### Diffs
- **Uncommitted** (default diff mode): working tree vs `HEAD`, filter all / staged / unstaged.
- **Branch diff** (⌘⇧B): worktree (committed + uncommitted) vs **merge-base** with base branch.
  Base auto-detected: `origin/HEAD` → `origin/main` → `origin/master` → `main` → `master`. Pickable per repo.
  Shows "fetched Xd ago"; fetch is manual, never automatic.
- **Compare two files**, **open .patch**, **compare scratch buffers / clipboard**.
- Rust ships full old/new contents; frontend builds diffs with `parseDiffFromFile` (full context expansion).
  `.patch` / pasted diffs use `parsePatchFiles` (view-only partial context).
- All changed files render in one scrolling `CodeView`; split / unified toggle; ignore-whitespace toggle; F7 / ⇧F7 next/prev change.
- Hunk separators: `line-info`. Do **not** combine a custom `renderGutterUtility` with `line-info` (WebKit bug 308027).

### Untitled scratch buffers
- Launch with no args → empty **Untitled-1** (editable). ⌘N opens another.
- Language auto-detect + picker. Looks like a diff → "View as diff" button (⌘⇧D), never auto-switch.
- Markdown → preview toggle. Unsaved scratch content restored on next launch (hot exit).

### Editing (default on)
- Marie is an editor: every working-copy file is editable, including the new side of diffs
  (Uncommitted / Unstaged / Branch). Committed / base / index sides stay read-only.
- ⌘S save, ⇧⌘S save as, ⌥⇧⌘S save all; dirty dot on tabs; close prompts if unsaved.
- Save checks the file on disk still matches what was loaded; otherwise asks before overwriting.
  Local writes are atomic (temp + rename, permissions kept); ssh writes go through a temp file + mv.
- Undo/redo menu items route to the focused Pierre editor.

### Media
- Images (png/jpg/gif/webp/avif/heic/…): fit / 1:1 / zoom (⌘-scroll, pinch), checker/dark/light background, dimensions + size.
- SVG renders as an image (scripts never run, loaded via `<img>`); ⇧⌘V flips to editable source.
- Audio and video play inline with duration / resolution info. Local files stream via the asset protocol; ssh files are fetched as bytes (≤ 200 MB).

### Settings (⌘,)
- Appearance (system / light / dark), dark theme, light theme.
- UI font + size (scales the whole interface), code font + size + line height, ligatures, wrap, diff layout.

### Command palette
- ⌘P: fuzzy file finder (Rust-side matching). `>` prefix switches to commands.
- ⌘⇧P: commands. ⌘G: go to line. Every command is defined once and exposed in palette + native menu with the same shortcut.

### Themes
- Separate light and dark theme, follows system appearance (override available).
- One theme drives everything: Pierre components (`theme: {light, dark}`), Trees (`themeToTreeStyles`), shadcn CSS variables (derived from the theme JSON's `colors`).
- Bundled: Pierre Light/Dark + a curated set of Shiki themes.

### Native shell
- Native macOS menu bar: Marie / File / Edit / View / Go / Git / Window / Help. **Edit menu must use Tauri predefined items** (copy/paste/select-all/undo) or clipboard shortcuts break in the webview.
- Session restore: open workspaces, tabs, scroll positions.
- Settings in `~/Library/Application Support/marie/settings.json`.

### CLI (`marie`)
```
marie                     # empty Untitled-1
marie .                   # open folder
marie a.ts b.ts           # compare two files
marie diff [base]         # branch diff of cwd (default auto base)
marie diff --uncommitted
marie ssh://host/path     # remote workspace
--wait                    # for git difftool
```
Installed via palette command "Install 'marie' command".

## MVP (this build)

In:
1. Tauri + Vite + React + shadcn scaffold, native menu with Edit menu.
2. Open local folder (dialog / CLI arg / palette) → Trees sidebar with git status.
3. File view via `CodeView` + highlights; markdown rendered via Words with source toggle.
4. Diff modes: Uncommitted and Branch diff vs auto base (merge-base), split/unified toggle.
5. Command palette: files (⌘P) + commands (⌘⇧P).
6. Themes: light/dark pairs, follow system, switch from palette; chrome derived from theme.
7. Untitled scratch buffer on launch, "View as diff" for pasted patches.
8. SSH workspace (read-only): `ssh://host/path` via palette "Connect via SSH…" listing `~/.ssh/config` hosts; tree, file view, diffs.

Later: editing, compare two files / clipboard, `.patch` open dialog, CLI install, hot exit, session restore,
file watching, worktree switcher, commit filter, KaTeX / Mermaid, large-file heuristics, remote helper binary.
