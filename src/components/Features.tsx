import { href } from '../lib/route'
import { Reveal } from './Reveal'

const FEATURES: { title: string; body: string; link?: [string, string]; isNew?: boolean }[] = [
  { isNew: true, title: 'Move my site', body: 'On GitHub Pages, Netlify or Vercel? A move plan says what comes along, and one pull request switches it — redirects and headers included.', link: ['Move a site', '#/move'] },
  { isNew: true, title: 'Jekyll, Hugo, MkDocs, Zola', body: 'Static site generators deploy in one click too: the workflow installs the tool and builds for the site root — GitHub Pages sites included.' },
  { isNew: true, title: 'Python and Go servers', body: 'Flask, FastAPI, Gin, Echo and plain net/http — checked for what trips them up on ms.computer, then deployed and updated on every push.' },
  { isNew: true, title: 'Private repos', body: 'With GitHub connected, checks and fixes work on private repos too — read with your token, in your browser.' },
  { isNew: true, title: '“Deploy to Ms. Computer” button', body: 'Paste it in a README: visitors get their own copy of the project, live at their own address.', link: ['See it', '#/deploy/mmdev94/shipyard-test'] },
  { isNew: true, title: 'More fixes, one click each', body: 'Procfiles, $PORT, deep links in single-page apps, GitHub Pages base paths, SvelteKit and Astro to static — as pull requests.' },
  { title: 'Check any repo', body: 'Every ms.computer rule, a leaked-key scan, and the exact file and line behind each finding. Re-checks itself when you push.', link: ['Try it', '#/'] },
  { title: 'Deploy three ways', body: 'One click with a token that never leaves the tab, a terminal script for the GitHub CLI, or by hand on GitHub’s own pages.' },
  { title: 'Start from a template', body: 'A page, a React app or a blog — in a new repo and live in about three minutes.', link: ['Templates', '#/new'] },
  { title: 'Watch every deploy', body: 'Step-by-step progress, the reason in plain words when something fails, and the full log one click away.' },
  { title: 'Roll back', body: 'Every deploy on record; put any earlier commit back live at the same address, in one click.' },
  { title: 'Preview pull requests', body: 'Each pull request gets its own address, updated on every push and gone when it closes.' },
  { title: 'Fix it for me', body: 'Safe, mechanical fixes arrive as a pull request with the exact diff — nothing changes until you merge.' },
  { title: 'My sites', body: 'Every site in one place: redeploy, update the workflow, switch previews on, take one down.', link: ['My sites', '#/sites'] },
  { title: 'Showcase', body: 'Tag a repo ms-computer and it’s listed with its live site running in the card.', link: ['Showcase', '#/showcase'] },
]

/** One screen that shows everything Shipyard does — what's new in v2 first — with the roadmap one click away. */
export function Features() {
  return (
    <section id="features" className="px-6 py-20 md:px-14 md:py-28">
      <div className="mx-auto max-w-shell">
        <Reveal className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-prose">
            <span className="eyebrow">Everything in v2</span>
            <h2 className="font-display mt-4 text-[clamp(2rem,4.5vw,3.3rem)] font-medium leading-[1.05] tracking-[-0.04em]">
              From GitHub to live — and everything after.
            </h2>
            <p className="mt-4 text-[1.05rem] leading-relaxed text-muted">
              No Shipyard server and no account: it all runs in your browser and your own GitHub Actions.
            </p>
          </div>
          <a href={href.roadmap} className="shrink-0 border border-accent bg-accent px-5 py-3 font-semibold text-white transition-colors hover:bg-[#7d4ff0]">
            What shipped, and when — the roadmap →
          </a>
        </Reveal>
        <div className="mt-12 grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={0.03 * (i % 3)} className="flex flex-col bg-white p-6">
              <span className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-accent">{String(i + 1).padStart(2, '0')}</span>
                {f.isNew && <span className="rounded-full bg-accentSoft px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-accent2">New in v2</span>}
              </span>
              <h3 className="font-display mt-3 text-[1.2rem] font-semibold tracking-[-0.02em]">{f.title}</h3>
              <p className="mt-2 flex-1 text-[14.5px] leading-relaxed text-muted">{f.body}</p>
              {f.link && (
                <a href={f.link[1]} className="mt-4 text-sm font-semibold text-accent hover:underline">
                  {f.link[0]} →
                </a>
              )}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
