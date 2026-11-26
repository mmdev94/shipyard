import { BackLink } from '../components/BackLink'
import { RULES, SECRET_PATTERNS } from '../lib/checker/rules.ts'
import { Reveal } from '../components/Reveal'

type Row = { rule: string; check: string; applies: 'Static' | 'Dynamic' | 'Both' }

const ROWS: Row[] = [
  { applies: 'Both', rule: RULES.publicImages, check: 'Scans up to 160 source and config files for private keys, cloud and payment keys, chat webhooks and wallet seed phrases, and flags committed .env files. Matches are masked on screen.' },
  { applies: 'Static', rule: RULES.staticNeedsIndex, check: 'Finds the build output folder for popular frameworks (Vite, Next export, Astro, SvelteKit, Nuxt generate, Docusaurus…) and checks plain-HTML repos have an index.html.' },
  { applies: 'Static', rule: RULES.staticNeedsIndex, check: 'Single-page apps that route by path (React Router, Vue Router, Angular, TanStack, wouter, Solid): a reload on /about would 404, so the workflow also publishes index.html as 404.html — ms.computer serves that for unknown paths.' },
  { applies: 'Static', rule: RULES.staticNeedsIndex, check: 'Flags builds set up for a GitHub Pages sub-path (Vite or Astro base, Next basePath, CRA homepage, Docusaurus baseUrl, SvelteKit paths.base): on ms.computer the site is at the root, so assets would 404.' },
  { applies: 'Static', rule: RULES.maxResponse, check: 'Flags any file over 16 MiB in the folders that end up in the site.' },
  { applies: 'Both', rule: RULES.noEnv, check: 'Looks for process.env / import.meta.env reads beyond PORT and NODE_ENV. In a static build they are baked in at build time, so it lists which ones the build expects.' },
  { applies: 'Dynamic', rule: RULES.noDb, check: 'Detects database drivers and ORMs (Postgres, MySQL, Mongo, Redis, Prisma, SQLAlchemy, GORM, pgx…) in package.json, requirements and go.mod, and Django’s default SQLite.' },
  { applies: 'Dynamic', rule: RULES.noEgress, check: 'Finds outgoing calls to absolute URLs and SDK clients (Stripe, OpenAI, AWS…). A dependency alone is only a warning; a call in server code is a failure.' },
  { applies: 'Dynamic', rule: RULES.noStreaming, check: 'Detects WebSocket and Socket.IO libraries (ws, socket.io, Flask-SocketIO, Django Channels, gorilla/websocket…), and Streamlit and Gradio, which run over WebSockets.' },
  { applies: 'Dynamic', rule: RULES.noWorkers, check: 'Detects schedulers and job queues (cron, BullMQ, Celery, robfig/cron…), docker-compose files with several services, and Procfiles with more than a web process.' },
  { applies: 'Dynamic', rule: RULES.readOnly, check: 'Warns about upload libraries (multer, busboy…) and code that writes to local disk.' },
  { applies: 'Dynamic', rule: RULES.smoke, check: 'Checks the server takes its port from $PORT instead of a hard-coded 3000 or 8080 (Node, Flask, and Go’s ListenAndServe, Gin, Echo and Fiber).' },
  { applies: 'Dynamic', rule: RULES.smoke, check: 'Python: works out the command ms.computer will start the app with. Without a Procfile it always tries main:app — so an app in app.py, or a Flask app without gunicorn, fails. Go: checks there’s one main package that serves HTTP.' },
]

const TONE = { Static: 'bg-[#eaf7f0] text-[#13804a]', Dynamic: 'bg-accentSoft text-accent2', Both: 'bg-bg2 text-ink2' }

export function Rules() {
  const secrets = Array.from(new Set(SECRET_PATTERNS.map((p) => p.label)))
  return (
    <section className="px-6 py-14 md:px-14 md:py-20">
      <div className="mx-auto max-w-shell">
        <BackLink />
        <Reveal className="mt-6 max-w-[760px]">
          <span className="eyebrow">The rules</span>
          <h1 className="font-display mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-medium leading-[1.02] tracking-[-0.035em]">
            What runs on ms.computer — and how Shipyard checks it.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Every check maps to a limit in ms.computer's own deploy guide (<code className="font-mono text-[14px]">mscomputer docs agents</code>).
            Shipyard reads your repo's files and applies plain, citable rules — no AI guessing, so the same repo always gets the same answer.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-px border border-line bg-line">
          <div className="hidden grid-cols-[110px_1fr_1fr] bg-bg2 md:grid">
            {['Applies to', 'ms.computer rule', 'What Shipyard looks for'].map((h) => (
              <span key={h} className="font-mono px-5 py-3 text-[11px] uppercase tracking-[0.14em] text-muted">{h}</span>
            ))}
          </div>
          {ROWS.map((r) => (
            <div key={r.rule} className="grid gap-2 bg-white px-5 py-5 md:grid-cols-[110px_1fr_1fr] md:gap-0 md:px-0 md:py-0">
              <span className="md:px-5 md:py-5">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${TONE[r.applies]}`}>{r.applies}</span>
              </span>
              <p className="font-semibold leading-snug text-ink md:px-5 md:py-5">{r.rule}</p>
              <p className="text-[15px] leading-relaxed text-muted md:px-5 md:py-5">{r.check}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">Secrets it recognises</h2>
            <p className="mt-2 text-muted">Deployed images are public to every miner, so a key in the repo is a key on the internet.</p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {secrets.map((s) => (
                <li key={s} className="font-mono border border-line bg-bg2 px-3 py-1.5 text-[12.5px] text-ink2">{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">What it can't see</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-muted">
              <li>Private repos — it only reads what GitHub shows anyone.</li>
              <li>Very large repos: it reads the 160 files most likely to matter (configs, servers, entry points).</li>
              <li>Runtime behaviour. A pass means nothing in the code breaks a rule — the deploy's own smoke test is the final word.</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
