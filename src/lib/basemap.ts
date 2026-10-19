import type { StyleSpecification } from 'maplibre-gl'
import { MAP } from '../config'

export type BasemapId = keyof typeof MAP.basemaps

const KEY = 'rues-secteur:basemap:v1'

export function loadBasemap(): BasemapId {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && saved in MAP.basemaps) return saved as BasemapId
  } catch {
    // ignoré
  }
  return 'plan'
}

export function saveBasemap(id: BasemapId) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // ignoré
  }
}

let planStyle: Promise<StyleSpecification> | null = null

/** Style du plan, débarrassé de toutes ses couches de texte et d'icônes (noms de rues…). */
export function loadPlanStyle(): Promise<StyleSpecification> {
  planStyle ??= fetch(MAP.basemaps.plan.styleUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`style ${res.status}`)
      return res.json() as Promise<StyleSpecification>
    })
    .then((style) => ({ ...style, layers: style.layers.filter((l) => l.type !== 'symbol') }))
    .catch((err) => {
      planStyle = null // nouvel essai au prochain affichage
      throw err
    })
  return planStyle
}

/** Gabarit d'URL des tuiles vectorielles du plan (lu dans le TileJSON de la source). */
export async function planTileTemplate(): Promise<string> {
  const style = await loadPlanStyle()
  const src = Object.values(style.sources).find((s) => s.type === 'vector')
  if (!src || src.type !== 'vector') throw new Error('source vectorielle introuvable')
  if (src.tiles?.length) return src.tiles[0]
  if (!src.url) throw new Error('source vectorielle sans URL')
  const res = await fetch(src.url)
  if (!res.ok) throw new Error(`tilejson ${res.status}`)
  const tilejson = (await res.json()) as { tiles: string[] }
  return tilejson.tiles[0]
}
