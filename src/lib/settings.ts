import { GAME } from '../config'
import type { Dataset, GameSettings } from '../types'

const KEY = 'rues-secteur:settings:v1'

export function loadSettings(data: Dataset): GameSettings {
  const defaults: GameSettings = {
    communes: data.communes.map((c) => c.insee),
    levels: [1],
    quartiers: [],
    count: GAME.defaultQuestionCount,
  }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<GameSettings> | null
    if (!saved) return defaults
    const known = new Set(data.communes.map((c) => c.insee))
    const communes = (saved.communes ?? []).filter((c) => known.has(c))
    const levels = (saved.levels ?? []).filter((l) => GAME.enabledLevels.includes(l))
    return {
      communes: communes.length ? communes : defaults.communes,
      levels: levels.length ? levels : defaults.levels,
      quartiers: saved.quartiers ?? [],
      count: saved.count && saved.count > 0 ? saved.count : defaults.count,
    }
  } catch {
    return defaults
  }
}

export function saveSettings(s: GameSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // ignoré
  }
}
