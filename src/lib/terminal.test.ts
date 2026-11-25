import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { terminalCommand, terminalScript, type TerminalInput } from './terminal.ts'
import { generateWorkflow } from './workflow.ts'

const yaml = generateWorkflow({ appName: 'blog', mode: 'static', branch: 'main', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.' })
const input = (over: Partial<TerminalInput> = {}): TerminalInput => ({
  owner: 'me', repo: "it's-blog", branch: 'main', yaml, trackUrl: 'https://shipyard.example/#/track/me/blog', setupToken: 'gh', ...over,
})

// A stand-in `gh` that answers like GitHub for a first deploy and logs what it was asked.
const FAKE_GH = `#!/usr/bin/env bash
LOG="$FAKE_DIR/log"
echo "gh $*" >> "$LOG"
case "$*" in
  "auth status") exit 0 ;;
  "auth token") echo "gho_from_the_cli" ;;
  api\\ repos/*/actions/variables/MSCOMPUTER_TOML) [ -n "$FAKE_DEPLOYED" ] && echo '{}' || exit 1 ;;
  secret\\ set\\ SHIPYARD_SETUP_TOKEN*) echo "secret=$(cat)" >> "$LOG" ;;
  api\\ repos/*/contents/*--jq\\ .content*) exit 1 ;;
  api\\ repos/*/contents/*--jq\\ .sha*) exit 1 ;;
  "api -X PUT"*) for a in "$@"; do case "$a" in content=*) printf '%s' "\${a#content=}" | base64 -d > "$FAKE_DIR/committed.yml" ;; esac; done; echo abc1234def ;;
  run\\ list*) n=$(cat "$FAKE_DIR/runs" 2>/dev/null || echo 0); echo $((n+1)) > "$FAKE_DIR/runs"; [ "$n" -ge 1 ] && echo 77 || echo "" ;;
  "run watch 77"*) exit 0 ;;
  api\\ repos/*/deployments\\?*) echo 5 ;;
  api\\ repos/*/deployments/5/statuses*) echo https://blog-a1.ms.computer ;;
  *) echo "unexpected: gh $*" >&2; exit 9 ;;
esac
`

function runWithFakeGh(script: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'shipyard-gh-'))
  writeFileSync(join(dir, 'gh'), FAKE_GH)
  chmodSync(join(dir, 'gh'), 0o755)
  const res = spawnSync('bash', ['-c', script], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_DIR: dir, ...env },
    encoding: 'utf8',
  })
  const log = readFileSync(join(dir, 'log'), 'utf8')
  return { res, log, dir }
}

test('the script is valid bash, in both setup-token modes', () => {
  for (const setupToken of ['gh', 'paste'] as const) {
    const r = spawnSync('bash', ['-n'], { input: terminalScript(input({ setupToken })), encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
  }
})

test('first deploy: saves the gh login as the setup secret, commits the exact workflow, follows the run', () => {
  const { res, log, dir } = runWithFakeGh(terminalCommand(input()))
  assert.equal(res.status, 0, res.stderr + res.stdout)
  assert.match(log, /gh secret set SHIPYARD_SETUP_TOKEN --repo me\/it's-blog/)
  assert.match(log, /secret=gho_from_the_cli/)
  assert.equal(readFileSync(join(dir, 'committed.yml'), 'utf8'), yaml.replace(/\n$/, '') + '\n')
  assert.match(log, /gh run watch 77 --repo me\/it's-blog --exit-status/)
  assert.match(res.stdout, /Live: https:\/\/blog-a1\.ms\.computer/)
  assert.ok(!res.stdout.includes('gho_from_the_cli'), 'the token is never printed')
})

test('a repo deployed before skips the setup secret', () => {
  const { res, log } = runWithFakeGh(terminalCommand(input()), { FAKE_DEPLOYED: '1' })
  assert.equal(res.status, 0, res.stderr)
  assert.ok(!log.includes('secret set'))
  assert.match(res.stdout, /Deployed before/)
})
