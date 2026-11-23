import { create } from 'zustand'
import type { LegRoute } from '../types/trip'

export type RouteStatus = 'loading' | 'error'

/**
 * Derived route cache, keyed by `legRouteKey(...)` (src/lib/routeKey.ts). Not undoable: the routing
 * feature fills it, everything else only reads (through `useLegRoutes()` / `getLegRoutes()`). A key
 * is either in `routes`, flagged in `status`, or neither (not requested yet).
 */
export interface RouteState {
  routes: Record<string, LegRoute>
  status: Record<string, RouteStatus>
  /** User-presentable reason for each key whose status is 'error'. */
  errors: Record<string, string>

  /** Store a finished route under `route.key` and clear that key's status. */
  setRoute: (route: LegRoute) => void
  /** Bulk-load routes (restore/import) without touching statuses. */
  setRoutes: (routes: LegRoute[]) => void
  /** Set a key's status, or clear it with `null`. `error` explains an 'error' status. */
  setStatus: (key: string, status: RouteStatus | null, error?: string) => void
  clear: () => void
}

export const useRouteStore = create<RouteState>()((set) => ({
  routes: {},
  status: {},
  errors: {},

  setRoute: (route) =>
    set((s) => {
      const { [route.key]: _done, ...status } = s.status
      const { [route.key]: _reason, ...errors } = s.errors
      return { routes: { ...s.routes, [route.key]: route }, status, errors }
    }),

  setRoutes: (routes) =>
    set((s) => {
      if (routes.length === 0) return s
      const next = { ...s.routes }
      for (const r of routes) next[r.key] = r
      return { routes: next }
    }),

  setStatus: (key, status, error) =>
    set((s) => {
      if (status === null) {
        if (!(key in s.status)) return s
        const { [key]: _gone, ...rest } = s.status
        const { [key]: _reason, ...errors } = s.errors
        return { status: rest, errors }
      }
      const reason = status === 'error' && error ? error : undefined
      if (s.status[key] === status && s.errors[key] === reason) return s
      const { [key]: _old, ...others } = s.errors
      return { status: { ...s.status, [key]: status }, errors: reason ? { ...others, [key]: reason } : others }
    }),

  clear: () => set({ routes: {}, status: {}, errors: {} }),
}))
