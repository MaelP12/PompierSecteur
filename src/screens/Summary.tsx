import { Fragment, useState } from 'react'
import { CircleMarker, Polyline } from 'react-leaflet'
import { FitBounds, MapView, StreetLine } from '../components/MapView'
import { SCORING } from '../config'
import { boundsOf, formatDistance } from '../lib/geo'
import { isSuccess } from '../lib/scoring'
import type { Answer, Dataset } from '../types'
import { resultColor } from './Game'

interface Props {
  data: Dataset
  answers: Answer[]
  onReplay: () => void
  onHome: () => void
}

export function Summary({ data, answers, onReplay, onHome }: Props) {
  const [focus, setFocus] = useState<number | null>(null)
  const total = answers.reduce((s, a) => s + a.points, 0)
  const max = answers.length * SCORING.maxPoints
  const ok = answers.filter((a) => isSuccess(a.points)).length
  const median = [...answers].sort((a, b) => a.distance - b.distance)[Math.floor(answers.length / 2)]

  const bounds =
    focus !== null
      ? boundsOf([...answers[focus].street.lines.flat(), answers[focus].guess])
      : answers.length
        ? boundsOf(answers.flatMap((a) => [...a.street.lines.flat(), a.guess]))
        : null

  return (
    <div className="summary">
      <div className="summary-map">
        <MapView data={data}>
          {answers.map((a, i) => (
            <StreetLine
              key={a.street.id}
              lines={a.street.lines}
              color={resultColor(a.points)}
              weight={focus === i ? 8 : 5}
              onClick={() => setFocus(i)}
            />
          ))}
          {answers.map((a, i) =>
            focus === null || focus === i ? (
              <Fragment key={`g${i}`}>
                <Polyline
                  positions={[a.guess, a.nearest]}
                  interactive={false}
                  pathOptions={{ color: '#334155', weight: 2, dashArray: '4 6' }}
                />
                <CircleMarker
                  center={a.guess}
                  radius={5}
                  interactive={false}
                  pathOptions={{ color: '#fff', weight: 2, fillColor: '#334155', fillOpacity: 1 }}
                />
              </Fragment>
            ) : null,
          )}
          <FitBounds bounds={bounds} top={24} bottom={24} maxZoom={17} />
        </MapView>
      </div>

      <div className="summary-body">
        <div className="summary-score">
          <div>
            <strong>{total}</strong> <span className="muted">/ {max} pts</span>
          </div>
          <div className="muted small">
            {ok}/{answers.length} réussies{median ? ` · distance médiane ${formatDistance(median.distance)}` : ''}
          </div>
        </div>

        <ol className="answer-list">
          {answers.map((a, i) => (
            <li key={a.street.id}>
              <button className={focus === i ? 'on' : ''} onClick={() => setFocus(focus === i ? null : i)}>
                <span className="dot" style={{ background: resultColor(a.points) }} />
                <span className="answer-name">
                  {a.street.name}
                  <span className="muted small"> · {a.street.commune}</span>
                </span>
                <span className="answer-score">
                  <strong>{a.points}</strong>
                  <span className="muted small">{formatDistance(a.distance)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className="actions sticky">
          <button className="btn primary big" onClick={onReplay}>
            Rejouer
          </button>
          <button className="btn big" onClick={onHome}>
            Accueil
          </button>
        </div>
      </div>
    </div>
  )
}
