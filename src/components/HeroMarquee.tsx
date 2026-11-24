const MSG = 'Build on Ms. Computer — host static sites, dynamic apps & sandboxes, run by everyone'

export function HeroMarquee() {
  const item = (
    <span className="flex shrink-0 items-center gap-6 pr-6 font-mono text-[12px] uppercase tracking-[0.1em] text-muted">
      {MSG}
      <a href="https://ms.computer" target="_blank" rel="noopener" className="text-accent hover:underline">
        Learn more →
      </a>
      <span className="h-1.5 w-1.5 rounded-none border border-accent bg-accent/50" />
    </span>
  )

  return (
    <div className="overflow-hidden border-b border-line bg-bg2 py-2.5">
      <div className="marquee flex w-max">
        {item}{item}{item}{item}
      </div>
    </div>
  )
}
