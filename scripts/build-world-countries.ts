// Build the world-country polygon data files used by the globe.
//
// Two ship targets:
//   data/world-countries-50m.topo.json     — /explorer/ page (full)
//   data/world-countries-tile.topo.json    — splash tile (low-detail)
//
// Both are TopoJSON; both are derived from world-atlas's 1:50m source
// (Mike Bostock's canonical Natural Earth TopoJSON), with Antarctica
// substituted from world-atlas's 1:110m to avoid the 50m fragmenting
// the continent into ~100 ice-shelf pieces. The two outputs differ
// only in island-trim aggressiveness and simplification weight.
//
// Why ship two files instead of one:
//   * The /explorer/ page renders the globe at fullscreen (camera at
//     altitude 2.0, ~0.3° per pixel) so coastline detail is visible
//     and the user is making a deliberate visit — they can spend a
//     ~100 KB download budget on visual fidelity.
//   * The splash tile renders the same globe inside a ~240 px square
//     on the home page, where 1° lat ≈ 0.4 px. At that resolution
//     fine coastline detail just becomes high-frequency noise that
//     reads as "busy", not "detailed". Aggressive simplification
//     produces a cleaner, more aesthetic silhouette and ships in
//     ~25 KB gz — important because the splash is the first paint
//     of the site and the globe assets fetch in parallel with the
//     lightning reveal animation.
//
// Why TopoJSON, not GeoJSON:
//   Adjacent country borders share *arcs* in TopoJSON instead of
//   being expressed as independent coordinate sequences in each
//   neighbor. That guarantees adjacent edges are byte-identical
//   when decoded, which eliminates the floating-point sliver gaps
//   that the previous flat 110m GeoJSON dataset showed at country
//   borders (Kenya↔Somalia, France↔Germany, Argentina↔Chile, etc.).
//   It also halves the wire size — shared arcs aren't duplicated.
//   Globe.tsx decodes via topojson-client.feature() at runtime
//   (~10–30 ms on the main thread).
//
// We also write a sidecar GeoJSON file (NOT shipped to the browser —
// excluded from build.ts) so scripts/timeline/build-journey.py can
// keep computing country centroids without needing a Python TopoJSON
// decoder. The sidecar mirrors the FULL roster.
//
// Source: world-atlas (https://github.com/topojson/world-atlas)
//
// Run: bun run scripts/build-world-countries.ts

import { feature, quantize } from 'topojson-client';
import { topology as toTopology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Geometry, Feature } from 'geojson';

const SOURCE_URL = 'https://unpkg.com/world-atlas@2/countries-50m.json';
// Antarctica is a special case. At 1:50m, Natural Earth fragments it
// into ~100 small ice-shelf and continent pieces (none individually
// "looks like Antarctica"); at 1:110m it's one ~550-vertex polygon
// plus a handful of coastal islands, which renders cleanly under our
// flat-photo shader. Antarctica has no land neighbors, so swapping
// in the lower-resolution version doesn't break any shared borders.
const ANTARCTICA_SOURCE_URL = 'https://unpkg.com/world-atlas@2/countries-110m.json';

// Browser-shipped TopoJSON files. build.ts copies both into dist/data/.
const FULL_OUT_PATH = new URL('../data/world-countries-50m.topo.json', import.meta.url);
const TILE_OUT_PATH = new URL('../data/world-countries-tile.topo.json', import.meta.url);
// Build-time GeoJSON sidecar consumed by scripts/timeline/build-journey.py.
// Not copied into dist/data/ — never reaches the browser.
const GEO_OUT_PATH = new URL('../data/world-countries-50m.json', import.meta.url);

// world-atlas embeds Natural Earth's `NAME` field (short labels with
// abbreviations) rather than `NAME_LONG`. The rest of the codebase —
// VISITED_NAME_ALIASES in src/splash/Globe.tsx, the photo atlas
// generator — was authored against the long-form names, so we
// rewrite the short labels here to keep the public name surface
// stable. Anything not listed passes through unchanged.
const NAME_REMAP: Readonly<Record<string, string>> = {
  'Bahamas': 'The Bahamas',
  'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Central African Rep.': 'Central African Republic',
  'Congo': 'Republic of the Congo',
  "Côte d'Ivoire": 'Ivory Coast',
  'Dem. Rep. Congo': 'Democratic Republic of the Congo',
  'Dominican Rep.': 'Dominican Republic',
  'Eq. Guinea': 'Equatorial Guinea',
  'Falkland Is.': 'Falkland Islands',
  'Fr. S. Antarctic Lands': 'French Southern and Antarctic Lands',
  'N. Cyprus': 'Northern Cyprus',
  'S. Sudan': 'South Sudan',
  'Serbia': 'Republic of Serbia',
  'Solomon Is.': 'Solomon Islands',
  'Tanzania': 'United Republic of Tanzania',
  'Timor-Leste': 'East Timor',
  'W. Sahara': 'Western Sahara',
  'eSwatini': 'Swaziland',
};

