/**
 * Politeness queue for the free community services (Nominatim, OSRM): tasks start in arrival order,
 * at most `maxConcurrent` at a time and at least `minIntervalMs` apart. Identical requests (same
 * `key`) share one run, and a run is aborted — or dropped, if it has not started — once every caller
 * waiting on it has aborted.
 */
export interface RequestQueueOptions {
  /** Minimum time between the starts of two tasks. */
  minIntervalMs: number
  /** Tasks allowed in flight at once (default 1). */
  maxConcurrent?: number
  /** Clock, for tests (default `Date.now`, which fake timers also control). */
  now?: () => number
}

export interface QueueRunOptions {
  /** Aborting rejects this caller with an AbortError at once. */
  signal?: AbortSignal
  /** Callers with the same key while one is queued or running share its result. */
  key?: string
}

export interface RequestQueue {
  run: <T>(task: (signal: AbortSignal) => Promise<T>, options?: QueueRunOptions) => Promise<T>
  /** Tasks waiting to start (not counting the running ones). */
  readonly pending: number
}

export const abortError = (): DOMException => new DOMException('The operation was aborted.', 'AbortError')

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

interface Subscriber {
  resolve: (value: never) => void
  reject: (reason: unknown) => void
}

interface Job {
  key: string | undefined
  task: (signal: AbortSignal) => Promise<unknown>
  controller: AbortController
  subscribers: Set<Subscriber>
  started: boolean
}

export function createRequestQueue({
  minIntervalMs,
  maxConcurrent = 1,
  now = () => Date.now(),
}: RequestQueueOptions): RequestQueue {
  const waiting: Job[] = []
  const byKey = new Map<string, Job>()
  let running = 0
  let lastStart = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined

  const forget = (job: Job) => {
    if (job.key !== undefined && byKey.get(job.key) === job) byKey.delete(job.key)
  }

  function pump() {
    clearTimeout(timer)
    timer = undefined
    while (waiting.length > 0 && running < maxConcurrent) {
      const wait = lastStart + minIntervalMs - now()
      if (wait > 0) {
        timer = setTimeout(pump, wait)
        return
      }
      start(waiting.shift() as Job)
    }
  }

  function start(job: Job) {
    job.started = true
    running++
    lastStart = now()
    new Promise((resolve) => resolve(job.task(job.controller.signal)))
      .then(
        (value) => {
          for (const s of job.subscribers) s.resolve(value as never)
        },
        (error: unknown) => {
          for (const s of job.subscribers) s.reject(error)
        },
      )
      .finally(() => {
        forget(job)
        running--
        pump()
      })
  }

  function cancel(job: Job) {
    forget(job)
    if (job.started) {
      job.controller.abort()
      return
    }
    const i = waiting.indexOf(job)
    if (i >= 0) waiting.splice(i, 1)
  }

  return {
    get pending() {
      return waiting.length
    },
    run<T>(task: (signal: AbortSignal) => Promise<T>, { signal, key }: QueueRunOptions = {}): Promise<T> {
      if (signal?.aborted) return Promise.reject(abortError())
      return new Promise<T>((resolve, reject) => {
        let job = key === undefined ? undefined : byKey.get(key)
        if (!job) {
          job = { key, task, controller: new AbortController(), subscribers: new Set(), started: false }
          if (key !== undefined) byKey.set(key, job)
          waiting.push(job)
        }
        const joined = job
        const onAbort = () => {
          if (!joined.subscribers.delete(subscriber)) return
          reject(abortError())
          if (joined.subscribers.size === 0) cancel(joined)
        }
        const subscriber: Subscriber = {
          resolve: (value) => {
            signal?.removeEventListener('abort', onAbort)
            resolve(value as T)
          },
          reject: (reason) => {
            signal?.removeEventListener('abort', onAbort)
            reject(reason)
          },
        }
        joined.subscribers.add(subscriber)
        signal?.addEventListener('abort', onAbort, { once: true })
        pump()
      })
    },
  }
}
