import { SCORING } from '../config'

/** Points obtenus pour une distance (m) au point le plus proche de la voie. */
export function pointsFor(distance: number, cfg = SCORING): number {
  const { maxPoints, fullScoreDistance: full, zeroScoreDistance: zero } = cfg
  if (distance <= full) return maxPoints
  if (distance >= zero) return 0
  const t = (distance - full) / (zero - full) // 0 → 1
  const k = cfg.curve === 'ease' ? (1 + Math.cos(Math.PI * t)) / 2 : 1 - t
  return Math.round(maxPoints * k)
}

export function isSuccess(points: number): boolean {
  return points >= SCORING.successPoints
}
