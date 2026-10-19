import type { Commune, Dataset, LatLng, Street } from '../types'
import { boundsOf } from './geo'
import { normalize } from './text'

type Pos = [number, number] // [lng, lat] (ordre GeoJSON)

interface StreetFeature {
  id: string
  geometry: { type: 'MultiLineString'; coordinates: Pos[][] }
  properties: {
    name: string
    insee: string
    commune: string
    quartier: string | null
    kind: string
    highway: string
    length_m: number
    addresses: number | null
    score: number
    level: 1 | 2 | 3
  }
}

interface CommuneFeature {
  id: string
  geometry: { type: 'Polygon'; coordinates: Pos[][] } | { type: 'MultiPolygon'; coordinates: Pos[][][] }
  properties: { insee: string; nom: string }
}

const swap = ([lng, lat]: Pos): LatLng => [lat, lng]

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`)
  if (!res.ok) throw new Error(`Impossible de charger ${file} (HTTP ${res.status})`)
  return res.json() as Promise<T>
}

export async function loadDataset(): Promise<Dataset> {
  const [streetsFc, communesFc] = await Promise.all([
    fetchJson<{ metadata: { demo?: boolean; generated: string; attribution: string }; features: StreetFeature[] }>(
      'streets.geojson',
    ),
    fetchJson<{ features: CommuneFeature[] }>('communes.geojson'),
  ])

  const streets: Street[] = streetsFc.features.map((f) => {
    const p = f.properties
    const lines = f.geometry.coordinates.map((line) => line.map(swap))
    return {
      id: f.id,
      name: p.name,
      insee: p.insee,
      commune: p.commune,
      quartier: p.quartier,
      kind: p.kind,
      highway: p.highway,
      lengthM: p.length_m,
      addresses: p.addresses,
      score: p.score,
      level: p.level,
      lines,
      bounds: boundsOf(lines.flat()),
      search: normalize(`${p.name} ${p.commune}`),
    }
  })

  const communes: Commune[] = communesFc.features.map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    return {
      insee: f.properties.insee,
      nom: f.properties.nom,
      outline: polys.map((rings) => rings[0].map(swap)),
    }
  })
  communes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))

  return {
    streets,
    communes,
    bounds: boundsOf(communes.flatMap((c) => c.outline.flat())),
    demo: Boolean(streetsFc.metadata?.demo),
    generated: streetsFc.metadata?.generated ?? '',
    attribution: streetsFc.metadata?.attribution ?? '',
  }
}
