// Writes the SVG masters. PNGs are produced by raster.cjs.
const fs = require('fs')
const path = require('path')
const L = require('./lib.cjs')
const { ROOT, PUBLIC, BLUE, svgDoc, tileRect, masterContent } = L

const w = (name, s) => fs.writeFileSync(path.join(ROOT, name), s)

// master (rounded tile, transparent corners)
w('icon.svg', svgDoc('Vanagram', 512, 512, `  ${tileRect()}\n  ${masterContent()}`))

// maskable: full-bleed square, content scaled into the 80 % safe zone (circle r = 40 %)
w('icon-maskable.svg', svgDoc('Vanagram (maskable)', 512, 512, `  <rect width="512" height="512" fill="${BLUE}"/>\n  <g transform="translate(256 256) scale(0.8) translate(-256 -256.5)">${masterContent()}</g>`))

// apple-touch: full-bleed square (iOS applies its own mask), same artwork as master
w('apple-touch-icon.svg', svgDoc('Vanagram (apple touch)', 512, 512, `  <rect width="512" height="512" fill="${BLUE}"/>\n  ${masterContent()}`))

// small-size designs + lockups
fs.mkdirSync(path.join(ROOT, 'src/gen'), { recursive: true })
w('favicon.svg', L.faviconSvg())
fs.copyFileSync(path.join(ROOT, 'favicon.svg'), path.join(PUBLIC, 'favicon.svg')) // the one SVG the site serves
w('src/gen/apple-touch-icon.svg', fs.readFileSync(path.join(ROOT, 'apple-touch-icon.svg'), 'utf8'))
fs.unlinkSync(path.join(ROOT, 'apple-touch-icon.svg'))
w('logo-lockup-light.svg', L.lockupSvg('light'))
w('logo-lockup-dark.svg', L.lockupSvg('dark'))
console.log('svg ok')
