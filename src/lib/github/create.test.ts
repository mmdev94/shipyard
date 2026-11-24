import { test } from 'node:test'
import assert from 'node:assert/strict'
import sodium from 'libsodium-wrappers'
import { createFromTemplate } from './create.ts'
import { fromBase64, type Step } from './deploy.ts'

const TOKEN = 'github_pat_' + 'B'.repeat(40)

async function fakeRepo(initial: 'missing' | 'empty' | Record<string, string>) {
  await sodium.ready
  const kp = sodium.crypto_box_keypair()
  let head: string | null = null
  const commits = new Map<string, { tree: Record<string, string>; parents: string[] }>()
  const trees = new Map<string, Record<string, string>>()
  const secrets = new Map<string, string>()
  let n = 0
  const id = (p: string) => `${p}${++n}`.padEnd(12, '0')
  if (initial !== 'missing' && initial !== 'empty') {
    const t = id('t'); trees.set(t, initial)
    head = id('c'); commits.set(head, { tree: initial, parents: [] })
  }
  const runs: { id: number; head_sha: string; event: string; created_at: string }[] = []
  const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status })
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const r = url.replace('https://api.github.com/repos/me/new-site', '')
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (initial === 'missing') return json(404, { message: 'Not Found' })
    if (method === 'GET' && r === '') return json(200, { default_branch: 'main', permissions: { push: true } })
    if (method === 'GET' && r === '/git/ref/heads/main') return head ? json(200, { object: { sha: head } }) : json(409, { message: 'Git Repository is empty.' })
    let m = /^\/git\/trees\/(\w+)\?recursive=1$/.exec(r)
    if (method === 'GET' && m) return json(200, { tree: Object.keys(commits.get(m[1])!.tree).map((path) => ({ path, type: 'blob' })) })
    if (method === 'GET' && /\/actions\/variables\//.test(r)) return json(404, {})
    if (method === 'GET' && r === '/actions/secrets/public-key') return json(200, { key_id: 'k', key: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL) })
    m = /^\/actions\/secrets\/(\w+)$/.exec(r)
    if (m && method === 'GET') return secrets.has(m[1]) ? json(200, {}) : json(404, {})
    if (m && method === 'PUT') {
      secrets.set(m[1], new TextDecoder().decode(sodium.crypto_box_seal_open(sodium.from_base64(body.encrypted_value, sodium.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey)))
      return json(201)
    }
    if (method === 'PUT' && r === '/contents/README.md') {
      assert.equal(head, null, 'Contents API only used for the very first commit')
      head = id('c'); commits.set(head, { tree: { 'README.md': fromBase64(body.content) }, parents: [] })
      return json(201, { commit: { sha: head } })
    }
    m = /^\/git\/commits\/(\w+)$/.exec(r)
    if (method === 'GET' && m) { const t = id('t'); trees.set(t, commits.get(m[1])!.tree); return json(200, { tree: { sha: t } }) }
    if (method === 'POST' && r === '/git/trees') {
      const t = id('t')
      trees.set(t, { ...trees.get(body.base_tree), ...Object.fromEntries(body.tree.map((e: { path: string; content: string }) => [e.path, e.content])) })
      return json(201, { sha: t })
    }
    if (method === 'POST' && r === '/git/commits') { const c = id('c'); commits.set(c, { tree: trees.get(body.tree)!, parents: body.parents }); return json(201, { sha: c }) }
    if (method === 'PATCH' && r === '/git/refs/heads/main') {
      assert.equal(commits.get(body.sha)!.parents[0], head, 'fast-forward from the current head')
      head = body.sha
      runs.unshift({ id: 9, head_sha: body.sha, event: 'push', created_at: new Date().toISOString() })
      return json(200, {})
    }
    if (method === 'GET' && r.startsWith('/actions/workflows/ms-computer.yml/runs')) return json(200, { workflow_runs: runs })
    return json(500, { message: `no route ${method} ${r}` })
  }
  return { fetchImpl, secrets, files: () => (head ? commits.get(head)!.tree : {}) }
}

const FILES = { 'README.md': '# Mine\n', 'index.html': '<h1>hi</h1>\n', '.github/workflows/ms-computer.yml': 'name: x\n' }
const go = (g: Awaited<ReturnType<typeof fakeRepo>>) => {
  const seen: Step[][] = []
  return createFromTemplate({ owner: 'me', repo: 'new-site', token: TOKEN, makeFiles: (b) => (assert.equal(b, 'main'), FILES), fetchImpl: g.fetchImpl, sleep: async () => {} }, (s) => seen.push(s)).then((res) => ({ res, last: seen.at(-1)! }))
}

test('empty repo: first commit via Contents API, then every file in one commit', async () => {
  const g = await fakeRepo('empty')
  const { res, last } = await go(g)
  assert.deepEqual(res, { ok: true, runId: 9, branch: 'main' })
  assert.deepEqual(g.files(), FILES)
  assert.equal(g.secrets.get('SHIPYARD_SETUP_TOKEN'), TOKEN)
  assert.deepEqual(last.map((s) => s.state), ['done', 'done', 'done', 'done'])
})

test('repo GitHub created with a README and LICENSE: replaced and kept', async () => {
  const g = await fakeRepo({ 'README.md': '# auto\n', LICENSE: 'MIT' })
  const { res } = await go(g)
  assert.equal(res.ok, true)
  assert.equal(g.files()['README.md'], '# Mine\n')
  assert.equal(g.files().LICENSE, 'MIT')
})

test('a repo with real code is never overwritten', async () => {
  const g = await fakeRepo({ 'README.md': 'x', 'src/app.js': 'x' })
  const { res, last } = await go(g)
  assert.equal(res.ok, false)
  assert.match(last[0].note!, /already has files \(src\/app\.js/)
  assert.ok(!g.secrets.size, 'nothing written')
})

test('missing repo explains what to do', async () => {
  const g = await fakeRepo('missing')
  const { last } = await go(g)
  assert.match(last[0].note!, /Create it first/)
})
