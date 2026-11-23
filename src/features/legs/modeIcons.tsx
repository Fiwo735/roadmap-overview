import { Car, Plane, Ship, TrainFront, type LucideIcon } from 'lucide-react'
import type { LegMode } from '../../types/trip'

/** The icon of each leg mode (sidebar connectors, the mode editor, the exported legend). */
export const MODE_ICONS: Record<LegMode, LucideIcon> = {
  drive: Car,
  ferry: Ship,
  train: TrainFront,
  flight: Plane,
}
