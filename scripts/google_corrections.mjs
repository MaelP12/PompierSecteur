#!/usr/bin/env node
/**
 * Corrige public/data/streets.geojson à partir des SEULES réponses Google
 * (verification/google_cache.json, produit par verify_google.mjs). La BAN n'est pas utilisée.
 *
 * Étape 1 — proposer :   npm run google:corrections
 *     Écrit verification/corrections_google.csv : une ligne par voie à supprimer, renommer
 *     ou vérifier, avec la raison. Vous pouvez éditer la colonne « action » (supprimer,
 *     renommer, garder) et « nouveau_nom » avant d'appliquer.
 *
 * Étape 2 — appliquer :  npm run google:corrections -- --apply
 *     Lit corrections_google.csv et modifie streets.geojson : supprime les voies « supprimer »,
 *     renomme les voies « renommer » (fusionne avec la voie de même nom si elle existe déjà).
 *     Les lignes « verifier » et « garder » ne changent rien.
 *     Après une régénération des données (npm run data), relancez seulement --apply :
 *     le fichier de corrections suffit, Google n'est pas réinterrogé.
 *
 * Règles (Google seul) :
 *   - confirmée     : Google connaît ce nom (au type et à l'orthographe près) à moins de 300 m,
 *                     ou plus loin mais dans la même commune            → rien
 *   - supprimer     : Google ne connaît ce nom que dans une autre commune, ou ne renvoie
 *                     rien d'approchant près de la voie
 *   - renommer      : Google renvoie à moins de 250 m une voie au nom équivalent mais écrit
 *                     autrement (type de voie, faute, prénom complet…) → nom de Google
 *   - verifier      : Google renvoie près de la voie un nom proche mais pas équivalent, ou
 *                     la voie est une place/un rond-point (Google les indexe mal) → rien
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STREETS = path.join(ROOT, 'public/data/streets.geojson');
const CACHE = path.join(ROOT, 'verification/google_cache.json');
const CORR = path.join(ROOT, 'verification/corrections_google.csv');
const APPLY = process.argv.includes('--apply');

const CONFIRM_M = 300;   // nom identique : distance max pour confirmer sans regarder la commune
const RENAME_M = 250;    // nom équivalent : distance max pour renommer
const NEAR_M = 50;       // nom sans rapport : en dessous, Google pointe bien au même endroit
const RELATED_M = 350;   // nom qui partage un mot (lieu-dit…) : en dessous, à vérifier plutôt que supprimer

const LV = { 1: '1 – Facile', 2: '2 – Moyen', 3: '3 – Difficile' };

// ---------------------------------------------------------------------------
// Comparaison de noms
// ---------------------------------------------------------------------------
const ABBR = {
  av: 'avenue', ave: 'avenue', bd: 'boulevard', bld: 'boulevard', pl: 'place', imp: 'impasse',
  parv: 'parvis', all: 'allee', che: 'chemin', chem: 'chemin', rte: 'route', sq: 'square',
  res: 'residence', st: 'saint', ste: 'sainte', gal: 'general', mal: 'marechal', dr: 'docteur',
  deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6', sept: '7', huit: '8', neuf: '9', dix: '10',
};
const TYPES = new Set(('rue avenue allee boulevard chemin place passage impasse clos cour cours sente ' +
  'sentier ruelle venelle villa square parvis esplanade mail promenade route quai carrefour traverse ' +
  'residence chaussee hameau galerie montee rampe voie pont port cite').split(' '));
// Lieux que le géocodeur Google range rarement comme des voies.
const PLACE_TYPES = new Set(['place', 'square', 'parvis', 'esplanade', 'carrefour', 'rond-point', 'mail']);
const STOP = new Set('de du des la le les l d a au aux et en'.split(' '));

function tokens(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .replace(/[’'‘`\-_.,/()]/g, ' ').split(/\s+/).filter(Boolean)
    .map((t) => ABBR[t] ?? t);
}
/** { type, words } : type de voie (1er mot) et mots distinctifs (sans articles, au singulier). */
function parse(name) {
  let t = tokens(name);
  let type = '';
  if (t[0] === 'rond' && t[1] === 'point') { type = 'rond-point'; t = t.slice(2); }
  else if (TYPES.has(t[0])) { type = t[0]; t = t.slice(1); }
  const words = t.filter((w) => !STOP.has(w)).map((w) => (w.length > 4 ? w.replace(/[sx]$/, '') : w));
  return { type, words };
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const wordEq = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && lev(a, b) <= 2);
const subset = (A, B) => A.every((a) => B.some((b) => wordEq(a, b)));
const exactly = (A, B) => A.join(' ') === B.join(' ');

