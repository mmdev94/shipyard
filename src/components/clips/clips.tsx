import { appear, Caption, Check, Cursor, prog, typed, Window, type Clip } from './kit'

const WIN = { left: 24, top: 16, width: 912, height: 504 }
const REPO = 'you/my-site'

/** 1 — paste a repo, see if it runs */
const check: Clip = {
  id: 'check',
  title: 'Check your repo',
  caption: 'Paste your GitHub repo — see if it runs on ms.computer',
  duration: 8200,
  render: (t, bare) => {
    const clicked = t >= 2900
    const reading = t >= 3000 && t < 4100
    const done = t >= 4100
    const rows = ['index.html at the root', 'No leaked keys or secrets', 'No database needed', 'Every file under 16 MiB']
    return (
      <>
        <Window style={WIN}>
          <div className="absolute inset-x-0 top-[40px] text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">GitHub → ms.computer</p>
            <h3 className="font-display mt-3 text-[34px] font-medium tracking-[-0.03em] text-ink">
              Will your repo run on <span className="text-accent">ms.computer?</span>
            </h3>
          </div>
          <div className="absolute left-[176px] top-[150px] flex h-[52px] w-[560px]">
            <div className={`flex flex-1 items-center border ${t > 400 && !done ? 'border-accent' : 'border-line'} bg-white`}>
              <span className="font-mono pl-4 text-[15px] text-muted">github.com/</span>
              <span className="font-mono text-[15px] text-ink">{typed(REPO, t, 500, 2000)}</span>
              {t > 400 && t < 2900 && Math.floor(t / 450) % 2 === 0 && <span className="ml-px h-5 w-px bg-ink" />}
            </div>
            <span className={`grid w-[150px] place-items-center font-semibold text-white ${clicked && t < 3300 ? 'bg-[#7d4ff0]' : 'bg-accent'}`}>Check repo →</span>
          </div>
          {reading && (
            <div className="absolute left-[176px] top-[240px] w-[560px] text-center">
              <p className="font-mono text-[13px] text-muted">Reading {REPO} — {Math.round(prog(t, 3000, 4000) * 24)} of 24 files</p>
              <div className="mx-auto mt-3 h-[3px] w-[360px] bg-line">
                <div className="h-full bg-accent" style={{ width: `${prog(t, 3000, 4000) * 100}%` }} />
              </div>
            </div>
          )}
          {done && (
            <div className="absolute left-[176px] top-[230px] w-[560px] border border-ok/40 bg-[#f3fbf6] p-5" style={appear(t, 4100)}>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-ok px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white">Ready</span>
                <span className="font-mono text-[13px] text-muted">{REPO} @ main</span>
              </div>
              <p className="font-display mt-2 text-[24px] font-medium tracking-[-0.02em] text-ink">Deploys as a static site</p>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                {rows.map((r, i) => (
                  <li key={r} className="flex items-center gap-2 text-[14px] text-ink2" style={appear(t, 4500 + i * 300)}>
                    <Check done /> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Window>
        {!bare && <Cursor t={t} path={[[0, 760, 470], [2200, 760, 470], [2800, 690, 192], [8200, 690, 192]]} clicks={[2900]} />}
        {!bare && <Caption n="1" text={check.caption} />}
      </>
    )
  },
}

/** 2 — one click sets up the auto-deploy */
const deploy: Clip = {
  id: 'deploy',
  title: 'Turn on auto-deploy',
  caption: 'One click adds the auto-deploy workflow to your repo',
  duration: 8600,
  render: (t, bare) => {
    const steps = ['Check the token can write to the repo', 'Save a one-time setup secret', 'Commit .github/workflows/ms-computer.yml', 'Start the deploy']
    const at = (i: number) => 2200 + i * 1050
    return (
      <>
        <Window style={WIN}>
          <div className="absolute left-[56px] right-[56px] top-[34px]">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">Auto-deploy · about 3 minutes</p>
            <h3 className="font-display mt-2 text-[30px] font-medium tracking-[-0.03em] text-ink">
              Every push to <span className="font-mono text-[0.8em] text-accent">main</span> goes live.
            </h3>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[
                ['One click', 'Token held in this tab only'],
                ['Terminal', 'GitHub CLI — no token here'],
                ['By hand', 'Four GitHub pages'],
              ].map(([a, b], i) => (
                <div key={a} className={`border px-4 py-2.5 ${i === 0 ? 'border-accent shadow-[inset_0_-3px_0_#8f63ff]' : 'border-line'}`}>
                  <p className="font-semibold text-ink">{a}</p>
                  <p className="text-[12px] text-muted">{b}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border border-ok/40 bg-[#f3fbf6] px-4 py-2.5 text-[14px]">
              <span>
                Connected as <strong>you</strong> <span className="text-muted">· token held in this tab only</span>
              </span>
              <span className={`px-4 py-2 text-[13px] font-semibold text-white ${t >= 1700 && t < 2100 ? 'bg-[#7d4ff0]' : 'bg-accent'}`}>Deploy to ms.computer</span>
            </div>
            {t >= 2000 && (
              <ol className="mt-4 space-y-2.5" style={appear(t, 2000)}>
                {steps.map((s, i) => (
                  <li key={s} className="flex items-center gap-3 text-[15px] text-ink2">
                    <Check done={t >= at(i) + 800} doing={t >= at(i) && t < at(i) + 800} />
                    <span className={t >= at(i) ? 'text-ink' : 'text-muted'}>{s}</span>
                  </li>
                ))}
              </ol>
            )}
            {t >= 6600 && (
              <p className="mt-4 text-[14px] font-semibold text-[#13804a]" style={appear(t, 6600)}>
                Done — opening the tracker…
              </p>
            )}
          </div>
        </Window>
        {!bare && <Cursor t={t} path={[[0, 520, 460], [900, 520, 460], [1600, 800, 266], [8600, 800, 266]]} clicks={[1700]} />}
        {!bare && <Caption n="2" text={deploy.caption} />}
      </>
    )
  },
}

/** 3 — push like always, it goes live */
const push: Clip = {
  id: 'push',
  title: 'Push and it’s live',
  caption: 'Push like always — it’s live at the same address',
  duration: 9400,
  render: (t, bare) => {
    const steps = ['Check out', 'Install and build', 'Build the image', 'Deploy']
    const at = (i: number) => 3000 + i * 900
    const live = t >= 6700
    return (
      <>
        <Window dark url="~/my-site — zsh" style={{ left: 24, top: 16, width: 380, height: 504 }}>
          <div className="font-mono space-y-1 p-4 text-[13px] leading-relaxed text-[#d9d4ff]">
            <p>
              <span className="text-[#7CFFB2]">~/my-site</span> $ {typed('git commit -am "New homepage"', t, 400, 1500)}
            </p>
            {t > 1600 && <p className="text-white/50">[main 4f1c2e9] New homepage</p>}
            {t > 1800 && (
              <p>
                <span className="text-[#7CFFB2]">~/my-site</span> $ {typed('git push', t, 1900, 2400)}
              </p>
            )}
            {t > 2600 && <p className="text-white/50">To github.com/you/my-site</p>}
            {t > 2700 && <p className="text-white/50">&nbsp;&nbsp; 9b0a1c3..4f1c2e9 main → main</p>}
          </div>
        </Window>
        <Window url="shipyard-h0413.ms.computer/#/track/you/my-site" style={{ left: 420, top: 16, width: 516, height: 504 }}>
          <div className="p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Deploy tracker</p>
            <p className="font-display mt-1 text-[24px] font-medium tracking-[-0.02em]">
              you/<span className="text-accent">my-site</span>
            </p>
            <div className="mt-3 border border-line">
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white ${t < 2900 ? 'bg-muted' : live ? 'bg-ok' : 'bg-accent'}`}>
                  {t < 2900 ? 'waiting' : live ? 'success' : 'deploying'}
                </span>
                <span className="font-mono text-[12px] text-muted">{t < 2900 ? '—' : '4f1c2e9'}</span>
                <span className="ml-1 text-[13px] font-semibold">{t < 2900 ? '' : 'New homepage'}</span>
              </div>
              {steps.map((s, i) => (
                <div key={s} className="flex items-center gap-3 border-b border-line/70 px-4 py-2 text-[14px] last:border-b-0">
                  <Check done={t >= at(i) + 800} doing={t >= at(i) && t < at(i) + 800} />
                  <span className={t >= at(i) ? 'text-ink' : 'text-muted'}>{s}</span>
                </div>
              ))}
            </div>
            <div className={`mt-3 border p-4 transition-colors ${live ? 'border-ok/50 bg-[#f3fbf6]' : 'border-line bg-bg2'}`}>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Live site</p>
              {live ? (
                <p className="mt-1.5 flex items-center gap-2 text-[17px] font-semibold" style={appear(t, 6700)}>
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-ok" /> my-site-k4821.ms.computer
                </p>
              ) : (
                <p className="mt-1.5 text-[14px] text-muted">Appears here as soon as the deploy finishes.</p>
              )}
            </div>
          </div>
        </Window>
        {!bare && <Caption n="3" text={push.caption} />}
      </>
    )
  },
}

/** Bonus — stuck? fix it for me */
const fix: Clip = {
  id: 'fix',
  title: 'Fix it for me',
  caption: 'Stuck? “Fix it for me” sends the fix as a pull request',
  duration: 8400,
  render: (t, bare) => {
    const open = t >= 1500
    const opened = t >= 5000
    return (
      <>
        <Window style={WIN}>
          <div className="absolute left-[56px] right-[56px] top-[30px]">
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-[#d99a2b] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white">Almost</span>
              <span className="font-display text-[24px] font-medium tracking-[-0.02em]">Needs one fix first</span>
            </div>
            <div className="mt-4 border border-[#f1c2bd] bg-[#fff6f5] p-4">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full bg-[#e0453a]" />
                <span className="font-semibold">A .env file is committed</span>
                <span className="ml-auto rounded-full bg-accentSoft px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-accent2">fixable</span>
              </div>
              <p className="mt-1.5 pl-5 text-[13px] text-muted">Anyone can read it — and every ms.computer miner could too.</p>
              {!open && (
                <span className={`ml-5 mt-3 inline-block px-3.5 py-2 text-[13px] font-semibold text-white ${t >= 1150 ? 'bg-[#7d4ff0]' : 'bg-accent'}`}>Fix it for me →</span>
              )}
              {open && (
                <div className="ml-5 mt-3 space-y-2 border border-accent/40 bg-white p-3" style={appear(t, 1500)}>
                  <div className="border border-line text-[12px]">
                    <p className="font-mono flex justify-between border-b border-line bg-bg2 px-3 py-1">
                      <span>.env</span>
                      <span className="text-[#b3302a]">deleted</span>
                    </p>
                  </div>
                  <div className="border border-line text-[12px]" style={appear(t, 2100)}>
                    <p className="font-mono flex justify-between border-b border-line bg-bg2 px-3 py-1">
                      <span>.gitignore</span>
                      <span className="text-muted">changed</span>
                    </p>
                    <p className="font-mono px-3 py-0.5 text-muted">node_modules</p>
                    {['# Local secrets — never commit these', '.env', '.env.*'].map((l, i) => (
                      <p key={l} className="font-mono bg-[#e9f9ef] px-3 py-0.5 text-[#13643a]" style={appear(t, 2400 + i * 250)}>
                        + {l}
                      </p>
                    ))}
                  </div>
                  {!opened ? (
                    <span className={`inline-block px-3.5 py-2 text-[13px] font-semibold text-white ${t >= 4300 ? 'bg-[#7d4ff0]' : 'bg-accent'}`}>Open a pull request</span>
                  ) : (
                    <p className="border border-ok/40 bg-[#f3fbf6] px-3 py-2 text-[13px]" style={appear(t, 5000)}>
                      Opened <span className="font-semibold text-accent underline">pull request #4 ↗</span> — merge it and you’re ready.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </Window>
        {!bare && <Cursor t={t} path={[[0, 600, 470], [600, 600, 470], [1100, 160, 228], [3600, 160, 228], [4200, 160, 418], [4800, 160, 418], [5600, 720, 500], [8400, 720, 500]]} clicks={[1150, 4300]} />}
        {!bare && <Caption text={fix.caption} />}
      </>
    )
  },
}

export const CLIPS: Record<string, Clip> = { check, deploy, push, fix }
export const GUIDE: Clip[] = [check, deploy, push]
