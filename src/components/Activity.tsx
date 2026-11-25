import { useEffect } from 'react'
import { describe, isWrite, setActivityOpen, useActivity, useActivityOpen } from '../lib/github/activity.ts'
import { useSession } from '../lib/github/client.ts'

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** "Activity · 12" — opens the log of everything done with the token. */
export function ActivityButton({ className = '' }: { className?: string }) {
  const log = useActivity()
  const writes = log.filter((e) => isWrite(e.method)).length
  return (
    <button type="button" onClick={() => setActivityOpen(true)} className={className}>
      What Shipyard did with your token{log.length ? ` · ${log.length} call${log.length === 1 ? '' : 's'}${writes ? `, ${writes} change${writes === 1 ? '' : 's'}` : ''}` : ''}
    </button>
  )
}

/** Side panel: every GitHub API call made with the token in this tab, in plain words. */
export function ActivityDrawer() {
  const open = useActivityOpen()
  const log = useActivity()
  const session = useSession()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setActivityOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) return null
  const writes = log.filter((e) => isWrite(e.method))

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Token activity">
      <button type="button" aria-label="Close" onClick={() => setActivityOpen(false)} className="absolute inset-0 bg-ink/30" />
      <aside className="relative flex h-full w-full max-w-[520px] flex-col border-l border-line bg-white shadow-2xl">
        <div className="border-b border-line p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="eyebrow">Token activity</span>
              <h2 className="font-display mt-3 text-2xl font-semibold tracking-[-0.02em]">What Shipyard did with your token</h2>
            </div>
            <button type="button" onClick={() => setActivityOpen(false)} className="border border-line px-3 py-1.5 text-sm font-semibold hover:border-ink/30">
              Close
            </button>
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-muted">
            Every GitHub API call made with it in this tab, newest first — {log.length} in all, {writes.length} that changed
            something. The page’s security policy blocks every host except GitHub, so this is the whole list. It’s kept in
            memory and cleared when you disconnect or refresh.
          </p>
          {!session && <p className="mt-3 text-[14px] font-semibold text-ink2">Not connected — no token in this tab.</p>}
        </div>
        <ol className="flex-1 divide-y divide-line/70 overflow-y-auto" data-lenis-prevent>
          {log.length === 0 && <li className="p-5 text-[14px] text-muted">Nothing yet.</li>}
          {log.map((e) => {
            const w = isWrite(e.method)
            const ok = e.status >= 200 && e.status < 400
            return (
              <li key={e.id} className={`px-5 py-3 ${w ? 'bg-[#fffaf0]' : ''}`}>
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${
                      w ? 'bg-[#f5a524] text-white' : 'bg-bg2 text-muted'
                    }`}
                  >
                    {w ? 'change' : 'read'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-snug text-ink">
                      {describe(e.method, e.path)}
                      {e.count > 1 && <span className="text-muted"> · ×{e.count}</span>}
                    </p>
                    <p className="font-mono mt-1 break-all text-[11px] text-muted">
                      {time(e.at)} · {e.method} {e.path} ·{' '}
                      <span className={ok || e.status === 404 ? '' : 'text-[#b3302a]'}>{e.status || 'no answer'}</span>
                    </p>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </aside>
    </div>
  )
}
