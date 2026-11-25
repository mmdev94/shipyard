import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import type { Finding, Report, Severity } from '../lib/checker/index.ts'
import { normalizeAppName, type WorkflowConfig } from '../lib/workflow.ts'
import { DeployPanel } from './DeployPanel'
import { FixIt } from './FixIt'
import { availableFixes, type Fix } from '../lib/fixes'

const ORDER: Severity[] = ['fail', 'warn', 'info', 'pass']

const SEV: Record<Severity, { label: string; dot: string; ring: string; text: string }> = {
  fail: { label: 'Must fix', dot: 'bg-[#e0453a]', ring: 'border-[#f1c2bd] bg-[#fff6f5]', text: 'text-[#b3302a]' },
  warn: { label: 'Check this', dot: 'bg-warn', ring: 'border-[#ecd9b3] bg-[#fffbf2]', text: 'text-[#8f6113]' },
  info: { label: 'Good to know', dot: 'bg-accent', ring: 'border-line bg-white', text: 'text-accent2' },
  pass: { label: 'Passed', dot: 'bg-ok', ring: 'border-line bg-white', text: 'text-[#13804a]' },
}

const VERDICT = {
  static: { badge: 'Ready', tone: 'bg-ok', bar: 'from-[#1fae63]/15' },
  dynamic: { badge: 'Ready', tone: 'bg-ok', bar: 'from-[#1fae63]/15' },
  fix: { badge: 'Almost', tone: 'bg-warn', bar: 'from-[#c98a1e]/15' },
  unsupported: { badge: 'Not yet', tone: 'bg-[#e0453a]', bar: 'from-[#e0453a]/12' },
} as const

function blobUrl(r: Report, path: string, line?: number) {
  const p = path.split('/').map(encodeURIComponent).join('/')
  return `${r.repo.url}/blob/${encodeURIComponent(r.repo.branch)}/${p}${line ? `#L${line}` : ''}`
}

