// JavaScript projects that aren't websites: browser extensions, desktop apps,
// command-line tools, libraries and plugins, and monorepos of packages. Each
// would "build", but deploying it gives no real site — so the check says what
// it is, and points to a docs, demo or example site in the repo when there is one.
import type { RepoSnapshot } from './types.ts'

export type NotSiteKind = 'extension' | 'desktop' | 'cli' | 'library' | 'packages'

export interface NotSite {
  kind: NotSiteKind
  label: string
  reason: string
}

export const NOT_SITE_NOUN: Record<NotSiteKind, string> = {
  extension: 'a browser extension',
  desktop: 'a desktop app',
  cli: 'a command-line tool',
  library: 'a library',
  packages: 'a set of packages',
}

interface Pkg {
  name?: string
  private?: boolean
  bin?: unknown
  main?: string
  module?: string
  exports?: unknown
  types?: string
  typings?: string
  files?: unknown
  peerDependencies?: Record<string, string>
  workspaces?: unknown
}

const EXTENSION_DEPS = ['@crxjs/vite-plugin', 'wxt', 'plasmo', 'vite-plugin-web-extension', '@samrum/vite-plugin-web-extension', 'webextension-polyfill', 'vite-plugin-chrome-extension']
const ELECTRON_DEPS = ['electron', 'electron-vite', 'vite-plugin-electron', 'electron-builder', '@electron-forge/cli']
const TAURI_DEPS = ['@tauri-apps/cli', '@tauri-apps/api']
/** Frameworks whose build is a website even when package.json also looks like a library. */
const SITE_FRAMEWORKS = ['next', 'nuxt', 'astro', '@sveltejs/kit', 'gatsby', '@docusaurus/core', 'vitepress', '@remix-run/react', 'react-scripts', '@angular/core']

const join = (dir: string, file: string) => (dir === '.' ? file : `${dir}/${file}`)

/** What this folder is, when it isn't a website; null for anything that might be one. */
export async function notAWebsite(snap: RepoSnapshot, dir: string, pkgText: string | null, deps: Record<string, string>, monorepo: boolean): Promise<NotSite | null> {
  if (!pkgText) return null
  let pkg: Pkg
  try {
    pkg = JSON.parse(pkgText) as Pkg
  } catch {
    return null
  }
  const paths = snap.files.map((f) => f.path)
  const has = (p: string) => paths.includes(join(dir, p))
  const hasDep = (names: string[]) => names.filter((n) => deps[n])
  const html = ['index.html', 'public/index.html', 'src/index.html'].some(has)

  // browser extension: an extension manifest (manifest_version — a web app manifest has none) or an extension build tool
  for (const m of ['manifest.json', 'public/manifest.json', 'src/manifest.json', 'static/manifest.json']) {
    if (has(m) && /"manifest_version"\s*:/.test((await snap.read(join(dir, m))) ?? '')) return { kind: 'extension', label: 'Browser extension', reason: `${m} is a browser-extension manifest (manifest_version).` }
  }
  const ext = hasDep(EXTENSION_DEPS)
  if (ext.length || ['manifest.config.ts', 'src/manifest.ts', 'wxt.config.ts'].some(has)) return { kind: 'extension', label: 'Browser extension', reason: `Built with ${ext[0] ?? 'an extension manifest'} — a browser extension.` }

  // desktop app
  const electron = hasDep(ELECTRON_DEPS)
  if (electron.length) return { kind: 'desktop', label: 'Electron app', reason: `Uses ${electron[0]} — a desktop app; its pages expect Electron, not a browser.` }
  if (hasDep(TAURI_DEPS).length || paths.some((p) => p.startsWith(join(dir, 'src-tauri/')))) return { kind: 'desktop', label: 'Tauri app', reason: 'A Tauri desktop app; its pages expect Tauri, not a browser.' }

  if (SITE_FRAMEWORKS.some((f) => deps[f])) return null

  // command-line tool: installs a command and has no web page
  if (pkg.bin && !html) return { kind: 'cli', label: 'Command-line tool', reason: 'package.json installs a command ("bin") and there’s no web page.' }

  // library or plugin: published entry points, and no web page to serve
  const published = Boolean(pkg.exports || pkg.types || pkg.typings || pkg.module || pkg.files)
  const viteLib = /\blib\s*:\s*\{/.test((await snap.read(join(dir, 'vite.config.ts'))) ?? (await snap.read(join(dir, 'vite.config.js'))) ?? '')
  const plugin = /^(@[^/]+\/)?(vite|rollup|webpack|eslint|postcss|babel|tailwindcss)-plugin-/.test(pkg.name ?? '') || /-(vite|rollup)-plugin$/.test(pkg.name ?? '')
  if (!html && (published || viteLib || plugin || Object.keys(pkg.peerDependencies ?? {}).length))
    return { kind: 'library', label: plugin ? 'Plugin' : 'Library', reason: `${plugin ? 'A plugin' : 'A library'} for other projects to install (${[published && 'published entry points', viteLib && 'a library build', plugin && 'plugin name', pkg.peerDependencies && 'peer dependencies'].filter(Boolean).join(', ')}), with no web page of its own.` }

  // the root of a monorepo of packages, with no page of its own
  if (dir === '.' && monorepo && !html) return { kind: 'packages', label: 'Monorepo of packages', reason: 'The repo root is a workspace of packages with no web page of its own.' }
  return null
}

/** Folders in a repo that hold a site — docs, a demo, a playground, examples — best first. */
export function siteFolders(snap: RepoSnapshot, except: string): string[] {
  const RANK = ['website', 'docs', 'doc', 'site', 'www', 'web', 'demo', 'demos', 'playground', 'explorer', 'example', 'examples', 'apps']
  const folders = new Set<string>()
  for (const { path } of snap.files) {
    const m = /^((?:website|docs|doc|site|www|web|demo|demos|playground|explorer|example)|(?:examples|apps|demos)\/[^/]+)\/(index\.html|package\.json|mkdocs\.yml|docusaurus\.config\.[jt]s|\.vitepress\/config\.[mc]?[jt]s|hugo\.toml)$/.exec(path)
    if (m && m[1] !== except) folders.add(m[1])
  }
  const rank = (f: string) => {
    const i = RANK.indexOf(f.split('/')[0])
    return i === -1 ? 99 : i
  }
  return [...folders].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 8)
}
