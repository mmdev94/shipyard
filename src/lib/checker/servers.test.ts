import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSnapshot } from './index.ts'
import { bindsPort, findPyEntry, goDeps, goLabel, goMains, goPort, guessedPyStart, procfileWeb, pyDep, pyFramework, pyStartCommand } from './servers.ts'
import { availableFixes, procfileWith, requirementWith } from '../fixes.ts'
import type { RepoSnapshot } from './types.ts'

function repo(files: Record<string, string>): RepoSnapshot {
  return { owner: 'me', repo: 'api', branch: 'main', files: Object.entries(files).map(([path, t]) => ({ path, size: Math.max(1, t.length) })), truncated: false, read: async (p) => files[p] ?? null }
}
const find = (r: { findings: { id: string }[] }, id: string) => r.findings.find((f) => f.id === id) as { severity: string; title: string; data?: Record<string, string> } | undefined
const FLASK = 'from flask import Flask\napp = Flask(__name__)\n\n@app.get("/")\ndef hi():\n    return "hi"\n'
const FASTAPI = 'from fastapi import FastAPI\n\napi = FastAPI()\n'

test('requirements are read the way pip reads them', () => {
  assert.ok(pyDep('Flask==3.0.0\ngunicorn>=22', 'flask'))
  assert.ok(pyDep('uvicorn[standard]>=0.30', 'uvicorn'))
  assert.ok(pyDep('dependencies = ["fastapi>=0.110", "uvicorn"]', 'fastapi'))
  assert.ok(!pyDep('flask-cors\n', 'flask'))
  assert.equal(pyFramework('fastapi\nflask\n'), 'fastapi')
})

test('what ms.computer runs without a Procfile — always main:app (measured with CLI 0.2.6)', () => {
  assert.equal(guessedPyStart('fastapi', 'fastapi\nuvicorn'), 'uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}')
  assert.equal(guessedPyStart('flask', 'flask\ngunicorn'), 'gunicorn --bind 0.0.0.0:${PORT:-8000} main:app')
  assert.equal(guessedPyStart('flask', 'flask'), null, 'no gunicorn: refused at planning')
})

test('the app object is found, preferring main.py and app.py', () => {
  assert.deepEqual(findPyEntry([{ path: 'app.py', text: FLASK }], '.'), { path: 'app.py', module: 'app', variable: 'app' })
  assert.deepEqual(findPyEntry([{ path: 'src/server/__init__.py', text: FASTAPI }, { path: 'tests/test_x.py', text: FASTAPI }], '.'), { path: 'src/server/__init__.py', module: 'src.server', variable: 'api' })
  assert.deepEqual(findPyEntry([{ path: 'backend/main.py', text: 'app: FastAPI = FastAPI()' }], 'backend'), { path: 'backend/main.py', module: 'main', variable: 'app' })
  assert.equal(pyStartCommand('flask', { path: 'app.py', module: 'app', variable: 'app' }), 'gunicorn --bind 0.0.0.0:$PORT app:app')
  assert.equal(pyStartCommand('fastapi', { path: 'x', module: 'src.server', variable: 'api' }), 'uvicorn src.server:api --host 0.0.0.0 --port $PORT')
})

test('start commands must listen on 0.0.0.0:$PORT', () => {
  assert.equal(procfileWeb('release: x\nweb: gunicorn app:app\n'), 'gunicorn app:app')
  assert.ok(bindsPort('gunicorn app:app'), 'gunicorn binds 0.0.0.0:$PORT by itself')
  assert.ok(bindsPort('gunicorn --bind 0.0.0.0:$PORT app:app'))
  assert.ok(!bindsPort('gunicorn --bind 127.0.0.1:8000 app:app'))
  assert.ok(bindsPort('uvicorn main:app --host 0.0.0.0 --port $PORT'))
  assert.ok(!bindsPort('uvicorn main:app --port $PORT'), 'uvicorn defaults to 127.0.0.1')
  assert.ok(!bindsPort('python app.py'))
})

test('Flask in app.py: the check catches the main:app guess and Fix it writes the Procfile', async () => {
  const r = await checkSnapshot(repo({ 'requirements.txt': 'flask\ngunicorn\n', 'app.py': FLASK }))
  assert.equal(r.detection.frameworkLabel, 'Flask')
  assert.equal(r.detection.mode, 'dynamic')
  const start = find(r, 'start')!
  assert.equal(start.severity, 'fail')
  assert.match(start.title, /`main:app`, but the app is `app:app`/)
  const fix = availableFixes(r).find((f) => f.id === 'python-start')!
  const files: Record<string, string> = { 'requirements.txt': 'flask\ngunicorn\n' }
  const changes = await fix.build(async (p) => files[p] ?? null)
  assert.deepEqual(changes, [{ path: 'Procfile', before: null, after: 'web: gunicorn --bind 0.0.0.0:$PORT app:app\n' }])
})

