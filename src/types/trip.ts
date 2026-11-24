/**
 * Data contract for Roadmap Overview.
 *
 * Two kinds of data exist and must not be mixed:
 *
 *  - INTENT (Trip, Place, Leg): what the user edits. Undoable, autosaved, exported.
 *  - DERIVED (LegRoute, stats, countries): computed from intent. Never undoable.
 *    Road geometry is cached by a routing key (see src/lib/routeKey.ts) so that
 *    undo/redo and re-ordering hit the cache instead of the router.
 *
 * Changing these types is a file-format change: bump TripFile.version and add a
 * migration in the import code.
 */

/** WGS84 coordinate. */
export interface LatLng {
  lat: number
  lng: number
}

/** A stop on the trip: a numbered, labelled marker on the map and a row in the places list. */
export interface Place {
  id: string
  /** Short label shown in the list and on the map, e.g. "Lyon" or "Camping Les Pins". */
  name: string
  /** Full geocoder description, e.g. "Lyon, Métropole de Lyon, Rhône, France". */
  address?: string
  lat: number
  lng: number
  /** Day of travel on which this place is reached. Integer, 0 or greater, no upper bound. */
  day: number
  /** True once the user typed a name themselves; re-geocoding must then not overwrite `name`. */
  customName?: boolean
  /** Free-text note. */
  note?: string
  /**
   * Photos of the place, in the order shown (optional, added without a version bump). The trip only
   * holds references: the image bytes live in the browser's IndexedDB (src/services/photoDb.ts) and travel
   * inside saved JSON files (`TripFile.photos`), never in autosave, recent trips or share links.
   */
  photos?: PlacePhoto[]
}

/** A reference to a photo of a place. `width` x `height` are the stored (already rotated and downscaled) pixels. */
export interface PlacePhoto {
  /** Key of the bytes in IndexedDB and in `TripFile.photos`. */
  id: string
  width: number
  height: number
  /** Optional caption, shown under the photo in the viewer. */
  caption?: string
}

/** How a leg is travelled. Only 'drive' is routed over roads; the rest are drawn by hand. */
export type LegMode = 'drive' | 'ferry' | 'train' | 'flight'

/**
 * The connection between two consecutive places.
 * Invariant (kept by the trip store): legs.length === max(0, places.length - 1) and
 * legs[i].fromId === places[i].id && legs[i].toId === places[i + 1].id.
 * When places are re-ordered, a leg is re-used if its (fromId, toId) pair is still adjacent.
 */
export interface Leg {
  id: string
  fromId: string
  toId: string
  mode: LegMode
  /**
   * Shaping points the user dragged the line through (Google-Maps style), ordered from → to.
   * 'drive': the road route is forced through them. Other modes: the line is drawn through them.
   */
  via: LatLng[]
  /** 'drive' only: draw straight segments instead of following roads (off-road, routing gaps). */
  straight?: boolean
  /** User override of the duration, in minutes. Non-drive legs fall back to an estimate when unset. */
  durationMin?: number
  /** Optional label, e.g. "Brittany Ferries · Portsmouth → Santander". */
  label?: string
}

/**
 * The vehicles the ride can drive on road stretches (registry and artwork: src/lib/vehicles.ts, features/ride/vehicles.ts).
 * The ids are stored in trips and links, so they never change; the names shown differ for two: `campervan` is labelled
 * "Car" and `iveco-daily` "Campervan".
 */
export type VehicleKind = 'campervan' | 'iveco-daily' | 'retro-bus' | 'motorhome' | 'caravan' | 'offroad'

/** The vehicle that rides the trip's road stretches (ferries, trains and flights keep their own). */
export interface TripVehicle {
  kind: VehicleKind
  /** Body colour as `#rrggbb`; omitted for the vehicle's own colour (and always for kinds that have only one). */
  color?: string
}

export interface Trip {
  id: string
  title: string
  subtitle?: string
  /** Calendar date (YYYY-MM-DD) of the earliest day used by any place. Optional. */
  startDate?: string
  /** Added without a version bump: missing means the default vehicle (kind `campervan`, labelled Car). Kept canonical: never the default itself. */
  vehicle?: TripVehicle
  places: Place[]
  legs: Leg[]
}

/**
 * A stretch of a routed leg travelled in one way. OSRM's car profile drives onto car ferries, so a
 * 'drive' leg can contain ferry crossings; `from` / `to` are indices into the decoded geometry
 * (inclusive).
 */
export interface RouteSpan {
  mode: 'drive' | 'ferry'
  from: number
  to: number
  distanceM: number
  durationS: number
}

/** Geometry + metrics for one leg. DERIVED: cached by `key`, never part of undo history. */
export interface LegRoute {
  /** The routing key this result was computed for (legRouteKey). */
  key: string
  /** Encoded polyline, precision 5 (the Google/OSRM "polyline" format). */
  geometry: string
  distanceM: number
  /** Duration from the router (drive) or the mode estimate (others), before any user override. */
  durationS: number
  source: 'osrm' | 'manual'
  /**
   * Optional (added without a version bump): how the geometry splits into driven and ferry stretches,
   * from the router's steps. When present the spans cover the whole geometry in order — the first
   * starts at index 0, the last ends at the final point, and each starts at the point where the
   * previous one ends. Omitted when the whole leg is travelled as `Leg.mode` says (always for
   * manual routes, and for a drive route without ferries).
   */
  spans?: RouteSpan[]
}

/** The on-disk / share format. A file opens instantly because routes travel with it. */
export interface TripFile {
  format: 'roadmap-overview/trip'
  version: 1
  /** ISO timestamp. */
  exportedAt: string
  trip: Trip
  /**
   * Cached routes keyed by LEG ID. On import a route is only trusted when its `key` equals the
   * key recomputed from the trip; otherwise the leg is routed again.
   */
  routes?: Record<string, LegRoute>
  /**
   * Optional (added without a version bump): the full-size bytes of the photos the trip's places refer to
   * (`Place.photos`), keyed by `PlacePhoto.id`. Only JSON files saved from the File menu carry them;
   * autosave, recent trips and share links hold references only. Thumbnails are derived again on import.
   */
  photos?: Record<string, TripFilePhoto>
}

/** One embedded photo of a trip file. */
export interface TripFilePhoto {
  mime: 'image/jpeg'
  /** Base64 (no `data:` prefix) of the JPEG. */
  data: string
  width: number
  height: number
}
