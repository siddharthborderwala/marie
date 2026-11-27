import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { EditProvider } from "@pierre/diffs/react"
import { IconArrowsDiff, IconGitBranch, IconSearch, IconLayoutSidebar, IconPlus } from "@tabler/icons-react"
import { TabActionsContext } from "@/components/TabActions"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Sidebar } from "@/components/Sidebar"
import { TabBar } from "@/components/TabBar"
import { Palette } from "@/components/Palette"
import { Settings } from "@/components/Settings"
import { TerminalPanel } from "@/components/TerminalPanel"
import { ContextMenuHost } from "@/components/ContextMenu"
import { PromptDialog } from "@/components/PromptDialog"
import { installContextMenus } from "@/lib/contextMenus"
import { codeLineHeightPx } from "@/lib/pierre"
import { FileView } from "@/components/views/FileView"
import { DiffView, PatchView } from "@/components/views/DiffView"
import { ScratchView } from "@/components/views/ScratchView"
import { Placeholder } from "@/components/views/Placeholder"
import { runCommand } from "@/commands"
import { ipc, isTauri } from "@/lib/ipc"
import { applyChrome, loadCustomThemes } from "@/lib/themes"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
import { newWindow, windowLabel } from "@/lib/win"
import { checkForUpdates } from "@/lib/updater"
import { createEditor } from "@/lib/editing"
import { useActiveTheme } from "@/lib/useTheme"
import { useEffectiveDark, useStore } from "@/store"


let booted = false
async function boot() {
  if (booted) return
  booted = true
  // Custom themes must be registered with Pierre before anything renders with them.
  const { themes, errors } = await loadCustomThemes()
  useStore.setState({ customThemes: themes, themesReady: true })
  if (errors.length) toast.error(`Couldn't load ${errors.length} theme(s): ${errors[0]}`)
  const s = useStore.getState()
  const { args, cwd } = isTauri() ? await ipc.launchArgs().catch(() => ({ args: [], cwd: "" })) : { args: [], cwd: "" }
  const flags = args.filter((a) => a.startsWith("--"))
  const pos = args.filter((a) => !a.startsWith("--"))
  const abs = (p: string) => (p.startsWith("/") || p.startsWith("ssh://") || p.startsWith("~") ? p : `${cwd}/${p}`)

  const folderParam = new URLSearchParams(location.search).get("folder")
  if (folderParam) {
    // Window opened via New Window / Open in New Window.
    await s.openWorkspace(folderParam)
  } else if (windowLabel() === "main" && pos.length === 0 && isTauri()) {
    // Plain launch: restore the previous session's windows.
    const session = await invoke<string[]>("take_session").catch(() => [] as string[])
    if (session[0]) await s.openWorkspace(session[0])
    for (const uri of session.slice(1)) await newWindow(uri).catch(() => {})
  } else if (pos[0] === "diff") {
    // marie diff [base] [--uncommitted] [--in <dir>]
    const inIdx = args.indexOf("--in")
    await s.openWorkspace(inIdx >= 0 ? abs(args[inIdx + 1]) : cwd)
    if (flags.includes("--uncommitted")) useStore.getState().openDiff("uncommitted")
    else useStore.getState().openDiff("branch", pos[1] ?? null)
  } else if (pos[0]) {
    // marie <dir> [file-in-dir] [--diff[=base]]
    await s.openWorkspace(abs(pos[0]))
    if (pos[1]) useStore.getState().openFile(pos[1])
    const d = flags.find((f) => f.startsWith("--diff"))
    if (d) useStore.getState().openDiff(d.includes("=") ? "branch" : "uncommitted", d.split("=")[1] ?? null)
  }
  if (useStore.getState().tabs.length === 0) useStore.getState().newScratch()
  // Release builds: quietly check for an update shortly after launch (main window only).
  if (import.meta.env.PROD && windowLabel() === "main") window.setTimeout(() => void checkForUpdates(true), 8000)
}

function ActiveView() {
  const ready = useStore((s) => s.themesReady)
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeId))
  if (!ready) return null
  if (!tab)
    return (
      <Placeholder title="Nothing open">
        <div className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
          <span>
            <Kbd>⌘P</Kbd> go to file · <Kbd>⇧⌘P</Kbd> commands · <Kbd>⌘N</Kbd> new untitled
          </span>
        </div>
      </Placeholder>
    )
  switch (tab.kind) {
    case "file":
      return <FileView key={`${tab.id}:${tab.lang ?? ""}`} tabId={tab.id} path={tab.path} mdSource={tab.mdSource} preview={tab.preview} lang={tab.lang} />
    case "diff":
      return <DiffView key={tab.id} tabId={tab.id} mode={tab.mode} base={tab.base} nonce={tab.nonce} />
    case "scratch":
      return <ScratchView key={tab.id} tabId={tab.id} title={tab.title} lang={tab.lang} />
    case "patch":
      return <PatchView key={tab.id} tabId={tab.id} patch={tab.patch} />
  }
}

