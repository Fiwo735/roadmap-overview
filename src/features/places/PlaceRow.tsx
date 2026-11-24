import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { EllipsisVertical, GripVertical, Image as PhotoIcon, LocateFixed, Pencil, StickyNote, Trash2 } from 'lucide-react'
import { Button } from '../../components/Button'
import { IconButton } from '../../components/IconButton'
import { Menu, type MenuEntry } from '../../components/Menu'
import { useTooltip } from '../../components/Tooltip'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import type { Place } from '../../types/trip'
import { LegConnector } from '../legs/LegConnector'
import { PlacePhotos } from '../photos/PlacePhotos'
import { useRideStore } from '../ride/rideStore'
import { DayField } from './DayField'
import { PlaceNote } from './PlaceNote'
import { PlaceSearch } from './PlaceSearch'
import { displayName } from './names'
import { replacePlaceFromResult, zoomToPlace } from './placeActions'

interface PlaceRowProps {
  place: Place
  index: number
  isLast: boolean
  /** Effective day of the stop before this one, set when this row's day is earlier than it. */
  earlierThan?: number
}

/** Inline name editor: Enter or blur saves (as a custom name), Escape cancels. */
function RenameField({ place }: { place: Place }) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(place.name)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  function finish(save: boolean) {
    if (done.current) return
    done.current = true
    const name = value.trim()
    if (save && name && name !== place.name) {
      useTripStore.getState().updatePlace(place.id, { name, customName: true })
    }
    useUiStore.getState().renamePlace(null)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(true)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      finish(false)
    }
  }

  return (
    <input
      ref={ref}
      className="place-row__rename"
      data-testid="place-rename-input"
      type="text"
      aria-label={`Name of place ${place.name}`}
      autoComplete="off"
      spellCheck={false}
      maxLength={120}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
    />
  )
}

export function PlaceRow({ place, index, isLast, earlierThan }: PlaceRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: place.id,
  })
  const itemRef = useRef<HTMLLIElement | null>(null)
  const mainRef = useRef<HTMLButtonElement>(null)
  const expanded = useUiStore((s) => s.expandedPlaceId === place.id)
  const renaming = useUiStore((s) => s.renamingPlaceId === place.id)
  const selected = useUiStore((s) => s.selectedPlaceId === place.id)
  const hovered = useUiStore((s) => s.hoveredPlaceId === place.id)
  // While riding: the place the van is at, and the ones it has been to.
  const ride = useRideStore((s) => (!s.active ? undefined : s.placeIndex === index ? 'current' : s.placeIndex > index ? 'reached' : undefined))
  const name = displayName(place.name)
  const addressTip = useTooltip<HTMLButtonElement>(place.address)
  const menuLabel = `Actions for ${name}`

  // Clicking anywhere outside the row (the map, another row, …) collapses the search. On `click`,
  // not on press: collapsing shifts the rows below, and that must not happen between the press and
  // the release of a click on one of them. The row's own menu is portalled out of the row, but
  // still part of it.
  useEffect(() => {
    if (!expanded) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element
      if (itemRef.current?.contains(target)) return
      if (target.closest('[role="menu"]')?.getAttribute('aria-label') === menuLabel) return
      useUiStore.getState().expandPlace(null)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [expanded, menuLabel])

  const toggle = () => {
    const ui = useUiStore.getState()
    ui.selectPlace(place.id)
    ui.expandPlace(expanded ? null : place.id)
  }

  const collapse = () => {
    useUiStore.getState().expandPlace(null)
    mainRef.current?.focus()
  }

  const menuItems: MenuEntry[] = [
    {
      id: 'rename',
      label: 'Rename',
      icon: <Pencil size={16} />,
      onSelect: () => useUiStore.getState().renamePlace(place.id),
    },
    { id: 'zoom', label: 'Zoom to', icon: <LocateFixed size={16} />, onSelect: () => zoomToPlace(place) },
    { id: 'sep', type: 'separator' },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 size={16} />,
      danger: true,
      onSelect: () => useTripStore.getState().removePlace(place.id),
    },
  ]

  return (
    <li
      ref={(el) => {
        itemRef.current = el
        setNodeRef(el)
      }}
      className="place-item"
      data-place-id={place.id}
      data-testid="place-item"
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div
        className="place-card"
        data-selected={selected || undefined}
        data-hovered={hovered || undefined}
        data-expanded={expanded || undefined}
        data-ride={ride}
        // Mouse only: after a touch tap there is no pointer to leave again, so it would stay stuck.
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') useUiStore.getState().hoverPlace(place.id)
        }}
        onPointerLeave={() => {
          if (useUiStore.getState().hoveredPlaceId === place.id) useUiStore.getState().hoverPlace(null)
        }}
      >
        <div className="place-row" data-testid="place-row">
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="place-row__grip"
            data-testid="place-grip"
            aria-label={`Reorder ${name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={16} />
          </button>

          {renaming ? (
            <div className="place-row__main place-row__main--editing">
              <span className="place-badge">{index + 1}</span>
              <RenameField place={place} />
            </div>
          ) : (
            <button
              ref={mainRef}
              type="button"
              className="place-row__main"
              data-testid="place-main"
              aria-expanded={expanded}
              onClick={toggle}
              {...addressTip.props}
            >
              <span className="place-badge">{index + 1}</span>
              <span className="place-row__name" data-testid="place-name">
                {name}
              </span>
              {place.note ? (
                <span className="place-row__note" data-testid="place-note-indicator" title={place.note}>
                  <StickyNote size={13} aria-hidden="true" />
                  <span className="sr-only">Has a note</span>
                </span>
              ) : null}
              {place.photos?.length ? (
                <span className="place-row__photos" data-testid="place-photos-indicator" title={`${place.photos.length} photo${place.photos.length === 1 ? '' : 's'}`}>
                  <PhotoIcon size={13} aria-hidden="true" />
                  {place.photos.length}
                  <span className="sr-only"> {place.photos.length === 1 ? 'photo' : 'photos'}</span>
                </span>
              ) : null}
            </button>
          )}
          {addressTip.tooltip}

          <DayField placeId={place.id} name={name} day={place.day} earlierThan={earlierThan} />

          <Menu
            label={menuLabel}
            align="end"
            items={menuItems}
            trigger={(triggerProps) => (
              <IconButton
                {...triggerProps}
                size="sm"
                label={menuLabel}
                tooltip="More actions"
                icon={<EllipsisVertical size={16} />}
                data-testid="place-menu"
              />
            )}
          />
        </div>

        {expanded ? (
          <div
            className="place-panel"
            data-testid="place-panel"
            onKeyDown={(e) => {
              if (e.key === 'Escape') collapse()
            }}
          >
            <div className="place-panel__address">
              <span data-testid="place-address">{place.address || 'No address saved for this place.'}</span>
              <Button
                size="sm"
                variant="ghost"
                icon={<Pencil size={14} />}
                onClick={() => useUiStore.getState().renamePlace(place.id)}
              >
                Rename
              </Button>
            </div>
            <PlaceSearch
              label={`Search a new location for ${name}`}
              initialQuery={place.name}
              placeholder="Search for a place…"
              autoFocus
              onPick={(result) => replacePlaceFromResult(place.id, result)}
              onEscape={collapse}
              testId="row-search"
            />
            <PlaceNote placeId={place.id} note={place.note ?? ''} placeName={name} onEscape={collapse} />
            <PlacePhotos place={place} placeName={name} />
          </div>
        ) : null}
      </div>
      {isLast ? null : <LegConnector legIndex={index} />}
    </li>
  )
}
