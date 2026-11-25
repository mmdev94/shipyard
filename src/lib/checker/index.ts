import { detect } from './detect.ts'
import { fetchSnapshot, parseRepoInput, type RepoRef } from './github.ts'
import { evaluate, type Progress } from './rules.ts'
import type { Detection, Finding, Report, RepoSnapshot, Verdict } from './types.ts'

export { parseRepoInput, GitHubError } from './github.ts'
export type * from './types.ts'

export function verdictFor(detection: Detection, findings: Finding[]): Verdict {
  const fails = findings.filter((f) => f.severity === 'fail')
  const blocking = fails.filter((f) => f.blocking)
  if (blocking.length) {
    return {
      kind: 'unsupported',
      title: 'Not supported on ms.computer yet',
      summary: `${blocking.map((f) => f.title.toLowerCase()).join(', ')} — ms.computer can't run that today.`,
    }
  }
  if (fails.length) {
    return {
      kind: 'fix',
      title: `Needs ${fails.length === 1 ? 'one fix' : `${fails.length} fixes`} first`,
      summary: `Fix ${fails.length === 1 ? 'this' : 'these'} and it's ready: ${fails.map((f) => f.title.toLowerCase()).join(', ')}.`,
    }
  }
  if (detection.mode === 'static') {
    return {
      kind: 'static',
      title: 'Ready — deploys as a static site',
      summary: `${detection.frameworkLabel}${detection.buildCommand ? `, built with \`${detection.buildCommand}\`` : ''}, served from \`${detection.outputDir}\`.`,
    }
  }
  return {
    kind: 'dynamic',
    title: 'Deploys as a dynamic app',
    summary: `${detection.frameworkLabel} runs as a container. It works within ms.computer's limits — check the warnings below.`,
  }
}

export interface CheckOptions {
  /** Folder to treat as the app, for monorepos (from detection.apps). */
  appDir?: string
  onProgress?: Progress
}

export async function checkSnapshot(snap: RepoSnapshot, opts: CheckOptions = {}): Promise<Report> {
  const detection = await detect(snap, { appDir: opts.appDir })
  const { findings, scanned } = await evaluate(snap, detection, opts.onProgress)
  return {
    repo: { owner: snap.owner, repo: snap.repo, branch: snap.branch, url: `https://github.com/${snap.owner}/${snap.repo}` },
    detection,
    findings,
    verdict: verdictFor(detection, findings),
    scanned: { files: scanned, totalFiles: snap.files.length, truncated: snap.truncated },
    paths: snap.files.map((f) => f.path),
  }
}

export async function checkRepo(input: string | RepoRef, opts: CheckOptions & { fetchImpl?: typeof fetch } = {}): Promise<Report> {
  const ref = typeof input === 'string' ? parseRepoInput(input) : input
  if (!ref) throw new Error('That doesn’t look like a GitHub repo. Try owner/repo or a github.com link.')
  return checkSnapshot(await fetchSnapshot(ref, opts.fetchImpl), opts)
}
