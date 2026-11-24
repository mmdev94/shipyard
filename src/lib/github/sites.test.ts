import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatch, loadSites, needsUpdate, updateWorkflow } from './sites.ts'
import { fromBase64, toBase64 } from './deploy.ts'
import { generateWorkflow, readWorkflowConfig, WORKFLOW_VERSION } from '../workflow.ts'

const TOKEN = 'github_pat_' + 'C'.repeat(40)
const V2 = generateWorkflow({ appName: 'blog', mode: 'static', branch: 'main', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.' })
const V1 = '# Deploys this repo to ms.computer on every push to main.\nname: Deploy to ms.computer\n'

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
    if (rest.startsWith('/actions/workflows/ms-computer.yml/runs')) return json(200, { workflow_runs: [{ id: 1, status: 'completed', conclusion: 'success', head_sha: 'abcdef123', display_title: 't', updated_at: new Date().toISOString(), html_url: '' }] })
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
  await dispatch(blog, 'take-down', TOKEN, f.fetchImpl)
  await dispatch(old, 'deploy', TOKEN, f.fetchImpl)
  const sent = f.calls.filter((c) => c.path.endsWith('/dispatches')).map((c) => c.body)
  assert.deepEqual(sent, [{ ref: 'main', inputs: { action: 'take-down' } }, { ref: 'main' }])
  await assert.rejects(dispatch(old, 'take-down', TOKEN, f.fetchImpl), /Update the workflow first/)
})

test('update rewrites the file from its embedded config, keeping the sha', async () => {
  const f = fake()
  const [blog] = await loadSites(TOKEN, f.fetchImpl)
  await updateWorkflow({ ...blog, version: 1 }, TOKEN, f.fetchImpl)
  const put = f.calls.find((c) => c.method === 'PUT')!
  assert.equal(put.body.sha, 'sha-blog')
  assert.equal(readWorkflowConfig(fromBase64(put.body.content))?.config.appName, 'blog')
})
