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
| Countries | `world-atlas` 50 m boundaries + `topojson-client` (own lazy chunk), `flag-icons` SVGs |
| Share links | `lz-string` (`compressToEncodedURIComponent`) |
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
                             routeKey, modes, geoResult (Nominatim result → GeoResult, short name),
                             requestQueue (politeness queue), lru, nearest (point-to-path projection,
                             insert index, via-point index), simplify (Douglas–Peucker),
                             manualRoute (routes that need no router), greatCircle (flight arcs),
                             routeSpans (ferry stretches from OSRM steps), legModes / legBadges (legend and badge placement),
                             shareLink (`#trip=` links), tripFileIo (file names, pretty JSON, text → TripFile)
  services/                  ALL network access: config.ts (tile/OSRM/Nominatim URLs, sample trip), nominatim.ts, osrm.ts,
                             tripSource.ts (trip files from `?src=` and the sample)
  store/                     tripStore (undoable intent), uiStore, routeStore, persistence
  components/                shared UI primitives: Button, IconButton (+Tooltip), Menu, Dialog,
                             ContextMenu (a Menu opened at a point), Toast (+ the `toast` API in
                             toast.ts), Spinner, SegmentedControl, Switch, portal.ts (portal target
                             and modal stack)
  features/<name>/           one folder per feature:
    layout/                  TopBar, Sidebar, TripTitle, UndoRedoButtons, shortcuts, Logo
    map/                     MapView, panes, mapInstance (getMap/useLeafletMap), view helpers
    theme/                   ThemeToggle, theme.ts (init/choose)
    places/                  PlacesPanel (sortable list, search), PlacesLayer (markers, context menus)
    legs/                    LegConnector (between place rows: leg summary + the selected leg's LegEditor),
                             LegLegend (map legend), legActions, modeIcons
    routing/                 RouteManager (OSRM → route store), legRoutes (`getLegRoutes`/`useLegRoutes`),
                             RouteLayer + reshape (lines, via points, Google-Maps-style reshaping), MapTools
    stats/                   title/statistics card (StatsOverlay → TripCard | TripPill), computeStats,
                             countries (+ countryIndex, worldIndex, countryData), flags, dateRange, samplePath
    io/                      FileMenu (top bar), import/export actions, drop overlay, start-up links (F5)
    ride/ export-image/      slot placeholders until their feature lands
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
| `places/PlacesPanel` | sidebar content (renders `legs/LegConnector` between its rows) |
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
  `eff[last] - eff[0] + 1`. New places default to the previous place's *effective* day + 1 when
  appended (`0` for the first place) and to the previous place's effective day when inserted in the
  middle (`defaultDayAt`), so with typed days `[0, 1, 0]` an appended place gets day 2.
- **Durations.** `effectiveDurationS(leg, route)`: the user's `durationMin` override, else the
  route's duration (OSRM for drive legs, `estimateDurationS()` for the other modes).
- **Modes.** `src/lib/modes.ts` defines colours, dashes and speed estimates per mode. Map,
  sidebar and image export all read from it.

## State

- `store/tripStore.ts`: Zustand store holding `trip: Trip` plus actions; wrapped in zundo
  `temporal` so `undo()`/`redo()` cover intent only. Continuous edits (typing, dragging) must
  produce one history entry per gesture (commit on blur/Enter/drag end). Machine-made follow-ups of
  a gesture (a reverse-geocoded name arriving after a drop) go through `withoutHistory(fn)`.
- `store/uiStore.ts`: non-undoable UI state — theme, mobile sidebar, selection/hover of places
  and legs (selecting a place deselects the leg and vice versa), the map tools' `showLabels`, which place row is expanded into search (`expandedPlaceId`) or being renamed
  (`renamingPlaceId`; the two are mutually exclusive), the open dialog id. Ids that disappear from
  the trip (undo, delete, import) are cleared automatically (`bootstrap.ts`). Features with
  self-contained state (ride playback, …) add their own small store.
- `store/routeStore.ts`: derived route cache `Record<key, LegRoute>` + per-key status
  (`loading`/`error`) and, for errors, a user-presentable reason (`errors`). Not undoable. Written
  only by the route manager; everything else reads through `getLegRoutes()` / `useLegRoutes()`
  (`features/routing/legRoutes.ts`, see F2).
- `store/persistence.ts`: debounced autosave of a `TripFile` (trip + routes of current legs) to
  `localStorage["roadmap-overview:v1:current"]`, restored on start. Theme lives in
  `localStorage["roadmap-overview:theme"]`. The trips that something replaced (a link, a file, the
  sample, "New trip") go to a ring of up to five in `localStorage["roadmap-overview:v1:recent"]`
  (`store/recentTrips.ts`, F5).
- **Debug hook.** In dev builds `window.__ROADMAP__` exposes the stores (`trip`, `ui`, `routes`,
  each a Zustand store; `trip.temporal` is the undo history) and `getMap()` (the Leaflet map) so
  Playwright and humans can inspect and drive state programmatically. Stripped from production.

## External services (and their usage policies)

All network calls go through `src/services/*`; components never call `fetch` directly.

| Service | Use | Rules we follow |
| --- | --- | --- |
| `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Map tiles, image export | Visible "© OpenStreetMap contributors" attribution (map and exported image); `crossOrigin` enabled so tiles can be drawn on canvas; no bulk prefetching. |
| `https://router.project-osrm.org/route/v1/driving/…` | Road routing of drive legs | `overview=full&geometries=polyline&steps=true&alternatives=false` (the steps only tell where a route takes a ferry, see F3); one request per leg (from, via…, to); one `lib/requestQueue.ts` queue (≤ 1 request in flight, ≥ 1 s between starts, identical requests shared, requests nobody waits for any more dropped or aborted, 20 s timeout); results cached by key; geometry simplified (12 m) before caching. |
| A trip file URL the user gives as `?src=…` (and the bundled `samples/…` on this site) | Opening a trip someone published, e.g. a gist | GET only (`services/tripSource.ts`), http(s) only, no credentials or referrer, 20 s timeout, 20 MB cap; the other server has to allow cross-origin reads (CORS). |
| `https://nominatim.openstreetmap.org/search` and `/reverse` | Place search, naming dropped pins | **No search-as-you-type** (policy): search on Enter/button only. ≤ 1 request/s globally (one queue for both endpoints, `lib/requestQueue.ts`), identical in-flight requests shared, LRU result cache, 15 s timeout. `format=jsonv2&addressdetails=1`; `/search` limit 8 plus an unbounded `viewbox` of the visible map, `/reverse` zoom 14. |

Base URLs are constants in `src/services/config.ts` so they can be pointed elsewhere.

## Map conventions

- Draw order (Leaflet panes, bottom → top): tiles, route casing, route lines, leg mode badges,
  via-point handles, place markers, labels, ride vehicle, popups/menus. Our panes are created in
  `features/map/panes.ts` (`PANES.routeCasing | route | routeBadges | via | markers | labels | ride`);
  pass the name as the `pane` option of a layer.
- Place markers: numbered circular badges (marker pane) with a permanent short label (Leaflet
  tooltip in the labels pane, class `place-label`) beside each. Markers and labels are not themed:
  the tiles are always light, so they stay a white-ringed badge and a light pill on any tile.
  Crowded labels give way to each other (`features/places/labelLayout.ts`); adding the class
  `hide-place-labels` to the map container hides all labels but the hovered/selected one.
- Route styling comes from `MODES` (`src/lib/modes.ts`) through `features/routing/legStyle.ts`: a
  darker casing under the line, thicker when hovered/selected; legs still routing show a thin grey
  dashed straight placeholder, failed ones a red dashed line, straight drive legs a dotted line.
  Ferry, train and flight legs use their own colour and dash (and casing, except flights) and carry a
  round mode badge at the middle of the line, as does every ferry crossing inside a drive route (F3). Route, badge and via-point layers are not themed (the tiles
  never are).
- Map overlays are React components stacked above the map (not Leaflet popups), styled with the
  theme tokens. They live in `features/map/MapOverlays.tsx` as siblings of the Leaflet container,
  so pointer events never reach the map through them. Code outside the `MapContainer` reaches the
  map with `useLeafletMap()` / `getMap()` (`features/map/mapInstance.ts`).
- Automatic fits leave room for the overlays (F4): `fitMapToPlaces` (so "Fit to trip", fitting a leg,
  the refit after adding a place and the first view of a restored trip) pads the fit with
  `overlayInsets(map, base)` (`features/map/overlayInsets.ts`), which measures the children of the
  top-left slot (title card or pill) and the top-right slot (map tools) when it is called. The card
  only pushes the fit away on one side, to its right or below it, whichever leaves the larger visible
  area; a lone place is centred in the visible part. New overlays that cover part of the map should
  sit in one of those slots (or extend `overlayInsets`), not be absolutely positioned elsewhere.

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
  cross-tab sync or warning; planned for F8); the top bar
  has no overflow strategy for the later Ride/Image/File buttons on phones (F8).

