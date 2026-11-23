import { useEffect, useMemo, useState } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useLegRoutes } from '../routing/legRoutes'
import { computeTripStats, type TripStats } from './computeStats'
import { detectCountries, type Country } from './countries'

export type CountriesStatus = 'loading' | 'ready' | 'failed'

interface CountriesState {
  list: Country[]
  status: CountriesStatus
}

const sameCountries = (a: readonly Country[], b: readonly Country[]) => a.length === b.length && a.every((c, i) => c.code === b[i].code)

/**
 * The live statistics of the current trip. Numbers follow the trip and the arriving routes at once;
 * the countries need the boundaries (downloaded on first use) and are worked out asynchronously: until
 * they are known the status is 'loading', afterwards the previous list stays on screen while a changed
 * trip is re-examined. 'failed' means the boundaries could not be downloaded (tried again on the next change).
 */
export function useTripStats(): { stats: TripStats; countriesStatus: CountriesStatus } {
  const places = useTripStore((s) => s.trip.places)
  const legs = useLegRoutes()
  const [countries, setCountries] = useState<CountriesState>({ list: [], status: 'loading' })

  useEffect(() => {
    let current = true
    detectCountries(places, legs).then(
      (list) => {
        if (current) setCountries((prev) => (prev.status === 'ready' && sameCountries(prev.list, list) ? prev : { list, status: 'ready' }))
      },
      () => {
        if (current) setCountries({ list: [], status: 'failed' })
      },
    )
    return () => {
      current = false
    }
  }, [places, legs])

  const stats = useMemo(() => computeTripStats({ places }, legs, countries.list), [places, legs, countries.list])
  return { stats, countriesStatus: countries.status }
}
