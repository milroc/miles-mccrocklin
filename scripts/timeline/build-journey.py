#!/usr/bin/env python3
"""
Build data/journey.json from data/timeline.json.

One waypoint per timeline entry, in chronological order (oldest → newest).
Lat/lng come from each country's centroid in data/world-countries-50m.json;
microstates the mesh omits use hardcoded coordinates.

Output schema matches the existing journey.json (waypoints used by Globe.tsx
to draw arcs between consecutive stops).

Usage: scripts/timeline/build-journey.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TIMELINE = ROOT / "data" / "timeline.json"
GEO = ROOT / "data" / "world-countries-50m.json"
OUT = ROOT / "data" / "journey.json"

MONTH_INDEX = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}

# Been name → GeoJSON polygon name. Anything unmapped passes through.
NAME_ALIASES: dict[str, str] = {
    "Bahamas": "The Bahamas",
    "England": "United Kingdom",
    "Scotland": "United Kingdom",
    "Wales": "United Kingdom",
    "Northern Ireland": "United Kingdom",
}

# Microstates / city-states absent from the 110m mesh. Coordinates: capital
# city / well-known centre.
MICROSTATE_COORDS: dict[str, tuple[float, float]] = {
    # name : (lat, lng)
    "Gibraltar": (36.1408, -5.3536),
    "Liechtenstein": (47.166, 9.555),
    "San Marino": (43.9424, 12.4578),
    "Singapore": (1.3521, 103.8198),
    "Vatican": (41.9029, 12.4534),
}

# A few large/disjoint countries where the bounding-box centroid lands in an
# unhelpful place (mid-Pacific, Siberian wilderness, etc.). Override with a
# point closer to where the user actually visits.
CENTROID_OVERRIDES: dict[str, tuple[float, float]] = {
    "United States of America": (39.5, -98.35),  # geographic centre, lower 48
    "Russia": (55.75, 37.62),                    # Moscow
    "France": (46.6, 2.5),                       # mainland centre, ignores Guiana
    "Canada": (56.13, -106.35),
    "Australia": (-25.27, 133.78),
    "Brazil": (-10.0, -52.0),
    "United Kingdom": (54.0, -2.0),
    "China": (35.86, 104.20),
    "India": (22.0, 79.0),
}

def bbox_center(coords) -> tuple[float, float]:
    """Compute the centre of the bounding box of GeoJSON polygon coords.
    `coords` is a list of rings; we walk all coords, collecting min/max."""
    xs: list[float] = []
    ys: list[float] = []
    def walk(node):
        if isinstance(node, (list, tuple)) and node and isinstance(node[0], (int, float)):
            xs.append(node[0]); ys.append(node[1])
        elif isinstance(node, list):
            for c in node:
                walk(c)
    walk(coords)
    if not xs:
        raise ValueError("empty polygon")
    return ((min(ys) + max(ys)) / 2, (min(xs) + max(xs)) / 2)  # (lat, lng)

def largest_polygon(geom) -> list:
    """For MultiPolygon, return the polygon with the most coordinates (a proxy
    for the largest landmass — picks the contiguous mainland over outlying
    islands or overseas territories)."""
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        best = None
        best_n = -1
        for poly in geom["coordinates"]:
            n = sum(len(ring) for ring in poly)
            if n > best_n:
                best, best_n = poly, n
        return best
    raise ValueError(f"unexpected geometry type: {geom['type']}")

def build_centroid_index(geo_features) -> dict[str, tuple[float, float]]:
    idx: dict[str, tuple[float, float]] = {}
    for f in geo_features:
        name = f["properties"]["name"]
        try:
            poly = largest_polygon(f["geometry"])
            idx[name] = bbox_center(poly)
        except Exception as e:
            print(f"  warn: {name}: {e}", file=sys.stderr)
    return idx

def date_key(e) -> tuple[int, int]:
    return (int(e["startYear"]), MONTH_INDEX.get(e["startMonth"], 1))

def main() -> int:
    timeline = json.loads(TIMELINE.read_text())
    geo = json.loads(GEO.read_text())
    centroids = build_centroid_index(geo["features"])

    # Override after building from GeoJSON so we use the GeoJSON shape where
    # we don't have a manual override.
    for name, coord in CENTROID_OVERRIDES.items():
        centroids[name] = coord

    waypoints = []
    misses = []
    sorted_entries = sorted(timeline, key=date_key)
    for e in sorted_entries:
        country = e["country"]
        if country in MICROSTATE_COORDS:
            lat, lng = MICROSTATE_COORDS[country]
        else:
            mapped = NAME_ALIASES.get(country, country)
            if mapped not in centroids:
                misses.append(country)
                continue
            lat, lng = centroids[mapped]
        waypoints.append({
            "label": country,
            "lat": round(lat, 4),
            "lng": round(lng, 4),
            "startMonth": e["startMonth"],
            "startYear": e["startYear"],
            "endMonth": e["endMonth"],
            "endYear": e["endYear"],
            "kind": e["kind"],
        })

    out = {
        "$comment": (
            "Generated from data/timeline.json by "
            "scripts/timeline/build-journey.py. "
            "One waypoint per timeline entry, ordered chronologically by "
            "start month/year. Arcs draw between consecutive stops. "
            "Coordinates are country centroids (bbox of largest polygon) "
            "from world-countries-50m.json, with manual overrides for "
            "geographically sprawling countries."
        ),
        "waypoints": waypoints,
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(waypoints)} waypoints)", file=sys.stderr)
    if misses:
        print(f"missed: {misses}", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
