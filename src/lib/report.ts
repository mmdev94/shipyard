// "Report a problem": builds a GitHub issue (from the repo's issue forms) with
// what the visitor wrote plus a few details that make a report useful — the
// page, Shipyard's version, the browser, the error. Nothing is sent from here:
// the link opens GitHub with the form filled in, and the visitor submits it.
// Tokens never go in, even if someone pastes one.
import { useSyncExternalStore } from 'react'

export type ReportKind = 'bug' | 'idea' | 'question'

export const ISSUES = 'https://github.com/mmdev94/shipyard/issues'
const TEMPLATE: Record<ReportKind, string> = { bug: 'bug.yml', idea: 'idea.yml', question: 'question.yml' }
const PREFIX: Record<ReportKind, string> = { bug: '[Bug]', idea: '[Idea]', question: '[Question]' }

/** GitHub refuses very long URLs; stay well under. */
const MAX_URL = 7000

export interface ReportPreset {
  kind?: ReportKind
  /** an error message to attach */
  error?: string
  /** extra detail lines, e.g. "Repo: owner/repo" */
  details?: string[]
}

export interface ReportInput {
  kind: ReportKind
  what: string
  steps: string
  context: string[]
}

const TOKEN = /\b(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g

// Private repos seen in this tab. Issues are public, so their names never go
// into the details Shipyard adds (what people type themselves is up to them).
const hidden = new Set<string>()
/** Marks "owner/repo" as private: its name is left out of reports. */
export function hideRepo(owner: string, repo: string): void {
  hidden.add(`${owner}/${repo}`.toLowerCase())
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function hideNames(s: string): string {
  for (const full of hidden) s = s.replace(new RegExp(escape(full), 'gi'), '(a private repo)')
  return s
}

/** Removes anything that looks like a GitHub token. */
export const scrub = (s: string) => s.replace(TOKEN, '[token removed]')

/** "Chrome 131 on Windows" — enough to reproduce, no fingerprinting detail. */
export function describeBrowser(ua: string): string {
  const browser =
    /Edg\/(\d+)/.exec(ua)?.[1] ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}` :
    /OPR\/(\d+)/.exec(ua)?.[1] ? `Opera ${/OPR\/(\d+)/.exec(ua)![1]}` :
    /Firefox\/(\d+)/.exec(ua)?.[1] ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}` :
    /Chrome\/(\d+)/.exec(ua)?.[1] ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}` :
    /Version\/(\d+).*Safari/.exec(ua)?.[1] ? `Safari ${/Version\/(\d+).*Safari/.exec(ua)![1]}` :
    'Unknown browser'
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS'
  return `${browser} on ${os}`
}

/** The details block: page, version, browser, connection, error, extras. */
export function collectContext(opts: {
  hash: string
  commit: string
  builtAt: string
  ua: string
  viewport: [number, number]
  connected: boolean
  preset?: ReportPreset
  /** "v2" on the preview site */
  channel?: string
}): string[] {
  const lines = [
    `Page: ${opts.hash || '#/'}`,
    `Shipyard: ${opts.channel ? `${opts.channel} preview · ` : ''}${opts.commit} (built ${opts.builtAt.slice(0, 16).replace('T', ' ')} UTC)`,
    `Browser: ${describeBrowser(opts.ua)} · ${opts.viewport[0]}×${opts.viewport[1]}`,
    `GitHub connected: ${opts.connected ? 'yes' : 'no'}`,
    ...(opts.preset?.details ?? []),
  ]
  if (opts.preset?.error) lines.push(`Error: ${opts.preset.error.replace(/\s+/g, ' ').trim().slice(0, 600)}`)
  return lines.map((l) => hideNames(scrub(l)))
}

/** A short title from the first line of what they wrote. */
export function titleFor(kind: ReportKind, what: string): string {
  const first = scrub(what).split('\n').find((l) => l.trim())?.trim() ?? ''
  const short = first.length > 70 ? `${first.slice(0, 67).trimEnd()}…` : first
  return `${PREFIX[kind]} ${short || (kind === 'bug' ? 'Something went wrong' : kind === 'idea' ? 'An idea' : 'A question')}`
}

/** The GitHub link that opens the issue form with everything filled in. */
export function issueUrl(input: ReportInput): string {
  let what = scrub(input.what).trim()
  const steps = scrub(input.steps).trim().slice(0, 1500)
  const context = input.context.join('\n')
  const build = () =>
    `${ISSUES}/new?${new URLSearchParams({
      template: TEMPLATE[input.kind],
      title: titleFor(input.kind, what),
      what,
      ...(steps ? { steps } : {}),
      context,
    })}`
  let url = build()
  // trim the free text, never the details, until GitHub will take the link
  while (url.length > MAX_URL && what.length > 200) {
    what = `${what.slice(0, Math.floor(what.length * 0.8)).trimEnd()}…`
    url = build()
  }
  return url
}

/** The same report as plain text, for people who'd rather post it on Discord. */
export function reportText(input: ReportInput): string {
  const head = titleFor(input.kind, input.what)
  const steps = scrub(input.steps).trim()
  return [head, '', scrub(input.what).trim(), ...(steps ? ['', `What I was doing: ${steps}`] : []), '', ...input.context].join('\n')
}

// ── open / close, from anywhere ──────────────────────────────────────────────

let state: { open: boolean; preset: ReportPreset } = { open: false, preset: {} }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function openReport(preset: ReportPreset = {}): void {
  state = { open: true, preset }
  emit()
}
export function closeReport(): void {
  state = { open: false, preset: {} }
  emit()
}
export const useReport = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
