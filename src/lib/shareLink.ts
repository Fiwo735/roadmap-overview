import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { TripFile } from '../types/trip'

/** Share links carry the trip in the URL hash: `https://app/#trip=<compressed TripFile>`. */
export const SHARE_HASH_PREFIX = '#trip='

/** Longer links may be cut off by chat apps or old browsers: the UI then suggests the JSON file. */
export const LONG_SHARE_LINK_CHARS = 8_000

/** The most hash we are willing to decompress; a 500-stop trip is far below it (the sample is 3 000). */
export const MAX_SHARE_PAYLOAD_CHARS = 100_000
/** The most text a link may unpack to; anything bigger is treated as a damaged (or hostile) link. */
const MAX_UNPACKED_CHARS = 5_000_000

export const isShareHash = (hash: string): boolean => hash.startsWith(SHARE_HASH_PREFIX)

/**
 * `#trip=…` for `file`. Cached routes are left out: they are big, and the receiving app derives
 * them again (the link stays short, the file is the way to share routes).
 */
export function encodeShareHash(file: TripFile): string {
  const { routes: _routes, ...withoutRoutes } = file
  return SHARE_HASH_PREFIX + compressToEncodedURIComponent(JSON.stringify(withoutRoutes))
}

/** The shareable address of this page for `file`: the page URL minus query and old hash, plus the trip. */
export function buildShareUrl(file: TripFile, pageUrl: string): string {
  const url = new URL(pageUrl)
  return `${url.origin}${url.pathname}${encodeShareHash(file)}`
}

export const isLongShareLink = (url: string): boolean => url.length > LONG_SHARE_LINK_CHARS

/** Can this app open the link again? (It refuses to unpack hashes beyond `MAX_SHARE_PAYLOAD_CHARS`.) */
export function isOpenableShareLink(url: string): boolean {
  const at = url.indexOf(SHARE_HASH_PREFIX)
  return at >= 0 && url.length - at - SHARE_HASH_PREFIX.length <= MAX_SHARE_PAYLOAD_CHARS
}

export type DecodeShareResult = { ok: true; data: unknown } | { ok: false; error: string }

/**
 * Unpack a `#trip=…` hash into the JSON it carries (still untrusted: feed it to `parseTripFile`).
 * `decompress` is the unpacking function (a seam for tests).
 */
export function decodeShareHash(
  hash: string,
  decompress: (payload: string) => string | null = decompressFromEncodedURIComponent,
): DecodeShareResult {
  if (!isShareHash(hash)) return { ok: false, error: 'This is not a trip link.' }
  const payload = hash.slice(SHARE_HASH_PREFIX.length)
  if (payload.length > MAX_SHARE_PAYLOAD_CHARS) return { ok: false, error: 'This share link is too large to open.' }
  const damaged = { ok: false, error: 'This share link is damaged or incomplete.' } as const
  try {
    const text = decompress(payload)
    if (!text || text.length > MAX_UNPACKED_CHARS) return damaged
    return { ok: true, data: JSON.parse(text) as unknown }
  } catch {
    return damaged
  }
}
