import { useEffect, useState } from 'react'
import { Logo } from './Logo'
import { SessionChip } from './Connect'
import { parseRoute } from '../lib/route'

const LINKS = [
  { label: 'How it works', href: '#/', section: 'story' },
  { label: 'Templates', href: '#/new' },
  { label: 'My sites', href: '#/sites' },
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
        <nav className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} onClick={(e) => go(e, l)} className="text-[15px] font-medium text-ink2 transition-colors hover:text-accent">
              {l.label}
            </a>
          ))}
        </nav>
        <span className="flex items-center gap-4">
        <SessionChip />
        <a
          href="#/"
          onClick={() => setTimeout(() => document.getElementById('repo')?.focus(), 60)}
          className="rounded-none border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#7d4ff0]"
        >
          Check a repo →
        </a>
        </span>
      </div>
    </header>
  )
}
