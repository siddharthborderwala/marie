import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"

/** DOM node on the right side of the tab row; the active view portals its controls here. */
export const TabActionsContext = createContext<HTMLElement | null>(null)

export function TabActions({ children }: { children: ReactNode }) {
  const el = useContext(TabActionsContext)
  return el ? createPortal(children, el) : null
}