### F1 — places list, search, day field, labelled markers

- **Nominatim client** (`services/nominatim.ts`): `searchPlaces(query, { signal })` and
  `reverseGeocode(latLng, { signal })` return `GeoResult` (`lib/geoResult.ts`: `shortName()` is the
  pure short-form rule, `regionLine()` the secondary line of a result). Everything goes through
  one `lib/requestQueue.ts` queue (≥ 1 s between request starts, one in flight, identical keys
  share a run, a run is aborted/dropped only when *all* its callers aborted) plus LRU caches
  (40 searches, 60 reverse lookups; `null` "nothing there" answers are cached too). Failures
  reject with `NominatimError` (`kind` network/http/timeout); aborts reject with an AbortError
  (`isAbortError`). `createNominatimClient({ fetch, … })` exists for tests. Searches pass the visible
  map area as an unbounded `viewbox` (`viewboxParam()`: rounded outward to whole degrees, which is
  also part of the cache key) so nearby places rank first; repeated hits for one place (same short
  name, region line, within 5 km) are dropped (`dedupeResults`). Reverse results are named after
  their settlement (`settlementName`: city, town, village, hamlet, municipality, else the usual
  short name), so a pin dropped in central Munich is "Munich", not its quarter; search results keep
  `name` first so a campsite stays a campsite. The queue is generic
  (`minIntervalMs`, `maxConcurrent`) so the OSRM client can reuse it.
- **Places list** (`features/places/`): `PlacesPanel` (dnd-kit sortable, pointer sensor with a 5 px
  activation distance + keyboard sensor, grip handle only) → `PlaceRow` (grip · badge · name · day
  · menu; the row is a `li` > `.place-card` + `LegConnector`). One drop = one `movePlace`.
  While dragging, the leg connectors are hidden, **not collapsed**: dnd-kit measures the other rows
  at drag start, and a layout change at that moment makes the drag overlay and the drop targets
  disagree. Collapsing the *space* needs the connector height to be reserved some other way.
  Outside-click collapse of an expanded row listens to `click`, not `pointerdown`, because the
  collapse moves the rows below and must not happen between press and release of a click on one.
- **Day field** (`DayField.tsx`): free typing, commit on Enter/blur as one undo step (`parseDay`
  accepts plain digits only; anything else reverts), ↑/↓ step the draft, Escape reverts and leaves
  the field (without closing the mobile slide-over); a draft whose saved day changed underneath
  (undo, another edit) is dropped in favour of the new value. A row is
  flagged (`data-warning`, tooltip + screen-reader text) when its day is lower than the previous
  stop's *effective* day (`effectiveDays()` in `lib/trip.ts`), i.e. exactly the rows whose day
  would be raised.
- **Search UX** (`PlaceSearch.tsx`): used by the expanded row and the "Add a place…" box. Search
  only on Enter / the button; ↑/↓/Enter pick; Escape closes; editing the text discards the results
  (they belong to the searched text, so Enter searches again instead of picking a stale hit). Picking in a row →
  `replacePlaceFromResult` (location, name, address, `customName` cleared, one undo step, fly
  there); picking in the add box → `addPlaceFromResult` (append; the first place of a trip is flown
  to, later ones refit the trip only when they are off-screen). Rename is `ui.renamingPlaceId`
  (`ui.renamePlace(id)`, `startRename(id)` in `placeActions.ts`): the map's marker menu and the row
  menu share it.
