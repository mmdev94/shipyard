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

export const newSecretUrl = (owner: string, repo: string) =>
  `https://github.com/${owner}/${repo}/settings/secrets/actions/new`
export const actionsUrl = (owner: string, repo: string) =>
  `https://github.com/${owner}/${repo}/actions/workflows/ms-computer.yml`
export const badgeImage = (owner: string, repo: string) =>
  `https://github.com/${owner}/${repo}/actions/workflows/ms-computer.yml/badge.svg`

export function badgeMarkdown(owner: string, repo: string): string {
  return `[![Deploy to ms.computer](${badgeImage(owner, repo)})](${SITE}#/track/${owner}/${repo})`
}
