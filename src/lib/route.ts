import { useEffect, useState } from 'react'

// Hash routes keep this a plain static site (no server rewrites needed):
//   #/                      home (checker)
//   #/check/owner/repo      home with that repo checked
//   #/track/owner/repo      live deploy status
//   #/rules                 what runs on ms.computer
export type Route =
  | { page: 'home'; repo?: string }
  | { page: 'track'; owner: string; repo: string }
  | { page: 'rules' }

const SEG = /^[A-Za-z0-9_.-]+$/

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'rules') return { page: 'rules' }
  if (parts[0] === 'track' && SEG.test(parts[1] ?? '') && SEG.test(parts[2] ?? '')) {
    return { page: 'track', owner: parts[1], repo: parts[2] }
  }
  if (parts[0] === 'check' && parts.length >= 3) return { page: 'home', repo: parts.slice(1).join('/') }
  return { page: 'home' }
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
  rules: '#/rules',
}
