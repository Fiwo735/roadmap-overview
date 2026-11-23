import { create } from 'zustand'
import type { LegRoute } from '../types/trip'

export type RouteStatus = 'loading' | 'error'

/**
 * Derived route cache, keyed by `legRouteKey(...)` (src/lib/routeKey.ts). Not undoable: the routing
 * feature fills it, everything else only reads. A key is either in `routes`, flagged in `status`,
 * or neither (not requested yet).
 */
export interface RouteState {
  routes: Record<string, LegRoute>
  status: Record<string, RouteStatus>

  /** Store a finished route under `route.key` and clear that key's status. */
  setRoute: (route: LegRoute) => void
  /** Bulk-load routes (restore/import) without touching statuses. */
  setRoutes: (routes: LegRoute[]) => void
  /** Set a key's status, or clear it with `null`. */
  setStatus: (key: string, status: RouteStatus | null) => void
  clear: () => void
}

export const useRouteStore = create<RouteState>()((set) => ({
  routes: {},
  status: {},

  setRoute: (route) =>
    set((s) => {
      const { [route.key]: _done, ...status } = s.status
      return { routes: { ...s.routes, [route.key]: route }, status }
    }),

  setRoutes: (routes) =>
    set((s) => {
      if (routes.length === 0) return s
      const next = { ...s.routes }
      for (const r of routes) next[r.key] = r
      return { routes: next }
    }),

  setStatus: (key, status) =>
    set((s) => {
      if (status === null) {
        if (!(key in s.status)) return s
        const { [key]: _gone, ...rest } = s.status
        return { status: rest }
      }
      return s.status[key] === status ? s : { status: { ...s.status, [key]: status } }
    }),

  clear: () => set({ routes: {}, status: {} }),
}))
