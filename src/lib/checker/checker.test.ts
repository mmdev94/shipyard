import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSnapshot, parseRepoInput } from './index.ts'
import { mask } from './rules.ts'
import { normalizeAppName } from '../workflow.ts'
import type { RepoSnapshot } from './types.ts'

type FileSpec = string | { size: number }

function fakeRepo(files: Record<string, FileSpec>): RepoSnapshot {
  const entries = Object.entries(files).map(([path, v]) => ({ path, size: typeof v === 'string' ? Math.max(1, v.length) : v.size }))
  return {
    owner: 'me',
    repo: 'site',
    branch: 'main',
    files: entries,
    truncated: false,
    read: async (p) => {
      const v = files[p]
      return typeof v === 'string' ? v : null
    },
  }
}

const pkg = (o: object) => JSON.stringify(o)
const ids = (r: { findings: { id: string; severity: string }[] }, sev: string) => r.findings.filter((f) => f.severity === sev).map((f) => f.id).sort()

test('parseRepoInput accepts common forms', () => {
  assert.deepEqual(parseRepoInput('vitejs/vite'), { owner: 'vitejs', repo: 'vite', branch: undefined })
  assert.deepEqual(parseRepoInput('https://github.com/vitejs/vite.git'), { owner: 'vitejs', repo: 'vite', branch: undefined })
  assert.deepEqual(parseRepoInput('github.com/a/b/tree/feat/x?tab=1'), { owner: 'a', repo: 'b', branch: 'feat/x' })
  assert.deepEqual(parseRepoInput('git@github.com:a/b.git'), { owner: 'a', repo: 'b', branch: undefined })
  assert.equal(parseRepoInput('not a repo'), null)
  assert.equal(parseRepoInput('https://gitlab.com/a'), null)
})

test('Vite + React is ready as a static site', async () => {
  const r = await checkSnapshot(
    fakeRepo({
      'package.json': pkg({ scripts: { build: 'vite build' }, dependencies: { react: '19' }, devDependencies: { vite: '8' } }),
      'package-lock.json': '{}',
      'index.html': '<div id=root>',
      'src/main.tsx': 'fetch("https://api.example.com/data")',
    }),
  )
  assert.equal(r.verdict.kind, 'static')
  assert.equal(r.detection.frameworkLabel, 'Vite + React')
  assert.equal(r.detection.buildCommand, 'npm run build')
  assert.equal(r.detection.outputDir, 'dist')
  assert.deepEqual(ids(r, 'fail'), [])
})

test('Vite custom outDir and pnpm are picked up', async () => {
  const r = await checkSnapshot(
    fakeRepo({
      'package.json': pkg({ scripts: { build: 'vite build' }, devDependencies: { vite: '8' } }),
      'pnpm-lock.yaml': 'x',
      'vite.config.ts': "export default { build: { outDir: './build' } }",
      '.nvmrc': 'v20.11.0',
    }),
  )
  assert.equal(r.detection.outputDir, 'build')
  assert.equal(r.detection.packageManager, 'pnpm')
  assert.equal(r.detection.buildCommand, 'pnpm run build')
  assert.equal(r.detection.nodeVersion, '20')
})

test('Next.js: static export vs server', async () => {
  const base = { 'package.json': pkg({ scripts: { build: 'next build' }, dependencies: { next: '15', react: '19' } }) }
  const exp = await checkSnapshot(fakeRepo({ ...base, 'next.config.mjs': "export default { output: 'export' }" }))
  assert.equal(exp.verdict.kind, 'static')
  assert.equal(exp.detection.outputDir, 'out')
  const srv = await checkSnapshot(fakeRepo({ ...base, 'next.config.mjs': 'export default {}' }))
  assert.equal(srv.detection.mode, 'dynamic')
})

test('Express + Postgres + env vars is not supported', async () => {
  const r = await checkSnapshot(
    fakeRepo({
      'package.json': pkg({ scripts: { start: 'node server.js' }, dependencies: { express: '5', pg: '8', dotenv: '16' } }),
      'server.js': "const express = require('express')\nconst db = new Pool({ connectionString: process.env.DATABASE_URL })\napp.listen(process.env.PORT || 3000)",
    }),
  )
  assert.equal(r.detection.mode, 'dynamic')
  assert.equal(r.verdict.kind, 'unsupported')
  assert.ok(ids(r, 'fail').includes('database'))
  assert.ok(ids(r, 'fail').includes('env-vars'))
  const env = r.findings.find((f) => f.id === 'env-vars')!
  assert.ok(env.evidence!.some((e) => e.path === 'server.js' && e.line === 2))
})

