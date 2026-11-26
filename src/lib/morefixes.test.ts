import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSnapshot } from './checker/index.ts'
import { historyRouter } from './checker/routing.ts'
import { addDevDependency, astroStaticConfig, availableFixes, svelteStaticConfig } from './fixes.ts'
import { configFromReport } from './github/copy.ts'
import { generateWorkflow, readWorkflowConfig } from './workflow.ts'
import type { RepoSnapshot } from './checker/types.ts'

function repo(files: Record<string, string>): RepoSnapshot {
  return { owner: 'me', repo: 'site', branch: 'main', files: Object.entries(files).map(([path, t]) => ({ path, size: Math.max(1, t.length) })), truncated: false, read: async (p) => files[p] ?? null }
}
const find = (r: { findings: { id: string }[] }, id: string) => r.findings.find((f) => f.id === id) as { severity: string; title: string; data?: Record<string, string> } | undefined
const VITE_REACT = { 'package.json': JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { react: '^19', 'react-router-dom': '^7' }, devDependencies: { vite: '^6' } }), 'package-lock.json': '{}', 'index.html': '<div id="root"></div>' }

test('routers that route by path are found; hash routing needs nothing', () => {
  const deps = { 'react-router-dom': '^7' }
  assert.equal(historyRouter(deps, [{ path: 'src/main.tsx', text: 'const router = createBrowserRouter(routes)' }])?.name, 'React Router')
  assert.equal(historyRouter(deps, [{ path: 'src/main.tsx', text: '<HashRouter><App/></HashRouter>' }]), null)
  assert.equal(historyRouter({ 'vue-router': '^4' }, [{ path: 'src/router/index.ts', text: 'createRouter({ history: createWebHistory(), routes })' }])?.snippet, 'createRouter({ history: createWebHistory(), routes })')
  assert.equal(historyRouter({ 'vue-router': '^4' }, [{ path: 'src/router/index.ts', text: 'history: createWebHashHistory()' }]), null)
  assert.equal(historyRouter({ '@angular/router': '^19' }, [{ path: 'src/app/app.config.ts', text: 'provideRouter(routes)' }])?.name, 'Angular Router')
  assert.equal(historyRouter({ '@angular/router': '^19' }, [{ path: 'src/app/app.config.ts', text: 'provideRouter(routes, withHashLocation())' }]), null)
})

test('a React Router app: the workflow Shipyard writes ships the 404.html fallback', async () => {
  const r = await checkSnapshot(repo({ ...VITE_REACT, 'src/main.tsx': 'import { BrowserRouter } from "react-router-dom"\nroot.render(<BrowserRouter><App /></BrowserRouter>)' }))
  assert.equal(find(r, 'spa-routing')?.severity, 'info')
  assert.equal(configFromReport(r).spa, true)
  assert.match(generateWorkflow(configFromReport(r)), /cp "\$APP_DIR\/index\.html" "\$APP_DIR\/404\.html"/)
  const plain = await checkSnapshot(repo({ ...VITE_REACT, 'src/main.tsx': 'root.render(<App />)' }))
  assert.equal(find(plain, 'spa-routing'), undefined)
  assert.equal(configFromReport(plain).spa, undefined)
})

