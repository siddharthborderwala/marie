import { create } from "zustand"
import { toast } from "sonner"
import { windowLabel, focusWindowFor, setWindowFolder } from "@/lib/win"
import { ipc, type DiffMode, type RepoInfo, type StatusEntry, type WorkspaceInfo } from "@/lib/ipc"

export type Appearance = "system" | "light" | "dark"

export type Tab =
  | { id: string; kind: "file"; path: string; title: string; mdSource?: boolean; preview?: boolean; lang?: string | null }
  | { id: string; kind: "diff"; title: string; mode: DiffMode; base: string | null; nonce: number }
  | { id: string; kind: "scratch"; title: string; lang: string | null }
  | { id: string; kind: "patch"; title: string; patch: string }

export type PaletteMode = "files" | "commands" | "line" | "ssh" | "theme" | "branch" | "lang"

interface Prefs {
  darkTheme: string
  lightTheme: string
  appearance: Appearance
  diffStyle: "split" | "unified"
  wrap: boolean
  sidebar: boolean
  uiFont: string
  uiFontSize: number
  codeFont: string
  codeFontSize: number
  codeLineHeight: number
  codeFontWeight: number
  ligatures: boolean
  indentGuides: boolean
}

interface State extends Prefs {
  workspace: WorkspaceInfo | null
  files: string[]
  loadingFiles: boolean
  status: StatusEntry[]
  repo: RepoInfo | null
  tabs: Tab[]
  activeId: string | null
  palette: { open: boolean; mode: PaletteMode }
  settingsOpen: boolean
  /** user themes from the themes folder (VS Code format, converted) */
  customThemes: { id: string; label: string; appearance: "dark" | "light" }[]
  themesReady: boolean
  terminal: { open: boolean; sessions: { id: string }[]; active: string | null; height: number }
  sideView: "explorer" | "search"
  searchNonce: number
  recentNonce: number
  /** recently closed tabs (for Reopen Closed Tab) and tab activation history (Back/Forward) */
  closedTabs: Tab[]
  history: string[]
  historyIndex: number
  systemDark: boolean
  /** scratch buffer contents, keyed by tab id (kept out of Tab so typing doesn't re-render tabs) */
  scratch: Record<string, string>
  /** unsaved editors, keyed by saver key (tab id, or `${tabId}::${path}` inside diffs) */
  dirty: Record<string, true>

  setPrefs(p: Partial<Prefs>): void
  openWorkspace(uri: string): Promise<void>
  closeWorkspace(): Promise<void>
  refresh(): Promise<void>
  openFile(path: string): void
  openDiff(mode: DiffMode, base?: string | null): void
  newScratch(text?: string): void
  openPatch(title: string, patch: string): void
  setScratch(id: string, text: string): void
  setDirty(key: string, dirty: boolean): void
  refreshStatus(): Promise<void>
  updateTab(id: string, patch: Partial<Tab>): void
  closeTab(id?: string, confirmed?: boolean): void
  activate(id: string): void
  cycleTab(dir: 1 | -1): void
  setSettingsOpen(open: boolean): void
  newTerminal(): void
  closeTerminal(id: string): void
  setTerminal(p: Partial<State["terminal"]>): void
  reopenClosedTab(): void
  goHistory(dir: -1 | 1): void
  openPalette(mode: PaletteMode): void
  closePalette(): void
}

const PREFS_KEY = "marie.prefs"
// Untitled buffers are per window (main keeps the original key for continuity).
const SCRATCH_KEY = windowLabel() === "main" ? "marie.scratch" : `marie.scratch.${windowLabel()}`
const RECENT_KEY = "marie.recent"

function readJSON<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? { ...fallback, ...JSON.parse(v) } : fallback
  } catch {
    return fallback
  }
}

const defaultPrefs: Prefs = {
  darkTheme: "pierre-dark",
  lightTheme: "pierre-light",
  appearance: "system",
  diffStyle: "split",
  wrap: false,
  sidebar: true,
  uiFont: "Geist Variable",
  uiFontSize: 13,
  codeFont: "Geist Mono Variable",
  codeFontSize: 12.5,
  codeLineHeight: 1.6,
  codeFontWeight: 400,
  ligatures: true,
  indentGuides: true,
}

/** New untitled buffers start as a page of 20 empty lines (trimmed again on save). */
export const BLANK_PAGE = ""
const isBlank = (t: string | undefined) => !t || t.trim() === ""

/** Trailing blank lines collapse to a single final newline (used when saving scratch buffers). */
export function trimTrailingBlankLines(t: string) {
  const trimmed = t.replace(/(?:[ \t]*\n)+[ \t]*$/, "")
  return trimmed.length ? trimmed + "\n" : ""
}

