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
