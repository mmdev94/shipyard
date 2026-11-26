// Runs the generated Deploy step's real shell against a stand-in `mscomputer`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateWorkflow } from './workflow.ts'

const yaml = generateWorkflow({ appName: 'blog', mode: 'static', branch: 'main', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.' })

function deployScript(): string {
  const job = yaml.slice(yaml.indexOf('\n  deploy:'), yaml.indexOf('\n  take-down:'))
  const at = job.indexOf('- name: Deploy\n')
  const next = job.indexOf('\n      - name:', at + 1)
  const block = job.slice(at, next)
  return block.slice(block.indexOf('run: |\n') + 7).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n')
}

/** `answers`: one line per call — "active", "live" (ALREADY_LIVE) or "ok". */
function run(answers: string[]) {
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
  const r = spawnSync('bash', ['-c', deployScript()], {
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
