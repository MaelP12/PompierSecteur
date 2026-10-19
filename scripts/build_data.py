#!/usr/bin/env python3
"""Génère les données de l'application « Rues du secteur ».

Étapes :
  1. contours des communes (geo.api.gouv.fr, repli : relation OSM via Overpass) ;
  2. voies nommées OSM du secteur (Overpass, géométrie complète) ;
  3. nombre d'adresses par voie (Base Adresse Nationale, optionnel) ;
  4. découpage des voies par commune, fusion des tronçons d'une même voie ;
  5. score de notoriété et niveau de difficulté (1 Facile, 2 Moyen, 3 Difficile) ;
  6. écriture de public/data/streets.geojson et public/data/communes.geojson.

Usage :
  python scripts/build_data.py                # télécharge (ou réutilise le cache) et génère
  python scripts/build_data.py --refresh      # force le re-téléchargement
  python scripts/build_data.py --offline      # n'utilise que le cache (scripts/.cache)
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import re
import sys
import time
import tomllib
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import requests
import shapely
from pyproj import Transformer
from shapely import ops
from shapely.geometry import LineString, MultiLineString, Point, mapping, shape
from shapely.geometry.base import BaseGeometry

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "scripts" / "config.toml"
DEFAULT_CACHE = ROOT / "scripts" / ".cache"
DEFAULT_OUT = ROOT / "public" / "data"
USER_AGENT = "rues-secteur-pompiers/1.0 (outil d'entrainement, usage personnel)"

TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
TO_WGS = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

ABBREVIATIONS = {
    "st": "saint", "ste": "sainte", "gal": "general", "mal": "marechal",
    "av": "avenue", "ave": "avenue", "bd": "boulevard", "bld": "boulevard",
    "imp": "impasse", "pl": "place", "sq": "square", "che": "chemin", "rte": "route",
}


def normalize(name: str) -> str:
    """Forme canonique d'un nom de voie pour comparer OSM et BAN."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[’'‘`\-_.,/()]", " ", s)
    tokens = [ABBREVIATIONS.get(t, t) for t in s.split()]
    return " ".join(tokens)


def slugify(norm_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", norm_name).strip("-")


def log_scale(value: float, lo: float, hi: float) -> float:
    if value <= lo:
        return 0.0
    if value >= hi:
        return 1.0
    return (math.log(value) - math.log(lo)) / (math.log(hi) - math.log(lo))


def to_l93(geom: BaseGeometry) -> BaseGeometry:
    return shapely.transform(geom, TO_L93.transform, interleaved=False)


def to_wgs(geom: BaseGeometry) -> BaseGeometry:
    return shapely.transform(geom, TO_WGS.transform, interleaved=False)


def round_coords(obj, ndigits: int):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(v, ndigits) for v in obj]
        return [round_coords(o, ndigits) for o in obj]
    return obj


def lines_of(geom: BaseGeometry) -> list[LineString]:
    """Extrait les LineString d'une géométrie quelconque (résultat d'intersection)."""
    if geom.is_empty:
        return []
    if isinstance(geom, LineString):
        return [geom]
    if hasattr(geom, "geoms"):
        out: list[LineString] = []
        for g in geom.geoms:
            out.extend(lines_of(g))
        return out
    return []  # points d'intersection isolés


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Téléchargements (avec cache)
# ---------------------------------------------------------------------------

class Fetcher:
    def __init__(self, cache_dir: Path, refresh: bool, offline: bool):
        self.cache_dir = cache_dir
        self.refresh = refresh
        self.offline = offline
        cache_dir.mkdir(parents=True, exist_ok=True)
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT

    def cached(self, name: str) -> Path:
        return self.cache_dir / name

    def _use_cache(self, path: Path) -> bool:
        if path.exists() and (self.offline or not self.refresh):
            return True
        if self.offline:
            raise FileNotFoundError(f"--offline : fichier absent du cache : {path}")
        return False

    def get_bytes(self, name: str, url: str, timeout: int = 120) -> bytes:
        path = self.cached(name)
        if self._use_cache(path):
            return path.read_bytes()
        log(f"  ↓ {url}")
        r = self.session.get(url, timeout=timeout)
        r.raise_for_status()
        path.write_bytes(r.content)
        return r.content

    def overpass(self, name: str, query: str, urls: list[str]) -> dict:
        path = self.cached(name)
        if self._use_cache(path):
            return json.loads(path.read_text("utf-8"))
        last_err: Exception | None = None
        for url in urls:
            for attempt in range(2):
                try:
                    log(f"  ↓ Overpass {url} (essai {attempt + 1})")
                    r = self.session.post(url, data={"data": query}, timeout=360)
                    if r.status_code in (429, 504):
                        raise requests.HTTPError(f"HTTP {r.status_code}")
                    r.raise_for_status()
                    data = r.json()
                    path.write_text(json.dumps(data), "utf-8")
                    return data
                except Exception as err:  # noqa: BLE001 - on essaie le serveur suivant
                    last_err = err
                    log(f"    échec : {err}")
                    time.sleep(5 * (attempt + 1))
        raise RuntimeError(f"Overpass indisponible : {last_err}")


# ---------------------------------------------------------------------------
# 1. Contours des communes
# ---------------------------------------------------------------------------

def contour_from_osm(fetcher: Fetcher, insee: str, urls: list[str]) -> BaseGeometry:
    query = (
        '[out:json][timeout:120];'
        f'relation["boundary"="administrative"]["admin_level"="8"]["ref:INSEE"="{insee}"];'
        "out geom;"
    )
    data = fetcher.overpass(f"contour_osm_{insee}.json", query, urls)
    rels = [e for e in data["elements"] if e["type"] == "relation"]
    if not rels:
        raise RuntimeError(f"Relation OSM introuvable pour la commune {insee}")
    rings = []
    for m in rels[0]["members"]:
        if m.get("type") == "way" and m.get("role") in ("outer", "") and "geometry" in m:
            rings.append(LineString([(p["lon"], p["lat"]) for p in m["geometry"]]))
    polys = list(ops.polygonize(ops.linemerge(rings)))
    if not polys:
        raise RuntimeError(f"Impossible de reconstruire le contour OSM de {insee}")
    return ops.unary_union(polys)


def load_contours(fetcher: Fetcher, cfg: dict) -> dict[str, BaseGeometry]:
    contours: dict[str, BaseGeometry] = {}
    for c in cfg["communes"]:
        insee = c["insee"]
        try:
            raw = fetcher.get_bytes(
                f"contour_{insee}.geojson",
                cfg["sources"]["commune_contour_url"].format(insee=insee),
            )
            gj = json.loads(raw)
            geom = shape(gj["geometry"] if gj.get("type") == "Feature" else gj)
        except Exception as err:  # noqa: BLE001
            log(f"  contour geo.api.gouv.fr indisponible pour {insee} ({err}), repli OSM")
            geom = contour_from_osm(fetcher, insee, cfg["sources"]["overpass_urls"])
        contours[insee] = geom.buffer(0)
        log(f"  contour {c['nom']} ({insee}) : OK")
    return contours


# ---------------------------------------------------------------------------
# 2. Voies OSM
# ---------------------------------------------------------------------------

def osm_query(cfg: dict, contours: dict[str, BaseGeometry]) -> tuple[str, str]:
    """Requête Overpass (voies nommées + lieux-quartiers) et nom du fichier de cache."""
    minx, miny, maxx, maxy = ops.unary_union(list(contours.values())).bounds
    pad = 0.003
    bbox = f"{miny - pad:.5f},{minx - pad:.5f},{maxy + pad:.5f},{maxx + pad:.5f}"
    hw = "|".join(cfg["filter"]["highways"])
    places = "|".join(cfg["quartiers"]["place_types"])
    query = (
        "[out:json][timeout:300];"
        f'way["highway"~"^({hw})$"]["name"]({bbox});'
        "out tags geom;"
        f'node["place"~"^({places})$"]["name"]({bbox});'
        "out tags center;"
    )
    # Le nom du cache dépend de la requête : modifier la config relance le téléchargement.
    return query, f"overpass_{hashlib.sha1(query.encode()).hexdigest()[:10]}.json"


def load_osm(fetcher: Fetcher, cfg: dict, contours: dict[str, BaseGeometry]) -> dict:
    query, cache_name = osm_query(cfg, contours)
    return fetcher.overpass(cache_name, query, cfg["sources"]["overpass_urls"])


# ---------------------------------------------------------------------------
# 3. Base Adresse Nationale
# ---------------------------------------------------------------------------

def load_ban(fetcher: Fetcher, cfg: dict, insees: set[str]) -> Counter | None:
    if not cfg["sources"].get("use_ban", True):
        return None
    try:
        raw = fetcher.get_bytes("ban.csv.gz", cfg["sources"]["ban_url"], timeout=300)
    except Exception as err:  # noqa: BLE001
        log(f"  BAN indisponible ({err}) : critère « adresses » ignoré")
        return None
    counts: Counter = Counter()
    seen: set[tuple] = set()
    with gzip.open(io.BytesIO(raw), "rt", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter=";"):
            insee = row.get("code_insee", "")
            if insee not in insees:
                continue
            numero = row.get("numero", "")
            if not numero or numero == "99999":  # toponyme sans numéro
                continue
            key = (insee, normalize(row.get("nom_voie", "")))
            uid = (key, numero, row.get("rep", ""))
            if uid in seen:
                continue
            seen.add(uid)
            counts[key] += 1
    log(f"  BAN : {sum(counts.values())} adresses, {len(counts)} voies")
    return counts


# ---------------------------------------------------------------------------
# 4. Découpage par commune et fusion
# ---------------------------------------------------------------------------

@dataclass
class Street:
    insee: str
    norm: str
    names: Counter = field(default_factory=Counter)        # nom d'origine -> longueur
    highways: Counter = field(default_factory=Counter)     # classe OSM -> longueur
    parts: list[LineString] = field(default_factory=list)
    osm_ids: set[int] = field(default_factory=set)
    clipped: bool = False
    geom: BaseGeometry | None = None
    length: float = 0.0
    addresses: int | None = None
    quartier: str | None = None
    kind: str = ""
    score: float = 0.0
    level: int = 3

    @property
    def name(self) -> str:
        return self.names.most_common(1)[0][0]


def build_streets(cfg: dict, osm: dict, contours_l93: dict[str, BaseGeometry]) -> dict:
    excl = [re.compile(p, re.I) for p in cfg["filter"]["exclude_name_patterns"]]
    streets: dict[tuple[str, str], Street] = {}
    n_ways = 0
    for el in osm["elements"]:
        if el["type"] != "way" or "geometry" not in el:
            continue
        tags = el.get("tags", {})
        name = tags.get("name", "").strip()
        if not name or any(p.search(name) for p in excl):
            continue
        if tags.get("access") == "private" and tags.get("highway") == "service":
            continue
        pts = [(p["lon"], p["lat"]) for p in el["geometry"] if p]
        if len(pts) < 2:
            continue
        n_ways += 1
        line = to_l93(LineString(pts))
        for insee, poly in contours_l93.items():
            if not line.intersects(poly):
                continue
            inside = poly.contains(line)
            pieces = [line] if inside else lines_of(line.intersection(poly))
            pieces = [p for p in pieces if p.length > 0.5]
            if not pieces:
                continue
            key = (insee, normalize(name))
            st = streets.setdefault(key, Street(insee=insee, norm=key[1]))
            piece_len = sum(p.length for p in pieces)
            st.parts.extend(pieces)
            st.names[name] += piece_len
            st.highways[tags.get("highway", "")] += piece_len
            st.osm_ids.add(el["id"])
            st.clipped |= not inside
    log(f"  {n_ways} tronçons OSM nommés → {len(streets)} voies (avant filtrage)")
    return streets


def merge_and_filter(cfg: dict, streets: dict, ban: Counter | None) -> list[Street]:
    fcfg = cfg["filter"]
    out: list[Street] = []
    for st in streets.values():
        merged = shapely.line_merge(ops.unary_union(st.parts))
        if fcfg["simplify_tolerance_m"] > 0:
            merged = merged.simplify(fcfg["simplify_tolerance_m"], preserve_topology=True)
        lines = lines_of(merged)
        if not lines:
            continue
        st.geom = MultiLineString(lines)
        st.length = st.geom.length
        if ban is not None:
            st.addresses = ban.get((st.insee, st.norm), 0)
        if st.length < fcfg["min_length_m"]:
            continue
        if st.clipped and st.length < fcfg["min_clipped_length_m"] and not st.addresses:
            continue  # simple débord d'une voie de la commune voisine
        out.append(st)
    return out


# ---------------------------------------------------------------------------
# Quartiers
# ---------------------------------------------------------------------------

def assign_quartiers(cfg: dict, osm: dict, streets: list[Street], contours_l93: dict) -> None:
    qcfg = cfg["quartiers"]
    if not qcfg.get("enabled", True):
        return
    places: dict[str, list[tuple[str, Point]]] = defaultdict(list)
    no_coords = 0
    for el in osm["elements"]:
        if el["type"] != "node" or "name" not in el.get("tags", {}):
            continue
        coords = el if "lon" in el else el.get("center")
        if not coords or "lon" not in coords:
            no_coords += 1
            continue
        pt = to_l93(Point(coords["lon"], coords["lat"]))
        for insee, poly in contours_l93.items():
            if poly.contains(pt):
                places[insee].append((el["tags"]["name"], pt))
    if no_coords:
        log(f"  {no_coords} lieux OSM sans coordonnées ignorés (supprimer le cache Overpass ?)")
    for st in streets:
        cands = places.get(st.insee)
        if not cands:
            continue
        center = ops.nearest_points(st.geom, st.geom.centroid)[0]
        name, d = min(((n, p.distance(center)) for n, p in cands), key=lambda t: t[1])
        if d <= qcfg["max_distance_m"]:
            st.quartier = name


# ---------------------------------------------------------------------------
# 5. Notoriété et niveaux
# ---------------------------------------------------------------------------

def name_kind(norm_name: str, table: dict) -> str:
    keys = sorted((normalize(k) for k in table if k != "default"), key=len, reverse=True)
    for k in keys:
        if norm_name == k or norm_name.startswith(k + " "):
            return k.replace(" ", "-")
    return "autre"


def compute_scores(cfg: dict, streets: list[Street], has_ban: bool) -> None:
    ncfg = cfg["notoriety"]
    opts = ncfg["options"]
    weights = dict(ncfg["weights"])
    if not has_ban:
        weights["addresses"] = 0.0
    total_w = sum(weights.values()) or 1.0
    hw_table = ncfg["highway"]
    nt_table = {normalize(k).replace(" ", "-"): v for k, v in ncfg["name_type"].items()}

    for st in streets:
        hw_vals = {h: hw_table.get(h, hw_table["default"]) for h in st.highways}
        if opts["highway_mode"] == "max":
            hw_score = max(hw_vals.values())
        else:
            tot = sum(st.highways.values()) or 1.0
            hw_score = sum(hw_vals[h] * length for h, length in st.highways.items()) / tot
        st.kind = name_kind(st.norm, ncfg["name_type"])
        components = {
            "highway": hw_score,
            "length": log_scale(st.length, opts["length_min_m"], opts["length_max_m"]),
            "name_type": nt_table.get(st.kind, nt_table["default"]),
            "addresses": log_scale(1 + (st.addresses or 0), 1, 1 + opts["addresses_max"]),
        }
        st.score = sum(weights[k] * v for k, v in components.items()) / total_w


def assign_levels(cfg: dict, streets: list[Street], communes: dict[str, str]) -> None:
    lcfg = cfg["levels"]
    groups: dict[str, list[Street]] = defaultdict(list)
    for st in streets:
        groups[st.insee if lcfg["scope"] == "commune" else "all"].append(st)
    for group in groups.values():
        group.sort(key=lambda s: s.score, reverse=True)
        n = len(group)
        n_easy = round(n * lcfg["easy_share"])
        n_medium = round(n * (lcfg["easy_share"] + lcfg["medium_share"]))
        for i, st in enumerate(group):
            st.level = 1 if i < n_easy else 2 if i < n_medium else 3

    by_name = {(communes[s.insee], s.norm): s for s in streets}
    for ov in cfg.get("overrides", []):
        st = by_name.get((ov["commune"], normalize(ov["name"])))
        if st is None:
            log(f"  ⚠ forçage ignoré, voie introuvable : {ov['name']} ({ov['commune']})")
        else:
            st.level = int(ov["level"])


# ---------------------------------------------------------------------------
# 6. Écriture
# ---------------------------------------------------------------------------

def write_outputs(cfg: dict, streets: list[Street], contours: dict, out_dir: Path,
                  has_ban: bool, demo: bool) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    prec = cfg["filter"]["coord_precision"]
    communes = {c["insee"]: c["nom"] for c in cfg["communes"]}
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    attribution = "© les contributeurs OpenStreetMap (ODbL)" + (
        ", Base Adresse Nationale (Licence Ouverte)" if has_ban else "")

    features = []
    streets.sort(key=lambda s: (communes[s.insee], s.name))
    for st in streets:
        geom = mapping(to_wgs(st.geom))
        features.append({
            "type": "Feature",
            "id": f"{st.insee}-{slugify(st.norm)}",
            "geometry": {"type": "MultiLineString",
                         "coordinates": round_coords(geom["coordinates"], prec)},
            "properties": {
                "name": st.name,
                "insee": st.insee,
                "commune": communes[st.insee],
                "quartier": st.quartier,
                "kind": st.kind,
                "highway": st.highways.most_common(1)[0][0],
                "length_m": round(st.length),
                "addresses": st.addresses,
                "score": round(st.score, 4),
                "level": st.level,
                "osm_ids": sorted(st.osm_ids),
            },
        })
    streets_fc = {
        "type": "FeatureCollection",
        "metadata": {"version": 1, "generated": generated, "attribution": attribution,
                     "demo": demo, "count": len(features)},
        "features": features,
    }
    (out_dir / "streets.geojson").write_text(
        json.dumps(streets_fc, ensure_ascii=False, separators=(",", ":")), "utf-8")

    commune_features = []
    for insee, geom in contours.items():
        simplified = to_wgs(to_l93(geom).simplify(5))
        g = mapping(simplified)
        commune_features.append({
            "type": "Feature", "id": insee,
            "geometry": {"type": g["type"], "coordinates": round_coords(g["coordinates"], prec)},
            "properties": {"insee": insee, "nom": communes[insee],
                           "bounds": [round(v, prec) for v in geom.bounds]},
        })
    (out_dir / "communes.geojson").write_text(json.dumps({
        "type": "FeatureCollection",
        "metadata": {"generated": generated, "demo": demo},
        "features": commune_features,
    }, ensure_ascii=False, separators=(",", ":")), "utf-8")


def print_summary(streets: list[Street], communes: dict[str, str]) -> None:
    table: dict[str, Counter] = defaultdict(Counter)
    for st in streets:
        table[communes[st.insee]][st.level] += 1
    log("\n  Commune        Facile  Moyen  Difficile  Total")
    for nom, c in sorted(table.items()):
        log(f"  {nom:<14}{c[1]:>6}{c[2]:>7}{c[3]:>11}{sum(c.values()):>7}")
    log("\n  Exemples Facile : " + ", ".join(
        s.name for s in sorted(streets, key=lambda s: -s.score)[:8]))


# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--refresh", action="store_true", help="re-télécharger les sources")
    ap.add_argument("--offline", action="store_true", help="utiliser uniquement le cache")
    ap.add_argument("--demo", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    cfg = tomllib.loads(args.config.read_text("utf-8"))
    communes = {c["insee"]: c["nom"] for c in cfg["communes"]}
    fetcher = Fetcher(args.cache_dir, args.refresh, args.offline)

    log("1/5 Contours des communes")
    contours = load_contours(fetcher, cfg)
    contours_l93 = {k: to_l93(v) for k, v in contours.items()}

    log("2/5 Voies OpenStreetMap")
    osm = load_osm(fetcher, cfg, contours)

    log("3/5 Base Adresse Nationale")
    ban = load_ban(fetcher, cfg, set(communes))

    log("4/5 Découpage par commune et fusion des tronçons")
    raw = build_streets(cfg, osm, contours_l93)
    streets = merge_and_filter(cfg, raw, ban)
    assign_quartiers(cfg, osm, streets, contours_l93)

    log("5/5 Notoriété et niveaux")
    compute_scores(cfg, streets, ban is not None)
    assign_levels(cfg, streets, communes)

    write_outputs(cfg, streets, contours, args.out, ban is not None, args.demo)
    print_summary(streets, communes)
    log(f"\n✔ {len(streets)} voies écrites dans {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
