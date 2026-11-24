/**
 * Small least-recently-used cache: reads refresh an entry, the oldest is evicted beyond `limit`. `onEvict`
 * is told of every value that leaves the cache by being pushed out or replaced (not by `clear`).
 */
export interface Lru<K, V> {
  get: (key: K) => V | undefined
  has: (key: K) => boolean
  set: (key: K, value: V) => void
  clear: () => void
  readonly size: number
}

export function createLru<K, V>(limit: number, onEvict?: (value: V, key: K) => void): Lru<K, V> {
  const map = new Map<K, V>()
  return {
    get(key) {
      if (!map.has(key)) return undefined
      const value = map.get(key) as V
      map.delete(key)
      map.set(key, value)
      return value
    },
    has: (key) => map.has(key),
    set(key, value) {
      const had = map.has(key)
      const replaced = map.get(key)
      map.delete(key)
      map.set(key, value)
      if (had && replaced !== value) onEvict?.(replaced as V, key)
      if (map.size > limit) {
        const oldest = map.keys().next().value as K
        const evicted = map.get(oldest) as V
        map.delete(oldest)
        onEvict?.(evicted, oldest)
      }
    },
    clear: () => map.clear(),
    get size() {
      return map.size
    },
  }
}
