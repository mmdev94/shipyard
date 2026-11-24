import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Actions sets GITHUB_SHA and GITHUB_REPOSITORY, so a site built by its
// own workflow can show exactly which commit is live.
export default defineConfig({
  plugins: [react()],
  define: {
    __COMMIT__: JSON.stringify((process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local'),
    __BUILT_AT__: JSON.stringify(new Date().toISOString()),
    __REPO__: JSON.stringify(process.env.GITHUB_REPOSITORY ?? 'mmdev94/shipyard'),
  },
})
