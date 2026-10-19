import { useMemo, useState } from 'react'
import { LEVELS, SCORING } from '../config'
import { formatDistance } from '../lib/geo'
import { aggregate, loadStats, resetStats, successRate, type Aggregate } from '../lib/stats'
import type { Dataset } from '../types'
import { OfflineCard } from './OfflineCard'

function pct(a: number, b: number) {
  return b ? `${Math.round((a / b) * 100)} %` : '—'
}

function AggTable({ title, rows }: { title: string; rows: Aggregate[] }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <table className="stats-table">
        <thead>
          <tr>
            <th />
            <th>Vues</th>
            <th>Réussite</th>
            <th>Moy.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th>{r.label}</th>
              <td>
                {r.seen}/{r.total}
              </td>
              <td>
                <div className="bar">
                  <span style={{ width: r.attempts ? `${(r.successes / r.attempts) * 100}%` : 0 }} />
                </div>
                {pct(r.successes, r.attempts)}
              </td>
              <td>{r.attempts ? r.avgPoints : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export function Stats({ data, onBack }: { data: Dataset; onBack: () => void }) {
  const [version, setVersion] = useState(0)
  const store = useMemo(() => loadStats(), [version])
  const stats = store.streets

  const byCommune = useMemo(() => aggregate(data.streets, stats, (s) => s.commune), [data.streets, stats])
  const byLevel = useMemo(
    () => aggregate(data.streets, stats, (s) => String(s.level), (k) => LEVELS[Number(k)].label),
    [data.streets, stats],
  )
  const totals = byCommune.reduce(
    (t, r) => ({ attempts: t.attempts + r.attempts, successes: t.successes + r.successes, seen: t.seen + r.seen }),
    { attempts: 0, successes: 0, seen: 0 },
  )
  const worst = useMemo(
    () =>
      data.streets
        .filter((s) => stats[s.id] && stats[s.id].s < stats[s.id].a)
        .sort(
          (a, b) =>
            successRate(stats[a.id]) - successRate(stats[b.id]) ||
            stats[a.id].pts / stats[a.id].a - stats[b.id].pts / stats[b.id].a,
        )
        .slice(0, 20),
    [data.streets, stats],
  )

  return (
    <div className="page">
      <header className="page-header with-back">
        <button className="icon-btn" aria-label="Retour" onClick={onBack}>
          ←
        </button>
        <h1>Statistiques</h1>
      </header>

      <section className="card kpis">
        <div>
          <strong>{totals.attempts}</strong>
          <span className="muted small">réponses</span>
        </div>
        <div>
          <strong>{pct(totals.successes, totals.attempts)}</strong>
          <span className="muted small">réussite</span>
        </div>
        <div>
          <strong>
            {totals.seen}/{data.streets.length}
          </strong>
          <span className="muted small">voies vues</span>
        </div>
      </section>

      <AggTable title="Par commune" rows={byCommune.sort((a, b) => a.label.localeCompare(b.label, 'fr'))} />
      <AggTable title="Par niveau" rows={byLevel.sort((a, b) => a.key.localeCompare(b.key))} />

      <section className="card">
        <h2>Voies à retravailler</h2>
        {worst.length === 0 ? (
          <p className="muted small">Aucune erreur enregistrée pour l'instant.</p>
        ) : (
          <ul className="worst">
            {worst.map((s) => {
              const st = stats[s.id]
              return (
                <li key={s.id}>
                  <span>
                    {s.name} <span className="muted small">· {s.commune}</span>
                  </span>
                  <span className="small">
                    {st.s}/{st.a} · {formatDistance(st.lastD)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {store.games.length > 0 && (
        <section className="card">
          <h2>Dernières parties</h2>
          <ul className="worst">
            {store.games.slice(0, 10).map((g) => (
              <li key={g.date}>
                <span>
                  {new Date(g.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {g.mode === 'review' ? ' · révision' : ''}
                </span>
                <span className="small">
                  {g.points} / {g.questions * SCORING.maxPoints}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <OfflineCard data={data} />

      <section className="card">
        <h2>Données</h2>
        <p className="small muted">
          {data.streets.length} voies · générées le{' '}
          {data.generated ? new Date(data.generated).toLocaleDateString('fr-FR') : '?'}
          <br />
          {data.attribution}
        </p>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm('Effacer toutes les statistiques ?')) {
              resetStats()
              setVersion((v) => v + 1)
            }
          }}
        >
          Réinitialiser les statistiques
        </button>
      </section>
    </div>
  )
}
