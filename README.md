# Rues du secteur — entraînement

Application web (PWA, pensée pour le téléphone) pour apprendre les voies de **Cergy**, **Pontoise** et **Osny**.
L'app affiche un nom de voie, vous placez un marqueur sur une carte **sans noms de rues**, puis elle
trace la vraie voie et calcule la distance entre votre marqueur et le **point le plus proche de la voie**.

- 3 niveaux (Facile / Moyen / Difficile) calculés à partir d'un score de « notoriété » ;
- filtres par commune (et par quartier, approximatif) ;
- statistiques locales, mode **Révision** (répétition espacée), mode **Exploration** (recherche + tap pour identifier une voie) ;
- installable (PWA) et utilisable hors ligne (données embarquées, tuiles mises en cache).

> ⚠ Le dépôt contient un **jeu de données de démonstration** (voies fictives « … Démo … »), qui sert à tester l'app.
> Pour avoir les vraies voies, générez les données (étape 2 ci-dessous). Un avertissement s'affiche sur l'accueil tant que ce n'est pas fait.

---

## 1. Installation

Prérequis : **Node.js ≥ 20** et **Python ≥ 3.11**.

```bash
npm install
python3 -m venv .venv && source .venv/bin/activate     # Windows : .venv\Scripts\activate
pip install -r scripts/requirements.txt
```

## 2. Générer les données réelles

```bash
python scripts/build_data.py          # ou : npm run data
```

Le script :

1. récupère le contour officiel de chaque commune (API `geo.api.gouv.fr`, avec repli sur la relation OSM) ;
2. télécharge via **Overpass** toutes les voies OSM nommées du secteur, **géométrie complète** ;
3. télécharge la **Base Adresse Nationale** du 95 et compte les adresses de chaque voie ;
4. découpe chaque tronçon par commune et **fusionne les tronçons d'une même voie dans une même commune**
   (une voie qui traverse deux communes donne deux entrées ; les petits débords sur la commune voisine sont ignorés) ;
5. calcule le score de notoriété et le niveau ;
6. écrit `public/data/streets.geojson` et `public/data/communes.geojson`, puis affiche un résumé
   (nombre de voies par commune et par niveau).

Les téléchargements sont mis en cache dans `scripts/.cache/`. Options :

| Option | Effet |
|---|---|
| `--refresh` | re-télécharge les sources (à faire pour mettre à jour OSM/BAN) |
| `--offline` | n'utilise que le cache (pour régler les seuils sans réseau) |
| `--config autre.toml` | autre fichier de configuration |

`npm run data:demo` régénère le jeu de démonstration (sans réseau).

### Régler la difficulté : `scripts/config.toml`

Score de notoriété (0 à 1) = somme pondérée de 4 critères :

| Critère | Source | Réglage |
|---|---|---|
| type de voie OSM | `highway=*` (primary > secondary > tertiary > residential > living_street/service) | `[notoriety.highway]` |
| longueur totale | après fusion, échelle logarithmique | `length_min_m`, `length_max_m` |
| type de nom | 1ᵉʳ mot : boulevard/avenue > rue > allée/impasse/sentier | `[notoriety.name_type]` |
| nombre d'adresses | BAN | `addresses_max` |

Poids dans `[notoriety.weights]`. Répartition dans `[levels]` : `easy_share = 0.20`, `medium_share = 0.40`
(le reste en Difficile), calculée par commune (`scope = "commune"`) ou sur tout le secteur (`"global"`).
Pour corriger une voie précise :

```toml
[[overrides]]
commune = "Pontoise"
name = "Rue Pierre Butin"
level = 1
```

Puis `python scripts/build_data.py --offline` (pas besoin de re-télécharger). Les statistiques sont liées à
l'identifiant de la voie (`<INSEE>-<nom>`) : elles sont conservées après une régénération.

Autres réglages utiles : `[filter] highways` (ajoutez `"footway"`, `"path"` pour les cheminements piétons nommés,
nombreux sur les dalles de Cergy-Préfecture), `exclude_name_patterns`, `min_clipped_length_m`,
et `[quartiers]` (rattachement au lieu OSM `place=suburb|quarter|neighbourhood` le plus proche).

