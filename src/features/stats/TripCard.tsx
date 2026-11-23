import { CalendarDays, ChevronUp, Globe, MapPin, Route, TriangleAlert } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { Spinner } from '../../components/Spinner'
import { formatDistance, formatDuration } from '../../lib/format'
import { MODE_ORDER, MODES } from '../../lib/modes'
import { useTripStore } from '../../store/tripStore'
import { MODE_ICONS } from '../legs/modeIcons'
import { CountryFlags } from './CountryFlags'
import { InlineText } from './InlineText'
import { StartDate } from './StartDate'
import { StatTile } from './StatTile'
import { useStatsCardStore } from './statsCardStore'
import { useTripStats } from './useTripStats'
import type { LegMode } from '../../types/trip'
import './stats.css'

const OTHER_MODES: LegMode[] = ['ferry', 'train', 'flight']
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The trip's title, subtitle, dates and statistics, as the card at the top-left of the map. */
export function TripCard() {
  const title = useTripStore((s) => s.trip.title)
  const subtitle = useTripStore((s) => s.trip.subtitle ?? '')
  const setTitle = useTripStore((s) => s.setTitle)
  const setSubtitle = useTripStore((s) => s.setSubtitle)
  const setCollapsed = useStatsCardStore((s) => s.setCollapsed)
  const { stats, countriesStatus } = useTripStats()

  const partial = stats.pendingLegs > 0
  const hasRoutes = stats.stops > 1
  const modesInUse = OTHER_MODES.filter((m) => stats.timeByModeS[m] > 0 || stats.distanceByModeM[m] > 0)
  const distanceDetail = MODE_ORDER.filter((m) => stats.distanceByModeM[m] > 0)
    .map((m) => `${MODES[m].label} ${formatDistance(stats.distanceByModeM[m])}`)
    .join(' · ')
  // With other modes in use the driving tile says how the travel time adds up.
  // A trip without a drive leg (train only, ferry and flight) has no driving tile.
  const showDriving = hasRoutes && (stats.legsByMode.drive > 0 || stats.drivingS > 0)
  const timeDetail = modesInUse.length
    ? [...(showDriving ? [`Driving ${formatDuration(stats.drivingS)}`] : []), ...modesInUse.map((m) => `${MODES[m].label} ${formatDuration(stats.timeByModeS[m])}`), `Total ${formatDuration(stats.travelS)}`].join(' · ')
    : undefined

  return (
    <section className="trip-card" aria-label="Trip summary" data-testid="trip-card" data-partial={partial ? 'true' : undefined}>
      <div className="trip-card__head">
        <div className="trip-card__titles">
          <h2 className="trip-card__title">
            <InlineText
              className="trip-card__title-text"
              value={title}
              placeholder="Untitled trip"
              label="Trip title"
              testId="card-title"
              onCommit={setTitle}
            />
          </h2>
          <InlineText
            className="trip-card__subtitle"
            value={subtitle}
            placeholder="Add a subtitle"
            label="Trip subtitle"
            maxLength={200}
            testId="card-subtitle"
            onCommit={setSubtitle}
          />
          <StartDate days={stats.days} />
        </div>
        <IconButton
          size="sm"
          label="Hide trip summary"
          icon={<ChevronUp size={18} />}
          data-testid="card-collapse"
          onClick={() => setCollapsed(true)}
        />
      </div>

      {stats.stops === 0 ? (
        <p className="trip-card__hint">Add places to see distance, days and countries.</p>
      ) : (
        <dl className="stats" data-testid="stats">
          {hasRoutes ? (
            <StatTile id="distance" label="Distance" icon={<Route size={14} />} value={partial && stats.distanceM === 0 ? '—' : formatDistance(stats.distanceM)} detail={distanceDetail || undefined} partial={partial} />
          ) : null}
          <StatTile id="days" label={stats.days === 1 ? 'Day' : 'Days'} icon={<CalendarDays size={14} />} value={stats.days} />
          <StatTile id="stops" label={stats.stops === 1 ? 'Stop' : 'Stops'} icon={<MapPin size={14} />} value={stats.stops} />
          {showDriving ? (
            <StatTile id="driving" label="Driving" icon={<MODE_ICONS.drive size={14} />} value={partial && stats.drivingS === 0 ? '—' : formatDuration(stats.drivingS)} detail={timeDetail} partial={partial} />
          ) : null}
          {modesInUse.map((mode) => {
            const Icon = MODE_ICONS[mode]
            return (
              <StatTile key={mode} id={mode} label={MODES[mode].label} icon={<Icon size={14} />} value={formatDuration(stats.timeByModeS[mode])} partial={partial} />
            )
          })}
          <StatTile
            id="countries"
            label={stats.countries.length === 1 ? 'Country' : 'Countries'}
            icon={<Globe size={14} />}
            value={countriesStatus === 'ready' ? stats.countries.length : countriesStatus === 'failed' ? '—' : '…'}
            detail={countriesStatus === 'failed' ? 'The country boundaries could not be loaded' : undefined}
            partial={partial || countriesStatus !== 'ready'}
            wide
          >
            <CountryFlags countries={stats.countries} />
          </StatTile>
        </dl>
      )}

      {partial ? (
        <div className="trip-card__status" role="status" data-testid="stats-status">
          {stats.loadingLegs > 0 ? (
            <p>
              <Spinner size={13} />
              Routing {plural(stats.loadingLegs, 'leg', 'legs')}…
            </p>
          ) : null}
          {stats.failedLegs > 0 ? (
            <p className="is-warning">
              <TriangleAlert size={13} aria-hidden="true" />
              {plural(stats.failedLegs, 'leg', 'legs')} not routed: totals are incomplete
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
