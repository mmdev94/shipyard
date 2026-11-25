// Reads a repo's ms.computer deploys through GitHub's public API, from the
// visitor's browser. `cache: 'no-cache'` makes the browser revalidate with the
// ETag it already holds; GitHub doesn't count 304 answers against the
// 60-requests-an-hour limit, so polling an idle repo is close to free.
import { GitHubError } from './checker/index.ts'
import { currentToken } from './github/client.ts'
import { logActivity } from './github/activity.ts'

const API = 'https://api.github.com'
const WORKFLOW = 'ms-computer.yml'

async function get<T>(path: string): Promise<T> {
  let res: Response
  try {
    const token = currentToken()
    res = await fetch(`${API}${path}`, {
      cache: 'no-cache',
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  } catch {
    if (currentToken()) logActivity('GET', path, 0)
    throw new GitHubError("Couldn't reach GitHub.", 0)
  }
  if (currentToken()) logActivity('GET', path, res.status)
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
  jobId: number | null
  /** 'deploy' or 'take-down' — the job in the run that wasn't skipped */
  jobName: string | null
  steps: Step[]
  annotations: Annotation[]
  liveUrl: string | null
  liveSince: string | null
  liveSha: string | null
  /** the latest deploy record was marked inactive by a take-down */
  takenDown: boolean
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
    get<{ workflow_runs: Run[] }>(`${base}/actions/workflows/${WORKFLOW}/runs?per_page=10`),
    loadLive(base),
  ])
  // pull request previews are followed in their own panel, not as the site's latest deploy
  const run = runs.workflow_runs.find((r) => r.event !== 'pull_request') ?? null
  if (!run) return { run, jobId: null, jobName: null, steps: [], annotations: [], ...live }

  // a finished run never changes — reuse what we already have
  if (prev?.run?.id === run.id && prev.run.status === 'completed' && run.status === 'completed') {
    return { ...prev, run, ...live }
  }
  // a run has a deploy job and a take-down job; only one of them runs
  const jobs = await get<{ jobs: { id: number; name: string; conclusion: string | null; steps?: Step[] }[] }>(`${base}/actions/runs/${run.id}/jobs`)
  const job = jobs.jobs.find((j) => j.conclusion !== 'skipped') ?? jobs.jobs[0]
  const steps = (job?.steps ?? []).filter((s) => !/^(Set up job|Complete job|Post )/.test(s.name))
  let annotations: Annotation[] = []
  if (job && run.status === 'completed') {
    annotations = (await get<Annotation[]>(`${base}/check-runs/${job.id}/annotations`)).filter(
      (a) => !/^Process completed with exit code/.test(a.message),
    )
  }
  return { run, jobId: job?.id ?? null, jobName: job?.name ?? null, steps, annotations, ...live }
}

type Live = Pick<TrackState, 'liveUrl' | 'liveSince' | 'liveSha' | 'takenDown'>
const NOT_LIVE: Live = { liveUrl: null, liveSince: null, liveSha: null, takenDown: false }

async function loadLive(base: string): Promise<Live> {
  try {
    const deps = await get<{ id: number; sha: string; created_at: string }[]>(`${base}/deployments?environment=ms-computer&per_page=1`)
    const d = deps[0]
    if (!d) return NOT_LIVE
    // newest status first: a take-down adds "inactive" on top of the old "success"
    const statuses = await get<{ state: string; environment_url: string }[]>(`${base}/deployments/${d.id}/statuses?per_page=1`)
    const latest = statuses[0]
    if (latest?.state === 'inactive') return { ...NOT_LIVE, takenDown: true }
    if (latest?.state !== 'success') return NOT_LIVE
    return { liveUrl: latest.environment_url || null, liveSince: d.created_at, liveSha: d.sha, takenDown: false }
  } catch {
    return NOT_LIVE
  }
}

/** Turns the %0A-joined annotation text back into lines. */
export function annotationLines(a: Annotation): string[] {
  return a.message.split('\n').map((l) => l.trimEnd()).filter(Boolean)
}

/**
 * The finished job's full log (needs a token — GitHub doesn't serve logs
 * anonymously). The API answers with a redirect to GitHub's log storage,
 * which allows browser reads; the token isn't sent along on that hop.
 */
