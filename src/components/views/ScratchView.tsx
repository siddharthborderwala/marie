import { useEffect, useMemo, useRef, useState } from "react"
import { File } from "@pierre/diffs/react"
import type { FileContents, SupportedLanguages } from "@pierre/diffs"
import { IconArrowsDiff } from "@tabler/icons-react"
import { useCodeOptions } from "@/lib/pierre"
import { guessLang, looksLikeDiff } from "@/lib/views"
import { useStore } from "@/store"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { TabActions } from "@/components/TabActions"

/** Editable untitled buffer. Uses Pierre's edit mode so pasted code is highlighted live. */
export function ScratchView({ tabId, title, lang }: { tabId: string; title: string; lang: string | null }) {
  const text = useStore((s) => s.scratch[tabId] ?? "")
  const setScratch = useStore((s) => s.setScratch)
  const openPatch = useStore((s) => s.openPatch)
  const openPalette = useStore((s) => s.openPalette)
  const options = useCodeOptions()

  // Auto-detect language (debounced) unless the user picked one.
  const [detected, setDetected] = useState(() => guessLang(text))
  useEffect(() => {
    if (lang) return
    const t = window.setTimeout(() => setDetected(guessLang(text)), 350)
    return () => window.clearTimeout(t)
  }, [text, lang])
  const effective = lang ?? detected

  // Editor owns the document after mount; only remount when language changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const file = useMemo<FileContents>(
    () => ({
      name: title,
      contents: useStore.getState().scratch[tabId] ?? "",
      lang: effective as SupportedLanguages,
      cacheKey: `${tabId}:${effective}:${Date.now()}`,
    }),
    [tabId, effective],
  )
  const fileOptions = useMemo(
    () => ({
      theme: options.theme,
      themeType: options.themeType,
      preferredHighlighter: options.preferredHighlighter,
      overflow: options.overflow,
      disableFileHeader: true,
      unsafeCSS: options.unsafeCSS,
      onPostRender: options.onPostRender,
    }),
    [options],
  )

  const isDiff = looksLikeDiff(text)
  const surfaceRef = useRef<HTMLDivElement>(null)

  // Keep a handle on the live editor so clicks in empty space can place the caret.
  const editorRef = useRef<{ getText(): string; focus(o?: { lineNumber?: number; character?: number }): void } | null>(null)
  const editorOptions = useMemo(
    () => ({
      onAttach: (ed: unknown) => {
        editorRef.current = ed as typeof editorRef.current
      },
    }),
    [],
  )
  const focusEnd = () => {
    const ed = editorRef.current
    if (!ed) return
    const lines = ed.getText().split("\n")
    ed.focus({ lineNumber: lines.length, character: lines[lines.length - 1].length })
  }
  // A fresh untitled buffer should be ready to type into.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!editorRef.current) return
      if (document.activeElement === document.body || !document.activeElement)
        editorRef.current.focus({ lineNumber: 1, character: 0 })
    }, 50)
    return () => window.clearTimeout(t)
  }, [file])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabActions>
        {isDiff && (
          <Button size="xs" variant="secondary" onClick={() => openPatch(`Δ ${title}`, text)}>
            <IconArrowsDiff /> View as diff <Kbd>⇧⌘D</Kbd>
          </Button>
        )}
        <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => openPalette("lang")} title="Change language mode">
          {effective}
          {!lang && <span className="opacity-60">auto</span>}
        </Button>
      </TabActions>
      <div ref={surfaceRef} className="code-surface scratch flex min-h-0 flex-1 flex-col overflow-auto">
        <File
          key={file.cacheKey}
          file={file}
          edit
          editStateKey={`scratch:${tabId}:${effective}`}
          options={fileOptions}
          onEditChange={(e) => setScratch(tabId, e.file.contents)}
          onEditComplete={() => "accept"}
          editorOptions={editorOptions}
        />
        {/* Empty space below the text: clicking it puts the caret at the end, like any editor. */}
        <div
          className="min-h-24 flex-1 cursor-text"
          onMouseDown={(e) => {
            e.preventDefault()
            focusEnd()
          }}
        />
      </div>
    </div>
  )
}

