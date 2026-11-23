const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Short random id, optionally prefixed ("p_k3j9x2a1b4"). Uses getRandomValues (available in
 * insecure contexts too, unlike crypto.randomUUID).
 */
export function newId(prefix?: string): string {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return prefix ? `${prefix}_${out}` : out
}