- **Markers** (`PlacesLayer.tsx`): managed imperatively, one `L.marker` per place (draggable,
  keyboard-focusable, `aria-label`). Only a mouse sets the hovered place (touch taps would leave it
  stuck: no pointer ever leaves). Hover/selection only toggle CSS classes (`is-hovered`,
  `is-selected`) — rebuilding an icon under the pointer would swallow clicks and drags. Labels are
  permanent tooltips in the labels pane; `labelLayout.ts` hides/flips crowded ones (right, then
  left, then hidden; the hovered/selected label always shows). Drop → one `updatePlace`, then
  `lookupName(id)` (`nameLookup.ts`) reverse-geocodes machine-named places and applies the answer
  with `withoutHistory`, only if the place is still where and what it was; "nothing known there"
  falls back to "Dropped pin", a network error keeps the old name and shows a toast.
- **Map context menus**: `components/ContextMenu.tsx` (a `Menu` panel opened at a point; focus
  returns to where it was when it closes). An expanded row ignores clicks in its own portalled
  actions menu when deciding whether a click was "outside".
  "Add place here" appends a "Dropped pin" and names it; "Insert place here" (≥ 2 places) uses
  `insertIndexNear()` (`lib/nearest.ts`) on the cached route geometry of each leg
  (`legRouteKey` → route store), the straight segment when a leg is not routed yet. Right-click on
  a marker: Rename / Delete.
- **Helpers other features may reuse**: `placeActions.ts` (`zoomToPlace`, `addPlaceAt`,
  `addPlaceFromResult`, `startRename`, `cleanLatLng`), `map/view.ts` `flyToPoint`,
  `tripStore.withoutHistory`, `lib/nearest.ts` `distanceToPathM`.
- **Tests**: Vitest for short names, request queue (fake timers), LRU, Nominatim client (stubbed
  fetch), nearest-leg insert, day parsing/effective days, `withoutHistory`, UI-store modes.
  `e2e/places.spec.ts` (mocked Nominatim) covers searching/adding, reorder (mouse and keyboard,
  undo/redo), day edits and the warning, row search/replace, rename, zoom/delete, hover/selection
  sync, marker drag + undo, late names, label decluttering and the context menus.
- **Known gaps**: dragging a marker has no keyboard
  equivalent (use row search); long-press on touch relies on the browser/Leaflet emitting
  `contextmenu` (not verified on a real device); labels avoid each other and markers but not route
  lines; an undo step older than a late reverse-geocoded name keeps the old machine name.

### F2 — OSRM road routing, route reshaping, leg summaries, map tools

