import type { GameSettings, Street } from '../types'
import { successRate, type StreetStat } from './stats'

export function filterStreets(streets: Street[], settings: GameSettings): Street[] {
  return streets.filter(
    (s) =>
      settings.communes.includes(s.insee) &&
      settings.levels.includes(s.level) &&
      (settings.quartiers.length === 0 || (s.quartier !== null && settings.quartiers.includes(s.quartier))),
  )
}

function shuffle<T>(arr: T[], rnd = Math.random): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Partie normale : tirage aléatoire sans doublon. Les voies jamais posées ou posées
 * il y a longtemps passent légèrement en priorité.
 */
export function pickGame(
  pool: Street[],
  count: number,
  stats: Record<string, StreetStat>,
  now = Date.now(),
  rnd = Math.random,
): Street[] {
  const DAY = 24 * 3600 * 1000
  const weighted = pool.map((s) => {
    const last = stats[s.id]?.last ?? 0
    const ageDays = last ? (now - last) / DAY : 30
    // Clé aléatoire « Efraimidis-Spirakis » : poids entre 1 (vue aujourd'hui) et 3 (jamais vue).
    const weight = 1 + Math.min(ageDays, 30) / 15
    return { s, key: Math.pow(rnd(), 1 / weight) }
  })
  weighted.sort((a, b) => b.key - a.key)
  return weighted.slice(0, count).map((w) => w.s)
}

/**
 * Révision (répétition espacée) : d'abord les voies dont la révision est due,
 * en commençant par les boîtes basses (les plus ratées), puis les voies déjà ratées.
 */
export function pickReview(
  pool: Street[],
  count: number,
  stats: Record<string, StreetStat>,
  now = Date.now(),
): Street[] {
  const seen = pool.filter((s) => stats[s.id])
  const due = seen
    .filter((s) => stats[s.id].due <= now)
    .sort((a, b) => {
      const sa = stats[a.id], sb = stats[b.id]
      return sa.box - sb.box || successRate(sa) - successRate(sb) || sa.due - sb.due
    })
  const picked = due.slice(0, count)
  if (picked.length < count) {
    const extra = seen
      .filter((s) => !picked.includes(s) && stats[s.id].s < stats[s.id].a)
      .sort((a, b) => successRate(stats[a.id]) - successRate(stats[b.id]))
    picked.push(...extra.slice(0, count - picked.length))
  }
  return shuffle(picked)
}

/** Nombre de voies à réviser maintenant dans le périmètre choisi. */
export function dueCount(pool: Street[], stats: Record<string, StreetStat>, now = Date.now()): number {
  return pool.filter((s) => stats[s.id] && stats[s.id].due <= now).length
}
