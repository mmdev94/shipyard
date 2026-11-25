import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openFixPr } from './fixpr.ts'
import { toBase64 } from './deploy.ts'
import { availableFixes } from '../fixes.ts'
import type { Report } from '../checker/types.ts'

const TOKEN = 'github_pat_' + 'D'.repeat(40)
const report = {
  repo: { owner: 'me', repo: 'site', branch: 'main', url: '' },
  detection: { framework: 'vite', workingDir: '.' },
  findings: [],
  verdict: { kind: 'fix' },
  scanned: { files: 0, totalFiles: 0, truncated: false },
  paths: ['.env', 'index.html'],
} as unknown as Report
const fix = availableFixes(report)[0]

function fake(opts: { push?: boolean; branchTaken?: boolean; env?: string | null } = {}) {
  const calls: { method: string; path: string; body?: any }[] = []
  const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status })
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.replace('https://api.github.com/repos/me/site', '')
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })
    if (path === '') return json(200, { permissions: { push: opts.push ?? true } })
    if (path === '/git/ref/heads/main') return json(200, { object: { sha: 'head1' } })
    if (path === '/contents/.env?ref=head1') return opts.env === null ? json(404, {}) : json(200, { content: toBase64(opts.env ?? 'KEY=1'), encoding: 'base64' })
    if (path === '/contents/.gitignore?ref=head1') return json(200, { content: toBase64('dist\n'), encoding: 'base64' })
    if (path === '/git/commits/head1') return json(200, { tree: { sha: 'tree0' } })
    if (method === 'POST' && path === '/git/trees') return json(201, { sha: 'tree1' })
    if (method === 'POST' && path === '/git/commits') return json(201, { sha: 'commit1' })
    if (method === 'POST' && path === '/git/refs') {
      const taken = opts.branchTaken && body.ref === 'refs/heads/shipyard/remove-env-files'
      return taken ? json(422, { message: 'Reference already exists' }) : json(201, {})
    }
    if (method === 'POST' && path === '/pulls') return json(201, { html_url: 'https://github.com/me/site/pull/4', number: 4 })
    return json(500, { message: `no route ${method} ${path}` })
  }
  return { calls, fetchImpl }
}

test('opens a PR from a fresh branch with one commit, reading files at the current head', async () => {
  const f = fake()
  const r = await openFixPr({ owner: 'me', repo: 'site', branch: 'main', token: TOKEN, fix, fetchImpl: f.fetchImpl })
  assert.equal(r.number, 4)
  const tree = f.calls.find((c) => c.path === '/git/trees')!.body
  assert.equal(tree.base_tree, 'tree0')
  assert.deepEqual(tree.tree.map((e: any) => [e.path, e.sha === null ? 'delete' : 'write']), [['.env', 'delete'], ['.gitignore', 'write']])
  assert.deepEqual(f.calls.find((c) => c.path === '/git/commits' && c.method === 'POST')!.body.parents, ['head1'])
  const pr = f.calls.find((c) => c.path === '/pulls')!.body
  assert.deepEqual([pr.head, pr.base, pr.title], ['shipyard/remove-env-files', 'main', 'Remove committed .env files'])
  assert.ok(!f.calls.some((c) => c.method === 'PATCH' || c.path.startsWith('/git/refs/heads/main')), 'never writes to the base branch')
})

test('an existing fix branch gets a suffix instead of being overwritten', async () => {
  const f = fake({ branchTaken: true })
  await openFixPr({ owner: 'me', repo: 'site', branch: 'main', token: TOKEN, fix, fetchImpl: f.fetchImpl })
  const refs = f.calls.filter((c) => c.path === '/git/refs').map((c) => c.body.ref)
  assert.equal(refs.length, 2)
  assert.match(refs[1], /^refs\/heads\/shipyard\/remove-env-files-[a-z0-9]+$/)
  assert.equal(f.calls.find((c) => c.path === '/pulls')!.body.head, refs[1].replace('refs/heads/', ''))
})

test('read-only tokens and already-fixed repos stop before writing anything', async () => {
  const ro = fake({ push: false })
  await assert.rejects(openFixPr({ owner: 'me', repo: 'site', branch: 'main', token: TOKEN, fix, fetchImpl: ro.fetchImpl }), /only read this repo/)
  assert.ok(!ro.calls.some((c) => c.method !== 'GET'))
  const fixed = fake({ env: null })
  // .env gone already, and .gitignore still needs the block → only .gitignore changes; still a PR
  const r = await openFixPr({ owner: 'me', repo: 'site', branch: 'main', token: TOKEN, fix, fetchImpl: fixed.fetchImpl })
  assert.deepEqual(r.changes.map((c) => c.path), ['.gitignore'])
})
