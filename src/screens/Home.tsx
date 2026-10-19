import { useMemo } from 'react'
import { GAME, LEVELS } from '../config'
import { dueCount, filterStreets } from '../lib/questions'
import { loadStats } from '../lib/stats'
import type { Dataset, GameSettings, Mode } from '../types'

interface Props {
  data: Dataset
  settings: GameSettings
  onChange: (s: GameSettings) => void
  onPlay: (mode: Mode) => void
  onExplore: () => void
  onStats: () => void
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

export function Home({ data, settings, onChange, onPlay, onExplore, onStats }: Props) {
  const stats = useMemo(() => loadStats().streets, [])
  const pool = useMemo(() => filterStreets(data.streets, settings), [data.streets, settings])
  const inCommunes = useMemo(
    () => data.streets.filter((s) => settings.communes.includes(s.insee)),
    [data.streets, settings.communes],
  )
  // La révision porte sur toutes les voies des communes choisies, quel que soit le niveau.
  const toReview = useMemo(() => dueCount(inCommunes, stats), [inCommunes, stats])
  const quartiers = useMemo(() => {
    const set = new Set(inCommunes.map((s) => s.quartier).filter((q): q is string => Boolean(q)))
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'))
  }, [inCommunes])

  const set = (patch: Partial<GameSettings>) => onChange({ ...settings, ...patch })

  return (
    <div className="page">
      <header className="page-header">
        <h1>Rues du secteur</h1>
        <p className="muted">Cergy · Pontoise · Osny</p>
      </header>

      <section className="card">
        <h2>Communes</h2>
        <div className="chips">
          {data.communes.map((c) => (
            <button
              key={c.insee}
              className={`chip ${settings.communes.includes(c.insee) ? 'on' : ''}`}
              aria-pressed={settings.communes.includes(c.insee)}
              onClick={() => {
                const communes = toggle(settings.communes, c.insee)
                if (communes.length) set({ communes, quartiers: [] })
              }}
            >
              {c.nom}
            </button>
          ))}
        </div>

        {quartiers.length > 0 && (
          <details className="quartiers" open={settings.quartiers.length > 0}>
            <summary>
              Quartiers {settings.quartiers.length ? `(${settings.quartiers.length})` : '(tous)'}
            </summary>
            <p className="muted small">Rattachement approximatif (lieu OSM le plus proche).</p>
            <div className="chips">
              {quartiers.map((q) => (
                <button
                  key={q}
                  className={`chip small ${settings.quartiers.includes(q) ? 'on' : ''}`}
                  aria-pressed={settings.quartiers.includes(q)}
                  onClick={() => set({ quartiers: toggle(settings.quartiers, q) })}
                >
                  {q}
                </button>
              ))}
            </div>
          </details>
        )}

        <h2>Niveau</h2>
        <div className="chips levels">
          {[1, 2, 3].map((lvl) => (
            <button
              key={lvl}
              className={`chip level-${lvl} ${settings.levels.includes(lvl) ? 'on' : ''}`}
              aria-pressed={settings.levels.includes(lvl)}
              disabled={!GAME.enabledLevels.includes(lvl)}
              onClick={() => {
                const levels = toggle(settings.levels, lvl)
                if (levels.length) set({ levels })
              }}
            >
              <strong>{LEVELS[lvl].label}</strong>
            </button>
          ))}
        </div>

        <h2>Questions par partie</h2>
        <div className="segmented">
          {GAME.questionCountChoices.map((n) => (
            <button key={n} className={settings.count === n ? 'on' : ''} onClick={() => set({ count: n })}>
              {n}
            </button>
          ))}
        </div>
        <p className="muted small pool">{pool.length} voies dans la sélection</p>
      </section>

      <div className="actions">
        <button className="btn primary big" disabled={pool.length === 0} onClick={() => onPlay('game')}>
          Jouer
        </button>
        <button className="btn big" disabled={toReview === 0} onClick={() => onPlay('review')}>
          Révision {toReview > 0 ? <span className="badge">{toReview}</span> : <span className="small">(rien à revoir)</span>}
        </button>
        <div className="row">
          <button className="btn" onClick={onExplore}>
            Exploration
          </button>
          <button className="btn" onClick={onStats}>
            Statistiques
          </button>
        </div>
      </div>

      {data.demo && (
        <p className="demo-note">
          ⚠ Données de démonstration (voies fictives). Lancez <code>python scripts/build_data.py</code> pour
          générer les vraies voies.
        </p>
      )}
    </div>
  )
}
