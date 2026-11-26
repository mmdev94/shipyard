// Python and Go servers: how ms.computer will start them, and whether that works.
//
// ms.computer plans dynamic apps with Railpack (0.37 in CLI 0.2.6). Measured
// with the real CLI on small apps:
//   - FastAPI is started with `uvicorn main:app`, Flask with `gunicorn main:app`
//     — always `main:app`, wherever the app object really is. An app in app.py
//     builds fine and then fails the health check.
//   - Flask without gunicorn in its dependencies, Streamlit, and plain scripts
//     are refused at planning ("no bounded evidence of an HTTP service").
//   - A Procfile `web:` line (or railpack.json deploy.startCommand) overrides
//     the guess and is used as is.
//   - Go: the main package at the root or a single cmd/<name> is built and run;
//     the code has to visibly serve HTTP.

export type PyFramework = 'flask' | 'fastapi' | 'starlette' | 'quart' | 'django' | 'streamlit' | 'gradio'

/** The order matters: the first match names the app. */
const PY_FRAMEWORKS: PyFramework[] = ['fastapi', 'flask', 'django', 'streamlit', 'gradio', 'starlette', 'quart']
const PY_LABEL: Record<PyFramework, string> = {
  flask: 'Flask',
  fastapi: 'FastAPI',
  starlette: 'Starlette',
  quart: 'Quart',
  django: 'Django',
  streamlit: 'Streamlit',
  gradio: 'Gradio',
}

/** Is `name` a dependency in requirements.txt / pyproject.toml / Pipfile text? */
export function pyDep(req: string, name: string): boolean {
  return new RegExp(`(^|[\\s"'\\[,])${name.replace(/[.-]/g, '[.-_]?')}(\\[[^\\]]*\\])?([\\s=<>~!;,"']|$)`, 'im').test(req)
}

export function pyFramework(req: string): PyFramework | null {
  return PY_FRAMEWORKS.find((f) => pyDep(req, f)) ?? null
}

export const pyLabel = (f: PyFramework) => PY_LABEL[f]

/** WSGI apps need gunicorn, ASGI apps uvicorn. */
export function serverFor(f: PyFramework): 'gunicorn' | 'uvicorn' | null {
  if (f === 'flask' || f === 'django') return 'gunicorn'
  if (f === 'fastapi' || f === 'starlette' || f === 'quart') return 'uvicorn'
  return null
}

export interface PyEntry {
  /** file the app object is created in, relative to the repo */
  path: string
  /** import path, e.g. "app" or "src.server" */
  module: string
  /** the variable, e.g. "app" */
  variable: string
}

