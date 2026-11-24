// Rasterises SVGs to PNGs (1:1, transparent where the tile has rounded corners) into the app's public/ folder.
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const { ROOT, PUBLIC } = require('./lib.cjs')

const jobs = [
  ['favicon.svg', 16, 'favicon-16.png'],
  ['favicon.svg', 32, 'favicon-32.png'],
  ['src/gen/apple-touch-icon.svg', 180, 'apple-touch-icon.png'],
  ['icon.svg', 192, 'icon-192.png'],
  ['icon.svg', 512, 'icon-512.png'],
  ['icon-maskable.svg', 512, 'icon-maskable-512.png'],
]
const only = process.argv.slice(2)

;(async () => {
  const browser = await chromium.launch()
  for (const [src, size, out] of jobs) {
    if (only.length && !only.includes(out)) continue
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    const html = path.join(__dirname, `_r-${out}.html`)
    fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}img{display:block}</style><img src="file://${path.join(ROOT, src)}" width="${size}" height="${size}">`)
    await page.goto('file://' + html)
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())))
    await page.screenshot({ path: path.join(PUBLIC, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
    await page.close()
    fs.unlinkSync(html)
  }
  await browser.close()
  console.log('png ok')
})()