export function App() {
  const sidebar = useStore((s) => s.sidebar)
  const ws = useStore((s) => s.workspace)
  const repo = useStore((s) => s.repo)
  const changeCount = useStore((s) => s.status.filter((x) => x.status !== "ignored").length)
  const [actionsEl, setActionsEl] = useState<HTMLDivElement | null>(null)
  const theme = useActiveTheme()
  const dark = useEffectiveDark()

  useEffect(() => {
    if (theme) applyChrome(theme.palette)
  }, [theme])

  // Fonts & sizes → CSS variables (UI scales via root font-size; code via Pierre's --diffs-* vars).
  const fonts = useStore(
    useShallow((s) => [s.uiFont, s.uiFontSize, s.codeFont, s.codeFontSize, s.codeLineHeight, s.ligatures, s.codeFontWeight, s.indentGuides] as const),
  )
  useEffect(() => {
    const [uiFont, uiSize, codeFont, codeSize, lh, lig, weight, guides] = fonts
    const r = document.documentElement.style
    const q = (f: string) => (/^[\w-]+$/.test(f) && !f.includes(" ") ? f : `"${f}"`)
    r.setProperty("--ui-font", `${q(uiFont)}, "Geist Variable", -apple-system, system-ui, sans-serif`)
    r.setProperty("--code-font", `${q(codeFont)}, "Geist Mono Variable", ui-monospace, Menlo, monospace`)
    r.setProperty("--code-font-size", `${codeSize}px`)
    r.setProperty("--code-line-height", `${codeLineHeightPx(codeSize, lh)}px`)
    r.setProperty("--code-font-features", lig ? '"calt" 1, "liga" 1' : '"calt" 0, "liga" 0')
    r.setProperty("--code-font-weight", String(weight))
    if (guides) r.removeProperty("--marie-guide-color")
    else r.setProperty("--marie-guide-color", "transparent")
    r.fontSize = `${(16 * uiSize) / 13}px`
  }, [fonts])

  // ⌃` also toggles the terminal (the menu item carries ⌘J; a menu item has one accelerator).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === "Backquote") {
        e.preventDefault()
        runCommand(e.shiftKey ? "terminal.new" : "view.toggleTerminal")
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  // Custom context menus everywhere; the native WebKit menu never shows.
  useEffect(() => installContextMenus(), [])

  useEffect(() => {
    void boot()
    if (!isTauri()) return
    // Menu events are sent to the focused window only.
    const un = getCurrentWebviewWindow().listen<string>("menu", (e) => runCommand(e.payload))
    return () => {
      void un.then((f) => f())
    }
  }, [])

  return (
    <EditProvider createEditor={createEditor}>
      <TooltipProvider>
        <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
          {/* Title bar: traffic lights · sidebar toggle | centered command bar | branch · changes */}
          <header className="relative flex h-11 shrink-0 items-center border-b bg-sidebar pr-2 pl-[80px]" data-tauri-drag-region>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => runCommand("view.toggleSidebar")}
              title="Toggle Sidebar (⌘B)"
              className="size-7 text-muted-foreground [&_svg]:size-[18px]"
            >
              <IconLayoutSidebar />
            </Button>

            <button
              onClick={() => useStore.getState().openPalette("files")}
              className="absolute left-1/2 flex h-7 w-[min(440px,38vw)] -translate-x-1/2 items-center gap-2 rounded-4xl border bg-background/60 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <IconSearch className="size-3.5 shrink-0" />
              <span className="truncate">{ws ? `Search ${ws.name}` : "Search files and commands"}</span>
              <Kbd className="ml-auto">⌘P</Kbd>
            </button>

            <div className="ml-auto flex items-center gap-1">
              {repo?.branch && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => runCommand("git.pickBase")}
                  className="max-w-48 text-muted-foreground"
                  title="Compare with branch…"
                >
                  <IconGitBranch /> <span className="truncate">{repo.branch}</span>
                </Button>
              )}
              {ws?.is_git && (
                <Button size="xs" variant="ghost" onClick={() => runCommand("git.uncommitted")} className="text-muted-foreground">
                  <IconArrowsDiff /> Changes
                  {changeCount > 0 && <span className="tabular-nums opacity-70">{changeCount}</span>}
                </Button>
              )}
            </div>
          </header>

          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
            {sidebar && (
              <>
                <ResizablePanel id="sidebar" defaultSize={270} minSize={180} maxSize={560} className="bg-sidebar">
                  <Sidebar />
                </ResizablePanel>
                <ResizableHandle />
              </>
            )}
            <ResizablePanel id="main" minSize={300}>
              <main className="flex h-full min-h-0 flex-col">
                {/* Tab row: tabs + new, and the active view's controls on the right. */}
                <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
                  <TabBar />
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => runCommand("file.newUntitled")}
                    title="New Untitled (⌘N)"
                    className="text-muted-foreground [&_svg]:size-4"
                  >
                    <IconPlus />
                  </Button>
                  <div className="flex-1" />
                  <div ref={setActionsEl} className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" />
                </div>
                <TabActionsContext.Provider value={actionsEl}>
                  <div className="min-h-0 flex-1">
                    <ActiveView />
                  </div>
                </TabActionsContext.Provider>
                <TerminalPanel />
              </main>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        <Palette />
        <Settings />
        <PromptDialog />
        <ContextMenuHost />
        <Toaster position="bottom-right" theme={dark ? "dark" : "light"} />
      </TooltipProvider>
    </EditProvider>
  )
}

export default App
