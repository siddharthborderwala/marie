/**
 * VS Code-style indent guides for Pierre code views. Pierre renders into shadow DOM and
 * virtualizes lines, so we tag each rendered [data-line] with its indent depth
 * (data-indent / --indent) and let CSS (see EDITOR_CSS) paint the guides. A MutationObserver
 * per shadow root keeps it current while scrolling and editing.
 */

const observed = new WeakSet<Node>()
/** Indent unit per shadow root: smallest consistent unit seen so far (lines render in batches). */
const units = new WeakMap<ParentNode, number>()
const pending = new Set<ParentNode>()
let raf = 0

function leading(text: string, tab: number) {
  let n = 0
  for (const ch of text) {
    if (ch === " ") n++
    else if (ch === "\t") n += tab - (n % tab)
    else return { n, blank: false }
  }
  return { n, blank: true }
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

function tag(root: ParentNode) {
  const lines = [...root.querySelectorAll<HTMLElement>("[data-line]")]
  if (!lines.length) return
  // Group by diff side (split diffs); a plain file is one group. Pierre renders lines in
  // batches with separate parents, so never group by parentElement.
  const groups = new Map<Element | null, HTMLElement[]>()
  for (const l of lines) {
    const g = l.closest("[data-deletions], [data-additions]")
    const arr = groups.get(g)
    if (arr) arr.push(l)
    else groups.set(g, [l])
  }
  // One indent unit for the whole file (gcd of every indent seen, remembered across renders).
  let unit = units.get(root) ?? 0
  const allInfo = new Map<HTMLElement, { n: number; blank: boolean }>()
  for (const l of lines) {
    const i = leading(l.textContent ?? "", 4)
    allInfo.set(l, i)
    if (!i.blank && i.n > 0) unit = unit ? gcd(unit, i.n) : i.n
  }
  if (unit) units.set(root, unit)
  if (unit < 2) unit = unit === 1 ? 2 : 4
  for (const group of groups.values()) {
    group.sort((a, b) => Number(a.dataset.line ?? 0) - Number(b.dataset.line ?? 0) || 0)
    const info = group.map((l) => allInfo.get(l)!)
    for (let i = 0; i < group.length; i++) {
      let n = info[i].n
      if (info[i].blank) {
        // Blank lines inherit the smaller of the surrounding indents (no dangling guides).
        let prev = 0
        let next = 0
        for (let j = i - 1; j >= 0; j--) if (!info[j].blank) { prev = info[j].n; break }
        for (let j = i + 1; j < group.length; j++) if (!info[j].blank) { next = info[j].n; break }
        n = Math.min(prev, next)
      }
      const levels = Math.floor(n / unit)
      const el = group[i]
      const want = levels > 0 ? String(levels * unit) : null
      if (el.dataset.indent !== (want ?? undefined)) {
        if (want) {
          el.dataset.indent = want
          el.style.setProperty("--indent", want)
          el.style.setProperty("--indent-unit", String(unit))
        } else {
          delete el.dataset.indent
          el.style.removeProperty("--indent")
        }
      }
    }
  }
}

function schedule(root: ParentNode) {
  pending.add(root)
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    for (const r of pending) tag(r)
    pending.clear()
  })
}

/** Pass as Pierre's `onPostRender` option. */
export function onPostRenderIndentGuides(node: unknown) {
  const el = node as HTMLElement | null
  if (!el) return
  const root: ParentNode = el.shadowRoot ?? (el.getRootNode() as ParentNode) ?? el
  schedule(root)
  if (!observed.has(root)) {
    observed.add(root)
    new MutationObserver(() => schedule(root)).observe(root as Node, { childList: true, subtree: true, characterData: true })
  }
}
