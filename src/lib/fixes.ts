// "Fix it for me": checker findings that have one safe, mechanical fix. Each
// fix is a function of the files as they are *now* (read fresh when the pull
// request is made, so it never reverts someone's newer edits) and returns the
// changed files. Nothing here guesses at business logic — leaked keys, for
// one, stay a manual job, because the real fix is revoking the key.
import type { Report } from './checker/types.ts'
import { isCommittedEnv } from './checker/rules.ts'
import { goPort, pyDep } from './checker/servers.ts'

export type Read = (path: string) => Promise<string | null>

export interface FileChange {
  path: string
  /** null: the file is new */
  before: string | null
  /** null: the file is deleted */
  after: string | null
}

export interface Fix {
  id: string
  /** finding this fix belongs to; undefined for fixes offered from the verdict */
  findingId?: string
  title: string
  /** one sentence for the button's panel */
  summary: string
  /** shown in red above the PR button */
  warning?: string
  /** pull request title and description (markdown) */
  prTitle: string
  prBody: string
  build(read: Read): Promise<FileChange[]>
}

const join = (dir: string, p: string) => (dir === '.' || !dir ? p : `${dir.replace(/\/$/, '')}/${p}`)
const FOOTER = '\n\n---\nOpened with [Shipyard](https://github.com/mmdev94/shipyard) “Fix it for me”. Review the diff before merging — nothing changes until you do.'

// ── committed .env files ──────────────────────────────────────────────────────

const GITIGNORE_BLOCK = `
# Local secrets — never commit these (added by Shipyard)
.env
.env.*
!.env.example
!.env.sample
!.env.template
`

/** Appends the .env block unless .gitignore already ignores `.env` and `.env.*`. */
export function ignoreEnv(gitignore: string | null): string | null {
  const lines = (gitignore ?? '').split('\n').map((l) => l.trim())
  const covers = (re: RegExp) => lines.some((l) => re.test(l))
  if (covers(/^\/?\.env\*$/) || (covers(/^\/?\.env$/) && covers(/^\/?\.env\.\*$/)) || covers(/^\*\*?\/?\.env\*$/)) return null
  const base = gitignore ?? ''
  return base + (base && !base.endsWith('\n') ? '\n' : '') + GITIGNORE_BLOCK.slice(base ? 0 : 1)
}

function envFileFix(report: Report): Fix | null {
  const files = report.paths.filter(isCommittedEnv)
  if (!files.length) return null
  const list = files.map((f) => `- \`${f}\``).join('\n')
  return {
    id: 'remove-env-files',
    findingId: 'env-file',
    title: 'Delete the .env files and ignore them from now on',
    summary: `Deletes ${files.length === 1 ? files[0] : `${files.length} .env files`} and adds .env to .gitignore, so it can’t be committed again.`,
    warning: 'This removes the file from the latest commit only. Its values stay in the git history, and anyone may already have copied them — rotate every key it contained.',
    prTitle: 'Remove committed .env files',
    prBody: `This repo is public, so these files are readable by anyone:\n\n${list}\n\nThis pull request deletes them and adds \`.env\` / \`.env.*\` to \`.gitignore\` (keeping \`.env.example\`).\n\n**Rotate every key these files contained.** Deleting a file doesn’t remove it from the git history, and the values may already have been copied.${FOOTER}`,
    async build(read) {
      const changes: FileChange[] = []
      for (const path of files) changes.push({ path, before: await read(path), after: null })
      const gi = await read('.gitignore')
      const next = ignoreEnv(gi)
      if (next !== null) changes.push({ path: '.gitignore', before: gi, after: next })
      return changes.filter((c) => !(c.after === null && c.before === null))
    },
  }
}

// ── fixed listen port ─────────────────────────────────────────────────────────

const NODE_LISTEN = /\.listen\(\s*(3000|8000|8080|5000|4000)\b(?![^)]*process\.env\.PORT)/g

/** `app.listen(3000` → `app.listen(Number(process.env.PORT) || 3000`. */
export function nodePort(src: string): string {
  return src.replace(NODE_LISTEN, '.listen(Number(process.env.PORT) || $1')
}

