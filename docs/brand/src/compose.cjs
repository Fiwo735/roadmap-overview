// og-image.png (1200x630, into public/) and preview-sheet.png (next to the masters)
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const { ROOT, PUBLIC } = require('./lib.cjs')
const u = (f) => 'file://' + path.join(f.endsWith('.png') ? PUBLIC : ROOT, f)

function bez(p, t) {
  const k = 1 - t
  return [k ** 3 * p[0][0] + 3 * k * k * t * p[1][0] + 3 * k * t * t * p[2][0] + t ** 3 * p[3][0], k ** 3 * p[0][1] + 3 * k * k * t * p[1][1] + 3 * k * t * t * p[2][1] + t ** 3 * p[3][1]]
}

function ogHtml() {
  // decorative route with numbered stops, right side
  const segs = [
    [[600, 560], [700, 585], [760, 470], [860, 450]],
    [[860, 450], [960, 430], [1010, 330], [1070, 260]],
    [[1070, 260], [1110, 215], [1140, 190], [1150, 110]],
  ]
  let dots = ''
  segs.forEach((s) => {
    for (let i = 1; i < 14; i++) {
      const [x, y] = bez(s, i / 14)
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="#1a73e8" opacity=".38"/>`
    }
  })
  const nodes = [[600, 560, '1'], [860, 450, '2'], [1070, 260, '3']]
    .map(([x, y, n]) => `<circle cx="${x}" cy="${y}" r="27" fill="#1a73e8"/><text x="${x}" y="${y + 9.5}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="27" fill="#fff">${n}</text>`).join('')
  return `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0}
    body{width:1200px;height:630px;background:#f4f7fb;position:relative;overflow:hidden;font-family:Inter,sans-serif}
    .deco{position:absolute;inset:0}
    .lock{position:absolute;left:90px;top:132px;height:190px}
    .tag{position:absolute;left:96px;top:376px;font-size:44px;font-weight:500;letter-spacing:-0.01em;color:#3d4a5e}
    .sub{position:absolute;left:98px;top:422px;font-size:26px;font-weight:500;color:#6b7788}
  </style>
  <svg class="deco" viewBox="0 0 1200 630" width="1200" height="630">${dots}${nodes}
    <circle cx="1150" cy="110" r="31" fill="#fff" stroke="#1a73e8" stroke-width="10"/><circle cx="1150" cy="110" r="11" fill="#f9ab00"/></svg>
  <img class="lock" src="${u('logo-lockup-light.svg')}">
  <div class="tag">Your road trip on one map</div>`
}

function sheetHtml() {
  const panel = (theme) => {
    const bg = theme === 'light' ? '#eef1f5' : '#0d1219'
    const fg = theme === 'light' ? '#18212f' : '#e8edf4'
    const mut = theme === 'light' ? '#5b6678' : '#9ba7b9'
    const lock = `logo-lockup-${theme}.svg`
    const cell = (inner, label) => `<div class="c">${inner}<div class="l">${label}</div></div>`
    return `<div class="panel" style="background:${bg};color:${fg};--mut:${mut}">
      <h3>${theme === 'light' ? 'Light background' : 'Dark background'}</h3>
      <div class="sec">SVG masters (shown at 160 px)</div>
      <div class="row">
        ${cell(`<img src="${u('icon.svg')}" width="160" height="160">`, 'icon.svg')}
        ${cell(`<img src="${u('icon-maskable.svg')}" width="160" height="160">`, 'icon-maskable.svg')}
        ${cell(`<img src="${u('icon-maskable.svg')}" width="160" height="160" style="border-radius:50%">`, 'maskable, circle mask')}
        ${cell(`<img src="${u('favicon.svg')}" width="160" height="160">`, 'favicon.svg (32 design)')}
      </div>
      <div class="sec">PNG at 1:1</div>
      <div class="row" style="align-items:flex-end">
        ${cell(`<img src="${u('favicon-16.png')}" width="16" height="16">`, 'favicon-16')}
        ${cell(`<img src="${u('favicon-32.png')}" width="32" height="32">`, 'favicon-32')}
        ${cell(`<img src="${u('apple-touch-icon.png')}" width="180" height="180">`, 'apple-touch 180')}
        ${cell(`<img src="${u('apple-touch-icon.png')}" width="180" height="180" style="border-radius:22.4%">`, 'iOS-masked')}
        ${cell(`<img src="${u('icon-192.png')}" width="192" height="192">`, 'icon-192')}
      </div>
      <div class="sec">Large PNG (shown at 224 px)</div>
      <div class="row">
        ${cell(`<img src="${u('icon-512.png')}" width="224" height="224">`, 'icon-512')}
        ${cell(`<img src="${u('icon-maskable-512.png')}" width="224" height="224">`, 'icon-maskable-512')}
        ${cell(`<img src="${u('icon-maskable-512.png')}" width="224" height="224" style="border-radius:50%">`, 'circle mask')}
      </div>
      <div class="sec">Lockup at 30 / 48 / 96 px tall (${lock})</div>
      <div class="row" style="align-items:center;gap:36px">
        <img src="${u(lock)}" style="height:30px"><img src="${u(lock)}" style="height:48px"><img src="${u(lock)}" style="height:96px">
      </div>
      <div class="sec">og-image.png (shown at 50 %)</div>
      <div class="row"><img src="${u('og-image.png')}" width="600" height="315" style="border-radius:6px"></div>
    </div>`
  }
  return `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;display:flex;font-family:Inter,sans-serif;width:1560px}
    .panel{width:780px;padding:20px 28px 28px}h3{margin:0 0 6px;font-size:16px}
    .sec{font-size:12px;font-weight:600;color:var(--mut);margin:18px 0 8px;text-transform:uppercase;letter-spacing:.04em}
    .row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
    .c{display:flex;flex-direction:column;align-items:flex-start;gap:6px}.l{font-size:11px;color:var(--mut)}
    img{display:block}
  </style>${panel('light')}${panel('dark')}`
}

;(async () => {
  const browser = await chromium.launch()
  const render = async (html, name, out, vp) => {
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 })
    const tmp = path.join(__dirname, `_c-${name}.html`)
    fs.writeFileSync(tmp, html)
    await page.goto('file://' + tmp)
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))))
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: path.join(out === 'og-image.png' ? PUBLIC : ROOT, out), fullPage: name === 'sheet' })
    await page.close(); fs.unlinkSync(tmp)
  }
  await render(ogHtml(), 'og', 'og-image.png', { width: 1200, height: 630 })
  await render(sheetHtml(), 'sheet', 'preview-sheet.png', { width: 1560, height: 900 })
  await browser.close()
  console.log('composed')
})()
