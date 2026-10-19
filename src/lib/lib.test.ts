import { describe, expect, it } from 'vitest'
import type { Street } from '../types'
import { formatDistance, haversine, hintCircles, nearestOnLines } from './geo'
import { pickGame, pickReview } from './questions'
import { pointsFor, withHintPenalty } from './scoring'
import type { StreetStat } from './stats'
import { matches, normalize } from './text'

describe('nearestOnLines', () => {
  // Segment horizontal à Cergy, ~730 m de long.
  const line: [number, number][] = [
    [49.04, 2.06],
    [49.04, 2.07],
  ]

  it('mesure la distance au point le plus proche, pas au centre', () => {
    const p: [number, number] = [49.041, 2.0605] // ~111 m au nord, près d'une extrémité
    const { point, distance } = nearestOnLines(p, [line])
    expect(distance).toBeGreaterThan(105)
    expect(distance).toBeLessThan(117)
    expect(point[1]).toBeCloseTo(2.0605, 6)
    expect(Math.abs(distance - haversine(p, point))).toBeLessThan(0.5)
  })

  it('se colle à une extrémité au-delà du segment', () => {
    const { point } = nearestOnLines([49.04, 2.08], [line])
    expect(point).toEqual([49.04, 2.07])
  })

  it('choisit la ligne la plus proche parmi plusieurs', () => {
    const other: [number, number][] = [
      [49.05, 2.06],
      [49.05, 2.07],
    ]
    const { distance } = nearestOnLines([49.049, 2.065], [line, other])
    expect(distance).toBeLessThan(120)
  })
})

describe('pointsFor', () => {
  it('donne 100 sous 50 m et 0 au-delà de 1 km', () => {
    expect(pointsFor(0)).toBe(100)
    expect(pointsFor(50)).toBe(100)
    expect(pointsFor(1000)).toBe(0)
    expect(pointsFor(5000)).toBe(0)
  })
  it('décroît entre les deux seuils', () => {
    expect(pointsFor(525)).toBe(50)
    expect(pointsFor(200)).toBeGreaterThan(pointsFor(400))
  })
  it('accepte des seuils réglables', () => {
    const cfg = { maxPoints: 10, fullScoreDistance: 10, zeroScoreDistance: 110, curve: 'linear' as const, successPoints: 7 }
    expect(pointsFor(60, cfg)).toBe(5)
  })
})

describe('texte', () => {
  it('normalise accents et apostrophes', () => {
    expect(normalize("Allée de l'Écluse")).toBe('allee de l ecluse')
  })
  it('recherche tous les mots dans le désordre', () => {
    expect(matches(normalize('Rue de la Gare Pontoise'), 'gare pontoise')).toBe(true)
    expect(matches(normalize('Rue de la Gare Pontoise'), 'gare osny')).toBe(false)
  })
  it('formate les distances', () => {
    expect(formatDistance(42.4)).toBe('42 m')
    expect(formatDistance(1530)).toBe('1,53 km')
  })
})

function street(id: string): Street {
  return {
    id, name: id, insee: '95127', commune: 'Cergy', quartier: null, kind: 'rue', highway: 'residential',
    lengthM: 100, addresses: 0, score: 0.5, level: 2, lines: [[[49, 2], [49, 2.001]]],
    bounds: [[49, 2], [49, 2.001]], search: id,
  }
}

describe('tirage des questions', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map(street)
  const stat = (p: Partial<StreetStat>): StreetStat => ({ a: 1, s: 0, pts: 0, box: 0, due: 0, last: 0, lastD: 0, ...p })

  it('ne pose pas deux fois la même voie', () => {
    const q = pickGame(pool, 10, {})
    expect(q).toHaveLength(5)
    expect(new Set(q.map((s) => s.id)).size).toBe(5)
  })

  it('révision : voies dues d’abord, boîtes basses en premier, rien de jamais vu', () => {
    const now = 1_000_000
    const stats = {
      a: stat({ box: 3, s: 1, due: now - 1 }),
      b: stat({ box: 0, due: now - 1 }),
      c: stat({ box: 2, s: 1, a: 1, due: now + 999 }), // pas due, jamais ratée
      d: stat({ box: 1, s: 1, a: 2, due: now + 999 }), // pas due mais déjà ratée
    }
    const ids = pickReview(pool, 10, stats, now).map((s) => s.id).sort()
    expect(ids).toEqual(['a', 'b', 'd'])
    expect(pickReview(pool, 1, stats, now).map((s) => s.id)).toEqual(['b'])
  })
})

describe('indices', () => {
  const lines: [number, number][][] = [
    [
      [49.04, 2.06],
      [49.041, 2.065],
      [49.043, 2.07],
    ],
  ]

  it('chaque cercle contient la voie et est inclus dans le précédent', () => {
    for (let seed = 1; seed <= 200; seed++) {
      let x = seed
      const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647)
      const circles = hintCircles(lines, [1000, 400, 150], 0.6, rand)
      circles.forEach((c, i) => {
        expect(nearestOnLines(c.center, lines).distance).toBeLessThan(c.radius)
        if (i > 0) {
          const prev = circles[i - 1]
          expect(haversine(prev.center, c.center) + c.radius).toBeLessThanOrEqual(prev.radius + 0.5)
        }
      })
    }
  })

  it('retire la pénalité sans descendre sous 0', () => {
    expect(withHintPenalty(90, 2, 15)).toBe(60)
    expect(withHintPenalty(20, 3, 15)).toBe(0)
  })
})