/** Flask-style `app.run(port=5000)` → reads $PORT and listens on every interface. */
export function pythonPort(src: string): string {
  let changed = false
  const out = src.replace(/app\.run\(([^)]*)\)/g, (call, args: string) => {
    if (!/port\s*=\s*\d+/.test(args)) return call
    changed = true
    let a = args.replace(/port\s*=\s*(\d+)/, 'port=int(os.environ.get("PORT", $1))')
    if (!/host\s*=/.test(a)) a = `host="0.0.0.0", ${a.trim()}`
    return `app.run(${a})`
  })
  if (!changed || /^\s*import os\b|^\s*import [^\n]*\bos\b/m.test(out)) return out
  // add `import os` after a leading shebang / encoding line / docstring-free header
  const lines = out.split('\n')
  let at = 0
  while (at < lines.length && (/^#!/.test(lines[at]) || /^#.*coding[:=]/.test(lines[at]))) at++
  lines.splice(at, 0, 'import os')
  return lines.join('\n')
}

function portFix(report: Report): Fix | null {
  const f = report.findings.find((x) => x.id === 'port' && x.severity === 'warn')
  const paths = [...new Set(f?.evidence?.map((e) => e.path) ?? [])]
  if (!paths.length) return null
  return {
    id: 'listen-on-port',
    findingId: 'port',
    title: 'Listen on the port ms.computer gives you',
    summary: `Changes ${paths.join(', ')} to read $PORT, keeping the current port as the fallback for local runs.`,
    prTitle: 'Listen on $PORT',
    prBody: `ms.computer tells the server which port to listen on through \`$PORT\`, and checks \`GET /\` before going live. The server listened on a fixed port; this reads \`$PORT\` and keeps the old port as the fallback, so local runs work as before.\n\nChanged: ${paths.map((p) => `\`${p}\``).join(', ')}${FOOTER}`,
    async build(read) {
      const out: FileChange[] = []
      for (const path of paths) {
        const before = await read(path)
        if (before === null) continue
        const after = /\.py$/.test(path) ? pythonPort(before) : /\.go$/.test(path) ? goPort(before) : nodePort(before)
        if (after !== before) out.push({ path, before, after })
      }
      return out
    },
  }
}

// ── Python: tell ms.computer how to start the app ─────────────────────────────

/** Sets the Procfile's web line (keeping any other lines). */
export function procfileWith(before: string | null, cmd: string): string {
  const line = `web: ${cmd}`
  if (!before) return `${line}\n`
  if (/^web:.*$/m.test(before)) return before.replace(/^web:.*$/m, line)
  return `${line}\n${before}`
}

/** Adds a package to requirements.txt; null when it's already there. */
export function requirementWith(before: string | null, name: string): string | null {
  if (before !== null && pyDep(before, name)) return null
  const text = before ?? ''
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${name}\n`
}

function pyStartFix(report: Report): Fix | null {
  const f = report.findings.find((x) => x.id === 'start' && x.data?.procfile)
  if (!f?.data) return null
  const { procfile: cmd, server, reqFile, dir } = f.data
  const procPath = join(dir, 'Procfile')
  const addsServer = Boolean(server && reqFile?.endsWith('requirements.txt'))
  return {
    id: 'python-start',
    findingId: 'start',
    title: 'Tell ms.computer how to start the app',
    summary: `Writes a Procfile with \`web: ${cmd}\`${addsServer ? ` and adds ${server} to requirements.txt` : ''}.`,
    warning: server && !addsServer ? `Also add ${server} to ${reqFile} yourself — Shipyard only edits requirements.txt.` : undefined,
    prTitle: 'Tell ms.computer how to start the app (Procfile)',
    prBody: `Without a start command, ms.computer guesses \`main:app\` for Python apps — this one isn't there, so the build would work and the server would then fail its health check.\n\nThis adds a Procfile whose \`web\` line ms.computer runs as is:\n\n\`\`\`\nweb: ${cmd}\n\`\`\`\n\nIt listens on 0.0.0.0 at the port ms.computer passes in \`$PORT\`.${addsServer ? ` ${server} is added to requirements.txt, since the command needs it.` : ''}${FOOTER}`,
    async build(read) {
      const out: FileChange[] = []
      const before = await read(procPath)
      const after = procfileWith(before, cmd)
      if (after !== before) out.push({ path: procPath, before, after })
      if (addsServer && server && reqFile) {
        const req = await read(reqFile)
        const next = requirementWith(req, server)
        if (next !== null) out.push({ path: reqFile, before: req, after: next })
      }
      return out
    },
  }
}

// ── Next.js → static export ───────────────────────────────────────────────────

const NEXT_CONFIGS = ['next.config.mjs', 'next.config.js', 'next.config.ts', 'next.config.mts', 'next.config.cjs']

/** Server-only features that `output: 'export'` can't build. */
export function nextExportBlockers(paths: string[], dir: string): string[] {
  const under = (p: string) => (dir === '.' ? true : p.startsWith(`${dir}/`))
  const rel = (p: string) => (dir === '.' ? p : p.slice(dir.length + 1))
  return paths.filter(under).map(rel).filter((p) =>
    /^(src\/)?pages\/api\//.test(p) || /^(src\/)?app\/(.+\/)?route\.[cm]?[jt]sx?$/.test(p) || /^(src\/)?middleware\.[cm]?[jt]s$/.test(p),
  )
}

