import { create } from 'zustand'
import { useRouteStore } from '../../store/routeStore'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import type { Place } from '../../types/trip'
import { isPresenting, usePresentationStore } from '../presentation/presentationStore'
import { getLegRoutes, useLegRoutes, type LegRouteInfo } from '../routing/legRoutes'
import {
  buildTimeline,
  nextStepTime,
  sampleTimeline,
  stepDay,
  type RideSample,
  type Timeline,
} from './timeline'

export const RIDE_SPEEDS = [0.5, 1, 2, 4] as const
export type RideSpeed = (typeof RIDE_SPEEDS)[number]

/** Ride state: playback only, nothing here is trip data (not undoable, not saved). */
export interface RideState {
  /** The ride is on: the HUD and the van show, editing is locked. */
  active: boolean
  playing: boolean
  speed: RideSpeed
  /** The camera follows the van (else the whole trip is shown). Kept for the session. */
  follow: boolean
  /** Seconds along the timeline at 1× speed. */
  time: number
  timeline: Timeline | null
  /** Index of the last place reached: in the store so the sidebar's rows re-render only when it changes. */
  placeIndex: number
  /**
   * How the last ride ended: true when something else took over the map (the trip was replaced or
   * emptied), so the map must stay as that left it; false when the user closed the ride and the view
   * from before it comes back. Read by the map layer as it tidies up.
   */
  keepView: boolean
}

export const useRideStore = create<RideState>()(() => ({
  active: false,
  playing: false,
  speed: 1,
  follow: false,
  time: 0,
  timeline: null,
  placeIndex: 0,
  keepView: false,
}))

/** Is the ride on? */
export const isRiding = (): boolean => useRideStore.getState().active

/**
 * THE switch every editing surface consults: true while a ride is on (the ride is made from the trip as
 * it was when it started) and in presentation mode (F8: the trip is being shown, not edited). Anything
 * that changes the trip (marker drags, the places list, the leg editor, undo/redo, the title, map menus,
 * opening another trip, …) must be off while it is. Use the hook in components and `isEditingLocked()`
 * in event handlers.
 */
export const isEditingLocked = (): boolean => useRideStore.getState().active || isPresenting()
/**
 * Why the trip cannot be changed right now, as a sentence for a toast, or null when it can. For actions that
 * come back later and change the trip — an "Undo" on a toast that is still showing, "Load it" — which must
 * check at click time: the lock may have begun since they were offered.
 */