const APP_OBJECT = /^(\w+)\s*(?::\s*[\w.]+\s*)?=\s*(?:flask\.|fastapi\.)?(Flask|FastAPI|Starlette|Quart)\(/m

/** Finds `app = Flask(...)` / `app = FastAPI()` — preferring main.py, app.py, then the shallowest file. */
export function findPyEntry(files: { path: string; text: string }[], dir: string): PyEntry | null {
  const base = dir === '.' ? '' : `${dir}/`
  const rank = (p: string) => {
    const rel = p.slice(base.length)
    return (rel === 'main.py' ? 0 : rel === 'app.py' ? 1 : 2) * 100 + rel.split('/').length
  }
  const hits = files
    .filter((f) => f.path.endsWith('.py') && f.path.startsWith(base) && !/(^|\/)(tests?|venv|\.venv|site-packages)\//.test(f.path))
    .map((f) => ({ f, m: APP_OBJECT.exec(f.text) }))
    .filter((x) => x.m)
    .sort((a, b) => rank(a.f.path) - rank(b.f.path))
  const hit = hits[0]
  if (!hit) return null
  const rel = hit.f.path.slice(base.length).replace(/\.py$/, '')
  return { path: hit.f.path, module: rel.replace(/\/__init__$/, '').replace(/\//g, '.'), variable: hit.m![1] }
}

/** The `web:` command from a Procfile, if any. */
export function procfileWeb(procfile: string | null): string | null {
  const m = /^web:\s*(.+)$/m.exec(procfile ?? '')
  return m ? m[1].trim() : null
}

/** What ms.computer runs when nothing says otherwise (null: it refuses to plan). */
export function guessedPyStart(f: PyFramework, req: string): string | null {
  if (f === 'fastapi' && pyDep(req, 'uvicorn')) return 'uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}'
  if (f === 'flask' && pyDep(req, 'gunicorn')) return 'gunicorn --bind 0.0.0.0:${PORT:-8000} main:app'
  return null
}

/** The start command Shipyard would put in a Procfile for this app. */
export function pyStartCommand(f: PyFramework, entry: PyEntry): string | null {
  const target = `${entry.module}:${entry.variable}`
  const server = serverFor(f)
  if (server === 'gunicorn') return `gunicorn --bind 0.0.0.0:$PORT ${target}`
  if (server === 'uvicorn') return `uvicorn ${target} --host 0.0.0.0 --port $PORT`
  return null
}

/**
 * Does a start command listen where ms.computer expects — on $PORT, on all
 * interfaces? gunicorn binds 0.0.0.0:$PORT by itself when PORT is set;
 * uvicorn defaults to 127.0.0.1, so it needs --host 0.0.0.0.
 */
export function bindsPort(cmd: string): boolean {
  if (/\b(127\.0\.0\.1|localhost)\b/.test(cmd)) return false
  if (/^gunicorn\b/.test(cmd)) return !/(--bind|-b)\s/.test(cmd) || /\$\{?PORT\b/.test(cmd)
  if (/^uvicorn\b/.test(cmd)) return /--host\s+(0\.0\.0\.0|::)/.test(cmd) && /\$\{?PORT\b/.test(cmd)
  return /\$\{?PORT\b/.test(cmd)
}

// ── Go ────────────────────────────────────────────────────────────────────────

/** go.mod requirement lines, e.g. "github.com/gin-gonic/gin". */
export function goDeps(gomod: string): string[] {
  return [...gomod.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/[^\s]+)\s+v[\d.]+/gm)].map((m) => m[1])
}

export const goHas = (deps: string[], prefixes: string[]) => prefixes.filter((p) => deps.some((d) => d === p || d.startsWith(`${p}/`)))

const GO_WEB: [string, string][] = [
  ['github.com/gin-gonic/gin', 'Gin'],
  ['github.com/labstack/echo', 'Echo'],
  ['github.com/gofiber/fiber', 'Fiber'],
  ['github.com/go-chi/chi', 'chi'],
  ['github.com/gorilla/mux', 'Gorilla'],
]

export function goLabel(deps: string[]): string {
  const hit = GO_WEB.find(([p]) => goHas(deps, [p]).length)
  return hit ? `Go · ${hit[1]}` : 'Go server'
}

/** Folders holding a `main` package: "." for the root, else e.g. "cmd/server". */
export function goMains(paths: string[], dir: string, isMain: (path: string) => boolean): string[] {
  const base = dir === '.' ? '' : `${dir}/`
  const dirs = new Set<string>()
  for (const p of paths) {
    if (!p.startsWith(base) || !p.endsWith('.go') || p.endsWith('_test.go')) continue
    const rel = p.slice(base.length)
    const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.'
    if ((folder === '.' || /^cmd\/[^/]+$/.test(folder)) && isMain(p)) dirs.add(folder)
  }
  return [...dirs].sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)))
}

/** Go code that starts an HTTP server — plus each framework's own call (Gin's r.Run() reads $PORT itself). */
export function goServes(deps: string[]): RegExp {
  const parts = ['http\\.ListenAndServe(TLS)?\\(', '\\.ListenAndServe\\(\\)', 'http\\.Serve\\(', '\\b\\w+\\.(Run|Start|Listen)\\(\\s*("|":"|fmt\\.Sprintf|addr|port|":"\\s*\\+)']
  if (goHas(deps, ['github.com/gin-gonic/gin']).length) parts.push('\\b\\w+\\.Run\\(')
  if (goHas(deps, ['github.com/labstack/echo']).length) parts.push('\\b\\w+\\.Start\\(')
  if (goHas(deps, ['github.com/gofiber/fiber']).length) parts.push('\\b\\w+\\.Listen\\(')
  return new RegExp(parts.join('|'))
}

/**
 * A fixed public port in Go server code: ListenAndServe(":8080", …), r.Run(":8080"),
 * e.Start(":1323"), app.Listen(":3000"). localhost-only listeners (a pprof
 * sidecar on localhost:6060) aren't the web server and are left alone.
 */
export const GO_FIXED_PORT = /(?:http\.ListenAndServe(?:TLS)?|\.(?:Run|Start|Listen))\(\s*"(?:0\.0\.0\.0)?:(\d{2,5})"/

/** Rewrites fixed ports in a Go file to read $PORT (keeping the old port as the local fallback). */
export function goPort(src: string): string {
  // only the first public listener: two servers can't both take $PORT
  const m = GO_FIXED_PORT.exec(src)
  if (!m) return src
  const port = m[1]
  const out = src.slice(0, m.index) + m[0].replace(/"(?:0\.0\.0\.0)?:\d{2,5}"/, '":"+envPort()') + src.slice(m.index + m[0].length)
  if (/\bfunc envPort\(/.test(src)) return out
  let res = out
  if (!/^\s*"os"\s*$/m.test(res) && !/^import\s+"os"/m.test(res)) {
    if (/^import \(\n/m.test(res)) res = res.replace(/^import \(\n/m, 'import (\n\t"os"\n')
    else if (/^import\s+"[^"]+"/m.test(res)) res = res.replace(/^import\s+("[^"]+")/m, 'import (\n\t"os"\n\t$1\n)')
    else res = res.replace(/^(package \w+\n)/m, '$1\nimport "os"\n')
  }
  return `${res.replace(/\s*$/, '')}\n\n// envPort is the port ms.computer gives the app in $PORT (${port} when run locally).\nfunc envPort() string {\n\tif p := os.Getenv("PORT"); p != "" {\n\t\treturn p\n\t}\n\treturn "${port}"\n}\n`
}
