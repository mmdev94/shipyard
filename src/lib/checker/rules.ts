import { bindsPort, findPyEntry, GO_FIXED_PORT, GO_SERVES, goDeps, goHas, goMains, guessedPyStart, procfileWeb, pyDep, pyFramework, pyLabel, pyStartCommand, serverFor } from './servers.ts'
import { allDeps, parsePackageJson } from './detect.ts'
import type { Detection, Evidence, Finding, RepoSnapshot } from './types.ts'

// Plain-language versions of the ms.computer platform rules
// (https://ms.computer/llms.txt and `mscomputer docs agents`).
export const RULES = {
  publicImages: 'Everything you deploy is readable by every ms.computer miner and must be treated as public.',
  noEnv: 'User environment variables and secrets are not supported in this release.',
  noDb: 'Databases and other stateful services are not supported.',
  noStreaming: 'WebSockets and streaming responses are not supported.',
  noEgress: 'Dynamic apps run with network egress denied: the server cannot call other services.',
  noWorkers: 'Background workers and multiple services are not supported.',
  readOnly: 'The filesystem is read-only and there are no persistent volumes; request bodies are capped at 1 MiB.',
  maxResponse: 'Responses larger than 16 MiB are not supported.',
  smoke: 'The server must listen on 0.0.0.0:$PORT and answer GET / with 200 (checked twice within 60 seconds).',
  staticNeedsIndex: 'A static site needs an index.html at its root.',
} as const

const MAX_SCAN_FILES = 160
const MAX_FILE_BYTES = 300_000
const MAX_DEPLOY_FILE = 16 * 1024 * 1024

/** A .env file with real values (not an example/template). */
export const isCommittedEnv = (p: string) =>
  /(^|\/)\.env(\.[\w-]+)?$/.test(p) && !/\.(example|sample|template|dist|defaults?)$/i.test(p) && !SKIP_DIR.test(p)

export const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|\.output|\.svelte-kit|vendor|coverage|\.git|\.vercel|\.turbo|target|__pycache__|\.venv|venv)\//
const TEXT_EXT = /\.(m?[jt]sx?|c[jt]s|vue|svelte|astro|html?|py|rb|go|php|json|ya?ml|toml|sh|ini|cfg|conf|properties|txt)$|(^|\/)(Dockerfile|Procfile|\.env[\w.-]*)$/i
const SKIP_FILE = /(\.min\.js|\.map|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|composer\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/i
const TEST_PATH = /(^|\/)(__tests__|__mocks__|tests?|e2e|spec|cypress|playwright|fixtures?|examples?|mocks?)\/|\.(test|spec|stories)\.[cm]?[jt]sx?$|(_test\.(py|go)|(^|\/)test_[^/]+\.py)$/i
const SERVER_PATH = /(^|\/)(server|api|backend|routes|functions|lambda|middleware|controllers|handlers)(\/|\.|$)|(^|\/)(app|main|index|server)\.(py|go|rb)$|^(server|app|index)\.(c|m)?[jt]s$/i

interface Scanned {
  path: string
  text: string
  server: boolean
  /** Test or fixture code: still secret-scanned, but ignored by platform rules. */
  test: boolean
}

export type Progress = (done: number, total: number) => void

function lineOf(text: string, index: number): number {
  let n = 1
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

function snippetAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index) + 1
  const end = text.indexOf('\n', index)
  return text.slice(start, end === -1 ? undefined : end).trim().slice(0, 140)
}

export function mask(secret: string): string {
  if (secret.length <= 8) return '•'.repeat(secret.length)
  return `${secret.slice(0, 4)}${'•'.repeat(Math.min(12, secret.length - 6))}${secret.slice(-2)}`
}