test('an existing Shipyard workflow without the fallback: Fix it updates the workflow only', async () => {
  const wf = generateWorkflow({ appName: 'site', mode: 'static', branch: 'main', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.' })
  const files = { ...VITE_REACT, 'src/main.tsx': 'createBrowserRouter([])', '.github/workflows/ms-computer.yml': wf }
  const r = await checkSnapshot(repo(files))
  assert.equal(find(r, 'spa-routing')?.severity, 'warn')
  const fix = availableFixes(r).find((f) => f.id === 'spa-fallback')!
  const [change] = await fix.build(async (p) => (files as Record<string, string>)[p] ?? null)
  assert.equal(change.path, '.github/workflows/ms-computer.yml')
  const cfg = readWorkflowConfig(change.after!)!.config
  assert.equal(cfg.spa, true)
  assert.equal(cfg.buildCommand, 'npm run build', 'everything else kept')

  const done = await checkSnapshot(repo({ ...files, '.github/workflows/ms-computer.yml': change.after! }))
  assert.equal(find(done, 'spa-routing')?.severity, 'pass')
})

test('a GitHub Pages base path: flagged, and Fix it sets it to the root', async () => {
  const files = { ...VITE_REACT, 'vite.config.ts': "import { defineConfig } from 'vite'\nexport default defineConfig({\n  base: '/site/',\n})\n" }
  const r = await checkSnapshot(repo(files))
  assert.equal(find(r, 'base-path')?.severity, 'fail')
  assert.equal(find(r, 'base-path')?.title, 'Built for /site/, but served at /')
  const [change] = await availableFixes(r).find((f) => f.id === 'root-base-path')!.build(async (p) => (files as Record<string, string>)[p] ?? null)
  assert.equal(change.after, "import { defineConfig } from 'vite'\nexport default defineConfig({\n  base: '/',\n})\n")
  assert.equal(r.verdict.kind, 'fix')
})

const SVELTE_CONFIG = `import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments
		adapter: adapter()
	}
};

export default config;
`

test('SvelteKit: adapter-static with prerendering and a fallback, in one PR', async () => {
  assert.equal(svelteStaticConfig(SVELTE_CONFIG), SVELTE_CONFIG.replace("import adapter from '@sveltejs/adapter-auto';", "import adapter from '@sveltejs/adapter-static';").replace('adapter: adapter()', "adapter: adapter({ fallback: '404.html' })"))
  assert.match(svelteStaticConfig("import adapter from '@sveltejs/adapter-node'\nexport default { kit: { adapter: adapter({ out: 'x' }) } }")!, /adapter-static'[\s\S]*adapter: adapter\(\{ fallback: '404\.html' \}\)/)
  assert.equal(svelteStaticConfig("import adapter from '@sveltejs/adapter-static'\n"), null)
  const files: Record<string, string> = {
    'package.json': '{\n\t"scripts": { "build": "vite build" },\n\t"devDependencies": {\n\t\t"@sveltejs/adapter-auto": "^6.0.0",\n\t\t"@sveltejs/kit": "^2.20.0",\n\t\t"vite": "^6.2.0"\n\t}\n}\n',
    'package-lock.json': '{}',
    'svelte.config.js': SVELTE_CONFIG,
    'src/routes/+page.svelte': '<h1>Hi</h1>',
    'src/routes/about/+page.server.ts': 'export const load = () => ({})',
  }
  const r = await checkSnapshot(repo(files))
  assert.equal(r.detection.framework, 'sveltekit')
  const fix = availableFixes(r).find((f) => f.id === 'sveltekit-static')!
  assert.match(fix.warning!, /commit package-lock\.json/)
  assert.match(fix.warning!, /about\/\+page\.server\.ts/)
  const changes = await fix.build(async (p) => files[p] ?? null)
  assert.deepEqual(changes.map((c) => c.path), ['svelte.config.js', 'src/routes/+layout.ts', 'package.json'])
  assert.match(changes[1].after!, /export const prerender = true/)
  assert.match(changes[2].after!, /\t\t"@sveltejs\/adapter-static": "\^3\.0\.8",\n\t\t"@sveltejs\/kit"/, 'sorted, tabs kept')

  const after = await checkSnapshot(repo({ ...files, ...Object.fromEntries(changes.map((c) => [c.path, c.after!])) }))
  assert.equal(after.detection.framework, 'sveltekit-static')
  assert.equal(after.detection.outputDir, 'build')
})

test('Astro: output static, adapter (even multi-line) and its import removed', async () => {
  const cfg = "import { defineConfig } from 'astro/config';\nimport node from '@astrojs/node';\n\nexport default defineConfig({\n  output: 'server',\n  adapter: node({\n    mode: 'standalone',\n  }),\n  site: 'https://example.com',\n});\n"
  assert.equal(astroStaticConfig(cfg), "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({\n  site: 'https://example.com',\n});\n")
  assert.equal(astroStaticConfig("export default defineConfig({ output: 'server', adapter: vercel() })"), 'export default defineConfig({})')
  assert.equal(astroStaticConfig("export default defineConfig({ site: 'x' })"), null)
  const files: Record<string, string> = { 'package.json': JSON.stringify({ scripts: { build: 'astro build' }, dependencies: { astro: '^5', '@astrojs/node': '^9' } }), 'astro.config.mjs': cfg, 'src/pages/index.astro': '<h1>hi</h1>', 'src/pages/api/hello.ts': 'export const GET = () => new Response("hi")' }
  const r = await checkSnapshot(repo(files))
  assert.equal(r.detection.framework, 'astro-server')
  const fix = availableFixes(r).find((f) => f.id === 'astro-static')!
  assert.match(fix.warning!, /api\/hello\.ts/)
  const [change] = await fix.build(async (p) => files[p] ?? null)
  const after = await checkSnapshot(repo({ ...files, 'astro.config.mjs': change.after! }))
  assert.equal(after.detection.framework, 'astro')
})

test('dev dependencies are added once, in order', () => {
  assert.equal(addDevDependency('{\n  "devDependencies": {\n    "vite": "^6"\n  }\n}\n', '@sveltejs/adapter-static', '^3.0.8'), '{\n  "devDependencies": {\n    "@sveltejs/adapter-static": "^3.0.8",\n    "vite": "^6"\n  }\n}\n')
  assert.equal(addDevDependency('{"devDependencies":{"@sveltejs/adapter-static":"^3"}}', '@sveltejs/adapter-static', '^3.0.8'), null)
})
