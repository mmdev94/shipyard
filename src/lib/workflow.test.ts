import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateWorkflow, readWorkflowConfig, WORKFLOW_VERSION, type WorkflowConfig } from './workflow.ts'

const base: WorkflowConfig = { appName: 'My Blog!', mode: 'static', branch: 'main', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.' }

test('embedded config round-trips and the name is normalized', () => {
  const read = readWorkflowConfig(generateWorkflow(base))
  assert.equal(read?.version, WORKFLOW_VERSION)
  assert.equal(read?.config.appName, 'my-blog')
  assert.equal(read?.config.outputDir, 'dist')
})

test('files Shipyard did not write are not read as config', () => {
  assert.equal(readWorkflowConfig('name: CI\non: push\n'), null)
  assert.equal(readWorkflowConfig('# shipyard-workflow: 2\n# shipyard-config: {not json}\n'), null)
})

test('no lockfile: plain install, no cache', () => {
  const y = generateWorkflow({ ...base, hasLockfile: false })
  assert.match(y, /^ {10}npm install$/m)
  assert.doesNotMatch(y, /cache: npm/)
  const locked = generateWorkflow(base)
  assert.match(locked, /^ {10}npm ci$/m)
  assert.match(locked, /cache: npm/)
})

test('take-down only runs when asked; deploy never runs then', () => {
  const y = generateWorkflow(base)
  assert.match(y, /deploy:\n {4}if: \$\{\{ github\.event_name != 'pull_request' && inputs\.action != 'take-down' \}\}/)
  assert.match(y, /take-down:\n {4}if: \$\{\{ inputs\.action == 'take-down' \}\}/)
})

test('v3: the workflow deletes the setup token itself, and signs files only when asked', () => {
  const base = { appName: 'blog', mode: 'static' as const, branch: 'main', packageManager: 'npm' as const, nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.' }
  const plain = generateWorkflow(base)
  assert.match(plain, /gh secret delete SHIPYARD_SETUP_TOKEN --repo "\$GITHUB_REPOSITORY"/)
  assert.ok(!plain.includes('attest-build-provenance'))
  assert.ok(!plain.includes('id-token'))
  const signed = generateWorkflow({ ...base, attest: true })
  assert.match(signed, /uses: actions\/attest-build-provenance@v4\n\s+with:\n\s+subject-path: 'dist\/\*\*'/)
  assert.match(signed, /permissions:\n  contents: read\n  deployments: write\n  id-token: write\n  attestations: write\n/)
  assert.equal(readWorkflowConfig(signed)?.config.attest, true)
})

test('v5: previews are opt-in, same-repo only, and never touch the production deploy job', () => {
  const base = { appName: 'blog', mode: 'static' as const, branch: 'main', packageManager: 'npm' as const, nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.' }
  const off = generateWorkflow(base)
  assert.ok(!off.includes('pull_request:'), 'no PR trigger unless asked')
  assert.ok(!off.includes('preview'))
  assert.match(off, /deploy:\n    if: \$\{\{ github.event_name != 'pull_request' && inputs.action != 'take-down' \}\}/)

  const on = generateWorkflow({ ...base, previews: true })
  assert.match(on, /pull_request:\n    branches: \[main\]\n    types: \[opened, synchronize, reopened, closed\]/)
  assert.match(on, /github.event.pull_request.head.repo.full_name == github.repository/, 'forks never get a preview')
  assert.match(on, /APP_NAME: blog-pr-\$\{\{ github.event.pull_request.number \}\}/)
  assert.match(on, /format\('ms-computer-pr-\{0\}', github.event.pull_request.number\)/, 'PRs don’t queue behind production')
  assert.match(on, /openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:KEYMAT/, 'the preview identity is stored encrypted')
  assert.match(on, /-F auto_inactive=false/, 'one PR’s preview never retires another’s')
  // the preview's deploy must not fall back to production's deploy records
  const preview = on.slice(on.indexOf('\n  preview:'))
  assert.ok(!preview.includes('environment=ms-computer&'), 'preview never looks up production deployments')
  assert.equal(readWorkflowConfig(on)?.config.previews, true)
})