/** Choose which files to read: configs and server code first, then the rest of the source. */
export function pickFiles(snap: RepoSnapshot, detection: Detection): string[] {
  const candidates = snap.files.filter(
    (f) => f.size > 0 && f.size <= MAX_FILE_BYTES && TEXT_EXT.test(f.path) && !SKIP_FILE.test(f.path) && !SKIP_DIR.test(`${f.path}`),
  )
  const prefix = detection.workingDir === '.' ? '' : `${detection.workingDir}/`
  const score = (p: string) => {
    if (/(^|\/)\.env/.test(p)) return 0
    if (!p.includes('/') || p.split('/').length <= 2) return 1
    if (SERVER_PATH.test(p)) return 2
    if (prefix && p.startsWith(prefix)) return 3
    if (/(^|\/)src\//.test(p)) return 4
    return 5
  }
  return candidates
    .map((f) => f.path)
    .sort((a, b) => score(a) - score(b) || a.length - b.length)
    .slice(0, MAX_SCAN_FILES)
}

async function readAll(snap: RepoSnapshot, paths: string[], detection: Detection, onProgress?: Progress): Promise<Scanned[]> {
  const out: Scanned[] = []
  let i = 0
  let done = 0
  const worker = async () => {
    while (i < paths.length) {
      const path = paths[i++]
      const text = await snap.read(path)
      onProgress?.(++done, paths.length)
      if (text === null) continue
      const test = TEST_PATH.test(path)
      const server =
        !test &&
        detection.mode === 'dynamic' &&
        (SERVER_PATH.test(path) || /\.(py|go|rb)$/.test(path) || /require\(['"](express|fastify|koa)['"]\)|from ['"](express|fastify|koa|hono)['"]/.test(text))
      out.push({ path, text, server, test })
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker))
  return out
}

function findAll(files: Scanned[], re: RegExp, opts: { serverOnly?: boolean; limit?: number; under?: string } = {}): Evidence[] {
  const ev: Evidence[] = []
  for (const f of files) {
    if (f.test) continue
    if (opts.serverOnly && !f.server) continue
    if (opts.under && !f.path.startsWith(opts.under)) continue
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
    let m: RegExpExecArray | null
    while ((m = g.exec(f.text))) {
      ev.push({ path: f.path, line: lineOf(f.text, m.index), snippet: snippetAt(f.text, m.index) })
      if (ev.length >= (opts.limit ?? 5)) return ev
      if (m[0].length === 0) g.lastIndex++
    }
  }
  return ev
}

// ---------- security ----------

interface SecretPattern {
  id: string
  label: string
  re: RegExp
  /** Some keys (Firebase web keys) are designed to be public. */
  soft?: boolean
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { id: 'private-key', label: 'Private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  { id: 'aws', label: 'AWS access key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github', label: 'GitHub token', re: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { id: 'stripe', label: 'Stripe live secret key', re: /\b(sk|rk)_live_[0-9A-Za-z]{20,}\b/ },
  { id: 'anthropic', label: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'openai', label: 'OpenAI API key', re: /\bsk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: 'slack', label: 'Slack token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: 'telegram', label: 'Telegram bot token', re: /\b\d{8,10}:AA[0-9A-Za-z_-]{33}\b/ },
  { id: 'discord-webhook', label: 'Discord webhook', re: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]{30,}/ },
  { id: 'mnemonic', label: 'Wallet seed phrase', re: /\b(mnemonic|seed_?phrase|secret_?phrase)\b\s*[:=]\s*['"`](?:[a-z]+\s+){11,23}[a-z]+['"`]/i },
  { id: 'google', label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, soft: true },
]

function securityFindings(snap: RepoSnapshot, files: Scanned[]): Finding[] {
  const findings: Finding[] = []

  const envFiles = snap.files.map((f) => f.path).filter(isCommittedEnv)
  findings.push(
    envFiles.length
      ? {
          id: 'env-file',
          severity: 'fail',
          category: 'security',
          title: 'A .env file is committed',
          detail: `This repo is public, so ${envFiles.length === 1 ? 'this file is' : 'these files are'} already readable by anyone — and on ms.computer every miner could read it too.`,
          rule: RULES.publicImages,
          fix: 'Delete the file, add `.env*` to .gitignore, and rotate every key it contained. Shipyard’s workflow also never ships .env files.',
          evidence: envFiles.slice(0, 5).map((path) => ({ path })),
        }
      : { id: 'env-file', severity: 'pass', category: 'security', title: 'No .env files committed', detail: '' },
  )

  const keyFiles = snap.files
    .map((f) => f.path)
    .filter((p) => /(^|\/)(id_(rsa|ed25519|ecdsa|dsa)|[^/]+\.(pem|key|p12|pfx|keystore|jks))$/i.test(p) && !SKIP_DIR.test(p))
  const leaks: Evidence[] = []
  const soft: Evidence[] = []
  const kinds = new Set<string>()
  for (const f of files) {
    for (const pat of SECRET_PATTERNS) {
      const g = new RegExp(pat.re.source, `${pat.re.flags}g`)
      let m: RegExpExecArray | null
      while ((m = g.exec(f.text))) {
        const ev = { path: f.path, line: lineOf(f.text, m.index), snippet: `${pat.label}: ${mask(m[0])}` }
        ;(pat.soft ? soft : leaks).push(ev)
        if (!pat.soft) kinds.add(pat.label)
        if (leaks.length + soft.length > 20) break
      }
    }
  }
  const keyEvidence = keyFiles.map((path) => ({ path, snippet: 'Key file' }))
  if (leaks.length || keyEvidence.length) {
    findings.push({
      id: 'secrets',
      severity: 'fail',
      category: 'security',
      title: `Possible secrets in the code${kinds.size ? ` (${[...kinds].slice(0, 3).join(', ')})` : ''}`,
      detail: 'Anything that ships with your site is public on ms.computer — every miner can read it. Values are masked here.',
      rule: RULES.publicImages,
      fix: 'Remove the secret from the code and git history, then rotate it. Static sites should only ever contain public keys.',
      evidence: [...keyEvidence, ...leaks].slice(0, 8),
    })
  } else {
    findings.push({ id: 'secrets', severity: 'pass', category: 'security', title: 'No secrets or private keys found', detail: '' })
  }
  if (soft.length) {
    findings.push({
      id: 'public-keys',
      severity: 'info',
      category: 'security',
      title: 'Google/Firebase API keys found',
      detail: 'These are usually meant to be public (Firebase web keys are), but make sure each one is restricted to your domain in Google Cloud.',
      evidence: soft.slice(0, 5),
    })
  }
  return findings
}

// ---------- platform ----------

const DB_DEPS = ['pg', 'postgres', 'mysql', 'mysql2', 'mongodb', 'mongoose', '@prisma/client', 'prisma', 'sequelize', 'typeorm', 'knex', 'redis', 'ioredis', 'sqlite3', 'better-sqlite3', '@libsql/client', 'drizzle-orm', '@neondatabase/serverless', 'firebase-admin']
const PY_DB = ['psycopg2', 'psycopg', 'sqlalchemy', 'pymongo', 'redis', 'peewee', 'tortoise-orm', 'asyncpg', 'motor']
const STREAM_DEPS = ['socket.io', 'ws', '@fastify/websocket', 'express-ws', 'uWebSockets.js', '@socket.io/redis-adapter']
const PY_STREAM = ['flask-socketio', 'websockets', 'channels', 'python-socketio', 'streamlit', 'gradio']
const GO_DB = ['gorm.io/gorm', 'github.com/jackc/pgx', 'github.com/lib/pq', 'go.mongodb.org/mongo-driver', 'github.com/redis/go-redis', 'github.com/go-redis/redis', 'github.com/go-sql-driver/mysql', 'github.com/mattn/go-sqlite3', 'modernc.org/sqlite', 'github.com/jmoiron/sqlx', 'entgo.io/ent']
const GO_STREAM = ['github.com/gorilla/websocket', 'nhooyr.io/websocket', 'github.com/coder/websocket', 'golang.org/x/net/websocket', 'github.com/gofiber/websocket']
const GO_WORKERS = ['github.com/robfig/cron', 'github.com/go-co-op/gocron', 'github.com/hibiken/asynq']
const WORKER_DEPS = ['node-cron', 'cron', 'bull', 'bullmq', 'agenda', 'bree', 'node-schedule']
const PY_WORKERS = ['celery', 'apscheduler', 'rq', 'dramatiq', 'huey']
const EGRESS_DEPS = ['axios', 'node-fetch', 'got', 'undici', 'openai', '@anthropic-ai/sdk', 'stripe', '@aws-sdk/client-s3', 'nodemailer', 'twilio', '@sendgrid/mail', 'resend']
const PY_EGRESS = ['requests', 'httpx', 'openai', 'anthropic', 'boto3', 'stripe']
const UPLOAD_DEPS = ['multer', 'busboy', 'formidable', 'express-fileupload', '@fastify/multipart']

function pyHas(req: string, names: string[]): string[] {
  return names.filter((n) => new RegExp(`(^|[\\s"'\\[,])${n.replace(/[.-]/g, '[.-_]?')}([\\s=<>~!\\[;,"']|$)`, 'im').test(req))
}

async function dynamicFindings(snap: RepoSnapshot, d: Detection, files: Scanned[]): Promise<Finding[]> {
  const dir = d.workingDir === '.' ? '' : `${d.workingDir}/`
  const pkg = parsePackageJson(await snap.read(`${dir}package.json`))
  const deps = allDeps(pkg)
  const reqFile = ['requirements.txt', 'pyproject.toml', 'Pipfile'].find((n) => snap.files.some((f) => f.path === `${dir}${n}`))
  const req = [await snap.read(`${dir}requirements.txt`), await snap.read(`${dir}pyproject.toml`), await snap.read(`${dir}Pipfile`)].filter(Boolean).join('\n')
  const gomod = d.framework === 'go' ? ((await snap.read(`${dir}go.mod`)) ?? '') : ''
  const gdeps = goDeps(gomod)
  const depFile = pkg ? `${dir}package.json` : gomod ? `${dir}go.mod` : `${dir}${reqFile ?? 'requirements.txt'}`
  const depEv = (names: string[]) => names.map((n) => ({ path: depFile, snippet: n }))
  const out: Finding[] = []

  const djangoSqlite = pyDep(req, 'django') && findAll(files, /django\.db\.backends\.sqlite3/, { limit: 1 })
  const db = [...DB_DEPS.filter((n) => deps[n]), ...pyHas(req, PY_DB), ...goHas(gdeps, GO_DB), ...(djangoSqlite && djangoSqlite.length ? ['Django’s SQLite database'] : [])]
  out.push(
    db.length
      ? { id: 'database', severity: 'fail', blocking: true, category: 'platform', title: 'Uses a database', detail: `Found ${db.slice(0, 3).join(', ')}. There's no database on ms.computer yet, and the app can't reach an outside one either.`, rule: RULES.noDb, fix: 'Not deployable as-is. Ship the frontend as a static site and keep the database-backed API on another host.', evidence: depEv(db) }
      : { id: 'database', severity: 'pass', category: 'platform', title: 'No database', detail: '' },
  )

  const stream = [...STREAM_DEPS.filter((n) => deps[n]), ...pyHas(req, PY_STREAM), ...goHas(gdeps, GO_STREAM)]
  const sse = findAll(files, /text\/event-stream|StreamingResponse|res\.flushHeaders\(/, { serverOnly: true, limit: 3 })
  out.push(
    stream.length || sse.length
      ? { id: 'streaming', severity: 'fail', blocking: true, category: 'platform', title: 'Uses WebSockets or streaming', detail: 'Real-time connections and streamed responses aren’t supported.', rule: RULES.noStreaming, fix: 'Switch to plain request/response (polling), or host the real-time part elsewhere.', evidence: [...depEv(stream), ...sse] }
      : { id: 'streaming', severity: 'pass', category: 'platform', title: 'No WebSockets or streaming', detail: '' },
  )

  const workers = [...WORKER_DEPS.filter((n) => deps[n]), ...pyHas(req, PY_WORKERS), ...goHas(gdeps, GO_WORKERS)]
  const procfile = (await snap.read(`${dir}Procfile`)) ?? ''
  const procTypes = procfile.split('\n').filter((l) => /^\w[\w-]*:/.test(l))
  const compose = (await snap.read(`${dir}docker-compose.yml`)) ?? (await snap.read(`${dir}compose.yaml`)) ?? (await snap.read(`${dir}docker-compose.yaml`)) ?? ''
  const services = compose ? (compose.match(/^ {2}[\w.-]+:\s*$/gm) ?? []).length : 0
  const multi = procTypes.length > 1 || services > 1
  out.push(
    workers.length || multi
      ? { id: 'workers', severity: 'fail', blocking: true, category: 'platform', title: workers.length ? 'Runs background jobs' : 'Runs more than one service', detail: workers.length ? `Found ${workers.join(', ')}.` : `Found ${Math.max(procTypes.length, services)} services.`, rule: RULES.noWorkers, fix: 'Only one web process runs. Move scheduled jobs to a cron service elsewhere, or drop them.', evidence: [...depEv(workers), ...(multi ? [{ path: procTypes.length > 1 ? `${dir}Procfile` : `${dir}docker-compose.yml` }] : [])] }
      : { id: 'workers', severity: 'pass', category: 'platform', title: 'Single web process, no background jobs', detail: '' },
  )

  const envUse = findAll(files, /process\.env\.(?!PORT\b|NODE_ENV\b|HOST\b|HOSTNAME\b)[A-Z_][A-Z0-9_]*|os\.environ(\.get)?\[?\(?['"](?!PORT['"])\w+|os\.getenv\(\s*['"](?!PORT['"])\w+|os\.Getenv\("(?!PORT")\w+/, { serverOnly: true, limit: 5 })
  const dotenv = deps.dotenv || pyHas(req, ['python-dotenv']).length
  out.push(
    envUse.length || dotenv
      ? { id: 'env-vars', severity: 'fail', category: 'platform', title: 'Reads environment variables at runtime', detail: 'You can’t set environment variables or secrets on ms.computer yet, so these will be empty.', rule: RULES.noEnv, fix: 'Hard-code non-secret config, or give each variable a safe default. Anything that needs a real secret can’t run here yet.', evidence: [...(dotenv ? [{ path: `${dir}package.json`, snippet: 'dotenv' }] : []), ...envUse] }
      : { id: 'env-vars', severity: 'pass', category: 'platform', title: 'No runtime environment variables', detail: '' },
  )

  const egressDeps = [...EGRESS_DEPS.filter((n) => deps[n]), ...pyHas(req, PY_EGRESS)]
  const fetchUse = findAll(files, /\b(fetch|axios(\.(get|post|put|delete|patch|request))?|got|ky|requests\.(get|post|put|delete|patch)|httpx\.(get|post|put|delete))\(\s*f?[`'"]https?:\/\/|new (OpenAI|Anthropic|Stripe)\(|\bStripe\(|boto3\.client\(|http\.(Get|Post|Head)\("https?:|http\.NewRequest(WithContext)?\([^)]*"https?:/, { serverOnly: true, limit: 5 })
  out.push(
    fetchUse.length
      ? { id: 'egress', severity: 'fail', blocking: true, category: 'platform', title: 'Calls other services from the server', detail: 'Dynamic apps run with outbound network turned off, so these calls will fail.', rule: RULES.noEgress, fix: 'Make those calls from the browser instead (a static frontend can call any API), or host this backend elsewhere.', evidence: fetchUse }
      : egressDeps.length
        ? { id: 'egress', severity: 'warn', category: 'platform', title: 'Has HTTP-client libraries', detail: `Found ${egressDeps.slice(0, 3).join(', ')}. If the server uses them to call other services, those calls will fail.`, rule: RULES.noEgress, evidence: depEv(egressDeps) }
        : { id: 'egress', severity: 'pass', category: 'platform', title: 'No outbound calls from the server', detail: '' },
  )

  const uploads = UPLOAD_DEPS.filter((n) => deps[n])
  const writes = findAll(files, /fs\.(writeFile|appendFile|createWriteStream|mkdir)(Sync)?\(|open\([^)]*['"][wa]b?\+?['"]/, { serverOnly: true, limit: 3 })
  out.push(
    uploads.length || writes.length
      ? { id: 'disk', severity: 'warn', category: 'platform', title: 'Writes files or accepts uploads', detail: 'The filesystem is read-only and request bodies are capped at 1 MiB, so uploads and saved files won’t work.', rule: RULES.readOnly, fix: 'Keep state in the browser (localStorage) or in an outside service called from the browser.', evidence: [...depEv(uploads), ...writes] }
      : { id: 'disk', severity: 'pass', category: 'platform', title: 'No file writes or uploads', detail: '' },
  )

  out.push(...(await startFindings(snap, d, files, req, gomod, reqFile)))

  // a Python app served by gunicorn/uvicorn never runs its `app.run(port=…)` line
  const pyServed = Boolean(req) && (pyDep(req, 'gunicorn') || pyDep(req, 'uvicorn'))
  const fixedPort = findAll(files, pyServed ? /\.listen\(\s*(3000|8000|8080|5000|4000)\b(?![^)]*process\.env\.PORT)/ : /\.listen\(\s*(3000|8000|8080|5000|4000)\b(?![^)]*process\.env\.PORT)|app\.run\([^)]*port\s*=\s*\d+/, { serverOnly: true, limit: 2 })
  if (gomod) fixedPort.push(...findAll(files, GO_FIXED_PORT, { limit: 3 }).filter((e) => !files.find((f) => f.path === e.path)?.text.includes('Getenv("PORT")')))
  const usesPort = gomod ? [] : findAll(files, /process\.env\.PORT|os\.environ\.get\(['"]PORT|os\.getenv\(['"]PORT|Getenv\("PORT"\)|\$PORT/, { limit: 1 })
  out.push(
    fixedPort.length && !usesPort.length
      ? { id: 'port', severity: 'warn', category: 'platform', title: 'Listens on a fixed port', detail: 'ms.computer tells your server which port to use through $PORT.', rule: RULES.smoke, fix: 'Listen on `process.env.PORT` (or `$PORT`) and on 0.0.0.0, and make sure GET / returns 200.', evidence: fixedPort }
      : { id: 'port', severity: 'info', category: 'platform', title: 'Health check', detail: 'Before going live, ms.computer calls GET / on your server. It has to return 200 twice within 60 seconds.', rule: RULES.smoke },
  )
  return out
}

/**
 * How ms.computer will start a Python or Go server, and whether that works —
 * see servers.ts for what its planner does.
 */
async function startFindings(snap: RepoSnapshot, d: Detection, files: Scanned[], req: string, gomod: string, reqFile: string | undefined): Promise<Finding[]> {
  const dir = d.workingDir === '.' ? '' : `${d.workingDir}/`
  const rule = RULES.smoke
  if (gomod) {
    const mains = goMains(snap.files.map((f) => f.path), d.workingDir, (p) => /^package main\b/m.test(files.find((f) => f.path === p)?.text ?? ''))
    const serves = findAll(files, GO_SERVES, { limit: 1 })
    if (!mains.length)
      return [{ id: 'start', severity: 'fail', category: 'build', title: 'No main package to run', detail: 'ms.computer builds the Go program in the module root or in a single cmd/<name> folder, and neither has a `package main`.', rule, fix: 'Put the server’s main.go at the module root or in cmd/server.' }]
    if (mains.length > 1)
      return [{ id: 'start', severity: 'warn', category: 'build', title: 'More than one program', detail: `Found main packages in ${mains.map((m) => (m === '.' ? 'the root' : m)).join(', ')}. ms.computer runs one web process and may pick the wrong one.`, rule, fix: 'Keep only the web server as a main package at the root (or the only cmd/ folder).', evidence: mains.map((m) => ({ path: `${dir}${m === '.' ? 'go.mod' : m}` })) }]
    if (!serves.length)
      return [{ id: 'start', severity: 'fail', category: 'build', title: 'No HTTP server found', detail: 'ms.computer only deploys Go programs that visibly serve HTTP (http.ListenAndServe, or Gin/Echo/Fiber’s Run, Start or Listen) and refuses the rest when planning.', rule, fix: 'Make sure the main package starts the web server itself.' }]
    return [{ id: 'start', severity: 'pass', category: 'build', title: `Builds and runs the Go program${mains[0] === '.' ? '' : ` in ${mains[0]}`}`, detail: '', evidence: serves }]
  }

  const fw = pyFramework(req)
  if (!fw) return []
  const web = procfileWeb(await snap.read(`${dir}Procfile`))
  if (web) {
    return [
      bindsPort(web)
        ? { id: 'start', severity: 'pass', category: 'build', title: 'Starts with the Procfile’s web command', detail: '', evidence: [{ path: `${dir}Procfile`, snippet: `web: ${web}` }] }
        : { id: 'start', severity: 'warn', category: 'build', title: 'The Procfile’s web command may not listen on $PORT', detail: 'ms.computer runs the Procfile’s web line. It has to listen on 0.0.0.0 at the port in $PORT.', rule, fix: 'For example `gunicorn --bind 0.0.0.0:$PORT app:app` or `uvicorn main:app --host 0.0.0.0 --port $PORT`.', evidence: [{ path: `${dir}Procfile`, snippet: `web: ${web}` }] },
    ]
  }
  if (fw === 'streamlit' || fw === 'gradio') return [] // the streaming check already blocks these
  if (fw === 'django') {
    const wsgi = snap.files.find((f) => f.path.startsWith(dir) && f.path.endsWith('/wsgi.py'))
    return [
      wsgi && pyDep(req, 'gunicorn')
        ? { id: 'start', severity: 'pass', category: 'build', title: 'Starts with gunicorn', detail: '', evidence: [{ path: wsgi.path }] }
        : { id: 'start', severity: 'fail', category: 'build', title: 'No way to start the server', detail: 'ms.computer starts Django with gunicorn and refuses to plan without it.', rule, fix: `Add gunicorn to ${reqFile ?? 'requirements.txt'} and a Procfile like \`web: gunicorn mysite.wsgi\`.` },
    ]
  }
  const entry = findPyEntry(files, d.workingDir)
  const server = serverFor(fw)!
  const guess = guessedPyStart(fw, req)
  const label = pyLabel(fw)
  if (!entry)
    return [{ id: 'start', severity: 'warn', category: 'build', title: `Couldn’t find the ${label} app object`, detail: `ms.computer will try \`${guess ?? `${server} main:app`}\`. If your app isn’t \`app\` in main.py, that fails.`, rule, fix: `Add a Procfile with the right command, e.g. \`web: ${pyStartCommand(fw, { path: '', module: 'main', variable: 'app' })}\`.` }]
  const target = `${entry.module}:${entry.variable}`
  const ev = [{ path: entry.path, snippet: `${entry.variable} = ${label}(…)` }]
  if (!pyDep(req, server))
    return [{ id: 'start', severity: 'fail', category: 'build', title: `${server} isn’t installed`, detail: `ms.computer serves ${label} with ${server}, and refuses to plan an app without it.`, rule, fix: `Add ${server} to ${reqFile ?? 'requirements.txt'} and a Procfile: \`web: ${pyStartCommand(fw, entry)}\`.`, evidence: ev, data: { procfile: pyStartCommand(fw, entry)!, server, reqFile: `${dir}${reqFile ?? 'requirements.txt'}`, dir: d.workingDir } }]
  if (guess && target !== 'main:app')
    return [{ id: 'start', severity: 'fail', category: 'build', title: `ms.computer would start \`main:app\`, but the app is \`${target}\``, detail: `Without a Procfile, ms.computer runs \`${guess}\`. The build works, then the server can’t import the app and the health check fails.`, rule, fix: `Add a Procfile: \`web: ${pyStartCommand(fw, entry)}\`.`, evidence: ev, data: { procfile: pyStartCommand(fw, entry)!, dir: d.workingDir } }]
  if (!guess)
    return [{ id: 'start', severity: 'warn', category: 'build', title: 'No start command', detail: `ms.computer has no default way to start ${label}.`, rule, fix: `Add a Procfile: \`web: ${pyStartCommand(fw, entry)}\`.`, evidence: ev, data: { procfile: pyStartCommand(fw, entry)!, dir: d.workingDir } }]
  return [{ id: 'start', severity: 'pass', category: 'build', title: `Starts with \`${guess.split(' ')[0]} main:app\``, detail: '', evidence: ev }]
}

async function staticFindings(snap: RepoSnapshot, d: Detection, files: Scanned[]): Promise<Finding[]> {
  const out: Finding[] = []
  const dir = d.workingDir === '.' ? '' : `${d.workingDir}/`

  if (d.framework === 'html') {
    const hasIndex = snap.files.some((f) => f.path === `${dir}index.html`)
    out.push(
      hasIndex
        ? { id: 'index', severity: 'pass', category: 'platform', title: 'index.html at the root', detail: '' }
        : { id: 'index', severity: 'fail', category: 'platform', title: 'No index.html at the root', detail: 'ms.computer serves index.html as your home page.', rule: RULES.staticNeedsIndex, fix: 'Add an index.html, or point Shipyard at the folder that has one.' },
    )
  }

  const assetRoots = d.framework === 'html' ? [dir] : [`${dir}public/`, `${dir}static/`, `${dir}assets/`, `${dir}src/assets/`]
  const big = snap.files.filter((f) => f.size > MAX_DEPLOY_FILE && assetRoots.some((r) => f.path.startsWith(r)) && !SKIP_DIR.test(f.path))
  out.push(
    big.length
      ? { id: 'big-files', severity: 'fail', category: 'platform', title: 'Files over 16 MiB', detail: 'Each file is one response, and responses over 16 MiB aren’t supported.', rule: RULES.maxResponse, fix: 'Compress or split these files, or host them elsewhere (a video platform or CDN) and link to them.', evidence: big.slice(0, 5).map((f) => ({ path: f.path, snippet: `${(f.size / 1024 / 1024).toFixed(1)} MiB` })) }
      : { id: 'big-files', severity: 'pass', category: 'platform', title: 'All files under 16 MiB', detail: '' },
  )

  const examples = snap.files.filter((f) => f.path.startsWith(dir) && /^(src\/)?\.env\.(example|sample|template)$/i.test(f.path.slice(dir.length)))
  // a variable with a fallback right after it (`?? '…'` or `|| '…'`) is optional: the build works without it
  const buildEnv = findAll(files, /(?:import\.meta\.env\.(?!MODE\b|DEV\b|PROD\b|SSR\b|BASE_URL\b)[A-Z_][A-Z0-9_]*|process\.env\.(?:NEXT_PUBLIC_|REACT_APP_|VUE_APP_|GATSBY_|PUBLIC_)[A-Z0-9_]+)\b(?!\s*(?:\?\?|\|\|))/, { limit: 5, under: dir })
  out.push(
    buildEnv.length || examples.length
      ? { id: 'build-env', severity: 'warn', category: 'build', title: 'Expects build-time variables', detail: 'The values get baked into the public files at build time. The deploy workflow won’t have them unless you add them.', rule: RULES.publicImages, fix: 'Add them as GitHub Actions variables and pass them to the build step. Only use values that are safe to be public.', evidence: [...examples.map((f) => ({ path: f.path })), ...buildEnv] }
      : { id: 'build-env', severity: 'pass', category: 'build', title: 'No build-time variables needed', detail: '' },
  )

  // dev containers, CI and editor setup ship Dockerfiles too — they aren't a backend
  const DEV_TOOLING = /(^|\/)(\.devcontainer|\.github|\.gitpod|\.circleci|\.vscode)\//
  const backendMarkers = /(^|\/)(Dockerfile|requirements\.txt|pyproject\.toml|go\.mod|Gemfile|docker-compose\.ya?ml|compose\.ya?ml)$/
  const backends = [...new Set(snap.files.filter((f) => backendMarkers.test(f.path) && !f.path.startsWith(dir || '\u0000') && !SKIP_DIR.test(f.path) && !TEST_PATH.test(f.path) && !DEV_TOOLING.test(f.path)).map((f) => f.path.split('/').length > 1 ? `${f.path.split('/')[0]}/` : 'the repo root'))]
  if (dir && backends.length) {
    out.push({ id: 'other-services', severity: 'info', category: 'build', title: 'Only the frontend gets deployed', detail: `This repo also has a backend (${backends.slice(0, 3).join(', ')}). Shipyard ships \`${d.workingDir}/\` as a static site; the backend would need its own host.` })
  }

  out.push({
    id: 'browser-calls',
    severity: 'info',
    category: 'platform',
    title: 'Calling APIs from the browser is fine',
    detail: 'A static site can call any public API: the request goes out from the visitor’s browser, not from ms.computer.',
  })
  return out
}

export async function evaluate(snap: RepoSnapshot, d: Detection, onProgress?: Progress): Promise<{ findings: Finding[]; scanned: number }> {
  const files = await readAll(snap, pickFiles(snap, d), d, onProgress)
  const findings: Finding[] = [...securityFindings(snap, files)]
  findings.push(...(d.mode === 'dynamic' ? await dynamicFindings(snap, d, files) : await staticFindings(snap, d, files)))

  if (!d.workflowSupported) {
    findings.push({
      id: 'toolchain',
      severity: 'warn',
      category: 'build',
      title: d.framework === 'unknown' ? 'Couldn’t work out how to build this' : `${d.frameworkLabel} needs its own build tool`,
      detail:
        d.framework === 'unknown'
          ? 'No index.html or known framework was found, so the generated workflow may need edits.'
          : 'The generated workflow sets up Node. Add a setup step for this tool before the build step.',
    })
  }
  if (snap.truncated) {
    findings.push({ id: 'truncated', severity: 'info', category: 'build', title: 'Very large repo — partly scanned', detail: 'GitHub only returned part of the file list, so some files weren’t checked.' })
  }
  return { findings, scanned: files.length }
}
