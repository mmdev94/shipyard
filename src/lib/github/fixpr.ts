// Opens a "Fix it for me" pull request: reads the files at the branch's
// current head (so the fix never reverts newer edits), applies the fix, and
// commits it on a new branch with one tree — then opens the PR. Nothing lands
// on the default branch until someone merges it.
import type { FetchLike } from './client.ts'
import { fromBase64, repoCaller } from './deploy.ts'
import type { FileChange, Fix } from '../fixes.ts'

export interface FixPrInput {
  owner: string
  repo: string
  /** the branch the check ran on — the PR targets it */
  branch: string
  token: string
  fix: Fix
  fetchImpl?: FetchLike
}

export interface FixPrResult {
  url: string
  number: number
  changes: FileChange[]
}

export async function openFixPr({ owner, repo, branch, token, fix, fetchImpl }: FixPrInput): Promise<FixPrResult> {
  const call = repoCaller(owner, repo, token, fetchImpl)
  const meta = await call<{ permissions?: { push?: boolean }; archived?: boolean } | null>('GET', '', undefined, true)
  if (!meta) throw new Error(`The token can’t see ${owner}/${repo}. Give it access to this repo.`)
  if (meta.archived) throw new Error('This repo is archived, so nothing can be committed to it.')
  if (meta.permissions && meta.permissions.push === false) {
    throw new Error('The token can only read this repo. Pull requests from Shipyard need write access (you can fork it and check the fork instead).')
  }

  const ref = await call<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodeURIComponent(branch)}`)
  const head = ref.object.sha
  const read = async (path: string) => {
    const f = await call<{ content?: string; encoding?: string } | null>('GET', `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${head}`, undefined, true)
    return f?.content !== undefined && f.encoding === 'base64' ? fromBase64(f.content) : null
  }
  const changes = await fix.build(read)
  if (!changes.length) throw new Error('There’s nothing left to change — it looks fixed already. Re-check the repo.')

  const base = await call<{ tree: { sha: string } }>('GET', `/git/commits/${head}`)
  const tree = await call<{ sha: string }>('POST', '/git/trees', {
    base_tree: base.tree.sha,
    tree: changes.map((c) =>
      c.after === null ? { path: c.path, mode: '100644', type: 'blob', sha: null } : { path: c.path, mode: '100644', type: 'blob', content: c.after },
    ),
  })
  const commit = await call<{ sha: string }>('POST', '/git/commits', {
    message: `${fix.prTitle} (Shipyard)`,
    tree: tree.sha,
    parents: [head],
  })

  // a branch per fix; if an earlier one is still around, add a suffix rather than overwrite it
  let name = `shipyard/${fix.id}`
  try {
    await call('POST', '/git/refs', { ref: `refs/heads/${name}`, sha: commit.sha })
  } catch (e) {
    if ((e as { status?: number }).status !== 422) throw e
    name = `shipyard/${fix.id}-${Date.now().toString(36)}`
    await call('POST', '/git/refs', { ref: `refs/heads/${name}`, sha: commit.sha })
  }

  const pr = await call<{ html_url: string; number: number }>('POST', '/pulls', {
    title: fix.prTitle,
    head: name,
    base: branch,
    body: fix.prBody,
  })
  return { url: pr.html_url, number: pr.number, changes }
}
