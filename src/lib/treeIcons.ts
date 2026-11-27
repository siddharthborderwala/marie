import type { FileTreeIconConfig } from "@pierre/trees"

// Tabler outline SVGs, inlined at build time.
// Keep this brace list in sync with the icons referenced below (only these get bundled).
const raw = import.meta.glob(
  "/node_modules/@tabler/icons/icons/outline/{braces,brand-astro,brand-c-sharp,brand-cpp,brand-css3,brand-deno,brand-docker,brand-git,brand-golang,brand-html5,brand-kotlin,brand-npm,brand-pnpm,brand-python,brand-react,brand-rust,brand-svelte,brand-swift,brand-tailwind,brand-typescript,brand-vite,brand-yarn,certificate,chevron-down,coffee,database,dots,file,file-code,file-spreadsheet,file-text,file-type-js,file-type-pdf,file-type-php,file-type-svg,file-type-ts,file-type-vue,file-type-xml,file-zip,info-circle,key,license,lock,markdown,music,photo,settings,terminal-2,video}.svg",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>

type Rule = [icon: string, color?: string]

// Colors are muted, readable on both light and dark themes.
const C = {
  ts: "#4b8fd6",
  js: "#d4b830",
  rust: "#d9825b",
  py: "#5b8fd1",
  go: "#3fb6c9",
  swift: "#e9734a",
  md: "#7aa2c8",
  json: "#c9a34a",
  css: "#a776d6",
  html: "#e2704f",
  git: "#e2704f",
  conf: "#8a94a3",
  img: "#4fae8c",
  data: "#6a9fb5",
  shell: "#76b05a",
  lock: "#8a94a3",
}

const BY_EXT: Record<string, Rule> = {
  ts: ["file-type-ts", C.ts],
  mts: ["file-type-ts", C.ts],
  cts: ["file-type-ts", C.ts],
  "d.ts": ["brand-typescript", C.ts],
  tsx: ["brand-react", C.ts],
  js: ["file-type-js", C.js],
  mjs: ["file-type-js", C.js],
  cjs: ["file-type-js", C.js],
  jsx: ["brand-react", C.js],
  rs: ["brand-rust", C.rust],
  py: ["brand-python", C.py],
  go: ["brand-golang", C.go],
  swift: ["brand-swift", C.swift],
  kt: ["brand-kotlin", "#a77bdb"],
  cs: ["brand-c-sharp", "#8e6fd1"],
  cpp: ["brand-cpp", "#5b8fd1"],
  cc: ["brand-cpp", "#5b8fd1"],
  hpp: ["brand-cpp", "#5b8fd1"],
  c: ["file-code", "#5b8fd1"],
  h: ["file-code", "#5b8fd1"],
  vue: ["file-type-vue", "#4fae8c"],
  svelte: ["brand-svelte", "#e2704f"],
  astro: ["brand-astro", "#e2704f"],
  php: ["file-type-php", "#8e8fd1"],
  rb: ["file-code", "#d65b5b"],
  java: ["coffee", "#d9825b"],
  md: ["markdown", C.md],
  mdx: ["markdown", C.md],
  markdown: ["markdown", C.md],
  txt: ["file-text"],
  json: ["braces", C.json],
  jsonc: ["braces", C.json],
  json5: ["braces", C.json],
  yaml: ["settings", C.conf],
  yml: ["settings", C.conf],
  toml: ["settings", C.conf],
  ini: ["settings", C.conf],
  env: ["key", C.conf],
  css: ["brand-css3", C.css],
  scss: ["brand-css3", C.css],
  less: ["brand-css3", C.css],
  html: ["brand-html5", C.html],
  xml: ["file-type-xml", C.html],
  svg: ["file-type-svg", C.img],
  png: ["photo", C.img],
  jpg: ["photo", C.img],
  jpeg: ["photo", C.img],
  gif: ["photo", C.img],
  webp: ["photo", C.img],
  ico: ["photo", C.img],
  icns: ["photo", C.img],
  mp4: ["video", C.img],
  mov: ["video", C.img],
  mp3: ["music", C.img],
  wav: ["music", C.img],
  pdf: ["file-type-pdf", "#d65b5b"],
  zip: ["file-zip", C.conf],
  gz: ["file-zip", C.conf],
  tar: ["file-zip", C.conf],
  csv: ["file-spreadsheet", C.data],
  tsv: ["file-spreadsheet", C.data],
  sql: ["database", C.data],
  db: ["database", C.data],
  sh: ["terminal-2", C.shell],
  bash: ["terminal-2", C.shell],
  zsh: ["terminal-2", C.shell],
  fish: ["terminal-2", C.shell],
  lock: ["lock", C.lock],
  pem: ["certificate", C.conf],
  crt: ["certificate", C.conf],
  wasm: ["file-code", "#8e6fd1"],
}

const BY_NAME: Record<string, Rule> = {
  "package.json": ["brand-npm", "#d65b5b"],
  "pnpm-lock.yaml": ["brand-pnpm", "#d9a33a"],
  "pnpm-workspace.yaml": ["brand-pnpm", "#d9a33a"],
  "yarn.lock": ["brand-yarn", "#5b8fd1"],
  "package-lock.json": ["brand-npm", "#d65b5b"],
  "bun.lockb": ["lock", C.lock],
  "bun.lock": ["lock", C.lock],
  "Cargo.toml": ["brand-rust", C.rust],
  "Cargo.lock": ["brand-rust", C.rust],
  "go.mod": ["brand-golang", C.go],
  "go.sum": ["brand-golang", C.go],
  ".gitignore": ["brand-git", C.git],
  ".gitattributes": ["brand-git", C.git],
  ".gitmodules": ["brand-git", C.git],
  Dockerfile: ["brand-docker", "#4b8fd6"],
  "docker-compose.yml": ["brand-docker", "#4b8fd6"],
  "docker-compose.yaml": ["brand-docker", "#4b8fd6"],
  "tsconfig.json": ["brand-typescript", C.ts],
  "deno.json": ["brand-deno"],
  LICENSE: ["license", "#d9a33a"],
  "LICENSE.md": ["license", "#d9a33a"],
  "README.md": ["info-circle", C.md],
  Makefile: ["terminal-2", C.shell],
  ".env": ["key", C.conf],
  ".editorconfig": ["settings", C.conf],
  ".prettierrc": ["settings", C.conf],
  ".prettierignore": ["settings", C.conf],
}

const BY_CONTAINS: Record<string, Rule> = {
  "vite.config": ["brand-vite", "#a776d6"],
  "tailwind.config": ["brand-tailwind", "#3fb6c9"],
  "eslint": ["settings", "#8e6fd1"],
  "tsconfig.": ["brand-typescript", C.ts],
  ".env.": ["key", C.conf],
  "dockerfile": ["brand-docker", "#4b8fd6"],
}

const SLOTS: Record<string, string> = {
  "file-tree-icon-file": "file",
  "file-tree-icon-chevron": "chevron-down",
  "file-tree-icon-lock": "lock",
  "file-tree-icon-ellipsis": "dots",
}

function symbolId(icon: string, color?: string) {
  return `tb-${icon}${color ? `-${color.slice(1)}` : ""}`
}

function toSymbol(svg: string, id: string, color?: string) {
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/, "")
  const stroke = color ?? "currentColor"
  return `<symbol id="${id}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`
}

