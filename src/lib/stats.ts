import { REVIEW } from '../config'
import type { Mode, Street } from '../types'
import { isSuccess } from './scoring'

/** Statistiques d'une voie. Noms courts : tout est stocké dans localStorage. */
export interface StreetStat {
  a: number // tentatives
  s: number // réussites
  pts: number // total des points
  box: number // boîte de Leitner (0 = à revoir tout de suite)
  due: number // prochaine révision (timestamp ms)
  last: number // dernière tentative (timestamp ms)
  lastD: number // dernière distance (m)
}

export interface GameRecord {
  date: number
  mode: Mode
  questions: number
  points: number
}

interface Store {
  v: 1
  streets: Record<string, StreetStat>
  games: GameRecord[]
}

const KEY = 'rues-secteur:stats:v1'
const DAY = 24 * 3600 * 1000

function empty(): Store {
  return { v: 1, streets: {}, games: [] }
}

export function loadStats(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const data = JSON.parse(raw) as Store
    return data?.v === 1 ? data : empty()
  } catch {
    return empty()
  }
}

function save(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // stockage plein ou désactivé : les stats ne sont simplement pas conservées
  }
}

export function recordAnswer(streetId: string, points: number, distance: number, now = Date.now()) {
  const store = loadStats()
  const st = store.streets[streetId] ?? { a: 0, s: 0, pts: 0, box: 0, due: now, last: 0, lastD: 0 }
  const ok = isSuccess(points)
  st.a += 1
  st.s += ok ? 1 : 0
  st.pts += points
  st.box = ok ? Math.min(st.box + 1, REVIEW.intervalsDays.length - 1) : 0
  st.due = now + REVIEW.intervalsDays[st.box] * DAY
  st.last = now
  st.lastD = Math.round(distance)
  store.streets[streetId] = st
  save(store)
}

export function recordGame(rec: GameRecord) {
  const store = loadStats()
  store.games = [rec, ...store.games].slice(0, 100)
  save(store)
}

export function resetStats() {
  save(empty())
}

export interface Aggregate {
  key: string
  label: string
  total: number // voies du groupe
  seen: number // voies déjà posées
  attempts: number
  successes: number
  avgPoints: number
}

/** Agrège les statistiques des voies par clé (commune, niveau…). */
export function aggregate(
  streets: Street[],
  stats: Record<string, StreetStat>,
  keyOf: (s: Street) => string,
  labelOf: (key: string) => string = (k) => k,
): Aggregate[] {
  const groups = new Map<string, Aggregate & { pts: number }>()
  for (const s of streets) {
    const key = keyOf(s)
    const g =
      groups.get(key) ??
      { key, label: labelOf(key), total: 0, seen: 0, attempts: 0, successes: 0, avgPoints: 0, pts: 0 }
    g.total += 1
    const st = stats[s.id]
    if (st) {
      g.seen += 1
      g.attempts += st.a
      g.successes += st.s
      g.pts += st.pts
    }
    groups.set(key, g)
  }
  return [...groups.values()].map(({ pts, ...g }) => ({
    ...g,
    avgPoints: g.attempts ? Math.round(pts / g.attempts) : 0,
  }))
}

export function successRate(st: { a: number; s: number }): number {
  return st.a ? st.s / st.a : 0
}
