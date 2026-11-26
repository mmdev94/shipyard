// "Move my site": spots a repo set up for GitHub Pages, Netlify or Vercel and
// reads the settings worth keeping (build command, output folder, redirects,
// headers) and the ones that can't come along (functions, custom domains,
// Netlify Forms). Everything is read from files in the repo — the hosts'
// dashboards aren't visible from here, and the report says so.
import type { RepoSnapshot } from './types.ts'

export type Host = 'netlify' | 'vercel' | 'github-pages'

export const HOST_LABEL: Record<Host, string> = { netlify: 'Netlify', vercel: 'Vercel', 'github-pages': 'GitHub Pages' }

export interface Redirect {
  from: string
  to: string
  status: number
  /** Netlify's "!" / force = true */
  force?: boolean
  /** has conditions (country, language, role, query) that aren't carried over */
  conditional?: boolean
}

export interface HeaderRule {
  /** path pattern, e.g. "/*" or "/assets/(.*)" */
  path: string
  values: [string, string][]
}

export interface HostSetup {
  host: Host
  /** files the setup was read from, e.g. ["netlify.toml", "public/_redirects"] */
  sources: string[]
  build: { command?: string; publish?: string; base?: string; node?: string }
  redirects: Redirect[]
  /** header rules (_headers blocks, [[headers]], vercel.json headers) */
  headers: HeaderRule[]
  /** serverless functions that won't run on a static site */
  functions: string[]
  /** a custom domain (CNAME file) */
  domain?: string
  /** Netlify Forms in the HTML */
  forms: string[]
  /** GitHub Pages project sites live under /<repo>/ — the setting that says so */
  basePath?: { file: string; value: string; kind: 'vite' | 'next' | 'astro' | 'cra' | 'docusaurus' | 'sveltekit' }
  /** Vercel cleanUrls / trailingSlash and similar URL behaviour */
  urlOptions: string[]
}

// ── a small TOML reader: enough for netlify.toml ─────────────────────────────

type TomlValue = string | number | boolean | TomlTable | TomlValue[]
interface TomlTable {
  [key: string]: TomlValue
}

