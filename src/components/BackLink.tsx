import type { MouseEvent } from 'react'
import { backLabel, href, previousPage } from '../lib/route'

/** "← My sites", "← blog check"… — goes back to the page the visitor came from, or home. */
export function BackLink() {
  const prev = previousPage()
  const onClick = (e: MouseEvent) => {
    if (!prev) return
    e.preventDefault()
    window.history.back()
  }
  return (
    <a href={prev?.hash ?? href.home} onClick={onClick} className="text-sm text-muted hover:text-accent">
      ← {prev ? backLabel(prev.route) : 'Shipyard'}
    </a>
  )
}