/** Relation entre le nom OSM et un nom Google. */
function relation(osmName, gName) {
  const o = parse(osmName), g = parse(gName);
  if (!o.words.length || !g.words.length) return 'aucune';
  const sameType = o.type === g.type;
  if (sameType && exactly(o.words, g.words)) return 'identique';
  if (subset(o.words, g.words) && subset(g.words, o.words)) return 'equivalent';
  // Mots collés ou séparés (« Closbilles » / « Clos Billes »).
  if (o.words.join('') === g.words.join('')) return 'equivalent';
  // Type de voie ajouté ou retiré devant le nom (« Rue du Chemin Vert » / « Chemin Vert »).
  const full = (p) => (p.type ? [p.type, ...p.words] : p.words);
  for (const [a, b] of [[o.words, full(g)], [full(o), g.words]])
    if (subset(a, b) && subset(b, a)) return 'equivalent';
  // Google plus précis (« Rue Daubigny » → « Rue Charles Daubigny »), même type de voie.
  if (sameType && subset(o.words, g.words)) return 'equivalent';
  // Google sans un mot d'OSM (« Impasse Jean-Claude Chabanne » → « Impasse Claude Chabanne »).
  if (sameType && g.words.length >= 2 && o.words.length - g.words.length === 1 && subset(g.words, o.words))
    return 'equivalent';
  if (o.words.some((a) => g.words.some((b) => wordEq(a, b)))) return 'proche';
  return 'aucune';
}

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------
function distPtSeg(p, a, b) {
  const R = 6371000 * Math.PI / 180, k = Math.cos(p[1] * Math.PI / 180);
  const P = [p[0] * k * R, p[1] * R], A = [a[0] * k * R, a[1] * R], B = [b[0] * k * R, b[1] * R];
  const dx = B[0] - A[0], dy = B[1] - A[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L)) : 0;
  return Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy);
}
const distToGeom = (p, g) =>
  Math.round(Math.min(...g.coordinates.flatMap((l) => l.slice(1).map((b, i) => distPtSeg(p, l[i], b)))));

// ---------------------------------------------------------------------------
// Décision pour une voie, à partir de la réponse Google
// ---------------------------------------------------------------------------
const clean = (s) => s.replace(/’/g, "'").trim();

/** Noms candidats renvoyés par Google : la voie (route) et, pour un lieu, son nom. */
function candidates(feature, resp) {
  const out = [];
  for (const r of resp.results ?? []) {
    const d = distToGeom([r.location.lng, r.location.lat], feature.geometry);
    const city = r.components.find((c) => c.types.includes('locality'))?.name ?? '';
    const route = r.components.find((c) => c.types.includes('route'))?.name;
    if (route) out.push({ name: clean(route), d, city, src: 'route' });
    if (!r.types.includes('route')) {
      // Lieu (place, établissement…) : 1er segment de l'adresse, sans numéro.
      const first = clean(r.formatted_address.split(',')[0].replace(/^\d+\w?\s+/, ''));
      if (first && first !== route) out.push({ name: first, d, city, src: 'lieu' });
    }
  }
  return out;
}

