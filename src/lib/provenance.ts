// "Is this page really built from the public repo?" Each deploy of Shipyard
// signs every built file (actions/attest-build-provenance → Sigstore, stored by
// GitHub). Here the browser hashes the files it is actually running and asks
// GitHub's public API for the signed record of each hash.
//
// A page can't fully vouch for itself — a tampered page could fake this check
// too — so the UI also gives the terminal command for an independent check.

export interface FileCheck {
  /** path as served, e.g. /assets/index-abc.js */
  path: string
  sha256: string
  state: 'signed' | 'unsigned' | 'error'
  /** from the signed statement */
  commit?: string
  runUrl?: string
  workflow?: string
  note?: string
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes))
}

/** The files that make up the running page: the HTML (it carries the security policy), the entry script and the styles. */
export function pageFiles(doc: Document = document): string[] {
  const out = [doc.location.pathname || '/']
  const script = doc.querySelector<HTMLScriptElement>('script[type="module"][src]')
  if (script) out.push(new URL(script.src).pathname)
  doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]').forEach((l) => {
    const u = new URL(l.href)
    if (u.origin === doc.location.origin) out.push(u.pathname)
  })
  return out
}

interface Statement {
  predicate?: {
    buildDefinition?: {
      externalParameters?: { workflow?: { path?: string; ref?: string } }
      resolvedDependencies?: { digest?: { gitCommit?: string } }[]
    }
    runDetails?: { metadata?: { invocationId?: string } }
  }
}

/** Reads commit / run / workflow out of a GitHub attestation bundle. */
export function readStatement(bundle: unknown): Pick<FileCheck, 'commit' | 'runUrl' | 'workflow'> {
  try {
    const payload = (bundle as { dsseEnvelope?: { payload?: string } })?.dsseEnvelope?.payload
    if (!payload) return {}
    const st = JSON.parse(atob(payload)) as Statement
    const bd = st.predicate?.buildDefinition
    return {
      commit: bd?.resolvedDependencies?.[0]?.digest?.gitCommit,
      runUrl: st.predicate?.runDetails?.metadata?.invocationId,
      workflow: bd?.externalParameters?.workflow?.path,
    }
  } catch {
    return {}
  }
}

export async function checkFile(repo: string, path: string, fetchImpl: typeof fetch = fetch): Promise<FileCheck> {
  let sha = ''
  try {
    const res = await fetchImpl(path, { cache: 'no-store' })
    if (!res.ok) return { path, sha256: '', state: 'error', note: `the site answered ${res.status}` }
    sha = await sha256Hex(await res.arrayBuffer())
    const api = await fetchImpl(`https://api.github.com/repos/${repo}/attestations/sha256:${sha}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (api.status === 404) return { path, sha256: sha, state: 'unsigned' }
    if (!api.ok) return { path, sha256: sha, state: 'error', note: `GitHub answered ${api.status}` }
    const data = (await api.json()) as { attestations?: { bundle?: unknown }[] }
    const first = data.attestations?.[0]
    if (!first) return { path, sha256: sha, state: 'unsigned' }
    return { path, sha256: sha, state: 'signed', ...readStatement(first.bundle) }
  } catch (e) {
    return { path, sha256: sha, state: 'error', note: (e as Error).message }
  }
}

export const verifyCommand = (origin: string, path: string, repo: string) => {
  const name = path === '/' ? 'index.html' : path.split('/').pop()!
  return `curl -so ${name} ${origin}${path} && gh attestation verify ${name} -R ${repo}`
}
