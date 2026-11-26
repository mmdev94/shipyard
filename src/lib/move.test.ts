import { test } from 'node:test'
import assert from 'node:assert/strict'
import { caddyfileFor, moveConfig, moveFix, movePlan, rootBasePath, toPattern, toTarget } from './move.ts'
import { checkSnapshot } from './checker/index.ts'
import { generateWorkflow, readWorkflowConfig } from './workflow.ts'
import type { HostSetup } from './checker/hosts.ts'
import type { RepoSnapshot } from './checker/types.ts'

function repo(files: Record<string, string>): RepoSnapshot {
  return { owner: 'me', repo: 'site', branch: 'main', files: Object.entries(files).map(([path, t]) => ({ path, size: Math.max(1, t.length) })), truncated: false, read: async (p) => files[p] ?? null }
}
const setup = (o: Partial<HostSetup>): HostSetup => ({ host: 'netlify', sources: ['netlify.toml'], build: {}, redirects: [], headers: [], functions: [], forms: [], urlOptions: [], ...o })

test('path patterns from Netlify and Vercel become anchored regexes', () => {
  assert.deepEqual(toPattern('/about'), { regex: '^/about$', groups: [], exact: true })
  assert.deepEqual(toPattern('/blog/*'), { regex: '^/blog/(.*)$', groups: ['splat'], exact: false })
  assert.deepEqual(toPattern('/news/:year/:slug'), { regex: '^/news/([^/]+)/([^/]+)$', groups: ['year', 'slug'], exact: false })
  assert.deepEqual(toPattern('/:path*'), { regex: '^/(.*)$', groups: ['path'], exact: false })
  assert.deepEqual(toPattern('/(.*)'), { regex: '^/(.*)$', groups: ['$1'], exact: false })
  assert.equal(toPattern('/post/:id(\\d+)'), null, 'regex options are left for a human')
  const p = toPattern('/blog/*')!
  assert.equal(toTarget('/posts/:splat', p, 'r1'), '/posts/{re.r1.1}')
  assert.equal(toTarget('https://new.example.com/:splat', p, 'r1'), 'https://new.example.com/{re.r1.1}')
  assert.equal(toTarget('/x/:missing', p, 'r1'), null)
  assert.equal(toTarget('/$1', toPattern('/(.*)')!, 'r2'), '/{re.r2.1}')
})

test('the Caddyfile keeps redirects (respecting Netlify shadowing), rewrites, headers and the SPA fallback', () => {
  const { text, skipped } = caddyfileFor(
    setup({
      redirects: [
        { from: '/old', to: '/new', status: 301 },
        { from: '/blog/*', to: '/posts/:splat', status: 301, force: true },
        { from: '/app/*', to: '/app/index.html', status: 200 },
        { from: '/api/*', to: 'https://api.example.com/:splat', status: 200 },
        { from: '/fr/*', to: '/fr/', status: 302, conditional: true },
        { from: '/*', to: '/index.html', status: 200 },
      ],
      headers: [{ path: '/*', values: [['X-Frame-Options', 'DENY'], ['Content-Security-Policy', 'default-src "self"']] }],
    }),
    { spa: true },
  )
  assert.match(text, /@r\d \{\n\t\tpath_regexp r\d \^\/old\$\n\t\tnot file\n\t\}\n\tredir @r\d \/new 301/)
  assert.match(text, /@(r\d) path_regexp \1 \^\/blog\/\(\.\*\)\$\n\tredir @\1 \/posts\/\{re\.\1\.1\} 301/, 'forced: no file check')
  assert.match(text, /rewrite @r\d \/app\/index\.html/)
  assert.match(text, /header @h1 Content-Security-Policy "default-src \\"self\\""/)
  assert.match(text, /try_files \{path\} \{path\}\.html \{path\}\/index\.html \/index\.html/)
  assert.deepEqual(skipped, ['/api/* → https://api.example.com/:splat (200) — proxying to another site needs outbound network, which ms.computer apps don’t have', '/fr/* → /fr/ (302)'])
})