- **OSRM client** (`services/osrm.ts`): `routeDrive(points, { signal })` → `{ geometry, distanceM,
  durationS }` (geometry = precision-5 polyline, already simplified). One `createRequestQueue`
  (`createOsrmClient({ fetch, … })` for tests): ≤ 1 in flight, ≥ 1 s between starts, identical URLs
  share a run, aborted queued requests never reach the network, and `priority` (higher first; a
  caller joining a waiting run with a higher one raises it) lets user edits overtake background work
  without breaking the spacing or the one-in-flight rule. Failures reject with `OsrmError`
  (`kind`: network / http / timeout / route, plus OSRM's `code`, e.g. `NoRoute`); its `message` is
  written for the user and ends up in the route store's `errors`. Aborts reject with an AbortError.
  **Simplification** (`lib/simplify.ts`, Douglas–Peucker in projected metres, 12 m): measured on the
  real server, Paris→Lyon (464 km) 28.9 kB → 3.5 kB, Lyon→Annecy (139 km) 8.1 kB → 1.3 kB,
  Annecy→Zurich (319 km) 29.1 kB → 3.3 kB of polyline text — 84–89 % smaller, roughly 7–10 bytes
  per km, so a 3 000 km trip is ~25 kB in localStorage.
- **Route manager** (`features/routing/routeManager.ts`, mounted by `RouteManager.tsx`;
  `createRouteManager({ fetchRoute })` for tests): on every change of the trip's places/legs it
  derives the keys the trip needs (`needsRouter(leg)` = the mode is `routed` in `MODES` and the leg is
  not `straight`), requests the missing ones, aborts requests for keys no longer needed, and clears
  statuses of keys it forgets. Results go to the route store by key, never into the trip. A failed
  key stays failed until `retryRoute(key)` (no retry loop). Keys that a *user edit* asked for are
  queued with `USER_PRIORITY`, so a drop or a moved place does not wait behind the routing of a
  freshly opened trip: a trip change counts as an edit when it needs at most 4 new routes (a gesture
  changes 1–3 legs, opening or importing a trip many), and so does Retry; the first sync after start
  and cache losses are background work. `stop()` is deferred by a tick so React's dev remount does
  not abort and re-send the first request.
- **Reading routes** (`features/routing/legRoutes.ts`) — the one way stats, ride and export read
  geometry: `getLegRoutes()` (plain function) / `useLegRoutes()` (hook) return, in trip order,
  `{ leg, from, to, key, route?, coords, status: 'ok' | 'loading' | 'error', error? }`. `coords` is
  the decoded route when `ok`, otherwise the straight placeholder through places and via points
  (frozen, shared: copy before modifying). The array is the same object until places, legs or route
  store change. Legs that need no router (straight drive legs; F3's ferry/train/flight) are computed
  on demand by the pure `computeManualRoute(from, via, to, mode)` (`lib/manualRoute.ts`: straight
  segments, great-circle arcs for flights since F3, distance along the drawn geometry,
  `estimateDurationS`), remembered in an LRU by key, and are **never** stored in the route store or
  autosaved. `needsRouter` follows `MODES[mode].routed`.
- **Map layer** (`RouteLayer.tsx`, imperative Leaflet like the markers): per leg a casing polyline
  (route-casing pane), a line (route pane) and an invisible 18 px `route-hit` polyline that takes the
  pointer; elements carry `data-leg-id` and `data-role="route-casing|route-line|route-hit"` (tests
  use them; F3 adds `route-ferry-casing|route-ferry-line`, see there). Hover/selection only restyle (`setStyle`), never rebuild. Hover sets
  `ui.hoveredLegId` (mouse and pen only), a click selects the leg, a click on the empty map
  deselects, right-click is forwarded to the map's own context menu (so "Insert place here" works on
  a line).
- **Reshaping** (`reshape.ts`): while a mouse hovers a leg that is not loading, a white handle
  (non-interactive marker in the via pane) follows the pointer, snapped to the line
  (`nearestOnPath`). A capture-phase `mousedown` on the map container takes the press over before
  Leaflet's map dragging sees it, so dragging from a line never pans while everywhere else still
  does; moving less than 4 px stays a click. During the drag a dotted preview runs previous anchor →
  cursor → next anchor; the drop calls `addVia` once at `viaInsertIndex(coords, via, grabPoint)`
  (the index comes from where the line was **grabbed**: each existing via point is located along the
  route, never earlier than the one before, so routes that double back stay correct). Esc cancels,
  and so does releasing outside the map (over the sidebar or outside the window; the preview
  disappears as soon as the pointer leaves the map). The click that ends a dropped or cancelled drag
  is swallowed, also when the button is still down after Esc. Pressing on a line blurs the focused
  element (the press is taken over from the browser, so a day field being edited commits as on any
  other click). The leg is selected when a drop commits, not when the drag starts. Via points are
  draggable markers (preview while dragging, one `moveVia` on drop; released outside the map they
  snap back); double-click, right-click or Delete on a focused one removes it; tooltip "Drag to
  change route · double-click to remove". Undo/redo hit the route cache: no request.
- **Previous line kept while re-routing**: a leg that was routed before and whose key changes keeps
  drawing its last routed geometry (faded, `stale` in `legStyle`) until the new route arrives; a
  failure replaces it with the red line at once, and the grey straight placeholder is only for legs
  that were never routed. The state is per leg in `RouteLayer` (`lastRouted`); `getLegRoutes()` still
  reports `loading` with placeholder `coords`, so stats, ride and export never see stale geometry.
- **Sidebar** (`legs/LegConnector.tsx`, mode icons in `legs/modeIcons.tsx`): a rail on the places'
  badge axis with the mode icon on it and "312 km · 3 h 40 min" (`effectiveDurationS`, so a duration
  override shows); spinner + "Routing…" while loading; on error the reason plus "Retry" and "Use
  straight line" (`updateLeg(id, { straight: true })`, one undo step). Hover and selection are
  shared with the map; clicking selects the leg and fits the map to it; a leg selected on the map
  scrolls its connector into view. `data-status`, `data-mode`, `data-hovered`, `data-selected` are
  on the connector. The selected leg's editor (F3) expands under the summary; the summary reads
  everything from `useLegRoutes()`.
- **Map tools** (`MapTools.tsx`): "Fit to trip" (places + all route points, `fitMapToTrip()` in
  `mapFit.ts`; `fitMapToLeg(id)` likewise) and a "Show labels" toggle (`ui.showLabels`;
  `PlacesLayer` mirrors it as the `hide-place-labels` class on the map container).
- **Contract / shared-store changes**: `types/trip.ts` unchanged. `routeStore` gained `errors` and
  `setStatus(key, status, error?)`; `uiStore` gained `showLabels` and the place/leg selection
  coupling; `lib/nearest.ts` gained `nearestOnPath` / `viaInsertIndex` (`distanceToPathM` now uses
  it); `PlacesLayer` got the label-class effect.
- **Tests**: Vitest for simplification, projection and via index (including a route that doubles
  back), manual routes, the OSRM client (stubbed fetch, fake timers: URL, parsing, error mapping,
  spacing, abort-before-send, de-dupe), the route manager (fake router), `getLegRoutes`, leg styles,
  UI/route store additions. `e2e/routing.spec.ts` (mocked OSRM) covers routes and summaries, the
  loading and error/Retry/straight-line states, request spacing and dropping, reload without
  re-routing, reshaping (handle, drag-to-add with index, undo/redo without requests, via drag,
  double-/right-click/Delete removal, Escape, release over the sidebar for a new and an existing via
  point, a focused field committing when a drag starts, panning elsewhere, no handle while loading,
  the previous line staying while a leg re-routes, user edits jumping the queue), hover/
  selection sync, connector click-to-fit, scroll-into-view, right-click on a line, fit to trip and
  show labels. New `App` helpers: `legRoute(i)`, `legPath(i)`, `screenPoint()`, `latLngAt()`,
  `settle()` (waits for Leaflet's animations: a second animated move started during the first ends
  short of its target).
- **Known gaps**: no live re-routing while dragging (only the dotted preview); no edge auto-pan
  while dragging a new via point out of a line (dragging an existing via point does auto-pan, also
  towards the sidebar before a release there cancels it); reshaping from a line is mouse/pen only —
  a touch drag on a line pans the map, only the via markers themselves drag by touch; via points
  cannot be moved with the keyboard (Delete removes a focused one, but there is no keyboard way to
  add or move one); the in-memory route cache and the manual-route LRU are not pruned during a
  session (autosave only keeps the routes of current legs); OSRM is asked for one leg per second at
  most, so routing a long trip from scratch takes about a second per leg.

### F3 — custom legs: ferry, train, flight, straight drives; ferry detection in drive routes

- **Contract** (additive, file version stays 1): `RouteSpan` and the optional `LegRoute.spans`
  (`types/trip.ts`): the ferry/drive stretches of a *routed* leg as inclusive indices into the decoded
  geometry; when present they cover the whole geometry, each span starting where the previous ends.
  `parseTripFile` keeps the route but drops spans that break that rule (warning "ferry sections").
  Manual routes never have spans. `info.route?.spans` is how stats (ferry time) or the ride (slow
  boat) can see crossings.
- **Ferry detection** (`lib/routeSpans.ts`, `services/osrm.ts`): the request now has `steps=true`;
  `spansFromSteps` turns the steps' `mode` into spans (`ferry` = ferry, every other mode = drive,
  consecutive steps merged, the shared boundary point stored once) and traces the full-resolution
  path from the step geometries; `simplifyWithSpans` simplifies each span on its own so the
  boundaries survive. The traced path replaces the overview geometry only when a ferry was found and it
  agrees with the overview (ends within 1 km, length within 5 %); otherwise nothing changes. Measured
  on the real server: the step geometries concatenate to *exactly* the overview geometry, and
  `steps=true` makes responses 4-8× larger (every step carries intersections): Dover→Calais 35 kB,
  Hamburg→Hirtshals 100 kB, Hirtshals→Kristiansand 285 kB. **The demo server does not take the
  Hirtshals→Kristiansand ferry** (it drives round: 1 374 km, no ferry step); Dover→Calais does use
  the Eurotunnel shuttle as a `ferry` step (59 km, 35 min), so that real answer is the unit-test
  fixture (`lib/fixtures/osrm-dover-calais.json`) and the e2e mock's ferry pair (`FERRY_PORTS`,
  `FERRY_DURATION_S` in `e2e/mocks/osrm.ts`; `fakeRoute` returns steps when `steps=true`).
