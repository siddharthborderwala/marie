import { getFiletypeFromFileName, type SupportedLanguages } from "@pierre/diffs"
/** Imperative hooks the active view registers so commands (go to line, etc.) can reach it. */
export interface ViewHandle {
  goToLine?(line: number): void
  lineCount?(): number
  getText?(): string | undefined
}

const handles = new Map<string, ViewHandle>()

export function registerView(tabId: string, h: ViewHandle) {
  handles.set(tabId, h)
  return () => {
    if (handles.get(tabId) === h) handles.delete(tabId)
  }
}

export function viewHandle(tabId: string | null | undefined) {
  return tabId ? handles.get(tabId) : undefined
}

export function looksLikeDiff(text: string) {
  return /^(diff --git |--- [^\n]*\n\+\+\+ |@@ -\d+(,\d+)? \+\d+(,\d+)? @@)/m.test(text)
}

const LANG_HINTS: [RegExp, string][] = [
  [/^\s*[{[][\s\S]*[}\]]\s*$/, "json"],
  [/^#!.*\b(bash|sh|zsh)\b/, "bash"],
  [/^#!.*\bpython/, "python"],
  [/^\s*(import|from)\s+\S+.*\n|^\s*def \w+\(.*\):/m, "python"],
  [/^\s*(fn|use|impl|pub|mod)\s/m, "rust"],
  [/^\s*package \w+\s*\n|^\s*func \w+\(/m, "go"],
  [/^\s*(import|export)\s.+from\s+['"]|\b(const|let)\s+\w+\s*[:=]|=>\s*[{(]/m, "tsx"],
  [/^\s*<(!doctype|html|div|span|head|body)\b/im, "html"],
  [/^\s*(SELECT|INSERT|UPDATE|CREATE|WITH)\s/im, "sql"],
  [/^\s*[\w.-]+:\s*(\S.*)?\n\s*[\w.-]+:/m, "yaml"],
  [/^#{1,6}\s+\S|^\s*[-*]\s+\S|\[[^\]]+\]\([^)]+\)/m, "markdown"],
]

/** Cheap language guess for scratch buffers. */
export function guessLang(text: string): string {
  if (!text.trim()) return "text"
  if (looksLikeDiff(text)) return "diff"
  const head = text.slice(0, 4000)
  for (const [re, lang] of LANG_HINTS) if (re.test(head)) return lang
  return "text"
}

export const SCRATCH_LANGS = [
  "text",
  "markdown",
  "diff",
  "json",
  "typescript",
  "tsx",
  "javascript",
  "rust",
  "go",
  "python",
  "swift",
  "bash",
  "yaml",
  "toml",
  "html",
  "css",
  "sql",
  "c",
  "cpp",
  "java",
  "ruby",
]

export function isMarkdownPath(p: string) {
  return /\.(md|mdx|markdown|mdown)$/i.test(p)
}

// ---- language detection for real files ------------------------------------

const NAME_LANGS: Record<string, string> = {
  ".prettierrc": "json",
  ".babelrc": "json",
  ".eslintrc": "json",
  ".swcrc": "json",
  ".jshintrc": "json",
  ".stylelintrc": "json",
  ".mcprc": "json",
}

/**
 * Pierre detects by name/extension; when that yields plain text (dotfiles, extensionless
 * scripts), fall back to sniffing the content. Returns undefined to keep Pierre's choice.
 */
export function detectLang(path: string, text: string | null | undefined): SupportedLanguages | undefined {
  const name = path.split("/").pop() ?? path
  if (NAME_LANGS[name]) return NAME_LANGS[name] as SupportedLanguages
  if (getFiletypeFromFileName(name) !== "text") return undefined
  if (!text) return undefined
  const g = guessLang(text)
  return g === "text" ? undefined : (g as SupportedLanguages)
}
