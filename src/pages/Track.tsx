import { useEffect, useRef, useState } from 'react'
import { GitHubError } from '../lib/checker/index.ts'
import { href } from '../lib/route'
import { badgeMarkdown, actionsUrl } from '../lib/setup'
import { annotationLines, hasWorkflow, loadTrack, type Step, type TrackState } from '../lib/track'
import { CopyButton } from '../components/DeployPanel'

function ago(iso: string | null): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.round(s)}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

function duration(a: string | null, b: string | null): string {
  if (!a) return ''
  const s = Math.round(((b ? new Date(b) : new Date()).getTime() - new Date(a).getTime()) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function StepIcon({ s }: { s: Step }) {
  if (s.status !== 'completed') {
    return s.status === 'in_progress' ? (
      <span className="relative grid h-5 w-5 place-items-center">
        <span className="absolute h-5 w-5 animate-ping rounded-full bg-accent/30" />
        <span className="h-2.5 w-2.5 rounded-full bg-accent" />
      </span>
    ) : (
      <span className="h-5 w-5 rounded-full border border-line" />
    )
  }
  if (s.conclusion === 'success') return <span className="grid h-5 w-5 place-items-center rounded-full bg-ok text-[11px] text-white">✓</span>
  if (s.conclusion === 'failure') return <span className="grid h-5 w-5 place-items-center rounded-full bg-[#e0453a] text-[11px] text-white">✕</span>
  return <span className="grid h-5 w-5 place-items-center rounded-full border border-line text-[10px] text-muted">–</span>
}

type Phase = 'loading' | 'missing' | 'ready' | 'error'

export function Track({ owner, repo }: { owner: string; repo: string }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [state, setState] = useState<TrackState | null>(null)
  const [error, setError] = useState('')
  const [, tick] = useState(0)
  const prev = useRef<TrackState | undefined>(undefined)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    prev.current = undefined
    setPhase('loading')
    setState(null)

    const poll = async () => {
      if (!alive) return
      if (document.hidden) {
        timer = setTimeout(poll, 3000)
        return
      }
      try {
        if (!prev.current && !(await hasWorkflow(owner, repo))) {
          if (alive) setPhase('missing')
          return
        }
        const next = await loadTrack(owner, repo, prev.current)
        if (!alive) return
        prev.current = next
        setState(next)
        setPhase('ready')
        setError('')
        const running = next.run && next.run.status !== 'completed'
        timer = setTimeout(poll, running ? 6000 : 30000)
      } catch (e) {
        if (!alive) return
        if (e instanceof GitHubError && e.status === 404) {
          setPhase('missing')
          return
        }
        const wait = e instanceof GitHubError && e.rateLimitReset ? Math.max(60_000, e.rateLimitReset.getTime() - Date.now()) : 20000
        setError(
          e instanceof GitHubError && e.rateLimitReset
            ? `${e.message} Picking up again at ${e.rateLimitReset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
            : (e as Error).message,
        )
        if (!prev.current) setPhase('error')
        timer = setTimeout(poll, wait)
      }
    }
    poll()
    const clock = setInterval(() => tick((t) => t + 1), 1000)
    return () => {
      alive = false
      clearTimeout(timer)
      clearInterval(clock)
    }
  }, [owner, repo])

  const run = state?.run
  const running = run && run.status !== 'completed'
  const failed = run?.status === 'completed' && run.conclusion === 'failure'
  const errors = state?.annotations.filter((a) => a.annotation_level === 'failure') ?? []
  const notices = state?.annotations.filter((a) => a.annotation_level !== 'failure' && a.title !== 'Live on ms.computer') ?? []

  return (
    <section className="px-6 py-14 md:px-14 md:py-20">
      <div className="mx-auto max-w-shell">
        <a href={href.home} className="text-sm text-muted hover:text-accent">← Shipyard</a>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="eyebrow">Deploy tracker</span>
            <h1 className="font-display mt-4 text-[clamp(2rem,4.6vw,3.4rem)] font-medium leading-[1.04] tracking-[-0.035em]">
              {owner}/<span className="text-accent">{repo}</span>
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={actionsUrl(owner, repo)} target="_blank" rel="noopener" className="border border-line bg-white px-4 py-2.5 text-sm font-semibold hover:border-ink/30">
              Actions on GitHub ↗
            </a>
            <CopyButton text={badgeMarkdown(owner, repo)} label="Copy README badge" className="px-4 py-2.5 text-sm" />
          </div>
        </div>

        {phase === 'loading' && <p className="mt-12 text-muted">Reading the latest run from GitHub…</p>}

        {phase === 'missing' && (
          <div className="mt-12 border border-line bg-bg2 p-8">
            <h2 className="text-xl font-semibold">No Shipyard workflow here yet.</h2>
            <p className="mt-2 text-muted">
              This repo has no <code className="font-mono text-[13px]">.github/workflows/ms-computer.yml</code>, or it's private.
            </p>
            <a href={href.check(owner, repo)} className="mt-5 inline-block border border-accent bg-accent px-5 py-3 font-semibold text-white hover:bg-[#7d4ff0]">
              Check this repo →
            </a>
          </div>
        )}

        {phase === 'error' && <p className="mt-12 border border-[#f1c2bd] bg-[#fff6f5] p-5 text-[#b3302a]">{error}</p>}

        {phase === 'ready' && state && (
          <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              {/* latest run */}
              {run ? (
                <div className="border border-line bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white ${
                            running ? 'bg-accent' : failed ? 'bg-[#e0453a]' : run.conclusion === 'success' ? 'bg-ok' : 'bg-muted'
                          }`}
                        >
                          {running ? (run.status === 'queued' ? 'queued' : 'deploying') : run.conclusion ?? run.status}
                        </span>
                        <span className="font-mono text-[13px] text-muted">{run.head_sha.slice(0, 7)}</span>
                      </div>
                      <p className="mt-1.5 truncate font-semibold">{run.display_title}</p>
                    </div>
                    <div className="font-mono text-right text-[12px] text-muted">
                      <div>{running ? `running ${duration(run.run_started_at, null)}` : ago(run.updated_at)}</div>
                      <a href={run.html_url} target="_blank" rel="noopener" className="text-accent hover:underline">
                        full log ↗
                      </a>
                    </div>
                  </div>
                  <ol className="divide-y divide-line/70">
                    {state.steps.map((s) => (
                      <li key={s.number} className="flex items-center gap-3 px-5 py-3">
                        <StepIcon s={s} />
                        <span className={`flex-1 text-[15px] ${s.status === 'completed' && s.conclusion === 'skipped' ? 'text-muted' : 'text-ink'}`}>{s.name}</span>
                        <span className="font-mono text-[12px] text-muted">{s.conclusion === 'skipped' ? 'skipped' : duration(s.started_at, s.completed_at)}</span>
                      </li>
                    ))}
                    {state.steps.length === 0 && <li className="px-5 py-4 text-sm text-muted">Waiting for a runner…</li>}
                  </ol>
                </div>
              ) : (
                <div className="border border-line bg-bg2 p-6 text-muted">The workflow is in place but hasn't run yet. Push a commit to start it.</div>
              )}

              {/* why it failed — read from the run's annotations */}
              {errors.map((a, i) => (
                <div key={i} className="border border-[#f1c2bd] bg-[#fff6f5]">
                  <p className="border-b border-[#f1c2bd] px-5 py-3 font-semibold text-[#b3302a]">{a.title || 'The run stopped'}</p>
                  <pre className="font-mono max-h-[360px] overflow-auto whitespace-pre-wrap px-5 py-4 text-[12.5px] leading-relaxed text-ink2" data-lenis-prevent>
                    {annotationLines(a).join('\n')}
                  </pre>
                </div>
              ))}
              {notices.map((a, i) => (
                <div key={i} className="border border-line bg-bg2 px-5 py-4 text-[14px] text-ink2">
                  <span className="font-semibold">{a.title}</span> {annotationLines(a).join(' ')}
                </div>
              ))}
            </div>

            {/* live site */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className={`border p-6 ${state.liveUrl ? 'border-ok/40 bg-[#f3fbf6]' : 'border-line bg-bg2'}`}>
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Live site</span>
                {state.liveUrl ? (
                  <>
                    <a href={state.liveUrl} target="_blank" rel="noopener" className="mt-3 flex items-center gap-2 break-all text-lg font-semibold text-ink hover:text-accent">
                      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-ok" />
                      {state.liveUrl.replace('https://', '')}
                    </a>
                    <p className="font-mono mt-3 text-[12px] text-muted">
                      {state.liveSha?.slice(0, 7)} · deployed {ago(state.liveSince)}
                    </p>
                    {running && <p className="mt-3 text-sm text-muted">This version keeps serving until the new one is up.</p>}
                  </>
                ) : (
                  <p className="mt-3 text-[15px] text-muted">
                    {running ? 'Appears here as soon as the first deploy finishes.' : 'No deploy recorded yet.'}
                  </p>
                )}
              </div>
              {error && <p className="mt-3 text-sm text-warn">{error}</p>}
              <p className="mt-4 text-xs leading-relaxed text-muted">
                Read straight from GitHub's public API in your browser. Refreshes every few seconds while a deploy runs.
              </p>
            </aside>
          </div>
        )}
      </div>
    </section>
  )
}
