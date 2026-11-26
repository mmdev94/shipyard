// Tiny animation kit for the guide clips: every clip is a pure function of
// time `t` (ms), drawn in a fixed 960×600 frame and scaled to fit. On the site
// they play live (cheap, sharp, no video files); the recorder sets `t` frame by
// frame to export GIFs and the link-preview image from the very same code.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export const W = 960
export const H = 600

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
/** 0→1 progress of t between a and b, eased */
export const prog = (t: number, a: number, b: number) => {
  const x = clamp((t - a) / (b - a))
  return 1 - Math.pow(1 - x, 3)
}
/** fade + rise in at time a */
export const appear = (t: number, a: number, dur = 350): CSSProperties => {
  const p = prog(t, a, a + dur)
  return { opacity: p, transform: `translateY(${(1 - p) * 10}px)` }
}
/** the first n characters of s, typed between a and b */
export const typed = (s: string, t: number, a: number, b: number) => s.slice(0, Math.round(clamp((t - a) / (b - a)) * s.length))

export interface Clip {
  id: string
  title: string
  caption: string
  duration: number
  /** `bare`: no cursor or caption (for still images) */
  render: (t: number, bare?: boolean) => ReactNode
}

/** A macOS-style window: traffic lights and an address bar. */
export function Window({ url = 'shipyard-h0413.ms.computer', children, style, dark = false }: { url?: string; children: ReactNode; style?: CSSProperties; dark?: boolean }) {
  return (
    <div
      className={`absolute overflow-hidden rounded-xl border ${dark ? 'border-darkline bg-dark' : 'border-line bg-white'}`}
      style={{ boxShadow: '0 30px 60px -30px rgba(20,16,30,.45)', ...style }}
    >
      <div className={`flex h-9 items-center gap-2 border-b px-3 ${dark ? 'border-darkline bg-dark2' : 'border-line bg-bg2'}`}>
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className={`font-mono ml-3 flex-1 truncate rounded-md px-3 py-1 text-center text-[11px] ${dark ? 'bg-dark text-white/50' : 'bg-white text-muted'}`}>{url}</span>
      </div>
      <div className="relative h-[calc(100%-36px)]">{children}</div>
    </div>
  )
}

/** A pointer that glides between keyframes [t, x, y] and pulses on clicks. */
export function Cursor({ t, path, clicks = [] }: { t: number; path: [number, number, number][]; clicks?: number[] }) {
  let x = path[0][1]
  let y = path[0][2]
  for (let i = 1; i < path.length; i++) {
    const [ta, xa, ya] = path[i - 1]
    const [tb, xb, yb] = path[i]
    if (t >= ta) {
      const p = prog(t, ta, tb)
      x = xa + (xb - xa) * p
      y = ya + (yb - ya) * p
    }
  }
  const click = clicks.find((c) => t >= c && t < c + 450)
  const ring = click === undefined ? 0 : (t - click) / 450
  return (
    <div className="pointer-events-none absolute z-50" style={{ left: x, top: y }}>
      {click !== undefined && (
        <span className="absolute rounded-full border-2 border-accent" style={{ width: 44 * ring + 8, height: 44 * ring + 8, left: -(22 * ring + 4), top: -(22 * ring + 4), opacity: 1 - ring }} />
      )}
      <svg width="22" height="26" viewBox="0 0 22 26" style={{ transform: click !== undefined && ring < 0.3 ? 'scale(.88)' : undefined, transformOrigin: '0 0' }}>
        <path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15 L17.5 15 Z" fill="#16161a" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export function Check({ done, doing }: { done?: boolean; doing?: boolean }) {
  if (done) return <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ok text-[11px] text-white">✓</span>
  if (doing)
    return (
      <span className="relative grid h-5 w-5 shrink-0 place-items-center">
        <span className="absolute h-5 w-5 animate-ping rounded-full bg-accent/30" />
        <span className="h-2.5 w-2.5 rounded-full bg-accent" />
      </span>
    )
  return <span className="h-5 w-5 shrink-0 rounded-full border border-line" />
}

/** The step number and one plain sentence under the window. */
export function Caption({ n, text }: { n?: string; text: string }) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex h-[64px] items-center gap-3 px-8">
      {n && <span className="font-mono grid h-8 w-8 shrink-0 place-items-center bg-accent text-sm font-semibold text-white">{n}</span>}
      <span className="font-display text-[21px] font-semibold tracking-[-0.01em] text-ink">{text}</span>
    </div>
  )
}

/** Renders a clip at its design size, scaled to the box it's given. */
export function Stage({ children, className = '', height = H }: { children: ReactNode; className?: string; /** crop the frame's bottom (e.g. no caption) */ height?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} className={`relative w-full overflow-hidden ${className}`} style={{ aspectRatio: `${W} / ${height}` }}>
      <div className="absolute left-0 top-0" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        {children}
      </div>
    </div>
  )
}

/**
 * Time for a clip playing on the page: loops while it's on screen, freezes on
 * its final frame for people who prefer reduced motion.
 */
export function useClipTime(duration: number, hold = 1800) {
  const box = useRef<HTMLDivElement>(null)
  const [t, setT] = useState(duration)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let start = 0
    let visible = false
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible && !raf) {
        start = performance.now() - (start ? 0 : 0)
        tick(start)
      }
    })
    const tick = (now: number) => {
      if (!visible) {
        raf = 0
        return
      }
      setT(((now - start) % (duration + hold)))
      raf = requestAnimationFrame(tick)
    }
    if (box.current) io.observe(box.current)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [duration, hold])
  return { box, t: Math.min(t, duration) }
}
