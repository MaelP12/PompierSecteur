import { useCallback, useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { loadDataset } from './lib/data'
import { filterStreets, pickGame, pickReview } from './lib/questions'
import { loadSettings, saveSettings } from './lib/settings'
import { loadStats, recordGame } from './lib/stats'
import { Explore } from './screens/Explore'
import { Game } from './screens/Game'
import { Home } from './screens/Home'
import { Stats } from './screens/Stats'
import { Summary } from './screens/Summary'
import type { Answer, Dataset, GameSettings, Mode, Street } from './types'

type Screen =
  | { name: 'home' }
  | { name: 'play'; mode: Mode; questions: Street[]; key: number }
  | { name: 'summary'; mode: Mode; answers: Answer[] }
  | { name: 'explore' }
  | { name: 'stats' }

export default function App() {
  const [data, setData] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadDataset().then(setData, (e: Error) => setError(e.message))
  }, [])

  if (error) {
    return (
      <>
        <div className="page center">
          <h1>Données introuvables</h1>
          <p>{error}</p>
          <p className="muted">
            Générez les données avec <code>python scripts/build_data.py</code> (voir README).
          </p>
        </div>
        <Analytics />
      </>
    )
  }
  if (!data) {
    return (
      <>
        <div className="page center muted">Chargement des voies…</div>
        <Analytics />
      </>
    )
  }
  return (
    <>
      <Main data={data} />
      <Analytics />
    </>
  )
}

function Main({ data }: { data: Dataset }) {
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings(data))
  const [screen, setScreenState] = useState<Screen>({ name: 'home' })
  const [notice, setNotice] = useState<string | null>(null)

  // Bouton « retour » d'Android / du navigateur : revient à l'accueil au lieu de quitter l'app.
  const setScreen = useCallback((s: Screen) => {
    if (s.name !== 'home' && history.state?.screen !== 'inner') history.pushState({ screen: 'inner' }, '')
    if (s.name === 'home' && history.state?.screen === 'inner') history.back()
    setScreenState(s)
  }, [])
  useEffect(() => {
    const onPop = () => setScreenState({ name: 'home' })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const updateSettings = (s: GameSettings) => {
    setSettings(s)
    saveSettings(s)
  }

  const start = (mode: Mode) => {
    const stats = loadStats().streets
    const questions =
      mode === 'review'
        ? pickReview(
            data.streets.filter((s) => settings.communes.includes(s.insee)),
            settings.count,
            stats,
          )
        : pickGame(filterStreets(data.streets, settings), settings.count, stats)
    if (questions.length === 0) {
      setNotice(mode === 'review' ? 'Rien à réviser pour le moment 👍' : 'Aucune voie dans la sélection.')
      return
    }
    setNotice(null)
    setScreen({ name: 'play', mode, questions, key: Date.now() })
  }

  const finish = (mode: Mode, answers: Answer[]) => {
    if (answers.length === 0) {
      setScreen({ name: 'home' })
      return
    }
    recordGame({
      date: Date.now(),
      mode,
      questions: answers.length,
      points: answers.reduce((s, a) => s + a.points, 0),
    })
    setScreen({ name: 'summary', mode, answers })
  }

  return (
    <>
      {screen.name === 'home' && (
        <>
          <Home
            data={data}
            settings={settings}
            onChange={updateSettings}
            onPlay={start}
            onExplore={() => setScreen({ name: 'explore' })}
            onStats={() => setScreen({ name: 'stats' })}
          />
          {notice && (
            <div className="toast" role="status" onClick={() => setNotice(null)}>
              {notice}
            </div>
          )}
        </>
      )}
      {screen.name === 'play' && (
        <Game
          key={screen.key}
          data={data}
          mode={screen.mode}
          questions={screen.questions}
          onFinish={(answers) => finish(screen.mode, answers)}
          onQuit={(answers) => {
            if (answers.length === 0 || confirm('Arrêter la partie ? Les réponses déjà données sont comptées.'))
              finish(screen.mode, answers)
          }}
        />
      )}
      {screen.name === 'summary' && (
        <Summary
          data={data}
          answers={screen.answers}
          onReplay={() => start(screen.mode)}
          onHome={() => setScreen({ name: 'home' })}
        />
      )}
      {screen.name === 'explore' && <Explore data={data} onBack={() => setScreen({ name: 'home' })} />}
      {screen.name === 'stats' && <Stats data={data} onBack={() => setScreen({ name: 'home' })} />}
    </>
  )
}
