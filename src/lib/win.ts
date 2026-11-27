import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/ipc"

/** This window's label ("main" for the first window, "win-N" for others). */
export function windowLabel(): string {
  try {
    const meta = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
      .__TAURI_INTERNALS__?.metadata?.currentWindow?.label
    return meta ?? "main"
  } catch {
    return "main"
  }
}

export async function setWindowFolder(uri: string | null, title: string) {
  if (!isTauri()) return
  await invoke("set_window_folder", { uri })
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  await getCurrentWindow().setTitle(title)
}

/** Opens a new window (optionally with a folder); focuses an existing one showing that folder. */
export function newWindow(folder?: string | null) {
  return invoke<string>("new_window", { folder: folder ?? null })
}

/** True when another window already shows this folder (and it was brought to front). */
export function focusWindowFor(uri: string) {
  return isTauri() ? invoke<boolean>("focus_window_for", { uri }) : Promise.resolve(false)
}
