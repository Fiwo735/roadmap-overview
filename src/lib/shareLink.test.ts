import { decompressFromEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import type { LegRoute, Trip } from '../types/trip'
import { encodePolyline } from './polyline'
import { legRouteKey } from './routeKey'
import {
  LONG_SHARE_LINK_CHARS,
  MAX_SHARE_PAYLOAD_CHARS,
  SHARE_HASH_PREFIX,
  buildShareUrl,
  decodeShareHash,
  encodeShareHash,
  isLongShareLink,
  isOpenableShareLink,
  isShareHash,
} from './shareLink'
import { parseTripFile, serializeTripFile } from './tripFile'

function trip(): Trip {
  return {
    id: 't1',
    title: 'Flåm → Ørsta ✓',
    subtitle: 'Fjords',
    startDate: '2027-06-19',
    places: [
      { id: 'a', name: 'Flåm', lat: 60.8625, lng: 7.1141, day: 0, note: 'Railway', customName: true },
      { id: 'b', name: 'Geiranger', lat: 62.1008, lng: 7.2057, day: 2 },
      { id: 'c', name: 'Oslo', lat: 59.9127, lng: 10.7461, day: 3 },
    ],
    legs: [
      { id: 'l1', fromId: 'a', toId: 'b', mode: 'drive', via: [{ lat: 61.5, lng: 7 }] },
      { id: 'l2', fromId: 'b', toId: 'c', mode: 'ferry', via: [], label: 'Boat', durationMin: 90 },
    ],
  }
}

function routeFor(t: Trip, i: number): LegRoute {
  const [a, b] = [t.places[i], t.places[i + 1]]
  return {
    key: legRouteKey(a, b, t.legs[i]),
    geometry: encodePolyline([a, { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 + 0.2 }, b]),
    distanceM: 1000,
    durationS: 60,
    source: 'osrm',
  }
}

describe('share hash', () => {
  it('round-trips a trip through the hash', () => {
    const t = trip()
    const hash = encodeShareHash(serializeTripFile(t))
    expect(isShareHash(hash)).toBe(true)
    expect(hash.startsWith(SHARE_HASH_PREFIX)).toBe(true)

    const decoded = decodeShareHash(hash)
    expect(decoded.ok).toBe(true)
    const parsed = decoded.ok ? parseTripFile(decoded.data) : null
    expect(parsed?.ok && parsed.file.trip).toEqual(t)
    expect(parsed?.ok && parsed.warnings).toEqual([])
  })

  it('leaves the cached routes out, so the link stays short', () => {
    const t = trip()
    const withRoutes = serializeTripFile(t, { l1: routeFor(t, 0) })
    expect(withRoutes.routes).toHaveProperty('l1')
    const hash = encodeShareHash(withRoutes)

    // Same link as for the file without routes.
    expect(hash).toBe(encodeShareHash({ ...withRoutes, routes: {} }))
    const text = decompressFromEncodedURIComponent(hash.slice(SHARE_HASH_PREFIX.length))
    expect(JSON.parse(text)).not.toHaveProperty('routes')

    const decoded = decodeShareHash(hash)
    const parsed = decoded.ok ? parseTripFile(decoded.data) : null
    expect(parsed?.ok && parsed.file.routes).toEqual({})
  })

  it('uses only characters that survive in a URL hash', () => {
    const hash = encodeShareHash(serializeTripFile(trip()))
    expect(hash.slice(SHARE_HASH_PREFIX.length)).toMatch(/^[A-Za-z0-9+\-$]+$/)
  })

  it('rejects hashes that are not share links', () => {
    for (const hash of ['', '#', '#map=1', '#Trip=abc', 'trip=abc']) {
      expect(isShareHash(hash)).toBe(false)
      expect(decodeShareHash(hash)).toEqual({ ok: false, error: 'This is not a trip link.' })
    }
  })

  it('reports damaged links instead of throwing', () => {
    const damaged = { ok: false, error: 'This share link is damaged or incomplete.' }
    expect(decodeShareHash('#trip=')).toEqual(damaged)
    expect(decodeShareHash('#trip=!!!not-a-link!!!')).toEqual(damaged)
    const hash = encodeShareHash(serializeTripFile(trip()))
    // A link cut off in a chat app.
    expect(decodeShareHash(hash.slice(0, Math.floor(hash.length / 2)))).toEqual(damaged)
  })

  it('still hands data that is not a trip to parseTripFile, which rejects it', () => {
    const hash = SHARE_HASH_PREFIX + 'N4Ig5gpgNgDgrgYwAQHYCuA7ALgSwPYBcATgM4AuAhgCZwA'
    const decoded = decodeShareHash(hash)
    const parsed = decoded.ok ? parseTripFile(decoded.data) : decoded
    expect(parsed.ok).toBe(false)
  })

  it('refuses payloads beyond the cap without decompressing them', () => {
    const tooLarge = { ok: false, error: 'This share link is too large to open.' }
    expect(decodeShareHash(SHARE_HASH_PREFIX + 'A'.repeat(MAX_SHARE_PAYLOAD_CHARS + 1))).toEqual(tooLarge)
    expect(decodeShareHash(SHARE_HASH_PREFIX + 'A'.repeat(2_000_001))).toEqual(tooLarge)
    // At the cap it is looked at (and found to be rubbish), not refused for its size.
    expect(decodeShareHash(SHARE_HASH_PREFIX + 'A'.repeat(MAX_SHARE_PAYLOAD_CHARS))).not.toEqual(tooLarge)
  })

  it('treats a link that unpacks to something huge as damaged', () => {
    // The packer is far too slow to make a real one in a test: let the unpacker claim to have made 6 MB.
    const damaged = { ok: false, error: 'This share link is damaged or incomplete.' }
    expect(decodeShareHash(SHARE_HASH_PREFIX + 'abc', () => '{"a":"' + 'x'.repeat(6_000_000) + '"}')).toEqual(damaged)
    // Just under the limit is fine (and is then parsed as JSON).
    const big = '"' + 'x'.repeat(4_999_000) + '"'
    expect(decodeShareHash(SHARE_HASH_PREFIX + 'abc', () => big)).toEqual({ ok: true, data: 'x'.repeat(4_999_000) })
  })

  it('treats a link whose unpacking throws or returns nothing as damaged, never as an exception', () => {
    const damaged = { ok: false, error: 'This share link is damaged or incomplete.' }
    const boom = () => {
      throw new RangeError('Invalid string length')
    }
    expect(decodeShareHash(SHARE_HASH_PREFIX + 'abc', boom)).toEqual(damaged)
    expect(decodeShareHash(SHARE_HASH_PREFIX + 'abc', () => null)).toEqual(damaged)
    expect(decodeShareHash(SHARE_HASH_PREFIX + 'abc', () => '')).toEqual(damaged)
    expect(decodeShareHash(SHARE_HASH_PREFIX + 'abc', () => '{"half": ')).toEqual(damaged)
    // And the real unpacker on rubbish.
    for (const payload of ['\u0000\u0001\u0002', '%%%%', '€€€€€€€€', 'Ä'.repeat(500)]) {
      expect(decodeShareHash(SHARE_HASH_PREFIX + payload)).toEqual(damaged)
    }
  })
})

describe('isOpenableShareLink', () => {
  it('is true for what the app writes and false beyond what it would open again', () => {
    expect(isOpenableShareLink(buildShareUrl(serializeTripFile(trip()), 'https://example.org/'))).toBe(true)
    expect(isOpenableShareLink('https://example.org/' + SHARE_HASH_PREFIX + 'x'.repeat(MAX_SHARE_PAYLOAD_CHARS))).toBe(true)
    expect(isOpenableShareLink('https://example.org/' + SHARE_HASH_PREFIX + 'x'.repeat(MAX_SHARE_PAYLOAD_CHARS + 1))).toBe(false)
    expect(isOpenableShareLink('https://example.org/')).toBe(false)
  })
})

describe('buildShareUrl', () => {
  it('keeps the page address and replaces query and hash', () => {
    const file = serializeTripFile(trip())
    const url = buildShareUrl(file, 'https://example.org/roadmap/?src=https%3A%2F%2Fx.test%2Ft.json&a=1#old')
    expect(url.startsWith('https://example.org/roadmap/#trip=')).toBe(true)
    expect(url).not.toContain('src=')
    const decoded = decodeShareHash(new URL(url).hash)
    expect(decoded.ok).toBe(true)
  })

  it('works for a local dev address', () => {
    const url = buildShareUrl(serializeTripFile(trip()), 'http://127.0.0.1:5173/')
    expect(url.startsWith('http://127.0.0.1:5173/#trip=')).toBe(true)
  })
})

describe('isLongShareLink', () => {
  it('flags links beyond the threshold and a many-stop trip produces one', () => {
    expect(isLongShareLink('x'.repeat(LONG_SHARE_LINK_CHARS))).toBe(false)
    expect(isLongShareLink('x'.repeat(LONG_SHARE_LINK_CHARS + 1))).toBe(true)

    const short = buildShareUrl(serializeTripFile(trip()), 'https://example.org/')
    expect(isLongShareLink(short)).toBe(false)

    // 300 stops with unpredictable coordinates compress badly.
    let seed = 1
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const places = Array.from({ length: 300 }, (_, i) => ({
      id: `p${i}`,
      name: `Stop ${i}`,
      lat: 40 + random() * 20,
      lng: random() * 20,
      day: i,
    }))
    const legs = places.slice(1).map((p, i) => ({ id: `l${i}`, fromId: places[i].id, toId: p.id, mode: 'drive' as const, via: [] }))
    const big = buildShareUrl(serializeTripFile({ id: 'big', title: 'Big', places, legs }), 'https://example.org/')
    expect(isLongShareLink(big)).toBe(true)
  })
})
