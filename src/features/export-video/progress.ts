// Framework-free: the progress bar and the time left.

export type VideoPhase = 'map' | 'frames' | 'finishing'

export interface VideoProgress {
  phase: VideoPhase
  done: number
  total: number
}

/** Shares of the bar: loading the map's tiles, drawing and encoding the frames, closing the file. */
const MAP_SHARE = 0.1
const FINISH_SHARE = 0.03

const ratio = (done: number, total: number) => (total > 0 ? Math.min(1, Math.max(0, done / total)) : 0)

/** How far along the whole job is, 0 … 1. */
export function overallProgress({ phase, done, total }: VideoProgress): number {
  if (phase === 'map') return MAP_SHARE * ratio(done, total)
  if (phase === 'frames') return MAP_SHARE + (1 - MAP_SHARE - FINISH_SHARE) * ratio(done, total)
  return 1 - FINISH_SHARE * (1 - ratio(done, total))
}

/**
 * Seconds left, from how long the frames drawn so far took; null until there is enough to go by (a second of work or a
 * twentieth of it), so the first guess is not wild.
 */
export function estimateRemainingS(done: number, total: number, elapsedMs: number): number | null {
  if (done <= 0 || total <= done) return total > 0 && done >= total ? 0 : null
  if (elapsedMs < 1000 && done / total < 0.05) return null
  return ((elapsedMs / done) * (total - done)) / 1000
}

/** "about 20 seconds left", "about 2 minutes left", "less than 5 seconds left". */
export function formatRemaining(seconds: number | null): string {
  if (seconds === null) return 'Estimating the time left…'
  if (seconds < 5) return 'Less than 5 seconds left'
  if (seconds < 90) return `About ${Math.round(seconds / 5) * 5} seconds left`
  const minutes = Math.round(seconds / 60)
  return `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`
}

/** "0:07", "1:30" for a length in seconds. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
