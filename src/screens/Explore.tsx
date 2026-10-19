import { useCallback, useMemo, useState } from 'react'
import { Polyline } from 'react-leaflet'
import { BottomPanel } from '../components/BottomPanel'
import { FitBounds, MapView, StreetLine, TapHandler } from '../components/MapView'
import { LEVELS, MAP } from '../config'
import { distanceToBounds, formatDistance, nearestOnLines } from '../lib/geo'
import { loadStats, successRate } from '../lib/stats'
import { matches } from '../lib/text'
import type { Dataset, LatLng, Street } from '../types'

const LEVEL_COLORS: Record<number, string> = { 1: '#7c3aed', 2: '#0891b2', 3: '#65a30d' }

export function Explore({ data, onBack }: { data: Dataset; onBack: () => void }) {
  const [query, setQuery] = useState('')
  const [showList, setShowList] = useState(false)
  const [selected, setSelected] = useState<Street | null>(null)
  const [fitTo, setFitTo] = useState<Street | null>(null)
  const [network, setNetwork] = useState(false)
  const stats = useMemo(() => loadStats().streets, [])

  const results = useMemo(() => {
    if (!query.trim()) return []
    return data.streets.filter((s) => matches(s.search, query)).slice(0, 40)
  }, [data.streets, query])

  const networkLines = useMemo(() => {
    const byLevel: Record<number, LatLng[][]> = { 1: [], 2: [], 3: [] }
    for (const s of data.streets) byLevel[s.level].push(...s.lines)
    return byLevel
  }, [data.streets])

  // Tap sur la carte : identifie la voie la plus proche.
  const onTap = useCallback(
    (p: LatLng) => {
      let best: Street | null = null
      let bestD: number = MAP.exploreTapRadius
      for (const s of data.streets) {
        if (distanceToBounds(p, s.bounds) > bestD) continue
        const { distance } = nearestOnLines(p, s.lines)
        if (distance < bestD) {
          bestD = distance
          best = s
        }
      }
      setSelected(best)
      setShowList(false)
    },
    [data.streets],
  )

  const choose = (s: Street) => {
    setSelected(s)
    setFitTo(s)
    setShowList(false)
    setQuery(s.name)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  const st = selected ? stats[selected.id] : undefined

  return (
    <div className="screen">
      <MapView data={data}>
        <TapHandler onTap={onTap} />
        {network &&
          [3, 2, 1].map((lvl) => (
            <Polyline
              key={lvl}
              positions={networkLines[lvl]}
              interactive={false}
              pathOptions={{ color: LEVEL_COLORS[lvl], weight: lvl === 1 ? 4 : 3, opacity: 0.7 }}
            />
          ))}
        {selected && <StreetLine lines={selected.lines} color="#2563eb" />}
        <FitBounds bounds={fitTo?.bounds ?? null} top={90} bottom={220} />
      </MapView>

      <header className="search-bar">
        <button className="icon-btn" aria-label="Retour" onClick={onBack}>
          ←
        </button>
        <input
          type="search"
          inputMode="search"
          placeholder="Nom de voie… (ex. « gare pontoise »)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setShowList(true)
          }}
          onFocus={() => setShowList(true)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          className={`icon-btn ${network ? 'on' : ''}`}
          aria-pressed={network}
          aria-label="Afficher toutes les voies"
          title="Afficher toutes les voies"
          onClick={() => setNetwork((n) => !n)}
        >
          ☷
        </button>
      </header>

      {showList && query.trim() && (
        <ul className="search-results">
          {results.length === 0 && <li className="muted empty">Aucune voie trouvée</li>}
          {results.map((s) => (
            <li key={s.id}>
              <button onClick={() => choose(s)}>
                <span>{s.name}</span>
                <span className="muted small">
                  {s.commune} · {LEVELS[s.level].label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <BottomPanel>
        {selected ? (
          <div className="street-card">
            <div className="street-card-head">
              <div>
                <h2>{selected.name}</h2>
                <p className="muted">
                  {selected.commune}
                  {selected.quartier ? ` · ${selected.quartier}` : ''}
                </p>
              </div>
              <button className="icon-btn" aria-label="Fermer" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            <div className="facts">
              <span className={`level-tag level-${selected.level}`}>{LEVELS[selected.level].label}</span>
              <span>{formatDistance(selected.lengthM)}</span>
              {selected.addresses !== null && <span>{selected.addresses} adresses</span>}
              <span className="muted">{selected.highway}</span>
            </div>
            <p className="small muted">
              {st
                ? `Posée ${st.a} fois · ${Math.round(successRate(st) * 100)} % de réussite · dernière erreur ${formatDistance(st.lastD)}`
                : 'Jamais posée en partie.'}
            </p>
            {!fitTo || fitTo.id !== selected.id ? (
              <button className="btn" onClick={() => setFitTo(selected)}>
                Centrer sur la voie
              </button>
            ) : null}
          </div>
        ) : (
          <p className="hint">Cherchez une voie, ou touchez la carte pour identifier la voie la plus proche.</p>
        )}
      </BottomPanel>
    </div>
  )
}
