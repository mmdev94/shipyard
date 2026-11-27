// "Deploy to Ms. Computer" button: copies a public repo, at one commit, into a
// new empty repo of the visitor's — then the usual first deploy runs there.
// Files are read from GitHub's public raw file server (no token goes there)
// and written with the visitor's token: text files inline in one tree, binary
// files (images, fonts) as blobs first.
import { readWorkflowConfig, normalizeAppName, type WorkflowConfig } from '../workflow.ts'
import type { Report } from '../checker/types.ts'
import type { FileSpec, FillTools } from './create.ts'
import type { FetchLike } from './client.ts'

const RAW = 'https://raw.githubusercontent.com'

export interface SourceEntry {
  path: string
  mode: string
  type: string
  sha: string
  size?: number
}

export interface CopyPlan {
  owner: string
  repo: string
  commit: string
  files: SourceEntry[]
  skipped: { path: string; why: string }[]
  bytes: number
}

/** Kept well inside what a browser tab and GitHub's write limits handle comfortably. */
export const LIMITS = { files: 1500, bytes: 40_000_000, fileBytes: 20_000_000, binaries: 300 }

const ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/
const ENV_EXAMPLE = /\.(example|sample|template|dist|defaults)$/

/** What gets copied, and what doesn't (with why). Throws if the repo is too big to copy here. */
export function planCopy(owner: string, repo: string, commit: string, entries: SourceEntry[], truncated = false): CopyPlan {
  if (truncated) throw new Error(`${owner}/${repo} has too many files to copy from the browser. Use GitHub’s own “Use this template” or a fork, then check your copy on Shipyard.`)
  const files: SourceEntry[] = []
  const skipped: CopyPlan['skipped'] = []
  let bytes = 0
  for (const e of entries) {
    if (e.type === 'commit') skipped.push({ path: e.path, why: 'a submodule — add it yourself if the site needs it' })
    if (e.type !== 'blob') continue
    if (e.mode === '120000') skipped.push({ path: e.path, why: 'a symlink' })
    else if (e.path.startsWith('.github/workflows/')) skipped.push({ path: e.path, why: 'the original’s own workflows — your copy gets its own deploy workflow' })
    else if (ENV_FILE.test(e.path) && !ENV_EXAMPLE.test(e.path)) skipped.push({ path: e.path, why: 'an environment file — secrets are never copied' })
    else if ((e.size ?? 0) > LIMITS.fileBytes) skipped.push({ path: e.path, why: `over ${LIMITS.fileBytes / 1e6} MB` })
    else {
      files.push(e)
      bytes += e.size ?? 0
    }
  }
  if (files.length > LIMITS.files || bytes > LIMITS.bytes) {
    throw new Error(
      `${owner}/${repo} is too big to copy from the browser (${files.length} files, ${(bytes / 1e6).toFixed(1)} MB; the limit is ${LIMITS.files} files and ${LIMITS.bytes / 1e6} MB). Use GitHub’s “Use this template” or a fork, then check your copy on Shipyard.`,
    )
  }
  return { owner, repo, commit, files, skipped, bytes }
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** The text of a file if it's UTF-8 text (byte-for-byte safe to commit inline), else null. */
export function asText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null
  try {
    return utf8.decode(bytes)
  } catch {
    return null
  }
}

export function toBase64Bytes(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/')

/**
 * Reads every planned file and turns it into something to commit. Binary
 * files are uploaded as blobs, slowed down after the first 60 to stay under
 * GitHub's limit on how fast an account may create content.
 */
export async function copyFiles(
  plan: CopyPlan,
  tools: FillTools,
  opts: { fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Record<string, FileSpec>> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const out: Record<string, FileSpec> = {}
  let next = 0
  let done = 0
  let blobs = 0
  let failed = null as string | null
  const worker = async () => {
    while (next < plan.files.length && !failed) {
      const f = plan.files[next++]
      const url = `${RAW}/${plan.owner}/${plan.repo}/${plan.commit}/${enc(f.path)}`
      let res: Response | null = null
      for (let attempt = 0; attempt < 3 && !res?.ok; attempt++) {
        res = await fetchImpl(url).catch(() => null)
        if (!res?.ok && attempt < 2) await sleep(800 * (attempt + 1))
      }
      if (!res?.ok) {
        failed = f.path
        return
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      const text = asText(bytes)
      if (text !== null) out[f.path] = { content: text, mode: f.mode }
      else {
        if (++blobs > LIMITS.binaries) throw new Error(`More than ${LIMITS.binaries} images or other binary files — too many to copy from the browser. Use GitHub’s “Use this template” or a fork instead.`)
        if (blobs > 60) await sleep(1000)
        out[f.path] = { sha: await tools.blob(toBase64Bytes(bytes)), mode: f.mode }
      }
      done++
      if (done % 10 === 0 || done === plan.files.length) tools.note(`Copied ${done} of ${plan.files.length} files…`)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  if (failed) throw new Error(`Couldn’t read ${failed} from ${plan.owner}/${plan.repo}. Try again in a moment.`)
  return out
}

/** The workflow settings a check found — what the results page starts from. */
export function configFromReport(report: Report, appName = report.repo.repo): WorkflowConfig {
  const d = report.detection
  return {
    appName: normalizeAppName(appName),
    mode: d.mode,
    branch: report.repo.branch,
    packageManager: d.packageManager,
    packageManagerPinned: d.packageManagerPinned,
    hasLockfile: d.hasLockfile,
    nodeVersion: d.nodeVersion,
    buildCommand: d.buildCommand,
    outputDir: d.outputDir,
    workingDir: d.workingDir,
    ...(d.tool ? { tool: d.tool } : {}),
    ...(d.toolVersion ? { toolVersion: d.toolVersion } : {}),
    ...(d.submodules ? { submodules: true } : {}),
    // a single-page app with path routing: publish index.html as 404.html too
    ...(report.findings?.some((f) => f.id === 'spa-routing') ? { spa: true } : {}),
  }
}

/**
 * Settings for the copy's workflow: the original's own Shipyard settings when
 * it has them (its author tuned them), else what the check found — with the
 * copy's name and branch, and no extras that need setting up.
 */
export function copyConfig(report: Report, sourceWorkflow: string | null, name: string, branch: string): WorkflowConfig {
  const own = sourceWorkflow ? readWorkflowConfig(sourceWorkflow)?.config : null
  const base = own ?? configFromReport(report)
  return { ...base, appName: normalizeAppName(name), branch, attest: false, previews: false }
}

/** The Markdown an author pastes into a README. */
export function buttonMarkdown(site: string, owner: string, repo: string): string {
  return `[![Deploy to Ms. Computer](${site}deploy-button.svg)](${site}#/deploy/${owner}/${repo})`
}
