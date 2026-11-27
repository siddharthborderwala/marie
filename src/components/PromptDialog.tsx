import { useEffect, useRef, useState } from "react"
import { create } from "zustand"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface PromptState {
  open: boolean
  kind: "prompt" | "confirm"
  title: string
  description?: string
  value: string
  confirmLabel: string
  danger?: boolean
  resolve?: (v: string | null) => void
}

const usePrompt = create<PromptState>(() => ({ open: false, kind: "prompt", title: "", value: "", confirmLabel: "OK" }))

/** In-app replacement for window.prompt. Resolves to the entered text, or null if cancelled. */
export function promptText(title: string, opts: { value?: string; description?: string; confirmLabel?: string } = {}) {
  return new Promise<string | null>((resolve) =>
    usePrompt.setState({
      open: true,
      kind: "prompt",
      title,
      description: opts.description,
      value: opts.value ?? "",
      confirmLabel: opts.confirmLabel ?? "OK",
      danger: false,
      resolve,
    }),
  )
}

/** In-app replacement for window.confirm. */
export function confirmAction(title: string, opts: { description?: string; confirmLabel?: string; danger?: boolean } = {}) {
  return new Promise<boolean>((resolve) =>
    usePrompt.setState({
      open: true,
      kind: "confirm",
      title,
      description: opts.description,
      value: "",
      confirmLabel: opts.confirmLabel ?? "OK",
      danger: opts.danger,
      resolve: (v) => resolve(v != null),
    }),
  )
}

export function PromptDialog() {
  const s = usePrompt()
  const [value, setValue] = useState("")
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!s.open) return
    setValue(s.value)
    // Select the name part (before the extension) like VS Code's rename box.
    window.setTimeout(() => {
      const el = input.current
      if (!el) return
      el.focus()
      const dot = s.value.lastIndexOf(".")
      const slash = s.value.lastIndexOf("/")
      el.setSelectionRange(slash + 1, dot > slash + 1 ? dot : s.value.length)
    }, 30)
  }, [s.open, s.value])

  const finish = (v: string | null) => {
    s.resolve?.(v)
    usePrompt.setState({ open: false, resolve: undefined })
  }

  return (
    <Dialog open={s.open} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{s.title}</DialogTitle>
          {s.description && <DialogDescription className="break-all">{s.description}</DialogDescription>}
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (s.kind === "confirm") finish("")
            else if (value.trim()) finish(value.trim())
          }}
        >
          {s.kind === "prompt" && <Input ref={input} value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" variant={s.danger ? "destructive" : "default"} autoFocus={s.kind === "confirm"}>
              {s.confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
