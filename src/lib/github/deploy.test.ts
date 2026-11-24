import { test } from 'node:test'
import assert from 'node:assert/strict'
import sodium from 'libsodium-wrappers'
import { cleanUpSetupSecret, fromBase64, oneClickDeploy, toBase64, type Step } from './deploy.ts'
import { signIn, GhError } from './client.ts'

const TOKEN = 'github_pat_' + 'A'.repeat(40)

/** A tiny in-memory GitHub: enough of the REST API for the deploy flow. */
async function fakeGitHub(opts: { push?: boolean; vars?: Record<string, string>; secrets?: string[]; file?: string; deny?: RegExp } = {}) {
  await sodium.ready
  const kp = sodium.crypto_box_keypair()
  const state = {
    vars: { ...(opts.vars ?? {}) } as Record<string, string>,
    secrets: new Map<string, string>((opts.secrets ?? []).map((s) => [s, 'x'])),
    file: opts.file ?? null as string | null,
    runs: [] as { id: number; head_sha: string; event: string; created_at: string }[],
    calls: [] as string[],
  }
  const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status })
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.replace('https://api.github.com', '')
    state.calls.push(`${method} ${path}`)
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`)
    if (opts.deny?.test(`${method} ${path}`)) return json(403, { message: 'Resource not accessible by personal access token' })
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const r = path.replace(/^\/repos\/me\/site/, '')
    if (path === '/user') return json(200, { login: 'me', avatar_url: '', html_url: '' })
    if (method === 'GET' && r === '') return json(200, { permissions: { push: opts.push ?? true }, archived: false })
    if (method === 'GET' && r === '/branches/main') return json(200, { name: 'main' })
    if (method === 'GET' && r.startsWith('/branches/')) return json(404, { message: 'Branch not found' })
    let m = /^\/actions\/variables\/(\w+)$/.exec(r)
    if (method === 'GET' && m) return m[1] in state.vars ? json(200, { name: m[1], value: state.vars[m[1]] }) : json(404, {})
    if (method === 'GET' && r === '/actions/secrets/public-key') return json(200, { key_id: 'k1', key: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL) })
    m = /^\/actions\/secrets\/(\w+)$/.exec(r)
    if (m && method === 'GET') return state.secrets.has(m[1]) ? json(200, { name: m[1] }) : json(404, {})
    if (m && method === 'PUT') {
      assert.equal(body.key_id, 'k1')
      const opened = sodium.crypto_box_seal_open(sodium.from_base64(body.encrypted_value, sodium.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey)
      state.secrets.set(m[1], new TextDecoder().decode(opened))
      return json(201)
    }
    if (m && method === 'DELETE') {
      state.secrets.delete(m[1])
      return json(204)
    }
    if (r.startsWith('/contents/.github/workflows/ms-computer.yml')) {
      if (method === 'GET') return state.file === null ? json(404, {}) : json(200, { sha: 'f1', content: toBase64(state.file).replace(/(.{60})/g, '$1\n') })
      if (method === 'PUT') {
        assert.equal(body.branch, 'main')
        if (state.file !== null) assert.equal(body.sha, 'f1')
        state.file = fromBase64(body.content)
        state.runs.unshift({ id: 101, head_sha: 'c0ffee1234', event: 'push', created_at: new Date().toISOString() })
        return json(201, { commit: { sha: 'c0ffee1234' } })
      }
    }
    if (method === 'POST' && r === '/actions/workflows/ms-computer.yml/dispatches') {
      assert.deepEqual(body, { ref: 'main' })
      state.runs.unshift({ id: 202, head_sha: 'old', event: 'workflow_dispatch', created_at: new Date().toISOString() })
      return json(204)
    }
    if (method === 'GET' && r.startsWith('/actions/workflows/ms-computer.yml/runs')) return json(200, { workflow_runs: state.runs })
    return json(500, { message: `fake GitHub has no route for ${method} ${path}` })
  }
  return { state, fetchImpl }
}

const YAML = 'name: Deploy to ms.computer\n# — unicode survives → ✓\n'
const run = (gh: Awaited<ReturnType<typeof fakeGitHub>>, extra: Partial<Parameters<typeof oneClickDeploy>[0]> = {}) => {
  const updates: Step[][] = []
  return oneClickDeploy(
    { owner: 'me', repo: 'site', branch: 'main', yaml: YAML, token: TOKEN, fetchImpl: gh.fetchImpl, sleep: async () => {}, ...extra },
    (s) => updates.push(s),
  ).then((res) => ({ res, last: updates.at(-1)! }))
}

test('first deploy: saves the encrypted setup secret, commits the workflow, finds the run', async () => {
  const g = await fakeGitHub()
  const { res, last } = await run(g)
  assert.deepEqual(res, { ok: true, runId: 101, committed: true })
  assert.equal(g.state.secrets.get('SHIPYARD_SETUP_TOKEN'), TOKEN, 'libsodium opens what the browser sealed')
  assert.equal(g.state.file, YAML)
  assert.deepEqual(last.map((s) => s.state), ['done', 'done', 'done', 'done'])
})

test('redeploy with an unchanged workflow: no secret, no commit, dispatches instead', async () => {
  const g = await fakeGitHub({ vars: { MSCOMPUTER_TOML: 'key = "a"' }, secrets: ['MSCOMPUTER_APP_SECRET'], file: YAML })
  const { res, last } = await run(g)
  assert.deepEqual(res, { ok: true, runId: 202, committed: false })
  assert.ok(!g.state.secrets.has('SHIPYARD_SETUP_TOKEN'))
  assert.deepEqual(last.map((s) => s.state), ['done', 'skip', 'skip', 'done'])
})

test('changed workflow on an existing app updates the file with its sha', async () => {
  const g = await fakeGitHub({ vars: { MSCOMPUTER_TOML: 'key = "a"' }, secrets: ['MSCOMPUTER_APP_SECRET'], file: 'old: true\n' })
  const { res } = await run(g)
  assert.equal(res.committed, true)
  assert.equal(g.state.file, YAML)
})

test('read-only token stops at the first step', async () => {
  const g = await fakeGitHub({ push: false })
  const { res, last } = await run(g)
  assert.equal(res.ok, false)
  assert.equal(last[0].state, 'error')
  assert.match(last[0].note!, /needs write access/)
  assert.ok(!g.state.calls.some((c) => c.startsWith('PUT')), 'nothing written')
})

test('missing branch and missing permissions give readable errors', async () => {
  const g1 = await fakeGitHub()
  const r1 = await run(g1, { branch: 'nope' })
  assert.match(r1.last[0].note!, /no branch called “nope”/)

  const g2 = await fakeGitHub({ deny: /^PUT \/repos\/me\/site\/contents/ })
  const r2 = await run(g2)
  assert.equal(r2.last[2].state, 'error')
  assert.match(r2.last[2].note!, /Workflows permission/)
})

test('an app whose key went missing is not silently recreated', async () => {
  const g = await fakeGitHub({ vars: { MSCOMPUTER_TOML: 'key = "a"' } })
  const { res, last } = await run(g)
  assert.equal(res.ok, false)
  assert.match(last[1].note!, /MSCOMPUTER_APP_SECRET/)
})

test('cleanup deletes the setup secret only once the app key exists', async () => {
  const g = await fakeGitHub({ secrets: ['SHIPYARD_SETUP_TOKEN'] })
  assert.equal(await cleanUpSetupSecret('me', 'site', TOKEN, g.fetchImpl), false)
  assert.ok(g.state.secrets.has('SHIPYARD_SETUP_TOKEN'))
  g.state.secrets.set('MSCOMPUTER_APP_SECRET', 'x')
  assert.equal(await cleanUpSetupSecret('me', 'site', TOKEN, g.fetchImpl), true)
  assert.ok(!g.state.secrets.has('SHIPYARD_SETUP_TOKEN'))
})

test('signIn rejects things that are not tokens before calling GitHub', async () => {
  await assert.rejects(signIn('hello'), (e: unknown) => e instanceof GhError && /doesn’t look like a GitHub token/.test(e.message))
  const g = await fakeGitHub()
  assert.equal((await signIn(TOKEN, g.fetchImpl)).login, 'me')
})
