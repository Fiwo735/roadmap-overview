// Vanagram final logo: shared geometry + builders. Original artwork, no brand marks.
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..') // docs/brand: the SVG masters
const PUBLIC = path.join(ROOT, '..', '..', 'public') // the app's public/: the favicon and every PNG the site serves
const WM = JSON.parse(fs.readFileSync(path.join(__dirname, 'wordmark-semibold.json'), 'utf8'))

const BLUE = '#1a73e8'
const BLACK = '#0d1219'
const WHITE = '#ffffff'
const AMBER = '#f9ab00'
const INK_LIGHT = '#18212f' // app --text (light)
const INK_DARK = '#e8edf4' // app --text (dark)

const f = (n) => +n.toFixed(2)

// ------------------------------------------------------------------ the van (master artwork)
// Long-wheelbase high-roof panel van, side view, facing right. Base box 440 x 160 (+wheels).
// Rear overhang 120 (beyond the rear wheel centre), wheelbase 256, front overhang 64;
// short steep bonnet, big upright windscreen, sliding-door seams, roof vent.
function vanMaster({ body = BLACK, cut = BLUE, hub = WHITE, light = AMBER } = {}) {
  const bodyD = 'M0 160V24Q0 0 24 0H302Q324 0 332 19L359 92Q363 104 377 108L418 118Q440 124 440 142V160Z'
  const wheel = (cx) => `<circle cx="${cx}" cy="164" r="49" fill="${cut}"/><circle cx="${cx}" cy="164" r="38" fill="${body}"/><circle cx="${cx}" cy="164" r="14" fill="${hub}"/>`
  return `<rect x="104" y="-14" width="78" height="22" rx="9" fill="${body}"/>
    <path d="${bodyD}" fill="${body}"/>
    <path d="M262 32H320L343 88H262Z" fill="${cut}" stroke="${cut}" stroke-width="8" stroke-linejoin="round"/>
    <path d="M256 36V150M178 36V150" stroke="${cut}" stroke-width="6" stroke-linecap="round"/>
    <rect x="212" y="96" width="26" height="7" rx="3.5" fill="${hub}"/>
    <rect x="414" y="124" width="21" height="14" rx="6" fill="${light}"/>
    ${wheel(120)}${wheel(376)}`
}

/** Equal-arc-length dots along a cubic chain, skipping `padA`/`padB` at the ends. */
function dotsAlong(segs, r, step, padA, padB, fill = WHITE) {
  const pts = []
  segs.forEach((p, si) => {
    for (let i = si === 0 ? 0 : 1; i <= 120; i++) {
      const t = i / 120, u = 1 - t
      pts.push([
        u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
        u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1],
      ])
    }
  })
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const L = cum[cum.length - 1]
  const usable = L - padA - padB
  const n = Math.round(usable / step)
  const out = []
  for (let k = 0; k <= n; k++) {
    const target = padA + (usable * k) / n
    let i = 1
    while (i < cum.length - 1 && cum[i] < target) i++
    const t = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
    out.push(`<circle cx="${f(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t)}" cy="${f(pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t)}" r="${r}" fill="${fill}"/>`)
  }
  return out.join('')
}

/** The master icon content (512 box), without the tile. */
function masterContent() {
  // van: scale .96, rear-top at (45,128)
  const route = [
    [[70, 374], [128, 352], [196, 396], [256, 374]],
    [[256, 374], [316, 352], [384, 396], [442, 374]],
  ]
  return `<g transform="translate(45 128) scale(0.96)">${vanMaster()}</g>
  <g>
    ${dotsAlong([route[0]], 9, 34, 44, 34)}${dotsAlong([route[1]], 9, 34, 34, 46)}
    <circle cx="70" cy="374" r="23" fill="${WHITE}"/>
    <circle cx="256" cy="374" r="15" fill="${WHITE}"/>
    <circle cx="442" cy="374" r="26" fill="${WHITE}"/>
    <circle cx="442" cy="374" r="11" fill="${AMBER}"/>
  </g>`
}

const tileRect = (rx = 112, fill = BLUE) => `<rect width="512" height="512" rx="${rx}" fill="${fill}"/>`

function svgDoc(title, w, h, body, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}">
  <title>${title}</title>
