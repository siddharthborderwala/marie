import { open, save } from "@tauri-apps/plugin-dialog"
import { editorUndo, saveAll, saveTab } from "@/lib/editing"
import { newWindow } from "@/lib/win"
import { checkForUpdates } from "@/lib/updater"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
import { activeTab, trimTrailingBlankLines, useStore } from "@/store"
import { ipc } from "@/lib/ipc"
import { looksLikeDiff } from "@/lib/views"

export interface Command {
  id: string
  title: string
  group: string
  /** display only; real accelerators live in the native menu (src-tauri/src/menu.rs) */
  shortcut?: string
  when?: () => boolean
  run: () => void | Promise<void>
}

const S = () => useStore.getState()
const hasGit = () => !!S().workspace?.is_git

export async function openFolderDialog() {
  const dir = await open({ directory: true, multiple: false, title: "Open Folder" })
  if (typeof dir === "string") await S().openWorkspace(dir)
}

export const commands: Command[] = [
  { id: "file.newUntitled", group: "File", title: "New Untitled", shortcut: "⌘N", run: () => S().newScratch() },
  { id: "file.openFolder", group: "File", title: "Open Folder…", shortcut: "⌘O", run: openFolderDialog },
  {
    id: "app.installCli",
    group: "Shell Command",
    title: "Install 'marie' Command in PATH",
    run: async () => {
      try {
        const r = await invoke<{ path: string; on_path: boolean }>("install_cli")
        if (r.on_path) toast.success("Installed 'marie'", { description: `${r.path} — try \`marie .\`` })
        else
          toast.warning("Installed 'marie', but ~/.local/bin isn't on your PATH", {
            description: 'Add  export PATH="$HOME/.local/bin:$PATH"  to your ~/.zshrc',
            duration: 10000,
          })
      } catch (e) {
        toast.error(String(e))
      }
    },
  },
  { id: "app.checkUpdates", group: "Marie", title: "Check for Updates…", run: () => void checkForUpdates(false) },
  { id: "file.newWindow", group: "File", title: "New Window", shortcut: "⇧⌘N", run: () => void newWindow() },
  {
    id: "file.openFolderNewWindow",
    group: "File",
    title: "Open Folder in New Window…",
    shortcut: "⌥⌘O",
    run: async () => {
      const dir = await open({ directory: true, multiple: false, title: "Open Folder in New Window" })
      if (typeof dir === "string") await newWindow(dir)
    },
  },
  { id: "file.closeFolder", group: "File", title: "Close Folder", when: () => !!S().workspace, run: () => S().closeWorkspace() },
  { id: "file.connectSsh", group: "File", title: "Connect via SSH…", shortcut: "⇧⌘O", run: () => S().openPalette("ssh") },
  { id: "file.save", group: "File", title: "Save", shortcut: "⌘S", run: () => saveActive(false) },
  { id: "file.saveAs", group: "File", title: "Save As…", shortcut: "⇧⌘S", run: () => saveActive(true) },
  { id: "file.saveAll", group: "File", title: "Save All", shortcut: "⌥⇧⌘S", run: () => saveAll() },
  { id: "edit.undo", group: "Edit", title: "Undo", shortcut: "⌘Z", run: () => editorUndo(false) },
  { id: "edit.redo", group: "Edit", title: "Redo", shortcut: "⇧⌘Z", run: () => editorUndo(true) },
  { id: "app.settings", group: "Preferences", title: "Settings…", shortcut: "⌘,", run: () => S().setSettingsOpen(true) },
  {
    id: "file.closeTab",
    group: "File",
    title: "Close Tab",
    shortcut: "⌘W",
    run: async () => {
      // Like VS Code: with no tabs left, ⌘W closes the window.
      if (S().tabs.length === 0) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        await getCurrentWindow().close()
        return
      }
      S().closeTab()
    },
  },

  { id: "go.file", group: "Go", title: "Go to File…", shortcut: "⌘P", run: () => S().openPalette("files") },
  { id: "go.line", group: "Go", title: "Go to Line…", shortcut: "⌃G", run: () => S().openPalette("line") },
  { id: "go.back", group: "Go", title: "Go Back", shortcut: "⌃-", run: () => S().goHistory(-1) },
  { id: "go.forward", group: "Go", title: "Go Forward", shortcut: "⌃⇧-", run: () => S().goHistory(1) },
  {
    id: "editor.changeLanguage",
    group: "Editor",
    title: "Change Language Mode…",
    when: () => ["file", "scratch"].includes(activeTab()?.kind ?? ""),
    run: () => S().openPalette("lang"),
  },
  {
    id: "view.explorer",
    group: "View",
    title: "Show Explorer",
    shortcut: "⇧⌘E",
    run: () => {
      S().setPrefs({ sidebar: true })
      useStore.setState({ sideView: "explorer" })
    },
  },
  {
    id: "search.findInFiles",
    group: "Search",
    title: "Find in Files",
    shortcut: "⇧⌘F",
    when: () => !!S().workspace,
    run: () => {
      S().setPrefs({ sidebar: true })
      // re-key so the search input refocuses even if already visible
      useStore.setState({ sideView: "search", searchNonce: Date.now() })
    },
  },
  {
    id: "view.toggleTerminal",
    group: "Terminal",
    title: "Toggle Terminal",
    shortcut: "⌘J",
    run: () => {
      const t = S().terminal
      if (t.sessions.length === 0) S().newTerminal()
      else S().setTerminal({ open: !t.open })
    },
  },
  { id: "terminal.new", group: "Terminal", title: "New Terminal", shortcut: "⌃⇧`", run: () => S().newTerminal() },
  {
    id: "terminal.kill",
    group: "Terminal",
    title: "Kill Active Terminal",
    when: () => !!S().terminal.active,
    run: () => {
      const a = S().terminal.active
      if (a) S().closeTerminal(a)
    },
  },
  { id: "view.zoomIn", group: "View", title: "Zoom In", shortcut: "⌘=", run: () => zoom(1) },
  { id: "view.zoomOut", group: "View", title: "Zoom Out", shortcut: "⌘-", run: () => zoom(-1) },
  { id: "view.zoomReset", group: "View", title: "Reset Zoom", shortcut: "⌘0", run: () => zoom(0) },
  { id: "file.reopenClosed", group: "File", title: "Reopen Closed Tab", shortcut: "⇧⌘T", run: () => S().reopenClosedTab() },
  {
    id: "file.closeOthers",
    group: "File",
    title: "Close Other Tabs",
    run: () => {
      const s = S()
      for (const t of s.tabs) if (t.id !== s.activeId) s.closeTab(t.id)
    },
  },
  {
    id: "file.closeAll",
    group: "File",
    title: "Close All Tabs",
    shortcut: "⌥⌘W",
    run: () => {
      for (const t of [...S().tabs]) S().closeTab(t.id)
    },
  },
  {
    id: "file.revert",
    group: "File",
    title: "Revert File",
    when: () => activeTab()?.kind === "file",
    run: () => {
      const t = activeTab()
      if (t?.kind !== "file") return
      const s = S()
      const dirty = { ...s.dirty }
      delete dirty[t.id]
      // remount the tab with fresh contents from disk
      const fresh = { ...t, id: `${t.id}-r${Date.now().toString(36)}` }
      useStore.setState({ dirty, tabs: s.tabs.map((x) => (x.id === t.id ? fresh : x)), activeId: fresh.id })
    },
  },
  {
    id: "file.copyPath",
    group: "File",
    title: "Copy Path of Active File",
    shortcut: "⌥⌘C",
    when: () => activeTab()?.kind === "file",
    run: () => copyPath(false),
  },
  {
    id: "file.copyRelativePath",
    group: "File",
    title: "Copy Relative Path of Active File",
    shortcut: "⌥⇧⌘C",
    when: () => activeTab()?.kind === "file",
    run: () => copyPath(true),
  },
  {
    id: "file.revealInFinder",
    group: "File",
    title: "Reveal in Finder",
    shortcut: "⌥⌘R",
    when: () => activeTab()?.kind === "file" && !S().workspace?.remote,
    run: async () => {
      const t = activeTab()
      const ws = S().workspace
      if (t?.kind !== "file" || !ws) return
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener")
      await revealItemInDir(`${ws.id}/${t.path}`)
    },
  },
  { id: "go.nextTab", group: "Go", title: "Next Tab", shortcut: "⇧⌘]", run: () => S().cycleTab(1) },
  { id: "go.prevTab", group: "Go", title: "Previous Tab", shortcut: "⇧⌘[", run: () => S().cycleTab(-1) },

  { id: "git.uncommitted", group: "Git", title: "Uncommitted Changes", shortcut: "⇧⌘G", when: hasGit, run: () => S().openDiff("uncommitted") },
  {
    id: "git.staged",
    group: "Git",
    title: "Staged Changes",
    when: hasGit,
    run: () => S().openDiff("staged"),
  },
  {
    id: "git.unstaged",
    group: "Git",
    title: "Unstaged Changes",
    when: hasGit,
    run: () => S().openDiff("unstaged"),
  },
  {
    id: "git.branch",
    group: "Git",
    title: "Branch Diff (vs default base)",
    shortcut: "⇧⌘B",
    when: hasGit,
    run: () => S().openDiff("branch"),
  },
  { id: "git.pickBase", group: "Git", title: "Compare with Branch…", when: hasGit, run: () => S().openPalette("branch") },
  {
    id: "git.fetch",
    group: "Git",
    title: "Fetch origin",
    when: hasGit,
    run: async () => {
      const ws = S().workspace
      if (!ws) return
      const t = toast.loading("Fetching origin…")
      try {
        await ipc.gitFetch(ws.id)
        toast.success("Fetched origin", { id: t })
        await S().refresh()
      } catch (e) {
        toast.error(String(e), { id: t })
      }
    },
  },
  { id: "git.refresh", group: "Git", title: "Refresh", shortcut: "⌘R", when: () => !!S().workspace, run: () => S().refresh() },
  {
    id: "scratch.viewAsDiff",
    group: "Scratch",
    title: "View Scratch as Diff",
    shortcut: "⇧⌘D",
    when: () => {
      const t = activeTab()
      return t?.kind === "scratch" && looksLikeDiff(S().scratch[t.id] ?? "")
    },
    run: () => {
      const t = activeTab()
      if (t?.kind !== "scratch") return
      S().openPatch(`Δ ${t.title}`, S().scratch[t.id] ?? "")
    },
  },
  {
    id: "scratch.changeLanguage",
    group: "Scratch",
    title: "Change Language Mode…",
    when: () => activeTab()?.kind === "scratch",
    run: () => S().openPalette("lang"),
  },

  { id: "view.palette", group: "View", title: "Command Palette", shortcut: "⇧⌘P", run: () => S().openPalette("commands") },
  { id: "view.toggleSidebar", group: "View", title: "Toggle Sidebar", shortcut: "⌘B", run: () => S().setPrefs({ sidebar: !S().sidebar }) },
  {
    id: "view.toggleDiffStyle",
    group: "View",
    title: "Toggle Split / Unified Diff",
    shortcut: "⌥⌘S",
    run: () => S().setPrefs({ diffStyle: S().diffStyle === "split" ? "unified" : "split" }),
  },
  { id: "view.toggleWrap", group: "View", title: "Toggle Line Wrap", shortcut: "⌥Z", run: () => S().setPrefs({ wrap: !S().wrap }) },
  {
    id: "view.toggleMarkdown",
    group: "View",
    title: "Toggle Preview / Source (Markdown, SVG)",
    shortcut: "⇧⌘V",
    when: () => {
      const t = activeTab()
      return t?.kind === "file" && /\.(md|mdx|markdown|svg)$/i.test(t.path)
    },
    run: () => {
      const t = activeTab()
      if (t?.kind !== "file") return
      if (/\.svg$/i.test(t.path)) S().updateTab(t.id, { mdSource: !t.mdSource })
      else S().updateTab(t.id, { preview: !t.preview })
    },
  },
  { id: "view.selectTheme", group: "Theme", title: "Select Color Theme…", shortcut: "⌘K", run: () => S().openPalette("theme") },
  {
    id: "view.importTheme",
    group: "Theme",
    title: "Import VS Code Theme…",
    run: async () => {
      const picked = await open({
        title: "Import VS Code theme (.json files, or an extension's themes folder)",
        multiple: true,
        filters: [{ name: "VS Code theme", extensions: ["json"] }],
      })
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
      if (!paths.length) return
      try {
        const n = await ipc.importThemes(paths)
        await reloadThemes()
        toast.success(`Imported ${n} theme${n === 1 ? "" : "s"}`)
      } catch (e) {
        toast.error(String(e))
      }
    },
  },
  {
    id: "view.openThemesFolder",
    group: "Theme",
    title: "Open Themes Folder",
    run: async () => {
      const dir = await ipc.themesDir()
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener")
      await revealItemInDir(dir)
    },
  },
  { id: "view.reloadThemes", group: "Theme", title: "Reload Custom Themes", run: () => reloadThemes(true) },
  {
    id: "view.toggleAppearance",
    group: "Theme",
    title: "Toggle Light / Dark",
    shortcut: "⇧⌘L",
    run: () => {
      const s = S()
      const dark = s.appearance === "system" ? s.systemDark : s.appearance === "dark"
      s.setPrefs({ appearance: dark ? "light" : "dark" })
    },
  },
  { id: "view.appearanceSystem", group: "Theme", title: "Follow System Appearance", run: () => S().setPrefs({ appearance: "system" }) },
]

