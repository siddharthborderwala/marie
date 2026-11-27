import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react"
import { parseDiffFromFile, parsePatchFiles, type CodeViewItem, type FileDiffMetadata } from "@pierre/diffs"
import { IconGitBranch, IconRefresh } from "@tabler/icons-react"
import { ipc, type DiffMode, type DiffSet } from "@/lib/ipc"
import { useCodeOptions } from "@/lib/pierre"
import { detectLang, registerView } from "@/lib/views"
import { registerSaver } from "@/lib/editing"
import { useStore } from "@/store"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Placeholder } from "./Placeholder"
import { TabActions } from "@/components/TabActions"

function ago(sec: number | null | undefined) {
  if (sec == null) return "never fetched"
  if (sec < 90) return "fetched just now"
  if (sec < 3600) return `fetched ${Math.round(sec / 60)}m ago`
  if (sec < 86400 * 2) return `fetched ${Math.round(sec / 3600)}h ago`
  return `fetched ${Math.round(sec / 86400)}d ago`
}

export function DiffView({ tabId, mode, base, nonce }: { tabId: string; mode: DiffMode; base: string | null; nonce: number }) {
  const ws = useStore((s) => s.workspace)
  const repo = useStore((s) => s.repo)
  const openDiff = useStore((s) => s.openDiff)
  const openPalette = useStore((s) => s.openPalette)
  const [set, setSet] = useState<DiffSet | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ws) return
    let alive = true
    setError(null)
    ipc
      .gitDiff(ws.id, mode, base)
      .then((d) => alive && setSet(d))
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [ws, mode, base, nonce])

  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    if (!set) return []
    const out: CodeViewItem<undefined>[] = []
    for (const f of set.files) {
      if (f.skipped) continue
      try {
        const fileDiff = parseDiffFromFile(
          f.old == null ? null : { name: f.old_path ?? f.path, contents: f.old, cacheKey: f.old_key, lang: detectLang(f.path, f.new ?? f.old) },
          f.new == null ? null : { name: f.path, contents: f.new, cacheKey: f.new_key, lang: detectLang(f.path, f.new) },
        )
        // The working-tree side is editable (not in "staged", where the new side is the index).
        const editable = mode !== "staged" && f.new != null
        out.push({ type: "diff", id: `diff:${f.path}`, fileDiff, ...(editable ? { edit: true } : {}) })
      } catch {
        /* unparsable; skip */
      }
    }
    return out
  }, [set, mode])

  const editables = useMemo(
    () =>
      (set?.files ?? [])
        .filter((f) => !f.skipped && f.new != null && mode !== "staged")
        .map((f) => ({ id: `diff:${f.path}`, path: f.path, original: f.new as string })),
    [set, mode],
  )

  const effectiveBase = base ?? (mode === "branch" ? set?.base : null) ?? repo?.default_base ?? null
  const skipped = set?.files.filter((f) => f.skipped) ?? []

  const header = (
    <TabActions>
      <ToggleGroup
        value={[mode === "branch" ? "branch" : "uncommitted"]}
        onValueChange={(v: string[]) => {
          const next = v[0]
          if (next === "branch") openDiff("branch", base)
          else if (next === "uncommitted") openDiff("uncommitted")
        }}
        size="sm"
        variant="outline"
      >
        <ToggleGroupItem value="uncommitted" className="h-7 text-xs">
          Uncommitted
        </ToggleGroupItem>
        <ToggleGroupItem value="branch" className="h-7 text-xs">
          vs {effectiveBase ?? "base"}
        </ToggleGroupItem>
      </ToggleGroup>
      {mode === "branch" && (
        <Button size="xs" variant="ghost" onClick={() => openPalette("branch")}>
          <IconGitBranch /> Change base
        </Button>
      )}
      {(mode === "staged" || mode === "unstaged") && <span className="text-muted-foreground capitalize">{mode}</span>}
      {set && (
        <span className="px-1 text-muted-foreground tabular-nums">
          {set.files.length} file{set.files.length === 1 ? "" : "s"}
          {mode === "branch" && set.base_commit ? ` · merge-base ${set.base_commit.slice(0, 7)}` : ""}
          {mode === "branch" && effectiveBase?.includes("/") ? ` · ${ago(repo?.fetched_ago)}` : ""}
          {set.truncated ? " · truncated" : ""}
        </span>
      )}
      <Button size="icon-xs" variant="ghost" onClick={() => useStore.getState().refresh()} title="Refresh (⌘R)">
        <IconRefresh className="size-3.5" />
      </Button>
    </TabActions>
  )

  let body
  if (error) body = <Placeholder title="Couldn't compute diff" detail={error} />
  else if (!set) body = <Placeholder loading />
  else if (set.files.length === 0)
    body = (
      <Placeholder
        title="No changes"
        detail={mode === "branch" ? `Working tree matches merge-base with ${effectiveBase}` : "Working tree is clean"}
      />
    )
  else
    body = (
      <DiffList
        tabId={tabId}
        items={items}
        editables={editables}
        footer={
          skipped.length > 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Not shown: {skipped.map((f) => `${f.path} (${f.skipped})`).join(", ")}
            </div>
          ) : null
        }
      />
    )

  return (
    <div className="h-full min-h-0">
      {header}
      {body}
    </div>
  )
}

