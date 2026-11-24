import { useEffect, useMemo, useState } from 'react'
import { useSession } from '../lib/github/client.ts'
import { createFromTemplate, createSteps } from '../lib/github/create.ts'
import type { Step } from '../lib/github/deploy.ts'
import { href } from '../lib/route'
import { fillTemplate, SITE_NAME, TEMPLATES, type Template } from '../lib/templates.ts'
import { generateWorkflow, normalizeAppName } from '../lib/workflow.ts'
import { ConnectGitHub } from '../components/Connect'
import { StepList } from '../components/OneClick'

// Little CSS sketches of each starter, so the cards show what you get.
function Sketch({ id }: { id: Template['id'] }) {
  if (id === 'page')
    return (
      <div className="flex h-full flex-col justify-center gap-2 bg-[#fbfaff] px-6">
        <span className="h-2 w-10 rounded bg-accent/70" />
        <span className="h-5 w-32 rounded bg-ink" />
        <span className="h-2 w-40 rounded bg-muted/40" />
        <span className="h-2 w-28 rounded bg-muted/40" />
        <span className="mt-2 flex gap-2"><span className="h-5 w-14 border border-accent" /><span className="h-5 w-16 border border-accent" /></span>
      </div>
    )
  if (id === 'react')
    return (
      <div className="flex h-full flex-col justify-center gap-2 bg-[radial-gradient(120px_60px_at_85%_0%,#ece4ff,transparent)] px-6">
        <span className="h-3 w-24 rounded-full border border-accent/40" />
        <span className="h-5 w-36 rounded bg-ink" />
        <span className="h-2 w-40 rounded bg-muted/40" />
        <span className="mt-2 h-6 w-28 bg-accent" />
      </div>
    )
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 bg-[#fffdf8] px-6">
      <span className="h-4 w-28 rounded bg-ink" />
      {[0, 1, 2].map((i) => (
        <span key={i} className="flex flex-col gap-1 border-t border-[#ece7dc] pt-2">
          <span className="h-2 w-32 rounded bg-ink/70" />
          <span className="h-1.5 w-14 rounded bg-muted/40" />
        </span>
      ))}
    </div>
  )
}

