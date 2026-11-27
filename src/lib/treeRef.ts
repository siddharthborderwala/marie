import type { FileTree } from "@pierre/trees"

/** The Explorer's tree model, for commands/menus that act on it (rename, reveal). */
export const treeModel: { current: FileTree | null } = { current: null }
