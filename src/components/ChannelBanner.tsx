const PRODUCTION = 'https://shipyard-h0413.ms.computer'

/** On the v2 preview site only: says so, and points to the stable version. */
export function ChannelBanner() {
  if (!__CHANNEL__) return null
  return (
    <div className="relative z-50 bg-ink px-4 py-2 text-center text-[13px] text-white">
      <span className="font-mono mr-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em]">{__CHANNEL__} preview</span>
      New features being tested here — some may break.{' '}
      <a href={`${PRODUCTION}/${window.location.hash}`} className="font-semibold underline underline-offset-2 hover:text-accent">
        Use the stable Shipyard →
      </a>
    </div>
  )
}
