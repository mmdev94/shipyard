import type { PackageManager } from '../workflow.ts'
import type { Detection, RepoSnapshot } from './types.ts'
import { goDeps, goLabel, pyFramework, pyLabel } from './servers.ts'

export interface PackageJson {
  name?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  engines?: { node?: string }
  packageManager?: string
  workspaces?: unknown
}

export function parsePackageJson(text: string | null): PackageJson | null {
  if (!text) return null
  try {
    return JSON.parse(text) as PackageJson
  } catch {
    return null
  }
}

export function allDeps(pkg: PackageJson | null): Record<string, string> {
  return { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
}

const join = (dir: string, file: string) => (dir === '.' ? file : `${dir}/${file}`)

const WEB_DEPS = ['next', 'nuxt', 'vite', 'astro', '@sveltejs/kit', 'gatsby', 'react-scripts', '@docusaurus/core', 'vitepress', '@angular/core', '@11ty/eleventy', '@vue/cli-service', 'parcel', 'express', 'fastify', 'hono', 'koa', '@nestjs/core']
const APP_NAME_RANK = ['web', 'www', 'site', 'website', 'frontend', 'app', 'client', 'docs', 'landing', 'v4', 'dashboard']

function has(snap: RepoSnapshot, path: string): boolean {
  return snap.files.some((f) => f.path === path)
}

function firstExisting(snap: RepoSnapshot, dir: string, names: string[]): string | null {
  for (const n of names) if (has(snap, join(dir, n))) return join(dir, n)
  return null
}

async function readFirst(snap: RepoSnapshot, dir: string, names: string[]): Promise<string | null> {
  const p = firstExisting(snap, dir, names)
  return p ? snap.read(p) : null
}

function hasLockfile(snap: RepoSnapshot, dir: string): boolean {
  const names = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'package-lock.json']
  return (dir === '.' ? ['.'] : [dir, '.']).some((d) => names.some((n) => has(snap, join(d, n))))
}

function detectPackageManager(snap: RepoSnapshot, dir: string): PackageManager {
  const lockDirs = dir === '.' ? ['.'] : [dir, '.']
  for (const d of lockDirs) {
    if (has(snap, join(d, 'pnpm-lock.yaml'))) return 'pnpm'
    if (has(snap, join(d, 'yarn.lock'))) return 'yarn'
    if (has(snap, join(d, 'bun.lockb')) || has(snap, join(d, 'bun.lock'))) return 'bun'
    if (has(snap, join(d, 'package-lock.json'))) return 'npm'
  }
  return 'npm'
}

export function runScript(pm: PackageManager, script: string): string {
  if (pm === 'yarn') return `yarn ${script}`
  if (pm === 'bun') return `bun run ${script}`
  if (pm === 'pnpm') return `pnpm run ${script}`
  return `npm run ${script}`
}

async function detectNodeVersion(snap: RepoSnapshot, dir: string, pkg: PackageJson | null): Promise<string> {
  const file = await readFirst(snap, dir, ['.nvmrc', '.node-version'])
  const raw = file?.trim() || pkg?.engines?.node || ''
  const major = raw.match(/(\d{2})/)?.[1]
  const n = major ? Number(major) : 22
  return String(n >= 18 && n <= 26 ? n : 22)
}

