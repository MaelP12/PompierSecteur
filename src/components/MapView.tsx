import L from 'leaflet'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, Marker, Polygon, Polyline, TileLayer, useMap } from 'react-leaflet'
import { MAP } from '../config'
import { loadBasemap, loadPlanStyle, saveBasemap, type BasemapId } from '../lib/basemap'
import type { Dataset, LatLng } from '../types'

interface Props {
  data: Dataset
  children?: ReactNode
  /** Le double-tap zoome ; désactivé pendant une question pour ne pas gêner le tap. */
  doubleClickZoom?: boolean
}

/** Carte du secteur : fond sans noms, limitée aux communes, zoom borné. */
export function MapView({ data, children, doubleClickZoom = true }: Props) {
  const maxBounds = useMemo(() => {
    const [[s, w], [n, e]] = data.bounds
    const p = MAP.boundsPadding
    return L.latLngBounds([s - p, w - p], [n + p, e + p])
  }, [data.bounds])
  const [basemap, setBasemap] = useState<BasemapId>(loadBasemap)
  const sat = MAP.basemaps.satellite

  return (
    <MapContainer
      className="map"
      bounds={data.bounds}
      maxBounds={maxBounds}
      maxBoundsViscosity={1}
      minZoom={MAP.minZoom}
      maxZoom={MAP.maxZoom}
      zoomControl={false}
      doubleClickZoom={doubleClickZoom}
      attributionControl
      zoomSnap={0.25}
      bounceAtZoomLimits={false}
    >
      {basemap === 'satellite' ? (
        <TileLayer
          url={sat.tileUrl}
          attribution={sat.attribution}
          maxZoom={MAP.maxZoom}
          maxNativeZoom={sat.maxNativeZoom}
          detectRetina={false}
          bounds={maxBounds}
        />
      ) : (
        <PlanLayer />
      )}
      <BasemapToggle
        value={basemap}
        onChange={(id) => {
          setBasemap(id)
          saveBasemap(id)
        }}
      />
      {data.communes.map((c) => (
        <Polygon
          key={c.insee}
          positions={c.outline}
          interactive={false}
          pathOptions={{ color: '#475569', weight: 2, opacity: 0.55, dashArray: '6 6', fill: false }}
        />
      ))}
      <FixMinZoom />
      {children}
    </MapContainer>
  )
}

/** Plan vectoriel (MapLibre, chargé à la demande) sans aucune couche de texte. */
function PlanLayer() {
  const map = useMap()
  useEffect(() => {
    const { attribution } = MAP.basemaps.plan
    let layer: L.Layer | null = null
    let cancelled = false
    Promise.all([
      import('@maplibre/maplibre-gl-leaflet'),
      import('maplibre-gl'),
      // Sans cela, MapLibre cherche son worker à côté de son propre fichier, absent une fois empaqueté.
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
      loadPlanStyle(),
    ])
      .then(([{ maplibreGL }, { setWorkerUrl }, { default: workerUrl }, , style]) => {
        if (cancelled) return
        setWorkerUrl(workerUrl)
        layer = maplibreGL({ style, attributionControl: false }).addTo(map)
        map.attributionControl?.addAttribution(attribution)
      })
      .catch((err) => console.error('Fond de carte indisponible', err))
    return () => {
      cancelled = true
      if (layer) {
        map.removeLayer(layer)
        map.attributionControl?.removeAttribution(attribution)
      }
    }
  }, [map])
  return null
}

const BASEMAP_LABELS: Record<BasemapId, string> = { plan: '🗺️ Plan', satellite: '🛰️ Satellite' }

/** Bouton (contrôle Leaflet, au-dessus de l'attribution) pour changer de fond de carte. */
function BasemapToggle({ value, onChange }: { value: BasemapId; onChange: (id: BasemapId) => void }) {
  const map = useMap()
  const [el] = useState(() => {
    const div = L.DomUtil.create('div', 'leaflet-control basemap-toggle')
    L.DomEvent.disableClickPropagation(div)
    return div
  })
  useEffect(() => {
    const control = new L.Control({ position: 'bottomright' })
    control.onAdd = () => el
    control.addTo(map)
    return () => {
      control.remove()
    }
  }, [map, el])
  const next: BasemapId = value === 'plan' ? 'satellite' : 'plan'
  return createPortal(
    <button type="button" aria-label={`Fond de carte : ${BASEMAP_LABELS[next]}`} onClick={() => onChange(next)}>
      {BASEMAP_LABELS[next]}
    </button>,
    el,
  )
}

/** Empêche de dézoomer au-delà du secteur entier (selon la taille de l'écran). */
function FixMinZoom() {
  const map = useMap()
  useEffect(() => {
    const update = () => {
      const z = map.getBoundsZoom(map.options.maxBounds as L.LatLngBounds, false)
      map.setMinZoom(Math.max(MAP.minZoom, Math.floor(z * 4) / 4))
    }
    update()
    map.on('resize', update)
    return () => {
      map.off('resize', update)
    }
  }, [map])
  return null
}

