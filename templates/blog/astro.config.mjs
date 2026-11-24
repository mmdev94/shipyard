import { defineConfig } from 'astro/config'

// Static output: `npm run build` writes plain files to dist/, which ms.computer serves.
export default defineConfig({ output: 'static' })
