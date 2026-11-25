import type { RepoSnapshot, TreeEntry } from './types.ts'
import { currentToken } from '../github/client.ts'
import { logActivity } from '../github/activity.ts'

// Everything here runs in the visitor's browser. GitHub's API allows 60
// requests an hour per internet address without a login, and 5,000 with a
// token; a check uses two. File contents come from raw.githubusercontent.com,
// which is CORS-open and not counted. When GitHub is connected, checks use the
// token so they count against the larger allowance.
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

async function apiGet(fetchImpl: FetchLike, path: string): Promise<unknown> {
  let token = currentToken()
  let res: Response | undefined
  for (let attempt = 0; attempt < 3 && !res; attempt++) {
    try {
      res = await fetchImpl(`${API}${path}`, {
        headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  if (res.ok) return res.json()
  if (isRateLimited(res)) {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    throw new GitHubError(rateLimitMessage(Boolean(token)), res.status, reset ? new Date(reset * 1000) : undefined)
  }
  if (res.status === 404) {
    throw new GitHubError("Couldn't find that repo. It may be private, renamed, or misspelled — Shipyard can only read public repos.", 404)
  }
  throw new GitHubError(`GitHub answered ${res.status}. Try again in a moment.`, res.status)
}

export async function fetchSnapshot(ref: RepoRef, fetchImpl: FetchLike = fetch): Promise<RepoSnapshot> {
  const meta = (await apiGet(fetchImpl, `/repos/${ref.owner}/${ref.repo}`)) as {
    default_branch: string
    owner: { login: string }
    name: string
  }
  const owner = meta.owner.login
  const repo = meta.name
  const branch = ref.branch || meta.default_branch
  const tree = (await apiGet(
    fetchImpl,
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  )) as { tree: { path: string; type: string; size?: number }[]; truncated: boolean }

  const files: TreeEntry[] = tree.tree
    .filter((e) => e.type === 'blob')
    .map((e) => ({ path: e.path, size: e.size ?? 0 }))
  const sizes = new Map(files.map((f) => [f.path, f.size]))
  const cache = new Map<string, Promise<string | null>>()

  const read = (path: string): Promise<string | null> => {
    const size = sizes.get(path)
    if (size === undefined || size > MAX_READ_BYTES) return Promise.resolve(null)
    let hit = cache.get(path)
    if (!hit) {
      const url = `${RAW}/${owner}/${repo}/refs/heads/${branch
        .split('/')
        .map(encodeURIComponent)
        .join('/')}/${path.split('/').map(encodeURIComponent).join('/')}`
      const attempt = () => fetchImpl(url).then((r) => (r.ok ? r.text() : null))
      hit = attempt().catch(() => attempt().catch(() => null))
      cache.set(path, hit)
    }
    return hit
  }

  return { owner, repo, branch, files, truncated: tree.truncated, read }
}
