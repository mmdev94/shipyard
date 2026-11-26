import { useEffect, useState } from 'react'

// Hash routes keep this a plain static site (no server rewrites needed):
//   #/                      home (checker)
//   #/check/owner/repo      home with that repo checked
//   #/track/owner/repo      live deploy status
//   #/rules                 what runs on ms.computer
//   #/new[/template]        start a new site from a template
//   #/sites                 dashboard of your deployed repos (needs a token)
//   #/showcase              ms.computer sites listed with the ms-computer topic
//   #/move                  move a site from GitHub Pages, Netlify or Vercel
//   #/deploy/owner/repo     "Deploy to Ms. Computer" button: copy a repo and deploy it
export type Route =
  | { page: 'home'; repo?: string }
  | { page: 'track'; owner: string; repo: string }
  | { page: 'deploy'; owner: string; repo: string }
  | { page: 'rules' }
  | { page: 'new'; template?: string }
  | { page: 'sites' }
  | { page: 'showcase' }
  | { page: 'roadmap' }
  | { page: 'move' }
  | { page: 'clip'; id: string }
  | { page: 'og' }

const SEG = /^[A-Za-z0-9_.-]+$/

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'rules') return { page: 'rules' }
  if (parts[0] === 'new') return { page: 'new', template: parts[1] }
  if (parts[0] === 'sites') return { page: 'sites' }
  if (parts[0] === 'showcase') return { page: 'showcase' }
  if (parts[0] === 'roadmap') return { page: 'roadmap' }
  if (parts[0] === 'move') return { page: 'move' }
  if (parts[0] === 'clip' && parts[1]) return { page: 'clip', id: parts[1] }
  if (parts[0] === 'og') return { page: 'og' }
  if (parts[0] === 'track' && SEG.test(parts[1] ?? '') && SEG.test(parts[2] ?? '')) {
    return { page: 'track', owner: parts[1], repo: parts[2] }
  }
  if (parts[0] === 'deploy' && SEG.test(parts[1] ?? '') && SEG.test(parts[2] ?? '')) {
    return { page: 'deploy', owner: parts[1], repo: parts[2] }
  }
  if (parts[0] === 'check' && parts.length >= 3) return { page: 'home', repo: parts.slice(1).join('/') }
  return { page: 'home' }
}

// The pages the visitor walked through, so "back" can return to where they
// came from (My sites, a check, a template) instead of always the home page.
// Registered at load, before React's listener, so it's current on render.
const trail: string[] = [normalize(window.location.hash)]
function normalize(hash: string) {
  return hash.startsWith('#/') ? hash : '#/'
}
window.addEventListener('hashchange', () => {
  const next = normalize(window.location.hash)
  if (next === trail[trail.length - 1]) return
  if (next === trail[trail.length - 2]) trail.pop() // browser back
  else trail.push(next)
  if (trail.length > 50) trail.shift()
})

/** The in-app page before this one, if the visitor came from one. */
export function previousPage(): { hash: string; route: Route } | null {
  const hash = trail[trail.length - 2]
  return hash ? { hash, route: parseRoute(hash) } : null
}

export function backLabel(r: Route): string {
  switch (r.page) {
    case 'sites':
      return 'My sites'
    case 'showcase':
      return 'Showcase'
    case 'roadmap':
      return 'Roadmap'
    case 'move':
      return 'Move my site'
    case 'clip':
    case 'og':
      return 'Shipyard'
    case 'new':
      return 'Templates'
    case 'rules':
      return 'Rules'
    case 'track':
      return `${r.repo} tracker`
    case 'deploy':
      return `Deploy ${r.repo}`
    case 'home':
      return r.repo ? `${r.repo.split('/')[1] ?? r.repo} check` : 'Shipyard'
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const href = {
  home: '#/',
  check: (owner: string, repo: string, branch?: string) =>
    `#/check/${owner}/${repo}${branch ? `/tree/${branch.split('/').map(encodeURIComponent).join('/')}` : ''}`,
  track: (owner: string, repo: string) => `#/track/${owner}/${repo}`,
  deploy: (owner: string, repo: string) => `#/deploy/${owner}/${repo}`,
  rules: '#/rules',
  newSite: (template?: string) => `#/new${template ? `/${template}` : ''}`,
  sites: '#/sites',
  showcase: '#/showcase',
  roadmap: '#/roadmap',
  move: '#/move',
}
