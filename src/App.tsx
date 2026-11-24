import { useEffect, useRef, useState } from 'react'
import { checkSnapshot, GitHubError, parseRepoInput, type Report, type RepoSnapshot } from './lib/checker/index.ts'
import { fetchSnapshot } from './lib/checker/github.ts'
import { useLenis } from './lib/useLenis'
import { useRoute } from './lib/route'
import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { Results } from './components/Results'
import { FilmStory } from './components/FilmStory'
import { Proof } from './components/Proof'
import { StatsStrip } from './components/StatsStrip'
import { Gallery } from './components/Gallery'
import { Faq } from './components/Faq'
import { ConversionPanel } from './components/ConversionPanel'
import { Track } from './pages/Track'
import { Rules } from './pages/Rules'

const FRAME = 'relative mx-auto max-w-frame overflow-x-clip border-x border-line bg-white'
const STACK = `${FRAME} [&>section:not(:last-child)]:border-b [&>section]:border-line`

type Check =
  | { state: 'idle' }
  | { state: 'running'; label: string; done: number; total: number }
  | { state: 'done'; report: Report }
  | { state: 'error'; message: string }

function useChecker(input: string | undefined) {
  const [check, setCheck] = useState<Check>({ state: 'idle' })
  const snap = useRef<RepoSnapshot | null>(null)
  const runId = useRef(0)

  const run = async (s: RepoSnapshot, appDir: string | undefined, id: number) => {
    setCheck({ state: 'running', label: `Reading ${s.owner}/${s.repo}`, done: 0, total: 0 })
    const report = await checkSnapshot(s, {
      appDir,
      onProgress: (done, total) => id === runId.current && setCheck({ state: 'running', label: `Reading ${s.owner}/${s.repo}`, done, total }),
    })
    if (id === runId.current) setCheck({ state: 'done', report })
  }

  useEffect(() => {
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
    setCheck({ state: 'running', label: `Asking GitHub about ${ref.owner}/${ref.repo}`, done: 0, total: 0 })
    fetchSnapshot(ref)
      .then((s) => {
        if (id !== runId.current) return
        snap.current = s
        return run(s, undefined, id)
      })
      .catch((e) => {
        if (id !== runId.current) return
        const msg =
          e instanceof GitHubError && e.rateLimitReset
            ? `${e.message} It resets at ${e.rateLimitReset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
            : (e as Error).message || 'Something went wrong reading the repo.'
        setCheck({ state: 'error', message: msg })
      })
  }, [input])

  const pickApp = (dir: string | undefined) => {
    if (snap.current) run(snap.current, dir, ++runId.current)
  }
  return { check, pickApp }
}

function Home({ repo }: { repo?: string }) {
  const { check, pickApp } = useChecker(repo)

  // bring the results into view once they're in
  useEffect(() => {
    if (check.state === 'done') setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }, [check.state])

  return (
    <>
      <div className={FRAME}>
        <Hero initial={repo} busy={check.state === 'running'} />
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
            <p className="mx-auto max-w-xl border border-[#f1c2bd] bg-[#fff6f5] px-5 py-4 text-center text-[#b3302a]">{check.message}</p>
          </div>
        )}
        {check.state === 'done' && (
          <Results key={`${check.report.repo.owner}/${check.report.repo.repo}/${check.report.detection.workingDir}`} report={check.report} onPickApp={pickApp} />
        )}
      </div>

      <FilmStory />

      <div className={STACK}>
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

  return (
    <>
      <Nav />
      {route.page === 'home' && <Home repo={route.repo} />}
      {route.page !== 'home' && (
        <div className={STACK}>
          {route.page === 'track' ? <Track owner={route.owner} repo={route.repo} /> : <Rules />}
          <ConversionPanel />
        </div>
      )}
    </>
  )
}
