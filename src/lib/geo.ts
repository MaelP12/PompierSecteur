import type { LatLng } from '../types'

const R = 6371008.8 // rayon terrestre moyen (m)
const RAD = Math.PI / 180

/** Distance (m) entre deux points (haversine). */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b[0] - a[0]) * RAD
  const dLng = (b[1] - a[1]) * RAD
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Point de la voie le plus proche de `p`, et sa distance (m).
 * Projection équirectangulaire locale centrée sur `p` : précise au mètre près
 * à l'échelle d'une commune.
 */
export function nearestOnLines(p: LatLng, lines: LatLng[][]): { point: LatLng; distance: number } {
  const kx = Math.cos(p[0] * RAD) * R * RAD // m par degré de longitude
  const ky = R * RAD // m par degré de latitude
  let best = Infinity
  let bestPt: LatLng = lines[0][0]
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const a = line[i]
      const b = line[i + 1] ?? a
      const ax = (a[1] - p[1]) * kx
      const ay = (a[0] - p[0]) * ky
      const dx = (b[1] - a[1]) * kx
      const dy = (b[0] - a[0]) * ky
      const len2 = dx * dx + dy * dy
      let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0
      t = Math.max(0, Math.min(1, t))
      const x = ax + t * dx
      const y = ay + t * dy
      const d2 = x * x + y * y
      if (d2 < best) {
        best = d2
        bestPt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
      }
    }
  }
  return { point: bestPt, distance: Math.sqrt(best) }
}

export function boundsOf(points: Iterable<LatLng>): [LatLng, LatLng] {
  let s = 90, w = 180, n = -90, e = -180
  for (const [lat, lng] of points) {
    if (lat < s) s = lat
    if (lat > n) n = lat
    if (lng < w) w = lng
    if (lng > e) e = lng
  }
  return [[s, w], [n, e]]
}

/** Distance minimale (m) entre un point et une boîte englobante (0 si dedans). */
export function distanceToBounds(p: LatLng, [[s, w], [n, e]]: [LatLng, LatLng]): number {
  const lat = Math.max(s, Math.min(n, p[0]))
  const lng = Math.max(w, Math.min(e, p[1]))
  return haversine(p, [lat, lng])
}

/** Point décalé de `dx` m vers l'est et `dy` m vers le nord. */
export function offsetMeters(p: LatLng, dx: number, dy: number): LatLng {
  return [p[0] + dy / (R * RAD), p[1] + dx / (Math.cos(p[0] * RAD) * R * RAD)]
}

export interface HintCircle {
  center: LatLng
  radius: number
}

/**
 * Cercles d'indice emboîtés, du plus grand au plus petit, contenant tous un même point
 * de la voie. Les centres sont décalés dans une même direction aléatoire, proportionnellement
 * au rayon : chaque cercle est inclus dans le précédent (|c1 − c2| = f·(r1 − r2) ≤ r1 − r2).
 */
export function hintCircles(
  lines: LatLng[][],
  radii: number[],
  offset: number,
  rand: () => number = Math.random,
): HintCircle[] {
  const pts = lines.flat()
  const anchor = pts[Math.floor(rand() * pts.length)]
  const angle = rand() * 2 * Math.PI
  const f = offset * (0.5 + 0.5 * rand())
  return radii.map((radius) => ({
    center: offsetMeters(anchor, Math.cos(angle) * f * radius, Math.sin(angle) * f * radius),
    radius,
  }))
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1).replace('.', ',')} km`
}
