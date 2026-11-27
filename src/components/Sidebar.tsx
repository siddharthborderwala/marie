import { useEffect, useMemo, useRef } from "react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { IconDots, IconFiles, IconFolder, IconFolderOpen, IconLoader2, IconSearch, IconServer2 } from "@tabler/icons-react"
import { SearchView } from "@/components/SearchView"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { treeModel } from "@/lib/treeRef"
import { useContextMenu } from "@/components/ContextMenu"
import { workspaceMenu } from "@/lib/contextMenus"
import { newWindow } from "@/lib/win"
import type { ReactNode } from "react"
import { recentWorkspaces, useStore } from "@/store"
import { useActiveTheme } from "@/lib/useTheme"
import { treeStylesFor } from "@/lib/themes"
import { Kbd } from "@/components/ui/kbd"
import { openFolderDialog } from "@/commands"
import { tablerTreeIcons } from "@/lib/treeIcons"

const TREE_CSS = `
/* Pill-shaped search field, matching the shadcn inputs */
[data-file-tree-search-input] {
  border-radius: 9999px;
  padding-inline: 10px;
}
/* Breathing room after the last item: 10% of the window height, at least 100px.
   A real spacer element (padding on the fixed-height list is ignored by WebKit). */
[data-file-tree-virtualized-scroll]::after {
  content: "";
  display: block;
  height: 48px;
}
/* Rounded hover/selection backgrounds with breathing room between rows */
[data-item-button] {
  background-clip: padding-box;
  border-block: 1px solid transparent;
}
`

export function Sidebar() {
  const view = useStore((s) => s.sideView)
  const nonce = useStore((s) => s.searchNonce)
  const ws = useStore((s) => s.workspace)
  return (
    <div className="flex h-full min-h-0 flex-col">
      {ws && (
        <div className="flex h-9 shrink-0 items-center gap-0.5 px-2">
          <SideTab active={view === "explorer"} onClick={() => useStore.setState({ sideView: "explorer" })} title="Explorer (⇧⌘E)">
            <IconFiles />
          </SideTab>
          <SideTab
            active={view === "search"}
            onClick={() => useStore.setState({ sideView: "search", searchNonce: Date.now() })}
            title="Search (⇧⌘F)"
          >
            <IconSearch />
          </SideTab>
        </div>
      )}
      <div className={view === "explorer" || !ws ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <Explorer />
      </div>
      {ws && view === "search" && (
        <div className="min-h-0 flex-1">
          <SearchView key={nonce} />
        </div>
      )}
    </div>
  )
}

function SideTab({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex size-7 items-center justify-center rounded-4xl [&_svg]:size-4 ${active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
    >
      {children}
    </button>
  )
}

function Explorer() {
  const ws = useStore((s) => s.workspace)
  const files = useStore((s) => s.files)
  const status = useStore((s) => s.status)
  const loading = useStore((s) => s.loadingFiles)
  const theme = useActiveTheme()
  const fileSet = useRef<Set<string>>(new Set())

  const { model } = useFileTree({
    paths: [],
    search: true,
    // Roomier rows; each row's hover/selection is an inset rounded pill with a 2px gap
    // between neighbours (see TREE_CSS).
    itemHeight: 26,
    // Inline rename (Enter / F2 or the context menu); the move happens in Rust.
    renaming: {
      onRename: ({ sourcePath, destinationPath }) => {
        const ws = useStore.getState().workspace
        if (!ws) return
        const from = sourcePath.replace(/\/+$/, "")
        const to = destinationPath.replace(/\/+$/, "")
        invoke("fs_op", { id: ws.id, op: "rename", path: from, to })
          .then(() => {
            // keep open tabs pointing at the moved file
            useStore.setState((st) => ({
              tabs: st.tabs.map((t) =>
                t.kind === "file" && (t.path === from || t.path.startsWith(from + "/"))
                  ? { ...t, path: to + t.path.slice(from.length), title: (to + t.path.slice(from.length)).split("/").pop()! }
                  : t,
              ),
            }))
            return useStore.getState().refresh()
          })
          .catch((e) => {
            toast.error(String(e))
            void useStore.getState().refresh()
          })
      },
      onError: (msg) => toast.error(msg),
    },
    unsafeCSS: TREE_CSS,
    icons: { set: "none" },
    flattenEmptyDirectories: true,
    fileTreeSearchMode: "hide-non-matches",
    onSelectionChange: (paths) => {
      const p = paths[paths.length - 1]
      if (p && fileSet.current.has(p)) useStore.getState().openFile(p)
    },
  })

  useEffect(() => {
    treeModel.current = model
    return () => {
      if (treeModel.current === model) treeModel.current = null
    }
  }, [model])

  useEffect(() => {
    fileSet.current = new Set(files)
    model.resetPaths(files)
  }, [files, model])

  useEffect(() => {
    void tablerTreeIcons().then((icons) => model.setIcons(icons))
  }, [model])

  useEffect(() => {
    model.setGitStatus(status.length ? status : undefined)
  }, [status, model])

  // Reveal the active file in the tree.
  const activePath = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeId)
    return t?.kind === "file" ? t.path : null
  })
  useEffect(() => {
    if (activePath && fileSet.current.has(activePath)) model.scrollToPath(activePath, { offset: "nearest" })
  }, [activePath, model])

  const treeStyle = useMemo(() => (theme ? treeStylesFor(theme.palette) : undefined), [theme])

  if (!ws) return <EmptySidebar />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-menu="workspace" className="flex h-8 shrink-0 items-center gap-2 px-4 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <span className="truncate">{ws.name}</span>
        {loading && <IconLoader2 className="size-3 animate-spin" />}
        <button
          className="ml-auto flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          title="More Actions…"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            useContextMenu.getState().show(r.left, r.bottom + 4, workspaceMenu())
          }}
        >
          <IconDots className="size-4" />
        </button>
      </div>
      <FileTree model={model} className="min-h-0 flex-1" style={
          {
            ...(treeStyle as React.CSSProperties),
            height: "100%",
            // Follow the Interface font settings (the tree lives in its own shadow DOM).
            "--trees-font-family-override": "var(--ui-font)",
            "--trees-font-size-override": "calc(13rem / 16)",
            "--trees-border-radius-override": "8px",
            // 8px edge for search box + row highlights; labels land on the 16px text line.
            "--trees-padding-inline-override": "8px",
            "--trees-item-margin-x-override": "0px",
            "--trees-item-padding-x-override": "8px",
          } as React.CSSProperties
        } />
    </div>
  )
}

