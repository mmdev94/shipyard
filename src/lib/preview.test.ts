// Runs the generated preview steps' real shell (openssl, tar, jq) with a
// stand-in `gh`, to prove a preview's identity survives the round trip:
// first run saves it encrypted, the next run decrypts and reuses it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateWorkflow } from './workflow.ts'

const yaml = generateWorkflow({ appName: 'blog', mode: 'static', branch: 'main', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.', previews: true })
const previewJob = yaml.slice(yaml.indexOf('\n  preview:'), yaml.indexOf('\n  preview-cleanup:'))

/** The `run: |` body of the named step in the preview job, de-indented. */
function step(name: string): string {
  const at = previewJob.indexOf(`- name: ${name}`)
  assert.ok(at >= 0, name)
  const next = previewJob.indexOf('\n      - name:', at + 1)
  const block = previewJob.slice(at, next < 0 ? undefined : next)
  const body = block.slice(block.indexOf('run: |\n') + 'run: |\n'.length)
  return body.split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n')
}

const has = (cmd: string) => spawnSync('bash', ['-c', `command -v ${cmd}`]).status === 0

test('a preview’s app identity survives the encrypt → decrypt round trip', { skip: !['openssl', 'jq', 'tar'].every(has) && 'needs openssl, jq, tar' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'shipyard-preview-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  // stand-in gh: returns the saved record (if any) for the lookup, captures the record on create
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
case "$*" in
  *"deployments?environment=ms-computer-preview"*)
    if [ -f "$FAKE/records.json" ]; then cat "$FAKE/records.json"; elif [ -f "$FAKE/record.json" ]; then cat "$FAKE/record.json"; fi ;;
  *"/deployments --input -"*) jq '. + {id: 77}' > "$FAKE/record.json"; echo 77 ;;
  *statuses*) echo "status $*" >> "$FAKE/statuses.log" ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
`)
  chmodSync(join(bin, 'gh'), 0o755)
  writeFileSync(join(bin, 'mscomputer'), `#!/usr/bin/env bash
echo "mscomputer $* key=$(sed -n 's/^key = "\\(.*\\)"/\\1/p' mscomputer.toml) secret=$(cat "$HOME/.config/mscomputer/applications/"*.secret | tr '\\n' ' ')" >> "$FAKE/teardowns.log"
`)
  chmodSync(join(bin, 'mscomputer'), 0o755)

  const env = (home: string, genv: string, extra: Record<string, string> = {}) => ({
    ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE: dir, HOME: home, RUNNER_TEMP: join(home, 'tmp'),
    GITHUB_ENV: genv, GITHUB_REPOSITORY: 'me/blog', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '1',
    PR: '7', APP_SECRET: 'bWFpbi1hcHAtc2VjcmV0', GH_TOKEN: 'x', ...extra,
  })
  const readEnv = (f: string) => Object.fromEntries(readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  const run = (script: string, e: NodeJS.ProcessEnv, cwd: string) => {
    const r = spawnSync('bash', ['-c', script], { env: e, cwd, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr + r.stdout)
    return r.stdout
  }

  // run 1: no record yet; the deploy created the app; the record step saves it encrypted
  const home1 = join(dir, 'h1'); mkdirSync(join(home1, 'tmp'), { recursive: true })
  const genv1 = join(dir, 'env1'); writeFileSync(genv1, '')
  assert.match(run(step('Restore the preview\'s identity'), env(home1, genv1), home1), /No preview on record/)
  const app = join(home1, 'app'); mkdirSync(app)
  writeFileSync(join(app, 'mscomputer.toml'), 'name = "blog-pr-7"\nkey = "app_123"\n')
  mkdirSync(join(home1, '.config/mscomputer/applications'), { recursive: true })
  writeFileSync(join(home1, '.config/mscomputer/applications/app_123.secret'), 'the-preview-secret')
  run(step('Record the preview on GitHub'), env(home1, genv1, { ...readEnv(genv1), DEP_ID: 'dep_abc123', URL: 'https://blog-pr-7-a1.ms.computer', DEPLOY_SHA: 'f'.repeat(40) }), app)
  const record = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8'))
  assert.equal(record.payload.pr, 7)
  assert.ok(!JSON.stringify(record).includes('the-preview-secret'), 'the secret is never stored in the clear')

  // run 2: a fresh runner finds the record and restores the same app
  const home2 = join(dir, 'h2'); mkdirSync(join(home2, 'tmp'), { recursive: true })
  const genv2 = join(dir, 'env2'); writeFileSync(genv2, '')
  const out = run(step('Restore the preview\'s identity'), env(home2, genv2), home2)
  assert.match(out, /Restored the preview app for PR #7/)
  const e2 = readEnv(genv2)
  assert.equal(e2.PREV_DEP, 'dep_abc123')
  assert.equal(e2.GH_PREVIEW, '77')
  assert.equal(readFileSync(join(home2, '.config/mscomputer/applications/app_123.secret'), 'utf8'), 'the-preview-secret')
  assert.match(readFileSync(e2.PREVIEW_TOML, 'utf8'), /key = "app_123"/)
})


test('closing the PR takes down every app it left — once each, with its own key', { skip: !['openssl', 'jq', 'tar'].every(has) && 'needs openssl, jq, tar' }, () => {
  const cleanupJob = yaml.slice(yaml.indexOf('\n  preview-cleanup:'))
  const at = cleanupJob.indexOf('- name: Take the preview down')
  const body = cleanupJob.slice(cleanupJob.indexOf('run: |\n', at) + 'run: |\n'.length).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n')

  const dir = mkdtempSync(join(tmpdir(), 'shipyard-cleanup-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const KEYMAT = spawnSync('bash', ['-c', `printf 'shipyard-preview:%s' 'bWFpbi1hcHAtc2VjcmV0' | sha256sum | cut -d' ' -f1`], { encoding: 'utf8' }).stdout.trim()
  const identity = (key: string, secret: string) => {
    const d = mkdtempSync(join(tmpdir(), 'id-'))
    writeFileSync(join(d, 'mscomputer.toml'), `name = "blog-pr-7"\nkey = "${key}"\n`)
    writeFileSync(join(d, `${key}.secret`), secret)
    return spawnSync('bash', ['-c', `tar -cz -C "${d}" . | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:KEYMAT | base64 -w0`], { env: { ...process.env, KEYMAT }, encoding: 'utf8' }).stdout
  }
  // newest first: the current app (two records: an update and the first deploy), plus a stray app from a failed run, plus another PR
  writeFileSync(join(dir, 'records.json'), JSON.stringify([
    { id: 40, payload: { pr: 7, ms_computer_deployment: 'dep_c3', identity: identity('app_new', 'S-new') } },
    { id: 39, payload: { pr: 8, ms_computer_deployment: 'dep_ff', identity: identity('app_other', 'S-other') } },
    { id: 38, payload: { pr: 7, ms_computer_deployment: 'dep_b2', identity: identity('app_new', 'S-new') } },
    { id: 37, payload: { pr: 7, ms_computer_deployment: 'dep_a1', identity: identity('app_stray', 'S-stray') } },
  ]))
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
case "$*" in
  *"deployments?environment=ms-computer-preview"*) jq "$(sed -n 's/.*--jq //p' <<< "$*")" "$FAKE/records.json" ;;
  *statuses*) echo "$*" >> "$FAKE/statuses.log" ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
`)
  writeFileSync(join(bin, 'mscomputer'), `#!/usr/bin/env bash
echo "$* key=$(sed -n 's/^key = "\\(.*\\)"/\\1/p' mscomputer.toml)" >> "$FAKE/teardowns.log"
`)
  chmodSync(join(bin, 'gh'), 0o755)
  chmodSync(join(bin, 'mscomputer'), 0o755)
  const home = join(dir, 'home'); mkdirSync(join(home, 'tmp'), { recursive: true })
  const r = spawnSync('bash', ['-c', body], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE: dir, HOME: home, RUNNER_TEMP: join(home, 'tmp'), GITHUB_REPOSITORY: 'me/blog', PR: '7', APP_SECRET: 'bWFpbi1hcHAtc2VjcmV0', GH_TOKEN: 'x' },
    cwd: home, encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.deepEqual(readFileSync(join(dir, 'teardowns.log'), 'utf8').trim().split('\n'), ['teardown dep_c3 key=app_new', 'teardown dep_a1 key=app_stray'])
  const statuses = readFileSync(join(dir, 'statuses.log'), 'utf8')
  for (const id of [40, 38, 37]) assert.match(statuses, new RegExp(`deployments/${id}/statuses -f state=inactive`))
  assert.ok(!statuses.includes('deployments/39/'), 'another PR’s preview is left alone')
  assert.match(r.stdout, /Preview taken down::PR #7 is closed, so its preview is offline \(2 apps\)/)
})
