# Vanagram — architecture

Vanagram (called "Roadmap Overview" until F17) is a single-page web app for summarising a campervan trip: an OpenStreetMap map with numbered,
labelled stops joined by the route actually taken (road-routed, reshapeable by dragging like
Google Maps, plus hand-drawn ferry/train/flight legs), trip statistics, a "ride" animation of a
little campervan driving the route day by day, JSON save/load/share, PNG export and a rendered video of the ride.

Everything runs in the browser. There is no backend: OSM tiles, OSRM routing and Nominatim
geocoding are called directly from the client.

**Historic ids.** The rename (F17) changed what people read, not what the app stores or exchanges, so existing data keeps working: these
still say `roadmap-overview` (or `__ROADMAP__`, `ro-`) and must not be changed to match the name — the trip file / share link format id
`roadmap-overview/trip` (`TRIP_FILE_FORMAT`, `TripFile.format`), every `localStorage` key `roadmap-overview:*` (trip, theme, recent, corrupt,
welcome, stats card, image and video options, vehicle), the IndexedDB database `roadmap-overview` (photos), the dev-only `window.__ROADMAP__`
hook (and its `RoadmapDebug` type), the Leaflet pane names `ro-*`, the package name and the repository / deploy base path `/roadmap-overview/`.

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
| Video | WebCodecs `VideoEncoder` (H.264 → MP4, else VP9/VP8 → WebM) + `mediabunny` (MPL-2.0) for the file container, in its own lazy chunk; `MediaRecorder` on the canvas where there is no WebCodecs (F13) |
| Tests | Vitest (pure logic), Playwright 1.63 (`@playwright/test`, pinned to the preinstalled browsers) |

