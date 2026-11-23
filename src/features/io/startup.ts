import { toast } from '../../components/toast'
import { decodeShareHash, isShareHash, wantsPresentation } from '../../lib/shareLink'
import { parseTripFile } from '../../lib/tripFile'
import { parseTripJson } from '../../lib/tripFileIo'
import { fetchTripText, resolveSourceUrl, TripSourceError } from '../../services/tripSource'
import { useTripStore } from '../../store/tripStore'
import { enterPresentation } from '../presentation/presentationStore'
import { offerLinkedTrip, openLinkedTrip } from './importTrip'

/**
 * Remove what was opened from the address bar (the `#trip=` hash, the `?src=` parameter) without
 * reloading or adding a history entry: a reload must not import it again over the user's edits.
 * Other parameters stay.
 */
function cleanAddress({ hash = false, src = false, present = false }: { hash?: boolean; src?: boolean; present?: boolean }): void {
  const url = new URL(window.location.href)
  if (hash) url.hash = ''
  if (src) url.searchParams.delete('src')
  // A link that asked for presentation mode (`&present` after the trip) keeps asking as `?present`, so a
  // reload presents again; leaving presentation mode takes it out (presentationStore.ts).
  if (present && !url.searchParams.has('present')) url.searchParams.set('present', '')
  const search = url.search.replace(/([?&]present)=(?=&|$)/, '$1')
  window.history.replaceState(window.history.state, '', `${url.pathname}${search}${url.hash}`)
}

/** Open the trip in a `#trip=…` hash. The hash is removed afterwards so a reload does not import it again. */
function openShareHash(hash: string, atStart: boolean): void {
  // Also a `src` that came with the link: the link wins, and a reload must not fetch it either.
  cleanAddress({ hash: true, src: true, present: wantsPresentation('', hash) })
  const decoded = decodeShareHash(hash)
  const parsed = decoded.ok ? parseTripFile(decoded.data) : decoded
  if (!parsed.ok) {
    toast.error(`Could not open the shared trip. ${parsed.error}`)
    return
  }
  openLinkedTrip(parsed.file, parsed.warnings, { atStart })
}

/** Load the trip file at `?src=<url>` (asynchronous; the address is cleaned at once). */
async function openSource(src: string): Promise<void> {
  cleanAddress({ src: true })
  let host: string
  try {
    host = resolveSourceUrl(src, window.location.href).host
  } catch (err) {
    toast.error(`Could not open the trip address. ${err instanceof TripSourceError ? err.message : ''}`.trim())
    return
  }
  // Every edit makes a new trip object: if it changed while the file was on its way, the user is working.
  const tripAtStart = useTripStore.getState().trip
  const loading = toast.info(`Loading the trip from ${host}…`, { duration: 0 })
  try {
    const parsed = parseTripJson(await fetchTripText(src))
    if (!parsed.ok) {
      toast.error(`Could not open the trip from ${host}. ${parsed.error}`)
      return
    }
    if (useTripStore.getState().trip !== tripAtStart) offerLinkedTrip(parsed.file, parsed.warnings, host)
    else openLinkedTrip(parsed.file, parsed.warnings)
  } catch (err) {
    toast.error(`Could not load the trip. ${err instanceof TripSourceError ? err.message : ''}`.trim())
  } finally {
    toast.dismiss(loading)
  }
}

/**
 * Start-up: open the trip that the address asks for, a share link (`#trip=`) or a file URL
 * (`?src=`). A share link is read at once (synchronously, so the map's first view already fits
 * it); a share link pasted into an already open page (only the hash changes) is handled too.
 */
export function openTripFromAddress(): void {
  // `?present` / `&present`: show the trip in presentation mode (before the first render, so the map is laid out full width).
  if (wantsPresentation(window.location.search, window.location.hash)) enterPresentation()
  if (isShareHash(window.location.hash)) {
    openShareHash(window.location.hash, true)
  } else {
    const src = new URLSearchParams(window.location.search).get('src')
    if (src) void openSource(src)
  }
  window.addEventListener('hashchange', () => {
    if (!isShareHash(window.location.hash)) return
    if (wantsPresentation('', window.location.hash)) enterPresentation()
    openShareHash(window.location.hash, false)
  })
}
