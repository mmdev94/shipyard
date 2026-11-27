// What's shipped (each with the public commit that proves when) and what's
// next before the competition deadline. Dates are UTC.

export interface Shipped {
  date: string
  title: string
  detail: string
  /** commit(s) in github.com/mmdev94/shipyard */
  commits: string[]
  /** where to see it in the app */
  link?: string
}

export interface Planned {
  target: string
  title: string
  detail: string
  /** how it helps more people ship on ms.computer */
  growth: string
}

export const DEADLINE = '2026-12-06T18:00:00Z' // Dec 6, 12:00 Central

export const SHIPPED: Shipped[] = [
  {
    date: '2026-11-24',
    title: 'Repo checker, auto-deploy workflow, tracker',
    detail: 'Paste a public repo: a rule-based check in the browser says whether it runs on ms.computer and why, scans for leaked keys, and writes the GitHub Action that deploys every push. The tracker follows each run step by step.',
    commits: ['b0d39b8', '3d49b7a'],
    link: '#/',
  },
  {
    date: '2026-11-24',
    title: 'One-click deploy, templates, My sites',
    detail: 'Connect GitHub with a short-lived token held in the tab only, and Shipyard commits the workflow for you. Start from a template that’s live in about 3 minutes. Every site you deploy in one dashboard.',
    commits: ['1277696'],
    link: '#/new',
  },
  {
    date: '2026-11-25',
    title: 'Trust you can check',
    detail: 'The setup token deletes itself after the first deploy, every call made with your token is listed in plain words, a terminal mode keeps tokens off the page entirely, and every build is signed — “Verify this page” checks the files you’re running.',
    commits: ['d4ed71b'],
    link: '#/',
  },
  {
    date: '2026-11-25',
    title: 'Roll back and deploy history',
    detail: 'Every deploy on record, with one-click roll back to any earlier commit at the same address.',
    commits: ['da00ed4'],
  },
  {
    date: '2026-11-25',
    title: 'Showcase',
    detail: 'Every repo tagged ms-computer on GitHub, with its live site running in the card. No sign-up: one topic and you’re listed.',
    commits: ['0e8ac4e', '1c8f885'],
    link: '#/showcase',
  },
  {
    date: '2026-11-25',
    title: 'Pull request previews',
    detail: 'Each pull request gets its own live address, replaced on every push and taken down when it closes — without giving the workflow any extra token. Tested end to end on a real repo.',
    commits: ['194acd8', 'bc1b482'],
  },
  {
    date: '2026-11-25',
    title: 'Fix it for me',
    detail: 'Problems with one safe fix — a committed .env, a fixed server port, Next.js or Nuxt that can be static — arrive as a pull request with the exact diff.',
    commits: ['61ff7d3'],
  },
  {
    date: '2026-11-25',
    title: 'Survives GitHub outages; re-checks itself',
    detail: 'Deploy records retry through GitHub API hiccups, with a Repair button when an outage outlasts them. Checks are pinned to a commit and, with GitHub connected, re-run when you push.',
    commits: ['2f00904', '6162fff'],
  },
  {
    date: '2026-11-26',
    title: 'Link preview and a 30-second guide',
    detail: 'Sharing the link shows a preview card, and the home page walks first-timers through it in four short looping clips — check, auto-deploy, push, fix.',
    commits: ['5755bcf'],
    link: '#/',
  },
  {
    date: '2026-11-26',
    title: 'Report a problem',
    detail: 'A button on every page — and next to every error — opens a GitHub issue already filled in with the page, version, browser and error. Or copy it for Discord. Tokens are always stripped out.',
    commits: ['eadc823'],
  },
  {
    date: '2026-11-26',
    title: 'Private repos',
    detail: 'With GitHub connected, the check and Fix it for me work on private repos too. Their files are read through GitHub’s API with your token, in your browser, and their names are kept out of problem reports.',
    commits: ['7a375fc'],
  },
  {
    date: '2026-11-26',
    title: '“Deploy to Ms. Computer” button',
    detail: 'A button any author can paste into a README. A click copies the public repo into the visitor’s own GitHub account and deploys it to their own address — workflows and .env files are never copied.',
    commits: ['322b257'],
    link: '#/deploy/mmdev94/shipyard-test',
  },
  {
    date: '2026-11-27',
    title: 'Python and Go apps',
    detail: 'Flask, FastAPI and Go servers (Gin, Echo, Fiber, chi) are checked for what breaks them on ms.computer — like its main:app guess for Python — and Fix it for me writes the Procfile or the $PORT change.',
    commits: ['42808d6'],
  },
  {
    date: '2026-11-27',
    title: 'Move my site',
    detail: 'Repos set up for GitHub Pages, Netlify or Vercel get a move plan — build settings kept, every change and gap spelled out — and one pull request that switches them. “Exact rules” keeps redirects, rewrites and headers by serving the site with Caddy.',
    commits: ['f14a504'],
    link: '#/move',
  },
  {
    date: '2026-11-27',
    title: 'More Fix it for me',
    detail: 'Four new one-click fixes: deep links in single-page apps, GitHub Pages base paths, SvelteKit to adapter-static, and Astro to static output — each checked with a real build.',
    commits: ['70135dc'],
  },
  {
    date: '2026-11-27',
    title: 'Honest verdicts, and Jekyll, Hugo, MkDocs, Zola in one click',
    detail: '“Ready” only when Shipyard can really deploy the repo. Static site generators deploy in one click — the workflow installs the tool and builds for the site root, GitHub Pages sites included — and a failed build shows its reason in the tracker.',
    commits: ['01acf33'],
  },
  {
    date: '2026-11-27',
    title: 'Server apps start the way ms.computer starts them',
    detail: 'Node start rules measured with the real planner — start script, main, index.js, and the development servers it refuses — with a one-click fix; Dockerfiles called out as unused. Over 38 tested repos, nothing Shipyard calls ready is refused.',
    commits: ['b1d2519'],
  },
  {
    date: '2026-11-27',
    title: 'Extensions, apps, CLIs and libraries named for what they are',
    detail: 'Browser extensions, Electron and Tauri apps, command-line tools and libraries are no longer called “Ready” — the check says what they are and offers the repo’s docs, demo or example site instead.',
    commits: ['f4ea33c'],
  },
  {
    date: '2026-11-28',
    title: 'Why ms.computer — measured, not claimed',
    detail: 'Watchtower joins Shipyard as #/proof: push-to-live times from real deploys, uptime and speed of every ms.computer site checked every 5 minutes, the same page side by side with GitHub Pages, and what it costs — every number signed and linked to its raw data, limits stated.',
    commits: ['eab504a', '27a3e58', 'c4910db'],
    link: '#/proof',
  },
]

export const PLANNED: Planned[] = [
  {
    target: 'Dec 5',
    title: 'The v2 release',
    detail: 'A second independent review, the tests that need a real token, fresh guide clips — then v2 goes to the main site.',
    growth: 'Everything above reaches every visitor, not just the preview.',
  },
]
