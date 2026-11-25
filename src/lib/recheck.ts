import type { Finding, Report } from './checker/types.ts'

/** What a re-check found, shown above the results. */
export type Recheck =
  | { kind: 'busy' }
  | { kind: 'same'; commit: string; at: number }
  | { kind: 'changed'; commit: string; fixed: string[]; added: string[]; at: number }
  | { kind: 'error'; message: string }

const BAD = (f: Finding) => f.severity === 'fail' || f.severity === 'warn'

/** Findings that went away (fixed) or appeared (new problems) between two reports. */
export function diffFindings(before: Report, after: Report): { fixed: string[]; added: string[] } {
  const bad = (r: Report) => new Map(r.findings.filter(BAD).map((f) => [f.id, f.title]))
  const a = bad(before)
  const b = bad(after)
  return {
    fixed: [...a].filter(([id]) => !b.has(id)).map(([, t]) => t),
    added: [...b].filter(([id]) => !a.has(id)).map(([, t]) => t),
  }
}

