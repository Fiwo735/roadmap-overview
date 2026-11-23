import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { MapPinned, Sparkles } from 'lucide-react'
import { Button } from '../../components/Button'
import { effectiveDays } from '../../lib/trip'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import { loadSampleTrip } from '../io/importTrip'
import { useEditingLocked } from '../ride/rideStore'
import { PlaceRow } from './PlaceRow'
import { PlaceSearch } from './PlaceSearch'
import { displayName } from './names'
import { addPlaceFromResult } from './placeActions'
import './places.css'

/** The list is vertical: ignore sideways pointer movement. */
const lockHorizontal: Modifier = ({ transform }) => ({ ...transform, x: 0 })

const SCREEN_READER = {
  draggable:
    'To reorder, press space on the handle, move with the arrow keys, press space again to drop or Escape to cancel.',
}

/** Sidebar content: the sortable list of places (short form, day field, leg connectors) and the add box. */
export function PlacesPanel() {
  const places = useTripStore((s) => s.trip.places)
  const selectedId = useUiStore((s) => s.selectedPlaceId)
  // The list is read-only while editing is locked (a ride is on, F6): nothing in it can be focused or clicked.
  const locked = useEditingLocked()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const addRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(
    // A few pixels of travel before a drag starts keeps plain clicks on the handle clicks.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ids = useMemo(() => places.map((p) => p.id), [places])
  const eff = useMemo(() => effectiveDays(places), [places])

  // Clicking a marker selects its place: bring the row into view.
  useEffect(() => {
    if (!selectedId) return
    listRef.current?.querySelector(`[data-place-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const nameOf = (id: string | number) => displayName(places.find((p) => p.id === id)?.name ?? '')
  const position = (id: string | number) => `${ids.indexOf(String(id)) + 1} of ${ids.length}`
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, position ${position(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is over position ${position(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)} dropped at position ${position(over.id)}.` : `${nameOf(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Reordering cancelled. ${nameOf(active.id)} stays at position ${position(active.id)}.`,
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    setDraggingId(String(active.id))
    useUiStore.getState().hoverPlace(null)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggingId(null)
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from >= 0 && to >= 0) useTripStore.getState().movePlace(from, to)
  }

  return (
    <section className="places" aria-labelledby="places-heading" data-testid="places-panel" inert={locked}>
      <header className="places__header">
        <h2 id="places-heading" className="places__title">
          Places
        </h2>
        <span className="places__count" data-testid="places-count" aria-label={`${places.length} places`}>
          {places.length}
        </span>
      </header>

      {places.length === 0 ? (
        <div className="places__empty" data-testid="places-empty">
          <span className="empty-state__icon" aria-hidden="true">
            <MapPinned size={28} strokeWidth={1.75} />
          </span>
          <h3 className="empty-state__title">No stops yet</h3>
          <p className="empty-state__text">
            Search for a place below to add your first stop, or right-click the map and choose “Add place here”.
          </p>
          <Button variant="secondary" icon={<Sparkles size={16} />} onClick={() => void loadSampleTrip()} data-testid="load-sample">
            Load sample trip
          </Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[lockHorizontal]}
          accessibility={{ announcements, screenReaderInstructions: SCREEN_READER }}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDraggingId(null)}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul ref={listRef} className="place-list" data-testid="place-list" data-dragging={draggingId ? true : undefined}>
              {places.map((place, i) => (
                <PlaceRow
                  key={place.id}
                  place={place}
                  index={i}
                  isLast={i === places.length - 1}
                  earlierThan={i > 0 && place.day < eff[i - 1] ? eff[i - 1] : undefined}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <div ref={addRef} className="places__add">
        <PlaceSearch
          label="Add a place"
          placeholder="Add a place…"
          resetOnPick
          onPick={(result) => {
            addPlaceFromResult(result)
            // The new row is selected (and scrolled to); keep the box that adds the next one in view.
            requestAnimationFrame(() => addRef.current?.scrollIntoView({ block: 'nearest' }))
          }}
          testId="add-search"
        />
      </div>
    </section>
  )
}
