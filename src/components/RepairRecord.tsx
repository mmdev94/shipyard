import { useState } from 'react'
import { explain, useSession } from '../lib/github/client.ts'
import { repairRecord } from '../lib/github/sites.ts'
import { href } from '../lib/route'

/**
 * The site went live but GitHub's API failed while recording which deployment
 * it is. Without that, the next update can't replace it. One redeploy that
 * replaces exactly that deployment fixes it, and records it.
 */
export function RepairRecord({ owner, repo, depId: known, logUrl, onStarted }: { owner: string; repo: string; depId: string | null; logUrl: string; onStarted: () => void }) {
  const session = useSession()
  const [dep, setDep] = useState(known ?? '')
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'done' } | { kind: 'error'; text: string }>({ kind: 'idle' })
  const go = async () => {
    if (!session) return
    setState({ kind: 'busy' })
    try {
      await repairRecord(owner, repo, dep.trim(), session.token)
      setState({ kind: 'done' })
      onStarted()
    } catch (e) {
      setState({ kind: 'error', text: explain(e, 'start a run (it needs the Actions permission)') })
    }
  }
  return (
    <div className="border border-[#ecd9b3] bg-[#fffbf2] p-5">
      <p className="font-semibold text-[#8f6113]">The site is live, but this deploy wasn’t recorded</p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink2">
        GitHub’s API failed for a moment while saving which deployment went live. The next update needs it to replace the
        old version. One repair run fixes that: it redeploys, replacing exactly this deployment, and records it.
      </p>
      {!known && (
        <p className="mt-2 text-[13px] text-muted">
          Find the id in the run’s{' '}
          <a href={logUrl} target="_blank" rel="noopener" className="text-accent underline underline-offset-2">
            Deploy step log ↗
          </a>{' '}
          — the last line that reads “Deployment: dep_…”.
        </p>
      )}
      {state.kind === 'done' ? (
        <p className="mt-3 text-[14px] font-semibold text-[#13804a]">Repair run started — follow it above.</p>
      ) : session ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={dep}
            onChange={(e) => setDep(e.target.value)}
            placeholder="dep_…"
            spellCheck={false}
            aria-label="Deployment id"
            className="font-mono min-w-0 flex-1 border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          <button type="button" onClick={go} disabled={state.kind === 'busy' || !dep.trim()} className="border border-accent bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#7d4ff0] disabled:opacity-60">
            {state.kind === 'busy' ? 'Starting…' : 'Repair'}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted">
          <a href={href.sites} className="font-semibold text-accent underline underline-offset-4">Connect GitHub</a> to repair it in
          one click — or run the workflow from the Actions tab with <code className="font-mono">replace_deployment</code> set to that id.
        </p>
      )}
      {state.kind === 'error' && <p className="mt-2 text-[13px] text-[#b3302a]">{state.text}</p>}
    </div>
  )
}
