import type { Map as LeafletMap } from 'leaflet'

/**
 * Leaflet pane names, bottom to top (draw order from ARCHITECTURE.md): tiles (Leaflet's own
 * tilePane, z 200), route casing, route lines, via-point handles, place markers, labels, ride
 * vehicle; popups and tooltips (Leaflet's own, z 650/700) stay above all of them.
 * Pass the name as the `pane` option of any layer.
 */
export const PANES = {
  routeCasing: 'ro-route-casing',
  route: 'ro-route',
  via: 'ro-via',
  markers: 'ro-markers',
  labels: 'ro-labels',
  ride: 'ro-ride',
} as const

export type PaneName = (typeof PANES)[keyof typeof PANES]

const Z_INDEX: Record<PaneName, number> = {
  [PANES.routeCasing]: 410,
  [PANES.route]: 420,
  [PANES.via]: 430,
  [PANES.markers]: 450,
  [PANES.labels]: 460,
  [PANES.ride]: 470,
}

/** Create our panes on `map`; safe to call repeatedly. */
export function ensurePanes(map: LeafletMap): void {
  for (const name of Object.values(PANES)) {
    const pane = map.getPane(name) ?? map.createPane(name)
    pane.style.zIndex = String(Z_INDEX[name])
  }
}
