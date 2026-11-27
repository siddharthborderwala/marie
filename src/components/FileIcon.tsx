import { memo } from "react"
import { fileIconSvg } from "@/lib/treeIcons"

/** File-type icon matching the file tree. SVG comes from bundled Tabler sources (trusted). */
export const FileIcon = memo(function FileIcon({ path, className }: { path: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex size-4 shrink-0 items-center justify-center ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: fileIconSvg(path) }}
    />
  )
})
