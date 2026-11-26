import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { checkSnapshot, GitHubError, parseRepoInput, type Report, type RepoSnapshot } from './lib/checker/index.ts'
import { diffFindings, type Recheck } from './lib/recheck.ts'
import { fetchSnapshot, headCommit, needsConnect } from './lib/checker/github.ts'
import { useSession } from './lib/github/client.ts'
import { useLenis } from './lib/useLenis'
import { useRoute } from './lib/route'
import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { RecheckBar } from './components/Recheck'
import { FilmStory } from './components/FilmStory'
import { Proof } from './components/Proof'
import { Features } from './components/Features'
import { Guide } from './components/Guide'
import { StatsStrip } from './components/StatsStrip'
import { Gallery } from './components/Gallery'
import { Faq } from './components/Faq'
import { ConversionPanel } from './components/ConversionPanel'
import { ActivityDrawer } from './components/Activity'
import { ConnectGitHub } from './components/Connect'
import { ChannelBanner } from './components/ChannelBanner'
import { ChunkBoundary, reloadForNewVersion } from './components/ChunkBoundary'
import { ReportButton, ReportDialog, ReportLink } from './components/Report'

// a preloaded chunk that's gone (a deploy replaced it): fetch the new version
if (typeof window !== 'undefined')
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadForNewVersion()) e.preventDefault()
  })

// pages and the results panel load on demand: the home page doesn't need them
const Results = lazy(() => import('./components/Results').then((m) => ({ default: m.Results })))
const Track = lazy(() => import('./pages/Track').then((m) => ({ default: m.Track })))
const DeployCopy = lazy(() => import('./pages/DeployCopy').then((m) => ({ default: m.DeployCopy })))
const Rules = lazy(() => import('./pages/Rules').then((m) => ({ default: m.Rules })))
const NewSite = lazy(() => import('./pages/NewSite').then((m) => ({ default: m.NewSite })))
const Sites = lazy(() => import('./pages/Sites').then((m) => ({ default: m.Sites })))
const Showcase = lazy(() => import('./pages/Showcase').then((m) => ({ default: m.Showcase })))
const Roadmap = lazy(() => import('./pages/Roadmap').then((m) => ({ default: m.Roadmap })))
const Move = lazy(() => import('./pages/Move').then((m) => ({ default: m.Move })))
const ClipStage = lazy(() => import('./pages/ClipStage').then((m) => ({ default: m.ClipStage })))
const OgCard = lazy(() => import('./pages/ClipStage').then((m) => ({ default: m.OgCard })))

const FRAME = 'relative mx-auto max-w-frame overflow-x-clip border-x border-line bg-white'
const STACK = `${FRAME} [&>section:not(:last-child)]:border-b [&>section]:border-line`

type Check =
  | { state: 'idle' }
  | { state: 'running'; label: string; done: number; total: number }
  | { state: 'done'; report: Report }
  | { state: 'error'; message: string; connect?: boolean }

const WATCH_EVERY = 30_000
const WATCH_FOR = 30 * 60_000

