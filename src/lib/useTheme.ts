import { useEffect, useState } from "react"
import type { Theme as HlTheme } from "@pierre/highlights"
import { loadTheme, paletteFor, type ChromePalette } from "@/lib/themes"
import { useEffectiveDark, useStore } from "@/store"

/** The active (light or dark) theme object + derived chrome palette. */
export function useActiveTheme() {
  const dark = useEffectiveDark()
  const name = useStore((s) => (dark ? s.darkTheme : s.lightTheme))
  // Custom themes register asynchronously at boot; resolve only after that.
  const ready = useStore((s) => s.themesReady)
  const customCount = useStore((s) => s.customThemes.length)
  const [state, setState] = useState<{ name: string; theme: HlTheme; palette: ChromePalette } | null>(null)
  useEffect(() => {
    if (!ready) return
    let alive = true
    loadTheme(name).then((theme) => {
      if (alive) setState({ name, theme, palette: paletteFor(theme) })
    })
    return () => {
      alive = false
    }
  }, [name, ready, customCount])
  return state
}
