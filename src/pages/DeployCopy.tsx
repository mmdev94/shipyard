import { useEffect, useMemo, useState } from 'react'
import { BackLink } from '../components/BackLink'
import { ConnectGitHub } from '../components/Connect'
import { StepList } from '../components/OneClick'
import { ReportLink } from '../components/Report'
import { checkSnapshot, type Report } from '../lib/checker/index.ts'
import { fetchSnapshot } from '../lib/checker/github.ts'
import { useSession } from '../lib/github/client.ts'
import { copyConfig, copyFiles, planCopy, type CopyPlan, type SourceEntry } from '../lib/github/copy.ts'
import { createFromTemplate, createSteps } from '../lib/github/create.ts'
import type { Step } from '../lib/github/deploy.ts'
import { href } from '../lib/route'
import { SITE_NAME } from '../lib/templates.ts'
import { WORKFLOW_PATH } from '../lib/setup.ts'
import { publicGet } from '../lib/track.ts'
import { generateWorkflow, normalizeAppName } from '../lib/workflow.ts'

interface Meta {
  name: string
  owner: { login: string; avatar_url: string }
  description: string | null
  default_branch: string
  private?: boolean
  stargazers_count: number
  license: { spdx_id: string; name: string } | null
  html_url: string
}

interface Source {
  meta: Meta
  report: Report
  plan: CopyPlan
  workflow: string | null
}

async function loadSource(owner: string, repo: string): Promise<Source> {
  const meta = await publicGet<Meta>(`/repos/${owner}/${repo}`).catch((e) => {
    throw (e as { status?: number }).status === 404 ? new Error(`There’s no public repo ${owner}/${repo}. The button only copies public repos — check the link with whoever shared it.`) : e
  })
  if (meta.private) throw new Error(`${owner}/${repo} is private, so it can’t be copied with this button. Its owner can make it public, or deploy it with Shipyard directly.`)
  const o = meta.owner.login
  const snap = await fetchSnapshot({ owner: o, repo: meta.name }, fetch, { owner: o, repo: meta.name, branch: meta.default_branch })
  const [report, tree, workflow] = await Promise.all([
    checkSnapshot(snap),
    publicGet<{ tree: SourceEntry[]; truncated: boolean }>(`/repos/${o}/${meta.name}/git/trees/${snap.commit}?recursive=1`),
    snap.read(WORKFLOW_PATH),
  ])
  return { meta, report, workflow, plan: planCopy(o, meta.name, snap.commit!, tree.tree, tree.truncated) }
}

