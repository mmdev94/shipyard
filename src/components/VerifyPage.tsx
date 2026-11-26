import { useState } from 'react'
import { checkFile, pageFiles, verifyCommand, type FileCheck } from '../lib/provenance'
import { CopyButton } from './CopyButton'

/** Hashes the files this tab is running and looks up GitHub's signed build record for each. */
export function VerifyPage() {
  const [checks, setChecks] = useState<FileCheck[] | null>(null)
  const [busy, setBusy] = useState(false)
  const local = __COMMIT__ === 'local'
  const files = typeof document !== 'undefined' ? pageFiles() : []
  const entry = files.find((f) => f.endsWith('.js')) ?? '/'

  const run = async () => {
    setBusy(true)
    setChecks(await Promise.all(files.map((f) => checkFile(__REPO__, f))))
    setBusy(false)
  }
  const all = checks?.every((c) => c.state === 'signed')
  const commits = [...new Set(checks?.map((c) => c.commit).filter(Boolean))]

  return (
    <div className="border-t border-darkline p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">Signed build</span>
        {!local && (
          <button type="button" onClick={run} disabled={busy} className="border border-[#b9a7ff]/50 px-3 py-1.5 text-[13px] font-semibold text-[#d9d4ff] hover:border-[#b9a7ff] disabled:opacity-60">
            {busy ? 'Checking…' : checks ? 'Check again' : 'Verify this page'}
          </button>
        )}
      </div>
      {local && <p className="mt-3 text-[13px] text-white/60">Local build — only the deployed site is signed.</p>}
      {!checks && !local && (
        <p className="mt-3 text-[13px] leading-relaxed text-white/60">
          Every deploy signs each built file through GitHub. Your browser can hash the files it’s running right now and
          look up that signature.
        </p>
      )}
      {checks && (
        <div className="mt-4 space-y-3">
          <ul className="font-mono space-y-1.5 text-[12.5px]">
            {checks.map((c) => (
              <li key={c.path} className="flex items-start gap-2">
                <span className={c.state === 'signed' ? 'text-[#7CFFB2]' : 'text-[#ff9a8f]'}>{c.state === 'signed' ? '✓' : '✕'}</span>
                <span className="min-w-0 break-all text-white/85">
                  {c.path === '/' ? 'index.html' : c.path.replace(/^\//, '')}{' '}
                  <span className="text-white/40">
                    {c.state === 'signed' ? `sha256 ${c.sha256.slice(0, 12)}…` : c.state === 'unsigned' ? 'no signed record for this hash' : c.note}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] leading-relaxed text-white/75">
            {all ? (
              <>
                GitHub holds a signed record that these exact bytes were built by{' '}
                <span className="text-white">{__REPO__}</span>’s workflow
                {commits.length === 1 && (
                  <>
                    {' '}at commit{' '}
                    <a className="text-[#b9a7ff] hover:underline" href={`https://github.com/${__REPO__}/commit/${commits[0]}`} target="_blank" rel="noopener">
                      {commits[0]!.slice(0, 7)}
                    </a>
                  </>
                )}
                {checks[0]?.runUrl && (
                  <>
                    {' '}(
                    <a className="text-[#b9a7ff] hover:underline" href={checks[0].runUrl} target="_blank" rel="noopener">the run ↗</a>)
                  </>
                )}
                .
              </>
            ) : (
              <>Not every file has a signed record — this page may be from before signing started, or not what the repo built.</>
            )}
          </p>
          <div className="border border-darkline bg-black/30 p-3">
            <p className="text-[12px] text-white/55">
              A page can’t fully vouch for itself. For an independent check, run this in a terminal with the GitHub CLI:
            </p>
            <div className="mt-2 flex items-start gap-2">
              <code className="font-mono min-w-0 flex-1 break-all text-[11.5px] text-[#d9d4ff]">{verifyCommand(location.origin, entry, __REPO__)}</code>
              <CopyButton text={verifyCommand(location.origin, entry, __REPO__)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
