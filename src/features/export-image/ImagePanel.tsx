import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Download, ImageOff, TriangleAlert } from 'lucide-react'
import { Button } from '../../components/Button'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Spinner } from '../../components/Spinner'
import { Switch } from '../../components/Switch'
import { toast } from '../../components/toast'
import { modesInUse } from '../../lib/legModes'
import { isAbortError } from '../../lib/requestQueue'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import { useLegRoutes } from '../routing/legRoutes'
import { useTripStats } from '../stats/useTripStats'
import { CREDIT_CAPTION, type CreditMode } from './attribution'
import { canCopyImage, canCopyText, copyPng, copyText, downloadBlob } from './deliver'
import { setExportBusy } from './exportTab'
import { useExportOptions } from './exportStore'
import { exportFilename, isVeryLarge, LARGE_IMAGE_HINT, outputSize, presetOf, SIZE_PRESETS, type CardStyle, type ExportOptions, type ExportScale } from './options'
import { PresetPicker } from './PresetPicker'
import { canvasToPng, renderTripImage, type RenderProgress, type TripImageResult } from './renderTripImage'
import { usePreview, type PreviewParams } from './usePreview'
import './export.css'

/** Longest side of the preview frame on screen, in CSS pixels. */
const FRAME_MAX = 420

type Action = 'download' | 'copy'

interface Busy {
  action: Action
  phase: 'tiles' | 'drawing' | 'encoding'
  done: number
  total: number
}

