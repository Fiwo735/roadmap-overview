// The heavy half of the country detection (about 750 kB of boundaries): only ever imported
// dynamically by countries.ts, so it lands in its own chunk and stays out of the initial bundle.
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import topology from 'world-atlas/countries-50m.json'
import { countryName, featureCode } from './countryData'
import { createCountryIndex, type CountryIndex, type CountryShape } from './countryIndex'

type Properties = { name?: string }

/** Boundaries from a Natural Earth topology (world-atlas format: feature ids are ISO numeric codes). */
export function shapesFromTopology(world: Topology): CountryShape[] {
  const countries = feature(world, world.objects.countries as GeometryCollection<Properties>) as FeatureCollection<
    Polygon | MultiPolygon,
    Properties
  >
  const byCode = new Map<string, CountryShape & { polygons: number[][][][] }>()
  for (const f of countries.features) {
    const code = featureCode(f.id, f.properties?.name)
    if (!code) continue
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    const shape = byCode.get(code)
    if (shape) shape.polygons.push(...polygons)
    else byCode.set(code, { code, name: countryName(code), polygons: [...polygons] })
  }
  return [...byCode.values()]
}

/** The country index over the bundled world-atlas 50 m boundaries. */
export function createWorldIndex(): CountryIndex {
  return createCountryIndex(shapesFromTopology(topology as unknown as Topology))
}
