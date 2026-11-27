import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import {
  IconArrowsMaximize,
  IconCode,
  IconMinus,
  IconMusic,
  IconPhoto,
  IconPlus,
  IconSquare,
  IconSquareFilled,
  IconChessFilled,
} from "@tabler/icons-react"
import { cn } from "cn"
import { ipc } from "@/lib/ipc"
import { useStore } from "@/store"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Placeholder } from "./Placeholder"
import { TabActions } from "@/components/TabActions"
import { formatBytes } from "./FileView"

export type MediaKind = "image" | "svg" | "audio" | "video"

const EXT: Record<string, [MediaKind, string]> = {
  png: ["image", "image/png"],
  jpg: ["image", "image/jpeg"],
  jpeg: ["image", "image/jpeg"],
  gif: ["image", "image/gif"],
  webp: ["image", "image/webp"],
  avif: ["image", "image/avif"],
  bmp: ["image", "image/bmp"],
  ico: ["image", "image/x-icon"],
  heic: ["image", "image/heic"],
  tif: ["image", "image/tiff"],
  tiff: ["image", "image/tiff"],
  svg: ["svg", "image/svg+xml"],
  mp3: ["audio", "audio/mpeg"],
  wav: ["audio", "audio/wav"],
  m4a: ["audio", "audio/mp4"],
  aac: ["audio", "audio/aac"],
  flac: ["audio", "audio/flac"],
  ogg: ["audio", "audio/ogg"],
  opus: ["audio", "audio/ogg"],
  aiff: ["audio", "audio/aiff"],
  mp4: ["video", "video/mp4"],
  m4v: ["video", "video/mp4"],
  mov: ["video", "video/quicktime"],
  webm: ["video", "video/webm"],
}

export function mediaKind(path: string): [MediaKind, string] | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return EXT[ext] ?? null
}

