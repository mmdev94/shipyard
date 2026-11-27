import type { RepoSnapshot, TreeEntry } from './types.ts'
import { currentToken } from '../github/client.ts'
import { logActivity } from '../github/activity.ts'
import { hideRepo } from '../report.ts'

// Everything here runs in the visitor's browser. GitHub's API allows 60
// requests an hour per internet address without a login, and 5,000 with a
// token; a check uses two. File contents of public repos come from
// raw.githubusercontent.com, which is CORS-open and not counted. When GitHub is
// connected, checks use the token so they count against the larger allowance —
// and private repos the token covers can be read too, file by file through the
// API (the token never goes to the raw file server).
const API = 'https://api.github.com'
const RAW = 'https://raw.githubusercontent.com'
const MAX_READ_BYTES = 400_000

export interface RepoRef {
  owner: string
  repo: string
  branch?: string
}

export class GitHubError extends Error {
  status: number
  rateLimitReset?: Date
  constructor(message: string, status: number, rateLimitReset?: Date) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.rateLimitReset = rateLimitReset
  }
}

const NAME = /^[A-Za-z0-9_.-]+$/

/** Accepts owner/repo, github.com URLs, .git URLs and /tree/<branch> links. */
export function parseRepoInput(input: string): RepoRef | null {
  let s = input.trim()
  if (!s) return null
  s = s.replace(/^git@github\.com:/i, 'https://github.com/')
  s = s.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const parts = s.split('/')
  if (parts.length < 2) return null
  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/i, '')
  if (!NAME.test(owner) || !NAME.test(repo)) return null
  let branch: string | undefined
  if (parts[2] === 'tree' && parts.length > 3) branch = decodeURIComponent(parts.slice(3).join('/'))
  return { owner, repo, branch }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * What to say when GitHub's API refuses for its hourly limit. It's GitHub's
 * rule for its own API — nothing to do with Shipyard or ms.computer.
 */
export function rateLimitMessage(withToken: boolean): string {
  return withToken
    ? 'GitHub’s hourly limit for your token (5,000 requests) is used up. This is GitHub’s own rule for its API — not a Shipyard or ms.computer limit.'
    : 'GitHub’s hourly limit is used up. Without a GitHub login, GitHub allows 60 requests an hour from one internet address (a check uses about 2, and everyone on your network shares them). This is GitHub’s own rule for its API — not a Shipyard or ms.computer limit. Connect GitHub (My sites) to raise it to 5,000 an hour, or wait for the reset.'
}

/** GitHub refused because the hourly allowance is used up. */
export const isRateLimited = (res: Response) =>
  (res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0'

/**
 * GET from GitHub's API. `cache: 'no-cache'` makes the browser revalidate with
 * the ETag it holds, and GitHub doesn't count "not modified" answers against
 * the hourly limit — so asking again about something unchanged is free.
 */
async function apiFetch(fetchImpl: FetchLike, path: string, accept = 'application/vnd.github+json'): Promise<Response> {
  let token = currentToken()
  let res: Response | undefined
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await fetchImpl(`${API}${path}`, {
        cache: 'no-cache',
        headers: { Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      })
      if (token) logActivity('GET', path, res.status)
      // an expired or revoked token: fall back to reading anonymously
      if (res.status === 401 && token) {
        token = null
        res = undefined
      }
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
    }
  }
  if (!res) throw new GitHubError("Couldn't reach GitHub. Check your connection and try again.", 0)
  if (res.ok) return res
  if (isRateLimited(res)) {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    throw new GitHubError(rateLimitMessage(Boolean(token)), res.status, reset ? new Date(reset * 1000) : undefined)
  }
  if (res.status === 404 || res.status === 422) throw new GitHubError(notFoundMessage(Boolean(token)), 404)
  throw new GitHubError(`GitHub answered ${res.status}. Try again in a moment.`, res.status)
}

/**
 * GitHub answers 404 both for a repo that doesn't exist and for a private one
 * the visitor can't see, so say both — and how to get a private one checked.
 */
export function notFoundMessage(withToken: boolean): string {
  return withToken
    ? 'Couldn’t find that repo or branch. Check the spelling — or, if it’s private, your GitHub connection doesn’t include it: make a token whose Repository access covers this repo and connect again.'
    : 'Couldn’t find that repo or branch. Check the spelling — or, if it’s private, connect GitHub with a token that covers it, and Shipyard reads it with your token (in this tab only).'
}

/** The 404 that a private repo gives to a visitor who isn't connected — worth offering to connect. */
export const needsConnect = (e: unknown) => e instanceof GitHubError && e.status === 404 && e.message === notFoundMessage(false)

const apiGet = (fetchImpl: FetchLike, path: string) => apiFetch(fetchImpl, path).then((r) => r.json() as Promise<unknown>)
const enc = (ref: string) => ref.split('/').map(encodeURIComponent).join('/')