console.log(`Fetching ${SOURCE_URL}…`);
console.log(`Fetching ${ANTARCTICA_SOURCE_URL} (Antarctica)…`);
const [topology, antTopology] = (await Promise.all([
  fetch(SOURCE_URL).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${SOURCE_URL}`);
    return r.json();
  }),
  fetch(ANTARCTICA_SOURCE_URL).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${ANTARCTICA_SOURCE_URL}`);
    return r.json();
  }),
])) as [
  Topology<{ countries: GeometryCollection<{ name: string }>; land: GeometryCollection }>,
  Topology<{ countries: GeometryCollection<{ name: string }>; land: GeometryCollection }>,
];

const countries = feature(topology, topology.objects.countries) as FeatureCollection<
  Geometry,
  { name: string }
>;
const antarcticaFeature = (
  feature(antTopology, antTopology.objects.countries) as FeatureCollection<
    Geometry,
    { name: string }
  >
).features.find((f) => f.properties.name === 'Antarctica');
if (!antarcticaFeature) throw new Error('Antarctica missing from 110m source');

// Polygon ring area via the shoelace formula. Lat/lng input is fine
// for relative comparisons within one country.
const ringArea = (ring: number[][]): number => {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i] as [number, number];
    const [x2, y2] = ring[(i + 1) % n] as [number, number];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

// Bbox key for matching a small enclave polygon to a hole in another
// country's polygon. Holes in Natural Earth are encoded as inner rings
// of the surrounding country's polygon and are filled by a separate
// small polygon belonging to whichever country actually owns that
// land. Tajikistan's Sokh enclave inside Uzbekistan is the canonical
// example: Uzbekistan's main polygon has a hole at lat 40.93..41.02,
// and a tiny 8-vertex Tajikistan polygon at the same bbox fills it.
// 4 decimals = ~11 m precision — tighter than the world-atlas source
// quantization, so identical-arc rings round to the same key.
const bboxKey = (ring: number[][]): string => {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of ring as [number, number][]) {
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  return `${xmin.toFixed(4)},${ymin.toFixed(4)},${xmax.toFixed(4)},${ymax.toFixed(4)}`;
};

// Walk every feature's polygons and collect the bboxes of every inner
// ring (hole). Returns a Set so trimIslands can preserve any small
// polygon whose outer ring matches one of these holes.
const collectHoleKeys = (features: typeof countries.features): Set<string> => {
  const keys = new Set<string>();
  for (const f of features) {
    const geom = f.geometry as { type: string; coordinates: unknown };
    const polys = geom.type === 'MultiPolygon'
      ? (geom.coordinates as number[][][][])
      : geom.type === 'Polygon'
        ? [geom.coordinates as number[][][]]
        : [];
    for (const poly of polys) {
      // Skip the outer ring (poly[0]); collect bboxes of holes (poly[1..]).
      for (let i = 1; i < poly.length; i++) {
        keys.add(bboxKey(poly[i]!));
      }
    }
  }
  return keys;
};

// Drop tiny outlying islands within MultiPolygon countries. Each
// country's polygons are compared against its own largest polygon;
// anything below `ratio` of the largest is dropped. Per-country
// relative threshold means archipelago nations (Solomon Islands,
// Vanuatu) keep their main territory regardless of how small it is
// in absolute terms.
//
// Crucial exception: a small polygon whose bbox matches a *hole* in
// another country's polygon is an enclave — it fills that hole, and
// dropping it would leave a visible gap (the dark sphere shows
// through). holeKeys (computed once across all features before any
// trimming) lists the bboxes of every hole in the dataset; matching
// polygons are preserved regardless of size.
const trimIslands = (
  g: Geometry,
  ratio: number,
  holeKeys: Set<string>,
  stats: { dropped: number; downgraded: number; preservedEnclaves: number },
): Geometry => {
  if (g.type !== 'MultiPolygon') return g;
  const polys = g.coordinates as number[][][][];
  if (polys.length <= 1) return g;
  const areas = polys.map((p) => ringArea(p[0]!));
  const maxArea = Math.max(...areas);
  const threshold = maxArea * ratio;
  const kept = polys.filter((p, i) => {
    if (areas[i]! >= threshold) return true;
    if (holeKeys.has(bboxKey(p[0]!))) {
      stats.preservedEnclaves++;
      return true;
    }
    return false;
  });
  if (kept.length === polys.length) return g;
  stats.dropped += polys.length - kept.length;
  if (kept.length === 1) {
    stats.downgraded++;
    return { type: 'Polygon', coordinates: kept[0]! };
  }
  return { type: 'MultiPolygon', coordinates: kept };
};