function useChecker(input: string | undefined) {
  const session = useSession()
  const [check, setCheck] = useState<Check>({ state: 'idle' })
  const [attempt, setAttempt] = useState(0)
  const [recheck, setRecheck] = useState<Recheck | null>(null)
  const snap = useRef<RepoSnapshot | null>(null)
  const appDir = useRef<string | undefined>(undefined)
  const runId = useRef(0)
  const busy = useRef(false)

  const run = async (s: RepoSnapshot, dir: string | undefined, id: number, quiet = false) => {
    if (!quiet) setCheck({ state: 'running', label: `Reading ${s.owner}/${s.repo}`, done: 0, total: 0 })
    const report = await checkSnapshot(s, {
      appDir: dir,
      onProgress: (done, total) => !quiet && id === runId.current && setCheck({ state: 'running', label: `Reading ${s.owner}/${s.repo}`, done, total }),
    })
    if (id === runId.current) setCheck({ state: 'done', report })
    return report
  }

  useEffect(() => {
    setRecheck(null)
    appDir.current = undefined
    if (!input) {
      setCheck({ state: 'idle' })
      return
    }
    const ref = parseRepoInput(input)
    if (!ref) {
      setCheck({ state: 'error', message: 'That doesn’t look like a GitHub repo.' })
      return
    }
    const id = ++runId.current
    void import('./components/Results') // fetch the results panel while GitHub answers
    setCheck({ state: 'running', label: `Asking GitHub about ${ref.owner}/${ref.repo}`, done: 0, total: 0 })
    fetchSnapshot(ref)
      .then((s) => {
        if (id !== runId.current) return
        snap.current = s
        return run(s, undefined, id)
      })
      .catch((e) => {
        if (id !== runId.current) return
        setCheck({ state: 'error', message: errorText(e), connect: needsConnect(e) })
      })
  }, [input, attempt])

  // a private repo the visitor wasn't connected for: check again once they connect
  const waiting = check.state === 'error' && check.connect
  useEffect(() => {
    if (waiting && session) setAttempt((a) => a + 1)
  }, [waiting, session])

  const pickApp = (dir: string | undefined) => {
    appDir.current = dir
    if (snap.current) run(snap.current, dir, ++runId.current)
  }

  /**
   * Checks again without starting over: asks which commit the branch is at
   * (free when unchanged) and only re-reads the repo if it moved.
   */
  const checkAgain = useCallback(async () => {
    const s = snap.current
    if (!s || busy.current) return
    busy.current = true
    setRecheck({ kind: 'busy' })
    try {
      const commit = await headCommit(s.owner, s.repo, s.branch)
      if (commit === s.commit) {
        setRecheck({ kind: 'same', commit, at: Date.now() })
        return
      }
      const before = check.state === 'done' ? check.report : null
      const next = await fetchSnapshot({ owner: s.owner, repo: s.repo }, fetch, { owner: s.owner, repo: s.repo, branch: s.branch, private: s.private })
      snap.current = next
      const report = await run(next, appDir.current, ++runId.current, true)
      setRecheck({ kind: 'changed', commit: next.commit ?? commit, ...(before ? diffFindings(before, report) : { fixed: [], added: [] }), at: Date.now() })
    } catch (e) {
      setRecheck({ kind: 'error', message: errorText(e) })
    } finally {
      busy.current = false
    }
  }, [check])

  // "Check repo" on the same repo again: the URL doesn't change, so ask directly
  useEffect(() => {
    const on = () => checkAgain()
    window.addEventListener('shipyard:recheck', on)
    return () => window.removeEventListener('shipyard:recheck', on)
  }, [checkAgain])

  return { check, pickApp, recheck, checkAgain }
}

/**
 * With GitHub connected, keeps asking every 30 s whether the branch moved and
 * checks again when it does. Unchanged answers don't count against GitHub's
 * limit; without a token it doesn't run at all. Pauses in hidden tabs and
 * stops after 30 minutes with no new commits.
 */
function useWatch(active: boolean, report: Report | null, checkAgain: () => Promise<void>) {
  const session = useSession()
  const [state, setState] = useState<'off' | 'watching' | 'paused'>('off')
  const lastChange = useRef(Date.now())
  const commit = report?.repo.commit
  useEffect(() => {
    lastChange.current = Date.now()
  }, [commit])
  useEffect(() => {
    if (!active || !session || !report?.repo.commit) {
      setState('off')
      return
    }
    setState('watching')
    const { owner, repo, branch } = report.repo
    const timer = setInterval(async () => {
      if (document.hidden) return
      if (Date.now() - lastChange.current > WATCH_FOR) {
        setState('paused')
        clearInterval(timer)
        return
      }
      try {
        const head = await headCommit(owner, repo, branch)
        if (head !== report.repo.commit) await checkAgain()
      } catch {
        /* a missed beat is fine — try again next time */
      }
    }, WATCH_EVERY)
    return () => clearInterval(timer)
  }, [active, session, report, checkAgain])
  const resume = () => {
    lastChange.current = Date.now()
    setState('off')
    checkAgain()
  }
  return { state, resume, connected: Boolean(session) }
}

/** While a page's code loads — usually a blink. Same height as a short page, so the footer doesn't jump. */
function PageLoading() {
  return (
    <section className="px-6 py-14 md:px-14 md:py-20" aria-busy="true">
      <div className="mx-auto min-h-[50vh] max-w-shell">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    </section>
  )
}