test('Leaked token and committed .env need a fix, and the value is masked', async () => {
  const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
  const r = await checkSnapshot(
    fakeRepo({
      'index.html': '<h1>hi</h1>',
      '.env': 'SECRET=1',
      '.env.example': 'SECRET=',
      'app.js': `const t = "${token}"`,
    }),
  )
  assert.equal(r.verdict.kind, 'fix')
  assert.deepEqual(ids(r, 'fail'), ['env-file', 'secrets'])
  const s = r.findings.find((f) => f.id === 'secrets')!
  const shown = JSON.stringify(s)
  assert.ok(!shown.includes(token), 'full token must never be shown')
  assert.ok(shown.includes('ghp_'))
  const envFile = r.findings.find((f) => f.id === 'env-file')!
  assert.deepEqual(envFile.evidence!.map((e) => e.path), ['.env'])
})

test('Flask calling an API from the server is blocked by no-egress', async () => {
  const r = await checkSnapshot(
    fakeRepo({
      'requirements.txt': 'flask==3.0\nrequests>=2',
      'app.py': "import requests\n@app.get('/')\ndef home():\n    return requests.get('https://api.x.com').text",
    }),
  )
  assert.equal(r.detection.framework, 'python-flask')
  assert.equal(r.verdict.kind, 'unsupported')
  assert.ok(ids(r, 'fail').includes('egress'))
})

test('Monorepo: finds the web app folder', async () => {
  const r = await checkSnapshot(
    fakeRepo({
      'package.json': pkg({ private: true, workspaces: ['apps/*'] }),
      'apps/web/package.json': pkg({ scripts: { build: 'vite build' }, devDependencies: { vite: '8' } }),
      'apps/web/package-lock.json': '{}',
    }),
  )
  assert.equal(r.detection.workingDir, 'apps/web')
  assert.equal(r.detection.outputDir, 'dist')
})

test('A file over 16 MiB in public/ needs a fix', async () => {
  const r = await checkSnapshot(
    fakeRepo({
      'package.json': pkg({ scripts: { build: 'vite build' }, devDependencies: { vite: '8' } }),
      'public/intro.mp4': { size: 40 * 1024 * 1024 },
    }),
  )
  assert.equal(r.verdict.kind, 'fix')
  assert.ok(ids(r, 'fail').includes('big-files'))
})

test('Public Firebase keys are only informational', async () => {
  const r = await checkSnapshot(
    fakeRepo({ 'index.html': 'x', 'firebase.js': 'const k = "' + 'AIza' + 'SyA1234567890abcdefghijklmnopqrstuv"' }),
  )
  assert.equal(r.verdict.kind, 'static')
  assert.ok(ids(r, 'info').includes('public-keys'))
})

test('helpers', () => {
  assert.equal(normalizeAppName('My Cool Site!'), 'my-cool-site')
  assert.equal(normalizeAppName('***'), 'my-site')
  assert.ok(!mask('ghp_abcdefghijklmnop').includes('ghijklm'))
})

test('regression: a test file calling its own server is not outbound traffic', async () => {
  const r = await checkSnapshot(
    fakeRepo({
      'package.json': pkg({ scripts: { start: 'node server.js' }, dependencies: { express: '5', axios: '1' } }),
      'server.js': "const express = require('express')\napp.listen(process.env.PORT)",
      'e2e/src/server/server.spec.ts': 'const res = await axios.get(`/`)',
      'src/routes/api/proxy.ts': "await axios.get('https://api.github.com/users')",
    }),
  )
  const egress = r.findings.find((f) => f.id === 'egress')!
  assert.equal(egress.severity, 'fail')
  assert.deepEqual(egress.evidence!.map((e) => e.path), ['src/routes/api/proxy.ts'])
})

