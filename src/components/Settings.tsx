import type { ReactNode } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { defaultPrefs, useStore, type Appearance } from "@/store"
import { runCommand } from "@/commands"
import { themeOptions } from "@/lib/themes"

const UI_FONTS = ["Geist Variable", "-apple-system", "SF Pro Text", "Inter", "Helvetica Neue", "IBM Plex Sans", "system-ui"]
const CODE_FONTS = [
  "Geist Mono Variable",
  "SF Mono",
  "Menlo",
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Berkeley Mono",
  "Iosevka",
  "Monaspace Neon",
  "Commit Mono",
  "IBM Plex Mono",
  "Source Code Pro",
  "Hack",
]

const WEIGHTS: [number, string][] = [
  [300, "Light · 300"],
  [400, "Regular · 400"],
  [450, "Book · 450"],
  [500, "Medium · 500"],
  [600, "Semibold · 600"],
]

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-2">
      <h3 className="pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="divide-y">{children}</div>
    </section>
  )
}

function ThemeSelect({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v && onChange(v as string)}
      items={options.map(([o, l]) => ({ value: o, label: l }))}
    >
      <SelectTrigger className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([o, l]) => (
          <SelectItem key={o} value={o}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function FontInput({ id, value, options, onChange }: { id: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <>
      <Input
        list={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="w-56"
        style={{ fontFamily: `"${value}", ${id.includes("code") ? "monospace" : "sans-serif"}` }}
      />
      <datalist id={id}>
        {options.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </>
  )
}

function SizeSlider({
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <>
      <Slider
        className="w-40 data-horizontal:w-40"
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : (v as number))}
      />
      <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{format ? format(value) : value}</span>
    </>
  )
}

export function Settings() {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const p = useStore()
  const set = p.setPrefs

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Changes apply instantly.</DialogDescription>
        </DialogHeader>

        <Section title="Theme">
          <Row label="Appearance">
            <ToggleGroup
              value={[p.appearance]}
              onValueChange={(v: string[]) => v[0] && set({ appearance: v[0] as Appearance })}
              size="sm"
              variant="outline"
            >
              <ToggleGroupItem value="system">System</ToggleGroupItem>
              <ToggleGroupItem value="light">Light</ToggleGroupItem>
              <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label="Dark theme">
            <ThemeSelect value={p.darkTheme} options={themeOptions(true, p.customThemes)} onChange={(v) => set({ darkTheme: v })} />
          </Row>
          <Row label="Custom themes" hint="VS Code theme .json files">
            <Button size="sm" variant="ghost" onClick={() => runCommand("view.importTheme")}>
              Import…
            </Button>
            <Button size="sm" variant="ghost" onClick={() => runCommand("view.openThemesFolder")}>
              Open folder
            </Button>
          </Row>
          <Row label="Light theme">
            <ThemeSelect value={p.lightTheme} options={themeOptions(false, p.customThemes)} onChange={(v) => set({ lightTheme: v })} />
          </Row>
        </Section>

        <Section title="Interface">
          <Row label="Font" hint="Any installed font family">
            <FontInput id="ui-fonts" value={p.uiFont} options={UI_FONTS} onChange={(v) => set({ uiFont: v })} />
          </Row>
          <Row label="Size" hint="Scales the whole interface">
            <SizeSlider value={p.uiFontSize} min={11} max={17} step={0.5} onChange={(v) => set({ uiFontSize: v })} format={(v) => `${v}px`} />
          </Row>
        </Section>

        <Section title="Code">
          <Row label="Font">
            <FontInput id="code-fonts" value={p.codeFont} options={CODE_FONTS} onChange={(v) => set({ codeFont: v })} />
          </Row>
          <Row label="Size">
            <SizeSlider value={p.codeFontSize} min={10} max={20} step={0.5} onChange={(v) => set({ codeFontSize: v })} format={(v) => `${v}px`} />
          </Row>
          <Row label="Line height">
            <SizeSlider value={p.codeLineHeight} min={1.2} max={2} step={0.05} onChange={(v) => set({ codeLineHeight: v })} format={(v) => v.toFixed(2)} />
          </Row>
          <Row label="Weight" hint="Needs a font with that weight (variable fonts work best)">
            <Select
              value={String(p.codeFontWeight)}
              onValueChange={(v) => v && set({ codeFontWeight: Number(v) })}
              items={WEIGHTS.map(([w, l]) => ({ value: String(w), label: l }))}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEIGHTS.map(([w, l]) => (
                  <SelectItem key={w} value={String(w)}>
                    <span style={{ fontFamily: "var(--code-font)", fontWeight: w }}>{l}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Ligatures" hint="e.g. => != === in fonts that support them">
            <Switch checked={p.ligatures} onCheckedChange={(c) => set({ ligatures: c })} />
          </Row>
          <Row label="Indent guides">
            <Switch checked={p.indentGuides} onCheckedChange={(c) => set({ indentGuides: c })} />
          </Row>
          <Row label="Wrap long lines">
            <Switch checked={p.wrap} onCheckedChange={(c) => set({ wrap: c })} />
          </Row>
          <Row label="Diff layout">
            <ToggleGroup
              value={[p.diffStyle]}
              onValueChange={(v: string[]) => v[0] && set({ diffStyle: v[0] as "split" | "unified" })}
              size="sm"
              variant="outline"
            >
              <ToggleGroupItem value="split">Split</ToggleGroupItem>
              <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
            </ToggleGroup>
          </Row>
        </Section>

        <div className="flex justify-end pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              set({
                uiFont: defaultPrefs.uiFont,
                uiFontSize: defaultPrefs.uiFontSize,
                codeFont: defaultPrefs.codeFont,
                codeFontSize: defaultPrefs.codeFontSize,
                codeLineHeight: defaultPrefs.codeLineHeight,
                codeFontWeight: defaultPrefs.codeFontWeight,
                ligatures: defaultPrefs.ligatures,
              })
            }
          >
            Reset fonts
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
