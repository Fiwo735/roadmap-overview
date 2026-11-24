import type { VideoLength } from './options'

// Framework-free: how the video's seconds map onto the ride's clock (`ride/timeline.ts`), and what is on screen when.
//
//   |-- intro hold --|-------------- the ride ---------------|---- end hold ----|
//   the start, still      the timeline, at a steady pace         the finished trip

export const FPS = 30
/** The opening still: the card and the start of the route, before anything moves. */
export const INTRO_S = 1
/** The closing still on the finished trip (the credit is shown again here). */
export const END_S = 3
/** No video is longer than this, whatever the trip: a 400-day trip would otherwise be minutes of van. */
export const MAX_VIDEO_S = 120
/** The ride itself is never shorter than this (a one-day trip at its own pace is only 2.5 s). */
export const MIN_RIDE_S = 4

export interface Schedule {
  fps: number
  /** Number of frames; frame `i` is shown at `i / fps` seconds. */
  frames: number
  /** `frames / fps`. */
  duration: number
  intro: number
  /** Seconds of the video in which the vehicle moves. */
  ride: number
  end: number
  /** The timeline's own length (seconds at 1×) this ride is spread over. */
  timelineS: number
  /** The pace of the live ride would have been longer than the cap allows: the video is sped up. */
  capped: boolean
}

/**
 * The schedule for a video of `length`, for a ride whose timeline lasts `timelineS` seconds at 1×. A fixed length is
 * that many seconds in all (the ride is what is left after the two holds); `'ride'` plays the timeline at its live pace
 * (1×), at least `MIN_RIDE_S` and at most what `MAX_VIDEO_S` leaves after the holds.
 */
export function planSchedule(length: VideoLength, timelineS: number): Schedule {
  const holds = INTRO_S + END_S
  const timeline = Number.isFinite(timelineS) && timelineS > 0 ? timelineS : 0
  let ride: number
  let capped = false
  if (length === 'ride') {
    const longest = MAX_VIDEO_S - holds
    ride = Math.max(MIN_RIDE_S, Math.min(longest, timeline))
    capped = timeline > longest
  } else {
    ride = Math.max(MIN_RIDE_S, Number(length) - holds)
  }
  const frames = Math.max(2, Math.round((holds + ride) * FPS))
  const duration = frames / FPS
  // Keep the holds exact and let the ride absorb the rounding.
  return { fps: FPS, frames, duration, intro: INTRO_S, ride: duration - holds, end: END_S, timelineS: timeline, capped }
}

export type Phase = 'intro' | 'ride' | 'end'

export interface FrameClock {
  index: number
  /** Seconds into the video. */
  time: number
  phase: Phase
  /** Seconds along the ride's timeline (at 1×) this frame shows: 0 in the intro, the whole timeline in the end hold. */
  rideTime: number
  /** 0 … 1 through the ride phase (0 in the intro, 1 in the end hold). */
  rideProgress: number
}

/** What frame `index` (clamped to the video) shows. */
export function frameClock(schedule: Schedule, index: number): FrameClock {
  const i = Math.min(schedule.frames - 1, Math.max(0, Math.round(index)))
  const time = i / schedule.fps
  const { intro, ride, timelineS } = schedule
  if (time < intro) return { index: i, time, phase: 'intro', rideTime: 0, rideProgress: 0 }
  // The end hold starts on the first frame at or after the ride's last instant, so the last frame of the ride phase is just before it.
  if (time >= intro + ride - 1e-9) return { index: i, time, phase: 'end', rideTime: timelineS, rideProgress: 1 }
  const rideProgress = (time - intro) / ride
  return { index: i, time, phase: 'ride', rideTime: rideProgress * timelineS, rideProgress }
}

/** What a frame of the video shows, in words (the dialog's caption under the preview, and tests). */
export interface FrameInfo {
  index: number
  /** Seconds into the video. */
  time: number
  phase: Phase
  day: number
  /** The day panel's date, when the trip has a start date. */
  date: string | null
  /** The day panel's second line: "Lyon → Annecy", "Resting in …", "Arrived in …". */
  caption: string
  /** 0 … 1: how much the camera follows (0 = the whole trip is in view). */
  follow: number
}

/**
 * For a recorder that watches the canvas in real time: when frame `index` is due, `elapsedMs` after the recording began, and which
 * frame to draw now. Not yet due: wait `waitMs` and draw it. Due, or late: draw the frame that is current (frames that have gone by
 * are skipped, so the video keeps its pace and is only less smooth), never beyond the last.
 */
export function paceFrame(schedule: Pick<Schedule, 'fps' | 'frames'>, index: number, elapsedMs: number): { waitMs: number; index: number } {
  const dueMs = (index * 1000) / schedule.fps
  if (elapsedMs < dueMs) return { waitMs: dueMs - elapsedMs, index }
  return { waitMs: 0, index: Math.min(schedule.frames - 1, Math.max(index, Math.floor((elapsedMs * schedule.fps) / 1000))) }
}

/** How many days of the trip go by in each second of the ride (to warn that a short video makes a hurried one). */
export const daysPerSecond = (schedule: Schedule, days: number): number => (schedule.ride > 0 ? days / schedule.ride : 0)

// ---- The credit ------------------------------------------------------------------------------------------------
//
// OpenStreetMap's attribution guideline for a video in which a map is a major component: "the attribution should typically
// appear in a corner of the map, in addition to attribution in the end credits or description. As long as the credit is on
// screen long enough to be read, it does not have to remain in view during panning or zooming." (ARCHITECTURE.md → F13.)
// So it is shown in full for the first five seconds (the interactive-map rule's time), fades, and comes back on the end hold.

/** Seconds the credit stays fully visible from the start. */
export const CREDIT_OPENING_S = 5
/** Seconds each fade takes. */
export const CREDIT_FADE_S = 0.6
/** The credit is fully on again this long before the end hold, and for all of it. */
const CREDIT_LEAD_S = 0.3

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Opacity (0 … 1) of the OpenStreetMap credit at `time` seconds into a video with this schedule. */
export function creditAlpha(time: number, schedule: Schedule): number {
  const opening = 1 - clamp01((time - CREDIT_OPENING_S) / CREDIT_FADE_S)
  const closing = clamp01((time - (schedule.intro + schedule.ride - CREDIT_LEAD_S)) / CREDIT_FADE_S)
  return Math.max(opening, closing)
}

/** Seconds the credit is fully visible on the end hold: what the viewer has to read it. */
export const creditEndHoldS = (schedule: Schedule): number => schedule.end - (CREDIT_FADE_S - CREDIT_LEAD_S)
