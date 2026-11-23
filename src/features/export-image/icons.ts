import type { LegMode } from '../../types/trip'
import { modeIconSvg } from '../legs/modeIcons'

/** The icons the image's card and badges use: the four travel modes and the card's own figures. */
export type IconId = LegMode | 'route' | 'calendar' | 'pin' | 'globe'

/** Shapes of the card's own icons (24 × 24, stroked), copied from lucide (ISC licence) like `modeIconSvg`'s. */
const SHAPES: Record<Exclude<IconId, LegMode>, string> = {
  route: '<path d="M9 5h8.5a1 1 0 010 7h-11a1 1 0 000 7H15"/><circle cx="18" cy="19" r="3"/><circle cx="6" cy="5" r="3"/>',
  calendar:
    '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
}

const attributes = (tag: string): Record<string, string> => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))

/**
 * The outlines of an SVG made of `<path>`, `<circle>` and `<rect>` elements, as SVG path data a
 * canvas can stroke with `Path2D`. Lets the canvas draw the very icons the page draws (`modeIconSvg`).
 */
export function svgToPaths(svg: string): string[] {
  const paths: string[] = []
  for (const [, tag, rest] of svg.matchAll(/<(path|circle|rect)\b([^>]*)>/g)) {
    const a = attributes(rest)
    const n = (name: string) => Number(a[name] ?? 0)
    if (tag === 'path') paths.push(a.d ?? '')
    else if (tag === 'circle') {
      const [cx, cy, r] = [n('cx'), n('cy'), n('r')]
      paths.push(`M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`)
    } else {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')]
      const r = Math.min(n('rx'), w / 2, h / 2)
      paths.push(`M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`)
    }
  }
  return paths.filter(Boolean)
}

const isMode = (id: IconId): id is LegMode => id === 'drive' || id === 'ferry' || id === 'train' || id === 'flight'

const cache = new Map<IconId, string[]>()

/** The icon's outlines in a 24 × 24 box. */
export function iconPaths(id: IconId): string[] {
  let paths = cache.get(id)
  if (!paths) {
    paths = svgToPaths(isMode(id) ? modeIconSvg(id, 24) : SHAPES[id])
    cache.set(id, paths)
  }
  return paths
}