let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`

function untitledName(tabs: Tab[]) {
  let n = 1
  while (tabs.some((t) => t.kind === "scratch" && t.title === `Untitled-${n}`)) n++
  return `Untitled-${n}`
}

export function recentWorkspaces(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
  } catch {
    return []
  }
}
export function removeRecent(uri: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentWorkspaces().filter((u) => u !== uri)))
  } catch {
    /* ignore */
  }
}
function pushRecent(uri: string) {
  try {
    const list = [uri, ...recentWorkspaces().filter((u) => u !== uri)].slice(0, 12)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

// Restore scratch buffers (hot exit).
const savedScratch = readJSON<{ tabs: { id: string; title: string; lang: string | null; text: string }[] }>(SCRATCH_KEY, {
  tabs: [],
})
const restoredTabs: Tab[] = savedScratch.tabs
  .filter((t) => t.text.trim().length > 0)
  .map((t) => ({ id: t.id, kind: "scratch", title: t.title, lang: t.lang }))
const restoredText = Object.fromEntries(savedScratch.tabs.map((t) => [t.id, t.text]))

export { defaultPrefs }
export type { Prefs }

export const useStore = create<State>((set, get) => ({
  ...readJSON(PREFS_KEY, defaultPrefs),
  workspace: null,
  files: [],
  loadingFiles: false,
  status: [],
  repo: null,
  tabs: restoredTabs,
  activeId: restoredTabs[0]?.id ?? null,
  palette: { open: false, mode: "commands" },
  settingsOpen: false,
  customThemes: [],
  themesReady: false,
  terminal: { open: false, sessions: [], active: null, height: 280 },
  sideView: "explorer",
  searchNonce: 0,
  recentNonce: 0,
  closedTabs: [],
  history: [],
  historyIndex: -1,
  systemDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
  scratch: restoredText,
  dirty: {},

  setPrefs(p) {
    // Choosing a theme also switches to its mode (unless the caller sets appearance itself).
    if (p.appearance === undefined) {
      if (p.darkTheme && !p.lightTheme) p = { ...p, appearance: "dark" }
      else if (p.lightTheme && !p.darkTheme) p = { ...p, appearance: "light" }
    }
    set(p)
    const s = get()
    const prefs: Prefs = {
      darkTheme: s.darkTheme,
      lightTheme: s.lightTheme,
      appearance: s.appearance,
      diffStyle: s.diffStyle,
      wrap: s.wrap,
      sidebar: s.sidebar,
      uiFont: s.uiFont,
      uiFontSize: s.uiFontSize,
      codeFont: s.codeFont,
      codeFontSize: s.codeFontSize,
      codeLineHeight: s.codeLineHeight,
      codeFontWeight: s.codeFontWeight,
      ligatures: s.ligatures,
      indentGuides: s.indentGuides,
    }
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      /* ignore */
    }
  },

  async closeWorkspace() {
    const s = get()
    if (!s.workspace) return
    // Unsaved edits in workspace files? Ask once before dropping them.
    const dirtyWs = Object.keys(s.dirty).filter((k) => s.tabs.some((t) => t.kind !== "scratch" && (k === t.id || k.startsWith(`${t.id}::`))))
    if (dirtyWs.length) {
      const { confirmAction } = await import("@/components/PromptDialog")
      const ok = await confirmAction("Close folder with unsaved changes?", {
        description: `${dirtyWs.length} file${dirtyWs.length === 1 ? " has" : "s have"} unsaved changes that will be lost.`,
        confirmLabel: "Close Without Saving",
        danger: true,
      })
      if (!ok) return
    }
    // Keep untitled buffers that have content; everything else belongs to the folder.
    const keep = s.tabs.filter((t) => t.kind === "scratch" && !isBlank(s.scratch[t.id]))
    set({
      workspace: null,
      files: [],
      status: [],
      repo: null,
      loadingFiles: false,
      tabs: keep,
      activeId: keep[0]?.id ?? null,
      dirty: {},
      closedTabs: [],
      history: [],
      historyIndex: -1,
      sideView: "explorer",
      terminal: { ...s.terminal, open: false, sessions: [], active: null },
    })
    document.title = "Marie"
    void setWindowFolder(null, "Marie")
    // Start view: a fresh empty buffer, like VS Code's empty window.
    get().newScratch()
  },

  async openWorkspace(uri) {
    // Only surface progress when opening is slow (e.g. first ssh connection).
    let t: string | number | undefined
    const slow = window.setTimeout(() => (t = toast.loading(`Opening ${uri}…`)), 500)
    const done = () => {
      window.clearTimeout(slow)
      if (t !== undefined) toast.dismiss(t)
    }
    try {
      const info = await ipc.openWorkspace(uri)
      // Already open in another window? Bring that window forward instead of duplicating.
      if (info.id !== get().workspace?.id && (await focusWindowFor(info.id))) {
        done()
        return
      }
      void setWindowFolder(info.id, `${info.name} — Marie`)
      // Keep scratch tabs, drop tabs from the previous workspace.
      set((s) => ({
        workspace: info,
        files: [],
        status: [],
        repo: null,
        loadingFiles: true,
        tabs: s.tabs.filter((x) => x.kind === "scratch" && !isBlank(s.scratch[x.id])),
        activeId: null,
      }))
      pushRecent(info.id)
      document.title = `${info.name} — Marie`
      done()
      await get().refresh()
    } catch (e) {
      done()
      toast.error(String(e))
    }
  },

  async refresh() {
    const ws = get().workspace
    if (!ws) return
    set({ loadingFiles: true })
    const [files, status, repo] = await Promise.allSettled([
      ipc.listFiles(ws.id),
      ws.is_git ? ipc.gitStatus(ws.id) : Promise.resolve([]),
      ws.is_git ? ipc.repoInfo(ws.id) : Promise.resolve(null),
    ])
    if (get().workspace?.id !== ws.id) return
    set({
      files: files.status === "fulfilled" ? files.value : [],
      status: status.status === "fulfilled" ? status.value : [],
      repo: repo.status === "fulfilled" ? repo.value : null,
      loadingFiles: false,
      // bump diff tabs so they reload
      tabs: get().tabs.map((t) => (t.kind === "diff" ? { ...t, nonce: t.nonce + 1 } : t)),
    })
    if (files.status === "rejected") toast.error(String(files.reason))
  },

  openFile(path) {
    const s = get()
    const existing = s.tabs.find((t) => t.kind === "file" && t.path === path)
    if (existing) return set({ activeId: existing.id })
    const tab: Tab = { id: uid("file"), kind: "file", path, title: path.split("/").pop() ?? path }
    // Replace the active (preview-like) file tab if it's a plain file tab, VS Code "preview" style.
    set({ tabs: [...s.tabs, tab], activeId: tab.id })
  },

  openDiff(mode, base = null) {
    const s = get()
    if (!s.workspace?.is_git) {
      toast.error("Not a git repository")
      return
    }
    const existing = s.tabs.find((t) => t.kind === "diff")
    const title = mode === "branch" ? `Δ ${base ?? s.repo?.default_base ?? "base"}` : "Δ Uncommitted"
    if (existing && existing.kind === "diff") {
      return set({
        tabs: s.tabs.map((t) => (t.id === existing.id ? { ...existing, mode, base, title, nonce: existing.nonce + 1 } : t)),
        activeId: existing.id,
      })
    }
    const tab: Tab = { id: uid("diff"), kind: "diff", mode, base, title, nonce: 0 }
    set({ tabs: [...s.tabs, tab], activeId: tab.id })
  },

  newScratch(text = BLANK_PAGE) {
    const s = get()
    const tab: Tab = { id: uid("scratch"), kind: "scratch", title: untitledName(s.tabs), lang: null }
    set({ tabs: [...s.tabs, tab], activeId: tab.id, scratch: { ...s.scratch, [tab.id]: text } })
  },

  openPatch(title, patch) {
    const s = get()
    const tab: Tab = { id: uid("patch"), kind: "patch", title, patch }
    set({ tabs: [...s.tabs, tab], activeId: tab.id })
  },

  setScratch(id, text) {
    set((s) => ({ scratch: { ...s.scratch, [id]: text } }))
    persistScratch()
  },

  setDirty(key, dirty) {
    const cur = get().dirty
    if (!!cur[key] === dirty) return
    const next = { ...cur }
    if (dirty) next[key] = true
    else delete next[key]
    set({ dirty: next })
  },

  async refreshStatus() {
    const ws = get().workspace
    if (!ws?.is_git) return
    try {
      const status = await ipc.gitStatus(ws.id)
      if (get().workspace?.id === ws.id) set({ status })
    } catch {
      /* ignore */
    }
  },

  updateTab(id, patch) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) }))
    persistScratch()
  },

  closeTab(id, confirmed = false) {
    const s = get()
    const target = id ?? s.activeId
    if (!target) return
    const idx = s.tabs.findIndex((t) => t.id === target)
    if (idx < 0) return
    const tab = s.tabs[idx]
    const dirtyKeys = Object.keys(s.dirty).filter((k) => k === target || k.startsWith(`${target}::`))
    const needsConfirm = (tab.kind !== "scratch" && dirtyKeys.length > 0) || (tab.kind === "scratch" && !isBlank(s.scratch[tab.id]))
    if (needsConfirm && !confirmed) {
      // In-app confirm (async), then close again with confirmed = true.
      void import("@/components/PromptDialog").then(async ({ confirmAction }) => {
        const scratch = tab.kind === "scratch"
        const ok = await confirmAction(scratch ? `Discard ${tab.title}?` : `${tab.title} has unsaved changes`, {
          description: scratch ? "Its contents will be lost." : "Close without saving? Your changes will be lost.",
          confirmLabel: scratch ? "Discard" : "Don't Save",
          danger: true,
        })
        if (ok) get().closeTab(target, true)
      })
      return
    }
    const tabs = s.tabs.filter((t) => t.id !== target)
    const closedTabs = tab.kind === "scratch" ? s.closedTabs : [tab, ...s.closedTabs].slice(0, 20)
    const scratch = { ...s.scratch }
    delete scratch[target]
    const dirty = { ...s.dirty }
    for (const k of dirtyKeys) delete dirty[k]
    const activeId = s.activeId === target ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.activeId
    set({ tabs, activeId, scratch, dirty, closedTabs })
    persistScratch()
  },

  activate(id) {
    set({ activeId: id })
  },

  cycleTab(dir) {
    const s = get()
    if (!s.tabs.length) return
    const i = s.tabs.findIndex((t) => t.id === s.activeId)
    const next = s.tabs[(i + dir + s.tabs.length) % s.tabs.length]
    set({ activeId: next.id })
  },

  newTerminal() {
    const id = uid("term")
    set((s) => ({ terminal: { ...s.terminal, open: true, sessions: [...s.terminal.sessions, { id }], active: id } }))
  },
  closeTerminal(id) {
    set((s) => {
      const sessions = s.terminal.sessions.filter((x) => x.id !== id)
      const active = s.terminal.active === id ? (sessions.at(-1)?.id ?? null) : s.terminal.active
      return { terminal: { ...s.terminal, sessions, active, open: sessions.length ? s.terminal.open : false } }
    })
  },
  setTerminal(p) {
    set((s) => ({ terminal: { ...s.terminal, ...p } }))
  },
  reopenClosedTab() {
    const s = get()
    const [tab, ...rest] = s.closedTabs
    if (!tab) return
    if (tab.kind === "file") {
      set({ closedTabs: rest })
      get().openFile(tab.path)
      return
    }
    set({ closedTabs: rest, tabs: [...s.tabs, tab], activeId: tab.id })
  },
  goHistory(dir) {
    const s = get()
    let i = s.historyIndex + dir
    while (i >= 0 && i < s.history.length && !s.tabs.some((t) => t.id === s.history[i])) i += dir
    if (i < 0 || i >= s.history.length) return
    set({ historyIndex: i, activeId: s.history[i], navigating: true } as Partial<State>)
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },

  openPalette(mode) {
    set({ palette: { open: true, mode } })
  },
  closePalette() {
    set((s) => ({ palette: { ...s.palette, open: false } }))
  },
}))

let persistTimer: number | undefined
function persistScratch() {
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    const s = useStore.getState()
    const tabs = s.tabs
      .filter((t): t is Extract<Tab, { kind: "scratch" }> => t.kind === "scratch")
      .map((t) => ({ id: t.id, title: t.title, lang: t.lang, text: s.scratch[t.id] ?? "" }))
    try {
      localStorage.setItem(SCRATCH_KEY, JSON.stringify({ tabs }))
    } catch {
      /* ignore */
    }
  }, 400)
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  useStore.setState({ systemDark: e.matches })
})

export function useEffectiveDark() {
  return useStore((s) => (s.appearance === "system" ? s.systemDark : s.appearance === "dark"))
}

export function activeTab(): Tab | undefined {
  const s = useStore.getState()
  return s.tabs.find((t) => t.id === s.activeId)
}

// Dev-only handle for debugging in a browser.
if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore

// Back/Forward: record tab activations (skip moves caused by navigating the history itself).
useStore.subscribe((s, prev) => {
  if (s.activeId === prev.activeId || !s.activeId) return
  const st = s as State & { navigating?: boolean }
  if (st.navigating) {
    useStore.setState({ navigating: false } as Partial<State>)
    return
  }
  const history = [...s.history.slice(0, s.historyIndex + 1), s.activeId].slice(-50)
  useStore.setState({ history, historyIndex: history.length - 1 })
})

// Settings changed in another window → apply here too (localStorage is shared).
window.addEventListener("storage", (e) => {
  if (e.key !== PREFS_KEY || !e.newValue) return
  try {
    useStore.setState(JSON.parse(e.newValue))
  } catch {
    /* ignore */
  }
})
