import { useEffect } from 'react'
import { routeManager } from './routeManager'

/** Non-visual: runs the route manager (road routes from OSRM into the route store) while mounted. */
export function RouteManager() {
  useEffect(() => {
    routeManager.start()
    return () => routeManager.stop()
  }, [])
  return null
}