test('app.run(port=5000) is only a problem when nothing else serves the app', async () => {
  const local = `${FLASK}\nif __name__ == "__main__":\n    app.run(port=5000)\n`
  const served = await checkSnapshot(repo({ 'requirements.txt': 'flask\ngunicorn\n', 'main.py': local }))
  assert.equal(find(served, 'port')!.severity, 'info', 'gunicorn never runs that line')
  const bare = await checkSnapshot(repo({ 'requirements.txt': 'flask\n', 'main.py': local }))
  assert.equal(find(bare, 'port')!.severity, 'warn')
})

test('Flask without gunicorn: Fix it adds it to requirements.txt too', async () => {
  const r = await checkSnapshot(repo({ 'requirements.txt': 'Flask==3.0', 'main.py': FLASK }))
  assert.match(find(r, 'start')!.title, /gunicorn isn’t installed/)
  const fix = availableFixes(r).find((f) => f.id === 'python-start')!
  const changes = await fix.build(async (p) => (p === 'requirements.txt' ? 'Flask==3.0' : null))
  assert.deepEqual(changes.map((c) => [c.path, c.after]), [['Procfile', 'web: gunicorn --bind 0.0.0.0:$PORT main:app\n'], ['requirements.txt', 'Flask==3.0\ngunicorn\n']])
})

test('FastAPI as app in main.py, or with a good Procfile: passes', async () => {
  const ok = await checkSnapshot(repo({ 'requirements.txt': 'fastapi\nuvicorn\n', 'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n' }))
  assert.equal(find(ok, 'start')!.severity, 'pass')
  const proc = await checkSnapshot(repo({ 'requirements.txt': 'fastapi\nuvicorn\n', 'server.py': FASTAPI, Procfile: 'web: uvicorn server:api --host 0.0.0.0 --port $PORT\n' }))
  assert.equal(find(proc, 'start')!.severity, 'pass')
  assert.equal(find(proc, 'workers')!.severity, 'pass', 'one web line is one process')
  assert.equal(availableFixes(proc).find((f) => f.id === 'python-start'), undefined)
})

test('Streamlit is blocked: it talks to the browser over WebSockets', async () => {
  const r = await checkSnapshot(repo({ 'requirements.txt': 'streamlit\n', 'app.py': 'import streamlit as st\n' }))
  assert.equal(find(r, 'streaming')!.severity, 'fail')
  assert.equal(r.verdict.kind, 'unsupported')
})

test('Procfile edits keep other lines; requirements are not duplicated', () => {
  assert.equal(procfileWith('web: python app.py\nrelease: x\n', 'gunicorn app:app'), 'web: gunicorn app:app\nrelease: x\n')
  assert.equal(procfileWith('release: x\n', 'gunicorn app:app'), 'web: gunicorn app:app\nrelease: x\n')
  assert.equal(requirementWith('gunicorn==22\n', 'gunicorn'), null)
  assert.equal(requirementWith('flask', 'gunicorn'), 'flask\ngunicorn\n')
})

const GOMOD = 'module example.com/api\n\ngo 1.23\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n\tgithub.com/gorilla/websocket v1.5.3 // indirect\n)\n'

test('go.mod dependencies and main packages', () => {
  assert.deepEqual(goDeps(GOMOD), ['github.com/gin-gonic/gin', 'github.com/gorilla/websocket'])
  assert.deepEqual(goDeps('module x\n\nrequire github.com/lib/pq v1.10.9\n'), ['github.com/lib/pq'])
  assert.equal(goLabel(goDeps(GOMOD)), 'Go · Gin')
  const isMain = () => true
  assert.deepEqual(goMains(['main.go', 'internal/x.go', 'cmd/tool/main.go', 'main_test.go'], '.', isMain), ['.', 'cmd/tool'])
})