- **Manual geometry** (`lib/manualRoute.ts`, `lib/greatCircle.ts`): `manualPath` = straight through
  the via points (ferry, train, straight drive) or `greatCirclePathThrough` (flight: 64 segments per
  arc, exact endpoints, longitudes continuous across the antimeridian so Leaflet draws one line).
  Distance is the length along that geometry. `pointAlongPath` (`lib/geo.ts`) interpolates inside a
  segment in Mercator y, i.e. the way Leaflet draws a straight line, so badges sit on the line.
- **Leg editor** (`legs/LegEditor.tsx`, actions in `legActions.ts`): `SegmentedControl` for the mode,
  `Switch` "Follow roads" (drive only; `straight`), duration in hours + minutes (committed on Enter or
  when focus leaves the field, one undo step; `parseDurationMin`; "Reset to estimate" when overridden),
  label, "Show on map", "Reset shape" (when there are via points). Leaving `drive` clears `straight` in
  the same step. Via points mean different things on a road-routed leg (the road is forced through
  them) and a hand-drawn one (the line is drawn through them), so a change between the two kinds
  — mode switches and "Follow roads" alike (`needsRouter` before vs after) — drops them in the same
  undo step; switching among ferry/train/flight/straight drive keeps them. The mode control has manual
  activation (arrows and Home/End move the focus only; Enter, Space or a click choose), so keyboard
  users create no intermediate undo steps or OSRM requests. Escape in the connector reverts the focused
  field and closes the editor, a click elsewhere in the sidebar closes it (the map's own click already
  did), and so does Escape anywhere that nothing else used and that is not another text field (Escape in
  the trip title, a place's name or day belongs to that field). Clicking a connector no longer closes
  the mobile slide-over (the editor is in it): the editor's "Show on map" (`showLegOnMap`) fits the
  leg and closes the slide-over below 768 px. The duration hint says "Travel time from the route (incl.
  ferry)" for a drive route with ferry spans.
- **Map** (`RouteLayer.tsx`): a leg owns a casing + line for its own mode (or its driven stretches)
  and a second casing + line for ferry spans (`data-role="route-ferry-casing|route-ferry-line"`, empty
  polylines otherwise); hover/selection restyle both. Dashed modes (ferry, train) are cased in white
  with a *dashed* casing (`haloDash` in `lib/modes.ts`: dashes grown by the casing edge, gaps shrunk,
  pattern offset), so each dash has a halo and the gaps stay open; solid drive keeps its dark casing.
  The legend swatches use the same rule. Mode badges are Leaflet markers in the new
  `routeBadges` pane (below the via handles, so those stay grabbable), built from
  `legBadgeSpots()`; icons are SVG strings (`modeIconSvg`, shapes copied from lucide, because
  `react-dom/server` would add 60 kB gzipped). A click selects the leg. While a leg re-routes, its
  stale line keeps its ferry pieces and badge (faded). The reshape preview of a flight is an arc.
- **Legend** (`legs/LegLegend.tsx`, bottom-left slot in `MapOverlays`): `modesInUse()` over the legs,
  shown when more than one mode is in use; ferry spans inside drive legs count as ferry. The
  connector tags such a leg "incl. ferry".
- **Shared components**: `SegmentedControl` (radio group, one tab stop, arrows/Home/End) and `Switch`
  (`role="switch"`), both in the UI kit page and `e2e/components.spec.ts`.
- **Tests**: Vitest for great circles, manual routes per mode, spans from steps (synthetic and the real
  Dover→Calais answer), span-preserving simplification, span validation in `parseTripFile`, the OSRM
  client with steps, the route manager passing spans on, badge spots, legend modes, duration parsing,
  `pointAlongPath`, leg actions. `e2e/legs.spec.ts` (mocked): editor open/close, mode switch with
  style/badge/estimate/undo (and no OSRM request), keyboard mode choice, flight arc, duration
  override and reset, label, Follow roads off (dotted, no request), reshaping a ferry and a flight
  (instant, no request), Reset shape, via points dropped/kept across mode switches, manual activation
  of the mode control, "Show on map" (desktop and phone), Escape in other fields, badge click, legend,
  ferry span from OSRM steps (style, badge, tag, hint, legend, reload without a request). The F1 test "rows can be reordered with the keyboard" now
  waits for dnd-kit's own announcements (`DndLiveRegion`) instead of a transform, which raced the
  collision update.
- **Known gaps**: routes cached before F3 (autosave or an exported file) have no spans, so a drive leg
  through a ferry shows no ferry stretch until it is routed again (a changed leg or a retry); only
  ferry stretches are marked, not other non-road ones; the white halo of dashed lines is faint on very
  pale tiles; the legend does not list the dotted "straight line" drive style; a flight across the
  antimeridian is drawn on the far side of the map copy (`lng` beyond ±180); `steps=true` responses are
  much bigger than before.

### F4 — map title card, trip statistics, countries with flags

