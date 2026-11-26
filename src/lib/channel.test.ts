import { test } from 'node:test'
import assert from 'node:assert/strict'
import { channelWorkflow } from './channel.ts'
import { generateWorkflow, type WorkflowConfig } from './workflow.ts'

const PROD: WorkflowConfig = { appName: 'shipyard', mode: 'static', branch: 'main', packageManager: 'pnpm', nodeVersion: '22', buildCommand: 'pnpm run build', outputDir: 'dist', workingDir: '.', packageManagerPinned: true, hasLockfile: true, attest: true }

test('the v2 preview workflow never touches the production app', () => {
  const prod = generateWorkflow(PROD)
  const v2 = channelWorkflow(generateWorkflow({ ...PROD, appName: 'shipyard-v2', branch: 'v2' }), 'v2')
  // the production workflow really uses these — so the rewrite has something to do
  assert.match(prod, /secrets\.MSCOMPUTER_APP_SECRET\b/)
  assert.match(prod, /environment=ms-computer&/)

  assert.doesNotMatch(v2, /MSCOMPUTER_APP_SECRET(?!_V2)/, 'own app secret')
  assert.doesNotMatch(v2, /MSCOMPUTER_TOML(?!_V2)/, 'own app identity variable')
  assert.doesNotMatch(v2, /environment=ms-computer&|environment: "ms-computer"/, 'own deployment records')
  assert.doesNotMatch(v2, /production_environment: true/)
  assert.doesNotMatch(v2, /ms-computer-deploy\b/, 'own concurrency group')
  assert.match(v2, /group: ms-computer-v2-deploy/)
  assert.match(v2, /branches: \[v2\]/)
  assert.match(v2, /APP_NAME: shipyard-v2/)
  assert.match(v2, /gh secret set MSCOMPUTER_APP_SECRET_V2/)
  assert.match(v2, /gh variable set MSCOMPUTER_TOML_V2/)
  assert.match(v2, /^name: Deploy the v2 preview to ms\.computer$/m)
  // everything else is the same workflow, line for line
  const a = generateWorkflow({ ...PROD, appName: 'shipyard-v2', branch: 'v2' }).split('\n')
  const b = v2.split('\n')
  assert.equal(a.length, b.length)
  const changed = b.filter((line, n) => line !== a[n])
  assert.ok(changed.length > 5)
  for (const line of changed) assert.match(line, /_V2|ms-computer-v2|production_environment: false|^name: Deploy the v2 preview/, line)
})
