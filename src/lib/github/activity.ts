// Every GitHub API call made with the visitor's token, in this tab, in plain
// words — so "what did Shipyard do with my token?" has an exact answer.
// Kept in memory only, like the token itself.
import { useSyncExternalStore } from 'react'

export interface Activity {
  id: number
  at: number
  method: string
  path: string
  /** HTTP status, or 0 if GitHub couldn't be reached */
  status: number
  /** repeated identical reads (the tracker polls) are folded into one line */
  count: number
}

let entries: Activity[] = []
let nextId = 1
let open = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function logActivity(method: string, path: string, status: number): void {
  // the tracker re-reads the same few things every few seconds: fold a
  // repeated read into its earlier line instead of flooding the log
  const i = isWrite(method) ? -1 : entries.slice(0, 12).findIndex((e) => e.method === method && e.path === path && e.status === status)
  if (i >= 0) {
    const e = entries[i]
    entries = [{ ...e, at: Date.now(), count: e.count + 1 }, ...entries.filter((_, j) => j !== i)]
  } else {
    entries = [{ id: nextId++, at: Date.now(), method, path, status, count: 1 }, ...entries].slice(0, 300)
  }
  emit()
}

export function clearActivity(): void {
  entries = []
  emit()
}

export const activitySnapshot = () => entries
export const useActivity = () => useSyncExternalStore(subscribe, activitySnapshot)
export const useActivityOpen = () => useSyncExternalStore(subscribe, () => open)
export function setActivityOpen(v: boolean): void {
  open = v
  emit()
}

export const isWrite = (method: string) => method !== 'GET' && method !== 'HEAD'

/** Plain-English description of a GitHub REST call. */
export function describe(method: string, rawPath: string): string {
  const path = rawPath.split('?')[0]
  const q = new URLSearchParams(rawPath.split('?')[1] ?? '')
  if (path === '/user') return 'Read your GitHub username and avatar'
  if (path === '/user/repos') return 'Listed the repos this token can see'

  const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path)
  if (!m) return `${method} ${path}`
  const repo = `${m[1]}/${m[2]}`
  const rest = m[3] ?? ''
  const d = (s: string) => decodeURIComponent(s)
  let r: RegExpExecArray | null

  if (rest === '') return `Read ${repo}’s settings (default branch, whether you can push)`
  if ((r = /^\/branches\/(.+)$/.exec(rest))) return `Checked that branch “${d(r[1])}” exists in ${repo}`
  if (rest === '/actions/secrets/public-key') return `Fetched ${repo}’s public key, to encrypt a secret in your browser`
  if ((r = /^\/actions\/secrets\/([^/]+)$/.exec(rest))) {
    if (method === 'PUT') return `Saved the encrypted secret ${r[1]} in ${repo}`
    if (method === 'DELETE') return `Deleted the secret ${r[1]} from ${repo}`
    return `Checked whether ${repo} has the secret ${r[1]} (GitHub never returns secret values)`
  }
  if ((r = /^\/actions\/variables\/([^/]+)$/.exec(rest))) return `Checked whether ${repo} has the variable ${r[1]}`
  if ((r = /^\/contents\/(.+)$/.exec(rest))) {
    if (method === 'PUT') return `Committed ${d(r[1])} to ${repo}${q.get('ref') ? ` (${q.get('ref')})` : ''}`
    return `Read ${d(r[1])} in ${repo}`
  }
  if (/^\/git\/ref\/heads\//.test(rest)) return `Read the latest commit of ${repo}`
  if (/^\/git\/trees\//.test(rest)) return `Listed the files in ${repo}`
  if (rest === '/git/trees') return `Prepared the template’s files for one commit in ${repo}`
  if (/^\/git\/commits\//.test(rest)) return `Read a commit in ${repo}`
  if (rest === '/git/commits') return `Created the commit in ${repo}`
  if (rest === '/git/refs') return `Created a new branch in ${repo} for the fix`
  if (rest === '/pulls') return `Opened a pull request in ${repo}`
  if ((r = /^\/git\/refs\/heads\/(.+)$/.exec(rest))) return `Moved branch “${d(r[1])}” of ${repo} to that commit`
  if (/\/dispatches$/.test(rest)) return `Started the deploy workflow in ${repo}`
  if (/^\/actions\/workflows\/[^/]+\/runs$/.test(rest)) return `Checked ${repo}’s deploy runs`
  if (/^\/actions\/workflows\/[^/]+$/.test(rest)) return `Checked that ${repo} has the deploy workflow`
  if (/^\/actions\/runs\/\d+\/jobs$/.test(rest)) return `Read the progress of a deploy run in ${repo}`
  if (/^\/check-runs\/\d+\/annotations$/.test(rest)) return `Read the errors and notes of a run in ${repo}`
  if (/^\/actions\/jobs\/\d+\/logs$/.test(rest)) return `Downloaded the full log of a run in ${repo}`
  if (/^\/deployments\/\d+\/statuses$/.test(rest)) return `Read whether ${repo}’s site is live`
  if (rest === '/deployments') return `Read ${repo}’s deploy records`
  return `${method} ${rest} in ${repo}`
}
