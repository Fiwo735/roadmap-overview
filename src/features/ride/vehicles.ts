import type { LegMode } from '../../types/trip'

/**
 * The little vehicles of the ride, as SVG strings for a Leaflet divIcon. All are side views facing
 * east (the layer mirrors them to face west, so they are never upside-down) in a 64 × 40 box, with a
 * dark outline and light bodies so they read on any tile; colours are the mode colours of `MODES`
 * (the tiles are never themed, so neither are these). Wheels carry `class="ride-wheel"` so the CSS
 * can spin them while the vehicle moves.
 */
const INK = '#1f2937'
const GLASS = '#bae6fd'
const STROKE = `stroke="${INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`

function wheel(cx: number, cy: number, r: number): string {
  return `<g class="ride-wheel" style="transform-origin:${cx}px ${cy}px"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${INK}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.45}" fill="#e2e8f0"/><path d="M${cx} ${cy - r * 0.8}V${cy + r * 0.8}" stroke="${INK}" stroke-width="1.2"/></g>`
}

const VAN = `
  <path d="M5 30V14.5Q5 10 9.5 10H37.5L51 20.5Q59 21.5 60.5 26V30Z" fill="#ffffff" ${STROKE}/>
  <path d="M14 10V7.2Q14 5 16.2 5H31.8Q34 5 34 7.2V10" fill="#f1f5f9" ${STROKE}/>
  <path d="M5.5 21H55Q59 21.5 60.5 25.5V28H5.5Z" fill="#ef6c3a" stroke="none"/>
  <path d="M5 30V14.5Q5 10 9.5 10H37.5L51 20.5Q59 21.5 60.5 26V30Z" fill="none" ${STROKE}/>
  <path d="M9.5 12.5H31V19H9.5Z" fill="${GLASS}" ${STROKE} stroke-width="1.6"/>
  <path d="M36 12.5H37.5L47 19H36Z" fill="${GLASS}" ${STROKE} stroke-width="1.6"/>
  <path d="M33.5 12v17" stroke="${INK}" stroke-width="1.4" fill="none"/>
  <rect x="58" y="22.5" width="3" height="3.2" rx="1.2" fill="#fde047" stroke="${INK}" stroke-width="1.2"/>
  <rect x="3.4" y="22.5" width="2.6" height="3.4" rx="1" fill="#dc2626" stroke="${INK}" stroke-width="1.2"/>
  <path d="M57 30h5v2.2h-5Z" fill="${INK}" stroke="none"/>
  ${wheel(17.5, 30.5, 6.2)}
  ${wheel(47.5, 30.5, 6.2)}
`

const FERRY = `
  <path d="M4 25H60L53.5 34.5H11Z" fill="#0e7490" ${STROKE}/>
  <path d="M7.5 29.5H57" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none"/>
  <path d="M15 25V17.5H45V25" fill="#ffffff" ${STROKE}/>
  <path d="M21 17.5V11H39V17.5" fill="#f1f5f9" ${STROKE}/>
  <path d="M29 11V5H36V11" fill="#ef6c3a" ${STROKE}/>
  <path d="M29 7.5H36" stroke="${INK}" stroke-width="1.6" fill="none"/>
  <g fill="${GLASS}" stroke="${INK}" stroke-width="1.2">
    <rect x="19" y="19.6" width="4.4" height="3.2" rx="0.8"/><rect x="26" y="19.6" width="4.4" height="3.2" rx="0.8"/>
    <rect x="33" y="19.6" width="4.4" height="3.2" rx="0.8"/><rect x="40" y="19.6" width="2.6" height="3.2" rx="0.8"/>
    <rect x="24.5" y="13.2" width="4.4" height="2.8" rx="0.8"/><rect x="31.5" y="13.2" width="4.4" height="2.8" rx="0.8"/>
  </g>
  <path d="M2 37.6q4-3 8 0t8 0t8 0t8 0t8 0t8 0t8 0t6 0" stroke="#0891b2" stroke-width="2.4" stroke-linecap="round" fill="none"/>
`

const TRAIN = `
  <path d="M4 12.5H47Q59.5 12.5 61 25V31H4Z" fill="#7c3aed" ${STROKE}/>
  <path d="M4 25.5H61" stroke="#ffffff" stroke-width="2.4" fill="none"/>
  <g fill="${GLASS}" stroke="${INK}" stroke-width="1.4">
    <rect x="8" y="16" width="7" height="6" rx="1.2"/><rect x="18" y="16" width="7" height="6" rx="1.2"/>
    <rect x="28" y="16" width="7" height="6" rx="1.2"/><path d="M38.5 16H46Q52 16 55.5 22H38.5Z"/>
  </g>
  <path d="M24 12.5 28 6.8H38L42 12.5M28 6.8H38" fill="none" ${STROKE} stroke-width="1.6"/>
  <rect x="57.2" y="26.4" width="2.4" height="2.4" rx="0.8" fill="#fde047"/>
  <path d="M0 38H64" stroke="${INK}" stroke-width="1.6" fill="none"/>
  ${wheel(14, 33.6, 3.8)}
  ${wheel(25, 33.6, 3.8)}
  ${wheel(44, 33.6, 3.8)}
  ${wheel(55, 33.6, 3.8)}
`

const FLIGHT = `
  <path d="M6 20.5 3.5 8.5H10.5L18.5 18.5Z" fill="#db2777" ${STROKE}/>
  <path d="M6.5 22Q6.5 17.2 15 17H49Q60.5 17 62.5 21.8Q60.5 26.6 49 26.6H15Q6.5 26.6 6.5 22Z" fill="#ffffff" ${STROKE}/>
  <path d="M27.5 24 21 35.5H29.5L42 24Z" fill="#db2777" ${STROKE}/>
  <path d="M26 20.5 20 9.5H27.5L38 19.5Z" fill="#f472b6" ${STROKE}/>
  <g fill="${GLASS}" stroke="${INK}" stroke-width="1.2">
    <rect x="14" y="19.4" width="3.6" height="3" rx="1"/><rect x="20" y="19.4" width="3.6" height="3" rx="1"/>
    <rect x="30" y="19.4" width="3.6" height="3" rx="1"/><rect x="36" y="19.4" width="3.6" height="3" rx="1"/>
    <path d="M51 19.2Q57.5 19.2 59.2 21.8H51Z"/>
  </g>
  <rect x="32" y="26" width="9" height="3.4" rx="1.7" fill="#e2e8f0" stroke="${INK}" stroke-width="1.4"/>
`

const ART: Record<LegMode, string> = { drive: VAN, ferry: FERRY, train: TRAIN, flight: FLIGHT }

/** The vehicle that carries the traveller on a stretch of this mode (`drive` is the campervan), facing east. */
export function vehicleSvg(mode: LegMode): string {
  return `<svg class="ride-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 40" width="56" height="35" aria-hidden="true">${ART[mode]}</svg>`
}
