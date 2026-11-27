import type { Terminal } from "ghostty-web"

/** Live terminals by session id (context menu: copy/paste/clear; "Open in Terminal"). */
export const terminals = new Map<string, { term: Terminal; ready: boolean; input(data: string): void }>()