test('regression: output dir outside the app folder resolves correctly', async () => {
  const { generateWorkflow } = await import('../workflow.ts')
  const r = await checkSnapshot(
    fakeRepo({
      'frontend/package.json': pkg({ scripts: { build: 'vite build' }, devDependencies: { vite: '8' } }),
      'frontend/vite.config.ts': 'export default { build: { outDir: "../backend/app/frontend" } }',
      'backend/requirements.txt': 'fastapi',
      'backend/Dockerfile': 'FROM python',
    }),
  )
  assert.equal(r.detection.workingDir, 'frontend')
  assert.equal(r.detection.outputDir, '../backend/app/frontend')
  const yml = generateWorkflow({ ...r.detection, appName: 'x', branch: 'main' })
  assert.ok(yml.includes('"backend/app/frontend/" "$APP_DIR/"'), 'stage step copies the resolved folder')
  assert.ok(r.findings.some((f) => f.id === 'other-services'), 'mentions the backend that is not deployed')
})

test('regression: turbo monorepo with a root build script picks the web app', async () => {
  const r = await checkSnapshot(
    fakeRepo({
      'package.json': pkg({ scripts: { build: 'turbo build' }, devDependencies: { turbo: '2', vite: '8' } }),
      'turbo.json': '{}',
      'pnpm-workspace.yaml': 'packages: [apps/*]',
      'apps/v4/package.json': pkg({ scripts: { build: 'next build' }, dependencies: { next: '15' } }),
      'apps/web/package.json': pkg({ scripts: { build: 'vite build' }, devDependencies: { vite: '8' } }),
      'packages/ui/package.json': pkg({ scripts: { build: 'tsc' }, dependencies: { react: '19' } }),
      'packages/registry/fixtures/x/.env.example': 'A=',
    }),
  )
  assert.equal(r.detection.workingDir, 'apps/web')
  assert.deepEqual(r.detection.apps, ['apps/web', 'apps/v4'])
  assert.ok(!r.findings.some((f) => f.id === 'build-env' && f.severity === 'warn'), 'fixture .env.example is not app config')
  const other = await checkSnapshot(fakeRepoShared(), { appDir: 'apps/v4' })
  assert.equal(other.detection.framework, 'next')
})

function fakeRepoShared() {
  return fakeRepo({
    'package.json': pkg({ workspaces: ['apps/*'] }),
    'apps/v4/package.json': pkg({ scripts: { build: 'next build' }, dependencies: { next: '15' } }),
    'apps/web/package.json': pkg({ scripts: { build: 'vite build' }, devDependencies: { vite: '8' } }),
  })
}

test('regression: a devcontainer Dockerfile is not a backend', async () => {
  const r = await checkSnapshot(
    fakeRepo({
      'package.json': pkg({ workspaces: ['docs', 'packages/*'] }),
      '.devcontainer/Dockerfile': 'FROM node:22',
      'docs/package.json': pkg({ scripts: { build: 'astro build' }, dependencies: { astro: '5' } }),
      'docs/astro.config.mjs': 'export default {}',
    }),
  )
  assert.equal(r.detection.workingDir, 'docs')
  assert.ok(!r.findings.some((f) => f.id === 'other-services'), 'no backend note for dev tooling')
})

test('build-time variables: required ones warn, ones with a fallback do not', async () => {
  const base = { 'package.json': pkg({ scripts: { build: 'vite build' }, devDependencies: { vite: '8' } }), 'index.html': '<div id=root></div>' }
  const optional = await checkSnapshot(
    fakeRepo({ ...base, 'src/data.ts': "export const DATA = import.meta.env.VITE_DATA ?? 'https://example.com'\nconst k = process.env.NEXT_PUBLIC_X || 'x'" }),
  )
  assert.equal(optional.findings.find((f) => f.id === 'build-env')?.severity, 'pass')
  const required = await checkSnapshot(fakeRepo({ ...base, 'src/data.ts': 'export const KEY = import.meta.env.VITE_MAPS_KEY\nfetch(import.meta.env.VITE_API ?? x)' }))
  const f = required.findings.find((x) => x.id === 'build-env')
  assert.equal(f?.severity, 'warn')
  assert.equal(f?.evidence?.length, 1)
  assert.match(f?.evidence?.[0].snippet ?? '', /VITE_MAPS_KEY/)
})
