import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSnapshot } from './index.ts'
import type { RepoSnapshot } from './types.ts'

function repo(files: Record<string, string>): RepoSnapshot {
  return { owner: 'me', repo: 'x', branch: 'main', files: Object.entries(files).map(([path, t]) => ({ path, size: Math.max(1, t.length) })), truncated: false, read: async (p) => files[p] ?? null }
}
const check = async (files: Record<string, string>) => {
  const r = await checkSnapshot(repo(files))
  return { kind: r.detection.framework, title: r.verdict.title, ready: r.verdict.kind === 'static' || r.verdict.kind === 'dynamic', apps: r.detection.apps, summary: r.verdict.summary }
}
const pkg = (o: object) => JSON.stringify({ name: 'x', scripts: { build: 'vite build' }, devDependencies: { vite: '^6' }, ...o })
const APP = { 'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>', 'src/main.tsx': 'x' }

test('a browser extension is not a website (manifest_version, or an extension build tool)', async () => {
  assert.equal((await check({ 'package.json': pkg({ devDependencies: { vite: '^6', '@crxjs/vite-plugin': '^2' } }), 'manifest.json': '{"manifest_version": 3}' })).title, 'A browser extension, not a website')
  assert.equal((await check({ 'package.json': pkg({ devDependencies: { wxt: '^0.20' } }) })).kind, 'extension')
  // a web app manifest (PWA) has no manifest_version — still a website
  assert.equal((await check({ 'package.json': pkg({}), 'public/manifest.json': '{"name":"App","start_url":"/"}', ...APP })).ready, true)
})

test('desktop apps, command-line tools, libraries and plugins', async () => {
  assert.equal((await check({ 'package.json': pkg({ devDependencies: { vite: '^6', electron: '^33', 'electron-vite': '^3' } }), ...APP })).title, 'A desktop app, not a website')
  assert.equal((await check({ 'package.json': pkg({}), 'src-tauri/tauri.conf.json': '{}', ...APP })).kind, 'desktop')
  assert.equal((await check({ 'package.json': JSON.stringify({ name: 'tool', bin: { tool: 'cli.js' } }), 'cli.js': 'x' })).title, 'A command-line tool, not a website')
  assert.equal((await check({ 'package.json': JSON.stringify({ name: 'vite-plugin-x', main: 'dist/index.js', types: 'dist/index.d.ts', peerDependencies: { vite: '*' } }), 'src/index.ts': 'x' })).kind, 'library')
  // a web app that also ships a bin (a runner) is still a website
  assert.equal((await check({ 'package.json': pkg({ bin: { run: 'bin/run.js' } }), ...APP })).ready, true)
  // Next.js with "files" is a site, not a library
  assert.equal((await check({ 'package.json': JSON.stringify({ name: 's', files: ['out'], scripts: { build: 'next build' }, dependencies: { next: '15' } }), 'next.config.mjs': "export default { output: 'export' }" })).ready, true)
})

test('a library with a demo: says so, and offers the demo to check instead', async () => {
  const r = await check({ 'package.json': JSON.stringify({ name: 'lib', exports: './dist/index.js', files: ['dist'] }), 'src/index.ts': 'x', 'examples/react/package.json': pkg({ dependencies: { react: '^19' } }), 'examples/react/index.html': '<div id="root"></div>' })
  assert.equal(r.title, 'A library, not a website')
  assert.deepEqual(r.apps, ['examples/react'])
  assert.match(r.summary, /check that folder instead/)
})

test('a workspace root goes straight to its site folder — only one that builds on its own', async () => {
  const ws = await checkSnapshot(repo({ 'package.json': JSON.stringify({ name: 'repo', private: true }), 'pnpm-workspace.yaml': 'packages: ["packages/*"]', 'packages/core/package.json': '{"name":"core","main":"x"}', 'website/package.json': JSON.stringify({ scripts: { build: 'vitepress build' }, devDependencies: { vitepress: '^1' } }), 'website/index.md': '# hi' }))
  assert.equal(ws.detection.workingDir, 'website')
  assert.equal(ws.verdict.kind, 'static')
  // Nx-style: the app folder has no package.json and loads source — never "Plain HTML"
  const nx = await check({ 'package.json': JSON.stringify({ name: 'nx', private: true, workspaces: ['apps/*'] }), 'nx.json': '{}', 'apps/frontend/index.html': '<script type="module" src="/src/main.tsx"></script>' })
  assert.equal(nx.title, 'A set of packages, not a website')
  const inner = await checkSnapshot(repo({ 'apps/frontend/index.html': '<script type="module" src="/src/main.tsx"></script>', 'package.json': '{"private":true,"workspaces":["apps/*"]}', 'nx.json': '{}' }), { appDir: 'apps/frontend' })
  assert.equal(inner.verdict.title, 'This page needs a build first')
})