export async function loadJobLog(owner: string, repo: string, jobId: number): Promise<string> {
  const token = currentToken()
  if (!token) throw new GitHubError('Connect GitHub to read the full log.', 401)
  const res = await fetch(`${API}/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
  })
  logActivity('GET', `/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`, res.status)
  if (!res.ok) throw new GitHubError(`GitHub answered ${res.status} for the log.`, res.status)
  return (await res.text())
    .split('\n')
    .map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '').replace(/\x1b\[[0-9;]*m/g, ''))
    .join('\n')
}

export interface DeployRecord {
  id: number
  sha: string
  at: string
  /** made by a Roll back run */
  rollback: boolean
  /** the newest record, while the site is up */
  live: boolean
  takenDown: boolean
  /** first line of the commit message, when the commit is on the branch */
  message: string | null
  author: string | null
}

export interface History {
  records: DeployRecord[]
  /** newest commit on the branch: anything else live means "rolled back" */
  headSha: string | null
}

/**
 * Every deploy Shipyard recorded (one GitHub Deployment per successful
 * deploy), newest first, with commit messages from the branch. Three reads.
 */
export async function loadHistory(owner: string, repo: string, branch: string | null, limit = 15): Promise<History> {
  const base = `/repos/${owner}/${repo}`
  const [deps, commits] = await Promise.all([
    get<{ id: number; sha: string; created_at: string; description: string | null }[]>(`${base}/deployments?environment=ms-computer&per_page=${limit}`),
    get<{ sha: string; commit: { message: string; author: { name: string } | null }; author: { login: string } | null }[]>(
      `${base}/commits?per_page=50${branch ? `&sha=${encodeURIComponent(branch)}` : ''}`,
    ).catch(() => []),
  ])
  let latestState: string | null = null
  if (deps[0]) {
    const st = await get<{ state: string }[]>(`${base}/deployments/${deps[0].id}/statuses?per_page=1`).catch(() => [])
    latestState = st[0]?.state ?? null
  }
  const bySha = new Map(commits.map((c) => [c.sha, c]))
  const records = deps.map((d, i): DeployRecord => {
    const c = bySha.get(d.sha)
    return {
      id: d.id,
      sha: d.sha,
      at: d.created_at,
      rollback: /^Rolled back/i.test(d.description ?? ''),
      live: i === 0 && latestState === 'success',
      takenDown: i === 0 && latestState === 'inactive',
      message: c ? c.commit.message.split('\n')[0] : null,
      author: c ? (c.author?.login ?? c.commit.author?.name ?? null) : null,
    }
  })
  return { records, headSha: commits[0]?.sha ?? null }
}

/** "Roll back to 4f1c2e…(40)" → "Roll back to 4f1c2e9" */
export const shortTitle = (title: string) => title.replace(/\b([0-9a-f]{7})[0-9a-f]{33}\b/g, '$1')

/** Public GitHub read (uses the session's token when there is one, for the higher limit). */
export const publicGet = get

export interface Preview {
  pr: number
  url: string | null
  sha: string
  at: string
  state: 'live' | 'down' | 'unknown'
}

/**
 * Pull request previews on record (workflow v5 with previews on): the newest
 * record per PR, with whether it's still up. A PR's identity payload is
 * encrypted; only its number and address are read here.
 */
export async function loadPreviews(owner: string, repo: string, limit = 6): Promise<Preview[]> {
  const base = `/repos/${owner}/${repo}`
  const deps = await get<{ id: number; sha: string; created_at: string; payload: { pr?: number } | null }[]>(
    `${base}/deployments?environment=ms-computer-preview&per_page=50`,
  )
  const newest = new Map<number, (typeof deps)[number]>()
  for (const d of deps) {
    const pr = d.payload?.pr
    if (typeof pr === 'number' && !newest.has(pr)) newest.set(pr, d)
  }
  return Promise.all(
    [...newest.entries()].slice(0, limit).map(async ([pr, d]): Promise<Preview> => {
      const st = await get<{ state: string; environment_url: string }[]>(`${base}/deployments/${d.id}/statuses?per_page=1`).catch(() => null)
      const s = st?.[0]
      return {
        pr,
        sha: d.sha,
        at: d.created_at,
        url: s?.environment_url || null,
        state: !s ? 'unknown' : s.state === 'success' ? 'live' : 'down',
      }
    }),
  )
}
