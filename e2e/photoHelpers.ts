import type { Page } from '@playwright/test'
import { expect, type App } from './fixtures'
import { asFile, makePng, type Rgb } from './mocks/images'

/** Helpers shared by the photo specs (F11): rows, the place card, dragging files, what IndexedDB holds. */

export const row = (page: Page, i: number) => page.getByTestId('place-item').nth(i)
export const thumbs = (page: Page) => page.getByTestId('photo-thumb')
export const toasts = (page: Page) => page.getByTestId('toast')
export const card = (page: Page) => page.getByTestId('place-card')
export const viewer = (page: Page) => page.getByTestId('photo-viewer')

/** Open row `i` (it expands into search, address, note and photos). */
export async function expand(page: Page, i: number) {
  await row(page, i).getByTestId('place-main').click()
  await expect(page.getByTestId('place-photos')).toBeVisible()
}

const COLOURS: Rgb[] = [
  [200, 60, 50],
  [40, 110, 210],
  [30, 160, 90],
  [230, 170, 30],
  [140, 60, 190],
]

/** Add `count` small pictures (distinct colours) to place `i` through its row, and close the row again. */
export async function addPictures(page: Page, i: number, count: number) {
  await expand(page, i)
  const before = await thumbs(page).count()
  await page.getByTestId('photo-input').setInputFiles(
    Array.from({ length: count }, (_, n) => asFile(`pic-${n + 1}.png`, makePng(120 + n * 10, 80, COLOURS[n % COLOURS.length]), 'image/png')),
  )
  await expect(thumbs(page)).toHaveCount(before + count)
  await row(page, i).getByTestId('place-main').click()
  await expect(page.getByTestId('place-photos')).toHaveCount(0)
}

/** Click the marker of place `i` (fit the map to the trip first, so the markers are apart). */
export async function clickMarker(page: Page, app: App, i: number) {
  const place = (await app.trip()).places[i]
  const at = await app.screenPoint(place.lat, place.lng)
  await page.mouse.click(at.x, at.y)
}

export async function fitTrip(page: Page, app: App) {
  await page.getByTestId('fit-trip').click()
  await app.settle()
}

/** A DataTransfer holding files, like the one a file manager drags over the page. */
export function fileDrag(page: Page, files: { name: string; type: string; buffer: Buffer }[]) {
  return page.evaluateHandle(
    (list) => {
      const dt = new DataTransfer()
      for (const f of list) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))
        dt.items.add(new File([bytes], f.name, { type: f.type }))
      }
      return dt
    },
    files.map((f) => ({ name: f.name, type: f.type, base64: f.buffer.toString('base64') })),
  )
}

/** What IndexedDB holds: the ids of every stored photo (none while the app has not created its database yet). */
export const storedIds = (page: Page) =>
  page.evaluate(async () => {
    // Opening a database that does not exist would create it, empty, behind the app's back.
    if (!(await indexedDB.databases()).some((db) => db.name === 'roadmap-overview')) return []
    return new Promise<string[]>((resolve, reject) => {
      const open = indexedDB.open('roadmap-overview')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const request = open.result.transaction('photos').objectStore('photos').getAllKeys()
        request.onsuccess = () => {
          open.result.close()
          resolve(request.result.map(String))
        }
      }
    })
  })

/** Put a record into IndexedDB as an old, unreferenced photo would be (a tiny JPEG made by the page), optionally with a garbage-collection mark. */
export const seedStored = (page: Page, id: string, createdAt: number, unreferencedSince?: number) =>
  page.evaluate(
    async ([photoId, created, since]) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 8
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg'))
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('roadmap-overview')
        r.onsuccess = () => resolve(r.result)
      })
      const tx = db.transaction(['photos', 'unreferenced'], 'readwrite')
      tx.objectStore('photos').put({ id: photoId, blob, thumb: blob, width: 8, height: 8, createdAt: created })
      if (typeof since === 'number') tx.objectStore('unreferenced').put({ id: photoId, since })
      await new Promise((resolve) => (tx.oncomplete = resolve))
      db.close()
    },
    [id, createdAt, unreferencedSince ?? null] as const,
  )

/** The garbage-collection marks in IndexedDB: photo id to the time it was first found without a reference. */
export const storedMarks = (page: Page) =>
  page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((db) => db.name === 'roadmap-overview')) return {} as Record<string, number>
    return new Promise<Record<string, number>>((resolve, reject) => {
      const open = indexedDB.open('roadmap-overview')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const request = open.result.transaction('unreferenced').objectStore('unreferenced').getAll()
        request.onsuccess = () => {
          open.result.close()
          resolve(Object.fromEntries((request.result as { id: string; since: number }[]).map((m) => [m.id, m.since])))
        }
      }
    })
  })
