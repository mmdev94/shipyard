// A GitHub API client that holds the visitor's token in memory only.
//
// GitHub's OAuth endpoints (github.com/login/...) send no CORS headers, so a
// static page can't finish an OAuth or device-code login without a server —
// and ms.computer apps have no secrets and no outbound network. api.github.com
// does allow an Authorization header from any origin, so a fine-grained token
// pasted by the user works. It lives in this module's variable: never in
// cookies, localStorage or the URL, and it is gone on refresh. The page's
// Content-Security-Policy only allows network calls to GitHub.
import { useSyncExternalStore } from 'react'

export interface Viewer {
  login: string
  avatar_url: string
  html_url: string
}

interface Session {
  token: string
  viewer: Viewer
}

let session: Session | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function useSession(): Session | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => session,
  )
}

export const currentToken = (): string | null => session?.token ?? null

export function signOut(): void {
  session = null
  emit()
}

export class GhError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GhError'
    this.status = status
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const API = 'https://api.github.com'

/** Calls the GitHub REST API with the given token (or the session's). */
export async function gh<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts: { token?: string | null; fetchImpl?: FetchLike; allow404?: boolean } = {},
): Promise<T> {
  const token = opts.token === undefined ? currentToken() : opts.token
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await (opts.fetchImpl ?? fetch)(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: method === 'GET' ? 'no-cache' : 'no-store',
    })
  } catch {
    throw new GhError("Couldn't reach GitHub. Check your connection.", 0)
  }
  if (res.status === 404 && opts.allow404) return null as T
  if (res.status === 204 || res.status === 205) return null as T
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    const msg = (data as { message?: string } | null)?.message ?? `GitHub answered ${res.status}`
    throw new GhError(msg, res.status)
  }
  return data as T
}

/** Checks a pasted token and starts a session. Throws a readable error. */
export async function signIn(raw: string, fetchImpl?: FetchLike): Promise<Viewer> {
  const token = raw.trim()
  if (!/^(github_pat_|ghp_|gho_|ghu_)[A-Za-z0-9_]{20,}$/.test(token)) {
    throw new GhError('That doesn’t look like a GitHub token. Fine-grained tokens start with github_pat_.', 0)
  }
  let viewer: Viewer
  try {
    viewer = await gh<Viewer>('GET', '/user', undefined, { token, fetchImpl })
  } catch (e) {
    if (e instanceof GhError && e.status === 401) throw new GhError('GitHub didn’t accept that token — it may be expired or mistyped.', 401)
    throw e
  }
  session = { token, viewer }
  emit()
  return viewer
}

/** Turns GitHub's terse 403/404 answers into what to change on the token page. */
export function explain(e: unknown, need: string): string {
  if (e instanceof GhError) {
    if (e.status === 403 || e.status === 404) {
      return `The token can’t ${need}. On GitHub, edit the token: give it access to this repo and the permissions Shipyard lists, then try again.`
    }
    if (e.status === 401) return 'The token expired or was revoked. Connect a new one.'
    if (e.status === 422) return `GitHub refused it: ${e.message}`
    return e.message
  }
  return (e as Error)?.message ?? String(e)
}
