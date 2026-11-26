import { useEffect, useState } from 'react'
import { Logo } from './Logo'
import { SessionChip } from './Connect'
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

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
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
      <div className="mx-auto flex max-w-shell items-center justify-between px-6 py-3.5 md:px-8">
        <a href="#/" aria-label="Shipyard home"><Logo tag /></a>
        <nav className="hidden items-center gap-7 xl:flex">
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} onClick={(e) => go(e, l)} className="text-[15px] font-medium text-ink2 transition-colors hover:text-accent">
              {l.label}
            </a>
          ))}
        </nav>
        <span className="flex items-center gap-3 md:gap-4">
        <SessionChip />
        <a
          href="#/"
          onClick={() => setTimeout(() => document.getElementById('repo')?.focus(), 60)}
          className="hidden rounded-none border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#7d4ff0] sm:inline-block"
        >
          Check a repo →
        </a>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="border border-line bg-white px-3.5 py-2.5 text-sm font-semibold text-ink2 hover:border-ink/30 xl:hidden"
        >
          {open ? 'Close' : 'Menu'}
        </button>
        </span>
      </div>
      {open && (
        <nav id="mobile-menu" className="border-t border-line bg-white px-6 py-3 xl:hidden">
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
        </nav>
      )}
    </header>
  )
}
