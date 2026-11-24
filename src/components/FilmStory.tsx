import { motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion'
import { useRef, useState, type ReactNode } from 'react'

/* ---------- lottie-style scenes (pure CSS animation) ---------- */

const Chrome = ({ title, dark }: { title: string; dark?: boolean }) => (
  <div className={`flex items-center gap-1.5 border-b px-4 py-2.5 ${dark ? 'border-darkline' : 'border-line bg-bg2'}`}>
    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
    <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
    <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
    <span className={`font-mono ml-2 text-xs ${dark ? 'text-white/40' : 'text-muted'}`}>{title}</span>
  </div>
)

const card = 'fs-float mx-auto w-full max-w-md border shadow-[0_20px_50px_-24px_rgba(20,16,30,0.25)]'

const CheckScene = () => (
  <div className={`${card} border-line bg-white`}>
    <Chrome title="shipyard · you/your-site" />
    <div className="space-y-3 p-6 text-sm">
      {[
        ['bg-ok', 'Vite + React → static site'],
        ['bg-ok', 'No secrets or private keys'],
        ['bg-ok', 'No .env files committed'],
        ['bg-warn', 'Build expects VITE_API_URL'],
        ['bg-ok', 'All files under 16 MiB'],
      ].map(([dot, t], i) => (
        <div key={t} className="fs-rise flex items-center gap-3 text-ink2" style={{ animationDelay: `${0.15 + i * 0.18}s` }}>
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} /> {t}
        </div>
      ))}
    </div>
  </div>
)

const WorkflowScene = () => (
  <div className={`${card} border-line bg-white`}>
    <Chrome title=".github/workflows/ms-computer.yml" />
    <div className="font-mono space-y-2 p-6 text-[13px]">
      {[
        <><span className="text-accent">on</span>: push → <span className="text-accent2">main</span></>,
        <>- run: <span className="text-ink">npm ci &amp;&amp; npm run build</span></>,
        <>- run: <span className="text-ink">mscomputer build --static</span></>,
        <>- run: <span className="text-ink">mscomputer deploy</span><span className="fs-cursor ml-1" /></>,
      ].map((l, i) => (
        <div key={i} className="fs-rise flex gap-3 text-muted" style={{ animationDelay: `${0.2 + i * 0.25}s` }}>
          <span className="text-muted/60">{i + 1}</span>
          <span>{l}</span>
        </div>
      ))}
    </div>
  </div>
)

const PushScene = () => (
  <div className={`${card} overflow-hidden border-darkline bg-dark`}>
    <Chrome title="~/your-site" dark />
    <div className="font-mono space-y-2.5 p-6 text-[13px] leading-relaxed">
      {[
        <><span className="text-white/35">$ </span><span className="text-[#b9a7ff]">git push</span></>,
        <span className="text-white/55">● Install and build</span>,
        <span className="text-white/55">● Plan and build the image</span>,
        <span className="text-[#7CFFB2]">✓ Deploy · 2m 41s</span>,
      ].map((l, i) => (
        <div key={i} className="fs-rise" style={{ animationDelay: `${0.2 + i * 0.3}s` }}>
          {l}
        </div>
      ))}
    </div>
  </div>
)

const LiveScene = () => (
  <div className={`${card} border-line bg-white`}>
    <div className="flex items-center gap-2 border-b border-line bg-bg2 px-4 py-2.5">
      <span className="font-mono text-xs text-muted">your-site-k2048.ms.computer</span>
      <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-xs">
        <span className="h-2 w-2 animate-pulse rounded-full bg-ok" /> live
      </span>
    </div>
    <div className="px-6 py-7">
      <svg viewBox="0 0 200 48" className="h-12 w-full">
        <path className="fs-ekg" d="M0 24 H60 l8 -16 l10 32 l8 -16 H130 l6 -10 l6 20 l5 -10 H200" fill="none" stroke="#8f63ff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
    <div className="grid grid-cols-3 gap-px border-t border-line bg-line">
      {['main@4f1c2a', 'main@9b07e1', 'main@c3d915'].map((c, i) => (
        <div key={c} className="flex flex-col items-center gap-1 bg-white py-4">
          <span className="film-dot h-2.5 w-2.5 rounded-full bg-ok" style={{ animationDelay: `${i * 0.3}s` }} />
          <span className="font-mono text-[10px] text-muted">{c}</span>
        </div>
      ))}
    </div>
  </div>
)

