import { useEffect, useMemo, useRef, useState } from "react"
import {
  CommandDialog,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { IconFolder, IconGitBranch, IconPalette, IconServer2, IconTerminal2 } from "@tabler/icons-react"
import { activeTab, recentWorkspaces, useStore, type PaletteMode } from "@/store"
import { commands, openFolderDialog } from "@/commands"
import { ipc } from "@/lib/ipc"
import { themeOptions } from "@/lib/themes"
import { SCRATCH_LANGS, viewHandle } from "@/lib/views"
import { FileIcon } from "@/components/FileIcon"

const PLACEHOLDER: Record<PaletteMode, string> = {
  files: "Go to file…  (> commands, : line)",
  commands: "Type a command…",
  line: "Go to line…",
  ssh: "host, host:/path or ssh://host/path",
  "theme-dark": "Select dark theme",
  "theme-light": "Select light theme",
  branch: "Compare working tree with branch…",
  lang: "Select language mode",
}

export function Palette() {
  const { open, mode } = useStore((s) => s.palette)
  const close = useStore((s) => s.closePalette)
  const [query, setQuery] = useState("")

  // Prefix switching like VS Code: ">" commands, ":" line.
  let effMode: PaletteMode = mode
  let q = query
  if (mode === "files" && query.startsWith(">")) {
    effMode = "commands"
    q = query.slice(1)
  } else if (mode === "files" && query.startsWith(":")) {
    effMode = "line"
    q = query.slice(1)
  }

  const [highlight, setHighlight] = useState("")
  useEffect(() => {
    if (!open) return
    setQuery("")
    // Theme pickers start on the current theme; other modes start on the first item.
    const s = useStore.getState()
    setHighlight(mode === "theme-dark" ? s.darkTheme : mode === "theme-light" ? s.lightTheme : "")
  }, [open, mode])

  const themeSnapshot = useRef<{ darkTheme: string; lightTheme: string } | null>(null)
  useEffect(() => {
    if (open && (mode === "theme-dark" || mode === "theme-light")) {
      const s = useStore.getState()
      themeSnapshot.current = { darkTheme: s.darkTheme, lightTheme: s.lightTheme }
    }
  }, [open, mode])

  const onOpenChange = (o: boolean) => {
    if (!o) {
      // Escape from theme picker reverts the live preview.
      if (themeSnapshot.current && (mode === "theme-dark" || mode === "theme-light")) {
        useStore.getState().setPrefs(themeSnapshot.current)
      }
      themeSnapshot.current = null
      close()
    }
  }
  const done = () => {
    themeSnapshot.current = null
    close()
  }

  const isTheme = effMode === "theme-dark" || effMode === "theme-light"

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="max-w-xl sm:max-w-xl">
      <Command
        shouldFilter={effMode !== "files" && effMode !== "line" && effMode !== "ssh"}
        loop
        // Controlled highlight: cmdk only reports highlight changes when `value` is controlled.
        value={highlight}
        onValueChange={(v) => {
          setHighlight(v)
          // Live preview while moving through the theme list.
          if (isTheme && v && themeOptions(effMode === "theme-dark", useStore.getState().customThemes).some(([id]) => id === v))
            useStore.getState().setPrefs(effMode === "theme-dark" ? { darkTheme: v } : { lightTheme: v })
        }}
      >
        <CommandInput placeholder={PLACEHOLDER[effMode]} value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[min(420px,60vh)] scroll-py-2 pt-2 pb-1">
          {effMode === "files" && <FileResults query={q} onDone={done} />}
          {effMode === "commands" && <CommandResults onDone={done} />}
          {effMode === "line" && <LineResult query={q} onDone={done} />}
          {effMode === "ssh" && <SshResults query={q} onDone={done} />}
          {isTheme && <ThemeResults dark={effMode === "theme-dark"} onDone={done} />}
          {effMode === "branch" && <BranchResults onDone={done} />}
          {effMode === "lang" && <LangResults onDone={done} />}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

function FileResults({ query, onDone }: { query: string; onDone: () => void }) {
  const ws = useStore((s) => s.workspace)
  const fileCount = useStore((s) => s.files.length)
  const openFile = useStore((s) => s.openFile)
  const [results, setResults] = useState<string[]>([])

  useEffect(() => {
    if (!ws) return
    let alive = true
    const t = window.setTimeout(
      () => ipc.findFiles(ws.id, query, 80).then((r) => alive && setResults(r)),
      query ? 0 : 0,
    )
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [ws, query, fileCount])

  if (!ws) {
    const recent = recentWorkspaces()
    return (
      <>
        <CommandGroup heading="Open">
          <CommandItem value="open-folder" onSelect={() => (onDone(), void openFolderDialog())}>
            <IconFolder /> Open Folder…
            <CommandShortcut>⌘O</CommandShortcut>
          </CommandItem>
          <CommandItem value="ssh" onSelect={() => useStore.getState().openPalette("ssh")}>
            <IconServer2 /> Connect via SSH…
          </CommandItem>
        </CommandGroup>
        {recent.length > 0 && (
          <CommandGroup heading="Recent">
            {recent.map((r) => (
              <CommandItem key={r} value={r} onSelect={() => (onDone(), void useStore.getState().openWorkspace(r))}>
                {r.startsWith("ssh://") ? <IconServer2 /> : <IconFolder />}
                <span className="truncate">{r}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </>
    )
  }

  return (
    <>
      <CommandEmpty>No matching files</CommandEmpty>
      {results.map((p) => {
        const slash = p.lastIndexOf("/")
        return (
          <CommandItem key={p} value={p} onSelect={() => (onDone(), openFile(p))}>
            <FileIcon path={p} />
            <span className="shrink-0">{p.slice(slash + 1)}</span>
            <span className="truncate text-xs text-muted-foreground">{slash > 0 ? p.slice(0, slash) : ""}</span>
          </CommandItem>
        )
      })}
    </>
  )
}

function CommandResults({ onDone }: { onDone: () => void }) {
  const ws = useStore((s) => s.workspace)
  const visible = useMemo(() => commands.filter((c) => c.id !== "view.palette" && (!c.when || c.when())), [ws])
  return (
    <>
      <CommandEmpty>No matching commands</CommandEmpty>
      {visible.map((c) => (
        <CommandItem
          key={c.id}
          value={`${c.group}: ${c.title}`}
          onSelect={() => {
            onDone()
            // Commands that open another palette mode need the dialog to re-open after close.
            window.setTimeout(() => void c.run(), 0)
          }}
        >
          <IconTerminal2 className="opacity-60" />
          <span className="text-muted-foreground">{c.group}:</span> {c.title}
          {c.shortcut && <CommandShortcut>{c.shortcut}</CommandShortcut>}
        </CommandItem>
      ))}
    </>
  )
}

function LineResult({ query, onDone }: { query: string; onDone: () => void }) {
  const tab = activeTab()
  const handle = viewHandle(tab?.id)
  const n = parseInt(query.trim(), 10)
  const total = handle?.lineCount?.()
  if (!handle?.goToLine) return <CommandEmpty>No code view is active</CommandEmpty>
  return (
    <CommandItem
      value="go-line"
      onSelect={() => {
        onDone()
        if (n > 0) window.setTimeout(() => handle.goToLine?.(n), 0)
      }}
    >
      {n > 0 ? `Go to line ${n}` : `Type a line number${total ? ` (1–${total.toLocaleString()})` : ""}`}
    </CommandItem>
  )
}

function toSshUri(input: string) {
  const s = input.trim()
  if (!s) return null
  if (s.startsWith("ssh://")) return s
  const m = /^([^\s:/]+)(?::(.*))?$/.exec(s) ?? /^(\S+)\s+(\S+)$/.exec(s)
  if (!m) return null
  const path = (m[2] ?? "").trim()
  if (!path) return `ssh://${m[1]}`
  if (path.startsWith("/")) return `ssh://${m[1]}${path}`
  if (path.startsWith("~")) return `ssh://${m[1]}/${path}`
  return `ssh://${m[1]}/~/${path}`
}

function SshResults({ query, onDone }: { query: string; onDone: () => void }) {
  const [hosts, setHosts] = useState<string[]>([])
  useEffect(() => {
    ipc.sshHosts().then(setHosts).catch(() => setHosts([]))
  }, [])
  const openWs = (uri: string) => {
    onDone()
    void useStore.getState().openWorkspace(uri)
  }
  const typed = toSshUri(query)
  const recent = recentWorkspaces().filter((r) => r.startsWith("ssh://") && r.includes(query.trim()))
  const hostMatches = hosts.filter((h) => h.toLowerCase().includes(query.split(/[:\s/]/)[0].toLowerCase()))
  return (
    <>
      {typed && query.includes(":") && (
        <CommandItem value={`open ${typed}`} onSelect={() => openWs(typed)}>
          <IconServer2 /> Open <span className="font-mono text-xs">{typed}</span>
        </CommandItem>
      )}
      {recent.length > 0 && (
        <CommandGroup heading="Recent">
          {recent.map((r) => (
            <CommandItem key={r} value={r} onSelect={() => openWs(r)}>
              <IconServer2 /> <span className="font-mono text-xs">{r}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      <CommandGroup heading="~/.ssh/config · type host:/path for a specific folder">
        {hostMatches.map((h) => (
          <CommandItem key={h} value={h} onSelect={() => openWs(`ssh://${h}`)}>
            <IconServer2 /> <span className="truncate">{h}</span>
          </CommandItem>
        ))}
        {typed && !query.includes(":") && !hosts.includes(query.trim()) && (
          <CommandItem value={`open ${typed}`} onSelect={() => openWs(typed)}>
            <IconServer2 /> Open <span className="font-mono text-xs">{typed}</span>
          </CommandItem>
        )}
      </CommandGroup>
    </>
  )
}

function ThemeResults({ dark, onDone }: { dark: boolean; onDone: () => void }) {
  const custom = useStore((s) => s.customThemes)
  const list = themeOptions(dark, custom)
  const current = useStore((s) => (dark ? s.darkTheme : s.lightTheme))
  return (
    <CommandGroup heading={dark ? "Dark themes" : "Light themes"}>
      {list.map(([t, label]) => (
        <CommandItem
          key={t}
          value={t}
          keywords={[label]}
          onSelect={() => {
            useStore.getState().setPrefs(dark ? { darkTheme: t } : { lightTheme: t })
            onDone()
          }}
          data-checked={t === current}
        >
          <IconPalette className="opacity-60" /> {label}
          {t.startsWith("custom-") && <CommandShortcut className="tracking-normal">custom</CommandShortcut>}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

function BranchResults({ onDone }: { onDone: () => void }) {
  const repo = useStore((s) => s.repo)
  const openDiff = useStore((s) => s.openDiff)
  const branches = repo?.branches ?? []
  const ordered = [...branches].sort((a, b) => Number(b === repo?.default_base) - Number(a === repo?.default_base))
  return (
    <>
      <CommandEmpty>No branches</CommandEmpty>
      {ordered.map((b) => (
        <CommandItem key={b} value={b} onSelect={() => (onDone(), openDiff("branch", b))}>
          <IconGitBranch className="opacity-60" /> {b}
          {b === repo?.default_base && <CommandShortcut className="tracking-normal">default base</CommandShortcut>}
        </CommandItem>
      ))}
    </>
  )
}

function LangResults({ onDone }: { onDone: () => void }) {
  const tab = activeTab()
  const updateTab = useStore((s) => s.updateTab)
  if (tab?.kind !== "scratch" && tab?.kind !== "file") return <CommandEmpty>No editor is active</CommandEmpty>
  return (
    <>
      <CommandItem value="auto detect" onSelect={() => (onDone(), updateTab(tab.id, { lang: null }))}>
        Auto detect
      </CommandItem>
      {SCRATCH_LANGS.map((l) => (
        <CommandItem key={l} value={l} onSelect={() => (onDone(), updateTab(tab.id, { lang: l }))}>
          {l}
        </CommandItem>
      ))}
    </>
  )
}
