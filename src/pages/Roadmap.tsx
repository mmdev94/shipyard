import { useEffect, useState } from 'react'
import { BackLink } from '../components/BackLink'
import { DEADLINE, PLANNED, SHIPPED } from '../lib/roadmap'

const REPO = 'https://github.com/mmdev94/shipyard'
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString([], { month: 'short', day: 'numeric' })

function useCountdown(to: string) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const ms = Math.max(0, new Date(to).getTime() - now)
  return { days: Math.floor(ms / 86_400_000), hours: Math.floor((ms % 86_400_000) / 3_600_000) }
}

export function Roadmap() {
  const left = useCountdown(DEADLINE)
  return (
    <section className="px-6 py-14 md:px-14 md:py-20">
      <div className="mx-auto max-w-shell">
        <BackLink />
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div>
            <span className="eyebrow">Roadmap</span>
            <h1 className="font-display mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-medium leading-[1.02] tracking-[-0.035em]">
              Built in the open. Here’s what’s next.
            </h1>
            <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-muted">
              Shipyard’s goal is simple: make GitHub the fastest way onto ms.computer, so more people build on the network.
              Everything below that’s marked shipped links to the public commit that shipped it — dates you can check.
            </p>
          </div>
          <div className="border border-line bg-bg2 p-5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Until the competition deadline</span>
            <p className="font-display mt-2 text-4xl font-medium tracking-[-0.03em]">
              {left.days}d {left.hours}h
            </p>
            <p className="mt-1 text-[13px] text-muted">Dec 6, 12:00 Central · {SHIPPED.length} features shipped · {PLANNED.length} to go</p>
          </div>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="font-mono text-[12px] uppercase tracking-[0.16em] text-[#13804a]">Shipped · {SHIPPED.length}</h2>
            <ol className="mt-4 space-y-3">
              {SHIPPED.map((s) => (
                <li key={s.title} className="border border-line bg-white p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold text-ink">
                      <span className="mr-2 text-ok">✓</span>
                      {s.link ? (
                        <a href={s.link} className="hover:text-accent">{s.title}</a>
                      ) : (
                        s.title
                      )}
                    </h3>
                    <span className="font-mono text-[12px] text-muted">{day(s.date)}</span>
                  </div>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted">{s.detail}</p>
                  <p className="font-mono mt-3 flex flex-wrap gap-2 text-[12px]">
                    {s.commits.map((c) => (
                      <a key={c} href={`${REPO}/commit/${c}`} target="_blank" rel="noopener" className="border border-line px-2 py-0.5 text-accent hover:border-accent">
                        {c} ↗
                      </a>
                    ))}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <h2 className="font-mono text-[12px] uppercase tracking-[0.16em] text-accent">Next, before Dec 6 · {PLANNED.length}</h2>
            <ol className="mt-4 space-y-3">
              {PLANNED.map((p) => (
                <li key={p.title} className="border border-dashed border-accent/50 bg-white p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold text-ink">{p.title}</h3>
                    <span className="font-mono text-[12px] text-accent">target {p.target}</span>
                  </div>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted">{p.detail}</p>
                  <p className="mt-3 border-l-2 border-accent/50 pl-3 text-[13px] text-ink2">
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent">Growth · </span>
                    {p.growth}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <p className="mt-12 max-w-[70ch] text-[14px] leading-relaxed text-muted">
          How to check any of this: every commit is public at{' '}
          <a href={REPO} target="_blank" rel="noopener" className="text-accent underline underline-offset-4">github.com/mmdev94/shipyard</a>, every
          deploy of this site is a public GitHub Actions run, and each build is signed — “Verify this page” on the home page
          matches the files you’re running to the commit that built them.
        </p>
      </div>
    </section>
  )
}
