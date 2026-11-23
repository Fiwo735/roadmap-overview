import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { createRideScene } from './rideScene'
import { useRideStore } from './rideStore'

/**
 * Map layer of the ride (the van, the emphasised trail, the stop halos, the camera). Only exists
 * while a ride is on; the work is in rideScene.ts, which puts the map back as it was on close.
 */
export function RideLayer() {
  const map = useMap()
  const active = useRideStore((s) => s.active)

  useEffect(() => {
    if (!active) return
    const scene = createRideScene(map)
    return scene.destroy
  }, [map, active])

  return null
}