interface Outcome {
  kind: 'success' | 'warning' | 'error'
  text: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function describeOutcome(action: Action, filename: string, result: TripImageResult): Outcome {
  const done = action === 'copy' ? 'Image copied to the clipboard' : `Saved ${filename}`
  const text = `${done} (${result.width} × ${result.height} px).`
  if (result.tiles.failed > 0) {
    return { kind: 'warning', text: `${text} ${result.tiles.failed} of ${plural(result.tiles.total, 'map tile', 'map tiles')} could not be loaded, so the map has gaps.` }
  }
  return { kind: 'success', text }
}

/** After a download without the credit in it: remind the user that it goes beside the picture. */
function remindOfCredit(copyCaption: () => void) {
  toast.info(`Add the credit when you post the image: ${CREDIT_CAPTION}`, {
    duration: 12_000,
    action: canCopyText() ? { label: 'Copy caption', onClick: copyCaption } : undefined,
  })
}

/** The Image tab: choose a size and what to show, check the preview, download or copy. `footer` is where the dialog wants its buttons. */
export function ImagePanel({ footer }: { footer: HTMLElement | null }) {
  const options = useExportOptions((s) => s.options)
  const updateOptions = useExportOptions((s) => s.setOptions)
  const appTheme = useUiStore((s) => s.theme)
  const trip = useTripStore((s) => s.trip)
  const legs = useLegRoutes()
  const { stats, countriesStatus } = useTripStats()

  const preset = presetOf(options.preset)
  const pixels = outputSize(options.preset, options.scale)
  const theme = options.cardStyle === 'auto' ? appTheme : options.cardStyle
  const hasPlaces = trip.places.length > 0
  const canLegend = modesInUse(legs).length > 1

  // Everything the image depends on; a new object means the preview must be drawn again. The countries
  // arrive a moment after the first render, so the first drawing waits for them.
  const params = useMemo<PreviewParams | null>(
    () =>
      hasPlaces && countriesStatus !== 'loading'
        ? {
            trip: { title: trip.title, subtitle: trip.subtitle, startDate: trip.startDate, places: trip.places },
            legs,
            stats,
            countriesStatus,
            width: preset.width,
            height: preset.height,
            card: options.card,
            labels: options.labels,
            days: options.days,
            legend: options.legend,
            credit: options.credit,
            theme,
          }
        : null,
    [hasPlaces, countriesStatus, trip, legs, stats, preset, options.card, options.labels, options.days, options.legend, options.credit, theme],
  )

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const preview = usePreview(canvasRef, params)

  const [busy, setBusy] = useState<Busy | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // The dialog's other tab waits while an image is being made.
  const making = busy !== null
  useEffect(() => {
    setExportBusy(making)
    return () => setExportBusy(false)
  }, [making])
  // The caption's Copy button says "Copied" for a moment.
  const [captionCopied, setCaptionCopied] = useState(false)
  const copiedTimer = useRef<number | undefined>(undefined)
  // What the last download said is about the options it was made with.
  const setOptions = (patch: Partial<ExportOptions>) => {
    setOutcome(null)
    updateOptions(patch)
  }
  // The dialog unmounts when it closes: whatever is still being drawn for it is stopped.
  const runs = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    runs.current = controller
    mounted.current = true
    return () => {
      mounted.current = false
      controller.abort()
      window.clearTimeout(copiedTimer.current)
    }
  }, [])

  // The caption's Copy button and the reminder after a download both come here; the button says "Copied".
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

  async function run(action: Action) {
    if (!params || busy) return
    const filename = exportFilename(trip.title)
    const signal = runs.current?.signal
    setOutcome(null)
    setBusy({ action, phase: 'tiles', done: 0, total: 0 })
    const onProgress = ({ phase, done, total }: RenderProgress) => setBusy((b) => (b ? { ...b, phase, done, total } : b))
    // The picture is drawn at the full size chosen, from the tiles the preview already has where it can.
    const rendered = renderTripImage({ ...params, width: preset.width, height: preset.height, scale: options.scale, retryFailedTiles: true, signal, onProgress }).then(async (result) => {
      setBusy((b) => (b ? { ...b, phase: 'encoding' } : b))
      return { result, blob: await canvasToPng(result.canvas) }
    })
    rendered.catch(() => undefined) // reported below; this keeps an early failure of the clipboard from leaving it unhandled
    const { credit } = params
    try {
      // The clipboard gets the picture alone (see `copyPng`); a download without the credit in it reminds of the caption.
      if (action === 'copy') await copyPng(rendered.then((r) => r.blob))
      else {
        downloadBlob((await rendered).blob, filename)
        if (credit === 'beside') remindOfCredit(() => void copyCaption())
      }
      const { result } = await rendered
      if (mounted.current) setOutcome(describeOutcome(action, filename, result))
    } catch (error) {
      if (isAbortError(error) || !mounted.current) return
      const message = error instanceof Error && error.message ? error.message : 'Something went wrong.'
      setOutcome({ kind: 'error', text: action === 'copy' ? `The image could not be copied: ${message}` : `The image could not be created: ${message}` })
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  const info = preview.status === 'ready' || preview.status === 'updating' ? preview.info : null
  const notes: string[] = []
  if (hasPlaces) {
    if (isVeryLarge(pixels)) notes.push(LARGE_IMAGE_HINT)
    if (stats.loadingLegs > 0) notes.push(`${plural(stats.loadingLegs, 'leg is', 'legs are')} still being routed and drawn as a dashed straight line for now. The preview updates when routing finishes.`)
    if (stats.failedLegs > 0) notes.push(`${plural(stats.failedLegs, 'leg', 'legs')} could not be routed: drawn as a red dashed line and left out of the totals.`)
    if (countriesStatus === 'failed') notes.push('The country boundaries could not be loaded, so the card shows no countries.')
    if (!outcome && info && info.tilesFailed > 0) notes.push(`${info.tilesFailed} of ${plural(info.tilesTotal, 'map tile', 'map tiles')} could not be loaded, so the map has gaps. The image is still made.`)
    if (info && info.hiddenLabels > 0) notes.push(`${plural(info.hiddenLabels, 'place name', 'place names')} did not fit on the map and ${info.hiddenLabels === 1 ? 'is' : 'are'} left out.`)
  }

  const progress = busy ? (busy.phase === 'tiles' ? (busy.total > 0 ? busy.done / busy.total : 0) : 1) : 0
  const progressText = busy
    ? busy.phase === 'tiles'
      ? busy.total > 0
        ? `Loading map tiles ${busy.done} of ${busy.total}…`
        : 'Preparing the map…'
      : busy.phase === 'drawing'
        ? 'Drawing the image…'
        : 'Creating the PNG…'
    : ''

  const frameWidth = Math.round(FRAME_MAX * (preset.width / preset.height))

  return (
    <>
      <div className="export">
        <div className="export__main">
          {hasPlaces ? (
            <div className="export__frame" data-status={preview.status} style={{ aspectRatio: `${preset.width} / ${preset.height}`, width: `min(100%, ${frameWidth}px)` }}>
              <canvas ref={canvasRef} className="export__canvas" role="img" aria-label="Preview of the image" data-testid="export-preview" data-status={preview.status} />
              {preview.status !== 'ready' && preview.status !== 'error' ? (
                <span className="export__busy" data-testid="export-preview-busy">
                  <Spinner size={16} label="Drawing the preview" />
                </span>
              ) : null}
              {preview.status === 'error' ? <p className="export__frame-message">{preview.message}</p> : null}
            </div>
          ) : (
            <div className="export__empty" data-testid="export-empty">
              <ImageOff size={28} aria-hidden="true" />
              <p>Add at least one place to export an image of your trip.</p>
            </div>
          )}

          <p className="export__size" data-testid="export-size">
            {pixels.width} × {pixels.height} px
          </p>

          {hasPlaces && options.credit === 'beside' ? (
            <div className="export__caption" style={{ width: `min(100%, ${Math.max(frameWidth, 360)}px)` }} data-testid="export-caption">
              <h3 className="export__label">Caption to post with the image</h3>
              <div className="export__caption-row">
                <p className="export__caption-text" data-testid="export-caption-text">
                  {CREDIT_CAPTION}
                </p>
                {canCopyText() ? (
                  <Button size="sm" icon={captionCopied ? <Check size={14} /> : <Copy size={14} />} onClick={copyCaption} data-testid="export-caption-copy">
                    {captionCopied ? 'Copied' : 'Copy'}
                  </Button>
                ) : null}
              </div>
              <p className="export__hint">
                OpenStreetMap’s licence asks for this credit next to the image.
                {canCopyText() ? ' Copy it with the button and post it with the picture.' : ''}
              </p>
            </div>
          ) : null}

          <div className="export__status">
            {busy ? (
              <div className="export__progress" data-testid="export-progress">
                <div className="export__bar" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                  <span style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                {/* Screen readers hear each step once, not every tile. */}
                <p aria-hidden="true">{progressText}</p>
                <span className="sr-only" role="status">
                  {busy.phase === 'tiles' ? 'Loading map tiles…' : busy.phase === 'drawing' ? 'Drawing the image…' : 'Creating the PNG…'}
                </span>
              </div>
            ) : outcome ? (
              <p className={`export__outcome is-${outcome.kind}`} role={outcome.kind === 'error' ? 'alert' : 'status'} data-testid="export-outcome" data-kind={outcome.kind}>
                {outcome.kind !== 'success' ? <TriangleAlert size={14} aria-hidden="true" /> : null}
                {outcome.text}
              </p>
            ) : null}
          </div>

          {notes.length > 0 ? (
            <ul className="export__notes" data-testid="export-notes">
              {notes.map((note) => (
                <li key={note}>
                  <TriangleAlert size={14} aria-hidden="true" />
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="export__controls">
          <div className="export__group">
            <h3 className="export__label">Size</h3>
            <PresetPicker presets={SIZE_PRESETS} value={options.preset} onChange={(id) => setOptions({ preset: id })} label="Image size" testIdPrefix="export-preset" />
          </div>

          <div className="export__group">
            <h3 className="export__label">Resolution</h3>
            <SegmentedControl<`${ExportScale}`>
              label="Resolution"
              value={`${options.scale}`}
              onChange={(v) => setOptions({ scale: Number(v) as ExportScale })}
              options={[
                { value: '1', label: '1×' },
                { value: '2', label: '2× sharper' },
              ]}
            />
          </div>

          <div className="export__group">
            <h3 className="export__label">Map credit</h3>
            <SegmentedControl<CreditMode>
              label="Map credit"
              value={options.credit}
              onChange={(credit) => setOptions({ credit })}
              options={[
                { value: 'beside', label: 'Beside the image' },
                { value: 'image', label: 'Small, in the image' },
              ]}
            />
            <p className="export__hint" data-testid="export-credit-hint">
              {options.credit === 'beside' ? 'Nothing is drawn on the image: post the caption with it.' : 'Drawn small in the bottom-right corner of the image.'}
            </p>
          </div>

          <div className="export__group">
            <h3 className="export__label">Show</h3>
            <div className="export__switches">
              <Switch checked={options.card} onChange={(card) => setOptions({ card })} data-testid="export-toggle-card">
                Title and statistics card
              </Switch>
              <Switch checked={options.labels} onChange={(labels) => setOptions({ labels })} data-testid="export-toggle-labels">
                Place names
              </Switch>
              <Switch checked={options.days} onChange={(days) => setOptions({ days })} data-testid="export-toggle-days">
                Day numbers
              </Switch>
              <Switch checked={options.legend && canLegend} disabled={!canLegend} onChange={(legend) => setOptions({ legend })} data-testid="export-toggle-legend">
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
            <>
              {canCopyImage() ? (
                <Button icon={<Copy size={16} />} loading={busy?.action === 'copy'} disabled={!params || busy !== null} onClick={() => run('copy')} data-testid="export-copy">
                  Copy image
                </Button>
              ) : null}
              <Button
                variant="primary"
                icon={<Download size={16} />}
                loading={busy?.action === 'download'}
                disabled={!params || busy !== null}
                onClick={() => run('download')}
                data-testid="export-download"
              >
                Download PNG
              </Button>
            </>,
            footer,
          )
        : null}
    </>
  )
}
