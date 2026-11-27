import { detect } from './detect.ts'
import { fetchSnapshot, parseRepoInput, type RepoRef } from './github.ts'
import { detectHost, HOST_LABEL, type HostSetup } from './hosts.ts'
import { evaluate, type Progress } from './rules.ts'
import type { Detection, Finding, Report, RepoSnapshot, Verdict } from './types.ts'

export { parseRepoInput, GitHubError } from './github.ts'
export type * from './types.ts'

export function verdictFor(detection: Detection, findings: Finding[]): Verdict {
  // "Ready" is a promise: only make it when Shipyard can really deploy the repo
  if (detection.framework === 'unknown') {
    return {
      kind: 'unsupported',
      title: 'No website found here',
      summary: `Shipyard couldn’t find an index.html, a web framework, a static site generator or a server${detection.workingDir === '.' ? '' : ` in \`${detection.workingDir}/\``}. Libraries and command-line tools don’t deploy as websites.`,
    }
  }
  if (!detection.workflowSupported) {
    return {
      kind: 'fix',
      title: 'Needs its own build tool',
      summary: `${detection.frameworkLabel} builds with a tool Shipyard’s workflow doesn’t install yet. Build it yourself and deploy the output with the ms.computer CLI — the steps are below.`,
    }
  }
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

/** Uses the old host's build settings where it has them: they're what the site actually builds with. */
function applyHost(d: Detection, setup: HostSetup): Detection {
  const out = { ...d, reasons: [...d.reasons] }
  const from = setup.sources[0] ?? HOST_LABEL[setup.host]
  // run as written: the workflow puts node_modules/.bin on PATH, as the hosts do;
  // GitHub expressions (${{ … }}) only mean something in the host's own workflow
  if (setup.build.command && !setup.build.command.includes('${{') && (out.packageManager !== 'none' || out.framework === 'html')) {
    out.buildCommand = setup.build.command.trim()
    out.reasons.push(`Build command \`${setup.build.command}\` from ${from}.`)
  }
  if (setup.build.publish && out.mode === 'static') {
    const base = setup.build.base && setup.build.base !== '/' ? setup.build.base.replace(/^\/|\/$/g, '') : ''
    let publish = setup.build.publish.replace(/^\.?\//, '').replace(/\/$/, '') || '.'
    if (base && publish.startsWith(`${base}/`)) publish = publish.slice(base.length + 1)
    out.outputDir = publish
    out.reasons.push(`Output folder \`${setup.build.publish}\` from ${from}.`)
  }
  const node = /^v?(\d{2})/.exec(setup.build.node ?? '')?.[1]
  if (node && out.packageManager !== 'none') {
    out.nodeVersion = node
    out.reasons.push(`Node ${node} from ${from}.`)
  }
  return out
}

export async function checkSnapshot(snap: RepoSnapshot, opts: CheckOptions = {}): Promise<Report> {
  let detection = await detect(snap, { appDir: opts.appDir })
  // Netlify's base = the app's folder
  const first = await detectHost(snap, detection.workingDir)
  const hostBase = first?.build.base?.replace(/^\/|\/$/g, '')
  if (hostBase && !opts.appDir && detection.workingDir === '.' && snap.files.some((f) => f.path.startsWith(`${hostBase}/`))) detection = await detect(snap, { appDir: hostBase })
  const host = hostBase && detection.workingDir === hostBase ? await detectHost(snap, detection.workingDir) : first
  if (host) detection = applyHost(detection, host)
  const { findings, scanned } = await evaluate(snap, detection, opts.onProgress)
  return {
    repo: { owner: snap.owner, repo: snap.repo, branch: snap.branch, url: `https://github.com/${snap.owner}/${snap.repo}`, commit: snap.commit, ...(snap.private ? { private: true } : {}) },
    detection,
    findings,
    verdict: verdictFor(detection, findings),
    scanned: { files: scanned, totalFiles: snap.files.length, truncated: snap.truncated },
    paths: snap.files.map((f) => f.path),
    ...(host ? { host } : {}),
  }
}

export async function checkRepo(input: string | RepoRef, opts: CheckOptions & { fetchImpl?: typeof fetch } = {}): Promise<Report> {
  const ref = typeof input === 'string' ? parseRepoInput(input) : input
  if (!ref) throw new Error('That doesn’t look like a GitHub repo. Try owner/repo or a github.com link.')
  return checkSnapshot(await fetchSnapshot(ref, opts.fetchImpl), opts)
}
