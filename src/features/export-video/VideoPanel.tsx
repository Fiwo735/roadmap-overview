import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clapperboard, Copy, Download, Share2, TriangleAlert, X } from 'lucide-react'
import { Button } from '../../components/Button'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Spinner } from '../../components/Spinner'
import { Switch } from '../../components/Switch'
import { toast } from '../../components/toast'
import { modesInUse } from '../../lib/legModes'
import { isAbortError } from '../../lib/requestQueue'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import { CREDIT_CAPTION } from '../export-image/attribution'
import { tripFingerprint } from '../../lib/recentTrips'
import { canCopyText, copyText, downloadBlob } from '../export-image/deliver'
import { setExportBusy } from '../export-image/exportTab'
import type { CardStyle } from '../export-image/options'
import { PresetPicker } from '../export-image/PresetPicker'
import { rideAvailabilityFor, timelineFor } from '../ride/rideStore'
import { useLegRoutes } from '../routing/legRoutes'
import { useTripStats } from '../stats/useTripStats'
import { describeEncoding, detectEncoding, type Encoding } from './encoding'
import { daysPerSecond, FPS, MAX_VIDEO_S, planSchedule } from './schedule'
import { presetOf, VIDEO_PRESETS, videoFilename, type VideoCamera, type VideoLength, type VideoOptions } from './options'
import { estimateRemainingS, formatClock, formatRemaining, overallProgress, type VideoProgress } from './progress'
import { renderRideVideo, type RideVideoResult } from './renderRideVideo'
import { useVideoPreview, type VideoPreviewParams } from './useVideoPreview'
import { useVideoOptions } from './videoStore'

/** Longest side of the preview frame on screen, in CSS pixels. */
const FRAME_MAX = 420

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const LENGTHS: readonly { value: VideoLength; label: string }[] = [
  { value: '15', label: '15 s' },
  { value: '30', label: '30 s' },
  { value: '60', label: '60 s' },
  { value: 'ride', label: 'Ride pace' },
]

