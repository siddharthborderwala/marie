import { IconLoader2 } from "@tabler/icons-react"
import type { ReactNode } from "react"

export function Placeholder({
  title,
  detail,
  loading,
  children,
}: {
  title?: string
  detail?: string
  loading?: boolean
  children?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {loading ? (
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          {title && <div className="text-sm font-medium">{title}</div>}
          {detail && <div className="max-w-lg font-mono text-xs break-all text-muted-foreground">{detail}</div>}
          {children}
        </>
      )}
    </div>
  )
}