test('Go: fixed ports are rewritten to read $PORT, with the old port as the local fallback', () => {
  const src = 'package main\n\nimport (\n\t"net/http"\n)\n\nfunc main() {\n\thttp.ListenAndServe(":8080", nil)\n}\n'
  const out = goPort(src)
  assert.match(out, /import \(\n\t"os"\n\t"net\/http"\n\)/)
  assert.match(out, /http\.ListenAndServe\(":"\+envPort\(\), nil\)/)
  assert.match(out, /return "8080"/)
  assert.match(goPort('package main\n\nimport "github.com/gin-gonic/gin"\n\nfunc main() { r := gin.Default(); r.Run(":3000") }\n'), /import \(\n\t"os"\n\t"github.com\/gin-gonic\/gin"\n\)[\s\S]*r\.Run\(":"\+envPort\(\)\)/)
  assert.equal(goPort('package main\nfunc main() { http.ListenAndServe(":"+os.Getenv("PORT"), nil) }\n'), 'package main\nfunc main() { http.ListenAndServe(":"+os.Getenv("PORT"), nil) }\n')
})

test('a Go server: start, port fix, and Go-specific blockers', async () => {
  const main = 'package main\n\nimport "net/http"\n\nfunc main() {\n\thttp.ListenAndServe(":8080", nil)\n}\n'
  const r = await checkSnapshot(repo({ 'go.mod': 'module example.com/api\n\ngo 1.23\n', 'main.go': main }))
  assert.equal(r.detection.frameworkLabel, 'Go server')
  assert.equal(find(r, 'start')!.severity, 'pass')
  assert.equal(find(r, 'port')!.severity, 'warn')
  const fix = availableFixes(r).find((f) => f.id === 'listen-on-port')!
  const [change] = await fix.build(async (p) => (p === 'main.go' ? main : null))
  assert.match(change.after!, /envPort\(\)/)

  const ws = await checkSnapshot(repo({ 'go.mod': GOMOD, 'cmd/server/main.go': 'package main\nfunc main() { r := gin.Default(); r.Run(":"+os.Getenv("PORT")) }\n' }))
  assert.equal(find(ws, 'streaming')!.severity, 'fail')
  assert.equal(find(ws, 'start')!.title, 'Builds and runs the Go program in cmd/server')
  assert.equal(find(ws, 'port')!.severity, 'info')

  const cli = await checkSnapshot(repo({ 'go.mod': 'module x\n\ngo 1.23\n', 'main.go': 'package main\nfunc main() { println("hi") }\n' }))
  assert.equal(find(cli, 'start')!.title, 'No HTTP server found')

  const db = await checkSnapshot(repo({ 'go.mod': 'module x\n\nrequire github.com/jackc/pgx/v5 v5.6.0\n', 'main.go': main }))
  assert.equal(find(db, 'database')!.severity, 'fail')
})

test('review fixes: Go — localhost sidecars stay put, one envPort, Gin’s bare r.Run() is a server', async () => {
  const src = 'package main\n\nimport (\n\t"net/http"\n)\n\nfunc main() {\n\tgo http.ListenAndServe("localhost:6060", nil)\n\thttp.ListenAndServe(":8080", nil)\n}\n'
  const out = goPort(src)
  assert.match(out, /ListenAndServe\("localhost:6060", nil\)/, 'pprof untouched')
  assert.match(out, /ListenAndServe\(":"\+envPort\(\), nil\)/)
  assert.match(out, /return "8080"/)
  assert.equal(goPort(out), out, 'idempotent')
  const two = goPort('package main\nimport "net/http"\nfunc main() { http.ListenAndServe(":8080", nil) }\nfunc admin() { http.ListenAndServe(":9090", nil) }\n')
  assert.equal(two.match(/envPort\(\)/g)!.length, 2, 'one call site + the func')
  assert.match(two, /ListenAndServe\(":9090", nil\)/, 'only the first listener takes $PORT')

  const gin = await checkSnapshot(repo({ 'go.mod': GOMOD.replace(/\tgithub.com\/gorilla.*\n/, ''), 'main.go': 'package main\nfunc main() {\n\tr := gin.Default()\n\tr.Run()\n}\n' }))
  assert.equal(find(gin, 'start')!.severity, 'pass')
})

test('review fixes: FastAPI via fastapi[standard] needs only a Procfile (ms.computer can’t see the extra — measured)', async () => {
  const r = await checkSnapshot(repo({ 'requirements.txt': 'fastapi[standard]>=0.115\n', 'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n' }))
  assert.equal(find(r, 'start')!.title, 'ms.computer can’t tell how to start the app')
  const changes = await availableFixes(r).find((f) => f.id === 'python-start')!.build(async (p) => (p === 'requirements.txt' ? 'fastapi[standard]>=0.115\n' : null))
  assert.deepEqual(changes.map((c) => c.path), ['Procfile'])
  const inc = await checkSnapshot(repo({ 'requirements.txt': '-r base.txt\nfastapi\n', 'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n' }))
  assert.equal(find(inc, 'start')!.severity, 'warn')
})
