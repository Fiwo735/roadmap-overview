/** Shown until the reverse geocoder has named a place created from a bare coordinate. */
export const DROPPED_PIN_NAME = 'Dropped pin'

/** What lists and labels show for a place without a usable name. */
export const displayName = (name: string): string => name.trim() || 'Unnamed place'
