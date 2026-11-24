import type { TripVehicle, VehicleKind } from '../types/trip'

/**
 * The vehicles the ride drives on road stretches: what exists, what each is called, its own colour and
 * how a colour is handled. Pure data and helpers; the artwork is in `features/ride/vehicles.ts`.
 */
export interface VehicleMeta {
  kind: VehicleKind
  /** Shown in the picker and in the tooltips of the Ride and vehicle buttons. */
  label: string
  /** The body colour when none is chosen (`#rrggbb`). */
  defaultColor: string
  /** Whether the body colour can be chosen. The Daily is the black van: its name says so. */
  colorable: boolean
}

export const DEFAULT_VEHICLE_KIND: VehicleKind = 'campervan'

export const VEHICLES: Record<VehicleKind, VehicleMeta> = {
  campervan: { kind: 'campervan', label: 'Campervan', defaultColor: '#ffffff', colorable: true },
  'iveco-daily': { kind: 'iveco-daily', label: 'Iveco Daily (black)', defaultColor: '#15181d', colorable: false },
  'retro-bus': { kind: 'retro-bus', label: 'Retro camper bus', defaultColor: '#2a9d9d', colorable: true },
  motorhome: { kind: 'motorhome', label: 'Motorhome', defaultColor: '#ffffff', colorable: true },
  caravan: { kind: 'caravan', label: 'Car with caravan', defaultColor: '#2f6fd1', colorable: true },
  offroad: { kind: 'offroad', label: '4×4 with roof tent', defaultColor: '#3f9560', colorable: true },
}

/** The order the picker lists them in. */
export const VEHICLE_KINDS: readonly VehicleKind[] = ['campervan', 'iveco-daily', 'retro-bus', 'motorhome', 'caravan', 'offroad']

export const isVehicleKind = (value: unknown): value is VehicleKind =>
  typeof value === 'string' && (VEHICLE_KINDS as readonly string[]).includes(value)

/** The body colours the picker offers besides a free choice. */
export const COLOR_PRESETS: readonly { value: string; label: string }[] = [
  { value: '#ffffff', label: 'White' },
  { value: '#c5ccd6', label: 'Silver' },
  { value: '#15181d', label: 'Black' },
  { value: '#d4382c', label: 'Red' },
  { value: '#ee7a2f', label: 'Orange' },
  { value: '#f0c230', label: 'Yellow' },
  { value: '#3f9560', label: 'Green' },
  { value: '#2a9d9d', label: 'Teal' },
  { value: '#2f6fd1', label: 'Blue' },
]

// ---- Colours ------------------------------------------------------------------------------------

export interface Rgb {
  r: number
  g: number
  b: number
}

/** `#rgb` or `#rrggbb` (any case) as numbers, or null for anything else. */
export function parseColor(text: unknown): Rgb | null {
  if (typeof text !== 'string') return null
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim())
  if (!m) return null
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
}

const channel = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
export const toHex = ({ r, g, b }: Rgb): string => `#${channel(r)}${channel(g)}${channel(b)}`

/** The canonical `#rrggbb` (lower case) of a colour, or null when it is not one. */
export function normalizeColor(text: unknown): string | null {
  const rgb = parseColor(text)
  return rgb ? toHex(rgb) : null
}

/** `a` blended towards `b` by `t` (0 = a, 1 = b); both must be valid colours. */
export function mixColors(a: string, b: string, t: number): string {
  const [x, y] = [parseColor(a) ?? { r: 0, g: 0, b: 0 }, parseColor(b) ?? { r: 0, g: 0, b: 0 }]
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t })
}
export const lighten = (color: string, t: number): string => mixColors(color, '#ffffff', t)
export const darken = (color: string, t: number): string => mixColors(color, '#000000', t)

/** Perceived brightness, 0 (black) … 1 (white). */
export function luminance(color: string): number {
  const c = parseColor(color)
  return c ? (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 : 0
}

// ---- The trip's vehicle -------------------------------------------------------------------------

export interface ResolvedVehicle {
  kind: VehicleKind
  /** The body colour that is drawn: the chosen one, else the vehicle's own. */
  color: string
}

/**
 * What to draw for a trip's `vehicle`, whatever state it is in: a missing vehicle is the campervan, an
 * unknown kind is too, and a colour that is missing, invalid or not applicable falls back to the
 * vehicle's own.
 */
export function resolveVehicle(vehicle?: { kind?: unknown; color?: unknown } | null): ResolvedVehicle {
  const kind = isVehicleKind(vehicle?.kind) ? vehicle.kind : DEFAULT_VEHICLE_KIND
  const meta = VEHICLES[kind]
  const color = meta.colorable ? normalizeColor(vehicle?.color) : null
  return { kind, color: color ?? meta.defaultColor }
}

/**
 * The trip's way of saying "this vehicle in this colour": nothing at all for the default campervan, no
 * colour for the vehicle's own colour or for kinds that have only one, and `#rrggbb` otherwise. Keeps
 * files, share links and the undo history free of spellings that mean the same thing.
 */
export function canonicalVehicle(kind: VehicleKind, color?: string | null): TripVehicle | undefined {
  const meta = VEHICLES[kind]
  const chosen = meta.colorable ? normalizeColor(color) : null
  const own = chosen && chosen !== meta.defaultColor ? chosen : undefined
  if (kind === DEFAULT_VEHICLE_KIND && !own) return undefined
  return own ? { kind, color: own } : { kind }
}

export function vehicleLabel(vehicle?: TripVehicle | null): string {
  return VEHICLES[resolveVehicle(vehicle).kind].label
}

/** Do two trip vehicles mean the same thing to the ride? */
export function sameVehicle(a?: TripVehicle | null, b?: TripVehicle | null): boolean {
  const [x, y] = [resolveVehicle(a), resolveVehicle(b)]
  return x.kind === y.kind && x.color === y.color
}

/**
 * Read the `vehicle` of an untrusted trip. Nothing, or something that cannot be a vehicle, gives the
 * default; an unknown kind gives the default campervan, a bad colour the vehicle's own. What was
 * repaired is added to `warnings`.
 */
export function parseVehicle(raw: unknown, warnings: string[]): TripVehicle | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('The vehicle was not valid; the campervan is used.')
    return undefined
  }
  const { kind, color } = raw as { kind?: unknown; color?: unknown }
  if (!isVehicleKind(kind)) {
    warnings.push(`The vehicle ${typeof kind === 'string' && kind ? `“${kind.slice(0, 40)}” ` : ''}is not known; the campervan is used.`)
    return undefined
  }
  if (color !== undefined && normalizeColor(color) === null) {
    warnings.push('The vehicle’s colour was not valid; its own colour is used.')
    return canonicalVehicle(kind)
  }
  return canonicalVehicle(kind, color as string | undefined)
}
