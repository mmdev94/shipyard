import { useEffect, useMemo, useState } from 'react'
import { useSession } from '../lib/github/client.ts'
import { closeReport, collectContext, ISSUES, issueUrl, openReport, reportText, useReport, type ReportKind, type ReportPreset } from '../lib/report.ts'

const KINDS: { id: ReportKind; label: string; what: string; placeholder: string }[] = [
  { id: 'bug', label: 'Something’s broken', what: 'What happened?', placeholder: 'e.g. The check never finishes for my repo — it just keeps loading.' },
  { id: 'idea', label: 'Idea', what: 'What’s the idea?', placeholder: 'e.g. It would help if Shipyard could also deploy my Python app.' },
  { id: 'question', label: 'Question', what: 'Your question', placeholder: 'e.g. Do previews cost anything?' },
]

/** "Report this" next to an error message: opens the dialog with the error attached. */
export function ReportLink({ preset, className = '' }: { preset: ReportPreset; className?: string }) {
  return (
    <button type="button" onClick={() => openReport({ kind: 'bug', ...preset })} className={`font-semibold underline underline-offset-2 hover:text-accent ${className}`}>
      Report this
    </button>
  )
}

/** The small button on every page. */
export function ReportButton() {
  const { open } = useReport()
  if (open) return null
  return (
    <button
      type="button"
      onClick={() => openReport()}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-line bg-white/95 px-4 py-2.5 text-[13px] font-semibold text-ink2 shadow-[0_10px_30px_-12px_rgba(20,16,30,.35)] backdrop-blur hover:border-accent hover:text-accent"
    >
      <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M12 7v4M12 14h.01" />
      </svg>
      Report a problem
    </button>
  )
}

export function ReportDialog() {
  const { open, preset } = useReport()
  const session = useSession()
  const [kind, setKind] = useState<ReportKind>('bug')
  const [what, setWhat] = useState('')
  const [steps, setSteps] = useState('')
  const [include, setInclude] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setKind(preset.kind ?? 'bug')
    setCopied(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeReport()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, preset])

  const context = useMemo(
    () =>
      open
        ? collectContext({
            hash: window.location.hash,
            commit: __COMMIT__,
            builtAt: __BUILT_AT__,
            ua: navigator.userAgent,
            viewport: [window.innerWidth, window.innerHeight],
            connected: Boolean(session),
            preset,
          })
        : [],
    [open, preset, session],
  )
  if (!open) return null

  const k = KINDS.find((x) => x.id === kind)!
  const input = { kind, what, steps, context: include ? context : [] }
  const ready = what.trim().length > 0

  const send = () => {
    const w = window.open(issueUrl(input), '_blank')
    if (w) w.opener = null
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(input))
      setCopied(true)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Report a problem">
      <button type="button" aria-label="Close" onClick={closeReport} className="absolute inset-0 bg-ink/35" />
      <div className="relative max-h-[92vh] w-full max-w-[560px] overflow-y-auto border border-line bg-white p-6 shadow-2xl" data-lenis-prevent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">Report a problem</h2>
            <p className="mt-1 text-[14px] text-muted">First version — every report helps. Thank you!</p>
          </div>
          <button type="button" onClick={closeReport} className="border border-line px-3 py-1.5 text-sm font-semibold hover:border-ink/30">
            Close
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Kind of report">
          {KINDS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={kind === x.id}
              onClick={() => setKind(x.id)}
              className={`border px-2 py-2.5 text-[13px] font-semibold ${kind === x.id ? 'border-accent bg-accentSoft text-accent2' : 'border-line text-ink2 hover:border-ink/30'}`}
            >
              {x.label}
            </button>
          ))}
        </div>

        <label className="mt-5 block">
          <span className="text-sm font-semibold text-ink">{k.what}</span>
          <textarea
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            rows={4}
            placeholder={k.placeholder}
            className="mt-1.5 w-full border border-line px-3 py-2.5 text-[14px] outline-none focus:border-accent"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-sm font-semibold text-ink">{kind === 'bug' ? 'What were you doing?' : 'Anything else?'} <span className="font-normal text-muted">(optional)</span></span>
          <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={2} className="mt-1.5 w-full border border-line px-3 py-2.5 text-[14px] outline-none focus:border-accent" />
        </label>

        <div className="mt-4 border border-line bg-bg2 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink2">
            <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} className="accent-[#8f63ff]" />
            Add these details (they help me fix it faster)
          </label>
          <pre className={`font-mono mt-2 whitespace-pre-wrap text-[11.5px] leading-relaxed ${include ? 'text-ink2' : 'text-muted line-through'}`}>{context.join('\n')}</pre>
          <p className="mt-2 text-[12px] text-muted">No token, no account details, nothing from your repos except what’s shown here.</p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={send} disabled={!ready} className="border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#7d4ff0] disabled:opacity-50">
            Open it on GitHub ↗
          </button>
          <button type="button" onClick={copy} disabled={!ready} className="border border-line px-4 py-2.5 text-sm font-semibold text-ink2 hover:border-ink/30 disabled:opacity-50">
            {copied ? 'Copied ✓ — paste it in Discord' : 'Copy for Discord'}
          </button>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          GitHub opens with everything filled in — nothing is sent until you press <em>Submit</em> there (a free GitHub account is
          needed). No account? Copy it into the competition Discord instead.{' '}
          <a href={ISSUES} target="_blank" rel="noopener" className="text-accent underline underline-offset-2">See what’s already reported ↗</a>
        </p>
      </div>
    </div>
  )
}