/** Diff of a pasted patch (scratch → "View as diff"). */
export function PatchView({ tabId, patch }: { tabId: string; patch: string }) {
  const { items, error } = useMemo(() => {
    try {
      const parsed = parsePatchFiles(patch, { cacheKeyPrefix: `${tabId}-${patch.length}` })
      const diffs: FileDiffMetadata[] = parsed.flatMap((p) => p.files)
      return {
        items: diffs.map((fileDiff, i) => ({ type: "diff" as const, id: `p${i}:${fileDiff.name}`, fileDiff })),
        error: diffs.length ? null : "No file diffs found in this text.",
      }
    } catch (e) {
      return { items: [] as CodeViewItem<undefined>[], error: String(e) }
    }
  }, [patch, tabId])
  if (error) return <Placeholder title="Couldn't parse patch" detail={error} />
  return <DiffList tabId={tabId} items={items} partial />
}

function DiffList({
  tabId,
  items,
  footer,
  partial,
  editables,
}: {
  tabId: string
  items: CodeViewItem<undefined>[]
  footer?: React.ReactNode
  partial?: boolean
  editables?: { id: string; path: string; original: string }[]
}) {
  const setDirty = useStore((s) => s.setDirty)
  const options = useCodeOptions()
  const ref = useRef<CodeViewHandle<undefined, undefined> | null>(null)
  const opts = useMemo(
    () => (partial ? { ...options, hunkSeparators: "metadata" as const } : options),
    [options, partial],
  )
  const renderFooter = useCallback(() => footer ?? null, [footer])

  useEffect(() => {
    const offs = (editables ?? []).map((e) =>
      registerSaver({
        key: `${tabId}::${e.path}`,
        tabId,
        path: e.path,
        original: e.original,
        getText: () => ref.current?.getEditor(e.id)?.getText(),
      }),
    )
    return () => offs.forEach((f) => f())
  }, [editables, tabId])
  const pathOf = useMemo(() => new Map((editables ?? []).map((e) => [e.id, e.path])), [editables])

  useEffect(
    () =>
      registerView(tabId, {
        goToLine: (n) => {
          const first = items[0]
          if (first) ref.current?.scrollTo({ type: "line", id: first.id, lineNumber: n, side: "additions", align: "center" })
        },
      }),
    [tabId, items],
  )

  return (
    <CodeView
      ref={ref}
      items={items}
      options={opts}
      className="code-surface h-full"
      style={{ overflow: "auto", height: "100%" }}
      renderCodeViewFooter={renderFooter}
      getEditStateKey={(item) => `${tabId}:${item.id}`}
      onItemEditChange={(_e, item) => {
        const p = pathOf.get(item.id)
        if (p) setDirty(`${tabId}::${p}`, true)
      }}
      onItemEditComplete={() => "accept"}
    />
  )
}
