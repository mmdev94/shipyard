import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayName, loadShowcase, msUrl } from './showcase.ts'

test('only ms.computer addresses count as a live site', () => {
  assert.equal(msUrl('https://blog-a1234.ms.computer/'), 'https://blog-a1234.ms.computer')
  assert.equal(msUrl(' https://blog-a1234.ms.computer '), 'https://blog-a1234.ms.computer')
  assert.equal(msUrl('https://blog.vercel.app'), null)
  assert.equal(msUrl('https://evil.com/?x=.ms.computer'), null)
  assert.equal(msUrl('http://blog-a1234.ms.computer'), null)
  assert.equal(msUrl(null), null)
})

test('lists tagged repos: Website first, else the Shipyard deploy record; live ones first', async () => {
  const asked: string[] = []
  globalThis.fetch = (async (url: string) => {
    asked.push(url)
    const path = url.replace('https://api.github.com', '')
    const json = (b: unknown) => new Response(JSON.stringify(b))
    const item = (name: string, homepage: string | null) => ({
      name, owner: { login: 'me', avatar_url: 'https://avatars.githubusercontent.com/u/1' }, description: `${name} desc`,
      html_url: `https://github.com/me/${name}`, homepage, stargazers_count: 2, pushed_at: '2026-11-25T00:00:00Z', language: 'TypeScript', archived: false,
    })
    if (path.startsWith('/search/repositories')) {
      return json({ items: [item('nothing', null), item('home', 'https://home-b1.ms.computer'), item('shipyarded', ''), item('limited', null)] })
    }
    if (path.startsWith('/repos/me/shipyarded/deployments?')) return json([{ id: 7, sha: 'x', created_at: '2026-11-25T00:00:00Z' }])
    if (path.startsWith('/repos/me/shipyarded/deployments/7/statuses')) return json([{ state: 'success', environment_url: 'https://shipyarded-c2.ms.computer/' }])
    if (path.startsWith('/repos/me/nothing/deployments?')) return json([])
    if (path.startsWith('/repos/me/limited/deployments?')) return new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
    return new Response('{}', { status: 404 })
  }) as typeof fetch

  const list = await loadShowcase()
  assert.deepEqual(
    list.map((l) => [l.repo, l.url, l.viaShipyard, l.unchecked]),
    [
      ['home', 'https://home-b1.ms.computer', false, false],
      ['shipyarded', 'https://shipyarded-c2.ms.computer', true, false],
      ['nothing', null, false, false],
      ['limited', null, false, true],
    ],
  )
  assert.match(decodeURIComponent(asked[0]), /q=topic:ms-computer archived:false&sort=updated/)
  assert.ok(!asked.some((u) => u.includes('/repos/me/home/')), 'no lookups for repos that state their Website')
})

test('display names', () => assert.equal(displayName('my_cool-site'), 'my cool site'))
