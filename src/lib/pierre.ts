import { useMemo } from "react"
import { canUseWASM } from "@pierre/diffs"
import { useEffectiveDark, useStore } from "@/store"
import { onPostRenderIndentGuides } from "@/lib/indentGuides"

/** Native-feeling caret: hard on/off blink (~530ms each, like macOS) instead of Pierre's slow fade. */
export const EDITOR_CSS = `
@keyframes marie-caret-blink { 0% { opacity: 1 } 50% { opacity: 0 } 100% { opacity: 0 } }
@media (prefers-reduced-motion: no-preference) {
  [data-caret] { animation: marie-caret-blink 1.06s steps(1, end) 0.5s infinite; }
}
/* Code background = window background, so code and the area around it always match
   (Pierre's theme copy can differ slightly from the chrome palette). */
:host { --diffs-dark-bg: var(--background); --diffs-light-bg: var(--background); --diffs-bg: var(--background); }
/* Code starts right after the divider (Pierre reserves 2ch for +/- markers; we use bars). */
[data-line] { padding-inline-start: 0.75ch; }
/* Indent guides: one 1px line per indent level, painted from data-indent (see indentGuides.ts) */
[data-line][data-indent] {
  background-image: repeating-linear-gradient(
    to right,
    var(--marie-guide-color, color-mix(in srgb, var(--diffs-fg) 13%, transparent)) 0 1px,
    transparent 1px calc(var(--indent-unit, 4) * 1ch)
  );
  background-size: calc(var(--indent) * 1ch) 100%;
  background-repeat: no-repeat;
  background-position: 0.75ch 0;
}
/* Code weight follows Settings → Code → Weight */
:host, pre, code, [data-code] { font-weight: var(--code-font-weight, 400); }
/* No horizontal scrollbar under code; trackpad / shift-scroll still scroll sideways. */
* { scrollbar-width: none; }
*::-webkit-scrollbar { display: none; width: 0; height: 0; }
`

export const HIGHLIGHTER = canUseWASM() ? ("highlights" as const) : ("shiki-js" as const)

/** Shared, memoized options for every Pierre surface so theme/style changes apply everywhere. */
export function useCodeOptions() {
  const darkTheme = useStore((s) => s.darkTheme)
  const lightTheme = useStore((s) => s.lightTheme)
  // Pass Pierre one resolved theme: with the highlights backend a themeType flip alone
  // doesn't re-tokenize already-rendered code, but a theme *name* change does.
  const dark = useEffectiveDark()
  const diffStyle = useStore((s) => s.diffStyle)
  const wrap = useStore((s) => s.wrap)
  const lineHeight = useStore((s) => codeLineHeightPx(s.codeFontSize, s.codeLineHeight))
  return useMemo(
    () => ({
      theme: dark ? darkTheme : lightTheme,
      themeType: dark ? ("dark" as const) : ("light" as const),
      preferredHighlighter: HIGHLIGHTER,
      diffStyle,
      overflow: wrap ? ("wrap" as const) : ("scroll" as const),
      hunkSeparators: "line-info" as const,
      lineDiffType: "word-alt" as const,
      stickyHeaders: true,
      layout: { paddingTop: 0, paddingBottom: 48, gap: 0 },
      // Must match --diffs-line-height so virtualization estimates stay exact.
      itemMetrics: { lineHeight },
      unsafeCSS: EDITOR_CSS,
      onPostRender: onPostRenderIndentGuides,
    }),
    [darkTheme, lightTheme, dark, diffStyle, wrap, lineHeight],
  )
}

export function codeLineHeightPx(size: number, ratio: number) {
  return Math.round(size * ratio)
}
