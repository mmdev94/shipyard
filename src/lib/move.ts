// "Move my site": the plan for switching a GitHub Pages, Netlify or Vercel
// site to ms.computer, and the one pull request that does it.
//
// What ms.computer's static hosting does (measured 2026-11-27 on a live site):
// /about serves about/index.html, /docs serves docs.html, a custom 404.html is
// served for unknown paths (status 404), and _redirects/_headers are ignored.
// A Caddyfile is refused in a static build — but a site served by Caddy as a
// small server app gets real redirects, rewrites and headers (also measured).
// So a move has two modes:
//   static — fastest; SPA fallback via 404.html, exact-path redirects as
//            redirect pages, everything else listed as not coming along;
//   exact  — the rules translated into a Caddyfile, served as a server app.
import type { Report } from './checker/types.ts'
import { HOST_LABEL, isSpaFallback, type HostSetup, type Redirect } from './checker/hosts.ts'
import type { FileChange, Fix } from './fixes.ts'
import { generateWorkflow, SAFE_FROM, SAFE_TO, type WorkflowConfig } from './workflow.ts'
import { WORKFLOW_PATH } from './setup.ts'
import { configFromReport } from './github/copy.ts'

export type MoveMode = 'static' | 'exact'

export interface MoveItem {
  what: string
  status: 'kept' | 'changed' | 'lost'
  detail: string
}

// ── patterns: Netlify (/blog/*, :name) and Vercel (/:path*, /(.*), :name) ───

export interface Pattern {
  /** an anchored regex over the path */
  regex: string
  /** group names in order: "splat", a :name, or "$1"… for raw groups */
  groups: string[]
  exact: boolean
}

/** Turns a host's path pattern into a regex; null for what isn't translated (conditions, regex options). */
export function toPattern(from: string): Pattern | null {
  if (!from.startsWith('/') || /\s/.test(from)) return null
  if (!/[*:(]/.test(from)) return { regex: `^${esc(from)}$`, groups: [], exact: true }
  const groups: string[] = []
  let raw = 0
  let out = ''
  for (let i = 0; i < from.length; ) {
    const rest = from.slice(i)
    let m: RegExpExecArray | null
    if (rest.startsWith('(.*)')) {
      groups.push(`$${++raw}`)
      out += '(.*)'
      i += 4
    } else if ((m = /^:([A-Za-z_]\w*)\*/.exec(rest))) {
      groups.push(m[1])
      out += '(.*)'
      i += m[0].length
    } else if ((m = /^:([A-Za-z_]\w*)(?![\w(])/.exec(rest))) {
      groups.push(m[1])
      out += '([^/]+)'
      i += m[0].length
    } else if (rest[0] === '*') {
      groups.push('splat')
      out += '(.*)'
      i += 1
    } else if (/^[A-Za-z0-9._~/-]/.test(rest)) {
      out += esc(rest[0])
      i += 1
    } else return null
  }
  return { regex: `^${out}$`, groups, exact: false }
}

const esc = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

/** Fills a destination's :splat / :name / $1 with Caddy placeholders for the match named `id`. */
export function toTarget(to: string, p: Pattern, id: string): string | null {
  let ok = true
  const out = to.replace(/:([A-Za-z_]\w*)|\$(\d)/g, (all, name: string | undefined, num: string | undefined) => {
    const key = name ?? `$${num}`
    const at = p.groups.indexOf(key)
    if (at === -1) {
      ok = false
      return all
    }
    return `{re.${id}.${at + 1}}`
  })
  return ok && /^(https?:\/\/[^\s"]+|\/[^\s"]*)$/.test(out) ? out : null
}

const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * A Caddyfile that serves the built site with the old host's rules. Returns
 * the file and the rules it couldn't express (they're listed in the PR).
 */
export function caddyfileFor(setup: HostSetup, opts: { spa: boolean }): { text: string; skipped: string[] } {
  const lines: string[] = []
  const skipped: string[] = []
  let n = 0
  // Netlify applies non-forced rules only when no file matches; Vercel redirects always win
  const shadow = (r: Redirect) => setup.host === 'netlify' && !r.force

  for (const h of setup.headers) {
    const p = toPattern(h.path)
    if (!p) {
      skipped.push(`headers for ${h.path}`)
      continue
    }
    const id = `h${++n}`
    lines.push(`\t@${id} path_regexp ${id} ${p.regex}`)
    for (const [k, v] of h.values) if (/^[A-Za-z0-9-]+$/.test(k)) lines.push(`\theader @${id} ${k} ${quote(v)}`)
  }

  for (const r of setup.redirects) {
    if (opts.spa && isSpaFallback(r)) continue
    const p = toPattern(r.from)
    const label = `${r.from} → ${r.to} (${r.status})`
    if (!p || r.conditional) {
      skipped.push(label)
      continue
    }
    const id = `r${++n}`
    const target = toTarget(r.to, p, id)
    if (!target) {
      skipped.push(label)
      continue
    }
    const matcher = shadow(r) ? `\t@${id} {\n\t\tpath_regexp ${id} ${p.regex}\n\t\tnot file\n\t}` : `\t@${id} path_regexp ${id} ${p.regex}`
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      lines.push(matcher, `\tredir @${id} ${target} ${r.status}`)
    } else if (r.status === 200 && target.startsWith('/')) {
      lines.push(matcher, `\trewrite @${id} ${target}`)
    } else if (r.status === 410 || r.status === 404) {
      lines.push(matcher, `\trespond @${id} ${r.status}`)
    } else {
      skipped.push(`${label}${r.status === 200 ? ' — proxying to another site needs outbound network, which ms.computer apps don’t have' : ''}`)
    }
  }

  const text = `# Serves the site on ms.computer with the rules it had on ${HOST_LABEL[setup.host]}.
# Written by Shipyard from ${setup.sources.join(', ') || 'the repo'} — edit freely.
:{$PORT:80} {
\troot * .
\tencode gzip
${lines.join('\n')}
\ttry_files {path} {path}.html {path}/index.html${opts.spa ? ' /index.html' : ''}
\tfile_server
\thandle_errors 404 {
\t\trewrite * /404.html
\t\tfile_server
\t}
}
`
  return { text, skipped }
}

