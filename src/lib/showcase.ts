// The showcase: ms.computer sites people chose to list, found with no backend.
// A repo opts in by adding the GitHub topic `ms-computer`; GitHub's public
// search finds it. Its live address is the repo's Website field when that's an
// ms.computer URL, or else the latest deploy Shipyard recorded for it.
import { loadLiveSite, publicGet } from './track.ts'

export const TOPIC = 'ms-computer'
const MS_URL = /^https:\/\/[a-z0-9-]+\.ms\.computer\/?$/i

export interface Listing {
  owner: string
  repo: string
  description: string | null
  repoUrl: string
  avatar: string
  stars: number
  pushedAt: string
  language: string | null
  /** null: no ms.computer address found (yet) */
  url: string | null
  /** the address came from a Shipyard deploy record (so it deploys on every push) */
  viaShipyard: boolean
}

interface SearchItem {
  name: string
  owner: { login: string; avatar_url: string }
  description: string | null
  html_url: string
  homepage: string | null
  stargazers_count: number
  pushed_at: string
  language: string | null
  archived: boolean
}

/** At most this many deploy-record lookups (2 reads each) per load, to stay inside GitHub's anonymous limit. */
const LOOKUPS = 12

export function msUrl(homepage: string | null | undefined): string | null {
  const h = (homepage ?? '').trim()
  return MS_URL.test(h) ? h.replace(/\/$/, '') : null
}

export async function loadShowcase(): Promise<Listing[]> {
  const q = encodeURIComponent(`topic:${TOPIC} archived:false`)
  const res = await publicGet<{ items: SearchItem[] }>(`/search/repositories?q=${q}&sort=updated&order=desc&per_page=60`)
  let lookups = 0
  const listings = await Promise.all(
    res.items.map(async (r): Promise<Listing> => {
      const base: Listing = {
        owner: r.owner.login,
        repo: r.name,
        description: r.description,
        repoUrl: r.html_url,
        avatar: r.owner.avatar_url,
        stars: r.stargazers_count,
        pushedAt: r.pushed_at,
        language: r.language,
        url: msUrl(r.homepage),
        viaShipyard: false,
      }
      if (base.url || lookups >= LOOKUPS) return base
      lookups++
      const live = await loadLiveSite(r.owner.login, r.name).catch(() => null)
      return live?.liveUrl ? { ...base, url: live.liveUrl.replace(/\/$/, ''), viaShipyard: true } : base
    }),
  )
  // live sites first, then by most recent push (search order)
  return listings.filter((l) => l.url).concat(listings.filter((l) => !l.url))
}

/** The site's name for display: "my-blog" → "my blog". */
export const displayName = (repo: string) => repo.replace(/[-_]+/g, ' ').trim()
