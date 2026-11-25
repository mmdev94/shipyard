import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch, loadSites, needsUpdate, updateWorkflow } from './sites.ts'
import { fromBase64, toBase64 } from './deploy.ts'
import { generateWorkflow, readWorkflowConfig, WORKFLOW_VERSION } from '../workflow.ts'

const TOKEN = 'github_pat_' + 'C'.repeat(40)
const V2 = generateWorkflow({ appName: 'blog', mode: 'static', branch: 'main', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.' })
const V1 = '# Deploys this repo to ms.computer on every push to main.\nname: Deploy to ms.computer\n'

const noSleep = async () => {}

function fake() {
  const calls: { method: string; path: string; body?: any }[] = []
  const files: Record<string, string | undefined> = { blog: V2, old: V1, plain: undefined }
  const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status })
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = url.replace('https://api.github.com', '')
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })
    if (path.startsWith('/user/repos')) {
      return json(200, ['blog', 'old', 'plain', 'archived'].map((name) => ({ name, owner: { login: 'me' }, html_url: `https://github.com/me/${name}`, default_branch: 'main', archived: name === 'archived', pushed_at: '' })))
    }
    const m = /^\/repos\/me\/(\w+)(.*)$/.exec(path)!
    const [, repo, rest] = m
    if (rest.startsWith('/contents/.github/workflows/ms-computer.yml')) {
      if (method === 'PUT') return json(200, { commit: { sha: 'new1234' } })
      return files[repo] === undefined ? json(404, {}) : json(200, { sha: `sha-${repo}`, content: toBase64(files[repo]!) })
    }
    if (rest.startsWith('/actions/workflows/ms-computer.yml/runs')) {
      const dispatched = calls.filter((c) => c.path.endsWith('/dispatches')).length
      const updated = calls.some((c) => c.method === 'PUT')
      const run = (id: number, sha: string, event: string) => ({ id, status: 'queued', conclusion: null, head_sha: sha, event, display_title: 't', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), html_url: '' })
      const runs = [
        ...(dispatched ? [run(100 + dispatched, 'abcdef123', 'workflow_dispatch')] : []),
        ...(updated ? [run(200, 'new1234', 'push')] : []),
        { ...run(1, 'abcdef123', 'push'), status: 'completed', conclusion: 'success', created_at: '2020-01-01T00:00:00Z' },
      ]
      return json(200, { workflow_runs: runs })
    }
    if (rest.startsWith('/deployments?')) return json(200, repo === 'blog' ? [{ id: 5, created_at: '' }] : [])
    if (rest.startsWith('/deployments/5/statuses')) return json(200, [{ state: 'success', environment_url: 'https://blog-a1234.ms.computer' }])
    if (method === 'POST' && rest === '/actions/workflows/ms-computer.yml/dispatches') return json(204)
    return json(500, { message: `no route ${method} ${path}` })
  }
  return { calls, fetchImpl }
}

test('lists only repos with the workflow, with version and live URL', async () => {
  const f = fake()
  const sites = await loadSites(TOKEN, f.fetchImpl)
  assert.deepEqual(sites.map((s) => s.repo), ['blog', 'old'])
  const [blog, old] = sites
  assert.equal(blog.version, WORKFLOW_VERSION)
  assert.equal(blog.liveUrl, 'https://blog-a1234.ms.computer')
  assert.equal(needsUpdate(blog), false)
  assert.equal(old.version, null)
  assert.equal(needsUpdate(old), true)
  assert.ok(!f.calls.some((c) => c.path.includes('/archived/')), 'archived repos are skipped')
})

test('dispatch sends the action input only to workflows that know it', async () => {
  const f = fake()
  const [blog, old] = await loadSites(TOKEN, f.fetchImpl)
  assert.equal(await dispatch(blog, 'take-down', TOKEN, f.fetchImpl, noSleep), 101, 'returns the run it started')
  assert.equal(await dispatch(old, 'deploy', TOKEN, f.fetchImpl, noSleep), 102)
  const sent = f.calls.filter((c) => c.path.endsWith('/dispatches')).map((c) => c.body)
  assert.deepEqual(sent, [{ ref: 'main', inputs: { action: 'take-down' } }, { ref: 'main' }])
  await assert.rejects(dispatch(old, 'take-down', TOKEN, f.fetchImpl, noSleep), /Update the workflow first/)
})

test('update rewrites the file from its embedded config, keeping the sha', async () => {
  const f = fake()
  const [blog] = await loadSites(TOKEN, f.fetchImpl)
  assert.equal(await updateWorkflow({ ...blog, version: 1 }, TOKEN, f.fetchImpl, noSleep), 200, 'returns the run the commit started')
  const put = f.calls.find((c) => c.method === 'PUT')!
  assert.equal(put.body.sha, 'sha-blog')
  assert.equal(readWorkflowConfig(fromBase64(put.body.content))?.config.appName, 'blog')
})
