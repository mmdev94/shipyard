import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSnapshot } from './index.ts'
import { nodeStart } from './servers.ts'
import { availableFixes, setStartScript } from '../fixes.ts'
import type { RepoSnapshot } from './types.ts'

function repo(files: Record<string, string>): RepoSnapshot {
  return { owner: 'me', repo: 'api', branch: 'main', files: Object.entries(files).map(([path, t]) => ({ path, size: Math.max(1, t.length) })), truncated: false, read: async (p) => files[p] ?? null }
}
const SRV = 'const app = require("express")()\napp.get("/", (q, s) => s.send("hi"))\napp.listen(process.env.PORT || 3000)\n'
const pkg = (o: object) => JSON.stringify({ name: 'api', dependencies: { express: '^5' }, ...o }, null, 2) + '\n'
const start = async (files: Record<string, string>) => (await checkSnapshot(repo(files))).findings.find((f) => f.id === 'start')!

test('how ms.computer starts a Node server — every row measured with the real planner', () => {
  const paths = ['server.js', 'index.js']
  assert.deepEqual(nodeStart({ start: 'node server.js' }, undefined, paths, '.'), { how: 'script', command: 'node server.js' })
  assert.deepEqual(nodeStart({}, 'server.js', ['server.js'], '.'), { how: 'main', command: 'node server.js' })
  assert.deepEqual(nodeStart({}, undefined, ['index.js'], '.'), { how: 'index', command: 'node index.js' })
  assert.equal(nodeStart({ dev: 'node server.js', serve: 'node server.js' }, undefined, ['server.js'], '.').how, 'none', 'dev and serve are never used')
  for (const s of ['nodemon server.js', 'node --watch server.js', 'nest start --watch', 'next dev', 'vite']) assert.equal(nodeStart({ start: s }, undefined, paths, '.').problem?.kind, 'refused', s)
  for (const s of ['nodemon', 'tsx server.ts', 'pm2-runtime server.js', 'NODE_ENV=production node server.js', 'vite preview']) assert.notEqual(nodeStart({ start: s }, undefined, paths, '.').problem?.kind, 'refused', s)
  for (const s of ['forever start server.js', 'pm2 start server.js', 'tsx watch server.ts']) assert.equal(nodeStart({ start: s }, undefined, paths, '.').problem?.kind, 'risky', s)
})

test('no start command: a fail, and Fix it adds "start": "node server.js"', async () => {
  const files = { 'package.json': pkg({}), 'server.js': SRV }
  const r = await checkSnapshot(repo(files))
  const f = r.findings.find((x) => x.id === 'start')!
  assert.equal(f.severity, 'fail')
  assert.equal(r.verdict.kind, 'fix', 'not "Deploys as a dynamic app" — ms.computer refuses it')
  const [change] = await availableFixes(r).find((x) => x.id === 'node-start')!.build(async (p) => (files as Record<string, string>)[p] ?? null)
  assert.deepEqual(JSON.parse(change.after!).scripts, { start: 'node server.js' })
})

test('nodemon start: replaced by node, the old command kept as dev', async () => {
  const files = { 'package.json': pkg({ scripts: { start: 'nodemon server.js' } }), 'server.js': SRV }
  const r = await checkSnapshot(repo(files))
  assert.equal(r.findings.find((x) => x.id === 'start')!.title, 'The start script runs a development server')
  const [change] = await availableFixes(r).find((x) => x.id === 'node-start')!.build(async (p) => (files as Record<string, string>)[p] ?? null)
  assert.deepEqual(JSON.parse(change.after!).scripts, { start: 'node server.js', dev: 'nodemon server.js' })
  assert.deepEqual(JSON.parse(setStartScript('{"scripts":{"start":"nodemon a.js","dev":"vite"}}', 'node a.js')!).scripts, { start: 'node a.js', dev: 'vite' }, 'an existing dev script is kept')
  assert.equal(setStartScript('{"scripts":{"start":"node a.js"}}', 'node a.js'), null, 'nothing to change')
})

test('main or index.js: passes; a production start: passes', async () => {
  assert.equal((await start({ 'package.json': pkg({ main: 'server.js' }), 'server.js': SRV })).title, 'Starts with `node server.js`')
  assert.equal((await start({ 'package.json': pkg({}), 'index.js': SRV })).title, 'Starts with `node index.js`')
  assert.equal((await start({ 'package.json': pkg({ scripts: { start: 'node server.js' } }), 'server.js': SRV })).severity, 'pass')
})

test('a library with express only as a dev dependency is not a server', async () => {
  const r = await checkSnapshot(repo({ 'package.json': JSON.stringify({ name: 'cors', main: 'lib/index.js', devDependencies: { express: '^4', mocha: '^10' } }), 'lib/index.js': 'module.exports = function cors() {}' }))
  assert.notEqual(r.detection.mode, 'dynamic')
  assert.equal(r.verdict.title, 'No website found here')
})

test('a Dockerfile: never "runs as a container" — ms.computer ignores it', async () => {
  const site = await checkSnapshot(repo({ Dockerfile: 'FROM nginx', 'index.html': '<h1>hi</h1>' }))
  assert.equal(site.detection.framework, 'html', 'measured: the planner serves it as static files')
  assert.equal(site.findings.find((f) => f.id === 'dockerfile')?.severity, 'info')
  const only = await checkSnapshot(repo({ Dockerfile: 'FROM rust\nCMD ["./app"]', 'README.md': '# app' }))
  assert.equal(only.verdict.title, 'No website found here')
  assert.match(only.detection.reasons.join(' '), /ignores Dockerfiles/)
})

test('Jekyll: a theme line and a README in an app repo is the app, not a Jekyll site', async () => {
  const r = await checkSnapshot(repo({ '_config.yml': 'theme: jekyll-theme-cayman', 'README.md': '# API', 'package.json': pkg({ scripts: { start: 'nodemon server.js' } }), 'server.js': SRV }))
  assert.equal(r.detection.framework, 'node-express')
  const readmeSite = await checkSnapshot(repo({ '_config.yml': 'theme: jekyll-theme-cayman', 'README.md': '# Docs' }))
  assert.equal(readmeSite.detection.framework, 'jekyll', 'a README shown with a Pages theme is still a Jekyll site')
})