/**
 * Appelle `onTap` uniquement pour un vrai tap : ignoré pendant/après un pinch-zoom
 * à deux doigts, un déplacement de la carte ou une animation.
 * (Leaflet supprime déjà le « click » qui suit un glisser.)
 */
export function TapHandler({ onTap }: { onTap: (p: LatLng) => void }) {
  const map = useMap()
  const onTapRef = useRef(onTap)
  onTapRef.current = onTap

  useEffect(() => {
    const el = map.getContainer()
    const pointers = new Set<number>()
    let multiAt = 0
    let moving = false

    const markMulti = () => {
      multiAt = Date.now()
    }
    const onDown = (e: PointerEvent) => {
      pointers.add(e.pointerId)
      if (pointers.size > 1) markMulti()
    }
    const onUp = (e: PointerEvent) => {
      if (pointers.size > 1) markMulti()
      pointers.delete(e.pointerId)
    }
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) markMulti()
    }
    const onStart = () => {
      moving = true
    }
    const onEnd = () => {
      moving = false
    }
    const onClick = (e: L.LeafletMouseEvent) => {
      if (Date.now() - multiAt < MAP.multiTouchGuardMs) return
      if (moving || pointers.size > 1) return
      onTapRef.current([e.latlng.lat, e.latlng.lng])
    }

    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointerup', onUp, true)
    el.addEventListener('pointercancel', onUp, true)
    el.addEventListener('touchstart', onTouch, { capture: true, passive: true })
    el.addEventListener('touchmove', onTouch, { capture: true, passive: true })
    map.on('zoomstart movestart', onStart)
    map.on('zoomend moveend', onEnd)
    map.on('click', onClick)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointerup', onUp, true)
      el.removeEventListener('pointercancel', onUp, true)
      el.removeEventListener('touchstart', onTouch, true)
      el.removeEventListener('touchmove', onTouch, true)
      map.off('zoomstart movestart', onStart)
      map.off('zoomend moveend', onEnd)
      map.off('click', onClick)
    }
  }, [map])
  return null
}

const pinIcon = (color: string) =>
  L.divIcon({
    className: 'pin',
    html: `<svg viewBox="0 0 36 48" width="36" height="48"><path d="M18 47C18 47 34 28 34 17A16 16 0 0 0 2 17C2 28 18 47 18 47Z" fill="${color}" stroke="#fff" stroke-width="2.5"/><circle cx="18" cy="17" r="6" fill="#fff"/></svg>`,
    iconSize: [36, 48],
    iconAnchor: [18, 47],
  })
const PIN = pinIcon('#b91c1c')
const PIN_DONE = pinIcon('#334155')

/** Marqueur déplaçable (glisser) — le tap sur la carte le repositionne aussi. */
export function GuessMarker({
  position,
  draggable,
  onMove,
}: {
  position: LatLng
  draggable: boolean
  onMove?: (p: LatLng) => void
}) {
  const handlers = useMemo(
    () => ({
      dragend(e: L.DragEndEvent) {
        const ll = (e.target as L.Marker).getLatLng()
        onMove?.([ll.lat, ll.lng])
      },
    }),
    [onMove],
  )
  return (
    <Marker
      position={position}
      draggable={draggable}
      icon={draggable ? PIN : PIN_DONE}
      eventHandlers={handlers}
      autoPan
      keyboard={false}
    />
  )
}

/** Voie en surbrillance (liseré blanc + trait coloré). */
export function StreetLine({
  lines,
  color = '#2563eb',
  weight = 7,
  onClick,
}: {
  lines: LatLng[][]
  color?: string
  weight?: number
  onClick?: () => void
}) {
  const handlers = useMemo(() => (onClick ? { click: onClick } : {}), [onClick])
  return (
    <>
      <Polyline
        positions={lines}
        interactive={false}
        pathOptions={{ color: '#fff', weight: weight + 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
      />
      <Polyline
        positions={lines}
        interactive={Boolean(onClick)}
        eventHandlers={handlers}
        pathOptions={{ color, weight, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }}
      />
    </>
  )
}

/** Recadre la carte quand `bounds` change, en tenant compte des panneaux superposés. */
export function FitBounds({
  bounds,
  top = 110,
  bottom = 190,
  maxZoom = 17,
}: {
  bounds: [LatLng, LatLng] | null
  top?: number
  bottom?: number
  maxZoom?: number
}) {
  const map = useMap()
  const key = bounds ? bounds.flat().join(',') : ''
  useEffect(() => {
    if (!bounds) {
      // Question suivante : on coupe une animation en cours, sinon le tap serait ignoré.
      map.stop()
      return
    }
    map.flyToBounds(bounds, {
      paddingTopLeft: [24, top],
      paddingBottomRight: [24, bottom],
      maxZoom,
      duration: 0.6,
    })
  }, [key, map])
  return null
}
