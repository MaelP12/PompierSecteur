#!/usr/bin/env node
/**
 * Vérifie chaque voie de public/data/streets.geojson avec l'API Geocoding de Google Maps.
 *
 * Prérequis : une clé API Google (Geocoding API activée) dans la variable d'environnement
 * GOOGLE_MAPS_API_KEY. Exemple sous PowerShell :
 *     $env:GOOGLE_MAPS_API_KEY = "votre-clé"
 *     npm run verify:google
 *
 * Options :
 *     --limit N     ne teste que les N premières voies (pour essayer sans tout consommer)
 *     --refresh     ignore le cache et réinterroge Google
 *
 * Sorties (dossier verification/) :
 *     google_cache.json         réponses brutes de Google (évite de payer deux fois la même requête).
 *                               Les conditions Google limitent leur conservation : supprimez-le
 *                               une fois la vérification terminée (30 jours au plus).
 *     voies_verification.csv    si le fichier existe, ajoute (ou remplace) la colonne « google »
 *                               juste après « detail » ; sinon le crée avec les colonnes de base.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STREETS = path.join(ROOT, 'public/data/streets.geojson');
const OUT_DIR = path.join(ROOT, 'verification');
const CACHE = path.join(OUT_DIR, 'google_cache.json');
const CSV = path.join(OUT_DIR, 'voies_verification.csv');
const ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';
const CONCURRENCY = 5;
const FAR_M = 150;

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const REFRESH = args.includes('--refresh');
const KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!KEY) {
  console.error('Clé manquante : définissez GOOGLE_MAPS_API_KEY (voir l\'en-tête de ce script).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’'`-]/g, ' ').replace(/\bst\b/g, 'saint').replace(/\s+/g, ' ').trim();

function distPtSeg(p, a, b) {
  const R = 6371000 * Math.PI / 180, k = Math.cos(p[1] * Math.PI / 180);
  const P = [p[0] * k * R, p[1] * R], A = [a[0] * k * R, a[1] * R], B = [b[0] * k * R, b[1] * R];
  const dx = B[0] - A[0], dy = B[1] - A[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L)) : 0;
  return Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy);
}
const distToGeom = (p, g) =>
  Math.round(Math.min(...g.coordinates.flatMap((l) => l.slice(1).map((b, i) => distPtSeg(p, l[i], b)))));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(name, commune) {
  const params = new URLSearchParams({
    address: `${name}, ${commune}, France`,
    components: 'country:FR',
    region: 'fr',
    language: 'fr',
    key: KEY,
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    let body;
    try {
      const res = await fetch(`${ENDPOINT}?${params}`);
      body = await res.json();
    } catch {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (body.status === 'OVER_QUERY_LIMIT' || body.status === 'UNKNOWN_ERROR') {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (body.status === 'REQUEST_DENIED' || body.status === 'INVALID_REQUEST') {
      throw new Error(`Google refuse la requête (${body.status}) : ${body.error_message ?? ''}`);
    }
    // On ne garde que ce qui sert à la vérification.
    return {
      status: body.status,
      results: (body.results ?? []).slice(0, 3).map((r) => ({
        types: r.types,
        partial_match: !!r.partial_match,
        formatted_address: r.formatted_address,
        components: r.address_components.map((c) => ({ name: c.long_name, types: c.types })),
        location: r.geometry.location,
      })),
    };
  }
  throw new Error(`Google ne répond pas pour « ${name} » (${commune})`);
}

/** Traduit la réponse Google en un texte court pour la colonne « google ». */
function classify(feature, resp) {
  const { name, commune } = feature.properties;
  const r = resp.results[0];
  if (resp.status === 'ZERO_RESULTS' || !r) return 'absente : aucun résultat Google';
  const isStreet = r.types.includes('route') || r.types.includes('street_address');
  if (!isStreet) return `absente : Google renvoie seulement « ${r.formatted_address} »`;

  const comp = (type) => r.components.find((c) => c.types.includes(type))?.name ?? '';
  const route = comp('route');
  const city = comp('locality') || comp('postal_town') || comp('administrative_area_level_3');
  const d = distToGeom([r.location.lng, r.location.lat], feature.geometry);
  const approx = r.partial_match ? ', correspondance partielle' : '';

  if (norm(route) !== norm(name)) return `nom différent : « ${route} » (${city}) à ${d} m${approx}`;
  if (norm(city) !== norm(commune)) return `autre commune : ${city} à ${d} m${approx}`;
  if (d > FAR_M) return `confirmée mais à ${d} m du tracé${approx}`;
  return `confirmée à ${d} m${approx}`;
}

