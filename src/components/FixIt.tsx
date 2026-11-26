import { useEffect, useState, type ReactNode } from 'react'
import type { Report } from '../lib/checker/types.ts'
import { diffLines, type FileChange, type Fix } from '../lib/fixes.ts'
import { explain, useSession } from '../lib/github/client.ts'
import { openFixPr } from '../lib/github/fixpr.ts'
import { readRepoFile } from '../lib/checker/github.ts'
import { ReportLink } from './Report'
import { ConnectGitHub } from './Connect'

/** Reads a file at the checked commit for the preview (the PR itself re-reads at the newest commit). */
const rawRead = (r: Report) => (path: string) => readRepoFile(r.repo, path)

function Diff({ c }: { c: FileChange }) {
  const lines = diffLines(c.before, c.after)
  const label = c.after === null ? 'deleted' : c.before === null ? 'new file' : 'changed'
  return (
    <div className="border border-line">
      <div className="font-mono flex items-center justify-between gap-2 border-b border-line bg-bg2 px-3 py-1.5 text-[12px]">
        <span className="truncate text-ink2">{c.path}</span>
        <span className={c.after === null ? 'text-[#b3302a]' : 'text-muted'}>{label}</span>
      </div>
      {c.after === null ? (
        <p className="px-3 py-2 text-[12.5px] text-muted">The whole file is removed{c.before ? ` (${c.before.split('\n').length} lines — not shown here)` : ''}.</p>
      ) : (
        <pre className="font-mono max-h-[260px] overflow-auto text-[12px] leading-relaxed" data-lenis-prevent>
          {lines.map((l, i) => (
            <div key={i} className={l.kind === '+' ? 'bg-[#e9f9ef] text-[#13643a]' : l.kind === '-' ? 'bg-[#fdecea] text-[#9d2b25]' : 'text-muted'}>
              <span className="inline-block w-5 select-none pl-1.5">{l.kind === ' ' ? '' : l.kind}</span>
              {l.text || ' '}
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}

/** "Fix it for me": preview the exact change, then open it as a pull request. */
export function FixIt({
  fix,
  report,
  showHeader = true,
  label = 'Fix it for me →',
  beforePr,
  done,
}: {
  fix: Fix
  report: Report
  showHeader?: boolean
  label?: string
  /** runs with the token before the PR is opened (e.g. saving the setup secret a move needs) */
  beforePr?: (token: string) => Promise<void>
  /** what to say once the PR is open */
  done?: ReactNode
}) {
  const session = useSession()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<FileChange[] | null>(null)
  const [state, setState] = useState<{ kind: 'idle' | 'busy' } | { kind: 'done'; url: string; number: number } | { kind: 'error'; text: string }>({ kind: 'idle' })

  useEffect(() => {
    if (!open || preview) return
    fix.build(rawRead(report)).then(setPreview, () => setPreview([]))
  }, [open, preview, fix, report])

  const go = async () => {
    if (!session) return
    setState({ kind: 'busy' })
    try {
      if (beforePr) await beforePr(session.token)
      const r = await openFixPr({ owner: report.repo.owner, repo: report.repo.repo, branch: report.repo.branch, token: session.token, fix })
      setState({ kind: 'done', url: r.url, number: r.number })
    } catch (e) {
      setState({ kind: 'error', text: explain(e, 'open a pull request here (it needs Contents and Pull requests: write on this repo)') })
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 border border-accent bg-accent px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#7d4ff0]">
        {label}
      </button>
    )
  }
  return (
    <div className="space-y-3 border border-accent/40 bg-white p-4">
      {showHeader && (
        <div>
          <p className="font-semibold text-ink">{fix.title}</p>
          <p className="mt-1 text-[14px] text-muted">{fix.summary}</p>
        </div>
      )}
      {fix.warning && <p className="border-l-2 border-[#e0453a] pl-3 text-[14px] text-[#9d2b25]">{fix.warning}</p>}
      {preview === null && <p className="text-[13px] text-muted">Preparing the change…</p>}
      {preview && preview.length === 0 && <p className="text-[13px] text-muted">The preview couldn’t read the files — the pull request reads them itself.</p>}
      {preview && preview.map((c) => <Diff key={c.path} c={c} />)}

      {state.kind === 'done' ? (
        <p className="border border-ok/40 bg-[#f3fbf6] px-4 py-3 text-[14px]">
          Opened{' '}
          <a href={state.url} target="_blank" rel="noopener" className="font-semibold text-accent underline underline-offset-4">
            pull request #{state.number} ↗
          </a>
          . {done ?? 'Review and merge it on GitHub, then check the repo again.'}
        </p>
      ) : session ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={go} disabled={state.kind === 'busy'} className="border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#7d4ff0] disabled:opacity-60">
            {state.kind === 'busy' ? 'Opening…' : 'Open a pull request'}
          </button>
          <span className="text-[13px] text-muted">On a new branch — nothing changes in {report.repo.branch} until you merge it.</span>
        </div>
      ) : (
        <ConnectGitHub owner={report.repo.owner} title="Connect GitHub to open this as a pull request" compact />
      )}
      {state.kind === 'error' && (
        <p className="text-[14px] text-[#b3302a]">
          {state.text} <ReportLink preset={{ error: state.text, details: [`Repo: ${report.repo.owner}/${report.repo.repo}`, `Fix: ${fix.id}`] }} className="text-[#b3302a]" />
        </p>
      )}
    </div>
  )
}
