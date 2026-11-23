/** Small least-recently-used cache: reads refresh an entry, the oldest is evicted beyond `limit`. */
export interface Lru<K, V> {
  get: (key: K) => V | undefined
  has: (key: K) => boolean
  set: (key: K, value: V) => void
  clear: () => void
  readonly size: number
}

export function createLru<K, V>(limit: number): Lru<K, V> {
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
      map.delete(key)
      map.set(key, value)
      if (map.size > limit) map.delete(map.keys().next().value as K)
    },
    clear: () => map.clear(),
    get size() {
      return map.size
    },
  }
}
