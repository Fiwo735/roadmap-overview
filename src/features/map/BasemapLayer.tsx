import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL } from '../../services/config'
import { SeaTileLayer } from './SeaTileLayer'

/** The OSM tiles (without the outlines the style draws on the sea) under everything else. */
export function BasemapLayer() {
  const map = useMap()
  useEffect(() => {
    const layer = new SeaTileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: TILE_MAX_ZOOM })
    layer.addTo(map)
    return () => {
      layer.remove()
    }
  }, [map])
  return null
}
