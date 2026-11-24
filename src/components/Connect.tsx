import { useState, type FormEvent } from 'react'
import { signIn, signOut, useSession } from '../lib/github/client.ts'
import { CONNECT_PERMISSIONS, connectTokenUrl } from '../lib/setup'

/** Signed-in chip for the nav. */
export function SessionChip() {
  const s = useSession()
  if (!s) return null
  return (
    <span className="hidden items-center gap-2 md:inline-flex">
      <img src={s.viewer.avatar_url} alt="" className="h-7 w-7 rounded-full border border-line" />
      <a href="#/sites" className="text-sm font-semibold text-ink2 hover:text-accent">{s.viewer.login}</a>
    </span>
  )
}

export function ConnectGitHub({ owner, title = 'Connect GitHub to deploy in one click', compact = false }: { owner?: string; title?: string; compact?: boolean }) {
  const session = useSession()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (session) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border border-ok/40 bg-[#f3fbf6] px-5 py-3.5">
        <span className="flex items-center gap-3">
          <img src={session.viewer.avatar_url} alt="" className="h-8 w-8 rounded-full border border-line" />
          <span className="text-[15px]">
            Connected as <strong>{session.viewer.login}</strong>
            <span className="block text-xs text-muted">Token held in this tab only — refresh to forget it.</span>
          </span>
        </span>
        <button type="button" onClick={signOut} className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink2 hover:border-ink/30">
          Disconnect
        </button>
      </div>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(value)
      setValue('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-accent/40 bg-white p-5 md:p-6">
      <h4 className="font-display text-[1.25rem] font-semibold tracking-[-0.02em]">{title}</h4>
      {!compact && (
        <p className="mt-2 max-w-[64ch] text-[15px] leading-relaxed text-muted">
          GitHub only lets a server finish a normal sign-in, and Shipyard has no server — so you paste a short-lived token
          instead. It stays in this tab’s memory (no cookies, no storage, gone on refresh), and this page’s security
          policy only lets it talk to GitHub.
        </p>
      )}
      <ol className="mt-4 space-y-3 text-[15px] text-ink2">
        <li>
          <span className="font-mono mr-2 text-accent">1</span>
          <a href={connectTokenUrl(owner)} target="_blank" rel="noopener" className="font-semibold text-accent underline underline-offset-4">
            Create a token on GitHub ↗
          </a>{' '}
          — it’s prefilled. Under <em>Repository access</em> choose the repos to deploy, then <em>Generate token</em>.
          <details className="mt-1.5 text-sm text-muted">
            <summary className="cursor-pointer">What it can do</summary>
            <ul className="mt-2 space-y-1">
              {CONNECT_PERMISSIONS.map(([p, lvl, why]) => (
                <li key={p}>
                  <code className="font-mono text-[12px] text-ink2">{p}: {lvl}</code> — {why}
                </li>
              ))}
              <li>No account settings and no Administration, so it can’t delete or rename repos. Expires in 7 days.</li>
            </ul>
          </details>
        </li>
        <li>
          <span className="font-mono mr-2 text-accent">2</span>Paste it here:
          <form onSubmit={submit} className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="github_pat_…"
              autoComplete="off"
              spellCheck={false}
              className="font-mono min-w-0 flex-1 border border-line bg-white px-3 py-2.5 text-[14px] outline-none focus:border-accent"
              aria-label="GitHub token"
            />
            <button type="submit" disabled={busy || !value.trim()} className="border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#7d4ff0] disabled:opacity-60">
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-[#b3302a]">{error}</p>}
        </li>
      </ol>
    </div>
  )
}
