# Roadmap Overview — architecture

A single-page web app for summarising a campervan trip: an OpenStreetMap map with numbered,
labelled stops joined by the route actually taken (road-routed, reshapeable by dragging like
Google Maps, plus hand-drawn ferry/train/flight legs), trip statistics, a "ride" animation of a
little campervan driving the route day by day, JSON save/load/share and PNG export.

Everything runs in the browser. There is no backend: OSM tiles, OSRM routing and Nominatim
geocoding are called directly from the client.

## Stack

| Concern | Choice |
| --- | --- |
| Build | Vite 8, TypeScript 7 (`tsc -b`), oxlint |
| UI | React 19, plain CSS with theme tokens (no CSS framework), `lucide-react` icons |
| Map | Leaflet 1.9 + react-leaflet 5 (imperative Leaflet via `useMap()` where needed) |
| State | Zustand 5; `zundo` (temporal middleware) for undo/redo of trip intent |
| Lists | `@dnd-kit/core` + `@dnd-kit/sortable` |
| Geometry | `@mapbox/polyline` (precision 5) |
| Tests | Vitest (pure logic), Playwright 1.63 (`@playwright/test`, pinned to the preinstalled browsers) |

## Screen layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TopBar: logo · trip title (inline edit) · undo/redo · Ride · Image · File · theme │
├───────────────┬──────────────────────────────────────────────────────────┤
│ Sidebar       │ Map                                                      │
│  Places list  │  ┌ title + stats card (top-left)     map tools (top-right)┐│
│  (sortable,   │  │                                                       ││
│  day field,   │  │        markers, route, via handles, ride van          ││
│  leg rows     │  │                                                       ││
│  between)     │  └ scale (bottom-left)   ride HUD (bottom-centre)   zoom/attrib┘│
└───────────────┴──────────────────────────────────────────────────────────┘
```

The light/dark theme applies to everything **except the map tiles**, which always use the
standard OSM style. Our own overlays on the map (cards, HUD, menus) do follow the theme.

## Source layout

```
src/
  main.tsx, App.tsx          entry and layout (TopBar, Sidebar, map, toasts)
  bootstrap.ts               start-up: theme, restore autosave, start autosave, debug hook
  types/trip.ts              DATA CONTRACT (read this first)
  types/debug.ts             typing of the dev-only window.__ROADMAP__ hook
  lib/                       framework-free helpers — unit-tested with Vitest:
                             geo (haversine, bounds), polyline (encode/decode + memo), format,
                             id, trip (defaults, day rules, syncLegs), tripFile (parse/serialize),
                             routeKey, modes
  services/                  ALL network access: config.ts (tile/OSRM/Nominatim URLs), later
                             osrm.ts and nominatim.ts
  store/                     tripStore (undoable intent), uiStore, routeStore, persistence
  components/                shared UI primitives: Button, IconButton (+Tooltip), Menu, Dialog,
                             Toast (+ the `toast` API in toast.ts), Spinner, portal.ts (portal target and modal stack)
  features/<name>/           one folder per feature:
    layout/                  TopBar, Sidebar, TripTitle, UndoRedoButtons, shortcuts, Logo
    map/                     MapView, panes, mapInstance (getMap/useLeafletMap), view helpers
    theme/                   ThemeToggle, theme.ts (init/choose)
    places/ routing/ stats/ io/ ride/ export-image/   slot placeholders until their feature lands
  dev/                       UiKit page, served by the dev server at /ui-kit.html (not in the build)
  styles/                    tokens.css (theme variables), global.css