let cached: Promise<FileTreeIconConfig> | null = null

/** Build a FileTree icon config backed by a Tabler sprite sheet. */
export function tablerTreeIcons(): Promise<FileTreeIconConfig> {
  if (cached) return cached
  cached = (async () => {
    const wanted = new Map<string, { icon: string; color?: string }>()
    const ref = ([icon, color]: Rule) => {
      const id = symbolId(icon, color)
      wanted.set(id, { icon, color })
      return { name: id, viewBox: "0 0 24 24", width: 16, height: 16 }
    }
    const map = (rules: Record<string, Rule>) =>
      Object.fromEntries(Object.entries(rules).map(([k, r]) => [k, ref(r)]))

    const byFileExtension = map(BY_EXT)
    const byFileName = map(BY_NAME)
    const byFileNameContains = map(BY_CONTAINS)
    const remap = Object.fromEntries(Object.entries(SLOTS).map(([slot, icon]) => [slot, ref([icon])]))

    const symbols = await Promise.all(
      [...wanted].map(async ([id, { icon, color }]) => {
        const svg = raw[`/node_modules/@tabler/icons/icons/outline/${icon}.svg`]
        return svg ? toSymbol(svg, id, color) : ""
      }),
    )
    return {
      set: "none",
      colored: false,
      spriteSheet: `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols.join("")}</svg>`,
      remap,
      byFileName,
      byFileExtension,
      byFileNameContains,
    } satisfies FileTreeIconConfig
  })()
  return cached
}

// ---- same icons outside the tree (palette, tabs) --------------------------

function ruleFor(path: string): Rule {
  const name = path.split("/").pop() ?? path
  if (BY_NAME[name]) return BY_NAME[name]
  const lower = name.toLowerCase()
  for (const [k, r] of Object.entries(BY_CONTAINS)) if (lower.includes(k)) return r
  const parts = lower.split(".")
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join(".")
    if (BY_EXT[ext]) return BY_EXT[ext]
  }
  return ["file"]
}

/** Inline SVG markup for a file's icon (same mapping + colors as the tree). */
export function fileIconSvg(path: string): string {
  const [icon, color] = ruleFor(path)
  const svg = raw[`/node_modules/@tabler/icons/icons/outline/${icon}.svg`] ?? raw["/node_modules/@tabler/icons/icons/outline/file.svg"]
  const inner = (svg ?? "")
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/, "")
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${color ?? "currentColor"}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
}