// Round each coordinate to a fixed decimal count. Stripping the
// float64 noise digits that JSON.stringify emits (a single coord can
// come out as `40.99540995409956` when the underlying TopoJSON
// precision was ~400 m) shrinks the GeoJSON sidecar significantly
// with zero practical effect. Apply uniformly so shared arcs across
// adjacent features still round to identical values.
// A GeoJSON coordinate tree: a number, or a list of them, nested to
// whatever depth the geometry kind needs (Position, LineString ring,
// Polygon, MultiPolygon).
type CoordNode = number | CoordNode[];

const roundGeom = (g: Geometry, decimals: number): Geometry => {
  const factor = 10 ** decimals;
  const map = (a: CoordNode): CoordNode =>
    Array.isArray(a) ? a.map(map) : Math.round(a * factor) / factor;
  return { ...g, coordinates: map((g as { coordinates: CoordNode }).coordinates) } as Geometry;
};

// Hole bboxes across the entire (post-Antarctica-substitution) dataset.
// Computed once; passed into every trimIslands call so enclave polygons
// matching another country's hole survive the trim.
const remappedForHoleScan = countries.features.map((f) => ({
  ...f,
  geometry: f.properties.name === 'Antarctica' ? antarcticaFeature.geometry : f.geometry,
}));
const HOLE_KEYS = collectHoleKeys(remappedForHoleScan);

// Apply name remap + Antarctica substitution + island trim. The
// returned features feed both the wire topology and the GeoJSON
// sidecar.
const remapFeatures = (
  raw: typeof countries.features,
  trimRatio: number,
  stats: { dropped: number; downgraded: number; preservedEnclaves: number },
): { features: Feature<Geometry, { name: string }>[]; renamed: number } => {
  let renamed = 0;
  const features = raw.map((f) => {
    const original = f.properties.name;
    const mapped = NAME_REMAP[original];
    if (mapped) renamed++;
    const sourceGeom = original === 'Antarctica' ? antarcticaFeature.geometry : f.geometry;
    return {
      type: 'Feature' as const,
      properties: { name: mapped ?? original },
      geometry: trimIslands(sourceGeom, trimRatio, HOLE_KEYS, stats),
    };
  });
  return { features, renamed };
};

// Build a wire-ready topology. trim → topology → presimplify →
// simplify → quantize. Quantization is last so it (a) gets to use the
// full pre-simplified arc structure for tighter shared-arc matching
// and (b) strips the weight 3rd-dim that presimplify attaches (its
// delta-encoder only writes (dx, dy) pairs).
type BuildOptions = {
  label: string;
  trimRatio: number;
  simplifyWeight: number;
  quantization: number;
};
const buildShippedTopology = (opts: BuildOptions): {
  topology: Topology<{ countries: GeometryCollection<{ name: string }> }>;
  stats: {
    polygonsDropped: number;
    countriesDowngraded: number;
    preservedEnclaves: number;
    verticesBefore: number;
    verticesAfter: number;
  };
} => {
  const trimStats = { dropped: 0, downgraded: 0, preservedEnclaves: 0 };
  const { features } = remapFeatures(countries.features, opts.trimRatio, trimStats);
  const fc: FeatureCollection<Geometry, { name: string }> = {
    type: 'FeatureCollection',
    features,
  };
  // Build un-quantized first so simplify weights are in degree²
  // (intuitive units), not in post-quantization integer units.
  const unq = toTopology({ countries: fc } as Parameters<typeof toTopology>[0]) as Topology<{
    countries: GeometryCollection<{ name: string }>;
  }>;
  const verticesBefore = unq.arcs.reduce((s, a) => s + a.length, 0);
  const presimplified = presimplify(unq) as typeof unq;
  const simplified = simplify(presimplified, opts.simplifyWeight) as typeof unq;
  const verticesAfter = simplified.arcs.reduce((s, a) => s + a.length, 0);
  const final = quantize(
    simplified as Parameters<typeof quantize>[0],
    opts.quantization,
  ) as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  return {
    topology: final,
    stats: {
      polygonsDropped: trimStats.dropped,
      countriesDowngraded: trimStats.downgraded,
      preservedEnclaves: trimStats.preservedEnclaves,
      verticesBefore,
      verticesAfter,
    },
  };
};

