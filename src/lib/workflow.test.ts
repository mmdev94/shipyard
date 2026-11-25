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
  assert.match(y, /deploy:\n {4}if: \$\{\{ inputs\.action != 'take-down' \}\}/)
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
