import { useCallback, useEffect, useMemo, useRef, type MouseEvent } from "react"
import { Markdown } from "@pierre/words/react"
import { createHighlightsPlugin } from "@pierre/words/highlights"
import "@pierre/words/styles.css"
import { convertFileSrc } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { useActiveTheme } from "@/lib/useTheme"
import { registerView } from "@/lib/views"
import { useStore } from "@/store"

/** Resolve `rel` against the directory of `from` (both workspace-relative). */
function resolveRel(from: string, rel: string) {
  const parts = from.split("/").slice(0, -1)
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") parts.pop()
    else parts.push(seg)
  }
  return parts.join("/")
}

function stripFrontmatter(src: string) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(src)
  return m ? src.slice(m[0].length) : src
}

export function MarkdownView({ tabId, text, path }: { tabId: string; text: string; path: string }) {
  const theme = useActiveTheme()
  const ws = useStore((s) => s.workspace)
  const openFile = useStore((s) => s.openFile)
  const scroller = useRef<HTMLDivElement>(null)

  const plugins = useMemo(() => (theme ? { code: createHighlightsPlugin({ theme: theme.theme }) } : undefined), [theme])

  const urlTransform = useCallback(
    (url: string, key: "href" | "src") => {
      if (key === "href") return url
      // Images: block remote (tracking pixels); resolve relative ones from the local workspace.
      if (/^(https?:)?\/\//i.test(url) || /^data:/i.test(url)) return /^data:image\//i.test(url) ? url : null
      if (!ws || ws.remote) return null
      const clean = url.split(/[?#]/)[0]
      const rel = clean.startsWith("/") ? clean.slice(1) : resolveRel(path, decodeURI(clean))
      return convertFileSrc(`${ws.id}/${rel}`)
    },
    [ws, path],
  )

  // Links never navigate the webview: external → browser, relative → open in Marie, # → scroll.
  const onClick = useCallback(
    (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a")
      if (!a) return
      const href = a.getAttribute("href") ?? ""
      e.preventDefault()
      if (/^(https?|mailto):/i.test(href)) {
        void openUrl(href)
      } else if (href.startsWith("#")) {
        const id = decodeURIComponent(href.slice(1))
        const root = scroller.current
        const el =
          root?.querySelector(`[id="${CSS.escape(id)}"]`) ?? root?.querySelector(`[id$="${CSS.escape(id)}"]`)
        el?.scrollIntoView({ behavior: "smooth", block: "start" })
      } else if (href) {
        openFile(resolveRel(path, decodeURI(href.split("#")[0])))
      }
    },
    [openFile, path],
  )

  useEffect(
    () =>
      registerView(tabId, {
        goToLine: () => {},
      }),
    [tabId],
  )

  const body = useMemo(() => stripFrontmatter(text), [text])
  if (!plugins) return null

  return (
    <div ref={scroller} className="h-full overflow-auto" onClick={onClick}>
      <article className="md-body mx-auto max-w-[860px] px-10 pt-10 pb-24">
        <Markdown mode="static" plugins={plugins} urlTransform={urlTransform} controls={{ code: { copy: true, download: false } }} lineNumbers={false}>
          {body}
        </Markdown>
      </article>
    </div>
  )
}
