import { href } from '../lib/route'
import { badgeImage } from '../lib/setup'
import { Reveal } from './Reveal'
import { VerifyPage } from './VerifyPage'

const [OWNER, REPO] = __REPO__.split('/')

export function Proof() {
  const built = new Date(__BUILT_AT__)
  const local = __COMMIT__ === 'local'
  return (
    <section id="proof" className="px-6 py-20 md:px-14 md:py-28">
      <div className="mx-auto grid max-w-shell items-center gap-12 md:grid-cols-2">
        <Reveal>
          <span className="eyebrow">Proof</span>
          <h2 className="font-display mt-4 text-[clamp(2rem,4.5vw,3.3rem)] font-medium leading-[1.05] tracking-[-0.04em]">
            This page shipped itself.
          </h2>
          <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-muted">
            Shipyard runs Shipyard's own check on Shipyard's own repo, uses the workflow it generated, and deploys on
            every push — the same steps you'll use. Every file it serves is signed at build time, so you can check that
            the page in front of you is exactly what the public repo built.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={href.track(OWNER, REPO)} className="border border-accent bg-accent px-5 py-3 font-semibold text-white transition-colors hover:bg-[#7d4ff0]">
              Watch its deploys →
            </a>
            <a href={href.check(OWNER, REPO)} className="border border-line bg-white px-5 py-3 font-semibold text-ink transition-colors hover:border-ink/30">
              Check Shipyard's repo
            </a>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="border border-darkline bg-dark text-white shadow-[0_30px_60px_-30px_rgba(20,16,30,0.5)]">
            <div className="flex items-center justify-between border-b border-darkline px-5 py-3">
              <span className="font-mono text-xs text-white/50">{__REPO__}</span>
              <img src={badgeImage(OWNER, REPO)} alt="Deploy status" className="h-5" onError={(e) => (e.currentTarget.style.display = 'none')} />
            </div>
            <dl className="font-mono grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 p-6 text-[13.5px]">
              <dt className="text-white/40">commit</dt>
              <dd>
                {local ? (
                  <span className="text-white/70">local build</span>
                ) : (
                  <a className="text-[#b9a7ff] hover:underline" href={`https://github.com/${__REPO__}/commit/${__COMMIT__}`} target="_blank" rel="noopener">
                    {__COMMIT__}
                  </a>
                )}
              </dd>
              <dt className="text-white/40">built</dt>
              <dd className="text-white/80">{built.toUTCString().replace(' GMT', ' UTC')}</dd>
              <dt className="text-white/40">by</dt>
              <dd className="text-white/80">GitHub Actions · .github/workflows/ms-computer.yml</dd>
              <dt className="text-white/40">check</dt>
              <dd className="text-[#7CFFB2]">✓ static · 0 secrets · 0 must-fix</dd>
              <dt className="text-white/40">server</dt>
              <dd className="text-white/80">none — everything runs in your browser</dd>
            </dl>
            <VerifyPage />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
