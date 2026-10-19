import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Le worker de MapLibre est un module ES (il importe ses dépendances).
  worker: { format: 'es' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Rues du secteur — entraînement',
        short_name: 'Rues secteur',
        description: 'Apprendre les rues de Cergy, Pontoise et Osny',
        lang: 'fr',
        theme_color: '#b91c1c',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Les données (GeoJSON) sont pré-cachées : l'app fonctionne hors ligne.
        globPatterns: ['**/*.{js,css,html,svg,png,geojson}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            // Tuiles du fond de carte : gardées en cache au fil de la navigation.
            // (plan OpenFreeMap : style, TileJSON et tuiles vectorielles ; satellite IGN)
            urlPattern: /^https:\/\/(tiles\.openfreemap\.org|data\.geopf\.fr)\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tiles',
              expiration: { maxEntries: 6000, maxAgeSeconds: 60 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
