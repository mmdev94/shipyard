// Regenerates Shipyard's own deploy workflows from the config embedded in the
// production one, with the current generator — the same thing "Update
// workflow" on My sites does for any repo.
//   node --experimental-strip-types scripts/self-workflow.ts                 print the production workflow
//   node --experimental-strip-types scripts/self-workflow.ts --write         update .github/workflows/ms-computer.yml
//   node --experimental-strip-types scripts/self-workflow.ts --channel v2 [--write]
//       the v2 preview: a separate app (shipyard-v2) deployed from the v2 branch,
//       written to .github/workflows/ms-computer-v2.yml
import { readFileSync, writeFileSync } from 'node:fs'
import { generateWorkflow, readWorkflowConfig } from '../src/lib/workflow.ts'
import { channelWorkflow } from '../src/lib/channel.ts'

const prod = new URL('../.github/workflows/ms-computer.yml', import.meta.url)
const parsed = readWorkflowConfig(readFileSync(prod, 'utf8'))
if (!parsed) throw new Error('No Shipyard config in the workflow file')
const i = process.argv.indexOf('--channel')
const channel = i > 0 ? process.argv[i + 1] : null
const path = channel ? new URL(`../.github/workflows/ms-computer-${channel}.yml`, import.meta.url) : prod
const next = channel
  ? channelWorkflow(generateWorkflow({ ...parsed.config, appName: `${parsed.config.appName}-${channel}`, branch: channel, previews: false }), channel)
  : generateWorkflow(parsed.config)
if (process.argv.includes('--write')) writeFileSync(path, next)
else process.stdout.write(next)
