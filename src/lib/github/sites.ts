// "My sites": every repo the token can see that deploys with Shipyard's
// workflow, with its live URL and last run — plus the three things you'd want
// to do from a dashboard: redeploy, update the workflow, take the site down.
import { gh, type FetchLike } from './client.ts'
import { fromBase64, repoCaller, toBase64 } from './deploy.ts'
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
        call<{ workflow_runs: { id: number; status: string; conclusion: string | null; head_sha: string; display_title: string; updated_at: string; html_url: string }[] }>(
          'GET',
          '/actions/workflows/ms-computer.yml/runs?per_page=1',
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
      const run = runs.workflow_runs[0]
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

/** Starts a run. Older workflows have no `action` input, so only send it when the file knows it. */
export async function dispatch(site: Site, action: 'deploy' | 'take-down', token: string, fetchImpl?: FetchLike): Promise<void> {
  if (action === 'take-down' && needsUpdate(site)) throw new Error('Update the workflow first — older versions can’t take a site down.')
  const call = repoCaller(site.owner, site.repo, token, fetchImpl)
  await call('POST', '/actions/workflows/ms-computer.yml/dispatches', {
    ref: site.branch,
    ...(needsUpdate(site) ? {} : { inputs: { action } }),
  })
}

/** Rewrites the workflow from the config embedded in it, at the current version. The commit redeploys. */
export async function updateWorkflow(site: Site, token: string, fetchImpl?: FetchLike): Promise<string> {
  if (!site.config) throw new Error('This workflow has no Shipyard config in it — re-check the repo on the home page to regenerate it.')
  const call = repoCaller(site.owner, site.repo, token, fetchImpl)
  const res = await call<{ commit: { sha: string } }>('PUT', `/contents/${WORKFLOW_PATH}`, {
    message: `Update the ms.computer deploy workflow to v${WORKFLOW_VERSION} (Shipyard)`,
    content: toBase64(generateWorkflow(site.config)),
    branch: site.branch,
    sha: site.fileSha,
  })
  return res.commit.sha
}
