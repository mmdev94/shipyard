import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { Reveal } from './Reveal'

const ease = [0.16, 1, 0.3, 1] as const

const QA = [
  { q: 'Does Shipyard see my code or tokens?', a: 'Your browser reads the public repo straight from GitHub — there is no Shipyard server. The setup token goes from GitHub’s token page into your repo’s secrets; Shipyard never sees it. The deploy runs in your own GitHub Actions.' },
  { q: 'Why does the first deploy need a token?', a: 'The first deploy creates your ms.computer app and a one-time app secret — the only key that can update it later. GitHub’s built-in Actions token can’t write repo secrets, so a short-lived token you create (Secrets and Variables only, 7 days) stores it. Later deploys don’t need it; delete it after the first run.' },
  { q: 'Do I keep the same URL?', a: 'Yes. ms.computer reserves the hostname for your app. Each push replaces the live version at the same address — the tracker and your repo’s Deployments panel both show it.' },
  { q: 'How do updates work for static sites?', a: 'A static site can’t be swapped in place on ms.computer yet, so the workflow builds the new version first, then takes the old one down and deploys the new one. The site is briefly offline in between, and a failed build never touches the live version.' },
  { q: 'Is the check reliable?', a: 'It’s rule-based: every finding cites the ms.computer limit it comes from and links to the file and line. Same repo, same answer. It can’t run your code, so the deploy’s own smoke test is still the final word.' },
  { q: 'What can’t it deploy?', a: 'Anything that needs a database, background workers, WebSockets, environment secrets at runtime, or outgoing network calls from the server — ms.computer doesn’t offer those in this release. Shipyard tells you which part of your repo needs them.' },
  { q: 'Private repos? Python? Hugo?', a: 'Shipyard reads public repos only. The workflow builds Node projects and plain HTML; for other stacks it checks the repo and shows the CLI commands to deploy it yourself.' },
]

function Item({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-6 py-6 text-left">
        <span className="font-display text-[clamp(1.1rem,2vw,1.4rem)] font-semibold text-ink">{q}</span>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-lg text-accent transition-transform duration-300 ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease }} className="overflow-hidden">
            <p className="pb-6 text-[1.02rem] leading-relaxed text-muted">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Faq() {
  return (
    <section id="faq" className="bg-bg2 px-6 py-20 md:py-28">
      <div className="mx-auto max-w-3xl">
        <Reveal className="mb-10 text-center">
          <span className="eyebrow mx-auto">Questions</span>
          <h2 className="font-display mt-4 text-[clamp(2rem,4.5vw,3.2rem)] font-medium leading-[1.1] tracking-[-0.04em]">Good to know.</h2>
        </Reveal>
        <Reveal className="border-t border-line">
          {QA.map((item) => <Item key={item.q} {...item} />)}
        </Reveal>
      </div>
    </section>
  )
}
