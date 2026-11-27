import { themes as themeLoaders } from "@pierre/highlights/themes/loader"
import type { Theme as HlTheme } from "@pierre/highlights"
import { themeToTreeStyles } from "@pierre/trees"
import { registerCustomTheme } from "@pierre/diffs"
import { ipc } from "@/lib/ipc"
import { convertVSCodeTheme, parseJsonc, type VSCodeTheme, type ZedStyleTheme } from "@/lib/vscodeTheme"

/** Curated theme catalog (names are shared by diffs, highlights and trees). */
export const DARK_THEMES = [
  "pierre-dark",
  "pierre-dark-vibrant",
  "pierre-dark-soft",
  "github-dark-default",
  "github-dark-dimmed",
  "one-dark-pro",
  "dracula",
  "tokyo-night",
  "catppuccin-mocha",
  "catppuccin-macchiato",
  "rose-pine",
  "rose-pine-moon",
  "nord",
  "night-owl",
  "vitesse-dark",
  "kanagawa-wave",
  "gruvbox-dark-medium",
  "everforest-dark",
  "ayu-dark",
  "material-theme-darker",
  "dark-plus",
].filter((n) => n in themeLoaders)

export const LIGHT_THEMES = [
  "pierre-light",
  "pierre-light-vibrant",
  "pierre-light-soft",
  "github-light-default",
  "one-light",
  "catppuccin-latte",
  "rose-pine-dawn",
  "vitesse-light",
  "kanagawa-lotus",
  "gruvbox-light-medium",
  "everforest-light",
  "ayu-light",
  "material-theme-lighter",
  "solarized-light",
  "light-plus",
].filter((n) => n in themeLoaders)

export function prettyThemeName(id: string) {
  return id
    .split("-")
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ")
}

const cache = new Map<string, HlTheme>()

// ---- user (custom) themes ---------------------------------------------------
export interface CustomThemeInfo {
  id: string
  label: string
  appearance: "dark" | "light"
}
const customThemes = new Map<string, ZedStyleTheme>()
const registered = new Set<string>()

/** Read VS Code themes from the themes folder, convert, and register them with Pierre. */
export async function loadCustomThemes(): Promise<{ themes: CustomThemeInfo[]; errors: string[] }> {
  const files = await ipc.listCustomThemes().catch(() => [])
  const themes: CustomThemeInfo[] = []
  const errors: string[] = []
  for (const f of files) {
    try {
      const json = parseJsonc(f.text) as VSCodeTheme
      if (!json || (!json.tokenColors && !json.colors)) continue
      const base = f.file.replace(/\.json$/i, "")
      const zed = convertVSCodeTheme(json, base)
      const id = "custom-" + base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      customThemes.set(id, zed)
      cache.delete(id)
      if (!registered.has(id)) {
        registered.add(id)
        // highlights backend (Zed format) + Shiki fallback (TextMate format)
        registerCustomTheme(id, async () => customThemes.get(id) as unknown as HlTheme, "zed")
        registerCustomTheme(id, async () => ({ ...(json as object), name: id }) as never, "textmate")
      }
      themes.push({ id, label: zed.name, appearance: zed.appearance })
    } catch (e) {
      errors.push(`${f.file}: ${e}`)
    }
  }
  return { themes, errors }
}

export function isCustomTheme(id: string) {
  return customThemes.has(id)
}

export async function loadTheme(id: string): Promise<HlTheme> {
  const hit = cache.get(id)
  if (hit) return hit
  const custom = customThemes.get(id)
  if (custom) {
    cache.set(id, custom as unknown as HlTheme)
    return custom as unknown as HlTheme
  }
  const known = id in themeLoaders ? themeLoaders[id] : undefined
  // Unknown id (e.g. a custom theme that was removed): fall back without caching under that id.
  const t = (await (known ?? themeLoaders["pierre-dark"])()).default
  if (known) cache.set(id, t)
  return t
}

// ---- color math (hex in, hex out, so every consumer can parse it) ----

function parseHex(c: string | undefined): [number, number, number, number] | null {
  if (!c || c[0] !== "#") return null
  let h = c.slice(1)
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("")
  if (h.length !== 6 && h.length !== 8) return null
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
}
const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")

/** Mix `a` toward `b` by t (0..1). */
export function mix(a: string, b: string, t: number) {
  const A = parseHex(a)
  const B = parseHex(b)
  if (!A || !B) return a
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t)
}
function solid(c: string | undefined, over: string) {
  const C = parseHex(c)
  if (!C) return undefined
  if (C[3] >= 1) return toHex(C[0], C[1], C[2])
  return mix(over, toHex(C[0], C[1], C[2]), C[3])
}
export function alpha(c: string, a: number) {
  const C = parseHex(c)
  if (!C) return c
  return toHex(C[0], C[1], C[2]) + Math.round(a * 255).toString(16).padStart(2, "0")
}

