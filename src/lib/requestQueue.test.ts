import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequestQueue, isAbortError } from './requestQueue'

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createRequestQueue', () => {
  it('starts the first task at once and spaces later starts by the interval', async () => {
    const queue = createRequestQueue({ minIntervalMs: 1000, maxConcurrent: 5 })
    const starts: number[] = []
    const t0 = Date.now()
    const task = async () => {
      starts.push(Date.now() - t0)
    }
    const all = Promise.all([queue.run(task), queue.run(task), queue.run(task)])
    await vi.advanceTimersByTimeAsync(2500)
    await all
    expect(starts).toEqual([0, 1000, 2000])
  })

  it('runs one task at a time by default, even when the interval has passed', async () => {
    const queue = createRequestQueue({ minIntervalMs: 100 })
    const finish: Array<() => void> = []
    const started: number[] = []
    const slow = (n: number) => () => {
      started.push(n)
      return new Promise<void>((resolve) => finish.push(resolve))
    }
    const a = queue.run(slow(1))
    const b = queue.run(slow(2))
    await vi.advanceTimersByTimeAsync(5000)
    expect(started).toEqual([1])
    finish[0]()
    await a
    await vi.advanceTimersByTimeAsync(100)
    expect(started).toEqual([1, 2])
    finish[1]()
    await b
  })

  it('shares one run between callers with the same key', async () => {
    const queue = createRequestQueue({ minIntervalMs: 1000 })
    const task = vi.fn(async () => 42)
    const [a, b] = [queue.run(task, { key: 'k' }), queue.run(task, { key: 'k' })]
    await flush()
    await expect(Promise.all([a, b])).resolves.toEqual([42, 42])
    expect(task).toHaveBeenCalledTimes(1)
    // Once finished, the key is free again.
    await vi.advanceTimersByTimeAsync(1000)
    await queue.run(task, { key: 'k' })
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('never starts a queued task whose only caller aborted', async () => {
    const queue = createRequestQueue({ minIntervalMs: 1000 })
    const first = vi.fn(async () => 'first')
    const second = vi.fn(async () => 'second')
    const third = vi.fn(async () => 'third')
    const controller = new AbortController()
    const a = queue.run(first)
    const b = queue.run(second, { signal: controller.signal })
    const c = queue.run(third)
    await flush()
    controller.abort()
    await expect(b).rejects.toSatisfy(isAbortError)
    await vi.advanceTimersByTimeAsync(5000)
    await expect(Promise.all([a, c])).resolves.toEqual(['first', 'third'])
    expect(second).not.toHaveBeenCalled()
    expect(queue.pending).toBe(0)
  })

  it('aborts a running task only when every caller sharing it has aborted', async () => {
    const queue = createRequestQueue({ minIntervalMs: 1000 })
    let seen: AbortSignal | undefined
    const task = (signal: AbortSignal) => {
      seen = signal
      return new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
        setTimeout(() => resolve('done'), 500)
      })
    }
    const c1 = new AbortController()
    const c2 = new AbortController()
    const a = queue.run(task, { key: 'k', signal: c1.signal })
    const b = queue.run(task, { key: 'k', signal: c2.signal })
    await flush()
    c1.abort()
    await expect(a).rejects.toSatisfy(isAbortError)
    expect(seen?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    await expect(b).resolves.toBe('done')

    const c3 = new AbortController()
    const c = queue.run(task, { key: 'k2', signal: c3.signal })
    // Started at t=1000 (1 s after the previous start); still running 100 ms later.
    await vi.advanceTimersByTimeAsync(600)
    c3.abort()
    await expect(c).rejects.toSatisfy(isAbortError)
    expect(seen?.aborted).toBe(true)
  })

  it('rejects immediately for an already aborted signal', async () => {
    const queue = createRequestQueue({ minIntervalMs: 1000 })
    const task = vi.fn(async () => 1)
    await expect(queue.run(task, { signal: AbortSignal.abort() })).rejects.toSatisfy(isAbortError)
    expect(task).not.toHaveBeenCalled()
  })

  it('keeps going after a task fails', async () => {
    const queue = createRequestQueue({ minIntervalMs: 1000 })
    const bad = queue.run(async () => {
      throw new Error('boom')
    })
    const good = queue.run(async () => 'ok')
    const badResult = expect(bad).rejects.toThrow('boom')
    await vi.advanceTimersByTimeAsync(1000)
    await badResult
    await expect(good).resolves.toBe('ok')
  })
})
