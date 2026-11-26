// Bare pages for exporting media from the same components the site plays:
//   #/clip/<id>  one guide clip at 960×600; the recorder calls
//                window.__clip.set(ms) for each frame
//   #/clip/title, #/clip/end   title and end cards for the ad
//   #/og         the 1200×630 link-preview image
import { useEffect, useState } from 'react'
import { CLIPS } from '../components/clips/clips'
import { Check, H, W } from '../components/clips/kit'
import { Mark } from '../components/Logo'

declare global {
  interface Window {
    __clip?: { duration: number; set: (t: number) => Promise<void> }
  }
}

function TitleCard() {
  return (
    <div className="grid h-full place-items-center bg-dark text-center text-white">
      <div>
        <div className="flex justify-center"><Mark className="h-16 w-16" /></div>
        <p className="font-display mt-6 text-[64px] font-semibold tracking-[-0.03em]">Shipyard</p>
        <p className="mt-2 text-[26px] text-white/75">Push to GitHub. Live on <span className="text-[#b9a7ff]">ms.computer</span>.</p>
      </div>
    </div>
  )
}

function EndCard() {
  return (
    <div className="grid h-full place-items-center bg-dark text-center text-white">
      <div>
        <p className="font-display text-[44px] font-semibold tracking-[-0.03em]">Try it — no account, nothing to install.</p>
        <p className="font-mono mt-6 inline-block bg-accent px-6 py-3 text-[26px]">shipyard-h0413.ms.computer</p>
        <p className="mt-6 text-[20px] text-white/60">Free · open source · first version — feedback welcome</p>
      </div>
    </div>
  )
}

export function ClipStage({ id }: { id: string }) {
  const clip = CLIPS[id]
  const [t, setT] = useState(clip?.duration ?? 0)
  useEffect(() => {
    window.__clip = {
      duration: clip?.duration ?? 2500,
      set: (ms) =>
        new Promise((resolve) => {
          setT(ms)
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
    }
    document.body.style.margin = '0'
  }, [clip])
  return (
    <div id="stage" className="relative overflow-hidden bg-white" style={{ width: W, height: H }}>
      {id === 'title' ? <TitleCard /> : id === 'end' ? <EndCard /> : clip ? clip.render(t) : <p className="p-8">No clip “{id}”.</p>}
    </div>
  )
}

/** The card Discord, X and others show when someone shares the link. */
export function OgCard() {
  const clip = CLIPS.check
  return (
    <div id="stage" className="relative flex overflow-hidden bg-[#eef0f5]" style={{ width: 1200, height: 630 }}>
      <div className="absolute left-[22px] top-[112px]" style={{ width: W, height: H, transform: 'scale(0.62)', transformOrigin: '0 0' }}>
        <div className="relative bg-transparent" style={{ width: W, height: H }}>{clip.render(clip.duration, true)}</div>
      </div>
      <div className="absolute right-0 top-0 flex h-full w-[600px] flex-col justify-center pl-[28px] pr-[56px]">
        <div className="flex items-center gap-4">
          <Mark className="h-16 w-16" />
          <span className="font-display text-[60px] font-bold tracking-[-0.03em] text-ink">Shipyard</span>
        </div>
        <p className="font-display mt-5 text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
          Push to GitHub.
          <br />
          Live on <span className="text-accent">ms.computer</span>.
        </p>
        <ul className="mt-6 space-y-2.5 text-[21px] text-ink2">
          {['Checks if your repo will run', 'One click turns on auto-deploy', 'Every push goes live, same address'].map((s) => (
            <li key={s} className="flex items-center gap-3">
              <Check done /> {s}
            </li>
          ))}
        </ul>
        <p className="font-mono mt-7 text-[17px] text-muted">No account · nothing to install · free</p>
      </div>
    </div>
  )
}