## Screen layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TopBar: logo · trip title · undo/redo · Ride · Image · File · present · help · theme │
├───────────────┬──────────────────────────────────────────────────────────┤
│ Sidebar       │ Map                                                      │
│  Places list  │  ┌ title + stats card (top-left)     map tools (top-right)┐│
│  (sortable,   │  │                                                       ││
│  day field,   │  │        markers, route, via handles, ride van          ││
│  leg rows     │  │                                                       ││
│  between)     │  └ scale · legend (bottom-left)   toasts + ride HUD (bottom-centre)   zoom/attrib┘│
└───────────────┴──────────────────────────────────────────────────────────┘
```

Below 600 px the top bar folds undo/redo, presentation mode, help and the theme into a "⋯" menu
(`layout/TopBarOverflow`); in presentation mode (F8) the sidebar and the editing buttons are gone and the
map takes the whole width.

The light/dark theme applies to everything **except the map tiles**, which always use the
standard OSM style. Our own overlays on the map (cards, HUD, menus) do follow the theme.

## Source layout

```
src/
  main.tsx, App.tsx          entry and layout (TopBar, Sidebar, map, toasts)
  bootstrap.ts               start-up: theme, restore autosave, start autosave, debug hook
  types/trip.ts              DATA CONTRACT (read this first)
  types/debug.ts             typing of the dev-only window.__ROADMAP__ hook (a historic name, see above)
  lib/                       framework-free helpers — unit-tested with Vitest:
                             geo (haversine, bounds), polyline (encode/decode + memo), format,
                             id, trip (defaults, day rules, syncLegs), tripFile (parse/serialize),
                             routeKey, modes, vehicles (kinds, names, colours, `parseVehicle`), geoResult (Nominatim result → GeoResult, short name),
                             requestQueue (politeness queue), lru, nearest (point-to-path projection,
                             insert index, via-point index and anchors), simplify (Douglas–Peucker), viaSpurs (dead-end stubs at via points),
                             manualRoute (routes that need no router), greatCircle (flight arcs),
                             routeSpans (ferry stretches from OSRM steps), legModes / legBadges (legend and badge placement),
                             shareLink (`#trip=` links, the `present` flag), tripFileIo (file names, pretty JSON, text → TripFile),
                             assetUrl (root-relative URLs under the app's base path),
                             loadImage (an <img> loaded off-page, for canvases),
                             seaOutlines (the tiles' borders and outlines on the sea → water colour, on pixels; F9) and
                             seaOutlinesBitmap (the same on an ImageBitmap, for the page and the worker)
                             photos (photo rules: sizes, limits, batch planning, garbage selection, embedding in files; F11)
  services/                  ALL network access: config.ts (tile/OSRM/Nominatim URLs, sample trip), nominatim.ts, osrm.ts,
                             tripSource.ts (trip files from `?src=` and the sample), tiles.ts (the image export's
                             tile client: global concurrency, de-duplication, memory cache, failures),
                             seaTiles.ts / seaTileProcessor.ts / seaTiles.worker.ts (a tile as the map and the export show
                             it: downloaded with CORS, borders on the sea hidden in a worker, kept in memory; F9),
                             photoDb.ts is storage, not network: the IndexedDB store of photo bytes (F11)
  store/                     tripStore (undoable intent), uiStore, routeStore, persistence
  components/                shared UI primitives: Button, IconButton (+Tooltip), Menu, Dialog,
                             ContextMenu (a Menu opened at a point), Toast (+ the `toast` API in
                             toast.ts), Spinner, SegmentedControl, Switch, useMediaQuery, portal.ts
                             (portal target, modal stack, the map's toast dock)
  features/<name>/           one folder per feature:
    layout/                  TopBar (+ TopBarOverflow on phones), Sidebar, TripTitle, UndoRedoButtons, shortcuts, Logo (an <img> of public/favicon.svg; F17)
    map/                     MapView, panes, paneLock, mapInstance (getMap/useLeafletMap), view helpers,
                             BasemapLayer + SeaTileLayer (the OSM tiles, drawn on canvases; F9)
    theme/                   ThemeToggle, theme.ts (init/choose)
    places/                  PlacesPanel (sortable list, search), PlacesLayer (markers, context menus)
    legs/                    LegConnector (between place rows: leg summary + the selected leg's LegEditor),
                             LegLegend (map legend), legActions, modeIcons
    routing/                 RouteManager (OSRM → route store), legRoutes (`getLegRoutes`/`useLegRoutes`),
                             RouteLayer + reshape (lines, via points, Google-Maps-style reshaping), MapTools
    stats/                   title/statistics card (StatsOverlay → TripCard | TripPill), computeStats,
                             countries (+ countryIndex, worldIndex, countryData), flags, dateRange, samplePath
    io/                      FileMenu (top bar), import/export actions, drop overlay, start-up links (F5), cross-tab sync (F8)
    ride/                    RideButton (+ VehiclePicker, the chevron joined to it), RideHud (day, leg, controls), RideLayer +
                             rideScene (van, trail, camera), rideStore (playback + controls), timeline (the pure ride clock),
                             camera, vehicles (the artwork; SVG and canvas)
    export-image/            export dialog and image export (F7): ExportImageButton → ExportDialog (tabs Image | Video, the footer is a slot
                             the tab portals its buttons into; `exportTab.ts` has the tab store and `openExportDialog`) → ImagePanel, the canvas
                             renderer (renderTripImage + geometry, card, legend, labelPlacement, paint, …)
    export-video/            video export (F13): VideoPanel (the Video tab, lazy chunk), the scene (`scene.ts`: layout, one background picture,
                             a crop and vector overlays per frame), schedule (the video's clock), camera (still / following), hud (day panel),
                             encoding (what this browser can encode), frameSink (VideoEncoder + mediabunny, or MediaRecorder), renderRideVideo
    help/                    HelpDialog (how-tos + the shortcut table in `shortcutList.ts`), HelpButton, `?` key
                             (`helpActions`), WelcomeHint (first-visit card, `welcomeStore`) (F8)
    presentation/            presentationStore, PresentationButton (+ `usePresentationKeys`), PresentationLayer (F8)
    photos/                  photos of places (F11): PlacePhotos (the expanded row's Photos area), addPhotos + processImage
                             (decode, shrink, store), photoActions, MapPlaceCard (the card over a clicked marker) and
                             PhotoLightbox (the viewer), placeCardStore, photoUrls, photoFile (embedding/importing), photoGc
  dev/                       UiKit page, served by the dev server at /ui-kit.html (not in the build)
  styles/                    tokens.css (theme variables), global.css
e2e/                         Playwright specs, fixtures.ts (service mocks + helpers), mocks/
tools/                       build-time helpers with Vitest tests: sitePreview (the absolute link-preview URLs from `VITE_SITE_URL`), brand.test (icons, manifest) (F17)
public/                      static files served as they are: the icons, manifest.webmanifest, og-image.png (F17), the sample trip
docs/brand/                  the logo's SVG masters and the generator of every icon PNG and the og-image, README with colours and licence (F17)
docs/screenshots/            the README's pictures
.github/workflows/           deploy-pages.yml: build and publish to GitHub Pages (F15)
```

Feature slots: the app shell renders a placeholder component for every planned feature. A
feature replaces its own placeholders instead of editing the shell, so features stay in their own
folders. Slots and where they render:

| Placeholder | Slot |
| --- | --- |
| `ride/RideButton`, `export-image/ExportImageButton`, `io/FileMenu` | top bar, right side (between undo/redo and the presentation, help and theme buttons) |
| `places/PlacesPanel` | sidebar content (renders `legs/LegConnector` between its rows) |
| `stats/StatsOverlay` | map overlay, top-left |
| `routing/MapTools` | map overlay, top-right |
| `ride/RideHud` | map overlay, bottom-centre (its "Record video" button opens the export dialog on the Video tab) |
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
- **Vehicle** (F14). `Trip.vehicle?: { kind: VehicleKind; color?: string }` is the vehicle the ride drives on road stretches;
  missing means the default vehicle, kind `campervan`, which the picker calls **Car** (F16: the stored kind ids never change, only
  the labels do). It is intent (undoable, autosaved, exported, in share links) and kept **canonical**: the default vehicle in its own
  colour, and any vehicle's own colour, are stored as nothing (`canonicalVehicle`).

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
- **Photo bytes** live in IndexedDB (database `roadmap-overview`, store `photos`, `services/photoDb.ts`, F11), never in the trip,
  the undo history, the autosave, the recent trips or a share link: those hold `Place.photos` references only.
- **Debug hook.** In dev builds `window.__ROADMAP__` exposes the stores (`trip`, `ui`, `routes`,
  each a Zustand store; `trip.temporal` is the undo history), `getMap()` (the Leaflet map), `photos` (`collectGarbage()` for the
  photo store, F11) and, once the top bar has mounted, `ride` (the ride's store and controls, F6) and `video` (draw one frame of the video, or render one: F13) so Playwright and humans can inspect
  and drive state programmatically. Stripped from production.

## External services (and their usage policies)

All network calls go through `src/services/*`; components never call `fetch` directly.

| Service | Use | Rules we follow |
| --- | --- | --- |
| `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Map tiles, image and video export | Visible "© OpenStreetMap contributors" attribution on the live map (Leaflet's control); on an exported image a credit either drawn in it or posted beside it with the copyright URL (F12); tiles are downloaded with `fetch` in CORS mode (`services/seaTiles.ts`, F9: the pixels are read to hide the borders on the sea, and the canvas stays readable for the export), one request per tile, no bulk prefetching, a tile nobody wants any more (it left the view) is aborted, processed tiles are kept in memory (160, an LRU) so a tile seen again is not downloaded or processed again. The image and video export (`services/tiles.ts`) only fetch when the user opens the dialog or presses a button, at most 300 tiles per image or video (the tile zoom is lowered to stay within it; the preview is drawn small, ≈ 20 tiles; a video draws its map once, as one background picture, and crops it for every frame, so it never asks for tiles per frame, F13), **≤ 6 downloads in flight in total** across all renders (a tile of an abandoned preview still on its way counts), one download per URL however many renders want it, requests still queued when their render is abandoned are dropped, tiles kept in memory (220) so redrawing costs no request, and a failed tile is not asked for again for 30 s by previews (an explicit Download / Copy does retry them). |
| `https://router.project-osrm.org/route/v1/driving/…` | Road routing of drive legs | `overview=full&geometries=polyline&steps=true&alternatives=false` (the steps only tell where a route takes a ferry, see F3); one request per leg (from, via…, to); one `lib/requestQueue.ts` queue (≤ 1 request in flight, ≥ 1 s between starts, identical requests shared, requests nobody waits for any more dropped or aborted, 20 s timeout); results cached by key; out-and-back stubs at via points cut out, then the geometry simplified (12 m) before caching (F10). |
| A trip file URL the user gives as `?src=…` (and the bundled `samples/…` on this site) | Opening a trip someone published, e.g. a gist | GET only (`services/tripSource.ts`), http(s) only, no credentials or referrer, 20 s timeout, 20 MB cap; the other server has to allow cross-origin reads (CORS). |
| `https://nominatim.openstreetmap.org/search` and `/reverse` | Place search, naming dropped pins | **No search-as-you-type** (policy): search on Enter/button only. ≤ 1 request/s globally (one queue for both endpoints, `lib/requestQueue.ts`), identical in-flight requests shared, LRU result cache, 15 s timeout. `format=jsonv2&addressdetails=1`; `/search` limit 8 plus an unbounded `viewbox` of the visible map, `/reverse` zoom 14. |

Base URLs are constants in `src/services/config.ts` so they can be pointed elsewhere.

## Map conventions

- Draw order (Leaflet panes, bottom → top): tiles, route casing, route lines, ride trail, leg mode
  badges, via-point handles, ride stop halos, place markers, labels, ride vehicle, popups/menus. Our
  panes are created in `features/map/panes.ts`
  (`PANES.routeCasing | route | rideTrail | routeBadges | via | rideStops | markers | labels | ride`);
  pass the name as the `pane` option of a layer.
- The base map is `BasemapLayer` → `SeaTileLayer` (`features/map/`, F9): Leaflet's tile layer whose tiles are
  `<canvas class="leaflet-tile">` elements (not `<img>`), so tests and CSS that look for tiles use `.leaflet-tile` /
  `.leaflet-tile-loaded` (the classes are Leaflet's own), not `img`. `data-tile-source` says whether a tile was
  `processed` (borders on the sea hidden) or is the `original` picture (the tile server does not allow CORS reads).
- Place markers: numbered circular badges (marker pane) with a permanent short label (Leaflet
  tooltip in the labels pane, class `place-label`) beside each. Markers and labels are not themed:
  the tiles are always light, so they stay a white-ringed badge and a light pill on any tile.
  Crowded labels give way to each other (`features/places/labelLayout.ts`); adding the class
  `hide-place-labels` to the map container hides all labels but the hovered/selected one. A click on a
  marker also opens the place's **card** (F11, `features/photos/MapPlaceCard.tsx`): a themed React overlay anchored to the marker with
  its day/date, note and photos, closed by ✕, Escape, an empty-map click or another selection.
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
| `npm test` | Vitest unit tests (`src/**/*.test.ts` and `tools/**/*.test.ts`, node environment) |
| `npm run e2e` | Playwright specs in `e2e/` (chromium; dev server on `E2E_PORT`, default 5199) |

- e2e specs mock tiles, OSRM and Nominatim (`e2e/fixtures.ts`, `e2e/mocks/`), so they run offline
  and never load the public services. The auto-fixture `mocks` also exposes request logs and
  failure switches (`mocks.osrm.failWith = 'NoRoute'`, `delayMs`, …) and aborts any other external
  request (`mocks.blocked`). `E2E_REAL_NETWORK=1` turns the mocks off. The tile mock can serve a picture of
  its own (`mocks.tiles.png = makeSeaTilePng()`: a sea with a border, an outline, a ferry line, land and a label)
  and refuse CORS reads (`mocks.tiles.cors = false`: `fetch`es of tiles fail, an `<img>` still shows them).
- The `app` fixture reads and drives the app through `window.__ROADMAP__` (`app.trip()`,
  `app.addPlaces('Lyon', 'Annecy')`, `app.seedSavedTrip(file)`, `app.mapView()`, …). Prefer it
  over clicking through the UI when the UI is not what you are testing.
- Specs for shared components run against the dev-only `/ui-kit.html` page (`src/dev/UiKit.tsx`).
- Every test starts as a *returning visitor* (the auto-fixture `returningVisitor` stores the "welcome seen" flag), so the
  first-visit hint (F8) does not sit on the map; `test.use({ welcomeHint: true })` opts in. `e2e/subpath.spec.ts` builds the
  app with `--base=/roadmap-overview/` into `node_modules/.cache/e2e-subpath` (about 10 s) and serves it through page routes.
- Visual verification uses real tiles/routing/search through a dev server and screenshots.
  Chromium reaches the internet through the sandbox proxy: launch it with
  `proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }`.
- The video specs (`e2e/export-video.spec.ts`) render real, small videos in headless Chromium (WebCodecs H.264/VP9 and `MediaRecorder` are there; a render of 8 s at 720p takes
  about 5 s, the real-time recorder test 11 s) and read them back (an MP4's `moov`, a WebM's first bytes, a WebM played in a `<video>`).
- Several agents may run at once: always pass an explicit, unique port.
- CI is one workflow, `.github/workflows/deploy-pages.yml` (F15): type check, lint and the unit tests gate a sub-path build that is deployed
  to GitHub Pages. **Playwright does not run in CI** (it needs the browsers and takes minutes); run `npm run e2e` before pushing.

## Feature log

Each feature appends a short entry here: what it added, where it lives, anything non-obvious.

### F0 — app shell, map, theme, stores, shared UI, test infrastructure

- **Shell**: `App.tsx` lays out `TopBar`, `Sidebar` (360px; below 768px a slide-over toggled by
  `ui.sidebarOpen`, closed with Escape/backdrop) and the map. No page scroll; the sidebar scrolls.
- **Map** (`features/map/`): react-leaflet with OSM tiles (`services/config.ts`; since F9 drawn by `BasemapLayer`
  / `SeaTileLayer` on canvases instead of `<img>`s), attribution, scale bottom-left, zoom bottom-right. Initial view = fit the restored
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
- **Known gaps** (both closed in F8): two open tabs overwrote each other's autosave (now `io/crossTab.ts`); the
  top bar had no overflow strategy on phones (now `layout/TopBarOverflow`).

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
  change route · double-click to remove" (the handles are invisible until revealed since F10). Undo/redo hit the route cache: no request.
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
- **Flags**: `flagUrl(code)` → `<base>/flags/<code>.svg` (`lib/assetUrl.ts`; 4:3 SVG, no width/height of their own: size the
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
  (Northern Cyprus is shown as Cyprus); no per-day breakdown; the date field is the browser's native one (looks different per browser);
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
  than `MAX_PLACES` = 500 places is refused ("This trip has 501 places; Vanagram opens at most
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

### F6 — ride: a campervan driving the trip, day by day

- **Timeline** (`features/ride/timeline.ts`, pure and unit-tested; time is seconds at 1× speed). Built from the
  places' *effective* days and the leg geometries (`getLegRoutes()`: decoded coords, `route.spans`, the
  route's own `distanceM`). Leg `i` is travelled on day `eff[i + 1]`; every day from `eff[0]` to `eff[last]`
  has a slot: a **travel day** (≥ 1 leg) takes 2.5 s, shared by its legs in proportion to their length with
  a floor of 12 % (`legShares`); a **rest day** takes 0.6 s, but a run of consecutive rest days is capped at
  4 s in total (so "day 400" is not minutes of a parked van) and is stored as one slot: **nothing loops over
  days**, so absurd day numbers cost nothing. The ride starts on the first place's day (a rest slot when no
  leg is travelled that day) and ends with the last leg. `sampleTimeline(tl, t)` →
  `{ day, date?, legIndex | null, position, heading, mode, distanceM, placeIndex, legProgress, resting,
  finished }`; `date` = `startDate` + (day − first day), i.e. the first *effective* day is the day
  `startDate` names. `mode` is the leg's mode, `ferry` on a ferry span of a drive leg, the van on rest
  days. `distanceM` sums the routes' own lengths (what the sidebar shows) plus the fraction of the current leg.
  `lib/pathAlong.ts` holds the interpolation (cumulative lengths + binary search, Mercator-correct inside a
  segment like `pointAlongPath`, exact at vertices), the screen-space heading (smoothed over ±1.5 km) and
  `clipPath` (the travelled part of a leg with its spans clipped). `stepDay`, `timeOfDay`, `dayTicks` and
  `nextStepTime` (reduced motion) serve the controls.
- **Store and loop** (`rideStore.ts`): `useRideStore` = `{ active, playing, speed, follow, time, timeline,
  placeIndex }` (not undoable, not saved; `speed` and `follow` last for the session) plus plain functions
  (`startRide`, `closeRide`, `toggleRide`, `seekRide`, `stepRideDay`, …; `rideDebug` for tests).
  `isEditingLocked()` / `useEditingLocked()` is **the one switch every editing surface consults** (see
  Locking). One `requestAnimationFrame` loop advances `time`
  (frame step capped at 0.1 s); a hidden tab pauses it and showing the tab resumes it; with
  `prefers-reduced-motion` playback **steps** (one slot per 1.1 s at 1×) and the follow camera jumps instead
  of gliding. `rideSample()` memoises the last sample, so the loop, HUD and map share it. The ride is made
  from the trip as it was when it started: while it runs, a change of the places, legs or routes
  **rebuilds the timeline and carries on from the same time** (nothing is rebuilt for a rename), a
  different `trip.id` or fewer than two places **ends** it with `closeRide({ keepView: true })`: the map is
  then left as whatever replaced the trip (a file that was opened and fitted the map) left it, whereas a
  ride the user closes (`closeRide()`) puts the view from before back (`keepView` in the store tells the
  map layer which). `startRide` also collapses what the locked
  sidebar would keep open (row search/rename, the selected leg's editor, the mobile slide-over). Fewer than
  two places, or a leg still `loading`, disables the button (`aria-disabled`, reason as tooltip and
  `aria-describedby`); a leg that failed to route rides its straight placeholder.
- **Locking** — nothing is rewritten, it is switched off: `rideScene` puts the HTML `inert` attribute on the
  marker, via-handle, badge and route (hit-line) panes, so markers cannot be dragged, focused or
  right-clicked and no handle appears on a line; `PlacesPanel` sets `inert` on the whole list (rows, day
  fields, menus, leg editor, search box); `PlacesLayer` ignores the map's right-click; undo/redo buttons and
  shortcuts are off; the top-bar trip title is `readOnly`. All of these ask **`isEditingLocked()`** (event
  handlers) or **`useEditingLocked()`** (components), exported from `ride/rideStore.ts`: true while a
  ride is on **or presentation mode is** (F8). **Any surface that edits the trip — including ones added later, such as the map's title card
  or file actions — must consult it** (disable the control or make the field read-only) rather than
  look at ride internals. Any trip change that still gets through is handled by the rebuild/close rule above.
- **Map** (`rideScene.ts`, mounted by `RideLayer` only while a ride is on; `destroy()` restores the view, the
  panes and the container class): the vehicle is a Leaflet marker in the `ride` pane with an SVG per
  vehicle (`vehicles.ts`: the trip's own vehicle on the road — F14 — and the ferry, train and plane; all side views facing east, ~56 × 35 px, the long Campervan 68 px wide since F16 and centred on the same 56 px marker). It
  **mirrors** to face west — `nextFacing()` turns only once the heading is ≥ 15° past north/south, so
  wiggly roads do not flip it — and is never rotated. Wheels spin and the body bobs while it moves;
  parked (rest day, the end) it stands beside its stop's badge. A small "Day N" tag rides above it.
  The planned-route panes get `.ride-dimmed` (opacity); the **trail** (legs travelled plus the part of the
  current one) is drawn in the `rideTrail` pane with `legStyle(…, selected: true)` per mode — ferry
  stretches of a drive leg in the ferry style — as two sets of polylines: finished legs (rebuilt only when one
  more completes) and the current leg (clipped every frame). **Stop halos** (`rideStops` pane, under the
  badges): a green ring once reached, pulsing while parked there. In the sidebar `PlaceRow` carries
  `data-ride="current|reached"` (`current` = the last place reached) and the HUD scrolls it into view.
- **Camera**: without Follow the whole trip is fitted once (bottom padding for the HUD); with Follow the map
  flies to the van at **one zoom for the whole ride** (the median, over travel days, of the zoom that
  fits a day's legs; clamped to 4 … 12), so it cannot ping-pong. After that it **moves rarely**: nothing
  while the van is inside a comfort box (the middle 40 % of the width, at most the middle 50 % of the
  height, 56 px clear of the HUD), then ONE eased `panBy` glide (1.6 s) that brings the van well back
  inside, aimed at where it will be when the glide ends and leaned back against its direction of travel
  (`glideOffset`), so a ride costs a handful of pans instead of one per frame. This matters because every
  map move ends in a `moveend`, which makes Leaflet re-clip and redraw every polyline: panning each frame
  cost ~6 ms per pan on a 27-place trip (measured: ~230 `moveend`s per 5 s, p95 frame 33 ms; with glides
  ~3 per 5 s, p95 16.7 ms). A van outside the view (seek, restart) is jumped to; with reduced motion moves
  are instant. Dragging the map hands the camera to the user (Follow turns off, no refit); switching Follow
  off refits the trip; the user's own zooming is left alone. `camera.ts` has the pure parts. When the user
  closes the ride the view from before it comes back (not after a trip change, see Store).
- **HUD** (`RideHud.tsx`, `ride.css`, bottom-centre slot, themed): big "Day N" (+ the date when the trip has a
  `startDate`), the current leg and vehicle ("Lyon → Annecy · Ferry"), "Resting in …", "Arrived in …",
  distance so far of total, "Stop 2 of 5", a scrubber (native range input) with a tick per day (labelled up
  to 14, thinned to about 60 for long trips) and a dot per stop, previous/next day, play/pause/replay,
  restart, speed (0.5×–4×, a `SegmentedControl`), Follow, close. Focus moves to play on start and back to
  the Ride button on close. Keys (capture phase on `window`, so Leaflet's own arrow-key panning never sees
  them): Space, ←/→ = previous/next day (the start of it), Escape; ignored in text fields, menus, the speed
  buttons and while a dialog is open. Holding the scrubber pauses; letting go resumes, wherever the pointer is then (the release is listened
  for on `window`, so a drag that ends over the map or the sidebar still resumes). Below 768 px the
  zoom control is hidden while the HUD is up and the Ride button is icon-only; the leg legend is hidden
  below 1420 px (F8, was 1260: so the legend never sits under the 680 px controls). There is no `backdrop-filter` on the HUD: it made every frame of the ride pay for a blur
  in software rendering.
- **Shared-code changes**: `lib/geo.ts` exports `mercatorY` / `latFromMercatorY` / `MAX_MERCATOR_LAT`;
  `panes.ts` has the `rideTrail` and `rideStops` panes; `PlacesPanel`, `PlaceRow`, `PlacesLayer`,
  `UndoRedoButtons`, `TripTitle` and `shortcuts.ts` consult `isEditingLocked()` / `useEditingLocked()` (a
  few lines each). `types/trip.ts` is unchanged.
- **Tests**: Vitest for the path helpers, the timeline (several legs on a day, rest days and runs, out-of-order
  days, zero-length legs, a single place, ferry spans, dates, day stepping, reduced-motion steps, tick
  thinning, absurd day numbers), the camera maths, the HUD texts and the store (start/stop, controls, trip
  changes mid-ride). `e2e/ride.spec.ts` (mocked services): button states, the day advancing in real time,
  the van following the route and matching the model to within pixels, distance/date/rest days, facing,
  ferry/train/flight vehicles, trail/dimming/halos/sidebar highlight, pause/seek/scrub/keyboard/restart/
  close, releasing the scrubber outside the slider, locked editing (drag, reshape, right-click, list, undo,
  the title) and its restoration, trip changes mid-ride (and the map staying as the new trip left it),
  Follow (in view above the HUD, steady zoom, few `moveend`s, a drag hands the camera over), hidden tab,
  reduced motion.
- **Known gaps**: the van moves at a constant speed through its day's slot, so leg durations (user overrides,
  ferry times) do not shape the timing; a rest day is always the van parked (also after a flight or a
  train); a trip that arrives while a ride runs (a pasted link) rebuilds or ends it by the rule above (F8: the File menu's
  replacing actions, `Ctrl+O` and file drops are locked during a ride now, as in presentation mode); the per-frame trail clip is O(points of the current leg).

### F7 — image export: a PNG of the map with the travel

- **Dialog** (`features/export-image/`): the top bar's `ExportImageButton` (icon button, `data-testid="export-image-button"`)
  opens the dialog through `ui.openDialogId === 'export-image'` and mounts `ExportDialog` only while it is open, so the
  statistics and previews cost nothing the rest of the time (focus goes back to the button when it closes). `Dialog` gained
  a `size="xl"` (940 px). Preview on the left, controls on the right (stacked below 768 px): size preset (Landscape
  1920 × 1080, Portrait 1080 × 1350, Square 1080 × 1080, Print A4 landscape 3508 × 2480), resolution (1× / 2× sharper),
  switches (title and statistics card, place names, day numbers, legend — the legend one is disabled, with a hint, unless
  two or more modes are in use), card style (Match app / Light / Dark) and the map credit (beside the image / small in it: F12). The choices live in `exportStore.ts`
  (`localStorage["roadmap-overview:export-options"]`, repaired field by field by `sanitizeOptions`). "Download PNG" saves
  `<slug>.png` (`exportFilename`: the trip title, accents dropped); "Copy image" is
  `navigator.clipboard.write([new ClipboardItem({ 'image/png': promise })])` with the render passed as a promise (Safari
  needs the write started inside the click) and is hidden when `ClipboardItem` does not exist. While a download or copy
  renders the dialog shows a progress bar (tiles n of m, drawing, encoding) and disables both buttons; afterwards a result
  line (success / warning / error). Notes under the preview: an image above 4096 × 4096 pixels ("Very large image — may
  fail on iPhone/iPad; try 1× or a smaller size": only A4 at 2×; the same wording is the message when the canvas or the
  PNG cannot be made), legs still routing or failed, country boundaries that could not be loaded, missing tiles, place
  names that did not fit. Closing the dialog aborts a render in progress. Exporting
  never touches the trip, the undo history or the autosave.
- **Preview** (`usePreview.ts`): redrawn 250 ms after the last change (the first drawing at once), an overtaken drawing is
  aborted, and it is drawn at ≤ 960 px on its long side (`previewScaleFor`) — a tile zoom or two coarser than the real
  thing, ≈ 20 tiles — so a redraw with other switches asks the tile server for nothing new (tiles are kept in memory).
  The full-size render usually finds its tiles already there when the preset and resolution did not change.
- **Renderer** (`renderTripImage.ts`; everything but the painting is pure and unit-tested): `renderTripImage({ trip, legs,
  stats, countriesStatus, width, height, scale, card, labels, days, legend, theme, signal, onProgress })` →
  `{ canvas, width, height, tiles: { total, failed, zoom }, hiddenLabels }`; `canvasToPng(canvas)`. The picture is laid out
  in the preset's *logical* pixels and painted at `scale` canvas pixels per logical pixel, so 2× is the same image with
  twice the pixels (and tiles one zoom deeper, `pickTileZoom`); cards, markers, lines and text are drawn `uiScaleFor` =
  `min(width, height) / 900` times bigger than on screen, so a print looks like the screen. Inputs are the same objects the
  map card uses: `getLegRoutes()` / `useLegRoutes()`, `computeTripStats`, `detectCountries` (via `useTripStats`), `flagUrl`
  (flags are loaded as images, the country code is drawn when one fails), `formatDateRange`, `MODES`, `haloDash`,
  `legStyle` (line styles, incl. loading = grey dashed and failed = red dashed), `splitSpans` (ferry crossings inside a
  drive route), `legBadgeSpots`, `modesInUse`, `modeIconSvg`.
  - `geometry.ts`: Web-Mercator at fractional zoom, `fitViewport` (zoom and centre that show all points inside the
    padding; an obstacle — the card, the legend — that a line or marker lies under makes the content move to one side of it,
    and of all the combinations the one that keeps the most zoom wins, like the map's own fit; content that is already
    clear is only centred), `pickTileZoom` (the tile zoom whose tiles are 0.62–1.23× their size on the canvas), `tileGrid`
    / `tilesOf` (columns wrap across the antimeridian, rows stop at the poles), `chooseTileGrid` (lowers the zoom until the
    grid has ≤ `MAX_TILES` = 300 tiles).
  - `card.ts`: `buildCardContent` (which tiles the card has — mirrors `TripCard`: distance from two stops, driving only for
    trips that drive, one tile per other mode, countries "…"/"—") and `layoutCard` (the map card's CSS metrics: width 340,
    title ≤ 3 lines, subtitle ≤ 2, date range, tiles flowing in rows that grow to fill them, flags wrapping), as a list of
    drawing ops; `cardTheme.ts` copies the light and dark tokens (`cardTheme.test.ts` fails when `tokens.css` drifts);
    `legend.ts`, `markers.ts` (marker and label metrics), `attribution.ts` do the same for the other pieces;
    `labelPlacement.ts` places name labels greedily (first and last stop first; right, left, above, below, the corners; never
    over a marker, another label, the card, the legend or the attribution, always inside the image); `legDrawing.ts` plans
    the lines; `icons.ts` turns the page's own SVG icons into `Path2D` outlines so the canvas draws the same icons;
    `unwrap.ts` moves the legs and places of a trip that crosses the date line onto one continuous map (flight arcs
    keep counting east past 180°, the live map draws such a trip in two pieces); `flagImages.ts` loads a flag with its
    viewBox size written on it (Firefox and Safari cannot draw an SVG without a size on a canvas); `paint.ts` has the
    canvas painters; `fonts.ts` waits for Inter (a canvas does not); `deliver.ts` has the download and clipboard code.
  - The OpenStreetMap credit is drawn only when `credit: 'image'` (F12, below; the first version always drew a plate in the
    bottom-right corner). A tile that cannot be loaded leaves the land colour of the OSM style behind it; the image is still
    made, and the dialog warns.
- **Tiles** (`services/tiles.ts`, `createTileClient`): one global queue — ≤ 6 downloads in flight in total (`loadSeaTile`, F9:
  `fetch` with CORS, 20 s timeout; it was `lib/loadImage.ts` with `crossOrigin = anonymous`), however many renders ask; in-flight de-duplication (`Map<url, download>`: renders
  that want the same tile share the download); a render that is abandoned releases its queued requests (a queued download
  nobody waits for is never started), while those already on their way finish and are kept; an LRU of 220 decoded tiles
  kept across renders; failures remembered for 30 s, except that `retryFailed` (passed by Download / Copy as
  `retryFailedTiles`) asks again, so a passing 429/5xx does not bake a hole into the picture; progress per tile. See the
  policy row in "External services". The real-network check of a 1920 × 1080 export asked for 84 tiles, a 2160 × 2160 one
  (2×) for 196.
- **Shared-file edits** (all additive): `Dialog` `xl` size; `e2e/fixtures.ts` `mocks.tiles` gained `urls`, `delayMs`,
  `failWith` (`'http-500' | 'network'`), `inFlight` / `peak` (the tile mock has always served CORS headers, which is what
  keeps the canvas readable); `lib/loadImage.ts`, `services/tiles.ts` are new; no change to `types/trip.ts`.
- **Tests**: Vitest for projection and `fitViewport` (padding, single point, max zoom, obstacles incl. lines between
  points and several obstacles), tile zoom and grids (wrapping, poles, the cap), label placement, text wrapping and
  ellipsis, card content and layout, theme tokens, leg drawing plans, legend / label / credit metrics, icon outlines,
  options, file names, the tile client (concurrency, de-duplication, cache, failures, abort). `e2e/export-image.spec.ts`
  (mocked tiles, with CORS): dialog open/close and focus, preview content, PNG size for every preset and 2×, pixel checks
  of the downloaded file (tiles, route, card corner, credit), every switch changes the preview, legend needs two
  modes, card style vs app theme, ≤ 300 tiles and ≤ 6 at a time for A4 at 2×, progress and disabled buttons, tile
  failures (warning, image still made), clipboard, empty and one-place trips, remembered options (and damaged ones),
  unrouted legs, no new tiles after closing, no undo step.
- **Known gaps**: the preview is not the final picture pixel for pixel (it uses coarser tiles and a smaller scale); lines
  are not avoided by labels (as on the map); a trip that goes right around the world is fitted into a map wider than
  the tile pyramid's one copy and repeats tiles;
  2× A4 is a 35-megapixel canvas, which iOS Safari refuses (the dialog warns up front and says so on failure); the legend does not list the
  dotted "straight line" drive style (as on the map); text is set in Inter only, so scripts it lacks fall back to the system
  font; the card cannot be moved to another corner.

### F8 — polish: help, presentation mode, notes, toasts, other-tab saves, phones, sub-path hosting, README

- **Help** (`features/help/`): the top bar's "?" button and the `?` key (`useHelpKey`, mounted in `App`) open `HelpDialog`
  (`ui.openDialogId === 'help'`, so the phone overflow menu and the welcome card open it the same way via `openHelp()`): four short
  how-tos (places, routes, showing a trip, saving/sharing) and the shortcut tables. **`shortcutList.ts` is the one list of keys the
  app has** — a new shortcut must be added there (`shortcutList.test.ts`, `help.spec.ts`). Single-key shortcuts (`?`, `P`) go
  through `plainKeyAllowed(e)` in `layout/shortcuts.ts`: not with Ctrl/Cmd/Alt, not while a dialog is open, not in a text field or a
  menu (type-ahead). **First-visit hint** (`WelcomeHint`, a card in the new `map-slot--center`): shown for an empty trip until
  dismissed; `localStorage["roadmap-overview:welcome-seen"]` is also set the moment a trip has places (restored, opened, built), so
  it never returns for anyone who has used the app.
- **Presentation mode** (`features/presentation/`): `usePresentationStore.on` (not undoable, not saved). It is a second reason for
  **`isEditingLocked()` / `useEditingLocked()`** (now `ride active || presenting`), so everything F6 locked is locked here too, plus
  what F6 had left open: `PlacesLayer` ignores the right-click on a marker as well and disables marker dragging (`dragging.disable()`;
  markers stay hoverable on purpose, so their notes show), `PresentationLayer` makes the route, via and badge panes `inert` through
  `map/paneLock.ts` (a lock with owners — the ride and presentation may hold the same pane; the ride's scene was changed to use it)
  and hides the via handles (`.is-presenting`), `reshape.hover` checks the lock, the card hides "Add a subtitle" / "Add dates" while
  locked, and **opening another trip is locked too**: File → New trip / Open / Sample / Recent are disabled, `Ctrl+O` and file drops do
  nothing (a drop says why), Help's "Load the sample trip" is disabled. Save, Copy share link and Copy presentation link stay. The
  sidebar and undo/redo are hidden by `.app[data-presenting]` (`layout.css`); the map is fitted again after the layout change
  (`PresentationLayer`, not during a ride). Keys: `P` toggles, Escape leaves (after the ride's own Escape, which stops propagation
  first; not from a text field; from the read-only title it does). **Address**: `?present` (also `?present=1`; `=0`/`=false` are off)
  or `&present` after a `#trip=` hash (`wantsPresentation` in `lib/shareLink.ts`; the payload alphabet has no `&`) enters it in
  `openTripFromAddress`, before the first render; because the hash is removed after opening, a share link's wish is kept as
  `?present`, and leaving the mode removes it, so a reload presents again exactly while the mode is on. `buildShareUrl(file, url,
  { present: true })` and File → Copy presentation link make the `&present` form.
- **Notes**: `PlaceNote` (a textarea in the expanded row under the search; draft locally, one `updatePlace` on blur, empty/space-only
  removes the note, Escape discards and closes the row, a draft whose saved note changed underneath — undo — is dropped, a row
  that collapses with a draft saves it; at most 1000 characters). A note shows as a small icon on its row (`place-note-indicator`,
  the note as its `title`) and **in the marker's label**: the permanent label is a name plus a `.place-label__note` that CSS shows
  only while the label is hovered or selected (`is-hovered`/`is-selected`), turning the pill into a card; the marker's aria-label
  includes the note. (There is no second Leaflet tooltip: a marker has one, and it already is the label.) Since F11 a click on the marker opens
  the place card, which carries the note, and the label then stays a plain pill (`is-carded`) until the card is closed.
- **Toasts** (`components/Toast.tsx`, `portal.ts`, `map/MapOverlays.tsx`): on screens ≥ 768 px the toast region is portalled into a
  **toast dock** — the first child of the bottom-centre map slot, i.e. stacked directly above the ride controls, clear of the title
  card (top-left), the map tools (top-right) and the legend (bottom-left). Inside an open dialog it still goes into the dialog; on
  phones (and where there is no map: the UI kit page) it stays fixed to the window at the bottom, lifted above a running ride's controls
  (`body:has(.ride-hud)`). Toasts gained `secondaryAction`, `dismissible: false` (a decision toast: no X, pair with `duration: 0`) and
  `blockedBy` on an action: asked at click time, it returns a sentence when the action cannot run now (the toast stays, the sentence is shown
  as a toast). **Every toast action that changes the trip uses `blockedBy: editingLockedReason`** (`ride/rideStore.ts`: "Leave presentation
  mode (Esc) first…", "Close the ride (Esc) first…"): the Undo of New trip / open / restore / load, "Restore previous trip", "Open linked trip
  (anyway)", cross-tab "Load it" — a toast outlives the moment it was made, and the lock may have begun since.
  `components/useMediaQuery.ts` is the small hook behind the width switch.
- **Durations** are always hours: `formatDuration` gives "34 h 28 min", "1 234 h", never days (the one function every place uses,
  also the leg editor's hint and the stats tooltips; the "Days" tile is a count of calendar days and is unchanged).
- **Other tabs** (`features/io/crossTab.ts`, started by `bootstrap()`): the `storage` event (it only reaches the *other* tabs) for the
  autosave key. A stored trip whose `tripFingerprint` differs from the open one holds this tab's autosave
  (`holdAutosave()` / `releaseAutosave(save)` in `store/persistence.ts`: nothing is written, also not on page hide) and shows a
  toast "This trip was changed in another tab." with **Load it** (keeps this tab's trip in Recent trips, `installTrip` the stored one,
  one undo step, "Undo" toast) and **Keep mine** (release and save now). It has no dismiss button, because the hold lasts until the
  choice; further saves from the other tab change nothing visible (Load reads the stored trip when clicked), a toast pushed out of the
  queue is shown again, and equal trips (the other tab undid, or loaded ours) or unreadable data resolve or ignore it. Routes that
  arrive later do not matter: only the trip is compared. After "Keep mine" the *other* tab is the one asked. **While editing is locked** (ride,
  presentation) the question is not asked: the hold starts at once, a toast that is up goes away when a lock begins, and the question comes
  when it ends (`consider(readStoredTrip())`, so it reflects what is stored then). **Leaving**: while the question stands this tab's trip
  exists only in memory, so on `pagehide` / the tab being hidden it is pushed to Recent trips (`keepOpenTrip`; a trip equal to the stored
  one is not). "Load it" goes through `replaceOpenTrip` (exported from `io/importTrip.ts`), i.e. the same "no room to keep a copy →
  ask first" confirm as every other replacement; Cancel brings the question back.
- **Phones** (below 600 px, `layout.css`): `.topbar__collapsible` (undo/redo, the divider, presentation, help, theme) is hidden and
  `TopBarOverflow` ("⋯", a `Menu`) offers Undo, Redo, Presentation mode / Leave presentation mode, Help and the theme switch; the
  bar keeps the places button, the title, Ride, Image (F7's slot) and File. Below 500 px the logo is hidden to leave room for the
  title; below 1024 px the brand name is. The top bar is tested at 768, 900 and 1024 px and at 390 px. F7's Export image button stays in the bar on phones (nothing sticks
  out at 390, 360 or 320 px, with touch's 40 px buttons too) and in presentation mode: showing the trip as a picture is not editing.
  `.menu__shortcut` hints are hidden on coarse pointers (`Menu.css`); the first-visit card says "long-press on a phone".
- **Hosting under a sub-path**: `vite.config.ts` `base` comes from `BASE_PATH` (`/` by default; slashes are added) or `--base`; the
  flag plugin's dev middleware honours it. `lib/assetUrl.ts` (`assetUrl(path)`, `import.meta.env.BASE_URL`) is the one way to write a
  root-relative URL: used by `flagUrl` and `SAMPLE_TRIP_URL`; `index.html`'s favicon is rewritten by Vite; share links keep
  `location.pathname`; `?src=` is resolved against the page. `e2e/subpath.spec.ts` guards it (build, files found, no request outside
  the base, flags loaded, sample, share and presentation links, `?src=`).
- **README.md** (new): what it is, features with how-tos (the Image export section follows F7's dialog), shortcuts, the trip file format,
  sharing, development, the external services' policies and how to re-point them, hosting incl. an example GitHub Pages workflow (since F15 the README points to the real one). Screenshots live in `docs/screenshots/`
  (made from the sample trip with real tiles at 1280×800 CSS px, device scale factor 2, then resized to 1920 px (the video tab's, F13: 1600) and reduced to a
  256-colour palette to stay below 500 kB each; F17 made them again); `exported-image.jpg` is a real export of the sample trip (Landscape 1920 × 1080,
  downscaled to 1440 × 810 — made from the merged app, so its card says "34 h 28 min").
- **Small things**: the ride's legend is hidden below 1420 px (was 1260: at 1280 it sat under the controls); `TripCard`/`StartDate`
  render no prompts while editing is locked (also during a ride). **The title card folds into its pill while a ride runs** when the map
  is narrower than 760 px (a window under about 1100 px: the card would cover the trip) or too short for the card above the ride
  controls (`stats/useFoldedByRide.ts`: card height measured, the controls' height measured, both from the map area); it comes back
  when the ride closes or the window grows, and the user's own folding (`statsCardStore`) is untouched.
- **Tests**: Vitest for `formatDuration` (hours), `assetUrl`, the presentation flag in `shareLink`, `presentationStore`, `paneLock`,
  `shortcutList` and the autosave hold. Playwright (mocked): `help.spec.ts` (dialog, keys, hint, phone), `presentation.spec.ts`
  (toggle, `P`/Escape, `?present`, `&present` links, pasted link, presentation link round trip, everything that must not be editable,
  notes on hover, ride interplay, phone), `notes.spec.ts`, `crossTab.spec.ts` (two pages of one context), `toasts.spec.ts`
  (placement against the card, tools, ride controls, phone), `toastLock.spec.ts` (toast actions and the lock), `rideCard.spec.ts` (the card
  and the ride controls at many window sizes), `subpath.spec.ts`, and the top bar in `shell.spec.ts`. **Two races found in older
  specs**: Playwright switches file-chooser interception on asynchronously when a `filechooser` listener is added, so a listener added in
  the same breath as `Ctrl+O` can miss the chooser (register it first: `io.spec.ts`; reproduced 3 in 25 under load); and dnd-kit's
  KeyboardSensor listens for arrow/drop keys from a `setTimeout` after the pick-up, so the first ArrowDown can be lost although the
  pick-up is already announced (`places.spec.ts` sends it until dnd-kit shows it took it).
- **Known gaps**: the other-tab check compares trips only when a `storage` event arrives (a tab that was asleep sees the toast on its next
  event, not before); two tabs editing the same trip alternately will keep asking each other; presentation mode refits the map when
  toggled, so a hand-made view is not kept; the README screenshots are static and will age with the UI.

### F9 — no borders on the sea

The standard OSM style draws country and maritime borders, the rings of territorial waters and the outlines and glows of marine protected
areas across the sea. The tiles are pictures, so they are recoloured to the water colour **on the tile's pixels**, on the live map and in the
exported image (one path for both, so a later video export gets it too). The tile provider and style are unchanged.

- **The function** (`lib/seaOutlines.ts`, framework-free: `hideSeaOutlines(rgba, width, height)` recolours in place and returns how many
  pixels it changed, 0 = the tile is exactly as it was). Water is #aad3df, a boundary is #8d618b and a protected area #008000 drawn at partial
  opacity, with a lighter casing at high zooms, so an outline pixel is `water + a·(purple − water) + b·(green − water) + w·(white − water)`;
  the three coefficients come from inverting a 3 × 3 matrix. Calibrated on ~45 real tiles (zooms 3–16: North Sea, Skagerrak, Baltic, Channel,
  Adriatic, Aegean, Strait of Bonifacio, Norwegian/Swedish archipelagos, Lake Constance and Geneva, the Wadden Sea): outline pixels have
  `a` ≤ 1, `b` ≤ 0.75, `w` ≤ 0.36 and are no lighter than the water in any channel; every land colour has `w` ≥ 0.5. Rules, each of them
  there because a real tile needed it (`hideSeaOutlines` is commented, the constants are named):
  1. only *outline* pixels change, and only to the water colour; anything lighter than the water (land, a coast's edge, a label's halo) is
     "in the way": an outline pixel with one within 1 px stays, so coasts, labels and their halos are never touched. **Green outlines and
     glows** (protected areas: no purple in them and as much red taken out of the pixel as the green takes, which tells them from the sea
     mixed into a dark-green coast) are the exception: a glow hugs the coast, and half of it left looks like a mistake, so for them land is
     not in the way — but a label's halo (white over the sea, red ≥ 205), dark text and grey lines still are, as is anything that is not
     within 6 px of water (rule 3). (Keeping green outlines entirely was the fallback if this could not be made clean; it could);
  2. ferry lines (more blue than the water) and water labels are neither outline nor in the way — except a pixel that is *a ferry line on an
     outline* (sea + purple/green + the ferry's #6666ff, at least 0.15 of the pigment): it is recoloured to the sea with the ferry's share
     of blue, so a ferry along a border keeps its line and loses the dotted dark remnant the mix would leave;
  3. the outline must be over water: water within 6 px counting through outline pixels (a green line across *tidal flats* is drawn over the
     flats' colour, which is close to an outline's; erasing it would cut a blue stripe through them);
  4. an outline pixel inside a solid 11 × 11 block of outline colours belongs to an *area* and everything within 6 px of it stays (widest real
     outline: 9 px);
  5. neutral dark grey (a railway tunnel's line, #808080-ish) has the colour of a boundary lying on a protected area, so grey pixels are kept —
     unless a pixel of a boundary's own casing (purple, no green) is within 2 px, which a tunnel does not have;
  6. semi-transparent pixels are left alone.
  Boundaries that run *along* the coast stay as the faint dotted outline they are on the land side. A pass takes 2–4 ms for a 256 px tile; a
  second pass changes (almost) nothing. Real tiles used as fixtures: `lib/fixtures/tiles/` (with an attribution README), read by a small PNG
  decoder in the tests (`lib/fixtures/decodePng.ts`).
- **Getting tiles** (`services/seaTiles.ts`, `seaTileProcessor.ts`, `seaTiles.worker.ts`, `lib/seaOutlinesBitmap.ts`): `loadSeaTile(url,
  { signal?, readable? })` → `ImageBitmap | HTMLImageElement`. `fetch` in CORS mode (20 s timeout, credentials omitted; one request per tile,
  the same URLs as before) → the bytes go to a **module Web Worker** that decodes them (`createImageBitmap` with no colour management),
  runs `hideSeaOutlines` on an `OffscreenCanvas` and sends the bitmap back (the *same* decoded bitmap when there was nothing to hide).
  No Worker or OffscreenCanvas, or the worker broke (`onerror`, an unreadable message) or does not answer a tile within 5 s
  (`WORKER_TIMEOUT_MS`; every tile it owes then goes to the page): the same on the page, and the worker is not used again; pixels
  unreadable: the plain decoded tile. Processed bitmaps are kept in an LRU of 160 (about 40 MB), so a tile that comes back costs no
  request and no pass; one pushed out is `close()`d unless a `readable` caller (the export, which keeps its tiles) has it; concurrent
  callers share one download, which is aborted when the last of them gives up. A browser that refuses the bytes (no CORS) makes the
  screen fall back to the plain `<img>` (shown, but unreadable) — and, once such a picture has loaded, remembers the *origin*: its later
  tiles are loaded plainly with one request each (the first batch is asked for twice; a network error does not count, the picture must
  load); a caller that will read the picture back (`readable`, the export) gets the error instead, i.e. a missing tile, as before. HTTP
  errors and timeouts are errors in both cases (no second request).
- **Live map** (`features/map/SeaTileLayer.ts`, mounted by `BasemapLayer`; `MapView` no longer has react-leaflet's `TileLayer`): a
  `TileLayer` subclass whose `createTile` returns a `<canvas>` (sized by the picture, so any retina scheme would work; `detectRetina` is not
  used) and calls Leaflet's `done` when it is drawn, so fade-in, `leaflet-tile-loaded`, `tileerror`, attribution and the grid are Leaflet's.
  Tiles dropped by the map (`tileunload`, `tileabort`) abort their download. Leaflet's own `_abortLoading` tells loaded tiles of
  other zooms from loading ones with `img.complete`, which a canvas does not have, so it would throw away every old tile on a zoom: it is
  overridden to use Leaflet's own `loaded` mark (`seaOutlines.spec.ts` guards it). `data-tile-source="processed" | "original"` is on every tile.
- **Export** (`services/tiles.ts`): the shared `tileClient` is now `TileClient<CanvasImageSource>` and loads through `loadSeaTile(url,
  { readable: true })`; the 6-at-a-time queue, de-duplication, the 220-tile memory and the failure memory are unchanged and still sit on top.
- **Shared-file edits** (additive): `lib/lru.ts` (`createLru(limit, onEvict?)`), `e2e/fixtures.ts` (`mocks.tiles.png`, `mocks.tiles.cors`), `e2e/mocks/tiles.ts` (`makeSeaTilePng`,
  `SEA_TILE`), `e2e/smoke.spec.ts` (tiles are canvases now), `MapView.tsx`, `services/tiles.ts`, README (a "quiet sea" section, the tile row).
  `types/trip.ts` is unchanged, and so is the Help dialog (nothing new to do).
- **Tests**: Vitest — the function on ten real tiles (only outline pixels change and only to water; nothing next to land, a label or a
  halo; land untouched; no outline left in open water, 500+ before and ≤ 20 after; the tunnel; the flats; ferry lines and halos; the
  borders on land; a ferry line lying on a border leaves no mixed pixels — `z8-138-93-adriatic` — and keeps its line; green is gone from
  the water, also along coasts and between islands — Stockholm, Bonifacio, the Adriatic island) and on drawn pictures (every rule above, tile
  edges, odd sizes, `Uint8Array`), the loader (cache and its limit, closing of pushed-out bitmaps, sharing, abort of one or all callers, CORS
  fallback on the screen and not for a readable picture, an origin that refuses CORS asked once per tile, HTTP errors, the timeout) and the
  processor (worker, no worker, a broken worker, a silent one with fake timers, an unreadable message, a tile that cannot be sent,
  unreadable pixels, `OffscreenCanvas` missing; fakes for the browser's pieces).
  `e2e/seaOutlines.spec.ts` (mocked): pixels of a live tile (boundary, casing and outline gone; ferry, land, the border on land, halo and
  text kept), with the Worker removed or one that never answers, a tile the page may not read (and one request per later tile), tiles that fail (no hole filled in, no retry), tiles not fetched
  twice when the map comes back, old tiles kept during an animated zoom, and the export preview with the same tile.
- **Known gaps**: a boundary lying along the coast keeps its faint outline on the land side (there is no telling it from the coast);
  green glow *on the islands themselves* (over land) and a few specks where it meets islet edges stay, and a second pass would still take
  about a hundred pixels off the widest glows (nothing runs it); the green italic *names* of
  protected areas stay (as do the purple names of states and countries on the sea) — they are labels, and they are what is left of the
  area; a tunnel is cut by about 6 px where a boundary crosses it; a tile server with another water colour (another style) hides nothing;
  Firefox with fingerprinting protection returns noisy canvas pixels, so tiles there are shown unprocessed or slightly noisy; the live
  map's first tiles arrive one worker round trip later than an `<img>` would (a few ms).

### F10 — clean reshaped routes: invisible via handles, no stubs at via points

- **Handles hidden by default** (`routing/viaReveal.ts`, `routing.css`, `RouteLayer.tsx`). The via markers stay in the DOM (focusable,
  grabbable) at `opacity: 0`; the framework-free `createViaReveal` decides per leg when they get the class `is-revealed` (fade in at once,
  fade out after a 140 ms grace): the (mouse/pen) pointer is over the leg's line (`route-hit`) or one of its handles, a reshape drag is in
  progress (new via point out of the line or an existing handle), a handle has keyboard focus (`:focus-visible`, which reveals the whole
  leg), or — only when there is no hover (`(hover: none)` or the last pointer on the map was a finger) — the leg is the selected one.
  Selecting a leg (connector, click, the automatic selection after a drop) shows nothing with a mouse. **After a drop the leg rests**: the
  new handle appears under the pointer, but stays hidden until the pointer has left the leg once (`dragEnd(legId, dropped)`), and its
  tooltip is closed while it is invisible, and an unrevealed handle takes no part: a double-click on it removes nothing, a right-click is
  forwarded to the map's own menu (as on the line), a click selects the leg (as on the line). On touch the unrevealed handles also get `pointer-events: none`. Presentation mode and the
  ride hide the whole via pane (`display: none` under `.is-presenting` / `.ride-active`, `map.css`); the image export never drew them.
  `createReshaper` takes a 4th argument, `{ start, end }`, called when a line drag begins and ends.
- **Handles sit on the line** (`viaAnchorsOnPath` in `lib/nearest.ts`, `syncVias`): a via point the router did not run exactly through
  (it snaps to a road, or a stub was cut out) is drawn at the nearest point of the routed line — otherwise an invisible handle 80 m
  beside the road could not be found by pointing at the line. The stored via point is untouched (undo, the route key and the file keep
  it), and it stays where it was dropped while the leg re-routes. `viaPositionsOnPath` is shared with `viaInsertIndex`. The handle's
  key/focus listeners are re-bound when the icon is replaced (a leg switching mode used to lose its Delete key), the keyboard focus
  moves to the new element, and after every sync a leg whose focused handle is gone (removed with Delete, replaced) stops counting as
  focused — browsers do not always send `blur` for a removed element.
- **Smooth line at via points** (`lib/viaSpurs.ts`, called by `services/osrm.ts`). Measured on the real demo server, Lyon → Annecy
  (140.3 km) with one via point dropped beside the A43 (8 requests): 20 m off the road: route unchanged; **80 m off: the point snapped
  31 m away onto a dead-end road and the route drove 349 m in and the same 349 m back out** (+4.2 km, +12 min: a stub on the map);
  400 m off: a U-shaped turn 80 m wide between two different roads (real roads, nothing runs back over itself: left alone); 1 500 m off:
  only roundabout loops. `continue_straight=true` returned the identical routes, so the demo server already forbids U-turns at
  waypoints and the parameter is not sent. `trimViaSpurs(path, snappedVias, spans?)` finds, for each *interior* waypoint (the
  `waypoints[i].location` OSRM answers with; the route's own two ends are never touched, so a dead-end destination keeps its road), a
  vertex within 40 m of it where the path turns back (≥ 150° over 8 m) and walks the way in backwards while it lies within 4 m of the way
  back (the same road driven twice; at the junction up to 25 m over 60 m more, which is what a roundabout needs). A stub ≥ 30 m and ≤ 1 km
  each way is replaced by a straight join where the two ways part; the distance and duration (and the drive span's) shrink by what was cut,
  proportionally. Spans move to the new indices; a stub with a ferry boundary inside is left alone. Longer stubs (2.7 km of airport
  access road was seen) are kept: they were driven to on purpose. The route key is intent-only as before; **routes cached before F10 keep
  their stubs until they are routed again.** The real answer is the unit-test fixture `lib/fixtures/osrm-via-spur.json`.
- **Tests**: Vitest for `viaSpurs` (synthetic stubs, the real fixture, U-turn between roads, long/short stubs, route start, spans, inputs
  untouched), the OSRM client (stub cut, metrics follow, missing waypoints, destinations untouched), `viaAnchorsOnPath`, and `createViaReveal`
  (pointer, drag, rest after a drop, focus, touch selection). `e2e/viaHandles.spec.ts` (mocked): hidden right after a reshape drop with the
  pointer resting (no tooltip either), shown while on the line / on the handle / dragging, hidden when away, selection and sidebar hover do
  not show them, drag and double-click still work, Tab focus reveals the leg and Delete removes, presentation mode and the ride never show them,
  touch emulation (selected leg shows, others hidden and untouchable, touch drag of a handle), and an OSRM answer with a dead-end stub
  (real fixture through `page.route`): stub cut from the cached route, distance reduced, handle drawn on the line.
- **Known gaps**: the 1 km limit is a judgement call; U-shaped detours between parallel roads remain; a hybrid laptop shows the selected
  leg's handles after a touch until the next mouse move on the map; keyboard-only users still cannot add or move via points.

### F11 — photos for places

- **Contract** (additive, file version stays 1): `Place.photos?: PlacePhoto[]` (`{ id, width, height, caption? }`, the order is the order
  shown) and `TripFile.photos?: Record<id, { mime: 'image/jpeg', data: <base64>, width, height }>`. The trip only ever holds the
  *references*; `parseTripFile` repairs them (bad entries and repeated ids dropped, ≤ 50 per place, ≤ 300 per trip, one warning each) and
  validates the embedded records: only JPEG-looking base64 (`/9j/`) of at most 14 M characters, sane integer sizes, and only ids that a
  place refers to; the rest is dropped with a count in the warnings. It does not decode the bytes (see `photoFile.ts`).
  `sanitizePlacePatch` accepts `photos` (cleaned; empty = key removed) and `tripStore.updatePlace` caps it so the whole trip stays within
  300, so a 51st photo for a place or a 301st for a trip cannot enter by any route. Everything photo-related that is pure is in `lib/photos.ts`.
- **Where the bytes are** (`services/photoDb.ts`): `PhotoStore` (`put` — an id that is stored already is kept —, `get`, `has`, `list` without reading
  the photos (a key cursor on the `createdAt` index, plus each photo's garbage-collection mark), `markUnreferenced` / `clearUnreferenced`,
  `delete`); `createIndexedDbPhotoStore()` is the real one (database version 2: the stores `photos` and `unreferenced` — the marks —, created on
  upgrade if missing; opened lazily; it closes itself on a `versionchange` and opens again after the browser closed it (`onclose`); a `blocked`
  open fails at once and a connection that arrives afterwards is closed, not leaked; errors become `PhotoStoreError` with a sentence for the
  user: no room / the browser refuses site storage here (SecurityError, InvalidStateError: "private browsing or blocked site data can cause
  that") / anything else with the error's name — "private browsing" is not claimed for every failure);
  `createMemoryPhotoStore()` serves unit tests; `getPhotoStore()` / `setPhotoStore()` is the one the app uses. Record: `{ id, blob (JPEG ≤ 2048
  px), thumb (JPEG ≈ 320 px), width, height, createdAt }`. A photo this browser does not have (IndexedDB cleared, a trip that came without its
  file) shows a placeholder, never a broken image or an exception.
- **Adding** (`features/photos/`): `PlacePhotos` is the *Photos* area under the note in the expanded row: "Add photos" (a hidden multiple file
  input, `accept="image/*"`) and drag-and-drop of image files onto the area (its `onDrop` only claims drops that contain images, so a `.json`
  dropped there is still the window's trip drop). `addPhotos(placeId, files)` plans the batch (`planBatch`: not-an-image, empty, > 30 MB and
  the surplus beyond the free slots are rejected, each with a reason), then, one file at a time and one batch at a time (a promise queue:
  decoding a dozen 12-megapixel pictures at once would need gigabytes), runs `processImage`: `createImageBitmap(file, { imageOrientation:
  'from-image' })` (EXIF applied; the metadata, GPS included, is gone because the pixels are re-encoded), drawn onto a canvas (white under
  transparency), ≤ 2048 px, JPEG 0.85, then a ≈ 320 px thumbnail made from that. Each result is stored at once (memory stays flat) and the batch
  becomes **one** `updatePlace` = one undo step. An unreadable file (a HEIC outside Safari is named as such) is reported in one toast and the
  rest is added; a storage failure ends the batch with its own message but keeps what was stored. Progress ("Adding photo 3 of 12…") comes from
  `usePhotoJobs`. If editing is locked meanwhile (ride, presentation) or the place disappears, the batch is not applied (its bytes become
  garbage). `photoActions.ts`: remove (the × on a tile), move earlier/later (arrows; *no drag reordering*: the arrows are keyboard
  accessible, and a second dnd context inside a sortable row was not worth the risk), caption (committed on Enter/blur as one step; a
  half-typed caption survives the row closing; Escape discards it): each is one undo step and ignored while `isEditingLocked()`.
  The collapsed row shows a photo count (`place-photos-indicator`) beside the note icon.
- **Viewing** (`MapPlaceCard.tsx`, `PhotoLightbox.tsx`, `placeCardStore.ts`): a click on a marker (or Enter on a focused one, which then moves the
  focus into the card and gives it back on close) selects the place *and* opens its **card**: a React overlay in `.map-overlays` (not a
  Leaflet popup) with the numbered badge, the name, "Day 3 · Fri 17 Jul 2026" (the effective day; the date only when the trip has a start
  date), the note and up to eight thumbnails (the eighth says "+N"; a single photo is shown large). It sits above the marker, or below when
  there is no room (on a phone, where the title card is a pill across the top and the map tools beside it, "room" means clear of those: a
  card never covers them), is clamped into the map and follows the marker on pan/resize (a zoom animation hides it until `zoomend`; a marker that is
  scrolled out of view takes its card with it). It closes with its ✕, Escape (a document-capture handler, so it comes *before* presentation
  mode's Escape, and only when the key is not a field's, a menu's or a dialog's), a click on the empty map, another place being selected, the
  place being deleted, the marker being dragged, or a ride starting. Selecting a place in the **list** does not open a card: only the map does.
  **Not during a ride** (the camera moves under it and the ride has its own HUD); it works in presentation mode, which is its main use. The
  marker's *label* stops showing the note while its card is open (`is-carded`: the card has it); hovering still shows the note in the label.
  A thumbnail opens the viewer: a modal `<dialog>` portalled to the body (dark in both themes) with the photo large (the thumbnail blurred
  underneath until the big one has loaded), the caption, "2 / 12", previous/next buttons, ←/→, a horizontal swipe (≥ 48 px and mostly
  horizontal; the click that ends a drag does not close it), Esc / ✕ / a click beside the photo to close, and the neighbours preloaded.
  `photoUrls.ts`: object URLs are shared and reference-counted, and revoked 30 s after their last user (`usePhotoUrl(id, 'thumb' | 'full')`).
- **Saving and opening** (`photoFile.ts`, `lib/photos.ts`): *Save as JSON* is async now: `currentTripFile()` is taken at once (what was typed is in
  it), then `tripFileBlob` reads each referenced photo from IndexedDB and builds the text *in pieces* (`tripFileTextParts`: the pretty-printed
  file with `photos` last, each photo's base64 made in 3·256 KB chunks from its Blob, so no 100 MB string ever exists) for `new Blob(parts)`.
  Photos this browser no longer has — or whose bytes cannot be read (`blob.arrayBuffer()` rejecting is caught per photo, before the file's text
  is made, so the references of a skipped photo are left out as well) — are left out of the file, and a toast says how many; the save still
  happens, and `saveTripFile` catches everything else too ("Could not save the trip file") because its callers do not wait for it. Without
  photos the output is byte for byte what it was. Opening (`storePhotosOf`): every embedded JPEG is first bounded by what it *declares to decode
  to* (`readJpegSize` reads the frame header: wider or taller than 16 384 px or more than 64 megapixels is refused before anything is decoded),
  then decoded once (`describeJpeg`: its true, oriented size and a new thumbnail; one beyond 2048 px is shrunk and re-encoded like an added
  photo), stored with `overwrite: false`, and only then is the trip installed; the references get the stored size (`withPhotoSizes`), not the
  one the file claimed. References to photos that are neither in the file nor in this browser are removed, and the notes ("2 photos in the file
  were damaged or too large and were left out.") join the parser's warnings in the opening toast. The returned file has no `photos` any more, so
  the base64 does not linger in memory. `storePhotosOf` also returns `added`, the ids it newly put in storage; when the trip is then **not**
  opened — the confirm to replace the open trip is answered no, or editing got locked while a big file was read (`openTripText`) — they are
  `discardPhotos`-ed again. A linked file (`?src=`) is not prepared in advance: `openLinkedTrip` stores its photos in the moment it installs the
  trip (also from the "Open linked trip (anyway)" toast actions), so an offer nobody answers leaves nothing behind. **Share links**: `encodeShareHash` strips embedded bytes *and* references (`withoutPhotos`), `openShareHash`
  strips them again on the way in, and the share toast says "Photos are not part of links: save the JSON file …" when the trip has photos.
  Autosave and recent trips keep references only (their fingerprints include them, so a photo change is a change). The image export (F7) ignores photos.
- **Garbage collection** (`photoGc.ts`, `lib/photos.ts` `planGarbage`): deliberately slow, because this tab cannot see what other tabs still need
  (their undo history, a trip they have not saved yet). A sweep (`collectPhotoGarbage()`) works out which stored photos something still refers
  to — the open trip, **every state of this page's undo/redo history** (so an Undo, also the Undo toast of "New trip", finds its bytes), the trip
  in the autosave slot, every recent trip (read raw from localStorage, deliberately more inclusive than the validated list; when storage cannot be
  read nothing happens) — and then: a photo nothing refers to is **only marked** with the time of the sweep (store `unreferenced`); a marked photo
  that is referenced again loses its mark; a photo that has stayed unreferenced for **7 days** (`GC_TTL_MS`, counted from its mark) is deleted,
  with its mark. A clock set back deletes nothing. A tab that is still open sweeps again every 30 minutes (`GC_INTERVAL_MS`), which keeps the
  marks of the photos *its* history needs cleared, so another tab's sweep cannot get them to their week; only a tab that sleeps for more than a
  week while another one sweeps can lose a photo from its undo history (it then shows the "not available" placeholder). Sweeps run 8 s after
  start-up, 8 s after the trip id changes (`bootstrap.keepPhotosTidy`, one timer) and on that interval; tests call
  `window.__ROADMAP__.photos.collectGarbage({ now })` (two sweeps a week apart) instead of waiting.
- **Drops**: `DropOverlay` no longer shows "Drop to open trip" for a drag that carries only images (the types are known during the drag), and an
  image dropped anywhere else gets a hint toast ("To add photos, open a place in the list and drop them on its Photos area.") instead of
  "Could not open photo.png" (that F5 e2e test was updated); a drop that a photo area has taken (`defaultPrevented`) is ignored by the window.
- **Changed elsewhere**: `PlacesLayer` (click → `openPlaceCard`, Enter on a marker, `is-carded`, the card closes on `dragstart`), `PlaceRow`
  (indicator and `PlacePhotos`), `places.css`, `MapOverlays` (mounts `PlaceCardHost` and `PhotoViewerHost`), `exportTrip.ts` (async save, share
  toast), `importTrip.ts` / `startup.ts` (`storePhotosOf`), `bootstrap.ts` (GC, debug hook), `shortcutList.ts`, `HelpDialog.tsx`, README.
  `e2e/notes.spec.ts` ("show in the marker label while it is hovered or selected") now expects the card to carry the note after a click.
- **Tests**: Vitest — `lib/photos.test.ts` (resize maths and its boundaries, reference cleaning, limits and slots, batch planning, problem texts,
  garbage selection, base64/chunking, the assembled file parses back, share links carry nothing), `lib/tripFilePhotos.test.ts`
  (parse/validate/limits/warnings), `store/tripStorePhotos.test.ts` (patches, undo, the 300 cap), `features/photos/*.test.ts` (`addPhotos`
  with fake decoding and the memory store: one step, partial failure, quota, locks, queueing, progress; `photoActions`; `photoGc`;
  `photoFile`: embedding, unreadable/missing/damaged/oversized photos, true sizes, `added` and `discardPhotos`, storage failure; `photoUrls`:
  shared reference-counted object URLs; `planGarbage` and the marking sweeps in `lib/photos.test.ts` / `photoGc.test.ts`; `readJpegSize`),
  `features/io/importTripPhotos.test.ts` (the photos are stored before the trip is installed, and taken out again when it is not opened; a linked
  file's photos only when it is installed; the 150 MB limit for a picked file). The
  JPEG/EXIF pipeline needs a browser, so it is covered by Playwright
  (`e2e/photos.spec.ts`, `photoCard.spec.ts`, `photoFiles.spec.ts`; mocked services; images made on the fly by `e2e/mocks/images.ts`: PNGs in Node,
  JPEGs and the EXIF Orientation tag): add through the picker (one undo step, redo), a 3000×1500 JPEG → 2048×1024 and a sideways 40×20
  JPEG with EXIF 6 → 20×40, the progress line of a big batch, bad files, reorder/caption/remove/undo, the 50 cap, drops (on the area, elsewhere, a JSON on the area), the ride
  lock; the card (content, anchoring, following the map, every way to close it, no card from the list, "+N", missing bytes, none during a
  ride, Enter and focus), the viewer (counter, captions, buttons, ←/→, swipe, Esc, ✕, backdrop), presentation mode (the layers peel off one Escape
  at a time, nothing editable); Save as JSON embeds the photos and opening that file after wiping IndexedDB and localStorage restores them
  (card, viewer, reload); damaged/stray/missing photos in a file; a photo whose bytes cannot be read (a stubbed rejecting `arrayBuffer`: the file is
  still saved, with a warning); an embedded 4000×3000 photo shrunk on opening and a header declaring 30 000×30 000 refused; a share link without
  photos and its notice; GC (mark first, delete a week later, referenced-again, recent trips, undo history, the start-up sweep); the card on a
  phone staying clear of the trip pill and the map tools.
- **Known gaps**: photos cannot be reordered by dragging; the input of *Add photos* is capped by bytes (30 MB), not pixels, so a 100-megapixel PNG can still
  use a lot of memory while it is decoded (a photo embedded in a file *is* bounded by its pixels); files with photos are big (≈ 0.5 MB per photo, a third more as base64) and are read into memory
  when opened (a picked or dropped file may be up to 150 MB, `MAX_PICKED_TRIP_FILE_BYTES` — about 250 photos, what a phone can read into memory; a published
  `?src=` file is still limited to 20 MB, which fits only a few photos); photos nothing refers to stay in the browser for a week; the
  viewer cannot zoom into a photo; the card's thumbnails are cropped squares, not the photos' own proportions.

### F12 — the OpenStreetMap credit on exported images

The user asked for no "OpenStreetMap contributors" on the exported PNG "if possible". It is possible only in one way: the OSMF
[Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) (read in full when this was built) say
"Attribution must be to 'OpenStreetMap'" and that "© OpenStreetMap" is an accepted form; it "must be legible and understandable" and
"placed in the vicinity of the produced work". For static images: "the credit should typically appear in a corner of the map … Alternatively,
the attribution may be placed adjacent to the map", and where hyperlinking is impossible (a PNG) the rule for books and printed maps
applies: "the credit must appear beside the map … The URL to openstreetmap.org/copyright must be printed out." So the credit may leave
the picture only if it goes **beside** it **with that URL**; it can never simply be dropped. Do not remove it without re-reading those
rules (the tile usage policy requires visible attribution as well).

- **Choice** (`ExportOptions.credit: 'beside' | 'image'`, default `'beside'`, remembered with the other export options and repaired by
  `sanitizeOptions`, so a damaged value falls back to `'beside'`, never to "none"): `CreditMode` and every text live in
  `attribution.ts` (`CREDIT_CAPTION` = "Map © OpenStreetMap — openstreetmap.org/copyright", `IMAGE_CREDIT_TEXT` = "© OpenStreetMap ·
  openstreetmap.org/copyright"). `TripImageOptions.credit` is **required**, so a new caller of `renderTripImage` has to decide.
- **Beside the image** (default): nothing is drawn. The dialog's "Map credit" control sits with the other options; under the preview
  it shows "Caption to post with the image", the caption text (one click selects all) and a Copy button (hidden without
  `navigator.clipboard.writeText`; it says "Copied" for two seconds, no toast), with the reason ("OpenStreetMap's licence asks for
  this credit next to the image"). "Copy image" puts **the picture alone** on the clipboard (`deliver.copyPng`): a `text/plain` item
  beside it makes text fields and many chat and markdown apps paste the caption instead of the picture, so the caption has its own
  button. After a Download an info toast (12 s) reminds "Add the credit when you post the image: …" with a "Copy caption" action,
  which does what the Copy button does (and the button then says "Copied").
- **Small, in the image**: `paintCredit` draws the text in the corner `placeCredit` picks: 11 px × `u` Inter 500 in `#18212f` with a
  3.5 px white halo (85 %), no plate (the tiles are always the light OSM style, so it is the same in both app themes), flush with
  the bottom-right corner with 8 px side padding and a 22 px tall area. At 1× every preset has `u` ≥ 1.2, so the letters are ≥ 13 px
  on the canvas (`MIN_CREDIT_PX` = 12 is the floor the unit test holds every preset to); A4 and 2× scale it up with the picture.
  `placeCredit` tries bottom-right, top-right, bottom-left, top-left and takes the first that does not overlap the card or the legend
  (with the usual layout it is always bottom-right); it is also an obstacle for the name labels and, with `creditClearSides`, for the
  view fit (content that would run under it moves left / above it, like the card and legend; with the usual padding this does not
  cost any zoom). The preview draws the same.
- **PNG metadata**: `canvasToPng` writes a tEXt chunk `Copyright` = "Map © OpenStreetMap - openstreetmap.org/copyright" right after
  the header chunk of every PNG, in both modes (`pngText.ts`: CRC-32, `textChunk`, `addPngText`; Latin-1 only, as tEXt is, so the
  text has a hyphen where the caption has a dash). It travels with the file wherever it is posted; the visible credit is still what
  the guidelines require.
- **Live map**: unchanged (Leaflet's attribution control, "interactive map" rule).
- **Ride video export** (done in F13, below): follows the guidelines' video rule: the credit goes **on the video itself** (the map is the focus
  and there is no place beside it), i.e. it always uses the in-image credit, never "beside". It reuses `paintCredit` / `placeCredit`.
- **Shared-file edits**: `services/config.ts` loses `TILE_ATTRIBUTION_TEXT` (the exporter's plate text, now in `attribution.ts`);
  README and Help text; `components/*` and `types/trip.ts` untouched.
- **Tests**: Vitest: the texts (© OpenStreetMap and the URL in both), corner choice and collisions, the view fit keeping clear of the
  credit (`attribution.test.ts`), legibility of every preset at 1×, options default / repair (`options.test.ts`), the clipboard item
  holding the image only (`deliver.test.ts`), the chunk writer (CRC check value, chunk layout and CRC read back with Node's zlib, placement
  after IHDR, refusal of non-Latin-1 text and of non-PNG bytes: `pngText.test.ts`). `e2e/export-image.spec.ts` (mocked tiles): default download has not one drawn pixel in the credit
  corner and the caption is shown and copied; "Small, in the image" draws letters with a halo and no plate, also at 1080 × 1080 next
  to the legend; the preview follows the choice; the download reminder and its Copy action; Copy image puts `image/png` alone on the
  clipboard in both modes; the downloaded file has the tEXt chunk in both modes; the credit choice is in view in an 800 px tall
  window; the choice persists across reload; a damaged stored value falls back to the caption.
- **Known gaps**: the caption is not translated or customisable; the in-image credit is only ever in a corner.

### F14 — choose the vehicle (including a black Iveco Daily; renamed and made colourable in F16)

- **Contract** (additive, optional, no version bump): `Trip.vehicle?: TripVehicle` = `{ kind: VehicleKind; color?: string }`,
  `VehicleKind = 'campervan' | 'iveco-daily' | 'retro-bus' | 'motorhome' | 'caravan' | 'offroad'` (types/trip.ts). Missing = the
  campervan of F6, so every older file and link is unchanged. `src/lib/vehicles.ts` (pure, tested) is the registry — `VEHICLES`
  (label, default colour; F14 also had a `colorable` flag, which F16 removed), `VEHICLE_KINDS` (picker order), `COLOR_PRESETS`, colour maths (`parseColor`,
  `normalizeColor` → lower-case `#rrggbb`, `mixColors`, `lighten`, `darken`, `luminance`), `resolveVehicle` (whatever state a
  vehicle is in → `{ kind, color }`), `canonicalVehicle`, `sameVehicle` and `parseVehicle`. `parseTripFile` runs `parseVehicle`: an unknown
  kind → the campervan, a bad colour → the vehicle's own colour, a non-object → none, each with a warning (so the open toast says it); the
  stored form is canonical, so equal vehicles have equal fingerprints. Every vehicle is colourable (in F14 the Iveco Daily was not; F16 changed
  that, and its black is now just its own colour). `tripStore.setVehicle(kind, color?)` is one `edit` (one undo step; a choice that changes nothing records nothing;
  an unknown kind or a bad colour is ignored). **The last choice is remembered** (`store/vehiclePreference.ts`, `localStorage["roadmap-overview:vehicle"]`, the canonical vehicle as JSON,
  absent for the default campervan): only a choice made in the picker writes it (not undo, not opening a trip). It is the vehicle of a **new** trip:
  `newTrip()` (File → New trip), the empty trip of a first visit or a corrupt autosave (`bootstrap`, with history paused: no undo step) and the sample
  trip when it has none of its own (`openTripText(…, { withPreferredVehicle })`). A restored autosave, an opened file or a link keeps its own vehicle.
  Starting a new trip is one undo step that brings the old trip, and its vehicle, back.
- **Artwork** (`features/ride/vehicles.ts`, framework-free: no React, no Leaflet). Every picture is a list of shapes in a 64 × 40 box (F16: 40 high, and as wide as it needs — the Campervan's is 78 — `pictureBox`)
  (`VEHICLE_BOX`, anchor `VEHICLE_ANCHOR` = the middle of the wheels, ground at y ≈ 36.7; the anchor's x is the middle of the picture's own box): SVG path data with fill / stroke / opacity, plus
  *wheels* (a group that turns about its centre). One description feeds two renderers, so SVG and canvas cannot drift:
  `vehicleSvg(vehicle, facing = 'east')` and `transportSvg(mode, vehicle, facing)` return an SVG string (56 × 35 px; `facing: 'west'` wraps it
  in `scale(-1 1)`; wheels carry `class="ride-wheel"` for the CSS spin), and **`drawVehicle(ctx, vehicle, x, y, facing, width = 56, { wheelAngle,
  halo })`** / `drawTransport(ctx, mode, vehicle, …)` paint the same shapes on a `CanvasRenderingContext2D` or `OffscreenCanvasRenderingContext2D`
  with `Path2D` (`(x, y)` is where the wheels touch the line, `width` the width of the standard 64-unit box, so one unit is `width / 64` whatever the picture; the context's transform and styles are
  restored; `halo` draws the soft white glow the map version has, which a black van needs on dark ground (omitted, it is automatic for dark bodies since F16); shapes and `Path2D`s are cached, so a
  frame costs one fill/stroke per shape; the cache is a 24-entry LRU, so the colours tried in a picker drag do not pile up). A shape's own opacity
  multiplies the context's `globalAlpha` at the start of the call, so a caller can fade the whole vehicle; the alpha is given back. `transportSvg` / `drawTransport` choose by the stretch's mode: the trip's vehicle on `drive`,
  the ferry, train or plane (now in the same shape model) otherwise. Body colours go through `toneOf` (roof/panel tone) and `accentFor`
  (stripe: orange/blue/white that does not vanish on the body). The campervan with no colour chosen draws exactly as in F6. The six vehicles:
  campervan (shown as "Car" since F16); **Iveco Daily** (shown as "Campervan" and redrawn longer and colourable in F16, see there; the F14 look was) a long-wheelbase high-roof panel van, short steep bonnet, large upright windscreen, sliding door,
  dark glass, big mirror, grey wheels in dark arches, pale roof edge and crease lines so the black body keeps its shape — retro camper bus
  (two-tone, split windows, round lamp), coachbuilt motorhome (over-cab Luton), car with caravan, 4×4 with roof tent and spare wheel. No badges.
- **Ride**: `rideScene.showLook(mode)` draws `transportSvg(mode, trip.vehicle)` and sets `data-vehicle` (the *mode*, as before: `drive`, `ferry`,
  …), **`data-vehicle-kind`** (the trip's kind on a road stretch, else `ferry` / `train` / `flight`) and `data-vehicle-color` on
  `[data-testid=ride-vehicle]`; it re-runs when `trip.vehicle` changes (a replaced trip while a ride runs). Size, anchor, mirroring,
  bobbing and the day tag are unchanged.
- **Picker** (`ride/VehiclePicker.tsx`, `vehicle.css`): `RideButton` now renders a `.ride-split` (Ride + the chevron `vehicle-button`, 26 px
  wide, joined; its name is "Choose vehicle (currently <label>)", and the Ride tooltip says "Ride the route day by day. Vehicle: <label>"). The chevron opens a popover portalled to `<body>` (below the button, right edges aligned, clamped into the window): a 2 × 3
  grid of cards (`role="radio"`, a picture on a patch of light map, the name) and, for colourable vehicles, nine preset swatches plus a custom
  colour (native `<input type=color>`, committed on its `change` event so a drag is **one** undo step). Switching vehicle starts in the new vehicle's own colour; the checked card shows the colour in use (or being tried).
  Keys: arrows move the focus (they do not choose, as in `SegmentedControl`), Enter/Space choose, Escape closes and returns the focus,
  Tab out of the panel closes it; a click outside, scrolling or resizing closes it too. **Locked** while a ride runs or in presentation mode
  (`aria-disabled` + `aria-describedby` + tooltip: "Close the ride (Esc) to change the vehicle." / "Leave presentation mode (Esc) to change the
  vehicle."); a lock that begins while it is open closes it (store subscriptions, not an effect). Testids: `vehicle-button`
  (`data-vehicle-kind`), `vehicle-panel`, `vehicle-option` (`data-kind`, `aria-checked`), `vehicle-color` (`data-color`),
  `vehicle-color-custom` (F14 also had `vehicle-colors-note`, removed in F16).
- **Docs**: Help ("Show it") and README (Ride section, the file format) mention the picker and the `vehicle` field.
- **Tests**: Vitest — `lib/vehicles.test.ts` (registry, colours, resolve/canonical/parse), `tripFile.test.ts` (`vehicle`: round trip, unknown kind,
  bad colour, junk), `tripStore.test.ts` (`setVehicle`: undo, canonical form, no-ops, replace/new trip, a new trip with the remembered vehicle), `store/vehiclePreference.test.ts` (remember, forget, repair, blocked storage), `ride/vehicles.test.ts` (every kind
  as a well-formed SVG, colours, facing, the canvas API against a recording context with a stubbed `Path2D`: balanced
  save/restore, mirroring, wheel angle, halo, caller's opacity multiplied in and restored, styles restored, `Path2D` reuse, bounded cache). Playwright (`e2e/vehicle.spec.ts`, mocked): the picker beside Ride,
  choosing the Campervan (then the Daily) → trip + ride (`data-vehicle-kind`), every vehicle rides, one undo step / undo / redo, survives a reload, in the saved file,
  travels in a share link and opens from it, a damaged link repairs with a warning, New trip / first visit / sample with the remembered vehicle (and files, links, saved trips keeping theirs), colours (swatch, back to the own colour, per-vehicle
  default, custom), keyboard, Tab, outside click, both themes and a phone, the lock during a ride and in presentation mode (and a lock
  beginning while open), ferries keep the ferry, west facing, same size for all vehicles.
- **Known gaps**: the vehicle pictures are drawn by hand and recognisable rather than exact (the Campervan is a generic long, high-roof
  van with its proportions, not a licensed likeness); the picker's previews are not animated; a vehicle other than the campervan is not shown in
  the README screenshots (F17 redid them with the black Campervan); the remembered vehicle is per browser (not synced between devices), and re-clicking the checked vehicle also remembers it; the image export does not draw the vehicle (the video export, F13, does: it calls `drawTransport`).

### F15 — deployment to GitHub Pages

- **Workflow** `.github/workflows/deploy-pages.yml` ("Deploy to GitHub Pages"): `on: push` and `workflow_dispatch`; the `build` job is
  gated with `github.ref_name == github.event.repository.default_branch` (no branch name is hard-coded: a push to any other branch, or a
  manual run from one, skips both jobs). Permissions `contents: read`, `pages: write`, `id-token: write`. **build**: checkout, Node 22 with
  the npm cache, `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` (Vitest only), `npm run build` with
  `BASE_PATH=/${{ github.event.repository.name }}/` (so a fork publishes under its own name; F17 put `actions/configure-pages` before it and passes its
  `base_url` as `VITE_SITE_URL`), a one-line `grep` that `dist/index.html`
  references `/<repo>/assets/` (fails the job if the base ever stops being applied; F17 added one that `og:image` is an absolute URL), then `actions/upload-pages-artifact` with `dist`.
  **deploy**: `needs: build`, `actions/deploy-pages` in the `github-pages` environment, `url` from the step's `page_url` output; the
  concurrency group `pages` (`cancel-in-progress: false`: a running deployment is never cancelled half-way, a newer one waits) is on
  *this job*, not the workflow, so a run whose build is skipped (a push to another branch) can never replace a queued default-branch deployment.
  Actions used: `actions/checkout@v5`, `actions/setup-node@v5`, `actions/upload-pages-artifact@v4`, `actions/deploy-pages@v4` (F17: `actions/configure-pages@v5`). They could
  not be checked against github.com from the build machine; they are versions known to exist, so the first run is the real check
  (bumping a major later is a one-line change each).
- **What the user must do once** (the workflow cannot): make the repository public (or use a plan with Pages for private repos) and set
  Settings → Pages → Source to "GitHub Actions". Documented in the README's "Deployment" section, which replaces the example
  `pages.yml` that F8's Hosting section carried (it used `branches: [main]`, which is not this repository's default branch).
- **No app code changed.** The sub-path support is F8's (`BASE_PATH`, `assetUrl`, `e2e/subpath.spec.ts`); F15 re-verified the built site
  with `BASE_PATH=/roadmap-overview/ npm run build` + `vite preview` (sample trip, flags, share and presentation links, `?src=`, reload,
  both themes): every request stays under `/roadmap-overview/`, favicon, flags, fonts, scripts and the sample are found, no console
  errors. The workflow runs exactly the commands a developer runs locally; nothing in it is CI-specific.
- **Known gaps**: the site is only as good as the default branch (there are no preview deployments for other branches); `npm run e2e` is
  not part of the pipeline; a user-page repository (`<user>.github.io`) would need `BASE_PATH=/` in the workflow; the main JS chunk
  (about 640 kB) and the lazy country-boundary chunk (about 770 kB) trigger Vite's size warning, which is expected and harmless.

### F13 — a video of the ride

The export dialog gained a **Video** tab; it renders the ride as an MP4 (or WebM), in the browser, faster than real time.

- **Dialog** (`export-image/ExportDialog.tsx`, `exportTab.ts`): now a shell with real tabs (`role=tablist`, arrows/Home/End, `Image` | `Video`) around
  `ImagePanel` (the F7 dialog's body, moved unchanged apart from its buttons) and `VideoPanel`. The dialog's footer is a **slot**: the shown tab portals its own
  buttons into it (`createPortal(…, footer)`), so Image has Copy/Download and Video has Render / Cancel / Render again · Share · Download. `useExportTab`
  = `{ tab, busy, returnFocusTo }`; `openExportDialog(tab, opener?)` opens it (the top bar's button → Image; **the ride HUD's "Record video"** → Video, it pauses the
  ride first and gives the focus back to its own button when the dialog closes). While a render or an image download runs the other tab is `aria-disabled`
  (switching would unmount and stop it). `VideoPanel` is a lazy chunk (36 kB, 14 kB gzipped; the main bundle grew by 5 kB); `mediabunny` is a second one (161 kB,
  43 kB gzipped) loaded when a render starts. The dialog title is "Export image or video" (the old name is still a substring). `PresetPicker` takes its
  presets, label and test-id prefix.
- **Options** (`options.ts`, `videoStore.ts`, `localStorage["roadmap-overview:video-options"]`, repaired field by field like the image's): size `landscape` 1920×1080 ·
  `square` 1080×1080 · `vertical` 1080×1920 · `hd` ("Quick") 1280×720; length `15` | `30` | `60` | `ride`; camera `whole` | `follow`; title card, place names, legend;
  card style (Match app / Light / Dark: the card, legend and day panel). Defaults: landscape, 30 s, whole trip. File name `<slug of the title>-ride.mp4|webm` (`trip` when there is no title).
- **One clock** (`ride/rideStore.ts` `timelineFor(places, legs, startDate)`, which the ride's own `currentTimeline` now calls too): the video plays **the ride's
  timeline** (`buildTimeline` / `sampleTimeline`), so days, travel and rest slots (and their caps), leg shares, ferry stretches inside drive legs, the vehicle
  that switches to ferry/train/plane, the date and the caption (`rideCaption`, `formatRideDate`) are the live ride's, not a copy. `schedule.ts` only maps video seconds
  onto it: **30 fps**, an intro hold of 1 s on the start (rideTime 0), the ride at a steady pace, an end hold of 3 s on the finished trip. A fixed length is the
  whole video (the ride is what is left after the 4 s of holds); *Ride pace* is `timeline.duration` (at 1× speed) clamped to 4 s … 116 s; **no video is longer than
  `MAX_VIDEO_S` = 120 s** (the dialog says when that sped it up, and when a fixed length makes it hurried: ≥ 2.5 days a second).
- **Scene** (`scene.ts`, `prepareVideoScene` → `VideoScene { draw(ctx, i), info(i), … }`; prepared once, reused by the preview, the render and the debug hook):
  lays out like the image (`unwrapTrip`, `buildCardContent`/`layoutCard`, `layoutLegend`, `placeCredit`, `fitViewport` with the card, legend, **day panel** (bottom-centre) and credit
  as obstacles, `ensureFonts`), fetches the tiles of **one background picture** through the shared `tileClient` (≤ 6 at a time, ≤ 300 tiles, `retryFailed` for a real render) and paints
  it once with `paintTiles`. Every frame is then a crop of that picture under the frame's camera plus **vector** overlays: the planned route faint (`.ride-dimmed`'s 0.38) — as
  `Path2D`s built once in the background's pixels, stroked under the camera's transform with widths divided by its scale, so lines stay crisp — the trail (done legs merged
  per style into one path and grown one leg at a time like `rideScene`, the current leg clipped with `clipPath`, `planLegParts(…, selected = true)`, the ride's heavier style), the
  ferry/train/plane badges, the green stop rings (grow in over 0.28 s, the parked one pulses), numbered markers, name labels, the vehicle
  (`drawTransport` with the trip's vehicle: facing with `nextFacing`'s hysteresis, wheel angle and bob from the video clock, parked beside its stop, a "Day N" tag, all worked out per frame
  up front so any frame can be drawn on its own), then the card, legend, **day panel** (`hud.ts`: "Day N", the date, the distance so far, the leg with its mode icon, a progress bar; fixed size,
  texts cut with `ellipsize`) and the credit. With a still camera the map and the faint route are painted once into a canvas that every frame copies. A frame costs a few ms at 720p.
- **Camera** (`camera.ts`, pure): *Whole trip* is the image's fit, never moving. *Follow*: the background is a bigger picture at the **follow zoom** — the median over the travel days of the
  zoom that fits a day's legs (as the live ride, `pickFollowZoom`; at least one level closer than the whole trip, ≤ 13) — covering the route with half a frame to spare plus the whole-trip view,
  lowered by quarter levels until it fits **16 Mpixel and 300 tiles** (`planFollowBackground`; the least it accepts is the whole zoom + 0.25). Otherwise the trip is shown whole and the dialog says why, in one of two ways: **a trip so small that its whole view
  is already as close as the camera zooms** (`pickFollowZoom` → null when the whole zoom + 0.25 is beyond 13: two places a metre apart) gets "nothing to follow"; a map that fits neither the pixel nor the tile cap gets the
  cap as the reason. The cap is rarely the reason: measured, Lyon → Annecy → Zurich, Paris → Lyon, Lyon → Annecy and Lisbon – Paris – Moscow all follow at every size, with 120 – 270 tiles. The camera path per frame (`planFollowCamera`): the whole trip during the holds, easing (smoothstep, ≤ 1.6 s) in to
  and out of the **vehicle's track smoothed in both directions in time** (`smoothTrack`: a zero-phase first-order filter, τ 0.55 s, so there is no lag; the vehicle may drift ≤ 20 % × 18 % of the
  frame from where it should sit, so a flight's jump keeps it in view; it sits in the middle of what the day panel leaves free). While the camera is close the title card fades out
  (`cardAlpha`: it would cover the road) and returns on the end hold; names are placed twice (whole-trip clear of the overlays, and at the closer zoom) and cross-fade
  through nothing while the camera zooms (`labelBlend`). Zoom changes crop the background at a lower scale, so the background's zoom is the sharpest it ever is.
- **The OpenStreetMap credit**, and why it is in the picture. The OSMF Attribution Guideline for *TV, film, or video productions* says: "For fictional productions or where the map is
  not the focus of the production, attribution may be given on the map, in end credits, or, if the video is distributed via a digital format that includes a description, within the
  description. When attributing via the end credits or the description, the URL to openstreetmap.org/copyright must be included." and, "For productions where an OpenStreetMap map is a
  major component of what is shown to users, the attribution should typically appear in a corner of the map, in addition to attribution in the end credits or description. As long as the
  credit is on screen long enough to be read, it does not have to remain in view during panning or zooming." The map **is** the focus here, so the credit is **on the video**, always (there is
  no "beside" for a video and no switch): "© OpenStreetMap · openstreetmap.org/copyright" (`IMAGE_CREDIT_TEXT`, drawn by the image's `placeCredit`/`paintCredit`, text with a halo, no plate)
  in a corner for the first **5 s** at full strength (the interactive-map rule's time), fading over 0.6 s, and again from 0.3 s before the **end hold** to the last frame (≥ 2.7 s at full
  strength: the end credits); `creditAlpha` in `schedule.ts`. Its letters are 2.2 % of the shorter side (about 24 px of 1080, never below 16 px, which is 720p: a video is watched
  much smaller than it is made — on a phone a 1080 px picture is scaled to about a third — so the image export's 11 px would be a smear, `credit.ts`), in the first corner (bottom-right, top-right, bottom-left, top-left) that does not meet the card, legend or day panel — usually bottom-right, top-right in the
  square and vertical sizes. For "in addition to … the description" the tab shows the caption *Map © OpenStreetMap — openstreetmap.org/copyright* with a Copy button ("add it to the
  description when you post it"), **Share** passes it as the share's text, and the file's metadata carries a `comment` with it (and the trip's title) — the user still has to post it, as with the
  image's caption.
- **Encoding** (`encoding.ts`, `frameSink.ts`, `renderRideVideo.ts`). `detectEncoding(size, fps)` asks `VideoEncoder.isConfigSupported` about `avc1.640028` → `avc1.4d0028` → `avc1.420028` (MP4) →
  `vp09.00.40.08` → `vp8` (WebM) at the video's size; `chooseEncoding` (pure) takes the first supported, else `MediaRecorder` (`video/mp4;codecs=avc1…`, `video/webm;codecs=vp9`, …, on
  `canvas.captureStream`), else says the browser cannot (Render disabled, with a note). Bit rate (`videoBitrate`, 2.5 … 14 Mbit/s): 0.12 bit per pixel and frame for a still map (1080p30: 7.5 Mbit/s, 720p30: 3.3), 0.18 for a following camera (11.2 and 5.0), which slides the whole picture under thin dashed lines
  at every frame and, at 2.8 Mbit/s in 720p, smeared the route in the zoom ramps; it is worked out from the camera the scene really has. **WebCodecs path**: every frame is drawn on one canvas,
  becomes a `VideoFrame` (timestamp `i/30` s; a key frame every 60), is encoded and closed at once — nothing is kept but the compressed packets, which go into **mediabunny**'s
  `Output` (`Mp4OutputFormat({ fastStart: 'in-memory' })` or `WebMOutputFormat`, `BufferTarget`, an `EncodedVideoPacketSource` per codec) one at a time in order; the encoder is not fed while
  4 frames wait in it (`encodeQueueSize`, `dequeue`), which with the main thread being handed back **after every frame** (a `MessageChannel` message: a task of its own that queues fairly with timers and input, and is not slowed to once a second in a
  background tab as `setTimeout` is; `scheduler.yield()` was tried first and resumes ahead of other tasks, which starved the timers) keeps the page responsive: measured on a 30 s 1080p following render of eight stops, a 50 ms timer ran every 54 ms
  (median; 118 ms when yielding only after 12 ms of drawing, as every frame takes more), and the page had 24 tasks over 50 ms (the longest 138 ms) instead of 43 (243 ms). **Recorder path**: the canvas is captured with `captureStream(0)` + `requestFrame()` and the loop is paced by the wall clock (`pace(i)`), skipping frames when drawing falls behind: the
  video has its length, in real time, in whatever quality the browser picks (a Chromium WebM has no duration/cues). Abort (`AbortSignal`, from Cancel or the dialog closing) is checked every frame: the
  encoder is closed and `Output.cancel()`ed, nothing is kept, an AbortError reaches the dialog ("Cancelled: nothing was kept."). The MP4 is made `fastStart` (playable while loading, shareable). **The output is full-range**: `ffprobe` says `pix_fmt=yuvj420p`, `color_range=pc`, BT.709 matrix, sRGB transfer, as the canvas hands it to the encoder
  (nothing converts it to limited range); players that assume limited range for H.264 may show it a little flat or contrasty.
  **Why mediabunny** (MPL-2.0; new runtime dependency `mediabunny` ^1.66): it is the maintained successor of `mp4-muxer` and `webm-muxer` (MIT, both marked deprecated in its favour by the same author), one API for both containers
  with metadata tags, tree-shakable (the build keeps 43 kB gzipped of 11 MB of package), pure TypeScript with no native or WASM code. MPL-2.0 is file-level copyleft: using the unmodified package as
  a dependency adds nothing to this app's own terms. It sits in its own lazy chunk.
- **The Video tab** (`VideoPanel.tsx`, `useVideoPreview.ts`): the preview is a frame of the real video — `prepareVideoScene` at ≤ 960 px (`previewScaleFor`, coarser tiles, so few of them), debounced like the
  image's — with a **slider** to look at any moment of it (default 40 %; "Day 6 · Preikestolen → Odda", "0:12 / 0:30"), the summary line "1920 × 1080 px · 0:30 · MP4 (H.264)" (the length from the timeline at once), the credit
  box, and notes (a leg still routing disables Render with the ride's own reason; failed legs; capped or hurried length; the follow note; missing tiles; names that did not fit; recorder in real
  time). **Render video** shows a progress bar over three steps (map tiles 10 %, frames, closing the file; `progress.ts`), the step in words and **the time left** from the frames done so far
  (`estimateRemainingS`, "About 25 seconds left"), "Keep this tab open", and **Cancel**. When it is done the finished video replaces the preview in a `<video controls>` (it stays until a choice changes or the next render starts — it is matched by a key of the choices and the trip's content, `tripFingerprint`, not by the objects the parameters are made of, which are new whenever a route
  arrives late or the statistics are worked out again — and then the preview comes back and the file and its object URL are let go of), with "Video ready: 1280 × 720 px, 0:34, 2.1 MB (MP4)"; **Download video** and, where `navigator.canShare({ files })` says yes, **Share** (`navigator.share` with the `File` and the caption as text) and Render again.
- **Debug hook** `window.__ROADMAP__.video` (dev builds; `debugTypes.ts` has the typing, `debug.ts` the code): `frame(at, options?, scale?)` → a PNG data URL and the frame's `info`, drawn by
  the same scene/draw code as the render, `render(options?, encoding?, size?)` → a whole video, at the preset's size or a small `size` (the file as base64, its signature, its length), `encoding(size?)`.
- **Measured** (headless Chromium on a shared 4-CPU box, mocked tiles): a 34 s, 1280 × 720, 1 017-frame MP4 of the sample trip (whole trip) renders in about 11 s (3× real time) and is 2.1 MB (3.7 MB over real
  tiles; `ffprobe`: H.264 High, 30 fps, 1017 frames, 33.9 s); the follow background of the sample trip at 1080p is 182 tiles; a real-tile render at 720p of the sample asked for 20 tiles in the preview and 7 more in the render (the rest were kept).
- **Shared-file edits** (all additive): `ride/rideStore.ts` (`timelineFor`), `ride/RideHud.tsx` (the Record video button), `export-image/legDrawing.ts` (`planLegParts`, `LegLine`; `planLegs` uses it), `export-image/paint.ts`
  (`paintBox` exported), `export-image/PresetPicker.tsx` (generic), `export-image/ExportImageButton.tsx`, `export.css`, `package.json` (`mediabunny`), the Help dialog, and the README (a "Video export" section and `docs/screenshots/video-export.png`: real tiles, 1280 × 960 CSS px at 2×, the dialog's 720 px height cap lifted for the picture so all of the tab shows, resized to 1600 px and reduced to 256 colours like the others). `types/trip.ts` unchanged.
- **Tests**: Vitest — `schedule.test.ts` (lengths, the cap, frame → ride time, holds, **credit timing**: full for 5 s, fades, gone mid-ride, back for ≥ 2.5 s on the end hold, never missing in the shortest video),
  `camera.test.ts` (zero-phase smoothing: no lag on a steady drive, symmetric glide on a jump, no overshoot; follow weight and ramps; the camera during holds and while following, kept near the focus, smooth, vehicle kept in view on a jump;
  card/label fades; follow zoom; the background within the pixel and tile caps and around the whole view), `encoding.test.ts` (codec/muxer choice and fall-backs, recorder fall-back, nothing available, bit rate), `progress.test.ts`, `hud.test.ts`, `credit.test.ts` (legible in every preset),
  `options.test.ts`; `planLegParts` and `timelineFor` in the existing suites. Playwright `e2e/export-video.spec.ts` (mocked tiles): the tabs (mouse, keyboard), the HUD button (Video tab, ride paused, focus back), the choices and their persistence
  (and damaged ones), disabled states (one place, legs routing, no encoder), the preview slider and the credit in it (start, end, none mid-ride), the card in whole and follow, **a frame saved as a PNG through the same code as the render** (start/middle/end: size, credit corner,
  trail growing, stops turning green; attached to the test), a following camera within 300 tiles and 6 in flight and no new tile requests for more frames, a ferry stretch, **a real render** (MP4 `ftyp`, 1280 × 720 and 8.0 s read from the `moov`, plausible size, the file name from the title, progress that only
  grows, the time left, the other tab locked meanwhile), the finished video in the preview and its going away with a choice, **Cancel** (nothing downloaded, the next render works), closing the dialog mid-render (no more tile requests), a **WebM (VP9)** when H.264 is refused, the
  **MediaRecorder** fallback (WebM, real time), share (a stubbed `navigator.share` gets the file, its name and the credit), a **following render end to end**, the finished video **surviving** a new route-store object behind it, **the two-minute cap in a real render** (60 train legs, 3 600 frames at 320 × 180, `moov` says 120 s), the follow note for a trip too small to zoom into, and **the credit really in the encoded video** (a WebM played back in the page and its pixels read at 0.5 s, 2 s, 8 s, 13.5 s and 14.8 s).
- **Known gaps**: the preview is a frame of the scene at preview scale, not the encoded video; no audio and no choice of frame rate; the video is held in memory until it is downloaded (up to ~170 MB for two minutes of 1080p following, and twice that for a moment while the file is finished);
  the recorder fall-back needs the tab in front for the whole length and its WebM is not seekable in Chromium; a trip too small to zoom into, or whose follow map fits no cap, is shown whole; names are not avoided by the vehicle;
  a trip that crosses the date line is drawn as one continuous map (as the image) but not by the live ride;
  Firefox without an H.264 encoder makes a WebM; the credit's text is fixed (not translated).

### F16 — vehicle picker: "Car" and "Campervan", a colourable long van

- **Names, not ids.** `VEHICLES.campervan.label` is now **"Car"** (the original small van, still the default) and
  `VEHICLES['iveco-daily'].label` is **"Campervan"**. The kind ids are stored in trips, share links, autosaves, recent trips and the
  remembered-vehicle preference, so they are untouched (swapping them would have swapped the vehicle in every existing trip); a comment at
  `VEHICLES` says why id and label differ. Everything that shows a name reads the registry (picker cards, the trigger's accessible name and
  tooltip, the Ride tooltip), so no user-visible text says "Iveco Daily" any more; the repair warnings of `parseVehicle` say, in explicit
  words, "…the car is used." (the default vehicle is the Car). Order, default and storage are unchanged. Help and README say Car / Campervan.
- **Colour for the Campervan.** The `colorable` flag is gone: every vehicle takes the presets and a custom colour. The Campervan's own
  colour is black (`#15181d`, the Black preset), so it is stored as nothing, like every vehicle's own colour (`canonicalVehicle`);
  `parseTripFile` accepts a colour on `iveco-daily` (and keeps dropping an invalid one with a warning). Old trips with
  `{ kind: 'iveco-daily' }` and no colour draw black, as before. The picker lost its "fixed colour" note (and `.vehicle-colors__note`,
  `vehicle-colors-note`). Switching to the Campervan starts in black, as every vehicle starts in its own colour.
- **Redrawn as a long (L4-style) van** (`longVan` in `features/ride/vehicles.ts`). An L4 high-roof van is long on both counts, so it no
  longer fits the shared 64-unit box: **a picture may have its own width** (`WIDE_BOX`: the Campervan 78 units, everything else and the
  ferry/train/plane 64; `pictureBox(mode, vehicle)` says which), always 40 units high and drawn at the **same scale per unit** (56 / 64 px).
  So `width` of `drawVehicle` / `drawTransport` still means "the standard box's width" and the ride, the picker and F13's export call
  them as before: the long van just comes out wider (68 px at the ride's 56). The anchor is the middle of the picture's own box at the
  wheels' height (the body is centred in its box, so mirroring and the marker stay put). In the SVG the wide box is `viewBox 0 0 78 40`,
  `width` 68.25, `style="--units:78"`; **CSS uses `--units`**: `.ride-art` gets a negative left margin so the 56 px marker's centre (its
  anchor and the centre of the flip) is the van's middle, and the picker card sizes the svg at 1.75 px per unit (136 px, within the card).
  The marker (`VAN_SIZE`, the Day tag, parking offset) is unchanged. Proportions: wheelbase 42 units (the old van's 36), the body runs about
  0.3 of the wheelbase past the rear tyre (the old 0.14) and is ≈ 2.5 × as long as it is high. The cab is the old van's moved forward
  (`shiftX`, `VAN_STRETCH`); the cargo box gained two tinted side windows and a pale roof vent so it reads as a camper conversion.
  **Only the body takes the colour**; glass, tyres and rims, lamps, bumpers, the plastic skirt and the vent keep their own colours. The
  highlight and crease lines follow the body's brightness (pale lines on dark bodies, dark ones on light), so black, white and every preset
  keep their shape at 56 px, at 2×, facing either way, on light and dark tiles. The ride's marker now starts with the trip's own vehicle
  kind and colour (`data-vehicle-kind` / `-color`) instead of a hard-coded `campervan`.
- **Canvas halo is automatic for dark bodies.** `drawVehicle` / `drawTransport` keep their signatures; `DrawOptions.halo` now means: `true`
  / `false` force it, **omitted = automatic**, i.e. the soft white halo when the road vehicle's body is dark (`isDarkBody` in
  `lib/vehicles.ts`: perceived brightness below 0.3, which among the presets is only Black) and none otherwise, and none for the
  ferry, train and plane. The map's ride already had the CSS halo; this is for image and video export on dark ground. A caller that
  never passed `halo` and draws a dark vehicle now gets a glow behind it; others are unchanged.
- **Tests.** Vitest: labels and ids, default black and its being a preset, every preset/any colour on the Campervan, canonical storage
  (black = nothing, other colours `#rrggbb`, a black Car is kept), `resolveVehicle` / `sameVehicle` / `vehicleLabel`, `parseVehicle` and
  `parseTripFile` with a colour on `iveco-daily`, the warnings naming "the car", `tripStore.setVehicle` (colour = one undo step, own
  black = no change), `isDarkBody`, the artwork (body-only colour by swapping the colour text, glass/wheels/lamps constant, wheelbase ≥ 40,
  tail ≥ 0.25 of the wheelbase and longer than the nose, length ≈ 2.4–2.6 × height, body centred in its box and inside it, wheels on the
  car's ground line, one scale per unit for every vehicle, `pictureBox`, the canvas translate by half the box), and the automatic halo
  (dark on, light off, ferry/train/plane off, `true`/`false` obeyed). `e2e/vehicle.spec.ts`: the picker shows Car and Campervan (and no
  "Iveco"), the trigger and Ride tooltips use them, the Campervan has the nine presets plus custom with black checked, colouring it changes the trip (one undo step)
  and the ride's `data-vehicle-color` and fills (glass unchanged), black takes the colour back, and a reload, the saved file and a share
  link keep it, an old `{ kind: 'iveco-daily' }` trip opens black, a custom colour works; the long van's card is 78/64 as wide as the
  others, inside its card, also on a phone; on the ride it is centred on the 56 × 35 marker at the standard scale, east and west; the
  marker starts with the trip's vehicle; and one test draws the real `drawVehicle` on a real dark `<canvas>` (imported from the dev
  server inside the page) and counts the halo pixels: black and navy glow by themselves, the white Car and a red van do not, `halo: true`
  / `false` force it, the long van is wider than the car and centred on the anchor in both directions.
- **Known gaps**: the Car's picture is unchanged (the original small orange-striped high-top); the long van is still a generic van, not a
  licensed likeness; the rear-quarter window and vent do not change with the colour or open; the README screenshots still showed the Car (F17 redid them with the Campervan).

### F17 — Vanagram: the new name and the logo

The temporary name "Roadmap Overview" became **Vanagram**, with the long-roof van logo the user chose. A rename of what people see, not of what is
stored: every historic id stays (the list is at the top of this file) so saved trips, links, photos and settings keep working.

- **The name.** Every user-visible occurrence changed: the top bar, `index.html` (title "Vanagram — your campervan trip on one map", description), the Help
  dialog's intro, the drop overlay's hint, the errors that name the app ("This is not a Vanagram trip file.", "This trip was saved by a newer version of
  Vanagram.", "This trip has 501 places; Vanagram opens at most 500."), `ui-kit.html`, the README (new header) and this file. Presentation mode and the
  empty states had no name in them. **Exported files carry no app name** (the PNG has a `Copyright` text chunk, the video a title and a comment: nothing
  says Software), so nothing was added there. Kept on purpose, each with a comment where it is defined: `TripFile.format` / `TRIP_FILE_FORMAT`
  `roadmap-overview/trip`, the `roadmap-overview:*` localStorage keys, the `roadmap-overview` IndexedDB database, `window.__ROADMAP__` (and `RoadmapDebug`),
  the `ro-*` pane names, the Vite plugin name `roadmap-flag-icons`, `package.json`'s name, and the repository / base path. `e2e/brand.spec.ts` opens a
  file in the historic format, restores an autosave from before the rename (the storage key), and writes back the historic format.
- **The logo in the top bar** (`layout/Logo.tsx`): an **`<img>` of `favicon.svg`** at 32 px (was inline SVG in `--accent`). The favicon holds two designs and
  switches with a media query *inside the SVG*, which only an image (or a tab) gives a viewport to; inline it would always show the big one. 32 px is also the
  size the 32-unit design is drawn on, so it is crisp at 1× and 2×. Measured in Chromium: at 24 px and below the SVG draws the pixel-grid 16 px design, from about
  24.5 px the detailed one. The brand name stays live text (Inter, weight 600 and the lockup's −0.012 em tracking to read as one with the mark); the phone rules
  are unchanged (name hidden below 1024 px, the whole brand below 500 px). The image is decorative (`alt=""`).
- **Files** (`public/`, made by the generator, see below): `favicon.svg` (replaced), `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png` (180, full square),
  `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `og-image.png` (1200 × 630), and `manifest.webmanifest` (name and short name Vanagram, `display:
  standalone`, `theme_color` `#1a73e8`, `background_color` `#eef1f5` = the light page background, icons 192 / 512 `any` and 512 `maskable`, **`start_url` and `scope`
  `./` and icon `src`s relative**: they resolve against the manifest, so they follow it under any sub-path). `index.html` links the two PNG icons, then the SVG with
  `sizes="any"` (last, so browsers that draw SVG icons take it), the apple-touch icon, the manifest, `apple-mobile-web-app-title`, and a `theme-color` per scheme
  (`#ffffff` / `#161d28`, the top bar's `--surface`; once the user has picked a theme in the app both metas take *that* theme's colour, see "The address-bar colour" below), plus Open Graph (`og:type`, `site_name`, `title`,
  `description`, `image` + type/size/alt) and Twitter (`summary_large_image`) tags. Vite rewrites every one of those paths under the base.
- **Absolute link-preview URLs.** Scrapers want an absolute `og:image`; only the deployment knows the host. `tools/sitePreview.ts` (pure, unit-tested) and the
  `sitePreview` plugin in `vite.config.ts` read **`VITE_SITE_URL`** (shell or `.env*`): with it, `og:image` and `twitter:image` become `<site>/og-image.png` and
  `og:url` is added; without it they stay the base-relative path (right locally). A value that is not an http(s) URL fails the build; a trailing slash is optional
  (`actions/configure-pages`' `base_url` has none). The plugin takes the base from `configResolved`, not from `BASE`: `vite build --base=…` overrides the config's
  (the sub-path e2e build does exactly that, and caught the first version stripping the wrong prefix). **Workflow**: `actions/configure-pages@v5` (id `pages`) runs
  after the typecheck / lint / unit-test gates and before the build, whose env gets `VITE_SITE_URL: ${{ steps.pages.outputs.base_url }}` next to `BASE_PATH`; so the
  address is GitHub Pages' own — the owner's custom domain, not `*.github.io`, while it redirects — and nothing is hard-coded. A second step only **warns** (`::warning::`, exit 0) when
  `og:image` is not `https?://…`: with no `base_url` the build falls back to relative paths, which costs link previews, not the site. The base-path grep, the gates and the default-branch-only `if` are unchanged. (Like the F15 actions, `configure-pages` and its
  `base_url` output could not be run against github.com from the build machine; the first push is the check.)
- **`docs/brand/`**: the SVG masters (`icon`, `icon-maskable`, `favicon`, the light and dark lockups), `preview-sheet.png`, a README (what each file is for, the colours
  `#1a73e8` / `#0d1219` / white / `#f9ab00` and the ink colours, how to regenerate, the licence note) and `src/`, the designer's generator: `build.cjs` (SVGs),
  `raster.cjs` (PNGs, Playwright), `compose.cjs` (og-image, preview sheet), `lib.cjs` (the artwork), `wordmark.py` + `wordmark-semibold.json` (Inter SemiBold outlines
  from HarfBuzz / fontTools; redistributed under the OFL, so `docs/brand/LICENSE-Inter.txt` carries Inter's copyright line and the licence text, and the lockups and the JSON point to it). Changes from the delivered folder: the scripts are **`.cjs`** (this repository is `"type": "module"`), they write the PNGs and the favicon straight
  into `public/` (no second copy to keep in step), and `wordmark.py` writes beside itself and takes `INTER_DIR`. Re-running all three reproduces the shipped files (the
  SVGs byte for byte, the PNGs pixel for pixel). `tools/brand.test.ts` guards that `public/favicon.svg` equals the master, every icon the page and manifest name exists
  at its declared size, and the favicon still holds both designs.
- **README**: a `<picture>` header (the lockup, dark source for `prefers-color-scheme: dark`, 72 px tall so the lockup's own `min-height: 64px` picks the big mark),
  the name throughout, a "Name, logo and link previews" section (how `VITE_SITE_URL` works and why), the deployment steps. **Screenshots** `hero-light`, `leg-editor`, `ride`,
  `presentation`, `dark` (1280 × 800 at 2×, resized to 1920 px) and `video-export` (1280 × 960 at 2×, 1600 px) were made again from the sample trip with real tiles (the F8
  disk cache of real OSM tiles: no tile was asked for again), the **Campervan chosen in the picker** (so the ride and the video frame show the black long van) and the
  same 256-colour `MAXCOVERAGE` squeeze as before; 219 – 450 kB each. `exported-image.jpg` is unchanged: it shows neither the top bar nor a vehicle.
- **Tests.** Vitest: `tools/sitePreview.test.ts` (no site URL, slash handling, query/fragment, invalid values refused, base stripping, domain-root and no-base builds),
  `tools/brand.test.ts` (above), `features/theme/theme.test.ts` (`THEME_COLOR` against `tokens.css` and index.html); the error-message tests say Vanagram. Playwright: `e2e/brand.spec.ts` (title and banner, no "Roadmap Overview" in the page or the Help dialog,
  live text in Inter, narrow-screen rules, the logo an `<img>` of `/favicon.svg` 32 px that loaded, **the SVG drawn at 16 / 32 px has the same pixels as `favicon-16/32.png`
  and the 32 design shrunk to 16 is not the 16 design**, every icon link served with its type and size, the manifest parsing with its icons served and one maskable, the
  Open Graph and Twitter tags and a served 1200 × 630 image, the theme colours (per OS scheme, following a theme picked in the app on a light and a dark OS, a stored choice applied by the page script alone), the name once in the banner's aria snapshot at every width where the logo shows, an old-format file, an old autosave and the sample opening), and `e2e/subpath.spec.ts`
  (now two builds, with and without a site URL: icon links, manifest, manifest icons and start page under the base, the logo under the base, absolute `og:image` / `og:url` /
  `twitter:image` and the file they name, the base-relative fallback). Also checked by hand with `BASE_PATH=/roadmap-overview/ npm run build` + `vite preview`: no request
  outside the base, no console errors, the top bar in both themes at 1× and 2× and at 390 / 520 / 768 / 1100 px, the favicon in tab-sized renders.
- **The address-bar colour follows the theme** (`features/theme/theme.ts`): `THEME_COLOR` (the two `--surface` values) and `syncThemeColor()`, called by `initTheme` and by
  `chooseTheme` after it has stored the choice. With a stored choice **every** `meta[name=theme-color]` gets that theme's colour (a dark app on a light OS, or the reverse); with none each
  keeps its own scheme's colour, i.e. what the OS says (the app has no "follow the system" action: a choice is permanent, so that is only the state before the first choice). index.html's
  inline script does the same at first paint, with the same two hex values (`theme.test.ts` checks them against `tokens.css` and index.html).
- **The name for screen readers.** The logo is an image with `alt=""`, so the name must be text wherever the logo shows: from 500 to 1023 px `.brand__name` is visually hidden
  (the `.sr-only` pattern, in `layout.css`) instead of `display: none`; below 500 px the whole `.brand` is still `display: none`. `e2e/brand.spec.ts` reads the banner's aria snapshot at
  1440, 1024, 1023, 800, 600 and 500 px (the name once) and at 499 px (not at all).
- **Licence of the lettering.** The lockups' letters are outlines of Inter SemiBold, so `docs/brand/LICENSE-Inter.txt` has Inter's copyright line and the full SIL OFL 1.1 text; the
  lockup SVGs (a comment) and `wordmark-semibold.json` (a `license` field) point to it. The unused `wordmark-bold.json` was removed and `wordmark.py` no longer makes it.
- **Known gaps.** There is no service worker, so "installable" is up to the browser (the manifest only names and styles the app). The PNG icons are not regenerated by `npm run build` (run the generator when the artwork changes). Chromium decides which design the favicon
  shows by the size it draws at; other browsers may take the PNGs listed before the SVG.
