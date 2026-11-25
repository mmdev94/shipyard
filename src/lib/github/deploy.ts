// One-click deploy: what a visitor would otherwise do by hand in four GitHub
// pages, done through the API with their in-memory token.
//   1. check the token can write to the repo and the branch exists
//   2. first deploy only: save the token as SHIPYARD_SETUP_TOKEN (encrypted
//      in the browser with the repo's public key) so the run can store the
//      app's identity; the run deletes it again right after that
//   3. commit .github/workflows/ms-computer.yml (or dispatch if it's unchanged)
//   4. find the run that started, for the tracker
import { explain, gh, type FetchLike } from './client.ts'
import { b64decode, b64encode, encryptSecret } from './sealedbox.ts'
import { WORKFLOW_PATH } from '../setup.ts'

export type StepState = 'todo' | 'doing' | 'done' | 'skip' | 'error'
export type StepId = 'access' | 'secret' | 'workflow' | 'start'
export interface Step {
  id: StepId
  label: string
  state: StepState
  note?: string
}

export interface DeployInput {
  owner: string
  repo: string
  branch: string
  yaml: string
  token: string
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export interface DeployResult {
  ok: boolean
  runId: number | null
  committed: boolean
}

const utf8 = new TextEncoder()
export const toBase64 = (text: string) => b64encode(utf8.encode(text))
export const fromBase64 = (b64: string) => new TextDecoder().decode(b64decode(b64.replace(/\s+/g, '')))

/** Two workflows that differ only in the embedded `# shipyard-config:` line behave the same. */
export const sameSteps = (a: string, b: string) => {
  const strip = (y: string) => y.replace(/^# shipyard-config: .*$/m, '')
  return strip(a) === strip(b)
}

export type RepoCall = <T>(method: string, path: string, body?: unknown, allow404?: boolean) => Promise<T>

export function repoCaller(owner: string, repo: string, token: string, fetchImpl?: FetchLike): RepoCall {
  return <T>(method: string, path: string, body?: unknown, allow404 = false) =>
    gh<T>(method, `/repos/${owner}/${repo}${path}`, body, { token, fetchImpl, allow404 })
}

/** First deploy only: store the token as SHIPYARD_SETUP_TOKEN so the run can save the app's identity. */
export async function ensureSetupSecret(call: RepoCall, token: string): Promise<{ state: 'done' | 'skip'; note: string }> {
  const toml = await call('GET', '/actions/variables/MSCOMPUTER_TOML', undefined, true)
  const appSecret = toml ? await call('GET', '/actions/secrets/MSCOMPUTER_APP_SECRET', undefined, true) : null
  if (toml && appSecret) return { state: 'skip', note: 'Already deployed before — the app keeps its key and URL.' }
  if (toml && !appSecret) {
    throw new Error('This repo has an app on record but its key (MSCOMPUTER_APP_SECRET) is gone. Delete the MSCOMPUTER_TOML variable to start a fresh app with a new URL.')
  }
  const key = await call<{ key_id: string; key: string }>('GET', '/actions/secrets/public-key')
  await call('PUT', '/actions/secrets/SHIPYARD_SETUP_TOKEN', { encrypted_value: encryptSecret(token, key.key), key_id: key.key_id })
  return { state: 'done', note: 'Encrypted in your browser with the repo’s public key. Removed after the first deploy.' }
}

/** Finds the workflow run a commit (or a dispatch) started. */
export async function findRun(
  call: RepoCall,
  branch: string,
  commitSha: string | null,
  startedAt: number,
  sleep: (ms: number) => Promise<void>,
): Promise<number | null> {
  type Runs = { workflow_runs: { id: number; head_sha: string; event: string; created_at: string }[] }
  for (let i = 0; i < 20; i++) {
    const runs = await call<Runs>('GET', `/actions/workflows/ms-computer.yml/runs?branch=${encodeURIComponent(branch)}&per_page=5`)
    const run = runs.workflow_runs.find((r) =>
      commitSha
        ? r.head_sha === commitSha && r.event !== 'pull_request'
        : r.event === 'workflow_dispatch' && new Date(r.created_at).getTime() >= startedAt - 10_000,
    )
    if (run) return run.id
    await sleep(2500)
  }
  return null
}

export function initialSteps(): Step[] {
  return [
    { id: 'access', label: 'Check the token can write to the repo', state: 'todo' },
    { id: 'secret', label: 'Save a one-time setup secret', state: 'todo' },
    { id: 'workflow', label: `Commit ${WORKFLOW_PATH}`, state: 'todo' },
    { id: 'start', label: 'Start the deploy', state: 'todo' },
  ]
}

export async function oneClickDeploy(input: DeployInput, onUpdate: (steps: Step[]) => void): Promise<DeployResult> {
  const { owner, repo, branch, yaml, token, fetchImpl } = input
  const sleep = input.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const now = input.now ?? Date.now
  const steps = initialSteps()
  const set = (id: StepId, state: StepState, note?: string) => {
    const s = steps.find((x) => x.id === id)!
    s.state = state
    s.note = note
    onUpdate(steps.map((x) => ({ ...x })))
  }
  const call = repoCaller(owner, repo, token, fetchImpl)
  let current: StepId = 'access'
  const fail = (e: unknown, need: string): DeployResult => {
    set(current, 'error', explain(e, need))
    return { ok: false, runId: null, committed: false }
  }

  // 1 — access
  set('access', 'doing')
  try {
    const meta = await call<{ permissions?: { push?: boolean }; archived?: boolean }>('GET', '')
    if (meta.archived) throw new Error('This repo is archived, so nothing can be committed to it.')
    if (meta.permissions && meta.permissions.push === false) throw new Error('The token can only read this repo. It needs write access.')
    const br = await call('GET', `/branches/${encodeURIComponent(branch)}`, undefined, true)
    if (!br) throw new Error(`There’s no branch called “${branch}”.`)
  } catch (e) {
    return fail(e, 'read this repo')
  }
  set('access', 'done')

  // 2 — setup secret (first deploy only)
  current = 'secret'
  set('secret', 'doing')
  try {
    const r = await ensureSetupSecret(call, token)
    set('secret', r.state, r.note)
  } catch (e) {
    return fail(e, 'manage this repo’s Actions secrets and variables')
  }

  // 3 — workflow file
  current = 'workflow'
  set('workflow', 'doing')
  let commitSha: string | null = null
  const startedAt = now()
  try {
    const path = `/contents/${WORKFLOW_PATH}`
    const existing = await call<{ sha: string; content: string } | null>('GET', `${path}?ref=${encodeURIComponent(branch)}`, undefined, true)
    // the settings line at the top only records the inputs; if every step is the
    // same, there's nothing to commit — just start a run
    if (existing && sameSteps(fromBase64(existing.content), yaml)) {
      set('workflow', 'skip', 'Already up to date.')
    } else {
      const res = await call<{ commit: { sha: string } }>('PUT', path, {
        message: existing ? 'Update the ms.computer deploy workflow (Shipyard)' : 'Deploy to ms.computer on every push (Shipyard)',
        content: toBase64(yaml),
        branch,
        ...(existing ? { sha: existing.sha } : {}),
      })
      commitSha = res.commit.sha
      set('workflow', 'done', `Committed ${commitSha.slice(0, 7)} to ${branch}.`)
    }
  } catch (e) {
    return fail(e, 'commit workflow files (it needs the Contents and Workflows permissions)')
  }

  // 4 — start and find the run
  current = 'start'
  set('start', 'doing')
  try {
    if (!commitSha) {
      await call('POST', `/actions/workflows/ms-computer.yml/dispatches`, { ref: branch })
    }
    const runId = await findRun(call, branch, commitSha, startedAt, sleep)
    set('start', 'done', runId ? 'Running on GitHub Actions.' : 'Started — GitHub is still queueing it.')
    return { ok: true, runId, committed: Boolean(commitSha) }
  } catch (e) {
    return fail(e, 'start workflow runs (it needs the Actions permission)')
  }
}

/**
 * Fallback for workflows older than v3, which don't delete the setup token
 * themselves: after the first successful deploy the app's own key is saved, so the setup
 * secret (the user's token) has no job left. Remove it.
 */
export async function cleanUpSetupSecret(owner: string, repo: string, token: string, fetchImpl?: FetchLike): Promise<boolean> {
  const call = <T>(method: string, path: string) => gh<T>(method, `/repos/${owner}/${repo}${path}`, undefined, { token, fetchImpl, allow404: true })
  const [setup, appSecret] = await Promise.all([
    call('GET', '/actions/secrets/SHIPYARD_SETUP_TOKEN'),
    call('GET', '/actions/secrets/MSCOMPUTER_APP_SECRET'),
  ])
  if (!setup || !appSecret) return false
  await gh('DELETE', `/repos/${owner}/${repo}/actions/secrets/SHIPYARD_SETUP_TOKEN`, undefined, { token, fetchImpl })
  return true
}
