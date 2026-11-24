import { assetUrl } from '../../lib/assetUrl'

/**
 * The Vanagram mark: the van on a blue tile. It is an `<img>` of the favicon asset on purpose (not inline SVG): that file holds
 * two designs and the browser picks by the rendered width — the detailed one from 24 px up (the top bar's 32 px), a pixel-grid
 * one below it. Decorative: the brand name is written beside it.
 */
export function Logo({ size = 32 }: { size?: number }) {
  return <img className="logo" src={assetUrl('favicon.svg')} width={size} height={size} alt="" draggable={false} />
}