const formatBytes = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} kB`)

interface Job {
  controller: AbortController
  progress: VideoProgress
  /** When the frames began (the time left is worked out from the frames done since). */
  framesStartedAt: number | null
  /** Seconds left, as far as can be told yet. */
  remaining: number | null
}

interface Finished {
  /** What it was made for (`resultKey`): another choice, or another trip, makes it stale. */
  key: string
  video: RideVideoResult
  filename: string
  file: File
  url: string
  canShare: boolean
}

interface Outcome {
  kind: 'info' | 'warning' | 'error'
  text: string
}

function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/** What the browser can encode at this size: looked at once per size (a handful of quick questions). */
function useEncoding(width: number, height: number): Encoding | null | 'checking' {
  const [found, setFound] = useState<{ key: string; encoding: Encoding | null } | null>(null)
  const key = `${width}×${height}`
  useEffect(() => {
    let current = true
    detectEncoding({ width, height }, FPS).then(
      (encoding) => current && setFound({ key, encoding }),
      () => current && setFound({ key, encoding: null }),
    )
    return () => {
      current = false
    }
  }, [key, width, height])
  return found?.key === key ? found.encoding : 'checking'
}

/**
 * The Video tab (F13): choose the size, the length and the camera, look at any frame of the video, render it with a progress
 * bar and a time estimate (cancellable), then download it or share it. `footer` is where the dialog wants its buttons.
 */
export function VideoPanel({ footer }: { footer: HTMLElement | null }) {
  const options = useVideoOptions((s) => s.options)
  const updateOptions = useVideoOptions((s) => s.setOptions)
  const appTheme = useUiStore((s) => s.theme)
  const trip = useTripStore((s) => s.trip)
  const legs = useLegRoutes()
  const { stats, countriesStatus } = useTripStats()

  const preset = presetOf(options.preset)
  const theme = options.cardStyle === 'auto' ? appTheme : options.cardStyle
  const availability = rideAvailabilityFor(
    trip.places.length,
    legs.map((l) => l.status),
  )
  const canLegend = modesInUse(legs).length > 1
  const encoding = useEncoding(preset.width, preset.height)

  // The length of the video follows from the ride's clock and the choice; known at once, before anything is drawn.
  const timeline = useMemo(() => timelineFor(trip.places, legs, trip.startDate), [trip.places, trip.startDate, legs])
  const schedule = useMemo(() => (timeline ? planSchedule(options.length, timeline.duration) : null), [timeline, options.length])

  const params = useMemo<VideoPreviewParams | null>(
    () =>
      availability.ok && countriesStatus !== 'loading'
        ? { trip: { title: trip.title, subtitle: trip.subtitle, startDate: trip.startDate, places: trip.places, vehicle: trip.vehicle }, legs, stats, countriesStatus, options, theme }
        : null,
    [availability.ok, countriesStatus, trip, legs, stats, options, theme],
  )

  // ---- The preview: any frame of the video.
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const preview = useVideoPreview(params)
  const scene = preview.status === 'ready' || preview.status === 'updating' ? preview.scene : null
  const [position, setPosition] = useState(0.4)
  const frameIndex = scene ? Math.round(position * (scene.schedule.frames - 1)) : 0
  // The finished video takes the preview's place (and gives it back, on a fresh canvas, when the choices change).
  const [finished, setFinished] = useState<Finished | null>(null)
  // A finished video belongs to the choices it was made with and the trip's content. Not to the objects the parameters are made of: those are new
  // whenever a route arrives late or the statistics are worked out again, which changes nothing the user chose or sees.
  const resultKey = useMemo(() => `${JSON.stringify(options)}|${theme}|${tripFingerprint(trip)}`, [options, theme, trip])
  const result = finished && finished.key === resultKey ? finished : null
  const showingVideo = result !== null
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !scene) return
    if (canvas.width !== scene.canvasWidth || canvas.height !== scene.canvasHeight) {
      canvas.width = scene.canvasWidth
      canvas.height = scene.canvasHeight
    }
    const ctx = canvas.getContext('2d')
    if (ctx) scene.draw(ctx, frameIndex)
  }, [scene, frameIndex, showingVideo])
  const frameInfo = scene ? scene.info(frameIndex) : null

  // ---- Rendering.
  const [job, setJob] = useState<Job | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [captionCopied, setCaptionCopied] = useState(false)
  const copiedTimer = useRef<number | undefined>(undefined)
  const mounted = useRef(false)
  const running = useRef<AbortController | null>(null)
  const urls = useRef<string | null>(null)
  // The dialog's other tab waits while the video is made.
  const rendering = job !== null
  useEffect(() => {
    setExportBusy(rendering)
    return () => setExportBusy(false)
  }, [rendering])
  // The dialog unmounts when it closes (and the tab when the other one is chosen): whatever is still being made is stopped and let go of.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      running.current?.abort()
      window.clearTimeout(copiedTimer.current)
      if (urls.current) URL.revokeObjectURL(urls.current)
    }
  }, [])

  /** Let go of the finished video (its file is held in memory and by an object URL). */
  function forgetFinished() {
    if (urls.current) URL.revokeObjectURL(urls.current)
    urls.current = null
    setFinished(null)
  }

  // Another choice makes a finished video go away (its file is let go of, and so is its object URL).
  const setOptions = (patch: Partial<VideoOptions>) => {
    setOutcome(null)
    forgetFinished()
    updateOptions(patch)
  }

  async function render() {
    if (!params || !availability.ok || job || encoding === 'checking' || encoding === null) return
    const key = resultKey
    const controller = new AbortController()
    running.current = controller
    setOutcome(null)
    forgetFinished()
    setJob({ controller, progress: { phase: 'map', done: 0, total: 0 }, framesStartedAt: null, remaining: null })
    try {
      const video = await renderRideVideo({
        ...params,
        encoding,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!mounted.current) return
          const now = performance.now()
          setJob((j) => {
            if (!j) return j
            const framesStartedAt = j.framesStartedAt ?? (progress.phase === 'frames' ? now : null)
            const remaining = progress.phase === 'frames' && framesStartedAt !== null ? estimateRemainingS(progress.done, progress.total, now - framesStartedAt) : null
            return { ...j, progress, framesStartedAt, remaining }
          })
        },
      })
      if (!mounted.current) return
      const filename = videoFilename(trip.title, video.extension)
      const file = new File([video.blob], filename, { type: video.mime })
      const url = URL.createObjectURL(video.blob)
      urls.current = url
      setFinished({ key, video, filename, file, url, canShare: canShareFile(file) })
    } catch (error) {
      if (!mounted.current) return
      if (isAbortError(error)) setOutcome({ kind: 'info', text: 'Cancelled: nothing was kept.' })
      else setOutcome({ kind: 'error', text: `The video could not be made: ${error instanceof Error && error.message ? error.message : 'something went wrong.'}` })
    } finally {
      if (mounted.current) setJob(null)
      if (running.current === controller) running.current = null
    }
  }

  async function share() {
    if (!result) return
    try {
      await navigator.share({ files: [result.file], title: trip.title.trim() || 'Trip', text: CREDIT_CAPTION })
    } catch (error) {
      if (!isAbortError(error)) toast.error('The video could not be shared. Download it instead.')
    }
  }

  async function copyCaption() {
    if (!(await copyText(CREDIT_CAPTION))) {
      toast.error('The caption could not be copied. Select it and copy it yourself.')
      return
    }
    if (!mounted.current) return
    setCaptionCopied(true)
    window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCaptionCopied(false), 2000)
  }

  // ---- What to say.
  const days = timeline ? timeline.lastDay - timeline.firstDay + 1 : 0
  const notes: string[] = []
  if (availability.ok === false && trip.places.length >= 2) notes.push(availability.reason)
  if (trip.places.length >= 2) {
    if (stats.failedLegs > 0) notes.push(`${plural(stats.failedLegs, 'leg', 'legs')} could not be routed: the vehicle takes a straight line there.`)
    if (encoding === null) notes.push('This browser cannot make videos (it has neither WebCodecs nor a canvas recorder). Try a recent Chrome, Edge, Safari or Firefox.')
    if (schedule?.capped) notes.push(`At the ride’s own pace this would be longer than ${formatClock(MAX_VIDEO_S)}, so the video is sped up to ${formatClock(schedule.duration)}.`)
    else if (schedule && days > 1 && daysPerSecond(schedule, days) >= 2.5) notes.push(`A quick ride: about ${Math.round(daysPerSecond(schedule, days))} days of the trip go by every second. Choose a longer video to slow it down.`)
    if (options.camera === 'follow' && scene?.cameraNote) notes.push(scene.cameraNote)
    if (scene && scene.tiles.failed > 0 && !result) notes.push(`${scene.tiles.failed} of ${plural(scene.tiles.total, 'map tile', 'map tiles')} could not be loaded in the preview, so the map has gaps. The video is still made.`)
    if (scene && scene.hiddenLabels > 0) notes.push(`${plural(scene.hiddenLabels, 'place name', 'place names')} did not fit on the map and ${scene.hiddenLabels === 1 ? 'is' : 'are'} left out.`)
    if (typeof encoding === 'object' && encoding && encoding.kind === 'recorder') notes.push('This browser records the video as it is drawn, in real time: it takes as long as the video does, so keep this tab in front.')
  }

  const progress = job ? overallProgress(job.progress) : 0
  const progressText = job
    ? job.progress.phase === 'map'
      ? job.progress.total > 0
        ? `Loading map tiles ${job.progress.done} of ${job.progress.total}…`
        : 'Preparing the map…'
      : job.progress.phase === 'frames'
        ? `Rendering frame ${job.progress.done} of ${job.progress.total}…`
        : 'Finishing the file…'
    : ''
  const frameWidth = Math.round(FRAME_MAX * (preset.width / preset.height))
  const hasTrip = trip.places.length >= 2
  const summary = [
    `${preset.width} × ${preset.height} px`,
    schedule ? formatClock(schedule.duration) : null,
    typeof encoding === 'object' && encoding ? describeEncoding(encoding) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div className="export" data-testid="video-panel">
        <div className="export__main">
          {hasTrip ? (
            <div className="export__frame" data-status={result ? 'ready' : preview.status} style={{ aspectRatio: `${preset.width} / ${preset.height}`, width: `min(100%, ${frameWidth}px)` }}>
              {result ? (
                <video className="export__video" src={result.url} controls playsInline preload="metadata" aria-label="The finished video" data-testid="video-player" />
              ) : (
                <canvas
                  ref={canvasRef}
                  className="export__canvas"
                  role="img"
                  aria-label={frameInfo ? `Preview of the video: day ${frameInfo.day}, ${frameInfo.caption}` : 'Preview of the video'}
                  data-testid="video-preview"
                  data-status={preview.status}
                />
              )}
              {!result && preview.status !== 'ready' && preview.status !== 'error' ? (
                <span className="export__busy" data-testid="video-preview-busy">
                  <Spinner size={16} label="Drawing the preview" />
                </span>
              ) : null}
              {!result && preview.status === 'error' ? <p className="export__frame-message">{preview.message}</p> : null}
            </div>
          ) : (
            <div className="export__empty" data-testid="video-empty">
              <Clapperboard size={28} aria-hidden="true" />
              <p>Add at least two places to render a video of the ride.</p>
            </div>
          )}

          {hasTrip && !result ? (
            <div className="export__scrub" style={{ width: `min(100%, ${frameWidth}px)` }}>
              <input
                type="range"
                min={0}
                max={1000}
                step={1}
                value={Math.round(position * 1000)}
                onChange={(e) => setPosition(Number(e.target.value) / 1000)}
                aria-label="Preview position"
                aria-valuetext={frameInfo ? `Day ${frameInfo.day}, ${frameInfo.caption}, ${formatClock(frameInfo.time)}` : undefined}
                disabled={!scene}
                data-testid="video-scrub"
              />
              <div className="export__scrub-row" aria-hidden="true">
                <span className="export__scrub-caption" data-testid="video-frame-caption">
                  {frameInfo ? `Day ${frameInfo.day} · ${frameInfo.caption}` : ' '}
                </span>
                <span>{frameInfo && schedule ? `${formatClock(frameInfo.time)} / ${formatClock(schedule.duration)}` : ' '}</span>
              </div>
            </div>
          ) : null}

          <p className="export__size" data-testid="video-summary">
            {summary || ' '}
          </p>

          <div className="export__status">
            {job ? (
              <div className="export__progress" data-testid="video-progress">
                <div className="export__bar" role="progressbar" aria-label="Video progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                  <span style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <div className="export__progress-line" aria-hidden="true">
                  <span data-testid="video-progress-text">{progressText}</span>
                  <span data-testid="video-progress-eta">{job.progress.phase === 'frames' ? formatRemaining(job.remaining) : ''}</span>
                </div>
                <span className="sr-only" role="status">
                  {job.progress.phase === 'map' ? 'Loading map tiles…' : job.progress.phase === 'frames' ? 'Rendering the video…' : 'Finishing the file…'}
                </span>
                <span className="export__keep-open">Keep this tab open and in front while the video is made.</span>
              </div>
            ) : result ? (
              <p className="export__outcome is-success" role="status" data-testid="video-outcome" data-kind="success">
                {`Video ready: ${result.video.width} × ${result.video.height} px, ${formatClock(result.video.duration)}, ${formatBytes(result.video.blob.size)} (${result.video.extension.toUpperCase()}).`}
                {result.video.tiles.failed > 0 ? ` ${result.video.tiles.failed} of ${plural(result.video.tiles.total, 'map tile', 'map tiles')} could not be loaded, so the map has gaps.` : ''}
              </p>
            ) : outcome ? (
              <p className={`export__outcome is-${outcome.kind === 'info' ? 'success' : outcome.kind}`} role={outcome.kind === 'error' ? 'alert' : 'status'} data-testid="video-outcome" data-kind={outcome.kind}>
                {outcome.kind !== 'info' ? <TriangleAlert size={14} aria-hidden="true" /> : null}
                {outcome.text}
              </p>
            ) : null}
          </div>

          {notes.length > 0 ? (
            <ul className="export__notes" data-testid="video-notes">
              {notes.map((note) => (
                <li key={note}>
                  <TriangleAlert size={14} aria-hidden="true" />
                  {note}
                </li>
              ))}
            </ul>
          ) : null}

          {hasTrip ? (
            <div className="export__caption" style={{ width: `min(100%, ${Math.max(frameWidth, 360)}px)` }} data-testid="video-credit">
              <h3 className="export__label">Credit</h3>
              <div className="export__caption-row">
                <p className="export__caption-text" data-testid="video-caption-text">
                  {CREDIT_CAPTION}
                </p>
                {canCopyText() ? (
                  <Button size="sm" icon={captionCopied ? <Check size={14} /> : <Copy size={14} />} onClick={copyCaption} data-testid="video-caption-copy">
                    {captionCopied ? 'Copied' : 'Copy'}
                  </Button>
                ) : null}
              </div>
              <p className="export__hint">The credit is in the video, at the start and at the end. Add it to the description when you post it.</p>
            </div>
          ) : null}
        </div>

        <div className="export__controls">
          <div className="export__group">
            <h3 className="export__label">Size</h3>
            <PresetPicker presets={VIDEO_PRESETS} value={options.preset} onChange={(id) => setOptions({ preset: id })} label="Video size" testIdPrefix="video-preset" />
          </div>

          <div className="export__group">
            <h3 className="export__label">Length</h3>
            <SegmentedControl<VideoLength> label="Video length" value={options.length} onChange={(length) => setOptions({ length })} options={LENGTHS} />
            {options.length === 'ride' ? (
              <p className="export__hint" data-testid="video-length-hint">
                The vehicle drives at the pace of the ride on the map.
              </p>
            ) : null}
          </div>

          <div className="export__group">
            <h3 className="export__label">Camera</h3>
            <SegmentedControl<VideoCamera>
              label="Camera"
              value={options.camera}
              onChange={(camera) => setOptions({ camera })}
              options={[
                { value: 'whole', label: 'Whole trip' },
                { value: 'follow', label: 'Follow' },
              ]}
            />
            <p className="export__hint" data-testid="video-camera-hint">
              {options.camera === 'whole' ? 'The whole trip stays in view.' : 'Zooms in on the vehicle; the whole trip shows at the start and the end.'}
            </p>
          </div>

          <div className="export__group">
            <h3 className="export__label">Show</h3>
            <div className="export__switches">
              <Switch checked={options.card} onChange={(card) => setOptions({ card })} data-testid="video-toggle-card">
                Title and statistics card
              </Switch>
              <Switch checked={options.labels} onChange={(labels) => setOptions({ labels })} data-testid="video-toggle-labels">
                Place names
              </Switch>
              <Switch checked={options.legend && canLegend} disabled={!canLegend} onChange={(legend) => setOptions({ legend })} data-testid="video-toggle-legend">
                Legend
              </Switch>
              {!canLegend ? <p className="export__hint">The legend appears when the trip uses more than one kind of travel.</p> : null}
            </div>
          </div>

          <div className="export__group">
            <h3 className="export__label">Card style</h3>
            <SegmentedControl<CardStyle>
              label="Card style"
              value={options.cardStyle}
              onChange={(cardStyle) => setOptions({ cardStyle })}
              options={[
                { value: 'auto', label: 'Match app' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </div>
        </div>
      </div>
      {footer
        ? createPortal(
            job ? (
              <Button icon={<X size={16} />} onClick={() => job.controller.abort()} data-testid="video-cancel">
                Cancel
              </Button>
            ) : result ? (
              <>
                <Button onClick={() => void render()} data-testid="video-again">
                  Render again
                </Button>
                {result.canShare ? (
                  <Button icon={<Share2 size={16} />} onClick={() => void share()} data-testid="video-share">
                    Share
                  </Button>
                ) : null}
                <Button variant="primary" icon={<Download size={16} />} onClick={() => downloadBlob(result.video.blob, result.filename)} data-testid="video-download">
                  Download video
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                icon={<Clapperboard size={16} />}
                disabled={!params || !availability.ok || encoding === 'checking' || encoding === null}
                onClick={() => void render()}
                data-testid="video-render"
              >
                Render video
              </Button>
            ),
            footer,
          )
        : null}
    </>
  )
}
