import { Editor, type EditorFactory } from "@pierre/diffs/edit"
import { toast } from "sonner"
import { ipc } from "@/lib/ipc"
import { useStore } from "@/store"

type Pos = { line: number; character: number }
type Sel = { start: Pos; end: Pos }
type AnyEditor = {
  undo(): void
  redo(): void
  getText(): string
  getViewState(): { selections?: Sel[] }
  setSelections(s: (Sel & { direction?: number })[]): void
  applyEdits(e: { range: Sel; newText: string }[], updateHistory?: boolean): void
  focus(o?: { preventScroll?: boolean }): void
}

/** Most recently focused Pierre editor (undo/redo menu items route here). */
let activeEditor: AnyEditor | null = null
let activeFocused = false

export const createEditor: EditorFactory<undefined, undefined> = (type, options, key) => {
  // eslint-disable-next-line prefer-const
  let ed: Editor<typeof type, undefined, undefined>
  const opts = {
    ...options,
    onFocus: () => {
      activeEditor = ed as unknown as AnyEditor
      activeFocused = true
      options?.onFocus?.()
    },
    onBlur: () => {
      activeFocused = false
      options?.onBlur?.()
    },
  }
  ed = new Editor(type, opts, key)
  return ed
}

export function editorUndo(redo = false) {
  const inField = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
  if (activeEditor && activeFocused && !inField) {
    if (redo) activeEditor.redo()
    else activeEditor.undo()
  } else {
    document.execCommand(redo ? "redo" : "undo")
  }
}

// ---- clipboard actions for the context menu ----------------------------------

/** The editor a context-menu action should target (last focused one). */
export function currentEditor(): AnyEditor | null {
  return activeEditor
}

function offsets(text: string) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1)
  return (p: Pos) => Math.min(text.length, (starts[p.line] ?? text.length) + p.character)
}

/** Selected text; with an empty selection, the whole line (VS Code behaviour). */
function selectionText(ed: AnyEditor): { text: string; ranges: Sel[]; wholeLines: boolean } {
  const text = ed.getText()
  const off = offsets(text)
  const sels = ed.getViewState().selections ?? []
  const empty = sels.every((s) => s.start.line === s.end.line && s.start.character === s.end.character)
  if (empty) {
    const lines = text.split("\n")
    const lineNums = [...new Set(sels.map((s) => s.start.line))]
    return {
      text: lineNums.map((l) => (lines[l] ?? "") + "\n").join(""),
      ranges: lineNums.map((l) => ({ start: { line: l, character: 0 }, end: { line: l + 1, character: 0 } })),
      wholeLines: true,
    }
  }
  const ordered = sels.map((s) => (off(s.start) <= off(s.end) ? s : { start: s.end, end: s.start }))
  return { text: ordered.map((s) => text.slice(off(s.start), off(s.end))).join("\n"), ranges: ordered, wholeLines: false }
}

export async function editorCopy(cut = false) {
  const ed = activeEditor
  if (!ed) return
  const { text, ranges } = selectionText(ed)
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager")
  await writeText(text)
  if (cut) ed.applyEdits(ranges.map((range) => ({ range, newText: "" })))
  ed.focus({ preventScroll: true })
}

export async function editorPaste() {
  const ed = activeEditor
  if (!ed) return
  const { readText } = await import("@tauri-apps/plugin-clipboard-manager")
  const clip = (await readText()) ?? ""
  const sels = ed.getViewState().selections ?? [{ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }]
  ed.applyEdits(sels.map((s) => ({ range: { start: s.start, end: s.end }, newText: clip })))
  ed.focus({ preventScroll: true })
}

export function editorSelectAll() {
  const ed = activeEditor
  if (!ed) return
  const lines = ed.getText().split("\n")
  ed.setSelections([{ start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines.at(-1)!.length }, direction: 1 }])
  ed.focus({ preventScroll: true })
}

// ---- save registry -------------------------------------------------------

export interface Saver {
  /** dirty key, e.g. tab id or `${tabId}::${path}` */
  key: string
  tabId: string
  path: string
  getText(): string | undefined
  /** last text known to be on disk, for conflict detection */
  original: string
  onSaved?(text: string): void
}

const savers = new Map<string, Saver>()

export function registerSaver(s: Saver) {
  savers.set(s.key, s)
  return () => {
    if (savers.get(s.key) === s) savers.delete(s.key)
  }
}

export function updateOriginal(key: string, text: string) {
  const s = savers.get(key)
  if (s) s.original = text
}

async function saveOne(s: Saver): Promise<boolean> {
  const ws = useStore.getState().workspace
  const text = s.getText()
  if (!ws || text == null) return false
  try {
    await ipc.writeFile(ws.id, s.path, text, s.original, false)
  } catch (e) {
    if (String(e) !== "conflict") {
      toast.error(`Couldn't save ${s.path}: ${e}`)
      return false
    }
    const { confirmAction } = await import("@/components/PromptDialog")
    const ok = await confirmAction(`${s.path.split("/").pop()} changed on disk`, {
      description: `${s.path} was modified since you opened it. Overwrite it with your version?`,
      confirmLabel: "Overwrite",
      danger: true,
    })
    if (!ok) return false
    try {
      await ipc.writeFile(ws.id, s.path, text, null, true)
    } catch (e2) {
      toast.error(`Couldn't save ${s.path}: ${e2}`)
      return false
    }
  }
  s.original = text
  s.onSaved?.(text)
  useStore.getState().setDirty(s.key, false)
  return true
}

/** Save every dirty editor belonging to a tab. */
export async function saveTab(tabId: string) {
  const dirty = useStore.getState().dirty
  const list = [...savers.values()].filter((s) => s.tabId === tabId && dirty[s.key])
  if (!list.length) return
  const results = await Promise.all(list.map(saveOne))
  const ok = results.filter(Boolean).length
  if (ok) {
    void useStore.getState().refreshStatus()
  }
}

export async function saveAll() {
  const dirty = useStore.getState().dirty
  const tabs = new Set([...savers.values()].filter((s) => dirty[s.key]).map((s) => s.tabId))
  for (const t of tabs) await saveTab(t)
}
