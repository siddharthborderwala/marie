import { useEffect, useRef, useState } from "react"
import { Channel, invoke } from "@tauri-apps/api/core"
import { init, Terminal, FitAddon, type ITheme } from "ghostty-web"
import { IconPlus, IconTerminal2, IconX } from "@tabler/icons-react"
import { cn } from "cn"
import { useStore } from "@/store"
import { useActiveTheme } from "@/lib/useTheme"
import { Button } from "@/components/ui/button"
import { terminals } from "@/lib/terminalRef"

let ghosttyReady: Promise<void> | null = null
const ensureGhostty = () => (ghosttyReady ??= init())

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const

function terminalTheme(style: Record<string, unknown> | undefined, bg: string, fg: string, cursor: string): ITheme {
  const get = (k: string) => (typeof style?.[k] === "string" ? (style[k] as string) : undefined)
  const t: ITheme = { background: bg, foreground: fg, cursor, cursorAccent: bg, selectionBackground: fg + "33" }
  for (const c of ANSI) {
    const cap = c[0].toUpperCase() + c.slice(1)
    ;(t as Record<string, string | undefined>)[c] = get(`terminal.ansi.${c}`)
    ;(t as Record<string, string | undefined>)[`bright${cap}`] = get(`terminal.ansi.bright_${c}`) ?? get(`terminal.ansi.${c}`)
  }
  for (const k of Object.keys(t)) if ((t as Record<string, unknown>)[k] == null) delete (t as Record<string, unknown>)[k]
  return t
}

function TerminalSession({ sid, active, onTitle, onExit }: { sid: string; active: boolean; onTitle: (t: string) => void; onExit: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const wsId = useStore((s) => s.workspace?.id ?? null)
  const theme = useActiveTheme()
  const codeFont = useStore((s) => s.codeFont)
  const codeSize = useStore((s) => s.codeFontSize)
  const [ready, setReady] = useState(false)
  const themeRef = useRef<ITheme | undefined>(undefined)
  if (theme) {
    const style = (theme.theme as unknown as { style?: Record<string, unknown> }).style
    themeRef.current = terminalTheme(style, theme.palette.bg, theme.palette.fg, theme.palette.primary)
  }

  // Create once per session (the session keeps its workspace from when it was opened).
  useEffect(() => {
    let disposed = false
    let pid: number | null = null
    const el = host.current
    if (!el) return
    ;(async () => {
      await ensureGhostty()
      if (disposed) return
      const css = getComputedStyle(document.documentElement)
      const t = new Terminal({
        fontFamily: css.getPropertyValue("--code-font") || "monospace",
        fontSize: useStore.getState().codeFontSize,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 10000,
        theme: themeRef.current,
      })
      const f = new FitAddon()
      t.loadAddon(f)
      t.open(el)
      f.fit()
      term.current = t
      fit.current = f
      setReady(true)

      const onData = new Channel<ArrayBuffer>()
      onData.onmessage = (buf) => t.write(new Uint8Array(buf))
      const onExitCh = new Channel<number | null>()
      onExitCh.onmessage = () => {
        t.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n")
        onExit()
      }
      pid = await invoke<number>("pty_spawn", { id: wsId, cols: t.cols, rows: t.rows, onData, onExit: onExitCh })
      if (disposed) {
        void invoke("pty_kill", { pid })
        return
      }
      const input = (d: string) => void invoke("pty_write", { pid, data: d })
      t.onData(input)
      terminals.set(sid, { term: t, ready: true, input })
      t.onResize(({ cols, rows }) => void invoke("pty_resize", { pid, cols, rows }))
      t.onTitleChange((title) => title && onTitle(title))
      t.focus()
    })()

    const ro = new ResizeObserver(() => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) fit.current?.fit()
    })
    ro.observe(el)
    return () => {
      disposed = true
      ro.disconnect()
      terminals.delete(sid)
      if (pid != null) void invoke("pty_kill", { pid })
      term.current?.dispose()
      term.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow theme + font changes live.
  useEffect(() => {
    const t = term.current
    if (!t || !themeRef.current) return
    t.options.theme = themeRef.current
  }, [theme, ready])
  useEffect(() => {
    const t = term.current
    if (!t) return
    t.options.fontSize = codeSize
    t.options.fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--code-font") || "monospace"
    fit.current?.fit()
  }, [codeFont, codeSize, ready])

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        fit.current?.fit()
        term.current?.focus()
      })
    }
  }, [active])

  return <div ref={host} data-menu="terminal" data-term-id={sid} className={cn("absolute inset-0 px-3 pt-1.5", !active && "invisible")} />
}

export function TerminalPanel() {
  const open = useStore((s) => s.terminal.open)
  const sessions = useStore((s) => s.terminal.sessions)
  const activeId = useStore((s) => s.terminal.active)
  const height = useStore((s) => s.terminal.height)
  const { newTerminal, closeTerminal, setTerminal } = useStore.getState()
  const [titles, setTitles] = useState<Record<string, string>>({})

  // Opening the panel with no sessions starts one.
  useEffect(() => {
    if (open && sessions.length === 0) newTerminal()
  }, [open, sessions.length, newTerminal])

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const move = (ev: PointerEvent) => {
      const h = Math.max(120, Math.min(window.innerHeight - 160, startH + (startY - ev.clientY)))
      setTerminal({ height: h })
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  if (sessions.length === 0) return null
  return (
    // Kept mounted while hidden so shells survive toggling the panel.
    <div className={cn("relative flex shrink-0 flex-col border-t bg-background", !open && "hidden")} style={{ height }}>
      <div className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize" onPointerDown={startDrag} />
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
          {sessions.map((s, i) => (
            <div
              key={s.id}
              onMouseDown={() => setTerminal({ active: s.id })}
              className={cn(
                "group flex h-7 max-w-52 shrink-0 cursor-default items-center gap-1.5 rounded-4xl pr-1.5 pl-3 text-xs font-medium select-none",
                s.id === activeId ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <IconTerminal2 className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">{titles[s.id] ?? `Terminal ${i + 1}`}</span>
              <button
                className="flex size-4 items-center justify-center rounded-full opacity-0 group-hover:opacity-60 hover:bg-foreground/10 hover:opacity-100"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => closeTerminal(s.id)}
                aria-label="Kill terminal"
              >
                <IconX className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <Button size="icon-xs" variant="ghost" className="text-muted-foreground [&_svg]:size-4" onClick={() => newTerminal()} title="New Terminal (⌃⇧`)">
          <IconPlus />
        </Button>
        <div className="flex-1" />
        <Button size="icon-xs" variant="ghost" className="text-muted-foreground [&_svg]:size-4" onClick={() => setTerminal({ open: false })} title="Hide Panel (⌃`)">
          <IconX />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {sessions.map((s) => (
          <TerminalSession
            key={s.id}
            sid={s.id}
            active={open && s.id === activeId}
            onTitle={(t) => setTitles((x) => ({ ...x, [s.id]: t }))}
            onExit={() => closeTerminal(s.id)}
          />
        ))}
      </div>
    </div>
  )
}
