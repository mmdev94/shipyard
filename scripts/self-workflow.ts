// Regenerates Shipyard's own .github/workflows/ms-computer.yml from the config
// embedded in it, with the current generator — the same thing "Update
// workflow" on My sites does for any repo.
//   node --experimental-strip-types scripts/self-workflow.ts          print it
//   node --experimental-strip-types scripts/self-workflow.ts --write  update the file
import { readFileSync, writeFileSync } from 'node:fs'
import { generateWorkflow, readWorkflowConfig } from '../src/lib/workflow.ts'

const path = new URL('../.github/workflows/ms-computer.yml', import.meta.url)
const parsed = readWorkflowConfig(readFileSync(path, 'utf8'))
if (!parsed) throw new Error('No Shipyard config in the workflow file')
const next = generateWorkflow(parsed.config)
if (process.argv.includes('--write')) writeFileSync(path, next)
else process.stdout.write(next)
