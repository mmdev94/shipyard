import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { Reveal } from './Reveal'

const ease = [0.16, 1, 0.3, 1] as const

const QA = [
  { q: 'What happens to my token?', a: 'If you use one-click deploy, the token you paste stays in this tab’s memory — never in cookies, storage or the URL — and is gone when you refresh. The page’s Content-Security-Policy only allows network calls to GitHub, so it can’t be sent anywhere else; you can read the policy in the page source. For the first deploy it’s also saved, encrypted in your browser, as a repo secret so the run can store your app’s key — and the run deletes that secret itself right after, whether or not you’re still watching. “What Shipyard did with your token” lists every GitHub call made with it, in plain words. There is no Shipyard server.' },
  { q: 'Can I deploy without giving Shipyard a token at all?', a: 'Yes, two ways. Terminal: Shipyard writes a script you read and run with the GitHub CLI on your own computer — it uses your gh login, and nothing passes through this page. By hand: copy the workflow and add one secret on GitHub’s own pages. Both set up the same workflow as one-click deploy.' },
  { q: 'Can I undo a bad deploy?', a: 'Yes. The tracker lists every deploy on record; with GitHub connected, “Roll back to this” rebuilds that older commit and puts it live at the same address. The next push deploys the latest commit again. Older workflows get the button after a one-click update on My sites.' },
  { q: 'Is there a usage limit?', a: 'Not from Shipyard or ms.computer. Shipyard has no server, so your browser reads GitHub’s API directly, and GitHub sets the limit: 60 requests an hour per internet address without a GitHub login (a repo check uses about 2), or 5,000 an hour once you connect a token. If you hit it, Shipyard says when it resets.' },
  { q: 'What does “Fix it for me” change?', a: 'Only problems with one safe, mechanical fix: committed .env files (deleted and added to .gitignore — you still need to rotate the keys), a server listening on a fixed port (switched to $PORT, keeping the old port for local runs), and Next.js or Nuxt apps that can be built as static sites. You see the exact diff first, and it arrives as a pull request on a new branch, so nothing changes until you merge it. Leaked API keys stay a manual fix: the real fix is revoking the key.' },
  { q: 'Can every pull request get its own preview?', a: 'Yes, if you switch it on (in the settings after a check, or on My sites). Each PR from a branch of your repo is built and served at its own address, updated on every push to the PR, and taken down when the PR closes; the link shows on the PR as a deployment. Forks never get one: they can’t see your secrets, and a preview would publish a stranger’s code under your repo’s name. Each preview is its own ms.computer app, and its address stays reserved after teardown, so it’s off by default.' },
  { q: 'How do I know this page is what the public repo built?', a: 'Every deploy of Shipyard signs each built file through GitHub (build provenance, recorded with Sigstore). “Verify this page” in the Proof section hashes the files your browser is running and looks up those signatures. Since a page can’t fully vouch for itself, it also gives you a gh attestation verify command to check independently.' },
  { q: 'Why can’t I just sign in with GitHub?', a: 'GitHub only lets a server finish a sign-in, and that server would need a secret and outgoing network access — neither of which ms.computer apps have. A fine-grained token with only the permissions Shipyard lists (no Administration, so it can’t delete repos) and a 7-day expiry does the same job without any server in between.' },
  { q: 'Do I keep the same URL?', a: 'Yes. ms.computer reserves the hostname for your app. Each push replaces the live version at the same address — the tracker and your repo’s Deployments panel both show it.' },
  { q: 'How do updates work for static sites?', a: 'A static site can’t be swapped in place on ms.computer yet, so the workflow builds the new version first, then takes the old one down and deploys the new one. The site is briefly offline in between, and a failed build never touches the live version.' },
  { q: 'Is the check reliable?', a: 'It’s rule-based: every finding cites the ms.computer limit it comes from and links to the file and line. Same repo, same answer. It can’t run your code, so the deploy’s own smoke test is still the final word.' },
  { q: 'What can’t it deploy?', a: 'Anything that needs a database, background workers, WebSockets, environment secrets at runtime, or outgoing network calls from the server — ms.computer doesn’t offer those in this release. Shipyard tells you which part of your repo needs them.' },
  { q: 'I don’t have a project yet.', a: 'Pick a template (personal page, React app or Markdown blog). Shipyard fills a new repo in your account with it and its deploy workflow — about three minutes later it’s live, and every push after that updates it.' },
  { q: 'Private repos? Python? Hugo?', a: 'The checker reads public repos only; with a connected token, one-click deploy and My sites work with your private repos too. The workflow builds Node projects and plain HTML; for other stacks it checks the repo and shows the CLI commands to deploy it yourself.' },
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
