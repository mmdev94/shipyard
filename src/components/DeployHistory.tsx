import { useEffect, useState } from 'react'
import { explain, useSession } from '../lib/github/client.ts'
import { rollback } from '../lib/github/sites.ts'
import { loadHistory, type History } from '../lib/track'
import { href } from '../lib/route'

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/**
 * Every deploy on record, newest first, with "Roll back to this" on the ones
 * that aren't live. Reloads whenever the tracker sees a run start or finish.
 */
export function DeployHistory({
  owner,
  repo,
  branch,
  refreshKey,
  busyRun,
  onStarted,
}: {
  owner: string
  repo: string
  branch: string | null
  /** changes when a run starts or finishes */
  refreshKey: string
  /** a run is in progress: no new roll back until it's done */
  busyRun: boolean
  onStarted: () => void
}) {
  const session = useSession()
  const [history, setHistory] = useState<History | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    loadHistory(owner, repo, branch)
      .then((h) => alive && (setHistory(h), setError('')))
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
  }, [owner, repo, branch, refreshKey])

  if (error && !history) return null
  if (!history || history.records.length === 0) return null

  const live = history.records.find((r) => r.live)
  const rolledBack = live && history.headSha && live.sha !== history.headSha
  const seen = new Set<string>()

  const go = async (sha: string, label: string) => {
    if (!session) return
    if (!window.confirm(`Roll ${repo} back to ${sha.slice(0, 7)}${label ? ` — “${label}”` : ''}?\n\nThe site serves that commit until the next push to ${branch ?? 'the branch'}, which deploys the latest again.`)) return
    setPending(sha)
    setMsg({ ok: true, text: 'Starting the roll back…' })
    try {
      await rollback(owner, repo, sha, session.token)
      setMsg({ ok: true, text: `Rolling back to ${sha.slice(0, 7)} — follow it above.` })
      onStarted()
    } catch (e) {
      setMsg({ ok: false, text: explain(e, 'start a run (it needs the Actions permission)') })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <h2 className="font-semibold">Deploy history</h2>
        {rolledBack && (
          <span className="rounded-full bg-[#fff3dc] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#8f6113]">
            rolled back · next push deploys the latest
          </span>
        )}
      </div>
      <ol className="divide-y divide-line/70">
        {history.records.map((r) => {
          const first = !seen.has(r.sha)
          seen.add(r.sha)
          const canRollBack = first && !r.live && r.sha !== live?.sha
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.live ? 'bg-ok' : r.takenDown ? 'bg-[#e0453a]' : 'bg-line'}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px]">
                  <a href={`https://github.com/${owner}/${repo}/commit/${r.sha}`} target="_blank" rel="noopener" className="font-mono mr-2 text-[13px] text-accent hover:underline">
                    {r.sha.slice(0, 7)}
                  </a>
                  {r.message ?? <span className="text-muted">commit not on {branch ?? 'the branch'}</span>}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {ago(r.at)}
                  {r.author && ` · ${r.author}`}
                  {r.rollback && ' · roll back'}
                  {r.live && ' · live now'}
                  {r.takenDown && ' · taken down'}
                </p>
              </div>
              {canRollBack && session && (
                <button
                  type="button"
                  disabled={!!pending || busyRun}
                  onClick={() => go(r.sha, r.message ?? '')}
                  title={busyRun ? 'Wait for the current run to finish' : undefined}
                  className="border border-line px-3 py-1.5 text-[13px] font-semibold text-ink2 transition-colors hover:border-ink/30 disabled:opacity-50"
                >
                  {pending === r.sha ? 'Starting…' : 'Roll back to this'}
                </button>
              )}
            </li>
          )
        })}
      </ol>
      {msg && <p className={`border-t border-line px-5 py-3 text-[13px] ${msg.ok ? 'text-[#13804a]' : 'text-[#b3302a]'}`}>{msg.text}</p>}
      {!session && history.records.length > 1 && (
        <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
          <a href={href.sites} className="font-semibold text-accent underline underline-offset-4">Connect GitHub</a> to roll back to any
          earlier deploy in one click.
        </p>
      )}
    </div>
  )
}