test('sub-path settings go back to the root, per framework', () => {
  assert.equal(rootBasePath("export default defineConfig({ base: '/site/' })", 'vite', '/site/'), "export default defineConfig({ base: '/' })")
  assert.equal(rootBasePath('module.exports = { basePath: "/site", output: "export" }', 'next', '/site'), "module.exports = { basePath: '', output: \"export\" }")
  assert.equal(rootBasePath('{"name":"x","homepage":"https://me.github.io/site"}', 'cra', '/site'), '{"name":"x","homepage":"/"}', 'not "." — relative assets break deep links')
  assert.equal(rootBasePath("module.exports = { basePath: '/site', assetPrefix: '/site/', output: 'export' }", 'next', '/site'), "module.exports = { basePath: '', assetPrefix: '', output: 'export' }")
  assert.equal(rootBasePath("kit: { paths: { base: '/site' } }", 'sveltekit', '/site'), "kit: { paths: { base: '' } }")
  assert.equal(rootBasePath("base: process.env.BASE", 'vite', '/site/'), null, 'not a shape we edit')
})

const NETLIFY_SPA = {
  'netlify.toml': '[build]\n  command = "vite build"\n  publish = "dist"\n\n[build.environment]\n  NODE_VERSION = "20"\n\n[[redirects]]\n  from = "/*"\n  to = "/index.html"\n  status = 200\n',
  'public/_redirects': '/old-about /about 301\n/blog/* /posts/:splat 301\n',
  'public/_headers': '/*\n  X-Frame-Options: DENY\n',
  'package.json': JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^6' } }),
  'package-lock.json': '{}',
  'index.html': '<div id="root"></div>',
  'netlify/functions/hello.js': 'exports.handler = async () => ({ statusCode: 200 })',
}

test('a Netlify SPA: the check carries its build settings, and the plan says what moves', async () => {
  const r = await checkSnapshot(repo(NETLIFY_SPA))
  assert.equal(r.host?.host, 'netlify')
  assert.equal(r.detection.buildCommand, 'vite build', 'run as written — the workflow puts node_modules/.bin on PATH')
  assert.equal(r.detection.outputDir, 'dist')
  assert.equal(r.detection.nodeVersion, '20')

  const plan = movePlan(r, 'static')
  const status = (w: string) => plan.find((i) => i.what.startsWith(w))?.status
  assert.equal(status('Build settings'), 'kept')
  assert.equal(status('Single-page app fallback'), 'changed')
  assert.equal(status('Redirects'), 'lost', 'the wildcard one can’t be a page')
  assert.equal(status('Custom headers'), 'lost')
  assert.equal(status('Serverless functions'), 'lost')
  const exact = movePlan(r, 'exact')
  assert.equal(exact.find((i) => i.what.startsWith('Single-page'))?.status, 'kept')
  assert.equal(exact.find((i) => i.what.startsWith('Redirects'))?.status, 'kept')
  assert.equal(exact.find((i) => i.what.startsWith('Custom headers'))?.status, 'kept')

  const cfg = moveConfig(r, 'static')
  assert.equal(cfg.spa, true)
  assert.deepEqual(cfg.redirectPages, [['/old-about', '/about']])
})

test('the move pull request: workflow (+ Caddyfile), and nothing else for Netlify', async () => {
  const r = await checkSnapshot(repo(NETLIFY_SPA))
  const files: Record<string, string> = { ...NETLIFY_SPA }
  const changes = await moveFix(r, 'exact').build(async (p) => files[p] ?? null)
  assert.deepEqual(changes.map((c) => c.path), ['Caddyfile', '.github/workflows/ms-computer.yml'])
  const wf = readWorkflowConfig(changes[1].after!)!.config
  assert.equal(wf.caddyfile, 'Caddyfile')
  assert.equal(wf.buildCommand, 'vite build')
  assert.match(changes[0].after!, /redir @r\d \/posts\/\{re\.r\d\.1\} 301/)

  files.Caddyfile = ':80 { respond "mine" }'
  const again = await moveFix(r, 'exact').build(async (p) => files[p] ?? null)
  assert.equal(again[0].path, 'ms-computer.Caddyfile', 'an existing Caddyfile is never overwritten')
  assert.equal(readWorkflowConfig(again[1].after!)!.config.caddyfile, 'ms-computer.Caddyfile')
})

