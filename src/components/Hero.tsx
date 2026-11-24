import { useEffect, useState, type FormEvent } from 'react'
import { parseRepoInput } from '../lib/checker/index.ts'
import { href } from '../lib/route'
import { Reveal } from './Reveal'

// Real public repos that show each verdict — handy for a first look.
const EXAMPLES = [
  { label: 'satnaing/astro-paper', note: 'static' },
  { label: 'withastro/starlight', note: 'monorepo' },
  { label: 'fastapi/full-stack-fastapi-template', note: 'database' },
]

export function Hero({ initial, busy }: { initial?: string; busy: boolean }) {
  const [value, setValue] = useState(initial ?? '')
  const [error, setError] = useState('')
  useEffect(() => {
    if (initial) setValue(initial)
  }, [initial])

  const go = (raw: string) => {
    const ref = parseRepoInput(raw)
    if (!ref) {
      setError('Paste a public GitHub repo — like owner/repo or a github.com link.')
      return
    }
    setError('')
    window.location.hash = href.check(ref.owner, ref.repo, ref.branch)
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    go(value)
  }

  return (
    <section id="top" className="relative px-6 pb-16 pt-16 md:pb-24 md:pt-24">
      <div className="mx-auto w-full max-w-[880px] text-center">
        <Reveal>
          <span className="eyebrow mx-auto">GitHub → ms.computer, on every push</span>
        </Reveal>
        <Reveal delay={0.05}>
          <h1 className="font-display mt-6 text-[clamp(2.5rem,6.4vw,5rem)] font-medium leading-[0.98] tracking-[-0.035em] text-ink">
            Will your repo run on <span className="text-accent">ms.computer?</span>
          </h1>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mx-auto mt-6 max-w-[52ch] text-[clamp(1.02rem,1.9vw,1.24rem)] leading-relaxed text-muted">
            Paste a public repo. Shipyard checks it against the platform's rules, scans it for leaked keys,
            and writes the GitHub Action that deploys it every time you push. Runs in your browser — no account, no server.
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <form onSubmit={onSubmit} className="mx-auto mt-10 flex max-w-[680px] flex-col gap-2 sm:flex-row sm:gap-0">
            <label htmlFor="repo" className="sr-only">GitHub repository</label>
            <div className="flex min-w-0 flex-1 items-center border border-line bg-white focus-within:border-accent sm:border-r-0">
              <span className="font-mono hidden pl-4 text-sm text-muted sm:block">github.com/</span>
              <input
                id="repo"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="owner/repo"
                autoComplete="off"
                spellCheck={false}
                className="font-mono min-w-0 flex-1 bg-transparent px-4 py-4 text-[15px] text-ink outline-none placeholder:text-muted/60 sm:pl-0.5"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="border border-accent bg-accent px-7 py-4 font-semibold text-white transition-colors hover:bg-[#7d4ff0] disabled:opacity-70"
            >
              {busy ? 'Checking…' : 'Check repo →'}
            </button>
          </form>
          {error && <p className="mt-3 text-sm text-[#c43d3d]">{error}</p>}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted">
            <span>Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  setValue(ex.label)
                  go(ex.label)
                }}
                className="font-mono text-[13px] text-ink2 underline decoration-line underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
              >
                {ex.label}
              </button>
            ))}
          </div>
          <p className="mt-7 text-[15px] text-muted">
            No project yet?{' '}
            <a href="#/new" className="font-semibold text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent">
              Start from a template — live in about 3 minutes →
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  )
}
