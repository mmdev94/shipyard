import { useMemo, useState } from 'react'
import type { Report } from '../lib/checker/index.ts'
import { HOST_LABEL } from '../lib/checker/hosts.ts'
import { ensureSetupSecret, repoCaller } from '../lib/github/deploy.ts'
import { moveFix, movePlan, type MoveItem, type MoveMode } from '../lib/move.ts'
import { href } from '../lib/route'
import { FixIt } from './FixIt'

const CHIP: Record<MoveItem['status'], { label: string; cls: string }> = {
  kept: { label: 'Kept', cls: 'bg-[#eaf7f0] text-[#13804a]' },
  changed: { label: 'Changes', cls: 'bg-[#fff3dc] text-[#8f6113]' },
  lost: { label: 'Not coming', cls: 'bg-[#fdecea] text-[#9d2b25]' },
}

const MODES: { id: MoveMode; title: string; blurb: string }[] = [
  { id: 'static', title: 'Static', blurb: 'Plain files — the simplest and fastest. What static hosting can’t do is listed.' },
  { id: 'exact', title: 'Exact rules', blurb: 'Your redirects, rewrites and headers, served by Caddy as a small server app.' },
]

/**
 * "Moving from Netlify?" — on the results of a repo set up for GitHub Pages,
 * Netlify or Vercel: what comes along, and one pull request that switches it.
 */
export function MovePanel({ report }: { report: Report }) {
  const s = report.host!
  const host = HOST_LABEL[s.host]
  const plans = useMemo(() => ({ static: movePlan(report, 'static'), exact: movePlan(report, 'exact') }), [report])
  // recommend exact rules only when it keeps something static hosting would drop
  const lostStatic = plans.static.filter((i) => i.status === 'lost').length
  const lostExact = plans.exact.filter((i) => i.status === 'lost').length
  const [mode, setMode] = useState<MoveMode>(report.detection.mode === 'static' && lostExact < lostStatic ? 'exact' : 'static')
  const fix = useMemo(() => moveFix(report, mode), [report, mode])
  const items = plans[mode]
  const { owner, repo } = report.repo
  const blocked = report.verdict.kind === 'unsupported'
  // the choice only matters when there are rules static hosting can't express
  const hasRules = (s.redirects.length > 0 || s.headers.length > 0) && report.detection.mode === 'static'

  return (
    <div className="border border-accent/50 bg-white">
      <div className="border-b border-line bg-accentSoft/40 px-5 py-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">Move my site</span>
        <h3 className="font-display mt-1.5 text-[1.35rem] font-semibold tracking-[-0.02em]">Moving from {host}? Here’s what comes along.</h3>
        <p className="mt-1 text-[14px] text-muted">
          Read from {s.sources.length ? s.sources.map((x, i) => <span key={x}>{i ? ', ' : ''}<code className="font-mono text-[12.5px] text-ink2">{x}</code></span>) : 'the repo'} — settings in {host}’s dashboard aren’t visible from here.
        </p>
      </div>

      {hasRules && (
      <div className="grid grid-cols-1 gap-2 px-5 pt-4 sm:grid-cols-2" role="radiogroup" aria-label="How to serve the site">
        {MODES.map((m) => {
          const lost = plans[m.id].filter((i) => i.status === 'lost').length
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`border px-3.5 py-3 text-left ${mode === m.id ? 'border-accent bg-accentSoft/50' : 'border-line hover:border-ink/30'}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold text-ink">{m.title}</span>
                <span className="font-mono text-[11px] text-muted">{lost ? `${lost} not coming` : 'everything comes'}</span>
              </span>
              <span className="mt-1 block text-[12.5px] leading-snug text-muted">{m.blurb}</span>
            </button>
          )
        })}
      </div>
      )}

      <ul className="divide-y divide-line px-5 py-2">
        {items.map((i) => (
          <li key={i.what} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
            <span className="flex shrink-0 items-start gap-2 sm:w-[210px]">
              <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] ${CHIP[i.status].cls}`}>{CHIP[i.status].label}</span>
              <span className="text-[14px] font-semibold text-ink">{i.what}</span>
            </span>
            <span className="text-[13.5px] leading-relaxed text-muted">{i.detail.split('`').map((part, n) => (n % 2 ? <code key={n} className="font-mono text-[12.5px] text-ink2">{part}</code> : part))}</span>
          </li>
        ))}
      </ul>

      <div className="border-t border-line px-5 py-4">
        {blocked ? (
          <p className="text-[14px] text-muted">The check found something ms.computer can’t run yet (see <em>Must fix</em> below), so there’s no move pull request for this repo.</p>
        ) : (
          <>
            <p className="mb-3 text-[14px] text-muted">{fix.summary}</p>
            <FixIt
              key={mode}
              fix={fix}
              report={report}
              showHeader={false}
              label="Preview the move →"
              beforePr={async (token) => {
                await ensureSetupSecret(repoCaller(owner, repo, token), token)
              }}
              done={
                <>
                  Merging it deploys the site —{' '}
                  <a href={href.track(owner, repo)} className="font-semibold text-accent underline underline-offset-4">
                    follow it in the tracker
                  </a>
                  . When it’s live, compare both sites, then turn off the old one.
                </>
              }
            />
          </>
        )}
      </div>
    </div>
  )
}