function tomlScalar(raw: string): TomlValue {
  const v = raw.trim()
  if (/^".*"$/.test(v)) return JSON.parse(v.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')) as string
  if (/^'.*'$/.test(v)) return v.slice(1, -1)
  if (v === 'true' || v === 'false') return v === 'true'
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean).map(tomlScalar)
  if (/^\{.*\}$/.test(v)) {
    const t: TomlTable = {}
    for (const part of v.slice(1, -1).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
      const m = /^\s*([\w."-]+)\s*=\s*(.+)$/.exec(part)
      if (m) t[m[1].replace(/"/g, '')] = tomlScalar(m[2])
    }
    return t
  }
  return v
}

/** Parses the parts of TOML netlify.toml uses: tables, arrays of tables, strings, numbers, booleans, inline arrays/tables. */
export function parseToml(text: string): TomlTable {
  const root: TomlTable = {}
  let cur = root
  const path = (keys: string[], arrayOfTables: boolean) => {
    let t = root
    keys.forEach((k, i) => {
      const last = i === keys.length - 1
      if (last && arrayOfTables) {
        const arr = (Array.isArray(t[k]) ? t[k] : (t[k] = [])) as TomlValue[]
        const fresh: TomlTable = {}
        arr.push(fresh)
        t = fresh
      } else {
        const next = t[k]
        if (Array.isArray(next)) t = next[next.length - 1] as TomlTable
        else t = (typeof next === 'object' && next ? next : (t[k] = {})) as TomlTable
      }
    })
    return t
  }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '').trim()
    if (!line) continue
    let m = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(line)
    if (m) {
      cur = path(m[1].split('.').map((k) => k.trim().replace(/"/g, '')), true)
      continue
    }
    m = /^\[\s*([^\]]+?)\s*\]$/.exec(line)
    if (m) {
      cur = path(m[1].split('.').map((k) => k.trim().replace(/"/g, '')), false)
      continue
    }
    m = /^([\w."-]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2]
    // multi-line arrays
    if (value.startsWith('[') && !value.endsWith(']')) {
      while (i + 1 < lines.length && !value.trim().endsWith(']')) value += ' ' + lines[++i].replace(/\s+#.*$/, '').trim()
    }
    // triple-quoted strings
    if (value.startsWith('"""')) {
      let body = value.slice(3)
      while (!body.includes('"""') && i + 1 < lines.length) body += '\n' + lines[++i]
      cur[m[1].replace(/"/g, '')] = body.slice(0, body.indexOf('"""')).trim()
      continue
    }
    cur[m[1].replace(/"/g, '')] = tomlScalar(value)
  }
  return root
}

const str = (v: TomlValue | undefined) => (typeof v === 'string' ? v : undefined)
const tables = (v: TomlValue | undefined) => (Array.isArray(v) ? (v.filter((x) => typeof x === 'object' && x && !Array.isArray(x)) as TomlTable[]) : [])

/** Netlify `_redirects` lines: `from to [status][!]` (query/condition params are kept out). */
export function parseRedirectsFile(text: string): Redirect[] {
  const out: Redirect[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    if (parts.length < 2) continue
    const [from, to] = parts
    const code = parts.slice(2).find((p) => /^\d{3}!?$/.test(p))
    out.push({ from, to, status: code ? Number(code.replace('!', '')) : 301, force: code?.endsWith('!') || undefined, ...(parts.slice(2).some((p) => p.includes('=')) ? { conditional: true } : {}) })
  }
  return out
}

/** Netlify `_headers`: a path line, then indented `Name: value` lines. */
export function parseHeadersFile(text: string): HeaderRule[] {
  const out: HeaderRule[] = []
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line) && line.trim().startsWith('/')) out.push({ path: line.trim(), values: [] })
    else {
      const m = /^\s+([A-Za-z0-9-]+)\s*:\s*(.+)$/.exec(line)
      if (m && out.length) out[out.length - 1].values.push([m[1], m[2].trim()])
    }
  }
  return out.filter((r) => r.values.length)
}

/** Is this redirect the single-page-app fallback ("/* → /index.html 200")? */
export const isSpaFallback = (r: Redirect) => r.status === 200 && /^\/\*$|^\/\(\.\*\)$|^\/:path\*$/.test(r.from) && /^\/index\.html$|^\/$/.test(r.to)

// ── reading a repo ───────────────────────────────────────────────────────────

const SKIP = /(^|\/)(node_modules|\.git|vendor|dist|build|out|\.next)\//

export async function detectHost(snap: RepoSnapshot, dir: string): Promise<HostSetup | null> {
  const base = dir === '.' ? '' : `${dir}/`
  const paths = snap.files.map((f) => f.path)
  const has = (p: string) => paths.includes(p)
  const under = (p: string) => p.startsWith(base) && !SKIP.test(p)
  const read = (p: string) => snap.read(p)

  const netlifyToml = ['netlify.toml', `${base}netlify.toml`].find(has)
  const redirectFiles = paths.filter((p) => under(p) && /(^|\/)_redirects$/.test(p))
  const headerFiles = paths.filter((p) => under(p) && /(^|\/)_headers$/.test(p))
  const vercelJson = ['vercel.json', `${base}vercel.json`].find(has)
  const workflows = paths.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) && !/ms-computer/.test(p))
  const pagesWorkflows: { path: string; text: string }[] = []
  for (const w of workflows) {
    const text = (await read(w)) ?? ''
    if (/actions\/deploy-pages@|actions\/upload-pages-artifact@|peaceiris\/actions-gh-pages@|JamesIves\/github-pages-deploy-action@/.test(text)) pagesWorkflows.push({ path: w, text })
  }
  const pkgText = (await read(`${base}package.json`)) ?? ''
  const ghPagesScript = /"[^"]+"\s*:\s*"[^"]*\bgh-pages\s+(-d|--dist)\b[^"]*"/.exec(pkgText)?.[0]
  const cname = ['CNAME', `${base}CNAME`, `${base}public/CNAME`, `${base}static/CNAME`].find(has)

  const host: Host | null =
    netlifyToml || (redirectFiles.length && !vercelJson) || has('netlify/functions') || paths.some((p) => p.startsWith('netlify/functions/'))
      ? 'netlify'
      : vercelJson
        ? 'vercel'
        : pagesWorkflows.length || ghPagesScript || cname
          ? 'github-pages'
          : null
  if (!host) return null

  const setup: HostSetup = { host, sources: [], build: {}, redirects: [], headers: [], functions: [], forms: [], urlOptions: [] }

  if (host === 'netlify') {
    if (netlifyToml) {
      setup.sources.push(netlifyToml)
      const t = parseToml((await read(netlifyToml)) ?? '')
      const b = (t.build ?? {}) as TomlTable
      setup.build = { command: str(b.command), publish: str(b.publish), base: str(b.base) }
      for (const r of tables(t.redirects)) {
        const from = str(r.from)
        const to = str(r.to)
        if (from && to) setup.redirects.push({ from, to, status: typeof r.status === 'number' ? r.status : 301, force: r.force === true || undefined, ...(r.conditions || r.query ? { conditional: true } : {}) })
      }
      for (const h of tables(t.headers)) {
        const values = (typeof h.values === 'object' && h.values && !Array.isArray(h.values) ? Object.entries(h.values) : []).filter(([, v]) => typeof v === 'string') as [string, string][]
        if (str(h.for) && values.length) setup.headers.push({ path: str(h.for)!, values })
      }
      const env = ((b.environment ?? {}) as TomlTable)
      if (str(env.NODE_VERSION)) setup.build.node = str(env.NODE_VERSION)
      const fdir = str(((t.functions ?? {}) as TomlTable).directory) ?? str(b.functions)
      if (fdir) setup.functions.push(...paths.filter((p) => p.startsWith(`${fdir.replace(/^\.?\/|\/$/g, '')}/`) && /\.(m?[jt]s|go|py)$/.test(p)))
      const edge = tables(t.edge_functions)
      if (edge.length) setup.functions.push(...edge.map((e) => `edge function ${str(e.function) ?? ''}`.trim()))
    }
    for (const f of redirectFiles) {
      setup.sources.push(f)
      setup.redirects.push(...parseRedirectsFile((await read(f)) ?? ''))
    }
    for (const f of headerFiles) {
      setup.sources.push(f)
      setup.headers.push(...parseHeadersFile((await read(f)) ?? ''))
    }
    if (!setup.functions.length) setup.functions.push(...paths.filter((p) => /^netlify\/(functions|edge-functions)\/[^/]+\.(m?[jt]s|go)$/.test(p) || /^netlify\/functions\/[^/]+\/index\.(m?[jt]s)$/.test(p)))
    const html = paths.filter((p) => under(p) && /\.html?$/.test(p)).slice(0, 40)
    for (const p of html) if (/<form[^>]*\b(data-netlify\s*=\s*["']?true|netlify)\b/i.test((await read(p)) ?? '')) setup.forms.push(p)
  }

  if (host === 'vercel') {
    setup.sources.push(vercelJson!)
    let v: Record<string, unknown> = {}
    try {
      v = JSON.parse((await read(vercelJson!)) ?? '{}') as Record<string, unknown>
    } catch {
      /* unreadable vercel.json: keep going with the rest */
    }
    setup.build = {
      command: typeof v.buildCommand === 'string' ? v.buildCommand : undefined,
      publish: typeof v.outputDirectory === 'string' ? v.outputDirectory : undefined,
    }
    const cond = (r: { has?: unknown; missing?: unknown }) => (r.has || r.missing ? { conditional: true } : {})
    for (const r of (Array.isArray(v.rewrites) ? v.rewrites : []) as { source?: string; destination?: string; has?: unknown; missing?: unknown }[])
      if (r.source && r.destination) setup.redirects.push({ from: r.source, to: r.destination, status: 200, ...cond(r) })
    for (const r of (Array.isArray(v.redirects) ? v.redirects : []) as { source?: string; destination?: string; permanent?: boolean; statusCode?: number; has?: unknown; missing?: unknown }[])
      if (r.source && r.destination) setup.redirects.push({ from: r.source, to: r.destination, status: r.statusCode ?? (r.permanent === false ? 307 : 308), ...cond(r) })
    for (const r of (Array.isArray(v.routes) ? v.routes : []) as { src?: string; dest?: string; status?: number }[])
      if (r.src && r.dest) setup.redirects.push({ from: r.src, to: r.dest, status: r.status ?? 200 })
    for (const h of (Array.isArray(v.headers) ? v.headers : []) as { source?: string; headers?: { key?: string; value?: string }[] }[]) {
      const values = (h.headers ?? []).filter((x) => x.key && x.value).map((x) => [x.key!, x.value!] as [string, string])
      if (h.source && values.length) setup.headers.push({ path: h.source, values })
    }
    if (v.cleanUrls) setup.urlOptions.push('cleanUrls')
    if (v.trailingSlash !== undefined) setup.urlOptions.push(`trailingSlash: ${String(v.trailingSlash)}`)
    setup.functions.push(...paths.filter((p) => p.startsWith(`${base}api/`) && /\.(m?[jt]s|py|go|rb)$/.test(p) && !/\.(test|spec)\./.test(p)))
  }

  if (host === 'github-pages') {
    setup.sources.push(...pagesWorkflows.map((w) => w.path), ...(ghPagesScript ? [`${base}package.json`] : []))
    for (const w of pagesWorkflows) {
      const publish = /(?:^|\n)\s*(?:path|publish_dir|folder):\s*['"]?([^'"\n#]+)/.exec(w.text)?.[1]?.trim()
      if (publish && !setup.build.publish) setup.build.publish = publish.replace(/^\.\//, '')
      const run = [...w.text.matchAll(/run:\s*([^\n|>][^\n]*)/g)].map((m) => m[1].trim()).find((c) => /\b(build|generate|export)\b/.test(c) && !/install|\bci\b/.test(c))
      if (run && !setup.build.command) setup.build.command = run
    }
    if (ghPagesScript) {
      const d = /gh-pages\s+(?:-d|--dist)\s+(\S+?)["\s]/.exec(ghPagesScript)?.[1]
      if (d && !setup.build.publish) setup.build.publish = d
    }
  }

  if (cname) {
    const d = ((await read(cname)) ?? '').trim().split('\n')[0]
    if (d) setup.domain = d
    if (!setup.sources.includes(cname)) setup.sources.push(cname)
  }

  // project pages live under /<repo>/; at ms.computer the site is at the root
  if (host === 'github-pages') setup.basePath = await findBasePath(snap, base, paths, pkgText)
  return setup
}

/** The "this site lives under /<repo>/" setting of common frameworks, if set to a sub-path. */
export async function findBasePath(snap: RepoSnapshot, base: string, paths: string[], pkgText: string): Promise<HostSetup['basePath']> {
  const first = (names: string[]) => names.map((n) => `${base}${n}`).find((p) => paths.includes(p))
  const sub = (v: string | undefined) => (v && /^\/[^/]+.*/.test(v) && v !== '/' ? v : undefined)
  const checks: [HostSetup['basePath'] extends infer B ? (B extends { kind: infer K } ? K : never) : never, string[], RegExp][] = [
    ['vite', ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts'], /\bbase\s*:\s*['"`]([^'"`]+)['"`]/],
    ['next', ['next.config.js', 'next.config.mjs', 'next.config.ts'], /\bbasePath\s*:\s*['"`]([^'"`]+)['"`]/],
    ['astro', ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'], /\bbase\s*:\s*['"`]([^'"`]+)['"`]/],
    ['docusaurus', ['docusaurus.config.js', 'docusaurus.config.ts'], /\bbaseUrl\s*:\s*['"`]([^'"`]+)['"`]/],
    ['sveltekit', ['svelte.config.js'], /\bbase\s*:\s*['"`]([^'"`]+)['"`]/],
  ]
  for (const [kind, names, re] of checks) {
    const file = first(names)
    if (!file) continue
    const value = sub(re.exec((await snap.read(file)) ?? '')?.[1])
    if (value) return { file, value, kind }
  }
  const homepage = /"homepage"\s*:\s*"https?:\/\/[^"/]+\.github\.io(\/[^"]+)"/.exec(pkgText)?.[1]
  if (homepage && sub(homepage)) return { file: `${base}package.json`, value: homepage, kind: 'cra' }
  return undefined
}
