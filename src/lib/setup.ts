// Links and snippets for the four setup steps. Everything is a plain GitHub URL
// — Shipyard never sees a token, and there is no Shipyard server.

export const WORKFLOW_PATH = '.github/workflows/ms-computer.yml'
export const SITE = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''

const enc = encodeURIComponent

/**
 * GitHub's "create new file" page with the path filled in. GitHub refuses URLs
 * over ~7 KB (414/500), and the workflow is ~16 KB encoded, so the YAML goes on
 * the clipboard and the user pastes it — the whole workflow stays in their repo.
 */
export function newWorkflowUrl(owner: string, repo: string, branch: string): string {
  return `https://github.com/${owner}/${repo}/new/${branch.split('/').map(enc).join('/')}?filename=${enc(WORKFLOW_PATH)}`
}

/** Fine-grained token template: only Secrets + Variables write, 7 days. The user picks the repo. */
export function setupTokenUrl(owner: string, repo: string): string {
  const q = new URLSearchParams({
    name: `Shipyard setup · ${repo}`.slice(0, 40),
    description: `One-time token for the first ms.computer deploy of ${owner}/${repo}. Lets the workflow save the app's identity as a repo secret and variable. Safe to delete after the first deploy.`,
    target_name: owner,
    expires_in: '7',
    secrets: 'write',
    actions_variables: 'write',
  })
  return `https://github.com/settings/personal-access-tokens/new?${q}`
}

/**
 * Token for one-click deploys and the dashboard. Everything Shipyard does
 * through the API needs exactly these — nothing account-wide, no Administration
 * (so it can't delete or rename repos), and it expires in 7 days.
 */
export const CONNECT_PERMISSIONS = [
  ['contents', 'write', 'commit the workflow file'],
  ['workflows', 'write', 'GitHub requires it for files in .github/workflows'],
  ['secrets', 'write', 'save the one-time setup secret, then delete it'],
  ['actions_variables', 'write', 'read whether an app already exists'],
  ['actions', 'write', 'start, redeploy and take down runs'],
  ['pull_requests', 'write', 'open “Fix it for me” pull requests (only when you click it)'],
] as const

export function connectTokenUrl(owner?: string): string {
  const q = new URLSearchParams({
    name: 'Shipyard',
    description: 'Lets shipyard on ms.computer commit a deploy workflow and manage its Actions secrets. Used in the browser only; never stored.',
    expires_in: '7',
    ...(owner ? { target_name: owner } : {}),
  })
  for (const [perm, level] of CONNECT_PERMISSIONS) q.set(perm, level)
  return `https://github.com/settings/personal-access-tokens/new?${q}`
}

export const newSecretUrl = (owner: string, repo: string) =>
  `https://github.com/${owner}/${repo}/settings/secrets/actions/new`
export const actionsUrl = (owner: string, repo: string) =>
  `https://github.com/${owner}/${repo}/actions/workflows/ms-computer.yml`
export const badgeImage = (owner: string, repo: string) =>
  `https://github.com/${owner}/${repo}/actions/workflows/ms-computer.yml/badge.svg`

export function badgeMarkdown(owner: string, repo: string): string {
  return `[![Deploy to ms.computer](${badgeImage(owner, repo)})](${SITE}#/track/${owner}/${repo})`
}
