import type { RideSample } from './timeline'

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "Sat 4 Jul 2026" for a YYYY-MM-DD date; null when there is none (or it is not one). */
export function formatRideDate(iso: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(`${iso}T00:00:00Z`)
  if (!Number.isFinite(date.getTime())) return null
  // "Sat, 4 Jul 2026" in en-GB: drop the comma the locale adds after the weekday.
  return dateFormat.format(date).replace(',', '')
}

export interface RideCaption {
  kind: 'leg' | 'rest' | 'start' | 'end'
  text: string
}

/**
 * What the HUD says the traveller is doing: the leg being travelled ("Lyon → Annecy"), a rest day
 * ("Resting in Lyon"), the start, or the end of the trip. `names` are the places' display names.
 */
export function rideCaption(sample: RideSample, names: readonly string[]): RideCaption {
  const name = (i: number) => names[i] ?? 'the next stop'
  if (sample.finished) return { kind: 'end', text: `Arrived in ${name(names.length - 1)}` }
  if (sample.legIndex !== null) return { kind: 'leg', text: `${name(sample.legIndex)} → ${name(sample.legIndex + 1)}` }
  if (sample.placeIndex === 0 && sample.distanceM === 0) return { kind: 'start', text: `Starting in ${name(0)}` }
  return { kind: 'rest', text: `Resting in ${name(sample.placeIndex)}` }
}
