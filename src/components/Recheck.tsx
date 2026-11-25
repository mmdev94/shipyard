import type { Recheck } from '../lib/recheck.ts'
import { href } from '../lib/route'

const short = (c?: string) => (c ? c.slice(0, 7) : '')
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** "Check again", and — with GitHub connected — "Watching main". */
export function RecheckBar({
  commit,
  branch,
  recheck,
  onCheckAgain,
  watch,
}: {
  commit?: string
  branch: string
  recheck: Recheck | null
  onCheckAgain: () => void
  watch: { state: 'off' | 'watching' | 'paused'; resume: () => void; connected: boolean }
}) {
  const busy = recheck?.kind === 'busy'
  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <button
          type="button"
          onClick={onCheckAgain}
          disabled={busy}
          className="border border-line bg-white px-3.5 py-2 font-semibold text-ink2 transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
        >
          {busy ? 'Checking…' : 'Check again'}
        </button>
        {watch.state === 'watching' && (
          <span className="inline-flex items-center gap-2 text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-ok" /> Watching <span className="font-mono">{branch}</span> — checks again when it changes
          </span>
        )}
        {watch.state === 'paused' && (
          <span className="text-muted">
            Stopped watching after 30 minutes without a new commit.{' '}
            <button type="button" onClick={watch.resume} className="font-semibold text-accent underline underline-offset-2">
              Watch again
            </button>
          </span>
        )}
        {!watch.connected && (
          <span className="text-muted">
            <a href={href.sites} className="font-semibold text-accent underline underline-offset-2">Connect GitHub</a> to re-check automatically
            after every push.
          </span>
        )}
      </div>
      {recheck?.kind === 'same' && (
        <p className="text-[13px] text-muted">
          No new commits on <span className="font-mono">{branch}</span> — still <span className="font-mono">{short(commit)}</span> (checked {time(recheck.at)}).
        </p>
      )}
      {recheck?.kind === 'changed' && (
        <div className="border border-accent/40 bg-white px-4 py-3 text-[14px]">
          <p className="font-semibold text-ink">
            New commit <span className="font-mono">{short(recheck.commit)}</span> — checked again at {time(recheck.at)}.
          </p>
          {recheck.fixed.length === 0 && recheck.added.length === 0 && <p className="mt-1 text-muted">Nothing changed in the results.</p>}
          {recheck.fixed.map((t) => (
            <p key={`f-${t}`} className="mt-1 text-[#13804a]">✓ Fixed: {t}</p>
          ))}
          {recheck.added.map((t) => (
            <p key={`a-${t}`} className="mt-1 text-[#b3302a]">New: {t}</p>
          ))}
        </div>
      )}
      {recheck?.kind === 'error' && <p className="text-[13px] text-[#b3302a]">{recheck.message}</p>}
    </div>
  )
}