export function editingLockedReason(): string | null {
  const presenting = isPresenting()
  const riding = useRideStore.getState().active
  if (presenting && riding) return 'Leave presentation mode and close the ride (Esc twice) first, then try again.'
  if (presenting) return 'Leave presentation mode (Esc) first, then try again.'
  if (riding) return 'Close the ride (Esc) first, then try again.'
  return null
}
export const useEditingLocked = (): boolean => {
  const riding = useRideStore((s) => s.active)
  const presenting = usePresentationStore((s) => s.on)
  return riding || presenting
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

// ---- Availability ------------------------------------------------------------------------------

export type RideAvailability = { ok: true } | { ok: false; reason: string }

export function rideAvailabilityFor(placeCount: number, statuses: readonly string[]): RideAvailability {
  if (placeCount < 2) return { ok: false, reason: 'Add at least two places to ride the route.' }
  if (statuses.includes('loading')) return { ok: false, reason: 'The routes are still loading. The ride is ready in a moment.' }
  return { ok: true }
}

/** Can a ride start now: two places or more, and no leg still being routed (a failed leg rides its straight line). */
export function useRideAvailability(): RideAvailability {
  const placeCount = useTripStore((s) => s.trip.places.length)
  const infos = useLegRoutes()
  return rideAvailabilityFor(
    placeCount,
    infos.map((i) => i.status),
  )
}

// ---- Timeline and samples ----------------------------------------------------------------------

/**
 * The ride's clock for these places and their leg routes (`getLegRoutes()` / `useLegRoutes()`), or null when there is nothing
 * to ride. The one place the timeline is made from a trip: the ride plays it and the video export (F13) renders the same one.
 */
export function timelineFor(places: readonly Place[], infos: readonly LegRouteInfo[], startDate?: string): Timeline | null {
  if (places.length < 2 || infos.length !== places.length - 1) return null
  return buildTimeline({
    places,
    legs: infos.map((info) => ({
      mode: info.leg.mode,
      coords: info.coords,
      spans: info.route?.spans,
      distanceM: info.route?.distanceM,
    })),
    startDate,
  })
}

function currentTimeline(): Timeline | null {
  const { places, startDate } = useTripStore.getState().trip
  return timelineFor(places, getLegRoutes(), startDate)
}

let cache: { timeline: Timeline; time: number; sample: RideSample } | null = null

/** `sampleTimeline`, remembering the last answer: the loop, the HUD and the map all ask for the same instant. */
export function rideSample(timeline: Timeline, time: number): RideSample {
  if (cache && cache.timeline === timeline && cache.time === time) return cache.sample
  const sample = sampleTimeline(timeline, time)
  cache = { timeline, time, sample }
  return sample
}

/** The sample at the ride's current time, or null when no ride is on. Re-renders on every frame while playing. */
export function useRideSample(): RideSample | null {
  const timeline = useRideStore((s) => s.timeline)
  const time = useRideStore((s) => s.time)
  return timeline ? rideSample(timeline, time) : null
}

function commitTime(time: number): void {
  const { timeline } = useRideStore.getState()
  if (!timeline) return
  const t = Math.min(timeline.duration, Math.max(0, time))
  useRideStore.setState({ time: t, placeIndex: rideSample(timeline, t).placeIndex })
}

// ---- The loop ----------------------------------------------------------------------------------

/** Longest step of one frame: after a stall (a busy tab) the van carries on instead of leaping ahead. */
const MAX_FRAME_S = 0.1
/** How long each day lasts when stepping instead of moving (reduced motion), at 1× speed. */
const STEP_PERIOD_S = 1.1

let frame = 0
let lastNow = 0
let stepClock = 0
let resumeOnVisible = false
let scrubResume = false
let stopWatching: (() => void) | null = null

function tick(now: number): void {
  frame = 0
  const s = useRideStore.getState()
  if (!s.active || !s.playing || !s.timeline) return
  const dt = Math.min(MAX_FRAME_S, Math.max(0, (now - lastNow) / 1000))
  lastNow = now

  let next: number | null
  if (prefersReducedMotion()) {
    stepClock += dt * s.speed
    next = s.time
    if (stepClock >= STEP_PERIOD_S) {
      stepClock = 0
      next = nextStepTime(s.timeline, s.time) ?? s.timeline.duration
    }
  } else {
    next = s.time + dt * s.speed
  }

  if (next >= s.timeline.duration) {
    commitTime(s.timeline.duration)
    useRideStore.setState({ playing: false })
    return
  }
  commitTime(next)
  schedule()
}

function schedule(): void {
  if (frame || typeof requestAnimationFrame === 'undefined') return
  frame = requestAnimationFrame((now) => {
    tick(now)
  })
}

function cancelFrame(): void {
  if (frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame)
  frame = 0
}

function runLoop(): void {
  cancelFrame()
  lastNow = performance.now()
  schedule()
}

// ---- Controls ----------------------------------------------------------------------------------

export function playRide(): void {
  const s = useRideStore.getState()
  if (!s.active || !s.timeline) return
  // Playing from the end starts over.
  if (s.time >= s.timeline.duration) commitTime(0)
  stepClock = 0
  useRideStore.setState({ playing: true })
  runLoop()
}

export function pauseRide(): void {
  resumeOnVisible = false
  useRideStore.setState({ playing: false })
}

export function toggleRide(): void {
  if (useRideStore.getState().playing) pauseRide()
  else playRide()
}

export function restartRide(): void {
  commitTime(0)
  playRide()
}

export function seekRide(time: number): void {
  commitTime(time)
}

/** Previous / next day (the start of it); after the last day, the end. */
export function stepRideDay(delta: 1 | -1): void {
  const { timeline, time } = useRideStore.getState()
  if (timeline) commitTime(stepDay(timeline, time, delta))
}

export function setRideSpeed(speed: RideSpeed): void {
  useRideStore.setState({ speed })
}

export function setRideFollow(follow: boolean): void {
  useRideStore.setState({ follow })
}

/** Pause while the scrubber is held, so the van does not run away from the thumb. */
export function beginScrub(): void {
  scrubResume = useRideStore.getState().playing
  useRideStore.setState({ playing: false })
}

export function endScrub(): void {
  if (!scrubResume) return
  scrubResume = false
  const { timeline, time } = useRideStore.getState()
  if (timeline && time < timeline.duration) playRide()
}

// ---- Start and stop ----------------------------------------------------------------------------

/** What the ride is made from: the trip's identity and its leg routes as they were last looked at. */
let source: { tripId: string; legs: LegRouteInfo[] } | null = null

/** Would the two leg lists give the same timeline? (Names and notes do not matter: only where, when and how.) */
function sameRideSource(a: readonly LegRouteInfo[], b: readonly LegRouteInfo[]): boolean {
  const spot = (p: LegRouteInfo['from']) => `${p.lat},${p.lng},${p.day}`
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.coords === b[i].coords &&
        x.leg.mode === b[i].leg.mode &&
        x.route?.spans === b[i].route?.spans &&
        x.route?.distanceM === b[i].route?.distanceM &&
        spot(x.from) === spot(b[i].from) &&
        spot(x.to) === spot(b[i].to),
    )
  )
}

