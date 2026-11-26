// Runs the generated Deploy step's real shell against a stand-in `mscomputer`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateWorkflow } from './workflow.ts'

const yaml = generateWorkflow({ appName: 'blog', mode: 'static', branch: 'main', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.' })

function deployScript(y = yaml): string {
  const job = y.slice(y.indexOf('\n  deploy:'), y.indexOf('\n  take-down:'))
  const at = job.indexOf('- name: Deploy\n')
  const next = job.indexOf('\n      - name:', at + 1)
  const block = job.slice(at, next)
  return block.slice(block.indexOf('run: |\n') + 7).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n')
}

/** `answers`: one line per call — "active", "live" (ALREADY_LIVE) or "ok". */
function run(answers: string[], y = yaml) {
  const dir = mkdtempSync(join(tmpdir(), 'shipyard-deploy-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(dir, 'answers'), answers.join('\n') + '\n')
  writeFileSync(join(bin, 'mscomputer'), `#!/usr/bin/env bash
echo "$*" >> "$FAKE/calls"
case "$1" in
  teardown) echo "Ms. Computer teardown: terminated"; exit 0 ;;
esac
a=$(head -1 "$FAKE/answers"); sed -i 1d "$FAKE/answers"
case "$a" in
  active) echo "Code: APPLICATION_DEPLOYMENT_ACTIVE"; echo "Another deployment of this application is still in progress."; exit 2 ;;
  live) echo "Code: APPLICATION_ALREADY_LIVE"; exit 2 ;;
  ok) echo "Deployment dep_0123456789abcdef accepted for blog-a1234.ms.computer"; echo "URL: https://blog-a1234.ms.computer"; exit 0 ;;
esac
`)
  writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\necho "slept $1" >> "$FAKE/calls"\n')
  writeFileSync(join(bin, 'gh'), '#!/usr/bin/env bash\necho dep_feedfacecafe0001\n')
  for (const f of ['mscomputer', 'sleep', 'gh']) chmodSync(join(bin, f), 0o755)
  const out = join(dir, 'out')
  writeFileSync(out, '')
  const r = spawnSync('bash', ['-c', deployScript(y)], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE: dir, RUNNER_TEMP: dir, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: join(dir, 'summary'), APP_NAME: 'blog', REPLACE_DEPLOYMENT: '', GH_TOKEN: 'x', GITHUB_REPOSITORY: 'me/blog' },
  })
  return { r, calls: readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n'), out: readFileSync(out, 'utf8') }
}

test('waits and retries while an earlier deploy is still settling', () => {
  const { r, calls, out } = run(['active', 'active', 'ok'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(calls, ['deploy --name blog', 'slept 30', 'deploy --name blog', 'slept 30', 'deploy --name blog'])
  assert.match(r.stdout, /still settling on Ms\. Computer — trying again in 30s \(1\/10\)/)
  assert.match(out, /url=https:\/\/blog-a1234\.ms\.computer/)
})

test('also after replacing a live static site', () => {
  const { r, calls } = run(['live', 'active', 'ok'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(calls, ['deploy --name blog', 'teardown dep_feedfacecafe0001', 'deploy --name blog', 'slept 30', 'deploy --name blog'])
})

test('gives up after 10 waits with a readable error', () => {
  const { r, calls } = run(Array(12).fill('active'))
  assert.notEqual(r.status, 0)
  assert.equal(calls.filter((c) => c === 'slept 30').length, 10)
  assert.match(r.stdout, /::error title=Deploy failed/)
})

test('a Python app ms.computer can’t start: a plain-words error pointing to the Procfile fix', () => {
  const dyn = generateWorkflow({ appName: 'api', mode: 'dynamic', branch: 'main', packageManager: 'none', nodeVersion: '22', buildCommand: '', outputDir: '.', workingDir: '.' })
  const job = dyn.slice(dyn.indexOf('\n  deploy:'), dyn.indexOf('\n  take-down:'))
  const at = job.indexOf('- name: Plan and build the image\n')
  const block = job.slice(at, job.indexOf('\n      - name:', at + 1))
  const script = block.slice(block.indexOf('run: |\n') + 7).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n')
  const dir = mkdtempSync(join(tmpdir(), 'shipyard-plan-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'mscomputer'), `#!/usr/bin/env bash
echo '{"ok": false, "stage": "plan", "code": "PLAN_INPUT_REQUIRED", "message": "No production start command could be validated.", "data": {}}'
exit 1
`)
  chmodSync(join(bin, 'mscomputer'), 0o755)
  const r = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: dir } })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /::error title=ms\.computer can't tell how to start this app::No production start command could be validated\. Add a Procfile with one line, web: /)
  assert.match(r.stdout, /--port \$PORT\. Check the repo on Shipyard/)
  assert.doesNotMatch(r.stdout, /couldn't plan this app/)
})

test('a Python or Go app already live is replaced too (ms.computer won’t swap dynamic apps in place either)', () => {
  const dyn = generateWorkflow({ appName: 'blog', mode: 'dynamic', branch: 'main', packageManager: 'none', nodeVersion: '22', buildCommand: '', outputDir: '.', workingDir: '.' })
  const { r, calls, out } = run(['live', 'ok'], dyn)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(calls, ['deploy --name blog', 'teardown dep_feedfacecafe0001', 'deploy --name blog'])
  assert.match(r.stdout, /doesn't swap a live app in place/)
  assert.match(out, /url=https:\/\/blog-a1234\.ms\.computer/)
})

function stageScript(y: string): string {
  const job = y.slice(y.indexOf('\n  deploy:'), y.indexOf('\n  take-down:'))
  const at = job.indexOf('- name: Stage the built site\n')
  const block = job.slice(at, job.indexOf('\n      - name:', at + 1))
  return block.slice(block.indexOf('run: |\n') + 7).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n')
}

test('a moved single-page app: 404.html becomes the app, old paths become redirect pages', () => {
  const y = generateWorkflow({ appName: 'blog', mode: 'static', branch: 'main', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.', spa: true, redirectPages: [['/old', '/new/'], ['/docs.html', 'https://docs.example.com/'], ['/kept', '/x'], ['/bad path', '/x'], ['/q', "/x';rm -rf /;'"]] })
  const dir = mkdtempSync(join(tmpdir(), 'shipyard-stage-'))
  mkdirSync(join(dir, 'dist', 'kept'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'index.html'), '<div id="app"></div>')
  writeFileSync(join(dir, 'dist', '_redirects'), '/* /index.html 200')
  writeFileSync(join(dir, 'dist', 'netlify.toml'), '[build]')
  writeFileSync(join(dir, 'dist', 'kept', 'index.html'), 'a real page')
  const env = join(dir, 'env')
  const r = spawnSync('bash', ['-c', stageScript(y)], { cwd: dir, encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: dir, GITHUB_ENV: env, DEPLOY_SHA: 'abcdef0123' } })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const site = join(dir, 'site')
  assert.equal(readFileSync(join(site, '404.html'), 'utf8'), '<div id="app"></div>')
  assert.match(readFileSync(join(site, 'old', 'index.html'), 'utf8'), /http-equiv="refresh" content="0; url=\/new\/"/)
  assert.match(readFileSync(join(site, 'docs.html'), 'utf8'), /url=https:\/\/docs\.example\.com\//)
  assert.equal(readFileSync(join(site, 'kept', 'index.html'), 'utf8'), 'a real page', 'never overwrites a real page')
  assert.ok(!existsSync(join(site, '_redirects')) && !existsSync(join(site, 'netlify.toml')), 'the old host’s config isn’t published')
  assert.doesNotMatch(y, /bad path|rm -rf \/;/, 'unsafe paths never reach the workflow')
})

test('exact rules: the repo Caddyfile ships with the site, built as a server app (not --static)', () => {
  const y = generateWorkflow({ appName: 'blog', mode: 'static', branch: 'main', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.', caddyfile: 'Caddyfile', spa: true })
  assert.match(y, /cp "Caddyfile" "\$APP_DIR\/Caddyfile"/)
  assert.match(y, /mscomputer build \|\| exit 1/)
  assert.doesNotMatch(y, /build --static/)
  assert.doesNotMatch(y, /404\.html/, 'Caddy does the fallback itself')
})
