import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { Clapperboard, Crosshair, Flag, Pause, Play, RotateCcw, SkipBack, SkipForward, Tent, X } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { SegmentedControl } from '../../components/SegmentedControl'
import { formatDistance } from '../../lib/format'
import { MODES } from '../../lib/modes'
import { useTripStore } from '../../store/tripStore'
import { MODE_ICONS } from '../legs/modeIcons'
import { isTextEntry } from '../layout/shortcuts'
import { displayName } from '../places/names'
import { openExportDialog } from '../export-image/exportTab'
import {
  beginScrub,
  closeRide,
  endScrub,
  pauseRide,
  prefersReducedMotion,
  RIDE_SPEEDS,
  restartRide,
  seekRide,
  setRideFollow,
  setRideSpeed,
  stepRideDay,
  toggleRide,
  useRideSample,
  useRideStore,
  type RideSpeed,
} from './rideStore'
import { formatRideDate, rideCaption } from './rideText'
import { dayTicks, type Timeline } from './timeline'
import './ride.css'

const SPEED_OPTIONS = RIDE_SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))
/** Day numbers are written under the ticks when there are no more than this many of them. */
const LABELLED_TICKS = 14

/** Position along the scrubber track for a fraction 0 … 1, allowing for the width of the thumb. */
const along = (fraction: number) => `calc(var(--ride-thumb) / 2 + (100% - var(--ride-thumb)) * ${fraction})`

/** Space and the arrow keys while a ride is on; ignored where they belong to something else (a field, a menu, a dialog or a popover, the speed buttons). */
function useRideKeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (document.querySelector('dialog[open]')) return
      const target = e.target instanceof Element ? e.target : null
      const isRange = target instanceof HTMLInputElement && target.type === 'range'
      if (target && ((isTextEntry(target) && !isRange) || target.closest('[role="menu"], [role="radiogroup"], [role="dialog"]'))) return

      const handled = (action: () => void) => {
        e.preventDefault()
        // Before Leaflet's keyboard handling on the map (which would pan with the arrows).
        e.stopPropagation()
        action()
      }
      if (e.key === 'Escape') handled(() => closeRide())
      else if (e.key === 'ArrowLeft') handled(() => stepRideDay(-1))
      else if (e.key === 'ArrowRight') handled(() => stepRideDay(1))
      // A focused button or checkbox turns Space into its own click.
      else if (e.key === ' ' && !target?.closest('button, [role="radio"], a')) handled(toggleRide)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}

/**
 * Pause while the scrubber is held and resume when it is let go, wherever the pointer is then: the
 * release is listened for on the window, because a drag that ends outside the slider (over the map or
 * the sidebar) never reaches it.
 */
function useScrubHold(): () => void {
  const stop = useRef<(() => void) | null>(null)
  // Closing the ride mid-drag: drop the listeners (the ride's own state is reset by closeRide).
  useEffect(() => () => stop.current?.(), [])
  return () => {
    if (stop.current) return
    beginScrub()
    const release = () => {
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
      stop.current = null
      endScrub()
    }
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    stop.current = release
  }
}

function Scrubber({ timeline, time }: { timeline: Timeline; time: number }) {
  const holdScrub = useScrubHold()
  const sample = useRideSample()
  const places = useTripStore((s) => s.trip.places)
  const ticks = useMemo(() => dayTicks(timeline), [timeline])
  const fraction = timeline.duration > 0 ? time / timeline.duration : 0
  const labelled = ticks.length <= LABELLED_TICKS
  const names = places.map((p) => displayName(p.name))
  const caption = sample ? rideCaption(sample, names).text : ''

  return (
    <div className="ride-scrub" style={{ '--ride-progress': along(fraction) } as CSSProperties}>
      <div className="ride-scrub__track" aria-hidden="true" />
      <div className="ride-scrub__marks" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick.day} className="ride-scrub__tick" data-testid="ride-tick" data-day={tick.day} style={{ left: along(tick.time / timeline.duration) }}>
            {labelled ? <span className="ride-scrub__tick-label">{tick.day}</span> : null}
          </span>
        ))}
        {timeline.arrivals.map((at, i) => (
          <span
            key={i}
            className="ride-scrub__stop"
            data-testid="ride-stop-mark"
            data-reached={time >= at - 1e-4 || undefined}
            style={{ left: along(at / timeline.duration) }}
          />
        ))}
      </div>
      <input
        type="range"
        className="ride-scrub__input"
        data-testid="ride-scrub"
        aria-label="Ride progress"
        aria-valuetext={sample ? `Day ${sample.day}, ${caption}` : undefined}
        min={0}
        max={timeline.duration}
        step="any"
        value={time}
        onChange={(e) => seekRide(Number(e.target.value))}
        onPointerDown={holdScrub}
      />
    </div>
  )
}

