import type { TripFile } from '../types/trip'
import { parseTripFile, type ParseTripFileResult } from './tripFile'

export const TRIP_FILE_EXTENSION = '.trip.json'

/** Windows refuses these as file names, with any extension. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/

/**
 * A file-name-safe form of `text`: lower case, accents removed, every run of other characters
 * (anything that is not a letter or digit, in any script) becomes one "-". May be empty.
 */
export function slugify(text: string, maxLength = 60): string {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+/, '')
  return slug.slice(0, maxLength).replace(/-+$/, '')
}

/** "Alps & back!" → "alps-back.trip.json" (a title with nothing usable becomes "trip"). */
export function tripFileName(title: string): string {
  const slug = slugify(title) || 'trip'
  return (RESERVED_NAMES.test(slug) ? `${slug}-trip` : slug) + TRIP_FILE_EXTENSION
}

/** The text of a saved trip file: pretty-printed so it diffs and reads well. */
export function stringifyTripFile(file: TripFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/** `parseTripFile` for the text of a file or a download: invalid JSON is an error, not an exception. */
export function parseTripJson(text: string): ParseTripFileResult {
  const trimmed = text.replace(/^﻿/, '').trim()
  if (!trimmed) return { ok: false, error: 'The file is empty.' }
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'This is not a trip file: it is not valid JSON.' }
  }
  return parseTripFile(data)
}
