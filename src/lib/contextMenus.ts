/**
 * App-wide custom context menus (VS Code-style). One capture-phase `contextmenu` listener
 * suppresses the native menu everywhere and routes by what was clicked, using composedPath()
 * so targets inside shadow DOMs (file tree, Pierre editor, terminal canvas) resolve too.
 */
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useContextMenu, type MenuItem } from "@/components/ContextMenu"
import { confirmAction, promptText } from "@/components/PromptDialog"
import { runCommand } from "@/commands"
import { editorCopy, editorPaste, editorSelectAll } from "@/lib/editing"
import { isMarkdownPath } from "@/lib/views"
import { treeModel } from "@/lib/treeRef"
import { newWindow } from "@/lib/win"
import { terminals } from "@/lib/terminalRef"
import { recentWorkspaces, removeRecent, useStore } from "@/store"

const S = () => useStore.getState()
const sep = "separator" as const

async function writeClipboard(text: string) {
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager")
  await writeText(text)
}
async function readClipboard() {
  const { readText } = await import("@tauri-apps/plugin-clipboard-manager")
  return (await readText()) ?? ""
}

const absPath = (rel: string) => {
  const ws = S().workspace
  return ws ? `${ws.id}/${rel}`.replace(/\/+$/, "") : rel
}

async function fsOp(op: "newFile" | "newFolder" | "rename" | "delete", path: string, to?: string) {
  const ws = S().workspace
  if (!ws) return false
  try {
    await invoke("fs_op", { id: ws.id, op, path, to: to ?? null })
    await S().refresh()
    return true
  } catch (e) {
    toast.error(String(e))
    return false
  }
}

const parentDir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "")
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

async function revealInFinder(rel: string) {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener")
  await revealItemInDir(absPath(rel))
}

function openTerminalAt(rel: string) {
  // New terminal, then cd into the folder (works for local and ssh shells alike).
  S().newTerminal()
  const quoted = `'${rel.replace(/'/g, "'\\''")}'`
  let tries = 0
  const tick = () => {
    const t = terminals.get(S().terminal.active ?? "")
    if (t?.ready) t.input(`cd ${quoted}\r`)
    else if (tries++ < 60) window.setTimeout(tick, 100)
  }
  window.setTimeout(tick, 300)
}

function copyPathItems(rel: string): MenuItem[] {
  return [
    { label: "Copy Path", shortcut: "⌥⌘C", run: () => writeClipboard(absPath(rel)) },
    { label: "Copy Relative Path", shortcut: "⌥⇧⌘C", run: () => writeClipboard(rel) },
  ]
}

// ---- menus ---------------------------------------------------------------------

function treeMenu(rawPath: string, kind: "file" | "folder"): MenuItem[] {
  const path = rawPath.replace(/\/+$/, "")
  const ws = S().workspace
  const local = !!ws && !ws.remote
  const dir = kind === "folder" ? path : parentDir(path)
  const items: MenuItem[] = []
  if (kind === "file") {
    items.push({ label: "Open", run: () => S().openFile(path) })
    if (isMarkdownPath(path))
      items.push({
        label: "Open Preview",
        run: () => {
          S().openFile(path)
          const t = S().tabs.find((x) => x.kind === "file" && x.path === path)
          if (t) S().updateTab(t.id, { preview: true })
        },
      })
    items.push(sep)
  }
  items.push(
    {
      label: "New File…",
      run: async () => {
        const name = await promptText("New File", { description: dir ? `in ${dir}/` : "in workspace root", confirmLabel: "Create" })
        if (name && (await fsOp("newFile", join(dir, name)))) S().openFile(join(dir, name))
      },
    },
    {
      label: "New Folder…",
      run: async () => {
        const name = await promptText("New Folder", { description: dir ? `in ${dir}/` : "in workspace root", confirmLabel: "Create" })
        if (name) await fsOp("newFolder", join(dir, name))
      },
    },
    sep,
  )
  if (local) items.push({ label: "Reveal in Finder", shortcut: "⌥⌘R", run: () => revealInFinder(path) })
  items.push({ label: "Open in Integrated Terminal", run: () => openTerminalAt(dir || ".") })
  if (kind === "folder")
    items.push({
      label: "Find in Folder…",
      run: () => {
        S().setPrefs({ sidebar: true })
        useStore.setState({ sideView: "search", searchNonce: Date.now() })
      },
    })
  items.push(sep, ...copyPathItems(path), sep)
  items.push({
    label: "Rename…",
    run: async () => {
      const model = treeModel.current
      if (model) {
        // Inline rename in the tree (onRename in Sidebar performs the move).
        model.startRenaming(kind === "folder" ? `${path}/` : path)
        return
      }
      const name = await promptText("Rename", { value: path.split("/").pop(), confirmLabel: "Rename" })
      if (name) await fsOp("rename", path, join(parentDir(path), name))
    },
  })
  items.push({
    label: local ? "Move to Trash" : "Delete Permanently",
    danger: true,
    run: async () => {
      const ok = await confirmAction(`${local ? "Move" : "Delete"} '${path.split("/").pop()}'${local ? " to the Trash" : ""}?`, {
        description: local ? "You can restore it from the Trash." : "This permanently deletes it on the remote host.",
        confirmLabel: local ? "Move to Trash" : "Delete",
        danger: true,
      })
      if (!ok) return
      if (await fsOp("delete", path)) {
        for (const t of S().tabs) if (t.kind === "file" && (t.path === path || t.path.startsWith(path + "/"))) S().closeTab(t.id)
      }
    },
  })
  return items
}

