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
  main.tsx, App.tsx          app bootstrap and layout
  types/trip.ts              DATA CONTRACT (read this first)
  lib/                       framework-free helpers (geo math, polyline cache, formatting, ids,
                             routeKey.ts, modes.ts, …) — unit-tested with Vitest
  services/                  ALL network access: tiles config, osrm.ts, nominatim.ts
  store/                     tripStore (undoable intent), uiStore, routeStore, persistence
  components/                shared UI primitives (Button, IconButton, Menu, Dialog, Toast, …)
  features/<name>/           one folder per feature (map, places, routing, legs, stats, io,
                             ride, export-image, theme)
  styles/                    tokens.css (theme variables), global.css
e2e/                         Playwright specs + fixtures (service mocks)
```

Feature slots: the app shell renders a placeholder component for every planned feature
(e.g. `features/ride/RideButton.tsx` returning `null`). A feature replaces its own placeholders
instead of editing the shell, so features stay in their own folders.

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
- `store/uiStore.ts`: non-undoable UI state — theme, selection/hover of places and legs, which
  place row is expanded into search, open dialogs, ride playback state.
- `store/routeStore.ts`: derived route cache `Record<key, LegRoute>` + per-key status
  (`loading`/`error`). Not undoable.
- `store/persistence.ts`: debounced autosave of a `TripFile` (trip + routes of current legs) to
  `localStorage["roadmap-overview:v1:current"]`, restored on start. Theme lives in
  `localStorage["roadmap-overview:theme"]`.
- **Debug hook.** In dev builds `window.__ROADMAP__` exposes the stores (`trip`, `ui`, `routes`,
  each a Zustand store) so Playwright and humans can inspect and drive state programmatically.

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
  handles, place markers, labels, ride vehicle, popups/menus.
- Place markers: numbered circular pins with a permanent short label next to them.
- Route styling comes from `MODES` (`src/lib/modes.ts`). Hovered/selected legs get a
  highlight; legs still routing show a thin grey dashed straight placeholder.
- Map overlays are React components positioned inside the map container (not Leaflet popups),
  styled with the theme tokens.

## UI conventions

- Theme: `<html data-theme="light|dark">`, default from `prefers-color-scheme`, toggle persists
  the explicit choice. Colours only via the CSS variables in `styles/tokens.css`
  (`--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--accent`,
  `--accent-contrast`, `--danger`, `--warning`, `--success`, `--shadow-*`, `--radius-*`, …).
- Icons: `lucide-react`. Font: Inter (`@fontsource-variable/inter`).
- Every interactive element is keyboard reachable and has an accessible name.
  Add `data-testid` attributes to elements tests need; name them `kebab-case`.

## Testing and verification

| Command | What |
| --- | --- |
| `npm run dev` | dev server (`--port` to pick a port) |
| `npm run typecheck` / `npm run lint` | `tsc -b` / oxlint |
| `npm test` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run e2e` | Playwright specs in `e2e/` (uses `E2E_PORT`, default 5199) |

- e2e specs mock OSRM and Nominatim with deterministic fakes and serve a plain tile image
  (`e2e/fixtures.ts`), so they run offline and never load the public services.
- Visual verification uses real tiles/routing/search through a dev server and screenshots.
- Several agents may run at once: always pass an explicit, unique port.

## Feature log

Each feature appends a short entry here: what it added, where it lives, anything non-obvious.
