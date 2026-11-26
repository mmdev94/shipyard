// Client-side routing in single-page apps. A router using the browser's
// history (/about rather than /#/about) works while you click around, but a
// reload or a shared link asks the server for /about — and a static host
// without a fallback answers 404. ms.computer serves 404.html for unknown
// paths (measured), so shipping index.html as 404.html makes those links work.

/** Frameworks that build a single index.html and route in the browser. */
export const SPA_FRAMEWORKS = new Set(['vite', 'cra', 'vue-cli', 'angular', 'parcel', 'node-build'])

export interface RouterUse {
  /** e.g. "React Router" */
  name: string
  /** where it's set up */
  path: string
  snippet: string
}

interface Rule {
  name: string
  dep: string | ((deps: Record<string, string>) => boolean)
  /** sets up history (path) routing */
  history: RegExp
  /** hash routing — no fallback needed */
  hash?: RegExp
  /** the library routes by path unless told otherwise */
  historyByDefault?: boolean
}

const RULES: Rule[] = [
  { name: 'React Router', dep: (d) => Boolean(d['react-router-dom'] || d['react-router']), history: /\b(BrowserRouter|createBrowserRouter)\b/, hash: /\b(HashRouter|createHashRouter)\b/ },
  { name: 'Vue Router', dep: 'vue-router', history: /\bcreateWebHistory\s*\(|mode\s*:\s*['"]history['"]/, hash: /\bcreateWebHashHistory\s*\(/ },
  { name: 'TanStack Router', dep: '@tanstack/react-router', history: /\bcreateRouter\s*\(/, hash: /\bcreateHashHistory\s*\(/, historyByDefault: true },
  { name: 'wouter', dep: 'wouter', history: /from\s+['"]wouter['"]/, hash: /useHashLocation/, historyByDefault: true },
  { name: 'Solid Router', dep: '@solidjs/router', history: /<Router\b/, hash: /\bHashRouter\b/ },
  { name: 'Angular Router', dep: '@angular/router', history: /\bRouterModule\.forRoot\s*\(|\bprovideRouter\s*\(/, hash: /useHash\s*:\s*true|withHashLocation\s*\(|HashLocationStrategy/ },
  { name: 'Preact Router', dep: (d) => Boolean(d['preact-router'] || d['preact-iso']), history: /\b(Router|LocationProvider)\b/ },
]

/**
 * The router that routes by path in this app, if any. `files` are the source
 * files the checker read; hash routing anywhere in them means no fallback is needed.
 */
export function historyRouter(deps: Record<string, string>, files: { path: string; text: string }[]): RouterUse | null {
  for (const r of RULES) {
    const has = typeof r.dep === 'string' ? Boolean(deps[r.dep]) : r.dep(deps)
    if (!has) continue
    const code = files.filter((f) => /\.(m?[jt]sx?|vue|svelte)$/.test(f.path))
    if (r.hash && code.some((f) => r.hash!.test(f.text))) continue
    for (const f of code) {
      const m = r.history.exec(f.text)
      if (m) {
        const line = f.text.slice(f.text.lastIndexOf('\n', m.index) + 1, f.text.indexOf('\n', m.index) === -1 ? undefined : f.text.indexOf('\n', m.index)).trim()
        return { name: r.name, path: f.path, snippet: line.slice(0, 140) }
      }
    }
  }
  return null
}