function tabMenu(tabId: string): MenuItem[] {
  const s = S()
  const idx = s.tabs.findIndex((t) => t.id === tabId)
  const tab = s.tabs[idx]
  if (!tab) return []
  const items: MenuItem[] = [
    { label: "Close", shortcut: "⌘W", run: () => S().closeTab(tabId) },
    {
      label: "Close Others",
      disabled: s.tabs.length < 2,
      run: () => {
        for (const t of [...S().tabs]) if (t.id !== tabId) S().closeTab(t.id)
      },
    },
    {
      label: "Close to the Right",
      disabled: idx === s.tabs.length - 1,
      run: () => {
        for (const t of S().tabs.slice(idx + 1)) S().closeTab(t.id)
      },
    },
    { label: "Close All", shortcut: "⌥⌘W", run: () => runCommand("file.closeAll") },
  ]
  if (tab.kind === "file") {
    const local = !!s.workspace && !s.workspace.remote
    items.push(sep, ...copyPathItems(tab.path), sep)
    if (local) items.push({ label: "Reveal in Finder", shortcut: "⌥⌘R", run: () => revealInFinder(tab.path) })
    items.push({
      label: "Reveal in Explorer",
      run: () => {
        S().setPrefs({ sidebar: true })
        useStore.setState({ sideView: "explorer" })
        treeModel.current?.scrollToPath(tab.path, { offset: "center", focus: true })
      },
    })
  }
  return items
}

function editorMenu(): MenuItem[] {
  const tab = S().tabs.find((t) => t.id === S().activeId)
  const items: MenuItem[] = [
    { label: "Cut", shortcut: "⌘X", run: () => editorCopy(true) },
    { label: "Copy", shortcut: "⌘C", run: () => editorCopy(false) },
    { label: "Paste", shortcut: "⌘V", run: () => editorPaste() },
    sep,
    { label: "Select All", shortcut: "⌘A", run: () => editorSelectAll() },
    sep,
    { label: "Go to Line…", shortcut: "⌃G", run: () => runCommand("go.line") },
    { label: "Change Language Mode…", run: () => runCommand("editor.changeLanguage") },
  ]
  if (tab?.kind === "file") {
    if (isMarkdownPath(tab.path)) items.push({ label: "Open Preview", shortcut: "⇧⌘V", run: () => runCommand("view.toggleMarkdown") })
    items.push(sep, ...copyPathItems(tab.path))
    if (S().workspace && !S().workspace!.remote) items.push({ label: "Reveal in Finder", shortcut: "⌥⌘R", run: () => revealInFinder(tab.path) })
  }
  if (tab?.kind === "scratch") items.push(sep, { label: "Save As…", shortcut: "⇧⌘S", run: () => runCommand("file.saveAs") })
  return items
}

function selectionMenu(extra: MenuItem[] = []): MenuItem[] {
  const text = window.getSelection()?.toString() ?? ""
  return [
    { label: "Copy", shortcut: "⌘C", disabled: !text, run: () => writeClipboard(text) },
    sep,
    {
      label: "Select All",
      shortcut: "⌘A",
      run: () => {
        const root = document.querySelector(".md-body")
        if (!root) return
        const r = document.createRange()
        r.selectNodeContents(root)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(r)
      },
    },
    ...extra,
  ]
}

function inputMenu(el: HTMLInputElement | HTMLTextAreaElement): MenuItem[] {
  const selected = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)
  const replace = (text: string) => {
    el.focus()
    el.setRangeText(text, el.selectionStart ?? 0, el.selectionEnd ?? 0, "end")
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }
  // React tracks input values; setRangeText + an input event keeps controlled inputs in sync.
  return [
    {
      label: "Cut",
      shortcut: "⌘X",
      disabled: !selected || el.readOnly,
      run: async () => {
        await writeClipboard(selected)
        replace("")
      },
    },
    { label: "Copy", shortcut: "⌘C", disabled: !selected, run: () => writeClipboard(selected) },
    { label: "Paste", shortcut: "⌘V", disabled: el.readOnly, run: async () => replace(await readClipboard()) },
    sep,
    {
      label: "Select All",
      shortcut: "⌘A",
      run: () => {
        el.focus()
        el.select()
      },
    },
  ]
}

