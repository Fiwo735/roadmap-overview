import { describe, expect, it } from 'vitest'
import { addDays, formatDateRange } from './dateRange'

describe('addDays', () => {
  it('moves across months, years and leap days', () => {
    expect(addDays('2026-07-01', 13)).toBe('2026-07-14')
    expect(addDays('2026-07-30', 3)).toBe('2026-08-02')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('formatDateRange', () => {
  it('writes the days of one month as "1 – 14 Jul 2026"', () => {
    expect(formatDateRange('2026-07-01', 14)).toBe('1 – 14 Jul 2026')
  })

  it('writes a range over two months and over a new year', () => {
    expect(formatDateRange('2026-06-28', 6)).toBe('28 Jun – 3 Jul 2026')
    expect(formatDateRange('2026-12-28', 7)).toBe('28 Dec 2026 – 3 Jan 2027')
  })

  it('writes a one-day trip as a single date, also for 0 days (no places)', () => {
    expect(formatDateRange('2026-07-01', 1)).toBe('1 Jul 2026')
    expect(formatDateRange('2026-07-01', 0)).toBe('1 Jul 2026')
  })

  it('is empty for something that is not a calendar date', () => {
    expect(formatDateRange('2026-02-30', 3)).toBe('')
    expect(formatDateRange('soon', 3)).toBe('')
  })
})