${extra}${body}
</svg>
`
}

// ------------------------------------------------------------------ small sizes
/** 32-unit design. Edges sit on even units so that at 16 px they land on whole pixels. */
function small32Content() {
  return `<path d="M2 18V8Q2 6 4 6H20Q21.4 6 22 7.2L24 14H28Q30 14 30 16V18Z" fill="${BLACK}"/>
  <path d="M16 8H20.4L22 12H16Z" fill="${BLUE}"/>
  <rect x="14" y="8" width="1" height="9" fill="${BLUE}"/>
  <rect x="27" y="14.8" width="3" height="2" rx="0.6" fill="${AMBER}"/>
  <circle cx="11" cy="19" r="5" fill="${BLUE}"/><circle cx="25" cy="19" r="5" fill="${BLUE}"/>
  <circle cx="11" cy="19" r="3.5" fill="${BLACK}"/><circle cx="25" cy="19" r="3.5" fill="${BLACK}"/>
  <circle cx="11" cy="19" r="1.2" fill="${WHITE}"/><circle cx="25" cy="19" r="1.2" fill="${WHITE}"/>
  <g fill="${WHITE}">
    <circle cx="5" cy="28" r="2"/>
    <circle cx="10" cy="28" r="1"/><circle cx="14" cy="28" r="1"/><circle cx="18" cy="28" r="1"/><circle cx="22" cy="28" r="1"/>
    <circle cx="27" cy="28" r="2"/>
  </g>
  <circle cx="27" cy="28" r="1" fill="${AMBER}"/>`
}

/** 16-unit (= 16 px) design, drawn on the pixel grid: solid silhouette, 3x2 wheel stubs with a white hub pixel. */
function small16Content() {
  return `<path d="M1 3H10.5L12 7H15V9H1Z" fill="${BLACK}"/>
  <path d="M8 4H10.3L11.2 6H8Z" fill="${BLUE}"/>
  <rect x="14" y="7" width="1" height="1" fill="${AMBER}"/>
  <rect x="4" y="8" width="3" height="3" rx="1.1" fill="${BLACK}"/><rect x="11" y="8" width="3" height="3" rx="1.1" fill="${BLACK}"/>
  <rect x="5" y="9" width="1" height="1" fill="${WHITE}"/><rect x="12" y="9" width="1" height="1" fill="${WHITE}"/>
  <rect x="3" y="13" width="10" height="1" fill="${WHITE}"/>`
}

/** Favicon: 32-unit design, swapping to the pixel-grid 16 px design when rendered narrower than 24 px. */
function faviconSvg() {
  return svgDoc('Vanagram', 32, 32,
    `  <rect width="32" height="32" rx="7" fill="${BLUE}"/>
  <g class="f32">${small32Content()}</g>
  <g class="f16" transform="scale(2)">${small16Content()}</g>`,
    `  <style>.f16{display:none}@media (max-width:23.99px){.f32{display:none}.f16{display:inline}}</style>\n`)
}

/** Outlined wordmark "Vanagram" (Inter SemiBold, SIL OFL 1.1), baseline at y, left edge at x0. */
function wordmarkPaths({ x0, baseline, capH, fill }) {
  const s = capH / WM.capH
  const paths = WM.glyphs.map((g) => `<path transform="translate(${f(x0 + g.x * s)} ${f(baseline)}) scale(${s.toFixed(5)} ${(-s).toFixed(5)})" d="${g.d}"/>`).join('')
  return { svg: `<g fill="${fill}">${paths}</g>`, width: WM.adv * s }
}

/** Horizontal lockup, 128 units tall. Small icon below 64 px rendered height, master icon from 64 px up. */
function lockupSvg(theme) {
  const H = 128, gap = 30, capH = 54
  const ink = theme === 'light' ? INK_LIGHT : INK_DARK
  const wm = wordmarkPaths({ x0: H + gap, baseline: H / 2 + capH / 2, capH, fill: ink })
  const W = Math.ceil(H + gap + wm.width + 2)
  return svgDoc(`Vanagram (${theme})`, W, H,
    `  <g class="ls"><rect width="128" height="128" rx="28" fill="${BLUE}"/><g transform="scale(4)">${small32Content()}</g></g>
  <g class="lb" transform="scale(0.25)">${tileRect()}${masterContent()}</g>
  ${wm.svg}`,
    `  <!-- The letters are outlines of Inter SemiBold, (c) 2016 The Inter Project Authors, SIL Open Font License 1.1: docs/brand/LICENSE-Inter.txt -->\n  <style>.lb{display:none}@media (min-height:64px){.lb{display:inline}.ls{display:none}}</style>\n`)
}

module.exports = { ROOT, PUBLIC, WM, BLUE, BLACK, WHITE, AMBER, INK_LIGHT, INK_DARK, f, vanMaster, masterContent, tileRect, svgDoc, small32Content, small16Content, faviconSvg, lockupSvg, wordmarkPaths }