function Row({
  icon,
  label,
  detail,
  kbd,
  onClick,
  uri,
}: {
  icon: ReactNode
  label: string
  detail?: string
  kbd?: string
  onClick: (e?: React.MouseEvent) => void
  uri?: string
}) {
  return (
    <button
      onClick={onClick}
      data-menu={uri ? "recent" : undefined}
      data-uri={uri}
      className="group flex h-7 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-left text-[13px] text-foreground/90 hover:bg-accent hover:text-foreground"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground group-hover:text-foreground [&_svg]:size-4">
        {icon}
      </span>
      {/* The name keeps priority; the dimmed path gives way first, then both truncate. */}
      <span className="min-w-0 shrink truncate" title={label}>
        {label}
      </span>
      {detail && <span className="min-w-0 shrink-[3] truncate text-xs text-muted-foreground">{detail}</span>}
      {kbd && <Kbd className="ml-auto opacity-70">{kbd}</Kbd>}
    </button>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{children}</div>
}

function prettyPath(uri: string) {
  if (uri.startsWith("ssh://")) {
    const rest = uri.slice(6)
    const i = rest.indexOf("/")
    return { name: (i < 0 ? rest : rest.slice(i + 1)).split("/").filter(Boolean).pop() ?? rest, detail: i < 0 ? rest : rest.slice(0, i) }
  }
  const parts = uri.split("/").filter(Boolean)
  const name = parts.pop() ?? uri
  const dir = "/" + parts.join("/")
  return { name, detail: dir.replace(/^\/Users\/[^/]+/, "~") }
}

function EmptySidebar() {
  useStore((s) => s.recentNonce) // re-read after "Remove from Recent"
  const recent = recentWorkspaces().slice(0, 8)
  const open = useStore((s) => s.openWorkspace)
  return (
    <div className="flex h-full flex-col overflow-y-auto px-2 pt-1 pb-3">
      <Heading>Start</Heading>
      <Row icon={<IconFolderOpen />} label="Open Folder…" kbd="⌘O" onClick={() => void openFolderDialog()} />
      <Row icon={<IconServer2 />} label="Connect via SSH…" kbd="⇧⌘O" onClick={() => useStore.getState().openPalette("ssh")} />
      {recent.length > 0 && (
        <>
          <Heading>Recent</Heading>
          {recent.map((r) => {
            const { name, detail } = prettyPath(r)
            return (
              <Row
                key={r}
                icon={r.startsWith("ssh://") ? <IconServer2 /> : <IconFolder />}
                label={name}
                detail={detail}
                onClick={(e?: React.MouseEvent) => (e?.metaKey ? void newWindow(r) : void open(r))}
                uri={r}
              />
            )
          })}
        </>
      )}
    </div>
  )
}
