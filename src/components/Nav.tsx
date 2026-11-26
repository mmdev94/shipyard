import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Logo } from './Logo'
import { SessionChip } from './Connect'
import { useSession } from '../lib/github/client.ts'
import { setActivityOpen } from '../lib/github/activity.ts'
import { parseRoute } from '../lib/route'

const LINKS = [
  { label: 'How it works', href: '#/', section: 'story' },
  { label: 'Templates', href: '#/new' },
  { label: 'Showcase', href: '#/showcase' },
  { label: 'My sites', href: '#/sites' },
  { label: 'Roadmap', href: '#/roadmap' },
  { label: 'Rules', href: '#/rules' },
  { label: 'FAQ', href: '#/', section: 'faq' },
]

// Hash routes own the URL fragment, so in-page links scroll instead of navigating.
function go(e: React.MouseEvent, l: (typeof LINKS)[number]) {
  if (!l.section) return
  e.preventDefault()
  const scroll = () => document.getElementById(l.section!)?.scrollIntoView({ behavior: 'smooth' })
  if (parseRoute(window.location.hash).page !== 'home') {
    window.location.hash = '#/'
    setTimeout(scroll, 80)
  } else scroll()
}

/** Room left between the logo, the links and the buttons on the right. */
const MIN_GAP = 28

/**
 * Whether the full row of links fits next to the logo and the right-hand
 * buttons. Measured, not guessed from a breakpoint: what fits depends on the
 * signed-in chip (and the login's length), the font and the browser's zoom.
 */
function useFits() {
  const row = useRef<HTMLDivElement>(null)
  const links = useRef<HTMLDivElement>(null)
  const session = useSession()
  const [fits, setFits] = useState(false)
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    const check = () => {
      const cs = getComputedStyle(el)
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const width = (sel: string) => (el.querySelector(sel) as HTMLElement | null)?.offsetWidth ?? 0
      const right = [...el.querySelectorAll<HTMLElement>('[data-nav-right] > :not([data-nav-menu])')]
        .filter((c) => c.offsetWidth > 0)
        .reduce((sum, c, i) => sum + c.offsetWidth + (i ? 16 : 0), 0)
      const need = width('[data-nav-logo]') + (links.current?.scrollWidth ?? 0) + right + MIN_GAP * 2
      setFits(need <= room)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    el.querySelectorAll('[data-nav-right] > *').forEach((c) => ro.observe(c))
    document.fonts?.ready.then(check).catch(() => {})
    return () => ro.disconnect()
  }, [session])
  return { row, links, fits }
}

export function Nav() {
  const session = useSession()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const { row, links, fits } = useFits()
  useEffect(() => {
    if (fits) setOpen(false)
  }, [fits])
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 20)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <header
      className={`sticky top-0 z-40 w-full transition-colors ${
        scrolled ? 'border-b border-line bg-white/85 backdrop-blur-md' : 'border-b border-line bg-white'
      }`}
    >
      <div ref={row} className="relative mx-auto flex max-w-frame items-center justify-between gap-4 whitespace-nowrap px-4 py-3.5 sm:px-6 md:px-8">
        <a href="#/" aria-label="Shipyard home" data-nav-logo className="shrink-0"><Logo tag /></a>
        {/* always laid out — when it doesn't fit, invisibly in a clipped box — so its width can be measured */}
        <div className={fits ? 'contents' : 'pointer-events-none invisible absolute inset-0 overflow-hidden'} aria-hidden={!fits}>
        <nav
          ref={links}
          className="flex w-max items-center gap-6 lg:gap-7"
        >
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} onClick={(e) => go(e, l)} tabIndex={fits ? undefined : -1} className="text-[15px] font-medium text-ink2 transition-colors hover:text-accent">
              {l.label}
            </a>
          ))}
        </nav>
        </div>
        <span data-nav-right className="flex shrink-0 items-center gap-3 md:gap-4">
        <SessionChip />
        <a
          href="#/"
          onClick={() => setTimeout(() => document.getElementById('repo')?.focus(), 60)}
          className="hidden rounded-none border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#7d4ff0] sm:inline-block md:px-5"
        >
          Check a repo →
        </a>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          data-nav-menu
          className={`border border-line bg-white px-3.5 py-2.5 text-sm font-semibold text-ink2 hover:border-ink/30 ${fits ? 'hidden' : ''}`}
        >
          {open ? 'Close' : 'Menu'}
        </button>
        </span>
      </div>
      {open && !fits && (
        <nav id="mobile-menu" className="border-t border-line bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto grid max-w-shell grid-cols-2 gap-1 sm:grid-cols-4">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={(e) => {
                  setOpen(false)
                  go(e, l)
                }}
                className="px-2 py-2.5 text-[15px] font-medium text-ink2 hover:text-accent"
              >
                {l.label}
              </a>
            ))}
            <a href="#/" onClick={() => { setOpen(false); setTimeout(() => document.getElementById('repo')?.focus(), 60) }} className="px-2 py-2.5 text-[15px] font-semibold text-accent sm:hidden">
              Check a repo →
            </a>
          </div>
          {session && (
            <div className="mx-auto mt-2 flex max-w-shell items-center gap-3 border-t border-line px-2 pt-3 md:hidden">
              <img src={session.viewer.avatar_url} alt="" className="h-7 w-7 shrink-0 rounded-full border border-line" />
              <span className="min-w-0 flex-1 truncate text-sm text-muted">
                Signed in as <strong className="text-ink2">{session.viewer.login}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setActivityOpen(true)
                }}
                className="shrink-0 border border-line px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted hover:border-ink/30 hover:text-ink"
              >
                Activity
              </button>
            </div>
          )}
        </nav>
      )}
    </header>
  )
}
