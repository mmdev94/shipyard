import type { ReactNode } from 'react'
import type { SiteSummary } from '../../lib/watch/model'

export type Status = 'up' | 'down' | 'unknown'

/** Up / down from the latest check; "unknown" when there's no check in the last 30 minutes. */
export function statusOf(s: SiteSummary, generated: string): Status {
  if (!s.last) return 'unknown'
  if (Date.parse(generated) - Date.parse(s.last.at) > 30 * 60_000) return 'unknown'
  return s.last.up ? 'up' : 'down'
}

const STATUS: Record<Status, { label: string; dot: string; text: string }> = {
  up: { label: 'Up', dot: 'bg-good', text: 'text-goodText' },
  down: { label: 'Down', dot: 'bg-bad', text: 'text-badText' },
  unknown: { label: 'No recent check', dot: 'bg-muted', text: 'text-muted' },
}

export function StatusPill({ status, className = '' }: { status: Status; className?: string }) {
  const s = STATUS[status]
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${s.text} ${className}`}>
      <span className="relative inline-flex h-2.5 w-2.5">
        {status !== 'unknown' && <span className={`beacon absolute inset-0 rounded-full ${s.dot}`} />}
        <span className={`relative h-2.5 w-2.5 rounded-full ${s.dot}`} />
      </span>
      {s.label}
    </span>
  )
}

export function ServedBy({ upstream, up }: { upstream: string | null | undefined; up: boolean }) {
  if (!up) return <span className="text-muted">—</span>
  if (upstream === 'replica') return <span title="ms.computer said a miner’s copy of the site answered (x-ms-edge-upstream: replica)">miners</span>
  if (upstream === 'origin')
    return <span title="ms.computer said its own temporary copy answered (x-ms-edge-upstream: origin) — usual right after a deploy, before miners take over">ms.computer origin</span>
  return <span className="text-muted" title="the answer didn’t say">not said</span>
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="border border-line bg-white p-5">
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      <p className={`font-display tabular mt-1 text-[2rem] font-semibold leading-tight tracking-[-0.02em] ${tone === 'bad' ? 'text-badText' : 'text-ink'}`}>{value}</p>
      {note && <p className="mt-1 text-[13px] leading-snug text-muted">{note}</p>}
    </div>
  )
}

export function Receipt({ run, children }: { run: { url: string } | null; children?: ReactNode }) {
  if (!run) return <span className="text-muted">{children ?? 'measured locally (not a public run)'}</span>
  return (
    <a href={run.url} target="_blank" rel="noopener" className="font-mono text-accent underline underline-offset-2 hover:text-accent2">
      {children ?? 'see the run ↗'}
    </a>
  )
}
