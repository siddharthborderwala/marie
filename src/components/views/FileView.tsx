import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react"
import type { CodeViewItem, SupportedLanguages } from "@pierre/diffs"
import { ipc, type FileData } from "@/lib/ipc"
import { useCodeOptions } from "@/lib/pierre"
import { registerView } from "@/lib/views"
import { registerSaver } from "@/lib/editing"
import { detectLang, isMarkdownPath } from "@/lib/views"
import { useStore } from "@/store"
import { MarkdownView } from "./MarkdownView"
import { Placeholder } from "./Placeholder"
import { TabActions } from "@/components/TabActions"
import { Button } from "@/components/ui/button"
import { IconCode, IconEye } from "@tabler/icons-react"
import { MediaView, mediaKind } from "./MediaView"

const LARGE_LINES = 300_000

export function FileView({
  tabId,
  path,
  mdSource,
  preview,
  lang,
}: {
  tabId: string
  path: string
  mdSource?: boolean
  preview?: boolean
  lang?: string | null
}) {
  const media = mediaKind(path)
  const updateTab = useStore((s) => s.updateTab)
  // Media renders without reading text; SVG can flip to its (editable) source.
  if (media && !(media[0] === "svg" && mdSource)) {
    return (
      <MediaView
        tabId={tabId}
        path={path}
        kind={media[0]}
        mime={media[1]}
        onShowSource={media[0] === "svg" ? () => updateTab(tabId, { mdSource: true }) : undefined}
      />
    )
  }
  return <TextFileView tabId={tabId} path={path} preview={preview} lang={lang} />
}

function TextFileView({ tabId, path, preview, lang }: { tabId: string; path: string; preview?: boolean; lang?: string | null }) {
  const wsId = useStore((s) => s.workspace?.id)
  const [data, setData] = useState<FileData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stamp, setStamp] = useState(0)

  useEffect(() => {
    if (!wsId) return
    let alive = true
    setData(null)
    setError(null)
    ipc
      .readFile(wsId, path)
      .then((d) => {
        if (!alive) return
        setData(d)
        setStamp(Date.now())
      })
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [wsId, path])

  if (error) return <Placeholder title="Couldn't open file" detail={error} />
  if (!data) return <Placeholder loading />
  if (data.binary) return <Placeholder title="Binary file" detail={`${path} · ${formatBytes(data.size)}`} />
  if (data.too_large || data.text == null)
    return <Placeholder title="File too large to display" detail={`${path} · ${formatBytes(data.size)}`} />

  // Markdown opens as code (editable); preview is a toggle (⇧⌘V or the tab-row button).
  if (isMarkdownPath(path) && preview) {
    return (
      <>
        <PreviewToggle tabId={tabId} preview />
        <MarkdownView tabId={tabId} text={data.text} path={path} />
      </>
    )
  }
  return (
    <>
      {isMarkdownPath(path) && <PreviewToggle tabId={tabId} preview={false} />}
      <CodeFile tabId={tabId} path={path} text={data.text} stamp={stamp} langOverride={lang} />
    </>
  )
}

function CodeFile({
  tabId,
  path,
  text,
  stamp,
  langOverride,
}: {
  tabId: string
  path: string
  text: string
  stamp: number
  langOverride?: string | null
}) {
  const options = useCodeOptions()
  const ref = useRef<CodeViewHandle<undefined, undefined> | null>(null)
  const plain = useMemo(() => countLines(text) > LARGE_LINES, [text])
  const items = useMemo<CodeViewItem<undefined>[]>(
    () => [
      {
        type: "file",
        id: tabId,
        file: {
          name: path,
          contents: text,
          cacheKey: `${path}@${stamp}`,
          ...(plain
            ? { lang: "text" as const }
            : langOverride
              ? { lang: langOverride as SupportedLanguages }
              : detectLang(path, text)
                ? { lang: detectLang(path, text) }
                : {}),
        },
        edit: true,
      },
    ],
    [tabId, path, text, stamp, plain, langOverride],
  )

  const setDirty = useStore((s) => s.setDirty)
  useEffect(
    () =>
      registerSaver({
        key: tabId,
        tabId,
        path,
        original: text,
        getText: () => ref.current?.getEditor(tabId)?.getText(),
      }),
    [tabId, path, text],
  )
  const viewOptions = useMemo(() => ({ ...options, disableFileHeader: true }), [options])

  // Click below the last line → caret at end of file (and lets you scroll past the end).
  const renderFooter = useCallback(
    () => (
      <div
        className="h-[40vh] cursor-text"
        onMouseDown={(e) => {
          e.preventDefault()
          const ed = ref.current?.getEditor(tabId)
          if (!ed) return
          const lines = ed.getText().split("\n")
          ed.focus({ lineNumber: lines.length, character: lines[lines.length - 1].length })
        }}
      />
    ),
    [tabId],
  )

  useEffect(
    () =>
      registerView(tabId, {
        goToLine: (n) => ref.current?.scrollTo({ type: "line", id: tabId, lineNumber: n, align: "center" }),
        lineCount: () => countLines(text),
        getText: () => ref.current?.getEditor(tabId)?.getText() ?? text,
      }),
    [tabId, text],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {plain && (
        <div className="border-b bg-muted px-4 py-1.5 text-xs text-muted-foreground">
          Large file: syntax highlighting is off.
        </div>
      )}
      <CodeView
        ref={ref}
        items={items}
        options={viewOptions}
        renderCodeViewFooter={renderFooter}
        getEditStateKey={() => `file:${tabId}`}
        onItemEditChange={() => setDirty(tabId, true)}
        onItemEditComplete={() => "accept"}
        className="code-surface min-h-0 flex-1"
        style={{ overflow: "auto" }}
      />
    </div>
  )
}

function PreviewToggle({ tabId, preview }: { tabId: string; preview: boolean }) {
  const updateTab = useStore((s) => s.updateTab)
  return (
    <TabActions>
      <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => updateTab(tabId, { preview: !preview })} title="Toggle preview (⇧⌘V)">
        {preview ? <IconCode /> : <IconEye />} {preview ? "Source" : "Preview"}
      </Button>
    </TabActions>
  )
}

function countLines(s: string) {
  let n = 1
  for (let i = s.indexOf("\n"); i !== -1; i = s.indexOf("\n", i + 1)) n++
  return n
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