let zoomLevel = 1
async function zoom(dir: -1 | 0 | 1) {
  zoomLevel = dir === 0 ? 1 : Math.min(2, Math.max(0.5, Math.round((zoomLevel + dir * 0.1) * 10) / 10))
  const { getCurrentWebview } = await import("@tauri-apps/api/webview")
  await getCurrentWebview().setZoom(zoomLevel)
}

async function copyPath(relative: boolean) {
  const t = activeTab()
  const ws = S().workspace
  if (t?.kind !== "file" || !ws) return
  const text = relative ? t.path : ws.remote ? `${ws.id}/${t.path}` : `${ws.id}/${t.path}`
  await navigator.clipboard.writeText(text)
  toast.success("Copied path", { description: text, duration: 1500 })
}

async function reloadThemes(announce = false) {
  const { loadCustomThemes } = await import("@/lib/themes")
  const { themes, errors } = await loadCustomThemes()
  useStore.setState({ customThemes: themes })
  if (errors.length) toast.error(`Couldn't load ${errors.length} theme(s): ${errors[0]}`)
  else if (announce) toast.success(`${themes.length} custom theme${themes.length === 1 ? "" : "s"} loaded`)
}

async function saveActive(as: boolean) {
  const t = activeTab()
  if (!t) return
  if (t.kind === "scratch" || (as && t.kind === "file")) {
    const text = t.kind === "scratch" ? trimTrailingBlankLines(S().scratch[t.id] ?? "") : undefined
    const ws = S().workspace
    const target = await save({
      title: "Save As",
      defaultPath: ws && !ws.remote ? `${ws.id}/${t.kind === "file" ? t.path : t.title}` : t.title,
    })
    if (!target) return
    try {
      let body = text
      if (body == null && t.kind === "file") {
        // Save As of a workspace file: current editor text
        const { viewHandle } = await import("@/lib/views")
        body = viewHandle(t.id)?.getText?.()
      }
      await ipc.writeAbs(target, body ?? "")
      toast.success(`Saved ${target.split("/").pop()}`, { duration: 1200 })
      // If it landed inside the open (local) workspace, swap the scratch tab for the real file.
      if (ws && !ws.remote && target.startsWith(ws.id + "/")) {
        const rel = target.slice(ws.id.length + 1)
        if (t.kind === "scratch") {
          useStore.setState((s) => {
            const scratch = { ...s.scratch }
            delete scratch[t.id]
            return { scratch, tabs: s.tabs.filter((x) => x.id !== t.id) }
          })
        }
        await S().refresh()
        S().openFile(rel)
      }
    } catch (e) {
      toast.error(String(e))
    }
    return
  }
  await saveTab(t.id)
}

export function runCommand(id: string) {
  const c = commands.find((c) => c.id === id)
  if (!c) return
  if (c.when && !c.when()) return
  void c.run()
}
