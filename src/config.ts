// Réglages de l'application. Modifiez puis relancez `npm run dev` / `npm run build`.
// (Les seuils de difficulté des voies sont dans scripts/config.toml.)

export const GAME = {
  /** Nombre de questions par partie (valeur par défaut, modifiable dans l'accueil). */
  defaultQuestionCount: 10,
  questionCountChoices: [5, 10, 20, 30],
  /** Niveaux sélectionnables (les autres sont affichés grisés). */
  enabledLevels: [1, 2],
}

export const SCORING = {
  maxPoints: 100,
  /** En dessous de cette distance (m) : score maximal. */
  fullScoreDistance: 50,
  /** Au-delà de cette distance (m) : 0 point. */
  zeroScoreDistance: 1000,
  /** Forme de la décroissance entre les deux seuils :
   *  "linear" (droite) ou "ease" (pénalise moins les petites erreurs). */
  curve: 'linear' as 'linear' | 'ease',
  /** Score minimal pour compter la réponse comme « réussie » (stats + révision). */
  successPoints: 70,
}

export const HINTS = {
  /** Rayon (m) du cercle affiché à chaque indice : chaque clic réduit la zone. */
  radiiM: [1000, 400, 150],
  /** Points retirés par indice utilisé (le score ne descend pas sous 0). */
  penaltyPoints: 15,
  /** Décalage max du centre par rapport à la voie, en fraction du rayon
   *  (0 = voie au centre ; < 1 pour qu'elle reste dans le cercle). */
  offset: 0.6,
}

export const REVIEW = {
  /** Intervalles (jours) de la répétition espacée, par « boîte » (système de Leitner).
   *  Une erreur renvoie la voie en boîte 0 (à revoir tout de suite). */
  intervalsDays: [0, 1, 3, 7, 14, 30, 60],
}

export const MAP = {
  /** Fonds de carte SANS noms de rues, sans clé d'API. Le bouton de la carte bascule de l'un à l'autre. */
  basemaps: {
    /** Plan vectoriel OpenFreeMap : toutes les couches de texte (« symbol ») sont retirées
     *  du style. Autres styles : …/styles/liberty, …/styles/positron (très pâle) */
    plan: {
      styleUrl: 'https://tiles.openfreemap.org/styles/bright',
      attribution:
        '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      /** Zooms du pré-téléchargement hors ligne (les tuiles vectorielles s'arrêtent à 14). */
      prefetchZooms: [12, 13, 14],
    },
    /** Photographies aériennes de l'IGN (BD ORTHO, ~20 cm), sans aucun texte. */
    satellite: {
      tileUrl:
        'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
      attribution: '&copy; <a href="https://geoservices.ign.fr/">IGN</a> BD ORTHO',
      /** Zoom max des tuiles fournies par le serveur (au-delà : agrandissement). */
      maxNativeZoom: 19,
      /** Pré-téléchargement hors ligne (soyez raisonnable : serveur public gratuit). */
      prefetchZooms: [12, 13, 14, 15, 16],
    },
  },
  minZoom: 12,
  maxZoom: 19,
  /** Marge autour du secteur pour maxBounds (en degrés, ~0.01 ≈ 1 km). */
  boundsPadding: 0.01,
  /** Ignorer un tap s'il suit un geste à deux doigts de moins de X ms. */
  multiTouchGuardMs: 500,
  /** En exploration, distance max (m) pour identifier la voie touchée. */
  exploreTapRadius: 60,
}

export const LEVELS: Record<number, { label: string; hint: string }> = {
  1: { label: 'Facile', hint: 'Grands axes' },
  2: { label: 'Moyen', hint: 'Rues de quartier' },
  3: { label: 'Difficile', hint: 'Impasses, allées…' },
}