// ── the plan ──────────────────────────────────────────────────────────────────

/** Workflow settings for the moved site. */
export function moveConfig(report: Report, mode: MoveMode, caddyPath = 'Caddyfile'): WorkflowConfig {
  const setup = report.host!
  const cfg = configFromReport(report)
  const spa = setup.redirects.some(isSpaFallback) || Boolean(cfg.spa)
  if (mode === 'exact') return { ...cfg, caddyfile: caddyPath, spa: spa || undefined }
  const pages = setup.redirects
    .filter((r) => !isSpaFallback(r) && [301, 302, 307, 308].includes(r.status) && !r.conditional && SAFE_FROM.test(r.from) && SAFE_TO.test(r.to) && r.from !== '/')
    .map((r) => [r.from, r.to] as [string, string])
  return { ...cfg, spa: spa || undefined, redirectPages: pages.length ? pages : undefined }
}

/** What happens to each part of the old setup. */
export function movePlan(report: Report, mode: MoveMode): MoveItem[] {
  const s = report.host!
  const host = HOST_LABEL[s.host]
  const d = report.detection
  const items: MoveItem[] = []
  if (s.build.command || s.build.publish)
    items.push({ what: 'Build settings', status: 'kept', detail: `Builds with \`${d.buildCommand || 'no build step'}\` and serves \`${d.outputDir}\`${s.sources[0] ? `, as in ${s.sources[0]}` : ''}.` })
  if (s.build.node) items.push({ what: 'Node version', status: 'kept', detail: `Node ${d.nodeVersion}, from ${s.sources[0]}.` })

  const spa = s.redirects.some(isSpaFallback)
  if (spa)
    items.push(
      mode === 'exact'
        ? { what: 'Single-page app fallback', status: 'kept', detail: 'Every unknown path serves index.html with status 200, as before.' }
        : { what: 'Single-page app fallback', status: 'changed', detail: 'index.html is copied to 404.html, so deep links load the app — with status 404 instead of 200. Search engines may skip those URLs; choose “Exact rules” to keep 200.' },
    )
  const rules = s.redirects.filter((r) => !isSpaFallback(r))
  if (rules.length) {
    if (mode === 'exact') {
      const { skipped } = caddyfileFor(s, { spa })
      const bad = skipped.filter((x) => !x.startsWith('headers'))
      items.push({ what: `Redirects and rewrites (${rules.length})`, status: bad.length ? 'changed' : 'kept', detail: bad.length ? `Kept as real redirects, except: ${bad.join('; ')}.` : 'Kept as real redirects and rewrites, served by Caddy.' })
    } else {
      const pages = moveConfig(report, 'static').redirectPages ?? []
      const rest = rules.length - pages.length
      items.push({
        what: `Redirects and rewrites (${rules.length})`,
        status: rest ? 'lost' : 'changed',
        detail: `${pages.length ? `${pages.length} exact-path redirect${pages.length === 1 ? '' : 's'} become${pages.length === 1 ? 's' : ''} a redirect page (an instant HTML redirect, not a 301). ` : ''}${rest ? `${rest} with wildcards, rewrites or conditions can’t be expressed on static hosting — choose “Exact rules” to keep them.` : ''}`.trim(),
      })
    }
  }
  if (s.headers.length) {
    const skippedHeaders = mode === 'exact' ? caddyfileFor(s, { spa }).skipped.filter((x) => x.startsWith('headers')) : []
    items.push(
      mode === 'exact'
        ? { what: `Custom headers (${s.headers.length} rules)`, status: skippedHeaders.length ? 'changed' : 'kept', detail: skippedHeaders.length ? `Kept, except ${skippedHeaders.join(', ')}.` : 'Kept, set by Caddy.' }
        : { what: `Custom headers (${s.headers.length} rules)`, status: 'lost', detail: 'Static hosting sets its own security headers (CSP, nosniff, referrer policy) and no custom ones — choose “Exact rules” to keep yours.' },
    )
  }
  if (s.urlOptions.length) items.push({ what: 'URL options', status: 'kept', detail: `${s.urlOptions.join(', ')}: ms.computer already serves /about from about.html or about/index.html.` })
  if (s.basePath)
    items.push({ what: 'Site path', status: 'changed', detail: `On ${host} the site lives under ${s.basePath.value}; on ms.computer it’s at the root, so ${s.basePath.file} is set to “/”. Check any links that hard-code ${s.basePath.value}.` })
  if (s.functions.length)
    items.push({ what: `Serverless functions (${s.functions.length})`, status: 'lost', detail: `${s.functions.slice(0, 3).join(', ')}${s.functions.length > 3 ? '…' : ''} won’t run: a static site has no functions. Host them elsewhere and call them from the browser, or rebuild them as a small server app on ms.computer.` })
  if (s.forms.length) items.push({ what: 'Netlify Forms', status: 'lost', detail: `The form in ${s.forms[0]} posts to Netlify. Point it at a form service that works from the browser.` })
  if (s.domain) items.push({ what: 'Custom domain', status: 'lost', detail: `${s.domain} stays with ${host}: ms.computer gives every site a name-xxxx.ms.computer address and doesn’t take custom domains yet. Keep the old host up, or point the domain at a redirect.` })
  items.push({ what: 'Environment variables', status: 'changed', detail: `Anything set in ${host}’s dashboard isn’t in the repo. If the build needs it, the check’s environment-variable findings list what it reads.` })
  return items
}

