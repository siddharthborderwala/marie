import { useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { IconChevronDown, IconChevronRight, IconLetterCase, IconRegex, IconLoader2, IconAlphabetLatin } from "@tabler/icons-react"
import { cn } from "cn"
import { useStore } from "@/store"
import { FileIcon } from "@/components/FileIcon"
import { viewHandle } from "@/lib/views"

interface Hit {
  path: string
  line: number
  col: number
  text: string
}

function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn("flex size-6 items-center justify-center rounded-md [&_svg]:size-4", on ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:bg-muted")}
    >
      {children}
    </button>
  )
}

/** Find in Files (⇧⌘F): git grep / grep in Rust, works locally and over ssh. */
export function SearchView() {
  const ws = useStore((s) => s.workspace)
  const openFile = useStore((s) => s.openFile)
  const [query, setQuery] = useState("")
  const [cs, setCs] = useState(false)
  const [rx, setRx] = useState(false)
  const [word, setWord] = useState(false)
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  useEffect(() => {
    if (!ws || !query.trim()) {
      setHits([])
      setError(null)
      return
    }
    let alive = true
    const t = window.setTimeout(async () => {
      setBusy(true)
      try {
        const r = await invoke<Hit[]>("search_workspace", { id: ws.id, query, caseSensitive: cs, regex: rx, wholeWord: word })
        if (alive) {
          setHits(r)
          setError(null)
        }
      } catch (e) {
        if (alive) setError(String(e))
      } finally {
        if (alive) setBusy(false)
      }
    }, 220)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [ws, query, cs, rx, word])

  const groups = useMemo(() => {
    const m = new Map<string, Hit[]>()
    for (const h of hits) m.set(h.path, [...(m.get(h.path) ?? []), h])
    return [...m]
  }, [hits])

  const open = (h: Hit) => {
    openFile(h.path)
    // Wait for the file view to mount, then jump.
    let tries = 0
    const go = () => {
      const s = useStore.getState()
      const v = viewHandle(s.activeId)
      if (v?.goToLine) v.goToLine(h.line)
      else if (tries++ < 40) window.setTimeout(go, 50)
    }
    window.setTimeout(go, 30)
  }

  const highlight = (text: string) => {
    if (!query) return text
    let re: RegExp
    try {
      const src = rx ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      re = new RegExp(word ? `\\b(?:${src})\\b` : src, cs ? "g" : "gi")
    } catch {
      return text
    }
    const out: React.ReactNode[] = []
    let last = 0
    for (const m of text.matchAll(re)) {
      if (m.index == null || m[0] === "") break
      out.push(text.slice(last, m.index), <mark key={m.index} className="rounded-sm bg-primary/30 text-foreground">{m[0]}</mark>)
      last = m.index + m[0].length
    }
    out.push(text.slice(last))
    return out
  }

  if (!ws) return <div className="p-4 text-xs text-muted-foreground">Open a folder to search.</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-2">
        <div className="flex h-8 items-center gap-1 rounded-4xl border bg-background px-3 focus-within:border-ring">
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <Toggle on={cs} onClick={() => setCs(!cs)} title="Match Case">
            <IconLetterCase />
          </Toggle>
          <Toggle on={word} onClick={() => setWord(!word)} title="Match Whole Word">
            <IconAlphabetLatin />
          </Toggle>
          <Toggle on={rx} onClick={() => setRx(!rx)} title="Use Regular Expression">
            <IconRegex />
          </Toggle>
        </div>
        <div className="flex h-6 items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          {busy && <IconLoader2 className="size-3 animate-spin" />}
          {error ? (
            <span className="truncate text-destructive">{error}</span>
          ) : query ? (
            <span>
              {hits.length.toLocaleString()}
              {hits.length >= 5000 ? "+" : ""} results in {groups.length} files
            </span>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 text-[13px]">
        {groups.map(([path, list]) => {
          const isCollapsed = collapsed.has(path)
          const slash = path.lastIndexOf("/")
          return (
            <div key={path}>
              <button
                className="flex h-6 w-full items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-muted"
                onClick={() =>
                  setCollapsed((c) => {
                    const n = new Set(c)
                    if (n.has(path)) n.delete(path)
                    else n.add(path)
                    return n
                  })
                }
              >
                {isCollapsed ? <IconChevronRight className="size-3.5 shrink-0 opacity-60" /> : <IconChevronDown className="size-3.5 shrink-0 opacity-60" />}
                <FileIcon path={path} />
                <span className="shrink-0">{path.slice(slash + 1)}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">{slash > 0 ? path.slice(0, slash) : ""}</span>
                <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground tabular-nums">{list.length}</span>
              </button>
              {!isCollapsed &&
                list.map((h) => (
                  <button
                    key={`${h.line}:${h.col}`}
                    onClick={() => open(h)}
                    data-menu="search-hit"
                    data-path={h.path}
                    data-line={h.line}
                    data-text={h.text}
                    className="flex h-6 w-full items-center gap-2 rounded-md pr-2 pl-8 text-left hover:bg-muted"
                    title={`${path}:${h.line}`}
                  >
                    <span className="truncate font-mono text-xs" style={{ fontFamily: "var(--code-font)" }}>
                      {highlight(h.text.trimStart())}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">{h.line}</span>
                  </button>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
