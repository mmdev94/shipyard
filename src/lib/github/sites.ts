// "My sites": every repo the token can see that deploys with Shipyard's
// workflow, with its live URL and last run — plus the three things you'd want
// to do from a dashboard: redeploy, update the workflow, take the site down.
import { gh, type FetchLike } from './client.ts'
import { findRun, fromBase64, repoCaller, toBase64 } from './deploy.ts'
import { WORKFLOW_PATH } from '../setup.ts'
import { generateWorkflow, readWorkflowConfig, WORKFLOW_VERSION, type WorkflowConfig } from '../workflow.ts'

export interface Site {
  owner: string
  repo: string
  htmlUrl: string
  branch: string
  /** null: a workflow Shipyard didn't write (or an early one without embedded config) */
  version: number | null
  config: WorkflowConfig | null
  fileSha: string
  liveUrl: string | null
  liveSince: string | null
  takenDown: boolean
  run: { id: number; status: string; conclusion: string | null; sha: string; title: string; at: string; url: string } | null
}

interface RepoItem {
  name: string
  owner: { login: string }
  html_url: string
  default_branch: string
  archived: boolean
  pushed_at: string
}

/** Lists repos the token can reach and keeps those with the ms.computer workflow. */
export async function loadSites(token: string, fetchImpl?: FetchLike, limit = 60): Promise<Site[]> {
  const repos = (await gh<RepoItem[]>('GET', '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator', undefined, { token, fetchImpl }))
    .filter((r) => !r.archived)
    .slice(0, limit)

  const found = await Promise.all(
    repos.map(async (r) => {
      const call = repoCaller(r.owner.login, r.name, token, fetchImpl)
      const file = await call<{ sha: string; content: string } | null>('GET', `/contents/${WORKFLOW_PATH}`, undefined, true).catch(() => null)
      if (!file) return null
      const parsed = readWorkflowConfig(fromBase64(file.content))
      const [runs, deps] = await Promise.all([
        call<{ workflow_runs: { id: number; status: string; conclusion: string | null; head_sha: string; display_title: string; updated_at: string; html_url: string; event?: string }[] }>(
          'GET',
          '/actions/workflows/ms-computer.yml/runs?per_page=10',
        ).catch(() => ({ workflow_runs: [] })),
        call<{ id: number; created_at: string }[]>('GET', '/deployments?environment=ms-computer&per_page=1').catch(() => []),
      ])
      let liveUrl: string | null = null
      let takenDown = false
      if (deps[0]) {
        const statuses = await call<{ state: string; environment_url: string }[]>('GET', `/deployments/${deps[0].id}/statuses?per_page=1`).catch(() => [])
        if (statuses[0]?.state === 'success') liveUrl = statuses[0].environment_url || null
        takenDown = statuses[0]?.state === 'inactive'
      }
      const run = runs.workflow_runs.find((r) => r.event !== 'pull_request')
      const site: Site = {
        owner: r.owner.login,
        repo: r.name,
        htmlUrl: r.html_url,
        branch: parsed?.config.branch ?? r.default_branch,
        version: parsed?.version ?? null,
        config: parsed?.config ?? null,
        fileSha: file.sha,
        liveUrl,
        liveSince: deps[0]?.created_at ?? null,
        takenDown,
        run: run ? { id: run.id, status: run.status, conclusion: run.conclusion, sha: run.head_sha, title: run.display_title, at: run.updated_at, url: run.html_url } : null,
      }
      return site
    }),
  )
  return found.filter((s): s is Site => s !== null)
}

export const needsUpdate = (s: Site) => s.version === null || s.version < WORKFLOW_VERSION
export const canUpdateInPlace = (s: Site) => s.config !== null && needsUpdate(s)
/** v2 added the take-down job and the `action` input. */
export const hasActions = (s: Site) => s.version !== null && s.version >= 2

type Sleep = (ms: number) => Promise<void>
const wait: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Starts a run and waits (up to ~50s) for GitHub to list it, so the tracker
 * opens on the new run rather than the last one. Older workflows have no
 * `action` input, so it's only sent when the file knows it.
 */
export async function dispatch(site: Site, action: 'deploy' | 'take-down', token: string, fetchImpl?: FetchLike, sleep: Sleep = wait): Promise<number | null> {
  if (action === 'take-down' && !hasActions(site)) throw new Error('Update the workflow first — older versions can’t take a site down.')
  const call = repoCaller(site.owner, site.repo, token, fetchImpl)
  const startedAt = Date.now()
  await call('POST', '/actions/workflows/ms-computer.yml/dispatches', {
    ref: site.branch,
    ...(hasActions(site) ? { inputs: { action } } : {}),
  })
  return findRun(call, site.branch, null, startedAt, sleep)
}

