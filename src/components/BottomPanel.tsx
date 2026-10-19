import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Panneau du bas superposé à la carte. Publie sa hauteur dans la variable CSS
 * --panel-h de l'écran parent, pour que les contrôles Leaflet (attribution)
 * restent visibles au-dessus.
 */
export function BottomPanel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    const parent = el?.parentElement
    if (!el || !parent) return
    const ro = new ResizeObserver(() => parent.style.setProperty('--panel-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <footer className="bottom-panel" ref={ref}>
      {children}
    </footer>
  )
}
