// Static site generators that need their own toolchain: Jekyll (Ruby),
// Hugo, MkDocs (Python) and Zola. Detected from their config files; the
// deploy workflow installs the tool and builds the site for the root of its
// ms.computer address (a GitHub Pages project site lives under /<repo>/).
import type { RepoSnapshot } from './types.ts'
import type { SiteTool } from '../workflowConfig.ts'

export interface Generator {
  tool: SiteTool
  framework: string
  label: string
  buildCommand: string
  outputDir: string
  /** version to install, when the repo says */
  toolVersion?: string
  /** themes as git submodules */
  submodules: boolean
  reasons: string[]
}

const join = (dir: string, file: string) => (dir === '.' ? file : `${dir}/${file}`)
const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

/** The generator this folder is set up for, if any. Checked before Node, Python and Go: their config files are specific. */
export async function detectGenerator(snap: RepoSnapshot, dir: string): Promise<Generator | null> {
  const paths = snap.files.map((f) => f.path)
  const has = (p: string) => paths.includes(join(dir, p))
  const hasDir = (d: string) => paths.some((p) => p.startsWith(`${join(dir, d)}/`))
  const read = (p: string) => snap.read(join(dir, p))
  const submodules = paths.includes('.gitmodules')
  const base = dir === '.' ? '' : `${dir}/`

  // MkDocs
  const mkdocs = ['mkdocs.yml', 'mkdocs.yaml'].find(has)
  if (mkdocs) {
    const cfg = (await read(mkdocs)) ?? ''
    const out = /^site_dir\s*:\s*['"]?([^'"\n#]+)/m.exec(cfg)?.[1]?.trim() ?? 'site'
    const req = ['requirements.txt', 'docs/requirements.txt', 'requirements-docs.txt', 'docs-requirements.txt'].find(has)
    const material = /^\s*name\s*:\s*['"]?material\b/m.test(cfg) || /^theme\s*:\s*['"]?material\b/m.test(cfg)
    const install = req ? `pip install -r ${q(req)}` : `pip install ${material ? 'mkdocs-material' : 'mkdocs'}`
    return {
      tool: 'mkdocs',
      framework: 'mkdocs',
      label: material ? 'MkDocs (Material)' : 'MkDocs',
      buildCommand: `${install} && mkdocs build`,
      outputDir: out,
      submodules,
      reasons: [`MkDocs site (${mkdocs}) — the workflow installs ${req ? `${req}` : material ? 'mkdocs-material' : 'MkDocs'} with Python and builds it.`],
    }
  }

  // Hugo (baseURL) vs Zola (base_url) — both can use config.toml
  const hugoCfg = ['hugo.toml', 'hugo.yaml', 'hugo.yml', 'hugo.json', 'config/_default/hugo.toml', 'config/_default/config.toml'].find(has)
  const plainCfg = ['config.toml', 'config.yaml', 'config.yml'].find(has)
  const plainText = plainCfg ? ((await read(plainCfg)) ?? '') : ''
  const siteDirs = hasDir('content') || hasDir('layouts') || hasDir('themes') || hasDir('archetypes') || hasDir('templates')
  const isZola = plainCfg === 'config.toml' && /^\s*base_url\s*=/m.test(plainText) && (hasDir('templates') || hasDir('content') || hasDir('themes'))
  if (isZola) {
    const out = /^\s*output_dir\s*=\s*['"]([^'"]+)['"]/m.exec(plainText)?.[1] ?? 'public'
    return {
      tool: 'zola',
      framework: 'zola',
      label: 'Zola',
      buildCommand: 'zola build --base-url /',
      outputDir: out,
      submodules,
      reasons: ['Zola site (config.toml with base_url) — the workflow installs Zola and builds it for the site root.'],
    }
  }
  if (hugoCfg || (plainCfg && /^\s*(baseurl|baseURL)\s*[=:]/m.test(plainText) && siteDirs)) {
    const cfgText = hugoCfg ? ((await read(hugoCfg)) ?? '') : plainText
    const out = /^\s*publishDir\s*[=:]\s*['"]?([^'"\n]+)/m.exec(cfgText)?.[1]?.trim() ?? 'public'
    // the version the repo already builds with: Netlify's HUGO_VERSION, or a deploy workflow's
    const hints = [await snap.read('netlify.toml'), ...(await Promise.all(paths.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) && !/ms-computer/.test(p)).map((p) => snap.read(p))))].join('\n')
    const toolVersion = /HUGO_VERSION\s*[=:]\s*['"]?v?(\d+\.\d+\.\d+)/.exec(hints)?.[1] ?? /hugo-version\s*:\s*['"]?v?(\d+\.\d+\.\d+)/.exec(hints)?.[1]
    return {
      tool: 'hugo',
      framework: 'hugo',
      label: 'Hugo',
      buildCommand: 'hugo --minify --baseURL /',
      outputDir: out,
      toolVersion,
      submodules,
      reasons: [`Hugo site — the workflow installs Hugo${toolVersion ? ` ${toolVersion}` : ' (extended)'} and builds it for the site root${submodules ? ', with the theme submodules' : ''}.`],
    }
  }

  // Jekyll: _config.yml plus a Gemfile that uses it, or the usual Jekyll folders
  // (GitHub Pages builds those without a Gemfile). Jupyter Book also has _config.yml.
  if (has('_config.yml') && !has('_toc.yml')) {
    const gemfile = has('Gemfile') ? ((await read('Gemfile')) ?? '') : null
    const cfg = (await read('_config.yml')) ?? ''
    // site content, not repo paperwork: a README, licence or changelog isn't a page
    const PAPERWORK = /^(readme|changelog|changes|history|license|licence|contributing|code_of_conduct|security|support|authors|notice)\.(md|markdown)$/i
    const pages = paths.some((p) => p.startsWith(base) && /\.(md|markdown|html)$/.test(p) && !p.slice(base.length).includes('/') && !PAPERWORK.test(p.slice(base.length)))
    const strong = hasDir('_posts') || hasDir('_layouts') || hasDir('_includes') || hasDir('_sass') || pages
    // a theme line alone is what GitHub adds to show a README as a page — in a repo that's an app, the app wins
    const app = ['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml'].some(has)
    const jekyllish = strong || (/^\s*(theme|remote_theme)\s*:/m.test(cfg) && !app)
    if (gemfile !== null && /\b(jekyll|github-pages)\b/.test(gemfile)) {
      return {
        tool: 'jekyll',
        framework: 'jekyll',
        label: 'Jekyll',
        // a Gemfile.lock made on a Mac lists only macOS platforms; add Linux so bundler accepts it
        buildCommand: '(bundle lock --add-platform x86_64-linux || true) && bundle install && PAGES_REPO_NWO="$GITHUB_REPOSITORY" JEKYLL_ENV=production bundle exec jekyll build --baseurl ""',
        outputDir: '_site',
        submodules,
        reasons: ['Jekyll site with a Gemfile — the workflow installs Ruby and its gems and builds it for the site root.'],
      }
    }
    if (gemfile === null && jekyllish) {
      return {
        tool: 'jekyll-pages',
        framework: 'jekyll',
        label: 'Jekyll (GitHub Pages)',
        // what GitHub Pages builds with: the github-pages gem, its plugins and themes
        buildCommand: `printf 'source "https://rubygems.org"\\ngem "github-pages", group: :jekyll_plugins\\n' > Gemfile && bundle install && PAGES_REPO_NWO="$GITHUB_REPOSITORY" JEKYLL_ENV=production bundle exec jekyll build --baseurl ""`,
        outputDir: '_site',
        submodules,
        reasons: ['Jekyll site without a Gemfile, as GitHub Pages builds them — the workflow builds it with the same github-pages gem, for the site root.'],
      }
    }
  }
  return null
}