// ── the pull request ──────────────────────────────────────────────────────────

/** Sets a GitHub Pages project's sub-path back to the root; null when the file's shape isn't one we can edit safely. */
export function rootBasePath(text: string, kind: NonNullable<HostSetup['basePath']>['kind'], value: string): string | null {
  const v = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  switch (kind) {
    case 'vite':
    case 'astro': {
      const out = text.replace(new RegExp(`(\\bbase\\s*:\\s*)(['"\`])${v}\\2`), "$1'/'")
      return out === text ? null : out
    }
    case 'sveltekit': {
      const out = text.replace(new RegExp(`(\\bbase\\s*:\\s*)(['"\`])${v}\\2`), "$1''")
      return out === text ? null : out
    }
    case 'next': {
      const out = text.replace(new RegExp(`(\\bbasePath\\s*:\\s*)(['"\`])${v}\\2`), "$1''")
      return out === text ? null : out
    }
    case 'docusaurus': {
      const out = text.replace(new RegExp(`(\\bbaseUrl\\s*:\\s*)(['"\`])${v}\\2`), "$1'/'")
      return out === text ? null : out
    }
    case 'cra': {
      const out = text.replace(/("homepage"\s*:\s*)"[^"]*"/, '$1"."')
      return out === text ? null : out
    }
  }
}