export interface ChromePalette {
  type: "dark" | "light"
  bg: string
  fg: string
  sidebar: string
  muted: string
  mutedFg: string
  accent: string
  border: string
  primary: string
  popover: string
  added: string
  deleted: string
  modified: string
}

export function paletteFor(t: HlTheme): ChromePalette {
  const s = (t as unknown as { style: Record<string, unknown>; appearance: "dark" | "light" }).style
  const type = (t as unknown as { appearance: "dark" | "light" }).appearance === "light" ? "light" : "dark"
  const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : undefined)
  const bg = solid(str("editor.background") ?? str("background"), type === "dark" ? "#000000" : "#ffffff") ?? (type === "dark" ? "#141414" : "#ffffff")
  const fg = solid(str("editor.foreground") ?? str("text"), bg) ?? (type === "dark" ? "#e5e5e5" : "#1a1a1a")
  const players = s["players"] as { cursor?: string }[] | undefined
  const primary = solid(players?.[0]?.cursor, bg) ?? mix(bg, fg, 0.8)
  const d = type === "dark"
  const vs = (t as unknown as { vscodeColors?: Record<string, string> }).vscodeColors
  const v = (k: string) => (vs?.[k] ? solid(vs[k], bg) : undefined)
  return {
    type,
    bg,
    fg,
    sidebar: v("sideBar.background") ?? mix(bg, d ? "#000000" : fg, d ? 0.18 : 0.025),
    muted: mix(bg, fg, d ? 0.08 : 0.05),
    mutedFg: mix(fg, bg, 0.42),
    accent: mix(bg, fg, d ? 0.12 : 0.08),
    border: v("panel.border") ?? v("sideBar.border") ?? mix(bg, fg, d ? 0.14 : 0.12),
    primary: v("button.background") ?? v("focusBorder") ?? primary,
    popover: mix(bg, fg, d ? 0.05 : 0.0),
    added: solid(str("created"), bg) ?? "#3fb950",
    deleted: solid(str("deleted"), bg) ?? "#f85149",
    modified: solid(str("modified"), bg) ?? "#d29922",
  }
}

/** Push the palette into shadcn CSS variables so the whole chrome follows the code theme. */
export function applyChrome(p: ChromePalette) {
  const r = document.documentElement
  const set = (k: string, v: string) => r.style.setProperty(k, v)
  set("--background", p.bg)
  set("--foreground", p.fg)
  set("--card", p.popover)
  set("--card-foreground", p.fg)
  set("--popover", p.popover)
  set("--popover-foreground", p.fg)
  set("--primary", p.primary)
  set("--primary-foreground", p.bg)
  set("--secondary", p.muted)
  set("--secondary-foreground", p.fg)
  set("--muted", p.muted)
  set("--muted-foreground", p.mutedFg)
  set("--accent", p.accent)
  set("--accent-foreground", p.fg)
  set("--border", p.border)
  set("--input", p.border)
  set("--ring", p.primary)
  set("--sidebar", p.sidebar)
  set("--sidebar-foreground", p.fg)
  set("--sidebar-border", p.border)
  set("--sidebar-accent", p.accent)
  set("--sidebar-accent-foreground", p.fg)
  set("--git-added", p.added)
  set("--git-deleted", p.deleted)
  set("--git-modified", p.modified)
  r.classList.toggle("dark", p.type === "dark")
  r.style.colorScheme = p.type
}

export function treeStylesFor(p: ChromePalette) {
  return themeToTreeStyles({
    type: p.type,
    bg: p.sidebar,
    fg: p.fg,
    colors: {
      "sideBar.background": p.sidebar,
      "sideBar.foreground": p.fg,
      "list.hoverBackground": alpha(p.fg, p.type === "dark" ? 0.06 : 0.05),
      "list.activeSelectionBackground": alpha(p.primary, 0.22),
      "list.inactiveSelectionBackground": alpha(p.primary, 0.14),
      "list.focusBackground": alpha(p.primary, 0.22),
      "list.activeSelectionForeground": p.fg,
      "focusBorder": alpha(p.primary, 0.6),
      "input.background": p.bg,
      "input.border": p.border,
      "gitDecoration.addedResourceForeground": p.added,
      "gitDecoration.untrackedResourceForeground": p.added,
      "gitDecoration.modifiedResourceForeground": p.modified,
      "gitDecoration.deletedResourceForeground": p.deleted,
      "gitDecoration.renamedResourceForeground": p.modified,
    },
  })
}

/** Built-in + custom themes for one appearance, as [id, label] pairs. */
export function themeOptions(dark: boolean, custom: CustomThemeInfo[]): [string, string][] {
  const builtin = (dark ? DARK_THEMES : LIGHT_THEMES).map((t) => [t, prettyThemeName(t)] as [string, string])
  const mine = custom.filter((c) => (c.appearance === "dark") === dark).map((c) => [c.id, c.label] as [string, string])
  return [...mine, ...builtin]
}
