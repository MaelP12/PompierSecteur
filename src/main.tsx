import 'leaflet/dist/leaflet.css'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

registerSW({ immediate: true })

// Demande au navigateur de ne pas effacer le stockage (stats, révision) pour libérer de la place.
navigator.storage?.persist?.().catch(() => {})

createRoot(document.getElementById('root')!).render(<App />)
