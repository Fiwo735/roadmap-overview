import { toast } from '../../components/toast'
import { buildShareUrl, isLongShareLink, isOpenableShareLink } from '../../lib/shareLink'
import { collectLegRoutes, serializeTripFile } from '../../lib/tripFile'
import { stringifyTripFile, tripFileName } from '../../lib/tripFileIo'
import { useRouteStore } from '../../store/routeStore'
import { useTripStore } from '../../store/tripStore'
import type { TripFile } from '../../types/trip'

/** The current trip as a file, with the cached routes of its current legs unless `withRoutes` is false. */
export function currentTripFile(withRoutes = true): TripFile {
  const { trip } = useTripStore.getState()
  return serializeTripFile(trip, withRoutes ? collectLegRoutes(trip, useRouteStore.getState().routes) : {})
}

const hasPlaces = (): boolean => useTripStore.getState().trip.places.length > 0

function download(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  // Revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Save the trip, routes included, as `<title>.trip.json`. */
export function saveTripFile(): void {
  if (!hasPlaces()) {
    toast.info('There is nothing to save yet. Add a place first.')
    return
  }
  const name = tripFileName(useTripStore.getState().trip.title)
  download(stringifyTripFile(currentTripFile()), name, 'application/json')
  toast.success(`Saved ${name}`)
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // No clipboard API (insecure page) or permission refused: fall back to the old way.
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.append(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}

/**
 * Copy a link that opens this trip (without its routes, which the receiver derives again). With `present`
 * the link opens in presentation mode: the map, the title card and the ride, without the editing tools.
 */
export async function copyShareLink({ present = false } = {}): Promise<void> {
  if (!hasPlaces()) {
    toast.info('There is nothing to share yet. Add a place first.')
    return
  }
  const url = buildShareUrl(currentTripFile(false), window.location.href, { present })
  if (!isOpenableShareLink(url)) {
    toast.error('This trip is too big for a share link. Save it as a JSON file (File → Save as JSON) and share that.')
    return
  }
  if (!(await copyText(url))) {
    toast.error('Your browser did not allow copying to the clipboard.')
    return
  }
  if (isLongShareLink(url)) {
    toast.info(
      `Link copied, but it is very long (${url.length.toLocaleString('en-US')} characters) and some apps may cut it off. Sharing the JSON file (File → Save as JSON) is safer.`,
      { duration: 12_000 },
    )
  } else {
    toast.success(present ? 'Presentation link copied to the clipboard.' : 'Share link copied to the clipboard.')
  }
}
