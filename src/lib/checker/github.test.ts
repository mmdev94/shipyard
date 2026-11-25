import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchSnapshot, GitHubError } from './github.ts'
import { signIn, signOut } from '../github/client.ts'

const limited = () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } })

test('the hourly limit is explained as GitHub’s rule, with the reset time', async () => {
  const err = await fetchSnapshot({ owner: 'me', repo: 'site' }, async () => limited()).catch((e) => e)
  assert.ok(err instanceof GitHubError)
  assert.match(err.message, /GitHub allows 60 requests an hour/)
  assert.match(err.message, /GitHub’s own rule for its API — not a Shipyard or ms\.computer limit/)
  assert.match(err.message, /5,000/)
  assert.equal(err.rateLimitReset?.getTime(), 1800000000 * 1000)
})

test('checks use the connected token, and fall back to anonymous if it was revoked', async () => {
  const seen: (string | null)[] = []
  const tokenOk = async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('Authorization')
    if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'me', avatar_url: '', html_url: '' }))
    seen.push(auth)
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [], truncated: false }))
    return new Response(JSON.stringify({ default_branch: 'main', owner: { login: 'me' }, name: 'site' }))
  }
  await signIn('github_pat_' + 'E'.repeat(40), tokenOk as typeof fetch)
  await fetchSnapshot({ owner: 'me', repo: 'site' }, tokenOk as typeof fetch)
  assert.ok(seen.length === 2 && seen.every((a) => a === 'Bearer github_pat_' + 'E'.repeat(40)))

  seen.length = 0
  const revoked = async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('Authorization')
    seen.push(auth)
    if (auth) return new Response('{}', { status: 401 })
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [], truncated: false }))
    return new Response(JSON.stringify({ default_branch: 'main', owner: { login: 'me' }, name: 'site' }))
  }
  const snap = await fetchSnapshot({ owner: 'me', repo: 'site' }, revoked as typeof fetch)
  assert.equal(snap.branch, 'main')
  assert.ok(seen.includes(null), 'retried without the token')
  signOut()
})
