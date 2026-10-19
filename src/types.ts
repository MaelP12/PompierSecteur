export type LatLng = [number, number] // [lat, lng] (ordre Leaflet)

export interface Street {
  id: string
  name: string
  insee: string
  commune: string
  quartier: string | null
  kind: string
  highway: string
  lengthM: number
  addresses: number | null
  score: number
  level: 1 | 2 | 3
  /** Lignes de la voie, en [lat, lng]. */
  lines: LatLng[][]
  /** Boîte englobante [[sud, ouest], [nord, est]]. */
  bounds: [LatLng, LatLng]
  /** Nom normalisé pour la recherche. */
  search: string
}

export interface Commune {
  insee: string
  nom: string
  /** Anneaux extérieurs du contour, en [lat, lng]. */
  outline: LatLng[][]
}

export interface Dataset {
  streets: Street[]
  communes: Commune[]
  bounds: [LatLng, LatLng]
  demo: boolean
  generated: string
  attribution: string
}

export type Mode = 'game' | 'review'

export interface GameSettings {
  communes: string[] // codes INSEE
  levels: number[]
  quartiers: string[] // vide = tous
  count: number
}

export interface Answer {
  street: Street
  guess: LatLng
  nearest: LatLng
  distance: number
  /** Points finaux, pénalité d'indices déduite. */
  points: number
  /** Nombre d'indices utilisés. */
  hints: number
}