const STEPS: { step: string; title: string; detail: string; visual: ReactNode }[] = [
  { step: '01', title: 'Check it.', detail: 'Paste a public repo. Shipyard reads it in your browser, works out the framework, build command and output folder, and tests it against every ms.computer rule — plus a scan for leaked keys.', visual: <CheckScene /> },
  { step: '02', title: 'Add one file.', detail: 'Shipyard writes a GitHub Action for your exact setup. Connect GitHub and one click commits it and sets up the app’s key — or paste it in by hand.', visual: <WorkflowScene /> },
  { step: '03', title: 'Push like always.', detail: 'Every push to your branch builds the site, verifies it in the same sealed runtime the network uses, and deploys it. If anything fails, the tracker shows the exact reason.', visual: <PushScene /> },
  { step: '04', title: 'Live, same URL.', detail: 'Your site is on ms.computer at the same address after every push. Add the badge to your README so everyone can see it ship.', visual: <LiveScene /> },
]

export function FilmStory() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [active, setActive] = useState(0)
  useMotionValueEvent(p, 'change', (v) => setActive(Math.max(0, Math.min(STEPS.length - 1, Math.floor(v * STEPS.length)))))
  const barScale = useTransform(p, [0, 1], [0, 1])
  // fill as you scroll the steps, then fade out quickly as the film ends
  const barOpacity = useTransform(p, [0, 0.85, 1], [1, 1, 0])

  return (
    <section ref={ref} id="story" className="relative border-y border-line bg-bg2" style={{ height: `${STEPS.length * 75}vh` }}>
      <div className="sticky top-0 h-[100svh] overflow-hidden [perspective:1400px]">
        {/* top bar */}
        <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-6 pt-20 md:px-14 md:pt-24">
          <span className="eyebrow">How it works</span>
          <span className="font-mono text-sm">
            <span className="text-accent">{STEPS[active].step}</span>
            <span className="text-muted/60"> / {String(STEPS.length).padStart(2, '0')}</span>
          </span>
        </div>

        {/* only the active step is mounted — it flips in instantly (no exit wait),
            so fast scrolling always lands on the current step */}
        <motion.div
          key={active}
          initial={{ rotateX: -58, opacity: 0, y: 44 }}
          animate={{ rotateX: 0, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 560, damping: 11, mass: 0.5 }}
          className="absolute inset-0 flex items-center justify-center [transform-style:preserve-3d]"
          style={{ transformOrigin: '50% 45%' }}
        >
          <div className="mx-auto grid w-full max-w-shell items-center gap-10 px-6 md:grid-cols-2 md:gap-16 md:px-14">
            <div className={active % 2 === 1 ? 'md:order-2' : ''}>
              <span className="eyebrow">Step {STEPS[active].step}</span>
              <h3 className="font-display mt-5 text-[clamp(2.4rem,5.5vw,4.6rem)] font-medium leading-[1.04] tracking-[-0.04em]">
                {STEPS[active].title}
              </h3>
              <p className="mt-6 max-w-md text-[clamp(1.05rem,1.6vw,1.25rem)] leading-relaxed text-muted">{STEPS[active].detail}</p>
            </div>
            <div className={active % 2 === 1 ? 'md:order-1' : ''}>{STEPS[active].visual}</div>
          </div>
        </motion.div>

        {/* progress */}
        <motion.div style={{ scaleX: barScale, opacity: barOpacity }} className="absolute bottom-0 left-0 h-[3px] w-full origin-left bg-accent" />
      </div>
    </section>
  )
}
