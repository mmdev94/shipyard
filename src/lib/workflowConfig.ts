// The settings Shipyard embeds in the workflows it generates, and the reader
// for them — kept apart from the generator so the checker can read a repo's
// workflow without loading it.

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'none'
export type DeployMode = 'static' | 'dynamic'

export interface WorkflowConfig {
  appName: string
  mode: DeployMode
  branch: string
  packageManager: PackageManager
  nodeVersion: string
  /** Shell command(s) that build the site. Empty for plain HTML. */
  buildCommand: string
  /** Folder that holds the built site (static mode). "." for plain HTML. */
  outputDir: string
  /** Subfolder the app lives in, for monorepos. "." for the repo root. */
  workingDir: string
  /** package.json has a "packageManager" field, so setup actions read the version from it. */
  packageManagerPinned?: boolean
  /** A lockfile is committed. Without one, installs aren't frozen or cached. Defaults to true. */
  hasLockfile?: boolean
  /**
   * Static sites in a public repo: record a signed build-provenance attestation
   * (Sigstore, via GitHub) for every built file, so anyone can check that the
   * files a site serves came from this repo's workflow at a given commit.
   */
  attest?: boolean
  /**
   * Preview every pull request from a branch of this repo at its own address,
   * replaced on each push to the PR and taken down when it closes. Off by
   * default: each preview is a separate ms.computer app whose address stays
   * reserved after teardown.
   */
  previews?: boolean
  /**
   * Static sites moved from a host with a single-page-app fallback: ship a
   * copy of index.html as 404.html, so deep links load the app (ms.computer
   * serves 404.html for unknown paths, with status 404).
   */
  spa?: boolean
  /** Exact-path redirects for a static site, as small redirect pages: [from, to]. */
  redirectPages?: [string, string][]
  /**
   * Serve the built site with Caddy as a small server app, using this
   * Caddyfile from the repo (relative to workingDir) — for redirects,
   * rewrites and headers that static hosting can't express. ms.computer
   * refuses a Caddyfile in a static build, so this deploys as dynamic.
   */
  caddyfile?: string
}

/** Paths and targets Shipyard will write into a workflow (no quotes, spaces or shell characters). */
export const SAFE_FROM = /^\/[A-Za-z0-9._~\/-]*$/
export const SAFE_TO = /^(https?:\/\/[A-Za-z0-9.-]+(:\d+)?)?\/[A-Za-z0-9._~\/?#=&%+-]*$/

export const CONFIG_KEYS = ['appName', 'mode', 'branch', 'packageManager', 'nodeVersion', 'buildCommand', 'outputDir', 'workingDir', 'packageManagerPinned', 'hasLockfile', 'attest', 'previews', 'spa', 'redirectPages', 'caddyfile'] as const

/** Reads the config Shipyard embedded in a workflow it generated (null for other files). */
export function readWorkflowConfig(yaml: string): { version: number; config: WorkflowConfig } | null {
  const v = /^# shipyard-workflow: (\d+)$/m.exec(yaml)
  const c = /^# shipyard-config: (\{.*\})$/m.exec(yaml)
  if (!v || !c) return null
  try {
    const raw = JSON.parse(c[1]) as Record<string, unknown>
    const config = Object.fromEntries(CONFIG_KEYS.filter((k) => k in raw).map((k) => [k, raw[k]])) as unknown as WorkflowConfig
    if (typeof config.appName !== 'string' || (config.mode !== 'static' && config.mode !== 'dynamic')) return null
    return { version: Number(v[1]), config }
  } catch {
    return null
  }
}