test('GitHub Pages: the sub-path goes to the root and the Pages workflow is removed in the same PR', async () => {
  const files: Record<string, string> = {
    '.github/workflows/pages.yml': 'jobs:\n  b:\n    steps:\n      - run: npm run build\n      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: ./dist\n      - uses: actions/deploy-pages@v4\n',
    'vite.config.ts': "export default defineConfig({ base: '/site/' })",
    'package.json': JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^6' } }),
    'index.html': '<div id="root"></div>',
  }
  const r = await checkSnapshot(repo(files))
  assert.equal(r.host?.host, 'github-pages')
  const changes = await moveFix(r, 'static').build(async (p) => files[p] ?? null)
  assert.deepEqual(changes.map((c) => [c.path, c.after === null ? 'deleted' : 'written']), [['.github/workflows/ms-computer.yml', 'written'], ['vite.config.ts', 'written'], ['.github/workflows/pages.yml', 'deleted']])
  assert.equal(changes[1].after, "export default defineConfig({ base: '/' })")
})

test('host commands run as they did on the host: node_modules/.bin is on PATH for the whole build', () => {
  const y = generateWorkflow({ appName: 'a', mode: 'static', branch: 'main', packageManager: 'npm', nodeVersion: '22', buildCommand: 'CI= tsc && vite build', outputDir: 'dist', workingDir: '.' })
  assert.match(y, /npm ci\n {10}export PATH="\$PWD\/node_modules\/\.bin:\$GITHUB_WORKSPACE\/node_modules\/\.bin:\$PATH"\n {10}CI= tsc && vite build/)
})

test('review fixes: Vercel rewrites yield to real files, and an SPA catch-all with exclusions is the fallback', async () => {
  const files: Record<string, string> = {
    'vercel.json': JSON.stringify({ rewrites: [{ source: '/((?!api/.*).*)', destination: '/index.html' }, { source: '/docs/:page', destination: '/docs.html' }] }),
    'package.json': JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { react: '^19', 'react-router-dom': '^7' }, devDependencies: { vite: '^6' } }),
    'index.html': '<div id="root"></div>',
    'src/main.tsx': 'createBrowserRouter(routes)',
  }
  const r = await checkSnapshot(repo(files))
  const [caddy] = await moveFix(r, 'exact').build(async (p) => files[p] ?? null)
  assert.match(caddy.after!, /try_files \{path\} \{path\}\.html \{path\}\/index\.html \/index\.html/, 'deep links load the app')
  assert.doesNotMatch(caddy.after!, /rewrite @r\d \/index\.html/, 'no rewrite that would also swallow /assets/*.js')
  assert.match(caddy.after!, /@r\d \{\n\t\tpath_regexp r\d \^\/docs\/\(\[\^\/\]\+\)\$\n\t\tnot file\n\t\}\n\trewrite @r\d \/docs\.html/, 'Vercel: files first')
})

test('review fixes: a server app never gets exact rules; a 404 rule to 404.html is left to the error handler', async () => {
  const r = await checkSnapshot(repo({ 'vercel.json': JSON.stringify({ redirects: [{ source: '/a', destination: '/b' }] }), 'package.json': JSON.stringify({ dependencies: { express: '^5' }, scripts: { start: 'node server.js' } }), 'server.js': 'app.listen(process.env.PORT)' }))
  assert.equal(r.detection.mode, 'dynamic')
  assert.equal(moveConfig(r, 'exact').caddyfile, undefined)
  const { text } = caddyfileFor(setup({ redirects: [{ from: '/*', to: '/404.html', status: 404 }, { from: '/gone', to: '/x', status: 410 }] }), { spa: false })
  assert.doesNotMatch(text, /respond @r1/)
  assert.match(text, /respond @r2 410/)
})