function FindingRow({ f, report, fix }: { f: Finding; report: Report; fix?: Fix }) {
  const [open, setOpen] = useState(f.severity === 'fail')
  const s = SEV[f.severity]
  const hasMore = Boolean(f.detail || f.fix || f.rule || f.evidence?.length)
  return (
    <div className={`border ${s.ring}`}>
      <button
        type="button"
        onClick={() => hasMore && setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span className={`mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">{f.title}</span>
          {!open && f.detail && <span className="mt-0.5 block truncate text-sm text-muted">{f.detail}</span>}
        </span>
        {fix && <span className="shrink-0 rounded-full bg-accentSoft px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-accent2">fixable</span>}
        <span className={`font-mono hidden shrink-0 text-[11px] uppercase tracking-[0.12em] sm:block ${s.text}`}>
          {f.category}
        </span>
        {hasMore && <span className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`}>›</span>}
      </button>
      {open && hasMore && (
        <div className="space-y-3 px-5 pb-5 pl-[2.6rem] text-[15px] leading-relaxed">
          {f.detail && <p className="text-ink2">{f.detail}</p>}
          {f.rule && (
            <p className="border-l-2 border-accent/50 pl-3 text-sm text-muted">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent">ms.computer rule · </span>
              {f.rule}
            </p>
          )}
          {f.fix && (
            <p className="text-ink2">
              <span className="font-semibold text-ink">Fix: </span>
              {f.fix}
            </p>
          )}
          {f.evidence && f.evidence.length > 0 && (
            <ul className="space-y-1.5">
              {f.evidence.slice(0, 6).map((e, i) => (
                <li key={i} className="font-mono overflow-hidden text-[12.5px]">
                  <a href={blobUrl(report, e.path, e.line)} target="_blank" rel="noopener" className="text-accent hover:underline">
                    {e.path}
                    {e.line ? `:${e.line}` : ''}
                  </a>
                  {e.snippet && <span className="ml-2 block truncate text-muted sm:inline">{e.snippet}</span>}
                </li>
              ))}
              {f.evidence.length > 6 && <li className="text-sm text-muted">…and {f.evidence.length - 6} more</li>}
            </ul>
          )}
          {fix && <FixIt fix={fix} report={report} />}
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  hint,
  mono = true,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
  mono?: boolean
}) {
  return (
    <label className="block">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={`mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-[14px] text-ink outline-none focus:border-accent ${mono ? 'font-mono' : ''}`}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Results({
  report,
  onPickApp,
}: {
  report: Report
  onPickApp: (dir: string | undefined) => void
}) {
  const d = report.detection
  const v = VERDICT[report.verdict.kind]
  const [cfg, setCfg] = useState<WorkflowConfig>(() => ({
    appName: normalizeAppName(report.repo.repo),
    mode: d.mode,
    branch: report.repo.branch,
    packageManager: d.packageManager,
    packageManagerPinned: d.packageManagerPinned,
    nodeVersion: d.nodeVersion,
    buildCommand: d.buildCommand,
    outputDir: d.outputDir,
    workingDir: d.workingDir,
  }))
  const set = (k: keyof WorkflowConfig) => (val: string) => setCfg((c) => ({ ...c, [k]: val }))

  const grouped = useMemo(
    () => ORDER.map((sev) => ({ sev, items: report.findings.filter((f) => f.severity === sev) })).filter((g) => g.items.length),
    [report.findings],
  )
  const fixes = useMemo(() => availableFixes(report), [report])
  const counts = Object.fromEntries(ORDER.map((s) => [s, report.findings.filter((f) => f.severity === s).length])) as Record<Severity, number>

  return (
    <motion.section
      id="results"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className="border-t border-line"
    >
      {/* verdict */}
      <div className={`bg-gradient-to-b ${v.bar} to-transparent px-6 py-12 md:px-14 md:py-16`}>
        <div className="mx-auto max-w-shell">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-white ${v.tone}`}>{v.badge}</span>
            <a href={report.repo.url} target="_blank" rel="noopener" className="font-mono text-sm text-ink2 hover:text-accent">
              {report.repo.owner}/{report.repo.repo}
              <span className="text-muted"> @ {report.repo.branch}</span>
            </a>
          </div>
          <h2 className="font-display mt-5 text-[clamp(1.9rem,4.4vw,3.3rem)] font-medium leading-[1.05] tracking-[-0.035em]">
            {report.verdict.title}
          </h2>
          <p className="mt-4 max-w-[60ch] text-lg leading-relaxed text-muted">{report.verdict.summary}</p>
          <div className="font-mono mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted">
            <span>
              {report.scanned.files} of {report.scanned.totalFiles} files read
              {report.scanned.truncated ? ' (repo too big to list fully)' : ''}
            </span>
            {ORDER.filter((s) => counts[s]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${SEV[s].dot}`} /> {counts[s]} {SEV[s].label.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="px-6 pb-16 md:px-14">
      <div className="mx-auto grid max-w-shell grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* findings */}
        <div className="space-y-8">
          {fixes
            .filter((x) => !x.findingId)
            .map((x) => (
              <div key={x.id} className="border border-accent/40 bg-accentSoft/40 p-5">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">Shipyard can fix this</span>
                <p className="mt-2 font-semibold text-ink">{x.title}</p>
                <p className="mt-1 mb-4 text-[14px] text-muted">{x.summary}</p>
                <FixIt fix={x} report={report} showHeader={false} />
              </div>
            ))}
          {grouped.map((g) => (
            <div key={g.sev}>
              <h3 className={`font-mono mb-3 text-[12px] uppercase tracking-[0.16em] ${SEV[g.sev].text}`}>
                {SEV[g.sev].label} · {g.items.length}
              </h3>
              <div className="space-y-2">
                {g.items.map((f) => (
                  <FindingRow key={f.id} f={f} report={report} fix={fixes.find((x) => x.findingId === f.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* detection — editable, feeds the workflow */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="border border-line bg-bg2 p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-semibold">What Shipyard found</h3>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent">{d.mode}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{d.frameworkLabel}. Edit anything that looks off — the workflow below follows these.</p>

            {d.apps.length > 1 && (
              <label className="mt-4 block">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">App in this monorepo</span>
                <select
                  value={d.workingDir}
                  onChange={(e) => onPickApp(e.target.value === '.' ? undefined : e.target.value)}
                  className="font-mono mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-[14px] outline-none focus:border-accent"
                >
                  {Array.from(new Set([d.workingDir, ...d.apps])).map((a) => (
                    <option key={a} value={a}>
                      {a === '.' ? '(repo root)' : a}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="mt-4 space-y-3.5">
              <Field
                label="App name"
                value={cfg.appName}
                onChange={set('appName')}
                hint={`URL: ${normalizeAppName(cfg.appName)}-•••••.ms.computer`}
              />
              <Field label="Branch" value={cfg.branch} onChange={set('branch')} />
              {cfg.mode === 'static' && (
                <>
                  <Field label="Build command" value={cfg.buildCommand} onChange={set('buildCommand')} hint={cfg.buildCommand ? undefined : 'None — files are served as they are.'} />
                  <Field label="Output folder" value={cfg.outputDir} onChange={set('outputDir')} />
                </>
              )}
              <Field label="App folder" value={cfg.workingDir} onChange={set('workingDir')} />
              {cfg.packageManager !== 'none' && cfg.packageManager !== 'bun' && (
                <Field label="Node version" value={cfg.nodeVersion} onChange={set('nodeVersion')} />
              )}
              <label className="flex cursor-pointer gap-3 border border-line bg-white p-3">
                <input
                  type="checkbox"
                  checked={Boolean(cfg.previews)}
                  onChange={(e) => setCfg((c) => ({ ...c, previews: e.target.checked }))}
                  className="mt-0.5 accent-[#8b5cf6]"
                />
                <span className="text-[13px] leading-relaxed text-muted">
                  <span className="block font-semibold text-ink">Preview pull requests</span>
                  Each PR from a branch of this repo gets its own address, updated on every push and taken down when the PR
                  closes. Forks never get one. Each preview is a separate ms.computer app, and its address stays reserved.
                </span>
              </label>
            </div>

            {d.reasons.length > 0 && (
              <details className="mt-4 text-sm text-muted">
                <summary className="cursor-pointer text-ink2">Why Shipyard thinks so</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {d.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </aside>
      </div>
      </div>

      <DeployPanel report={report} cfg={cfg} />
    </motion.section>
  )
}
