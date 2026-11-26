import { useState } from 'react'
import { useSession } from '../lib/github/client.ts'
import { initialSteps, oneClickDeploy, type Step } from '../lib/github/deploy.ts'
import { ReportLink } from './Report'
import { href } from '../lib/route'

const ICON: Record<Step['state'], string> = { todo: '', doing: '', done: '✓', skip: '–', error: '✕' }

export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="divide-y divide-line/70 border border-line bg-white">
      {steps.map((s) => (
        <li key={s.id} className="flex gap-3 px-4 py-3">
          <span
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] text-white ${
              s.state === 'done' ? 'bg-ok' : s.state === 'error' ? 'bg-[#e0453a]' : s.state === 'skip' ? 'border border-line text-muted' : s.state === 'doing' ? 'bg-accent' : 'border border-line'
            }`}
          >
            {s.state === 'doing' ? <span className="h-2 w-2 animate-ping rounded-full bg-white" /> : ICON[s.state]}
          </span>
          <span className="min-w-0">
            <span className={`block text-[15px] ${s.state === 'todo' ? 'text-muted' : 'text-ink'}`}>{s.label}</span>
            {s.note && <span className={`mt-0.5 block text-sm ${s.state === 'error' ? 'text-[#b3302a]' : 'text-muted'}`}>{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function OneClick({ owner, repo, branch, yaml, disabled }: { owner: string; repo: string; branch: string; yaml: string; disabled?: boolean }) {
  const session = useSession()
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [state, setState] = useState<'idle' | 'running' | 'ok' | 'error'>('idle')
  if (!session) return null

  const go = async () => {
    setState('running')
    setSteps(initialSteps())
    const res = await oneClickDeploy({ owner, repo, branch, yaml, token: session.token }, setSteps)
    setState(res.ok ? 'ok' : 'error')
    if (res.ok) setTimeout(() => (window.location.hash = href.track(owner, repo)), 1200)
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={go}
          disabled={disabled || state === 'running'}
          className="border border-accent bg-accent px-6 py-3.5 font-semibold text-white transition-colors hover:bg-[#7d4ff0] disabled:opacity-60"
        >
          {state === 'running' ? 'Deploying…' : state === 'error' ? 'Try again' : `Deploy ${repo} →`}
        </button>
        <span className="text-sm text-muted">
          Commits one file to <span className="font-mono text-ink2">{branch}</span>. Every later push redeploys by itself.
        </span>
      </div>
      {steps && <StepList steps={steps} />}
      {state === 'ok' && <p className="text-[15px] text-[#13804a]">Started — opening the tracker…</p>}
      {state === 'error' && steps && (
        <p className="text-[13px] text-muted">
          Stuck even after following that? <ReportLink preset={{ error: steps.find((s) => s.state === 'error')?.note, details: [`Repo: ${owner}/${repo}`, `Failed step: ${steps.find((s) => s.state === 'error')?.label ?? '?'}`] }} />
        </p>
      )}
    </div>
  )
}