function terminalMenu(sid: string): MenuItem[] {
  const t = terminals.get(sid)
  const sel = t?.term.getSelection() ?? ""
  return [
    { label: "Copy", shortcut: "⌘C", disabled: !sel, run: () => writeClipboard(sel) },
    { label: "Paste", shortcut: "⌘V", run: async () => t?.term.paste(await readClipboard()) },
    { label: "Select All", shortcut: "⌘A", run: () => t?.term.selectAll() },
    sep,
    { label: "Clear Terminal", run: () => t?.term.clear() },
    sep,
    { label: "New Terminal", shortcut: "⌃⇧`", run: () => S().newTerminal() },
    { label: "Kill Terminal", danger: true, run: () => S().closeTerminal(sid) },
  ]
}

function searchHitMenu(path: string, line: number, text: string): MenuItem[] {
  return [
    {
      label: "Open",
      run: () => {
        S().openFile(path)
        window.setTimeout(() => void import("@/lib/views").then((v) => v.viewHandle(S().activeId)?.goToLine?.(line)), 300)
      },
    },
    sep,
    { label: "Copy Line", run: () => writeClipboard(text) },
    ...copyPathItems(path),
  ]
}

function recentMenu(uri: string): MenuItem[] {
  return [
    { label: "Open", run: () => S().openWorkspace(uri) },
    { label: "Open in New Window", shortcut: "⌘-click", run: () => void newWindow(uri) },
    { label: "Copy Path", run: () => writeClipboard(uri) },
    sep,
    {
      label: "Remove from Recent",
      run: () => {
        removeRecent(uri)
        useStore.setState({ recentNonce: Date.now() })
      },
    },
  ]
}

/** Explorer "⋯" menu and right-click on the folder name. */
export function workspaceMenu(): MenuItem[] {
  const ws = S().workspace
  if (!ws) return []
  return [
    {
      label: "New File…",
      run: async () => {
        const name = await promptText("New File", { description: "in workspace root", confirmLabel: "Create" })
        if (name && (await fsOp("newFile", name))) S().openFile(name)
      },
    },
    {
      label: "New Folder…",
      run: async () => {
        const name = await promptText("New Folder", { description: "in workspace root", confirmLabel: "Create" })
        if (name) await fsOp("newFolder", name)
      },
    },
    sep,
    { label: "Refresh", shortcut: "⌘R", run: () => S().refresh() },
    { label: "Collapse All Folders", run: () => collapseAll() },
    sep,
    { label: "Find in Folder…", shortcut: "⇧⌘F", run: () => runCommand("search.findInFiles") },
    { label: "Open in Integrated Terminal", run: () => openTerminalAt(".") },
    ...(ws.is_git ? [{ label: "Show Changes", shortcut: "⇧⌘G", run: () => runCommand("git.uncommitted") } as MenuItem] : []),
    sep,
    { label: "Copy Path", run: () => writeClipboard(ws.id) },
    ...(ws.remote ? [] : [{ label: "Reveal in Finder", run: () => revealInFinder("") } as MenuItem]),
    sep,
    { label: "Close Folder", run: () => S().closeWorkspace() },
  ]
}

function collapseAll() {
  const model = treeModel.current
  if (!model) return
  const dirs = new Set<string>()
  for (const f of S().files) {
    let i = f.indexOf("/")
    while (i > 0) {
      dirs.add(f.slice(0, i))
      i = f.indexOf("/", i + 1)
    }
  }
  // Deepest first so parents collapse last.
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    const item = (model.getItem(`${d}/`) ?? model.getItem(d)) as { collapse?: () => void } | null
    item?.collapse?.()
  }
}

// ---- routing -------------------------------------------------------------------

function attr(el: Element, name: string) {
  return el.getAttribute(name) ?? undefined
}

export function resolveMenu(e: MouseEvent): MenuItem[] | null {
  const path = e.composedPath().filter((n): n is Element => n instanceof Element)
  for (const el of path) {
    const menu = attr(el, "data-menu")
    if (menu === "tab") return tabMenu(attr(el, "data-tab-id")!)
    if (menu === "terminal") return terminalMenu(attr(el, "data-term-id")!)
    if (menu === "search-hit") return searchHitMenu(attr(el, "data-path")!, Number(attr(el, "data-line")), attr(el, "data-text") ?? "")
    if (menu === "recent") return recentMenu(attr(el, "data-uri")!)
    if (menu === "workspace") return workspaceMenu()
    if (el.getAttribute("data-type") === "item" && el.hasAttribute("data-item-path"))
      return treeMenu(attr(el, "data-item-path")!, attr(el, "data-item-type") === "folder" ? "folder" : "file")
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return inputMenu(el)
    if (el.classList?.contains("md-body"))
      return selectionMenu([sep, { label: "Show Source", shortcut: "⇧⌘V", run: () => runCommand("view.toggleMarkdown") }])
    if (el.classList?.contains("code-surface")) return editorMenu()
  }
  return null
}

export function installContextMenus() {
  const onMenu = (e: MouseEvent) => {
    e.preventDefault()
    const items = resolveMenu(e)
    if (items && items.length) useContextMenu.getState().show(e.clientX, e.clientY, items)
    else useContextMenu.getState().hide()
  }
  window.addEventListener("contextmenu", onMenu, true)
  return () => window.removeEventListener("contextmenu", onMenu, true)
}

export { recentWorkspaces }
