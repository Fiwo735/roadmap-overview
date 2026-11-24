/**
 * When a leg's via-point handles are shown. They are part of the route's shape, not of its look: a
 * reshaped route should read as a plain smooth line, so the handles only appear while someone is
 * working with that leg's shape and fade out again afterwards:
 *
 * - the pointer (mouse or pen) is over the leg's line or one of its handles,
 * - a drag that reshapes the leg is in progress (a new via point or an existing one),
 * - one of its handles has keyboard focus (`:focus-visible`),
 * - on devices without hover, the leg is the selected one (there is no other way to find them).
 *
 * Right after a drop the pointer is still where the new handle appeared: the leg stays hidden until
 * the pointer has left it once, so a reshaped route does not sprout a circle under the cursor.
 * Presentation mode and the ride never show handles (the map's CSS hides the whole pane there).
 *
 * This is the framework-free rule; `RouteLayer` feeds it from Leaflet and the document and mirrors
 * `isRevealed` onto the handles as the `is-revealed` class.
 */
export interface ViaReveal {
  isRevealed(legId: string): boolean
  /** The pointer came onto the leg's line or one of its handles. */
  pointerOver(legId: string): void
  /** The pointer left the leg's line or one of its handles. */
  pointerOut(legId: string): void
  /** A drag that reshapes the leg begins. */
  dragStart(legId: string): void
  /** The drag ended; `dropped`: it changed the leg (a cancelled drag changes nothing). */
  dragEnd(legId: string, dropped: boolean): void
  focusChanged(legId: string, focused: boolean): void
  /** Something the rule reads from outside changed (the selection, the input device). */
  refresh(): void
}

export interface ViaRevealEnvironment {
  selectedLegId(): string | null
  /** No hover to go by: a touch screen (or the last thing the user touched the map with was a finger). */
  touch(): boolean
  /** Called after every change that may alter what is shown. */
  onChange(): void
}

export function createViaReveal(env: ViaRevealEnvironment): ViaReveal {
  let pointerLeg: string | null = null
  let draggedLeg: string | null = null
  let focusedLeg: string | null = null
  let restingLeg: string | null = null

  const changed = () => env.onChange()

  return {
    isRevealed(legId) {
      if (draggedLeg === legId || focusedLeg === legId) return true
      if (pointerLeg === legId && restingLeg !== legId) return true
      return env.touch() && env.selectedLegId() === legId
    },
    pointerOver(legId) {
      pointerLeg = legId
      changed()
    },
    pointerOut(legId) {
      if (pointerLeg === legId) pointerLeg = null
      if (restingLeg === legId) restingLeg = null
      changed()
    },
    dragStart(legId) {
      draggedLeg = legId
      changed()
    },
    dragEnd(legId, dropped) {
      if (draggedLeg === legId) draggedLeg = null
      if (dropped) restingLeg = legId
      changed()
    },
    focusChanged(legId, focused) {
      if (focused === (focusedLeg === legId)) return
      if (focused) focusedLeg = legId
      else focusedLeg = null
      changed()
    },
    refresh: changed,
  }
}