const CONFIG = (base: string) => ['ts', 'mts', 'js', 'mjs', 'cjs'].map((e) => `${base}.${e}`)
const capture = (text: string | null, re: RegExp) => (text ? text.match(re)?.[1]?.replace(/^\.\//, '') : undefined)

const SERVER_DEPS = ['express', 'fastify', 'koa', 'hono', '@nestjs/core', '@hapi/hapi', 'restify', 'polka', 'h3']
const PY_SERVERS = ['flask', 'fastapi', 'django', 'streamlit', 'gradio', 'uvicorn', 'gunicorn', 'starlette', 'aiohttp', 'sanic']

/** Folders below the root that look like a deployable web app (monorepo apps, frontend/ folders). */
async function listApps(snap: RepoSnapshot): Promise<string[]> {
  const dirs = snap.files
    .map((f) => f.path)
    .filter((p) => /^(apps\/[^/]+|[^/]+)\/package\.json$/.test(p) && !/^(node_modules|packages|examples?|templates?|fixtures?|tests?)\//.test(p))
    .map((p) => p.replace(/\/package\.json$/, ''))
    .slice(0, 16)
  const found: string[] = []
  await Promise.all(
    dirs.map(async (d) => {
      const pkg = parsePackageJson(await snap.read(`${d}/package.json`))
      const deps = allDeps(pkg)
      if ((pkg?.scripts?.build || pkg?.scripts?.start) && WEB_DEPS.some((w) => deps[w])) found.push(d)
    }),
  )
  const rank = (d: string) => {
    const i = APP_NAME_RANK.indexOf(d.split('/').pop() ?? '')
    return i === -1 ? 99 : i
  }
  return found.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

async function isMonorepo(snap: RepoSnapshot): Promise<boolean> {
  if (['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json'].some((f) => has(snap, f))) return true
  return Boolean(parsePackageJson(await snap.read('package.json'))?.workspaces)
}

/** Pick the folder the app lives in, and list the other candidates so the UI can offer a choice. */
async function findAppDir(snap: RepoSnapshot): Promise<{ dir: string; apps: string[] }> {
  const rootHasApp = has(snap, 'index.html') || has(snap, 'package.json')
  if (rootHasApp && !(await isMonorepo(snap))) return { dir: '.', apps: [] }
  const apps = await listApps(snap)
  if (apps.length) return { dir: apps[0], apps }
  return { dir: '.', apps: [] }
}

export async function detect(snap: RepoSnapshot, opts: { appDir?: string } = {}): Promise<Detection> {
  const found = await findAppDir(snap)
  const dir = opts.appDir ?? found.dir
  const apps = found.apps
  const reasons: string[] = []
  if (dir !== '.') reasons.push(`Found the app in \`${dir}/\` (monorepo).`)

  const pkgPath = join(dir, 'package.json')
  const pkg = has(snap, pkgPath) ? parsePackageJson(await snap.read(pkgPath)) : null
  const deps = allDeps(pkg)
  const pm = pkg ? detectPackageManager(snap, dir) : 'none'
  const nodeVersion = await detectNodeVersion(snap, dir, pkg)
  const build = pkg?.scripts?.build ? runScript(pm, 'build') : ''

  const packageManagerPinned = Boolean(pkg?.packageManager?.startsWith(`${pm}@`))
  const base = { packageManager: pm as PackageManager, packageManagerPinned, hasLockfile: pkg ? hasLockfile(snap, dir) : false, nodeVersion, workingDir: dir, reasons, workflowSupported: true, apps }
  const staticResult = (framework: string, label: string, outputDir: string, buildCommand = build) => ({
    ...base,
    framework,
    frameworkLabel: label,
    mode: 'static' as const,
    buildCommand,
    outputDir,
  })
  const dynamicResult = (framework: string, label: string, workflowSupported = true) => ({
    ...base,
    framework,
    frameworkLabel: label,
    mode: 'dynamic' as const,
    buildCommand: '',
    outputDir: '.',
    workflowSupported,
  })

  // Non-Node stacks first: they decide dynamic regardless of any package.json.
  const dockerfile = has(snap, join(dir, 'Dockerfile'))
  const pyReq = (await readFirst(snap, dir, ['requirements.txt', 'pyproject.toml', 'Pipfile'])) ?? ''
  const pyServer = PY_SERVERS.find((p) => new RegExp(`(^|[\\s"'\\[])${p}([\\s=<>~!\\[;"']|$)`, 'im').test(pyReq))
  if (pyServer && !pkg) {
    const fw = pyFramework(pyReq)
    reasons.push(`Python web app (${fw ? pyLabel(fw) : pyServer}) found — ms.computer builds it into a server container.`)
    return dynamicResult(`python-${fw ?? pyServer}`, fw ? pyLabel(fw) : `Python · ${pyServer}`)
  }
  if (has(snap, join(dir, 'go.mod')) && !pkg) {
    const label = goLabel(goDeps((await snap.read(join(dir, 'go.mod'))) ?? ''))
    reasons.push(`Go module found (${label}) — ms.computer builds it into a server container.`)
    return dynamicResult('go', label)
  }

  if (pkg) {
    if (deps.next) {
      const cfg = await readFirst(snap, dir, CONFIG('next.config'))
      if (cfg && /output\s*:\s*['"`]export['"`]/.test(cfg)) {
        reasons.push('Next.js with `output: "export"` produces a static site in `out/`.')
        return staticResult('next-export', 'Next.js (static export)', 'out')
      }
      reasons.push('Next.js without `output: "export"` needs a running server.')
      return dynamicResult('next', 'Next.js (server)')
    }
    if (deps.nuxt) {
      if (pkg.scripts?.generate) {
        reasons.push('Nuxt with a `generate` script produces a static site.')
        return staticResult('nuxt-generate', 'Nuxt (generated)', '.output/public', runScript(pm, 'generate'))
      }
      reasons.push('Nuxt without `generate` runs as a server.')
      return dynamicResult('nuxt', 'Nuxt (server)')
    }
    if (Object.keys(deps).some((d) => d.startsWith('@remix-run/') || d === '@react-router/node')) {
      reasons.push('Remix / React Router framework mode runs as a server.')
      return dynamicResult('remix', 'Remix (server)')
    }
    if (deps['@sveltejs/kit']) {
      const cfg = await readFirst(snap, dir, ['svelte.config.js', 'svelte.config.mjs', 'svelte.config.ts'])
      if (cfg && /adapter-static/.test(cfg)) {
        const out = capture(cfg, /pages\s*:\s*['"`]([^'"`]+)['"`]/) ?? 'build'
        reasons.push('SvelteKit with `adapter-static` produces a static site.')
        return staticResult('sveltekit-static', 'SvelteKit (static)', out)
      }
      reasons.push('SvelteKit without `adapter-static` runs as a server.')
      return dynamicResult('sveltekit', 'SvelteKit (server)')
    }
    if (deps.astro) {
      const cfg = await readFirst(snap, dir, CONFIG('astro.config'))
      if (cfg && (/output\s*:\s*['"`](server|hybrid)['"`]/.test(cfg) || /adapter\s*:/.test(cfg))) {
        reasons.push('Astro with a server adapter runs as a server.')
        return dynamicResult('astro-server', 'Astro (server)')
      }
      const out = capture(cfg, /outDir\s*:\s*['"`]([^'"`]+)['"`]/) ?? 'dist'
      reasons.push('Astro builds a static site by default.')
      return staticResult('astro', 'Astro', out)
    }
    if (deps.gatsby) return staticResult('gatsby', 'Gatsby', 'public')
    if (deps['@docusaurus/core']) return staticResult('docusaurus', 'Docusaurus', 'build')
    if (deps.vitepress) {
      const script = Object.values(pkg.scripts ?? {}).find((s) => /vitepress build/.test(s)) ?? ''
      const src = script.match(/vitepress build\s+([^\s&;]+)/)?.[1] ?? '.'
      const buildCmd = pkg.scripts?.build ? build : runScript(pm, Object.entries(pkg.scripts ?? {}).find(([, s]) => /vitepress build/.test(s))?.[0] ?? 'build')
      return staticResult('vitepress', 'VitePress', `${src === '.' ? '' : `${src}/`}.vitepress/dist`, buildCmd)
    }
    if (deps['@11ty/eleventy']) return staticResult('eleventy', 'Eleventy', '_site')
    if (deps['@angular/core']) {
      const ng = await snap.read(join(dir, 'angular.json'))
      let out = 'dist'
      try {
        const j = JSON.parse(ng ?? '{}') as { projects?: Record<string, { architect?: { build?: { builder?: string; options?: { outputPath?: string | { base?: string } } } } }> }
        const proj = Object.values(j.projects ?? {})[0]
        const b = proj?.architect?.build
        const op = b?.options?.outputPath
        const basePath = typeof op === 'string' ? op : op?.base
        if (basePath) out = basePath
        if (b?.builder && /:application$/.test(b.builder)) out = `${out}/browser`
      } catch {
        /* keep default */
      }
      return staticResult('angular', 'Angular', out)
    }
    if (deps['react-scripts']) return staticResult('cra', 'Create React App', 'build')
    if (deps['@vue/cli-service']) return staticResult('vue-cli', 'Vue CLI', 'dist')
    if (deps.vite) {
      const cfg = await readFirst(snap, dir, CONFIG('vite.config'))
      const out = capture(cfg, /outDir\s*:\s*['"`]([^'"`]+)['"`]/) ?? 'dist'
      const label = deps.react ? 'Vite + React' : deps.vue ? 'Vite + Vue' : deps.svelte ? 'Vite + Svelte' : deps['solid-js'] ? 'Vite + Solid' : 'Vite'
      reasons.push(`${label} builds a static site into \`${out}/\`.`)
      return staticResult('vite', label, out)
    }
    if (deps.parcel) return staticResult('parcel', 'Parcel', 'dist')
    const server = SERVER_DEPS.find((d) => deps[d])
    if (server) {
      reasons.push(`Node web server (\`${server}\`) found.`)
      return dynamicResult(`node-${server}`, `Node · ${server}`)
    }
    if (pkg.scripts?.start && !pkg.scripts?.build) {
      reasons.push('A `start` script with no build step looks like a server.')
      return dynamicResult('node', 'Node app')
    }
  }

  if (dockerfile) {
    reasons.push('A Dockerfile is present, so it runs as a container.')
    return dynamicResult('docker', 'Docker container')
  }

  // Static generators that need a non-Node toolchain.
  if (has(snap, join(dir, 'hugo.toml')) || (has(snap, join(dir, 'config.toml')) && snap.files.some((f) => f.path.startsWith(join(dir, 'content/'))))) {
    reasons.push('Hugo site — it needs Hugo installed to build.')
    return { ...staticResult('hugo', 'Hugo', 'public', 'hugo --minify'), workflowSupported: false }
  }
  if (has(snap, join(dir, '_config.yml')) && has(snap, join(dir, 'Gemfile'))) {
    reasons.push('Jekyll site — it needs Ruby to build.')
    return { ...staticResult('jekyll', 'Jekyll', '_site', 'bundle exec jekyll build'), workflowSupported: false }
  }

  if (has(snap, join(dir, 'index.html'))) {
    reasons.push('Plain HTML — no build step, deployed as-is.')
    return { ...staticResult('html', 'Plain HTML', '.', ''), packageManager: pkg ? pm : 'none' }
  }

  if (pkg?.scripts?.build) {
    reasons.push("Has a build script but no framework we recognise — check the output folder.")
    return staticResult('node-build', 'Node build', 'dist')
  }

  reasons.push("Couldn't find an index.html or a known framework.")
  return { ...staticResult('unknown', 'Unknown', '.', ''), workflowSupported: false }
}