// ---------------------------------------------------------------------------
// CSV (format écrit par la vérification BAN : « ; », champs entre guillemets, BOM UTF-8)
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ';') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const writeCsv = (rows) => fs.writeFileSync(CSV, '﻿' + rows.map((r) => r.map(esc).join(';')).join('\n'));

function updateCsv(features, google) {
  const key = (commune, name) => `${commune}|${name}`;
  const byKey = new Map(features.map((f) => [key(f.properties.commune, f.properties.name), f.id]));
  if (!fs.existsSync(CSV)) {
    const rows = [['commune', 'voie', 'difficulte', 'google']];
    const LV = { 1: '1 – Facile', 2: '2 – Moyen', 3: '3 – Difficile' };
    for (const f of features) {
      if (google[f.id]) rows.push([f.properties.commune, f.properties.name, LV[f.properties.level], google[f.id]]);
    }
    writeCsv(rows);
    return;
  }
  const rows = parseCsv(fs.readFileSync(CSV, 'utf8').replace(/^﻿/, ''));
  const head = rows[0];
  const iCommune = head.indexOf('commune'), iVoie = head.indexOf('voie');
  let iGoogle = head.indexOf('google');
  if (iGoogle < 0) {
    iGoogle = head.indexOf('detail') >= 0 ? head.indexOf('detail') + 1 : head.length;
    for (const r of rows) r.splice(iGoogle, 0, '');
    head[iGoogle] = 'google';
  }
  for (const r of rows.slice(1)) {
    const id = byKey.get(key(r[iCommune], r[iVoie]));
    if (id && google[id]) r[iGoogle] = google[id];
  }
  writeCsv(rows);
}

// ---------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------
const features = JSON.parse(fs.readFileSync(STREETS, 'utf8')).features.slice(0, LIMIT);
fs.mkdirSync(OUT_DIR, { recursive: true });
const cache = !REFRESH && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const saveCache = () => fs.writeFileSync(CACHE, JSON.stringify(cache));

let next = 0, calls = 0, done = 0, fatal = null;
async function worker() {
  while (!fatal && next < features.length) {
    const f = features[next++];
    if (!cache[f.id]) {
      try {
        cache[f.id] = await geocode(f.properties.name, f.properties.commune);
      } catch (err) {
        fatal ??= err;
        return;
      }
      calls++;
      if (calls % 50 === 0) saveCache();
    }
    if (++done % 100 === 0) console.error(`${done}/${features.length}`);
  }
}
// Chaque worker attrape ses erreurs : on attend que toutes les requêtes en cours soient
// terminées avant de quitter (sinon Node peut planter sous Windows).
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
saveCache();
if (fatal) {
  console.error(`\n${fatal.message}`);
  console.error(`${calls} réponses déjà enregistrées dans le cache ; relancez le script une fois le problème réglé.`);
  process.exit(1);
}

const google = {};
const counts = {};
for (const f of features) {
  google[f.id] = classify(f, cache[f.id]);
  const k = google[f.id].split(/[ :]/)[0];
  counts[k] = (counts[k] ?? 0) + 1;
}
updateCsv(features, google);

console.log(`${features.length} voies, ${calls} requêtes Google envoyées (${features.length - calls} depuis le cache).`);
for (const [k, n] of Object.entries(counts)) console.log(`  ${k.padEnd(10)} ${n}`);
console.log(`Colonne « google » écrite dans ${path.relative(ROOT, CSV)}`);
