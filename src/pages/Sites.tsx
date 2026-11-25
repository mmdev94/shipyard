import { BackLink } from '../components/BackLink'
import { useCallback, useEffect, useState } from 'react'
import { explain, useSession } from '../lib/github/client.ts'
import { canUpdateInPlace, dispatch, hasActions, loadSites, needsUpdate, updateWorkflow, type Site } from '../lib/github/sites.ts'
import { href, parseRoute } from '../lib/route'
import { ConnectGitHub } from '../components/Connect'

function ago(iso: string | null): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

function RunBadge({ run }: { run: Site['run'] }) {
  if (!run) return <span className="text-muted">never run</span>
  const running = run.status !== 'completed'
  const tone = running ? 'bg-accent' : run.conclusion === 'success' ? 'bg-ok' : run.conclusion === 'failure' ? 'bg-[#e0453a]' : 'bg-muted'
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${tone} ${running ? 'animate-pulse' : ''}`} />
      {running ? 'deploying' : run.conclusion} · <span className="font-mono">{run.sha.slice(0, 7)}</span> · {ago(run.at)}
    </span>
  )
}

function SiteCard({ site, token }: { site: Site; token: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // every action starts a workflow run — once GitHub lists it, open the
  // tracker on it (Back returns here)
  const act = async (label: string, fn: () => Promise<number | null>) => {
    setBusy(label)
    setMsg({ ok: true, text: 'Started — opening the tracker as soon as GitHub lists the run…' })
    try {
      await fn()
      // unless they've moved on to another page meanwhile
      if (parseRoute(window.location.hash).page === 'sites') window.location.hash = href.track(site.owner, site.repo)
      else setBusy(null)
    } catch (e) {
      setMsg({ ok: false, text: explain(e, 'do that (it needs the Actions and Contents permissions)') })
      setBusy(null)
    }
  }
  const takeDown = () => {
    if (!window.confirm(`Take ${site.repo} offline?\n\nThe address stays reserved for it — Redeploy or any push brings it back.`)) return
    act('down', () => dispatch(site, 'take-down', token))
  }
  const btn = 'border px-3 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50'

  return (
    <article className="flex flex-col border border-line bg-white">
      <div className="border-b border-line p-5">
        <div className="flex items-start justify-between gap-3">
          <a href={site.htmlUrl} target="_blank" rel="noopener" className="min-w-0 truncate text-lg font-semibold hover:text-accent">
            {site.repo}
          </a>
          {needsUpdate(site) && <span className="shrink-0 rounded-full bg-accentSoft px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-accent2">update</span>}
        </div>
        {site.liveUrl ? (
          <a href={site.liveUrl} target="_blank" rel="noopener" className="mt-2 flex items-center gap-2 break-all text-[14px] text-ink2 hover:text-accent">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-ok" /> {site.liveUrl.replace('https://', '')}
          </a>
        ) : (
          <p className="mt-2 text-[14px] text-muted">{site.takenDown ? 'Taken down — the address is still reserved.' : 'Not live yet.'}</p>
        )}
        <p className="mt-3 text-[13px] text-muted">
          <RunBadge run={site.run} />
        </p>
      </div>
      <div className="mt-auto flex flex-wrap gap-2 p-4">
        <a href={href.track(site.owner, site.repo)} className={`${btn} border-accent bg-accent text-white hover:bg-[#7d4ff0]`}>Track</a>
        <button type="button" disabled={!!busy} onClick={() => act('deploy', () => dispatch(site, 'deploy', token))} className={`${btn} border-line hover:border-ink/30`}>
          {busy === 'deploy' ? 'Starting…' : 'Redeploy'}
        </button>
        {canUpdateInPlace(site) && (
          <button type="button" disabled={!!busy} onClick={() => act('update', () => updateWorkflow(site, token))} className={`${btn} border-line hover:border-ink/30`}>
            {busy === 'update' ? 'Updating…' : 'Update workflow'}
          </button>
        )}
        {needsUpdate(site) && !canUpdateInPlace(site) && (
          <a href={href.check(site.owner, site.repo)} className={`${btn} border-line hover:border-ink/30`}>Re-check to update</a>
        )}
        {site.liveUrl && hasActions(site) && (
          <button type="button" disabled={!!busy} onClick={takeDown} className={`${btn} ml-auto border-[#f1c2bd] text-[#b3302a] hover:bg-[#fff6f5]`}>
            {busy === 'down' ? 'Starting…' : 'Take down'}
          </button>
        )}
      </div>
      {msg && <p className={`border-t border-line px-4 py-3 text-[13px] ${msg.ok ? 'text-[#13804a]' : 'text-[#b3302a]'}`}>{msg.text}</p>}
    </article>
  )
}

export function Sites() {
  const session = useSession()
  const [sites, setSites] = useState<Site[] | null>(null)
  const [error, setError] = useState('')
  const token = session?.token

  const load = useCallback(async () => {
    if (!token) return
    setError('')
    try {
      setSites(await loadSites(token))
    } catch (e) {
      setError(explain(e, 'list your repos'))
    }
  }, [token])

  useEffect(() => {
    setSites(null)
    load()
  }, [load])

  return (
    <section className="px-6 py-14 md:px-14 md:py-20">
      <div className="mx-auto max-w-shell">
        <BackLink />
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-[720px]">
            <span className="eyebrow">My sites</span>
            <h1 className="font-display mt-4 text-[clamp(2.2rem,5vw,3.6rem)] font-medium leading-[1.02] tracking-[-0.035em]">
              Everything you’ve shipped to ms.computer.
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              Every repo your token can see that deploys with Shipyard — live address, last deploy, and the buttons ms.computer
              doesn’t have a dashboard for yet.
            </p>
          </div>
          {session && (
            <div className="flex gap-2">
              <button type="button" onClick={() => { setSites(null); load() }} className="border border-line bg-white px-4 py-2.5 text-sm font-semibold hover:border-ink/30">Refresh</button>
              <a href={href.newSite()} className="border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#7d4ff0]">New site →</a>
            </div>
          )}
        </div>

        {!session && (
          <div className="mt-10 max-w-[760px]">
            <ConnectGitHub title="Connect GitHub to see your sites" />
          </div>
        )}
        {session && error && <p className="mt-10 border border-[#f1c2bd] bg-[#fff6f5] p-5 text-[#b3302a]">{error}</p>}
        {session && !error && sites === null && <p className="mt-10 text-muted">Looking through your repos…</p>}
        {session && sites?.length === 0 && (
          <div className="mt-10 border border-line bg-bg2 p-8">
            <h2 className="text-xl font-semibold">No Shipyard sites yet.</h2>
            <p className="mt-2 text-muted">None of the repos this token can see has <code className="font-mono text-[13px]">.github/workflows/ms-computer.yml</code>.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <a href={href.newSite()} className="border border-accent bg-accent px-5 py-3 font-semibold text-white hover:bg-[#7d4ff0]">Start from a template →</a>
              <a href={href.home} className="border border-line bg-white px-5 py-3 font-semibold hover:border-ink/30">Check an existing repo</a>
            </div>
          </div>
        )}
        {session && sites && sites.length > 0 && (
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sites.map((s) => (
              <SiteCard key={`${s.owner}/${s.repo}`} site={s} token={session.token} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
