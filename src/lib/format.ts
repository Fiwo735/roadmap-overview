const GROUP_SEPARATOR = ' '

function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR)
}

/** "850 m", "2.4 km", "1 234 km". Non-finite or negative input renders as an em dash. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—'
  // Round first so 999.6 m reads "1 km", not "1000 m".
  const m = Math.round(meters)
  if (m < 1000) return `${m} m`
  const km = m / 1000
  if (km < 10) {
    const rounded = Math.round(km * 10) / 10
    // 9.96 km rounds up to 10: show it as a whole number from there on.
    if (rounded < 10) return `${rounded} km`
  }
  return `${group(Math.round(km))} km`
}

/**
 * "45 min", "3 h 40 min", "34 h 5 min". Travel times are always written in hours, never days: "34 h" reads as
 * the length of a drive, "1 d 10 h" as a calendar span. Non-finite or negative input renders as an em dash.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const totalMin = Math.round(seconds / 60)
  if (totalMin < 60) return `${totalMin} min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${group(h)} h` : `${group(h)} h ${m} min`
}