- **Card** (`features/stats/`): `StatsOverlay` (the top-left slot, unchanged name) renders `TripCard` or,
  when folded, `TripPill`. The card: title (`InlineText`: shown as a button, click/Enter turns it into a
  field; Enter or blur commits with `setTitle`, Escape discards, so one undo step per edit — the same
  store action as the top bar, which therefore follows), optional subtitle (placeholder "Add a
  subtitle", `setSubtitle`), optional start date (`StartDate`: "Add dates" → a native date field; typing
  or picking only changes the field, Enter, the check button or leaving it commits (one `setStartDate`
  step however many segments were changed; an incomplete date or one before 1900 is dropped), Escape
  discards; once set it shows `formatDateRange(startDate, days)`, e.g. "1 – 14 Jul 2026"), then
  tiles: Distance (tooltip/screen-reader breakdown by mode), Days, Stops, Driving (only when the trip
  has a drive leg or driving time; tooltip with the other modes and the total when more than one is in
  use), one tile per other mode in use (ferry, train, flight), Countries (count + flags). A long
  title and subtitle are cut to 3 and 2 lines on the card (the full text is the `title` attribute). `data-testid`s: `trip-card`, `card-title`,
  `card-subtitle`, `start-date`, `stat-<id>` / `stat-<id>-value`, `country-flag` (`data-code`),
  `stats-status`, `card-collapse`, `trip-pill`. The `useTripStats()` hook feeds it from
  `useLegRoutes()` and recomputes live as routes arrive; while legs are pending the card has
  `data-partial="true"`, route-derived tiles are muted (and show "—" while nothing is routed yet), and
  a footer says "Routing n legs…" / "n legs not routed: totals are incomplete". Countries show "…"
  while the boundaries load and "—" if they cannot be downloaded (retried on the next change).
- **Folding**: the chevron folds the card into a pill with the title; the choice is remembered in
  `localStorage["roadmap-overview:stats-collapsed"]` (`statsCardStore.ts`); without a stored choice it
  starts folded below 768 px. The card is ≤ 340 px wide and leaves the map tools' column free
  (`.map-slot--top-left` in `map.css` got a `max-width`).
- **Statistics** (`computeStats.ts`, framework-free): `computeTripStats(trip, getLegRoutes(),
  countries?)` → `{ stops, days, distanceM, distanceByModeM, timeByModeS, drivingS, otherTravelS,
  travelS, countries, pendingLegs, loadingLegs, failedLegs }`. `days` is `eff[last] − eff[0] + 1`
  (0 without places). Distance and time of a routed drive leg with ferry `spans` are split: the ferry
  spans' distance and their share of the duration count as ferry; a user `durationMin` is the duration
  of the whole leg and the spans' durations are scaled to add up to it. Legs that are loading or
  failed add no distance (and no time unless the user typed a duration); `pendingLegs` says how many.
  `dateRange.ts`: `addDays`, `formatDateRange` (locale-independent English, "28 Dec 2026 – 3 Jan 2027").
- **Countries** (framework-free; F7 reuses `detectCountries` and `flagUrl`): `detectCountries(places,
  getLegRoutes())` → `Promise<{ code, name }[]>`, ordered by first visit (place 1, the countries of
  leg 1's route, place 2, …); `countriesOfTrip(index, places, legs)` is the synchronous core. The
  boundaries are world-atlas `countries-50m` through `topojson-client`, in their own chunk
  (`worldIndex.ts`, ≈ 766 kB / 249 kB gzipped, only imported dynamically by `loadCountryIndex()`; an
  empty trip never loads it). `countryData.ts` embeds the ISO numeric → alpha-2 table with common
  English names ("Czechia", "Turkey"); features without an id map by name (Kosovo → `XK`, Northern
  Cyprus → `CY`, Somaliland → `SO`, the rest are dropped). `countryIndex.ts` is the geometry: 5° grid of
  polygons, ray-casting with holes, `at(point)` and `near(point, maxM)`. A **place** counts for the
  country it lies in or, when the 50 m coast puts it in the sea (harbours: Dover, Hirtshals), the
  nearest land within 10 km. **Routes**: a leg's geometry is sampled every 2 km (`samplePath.ts`, long
  straight segments interpolated in Mercator, i.e. where they are drawn) and a country counts after 3
  consecutive samples inside it; samples in no country neither count nor break a run. Only the geometry of
  road-routed drive legs is sampled, and only outside their ferry spans. Hand-drawn legs (ferry, train,
  flight, straight drive) are schematic: what their line merely crosses does not count (a straight
  Vienna → Venice train adds no Slovenia); they contribute their end places and the via points the user
  put on them (a via point in a country is a deliberate statement that the trip goes there). Road legs
  that are not routed yet contribute nothing but their places. Memoised per place position
  and per `LegRoute` object (WeakMap). Measured: a 5 037 km route of 16 791 points takes ~35 ms the
  first time, 0.02 ms again; building the index ~26 ms. Known limit: the 50 m borders are ~1 km off,
  so a road hugging a border for ≥ 6 km can add the neighbour.
- **Flags**: `flagUrl(code)` → `/flags/<code>.svg` (4:3 SVG, no width/height of their own: size the
  `<img>`/canvas draw yourself) or null. `vite.config.ts` has a small plugin that serves them from
  `node_modules/flag-icons` in dev and copies all 271 into the build (letting the bundler handle them
  inlined the small ones into the JavaScript); a flag is only fetched when displayed. Each flag in the
  card is a focusable image named after its country with a tooltip.
- **Shared-file edits**: `lib/geo.ts` exports `mercatorY`, `latFromMercatorY`, `MAX_MERCATOR_LAT`;
  `map/view.ts` (`fitMapToPlaces`/`viewForPlaces` take the overlay insets; `MapView.tsx` refits a restored
  trip once the overlays exist) and the new `map/overlayInsets.ts`; `map.css`, `vite.config.ts`, `package.json` (world-atlas, topojson-client, flag-icons; dev
  @types/topojson-client). Types in `types/trip.ts` unchanged. The card covers the map's top-left
  340 × ~300 px, so the F2/F3 specs that clicked or dragged on "the empty map" at x = 700 now use
  x = 1000 (`routing.spec.ts`, `legs.spec.ts`): pick test coordinates outside that corner.
