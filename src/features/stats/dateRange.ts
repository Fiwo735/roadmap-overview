import { isCalendarDate } from '../../lib/trip'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m: m - 1, d }
}

/** `date` (YYYY-MM-DD) moved by `n` calendar days, as YYYY-MM-DD. */
export function addDays(date: string, n: number): string {
  const { y, m, d } = parts(date)
  return new Date(Date.UTC(y, m, d) + n * DAY_MS).toISOString().slice(0, 10)
}

/**
 * The dates a trip of `days` days starting on `startDate` covers, written the short English way:
 * "1 – 14 Jul 2026", "28 Jun – 3 Jul 2026", "28 Dec 2026 – 3 Jan 2027", or "1 Jul 2026" for one day.
 * Empty when `startDate` is not a real date. Locale independent on purpose, so it reads the same in
 * the exported image as on screen.
 */
export function formatDateRange(startDate: string, days: number): string {
  if (!isCalendarDate(startDate)) return ''
  const first = parts(startDate)
  const last = parts(addDays(startDate, Math.max(1, days) - 1))
  const month = (p: { m: number }) => MONTHS[p.m]
  if (first.y === last.y && first.m === last.m && first.d === last.d) return `${first.d} ${month(first)} ${first.y}`
  if (first.y === last.y && first.m === last.m) return `${first.d} – ${last.d} ${month(last)} ${last.y}`
  if (first.y === last.y) return `${first.d} ${month(first)} – ${last.d} ${month(last)} ${last.y}`
  return `${first.d} ${month(first)} ${first.y} – ${last.d} ${month(last)} ${last.y}`
}
