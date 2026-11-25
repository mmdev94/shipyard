import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffFindings } from './recheck.ts'
import type { Finding, Report } from './checker/types.ts'

const r = (findings: Partial<Finding>[]) => ({ findings: findings.map((f) => ({ category: 'platform', detail: '', ...f })) }) as unknown as Report

test('a re-check names what was fixed and what is new', () => {
  const before = r([
    { id: 'env-file', severity: 'fail', title: 'A .env file is committed' },
    { id: 'port', severity: 'warn', title: 'Listens on a fixed port' },
    { id: 'index', severity: 'pass', title: 'index.html at the root' },
  ])
  const after = r([
    { id: 'env-file', severity: 'pass', title: 'No .env files committed' },
    { id: 'port', severity: 'warn', title: 'Listens on a fixed port' },
    { id: 'big-files', severity: 'fail', title: 'Files over 16 MiB' },
  ])
  assert.deepEqual(diffFindings(before, after), { fixed: ['A .env file is committed'], added: ['Files over 16 MiB'] })
  assert.deepEqual(diffFindings(after, after), { fixed: [], added: [] })
})
