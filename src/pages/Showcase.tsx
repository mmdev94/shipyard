import { useEffect, useMemo, useRef, useState } from 'react'
import { BackLink } from '../components/BackLink'
import { CopyButton } from '../components/DeployPanel'
import { SITES } from '../components/Gallery'
import { useSession } from '../lib/github/client.ts'
import { href } from '../lib/route'
import { displayName, loadShowcase, TOPIC, type Listing } from '../lib/showcase'

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/**
 * The live site itself, shrunk into the card. Loaded only when the card
 * scrolls into view, sandboxed, and not clickable (the card links out).
 */
function LivePreview({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.3)
  const [show, setShow] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / 1280))
    ro.observe(el)
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShow(true)
          io.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => {
      ro.disconnect()
      io.disconnect()
    }
  }, [])
  return (
    <div ref={box} className="relative aspect-[16/10] overflow-hidden border-b border-line bg-bg2">
      <span className="font-mono absolute inset-0 grid place-items-center text-xs text-muted">loading {url.replace('https://', '')}…</span>
      {show && (
        <iframe
          src={url}
          title={`${title} — live preview`}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          loading="lazy"
          tabIndex={-1}
          aria-hidden="true"
          style={{ width: 1280, height: 800, transform: `scale(${scale})`, transformOrigin: '0 0' }}
          className="pointer-events-none absolute left-0 top-0 border-0 bg-white"
        />
      )}
    </div>
  )
}

