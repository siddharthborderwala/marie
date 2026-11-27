/**
 * VS Code theme (colors + TextMate tokenColors) → Zed-style theme used by @pierre/highlights,
 * plus the VS Code UI colors so the app chrome can follow the theme exactly.
 */

export interface VSCodeTheme {
  name?: string
  type?: "dark" | "light" | "hc" | "hcLight"
  colors?: Record<string, string>
  tokenColors?: { scope?: string | string[]; settings: { foreground?: string; fontStyle?: string } }[]
}

export interface ZedStyleTheme {
  name: string
  appearance: "dark" | "light"
  style: Record<string, unknown>
  /** original VS Code UI colors (used for chrome) */
  vscodeColors?: Record<string, string>
}

/** Parse JSON-with-comments / trailing commas (VS Code theme files allow both). */
export function parseJsonc(text: string): unknown {
  let out = ""
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === "\\") out += text[++i] ?? ""
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i++
    } else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"))
}

function luminance(hex?: string) {
  const m = hex && /^#?([0-9a-f]{6})/i.exec(hex)
  if (!m) return 0
  const n = parseInt(m[1], 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}

// ---- TextMate scope resolution --------------------------------------------

interface Rule {
  selector: string[] // descendant path, e.g. ["meta.tag", "entity.name"]
  fg?: string
  fontStyle?: string
  specificity: number
  order: number
}

function compileRules(tc: VSCodeTheme["tokenColors"]): Rule[] {
  const rules: Rule[] = []
  let order = 0
  for (const t of tc ?? []) {
    const scopes = t.scope == null ? [""] : Array.isArray(t.scope) ? t.scope : t.scope.split(",")
    for (const raw of scopes) {
      const sel = raw.trim()
      const path = sel ? sel.split(/\s+/).filter((p) => p !== ">") : []
      rules.push({
        selector: path,
        fg: t.settings.foreground,
        fontStyle: t.settings.fontStyle,
        // deeper last segment + more path segments = more specific (TextMate ranking, simplified)
        specificity: (path.at(-1)?.split(".").length ?? 0) * 100 + path.length,
        order: order++,
      })
    }
  }
  return rules
}

const prefixMatch = (sel: string, scope: string) => scope === sel || scope.startsWith(sel + ".")

/** Resolve a single (leaf) scope against the rules; descendant selectors only match if their
 *  ancestors are all prefixes of the same scope family, which is the common case for our probes. */
function resolveScope(rules: Rule[], scope: string) {
  let fg: Rule | undefined
  let fs: Rule | undefined
  for (const r of rules) {
    if (r.selector.length === 0) continue
    if (r.selector.length > 1) continue // contextual rules (e.g. "comment keyword") don't apply to a bare scope
    if (!prefixMatch(r.selector[0], scope)) continue
    const better = (cur?: Rule) => !cur || r.specificity > cur.specificity || (r.specificity === cur.specificity && r.order > cur.order)
    if (r.fg && better(fg)) fg = r
    if (r.fontStyle != null && better(fs)) fs = r
  }
  return { fg: fg?.fg, fontStyle: fs?.fontStyle }
}

/** Zed syntax key → TextMate scopes to probe, most specific first. */
const SYNTAX_MAP: Record<string, string[]> = {
  comment: ["comment.line", "comment"],
  "comment.doc": ["comment.block.documentation", "comment.block", "comment"],
  "comment.documentation": ["comment.block.documentation", "comment"],
  string: ["string.quoted.double", "string.quoted", "string"],
  "string.escape": ["constant.character.escape", "string"],
  "string.regex": ["string.regexp", "string"],
  "string.regexp": ["string.regexp", "string"],
  "string.special": ["string.other", "string.interpolated", "string"],
  "string.special.symbol": ["constant.other.symbol", "string.other", "string"],
  number: ["constant.numeric.decimal", "constant.numeric", "constant"],
  boolean: ["constant.language.boolean", "constant.language", "constant"],
  constant: ["variable.other.constant", "constant.other", "constant"],
  "constant.builtin": ["constant.language", "support.constant", "constant"],
  keyword: ["keyword.control", "storage.type", "keyword", "storage"],
  "keyword.operator": ["keyword.operator", "keyword"],
  operator: ["keyword.operator", "keyword"],
  function: ["entity.name.function", "support.function", "meta.function-call"],
  "function.builtin": ["support.function.builtin", "support.function", "entity.name.function"],
  "function.method": ["entity.name.function.method", "entity.name.function", "support.function"],
  "function.method.call": ["meta.function-call.method", "entity.name.function", "support.function"],
  constructor: ["entity.name.function.constructor", "entity.name.type.class", "entity.name.class", "entity.name.type"],
  type: ["entity.name.type", "support.type", "storage.type"],
  "type.builtin": ["support.type.primitive", "support.type.builtin", "support.type", "storage.type"],
  "type.class.definition": ["entity.name.type.class", "entity.name.class", "entity.name.type"],
  enum: ["entity.name.type.enum", "entity.name.type"],
  variant: ["variable.other.enummember", "constant.other", "constant"],
  variable: ["variable.other.readwrite", "variable.other", "variable"],
  "variable.member": ["variable.other.property", "variable.other.object.property", "support.variable.property", "variable"],
  "variable.special": ["variable.language", "variable"],
  "variable.parameter": ["variable.parameter", "variable"],
  property: ["variable.other.property", "support.type.property-name", "meta.object-literal.key", "variable"],
  attribute: ["entity.other.attribute-name", "entity.other"],
  tag: ["entity.name.tag", "entity.name"],
  namespace: ["entity.name.namespace", "entity.name.module", "entity.name.type"],
  label: ["entity.name.label", "entity.name"],
  preproc: ["meta.preprocessor", "keyword.control.directive", "keyword"],
  punctuation: ["punctuation"],
  "punctuation.bracket": ["punctuation.definition.block", "meta.brace", "punctuation"],
  "punctuation.delimiter": ["punctuation.separator", "punctuation.terminator", "punctuation"],
  "punctuation.special": ["punctuation.definition.template-expression", "punctuation.section.embedded", "punctuation"],
  "punctuation.list_marker": ["punctuation.definition.list.begin.markdown", "markup.list", "punctuation"],
  selector: ["entity.name.tag.css", "entity.other.attribute-name.class.css", "entity.name.tag"],
  "selector.class": ["entity.other.attribute-name.class.css", "entity.other.attribute-name"],
  "selector.id": ["entity.other.attribute-name.id.css", "entity.other.attribute-name"],
  "selector.pseudo": ["entity.other.attribute-name.pseudo-class.css", "entity.other.attribute-name"],
  title: ["markup.heading", "entity.name.section"],
  emphasis: ["markup.italic"],
  "emphasis.strong": ["markup.bold"],
  link_text: ["string.other.link", "markup.underline.link"],
  link_uri: ["markup.underline.link", "string.other.link"],
  "text.literal": ["markup.inline.raw", "markup.raw", "string"],
  "diff.minus": ["markup.deleted"],
  "diff.plus": ["markup.inserted"],
  embedded: ["meta.embedded", "source"],
}

export function convertVSCodeTheme(json: VSCodeTheme, fallbackName: string): ZedStyleTheme {
  const colors = json.colors ?? {}
  const bg = colors["editor.background"] ?? (json.type === "light" ? "#ffffff" : "#1e1e1e")
  const fg = colors["editor.foreground"] ?? colors["foreground"] ?? (json.type === "light" ? "#333333" : "#d4d4d4")
  const appearance: "dark" | "light" =
    json.type === "light" || json.type === "hcLight" ? "light" : json.type === "dark" || json.type === "hc" ? "dark" : luminance(bg) > 0.5 ? "light" : "dark"

  const rules = compileRules(json.tokenColors)
  const syntax: Record<string, { color?: string; font_style?: string; font_weight?: number }> = {}
  for (const [key, probes] of Object.entries(SYNTAX_MAP)) {
    for (const scope of probes) {
      const r = resolveScope(rules, scope)
      if (r.fg) {
        const entry: { color: string; font_style?: string; font_weight?: number } = { color: r.fg }
        if (r.fontStyle?.includes("italic")) entry.font_style = "italic"
        if (r.fontStyle?.includes("bold")) entry.font_weight = 700
        syntax[key] = entry
        break
      }
    }
  }
  syntax.primary = { color: fg }

  const ansi = (n: string) => colors[`terminal.ansi${n}`]
  const style: Record<string, unknown> = {
    background: bg,
    text: fg,
    "editor.background": bg,
    "editor.foreground": fg,
    "editor.active_line.background": colors["editor.lineHighlightBackground"],
    "search.match_background": colors["editor.findMatchHighlightBackground"],
    players: [
      {
        cursor: colors["editorCursor.foreground"] ?? fg,
        selection: colors["editor.selectionBackground"],
        background: colors["editorCursor.foreground"] ?? fg,
      },
    ],
    error: colors["editorError.foreground"] ?? colors["errorForeground"],
    warning: colors["editorWarning.foreground"],
    info: colors["editorInfo.foreground"],
    hint: colors["editorHint.foreground"],
    created: colors["gitDecoration.addedResourceForeground"] ?? colors["editorGutter.addedBackground"],
    deleted: colors["gitDecoration.deletedResourceForeground"] ?? colors["editorGutter.deletedBackground"],
    modified: colors["gitDecoration.modifiedResourceForeground"] ?? colors["editorGutter.modifiedBackground"],
    "terminal.ansi.black": ansi("Black"),
    "terminal.ansi.red": ansi("Red"),
    "terminal.ansi.green": ansi("Green"),
    "terminal.ansi.yellow": ansi("Yellow"),
    "terminal.ansi.blue": ansi("Blue"),
    "terminal.ansi.magenta": ansi("Magenta"),
    "terminal.ansi.cyan": ansi("Cyan"),
    "terminal.ansi.white": ansi("White"),
    "terminal.ansi.bright_black": ansi("BrightBlack"),
    "terminal.ansi.bright_red": ansi("BrightRed"),
    "terminal.ansi.bright_green": ansi("BrightGreen"),
    "terminal.ansi.bright_yellow": ansi("BrightYellow"),
    "terminal.ansi.bright_blue": ansi("BrightBlue"),
    "terminal.ansi.bright_magenta": ansi("BrightMagenta"),
    "terminal.ansi.bright_cyan": ansi("BrightCyan"),
    "terminal.ansi.bright_white": ansi("BrightWhite"),
    syntax,
  }
  for (const k of Object.keys(style)) if (style[k] == null) delete style[k]

  return { name: json.name ?? fallbackName, appearance, style, vscodeColors: colors }
}
