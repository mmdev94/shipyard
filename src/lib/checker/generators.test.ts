import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSnapshot } from './index.ts'
import { configFromReport } from '../github/copy.ts'
import { generateWorkflow } from '../workflow.ts'
import { moveFix, movePlan } from '../move.ts'
import type { RepoSnapshot } from './types.ts'

function repo(files: Record<string, string>, extra: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return { owner: 'me', repo: 'blog', branch: 'main', files: Object.entries(files).map(([path, t]) => ({ path, size: Math.max(1, t.length) })), truncated: false, read: async (p) => files[p] ?? null, ...extra }
}
const wf = async (files: Record<string, string>) => {
  const r = await checkSnapshot(repo(files))
  return { r, y: generateWorkflow(configFromReport(r)) }
}

test('Jekyll with a Gemfile: Ruby, the gems (Linux added to a Mac lockfile), built for the root', async () => {
  const { r, y } = await wf({ Gemfile: 'source "https://rubygems.org"\ngem "jekyll", "~> 4.3"\n', '_config.yml': 'title: Blog\nbaseurl: "/blog"\n', 'index.md': '---\n---\nhi', '_posts/2026-01-01-a.md': 'x' })
  assert.equal(r.detection.framework, 'jekyll')
  assert.equal(r.verdict.kind, 'static')
  assert.equal(r.detection.outputDir, '_site')
  assert.match(y, /uses: ruby\/setup-ruby@v1\n {8}with:\n {10}ruby-version: '3\.3'/)
  assert.match(y, /bundle lock --add-platform x86_64-linux \|\| true\) && bundle install && PAGES_REPO_NWO="\$GITHUB_REPOSITORY" JEKYLL_ENV=production bundle exec jekyll build --baseurl ""/)
  assert.doesNotMatch(y, /setup-node/, 'no Node for a Ruby site')
})

test('Jekyll as GitHub Pages builds it (no Gemfile): the github-pages gem', async () => {
  const { r, y } = await wf({ '_config.yml': 'theme: minima\n', 'index.md': '# Home', 'about.md': '# About' })
  assert.equal(r.detection.frameworkLabel, 'Jekyll (GitHub Pages)')
  assert.equal(r.verdict.kind, 'static')
  assert.match(y, /gem "github-pages", group: :jekyll_plugins/)
  // a Jupyter Book also has _config.yml — not Jekyll
  const jb = await checkSnapshot(repo({ '_config.yml': 'title: Book', '_toc.yml': 'format: jb-book', 'intro.md': '# Hi' }))
  assert.notEqual(jb.detection.framework, 'jekyll')
})

test('Hugo: the version the repo already uses, extended, theme submodules, built for the root', async () => {
  const { r, y } = await wf({ 'hugo.toml': 'baseURL = "https://me.github.io/blog/"\ntitle = "Blog"\n', 'content/_index.md': 'hi', '.gitmodules': '[submodule "themes/x"]', 'netlify.toml': '[build.environment]\n  HUGO_VERSION = "0.140.2"\n', 'go.mod': 'module x' })
  assert.equal(r.detection.framework, 'hugo', 'a go.mod (Hugo modules) doesn’t make it a Go server')
  assert.equal(r.verdict.kind, 'static')
  assert.match(y, /uses: peaceiris\/actions-hugo@v3\n {8}with:\n {10}hugo-version: '0\.140\.2'\n {10}extended: true/)
  assert.match(y, /submodules: recursive/)
  assert.match(y, /hugo --minify --baseURL \//)
  const old = await checkSnapshot(repo({ 'config.toml': 'baseurl = "https://x.org/"\n', 'content/a.md': 'x', 'layouts/index.html': 'x' }))
  assert.equal(old.detection.framework, 'hugo', 'old-style config.toml')
})

test('Zola is not mistaken for Hugo (base_url vs baseURL)', async () => {
  const { r, y } = await wf({ 'config.toml': 'base_url = "https://me.github.io"\ntitle = "x"\n', 'content/_index.md': '+++\n+++', 'templates/index.html': 'x' })
  assert.equal(r.detection.framework, 'zola')
  assert.match(y, /uses: taiki-e\/install-action@v2\n {8}with:\n {10}tool: zola/)
  assert.match(y, /zola build --base-url \//)
})

test('MkDocs: Python, its requirements (or Material from the theme), site/', async () => {
  const { r, y } = await wf({ 'mkdocs.yml': 'site_name: Docs\ntheme:\n  name: material\n', 'docs/index.md': '# Docs' })
  assert.equal(r.detection.frameworkLabel, 'MkDocs (Material)')
  assert.equal(r.detection.outputDir, 'site')
  assert.match(y, /uses: actions\/setup-python@v7/)
  assert.match(y, /pip install mkdocs-material && mkdocs build/)
  const req = await checkSnapshot(repo({ 'mkdocs.yml': 'site_name: Docs\nsite_dir: build\n', 'docs/requirements.txt': 'mkdocs\nmkdocs-redirects\n', 'docs/index.md': '#' }))
  assert.equal(req.detection.buildCommand, "pip install -r 'docs/requirements.txt' && mkdocs build")
  assert.equal(req.detection.outputDir, 'build')
})

test('honest verdicts: a library is not "Ready"', async () => {
  const lib = await checkSnapshot(repo({ 'pyproject.toml': '[project]\nname = "fastapi-limiter"\ndependencies = ["fastapi"]\n', 'fastapi_limiter/__init__.py': 'x', 'README.md': '# lib' }))
  assert.equal(lib.verdict.kind, 'fix', 'a FastAPI library: nothing to start')
  assert.equal(lib.findings.find((f) => f.id === 'start')?.title, 'No FastAPI app to start')
  const plainLib = await checkSnapshot(repo({ 'setup.py': 'setup(name="x")', 'x/__init__.py': 'x' }))
  assert.equal(plainLib.verdict.title, 'No website found here')
  const site = await checkSnapshot(repo({ 'index.html': '<h1>hi</h1>' }))
  assert.equal(site.verdict.kind, 'static')
})

test('Move: a Jekyll site GitHub Pages builds from a branch (no workflow file) gets a working move', async () => {
  const files = { '_config.yml': 'title: Blog\nbaseurl: /blog\n', 'index.md': '# Home', '_posts/2026-01-01-a.md': 'x' }
  const r = await checkSnapshot(repo(files, { hasPages: true }))
  assert.equal(r.host?.host, 'github-pages')
  assert.deepEqual(r.host?.sources, ['GitHub Pages settings'])
  const plan = movePlan(r, 'static')
  assert.equal(plan.find((i) => i.what === 'Site path')?.status, 'changed')
  assert.equal(plan.find((i) => i.what === 'Jekyll build')?.status, 'kept')
  const changes = await moveFix(r, 'static').build(async (p) => (files as Record<string, string>)[p] ?? null)
  assert.deepEqual(changes.map((c) => c.path), ['.github/workflows/ms-computer.yml'])
  assert.match(changes[0].after!, /setup-ruby[\s\S]*github-pages[\s\S]*jekyll build --baseurl ""/)
})