export function NewSite({ initial }: { initial?: string }) {
  const session = useSession()
  const [tplId, setTplId] = useState<Template['id']>((TEMPLATES.find((t) => t.id === initial)?.id ?? 'page') as Template['id'])
  const tpl = TEMPLATES.find((t) => t.id === tplId)!
  const [name, setName] = useState('my-site')
  const [files, setFiles] = useState<Record<string, string> | null>(null)
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [state, setState] = useState<'idle' | 'running' | 'ok' | 'error'>('idle')

  // load the chosen template's files (a lazy chunk) as soon as it's picked
  useEffect(() => {
    let alive = true
    setFiles(null)
    import('../lib/templateFiles.ts').then((m) => m.loadTemplateFiles(tplId)).then((f) => alive && setFiles(f))
    return () => {
      alive = false
    }
  }, [tplId])

  const valid = SITE_NAME.test(name)
  const owner = session?.viewer.login
  const newRepoUrl = useMemo(() => {
    const q = new URLSearchParams({ name, description: `${tpl.name} — live on ms.computer, deployed by Shipyard`, visibility: 'public', owner: '@me' })
    return `https://github.com/new?${q}`
  }, [name, tpl.name])

  const go = async () => {
    if (!session || !files || !valid) return
    setState('running')
    setSteps(createSteps())
    const res = await createFromTemplate(
      {
        owner: session.viewer.login,
        repo: name,
        token: session.token,
        makeFiles: (branch) => {
          const filled = fillTemplate(files, { owner: session.viewer.login, repo: name })
          filled['.github/workflows/ms-computer.yml'] = generateWorkflow({ ...tpl.config, appName: name, branch })
          return filled
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
        <a href={href.home} className="text-sm text-muted hover:text-accent">← Shipyard</a>
        <div className="mt-6 max-w-[760px]">
          <span className="eyebrow">Templates</span>
          <h1 className="font-display mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-medium leading-[1.02] tracking-[-0.035em]">
            No project yet? Start one that’s already live.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Pick a starter. Shipyard puts it in a new repo in your GitHub account, wired to deploy — about three minutes
            later it’s on ms.computer, and every push after that updates it.
          </p>
        </div>

        {/* 1 — pick */}
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTplId(t.id)}
              aria-pressed={t.id === tplId}
              className={`group overflow-hidden border text-left transition-all ${t.id === tplId ? 'border-accent shadow-[0_0_0_3px_rgba(143,99,255,0.18)]' : 'border-line hover:border-ink/30'}`}
            >
              <div className="h-36 border-b border-line">
                <Sketch id={t.id} />
              </div>
              <div className="bg-white p-5">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold">{t.name}</span>
                  <span className={`grid h-5 w-5 place-items-center rounded-full border text-[11px] ${t.id === tplId ? 'border-accent bg-accent text-white' : 'border-line'}`}>{t.id === tplId ? '✓' : ''}</span>
                </div>
                <p className="font-mono mt-1 text-[12px] uppercase tracking-[0.1em] text-accent">{t.stack}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{t.blurb}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <ol className="space-y-8">
            <li>
              <h3 className="font-display text-[1.35rem] font-semibold"><span className="font-mono mr-2 text-accent">1</span>Name it and create the empty repo</h3>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center border border-line bg-white focus-within:border-accent">
                  <span className="font-mono pl-3 text-sm text-muted">{owner ?? 'you'}/</span>
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
                {valid ? (
                  <>GitHub opens with the name filled in — just press <em>Create repository</em>. Site address: <span className="font-mono text-ink2">{normalizeAppName(name)}-•••••.ms.computer</span></>
                ) : (
                  <span className="text-[#b3302a]">Use letters, numbers, dots, dashes or underscores.</span>
                )}
              </p>
            </li>
            <li>
              <h3 className="font-display text-[1.35rem] font-semibold"><span className="font-mono mr-2 text-accent">2</span>Connect GitHub</h3>
              <p className="mb-3 mt-1 text-sm text-muted">Give the token access to the new repo (or to all repos if you plan to make several).</p>
              <ConnectGitHub title="Paste a token" compact />
            </li>
            <li>
              <h3 className="font-display text-[1.35rem] font-semibold"><span className="font-mono mr-2 text-accent">3</span>Create and deploy</h3>
              <button
                type="button"
                onClick={go}
                disabled={!session || !files || !valid || state === 'running' || state === 'ok'}
                className="mt-3 border border-accent bg-accent px-6 py-3.5 font-semibold text-white transition-colors hover:bg-[#7d4ff0] disabled:opacity-50"
              >
                {state === 'running' ? 'Creating…' : state === 'error' ? 'Try again' : `Create ${tpl.name.toLowerCase()} in ${owner ?? 'your account'}/${name} →`}
              </button>
              {steps && <div className="mt-4"><StepList steps={steps} /></div>}
              {state === 'ok' && <p className="mt-3 text-[15px] text-[#13804a]">Done — opening the tracker for the first deploy…</p>}
            </li>
          </ol>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="border border-line bg-bg2 p-5">
              <h4 className="font-semibold">What goes in the repo</h4>
              {files ? (
                <ul className="font-mono mt-3 space-y-1 text-[12.5px] text-ink2">
                  {[...Object.keys(files).map((f) => (f === 'gitignore' ? '.gitignore' : f)), '.github/workflows/ms-computer.yml'].sort().map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted">Loading…</p>
              )}
              <p className="mt-4 text-sm text-muted">Then edit <span className="font-mono text-ink2">{tpl.edit}</span> and push — that’s the whole workflow.</p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}
