import { describe, expect, it } from 'vitest'
import type { LegRoute, Trip } from '../types/trip'
import { encodePolyline } from './polyline'
import { legRouteKey } from './routeKey'
import { serializeTripFile } from './tripFile'
import { parseTripJson, slugify, stringifyTripFile, tripFileName } from './tripFileIo'

function trip(): Trip {
  return {
    id: 't1',
    title: 'Summer',
    places: [
      { id: 'a', name: 'Berlin', lat: 52.52, lng: 13.405, day: 0 },
      { id: 'b', name: 'Prague', lat: 50.0755, lng: 14.4378, day: 1 },
    ],
    legs: [{ id: 'l1', fromId: 'a', toId: 'b', mode: 'drive', via: [] }],
  }
}

function route(t: Trip): LegRoute {
  const [a, b] = t.places
  return {
    key: legRouteKey(a, b, t.legs[0]),
    geometry: encodePolyline([a, { lat: 51.3, lng: 14 }, b]),
    distanceM: 350_000,
    durationS: 12_000,
    source: 'osrm',
  }
}

describe('slugify', () => {
  it('lower-cases, drops accents and joins words with dashes', () => {
    expect(slugify('Hamburg to the Norwegian fjords')).toBe('hamburg-to-the-norwegian-fjords')
    expect(slugify('Crème brûlée, Zürich & São Paulo!')).toBe('creme-brulee-zurich-sao-paulo')
    expect(slugify('  --Alps__2027--  ')).toBe('alps-2027')
  })

  it('keeps letters of other scripts and digits', () => {
    expect(slugify('日本 旅行 2027')).toBe('日本-旅行-2027')
    expect(slugify('Москва — Санкт-Петербург')).toBe('москва-санкт-петербург')
  })

  it('never produces path separators, dots or trailing dashes', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
    expect(slugify('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(slugify('x'.repeat(100) + ' tail', 20)).toBe('x'.repeat(20))
    expect(slugify('abcde fghij', 6)).toBe('abcde')
  })

  it('returns an empty string when nothing usable is left', () => {
    expect(slugify('')).toBe('')
    expect(slugify('!!! ???')).toBe('')
  })
})

describe('tripFileName', () => {
  it('adds the .trip.json extension', () => {
    expect(tripFileName('Hamburg to the Norwegian fjords')).toBe('hamburg-to-the-norwegian-fjords.trip.json')
  })

  it('falls back to "trip" for an empty or unusable title', () => {
    expect(tripFileName('')).toBe('trip.trip.json')
    expect(tripFileName('???')).toBe('trip.trip.json')
  })

  it('avoids names Windows reserves', () => {
    expect(tripFileName('CON')).toBe('con-trip.trip.json')
    expect(tripFileName('lpt1')).toBe('lpt1-trip.trip.json')
    expect(tripFileName('console')).toBe('console.trip.json')
  })
})

describe('stringifyTripFile / parseTripJson', () => {
  it('writes readable JSON that parses back to the same trip and routes', () => {
    const t = trip()
    const file = serializeTripFile(t, { l1: route(t) })
    const text = stringifyTripFile(file)
    expect(text).toContain('\n  "format": "roadmap-overview/trip"')
    expect(text.endsWith('}\n')).toBe(true)

    const parsed = parseTripJson(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.warnings).toEqual([])
    expect(parsed.file.trip).toEqual(t)
    // The route is trusted because its key matches the one recomputed from the trip.
    expect(parsed.file.routes).toEqual({ l1: route(t) })
  })

  it('drops a route whose key no longer matches the trip, without complaint', () => {
    const t = trip()
    const stale = { ...route(t), key: 'drive;1,1;2,2' }
    const parsed = parseTripJson(stringifyTripFile(serializeTripFile(t, { l1: stale })))
    expect(parsed.ok && parsed.file.routes).toEqual({})
    expect(parsed.ok && parsed.warnings).toEqual([])
  })

  it('accepts a byte-order mark and surrounding whitespace', () => {
    const parsed = parseTripJson(`﻿\n  ${stringifyTripFile(serializeTripFile(trip()))}  \n`)
    expect(parsed.ok).toBe(true)
  })

  it('explains empty files and invalid JSON', () => {
    expect(parseTripJson('')).toEqual({ ok: false, error: 'The file is empty.' })
    expect(parseTripJson('   \n')).toEqual({ ok: false, error: 'The file is empty.' })
    expect(parseTripJson('{"format": ')).toEqual({ ok: false, error: 'This is not a trip file: it is not valid JSON.' })
    expect(parseTripJson('<html></html>')).toMatchObject({ ok: false })
  })

  it('rejects JSON that is not a trip file', () => {
    expect(parseTripJson('[]')).toEqual({ ok: false, error: 'This is not a Roadmap Overview trip file.' })
    expect(parseTripJson('{"format":"something-else","version":1}')).toEqual({
      ok: false,
      error: 'This is not a Roadmap Overview trip file.',
    })
  })

  it('gives a clear error for a file from a newer version, and for an unsupported one', () => {
    const file = JSON.parse(stringifyTripFile(serializeTripFile(trip())))
    expect(parseTripJson(JSON.stringify({ ...file, version: 2 }))).toEqual({
      ok: false,
      error: 'This trip was saved by a newer version of Roadmap Overview.',
    })
    expect(parseTripJson(JSON.stringify({ ...file, version: 0 }))).toEqual({
      ok: false,
      error: 'This trip file has an unsupported version.',
    })
    expect(parseTripJson(JSON.stringify({ ...file, version: '1' }))).toMatchObject({ ok: false })
  })
})
