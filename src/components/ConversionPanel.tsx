import { openReport } from '../lib/report.ts'
import { Reveal } from './Reveal'
import { Logo } from './Logo'

export function ConversionPanel() {
  return (
    <>
      {/* CTA band */}
      <section id="deploy" className="px-6 py-10">
        <Reveal className="mx-auto max-w-shell overflow-hidden rounded-2xl bg-dark px-8 py-16 text-center text-white md:py-20">
          <span className="eyebrow eyebrow-light mx-auto">Your turn</span>
          <h2 className="font-display mx-auto mt-4 max-w-[18ch] text-[clamp(2rem,5vw,3.6rem)] font-medium leading-[1.05] tracking-[-0.04em]">
            Your next push could be live on ms.computer.
          </h2>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="#/" onClick={() => setTimeout(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); document.getElementById('repo')?.focus({ preventScroll: true }) }, 30)} className="rounded-none border border-accent bg-accent px-6 py-3.5 font-semibold text-white transition-colors hover:bg-[#7d4ff0]">
              Check your repo →
            </a>
            <a href="https://ms.computer" target="_blank" rel="noopener" className="rounded-none border border-white/20 px-6 py-3.5 font-semibold text-white transition-colors hover:border-white/40">
              About ms.computer ↗
            </a>
          </div>
        </Reveal>
      </section>

      {/* footer */}
      <footer className="px-6 pb-12 pt-8">
        <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-5 border-t border-line pt-8">
          <Logo />
          <div className="flex gap-6 text-sm text-muted">
            <a className="transition-colors hover:text-accent" href="https://ms.computer" target="_blank" rel="noopener">ms.computer</a>
            <a className="transition-colors hover:text-accent" href={`https://github.com/${__REPO__}`} target="_blank" rel="noopener">Source</a>
            <a className="transition-colors hover:text-accent" href="#/roadmap">Roadmap</a>
            <button type="button" className="transition-colors hover:text-accent" onClick={() => openReport()}>Report a problem</button>
            <a className="transition-colors hover:text-accent" href="#/rules">Rules</a>
            <a className="transition-colors hover:text-accent" href="https://discord.gg/52fa9qHFfJ" target="_blank" rel="noopener">Discord</a>
            <a className="transition-colors hover:text-accent" href="https://x.com/ms_computer" target="_blank" rel="noopener">X</a>
          </div>
          <span className="max-w-[34ch] text-xs leading-relaxed text-muted">Community-built for the ms.computer website competition. Not an official ms.computer product.</span>
        </div>
      </footer>
    </>
  )
}
