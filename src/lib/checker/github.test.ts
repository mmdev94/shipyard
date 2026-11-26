import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchSnapshot, GitHubError, headCommit, needsConnect, readRepoFile } from './github.ts'
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
    if (url.includes('/commits/')) return new Response('c0ffee' + '0'.repeat(34))
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [], truncated: false }))
    return new Response(JSON.stringify({ default_branch: 'main', owner: { login: 'me' }, name: 'site' }))
  }
  await signIn('github_pat_' + 'E'.repeat(40), tokenOk as typeof fetch)
  await fetchSnapshot({ owner: 'me', repo: 'site' }, tokenOk as typeof fetch)
  assert.ok(seen.length === 3 && seen.every((a) => a === 'Bearer github_pat_' + 'E'.repeat(40)), String(seen.length))

  seen.length = 0
  const revoked = async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('Authorization')
    seen.push(auth)
    if (auth) return new Response('{}', { status: 401 })
    if (url.includes('/commits/')) return new Response('c0ffee' + '0'.repeat(34))
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [], truncated: false }))
    return new Response(JSON.stringify({ default_branch: 'main', owner: { login: 'me' }, name: 'site' }))
  }
  const snap = await fetchSnapshot({ owner: 'me', repo: 'site' }, revoked as typeof fetch)
  assert.equal(snap.branch, 'main')
  assert.ok(seen.includes(null), 'retried without the token')
  signOut()
})

test('a check is pinned to one commit: file list and contents both read at it, revalidated not re-downloaded', async () => {
  const SHA = 'abc123'.padEnd(40, '0')
  const asked: { url: string; cache?: RequestCache; accept: string | null }[] = []
  const f = async (url: string, init?: RequestInit) => {
    asked.push({ url, cache: init?.cache, accept: new Headers(init?.headers).get('Accept') })
    if (url.endsWith('/repos/me/site')) return new Response(JSON.stringify({ default_branch: 'main', owner: { login: 'me' }, name: 'site' }))
    if (url.endsWith('/repos/me/site/commits/main')) return new Response(SHA)
    if (url.includes(`/git/trees/${SHA}`)) return new Response(JSON.stringify({ tree: [{ path: 'src/a b.html', type: 'blob', size: 5 }], truncated: false }))
    if (url === `https://raw.githubusercontent.com/me/site/${SHA}/src/a%20b.html`) return new Response('hello')
    return new Response('{}', { status: 404 })
  }
  const snap = await fetchSnapshot({ owner: 'me', repo: 'site' }, f as typeof fetch)
  assert.equal(snap.commit, SHA)
  assert.equal(await snap.read('src/a b.html'), 'hello')
  assert.equal(asked.find((a) => a.url.endsWith('/commits/main'))?.accept, 'application/vnd.github.sha')
  assert.ok(asked.filter((a) => a.url.startsWith('https://api.github.com')).every((a) => a.cache === 'no-cache'), 'API reads revalidate (free when unchanged)')

  // re-checking a known repo skips the repo lookup
  asked.length = 0
  await fetchSnapshot({ owner: 'me', repo: 'site' }, f as typeof fetch, { owner: 'me', repo: 'site', branch: 'main' })
  assert.ok(!asked.some((a) => a.url.endsWith('/repos/me/site')))
  assert.equal(await headCommit('me', 'site', 'main', f as typeof fetch), SHA)
})

test('a private repo is read with the token through the API — never from the raw file server', async () => {
  const SHA = 'feed01'.padEnd(40, '0')
  const TOKEN = 'github_pat_' + 'P'.repeat(40)
  const asked: { url: string; auth: string | null; accept: string | null }[] = []
  const f = async (url: string, init?: RequestInit) => {
    const h = new Headers(init?.headers)
    asked.push({ url, auth: h.get('Authorization'), accept: h.get('Accept') })
    if (url.endsWith('/user')) return new Response(JSON.stringify({ login: 'me', avatar_url: '', html_url: '' }))
    if (url.endsWith('/repos/me/secret')) return new Response(JSON.stringify({ default_branch: 'main', owner: { login: 'me' }, name: 'secret', private: true }))
    if (url.endsWith('/commits/main')) return new Response(SHA)
    if (url.includes(`/git/trees/${SHA}`))
      return new Response(JSON.stringify({ tree: [{ path: 'index.html', type: 'blob', size: 5, sha: 'b10b' }, { path: 'gone.txt', type: 'blob', size: 3 }], truncated: false }))
    if (url.endsWith('/repos/me/secret/git/blobs/b10b')) return new Response('hello')
    return new Response('{}', { status: 404 })
  }
  await signIn(TOKEN, f as typeof fetch)
  const snap = await fetchSnapshot({ owner: 'me', repo: 'secret' }, f as typeof fetch)
  assert.equal(snap.private, true)
  assert.equal(await snap.read('index.html'), 'hello')
  assert.equal(await snap.read('gone.txt'), null)
  const blob = asked.find((a) => a.url.includes('/git/blobs/'))!
  assert.equal(blob.auth, `Bearer ${TOKEN}`)
  assert.equal(blob.accept, 'application/vnd.github.raw+json')
  assert.ok(!asked.some((a) => a.url.includes('raw.githubusercontent.com')), 'the token never goes to the raw file server')

  // the Fix it preview reads the same way
  asked.length = 0
  const read = await readRepoFile({ owner: 'me', repo: 'secret', branch: 'main', commit: SHA, private: true }, 'index.html', async (url, init) => {
    asked.push({ url, auth: new Headers(init?.headers).get('Authorization'), accept: null })
    return new Response('hi')
  })
  assert.equal(read, 'hi')
  assert.equal(asked[0].url, `https://api.github.com/repos/me/secret/contents/index.html?ref=${SHA}`)
  assert.equal(asked[0].auth, `Bearer ${TOKEN}`)

  // signed out: nothing is read
  signOut()
  assert.equal(await snap.read('index.html'), 'hello', 'already read stays')
  assert.equal(await readRepoFile({ owner: 'me', repo: 'secret', branch: 'main', private: true }, 'x', async () => new Response('no')), null)
})

test('a 404 explains private repos and how to get one checked', async () => {
  const err = await fetchSnapshot({ owner: 'me', repo: 'nope' }, async () => new Response('{}', { status: 404 })).catch((e) => e)
  assert.ok(err instanceof GitHubError)
  assert.match(err.message, /if it’s private, connect GitHub/)
  assert.ok(needsConnect(err))

  await signIn('github_pat_' + 'Q'.repeat(40), async () => new Response(JSON.stringify({ login: 'me', avatar_url: '', html_url: '' })))
  const err2 = await fetchSnapshot({ owner: 'me', repo: 'nope' }, async () => new Response('{}', { status: 404 })).catch((e) => e)
  assert.match(err2.message, /doesn’t include it/)
  assert.ok(!needsConnect(err2), 'already connected — the token just doesn’t cover it')
  signOut()
})
