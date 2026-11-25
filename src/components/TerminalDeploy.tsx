import { useMemo, useState } from 'react'
import { setupTokenUrl, SITE } from '../lib/setup'
import { terminalCommand, terminalScript, type SetupTokenSource } from '../lib/terminal.ts'
import { CopyButton } from './DeployPanel'

/** Deploy with the GitHub CLI: a script the visitor reads, then runs on their own machine. */
export function TerminalDeploy({ owner, repo, branch, yaml }: { owner: string; repo: string; branch: string; yaml: string }) {
  const [source, setSource] = useState<SetupTokenSource>('gh')
  const [show, setShow] = useState(false)
  const input = { owner, repo, branch, yaml, trackUrl: `${SITE}#/track/${owner}/${repo}`, setupToken: source }
  const command = useMemo(() => terminalCommand(input), [owner, repo, branch, yaml, source]) // eslint-disable-line react-hooks/exhaustive-deps
  const script = useMemo(() => terminalScript(input), [command]) // eslint-disable-line react-hooks/exhaustive-deps

  // the workflow is the same file the other tabs commit — fold it so the script's own steps are readable
  const body = yaml.replace(/\n$/, '')
  const folded = command.replace(body, `# … the ${body.split('\n').length}-line workflow — unfold to read it …`)

  const download = () => {
    const url = URL.createObjectURL(new Blob([`#!/usr/bin/env bash\n${script}`], { type: 'text/x-shellscript' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `shipyard-deploy-${repo}.sh` })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const option = (value: SetupTokenSource, title: string, body: React.ReactNode) => (
    <label className={`flex cursor-pointer gap-3 border p-4 ${source === value ? 'border-accent bg-accentSoft/40' : 'border-line bg-white'}`}>
      <input type="radio" name={`setup-${repo}`} checked={source === value} onChange={() => setSource(value)} className="mt-1 accent-[#8b5cf6]" />
      <span className="text-[14px] leading-relaxed text-muted">
        <strong className="block text-[15px] text-ink">{title}</strong>
        {body}
      </span>
    </label>
  )

  return (
    <div className="space-y-5">
      <p className="max-w-[64ch] text-[15px] leading-relaxed text-muted">
        Runs on your computer with your own{' '}
        <a href="https://cli.github.com" target="_blank" rel="noopener" className="text-accent underline underline-offset-4">GitHub CLI</a>{' '}
        login. This page never sees a token — read the script, then paste it into a terminal (macOS, Linux, WSL or Git Bash).
      </p>

      <div>
        <p className="text-sm font-semibold text-ink2">The first deploy needs a setup token, to store the app’s key in your repo:</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {option('gh', 'Use my gh login', <>Simplest. It’s saved as an encrypted repo secret for the few minutes of the first deploy; the workflow deletes it once the app’s key is stored.</>)}
          {option(
            'paste',
            'Paste a one-time token',
            <>
              Narrowest: a token that can only write this repo’s secrets and variables, for 7 days.{' '}
              <a href={setupTokenUrl(owner, repo)} target="_blank" rel="noopener" className="text-accent underline underline-offset-4">Create it ↗</a> — the script asks for it, hidden.
            </>,
          )}
        </div>
        <p className="mt-2 text-[13px] text-muted">Deployed before? Then the script skips this step either way.</p>
      </div>

      <div className="border border-darkline bg-dark">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-darkline px-4 py-2.5">
          <span className="font-mono text-[12px] text-[#a9a3c9]">
            {command.split('\n').length} lines · commits {`.github/workflows/ms-computer.yml`} to {branch}
          </span>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={command} label="Copy command" />
            <button type="button" onClick={download} className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink2 hover:border-accent hover:text-accent">
              Download .sh
            </button>
            <button type="button" onClick={() => setShow((s) => !s)} className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink2 hover:border-accent hover:text-accent">
              {show ? 'Fold' : 'Unfold'} the workflow part
            </button>
          </div>
        </div>
        <pre className="font-mono max-h-[460px] overflow-auto whitespace-pre p-4 text-[12px] leading-relaxed text-[#d9d4ff]" data-lenis-prevent>
          {show ? command : folded}
        </pre>
      </div>
    </div>
  )
}