- **Tests**: Vitest for `computeTripStats` (empty, single place, out-of-order days, overrides, ferry
  spans with and without override, manual modes, pending/failed legs), the country index (holes,
  antimeridian, `near`), `codesAlong` (dips, runs, null samples), real boundaries (Berlin → Prague →
  Vienna = DE, CZ, AT; transit countries; coastal harbours; ferry/flight/train/ferry-span handling;
  Kosovo and Northern Cyprus; the 5 000 km timing), `fitInsets`, `samplePath`, date ranges, the code/name table and
  flag URLs (every country in the boundaries has a flag file). `e2e/stats.spec.ts` (mocked): numbers of a
  mocked trip, flags and their tooltips by mouse and keyboard, transit countries, lazy boundaries,
  boundary failure and recovery, partial/failed routing state, other modes and the distance breakdown,
  ferry spans with an override, days, hand-drawn legs and via points, no driving tile without a drive
  leg, title edit with top bar sync and one undo step, Escape/blur, empty title, long texts, subtitle,
  start date (range, one undo step per edit, Escape, Apply, clear), folding with persistence, phone
  layout, and that Fit to trip, fitting a leg and the restored first view keep markers clear of the card.
- **Known gaps**: borders at 50 m resolution (see above); Natural Earth's disputed-area choices apply
  (Northern Cyprus is shown as Cyprus); the card does not appear in the exported image until F7 draws
  it; no per-day breakdown; the date field is the browser's native one (looks different per browser);
  a place picked by search is flown to (`flyToPoint`) without regard for the card, and the fit is not
  redone when the card is folded or unfolded afterwards.

### F5 — save, load and share trips

- **File menu** (`features/io/FileMenu.tsx`, top bar): New trip (asks first only when the trip has places;
  `newTrip()` is one undoable step, the toast offers Undo), Open trip file… (Ctrl/Cmd+O), Save as JSON
  (Ctrl/Cmd+S), Copy share link, Load sample trip and Recent trips… (disabled while the list is empty).
  Save and Copy are disabled for a trip without places. The component also owns what has no other home:
  the shortcuts (`fileShortcuts.ts`; the browser's own save/open are always suppressed, the action is
  skipped while a modal dialog is open, and a field being edited, e.g. the title, is blurred first so what
  was typed is saved), `ConfirmHost` (the dialog behind `askToConfirm()` in `confirm.ts`, callable from
  non-React code; New trip uses it too), the Recent trips dialog and the drop overlay. On phones the label is
  hidden (icon only), and **toasts sit at the bottom** below 768 px (`Toast.css`), because the top bar's
  dropdowns open where they used to be.
- **Files** (`lib/tripFileIo.ts`): `tripFileName(title)` = `<slug>.trip.json` (`slugify` keeps letters
  of any script, drops accents, avoids Windows' reserved names, `trip` when nothing is left),
  `stringifyTripFile` (2-space JSON, trailing newline), `parseTripJson(text)` (BOM, empty file, invalid
  JSON → `{ ok: false, error }`, then `parseTripFile`; a newer `version` says "saved by a newer version").
  `features/io/exportTrip.ts`: `currentTripFile(withRoutes)` (= `collectLegRoutes` + `serializeTripFile`),
  `saveTripFile()` (Blob + `a[download]`), `copyShareLink()` (Clipboard API, `execCommand` fallback).
- **Importing** (`features/io/importTrip.ts`): `installTrip(file)` is the one way to put a parsed file
  into the stores — it seeds the route store with the file's routes *before* `replaceTrip` (so the route
  manager finds every key and sends no request), is one undo step, and fits the map (waits for the map
  if it is not mounted yet). `openTripText(text, name)` serves picked/dropped files and the sample: error
  toast with the reason (the trip is left alone) or "Opened “title” (n places)" with **Undo**, plus the
  first repairs `parseTripFile` made. Picking uses one lazily created hidden `<input type=file>`
  (`filePicker.ts`).
- **Recent trips** (`lib/recentTrips.ts` pure, `store/recentTrips.ts` storage): *every* operation that
  replaces a trip with places first calls `keepOpenTrip(incoming)` — open file, drop, sample, link,
  `?src=`, "New trip" and restoring a recent trip itself — which pushes the open trip (with its cached
  routes) to the front of the ring: newest first, at most 5 (`MAX_RECENT_TRIPS`), de-duplicated by a
  content fingerprint (`tripFingerprint`: key-order independent hash of the trip), nothing pushed for an
  empty trip or when the same trip comes back. Entries are `{ id, savedAt, file }`, each re-validated
  through `parseTripFile` on every read (invalid ones are skipped). Writing tries everything with routes,
  then without any routes, then drops the oldest entries one by one; if even the newest does not fit,
  `keepOpenTrip` says `'failed'` and the stored list stays as it was. `restoreRecentTrip(id?)` (newest
  when no id) is itself an open, so the replaced trip enters the ring and the restored entry leaves it.
  The File menu's **Recent trips…** dialog lists title, places and "saved 5 min ago" with Restore and
  Forget; `useRecentStore` holds the summaries (re-read on mount, on opening the dialog and after every
  write) so the menu never parses the ring while rendering.
- **When a trip cannot be kept** (`'failed'`): user-initiated opens (file, drop, sample, restore) ask
  first (`askToConfirm`, Cancel focused); a link or `?src=` does not replace anything by itself but shows
  a toast "…no room to keep a copy of your open trip" whose action "Open linked trip anyway" does it.
  A `?src=` file that arrives after the user already changed the trip in this page load (the trip object
  differs from the one at the time of the request) is only offered ("Open the linked trip …?" with an
  action), never applied.
