// Reads a repo's ms.computer deploys through GitHub's public API, from the
// visitor's browser. `cache: 'no-cache'` makes the browser revalidate with the
// ETag it already holds; GitHub doesn't count 304 answers against the
// 60-requests-an-hour limit, so polling an idle repo is close to free.
import { GitHubError } from './checker/index.ts'

const API = 'https://api.github.com'
const WORKFLOW = 'ms-computer.yml'

async function get<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, { cache: 'no-cache', headers: { Accept: 'application/vnd.github+json' } })
  } catch {
    throw new GitHubError("Couldn't reach GitHub.", 0)
  }
  if (res.ok) return res.json() as Promise<T>
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    throw new GitHubError('GitHub’s hourly limit for this network is used up.', res.status, reset ? new Date(reset * 1000) : undefined)
  }
  throw new GitHubError(res.status === 404 ? 'not found' : `GitHub answered ${res.status}`, res.status)
}

export interface Step {
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'pending' | 'waiting'
  conclusion: string | null
  number: number
  started_at: string | null
  completed_at: string | null
}

export interface Run {
  id: number
  status: string
  conclusion: string | null
  head_sha: string
  head_branch: string
  event: string
  html_url: string
  run_started_at: string
  updated_at: string
  display_title: string
}

export interface Annotation {
  annotation_level: 'notice' | 'warning' | 'failure'
  title: string | null
  message: string
}

export interface TrackState {
  run: Run | null
  steps: Step[]
  annotations: Annotation[]
  liveUrl: string | null
  liveSince: string | null
  liveSha: string | null
}

export async function hasWorkflow(owner: string, repo: string): Promise<boolean> {
  try {
    await get(`/repos/${owner}/${repo}/actions/workflows/${WORKFLOW}`)
    return true
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return false
    throw e
  }
}

/** The latest run, its steps, and — once finished — its annotations. */
export async function loadTrack(owner: string, repo: string, prev?: TrackState): Promise<TrackState> {
  const base = `/repos/${owner}/${repo}`
  const [runs, live] = await Promise.all([
    get<{ workflow_runs: Run[] }>(`${base}/actions/workflows/${WORKFLOW}/runs?per_page=1`),
    loadLive(base),
  ])
  const run = runs.workflow_runs[0] ?? null
  if (!run) return { run, steps: [], annotations: [], ...live }

  // a finished run never changes — reuse what we already have
  if (prev?.run?.id === run.id && prev.run.status === 'completed' && run.status === 'completed') {
    return { ...prev, run, ...live }
  }
  const jobs = await get<{ jobs: { id: number; steps?: Step[] }[] }>(`${base}/actions/runs/${run.id}/jobs`)
  const job = jobs.jobs[0]
  const steps = (job?.steps ?? []).filter((s) => !/^(Set up job|Complete job|Post )/.test(s.name))
  let annotations: Annotation[] = []
  if (job && run.status === 'completed') {
    annotations = (await get<Annotation[]>(`${base}/check-runs/${job.id}/annotations`)).filter(
      (a) => !/^Process completed with exit code/.test(a.message),
    )
  }
  return { run, steps, annotations, ...live }
}

async function loadLive(base: string): Promise<Pick<TrackState, 'liveUrl' | 'liveSince' | 'liveSha'>> {
  try {
    const deps = await get<{ id: number; sha: string; created_at: string }[]>(`${base}/deployments?environment=ms-computer&per_page=1`)
    const d = deps[0]
    if (!d) return { liveUrl: null, liveSince: null, liveSha: null }
    const statuses = await get<{ state: string; environment_url: string }[]>(`${base}/deployments/${d.id}/statuses?per_page=1`)
    const ok = statuses.find((s) => s.state === 'success')
    return { liveUrl: ok?.environment_url || null, liveSince: d.created_at, liveSha: d.sha }
  } catch {
    return { liveUrl: null, liveSince: null, liveSha: null }
  }
}

/** Turns the %0A-joined annotation text back into lines. */
export function annotationLines(a: Annotation): string[] {
  return a.message.split('\n').map((l) => l.trimEnd()).filter(Boolean)
}
