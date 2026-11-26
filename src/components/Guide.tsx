import { GUIDE, CLIPS } from './clips/clips'
import { Stage, useClipTime, type Clip } from './clips/kit'
import { Reveal } from './Reveal'

function ClipCard({ clip, n }: { clip: Clip; n?: number }) {
  const { box, t } = useClipTime(clip.duration)
  return (
    <figure ref={box} className="overflow-hidden border border-line bg-white">
      <Stage height={536}>{clip.render(t, true)}</Stage>
      <figcaption className="flex items-start gap-3 border-t border-line px-5 py-4">
        {n !== undefined ? (
          <span className="font-mono grid h-7 w-7 shrink-0 place-items-center bg-accent text-[13px] font-semibold text-white">{n}</span>
        ) : (
          <span className="font-mono grid h-7 w-7 shrink-0 place-items-center border border-accent text-[13px] font-semibold text-accent">?</span>
        )}
        <span>
          <span className="block font-semibold text-ink">{clip.title}</span>
          <span className="block text-[14px] text-muted">{clip.caption}</span>
        </span>
      </figcaption>
    </figure>
  )
}

/** For first-timers: what using Shipyard looks like, in three short loops. */
export function Guide() {
  return (
    <section id="guide" className="border-t border-line bg-bg2 px-6 py-16 md:px-14 md:py-20">
      <div className="mx-auto max-w-shell">
        <Reveal className="max-w-prose">
          <span className="eyebrow">New here? 30 seconds</span>
          <h2 className="font-display mt-4 text-[clamp(1.9rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.035em]">
            Three steps, then you just push.
          </h2>
          <p className="mt-3 text-[1.05rem] leading-relaxed text-muted">
            You need a GitHub repo with your site in it — or start from a template and Shipyard makes one for you.
          </p>
        </Reveal>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
          {GUIDE.map((c, i) => (
            <ClipCard key={c.id} clip={c} n={i + 1} />
          ))}
          <ClipCard clip={CLIPS.fix} />
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#/"
            onClick={() => setTimeout(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); document.getElementById('repo')?.focus({ preventScroll: true }) }, 30)}
            className="border border-accent bg-accent px-5 py-3 font-semibold text-white hover:bg-[#7d4ff0]"
          >
            Check my repo →
          </a>
          <a href="#/new" className="border border-line bg-white px-5 py-3 font-semibold hover:border-ink/30">
            I don’t have one — start from a template
          </a>
        </div>
      </div>
    </section>
  )
}
