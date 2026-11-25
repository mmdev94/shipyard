import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadHistory, shortTitle } from './track.ts'

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40)

function stubFetch(latestState: string) {
  const seen: string[] = []
  globalThis.fetch = (async (url: string) => {
    seen.push(url)
    const path = url.replace('https://api.github.com', '')
    const json = (b: unknown) => new Response(JSON.stringify(b))
    if (path.startsWith('/repos/me/blog/deployments?')) {
      return json([
        { id: 3, sha: A, created_at: '2026-11-25T10:00:00Z', description: 'Rolled back by Shipyard' },
        { id: 2, sha: B, created_at: '2026-11-24T10:00:00Z', description: 'Deployed by Shipyard' },
        { id: 1, sha: C, created_at: '2026-11-23T10:00:00Z', description: 'Deployed by Shipyard' },
      ])
    }
    if (path.startsWith('/repos/me/blog/deployments/3/statuses')) return json([{ state: latestState }])
    if (path.startsWith('/repos/me/blog/commits?')) {
      return json([
        { sha: B, commit: { message: 'New header\n\nlong body', author: { name: 'Me' } }, author: { login: 'me' } },
        { sha: A, commit: { message: 'Old header', author: { name: 'Me' } }, author: null },
      ])
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return seen
}

test('history: newest first, rollbacks marked, messages from the branch', async () => {
  const seen = stubFetch('success')
  const h = await loadHistory('me', 'blog', 'main')
  assert.equal(h.headSha, B)
  assert.deepEqual(
    h.records.map((r) => [r.id, r.live, r.rollback, r.message, r.author]),
    [
      [3, true, true, 'Old header', 'Me'],
      [2, false, false, 'New header', 'me'],
      [1, false, false, null, null],
    ],
  )
  assert.ok(seen.some((u) => u.includes('/commits?per_page=50&sha=main')))
})

test('history: a taken-down site has nothing live', async () => {
  stubFetch('inactive')
  const h = await loadHistory('me', 'blog', null)
  assert.equal(h.records[0].live, false)
  assert.equal(h.records[0].takenDown, true)
})

test('run titles shorten full SHAs', () => {
  assert.equal(shortTitle(`Roll back to ${A}`), 'Roll back to aaaaaaa')
  assert.equal(shortTitle('Fix header'), 'Fix header')
})

test('previews: newest record per PR, with whether it is still up', async () => {
  globalThis.fetch = (async (url: string) => {
    const path = url.replace('https://api.github.com', '')
    const json = (b: unknown) => new Response(JSON.stringify(b))
    if (path.startsWith('/repos/me/blog/deployments?environment=ms-computer-preview')) {
      return json([
        { id: 30, sha: A, created_at: '2026-11-25T12:00:00Z', payload: { pr: 7, identity: 'xx' } },
        { id: 29, sha: B, created_at: '2026-11-25T11:00:00Z', payload: { pr: 8 } },
        { id: 28, sha: C, created_at: '2026-11-25T10:00:00Z', payload: { pr: 7 } },
        { id: 27, sha: C, created_at: '2026-11-25T09:00:00Z', payload: null },
      ])
    }
    if (path.startsWith('/repos/me/blog/deployments/30/statuses')) return json([{ state: 'success', environment_url: 'https://blog-pr-7-a1.ms.computer' }])
    if (path.startsWith('/repos/me/blog/deployments/29/statuses')) return json([{ state: 'inactive', environment_url: '' }])
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  const { loadPreviews } = await import('./track.ts')
  const p = await loadPreviews('me', 'blog')
  assert.deepEqual(
    p.map((x) => [x.pr, x.state, x.url, x.sha.slice(0, 1)]),
    [
      [7, 'live', 'https://blog-pr-7-a1.ms.computer', 'a'],
      [8, 'down', null, 'b'],
    ],
  )
})
