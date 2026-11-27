import type { DeployMode, PackageManager, SiteTool } from '../workflowConfig.ts'
import type { HostSetup } from './hosts.ts'

export interface TreeEntry {
  path: string
  size: number
}

/** A read-only view of a repo at one branch. `read` fetches file text lazily. */
export interface RepoSnapshot {
  owner: string
  repo: string
  branch: string
  /** the commit everything was read at (absent in hand-made test snapshots) */
  commit?: string
  /** a private repo, read with the visitor's token */
  private?: boolean
  /** GitHub Pages is on for the repo (it may build from a branch, with no workflow file) */
  hasPages?: boolean
  files: TreeEntry[]
  truncated: boolean
  read(path: string): Promise<string | null>
}

export type Severity = 'pass' | 'info' | 'warn' | 'fail'
export type Category = 'platform' | 'security' | 'build'

export interface Evidence {
  path: string
  line?: number
  snippet?: string
}

export interface Finding {
  id: string
  severity: Severity
  category: Category
  title: string
  detail: string
  /** The ms.computer rule this relates to, in plain words. */
  rule?: string
  fix?: string
  evidence?: Evidence[]
  /** A failure no config change can fix today (e.g. a database). */
  blocking?: boolean
  /** Machine-readable details for "Fix it for me" (e.g. the Procfile command to write). */
  data?: Record<string, string>
}

export interface Detection {
  framework: string
  frameworkLabel: string
  mode: DeployMode
  packageManager: PackageManager
  packageManagerPinned: boolean
  /** A lockfile is committed, so installs can be frozen and cached. */
  hasLockfile: boolean
  nodeVersion: string
  buildCommand: string
  outputDir: string
  workingDir: string
  /** Why we decided this, shown to the user. */
  reasons: string[]
  /** True when the workflow can build it as-is (Node or plain HTML). */
  workflowSupported: boolean
  /** Other app folders found in a monorepo, for the UI's app picker. */
  apps: string[]
  /** A static site generator the workflow installs (Jekyll, Hugo, MkDocs, Zola). */
  tool?: SiteTool
  toolVersion?: string
  /** Themes as git submodules. */
  submodules?: boolean
}

export type VerdictKind = 'static' | 'dynamic' | 'fix' | 'unsupported'

export interface Verdict {
  kind: VerdictKind
  title: string
  summary: string
}

export interface Report {
  repo: { owner: string; repo: string; branch: string; url: string; commit?: string; private?: boolean }
  detection: Detection
  findings: Finding[]
  verdict: Verdict
  scanned: { files: number; totalFiles: number; truncated: boolean }
  /** Every path in the repo at that branch (for "Fix it for me"). */
  paths: string[]
  /** Set up for GitHub Pages, Netlify or Vercel: what "Move my site" reads. */
  host?: HostSetup
}