/**
 * The trip changed under a running ride (a late place name, a route that arrived): rebuild the
 * timeline and carry on from the same time. A different trip (opened, new) ends the ride; so does a
 * trip that can no longer be ridden. Legs still routing keep the old timeline until they are done.
 */
function onSourceChange(): void {
  const s = useRideStore.getState()
  if (!s.active || !source) return
  const { trip } = useTripStore.getState()
  if (trip.id !== source.tripId) return closeRide({ keepView: true })
  const legs = getLegRoutes()
  if (legs === source.legs) return
  const unchanged = sameRideSource(source.legs, legs)
  source = { tripId: source.tripId, legs }
  if (trip.places.length < 2) return closeRide({ keepView: true })
  if (unchanged || legs.some((l) => l.status === 'loading')) return
  const timeline = currentTimeline()
  if (!timeline) return closeRide({ keepView: true })
  useRideStore.setState({ timeline })
  commitTime(Math.min(s.time, timeline.duration))
}

function watchSources(): () => void {
  const unsubTrip = useTripStore.subscribe((state, prev) => {
    if (state.trip !== prev.trip) onSourceChange()
  })
  const unsubRoutes = useRouteStore.subscribe((state, prev) => {
    if (state.routes !== prev.routes) onSourceChange()
  })
  // A hidden tab must not keep the van running: pause, and carry on when it is shown again.
  const onVisibility = () => {
    const s = useRideStore.getState()
    if (document.hidden) {
      if (s.playing) {
        resumeOnVisible = true
        useRideStore.setState({ playing: false })
      }
    } else if (resumeOnVisible) {
      resumeOnVisible = false
      playRide()
    }
  }
  const hasDocument = typeof document !== 'undefined'
  if (hasDocument) document.addEventListener('visibilitychange', onVisibility)
  return () => {
    unsubTrip()
    unsubRoutes()
    if (hasDocument) document.removeEventListener('visibilitychange', onVisibility)
  }
}

/**
 * Start the ride from the current trip, playing from day one. False (nothing changes) when it cannot:
 * see `rideAvailabilityFor`. Clears what the locked sidebar would otherwise keep open: an expanded
 * row, a rename, the selected leg's editor, the mobile slide-over.
 */
export function startRide(): boolean {
  if (useRideStore.getState().active) return true
  const { trip } = useTripStore.getState()
  const legs = getLegRoutes()
  if (!rideAvailabilityFor(trip.places.length, legs.map((l) => l.status)).ok) return false
  const timeline = currentTimeline()
  if (!timeline) return false

  const ui = useUiStore.getState()
  // The panes that fed hover are about to go inert: a "mouseout" would never come.
  ui.hoverPlace(null)
  ui.hoverLeg(null)
  ui.expandPlace(null)
  ui.renamePlace(null)
  ui.selectPlace(null)
  ui.selectLeg(null)
  ui.setSidebarOpen(false)

  source = { tripId: trip.id, legs }
  cache = null
  stepClock = 0
  resumeOnVisible = false
  scrubResume = false
  stopWatching?.()
  stopWatching = watchSources()
  useRideStore.setState({ active: true, playing: true, time: 0, timeline, placeIndex: 0, keepView: false })
  runLoop()
  return true
}

/**
 * End the ride. By default the map goes back to the view it had before; pass `keepView` when something
 * else has just taken over the map (a file opened and fitted it) and must win.
 */
export function closeRide({ keepView = false }: { keepView?: boolean } = {}): void {
  cancelFrame()
  stopWatching?.()
  stopWatching = null
  source = null
  cache = null
  useRideStore.setState({ active: false, playing: false, time: 0, timeline: null, placeIndex: 0, keepView })
}

/** The controls as one object, for the dev-only `window.__ROADMAP__.ride` (tests drive the ride with it). */
export const rideDebug = {
  store: useRideStore,
  start: startRide,
  close: closeRide,
  play: playRide,
  pause: pauseRide,
  seek: seekRide,
  stepDay: stepRideDay,
  setSpeed: setRideSpeed,
  setFollow: setRideFollow,
  sample: (): RideSample | null => {
    const { timeline, time } = useRideStore.getState()
    return timeline ? rideSample(timeline, time) : null
  },
}

declare module '../../types/debug' {
  interface RoadmapDebug {
    /** The ride's store and controls (see `rideDebug` in features/ride/rideStore.ts). */
    ride?: typeof rideDebug
  }
}