function errorText(e: unknown): string {
  return e instanceof GitHubError && e.rateLimitReset
    ? `${e.message} It resets at ${e.rateLimitReset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
    : (e as Error).message || 'Something went wrong reading the repo.'
}

function Home({ repo }: { repo?: string }) {
  const { check, pickApp, recheck, checkAgain } = useChecker(repo)
  const report = check.state === 'done' ? check.report : null
  const watch = useWatch(Boolean(report), report, checkAgain)

  // bring the results into view once they're in
  useEffect(() => {
    if (check.state === 'done') setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }, [check.state])

  return (
    <>
      <div className={FRAME}>
        <Hero initial={repo} busy={check.state === 'running'} />
        {check.state === 'idle' && <Guide />}
        {check.state === 'running' && (
          <div className="border-t border-line px-6 py-10 text-center md:px-14" aria-live="polite">
            <p className="font-mono text-sm text-muted">
              {check.label}
              {check.total ? ` — ${check.done} of ${check.total} files` : '…'}
            </p>
            <div className="mx-auto mt-4 h-[3px] max-w-md overflow-hidden bg-line">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: check.total ? `${(check.done / check.total) * 100}%` : '12%' }}
              />
            </div>
          </div>
        )}
        {check.state === 'error' && (
          <div className="border-t border-line px-6 py-10 md:px-14" role="alert">
            <p className="mx-auto max-w-xl border border-[#f1c2bd] bg-[#fff6f5] px-5 py-4 text-center text-[#b3302a]">
              {check.message}{' '}
              <ReportLink preset={{ error: check.message, details: repo ? [`Repo: ${repo}`] : [] }} className="text-[#b3302a]" />
            </p>
            {check.connect && (
              <div className="mx-auto mt-5 max-w-xl">
                <ConnectGitHub owner={repo ? parseRepoInput(repo)?.owner : undefined} title="Private repo? Connect GitHub to check it" compact />
              </div>
            )}
          </div>
        )}
        {check.state === 'done' && (
          <ChunkBoundary>
          <Suspense fallback={<p className="border-t border-line px-6 py-10 text-center text-sm text-muted">Loading the results…</p>}>
            <Results
              key={`${check.report.repo.owner}/${check.report.repo.repo}/${check.report.detection.workingDir}`}
              report={check.report}
              onPickApp={pickApp}
              toolbar={<RecheckBar commit={check.report.repo.commit} branch={check.report.repo.branch} recheck={recheck} onCheckAgain={checkAgain} watch={watch} />}
            />
          </Suspense>
          </ChunkBoundary>
        )}
      </div>

      <FilmStory />

      <div className={STACK}>
        <Features />
        <Proof />
        <StatsStrip />
        <Gallery />
        <Faq />
        <ConversionPanel />
      </div>
    </>
  )
}

export default function App() {
  useLenis()
  const route = useRoute()
  useEffect(() => {
    if (route.page !== 'home' || !route.repo) window.scrollTo(0, 0)
  }, [route])

  // bare pages for exporting the guide clips and the link-preview image
  if (route.page === 'clip') return <Suspense fallback={null}><ClipStage id={route.id} /></Suspense>
  if (route.page === 'og') return <Suspense fallback={null}><OgCard /></Suspense>

  return (
    <>
      <ChannelBanner />
      <Nav />
      <ActivityDrawer />
      <ReportDialog />
      <ReportButton />
      {route.page === 'home' && <Home repo={route.repo} />}
      {route.page !== 'home' && (
        <div className={STACK}>
          <ChunkBoundary key={route.page}>
          <Suspense fallback={<PageLoading />}>
          {route.page === 'track' && <Track owner={route.owner} repo={route.repo} />}
          {route.page === 'deploy' && <DeployCopy key={`${route.owner}/${route.repo}`} owner={route.owner} repo={route.repo} />}
          {route.page === 'rules' && <Rules />}
          {route.page === 'new' && <NewSite initial={route.template} />}
          {route.page === 'sites' && <Sites />}
          {route.page === 'showcase' && <Showcase />}
          {route.page === 'roadmap' && <Roadmap />}
          {route.page === 'move' && <Move />}
          </Suspense>
          </ChunkBoundary>
          <ConversionPanel />
        </div>
      )}
    </>
  )
}
