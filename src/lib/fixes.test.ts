import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addScript, availableFixes, diffLines, ignoreEnv, nextExportBlockers, nextExportConfig, nodePort, pythonPort } from './fixes.ts'
import type { Report } from './checker/types.ts'

const report = (over: Partial<Report> & { framework?: string; workingDir?: string }): Report => ({
  repo: { owner: 'me', repo: 'site', branch: 'main', url: 'https://github.com/me/site' },
  detection: { framework: over.framework ?? 'vite', workingDir: over.workingDir ?? '.' } as Report['detection'],
  findings: over.findings ?? [],
  verdict: { kind: 'static' } as Report['verdict'],
  scanned: { files: 0, totalFiles: 0, truncated: false },
  paths: over.paths ?? [],
})
const reader = (files: Record<string, string>) => async (p: string) => files[p] ?? null

test('.gitignore: appends the block once, and never twice', () => {
  const added = ignoreEnv('node_modules\n')!
  assert.match(added, /^node_modules\n\n# Local secrets/)
  assert.match(added, /\n\.env\n\.env\.\*\n!\.env\.example\n/)
  assert.equal(ignoreEnv(added), null)
  assert.equal(ignoreEnv('.env*\n'), null)
  assert.match(ignoreEnv(null)!, /^# Local secrets/)
})

test('env fix deletes every committed .env (not examples) and updates .gitignore', async () => {
  const r = report({ paths: ['.env', 'api/.env.local', '.env.example', 'node_modules/x/.env', 'src/a.ts'] })
  const fix = availableFixes(r).find((f) => f.id === 'remove-env-files')!
  assert.equal(fix.findingId, 'env-file')
  const changes = await fix.build(reader({ '.env': 'KEY=1', 'api/.env.local': 'B=2', '.gitignore': 'dist\n' }))
  assert.deepEqual(changes.map((c) => [c.path, c.after === null ? 'delete' : 'edit']), [['.env', 'delete'], ['api/.env.local', 'delete'], ['.gitignore', 'edit']])
  assert.match(fix.warning!, /rotate every key/)
})

test('port: Node and Flask read $PORT, keep the old port as fallback, and are idempotent', () => {
  const node = nodePort('app.listen(3000, () => log("up"))\nserver.listen( 8080 )')
  assert.equal(node, 'app.listen(Number(process.env.PORT) || 3000, () => log("up"))\nserver.listen(Number(process.env.PORT) || 8080 )')
  assert.equal(nodePort(node), node)
  const py = pythonPort('#!/usr/bin/env python\nfrom flask import Flask\napp = Flask(__name__)\nif __name__ == "__main__":\n    app.run(debug=True, port=5000)\n')
  assert.match(py, /^#!\/usr\/bin\/env python\nimport os\nfrom flask/)
  assert.match(py, /app\.run\(host="0\.0\.0\.0", debug=True, port=int\(os\.environ\.get\("PORT", 5000\)\)\)/)
  assert.equal(pythonPort('import os\napp.run()\n'), 'import os\napp.run()\n', 'no port argument: left alone')
})

test('port fix only touches the files the checker pointed at', async () => {
  const r = report({ findings: [{ id: 'port', severity: 'warn', category: 'platform', title: '', detail: '', evidence: [{ path: 'server.js', line: 9 }] }] })
  const fix = availableFixes(r).find((f) => f.id === 'listen-on-port')!
  const ch = await fix.build(reader({ 'server.js': 'app.listen(3000)\n' }))
  assert.deepEqual(ch.map((c) => [c.path, c.after]), [['server.js', 'app.listen(Number(process.env.PORT) || 3000)\n']])
})

test('Next.js: export only offered without server-only features; config edits are safe', async () => {
  assert.deepEqual(nextExportBlockers(['web/pages/api/hello.ts', 'web/app/page.tsx', 'other/middleware.ts'], 'web'), ['pages/api/hello.ts'])
  assert.deepEqual(nextExportBlockers(['src/app/api/x/route.ts', 'middleware.ts', 'app/page.tsx'], '.'), ['src/app/api/x/route.ts', 'middleware.ts'])
  assert.equal(availableFixes(report({ framework: 'next', paths: ['pages/api/a.ts'] })).length, 0)

  assert.equal(nextExportConfig("const nextConfig = {\n  reactStrictMode: true,\n}\nexport default nextConfig\n"),
    "const nextConfig = {\n  output: 'export',\n  images: { unoptimized: true },\n  reactStrictMode: true,\n}\nexport default nextConfig\n")
  assert.match(nextExportConfig('import type { NextConfig } from "next"\nconst nextConfig: NextConfig = {\n  images: { domains: [] },\n}\n')!, /NextConfig = \{\n  output: 'export',\n  images: \{ domains/)
  assert.match(nextExportConfig('module.exports = {}\n')!, /module\.exports = \{\n  output: 'export'/)
  assert.equal(nextExportConfig("export default { output: 'export' }"), null, 'already static')
  assert.equal(nextExportConfig('export default (phase) => ({})'), null, 'a function config is left to a human')
  assert.match(nextExportConfig(null)!, /output: 'export'/)

  const fix = availableFixes(report({ framework: 'next', workingDir: 'web', paths: ['web/next.config.ts', 'web/app/page.tsx'] }))[0]
  assert.equal(fix.id, 'next-static-export')
  const ch = await fix.build(reader({ 'web/next.config.ts': 'const c = {\n}\nexport default c\n' }))
  assert.equal(ch[0].path, 'web/next.config.ts')
})

test('Nuxt: adds the generate script, keeping indentation', () => {
  const pkg = '{\n    "name": "x",\n    "scripts": {\n        "dev": "nuxt dev"\n    }\n}\n'
  const out = addScript(pkg, 'generate', 'nuxt generate')!
  assert.equal(out, '{\n    "name": "x",\n    "scripts": {\n        "dev": "nuxt dev",\n        "generate": "nuxt generate"\n    }\n}\n')
  assert.equal(addScript(out, 'generate', 'nuxt generate'), null)
  assert.equal(addScript('not json', 'generate', 'x'), null)
})

test('diff preview shows only the changed region with context', () => {
  const d = diffLines('a\nb\nc\nd\ne\nf', 'a\nb\nc\nX\ne\nf', 1)
  assert.deepEqual(d, [{ kind: ' ', text: 'c' }, { kind: '-', text: 'd' }, { kind: '+', text: 'X' }, { kind: ' ', text: 'e' }])
  assert.deepEqual(diffLines('x', null).map((l) => l.kind), ['-'])
})
