import { Reveal } from './Reveal'

export type Site = { title: string; author: string; desc: string; url: string; tag: string; img?: string }

// img is set only where a live preview was captured — entries without one are
// hidden (their sites were unreachable when previews were generated).
export const SITES: Site[] = [
  { title: 'The 1024', author: 'Tian Yi', tag: 'Network', url: 'https://the-1024-g4125.ms.computer/', img: '/previews/the-1024.webp', desc: 'A live map of all 1,024 miner slots — which are serving, which failed and why — with a 3-day replay.' },
  { title: 'NEXUS24', author: 'Nutrix', tag: 'Network', url: 'https://nexus24-a9829.ms.computer/', img: '/previews/nexus24.webp', desc: 'A live SN24 dashboard: a 1,024-box map, a watchlist for your miners, UID lookup and fail breakdowns.' },
  { title: 'Deploy Doctor', author: 'drmixalis', tag: 'Tool', url: 'https://deploy-doctor-d1556.ms.computer/', img: '/previews/deploy-doctor.webp', desc: 'Paste a failed mscomputer log and an ER-style monitor tells you the cause and the exact fix commands.' },
  { title: 'TaoDrop', author: 'mo0haned', tag: 'Tool', url: 'https://taodrop-x2274.ms.computer/', img: '/previews/taodrop.webp', desc: 'Throw files device to device over WebRTC — no upload, no account, encrypted and checked with SHA-256.' },
  { title: 'TaoRadar', author: 'mo0haned', tag: 'Tool', url: 'https://taoradar-c3561.ms.computer/', img: '/previews/taoradar.webp', desc: 'A Bittensor scanner: live subnet prices, pools, registration burn and a prune radar, read in your browser.' },
  { title: 'Chrono', author: 'Lultime', tag: 'Tool', url: 'https://chrono-n2732.ms.computer/', img: '/previews/chrono.webp', desc: 'Your day as a 24-hour dial instead of a list — sculpt time blocks, spot gaps and export to .ics.' },
  { title: 'Calm Space', author: 'Nutrix', tag: 'Tool', url: 'https://calm-space-z5942.ms.computer/', desc: 'A no-signup breathing and grounding tool for anxiety, running entirely in your browser.' },
  { title: 'ms.computer, explained', author: 'Starfish', tag: 'Learn', url: 'https://sn24-explained-x6656.ms.computer/', img: '/previews/sn24-explained.webp', desc: 'A scroll-through animated film that explains Subnet 24 from zero — miners, validators, how it all works.' },
  { title: 'Full Rack', author: 'Taylor', tag: 'Game', url: 'https://full-rack-h1272.ms.computer/', img: '/previews/full-rack.webp', desc: 'A daily scheduling puzzle: pack compute jobs onto four racks before they time out. Same shift for everyone.' },
  { title: 'Slime Dispatch', author: 'Lultime', tag: 'Game', url: 'https://slime-atlas-f8729.ms.computer/', img: '/previews/slime-dispatch.webp', desc: 'A living slime builds a road network in real time — cut and wall to push it past 94% MST efficiency.' },
  { title: 'One Line', author: 'Lultime', tag: 'Game', url: 'https://one-line-b7794.ms.computer/', img: '/previews/one-line.webp', desc: 'A one-stroke Eulerian drawing puzzle in a letterpress style, with a daily graph and shareable times.' },
  { title: 'Web Rewind', author: 'Giyu', tag: 'Creative', url: 'https://web-rewind-v0341.ms.computer/', img: '/previews/web-rewind.webp', desc: 'One fictional pizzeria, eight websites — drag the dial from 1996 table layouts to the AI web of today.' },
  { title: 'Imprint', author: 'drmixalis', tag: 'Creative', url: 'https://imprint-r4756.ms.computer/', img: '/previews/imprint.webp', desc: 'A letterpress in your browser: type a word, ink it, pull the lever, and download a debossed print.' },
  { title: 'Letter to the Future', author: 'ForesT', tag: 'Creative', url: 'https://letter-to-the-future-y2765.ms.computer/', img: '/previews/letter-to-the-future.webp', desc: 'Write a letter, pick a date — nobody can open it before then, locked with drand time-lock encryption.' },
  { title: 'Three Frames', author: 'Box', tag: 'Creative', url: 'https://three-frames-z4449.ms.computer/', img: '/previews/three-frames.webp', desc: 'A foldout studio: turn a paper lighthouse from day to night, hide a note, or print the illusion.' },
  { title: 'TaoNoise', author: 'mo0haned', tag: 'Creative', url: 'https://taonoise-m9728.ms.computer/', img: '/previews/taonoise.webp', desc: 'Make your own quiet — mix rain, fire, wind, ocean and 30 more sounds, synthesized live in the browser.' },
  { title: 'AgentMart', author: 'Nutrix', tag: 'Commerce', url: 'https://agentmart-e0613.ms.computer/', img: '/previews/agentmart.webp', desc: 'A shop built for AI agents — rent servers and GPUs, buy domains, pay with crypto. Demo prototype.' },
  { title: 'J Mercury', author: 'Giyu', tag: 'Business', url: 'https://jmercury-j7764.ms.computer/', img: '/previews/jmercury.webp', desc: 'Clear, managed websites for local service businesses — flip through live sample designs in the hero.' },
  { title: 'Hull Custom Landscape', author: 'Hull', tag: 'Business', url: 'https://hull-landscape-i4367.ms.computer/', desc: 'A modern rebuild for a real landscaping company — drone-video hero, service pages and real reviews.' },
]

