import { useCallback, useMemo, useState } from 'react'
import { Circle, CircleMarker, Polyline } from 'react-leaflet'
import { BottomPanel } from '../components/BottomPanel'
import { FitBounds, GuessMarker, MapView, StreetLine, TapHandler } from '../components/MapView'
import { HINTS, LEVELS, SCORING } from '../config'
import { boundsOf, formatDistance, hintCircles, nearestOnLines, offsetMeters } from '../lib/geo'
import { isSuccess, pointsFor, withHintPenalty } from '../lib/scoring'
import { recordAnswer } from '../lib/stats'
import type { Answer, Dataset, LatLng, Mode, Street } from '../types'

interface Props {
  data: Dataset
  mode: Mode
  questions: Street[]
  onFinish: (answers: Answer[]) => void
  onQuit: (answers: Answer[]) => void
}

export function resultColor(points: number): string {
  if (isSuccess(points)) return '#16a34a'
  if (points > 0) return '#ea580c'
  return '#dc2626'
}

export function Game({ data, mode, questions, onFinish, onQuit }: Props) {
  const [index, setIndex] = useState(0)
  const [guess, setGuess] = useState<LatLng | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  /** Nombre d'indices demandés pour la question en cours. */
  const [hints, setHints] = useState(0)
  const street = questions[index]
  const circles = useMemo(() => hintCircles(street.lines, HINTS.radiiM, HINTS.offset), [street])
  const circle = hints > 0 ? circles[hints - 1] : null
  const answer = answers[index] as Answer | undefined
  const total = answers.reduce((sum, a) => sum + a.points, 0)
  const isLast = index === questions.length - 1

  const onTap = useCallback((p: LatLng) => {
    setGuess((prev) => (answer ? prev : p))
  }, [answer])

  const validate = () => {
    if (!guess || answer) return
    const { point, distance } = nearestOnLines(guess, street.lines)
    const points = withHintPenalty(pointsFor(distance), hints)
    recordAnswer(street.id, points, distance)
    setAnswers((a) => [...a, { street, guess, nearest: point, distance, points, hints }])
  }

  const next = () => {
    if (isLast) {
      onFinish(answers)
      return
    }
    setIndex((i) => i + 1)
    setGuess(null)
    setHints(0)
  }

  const resultBounds = answer ? boundsOf([...street.lines.flat(), answer.guess]) : null
  const hintBounds: [LatLng, LatLng] | null = circle
    ? [
        offsetMeters(circle.center, -circle.radius, -circle.radius),
        offsetMeters(circle.center, circle.radius, circle.radius),
      ]
    : null

  return (
    <div className="screen">
      <MapView data={data} doubleClickZoom={false}>
        <TapHandler onTap={onTap} />
        {circle && (
          <Circle
            center={circle.center}
            radius={circle.radius}
            interactive={false}
            pathOptions={{ color: '#ca8a04', weight: 3, dashArray: '8 6', fillColor: '#facc15', fillOpacity: 0.12 }}
          />
        )}
        {answer && (
          <>
            <StreetLine lines={street.lines} color="#2563eb" />
            <Polyline
              positions={[answer.guess, answer.nearest]}
              interactive={false}
              pathOptions={{ color: resultColor(answer.points), weight: 3, dashArray: '6 8' }}
            />
            <CircleMarker
              center={answer.nearest}
              radius={7}
              interactive={false}
              pathOptions={{ color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
            />
          </>
        )}
        {guess && <GuessMarker position={guess} draggable={!answer} onMove={setGuess} />}
        <FitBounds bounds={resultBounds ?? hintBounds} top={130} bottom={230} />
      </MapView>

      <header className="question-bar">
        <div className="question-meta">
          <button className="icon-btn" aria-label="Quitter la partie" onClick={() => onQuit(answers)}>
            ✕
          </button>
          <span>
            {mode === 'review' ? 'Révision · ' : ''}
            {index + 1}/{questions.length}
          </span>
          <span className={`level-tag level-${street.level}`}>{LEVELS[street.level].label}</span>
          <span className="score">{total} pts</span>
        </div>
        <h1 className="street-name">{street.name}</h1>
        <p className="street-commune">{street.commune}</p>
      </header>

      <BottomPanel>
        {!answer ? (
          <>
            <p className="hint">
              {guess ? 'Glissez le marqueur ou touchez ailleurs pour corriger.' : 'Touchez la carte pour placer le marqueur.'}
            </p>
            <div className="panel-row">
              <button
                className="btn big hint-btn"
                disabled={hints >= HINTS.radiiM.length}
                onClick={() => setHints((h) => Math.min(h + 1, HINTS.radiiM.length))}
              >
                💡 Indice{hints > 0 ? ` ${hints}/${HINTS.radiiM.length}` : ''}
                <span className="small">−{HINTS.penaltyPoints} pts</span>
              </button>
              <button className="btn primary big" disabled={!guess} onClick={validate}>
                Valider
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="result" style={{ borderColor: resultColor(answer.points) }}>
              <div>
                <span className="result-points" style={{ color: resultColor(answer.points) }}>
                  {answer.points}
                </span>
                <span className="muted"> / {SCORING.maxPoints} pts</span>
              </div>
              <div className="result-distance">
                {answer.distance <= 1 ? 'Sur la voie !' : `à ${formatDistance(answer.distance)} de la voie`}
                {answer.hints > 0 && (
                  <div className="small muted">
                    {answer.hints} indice{answer.hints > 1 ? 's' : ''} : −{answer.hints * HINTS.penaltyPoints} pts
                  </div>
                )}
              </div>
            </div>
            <button className="btn primary big" onClick={next}>
              {isLast ? 'Voir le récapitulatif' : 'Suivant'}
            </button>
          </>
        )}
      </BottomPanel>
    </div>
  )
}