## 3. Lancer l'application

```bash
npm run dev        # http://localhost:5173 ; --host permet de l'ouvrir depuis le téléphone sur le même Wi-Fi
npm test           # tests unitaires (distance, score, tirage, révision)
npm run build && npm run preview    # version de production (PWA active)
```

### Régler le jeu : `src/config.ts`

- `SCORING` : 100 pts sous `fullScoreDistance` (50 m), 0 pt au-delà de `zeroScoreDistance` (1 km),
  décroissance `linear` ou `ease` ; `successPoints` = seuil de réussite pour les stats et la révision (70).
- `GAME` : nombre de questions par défaut (10) et choix proposés.
- `REVIEW.intervalsDays` : intervalles de la répétition espacée (boîtes de Leitner). Une réponse ratée
  renvoie la voie en boîte 0 (à revoir tout de suite), une réussite la fait monter d'une boîte.
- `MAP.basemaps` : fonds de carte **sans noms de rues** et sans clé d'API — plan vectoriel OpenFreeMap
  (couches de texte retirées) et photos aériennes IGN ; un bouton sur la carte bascule de l'un à l'autre.
  Chacun a ses zooms de téléchargement hors ligne (`prefetchZooms`).
- `MAP` : zooms min/max, marge de `maxBounds`.

## 4. Déployer

Le site est statique (`dist/`). Les données sont dans `public/data/` : **régénérez-les et commitez-les avant de déployer**.

**Vercel** : importez le dépôt, framework « Vite » détecté (build `npm run build`, sortie `dist`). `vercel.json` empêche la mise en cache du service worker.

**Netlify** : importez le dépôt ; `netlify.toml` contient déjà la configuration. Ou en ligne de commande :
`npm run build && npx netlify deploy --prod --dir dist`.

HTTPS est nécessaire pour l'installation PWA (fourni par Vercel/Netlify). Sur le téléphone :
*Partager → Sur l'écran d'accueil* (iPhone) ou *menu → Installer l'application* (Android).

## Architecture

```
scripts/
  config.toml          communes, sources, filtres, notoriété, niveaux, forçages
  build_data.py        Overpass + contours + BAN → GeoJSON
  make_demo_data.py    jeu fictif (tests hors ligne)
public/data/
  streets.geojson      1 Feature = 1 voie fusionnée dans 1 commune (MultiLineString)
  communes.geojson     contours des communes (limites, maxBounds)
src/
  config.ts            réglages du jeu
  lib/geo.ts           distance au point le plus proche d'une polyligne
  lib/scoring.ts       barème
  lib/stats.ts         stats localStorage + répétition espacée
  lib/questions.ts     tirage des questions (partie / révision)
  components/MapView   carte, filtre tap / pinch, marqueur, surbrillance
  screens/             Accueil, Partie, Récapitulatif, Exploration, Statistiques
```

Format d'une voie :

```json
{
  "type": "Feature",
  "id": "95127-boulevard-de-l-oise",
  "geometry": { "type": "MultiLineString", "coordinates": [[[2.0412, 49.0401], [2.0455, 49.0398]]] },
  "properties": {
    "name": "Boulevard de l'Oise", "insee": "95127", "commune": "Cergy", "quartier": "Cergy-Préfecture",
    "kind": "boulevard", "highway": "primary", "length_m": 2140, "addresses": 35,
    "score": 0.82, "level": 1, "osm_ids": [123, 456]
  }
}
```

**Gestes sur la carte** : le marqueur n'est posé que par un vrai tap. Un geste à deux doigts (pinch) bloque
les taps pendant 500 ms. Un tap pendant que la carte bouge (glisser, inertie, animation) est ignoré.
Le double-tap pour zoomer est désactivé pendant les questions.

## Licences des données

© les contributeurs OpenStreetMap ([ODbL](https://www.openstreetmap.org/copyright)) ;
Base Adresse Nationale (Licence Ouverte 2.0) ; fonds de carte : plan © OpenFreeMap / OpenMapTiles, photos aériennes © IGN (Licence Ouverte 2.0).
Les attributions sont affichées sur la carte.
