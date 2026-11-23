import { useToastDock } from '../../components/portal'
import { WelcomeHint } from '../help/WelcomeHint'
import { LegLegend } from '../legs/LegLegend'
import { StatsOverlay } from '../stats/StatsOverlay'
import { MapTools } from '../routing/MapTools'
import { RideHud } from '../ride/RideHud'

/**
 * React overlays drawn above the map (not Leaflet controls, so they can use the theme and normal
 * components). The layer ignores pointer events; each slot's children opt back in via CSS.
 */
export function MapOverlays() {
  return (
    <div className="map-overlays">
      <div className="map-slot map-slot--top-left">
        <StatsOverlay />
      </div>
      <div className="map-slot map-slot--top-right">
        <MapTools />
      </div>
      <div className="map-slot map-slot--center">
        <WelcomeHint />
      </div>
      <div className="map-slot map-slot--bottom-left">
        <LegLegend />
      </div>
      <div className="map-slot map-slot--bottom-center">
        {/* Toasts (components/Toast.tsx) are portalled in here on wide screens: above the ride controls, clear of the card, the tools and the legend. */}
        <div
          className="toast-dock"
          ref={(el) => {
            useToastDock.getState().set(el)
            return () => useToastDock.getState().set(null)
          }}
        />
        <RideHud />
      </div>
    </div>
  )
}