- **Share links** (`lib/shareLink.ts`): `#trip=` + `compressToEncodedURIComponent` of the TripFile
  **without routes**; `buildShareUrl` keeps origin + path and drops query and old hash. The 12-stop sample
  is 3 kB (3 021 characters); above 8 000 characters the toast says so and points to the JSON file.
  `decodeShareHash` is defensive and hands the JSON to `parseTripFile`: a payload over 100 000
  characters is refused before unpacking, and an unpacking that throws, returns nothing, is not JSON or
  yields more than 5 MB counts as a damaged link (never an exception). `copyShareLink` refuses to make a
  link the app itself would not open (`isOpenableShareLink`). The receiving page derives the routes again
  (about a second per leg).
- **Opening from the address** (`features/io/startup.ts`, called by `bootstrap()` *after* autosave started so
  the opened trip becomes the saved one): `#trip=` is read synchronously (the map's first view already fits
  it), the hash is removed with `replaceState`, the history is cleared. `hashchange` handles a link pasted
  into an open page (undoable, history kept). `?src=<url>` (absolute, or relative to the page) is fetched
  by `services/tripSource.ts` (http(s) only, no credentials/referrer, 20 s timeout, 20 MB cap, errors
  written for the user), `src` is removed from the address, a "Loading…" toast shows meanwhile. Both go
  through `openLinkedTrip`: the open trip goes to the recent trips first (see above), and the toast offers
  **Restore previous trip** (20 s), which restores the *newest* entry.
- **Drag and drop** (`DropOverlay.tsx`): window-level listeners, only for drags carrying `Files`
  (dragenter/leave are counted; text and link drags do nothing). A themed "Drop to open trip" overlay
  (`pointer-events: none`, above the top bar, below toasts); a drop opens the first `.json`/JSON-typed file
  or the only file whatever it is (so a wrong file gets a reason), and the browser's default of
  navigating to a dropped file is always prevented. Ignored while a modal dialog is open.
- **Sample trip** (`public/samples/hamburg-fjords.trip.json`, URL in `services/config.ts`
  `SAMPLE_TRIP_URL`): Hamburg → Aarhus → Hirtshals → **ferry** → Kristiansand → Preikestolen → Odda →
  Flåm → Geiranger → Lillehammer → Oslo → Gothenburg → Malmö; 12 places on days 0–14 with notes, a
  `startDate`, 10 routed legs with real OSRM geometry (38 kB; Preikestolen → Odda contains an automatic 3 km
  ferry span) and the Hirtshals → Kristiansand crossing as an explicit Ferry leg (195 min, labelled),
  because the demo server drives round instead. It was made by driving the app against the real servers
  (places added through the store, routes awaited, then File → Save as JSON); to change it, do the same.
  `features/io/sample.test.ts` guards it (parses without warnings, a route for every routed leg, one ferry).
  The places panel's empty state has a "Load sample trip" button (`data-testid="load-sample"`).
- **Contract / shared files**: `types/trip.ts` unchanged. New dependency: `lz-string` 1.5 (CommonJS: Vite
  and Vitest interop is fine, Playwright specs load it with `createRequire`). Additive edits to
  `bootstrap.ts`, `store/persistence.ts` (only `getStorage` is exported now), `PlacesPanel.tsx`
  (empty-state button), `Toast.css` (phones), `e2e/fixtures.ts` (`STORAGE_KEYS.recent`).
  **`parseTripFile` limits** (`lib/tripFile.ts`, they also apply to autosave and the recent trips): more
  than `MAX_PLACES` = 500 places is refused ("This trip has 501 places; Roadmap Overview opens at most
  500."), via points beyond `MAX_VIA_PER_LEG` = 50 per leg are dropped with a warning, and a saved route
  whose `distanceM` is outside 0.5×–3× the length of its own geometry (a geometry that does not move may
  claim at most 1 km) is dropped with a warning and routed again. Test fixtures with routes therefore
  need a realistic `distanceM`.
- **Tests**: Vitest for share-link encode/decode (round trip, no routes, damaged/cut-off/oversized, URL
  building, long-link threshold), slugify/file names/`parseTripJson`/version errors, `fetchTripText` and
  address resolution (stubbed fetch, fake timers), `installTrip` (route seeding by key *before* the trip
  changes, one undo step), `openTripText`, `keepOpenTrip`, `openLinkedTrip` (two links in a row keep the
  user's own trip, restore swaps, quota failures ask), the recent-trips ring (dedupe, cap, per-entry
  validation, the three quota fallbacks) and its pure helpers, the 500-place / 50-via / forged-distance
  limits, and the sample file. `e2e/io.spec.ts` (mocked services): save (name, pretty JSON, routes keyed by leg id), Ctrl+S
  with an uncommitted title, Ctrl+O, empty trip, open-without-OSRM-requests + Undo, a file without routes
  being routed, four kinds of unusable file, New trip (confirm, cancel, undo), share-link round trip in a
  fresh page (routes re-derived, hash removed, reload keeps the trip), kept/restored previous trip, two
  links in a row then restoring the user's own trip from Recent trips (the replaced trip stays in the
  ring), every way of replacing a trip landing in the list and the dialog's Restore/Forget, damaged
  entries ignored, a full quota (link: toast with "Open linked trip anyway"; file: confirm, Cancel and
  Replace), same-trip-not-kept, pasted link, damaged link, very long link, `?src=` (success, relative,
  404, wrong file, unreachable, bad scheme, arriving after the user edited), drag and drop (overlay, nesting, text drags, default prevented, wrong
  files), the sample (no OSRM requests, ferry leg, map fits, Undo, missing file) and the phone top bar.
  `?src=` hosts are mocked with `page.route` (page routes win over the fixture's blocking route).
- **Known gaps**: every Save downloads a new file (no File System Access API "save in place"); Save does
  not wait for routes that are still loading (they are simply missing from the file and derived again on
  open); a link or `?src=` replaces the open trip without asking (recent trips + toast instead); the
  ring holds five trips; a trip with more than 500 places (only reachable by adding them by hand) would
  be refused on reload and end up in the `…:corrupt` copy; lz-string has no output limit, so a hostile
  link within the 100 000-character cap can still make the tab unpack for a long time before the
  5 MB check; a server that refuses cross-origin reads looks like an unreachable one; drops are covered
  with synthetic drag events, not a real OS file drag; the sample is a static file, not bundled, so it
  needs the network (or a cached copy) once.
