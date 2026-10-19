#!/usr/bin/env python3
"""Génère un jeu de données de DÉMONSTRATION (voies fictives) sans accès réseau.

Il fabrique de fausses réponses Overpass / contours / BAN dans un cache temporaire,
puis exécute le vrai pipeline build_data.py dessus. Sert à tester l'application
et le script ; les voies s'appellent « Rue Démo … » et l'app affiche un bandeau.

    python scripts/make_demo_data.py
"""

from __future__ import annotations

import gzip
import json
import random
import sys
import tempfile
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_data  # noqa: E402

# Rectangles approximatifs (lon_min, lat_min, lon_max, lat_max) : PAS les vrais contours.
BOXES = {
    "95127": (2.010, 49.020, 2.075, 49.055),  # Cergy
    "95500": (2.075, 49.030, 2.125, 49.070),  # Pontoise
    "95476": (2.020, 49.055, 2.075, 49.090),  # Osny
}
QUARTIERS = {
    "95127": ["Cergy-Préfecture", "Cergy-Saint-Christophe", "Cergy-le-Haut"],
    "95500": ["Centre", "Marcouville"],
    "95476": ["Centre-bourg", "Le Moulinard"],
}


def main() -> int:
    rnd = random.Random(95)
    cfg = tomllib.loads(build_data.DEFAULT_CONFIG.read_text("utf-8"))
    cache = Path(tempfile.mkdtemp(prefix="rues-demo-"))
    contours = {}
    for insee, (x0, y0, x1, y1) in BOXES.items():
        poly = {"type": "Polygon",
                "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}
        (cache / f"contour_{insee}.geojson").write_text(json.dumps(
            {"type": "Feature", "geometry": poly, "properties": {}}))
        contours[insee] = build_data.shape(poly)

    elements, ban_rows, wid = [], [], 1

    def way(name, hw, pts):
        nonlocal wid
        elements.append({"type": "way", "id": wid, "tags": {"name": name, "highway": hw},
                         "geometry": [{"lon": x, "lat": y} for x, y in pts]})
        wid += 1

    letters = "ABCDEFGHIJKLMNOP"
    for insee, (x0, y0, x1, y1) in BOXES.items():
        nom = next(c["nom"] for c in cfg["communes"] if c["insee"] == insee)
        for i, q in enumerate(QUARTIERS[insee]):
            elements.append({"type": "node", "id": 10**6 + wid + i,
                             "lon": x0 + (x1 - x0) * (i + 1) / (len(QUARTIERS[insee]) + 1),
                             "lat": (y0 + y1) / 2, "tags": {"place": "suburb", "name": q}})
            wid += 1
        # Deux boulevards traversants, découpés en tronçons (pour tester la fusion).
        for k, frac in enumerate((0.35, 0.7)):
            y = y0 + (y1 - y0) * frac
            xs = [x0 - 0.0005 + j * (x1 - x0 + 0.001) / 4 for j in range(5)]
            for j, (a, b) in enumerate(zip(xs, xs[1:])):
                way(f"Boulevard Démo {nom} {letters[k]}", "primary",
                    [(a, y + 0.0003 * j), (b, y + 0.0003 * (j + 1))])
        # Avenues nord-sud.
        for k in range(3):
            x = x0 + (x1 - x0) * (k + 1) / 4
            way(f"Avenue Démo {letters[k]}", "secondary" if k == 1 else "tertiary",
                [(x, y0 + 0.002), (x + 0.001, (y0 + y1) / 2), (x, y1 - 0.002)])
        # Rues de quartier, allées et impasses.
        for k in range(14):
            cx, cy = rnd.uniform(x0 + 0.003, x1 - 0.003), rnd.uniform(y0 + 0.003, y1 - 0.003)
            kind = rnd.choice(["Rue", "Rue", "Rue", "Allée", "Impasse", "Chemin", "Place"])
            ln = {"Impasse": 0.0015, "Allée": 0.002, "Place": 0.0008}.get(kind, 0.006)
            hw = {"Impasse": "residential", "Allée": "living_street"}.get(kind, "residential")
            name = f"{kind} Démo {nom} {k + 1}"
            if kind == "Place":
                d = ln / 2
                pts = [(cx - d, cy - d), (cx + d, cy - d), (cx + d, cy + d), (cx - d, cy + d),
                       (cx - d, cy - d)]
                hw = "pedestrian"
            else:
                ang = rnd.uniform(0, 3.14)
                pts = [(cx, cy), (cx + ln * build_data.math.cos(ang),
                                  cy + ln * 0.66 * build_data.math.sin(ang))]
            way(name, hw, pts)
            for n in range(rnd.randint(0, 60 if kind == "Rue" else 8)):
                ban_rows.append(f"x;;{n + 1};;{name};95000;{insee};{nom}")

    _, cache_name = build_data.osm_query(cfg, contours)
    (cache / cache_name).write_text(json.dumps({"elements": elements}))
    header = "id;id_fantoir;numero;rep;nom_voie;code_postal;code_insee;nom_commune"
    with gzip.open(cache / "ban.csv.gz", "wt", encoding="utf-8") as f:
        f.write(header + "\n" + "\n".join(ban_rows) + "\n")

    return build_data.main(["--offline", "--demo", "--cache-dir", str(cache)])


if __name__ == "__main__":
    sys.exit(main())
