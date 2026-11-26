import { buttonMarkdown } from '../lib/github/copy.ts'
import { href } from '../lib/route'
import { SITE } from '../lib/setup'
import { CopyButton } from './DeployPanel'

/**
 * "Deploy to Ms. Computer" for a README: anyone who clicks it gets their own
 * copy of the project, deployed. Only for public repos — nobody else can copy
 * a private one.
 */
export function DeployButtonBox({ owner, repo }: { owner: string; repo: string }) {
  const md = buttonMarkdown(SITE, owner, repo)
  return (
    <div className="mt-2 border border-accent/40 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold text-ink">
          “Deploy to Ms. Computer” button <span className="font-normal text-muted">— let anyone run their own copy</span>
        </span>
        <CopyButton text={md} label="Copy markdown" />
      </div>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-3">
        <a href={href.deploy(owner, repo)} title="See what visitors get">
          <img src={`${SITE}deploy-button.svg`} alt="Deploy to Ms. Computer" className="h-8" />
        </a>
        <code className="font-mono min-w-0 flex-1 truncate text-[12px] text-muted">{md}</code>
      </div>
      <p className="mt-2 text-[12.5px] text-muted">
        Paste it into your README. A click opens Shipyard, which copies this repo into the visitor’s GitHub account and deploys
        it to their own address — no setup on your side.
      </p>
    </div>
  )
}