e2e/                         Playwright specs, fixtures.ts (service mocks + helpers), mocks/
```

Feature slots: the app shell renders a placeholder component for every planned feature. A
feature replaces its own placeholders instead of editing the shell, so features stay in their own
folders. Slots and where they render:

| Placeholder | Slot |
| --- | --- |
| `ride/RideButton`, `export-image/ExportImageButton`, `io/FileMenu` | top bar, right side (before the theme toggle) |
| `places/PlacesPanel` | sidebar content (empty state until F1) |
| `stats/StatsOverlay` | map overlay, top-left |
| `routing/MapTools` | map overlay, top-right |
| `ride/RideHud` | map overlay, bottom-centre |
| `places/PlacesLayer`, `routing/RouteLayer`, `routing/RouteManager`, `ride/RideLayer` | children of the `MapContainer` (`features/map/MapView.tsx`); use `useMap()` and the pane names from `features/map/panes.ts` |

## Data model

See `src/types/trip.ts`. Key rules:

- **Intent vs derived.** `Trip`/`Place`/`Leg` are user intent: undoable, autosaved, exported.
  `LegRoute` geometry/metrics are derived and live in the route store, keyed by
  `legRouteKey(from, to, leg)` (`src/lib/routeKey.ts`). Async routing results must never be
  written into the trip, otherwise undo history would fill with machine-made steps.
- **Legs are aligned with places.** `legs[i]` joins `places[i] → places[i+1]`. Every store
  action that changes `places` re-syncs `legs`, re-using a leg when its `(fromId, toId)` pair is
  still adjacent and creating `{ mode: 'drive', via: [] }` otherwise.
- **Days.** `place.day` is an integer `≥ 0` with no upper bound: the day of travel on which the
  place is reached. Days may be typed out of order; consumers use the *effective day*
  `eff[0] = day[0]`, `eff[i] = max(day[i], eff[i-1])`, and the UI flags rows whose day is lower
  than the previous one. Leg `i` is travelled on day `eff[i+1]`. Trip length in days is
  `eff[last] - eff[0] + 1`. New places default to `previous.day + 1` when appended (`0` for the
  first place) and to `previous.day` when inserted in the middle.
- **Durations.** `effectiveDurationS(leg, route)`: the user's `durationMin` override, else the
  route's duration (OSRM for drive legs, `estimateDurationS()` for the other modes).
- **Modes.** `src/lib/modes.ts` defines colours, dashes and speed estimates per mode. Map,
  sidebar and image export all read from it.

## State

- `store/tripStore.ts`: Zustand store holding `trip: Trip` plus actions; wrapped in zundo
  `temporal` so `undo()`/`redo()` cover intent only. Continuous edits (typing, dragging) must
  produce one history entry per gesture (commit on blur/Enter/drag end).
- `store/uiStore.ts`: non-undoable UI state — theme, mobile sidebar, selection/hover of places
  and legs, which place row is expanded into search, the open dialog id. Ids that disappear from
  the trip (undo, delete, import) are cleared automatically (`bootstrap.ts`). Features with
  self-contained state (ride playback, …) add their own small store.
- `store/routeStore.ts`: derived route cache `Record<key, LegRoute>` + per-key status
  (`loading`/`error`). Not undoable.
- `store/persistence.ts`: debounced autosave of a `TripFile` (trip + routes of current legs) to
  `localStorage["roadmap-overview:v1:current"]`, restored on start. Theme lives in
  `localStorage["roadmap-overview:theme"]`.
- **Debug hook.** In dev builds `window.__ROADMAP__` exposes the stores (`trip`, `ui`, `routes`,
  each a Zustand store; `trip.temporal` is the undo history) and `getMap()` (the Leaflet map) so
  Playwright and humans can inspect and drive state programmatically. Stripped from production.

## External services (and their usage policies)

All network calls go through `src/services/*`; components never call `fetch` directly.

| Service | Use | Rules we follow |
| --- | --- | --- |
| `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Map tiles, image export | Visible "© OpenStreetMap contributors" attribution (map and exported image); `crossOrigin` enabled so tiles can be drawn on canvas; no bulk prefetching. |
| `https://router.project-osrm.org/route/v1/driving/…` | Road routing of drive legs | `overview=full&geometries=polyline`; one request per leg (from, via…, to); a queue with ≤ 1 request in flight and ≥ 1 s between starts; results cached by key; stale requests aborted. |
| `https://nominatim.openstreetmap.org/search` and `/reverse` | Place search, naming dropped pins | **No search-as-you-type** (policy): search on Enter/button only. ≤ 1 request/s globally. `format=jsonv2&addressdetails=1`. |

Base URLs are constants in `src/services/config.ts` so they can be pointed elsewhere.

## Map conventions

- Draw order (Leaflet panes, bottom → top): tiles, route casing, route lines, via-point
  handles, place markers, labels, ride vehicle, popups/menus. Our panes are created in
  `features/map/panes.ts` (`PANES.routeCasing | route | via | markers | labels | ride`); pass the
  name as the `pane` option of a layer.
- Place markers: numbered circular pins with a permanent short label next to them.
- Route styling comes from `MODES` (`src/lib/modes.ts`). Hovered/selected legs get a
  highlight; legs still routing show a thin grey dashed straight placeholder.
- Map overlays are React components stacked above the map (not Leaflet popups), styled with the
  theme tokens. They live in `features/map/MapOverlays.tsx` as siblings of the Leaflet container,
  so pointer events never reach the map through them. Code outside the `MapContainer` reaches the
  map with `useLeafletMap()` / `getMap()` (`features/map/mapInstance.ts`).

## UI conventions

- Theme: `<html data-theme="light|dark">`, default from `prefers-color-scheme`, toggle persists
  the explicit choice. Colours only via the CSS variables in `styles/tokens.css`
  (`--bg`, `--surface`, `--surface-2/3`, `--border`, `--border-strong`, `--text`, `--text-muted`,
  `--text-faint`, `--accent`, `--accent-hover`, `--accent-contrast`, `--accent-soft`,
  `--accent-text` (accent as text/icon colour, lighter in dark mode), `--danger`, `--danger-text`,
  `--warning`, `--success`, `--shadow-sm|md|lg`, `--radius-sm|md|pill`, `--space-1…7` on an 8px
  grid, `--z-*` layers, …). `--accent` is the drive-route blue from `modes.ts`.
- Icons: `lucide-react`. Font: Inter (`@fontsource-variable/inter`).
- Every interactive element is keyboard reachable and has an accessible name.
  Add `data-testid` attributes to elements tests need; name them `kebab-case`.

## Testing and verification

| Command | What |
| --- | --- |
| `npm run dev` | dev server (`-- --port N` to pick a port) |
| `npm run typecheck` / `npm run lint` | `tsc -b` (app, node tooling, e2e) / oxlint |
| `npm test` | Vitest unit tests (`src/**/*.test.ts`, node environment) |
| `npm run e2e` | Playwright specs in `e2e/` (chromium; dev server on `E2E_PORT`, default 5199) |

- e2e specs mock tiles, OSRM and Nominatim (`e2e/fixtures.ts`, `e2e/mocks/`), so they run offline
  and never load the public services. The auto-fixture `mocks` also exposes request logs and
  failure switches (`mocks.osrm.failWith = 'NoRoute'`, `delayMs`, …) and aborts any other external
  request (`mocks.blocked`). `E2E_REAL_NETWORK=1` turns the mocks off.
- The `app` fixture reads and drives the app through `window.__ROADMAP__` (`app.trip()`,
  `app.addPlaces('Lyon', 'Annecy')`, `app.seedSavedTrip(file)`, `app.mapView()`, …). Prefer it
  over clicking through the UI when the UI is not what you are testing.
- Specs for shared components run against the dev-only `/ui-kit.html` page (`src/dev/UiKit.tsx`).
- Visual verification uses real tiles/routing/search through a dev server and screenshots.
  Chromium reaches the internet through the sandbox proxy: launch it with
  `proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }`.
- Several agents may run at once: always pass an explicit, unique port.

## Feature log

Each feature appends a short entry here: what it added, where it lives, anything non-obvious.

### F0 — app shell, map, theme, stores, shared UI, test infrastructure

- **Shell**: `App.tsx` lays out `TopBar`, `Sidebar` (360px; below 768px a slide-over toggled by
  `ui.sidebarOpen`, closed with Escape/backdrop) and the map. No page scroll; the sidebar scrolls.
- **Map** (`features/map/`): react-leaflet with OSM tiles (`services/config.ts`), `crossOrigin`
  tiles, attribution, scale bottom-left, zoom bottom-right. Initial view = fit the restored
  places, else Europe. `MapView` creates the panes before any layer mounts and publishes the map
  through `mapInstance.ts`. `view.ts` has `viewForPlaces()` / `fitMapToPlaces()` for reuse.
- **Theme**: tokens in `styles/tokens.css`; `index.html` sets `data-theme` before first paint;
  `features/theme/theme.ts` (`initTheme`, `chooseTheme`) keeps it in sync and stores the explicit
  choice in `localStorage["roadmap-overview:theme"]`. Leaflet's zoom/attribution controls follow
  the theme (`map.css`); tiles and the scale control never do.
- **Stores**: `tripStore` (zundo `temporal`, partialised to `{ trip }`, limit 100; actions that
  change nothing return the same trip object, which is how no-op calls stay out of history).
  `undo()`/`redo()` are exported as plain functions (the raw zundo ones take a step count, so
  never pass them to `onClick`). **One history step per gesture**: draw the in-progress state
  locally during a drag and call `moveVia` / `updatePlace` once on drag end, never on every move.
  `replaceTrip` and `newTrip` are single undoable steps.
- **Invalid input never reaches the trip**: `addPlace` returns `null` (and adds nothing) for
  non-finite or out-of-range coordinates; `updatePlace` / `updateLeg` ignore invalid values
  instead of applying them (`undefined` never deletes a required field, a coordinate update with
  an invalid half is dropped whole; see `sanitizePlacePatch` / `sanitizeLegPatch` in `lib/trip.ts`).
  Patches that change nothing — including `via` lists with equal contents — add no undo step.
- **File format** (`lib/tripFile.ts`): `parseTripFile` only rejects data that cannot be a trip
  (wrong format/version, no places list). Everything else is repaired and listed in `warnings`:
  an invalid place is dropped (legs re-synced) rather than costing the whole trip, a missing name
  becomes `""`, bad days are rounded, unknown modes become drive, duplicate ids are replaced, via
  points and durations that are invalid are dropped, orphan legs are dropped. Cached routes are
  kept only when their key equals the recomputed `legRouteKey` (a stale key is dropped quietly)
  and the geometry is sane — decodes to ≥ 2 in-range points whose ends lie within 25 km of the
  leg's places (OSRM snaps to roads); anything else is dropped with a warning and re-derived.
  `collectLegRoutes(trip, routesByKey)` builds the leg-id-keyed map `serializeTripFile` wants.
- **Autosave** (`store/persistence.ts`): at most every 500 ms while editing, immediately on
  `pagehide`/hidden. Unreadable saved data is copied to `roadmap-overview:v1:corrupt` and the app
  starts fresh with an error toast; storage failures never throw. When a write is refused (quota)
  it is retried once without the cached routes (re-derivable) and routes stay off for the rest of
  the session; if even that fails the user gets one toast and attempts back off for 30 s.
- **Shared UI** (`components/`): `toast.error(msg)` works from anywhere (`ToastHost` is mounted in
  `App`). `Menu` takes a `trigger` render prop to spread on any button and supports `checked`
  (radio) items; `Dialog` is a controlled native `<dialog>` (the parent sets `open` false in
  `onClose`; it closes on Escape, its X, or a press-and-click on the backdrop — a drag that starts
  inside does not). `IconButton` requires `label` (accessible name + tooltip). Everything outside a
  modal dialog is inert and painted beneath it, so floating UI is portalled **into the dialog**
  when its anchor is inside one (`components/portal.ts`: Menu panels, tooltips) and the toast
  region follows the innermost open dialog. Keep the `<dialog>` itself free of transforms/filters:
  that would turn it into the containing block of these `position: fixed` children.
- **Shortcuts** (`features/layout/shortcuts.ts`): undo/redo are ignored while typing in a field
  and while any modal dialog is open.
- **Mobile sidebar**: opening the slide-over focuses its close button; closing returns focus to
  `#sidebar-toggle`.
- **Formatting**: `formatDistance` / `formatDuration` use plain ASCII spaces ("1 234 km"); add
  `white-space: nowrap` where wrapping would hurt. Distances are rounded before choosing the unit
  (999.6 m → "1 km").
- **Tests**: Vitest covers lib, stores and persistence; Playwright covers the shell, theme, title,
  undo/redo, autosave, mobile layout, the mocks themselves and the shared components.
- **Known gaps**: two open tabs overwrite each other's autosave (last write wins; no
  cross-tab sync or warning; planned for F8); no marker or route layers yet (F1/F2); the top bar
  has no overflow strategy for the later Ride/Image/File buttons on phones (F8).
