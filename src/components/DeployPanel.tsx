import { useMemo, useState, type ReactNode } from 'react'
import type { Report } from '../lib/checker/index.ts'
import { href } from '../lib/route'
import { badgeImage, badgeMarkdown, newSecretUrl, newWorkflowUrl, setupTokenUrl, WORKFLOW_PATH } from '../lib/setup'
import { generateWorkflow, type WorkflowConfig } from '../lib/workflow.ts'
import { ConnectGitHub } from './Connect'
import { OneClick } from './OneClick'

export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        } catch {
          /* clipboard blocked — the text is still selectable */
        }
      }}
      className={`border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink2 transition-colors hover:border-accent hover:text-accent ${className}`}
    >
      {done ? 'Copied ✓' : label}
    </button>
  )
}

function Step({ n, title, children, done }: { n?: number; title: string; children: ReactNode; done?: boolean }) {
  return (
    <li className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-4 md:grid-cols-[52px_minmax(0,1fr)]">
      <span
        className={`font-mono grid h-10 w-10 place-items-center border text-sm font-semibold md:h-12 md:w-12 ${
          done ? 'border-ok bg-ok text-white' : 'border-accent bg-accentSoft text-accent'
        }`}
      >
        {n ? String(n).padStart(2, '0') : '→'}
      </span>
      <div className="pb-10">
        <h4 className="font-display text-[1.3rem] font-semibold tracking-[-0.02em] md:text-[1.45rem]">{title}</h4>
        <div className="mt-2 space-y-3 text-[15.5px] leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  )
}

const btn =
  'inline-flex items-center gap-2 border px-4 py-2.5 text-sm font-semibold transition-colors'
const primary = `${btn} border-accent bg-accent text-white hover:bg-[#7d4ff0]`
const secondary = `${btn} border-line bg-white text-ink hover:border-ink/30`

export function DeployPanel({ report, cfg }: { report: Report; cfg: WorkflowConfig }) {
  const { owner, repo } = report.repo
  const yaml = useMemo(() => generateWorkflow(cfg), [cfg])
  const [showYaml, setShowYaml] = useState(false)
  const [copied, setCopied] = useState(false)
  const d = report.detection

  if (report.verdict.kind === 'unsupported') {
    return (
      <div id="deploy-steps" className="border-t border-line bg-bg2 px-6 py-14 md:px-14">
        <div className="mx-auto max-w-shell">
          <span className="eyebrow">Next</span>
          <h3 className="font-display mt-4 text-[clamp(1.6rem,3.4vw,2.4rem)] font-medium tracking-[-0.03em]">
            Not a fit for ms.computer today.
          </h3>
          <p className="mt-3 max-w-[60ch] text-muted">
            The items marked <em>must fix</em> rely on things the platform doesn't offer in this release. If the app has a
            static front end, point Shipyard at just that folder — it often deploys on its own. The{' '}
            <a href={href.rules} className="text-accent underline underline-offset-4">rules page</a> lists what runs today.
          </p>
        </div>
      </div>
    )
  }

  if (!d.workflowSupported) {
    return (
      <div id="deploy-steps" className="border-t border-line bg-bg2 px-6 py-14 md:px-14">
        <div className="mx-auto max-w-shell">
          <span className="eyebrow">Deploy</span>
          <h3 className="font-display mt-4 text-[clamp(1.6rem,3.4vw,2.4rem)] font-medium tracking-[-0.03em]">
            Deploy {d.frameworkLabel} with the CLI.
          </h3>
          <p className="mt-3 max-w-[60ch] text-muted">
            Shipyard's GitHub Action builds Node projects and plain HTML. For {d.frameworkLabel}, build locally and ship
            the output folder with the official CLI:
          </p>
          <pre className="font-mono mt-5 overflow-x-auto border border-darkline bg-dark p-5 text-[13px] leading-relaxed text-[#d9d4ff]">
{`curl -fsSL https://get.ms.computer/install.sh | sh
cd ${d.outputDir || 'public'}
mscomputer plan --write && mscomputer build --static && mscomputer deploy --name ${cfg.appName}`}
          </pre>
        </div>
      </div>
    )
  }

  const copyAndOpen = async () => {
    // copy while this tab still has focus; the click's user activation still
    // covers window.open a moment later
    try {
      await navigator.clipboard.writeText(yaml)
      setCopied(true)
    } catch {
      setShowYaml(true) // clipboard blocked: show the YAML so it can be selected by hand
    }
    const win = window.open(newWorkflowUrl(owner, repo, cfg.branch), '_blank')
    if (win) win.opener = null
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([yaml], { type: 'text/yaml' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'ms-computer.yml' })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div id="deploy-steps" className="border-t border-line bg-bg2 px-6 py-14 md:px-14 md:py-20">
      <div className="mx-auto max-w-shell">
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <span className="eyebrow">Auto-deploy · about 3 minutes</span>
            <h3 className="font-display mt-4 text-[clamp(1.8rem,3.8vw,2.8rem)] font-medium leading-[1.06] tracking-[-0.035em]">
              Every push to <span className="font-mono text-[0.8em] text-accent">{cfg.branch}</span> goes live.
            </h3>
            <p className="mt-3 max-w-[62ch] text-muted">
              The build runs in your own GitHub Actions, so the app's secret key stays in your repo. Shipyard has no server.
            </p>
          </div>
        </div>
        {report.verdict.kind === 'fix' && (
          <p className="mt-6 border border-[#ecd9b3] bg-[#fffbf2] px-4 py-3 text-[15px] text-[#8f6113]">
            Fix the items marked <strong>must fix</strong> first — otherwise the first deploy will stop with the same reason.
          </p>
        )}

        <div className="mt-10 max-w-[760px]">
          <ConnectGitHub owner={owner} />
          <OneClick owner={owner} repo={repo} branch={cfg.branch} yaml={yaml} />
        </div>

        <details className="group mt-10 border-t border-line pt-6">
          <summary className="cursor-pointer list-none text-[15px] font-semibold text-ink2 hover:text-accent">
            <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
            Rather not paste a token? Do it by hand in GitHub (4 steps)
          </summary>
        <ol className="mt-8">
          <Step n={1} title="Create a one-time setup token">
            <p>
              The first deploy creates your app and needs somewhere safe to keep its key. This token lets the workflow save
              it as a repo secret. It can only write <strong className="text-ink2">Secrets</strong> and{' '}
              <strong className="text-ink2">Variables</strong>, and it expires in 7 days.
            </p>
            <p>
              On GitHub's page, under <em>Repository access</em>, pick <strong className="text-ink2">Only select repositories → {repo}</strong>, then generate and copy the token.
            </p>
            <a className={primary} href={setupTokenUrl(owner, repo)} target="_blank" rel="noopener">
              Open the prefilled token page ↗
            </a>
          </Step>

          <Step n={2} title="Save it in the repo as SHIPYARD_SETUP_TOKEN">
            <p>Paste the token as a new Actions secret with exactly this name:</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono border border-line bg-white px-3 py-1.5 text-[13px] text-ink">SHIPYARD_SETUP_TOKEN</code>
              <CopyButton text="SHIPYARD_SETUP_TOKEN" label="Copy name" />
              <a className={secondary} href={newSecretUrl(owner, repo)} target="_blank" rel="noopener">
                Open repo secrets ↗
              </a>
            </div>
          </Step>

          <Step n={3} title="Add the workflow">
            <p>
              The button copies the workflow and opens GitHub's new-file page at{' '}
              <code className="font-mono text-[13px] text-ink2">{WORKFLOW_PATH}</code>. Paste it in and commit to{' '}
              <span className="font-mono text-[13px] text-ink2">{cfg.branch}</span> — that commit is the first deploy.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copyAndOpen} className={primary}>
                {copied ? 'Copied — now paste on GitHub ↗' : 'Copy & open GitHub ↗'}
              </button>
              <button type="button" onClick={download} className={secondary}>
                Download
              </button>
              <button type="button" onClick={() => setShowYaml((s) => !s)} className={secondary}>
                {showYaml ? 'Hide' : 'Read'} the workflow
              </button>
            </div>
            {showYaml && (
              <pre className="font-mono max-h-[460px] overflow-auto border border-darkline bg-dark p-5 text-[12.5px] leading-relaxed text-[#d9d4ff]" data-lenis-prevent>
                {yaml}
              </pre>
            )}
          </Step>

          </ol>
        </details>

        <ol className="mt-10">
          <Step title="Watch it go live">
            <p>
              Shipyard follows the run step by step and shows the URL when it's live. Later pushes replace the site at the
              same address. After the first deploy you can delete the setup token.
            </p>
            <div className="flex flex-wrap gap-2">
              <a className={primary} href={href.track(owner, repo)}>
                Open the tracker →
              </a>
            </div>
            <div className="mt-2 border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold text-ink">README badge</span>
                <CopyButton text={badgeMarkdown(owner, repo)} label="Copy markdown" />
              </div>
              <div className="mt-3 flex min-w-0 items-center gap-3">
                <img src={badgeImage(owner, repo)} alt="" className="h-5" onError={(e) => (e.currentTarget.style.display = 'none')} />
                <code className="font-mono truncate text-[12px] text-muted">{badgeMarkdown(owner, repo)}</code>
              </div>
            </div>
          </Step>
        </ol>
      </div>
    </div>
  )
}
