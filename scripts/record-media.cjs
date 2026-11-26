// Exports the link-preview image and the guide clips as GIF/WebM from the
// same components the site plays. Needs a running `vite preview` and Playwright.
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/record-media.cjs <frames-dir> [base-url]
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const path = require('path')

const out = process.argv[2]
const base = process.argv[3] || 'http://localhost:4317/'
const FPS = 15
const CLIPS = ['check', 'deploy', 'push', 'fix', 'title', 'end']
const CARD = 2500 // title / end card length

;(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })

  // 1. link-preview image
  await page.goto(base + '#/og')
  await page.waitForTimeout(1500) // fonts
  await page.locator('#stage').screenshot({ path: path.join(out, 'og.png') })
  console.log('og.png')

  // 2. clip frames
  await page.setViewportSize({ width: 960, height: 600 })
  for (const id of CLIPS) {
    await page.goto(base + `#/clip/${id}`)
    await page.waitForFunction(() => window.__clip)
    await page.waitForTimeout(800)
    const duration = id === 'title' || id === 'end' ? CARD : await page.evaluate(() => window.__clip.duration)
    const dir = path.join(out, id)
    fs.mkdirSync(dir, { recursive: true })
    const n = Math.ceil((duration / 1000) * FPS)
    for (let i = 0; i <= n; i++) {
      await page.evaluate((ms) => window.__clip.set(ms), (i * 1000) / FPS)
      await page.locator('#stage').screenshot({ path: path.join(dir, `${String(i).padStart(4, '0')}.png`) })
    }
    console.log(id, n + 1, 'frames')
  }
  await browser.close()
})()