/** v4 added the `commit` input: deploy an older commit until the next push. */
export const ROLLBACK_VERSION = 4

/**
 * Deploys an older commit again. Reads the repo's workflow first: only v4+
 * knows the `commit` input (older ones would ignore it and redeploy the latest).
 */
export async function rollback(owner: string, repo: string, sha: string, token: string, fetchImpl?: FetchLike, sleep: Sleep = wait): Promise<number | null> {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('That isn’t a full commit SHA.')
  const call = repoCaller(owner, repo, token, fetchImpl)
  const file = await call<{ content: string } | null>('GET', `/contents/${WORKFLOW_PATH}`, undefined, true)
  if (!file) throw new Error('This repo has no ms.computer workflow.')
  const parsed = readWorkflowConfig(fromBase64(file.content))
  if (!parsed || parsed.version < ROLLBACK_VERSION) {
    throw new Error('This repo’s workflow is older than roll back. Update it from My sites first (one click).')
  }
  const startedAt = Date.now()
  await call('POST', '/actions/workflows/ms-computer.yml/dispatches', {
    ref: parsed.config.branch,
    inputs: { action: 'deploy', commit: sha },
  })
  return findRun(call, parsed.config.branch, null, startedAt, sleep)
}

async function writeWorkflow(site: Site, config: WorkflowConfig, message: string, token: string, fetchImpl: FetchLike | undefined, sleep: Sleep) {
  const call = repoCaller(site.owner, site.repo, token, fetchImpl)
  const res = await call<{ commit: { sha: string } }>('PUT', `/contents/${WORKFLOW_PATH}`, {
    message,
    content: toBase64(generateWorkflow(config)),
    branch: site.branch,
    sha: site.fileSha,
  })
  return findRun(call, site.branch, res.commit.sha, Date.now(), sleep)
}

const NO_CONFIG = 'This workflow has no Shipyard config in it — re-check the repo on the home page to regenerate it.'

/**
 * Repairs a deploy that went live but wasn't recorded (GitHub's API failed at
 * that moment): redeploys, replacing exactly that deployment, which records it.
 */
export async function repairRecord(owner: string, repo: string, depId: string, token: string, fetchImpl?: FetchLike, sleep: Sleep = wait): Promise<number | null> {
  if (!/^dep_[0-9a-f]{8,}$/.test(depId)) throw new Error('That doesn’t look like a deployment id — it starts with dep_.')
  const call = repoCaller(owner, repo, token, fetchImpl)
  const file = await call<{ content: string } | null>('GET', `/contents/${WORKFLOW_PATH}`, undefined, true)
  const parsed = file ? readWorkflowConfig(fromBase64(file.content)) : null
  if (!parsed || parsed.version < 2) throw new Error('This repo’s workflow is too old to repair from here. Update it on My sites first.')
  const startedAt = Date.now()
  await call('POST', '/actions/workflows/ms-computer.yml/dispatches', {
    ref: parsed.config.branch,
    inputs: { action: 'deploy', replace_deployment: depId },
  })
  return findRun(call, parsed.config.branch, null, startedAt, sleep)
}

/** Rewrites the workflow from the config embedded in it, at the current version. The commit redeploys; returns that run. */
export async function updateWorkflow(site: Site, token: string, fetchImpl?: FetchLike, sleep: Sleep = wait): Promise<number | null> {
  if (!site.config) throw new Error(NO_CONFIG)
  return writeWorkflow(site, site.config, `Update the ms.computer deploy workflow to v${WORKFLOW_VERSION} (Shipyard)`, token, fetchImpl, sleep)
}

/** Turns pull request previews on or off (and brings the workflow to the current version). The commit redeploys. */
export async function setPreviews(site: Site, on: boolean, token: string, fetchImpl?: FetchLike, sleep: Sleep = wait): Promise<number | null> {
  if (!site.config) throw new Error(NO_CONFIG)
  const message = on ? 'Preview every pull request on ms.computer (Shipyard)' : 'Stop pull request previews (Shipyard)'
  return writeWorkflow(site, { ...site.config, previews: on }, message, token, fetchImpl, sleep)
}
