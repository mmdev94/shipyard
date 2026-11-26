import { useState, type FormEvent } from 'react'
import { BackLink } from '../components/BackLink'
import { parseRepoInput } from '../lib/checker/index.ts'
import { href } from '../lib/route'

const HOSTS = [
  { name: 'Netlify', reads: 'netlify.toml, _redirects, _headers', keeps: 'build command, publish folder, Node version, redirects, headers' },
  { name: 'Vercel', reads: 'vercel.json', keeps: 'build command, output folder, rewrites, redirects, headers, clean URLs' },
  { name: 'GitHub Pages', reads: 'the Pages workflow, gh-pages script, CNAME', keeps: 'build command and folder — and moves a /<repo>/ site to the root' },
]

// Measured on a live ms.computer site on 2026-11-27 — what a moved site can count on.
const FACTS: [string, string, string][] = [
  ['/about serves about/index.html, /docs serves docs.html', 'Yes', 'Yes'],
  ['A custom 404.html for unknown paths', 'Yes (status 404)', 'Yes'],
  ['Single-page app fallback (/* → index.html)', 'Via 404.html (status 404)', 'Yes (status 200)'],
  ['Redirects', 'Exact paths, as redirect pages', 'Yes, real 301/302/307/308'],
  ['Rewrites with wildcards', 'No', 'Yes'],
  ['Custom headers', 'No — ms.computer sets its own', 'Yes'],
  ['Serverless functions / API routes', 'No', 'No'],
  ['Custom domain', 'No', 'No'],
]

export function Move() {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const ref = parseRepoInput(value)
    if (!ref) {
      setError('That doesn’t look like a GitHub repo — try owner/repo or a github.com link.')
      return
    }
    window.location.hash = href.check(ref.owner, ref.repo, ref.branch)
  }
  return (
    <section className="px-6 py-14 md:px-14 md:py-20">
      <div className="mx-auto max-w-shell">
        <BackLink />
        <div className="mt-6 max-w-[780px]">
          <span className="eyebrow">Move my site</span>
          <h1 className="font-display mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-medium leading-[1.02] tracking-[-0.035em]">
            On GitHub Pages, Netlify or Vercel? Move it in one pull request.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Shipyard reads your host’s settings from the repo, keeps what ms.computer can do, tells you plainly what it can’t,
            and opens one pull request. Merging it deploys the site — your old host keeps running until you switch it off.
          </p>
        </div>

        <form onSubmit={submit} className="mt-10 flex max-w-[680px] flex-col gap-2 sm:flex-row sm:gap-0">
          <label htmlFor="move-repo" className="sr-only">GitHub repository</label>
          <input
            id="move-repo"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError('')
            }}
            placeholder="owner/repo"
            autoComplete="off"
            spellCheck={false}
            className="font-mono min-w-0 flex-1 border border-line bg-white px-4 py-4 text-[15px] outline-none focus:border-accent sm:border-r-0"
          />
          <button type="submit" className="border border-accent bg-accent px-7 py-4 font-semibold text-white hover:bg-[#7d4ff0]">
            See the move plan →
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-[#c43d3d]">{error}</p>}

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
          {HOSTS.map((h) => (
            <div key={h.name} className="border border-line bg-white p-5">
              <p className="font-display text-xl font-semibold">{h.name}</p>
              <p className="mt-3 text-[13px] uppercase tracking-[0.1em] text-muted">Reads</p>
              <p className="font-mono mt-1 text-[13px] text-ink2">{h.reads}</p>
              <p className="mt-3 text-[13px] uppercase tracking-[0.1em] text-muted">Keeps</p>
              <p className="mt-1 text-[14px] text-ink2">{h.keeps}</p>
            </div>
          ))}
        </div>

        <ol className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {[
            ['Check the repo', 'The usual check, plus a move plan: every setting marked kept, changed or not coming along.'],
            ['Pick how to serve it', 'Static (plain files, simplest) or Exact rules (your redirects and headers, served by Caddy).'],
            ['Merge one pull request', 'It adds the deploy workflow and whatever the move needs. Merging deploys; the tracker follows it.'],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="font-mono text-accent">{i + 1}</span>
              <span>
                <span className="block font-semibold">{t}</span>
                <span className="mt-1 block text-[15px] text-muted">{d}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-16">
          <h2 className="font-display text-[clamp(1.5rem,3vw,2.1rem)] font-medium tracking-[-0.03em]">What a moved site can count on</h2>
          <p className="mt-2 max-w-[64ch] text-muted">Measured on a live ms.computer site, not taken from docs.</p>
          <div className="mt-6 overflow-x-auto border border-line">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead className="bg-bg2 text-[12px] uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold"> </th>
                  <th className="px-4 py-3 font-semibold">Static</th>
                  <th className="px-4 py-3 font-semibold">Exact rules</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {FACTS.map(([what, a, b]) => (
                  <tr key={what}>
                    <td className="px-4 py-3 text-ink2">{what}</td>
                    <td className="px-4 py-3 text-muted">{a}</td>
                    <td className="px-4 py-3 text-muted">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
