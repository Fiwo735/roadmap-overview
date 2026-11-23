/** Base URLs of the external services. Point them elsewhere to use a self-hosted instance. */

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

/** Plain-text form of the attribution, for the exported image. */
export const TILE_ATTRIBUTION_TEXT = '© OpenStreetMap contributors'

export const TILE_MAX_ZOOM = 19

/** OSRM demo server. Used as `${OSRM_URL}/route/v1/driving/{lng,lat;lng,lat}`. */
export const OSRM_URL = 'https://router.project-osrm.org'

/** Used as `${NOMINATIM_URL}/search` and `${NOMINATIM_URL}/reverse`. */
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'

/** The bundled sample trip (a static file in `public/samples/`, so it also opens offline once cached). */
export const SAMPLE_TRIP_URL = `${import.meta.env.BASE_URL}samples/hamburg-fjords.trip.json`
