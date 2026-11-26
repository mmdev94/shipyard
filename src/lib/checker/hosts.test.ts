import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectHost, isSpaFallback, parseHeadersFile, parseRedirectsFile, parseToml } from './hosts.ts'
import type { RepoSnapshot } from './types.ts'

function repo(files: Record<string, string>): RepoSnapshot {
  return { owner: 'me', repo: 'site', branch: 'main', files: Object.entries(files).map(([path, t]) => ({ path, size: Math.max(1, t.length) })), truncated: false, read: async (p) => files[p] ?? null }
}

const NETLIFY = `# Settings in the [build] context are global
[build]
  base = "/"
  command = "npm run build" # the build
  publish = "dist"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "20"

[[redirects]]
  from = "/blog/*"
  to = "/posts/:splat"
  status = 301
  force = true

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"

[[plugins]]
  package = "@netlify/plugin-lighthouse"
`

test('netlify.toml: build settings, redirects, headers, functions', () => {
  const t = parseToml(NETLIFY)
  assert.deepEqual(t.build && { command: (t.build as Record<string, unknown>).command, publish: (t.build as Record<string, unknown>).publish }, { command: 'npm run build', publish: 'dist' })
  assert.equal(((t.build as Record<string, unknown>).environment as Record<string, unknown>).NODE_VERSION, '20')
  assert.equal((t.redirects as unknown[]).length, 2)
  assert.equal(((t.headers as Record<string, unknown>[])[0].values as Record<string, unknown>)['X-Frame-Options'], 'DENY')
})

test('_redirects and _headers files', () => {
  const r = parseRedirectsFile('# comment\n/old   /new\n/news/*  /blog/:splat  302!\n/api/*  https://api.example.com/:splat  200\n/*  /index.html  200\n')
  assert.deepEqual(r[0], { from: '/old', to: '/new', status: 301, force: undefined })
  assert.deepEqual(r[1], { from: '/news/*', to: '/blog/:splat', status: 302, force: true })
  assert.ok(isSpaFallback(r[3]))
  assert.ok(!isSpaFallback(r[2]))
  assert.deepEqual(parseHeadersFile('# security\n/*\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n/assets/*\n  Cache-Control: public, max-age=31536000\n'), [
    { path: '/*', values: [['X-Frame-Options', 'DENY'], ['Referrer-Policy', 'no-referrer']] },
    { path: '/assets/*', values: [['Cache-Control', 'public, max-age=31536000']] },
  ])
})

test('a Netlify site: settings kept, functions and forms flagged', async () => {
  const s = (await detectHost(
    repo({
      'netlify.toml': NETLIFY,
      'package.json': '{"scripts":{"build":"vite build"}}',
      'netlify/functions/hello.js': 'exports.handler = async () => ({ statusCode: 200 })',
      'public/_redirects': '/old /new 301\n',
      'index.html': '<form name="contact" method="POST" data-netlify="true"></form>',
    }),
    '.',
  ))!
  assert.equal(s.host, 'netlify')
  assert.deepEqual(s.build, { command: 'npm run build', publish: 'dist', base: '/', node: '20' })
  assert.equal(s.redirects.length, 3)
  assert.deepEqual(s.headers, [{ path: '/*', values: [['X-Frame-Options', 'DENY']] }])
  assert.deepEqual(s.functions, ['netlify/functions/hello.js'])
  assert.deepEqual(s.forms, ['index.html'])
  assert.deepEqual(s.sources, ['netlify.toml', 'public/_redirects'])
})

