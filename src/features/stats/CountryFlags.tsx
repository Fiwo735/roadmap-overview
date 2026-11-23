import { useState } from 'react'
import { useTooltip } from '../../components/Tooltip'
import type { Country } from './countries'
import { flagUrl } from './flags'

function CountryFlag({ country }: { country: Country }) {
  const tip = useTooltip<HTMLSpanElement>(country.name)
  const [broken, setBroken] = useState(false)
  const url = flagUrl(country.code)
  return (
    <li className="flags__item">
      <span
        className="flag"
        tabIndex={0}
        role="img"
        aria-label={country.name}
        data-testid="country-flag"
        data-code={country.code}
        {...tip.props}
      >
        {url && !broken ? (
          <img src={url} alt="" width={24} height={18} draggable={false} onError={() => setBroken(true)} />
        ) : (
          <span className="flag__code">{country.code}</span>
        )}
      </span>
      {tip.tooltip}
    </li>
  )
}

/** The flags of the countries visited, in order; each is focusable and names its country on hover/focus. */
export function CountryFlags({ countries }: { countries: readonly Country[] }) {
  if (countries.length === 0) return null
  return (
    <ul className="flags" aria-label="Countries visited" data-testid="country-flags">
      {countries.map((country) => (
        <CountryFlag key={country.code} country={country} />
      ))}
    </ul>
  )
}
