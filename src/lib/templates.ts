// Starter sites a visitor can turn into their own repo + live ms.computer URL.
// Files live in /templates/<id>/ in this repo; `gitignore` is renamed to
// `.gitignore` on the way out (dotfiles don't survive bundling well).
import type { WorkflowConfig } from './workflow.ts'

export interface Template {
  id: 'page' | 'react' | 'blog'
  name: string
  blurb: string
  stack: string
  edit: string
  config: Omit<WorkflowConfig, 'appName' | 'branch'>
}

export const TEMPLATES: Template[] = [
  {
    id: 'page',
    name: 'Personal page',
    blurb: 'One HTML page and a stylesheet. No build step — the fastest way to a live site.',
    stack: 'HTML + CSS',
    edit: 'index.html',
    config: { mode: 'static', packageManager: 'none', nodeVersion: '22', buildCommand: '', outputDir: '.', workingDir: '.', hasLockfile: false },
  },
  {
    id: 'react',
    name: 'React app',
    blurb: 'A Vite + React app, built by GitHub Actions on every push and served as static files.',
    stack: 'Vite · React 19',
    edit: 'src/App.jsx',
    config: { mode: 'static', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.', hasLockfile: true },
  },
  {
    id: 'blog',
    name: 'Markdown blog',
    blurb: 'An Astro blog. Write a post as a .md file, push, and it’s published.',
    stack: 'Astro 7 · Markdown',
    edit: 'src/pages/posts/',
    config: { mode: 'static', packageManager: 'npm', nodeVersion: '22', buildCommand: 'npm run build', outputDir: 'dist', workingDir: '.', hasLockfile: true },
  },
]

/** Repo names Shipyard creates: GitHub-safe, and safe inside the templates' HTML/JS/JSON. */
export const SITE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/

export interface FillVars {
  owner: string
  repo: string
  date?: string
}

/** Swaps the {{…}} placeholders and restores dotfile names. */
export function fillTemplate(files: Record<string, string>, vars: FillVars): Record<string, string> {
  if (!SITE_NAME.test(vars.repo)) throw new Error('Use letters, numbers, dots, dashes or underscores for the name.')
  const siteName = vars.repo.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const date = vars.date ?? new Date().toISOString().slice(0, 10)
  const out: Record<string, string> = {}
  for (const [path, text] of Object.entries(files)) {
    const name = path === 'gitignore' ? '.gitignore' : path
    out[name] = text
      .replaceAll('{{SITE_NAME}}', siteName)
      .replaceAll('{{OWNER}}', vars.owner)
      .replaceAll('{{REPO}}', path.endsWith('package.json') || path.endsWith('package-lock.json') ? vars.repo.toLowerCase() : vars.repo)
      .replaceAll('{{DATE}}', date)
  }
  return out
}