// only entries with a captured preview image are shown
const WITH_PREVIEW = SITES.filter((s) => s.img)

// image ratios all sit near 4:3 — just enough to nudge card bottoms slightly
// out of lockstep without the dramatic stagger
const RATIOS = [1.4, 1.28, 1.34, 1.46, 1.3, 1.38, 1.25]

export function Gallery() {
  return (
    <section id="gallery" className="py-20 md:py-28">
      <div className="mx-auto max-w-shell px-6 md:px-14">
        {/* header row — title left, CTA right */}
        <Reveal className="mb-12 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-prose">
            <span className="eyebrow">Built on ms.computer</span>
            <h2 className="font-display mt-4 text-[clamp(2rem,4.5vw,3.4rem)] font-medium leading-[1.1] tracking-[-0.04em]">
              See what's shipping.
            </h2>
            <p className="mt-4 text-[1.05rem] text-muted">
              Real sites, apps and games already live on the network — each deployed in a single upload.
            </p>
          </div>
          <a
            href="#/showcase"
            className="shrink-0 rounded-full bg-dark px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2a2c34]"
          >
            Open the showcase →
          </a>
        </Reveal>

        {/* uniform bento grid — big image, minimal content; items-start lets
            titles of different lengths vary the bottom slightly (not much) */}
        <div className="grid items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {WITH_PREVIEW.map((s, i) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener"
              className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_0_rgba(20,16,30,0.04)] transition-all duration-200 hover:-translate-y-1 hover:border-ink/20 hover:shadow-[0_28px_56px_-24px_rgba(20,16,30,0.4)]"
            >
              <div className="overflow-hidden border-b border-line">
                <img
                  src={s.img}
                  alt={`${s.title} preview`}
                  loading="lazy"
                  style={{ aspectRatio: String(RATIOS[i % RATIOS.length]) }}
                  className="w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.05]"
                />
              </div>
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                    {s.tag}
                  </span>
                  <span className="font-mono text-xs text-muted2">by {s.author}</span>
                </div>
                <h3 className="font-display mt-3 line-clamp-2 text-[1.15rem] font-medium leading-snug text-ink group-hover:text-accent">
                  {s.title}
                </h3>
              </div>
            </a>
          ))}

          {/* your site */}
          <a
            href="https://ms.computer/start"
            target="_blank"
            rel="noopener"
            className="group flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-accent/50 bg-accentSoft p-8 text-center transition-colors hover:bg-[#e9ddff]"
          >
            <span className="font-display text-xl font-medium text-accent">Your site here →</span>
            <span className="text-sm text-muted">Deploy in one upload. Free at launch.</span>
          </a>
        </div>

        <p className="font-mono mt-8 text-center text-xs text-muted2">{WITH_PREVIEW.length} live · more every day</p>
      </div>
    </section>
  )
}
