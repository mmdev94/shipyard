import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkFile, readStatement, sha256Hex, verifyCommand } from './provenance.ts'

const statement = {
  _type: 'https://in-toto.io/Statement/v1',
  predicate: {
    buildDefinition: {
      externalParameters: { workflow: { path: '.github/workflows/ms-computer.yml', ref: 'refs/heads/main' } },
      resolvedDependencies: [{ uri: 'git+https://github.com/me/site@refs/heads/main', digest: { gitCommit: 'abc1234def' } }],
    },
    runDetails: { metadata: { invocationId: 'https://github.com/me/site/actions/runs/9/attempts/1' } },
  },
}
const bundle = { dsseEnvelope: { payload: btoa(JSON.stringify(statement)) } }

test('reads commit, run and workflow from a signed statement', () => {
  assert.deepEqual(readStatement(bundle), {
    commit: 'abc1234def',
    runUrl: 'https://github.com/me/site/actions/runs/9/attempts/1',
    workflow: '.github/workflows/ms-computer.yml',
  })
  assert.deepEqual(readStatement({}), {})
  assert.deepEqual(readStatement({ dsseEnvelope: { payload: 'not base64 json' } }), {})
})

test('hashes the served bytes and looks the hash up on GitHub', async () => {
  const body = new TextEncoder().encode('console.log("hi")')
  const sha = await sha256Hex(body.buffer as ArrayBuffer)
  const asked: string[] = []
  const fetchImpl = (async (url: string) => {
    asked.push(url)
    if (url === '/assets/index.js') return new Response(body)
    if (url.endsWith(`/attestations/sha256:${sha}`)) return new Response(JSON.stringify({ attestations: [{ bundle }] }))
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  const ok = await checkFile('me/site', '/assets/index.js', fetchImpl)
  assert.equal(ok.state, 'signed')
  assert.equal(ok.commit, 'abc1234def')
  assert.equal(asked[1], `https://api.github.com/repos/me/site/attestations/sha256:${sha}`)

  const tampered = await checkFile('me/site', '/assets/index.js', (async (url: string) =>
    url === '/assets/index.js' ? new Response('console.log("evil")') : new Response('{}', { status: 404 })) as typeof fetch)
  assert.equal(tampered.state, 'unsigned')
})

test('the terminal check names the file and repo', () => {
  assert.equal(verifyCommand('https://x.ms.computer', '/assets/index-a.js', 'me/site'), 'curl -so index-a.js https://x.ms.computer/assets/index-a.js && gh attestation verify index-a.js -R me/site')
  assert.match(verifyCommand('https://x.ms.computer', '/', 'me/site'), /-so index.html https:\/\/x.ms.computer\/ /)
})
