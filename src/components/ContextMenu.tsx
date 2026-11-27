import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { create } from "zustand"
import { cn } from "cn"

export type MenuItem =
  | {
      label: string
      run: () => void | Promise<void>
      shortcut?: string
      disabled?: boolean
      danger?: boolean
    }
  | "separator"

interface MenuState {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
  show(x: number, y: number, items: MenuItem[]): void
  hide(): void
}

export const useContextMenu = create<MenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (x, y, items) => set({ open: true, x, y, items }),
  hide: () => set({ open: false }),
}))

/** Single app-wide context menu, positioned at the cursor and clamped to the window. */
export function ContextMenuHost() {
  const { open, x, y, items, hide } = useContextMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; key: string } | null>(null)
  const openKey = `${x},${y},${items.length}`
  const [active, setActive] = useState(-1)

  const enabled = items.map((it, i) => (it !== "separator" && !it.disabled ? i : -1)).filter((i) => i >= 0)

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const pad = 6
    setPos({
      left: Math.min(x, window.innerWidth - r.width - pad),
      top: y + r.height > window.innerHeight - pad ? Math.max(pad, y - r.height) : y,
      key: openKey,
    })
    setActive(-1)
    ref.current.focus()
  }, [open, x, y, items])

  useEffect(() => {
    if (!open) return
    const close = () => hide()
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) hide()
    }
    window.addEventListener("mousedown", onDown, true)
    window.addEventListener("blur", close)
    window.addEventListener("resize", close)
    window.addEventListener("wheel", close, { passive: true })
    return () => {
      window.removeEventListener("mousedown", onDown, true)
      window.removeEventListener("blur", close)
      window.removeEventListener("resize", close)
      window.removeEventListener("wheel", close)
    }
  }, [open, hide])

  if (!open) return null

  const run = (it: MenuItem) => {
    if (it === "separator" || it.disabled) return
    hide()
    // Let the menu unmount (and focus return) before running the action.
    window.setTimeout(() => void it.run(), 0)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      hide()
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!enabled.length) return
      const idx = enabled.indexOf(active)
      const next = e.key === "ArrowDown" ? enabled[(idx + 1) % enabled.length] : enabled[(idx - 1 + enabled.length) % enabled.length]
      setActive(next ?? enabled[0])
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      const it = items[active]
      if (it) run(it)
    }
  }

  return (
    <div
      key={openKey}
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[100] min-w-52 rounded-2xl bg-popover p-1 text-[13px] text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none select-none animate-in fade-in-0 duration-150"
      // Rendered at the cursor, measured, then clamped before paint (no animation, no jump).
      style={pos && pos.key === openKey ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: "hidden" }}
    >
      {items.map((it, i) =>
        it === "separator" ? (
          <div key={i} className="mx-2 my-1 h-px bg-border" />
        ) : (
          <div
            key={i}
            role="menuitem"
            aria-disabled={it.disabled}
            onMouseEnter={() => setActive(it.disabled ? -1 : i)}
            onMouseLeave={() => setActive(-1)}
            onClick={() => run(it)}
            className={cn(
              "flex h-7 cursor-default items-center gap-6 rounded-xl px-2.5",
              it.disabled && "opacity-40",
              !it.disabled && i === active && (it.danger ? "bg-destructive/15 text-destructive" : "bg-accent text-accent-foreground"),
              it.danger && !it.disabled && "text-destructive",
            )}
          >
            <span className="flex-1 truncate">{it.label}</span>
            {it.shortcut && <span className="text-xs tracking-wide text-muted-foreground">{it.shortcut}</span>}
          </div>
        ),
      )}
    </div>
  )
}