function decide(feature, resp) {
  const { name, commune } = feature.properties;
  const kind = parse(name).type;
  const cands = candidates(feature, resp).map((c) => ({ ...c, rel: relation(name, c.name) }));
  const near = (rel, max) => cands.filter((c) => c.rel === rel && c.d <= max).sort((a, b) => a.d - b.d)[0];
  const show = (c) => `« ${c.name} »${c.city ? ` (${c.city})` : ''} à ${c.d} m`;

  // Nom identique ou équivalent tout près : confirmé.
  const same = near('identique', CONFIRM_M);
  if (same) return { action: 'confirmee', reason: `Google : ${show(same)}` };
  const sameFar = cands.find((c) => c.rel === 'identique');
  if (sameFar) {
    if (!sameFar.city || sameFar.city === commune)
      return { action: 'confirmee', reason: `Google : ${show(sameFar)} — position à vérifier` };
    return { action: 'supprimer', reason: `Google ne connaît ce nom qu'ailleurs : ${show(sameFar)}` };
  }

  const eq = near('equivalent', RENAME_M);
  if (eq && (!eq.city || eq.city === commune)) {
    if (eq.src === 'route' && !PLACE_TYPES.has(kind) && !eq.name.includes('.'))
      return { action: 'renommer', newName: eq.name, reason: `Google : ${show(eq)}` };
    return { action: 'verifier', reason: `Google : ${show(eq)} (lieu ou nom abrégé, non renommé)` };
  }

  const close = near('proche', RELATED_M) ?? near('equivalent', RELATED_M)
    ?? cands.filter((c) => c.d <= NEAR_M).sort((a, b) => a.d - b.d)[0];
  if (close) return { action: 'verifier', reason: `Google situe la voie sur ${show(close)}` };

  const best = cands.sort((a, b) => a.d - b.d)[0];
  const what = best ? `plus proche : ${show(best)}`
    : resp.results?.[0] ? `Google renvoie seulement « ${resp.results[0].formatted_address} »` : 'aucun résultat Google';
  // Google indexe mal les places et ronds-points : on ne les supprime pas sur sa seule absence.
  if (PLACE_TYPES.has(kind))
    return { action: 'verifier', reason: `Google ne connaît pas ce nom (${what}), mais les places et ronds-points y sont mal indexés` };
  return { action: 'supprimer', reason: `Google ne connaît pas ce nom ici (${what})` };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
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
  return rows.filter((r) => r.some(Boolean));
}

// ---------------------------------------------------------------------------
// Identifiant et type, comme build_data.py
// ---------------------------------------------------------------------------
const BUILD_ABBR = { st: 'saint', ste: 'sainte', gal: 'general', mal: 'marechal', av: 'avenue', ave: 'avenue',
  bd: 'boulevard', bld: 'boulevard', imp: 'impasse', pl: 'place', sq: 'square', che: 'chemin', rte: 'route' };
function normalize(name) {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'‘`\-_.,/()]/g, ' ');
  return s.split(/\s+/).filter(Boolean).map((t) => BUILD_ABBR[t] ?? t).join(' ');
}
const slugify = (n) => n.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const KINDS = ['rond point', ...TYPES, 'cite', 'sente', 'montee', 'rampe', 'port', 'pont'];
function kindOf(name) {
  const n = normalize(name);
  const k = KINDS.sort((a, b) => b.length - a.length).find((x) => n === x || n.startsWith(x + ' '));
  return k ? k.replace(' ', '-') : 'autre';
}

// ---------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------
const data = JSON.parse(fs.readFileSync(STREETS, 'utf8'));