const mb = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`)

export function DeployCopy({ owner, repo }: { owner: string; repo: string }) {
  const session = useSession()
  const [source, setSource] = useState<Source | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState(repo)
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [state, setState] = useState<'idle' | 'running' | 'ok' | 'error'>('idle')

  useEffect(() => {
    let alive = true
    loadSource(owner, repo).then(
      (s) => alive && setSource(s),
      (e) => alive && setError((e as Error).message),
    )
    return () => {
      alive = false
    }
  }, [owner, repo])

  const valid = SITE_NAME.test(name)
  const me = session?.viewer.login
  const title = `${owner}/${repo}`
  const newRepoUrl = useMemo(() => {
    const q = new URLSearchParams({ name, description: `My copy of ${title}, live on ms.computer`, visibility: 'public', owner: '@me' })
    return `https://github.com/new?${q}`
  }, [name, title])
  const v = source?.report.verdict.kind
  const deployable = source && v !== 'unsupported' && source.report.detection.workflowSupported
  const ownRepo = me && source && me.toLowerCase() === source.meta.owner.login.toLowerCase() && name.toLowerCase() === source.meta.name.toLowerCase()

  const go = async () => {
    if (!session || !source || !valid || ownRepo) return
    const { plan, report, workflow } = source
    const label = `Copy ${plan.owner}/${plan.repo} (${plan.files.length} files) and add its workflow`
    setState('running')
    setSteps(createSteps(label))
    const res = await createFromTemplate(
      {
        owner: session.viewer.login,
        repo: name,
        token: session.token,
        commitLabel: label,
        commitMessage: `Copy ${plan.owner}/${plan.repo}@${plan.commit.slice(0, 7)} and add its ms.computer deploy workflow (Shipyard)\n\nFrom https://github.com/${plan.owner}/${plan.repo}/tree/${plan.commit}`,
        makeFiles: async (branch, tools) => {
          const files = await copyFiles(plan, tools)
          files[WORKFLOW_PATH] = generateWorkflow(copyConfig(report, workflow, name, branch))
          return files
        },
      },
      setSteps,
    )
    setState(res.ok ? 'ok' : 'error')
    if (res.ok) setTimeout(() => (window.location.hash = href.track(session.viewer.login, name)), 1500)
  }

  return (
    <section className="px-6 py-14 md:px-14 md:py-20">
      <div className="mx-auto max-w-shell">
        <BackLink />
        <div className="mt-6 max-w-[780px]">
          <span className="eyebrow">Deploy to Ms. Computer</span>
          <h1 className="font-display mt-4 text-[clamp(2.1rem,4.8vw,3.6rem)] font-medium leading-[1.03] tracking-[-0.035em]">
            Get your own copy of <span className="text-accent">{repo}</span>, live on ms.computer.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Shipyard copies <span className="font-mono text-[0.9em] text-ink2">{title}</span> into a new repo in your GitHub
            account, wired to deploy — a few minutes later it has its own address, and every push you make updates it.
            Everything runs in your browser.
          </p>
        </div>

        {error && (
          <div className="mt-10 max-w-[780px] border border-[#f1c2bd] bg-[#fff6f5] p-5 text-[#b3302a]">
            {error} <ReportLink preset={{ error, details: [`Source: ${title}`] }} className="text-[#b3302a]" />
          </div>
        )}
        {!error && !source && <p className="mt-10 text-muted">Reading {title} from GitHub and checking it…</p>}

        {source && !deployable && (
          <div className="mt-10 max-w-[780px] border border-line bg-bg2 p-6">
            <h2 className="text-xl font-semibold">This project can’t be deployed in one go yet.</h2>
            <p className="mt-2 text-muted">
              {v === 'unsupported'
                ? source.report.verdict.summary
                : `It’s ${source.report.detection.frameworkLabel}, which Shipyard’s workflow doesn’t build yet (Node, Python and Go apps and plain HTML only).`}
            </p>
            <a href={href.check(source.meta.owner.login, source.meta.name)} className="mt-5 inline-block border border-accent bg-accent px-5 py-3 font-semibold text-white hover:bg-[#7d4ff0]">
              See the full check →
            </a>
          </div>
        )}

        {source && deployable && (
          <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
            <ol className="space-y-8">
              <li>
                <h3 className="font-display text-[1.35rem] font-semibold"><span className="font-mono mr-2 text-accent">1</span>Name your copy and create the empty repo</h3>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center border border-line bg-white focus-within:border-accent">
                    <span className="font-mono pl-3 text-sm text-muted">{me ?? 'you'}/</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value.replace(/\s+/g, '-'))}
                      spellCheck={false}
                      aria-label="Repository name"
                      className="font-mono min-w-0 flex-1 bg-transparent px-1 py-2.5 text-[14px] outline-none"
                    />
                  </div>
                  <a
                    href={valid ? newRepoUrl : undefined}
                    target="_blank"
                    rel="noopener"
                    aria-disabled={!valid}
                    className={`border px-4 py-2.5 text-center text-sm font-semibold ${valid ? 'border-ink bg-ink text-white hover:bg-ink2' : 'pointer-events-none border-line text-muted'}`}
                  >
                    Create it on GitHub ↗
                  </a>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {!valid ? (
                    <span className="text-[#b3302a]">Use letters, numbers, dots, dashes or underscores.</span>
                  ) : ownRepo ? (
                    <span className="text-[#b3302a]">That’s the original itself — pick a new name for the copy.</span>
                  ) : (
                    <>GitHub opens with the name filled in — just press <em>Create repository</em>. Address: <span className="font-mono text-ink2">{normalizeAppName(name)}-•••••.ms.computer</span></>
                  )}
                </p>
              </li>
              <li>
                <h3 className="font-display text-[1.35rem] font-semibold"><span className="font-mono mr-2 text-accent">2</span>Connect GitHub</h3>
                <p className="mb-3 mt-1 text-sm text-muted">Give the token access to your new repo. It can’t create, delete or rename repos — that’s why step 1 happens on GitHub.</p>
                <ConnectGitHub title="Paste a token" compact />
              </li>
              <li>
                <h3 className="font-display text-[1.35rem] font-semibold"><span className="font-mono mr-2 text-accent">3</span>Copy and deploy</h3>
                <button
                  type="button"
                  onClick={go}
                  disabled={!session || !valid || Boolean(ownRepo) || state === 'running' || state === 'ok'}
                  className="mt-3 border border-accent bg-accent px-6 py-3.5 font-semibold text-white transition-colors hover:bg-[#7d4ff0] disabled:opacity-50"
                >
                  {state === 'running' ? 'Copying…' : state === 'error' ? 'Try again' : me ? `Copy into ${me}/${name} and deploy →` : 'Copy and deploy →'}
                </button>
                {steps && <div className="mt-4"><StepList steps={steps} /></div>}
                {state === 'ok' && <p className="mt-3 text-[15px] text-[#13804a]">Done — opening the tracker for the first deploy…</p>}
                {state === 'error' && (
                  <p className="mt-3 text-[13px] text-muted">
                    Stuck? <ReportLink preset={{ error: steps?.find((s) => s.state === 'error')?.note, details: [`Source: ${title}`, `Copy: ${me ?? '?'}/${name}`] }} />
                  </p>
                )}
              </li>
            </ol>

            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <div className="border border-line bg-white p-5">
                <div className="flex items-center gap-3">
                  <img src={source.meta.owner.avatar_url} alt="" className="h-9 w-9 rounded-full border border-line" />
                  <div className="min-w-0">
                    <a href={source.meta.html_url} target="_blank" rel="noopener" className="font-mono block truncate text-[13px] font-semibold text-ink hover:text-accent">{title} ↗</a>
                    <span className="text-[12px] text-muted">
                      {source.report.detection.frameworkLabel} · {source.report.detection.mode === 'static' ? 'static site' : 'server app'}
                      {source.meta.stargazers_count > 0 && ` · ★ ${source.meta.stargazers_count}`}
                    </span>
                  </div>
                </div>
                {source.meta.description && <p className="mt-3 text-[14px] leading-relaxed text-muted">{source.meta.description}</p>}
                <p className="mt-3 text-[13px] text-ink2">
                  <span className="font-semibold">{source.report.verdict.title}</span>{' '}
                  <a href={href.check(source.meta.owner.login, source.meta.name)} className="text-accent underline underline-offset-2">full check</a>
                </p>
              </div>
              <div className="border border-line bg-bg2 p-5 text-[13.5px]">
                <h4 className="font-semibold">What’s copied</h4>
                <p className="mt-2 text-muted">
                  {source.plan.files.length} files ({mb(source.plan.bytes)}) at commit{' '}
                  <span className="font-mono text-ink2">{source.plan.commit.slice(0, 7)}</span>, plus a fresh deploy workflow
                  {source.workflow ? ' using the original’s Shipyard settings' : ''}. Your copy gets its own app and address.
                </p>
                {source.plan.skipped.length > 0 && (
                  <details className="mt-2 text-muted">
                    <summary className="cursor-pointer text-ink2">Left out ({source.plan.skipped.length})</summary>
                    <ul className="mt-1.5 space-y-1">
                      {source.plan.skipped.slice(0, 20).map((s) => (
                        <li key={s.path}><span className="font-mono text-[12px] text-ink2">{s.path}</span> — {s.why}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <p className="mt-3 text-muted">
                  {source.meta.license && source.meta.license.spdx_id !== 'NOASSERTION'
                    ? <>License: <span className="font-semibold text-ink2">{source.meta.license.name}</span> — the copy keeps it; follow its terms.</>
                    : <>No license is listed. Fine for trying it out — ask the author before using it for more.</>}
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </section>
  )
}