// =============================================================
// Wire targets
// =============================================================
//
// FULL (`world-countries-50m.topo.json`) — used by /explorer/.
// Calibrated for "max coastline detail under 100 KB gz" (the wire
// budget for a deliberate user-clicked page). 0.001 island ratio
// keeps Hawaii, Bermuda, Florida Keys, Channel Islands, etc.;
// simplify weight 1e-3 keeps Norwegian fjords, Greek archipelago
// detail, and most ria coastline crinkle.
const FULL_BUILD: BuildOptions = {
  label: 'FULL (/explorer/)',
  trimRatio: 0.001,
  // 5e-3 vs the previous 1e-3: drops to ~47% of source vertices.
  // Halves three-globe's polygon-mesh build cost on first paint
  // (~700 ms → ~350 ms on /explorer/), with ~30 km coastline detail
  // smoothed away — invisible at the explorer's altitude=2.0 camera
  // (~0.3°/pixel resolution).
  simplifyWeight: 5e-3,
  quantization: 1e4,
};

// TILE (`world-countries-tile.topo.json`) — used by the splash globe.
// The splash tile is ~240 px square (1° lat ≈ 0.4 px), so coastline
// detail finer than ~1° is visual noise. Aggressive trim drops every
// outlying island below 5 % of the country's largest (loses Hawaii,
// the Canaries, Tasmania, Sicily, Sardinia, Crete, Hokkaido — all
// invisible at tile scale anyway). Simplify weight 1e-1 collapses
// every triangle below ~0.3° linear (~1 px at the tile), giving
// clean continent silhouettes that read at-a-glance.
const TILE_BUILD: BuildOptions = {
  label: 'TILE (splash)',
  trimRatio: 0.05,
  simplifyWeight: 1e-1,
  quantization: 1e4,
};

const fullResult = buildShippedTopology(FULL_BUILD);
const tileResult = buildShippedTopology(TILE_BUILD);

// =============================================================
// GeoJSON sidecar (build-time only, not shipped)
// =============================================================
//
// Mirrors the FULL roster (with name remap + Antarctica sub +
// island trim at the FULL ratio) but skips the simplify and
// quantize steps. Used by scripts/timeline/build-journey.py to
// compute country centroids — full coordinate precision keeps
// centroid calculations honest.
const COORD_DECIMALS = 4;
const sidecarStats = { dropped: 0, downgraded: 0, preservedEnclaves: 0 };
const sidecarMapped = remapFeatures(
  countries.features,
  FULL_BUILD.trimRatio,
  sidecarStats,
);
const sidecarFC: FeatureCollection<Geometry, { name: string }> = {
  type: 'FeatureCollection',
  features: sidecarMapped.features.map((f) => ({
    ...f,
    geometry: roundGeom(f.geometry, COORD_DECIMALS),
  })),
};

// =============================================================
// Write everything and report
// =============================================================
await Bun.write(FULL_OUT_PATH, JSON.stringify(fullResult.topology));
await Bun.write(TILE_OUT_PATH, JSON.stringify(tileResult.topology));
await Bun.write(GEO_OUT_PATH, JSON.stringify(sidecarFC));

const fullBytes = await Bun.file(FULL_OUT_PATH).size;
const tileBytes = await Bun.file(TILE_OUT_PATH).size;
const geoBytes = await Bun.file(GEO_OUT_PATH).size;

const fmt = (b: number): string => `${(b / 1024).toFixed(1)} KB`;
console.log(`Renamed ${sidecarMapped.renamed} short labels to long forms.`);
console.log('');
console.log(`${FULL_BUILD.label}  →  ${FULL_OUT_PATH.pathname}`);
console.log(`  ratio=${FULL_BUILD.trimRatio}  weight=${FULL_BUILD.simplifyWeight}  quant=${FULL_BUILD.quantization}`);
console.log(`  ${fullResult.stats.polygonsDropped} sub-polygons trimmed; ${fullResult.stats.preservedEnclaves} enclaves preserved; ${fullResult.stats.countriesDowngraded} multi → single.`);
console.log(`  Simplified ${fullResult.stats.verticesBefore} → ${fullResult.stats.verticesAfter} vertices.`);
console.log(`  ${fmt(fullBytes)} raw`);
console.log('');
console.log(`${TILE_BUILD.label}  →  ${TILE_OUT_PATH.pathname}`);
console.log(`  ratio=${TILE_BUILD.trimRatio}  weight=${TILE_BUILD.simplifyWeight}  quant=${TILE_BUILD.quantization}`);
console.log(`  ${tileResult.stats.polygonsDropped} sub-polygons trimmed; ${tileResult.stats.preservedEnclaves} enclaves preserved; ${tileResult.stats.countriesDowngraded} multi → single.`);
console.log(`  Simplified ${tileResult.stats.verticesBefore} → ${tileResult.stats.verticesAfter} vertices.`);
console.log(`  ${fmt(tileBytes)} raw`);
console.log('');
console.log(`SIDECAR  →  ${GEO_OUT_PATH.pathname}  (${fmt(geoBytes)} raw, build-time only)`);