function ListingCard({ l }: { l: Listing }) {
  const name = displayName(l.repo)
  return (
    <article className="group flex flex-col overflow-hidden border border-line bg-white transition-shadow hover:shadow-[0_28px_56px_-28px_rgba(20,16,30,0.45)]">
      {l.url ? (
        <a href={l.url} target="_blank" rel="noopener" aria-label={`Open ${name}`}>
          <LivePreview url={l.url} title={name} />
        </a>
      ) : (
        <div className="grid aspect-[16/10] place-items-center border-b border-line bg-bg2 px-6 text-center text-sm text-muted">
          No ms.computer address found yet — set it as the repo’s Website.
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-[1.2rem] font-medium capitalize leading-snug">
            {l.url ? (
              <a href={l.url} target="_blank" rel="noopener" className="hover:text-accent">{name}</a>
            ) : (
              name
            )}
          </h3>
          {l.viaShipyard && (
            <span title="Deploys on every push with Shipyard" className="shrink-0 rounded-full bg-accentSoft px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-accent2">
              auto-deploys
            </span>
          )}
        </div>
        {l.description && <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-muted">{l.description}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-[12.5px] text-muted">
          <img src={l.avatar} alt="" className="h-5 w-5 rounded-full border border-line" loading="lazy" />
          <a href={l.repoUrl} target="_blank" rel="noopener" className="font-mono hover:text-accent">{l.owner}/{l.repo}</a>
          {l.stars > 0 && <span>★ {l.stars}</span>}
          <span>updated {ago(l.pushedAt)}</span>
          {l.viaShipyard && (
            <a href={href.track(l.owner, l.repo)} className="ml-auto font-semibold text-accent hover:underline">deploys →</a>
          )}
        </div>
      </div>
    </article>
  )
}

function GetListed() {
  const session = useSession()
  const repos = session ? `https://github.com/${session.viewer.login}?tab=repositories` : 'https://github.com'
  return (
    <div className="border border-accent/40 bg-white p-6 md:p-7">
      <h2 className="font-display text-[1.4rem] font-semibold tracking-[-0.02em]">Get your site listed</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        No sign-up and no form — the list is GitHub’s own search for one topic. Any ms.computer site counts, deployed with
        Shipyard or not.
      </p>
      <ol className="mt-5 space-y-4 text-[15px] text-ink2">
        <li className="flex gap-3">
          <span className="font-mono text-accent">1</span>
          <span>
            On your repo’s GitHub page, click ⚙ next to <em>About</em> and add the topic{' '}
            <code className="font-mono border border-line bg-bg2 px-1.5 py-0.5 text-[13px]">{TOPIC}</code>{' '}
            <CopyButton text={TOPIC} label="Copy" className="ml-1 align-middle" />
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-mono text-accent">2</span>
          <span>
            In the same box, set <em>Website</em> to your <span className="font-mono text-[13px]">…ms.computer</span> address.
            Deploying with Shipyard? Skip this — the showcase reads the address from your deploys.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-mono text-accent">3</span>
          <span>That’s it. GitHub’s search picks it up within a few minutes, and it shows up here.</span>
        </li>
      </ol>
      <div className="mt-5 flex flex-wrap gap-2">
        <a href={repos} target="_blank" rel="noopener" className="border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#7d4ff0]">
          Open your repos on GitHub ↗
        </a>
        <a href={href.newSite()} className="border border-line bg-white px-4 py-2.5 text-sm font-semibold hover:border-ink/30">
          No site yet? Start from a template
        </a>
      </div>
    </div>
  )
}

export function Showcase() {
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    loadShowcase()
      .then((l) => alive && setListings(l))
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!listings || !q) return listings
    return listings.filter((l) => `${l.owner} ${l.repo} ${l.description ?? ''} ${l.language ?? ''}`.toLowerCase().includes(q))
  }, [listings, query])
  const live = listings?.filter((l) => l.url).length ?? 0
  const picks = SITES.filter((s) => s.img)

  return (
    <section className="px-6 py-14 md:px-14 md:py-20">
      <div className="mx-auto max-w-shell">
        <BackLink />
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
          <div>
            <span className="eyebrow">Showcase</span>
            <h1 className="font-display mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-medium leading-[1.02] tracking-[-0.035em]">
              What people are shipping on ms.computer.
            </h1>
            <p className="mt-4 max-w-[60ch] text-lg leading-relaxed text-muted">
              Every repo tagged <code className="font-mono text-[0.85em] text-ink2">{TOPIC}</code> on GitHub, with its live site
              running in the card — read from GitHub in your browser, newest first.
            </p>
            {listings && (
              <p className="font-mono mt-4 text-sm text-muted">
                {listings.length} listed · {live} live
              </p>
            )}
          </div>
          <GetListed />
        </div>

        <div className="mt-12">
          {listings && listings.length > 0 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, owner or language…"
              aria-label="Filter the showcase"
              className="mb-6 w-full max-w-md border border-line bg-white px-4 py-3 text-[15px] outline-none focus:border-accent"
            />
          )}
          {error && <p className="border border-[#f1c2bd] bg-[#fff6f5] p-5 text-[#b3302a]">{error}</p>}
          {!error && listings === null && <p className="text-muted">Asking GitHub for repos tagged {TOPIC}…</p>}
          {listings?.length === 0 && (
            <div className="border border-dashed border-accent/50 bg-accentSoft/40 p-8 text-center">
              <p className="font-display text-xl font-medium text-ink">Nothing tagged yet — yours could be first.</p>
              <p className="mt-2 text-muted">Add the topic {TOPIC} to your repo, and it appears here in a few minutes.</p>
            </div>
          )}
          {shown && shown.length > 0 && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((l) => (
                <ListingCard key={`${l.owner}/${l.repo}`} l={l} />
              ))}
            </div>
          )}
          {shown && listings && listings.length > 0 && shown.length === 0 && <p className="text-muted">Nothing matches “{query}”.</p>}
        </div>

        <div className="mt-20 border-t border-line pt-12">
          <span className="eyebrow">Picked by hand</span>
          <h2 className="font-display mt-4 text-[clamp(1.7rem,3.4vw,2.4rem)] font-medium tracking-[-0.03em]">More from around the network</h2>
          <p className="mt-2 max-w-[60ch] text-muted">Sites we found on ms.computer before the showcase existed. Their makers can tag their repos to join the list above.</p>
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {picks.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noopener" className="group overflow-hidden border border-line bg-white hover:border-ink/25">
                <img src={s.img} alt={`${s.title} preview`} loading="lazy" className="aspect-[4/3] w-full border-b border-line object-cover object-top" />
                <div className="p-4">
                  <p className="font-semibold group-hover:text-accent">{s.title}</p>
                  <p className="mt-1 line-clamp-2 text-[13px] text-muted">{s.desc}</p>
                  <p className="font-mono mt-2 text-[11px] text-muted">by {s.author} · {s.tag}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
