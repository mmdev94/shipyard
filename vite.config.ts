import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The page may hold a visitor's GitHub token in memory. This policy is the
// proof of where it can go: scripts only from this site, and network calls
// only to GitHub's API, its raw-file host and its Actions log storage.
// Anyone can read it in the page source or dev tools.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: https://github.com https://*.githubusercontent.com",
  "connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://*.blob.core.windows.net",
  // live thumbnails on the showcase (sandboxed, cross-origin)
  'frame-src https://*.ms.computer',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const csp = (): Plugin => ({
  name: 'shipyard-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

// GitHub Actions sets GITHUB_SHA and GITHUB_REPOSITORY, so a site built by its
// own workflow can show exactly which commit is live.
export default defineConfig({
  plugins: [react(), csp()],
  define: {
    __COMMIT__: JSON.stringify((process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local'),
    __BUILT_AT__: JSON.stringify(new Date().toISOString()),
    __REPO__: JSON.stringify(process.env.GITHUB_REPOSITORY ?? 'mmdev94/shipyard'),
  },
})
