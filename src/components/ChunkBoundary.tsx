import { Component, type ReactNode } from 'react'
import { ReportLink } from './Report'

// Every deploy replaces the site's files, so a tab opened before a deploy can
// ask for a page's code that no longer exists. Reloading once picks up the new
// version; anything else gets a message instead of a blank page.
const RELOADED = 'shipyard:chunk-reload'

export const isChunkError = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch dynamically|ChunkLoadError/i.test(String((e as Error)?.message ?? e))

/** Reload once (per minute) for a missing chunk; false if that was already tried. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED) ?? 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem(RELOADED, String(Date.now()))
  } catch {
    /* storage blocked: still worth one reload */
  }
  window.location.reload()
  return true
}

export class ChunkBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  componentDidCatch(error: unknown) {
    if (isChunkError(error)) reloadForNewVersion()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunk = isChunkError(error)
    const message = String((error as Error)?.message ?? error)
    return (
      <section className="px-6 py-14 md:px-14 md:py-20" role="alert">
        <div className="mx-auto max-w-shell">
          <h1 className="font-display text-[clamp(1.8rem,4vw,2.6rem)] font-medium tracking-[-0.03em]">
            {chunk ? 'Shipyard was just updated.' : 'This page hit an error.'}
          </h1>
          <p className="mt-3 max-w-[60ch] text-muted">
            {chunk ? 'A new version went live while this tab was open. Reload to get it.' : 'Reloading usually helps. If it keeps happening, please report it.'}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => window.location.reload()} className="border border-accent bg-accent px-5 py-3 font-semibold text-white hover:bg-[#7d4ff0]">
              Reload
            </button>
            {!chunk && <ReportLink preset={{ error: message.slice(0, 300) }} />}
          </div>
        </div>
      </section>
    )
  }
}