function HudPanel({ timeline }: { timeline: Timeline }) {
  const time = useRideStore((s) => s.time)
  const playing = useRideStore((s) => s.playing)
  const speed = useRideStore((s) => s.speed)
  const follow = useRideStore((s) => s.follow)
  const sample = useRideSample()
  const places = useTripStore((s) => s.trip.places)
  const playRef = useRef<HTMLButtonElement>(null)
  useRideKeys()

  // Focus moves into the controls (so Space and Escape do what they say) and back to the button on close.
  useEffect(() => {
    playRef.current?.focus()
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || active.closest('.ride-hud')) document.getElementById('ride-button')?.focus()
    }
  }, [])

  // Keep the place the van is at in view in the (locked) list.
  const placeIndex = sample?.placeIndex ?? 0
  const placeId = places[placeIndex]?.id
  useEffect(() => {
    if (!placeId) return
    document
      .querySelector(`[data-testid="place-list"] [data-place-id="${CSS.escape(placeId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [placeId])

  if (!sample) return null
  const names = places.map((p) => displayName(p.name))
  const caption = rideCaption(sample, names)
  const date = formatRideDate(sample.date)
  const finished = sample.finished && !playing
  const ModeIcon = caption.kind === 'leg' ? MODE_ICONS[sample.mode] : caption.kind === 'end' ? Flag : Tent
  const modeColor = caption.kind === 'leg' ? MODES[sample.mode].color : undefined

  return (
    <section
      className="ride-hud"
      role="region"
      aria-label="Ride"
      data-testid="ride-hud"
      data-day={sample.day}
      data-playing={playing}
      data-finished={finished || undefined}
      data-vehicle={sample.mode}
    >
      <div className="ride-hud__head">
        <div className="ride-hud__day">
          <span className="ride-hud__day-number" data-testid="ride-day">
            Day {sample.day}
          </span>
          {date ? (
            <span className="ride-hud__date" data-testid="ride-date">
              {date}
            </span>
          ) : null}
        </div>
        <div className="ride-hud__where" data-kind={caption.kind}>
          <span className="ride-hud__mode" style={modeColor ? ({ '--mode-color': modeColor } as CSSProperties) : undefined} aria-hidden="true">
            <ModeIcon size={16} />
          </span>
          <span className="ride-hud__caption" data-testid="ride-caption">
            {caption.text}
          </span>
          {caption.kind === 'leg' ? (
            <span className="ride-hud__vehicle" data-testid="ride-vehicle-name">
              {MODES[sample.mode].label}
            </span>
          ) : null}
        </div>
      </div>

      <p className="ride-hud__stats">
        <span data-testid="ride-distance">{formatDistance(sample.distanceM)}</span>
        <span className="ride-hud__of"> of {formatDistance(timeline.totalDistanceM)}</span>
        <span className="ride-hud__dot" aria-hidden="true">
          ·
        </span>
        <span data-testid="ride-stop">
          Stop {sample.placeIndex + 1} of {timeline.placeCount}
        </span>
      </p>

      <Scrubber timeline={timeline} time={time} />

      <div className="ride-hud__controls">
        <div className="ride-hud__group" role="group" aria-label="Playback">
          <IconButton label="Previous day" tooltip="Previous day (←)" icon={<SkipBack size={16} />} onClick={() => stepRideDay(-1)} data-testid="ride-prev-day" />
          <IconButton
            ref={playRef}
            className="ride-hud__play"
            label={playing ? 'Pause' : finished ? 'Replay' : 'Play'}
            tooltip={playing ? 'Pause (Space)' : finished ? 'Replay' : 'Play (Space)'}
            icon={playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            onClick={toggleRide}
            data-testid="ride-play"
          />
          <IconButton label="Next day" tooltip="Next day (→)" icon={<SkipForward size={16} />} onClick={() => stepRideDay(1)} data-testid="ride-next-day" />
          <IconButton label="Restart" icon={<RotateCcw size={16} />} onClick={restartRide} data-testid="ride-restart" />
        </div>
        <div className="ride-hud__group">
          <SegmentedControl
            className="ride-hud__speed"
            label="Speed"
            value={String(speed)}
            options={SPEED_OPTIONS}
            onChange={(v) => setRideSpeed(Number(v) as RideSpeed)}
          />
          <IconButton
            label="Follow the vehicle"
            tooltip={follow ? 'Stop following the vehicle (show the whole trip)' : 'Follow the vehicle with the camera'}
            icon={<Crosshair size={18} />}
            aria-pressed={follow}
            onClick={() => setRideFollow(!follow)}
            data-testid="ride-follow"
          />
          <IconButton
            label="Record video"
            tooltip="Render this ride as a video"
            icon={<Clapperboard size={18} />}
            aria-haspopup="dialog"
            onClick={(e) => {
              // The video is made from the trip, not from the playback: pause so the ride is not running behind the dialog.
              pauseRide()
              openExportDialog('video', e.currentTarget)
            }}
            data-testid="ride-record"
          />
          <IconButton label="Close ride" tooltip="Close (Esc)" icon={<X size={18} />} onClick={() => closeRide()} data-testid="ride-close" />
        </div>
      </div>
    </section>
  )
}

/** Map overlay (bottom-centre) while a ride is on: the day, where the van is, and the playback controls. */
export function RideHud() {
  const timeline = useRideStore((s) => s.timeline)
  const active = useRideStore((s) => s.active)
  return active && timeline ? <HudPanel timeline={timeline} /> : null
}
