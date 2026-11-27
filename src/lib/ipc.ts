import { invoke } from "@tauri-apps/api/core"

export interface WorkspaceInfo {
  id: string
  name: string
  remote: boolean
  is_git: boolean
}

export interface FileData {
  text: string | null
  binary: boolean
  size: number
  too_large: boolean
}

export type GitStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "ignored"
export interface StatusEntry {
  path: string
  status: GitStatus
}

export type DiffMode = "uncommitted" | "staged" | "unstaged" | "branch"

export interface DiffFile {
  path: string
  old_path: string | null
  status: "added" | "modified" | "deleted" | "renamed"
  old: string | null
  new: string | null
  skipped: string | null
  old_key: string
  new_key: string
}

export interface DiffSet {
  mode: DiffMode
  base: string | null
  base_commit: string | null
  head: string | null
  files: DiffFile[]
  truncated: boolean
}

export interface RepoInfo {
  branch: string | null
  default_base: string | null
  branches: string[]
  fetched_ago: number | null
}

export const ipc = {
  openWorkspace: (uri: string) => invoke<WorkspaceInfo>("open_workspace", { uri }),
  listFiles: (id: string) => invoke<string[]>("list_files", { id }),
  readFile: (id: string, path: string) => invoke<FileData>("read_file", { id, path }),
  gitStatus: (id: string) => invoke<StatusEntry[]>("git_status", { id }),
  repoInfo: (id: string) => invoke<RepoInfo>("repo_info", { id }),
  gitDiff: (id: string, mode: DiffMode, base?: string | null) =>
    invoke<DiffSet>("git_diff", { id, mode, base: base ?? null }),
  gitFetch: (id: string) => invoke<void>("git_fetch", { id }),
  findFiles: (id: string, query: string, limit = 60) =>
    invoke<string[]>("find_files", { id, query, limit }),
  writeFile: (id: string, path: string, text: string, expected: string | null, force: boolean) =>
    invoke<void>("write_file", { id, path, text, expected, force }),
  writeAbs: (path: string, text: string) => invoke<void>("write_abs", { path, text }),
  readBytes: (id: string, path: string) => invoke<ArrayBuffer>("read_bytes", { id, path }),
  fileSize: (id: string, path: string) => invoke<number>("file_size", { id, path }),
  listCustomThemes: () => invoke<{ file: string; text: string }[]>("list_custom_themes"),
  importThemes: (paths: string[]) => invoke<number>("import_themes", { paths }),
  themesDir: () => invoke<string>("themes_dir_path"),
  sshHosts: () => invoke<string[]>("ssh_hosts"),
  launchArgs: () => invoke<{ args: string[]; cwd: string }>("launch_args"),
}

export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}
