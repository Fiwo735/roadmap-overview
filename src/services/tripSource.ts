/** Fetching a trip file from a URL (`?src=…`, the bundled sample). */

export type TripSourceErrorKind = 'invalid-url' | 'network' | 'http' | 'timeout' | 'too-large'

/** Failure to fetch a trip file; `message` is written for the user. */
export class TripSourceError extends Error {
  readonly kind: TripSourceErrorKind
  constructor(kind: TripSourceErrorKind, message: string) {
    super(message)
    this.name = 'TripSourceError'
    this.kind = kind
  }
}

/** Largest trip file we read; a trip with routes is well under a megabyte. */
export const MAX_TRIP_FILE_BYTES = 20 * 1024 * 1024
const TIMEOUT_MS = 20_000

/** Resolve `src` (absolute, or relative to `base`) to an http(s) URL; anything else is refused. */
export function resolveSourceUrl(src: string, base: string): URL {
  let url: URL
  try {
    url = new URL(src, base)
  } catch {
    throw new TripSourceError('invalid-url', 'That is not a valid address.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TripSourceError('invalid-url', 'Only http and https addresses can be opened.')
  }
  return url
}

export interface FetchTripOptions {
  signal?: AbortSignal
  timeoutMs?: number
  fetch?: typeof fetch
  /** Where relative addresses start; defaults to the current page. */
  base?: string
}

/** The text at `src`. The server must allow cross-origin reads (CORS) unless it is this site. */
export async function fetchTripText(src: string, options: FetchTripOptions = {}): Promise<string> {
  const { signal, timeoutMs = TIMEOUT_MS, fetch: fetchImpl = globalThis.fetch.bind(globalThis) } = options
  const url = resolveSourceUrl(src, options.base ?? globalThis.location.href)
  const host = url.host

  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  const signals = signal ? [signal, timeout.signal] : [timeout.signal]
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.any(signals),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok) {
      throw new TripSourceError('http', `${host} answered with an error (${response.status}).`)
    }
    const declared = Number(response.headers.get('content-length'))
    if (declared > MAX_TRIP_FILE_BYTES) throw new TripSourceError('too-large', 'That file is too large to be a trip.')
    const text = await response.text()
    if (text.length > MAX_TRIP_FILE_BYTES) throw new TripSourceError('too-large', 'That file is too large to be a trip.')
    return text
  } catch (err) {
    if (err instanceof TripSourceError) throw err
    if (signal?.aborted) throw err
    if (timeout.signal.aborted) {
      throw new TripSourceError('timeout', `${host} took too long to answer.`)
    }
    throw new TripSourceError(
      'network',
      `Could not reach ${host}. Check the address; the server also has to allow other websites to read the file.`,
    )
  } finally {
    clearTimeout(timer)
  }
}
