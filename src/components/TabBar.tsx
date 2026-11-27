import { IconArrowsDiff, IconPencil, IconX } from "@tabler/icons-react"
import { FileIcon } from "@/components/FileIcon"
import { cn } from "cn"
import { useStore, type Tab } from "@/store"

function TabIcon({ tab }: { tab: Tab }) {
  const cls = "size-3.5 shrink-0 opacity-70"
  if (tab.kind === "diff" || tab.kind === "patch") return <IconArrowsDiff className={cls} />
  if (tab.kind === "scratch") return <IconPencil className={cls} />
  return <FileIcon path={tab.path} className="[&_svg]:size-3.5" />
}

export function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const activeId = useStore((s) => s.activeId)
  const activate = useStore((s) => s.activate)
  const closeTab = useStore((s) => s.closeTab)
  const dirty = useStore((s) => s.dirty)
  const isDirty = (id: string) => Object.keys(dirty).some((k) => k === id || k.startsWith(`${id}::`))

  return (
    <div className="no-scrollbar flex h-full min-w-0 shrink items-center gap-1 overflow-x-auto">
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          data-menu="tab"
          data-tab-id={t.id}
          aria-selected={t.id === activeId}
          title={t.kind === "file" ? t.path : t.title}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              closeTab(t.id)
            } else activate(t.id)
          }}
          className={cn(
            "group flex h-7 max-w-60 min-w-0 shrink-0 cursor-default items-center gap-1.5 rounded-4xl pr-1.5 pl-3 text-xs font-medium transition-colors select-none",
            t.id === activeId
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <TabIcon tab={t} />
          <span className="truncate">{t.title}</span>
          {isDirty(t.id) && <span className="mx-[5px] size-1.5 shrink-0 rounded-full bg-foreground/70 group-hover:hidden" aria-label="unsaved" />}
          <button
            className={cn(
              "flex size-4 items-center justify-center rounded-full opacity-0 group-hover:opacity-60 hover:bg-foreground/10 hover:opacity-100",
              isDirty(t.id) && "hidden group-hover:block",
            )}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => closeTab(t.id)}
            aria-label={`Close ${t.title}`}
          >
            <IconX className="size-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