/** Adds `output: 'export'` (and unoptimized images) to a Next config; null if its shape isn't one we can edit safely. */
export function nextExportConfig(src: string | null): string | null {
  if (src === null) return `/** @type {import('next').NextConfig} */\nexport default {\n  output: 'export',\n  images: { unoptimized: true },\n}\n`
  if (/output\s*:\s*['"`]export['"`]/.test(src)) return null
  const open = /(const\s+\w+(?:\s*:\s*[\w.]+)?\s*=\s*\{)|(export\s+default\s*\{)|(module\.exports\s*=\s*\{)/.exec(src)
  if (!open) return null
  const insert = `\n  output: 'export',${/\bimages\s*:/.test(src) ? '' : '\n  images: { unoptimized: true },'}`
  const at = open.index + open[0].length
  return src.slice(0, at) + insert + src.slice(at)
}

function nextFix(report: Report): Fix | null {
  const d = report.detection
  if (d.framework !== 'next') return null
  const blockers = nextExportBlockers(report.paths, d.workingDir)
  if (blockers.length) return null
  const existing = NEXT_CONFIGS.map((n) => join(d.workingDir, n)).find((p) => report.paths.includes(p))
  const path = existing ?? join(d.workingDir, 'next.config.mjs')
  return {
    id: 'next-static-export',
    title: 'Build Next.js as a static site',
    summary: `No API routes, route handlers or middleware were found, so this app can probably be exported as static files. Adds output: 'export' to ${path}.`,
    prTitle: 'Build Next.js as a static site (output: export)',
    prBody: `ms.computer serves static sites, and this Next.js app has no API routes, route handlers or middleware — so it can likely be exported as plain files.\n\nThis sets \`output: 'export'\` (the build goes to \`out/\`) and \`images: { unoptimized: true }\` (the image optimizer needs a server).\n\n**Check the build before merging.** \`next build\` stops with a clear message if a page uses something that needs a server — \`cookies()\`, \`headers()\`, server actions, or dynamic routes without \`generateStaticParams\`.${FOOTER}`,
    async build(read) {
      const before = await read(path)
      const after = nextExportConfig(before)
      return after === null ? [] : [{ path, before, after }]
    },
  }
}

// ── Nuxt → generate ───────────────────────────────────────────────────────────

/** Adds `"generate": "nuxt generate"` to package.json, keeping its indentation and key order. */
export function addScript(pkgText: string, name: string, cmd: string): string | null {
  let pkg: { scripts?: Record<string, string> }
  try {
    pkg = JSON.parse(pkgText)
  } catch {
    return null
  }
  if (pkg.scripts?.[name]) return null
  const indent = /^\{\s*\n([ \t]+)"/.exec(pkgText)?.[1] ?? '  '
  pkg.scripts = { ...(pkg.scripts ?? {}), [name]: cmd }
  return JSON.stringify(pkg, null, indent) + (pkgText.endsWith('\n') ? '\n' : '')
}

function nuxtFix(report: Report): Fix | null {
  const d = report.detection
  if (d.framework !== 'nuxt') return null
  const path = join(d.workingDir, 'package.json')
  return {
    id: 'nuxt-generate',
    title: 'Pre-render Nuxt as a static site',
    summary: 'Adds a "generate" script (nuxt generate), which pre-renders every page into static files that ms.computer can serve.',
    prTitle: 'Add a nuxt generate script for static hosting',
    prBody: `ms.computer serves static sites. \`nuxt generate\` pre-renders the app into \`.output/public\`, and Shipyard deploys that folder once this script exists.\n\nCheck the result before merging: pages that need a server at request time (server routes, \`useRequestHeaders\`) won’t work when pre-rendered.${FOOTER}`,
    async build(read) {
      const before = await read(path)
      const after = before === null ? null : addScript(before, 'generate', 'nuxt generate')
      return after === null ? [] : [{ path, before, after }]
    },
  }
}

/** Fixes Shipyard can make for this report, most important first. */
export function availableFixes(report: Report): Fix[] {
  return [envFileFix(report), pyStartFix(report), portFix(report), nextFix(report), nuxtFix(report)].filter((f): f is Fix => f !== null)
}

/** Changed lines with a little context, for the preview: a prefix/suffix line diff (fixes are local edits). */
export function diffLines(before: string | null, after: string | null, context = 2): { kind: ' ' | '-' | '+'; text: string }[] {
  const a = before === null ? [] : before.split('\n')
  const b = after === null ? [] : after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const from = Math.max(0, start - context)
  return [
    ...a.slice(from, start).map((text) => ({ kind: ' ' as const, text })),
    ...a.slice(start, endA).map((text) => ({ kind: '-' as const, text })),
    ...b.slice(start, endB).map((text) => ({ kind: '+' as const, text })),
    ...a.slice(endA, Math.min(a.length, endA + context)).map((text) => ({ kind: ' ' as const, text })),
  ]
}
