import { toast } from "sonner"
import { isTauri } from "@/lib/ipc"

let checking = false

/**
 * Check GitHub Releases (marie-releases/latest.json) for a signed update.
 * Silent mode only speaks up when an update exists.
 */
export async function checkForUpdates(silent = false) {
  if (!isTauri() || checking) return
  checking = true
  try {
    const { check } = await import("@tauri-apps/plugin-updater")
    const update = await check()
    if (!update) {
      if (!silent) toast.success("Marie is up to date")
      return
    }
    toast(`Marie ${update.version} is available`, {
      description: update.body?.split("\n")[0] || "A new version is ready to install.",
      duration: Infinity,
      action: {
        label: "Restart & Update",
        onClick: async () => {
          const t = toast.loading(`Downloading Marie ${update.version}…`)
          try {
            await update.downloadAndInstall()
            const { relaunch } = await import("@tauri-apps/plugin-process")
            toast.success("Update installed — restarting", { id: t })
            await relaunch()
          } catch (e) {
            toast.error(`Update failed: ${e}`, { id: t })
          }
        },
      },
    })
  } catch (e) {
    if (!silent) toast.error(`Couldn't check for updates: ${e}`)
  } finally {
    checking = false
  }
}
