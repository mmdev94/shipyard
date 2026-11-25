import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activitySnapshot, clearActivity, describe } from './activity.ts'
import { gh } from './client.ts'

test('describes calls in plain words', () => {
  assert.equal(describe('PUT', '/repos/me/blog/actions/secrets/SHIPYARD_SETUP_TOKEN'), 'Saved the encrypted secret SHIPYARD_SETUP_TOKEN in me/blog')
  assert.equal(describe('DELETE', '/repos/me/blog/actions/secrets/SHIPYARD_SETUP_TOKEN'), 'Deleted the secret SHIPYARD_SETUP_TOKEN from me/blog')
  assert.match(describe('GET', '/repos/me/blog/actions/secrets/MSCOMPUTER_APP_SECRET'), /never returns secret values/)
  assert.equal(describe('PUT', '/repos/me/blog/contents/.github/workflows/ms-computer.yml'), 'Committed .github/workflows/ms-computer.yml to me/blog')
  assert.equal(describe('POST', '/repos/me/blog/actions/workflows/ms-computer.yml/dispatches'), 'Started the deploy workflow in me/blog')
  assert.equal(describe('GET', '/user'), 'Read your GitHub username and avatar')
  assert.equal(describe('GET', '/repos/me/blog/actions/workflows/ms-computer.yml/runs?branch=main&per_page=5'), 'Checked me/blog’s deploy runs')
})

test('every call made with a token is logged; repeated reads fold into one line', async () => {
  clearActivity()
  const fetchImpl = async () => new Response('{}', { status: 200 })
  const t = { token: 'github_pat_x', fetchImpl }
  await gh('GET', '/repos/me/blog/deployments?environment=ms-computer&per_page=1', undefined, t)
  await gh('GET', '/repos/me/blog/actions/workflows/ms-computer.yml/runs?per_page=1', undefined, t)
  await gh('GET', '/repos/me/blog/deployments?environment=ms-computer&per_page=1', undefined, t)
  await gh('PUT', '/repos/me/blog/actions/secrets/X', {}, t)
  await gh('PUT', '/repos/me/blog/actions/secrets/X', {}, t)
  await gh('GET', '/repos/me/blog', undefined, { token: null, fetchImpl }) // no token: nothing to log
  const log = activitySnapshot()
  assert.deepEqual(
    log.map((e) => [e.method, e.path.split('?')[0], e.count]),
    [
      ['PUT', '/repos/me/blog/actions/secrets/X', 1],
      ['PUT', '/repos/me/blog/actions/secrets/X', 1],
      ['GET', '/repos/me/blog/deployments', 2],
      ['GET', '/repos/me/blog/actions/workflows/ms-computer.yml/runs', 1],
    ],
    'writes are never folded; the repeated read moved up with ×2',
  )
  clearActivity()
  assert.equal(activitySnapshot().length, 0)
})