const FOOTER = '\n\n---\nOpened with [Shipyard](https://github.com/mmdev94/shipyard) “Move my site”. Review the diff before merging — nothing changes until you do.'
const MARK: Record<MoveItem['status'], string> = { kept: '✅ Kept', changed: '🔁 Changed', lost: '⚠️ Not coming along' }

/** The "Move to ms.computer" pull request: the deploy workflow, plus what the move needs. */
export function moveFix(report: Report, mode: MoveMode): Fix {
  const s = report.host!
  const host = HOST_LABEL[s.host]
  const dir = report.detection.workingDir
  const at = (p: string) => (dir === '.' ? p : `${dir}/${p}`)
  const items = movePlan(report, mode)
  return {
    id: 'move-to-ms-computer',
    title: `Move from ${host} to ms.computer`,
    summary: `One pull request: the deploy workflow${mode === 'exact' ? ', a Caddyfile with your rules' : ''}${s.basePath ? ', the site path set to the root' : ''}${s.host === 'github-pages' && s.sources.some((x) => x.startsWith('.github/workflows/')) ? ', and the GitHub Pages workflow removed' : ''}. Merging it deploys the site.`,
    prTitle: `Move from ${host} to ms.computer`,
    prBody: `This moves the site from ${host} to ms.computer. **Merging this pull request deploys it** — Shipyard has already saved the one-time setup secret the first deploy needs, and the tracker follows the run.\n\n| | |\n|---|---|\n${items.map((i) => `| ${MARK[i.status]} **${i.what}** | ${i.detail.replace(/\|/g, '\\|')} |`).join('\n')}\n\n**After it’s live:** compare the two sites, then turn off the old one${s.host === 'github-pages' ? ' (Settings → Pages → Source: None)' : ` in ${host}’s dashboard`}.${FOOTER}`,
    async build(read) {
      const out: FileChange[] = []
      let caddyPath = 'Caddyfile'
      if (mode === 'exact') {
        if ((await read(at('Caddyfile'))) !== null) caddyPath = 'ms-computer.Caddyfile'
        const before = await read(at(caddyPath))
        out.push({ path: at(caddyPath), before, after: caddyfileFor(s, { spa: s.redirects.some(isSpaFallback) }).text })
      }
      out.push({ path: WORKFLOW_PATH, before: await read(WORKFLOW_PATH), after: generateWorkflow(moveConfig(report, mode, caddyPath)) })
      if (s.basePath) {
        const before = await read(s.basePath.file)
        const after = before === null ? null : rootBasePath(before, s.basePath.kind, s.basePath.value)
        if (before !== null && after !== null) out.push({ path: s.basePath.file, before, after })
      }
      // GitHub Pages workflows would keep deploying the root-path build to /<repo>/ — remove them
      if (s.host === 'github-pages')
        for (const w of s.sources.filter((x) => x.startsWith('.github/workflows/'))) {
          const before = await read(w)
          if (before !== null) out.push({ path: w, before, after: null })
        }
      return out
    },
  }
}
