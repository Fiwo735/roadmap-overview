import type { Leg, LegMode, LegRoute } from '../types/trip'
import { MODE_ORDER } from './modes'

/**
 * The modes a trip travels in, in `MODE_ORDER`: each leg's own mode, plus ferry when a drive route
 * contains ferry crossings (`LegRoute.spans`). Drives the map legend.
 */
export function modesInUse(legs: ReadonlyArray<{ leg: Pick<Leg, 'mode'>; route?: Pick<LegRoute, 'spans'> }>): LegMode[] {
  const used = new Set<LegMode>()
  for (const { leg, route } of legs) {
    used.add(leg.mode)
    if (route?.spans?.some((span) => span.mode === 'ferry')) used.add('ferry')
  }
  return MODE_ORDER.filter((mode) => used.has(mode))
}
