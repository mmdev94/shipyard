import { useState, type ReactNode } from 'react'
import { DATA, DATA_TREE, minSec, pct, PROBE_RUNS, secs, useDeploys, type Loaded } from '../../lib/watch/data'
import { percentile } from '../../lib/watch/model'
import { href } from '../../lib/watch/route'

// "Why ms.computer": four proofs at the top of #/proof. Every number comes
// from a signed file in the probe's data branch, and each tile links to the
// raw evidence behind it.

function Tile({ n, label, value, note, children }: { n: number; label: string; value: ReactNode; note: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col border border-line bg-white p-5">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
        {String(n).padStart(2, '0')} · {label}
      </span>
      <p className="font-display mt-3 text-[clamp(1.9rem,3.4vw,2.6rem)] font-semibold leading-none tracking-[-0.03em]">{value}</p>
      <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted">{note}</p>
      {children && <div className="mt-4 text-[13px]">{children}</div>}
    </div>
  )
}

const ev = 'font-semibold text-accent underline underline-offset-2'

function PushToLive() {
  const d = useDeploys()
  const [open, setOpen] = useState(false)
  if (d === undefined) return <Tile n={1} label="Push → live" value="…" note="Reading the deploy records…" />
  if (!d || !d.all.count)
    return <Tile n={1} label="Push → live" value="—" note="No deploys measured yet: the probe reads them once an hour." />
  const rows = d.repos.flatMap((r) => r.deploys.map((x) => ({ ...x, repo: r.repo }))).sort((a, b) => Date.parse(b.pushed) - Date.parse(a.pushed))
  return (
    <Tile
      n={1}
      label="Push → live"
      value={minSec(d.all.median)}
      note={
        <>
          from <code className="font-mono text-[12.5px]">git push</code> to the new version live, the median over <strong>{d.all.count} real deploys</strong> in {d.all.repos} repos. 90% were
          live within {minSec(d.all.p90)}; the fastest took {minSec(d.all.fastest)}. That includes GitHub building the site.
        </>
      }
    >
      <button type="button" onClick={() => setOpen((o) => !o)} className={ev}>
        {open ? 'Hide' : 'See'} every deploy
      </button>
      {' · '}
      <a href={`${DATA}/deploys.json`} target="_blank" rel="noopener" className={ev}>
        signed data ↗
      </a>
      {open && (
        <ul className="font-mono mt-3 max-h-[240px] space-y-1 overflow-auto text-[12px] text-ink2" data-lenis-prevent>
          {rows.map((r) => (
            <li key={`${r.repo}${r.sha}${r.pushed}`} className="flex justify-between gap-3">
              <a href={r.run} target="_blank" rel="noopener" className="truncate hover:text-accent">
                {r.repo.split('/')[1]}@{r.sha}
              </a>
              <span className="shrink-0">{minSec(r.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  )
}

function Uptime({ data }: { data: Loaded }) {
  const s = data.summary.sites
  const up24 = s.filter((x) => x.up24 != null)
  const avg = up24.length ? up24.reduce((a, x) => a + x.up24!, 0) / up24.length : null
  const every = up24.filter((x) => x.up24 === 1).length
  const rest = up24.length - every
  const ttfb = percentile(s.map((x) => x.ttfb50).filter((v): v is number => v != null), 50)
  return (
    <Tile
      n={2}
      label="Uptime and speed"
      value={`${every} / ${up24.length}`}
      note={
        <>
          ms.computer sites answered <strong>every check</strong> in the last 24 hours (one every 5 minutes). Typical response: {secs(ttfb)} to the first byte.
          {rest > 0 && (
            <>
              {' '}The other {rest === 1 ? 'one was' : `${rest} were`} down for part of the day — counting {rest === 1 ? 'it' : 'them'}, the average is {pct(avg)}. A down site
              usually answers 503, which is what ms.computer says when an app isn’t running (as after its owner takes it down).
            </>
          )}{' '}
          Measured from one place, GitHub’s servers — <a href={href.how('limits')} className="underline underline-offset-2">the limits</a>.
        </>
      }
    >
      <a href="#sites" onClick={(e) => (e.preventDefault(), document.getElementById('sites')?.scrollIntoView({ behavior: 'smooth' }))} className={ev}>
        Every site, hour by hour
      </a>
      {' · '}
      <a href={PROBE_RUNS} target="_blank" rel="noopener" className={ev}>
        the public runs ↗
      </a>
    </Tile>
  )
}

function SideBySide() {
  return (
    <Tile
      n={3}
      label="Side by side"
      value="Soon"
      note="The same page on ms.computer and on GitHub Pages, measured in the same run from the same place. Being set up — no number until it’s measured."
    />
  )
}

function CostAndSetup() {
  return (
    <Tile
      n={4}
      label="Cost and setup"
      value="$0"
      note={
        <>
          No account and no card: ms.computer’s own command-line tool gets a free access token by itself. With Shipyard the whole setup is <strong>one workflow file</strong>, committed in
          one click or one pull request.
        </>
      }
    >
      <a href="https://github.com/mmdev94/shipyard/blob/main/.github/workflows/ms-computer.yml" target="_blank" rel="noopener" className={ev}>
        a real workflow ↗
      </a>
      {' · '}
      <a href="https://get.ms.computer/install.sh" target="_blank" rel="noopener" className={ev}>
        the CLI ↗
      </a>
    </Tile>
  )
}

export function WhyMsComputer({ data }: { data: Loaded }) {
  return (
    <section className="border-b border-line bg-bg2">
      <div className="mx-auto max-w-shell px-5 pb-12 pt-14 md:px-8 md:pt-20">
        <span className="eyebrow">Why ms.computer</span>
        <h1 className="font-display mt-4 max-w-[20ch] text-[clamp(2.4rem,6vw,4.2rem)] font-semibold leading-[1.0] tracking-[-0.04em]">Measured, not claimed.</h1>
        <p className="mt-5 max-w-[62ch] text-lg leading-relaxed text-muted">
          What it’s like to put a site on ms.computer, in numbers taken from real deploys and real checks. Every number links to the raw, signed data — and the{' '}
          <a href={DATA_TREE} target="_blank" rel="noopener" className="text-accent underline underline-offset-2">data branch</a> keeps every past measurement.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <PushToLive />
          <Uptime data={data} />
          <SideBySide />
          <CostAndSetup />
        </div>
      </div>
    </section>
  )
}
