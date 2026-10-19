import { useMemo, useRef, useState } from 'react'
import { MAP } from '../config'
import { planTileTemplate } from '../lib/basemap'
import type { Dataset } from '../types'

const { plan, satellite } = MAP.basemaps

/** Liste des URL de tuiles couvrant le secteur aux zooms donnés. */
function tileUrls(data: Dataset, template: string, zooms: number[]): string[] {
  const [[s, w], [n, e]] = data.bounds
  const p = MAP.boundsPadding / 2
  const retina = window.devicePixelRatio > 1 ? '@2x' : ''
  const urls: string[] = []
  for (const z of zooms) {
    const x = (lng: number) => Math.floor(((lng + 180) / 360) * 2 ** z)
    const y = (lat: number) => {
      const r = (lat * Math.PI) / 180
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
    }
    for (let tx = x(w - p); tx <= x(e + p); tx++) {
      for (let ty = y(n + p); ty <= y(s - p); ty++) {
        const sub = 'abcd'[(tx + ty) % 4]
        urls.push(
          template
            .replace('{s}', sub)
            .replace('{z}', String(z))
            .replace('{x}', String(tx))
            .replace('{y}', String(ty))
            .replace('{r}', retina),
        )
      }
    }
  }
  return urls
}

/**
 * Bonus hors ligne : les données sont déjà dans l'app (service worker) ; ce bouton
 * met en cache les tuiles du secteur. Les tuiles vues en jouant sont aussi gardées.
 */
export function OfflineCard({ data }: { data: Dataset }) {
  const satUrls = useMemo(() => tileUrls(data, satellite.tileUrl, satellite.prefetchZooms), [data])
  // Le gabarit des tuiles du plan n'est connu qu'au téléchargement : on compte avec un gabarit fictif.
  const planCount = useMemo(() => tileUrls(data, '{z}/{x}/{y}', plan.prefetchZooms).length, [data])
  const total = satUrls.length + planCount
  const [done, setDone] = useState<number | null>(null)
  const [errors, setErrors] = useState(0)
  const [stopped, setStopped] = useState(false)
  const abort = useRef(false)
  const swActive = 'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller)

  const start = async () => {
    abort.current = false
    setStopped(false)
    setDone(0)
    setErrors(0)
    let planUrls: string[] = []
    try {
      planUrls = tileUrls(data, await planTileTemplate(), plan.prefetchZooms)
    } catch {
      setErrors(planCount)
    }
    const urls = [...planUrls, ...satUrls]
    let i = 0
    let count = planUrls.length ? 0 : planCount
    const worker = async () => {
      while (i < urls.length && !abort.current) {
        const url = urls[i++]
        try {
          const res = await fetch(url, { mode: 'cors' })
          if (!res.ok) setErrors((x) => x + 1)
        } catch {
          setErrors((x) => x + 1)
        }
        setDone(++count)
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
  }

  const running = done !== null && done < total && !stopped

  return (
    <section className="card">
      <h2>Hors ligne</h2>
      <p className="small muted">
        Les voies sont toujours disponibles hors ligne une fois l'app installée. Pour le fond de carte,
        vous pouvez télécharger {total} tuiles, plan et satellite (de préférence en Wi-Fi). Les zooms plus
        détaillés sont gardés au fur et à mesure que vous les consultez.
      </p>
      {!swActive && (
        <p className="small muted">Service worker inactif (mode développement ou premier chargement).</p>
      )}
      {done === null ? (
        <button className="btn" onClick={start}>
          Télécharger le fond de carte
        </button>
      ) : running ? (
        <>
          <progress max={total} value={done} />
          <button className="btn" onClick={() => {
              abort.current = true
              setStopped(true)
            }}>
            Arrêter ({done}/{total})
          </button>
        </>
      ) : (
        <p className="small">
          {done}/{total} tuiles traitées{errors ? `, ${errors} erreurs` : ''}.
        </p>
      )}
    </section>
  )
}