if (!APPLY) {
  if (!fs.existsSync(CACHE)) {
    console.error('verification/google_cache.json introuvable : lancez d\'abord npm run verify:google.');
    process.exit(1);
  }
  const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const rows = [['action', 'commune', 'voie', 'nouveau_nom', 'difficulte', 'raison']];
  const counts = {};
  let missing = 0;
  for (const f of data.features) {
    const resp = cache[f.id];
    if (!resp) { missing++; continue; }
    const r = decide(f, resp);
    counts[r.action] = (counts[r.action] ?? 0) + 1;
    if (r.action !== 'confirmee')
      rows.push([r.action, f.properties.commune, f.properties.name, r.newName ?? '', LV[f.properties.level], r.reason]);
  }
  const order = { supprimer: 0, renommer: 1, verifier: 2 };
  rows.splice(1, rows.length, ...rows.slice(1).sort((a, b) =>
    order[a[0]] - order[b[0]] || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2])));
  fs.writeFileSync(CORR, '﻿' + rows.map((r) => r.map(esc).join(';')).join('\n'));
  console.log(counts);
  if (missing) console.log(`${missing} voies sans réponse Google dans le cache (ignorées).`);
  console.log(`Propositions écrites dans ${path.relative(ROOT, CORR)}.`);
  console.log('Relisez-les, puis appliquez : npm run google:corrections -- --apply');
  process.exit(0);
}

// --- Application ---
if (!fs.existsSync(CORR)) {
  console.error('verification/corrections_google.csv introuvable : lancez d\'abord npm run google:corrections.');
  process.exit(1);
}
const [head, ...lines] = parseCsv(fs.readFileSync(CORR, 'utf8').replace(/^﻿/, ''));
const col = (n) => head.indexOf(n);
const key = (commune, name) => `${commune}|${name}`;
const byKey = new Map(data.features.map((f) => [key(f.properties.commune, f.properties.name), f]));

const removed = new Set(), log = { supprimees: 0, renommees: 0, fusionnees: 0, introuvables: [] };
for (const r of lines) {
  const action = r[col('action')]?.trim().toLowerCase();
  if (action !== 'supprimer' && action !== 'renommer') continue;
  const f = byKey.get(key(r[col('commune')], r[col('voie')]));
  if (!f) { log.introuvables.push(`${r[col('commune')]} | ${r[col('voie')]}`); continue; }
  if (action === 'supprimer') { removed.add(f); log.supprimees++; continue; }
  const newName = r[col('nouveau_nom')]?.trim();
  if (!newName) continue;
  f.properties.name = newName;
  f.properties.kind = kindOf(newName);
  f.id = `${f.properties.insee}-${slugify(normalize(newName))}`;
  log.renommees++;
}

// Fusion des voies qui portent maintenant le même identifiant (même nom, même commune).
const kept = new Map();
for (const f of data.features) {
  if (removed.has(f)) continue;
  const other = kept.get(f.id);
  if (!other) { kept.set(f.id, f); continue; }
  const a = other.properties, b = f.properties;
  other.geometry.coordinates.push(...f.geometry.coordinates);
  a.length_m += b.length_m;
  a.addresses += b.addresses;
  a.osm_ids = [...new Set([...a.osm_ids, ...b.osm_ids])];
  a.level = Math.min(a.level, b.level);
  a.score = Math.max(a.score, b.score);
  if (b.highway !== a.highway && b.length_m > a.length_m) a.highway = b.highway;
  log.fusionnees++;
}
if (!log.supprimees && !log.renommees) {
  console.log('Rien à appliquer : streets.geojson est inchangé.');
  if (log.introuvables.length) console.log(`(${log.introuvables.length} lignes déjà appliquées ou voies absentes.)`);
  process.exit(0);
}
data.features = [...kept.values()];
data.metadata.count = data.features.length;
data.metadata.corrections = {
  source: 'Google Geocoding (verification/corrections_google.csv)',
  applied: new Date().toISOString().slice(0, 19) + '+00:00',
  removed: log.supprimees, renamed: log.renommees, merged: log.fusionnees,
};
fs.writeFileSync(STREETS, JSON.stringify(data));

console.log(`${log.supprimees} voies supprimées, ${log.renommees} renommées (${log.fusionnees} fusionnées avec une voie du même nom).`);
console.log(`${data.features.length} voies dans ${path.relative(ROOT, STREETS)}.`);
if (log.introuvables.length) {
  console.log(`${log.introuvables.length} lignes ignorées (voie absente du GeoJSON, déjà corrigée ?) :`);
  for (const l of log.introuvables) console.log(`  ${l}`);
}
