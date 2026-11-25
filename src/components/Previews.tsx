import { useEffect, useState } from 'react'
import { loadPreviews, type Preview } from '../lib/track'

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/** Pull request previews (workflow v5 with previews on). Renders nothing for repos without any. */
export function Previews({ owner, repo, refreshKey }: { owner: string; repo: string; refreshKey: string }) {
  const [previews, setPreviews] = useState<Preview[] | null>(null)
  useEffect(() => {
    let alive = true
    loadPreviews(owner, repo)
      .then((p) => alive && setPreviews(p))
      .catch(() => alive && setPreviews([]))
    return () => {
      alive = false
    }
  }, [owner, repo, refreshKey])
  if (!previews || previews.length === 0) return null

  return (
    <div className="border border-line bg-white">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-semibold">Pull request previews</h2>
        <p className="mt-0.5 text-[13px] text-muted">Each open PR from this repo runs at its own address; closing it takes the preview down.</p>
      </div>
      <ol className="divide-y divide-line/70">
        {previews.map((p) => (
          <li key={p.pr} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.state === 'live' ? 'bg-ok' : 'bg-line'}`} />
            <a href={`https://github.com/${owner}/${repo}/pull/${p.pr}`} target="_blank" rel="noopener" className="font-semibold hover:text-accent">
              PR #{p.pr}
            </a>
            {p.state === 'live' && p.url ? (
              <a href={p.url} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate text-[14px] text-accent hover:underline">
                {p.url.replace('https://', '')}
              </a>
            ) : (
              <span className="min-w-0 flex-1 text-[14px] text-muted">{p.state === 'down' ? 'closed — taken down' : 'status unknown'}</span>
            )}
            <span className="font-mono text-[12px] text-muted">
              {p.sha.slice(0, 7)} · {ago(p.at)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