test('a Vercel site: build settings, rewrites, redirects, API routes, URL options', async () => {
  const s = (await detectHost(
    repo({
      'vercel.json': JSON.stringify({ buildCommand: 'pnpm build', outputDirectory: 'build', cleanUrls: true, rewrites: [{ source: '/(.*)', destination: '/index.html' }], redirects: [{ source: '/old', destination: '/new', permanent: true }], headers: [{ source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] }] }),
      'api/hello.ts': 'export default function handler() {}',
      'api/hello.test.ts': '',
    }),
    '.',
  ))!
  assert.equal(s.host, 'vercel')
  assert.deepEqual(s.build, { command: 'pnpm build', publish: 'build' })
  assert.ok(isSpaFallback(s.redirects[0]))
  assert.deepEqual(s.redirects[1], { from: '/old', to: '/new', status: 308 })
  assert.deepEqual(s.headers, [{ path: '/(.*)', values: [['X-Robots-Tag', 'noindex']] }])
  assert.deepEqual(s.functions, ['api/hello.ts'])
  assert.deepEqual(s.urlOptions, ['cleanUrls'])
})

const PAGES_WF = `name: Deploy to Pages
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist
  deploy:
    needs: build
    steps:
      - uses: actions/deploy-pages@v4
`

test('GitHub Pages: the deploy workflow, the custom domain and the /<repo>/ base path', async () => {
  const s = (await detectHost(
    repo({ '.github/workflows/pages.yml': PAGES_WF, CNAME: 'www.example.com\n', 'vite.config.ts': "export default defineConfig({ base: '/site/', plugins: [react()] })" }),
    '.',
  ))!
  assert.equal(s.host, 'github-pages')
  assert.deepEqual(s.build, { command: 'npm run build', publish: 'dist' })
  assert.equal(s.domain, 'www.example.com')
  assert.deepEqual(s.basePath, { file: 'vite.config.ts', value: '/site/', kind: 'vite' })

  const cra = (await detectHost(repo({ 'package.json': '{"homepage":"https://me.github.io/site","scripts":{"deploy":"gh-pages -d build"},"dependencies":{"react-scripts":"5.0.1"}}' }), '.'))!
  assert.equal(cra.host, 'github-pages')
  assert.equal(cra.build.publish, 'build')
  assert.deepEqual(cra.basePath, { file: 'package.json', value: '/site', kind: 'cra' })

  const root = (await detectHost(repo({ '.github/workflows/pages.yml': PAGES_WF, 'vite.config.ts': "export default { base: '/' }" }), '.'))!
  assert.equal(root.basePath, undefined, 'a user site at / needs no change')
})

test('no host setup: nothing to move from', async () => {
  assert.equal(await detectHost(repo({ 'index.html': '<h1>hi</h1>', '.github/workflows/ms-computer.yml': 'uses: actions/deploy-pages@v4' }), '.'), null)
})

test('review fixes: # inside a URL is not a comment', () => {
  assert.deepEqual(parseRedirectsFile('/a /b#x 302 # moved\n# a comment\n'), [{ from: '/a', to: '/b#x', status: 302, force: undefined }])
})

test('review fixes: the Pages folder comes from the deploy step; computed commands and homepage metadata are ignored', async () => {
  const wf = `jobs:
  build:
    steps:
      - uses: actions/cache@v4
        with:
          path: ~/.npm
      - run: npm run build -- --base=/\${{ github.event.repository.name }}/
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist
      - uses: actions/deploy-pages@v4
`
  const s = (await detectHost(repo({ '.github/workflows/pages.yml': wf, 'package.json': '{"homepage":"https://me.github.io/site","devDependencies":{"vite":"^6"}}' }), '.'))!
  assert.equal(s.build.publish, 'dist', 'not ~/.npm from the cache step')
  assert.equal(s.build.command, undefined, 'a command with ${{ }} is not carried over')
  assert.equal(s.basePath, undefined, '"homepage" is only a path setting for Create React App')
  const inApp = (await detectHost(repo({ '.github/workflows/pages.yml': wf.replace('./dist', 'web/dist'), 'web/package.json': '{}' }), 'web'))!
  assert.equal(inApp.build.publish, 'dist', 'repo-root path made relative to the app folder')
})
