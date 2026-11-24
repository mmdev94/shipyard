import type { DeployMode, PackageManager } from '../workflow.ts'

export interface TreeEntry {
  path: string
  size: number
}

/** A read-only view of a repo at one branch. `read` fetches file text lazily. */
export interface RepoSnapshot {
  owner: string
  repo: string
  branch: string
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
}

export type VerdictKind = 'static' | 'dynamic' | 'fix' | 'unsupported'

export interface Verdict {
  kind: VerdictKind
  title: string
  summary: string
}

export interface Report {
  repo: { owner: string; repo: string; branch: string; url: string }
  detection: Detection
  findings: Finding[]
  verdict: Verdict
  scanned: { files: number; totalFiles: number; truncated: boolean }
}
