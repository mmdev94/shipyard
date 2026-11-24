// Template → new repo → live site. The visitor creates the empty repo on
// GitHub (the token deliberately has no permission to create or delete repos);
// Shipyard then fills it in one commit through the Git Data API.
import { explain, type FetchLike } from './client.ts'
import { ensureSetupSecret, findRun, repoCaller, toBase64, type Step, type StepId, type StepState } from './deploy.ts'

export interface CreateInput {
  owner: string
  repo: string
  token: string
  /** Builds the files once the default branch is known (the workflow names it). */
  makeFiles: (branch: string) => Record<string, string>
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
}

export interface CreateResult {
  ok: boolean
  runId: number | null
  branch: string | null
}

/** Files GitHub's "new repository" page can add; Shipyard may replace these. */
const STARTER_FILES = new Set(['README.md', 'LICENSE', '.gitignore'])

export function createSteps(): Step[] {
  return [
    { id: 'access', label: 'Find the empty repo', state: 'todo' },
    { id: 'secret', label: 'Save a one-time setup secret', state: 'todo' },
    { id: 'workflow', label: 'Commit the starter site and its workflow', state: 'todo' },
    { id: 'start', label: 'Start the first deploy', state: 'todo' },
  ]
}

export async function createFromTemplate(input: CreateInput, onUpdate: (steps: Step[]) => void): Promise<CreateResult> {
  const { owner, repo, token, fetchImpl } = input
  const sleep = input.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const call = repoCaller(owner, repo, token, fetchImpl)
  const steps = createSteps()
  const set = (id: StepId, state: StepState, note?: string) => {
    const s = steps.find((x) => x.id === id)!
    s.state = state
    s.note = note
    onUpdate(steps.map((x) => ({ ...x })))
  }
  let current: StepId = 'access'
  const fail = (e: unknown, need: string): CreateResult => {
    set(current, 'error', explain(e, need))
    return { ok: false, runId: null, branch: null }
  }

  // 1 — the repo exists, we can write to it, and it's empty (or only has GitHub's starter files)
  set('access', 'doing')
  let branch: string
  let parent: string | null = null
  try {
    const meta = await call<{ default_branch?: string; permissions?: { push?: boolean } } | null>('GET', '', undefined, true)
    if (!meta) throw new Error(`There’s no repo ${owner}/${repo} that this token can see. Create it first (step 1), and make sure the token has access to it.`)
    if (meta.permissions && meta.permissions.push === false) throw new Error('The token can only read this repo. It needs write access.')
    branch = meta.default_branch || 'main'
    const ref = await call<{ object: { sha: string } } | null>('GET', `/git/ref/heads/${encodeURIComponent(branch)}`, undefined, true).catch((e) => {
      if ((e as { status?: number }).status === 409) return null // "Git Repository is empty"
      throw e
    })
    if (ref) {
      const tree = await call<{ tree: { path: string; type: string }[] }>('GET', `/git/trees/${ref.object.sha}?recursive=1`)
      const extra = tree.tree.filter((e) => e.type === 'blob' && !STARTER_FILES.has(e.path))
      if (extra.length) throw new Error(`${owner}/${repo} already has files (${extra.slice(0, 3).map((e) => e.path).join(', ')}…). Templates only go into a new, empty repo — to deploy an existing project, check it on the home page instead.`)
      parent = ref.object.sha
    }
  } catch (e) {
    return fail(e, 'read this repo')
  }
  set('access', 'done', parent ? 'Found it — GitHub’s starter files will be replaced.' : 'Found it, empty and ready.')

  // 2 — setup secret
  current = 'secret'
  set('secret', 'doing')
  try {
    const r = await ensureSetupSecret(call, token)
    set('secret', r.state, r.note)
  } catch (e) {
    return fail(e, 'manage this repo’s Actions secrets')
  }

  // 3 — one commit with every file
  current = 'workflow'
  set('workflow', 'doing')
  let commitSha: string
  try {
    const files = input.makeFiles(branch)
    if (!parent) {
      // the Git Data API can't write to a repo with no commits; the Contents API can
      const first = await call<{ commit: { sha: string } }>('PUT', '/contents/README.md', {
        message: 'Start from a Shipyard template',
        content: toBase64(files['README.md'] ?? '# New site\n'),
        branch,
      })
      parent = first.commit.sha
    }
    const base = await call<{ tree: { sha: string } }>('GET', `/git/commits/${parent}`)
    const tree = await call<{ sha: string }>('POST', '/git/trees', {
      base_tree: base.tree.sha,
      tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
    })
    const commit = await call<{ sha: string }>('POST', '/git/commits', {
      message: 'Add the site and its ms.computer deploy workflow (Shipyard)',
      tree: tree.sha,
      parents: [parent],
    })
    await call('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha })
    commitSha = commit.sha
  } catch (e) {
    return fail(e, 'commit files (it needs the Contents and Workflows permissions)')
  }
  set('workflow', 'done', `Committed ${commitSha.slice(0, 7)} to ${branch}.`)

  // 4 — the push starts the deploy; find the run
  current = 'start'
  set('start', 'doing')
  try {
    const runId = await findRun(call, branch, commitSha, Date.now(), sleep)
    set('start', 'done', runId ? 'Building on GitHub Actions.' : 'Started — GitHub is still queueing it.')
    return { ok: true, runId, branch }
  } catch (e) {
    return fail(e, 'read workflow runs (it needs the Actions permission)')
  }
}
