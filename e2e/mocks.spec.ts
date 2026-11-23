import { haversineM } from '../src/lib/geo'
import { decodePolyline } from '../src/lib/polyline'
import { expect, findPlace, test } from './fixtures'

/** Sanity checks for the service mocks themselves, as seen from the page (CORS included). */

const osrmUrl = (...names: string[]) => {
  const coords = names.map((n) => findPlace(n)).map((p) => `${p.lng},${p.lat}`).join(';')
  return `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=polyline`
}

test.beforeEach(async ({ app }) => {
  await app.goto()
})

test('OSRM mock returns a realistic route through the requested coordinates', async ({ page, mocks }) => {
  const data = await page.evaluate((url) => fetch(url).then((r) => r.json()), osrmUrl('Berlin', 'Prague', 'Vienna'))
  expect(data.code).toBe('Ok')
  expect(data.routes).toHaveLength(1)
  expect(data.routes[0].legs).toHaveLength(2)
  expect(data.waypoints).toHaveLength(3)
  expect(data.waypoints[0].location).toEqual([findPlace('Berlin').lng, findPlace('Berlin').lat])

  const berlin = findPlace('Berlin')
  const prague = findPlace('Prague')
  const vienna = findPlace('Vienna')
  const crow = haversineM(berlin, prague) + haversineM(prague, vienna)
  expect(data.routes[0].distance / crow).toBeCloseTo(1.25, 1)
  expect(data.routes[0].duration).toBeCloseTo((data.routes[0].distance / 1000 / 75) * 3600, -1)

  const line = decodePolyline(data.routes[0].geometry)
  expect(line.length).toBeGreaterThan(20)
  expect(line[0].lat).toBeCloseTo(berlin.lat, 4)
  expect(line.at(-1)!.lng).toBeCloseTo(vienna.lng, 4)
  // Passes through the intermediate stop too.
  const nearPrague = Math.min(...line.map((p) => haversineM(p, prague)))
  expect(nearPrague).toBeLessThan(50)

  expect(mocks.osrm.requests).toHaveLength(1)
})

test('OSRM mock returns steps on request, with a ferry step between Dover and Calais', async ({ page }) => {
  const get = (url: string) => page.evaluate((u) => fetch(u).then((r) => r.json()), url)
  const plain = await get(osrmUrl('Lyon', 'Annecy'))
  expect(plain.routes[0].legs[0].steps).toEqual([])

  const withSteps = await get(`${osrmUrl('Lyon', 'Annecy')}&steps=true`)
  expect(withSteps.routes[0].legs[0].steps.map((s: { mode: string }) => s.mode)).toEqual(['driving'])

  const ferry = await get(`${osrmUrl('Dover', 'Calais')}&steps=true`)
  const steps = ferry.routes[0].legs[0].steps as Array<{ mode: string; duration: number; geometry: string }>
  expect(steps.map((s) => s.mode)).toEqual(['driving', 'ferry', 'driving'])
  expect(steps[1].duration).toBe(2_090)
  // The overview is exactly what the steps trace together.
  const traced = steps.flatMap((s, i) => decodePolyline(s.geometry).slice(i === 0 ? 0 : 1))
  expect(decodePolyline(ferry.routes[0].geometry)).toHaveLength(traced.length)
  // And it works in the other direction too.
  const back = await get(`${osrmUrl('Calais', 'Dover')}&steps=true`)
  expect(back.routes[0].legs[0].steps.map((s: { mode: string }) => s.mode)).toEqual(['driving', 'ferry', 'driving'])
})

test('OSRM mock can be told to fail', async ({ page, mocks }) => {
  mocks.osrm.failWith = 'NoRoute'
  const data = await page.evaluate((url) => fetch(url).then((r) => r.json()), osrmUrl('Berlin', 'Prague'))
  expect(data.code).toBe('NoRoute')

  mocks.osrm.failWith = 'http-500'
  const status = await page.evaluate((url) => fetch(url).then((r) => r.status), osrmUrl('Berlin', 'Prague'))
  expect(status).toBe(500)
})

test('Nominatim mock searches the gazetteer (jsonv2 shape)', async ({ page, mocks }) => {
  const url = 'https://nominatim.openstreetmap.org/search?q=Lyon&format=jsonv2&addressdetails=1&limit=5'
  const results = await page.evaluate((u) => fetch(u).then((r) => r.json()), url)
  expect(results.length).toBeGreaterThan(0)
  const lyon = results[0]
  expect(typeof lyon.lat).toBe('string')
  expect(typeof lyon.lon).toBe('string')
  expect(lyon.name).toBe('Lyon')
  expect(lyon.display_name).toContain('France')
  expect(lyon.address).toMatchObject({ city: 'Lyon', country: 'France', country_code: 'fr' })
  expect(mocks.nominatim.requests).toHaveLength(1)

  const unknown = await page.evaluate(
    (u) => fetch(u).then((r) => r.json()),
    'https://nominatim.openstreetmap.org/search?q=Atlantis&format=jsonv2',
  )
  expect(unknown).toEqual([])
})

test('Nominatim mock offers homonyms and accent-insensitive search', async ({ page }) => {
  const paris = await page.evaluate(
    (u) => fetch(u).then((r) => r.json()),
    'https://nominatim.openstreetmap.org/search?q=Paris&format=jsonv2&addressdetails=1',
  )
  expect(paris.map((r: { address: { country_code: string } }) => r.address.country_code)).toEqual(['fr', 'us'])

  const munich = await page.evaluate(
    (u) => fetch(u).then((r) => r.json()),
    'https://nominatim.openstreetmap.org/search?q=M%C3%BCnchen&format=jsonv2',
  )
  expect(munich[0].name).toBe('Munich')
})

test('Nominatim mock reverse-geocodes near a gazetteer place and fails far from any', async ({ page }) => {
  const annecy = findPlace('Annecy')
  const near = await page.evaluate(
    (u) => fetch(u).then((r) => r.json()),
    `https://nominatim.openstreetmap.org/reverse?lat=${annecy.lat + 0.05}&lon=${annecy.lng}&format=jsonv2&addressdetails=1`,
  )
  expect(near.name).toBe('Annecy')
  expect(near.address.country_code).toBe('fr')

  const sea = await page.evaluate(
    (u) => fetch(u).then((r) => r.json()),
    'https://nominatim.openstreetmap.org/reverse?lat=45&lon=-30&format=jsonv2',
  )
  expect(sea).toEqual({ error: 'Unable to geocode' })
})

test('requests to any other external host are blocked', async ({ page, mocks }) => {
  const outcome = await page.evaluate(() =>
    fetch('https://example.com/').then(
      () => 'ok',
      () => 'blocked',
    ),
  )
  expect(outcome).toBe('blocked')
  expect(mocks.blocked).toEqual(['https://example.com/'])
  mocks.blocked.length = 0
})

test('the tile mock sends CORS headers, so a canvas drawn with its tiles can be read back', async ({ page, mocks }) => {
  const url = 'https://tile.openstreetmap.org/5/16/11.png'
  // What the image export does: a crossOrigin image on a canvas that is then read.
  const readable = await page.evaluate(
    (u) =>
      new Promise<boolean>((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 256
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0)
          try {
            ctx.getImageData(0, 0, 1, 1)
            resolve(true)
          } catch {
            resolve(false) // SecurityError: the canvas is tainted
          }
        }
        img.onerror = () => resolve(false)
        img.src = `${u}?probe`
      }),
    url,
  )
  expect(readable).toBe(true)
  expect(mocks.tiles.urls).toContain(`${url}?probe`)
})