/** Resolve a playable URL: asset protocol locally (streams + range requests), blob over ssh. */
function useMediaSrc(path: string, mime: string) {
  const ws = useStore((s) => s.workspace)
  const [state, setState] = useState<{ src?: string; size?: number; error?: string }>({})
  useEffect(() => {
    if (!ws) return
    let alive = true
    let url: string | undefined
    setState({})
    ;(async () => {
      try {
        const size = await ipc.fileSize(ws.id, path)
        if (!ws.remote) {
          if (alive) setState({ src: convertFileSrc(`${ws.id}/${path}`), size })
          return
        }
        const buf = await ipc.readBytes(ws.id, path)
        url = URL.createObjectURL(new Blob([buf], { type: mime }))
        if (alive) setState({ src: url, size })
      } catch (e) {
        if (alive) setState({ error: String(e) })
      }
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [ws, path, mime])
  return state
}

/** Media info + controls live in the tab row (right side). */
function InfoBar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <TabActions>
      <div className="flex min-w-0 items-center gap-2 px-1 tabular-nums">{children}</div>
      {right && <div className="mx-1 h-4 w-px bg-border" />}
      {right}
    </TabActions>
  )
}

const Dot = () => <span className="opacity-40">·</span>

export function MediaView({
  tabId,
  path,
  kind,
  mime,
  onShowSource,
}: {
  tabId: string
  path: string
  kind: MediaKind
  mime: string
  onShowSource?: () => void
}) {
  const { src, size, error } = useMediaSrc(path, mime)
  if (error) return <Placeholder title="Couldn't load media" detail={error} />
  if (!src) return <Placeholder loading />
  if (kind === "audio") return <AudioView src={src} path={path} size={size} />
  if (kind === "video") return <VideoView src={src} size={size} mime={mime} />
  return <ImageView key={tabId} src={src} size={size} mime={mime} onShowSource={onShowSource} />
}

// ---------------------------------------------------------------- image

type Bg = "checker" | "dark" | "light"

function ImageView({ src, size, mime, onShowSource }: { src: string; size?: number; mime: string; onShowSource?: () => void }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState<number | "fit">("fit")
  const [fitScale, setFitScale] = useState(1)
  const [bg, setBg] = useState<Bg>("checker")
  const [failed, setFailed] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const computeFit = useCallback(() => {
    const el = box.current
    if (!el || !dims) return
    const pad = 48
    const s = Math.min((el.clientWidth - pad) / dims.w, (el.clientHeight - pad) / dims.h, 1)
    setFitScale(Math.max(s, 0.01))
  }, [dims])

  useEffect(() => {
    computeFit()
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(computeFit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [computeFit])

  const scale = zoom === "fit" ? fitScale : zoom
  const step = (dir: 1 | -1) => {
    const cur = scale
    const levels = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16]
    const next = dir > 0 ? levels.find((l) => l > cur + 1e-3) : [...levels].reverse().find((l) => l < cur - 1e-3)
    if (next) setZoom(next)
  }

  // ⌘/ctrl + wheel or trackpad pinch zooms.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => {
        const cur = z === "fit" ? fitScale : z
        return Math.min(32, Math.max(0.05, cur * Math.exp(-e.deltaY * 0.01)))
      })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [fitScale])

  const bgClass = {
    checker: "media-checker",
    dark: "bg-[#111]",
    light: "bg-white",
  }[bg]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <InfoBar
        right={
          <div className="flex items-center gap-1">
            <ToggleGroup value={[bg]} onValueChange={(v: string[]) => v[0] && setBg(v[0] as Bg)} size="sm" variant="outline" spacing={0}>
              <ToggleGroupItem value="checker" aria-label="Transparent grid" title="Transparency grid">
                <IconChessFilled className="size-3.5" />
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label="Dark background" title="Dark background">
                <IconSquareFilled className="size-3.5" />
              </ToggleGroupItem>
              <ToggleGroupItem value="light" aria-label="Light background" title="Light background">
                <IconSquare className="size-3.5" />
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="mx-1 h-4 w-px bg-border" />
            <Button size="icon-xs" variant="ghost" onClick={() => step(-1)} title="Zoom out (⌘ scroll)">
              <IconMinus />
            </Button>
            <button
              className="w-12 rounded px-1 py-0.5 text-center tabular-nums hover:bg-accent hover:text-foreground"
              onClick={() => setZoom(zoom === "fit" ? 1 : "fit")}
              title="Toggle fit / actual size"
            >
              {Math.round(scale * 100)}%
            </button>
            <Button size="icon-xs" variant="ghost" onClick={() => step(1)} title="Zoom in (⌘ scroll)">
              <IconPlus />
            </Button>
            <Button size="icon-xs" variant={zoom === "fit" ? "secondary" : "ghost"} onClick={() => setZoom("fit")} title="Fit">
              <IconArrowsMaximize />
            </Button>
            {onShowSource && (
              <>
                <div className="mx-1 h-4 w-px bg-border" />
                <Button size="xs" variant="ghost" onClick={onShowSource} title="View source (⇧⌘V)">
                  <IconCode /> Source
                </Button>
              </>
            )}
          </div>
        }
      >
        <IconPhoto className="size-3.5" />
        {dims && (
          <span className="text-foreground">
            {dims.w} × {dims.h}
          </span>
        )}
        {size != null && (
          <>
            <Dot /> <span>{formatBytes(size)}</span>
          </>
        )}
        <Dot /> <span>{mime.replace("image/", "").replace("+xml", "").toUpperCase()}</span>
      </InfoBar>
      <div ref={box} className={cn("relative min-h-0 flex-1 overflow-auto", bgClass)}>
        {failed ? (
          <Placeholder title="This image format can't be displayed" />
        ) : (
          <div
            className="flex min-h-full min-w-full items-center justify-center p-6"
            style={dims ? { width: dims.w * scale + 48, height: dims.h * scale + 48 } : undefined}
          >
            <img
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget
                // SVGs without intrinsic size report 0 → fall back to a sensible canvas.
                setDims({ w: img.naturalWidth || 512, h: img.naturalHeight || 512 })
              }}
              onError={() => setFailed(true)}
              className="max-w-none shadow-[0_0_0_1px_var(--border)]"
              style={{
                width: dims ? dims.w * scale : undefined,
                height: dims ? dims.h * scale : undefined,
                imageRendering: scale >= 3 ? "pixelated" : "auto",
                opacity: dims ? 1 : 0,
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- audio

function fmtTime(t: number) {
  if (!isFinite(t)) return "–:––"
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

function AudioView({ src, path, size }: { src: string; path: string; size?: number }) {
  const [duration, setDuration] = useState<number | null>(null)
  const name = path.split("/").pop()
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md rounded-3xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <IconMusic className="size-7" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {duration != null ? fmtTime(duration) : "…"}
              {size != null && ` · ${formatBytes(size)}`}
            </div>
          </div>
        </div>
        <audio
          src={src}
          controls
          preload="metadata"
          className="mt-5 w-full"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- video

function VideoView({ src, size, mime }: { src: string; size?: number; mime: string }) {
  const [meta, setMeta] = useState<{ w: number; h: number; d: number } | null>(null)
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <InfoBar>
        {meta && (
          <>
            <span className="text-foreground">
              {meta.w} × {meta.h}
            </span>
            <Dot /> <span>{fmtTime(meta.d)}</span>
          </>
        )}
        {size != null && (
          <>
            {meta && <Dot />} <span>{formatBytes(size)}</span>
          </>
        )}
        <Dot /> <span>{mime.split("/")[1].toUpperCase()}</span>
      </InfoBar>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-4">
        {failed ? (
          <Placeholder title="This video format can't be played" detail="WebKit plays MP4/H.264, HEVC, MOV and WebM (VP9)." />
        ) : (
          <video
            src={src}
            controls
            preload="metadata"
            className="max-h-full max-w-full rounded-lg"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              setMeta({ w: v.videoWidth, h: v.videoHeight, d: v.duration })
            }}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  )
}
