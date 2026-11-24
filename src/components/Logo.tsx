// Shipyard's own mark: a hull on a slipway. Kept separate from the ms.computer
// logo — Shipyard is a community tool, not an official ms.computer product.
export function Mark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <span className={`grid place-items-center rounded-lg bg-dark ${className}`}>
      <svg viewBox="0 0 24 24" className="h-[60%] w-[60%]" fill="none" aria-hidden>
        <path d="M4 13h16l-2.6 5.2a1.5 1.5 0 0 1-1.34.8H7.94a1.5 1.5 0 0 1-1.34-.8L4 13Z" fill="#8f63ff" />
        <path d="M12 4v8M12 5l5 6h-5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 21.5h18" stroke="#fff" strokeOpacity=".45" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export function Logo({ light = false, tag = false }: { light?: boolean; tag?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark />
      <span className="leading-none">
        <span className={`font-display block text-[17px] font-bold tracking-[-0.01em] ${light ? 'text-white' : 'text-ink'}`}>Shipyard</span>
        {tag && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">for ms.computer</span>}
      </span>
    </span>
  )
}