/** The commit a branch (or tag) points at right now — one small request, free when unchanged. */
export async function headCommit(owner: string, repo: string, ref: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const res = await apiFetch(fetchImpl, `/repos/${owner}/${repo}/commits/${enc(ref)}`, 'application/vnd.github.sha')
  return (await res.text()).trim()
}

export interface KnownRepo {
  owner: string
  repo: string
  branch: string
  private?: boolean
  hasPages?: boolean
}

/** Keeps at most `n` reads in flight (GitHub frowns on bursts of authenticated requests). */
function limiter(n: number) {
  let active = 0
  const queue: (() => void)[] = []
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => queue.push(r))
    active++
    try {
      return await job()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}

/**
 * One file of a private repo, with the visitor's token. Read by blob id, which
 * stays the same while the file's contents do — so after a commit, unchanged
 * files come back as "not modified" (free) and only changed ones are fetched.
 */
async function readBlob(fetchImpl: FetchLike, owner: string, repo: string, sha: string, path: string): Promise<string | null> {
  const token = currentToken()
  if (!token) return null
  const api = `/repos/${owner}/${repo}/git/blobs/${sha}`
  const res = await fetchImpl(`${API}${api}`, {
    cache: 'no-cache',
    headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${token}` },
  })
  logActivity('GET', `${api} (${path})`, res.status)
  return res.ok ? res.text() : null
}

/**
 * Reads one file of a checked repo — for the "Fix it for me" preview. Public
 * repos come from the raw file server; private ones through the API with the
 * visitor's token (null without one).
 */
export async function readRepoFile(
  r: { owner: string; repo: string; branch: string; commit?: string; private?: boolean },
  path: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const at = r.commit ?? enc(r.branch)
  if (!r.private) {
    const res = await fetchImpl(`${RAW}/${r.owner}/${r.repo}/${at}/${enc(path)}`)
    return res.ok ? res.text() : null
  }
  const token = currentToken()
  if (!token) return null
  const api = `/repos/${r.owner}/${r.repo}/contents/${enc(path)}?ref=${at}`
  const res = await fetchImpl(`${API}${api}`, {
    cache: 'no-cache',
    headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${token}` },
  })
  logActivity('GET', api, res.status)
  return res.ok ? res.text() : null
}

/**
 * Reads a repo at one commit. Everything is pinned to that commit — the file
 * list and every file's contents — so a check never mixes a fresh list with
 * file copies GitHub's file server cached minutes ago (it caches by branch
 * name for 5 minutes, but a commit's files never change). `known` skips the
 * repo lookup when re-checking.
 */
export async function fetchSnapshot(ref: RepoRef, fetchImpl: FetchLike = fetch, known?: KnownRepo): Promise<RepoSnapshot> {
  let owner: string, repo: string, branch: string, isPrivate: boolean, hasPages: boolean
  if (known) {
    ;({ owner, repo, branch } = known)
    isPrivate = Boolean(known.private)
    hasPages = Boolean(known.hasPages)
  } else {
    const meta = (await apiGet(fetchImpl, `/repos/${ref.owner}/${ref.repo}`)) as { default_branch: string; owner: { login: string }; name: string; private?: boolean; has_pages?: boolean }
    owner = meta.owner.login
    repo = meta.name
    branch = ref.branch || meta.default_branch
    isPrivate = Boolean(meta.private)
    hasPages = Boolean(meta.has_pages)
  }
  const commit = await headCommit(owner, repo, branch, fetchImpl)
  const tree = (await apiGet(fetchImpl, `/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`)) as {
    tree: { path: string; type: string; size?: number; sha?: string }[]
    truncated: boolean
  }

  const blobs = tree.tree.filter((e) => e.type === 'blob')
  const files: TreeEntry[] = blobs.map((e) => ({ path: e.path, size: e.size ?? 0 }))
  const sizes = new Map(files.map((f) => [f.path, f.size]))
  const shas = new Map(blobs.map((e) => [e.path, e.sha ?? '']))
  const cache = new Map<string, Promise<string | null>>()
  const slot = limiter(6)

  const read = (path: string): Promise<string | null> => {
    const size = sizes.get(path)
    if (size === undefined || size > MAX_READ_BYTES) return Promise.resolve(null)
    let hit = cache.get(path)
    if (!hit) {
      const url = `${RAW}/${owner}/${repo}/${commit}/${enc(path)}`
      const sha = shas.get(path)
      const attempt = isPrivate
        ? () => (sha ? slot(() => readBlob(fetchImpl, owner, repo, sha, path)) : Promise.resolve(null))
        : () => fetchImpl(url).then((r) => (r.ok ? r.text() : null))
      hit = attempt().catch(() => attempt().catch(() => null))
      cache.set(path, hit)
    }
    return hit
  }

  if (isPrivate) hideRepo(owner, repo)
  return { owner, repo, branch, commit, private: isPrivate, ...(hasPages ? { hasPages } : {}), files, truncated: tree.truncated, read }
}
