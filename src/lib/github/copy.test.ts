import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asText, buttonMarkdown, copyConfig, copyFiles, LIMITS, planCopy, toBase64Bytes, type SourceEntry } from './copy.ts'
import { generateWorkflow } from '../workflow.ts'
import type { Report } from '../checker/types.ts'

const SHA = 'c0de'.padEnd(40, '0')
const blob = (path: string, size = 10, mode = '100644'): SourceEntry => ({ path, mode, type: 'blob', sha: `s-${path}`, size })

test('the plan leaves out workflows, secrets, symlinks and submodules — and says why', () => {
  const plan = planCopy('them', 'site', SHA, [
    blob('index.html'),
    blob('.env'),
    blob('app/.env.production'),
    blob('.env.example'),
    blob('.github/workflows/ci.yml'),
    blob('.github/dependabot.yml'),
    blob('link', 5, '120000'),
    { path: 'vendor/lib', mode: '160000', type: 'commit', sha: 'x' },
    { path: 'src', mode: '040000', type: 'tree', sha: 'y' },
    blob('huge.bin', LIMITS.fileBytes + 1),
  ])
  assert.deepEqual(plan.files.map((f) => f.path), ['index.html', '.env.example', '.github/dependabot.yml'])
  assert.deepEqual(plan.skipped.map((s) => s.path).sort(), ['.env', '.github/workflows/ci.yml', 'app/.env.production', 'huge.bin', 'link', 'vendor/lib'])
  assert.match(plan.skipped.find((s) => s.path === '.env')!.why, /secrets are never copied/)
  assert.equal(plan.bytes, 30)
})

test('too big to copy from a browser: a clear message, not a half copy', () => {
  assert.throws(() => planCopy('them', 'big', SHA, [blob('a', 1)], true), /too many files/)
  assert.throws(() => planCopy('them', 'big', SHA, Array.from({ length: LIMITS.files + 1 }, (_, i) => blob(`f${i}`, 1))), /too big to copy/)
  assert.throws(() => planCopy('them', 'big', SHA, [blob('a', LIMITS.fileBytes), blob('b', LIMITS.fileBytes), blob('c', LIMITS.fileBytes)]), /too big to copy/)
})

test('text is kept byte for byte (BOM, CRLF); anything else is binary', () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69, 0x0d, 0x0a])
  assert.equal(asText(bom), '﻿hi\r\n')
  assert.equal(new TextEncoder().encode(asText(bom)!).length, bom.length)
  assert.equal(asText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00])), null)
  assert.equal(asText(new Uint8Array([0xff, 0xfe, 0x41])), null)
  assert.equal(toBase64Bytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 'iVBORw==')
})

test('copying reads each file at the commit; text inline, binary uploaded, failures retried', async () => {
  const plan = planCopy('them', 'site', SHA, [blob('index.html'), blob('img/a b.png'), blob('run.sh', 4, '100755')])
  const asked: string[] = []
  let flaky = 1
  const fetchImpl = async (url: string) => {
    asked.push(url)
    if (url.endsWith('/index.html')) return flaky-- > 0 ? new Response('busy', { status: 502 }) : new Response('<h1>hi</h1>')
    if (url.endsWith('/img/a%20b.png')) return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]))
    if (url.endsWith('/run.sh')) return new Response('echo')
    return new Response('', { status: 404 })
  }
  const uploaded: string[] = []
  const notes: string[] = []
  const files = await copyFiles(plan, { blob: async (b) => (uploaded.push(b), 'blob1'), note: (n) => notes.push(n) }, { fetchImpl, sleep: async () => {} })
  assert.deepEqual(files['index.html'], { content: '<h1>hi</h1>', mode: '100644' })
  assert.deepEqual(files['img/a b.png'], { sha: 'blob1', mode: '100644' })
  assert.deepEqual(files['run.sh'], { content: 'echo', mode: '100755' })
  assert.deepEqual(uploaded, ['iVBORwA='])
  assert.ok(asked.every((u) => u.startsWith(`https://raw.githubusercontent.com/them/site/${SHA}/`)), 'pinned to the commit, public file server only')
  assert.equal(notes.at(-1), 'Copied 3 of 3 files…')

  const broken = planCopy('them', 'site', SHA, [blob('gone.html')])
  await assert.rejects(copyFiles(broken, { blob: async () => '', note: () => {} }, { fetchImpl, sleep: async () => {} }), /Couldn’t read gone\.html/)
})

const report = {
  repo: { owner: 'them', repo: 'site', branch: 'main', url: '' },
  detection: { mode: 'static', packageManager: 'npm', packageManagerPinned: false, hasLockfile: true, nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.' },
} as unknown as Report

test('the copy’s workflow: the original’s Shipyard settings if any, with the copy’s name and branch, no extras', () => {
  const fromCheck = copyConfig(report, null, 'My Copy', 'trunk')
  assert.equal(fromCheck.appName, 'my-copy')
  assert.equal(fromCheck.branch, 'trunk')
  assert.equal(fromCheck.buildCommand, 'npm run build')

  const own = generateWorkflow({ ...fromCheck, appName: 'their-site', branch: 'main', buildCommand: 'npm run build:prod', outputDir: 'out', attest: true, previews: true })
  const cfg = copyConfig(report, own, 'mine', 'main')
  assert.equal(cfg.buildCommand, 'npm run build:prod')
  assert.equal(cfg.outputDir, 'out')
  assert.equal(cfg.appName, 'mine')
  assert.equal(cfg.attest, false)
  assert.equal(cfg.previews, false)
})

test('the README button links to the deploy page and the button image', () => {
  assert.equal(
    buttonMarkdown('https://shipyard-h0413.ms.computer/', 'them', 'site'),
    '[![Deploy to Ms. Computer](https://shipyard-h0413.ms.computer/deploy-button.svg)](https://shipyard-h0413.ms.computer/#/deploy/them/site)',
  )
})
