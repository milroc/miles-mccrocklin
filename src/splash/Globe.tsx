// Globe — react-globe.gl wrapper with server-safe shell + perf fallback.
//
// The Splash chrome (Splash.tsx) renders a static wireframe globe div.
// effects.tsx, after hydration, calls mountGlobe() to replace the
// static content with the live three.js globe (or a 2D d3-geo fallback
// under the perf threshold). The /explorer/ page calls mountGlobe()
// directly with fullscreen=true.
//
// react-globe.gl + three are dynamic-imported inside loadGlobeAssets()
// so the splash entry chunk doesn't pull three.js into its initial
// bundle.

import { SPLASH_CONFIG } from '../me';
import { canonicalVisitedNames, VISITED_NAME_ALIASES } from '../globe/visited-aliases';
import journeyData from '../../data/journey.json' with { type: 'json' };
// Type-only — three is dynamic-imported below. The `import type` form
// is erased at compile time, so it doesn't pull three into the splash
// entry chunk; we use it only for type annotations on cached state.
import type * as THREE_T from 'three';
import type { MultiPolygon, Polygon } from 'geojson';

interface Waypoint {
  label: string;
  lat: number;
  lng: number;
  startMonth?: string;
  startYear?: number;
  endMonth?: string;
  endYear?: number;
  kind?: 'visited' | 'lived';
}

interface JourneyJson {
  waypoints: Waypoint[];
}

// A single trip to a country. One waypoint = one Visit. Multiple visits
// per country are common (e.g. Mexico has six trips between 2001 and 2024).
export interface Visit {
  startMonth?: string;
  startYear?: number;
  endMonth?: string;
  endYear?: number;
  kind?: 'visited' | 'lived';
}

// Payload handed to onCountryClick. `entry` is null for countries the
// user visited but doesn't have photos for (e.g. The Bahamas — visit
// predates the digital archive). `visits` is always present for any
// country eligible to be clicked: the click flow gates on either an
// atlas entry OR at least one visit.
export interface CountrySelection {
  name: string;
  entry: AtlasEntry | null;
  visits: Visit[];
}

// Visited countries (post-alias). Built from journey.json's waypoint
// labels via the shared canonicalization in src/globe/visited-aliases.ts
// (UK constituents and Bahamas folded onto their atlas / 110m polygon
// names so membership tests against polygon names work; the same rule
// derives the splash placard's country count in
// scripts/build-splash-stats.ts). Used by polygonCapColor to paint
// visited countries that don't have a photo texture in the forest-green
// accent — currently just The Bahamas (1988–2001 visit predates the
// digital archive), but stays correct as new visits land before their
// albums do.
const WAYPOINTS: Waypoint[] = (journeyData as JourneyJson).waypoints;

const VISITED_COUNTRIES: ReadonlySet<string> = canonicalVisitedNames(
  WAYPOINTS.map((w) => w.label),
);

// Canonical country name → list of trips, in chronological order
// (journey.json is sorted that way). The panel reads this to show
// when each country was visited; multiple trips show as a list.
const VISITS_BY_COUNTRY: ReadonlyMap<string, readonly Visit[]> = (() => {
  const map = new Map<string, Visit[]>();
  for (const w of WAYPOINTS) {
    const name = VISITED_NAME_ALIASES[w.label] ?? w.label;
    const visit: Visit = {
      startMonth: w.startMonth,
      startYear: w.startYear,
      endMonth: w.endMonth,
      endYear: w.endYear,
      kind: w.kind,
    };
    const existing = map.get(name);
    if (existing) existing.push(visit);
    else map.set(name, [visit]);
  }
  return map;
})();

// Country→photo dataset, built by scripts/build-photo-atlas.ts from the
// portfolio at milesmccrocklin.myportfolio.com. Three render kinds:
//
//   polygon — country polygon textured with the primary album's first
//             photo (UV-mapped to the lat/lng bbox). One photo per
//             country; multi-album grids were dropped because users
//             read the cells as states/provinces.
//   bubble  — microstate not represented as a polygon in Natural Earth
//             110m (Singapore, Vatican, etc). Rendered as a circular
//             thumbnail anchored at lat/lng.
//   flat    — country polygon textured via a tangent-plane shader at
//             lat/lng instead of the geometry's UVs. Used when the
//             polygon's UV mapping distorts the photo (Antarctica
//             wraps around the south pole).
export interface AtlasAlbum {
  title: string;
  url: string;
  source_image_url?: string;
}
export type AtlasEntry =
  | {
      country: string;
      country_slug: string;
      render_kind: 'polygon';
      image: string;
      // Low-res variants of `image`, generated alongside it by
      // scripts/build-photo-atlas.ts. The splash uses `image_mid`
      // (768-edge, ~40-60 KB — sized for the near-viewport globe) with
      // `image_tile` (384-edge, ~15 KB) as fallback; /explorer/ uses
      // the full 2048-edge `image` (~26 MB total, drip-loaded).
      image_tile?: string;
      image_mid?: string;
      primary_album?: AtlasAlbum;
      secondary_albums?: AtlasAlbum[];
    }
  | {
      country: string;
      country_slug: string;
      render_kind: 'bubble' | 'flat';
      image: string;
      image_tile?: string;
      image_mid?: string;
      lat: number;
      lng: number;
      primary_album?: AtlasAlbum;
      secondary_albums?: AtlasAlbum[];
    };

// The bubble arm of the AtlasEntry union — the only entries handed to
// htmlElementsData, and the only ones carrying lat/lng.
type OverlayAtlasEntry = AtlasEntry & { render_kind: 'bubble' };

// Build arc data: connect each consecutive pair of waypoints. With N
// waypoints we produce N-1 segments. Each segment carries its position
// in the journey (`order`) so the dash animation can be phase-staggered
// by trip sequence — later trips trail earlier ones around the cycle.
//
// Smoke-trail aesthetic comes from `arcColor` returning a 2-element
// gradient `[startColor, endColor]` where the head is bright accent and
// the tail fades to transparent. react-globe.gl interpolates between
// the two so the dash sample at the start of the arc is bright and
// fades to invisible toward the end — the dash itself disperses as it
// travels. Cribbed from the airline-routes example in vasturiano's
// react-globe.gl docs:
// https://vasturiano.github.io/react-globe.gl/example/airline-routes/us-international-outbound.html
interface Arc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  label: string;
  order: number;
}

function buildArcs(waypoints: Waypoint[]): Arc[] {
  const arcs: Arc[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;
    arcs.push({
      startLat: a.lat,
      startLng: a.lng,
      endLat: b.lat,
      endLng: b.lng,
      label: `${a.label} → ${b.label}`,
      order: i,
    });
  }
  return arcs;
}

// three-globe uses GLOBE_RADIUS = 100 internally. We need this for any
// world-space math we do ourselves (tangent-plane projection for the
// 'flat' polygon shader, custom-layer mesh placement, etc.).
const GLOBE_RADIUS = 100;

// Altitude (in units of GLOBE_RADIUS) at which we render the country
// polygon caps. three-globe applies this as a uniform scale on the
// cap mesh, so the rendered vertices live at GLOBE_RADIUS * (1 + alt).
// Any world-space math that compares against rendered vertex positions
// must use this same scale or the result is off by 1%.
const POLYGON_ALTITUDE = 0.01;

// Slerp two [lng, lat] points on the unit sphere. Returns the
// interpolated [lng, lat] at parameter t ∈ [0, 1]. Used to subdivide
// polygon edges along great circles so the selection border curves
// with the globe instead of cutting chords through the sphere.
function slerpLngLat(
  a: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  const phA = (a[1] * Math.PI) / 180;
  const lnA = (a[0] * Math.PI) / 180;
  const phB = (b[1] * Math.PI) / 180;
  const lnB = (b[0] * Math.PI) / 180;
  const xA = Math.cos(phA) * Math.cos(lnA);
  const yA = Math.cos(phA) * Math.sin(lnA);
  const zA = Math.sin(phA);
  const xB = Math.cos(phB) * Math.cos(lnB);
  const yB = Math.cos(phB) * Math.sin(lnB);
  const zB = Math.sin(phB);
  const om = Math.acos(Math.max(-1, Math.min(1, xA * xB + yA * yB + zA * zB)));
  const so = Math.sin(om);
  if (so < 1e-10) return a;
  const sA = Math.sin((1 - t) * om) / so;
  const sB = Math.sin(t * om) / so;
  const x = xA * sA + xB * sB;
  const y = yA * sA + yB * sB;
  const z = zA * sA + zB * sB;
  const ln = Math.atan2(y, x);
  const ph = Math.atan2(z, Math.sqrt(x * x + y * y));
  return [(ln * 180) / Math.PI, (ph * 180) / Math.PI];
}

// Trace the outer ring of every (sub-)polygon in `feature` as a
// THREE.Line, projected onto a sphere of the given radius. Long edges
// are subdivided along the great circle so the border follows the
// globe's curvature. Uses the same lng→xyz formula as
// three-conic-polygon-geometry's `polar2Cartesian` so the line sits
// exactly above the rendered polygon cap, not a rotated copy of it.
function buildSelectionBorder(
  feature: { geometry: object },
  radius: number,
  THREE: typeof THREE_T,
  opacity: number = 1.0,
): THREE_T.Object3D {
  type Ring = Array<[number, number]>;
  const geom = feature.geometry as { type: string; coordinates: Ring[] | Ring[][] };
  const rings: Ring[] = [];
  if (geom.type === 'Polygon') {
    const c = geom.coordinates as Ring[];
    if (c[0]) rings.push(c[0]);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates as Ring[][]) {
      if (poly[0]) rings.push(poly[0]);
    }
  }
  const project = (lng: number, lat: number): THREE_T.Vector3 => {
    const ph = ((90 - lat) * Math.PI) / 180;
    const th = ((90 - lng) * Math.PI) / 180;
    return new THREE.Vector3(
      radius * Math.sin(ph) * Math.cos(th),
      radius * Math.cos(ph),
      radius * Math.sin(ph) * Math.sin(th),
    );
  };
  const MAX_SEG_DEG = 3;
  const group = new THREE.Group();
  for (const ring of rings) {
    const points: THREE_T.Vector3[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      points.push(project(a[0], a[1]));
      // Angular distance (radians → degrees)
      const phA = (a[1] * Math.PI) / 180;
      const phB = (b[1] * Math.PI) / 180;
      const dl = ((b[0] - a[0]) * Math.PI) / 180;
      const dotV =
        Math.sin(phA) * Math.sin(phB) + Math.cos(phA) * Math.cos(phB) * Math.cos(dl);
      const dDeg = (Math.acos(Math.max(-1, Math.min(1, dotV))) * 180) / Math.PI;
      if (dDeg > MAX_SEG_DEG) {
        const steps = Math.ceil(dDeg / MAX_SEG_DEG);
        for (let s = 1; s < steps; s++) {
          const mid = slerpLngLat(a, b, s / steps);
          points.push(project(mid[0], mid[1]));
        }
      }
    }
    // Close the loop visibly (LineLoop would do this but doesn't expose
    // dash/dotted state; stick with Line + explicit closing segment).
    if (points.length > 0) points.push(points[0].clone());
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    // Bright cream (--splash-canvas-fg-strong) reads against both the
    // dark canvas and the textured photos. Depth test stays ON so the
    // globe sphere (radius 100) occludes the line's back-hemisphere
    // portion — otherwise the outline ghosts through the planet on
    // countries facing away from the camera. We rely on the radial
    // offset (line at 101.4 vs cap at 101) plus renderOrder to win
    // against the polygon cap on the front-facing side without
    // disabling depth test.
    const material = new THREE.LineBasicMaterial({
      color: 0xece9e2,
      transparent: opacity < 1,
      opacity,
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 999;
    group.add(line);
  }
  return group;
}

// Perf threshold for falling back to 2D static globe. WebGL globe is
// expensive; on low-end Android we'd rather render the wireframe.
function shouldUse2DFallback(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const deviceMemory = nav.deviceMemory;
  const cores = navigator.hardwareConcurrency;
  if (typeof deviceMemory === 'number' && deviceMemory < 4) return true;
  if (typeof cores === 'number' && cores < 4) return true;
  // Reduced-motion → no auto-rotate (handled in mount), but still allow
  // the WebGL globe; user opted into the splash already.
  return false;
}

// Public globe-control surface returned to the page via options.onReady.
// Currently a single hook: kickIdleTimer() — Explorer pings this when
// the country modal closes so the 5s "resume rotate" timer runs from
// dismiss, matching the rule applied to drag/zoom interactions.
export interface GlobeControls {
  kickIdleTimer: () => void;
  // Highlights the selected country's photo cap (brightens + pulses).
  // Pass null to clear. Names that don't match a photo material are
  // silently ignored.
  setSelectedCountry: (name: string | null) => void;
  // User-level rotation lock. When locked, autoRotate stays off
  // permanently — kickIdleTimer no longer re-enables it after the 5s
  // idle window. Toggling unlock immediately resumes rotation.
  // Independent of the click/drag-driven idle pause/resume.
  setRotationLocked: (locked: boolean) => void;
  // Keyboard path into the exact same select flow the polygon click
  // uses (camera fly + onCountryClick). Names come from
  // visitableCountries(); unknown names are ignored.
  selectCountryByName: (name: string) => void;
  // Sorted names of every country the click flow accepts: photo-atlas
  // entries plus visited-only countries. Feeds Explorer's hidden
  // country index so the keyboard list can't drift from the globe.
  visitableCountries: () => string[];
}

interface MountGlobeOptions {
  // When true, fill the full mount rect with a non-square globe canvas
  // (used by the /explorer/ page). When false (default), the globe is a
  // centered square sized to min(rect.width, rect.height) and the
  // 2D-fallback perf check applies — used by the splash tile.
  fullscreen?: boolean;
  // Fires when a user clicks a country polygon that has a photo atlas
  // entry. Only invoked in fullscreen mode (the splash tile keeps
  // enablePointerInteraction off). Explorer uses this to open its
  // detail modal.
  onCountryClick?: (selection: CountrySelection) => void;
  // Called once the globe ref + OrbitControls are wired, handing back
  // a small control surface. Used by Explorer to ping the idle timer
  // when the modal dismisses.
  onReady?: (controls: GlobeControls) => void;
  // Microstate bubble markers (Gibraltar, Singapore, …) render at a
  // fixed 22px base size, so on very small mounts they dwarf the
  // sphere. Default true; the builder footer's 48px tile turns them
  // off.
  bubbles?: boolean;
}

// Cached country-feature view of the bundled world atlas. Narrowed to
// just the field we touch from JS — ConicPolygonGeometry consumes the
// full geometry directly without us peeking inside.
type CountryFeature = {
  type: 'Feature';
  properties: { name: string };
  geometry: CountryGeometry;
};

// Every country in the shipped topology is a Polygon or a MultiPolygon —
// scripts/build-world-countries.ts emits nothing else. Naming that lets
// bboxOf/polygonCentroid walk the rings without re-asserting the shape.
type CountryGeometry = Polygon | MultiPolygon;

// Shape of the TopoJSON file we ship for country polygons.
// topojson-client.feature() turns this into a FeatureCollection at
// runtime. Narrow typing matches what we actually pass through.
type TopoJsonRoot = {
  type: 'Topology';
  objects: { countries: { type: 'GeometryCollection'; geometries: unknown[] } };
  arcs: unknown[];
  transform?: unknown;
};

// Bundle of dynamic imports + decoded data + per-country materials
// that mountGlobe needs to render the globe. Built once per mount by
// loadGlobeAssets() below.
interface GlobeAssets {
  Globe: typeof import('react-globe.gl').default;
  createRoot: typeof import('react-dom/client').createRoot;
  React: typeof import('react');
  THREE: typeof import('three');
  countries: CountryFeature[];
  atlas: AtlasEntry[];
  // Country name → MeshBasicMaterial. Mutated as textures finish
  // decoding + uploading to GPU; mountGlobe re-renders once photosReady
  // resolves so the polygons' photo caps appear in a single second
  // beat after the bare sphere paints.
  // Country name → cap material. Always a ShaderMaterial in the new
  // lazy-load path: each country starts in a shimmer-loading state
  // (uHasPhoto = 0) and the texture is asynchronously swapped in
  // (uHasPhoto = 1) once the JPEG decodes. mountGlobe doesn't need to
  // re-render the polygon; the shader just reads the new uniforms.
  // 'flat' polygons (Antarctica) use a tangent-plane projection
  // instead of the geometry's UVs, but share the same shimmer machinery.
  photoMaterials: Map<string, THREE_T.Material>;
  // All ShaderMaterials with a uTime uniform. mountGlobe ticks them
  // in rAF so the shimmer animates smoothly.
  shimmerMaterials: THREE_T.ShaderMaterial[];
  // Fire the photo texture downloads. mountGlobe calls this AFTER
  // its stage-1 paint so the photo bytes don't compete with the JS
  // bundle and topology fetch on the critical path. Returns a promise
  // that resolves when every atlas entry has been processed (loaded,
  // errored, or skipped). Idempotent — repeat calls return the
  // in-flight promise. Options: `getRenderer` lets the pump pre-upload
  // each texture (renderer.initTexture) inside a measured frame budget
  // instead of letting the next render absorb the cost; `isBusy`
  // pauses the pump (e.g. mid-drag); `camera` orders loads
  // nearest-to-camera-first.
  loadPhotos: (opts?: {
    getRenderer?: () => THREE_T.WebGLRenderer | null;
    isBusy?: () => boolean;
    camera?: { lat: number; lng: number };
  }) => Promise<void>;
  // Explorer-only lazy full-res swaps (no-ops when the initial drip
  // already loaded the best variant). Upgrades countries whose
  // projected on-screen size exceeds the mid variant's resolution,
  // given the sphere's current apparent diameter in physical px.
  upgradePhotosForView: (lat: number, lng: number, spherePxNow: number, maxUpgrades: number) => void;
}

// Bbox summary of a country polygon: largest angular span (degrees)
// plus the bbox centroid. The span drives the splash texture-variant
// pick — a country's on-screen size scales with its angular extent, so
// small landmasses can take the 384 tile without visible softening.
// The centroid orders photo loads nearest-to-camera-first.
// Antimeridian-wrapping bboxes (Russia) inflate toward 360 — harmless,
// they clamp into the "big" bucket and their centroid is only used for
// load ordering.
function bboxOf(g: CountryGeometry): { extentDeg: number; lat: number; lng: number } {
  let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
  const visit = (ring: number[][]): void => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };
  if (g.type === 'Polygon') visit(g.coordinates[0] ?? []);
  else for (const poly of g.coordinates) visit(poly[0] ?? []);
  return {
    extentDeg: Math.max(maxLng - minLng, maxLat - minLat, 0),
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };
}

// Load the dynamic imports + topology + photo atlas + per-country
// materials that mountGlobe needs. Called once per page mount.
// spherePx: the globe sphere's projected diameter in physical pixels
// (CSS px × device pixel ratio), measured by mountGlobe. Sizes the
// per-country texture pick on the splash; 0 means "unknown" and falls
// back to the mid variant for everything.
async function loadGlobeAssets(fullscreen: boolean, spherePx: number): Promise<GlobeAssets> {
  return await (async () => {
    // Six independent imports run in parallel (async-parallel rule):
    // overlapping these network fetches saves ~1s on cold cache vs.
    // sequential await.
    // Geo + atlas data are fetched as raw JSON from /data/ instead of
    // imported. Dynamic-importing them with `with: { type: 'json' }`
    // makes the browser enforce a JSON MIME on the bundled JS chunk and
    // strict MIME checks reject it; dropping the assertion confuses
    // some parsers and is fragile across bundlers. Plain fetch is
    // honest about what's happening and ships the files as static
    // assets that GH Pages serves with the right content-type. build.ts
    // copies ./data → ./dist/data so these paths resolve in prod.
    // Country polygons: both surfaces now fetch the full 1:50m dataset
    // (~97 KB gz). The simplified tile variant existed for the old
    // 240px splash tile; the 2026-07 globe-anchor hero renders at
    // 500-720px, where the tile variant's chunky coastlines read as
    // artifacts. The fetch is off the critical path (parallel with the
    // reveal) and desktop-only, so the extra bytes are acceptable.
    // world-countries-tile.topo.json is no longer shipped to dist;
    // the generator still emits it in /data if a small-tile surface
    // ever returns.
    const polygonsUrl = '/data/world-countries-50m.topo.json';
    const [globeMod, reactDomClientMod, reactMod, THREE, topojsonClientMod, topology, atlas] = await Promise.all([
      import('react-globe.gl'),
      import('react-dom/client'),
      import('react'),
      import('three'),
      import('topojson-client'),
      fetch(polygonsUrl).then((r) => r.json() as Promise<TopoJsonRoot>),
      fetch('/data/photo-atlas.json').then((r) => r.json() as Promise<AtlasEntry[]>),
    ]);
    // Bun's dynamic-import namespace shape varies by source module: CJS
    // packages (react, react-dom/client, react-globe.gl) hide their named
    // exports under `.default`, while ESM packages (three) expose them
    // directly on the namespace. Unwrap defensively so the call sites
    // below see the same shape regardless of which form Bun produced.
    // A dynamic import hands back either the export itself or a namespace
    // hiding it behind `default` — which of the two Bun produces depends
    // on whether the package ships CJS or ESM.
    const unwrap = <T,>(mod: T | { default: T }): T => {
      if (mod && typeof mod === 'object' && 'default' in mod) {
        const inner = mod.default;
        // Objects and functions both count: react-globe.gl's default
        // export is a component function, the others are namespaces.
        if (inner && (typeof inner === 'object' || typeof inner === 'function')) {
          return inner;
        }
      }
      return mod as T;
    };
    const Globe = unwrap<typeof import('react-globe.gl').default>(globeMod);
    const reactDomClient = unwrap<typeof import('react-dom/client')>(reactDomClientMod);
    const React = unwrap<typeof import('react')>(reactMod);
    const topojsonClient = unwrap<typeof import('topojson-client')>(topojsonClientMod);
    const { createRoot } = reactDomClient;

    // Decode the shipped TopoJSON to a GeoJSON FeatureCollection.
    // Adjacent country borders share arcs in the source, so the
    // expanded coordinate sequences are byte-identical on both sides
    // of every shared border — no slivers, no holes.
    const decoded = topojsonClient.feature(
      topology as Parameters<typeof topojsonClient.feature>[0],
      topology.objects.countries as Parameters<typeof topojsonClient.feature>[1],
    );
    // feature() returns a bare Feature for a single geometry and a
    // FeatureCollection for a GeometryCollection; we always pass the
    // latter. Keep the features that carry the `name` every lookup here
    // indexes by, and the polygonal geometry the renderer needs — the
    // shipped topology has both on every country, so a drop means the
    // build produced something we don't know how to draw.
    const rawFeatures = 'features' in decoded ? decoded.features : [decoded];
    const countries: CountryFeature[] = rawFeatures.filter(
      (f): f is CountryFeature =>
        typeof f.properties?.name === 'string' &&
        (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'),
    );
    if (countries.length !== rawFeatures.length) {
      console.warn(
        `globe: skipped ${rawFeatures.length - countries.length} unnamed or non-polygon feature(s)`,
      );
    }

    // Per-country materials are created UPFRONT in a shimmer-loading
    // state (uHasPhoto = 0). Each country's texture lazily loads in the
    // background; on completion we mutate that material's uniforms in
    // place (uPhoto + uHasPhoto) so the polygon shader swaps from
    // shimmer to photo without re-rebuilding any meshes.
    //
    // photoMaterials is populated synchronously here (not asynchronously
    // as photos arrive), so the polygonCapMaterial accessor returns
    // a real material from frame zero.
    //
    // Bubble entries don't get a polygon material — they render via
    // HTML overlays. Pre-warm those via Image() so the first paint of
    // the bubble overlay isn't a blank circle.
    const textureLoader = new THREE.TextureLoader();
    // Prefer ImageBitmapLoader when the browser has createImageBitmap:
    // the JPEG decode happens off the main thread, so the upload pump
    // only pays the texImage2D cost, not decode + upload in one frame.
    // imageOrientation: 'flipY' bakes the vertical flip into the bitmap
    // itself — three.js ignores UNPACK_FLIP_Y_WEBGL for ImageBitmap
    // sources, so the texture's flipY must stay false on that path.
    const bitmapLoader = typeof createImageBitmap !== 'undefined'
      ? new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' })
      : null;
    const photoMaterials = new Map<string, THREE_T.Material>();
    // Tracked so mountGlobe's rAF can update each shader's uTime uniform
    // for the shimmer animation. ShaderMaterials only — MeshBasicMaterials
    // can't shimmer.
    const shimmerMaterials: THREE_T.ShaderMaterial[] = [];
    // 1×1 transparent placeholder so uPhoto is bound to a valid texture
    // before the real photo lands. Avoids "uniform sampler bound to
    // texture unit 0 but no texture" warnings on some drivers.
    const placeholderTex = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 0]),
      1, 1, THREE.RGBAFormat,
    );
    placeholderTex.needsUpdate = true;

    // Vertex/fragment shader pairs. All polygon-cap materials share the
    // same loading-state machine; only the UV sampling differs between
    // 'polygon' (geometry UVs) and 'flat' (tangent plane).
    //
    // The shimmer is a slow radial pulse emanating from each country's
    // centroid: muted canvas-fg (#7a7770) → cream canvas-fg-strong
    // (#ece9e2). Concentric rings travel outward like sonar — reads as
    // "loading" without shouting, and the per-country origin keeps the
    // editorial register intact instead of a single sheet sweep.
    const POLYGON_VS = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    const POLYGON_FS = `
      uniform sampler2D uPhoto;
      uniform float uHasPhoto;
      uniform float uTime;
      varying vec2 vUv;
      // Manual linear → sRGB encode for the framebuffer. three.js's
      // built-in materials get this via the <colorspace_fragment> chunk
      // appended at compile time when outputColorSpace is sRGB; custom
      // ShaderMaterial doesn't pick that up automatically. Without the
      // encode, linear texel values write straight to the framebuffer
      // (which is interpreted as sRGB by the display) and photos read
      // ~half their actual brightness.
      vec3 linearToSRGB(vec3 c) {
        vec3 lo = c * 12.92;
        vec3 hi = pow(max(c, vec3(0.0031308)), vec3(1.0 / 2.4)) * 1.055 - 0.055;
        return mix(hi, lo, lessThanEqual(c, vec3(0.0031308)));
      }
      void main() {
        if (uHasPhoto > 0.5) {
          // texture2D auto-decodes sRGB → linear (driven by tex.colorSpace).
          // We then encode linear → sRGB for the framebuffer ourselves.
          vec4 col = texture2D(uPhoto, vUv);
          gl_FragColor = vec4(linearToSRGB(col.rgb), col.a);
        } else {
          // Shimmer colors are already specified in sRGB display space,
          // so they pass through without re-encoding. Radial pulse from
          // the UV centroid (0.5, 0.5) — concentric rings travel outward.
          float r = length(vUv - vec2(0.5));
          float sweep = 0.5 + 0.5 * sin(r * 12.5664 - uTime * 1.6);
          vec3 muted = vec3(0.478, 0.467, 0.439);
          vec3 cream = vec3(0.925, 0.913, 0.886);
          gl_FragColor = vec4(mix(muted, cream, sweep), 1.0);
        }
      }
    `;
    const FLAT_VS = `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `;
    const FLAT_FS = `
      uniform sampler2D uPhoto;
      uniform float uHasPhoto;
      uniform float uTime;
      uniform vec3 uCenter;
      uniform vec3 uUAxis;
      uniform vec3 uVAxis;
      uniform float uHalfWidth;
      uniform float uHalfHeight;
      varying vec3 vWorldPos;
      // Linear → sRGB encode (see POLYGON_FS for rationale).
      vec3 linearToSRGB(vec3 c) {
        vec3 lo = c * 12.92;
        vec3 hi = pow(max(c, vec3(0.0031308)), vec3(1.0 / 2.4)) * 1.055 - 0.055;
        return mix(hi, lo, lessThanEqual(c, vec3(0.0031308)));
      }
      void main() {
        vec3 rel = vWorldPos - uCenter;
        float u = dot(rel, uUAxis) / uHalfWidth;
        float v = dot(rel, uVAxis) / uHalfHeight;
        if (uHasPhoto > 0.5) {
          vec4 col = texture2D(uPhoto, vec2(u, v) * 0.5 + 0.5);
          gl_FragColor = vec4(linearToSRGB(col.rgb), col.a);
        } else {
          // Radial pulse from the tangent-plane origin (the bbox
          // centroid in world space) — matches POLYGON_FS visually.
          float r = length(vec2(u, v));
          float sweep = 0.5 + 0.5 * sin(r * 6.2832 - uTime * 1.6);
          vec3 muted = vec3(0.478, 0.467, 0.439);
          vec3 cream = vec3(0.925, 0.913, 0.886);
          gl_FragColor = vec4(mix(muted, cream, sweep), 1.0);
        }
      }
    `;

    // Build the materials synchronously, register in photoMaterials,
    // and capture the work that the texture loads will need to do —
    // but DON'T fire the loads yet. mountGlobe calls loadPhotos()
    // after its first stage-1 paint, so the photo bytes don't
    // compete with the JS bundle and topology fetch on the
    // critical path.
    //
    // Splash texture variant, sized per country by projected on-screen
    // pixels. Big landmasses (Canada, Russia, Brazil) map their photo
    // across 300-400+ px on the desktop hero and need the 768-edge
    // `image_mid`; small countries render well under the 384 tile's
    // resolution, and on mobile (sphere ≈ 300 CSS px) nearly everything
    // does — so the same pixel math serves mobile lighter automatically.
    // The pick caps at `image_mid`: the 2048 originals never load in
    // the initial drip. /explorer/ starts from `image_mid` too and
    // upgrades individual countries to the 2048 original on demand
    // (click / zoom proximity — see upgradePhoto), so its zoomed-in
    // fidelity is unchanged while its load window stays smooth.
    const TILE_LONG_EDGE = 384; // matches scripts/build-photo-atlas.ts
    const MID_LONG_EDGE = 768;  // ditto
    const photoSrcOf = (entry: AtlasEntry, extentDeg: number): string => {
      if (fullscreen) return `/${entry.image_mid ?? entry.image}`;
      // Projected width ≈ chord of the country's angular extent on the
      // sphere silhouette. Take the tile only when it stays ≥1.25×
      // oversampled at that size — a texture stretched past its native
      // resolution reads soft, and mipmapped sampling looks crisper
      // with supersampling headroom than at 1:1.
      const projectedPx = spherePx * Math.sin((Math.min(extentDeg, 90) * Math.PI) / 360);
      const wantsTile = spherePx > 0 && projectedPx * 1.25 <= TILE_LONG_EDGE;
      const pick = wantsTile
        ? (entry.image_tile ?? entry.image_mid)
        : (entry.image_mid ?? entry.image_tile);
      return `/${pick ?? entry.image}`;
    };
    interface PhotoLoadJob {
      country: string;
      src: string;
      // 2048-edge original, set only when it differs from `src`
      // (i.e. fullscreen with a mid variant available). Loaded lazily
      // by upgradePhoto.
      fullSrc?: string;
      mat: THREE_T.ShaderMaterial;
      isFlat: boolean;
      flatBboxHalfWidth: number;
      flatBboxHalfHeight: number;
      // Country anchor for nearest-to-camera-first load ordering and
      // visibility gating of upgrades.
      lat: number;
      lng: number;
      // Largest angular bbox span — drives the projected-pixel test
      // that decides when the mid variant stops being enough.
      extentDeg: number;
    }
    const photoLoadJobs: PhotoLoadJob[] = [];
    // Counter for per-country polygonOffset bias. Every polygon (photo
    // and non-photo) renders at the same altitude — see polygonAltitude
    // in mountGlobe — so adjacent caps are coplanar and would z-fight
    // at borders without a bias. Each photo material gets a unique
    // negative polygonOffsetUnits so it (a) always wins the depth test
    // against the neighboring non-photo cap and (b) wins deterministically
    // against adjacent photo caps. Result: no flicker, no transparent
    // side-wall slivers (no side walls at all when altitude is uniform).
    let photoIdx = 0;
    for (const entry of atlas) {
      if (entry.render_kind === 'bubble') {
        // Bubbles render via the htmlElements pipeline (an <img> tag
        // in the DOM that the browser fetches itself with loading=lazy
        // + fetchPriority=low). No preload needed; bubbles are too
        // small to be on the critical path.
        continue;
      }
      const countryFeature = countries.find((f) => f.properties.name === entry.country);
      if (!countryFeature) {
        console.warn(`[Globe] no GeoJSON match for country "${entry.country}"`);
        continue;
      }

      const isFlat = entry.render_kind === 'flat';
      // Tangent-plane bbox half-extents for `flat` countries — derived
      // from the country's polygon vertices. The photo-load handler
      // uses these as the target rect to do aspect-cover sizing.
      let flatBboxHalfWidth = 0;
      let flatBboxHalfHeight = 0;
      let mat: THREE_T.ShaderMaterial;
      if (isFlat) {
        // Tangent-plane frame anchored at (entry.lat, entry.lng). For
        // Antarctica that's the south pole, so the projection onto
        // (uAxis, vAxis) is symmetric around a circumpolar polygon.
        // The lng→xyz formula must match three-conic-polygon-geometry's
        // `polar2Cartesian` exactly; otherwise the bbox is computed in a
        // frame rotated relative to the rendered mesh and the (u, v)
        // half-extents are swapped, causing texture wrap inside the
        // polygon.
        const polygonRadius = GLOBE_RADIUS * (1 + POLYGON_ALTITUDE);
        const phi = (90 - entry.lat) * Math.PI / 180;
        const theta = (90 - entry.lng) * Math.PI / 180;
        const anchor = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta),
        ).multiplyScalar(polygonRadius);
        const normal = anchor.clone().normalize();
        const refUp = new THREE.Vector3(0, 1, 0);
        let uAxis = new THREE.Vector3().crossVectors(refUp, normal);
        if (uAxis.lengthSq() < 1e-6) uAxis.set(0, 0, -1);
        uAxis.normalize();
        const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();

        // Walk the country polygon and find the bbox in tangent-plane
        // (u, v) coords. Sizes the photo rect to fit the country's
        // actual footprint instead of using a fixed-size card; the
        // rect's center sits at the bbox centroid in world space.
        const feature = countries.find((f) => f.properties.name === entry.country);
        let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
        if (feature) {
          const tmp = new THREE.Vector3();
          const project = (lng: number, lat: number) => {
            const ph = (90 - lat) * Math.PI / 180;
            const th = (90 - lng) * Math.PI / 180;
            tmp.set(
              Math.sin(ph) * Math.cos(th),
              Math.cos(ph),
              Math.sin(ph) * Math.sin(th),
            ).multiplyScalar(polygonRadius);
            const u = (tmp.x - anchor.x) * uAxis.x + (tmp.y - anchor.y) * uAxis.y + (tmp.z - anchor.z) * uAxis.z;
            const v = (tmp.x - anchor.x) * vAxis.x + (tmp.y - anchor.y) * vAxis.y + (tmp.z - anchor.z) * vAxis.z;
            if (u < uMin) uMin = u;
            if (u > uMax) uMax = u;
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
          };
          // GeoJSON: Polygon = [rings]; MultiPolygon = [polygons[rings]].
          // Rings are arrays of [lng, lat] pairs.
          type Ring = Array<[number, number]>;
          const geom = feature.geometry as { type: string; coordinates: Ring[] | Ring[][] };
          if (geom.type === 'Polygon') {
            for (const ring of geom.coordinates as Ring[]) {
              for (const [lng, lat] of ring) project(lng, lat);
            }
          } else if (geom.type === 'MultiPolygon') {
            for (const poly of geom.coordinates as Ring[][]) {
              for (const ring of poly) {
                for (const [lng, lat] of ring) project(lng, lat);
              }
            }
          }
        }
        // Fallback if the country wasn't in the world atlas (shouldn't
        // happen — earlier `countries.find` already gates this
        // branch — but keep the math safe).
        if (!Number.isFinite(uMin)) {
          uMin = -22; uMax = 22; vMin = -22; vMax = 22;
        }

        // Recenter on the bbox centroid (in world coords). The shader
        // samples `(vWorldPos - uCenter) · uAxis` so this offset just
        // shifts where (u=0, v=0) lands on the tangent plane.
        const cu = (uMin + uMax) / 2;
        const cv = (vMin + vMax) / 2;
        const center = anchor.clone()
          .add(uAxis.clone().multiplyScalar(cu))
          .add(vAxis.clone().multiplyScalar(cv));
        flatBboxHalfWidth = (uMax - uMin) / 2;
        flatBboxHalfHeight = (vMax - vMin) / 2;

        mat = new THREE.ShaderMaterial({
          uniforms: {
            uPhoto: { value: placeholderTex },
            uHasPhoto: { value: 0.0 },
            uTime: { value: 0.0 },
            uCenter: { value: center },
            uUAxis: { value: uAxis },
            uVAxis: { value: vAxis },
            // Pre-set to bbox extents so the shimmer fills the country
            // before the photo arrives. The photo-load handler does
            // aspect-cover sizing once the texture is decoded.
            uHalfWidth: { value: flatBboxHalfWidth },
            uHalfHeight: { value: flatBboxHalfHeight },
          },
          vertexShader: FLAT_VS,
          fragmentShader: FLAT_FS,
        });
      } else {
        mat = new THREE.ShaderMaterial({
          uniforms: {
            uPhoto: { value: placeholderTex },
            uHasPhoto: { value: 0.0 },
            uTime: { value: 0.0 },
          },
          vertexShader: POLYGON_VS,
          fragmentShader: POLYGON_FS,
        });
      }
      // Bias the depth value during rasterization so this photo cap
      // wins against the coplanar non-photo cap at every shared border,
      // and against adjacent photo caps via a unique units value.
      // factor=0 is critical: the slope-dependent component would
      // scale the bias by the polygon's depth-gradient, which is huge
      // for polygons near the sphere's silhouette and would punch
      // back-face caps through the globe sphere material.
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = 0;
      mat.polygonOffsetUnits = -1 - photoIdx;
      photoIdx++;

      photoMaterials.set(entry.country, mat);
      shimmerMaterials.push(mat);
      const bbox = bboxOf(countryFeature.geometry);
      const anchor = 'lat' in entry && 'lng' in entry
        ? (entry as AtlasEntry & { lat: number; lng: number })
        : bbox;
      const src = photoSrcOf(entry, bbox.extentDeg);
      photoLoadJobs.push({
        country: entry.country,
        src,
        fullSrc: fullscreen && src !== `/${entry.image}` ? `/${entry.image}` : undefined,
        mat,
        isFlat,
        flatBboxHalfWidth,
        flatBboxHalfHeight,
        lat: anchor.lat,
        lng: anchor.lng,
        extentDeg: bbox.extentDeg,
      });
    }

    // Idempotent. mountGlobe calls this from a requestAnimationFrame
    // after the stage-1 paint; the returned promise drives the stage-2
    // arc paint. On the splash path, photo bytes are ~2 MB total
    // (image_mid variants), desktop-only and off the critical path. On /explorer/ the full ~26 MB downloads
    // progressively while the user is already looking at geometry.
    // Texture-upload drip: when each JPEG finishes downloading +
    // decoding, we queue it for assignment instead of immediately
    // mutating `mat.uniforms.uPhoto.value`. A rAF pump drains the
    // queue under an explicit per-frame budget: renderer.initTexture()
    // performs the texImage2D + mipmap upload right there (instead of
    // hiding it in the next render), so the pump can measure the
    // elapsed time and stop pulling jobs once the budget is spent.
    // Effect: instead of a single ~1.3 s burst of 49 uploads (during
    // which the autoRotate animation freezes), uploads spread across
    // frames without ever blowing an individual frame's budget.
    // Shared texture pipeline. The pump machinery lives at assets
    // scope (not inside loadPhotos) so the /explorer/ on-demand
    // full-res upgrade path reuses the same queue, frame budget, and
    // drag-pause behavior as the initial drip.
    let pumpOpts: {
      getRenderer?: () => THREE_T.WebGLRenderer | null;
      isBusy?: () => boolean;
    } = {};
    interface Pending {
      tex: THREE_T.Texture;
      mat: THREE_T.ShaderMaterial;
      isFlat: boolean;
      flatBboxHalfWidth: number;
      flatBboxHalfHeight: number;
    }
    const queue: Pending[] = [];
    let pumpScheduled = false;
    // Half a 60 Hz frame: leaves headroom for three-globe's own
    // render work in the same tick. 768px textures fit 1-2 uploads.
    const UPLOAD_BUDGET_MS = 6;
    const applyJob = (job: Pending): void => {
        job.mat.uniforms.uPhoto.value = job.tex;
      job.mat.uniforms.uHasPhoto.value = 1.0;
      const img = job.tex.image as { width?: number; height?: number } | undefined;
      if (job.isFlat && img && img.width && img.height) {
        // Aspect-cover: photo fills the country's bbox while
        // preserving its own aspect ratio. The dimension that
        // would otherwise leave letterbox bands is expanded
        // beyond the bbox; the polygon clips the overflow so
        // visible pixels are always inside the photo.
        const photoAspect = img.width / img.height;
        const bboxAspect = job.flatBboxHalfWidth / job.flatBboxHalfHeight;
        if (photoAspect > bboxAspect) {
          job.mat.uniforms.uHalfHeight.value = job.flatBboxHalfHeight;
          job.mat.uniforms.uHalfWidth.value = job.flatBboxHalfHeight * photoAspect;
        } else {
          job.mat.uniforms.uHalfWidth.value = job.flatBboxHalfWidth;
          job.mat.uniforms.uHalfHeight.value = job.flatBboxHalfWidth / photoAspect;
        }
      }
    };
    const pumpOne = (): void => {
      pumpScheduled = false;
      if (pumpOpts.isBusy?.()) {
        // User is dragging — retry next frame, upload nothing now.
        schedulePump();
        return;
      }
      const renderer = pumpOpts.getRenderer?.() ?? null;
      const start = performance.now();
      let job = queue.shift();
      while (job) {
        // Upload now (decode already happened off-thread for the
        // ImageBitmap path), then flip the uniforms. Without a
        // renderer the assignment still works — the next render
        // just absorbs the upload like the old path did.
        renderer?.initTexture(job.tex);
        applyJob(job);
        if (performance.now() - start >= UPLOAD_BUDGET_MS) break;
        job = queue.shift();
      }
      if (queue.length > 0) schedulePump();
    };
    const schedulePump = (): void => {
      if (pumpScheduled) return;
      pumpScheduled = true;
      requestAnimationFrame(pumpOne);
    };

    // Fetch + decode one photo and hand it to the upload pump. `src`
    // is a parameter (not read off the job) so the same job can load
    // its mid variant during the drip and its full-res variant later.
    const loadOne = (
      { mat, isFlat, flatBboxHalfWidth, flatBboxHalfHeight }: PhotoLoadJob,
      src: string,
    ): Promise<void> =>
      new Promise<void>((resolve) => {
        const enqueue = (tex: THREE_T.Texture): void => {
          tex.colorSpace = THREE.SRGBColorSpace;
          // 8-tap anisotropic filtering: the sphere's surface is
          // oblique to the camera almost everywhere, and 4 taps
          // visibly blurs photo detail toward the limb.
          tex.anisotropy = 8;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          queue.push({ tex, mat, isFlat, flatBboxHalfWidth, flatBboxHalfHeight });
          schedulePump();
          resolve();
        };
        const fail = (): void => {
          console.warn(`[Globe] failed to load photo texture: ${src}`);
          resolve();
        };
        if (bitmapLoader) {
          bitmapLoader.load(
            src,
            (bitmap) => {
              const tex = new THREE.Texture(bitmap);
              // Flip is baked into the bitmap via imageOrientation;
              // flipY must stay false here (see bitmapLoader above).
              tex.flipY = false;
              tex.needsUpdate = true;
              enqueue(tex);
            },
            undefined,
            fail,
          );
        } else {
          textureLoader.load(
            src,
            (tex) => {
              tex.flipY = true;
              enqueue(tex);
            },
            undefined,
            fail,
          );
        }
      });

    // On-demand full-res upgrades (explorer). The initial drip loads
    // the cheap 768 mids so the load window stays smooth even on big
    // canvases; each country's 2048 original swaps in only once its
    // projected on-screen size outgrows what the mid can resolve —
    // the same landmass-size math the splash uses for its variant
    // pick, evaluated continuously against the live camera. Big
    // countries upgrade even at the resting pose on large monitors;
    // small countries never fetch the original at all (a country
    // spanning 4° of arc never exceeds 768 px on screen at any sane
    // zoom). Idempotent per country.
    const upgradedCountries = new Set<string>();
    const upgradePhoto = (job: PhotoLoadJob): void => {
      if (!job.fullSrc || upgradedCountries.has(job.country)) return;
      upgradedCountries.add(job.country);
      void loadOne(job, job.fullSrc);
    };
    const toRad = Math.PI / 180;
    const centralAngleDeg = (
      a: { lat: number; lng: number },
      b: { lat: number; lng: number },
    ): number =>
      Math.acos(Math.min(1, Math.max(-1,
        Math.sin(a.lat * toRad) * Math.sin(b.lat * toRad) +
        Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) *
        Math.cos((a.lng - b.lng) * toRad)))) / toRad;
    // Upgrade whatever the mid variant can no longer serve, given the
    // sphere's current apparent diameter in physical pixels.
    // 0.8 slack upgrades slightly before the crossover so the swap
    // lands ahead of the softness becoming visible. maxUpgrades paces
    // the trickle — each 2048 upload is a ~1-frame cost, so callers
    // meter a couple per check instead of bursting.
    const VISIBLE_HEMISPHERE_DEG = 60;
    const upgradePhotosForView = (
      lat: number,
      lng: number,
      spherePxNow: number,
      maxUpgrades: number,
    ): void => {
      let fired = 0;
      for (const job of photoLoadJobs) {
        if (fired >= maxUpgrades) return;
        if (!job.fullSrc || upgradedCountries.has(job.country)) continue;
        if (centralAngleDeg({ lat, lng }, job) > VISIBLE_HEMISPHERE_DEG) continue;
        const projectedPx = spherePxNow * Math.sin((Math.min(job.extentDeg, 90) * Math.PI) / 360);
        if (projectedPx > MID_LONG_EDGE * 0.8) {
          upgradePhoto(job);
          fired++;
        }
      }
    };

    let photosReadyPromise: Promise<void> | null = null;
    const loadPhotos = (opts: {
      getRenderer?: () => THREE_T.WebGLRenderer | null;
      // When true, the pump idles this frame (e.g. mid-drag) so
      // interaction keeps the full frame budget.
      isBusy?: () => boolean;
      // Initial camera anchor; photo loads sort nearest-first so the
      // visible hemisphere fills in before the far side.
      camera?: { lat: number; lng: number };
    } = {}): Promise<void> => {
      if (photosReadyPromise) return photosReadyPromise;
      pumpOpts = { getRenderer: opts.getRenderer, isBusy: opts.isBusy };
      const camera = opts.camera;
      // Nearest-to-camera-first: the countries the user is looking at
      // fill in first; the far side decodes while hidden.
      const ordered = camera
        ? [...photoLoadJobs].sort((a, b) => centralAngleDeg(camera, a) - centralAngleDeg(camera, b))
        : photoLoadJobs;

      // Bounded concurrency. Firing all ~49 fetch+decodes at once made
      // completions arrive in bursts that contended with the render
      // loop (worst on /explorer/'s 2048-edge JPEGs: decode workers
      // saturate the cores while the pump uploads). A small worker
      // pool keeps the network busy but spreads decode completions out
      // so the pump sees a steady trickle.
      const CONCURRENT_LOADS = 4;
      let nextJob = 0;
      const workers = Array.from(
        { length: Math.min(CONCURRENT_LOADS, ordered.length) },
        async () => {
          while (nextJob < ordered.length) {
            const job = ordered[nextJob];
            nextJob += 1;
            await loadOne(job, job.src);
          }
        },
      );
      photosReadyPromise = Promise.all(workers).then(() => {});
      return photosReadyPromise;
    };

    return { Globe, createRoot, React, THREE, countries, atlas, photoMaterials, loadPhotos, shimmerMaterials, upgradePhotosForView };
  })();
}

// Mount the live globe into the placeholder div. Returns a cleanup
// function. Called from effects.tsx after the reveal animation
// completes (splash) or directly from the explorer entry.
export async function mountGlobe(
  mountEl: HTMLElement,
  options: MountGlobeOptions = {},
): Promise<() => void> {
  const fullscreen = options.fullscreen ?? false;

  // THREE's WebGLRenderer throws during React's render when no WebGL
  // context is available — an error that never reaches this promise
  // chain, so the caller's .catch (and the explorer's failure state)
  // would never fire. Probe up front: a WebGL-less browser rejects
  // here on fullscreen surfaces and quietly keeps the wireframe on
  // tile surfaces.
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') ?? probe.getContext('webgl'))) {
    if (!fullscreen) return () => {};
    throw new Error('webgl-unavailable');
  }

  // Per locked plan: when globeReady is false, the SSR'd static
  // wireframe is the production state — no real arcs, no fake pins.
  // Real waypoints land before the flag flips. The /explorer/ page
  // bypasses the gate: it's a deliberate user click, not the splash
  // first-impression, so users opting in deserve the live globe.
  if (!SPLASH_CONFIG.globeReady && !fullscreen) {
    return () => { /* no-op cleanup; static globe stays */ };
  }

  // Same rationale for the perf fallback: tile-sized stays cautious;
  // the dedicated page assumes the user wants WebGL.
  if (!fullscreen && shouldUse2DFallback()) {
    return () => {};
  }

  // Dynamic imports + topology + photo-atlas + per-country materials.
  // Runs once per mount — JS bundle plus a topology fetch (~15 KB gz
  // tile for splash, ~50 KB gz full for /explorer/) plus the topojson
  // decode (~10–30 ms on main thread).
  // Sphere size in physical px for the texture-variant pick: the tile
  // canvas is 1.25× the mount (.globeMount inset -12.5%) and the
  // sphere subtends ~71.6% of the canvas at the resting altitude (see
  // the .wireLayer inset derivation in Splash.module.css — change the
  // altitude or oversize there, re-derive here).
  const mountRect = mountEl.getBoundingClientRect();
  const mountCssPx = fullscreen
    ? Math.max(mountRect.width, mountRect.height)
    : Math.min(mountRect.width, mountRect.height) || 240;
  const spherePx = mountCssPx * 1.25 * 0.716 * Math.min(2, window.devicePixelRatio || 1);
  const assets = await loadGlobeAssets(fullscreen, spherePx);
  const { Globe, createRoot, React, THREE, countries, atlas, photoMaterials, loadPhotos, shimmerMaterials, upgradePhotosForView } = assets;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Used to wait on document.fonts.ready before mounting so the first
  // measure captured the post-font-swap layout — but that blocks the
  // globe paint by 200-800ms while Google Fonts (JetBrains Mono)
  // resolves, which read as a noticeable load delay. Now we mount
  // immediately and let the ResizeObserver's settle window (400ms) +
  // 150ms debounce smooth out the handful of post-font-swap reflows.
  // The "7 discrete +2px" jitter the old guard prevented is invisible
  // in practice; the load wait was very visible.

  // Replace static content with the live globe. In tile mode the
  // canvas is a square sized to min(width, height) — if the mount is
  // non-square (mobile lays the explorer tile out at 16:10) react-
  // globe.gl anchors its canvas at the top-left, leaving a stripe of
  // empty space. Flex-centering the mount keeps the sphere visually
  // centered regardless of mount aspect.
  // Don't clear mountEl yet. The /explorer/ page renders a loading
  // wireframe inside it (and the splash a static globe div); leaving
  // those in place until the WebGL globe actually paints prevents a
  // ~1-second blank-screen window between "loader removed" and "first
  // polygon paint". We layer the WebGL mount on TOP of whatever's
  // there, then strip the loaders once the globe scene starts
  // showing real content (see canvasObserver below).
  // Make sure mountEl can host an absolutely-positioned child.
  if (getComputedStyle(mountEl).position === 'static') {
    mountEl.style.position = 'relative';
  }
  const reactMountEl = document.createElement('div');
  reactMountEl.style.position = 'absolute';
  reactMountEl.style.inset = '0';
  reactMountEl.style.width = '100%';
  reactMountEl.style.height = '100%';
  reactMountEl.style.display = 'flex';
  reactMountEl.style.alignItems = 'center';
  reactMountEl.style.justifyContent = 'center';
  // Transparent until first real paint, fading in over 200 ms once
  // the WebGL canvas has content underneath. The previous loaders
  // remain visible through the transparency until then.
  reactMountEl.style.opacity = '0';
  reactMountEl.style.transition = 'opacity 200ms ease';
  mountEl.appendChild(reactMountEl);

  const root = createRoot(reactMountEl);
  const arcs = buildArcs(WAYPOINTS);
  // Total phase spread across all arcs, in units of one dash cycle.
  // 1.5 means the last arc's animation is 1.5 cycles behind the first
  // — a clearly cascading wave rather than a single tight chase.
  const arcStaggerCycles = 1.5;
  const arcSpan = Math.max(1, arcs.length - 1);

  // Sizing: tile mode uses a centered square at min(width, height);
  // fullscreen uses the entire viewport rect so the sphere fills the
  // page. react-globe.gl needs explicit pixel dimensions. Round to
  // integers — getBoundingClientRect returns fractional pixels that
  // drift by a fraction during page settle (font swap, image loads),
  // and our resize-debounce equality check needs to short-circuit on
  // those subpixel blips, otherwise every load triggers a spurious
  // re-render that flickers the dash animation and rebuilds bubbles.
  function measure(): { width: number; height: number } {
    const r = mountEl.getBoundingClientRect();
    const w = Math.round(fullscreen ? r.width : Math.min(r.width, r.height)) || 240;
    const h = Math.round(fullscreen ? r.height : Math.min(r.width, r.height)) || 240;
    return { width: w, height: h };
  }
  let { width, height } = measure();

  // Globe sphere — solid dark, just one notch lighter than the canvas
  // mat (#1c1f1a) so the silhouette of the sphere is visible at the
  // limb but oceans still recede into the background. Editorial atlas
  // register: only land carries color.
  const globeMaterial = new THREE.MeshBasicMaterial({
    color: 0x232620,
  });

  // features + atlas + photoMaterials come from loadGlobeAssets above —
  // texture decode + material creation happened in parallel with the
  // reveal animation, so by the time we get here the materials are
  // already on the GPU and the first frame paints in one tick.
  // 'bubble' microstate thumbnails ride the htmlElements pipeline.
  // 'flat' polygons (Antarctica) render as a polygon cap with a custom
  // ShaderMaterial that samples the photo in screen-space — the photo
  // stays fixed on screen while the polygon moves over it, giving a
  // "window into a scene" parallax instead of stretching the texture
  // across a polygon that wraps the south pole.
  // An empty list when bubbles are off: the rest of the bubble plumbing
  // (scale rAF writes, selection querySelector) no-ops harmlessly on a
  // document with no bubble nodes.
  const overlayAtlasEntries = options.bubbles === false
    ? []
    : atlas.filter(
        (e): e is AtlasEntry & { render_kind: 'bubble' } => e.render_kind === 'bubble',
      );

  const globeRef = React.createRef<{
    controls: () => {
      autoRotate: boolean;
      autoRotateSpeed: number;
      // OrbitControls dolly limits — camera distance from globe center.
      minDistance: number;
      maxDistance: number;
      // OrbitControls.object is the camera; we read its position to
      // derive the current altitude for the bubble-scale calculation
      // in the rAF loop below.
      object?: { position: { length: () => number } };
      // OrbitControls extends EventDispatcher. We listen for 'start'
      // (user begins drag/zoom) to feed the idle-rotate timer.
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
    // three-globe's pointOfView is an overloaded accessor: no arguments
    // reads the current camera pose, one argument moves the camera.
    pointOfView: {
      (): { lat?: number; lng?: number; altitude?: number };
      (pov: { lat?: number; lng?: number; altitude?: number }, transitionMs?: number): void;
    };
    // The three.js renderer and camera behind the globe. Used for the
    // full-res texture-upgrade check, the shader precompile kick, and
    // the pixel-ratio cap on very large canvases.
    renderer?: () => THREE_T.WebGLRenderer;
    camera?: () => THREE_T.Camera;
    // Screen XY (relative to the globe canvas) → globe surface lat/lng,
    // or null if the ray misses the sphere. Used to find the country
    // under a click that landed on an arc mesh instead of the polygon.
    toGlobeCoords: (x: number, y: number) => { lat: number; lng: number } | null;
    // The underlying three.js scene. We attach the selection border
    // line mesh here directly — three-globe doesn't have a "highlight
    // one polygon" primitive, and polygonStrokeColor needs the stroke
    // mesh built at polygon-creation time (it's off for perf).
    scene: () => THREE_T.Scene;
  }>();

  // Country-name → atlas entry. Used by the click handler to look up
  // photo data when the user taps a polygon. Names match the polygon
  // properties.name keys (same source as photoMaterials).
  const atlasByName = new Map<string, AtlasEntry>(atlas.map((e) => [e.country, e]));

  // Idle-rotate manager. Any user interaction (polygon click, drag,
  // zoom, modal dismiss) pauses autoRotate immediately and starts a 5s
  // timer; when the timer fires without further interaction, autoRotate
  // resumes. The OrbitControls 'start' event covers drag + zoom; the
  // polygon click handler calls kickIdleTimer directly; Explorer pings
  // it via the GlobeControls surface on modal close.
  const IDLE_RESUME_MS = 5000;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  // User-level rotation lock. When true, kickIdleTimer's setTimeout
  // callback skips re-enabling autoRotate, so rotation stays off until
  // the user explicitly unlocks via setRotationLocked(false).
  let rotationLocked = false;
  function kickIdleTimer(): void {
    if (reduceMotion) return;
    const inst = globeRef.current;
    const controls = inst?.controls();
    if (controls) controls.autoRotate = false;
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (rotationLocked) return;
      const inst2 = globeRef.current;
      const controls2 = inst2?.controls();
      if (controls2) controls2.autoRotate = true;
    }, IDLE_RESUME_MS);
  }
  function setRotationLocked(locked: boolean): void {
    if (locked === rotationLocked) return;
    rotationLocked = locked;
    const inst = globeRef.current;
    const controls = inst?.controls();
    if (!controls) return;
    if (locked) {
      // Pause now; cancel any pending idle-resume so it doesn't kick
      // rotation back on at the 5s mark.
      controls.autoRotate = false;
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    } else {
      // Resume immediately. The next user interaction will reset the
      // idle timer through kickIdleTimer as usual.
      controls.autoRotate = true;
    }
  }

  // Selection border. `setSelectedCountry(name)` traces the country's
  // outer ring as a three.js Line at radius slightly above the polygon
  // cap and attaches it directly to the globe scene. Null clears it.
  // We use a custom mesh instead of three-globe's polygonStrokeColor
  // because that builds the stroke geometry at polygon-creation time
  // (off by default here for ~250 ms perf), and dynamic enabling
  // would require reflowing all 241 polygons.
  let selectedCountryName: string | null = null;
  let borderMesh: THREE_T.Object3D | null = null;
  let hoveredCountryName: string | null = null;
  let hoverBorderMesh: THREE_T.Object3D | null = null;
  function disposeMesh(mesh: THREE_T.Object3D | null): void {
    if (!mesh) return;
    const inst = globeRef.current;
    const scene = inst?.scene?.();
    if (scene) scene.remove(mesh);
    mesh.traverse((obj) => {
      const o = obj as THREE_T.Object3D & {
        geometry?: { dispose: () => void };
        material?: { dispose: () => void };
      };
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
  function disposeBorder(): void {
    disposeMesh(borderMesh);
    borderMesh = null;
  }
  function disposeHoverBorder(): void {
    disposeMesh(hoverBorderMesh);
    hoverBorderMesh = null;
  }
  // Toggle the `data-selected` attribute on the matching bubble DOM
  // node. Bubbles live in the document, created by three-globe via
  // htmlElementFn — querySelector reaches them regardless of which
  // container three-globe parents them under.
  function setBubbleSelection(name: string | null): void {
    document.querySelectorAll<HTMLElement>(
      '[data-splash-globe-bubble][data-selected="true"]',
    ).forEach((el) => { el.dataset.selected = 'false'; });
    if (!name) return;
    const el = document.querySelector<HTMLElement>(
      `[data-splash-globe-bubble][data-country="${CSS.escape(name)}"]`,
    );
    if (el) el.dataset.selected = 'true';
  }
  function isClickable(name: string): boolean {
    return atlasByName.has(name) || VISITED_COUNTRIES.has(name);
  }
  // Float the border slightly above the polygon cap to avoid z-fighting
  // with the textured surface. polygonAltitude = 0.01; add another 0.004
  // so the line sits about 0.4% of the globe radius above the photo.
  const BORDER_RADIUS = GLOBE_RADIUS * (1 + POLYGON_ALTITUDE + 0.004);
  function setSelectedCountry(name: string | null): void {
    // Eligible: any atlas entry (polygon, flat, or bubble) OR any
    // visited-only country (Bahamas etc — no photo album, but the
    // panel still has visit dates to show).
    const next = name && isClickable(name) ? name : null;
    if (next === selectedCountryName) return;
    selectedCountryName = next;
    disposeBorder();
    setBubbleSelection(next);
    // If the new selection is also currently hovered, drop the hover
    // ring — the full-opacity selection ring supersedes it. Otherwise
    // a previously-hovered polygon should keep its dim ring.
    if (next && next === hoveredCountryName) disposeHoverBorder();
    if (!next) return;
    // Bubbles have no polygon — only the CSS ring above applies.
    const feature = countries.find((f) => f.properties.name === next);
    if (!feature) return;
    const inst = globeRef.current;
    const scene = inst?.scene?.();
    if (!scene) return;
    borderMesh = buildSelectionBorder(feature, BORDER_RADIUS, THREE, 1.0);
    scene.add(borderMesh);
  }
  // Polygon hover affordance — only fires for clickable countries
  // (atlas + visited). Bubbles handle their own hover via CSS.
  function setHoveredCountry(name: string | null): void {
    const next = name && isClickable(name) && name !== selectedCountryName
      ? name
      : null;
    if (next === hoveredCountryName) return;
    hoveredCountryName = next;
    updateCanvasCursor();
    disposeHoverBorder();
    if (!next) return;
    const feature = countries.find((f) => f.properties.name === next);
    if (!feature) return;
    const inst = globeRef.current;
    const scene = inst?.scene?.();
    if (!scene) return;
    // 38% opacity reads as "hoverable" without competing with the full
    // cream of a selected country — same color family, lower weight.
    hoverBorderMesh = buildSelectionBorder(feature, BORDER_RADIUS, THREE, 0.38);
    scene.add(hoverBorderMesh);
  }

  // Point-in-polygon (ray-casting) in lng/lat space. Used by the
  // arc-click forwarder: when a user clicks a journey arc, we project
  // the screen click onto the globe surface and look up which country
  // polygon contains that point. The arcs themselves stay visually on
  // top, but clicks pass through to the country underneath. Crosses
  // the antimeridian without special handling — fine for the world
  // map at 1:50m where antimeridian-spanning countries (Russia, Fiji)
  // either don't matter for click targeting (Russia's far east is the
  // only span) or aren't in the visited set.
  function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (!a || !b) continue;
      const [xi, yi] = a;
      const [xj, yj] = b;
      const intersect = ((yi > lat) !== (yj > lat))
        && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function featureContains(feature: CountryFeature, lng: number, lat: number): boolean {
    const g = feature.geometry as
      | { type: 'Polygon'; coordinates: number[][][] }
      | { type: 'MultiPolygon'; coordinates: number[][][][] };
    if (g.type === 'Polygon') {
      const [outer, ...holes] = g.coordinates;
      if (!outer || !pointInRing(lng, lat, outer)) return false;
      return holes.every((h) => !pointInRing(lng, lat, h));
    }
    for (const poly of g.coordinates) {
      const [outer, ...holes] = poly;
      if (!outer || !pointInRing(lng, lat, outer)) continue;
      if (holes.every((h) => !pointInRing(lng, lat, h))) return true;
    }
    return false;
  }
  function findCountryAt(lng: number, lat: number): CountryFeature | null {
    for (const f of countries) {
      if (featureContains(f, lng, lat)) return f;
    }
    return null;
  }

  // Bbox centroid of a country polygon. Used to center the camera on
  // click when the atlas entry doesn't carry an explicit lat/lng
  // (i.e. render_kind === 'polygon'). Walks the outer rings of each
  // sub-polygon and averages min/max lng/lat. Crude but stable —
  // good enough for "frame the country" camera moves; a true
  // geo-centroid would buy nothing visible at globe scale.
  function polygonCentroid(g: CountryGeometry): { lat: number; lng: number } {
    let minLng = 180;
    let maxLng = -180;
    let minLat = 90;
    let maxLat = -90;
    const visit = (ring: number[][]): void => {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    };
    if (g.type === 'Polygon') {
      visit(g.coordinates[0] ?? []);
    } else {
      for (const poly of g.coordinates) visit(poly[0] ?? []);
    }
    return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  }

  // Stable accessor closures. These are passed as react-globe.gl props
  // and end up inside its internal useMemo / useEffect deps; building
  // a fresh arrow function on every renderGlobe() call would invalidate
  // those caches, re-run polygon material setup, reset arc dash state,
  // and rebuild bubble DOM nodes — all of which read as a visible
  // jitter when a resize triggers a re-render.
  // All polygons render on the same spherical shell. Layer ordering at
  // shared borders is handled by polygonOffset on the photo materials
  // (set in loadGlobeAssets), which biases their depth values so they
  // always win the depth test against neighboring non-photo caps and
  // against each other.
  const polygonCapMaterialFn = (d: CountryFeature): THREE_T.Material | undefined =>
    photoMaterials.get(d.properties.name);
  const polygonCapColorFn = (d: CountryFeature): string => {
    const name = d.properties.name;
    if (photoMaterials.has(name)) return 'rgba(0,0,0,0)'; // ignored when capMaterial is set, but keeps `hasCap` truthy
    if (VISITED_COUNTRIES.has(name)) return 'rgba(58, 107, 74, 0.78)'; // --splash-accent — visited but no photo (e.g. The Bahamas)
    return 'rgba(184, 181, 173, 0.55)'; // --canvas-fg @ ~55% — un-visited
  };
  // Side walls match the sphere material so any side wall that does
  // become visible at oblique angles blends with the sphere and reads
  // as a thin dark line at the polygon edge — same color as the
  // canvas behind the globe (#1c1f1a), so the eye doesn't catch a gap.
  const polygonSideColorFn = (): string => 'rgba(28, 31, 26, 1.0)';
  // Strokes (country borders) cost ~250 ms of polygon-mesh-build time
  // on /explorer/ first paint — three-globe creates a separate
  // GeoJsonGeometry line mesh per polygon. Returning false skips that
  // layer entirely. The polygon side walls (opaque, sphere-colored)
  // provide a thin dark line at oblique angles which reads similarly
  // enough at globe scale.
  const polygonStrokeColorFn = (): false => false;
  // Per-arc gradient for the smoke fade. The dash sample at the start
  // of the arc reads at full ARC_HEAD_ALPHA; by the end of the arc it's
  // sampling ARC_TAIL_ALPHA (basically zero). Result: each puff brightens
  // when it appears at the origin and disperses as it travels toward the
  // destination — built-in to react-globe.gl's arcColor when given a
  // [start, end] tuple.
  const arcColorFn = (): [string, string] => [
    'rgba(58, 107, 74, 0.55)', // head
    'rgba(58, 107, 74, 0.04)', // tail (~transparent)
  ];
  // Phase-stagger by journey order: the first arc starts at the cycle's
  // beginning; each subsequent arc trails the previous by
  // (arcStaggerCycles / arcSpan) of one dash cycle.
  const arcDashInitialGapFn = (d: Arc): number =>
    (d.order / arcSpan) * arcStaggerCycles;
  const htmlLatFn = (d: OverlayAtlasEntry): number => d.lat;
  const htmlLngFn = (d: OverlayAtlasEntry): number => d.lng;
  const htmlElementFn = (entry: OverlayAtlasEntry): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.dataset.splashGlobeBubble = 'true';
    wrap.title = entry.country;
    // data-country lets setSelectedCountry find this bubble's DOM node
    // to toggle the selection ring. The base CSS has pointer-events:
    // none so the splash tile stays inert; data-clickable="true" flips
    // it on for the fullscreen Explorer page.
    wrap.dataset.country = entry.country;
    if (fullscreen) {
      wrap.dataset.clickable = 'true';
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        selectAtlasEntry(entry.country);
      });
    }
    const img = document.createElement('img');
    // Bubbles render at 11-50 CSS px in both modes (see BUBBLE_*_PX),
    // so the 384-edge tile variant covers them with room to spare even
    // on retina. The full-res original used to load here on /explorer/
    // — a 2048-edge decode + raster per microstate for a thumbnail;
    // the detail panel loads the full-res image itself when opened.
    const tileSrc = entry.image_tile ?? entry.image_mid ?? entry.image;
    img.src = `/${tileSrc}`;
    img.alt = entry.country;
    // Eager, not lazy: lazy-loading made each bubble fetch + decode +
    // rasterize the moment rotation carried it into the viewport — a
    // one-frame hitch mid-spin, repeating as each microstate came
    // around. The tiles are ~15 KB each (a handful total), so loading
    // them all upfront is cheaper than five deferred hiccups;
    // fetchPriority stays low so they don't compete with anything.
    img.loading = 'eager';
    img.decoding = 'async';
    // Photos aren't critical-path: deprioritize behind any future
    // user-initiated nav. Modern Chrome/Safari honor this; older
    // browsers ignore the attribute harmlessly.
    (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
    wrap.appendChild(img);
    return wrap;
  };
  const htmlElementVisibilityModifierFn = (el: HTMLElement, isVisible: boolean): void => {
    el.style.opacity = isVisible ? '1' : '0';
  };

  // Click handler shared by polygon caps, microstate bubbles, and the
  // arc-forward fallback. Centers the camera on the country and fires
  // onCountryClick. Eligible names are atlas entries OR visited-only
  // countries (e.g. The Bahamas — visited but no photo album). Bubbles
  // store lat/lng directly; polygons either reuse the atlas entry's
  // curated lat/lng or fall back to a bbox centroid. pointOfView
  // altitude 1.1 lands the country roughly half the frame.
  function selectAtlasEntry(name: string, fallback?: { lat: number; lng: number }): void {
    const entry = atlasByName.get(name) ?? null;
    const visits = VISITS_BY_COUNTRY.get(name) ?? [];
    if (!entry && visits.length === 0) return;
    const target =
      entry && 'lat' in entry && 'lng' in entry
        ? { lat: entry.lat, lng: entry.lng }
        : fallback;
    const inst = globeRef.current;
    if (inst && target) {
      inst.pointOfView({ lat: target.lat, lng: target.lng, altitude: 1.1 }, 1200);
    }
    kickIdleTimer();
    options.onCountryClick?.({ name, entry, visits: [...visits] });
  }
  function selectCountry(feature: CountryFeature): void {
    const name = feature.properties.name;
    selectAtlasEntry(name, polygonCentroid(feature.geometry));
  }
  // GlobeControls.selectCountryByName — keyboard entry into the click
  // flow. Countries with a 110m polygon route through selectCountry
  // (centroid fallback); microstates without one (Singapore, Vatican)
  // fall through to selectAtlasEntry, whose bubble entry carries its
  // own lat/lng.
  function selectCountryByName(name: string): void {
    const feature = countries.find((f) => f.properties.name === name);
    if (feature) selectCountry(feature);
    else selectAtlasEntry(name);
  }
  // GlobeControls.visitableCountries — same eligibility set the click
  // handler gates on (atlas entry OR visited).
  function visitableCountries(): string[] {
    const names = new Set<string>([...atlasByName.keys(), ...VISITED_COUNTRIES]);
    return [...names].sort((a, b) => a.localeCompare(b));
  }
  // Hover fires with the polygon under the cursor (or null when the
  // cursor leaves a polygon entirely). Drives a dim cream outline on
  // clickable countries so users know which polygons respond.
  const polygonHoverFn = (poly: CountryFeature | null): void => {
    const name = poly ? poly.properties.name : null;
    setHoveredCountry(name);
  };
  // Custom click detection. We bypass three-globe's onPolygonClick /
  // onArcClick entirely because three-render-objects flips
  // isPointerDragging=true on *any* mousemove during press and (with
  // its default clickAfterDrag: false) silently drops the click. Even
  // 1 px of natural hand-tremor cancels a click on a mouse, which read
  // as "have to click multiple times to open a country."
  //
  // Instead: listen for pointerdown/pointerup on mountEl, allow up to
  // 5 px of movement and 600 ms between them, then raycast via
  // toGlobeCoords + point-in-polygon. Same path the old arc-click
  // forwarder used. Bubble overlays handle their own clicks; we ignore
  // pointer events whose target is inside a [data-splash-globe-bubble].
  const CLICK_PIXEL_TOLERANCE = 5;
  const CLICK_TIME_MS = 600;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let pointerDownTime = 0;
  let pointerDownActive = false;
  // Whether the current press has crossed the drag threshold. Drives
  // the `grabbing` cursor — we don't show it until the user actually
  // starts moving, so a plain click doesn't flicker through `grabbing`.
  let isDragging = false;
  const isBubbleTarget = (target: EventTarget | null): boolean =>
    !!(target instanceof Element && target.closest('[data-splash-globe-bubble]'));
  // Canvas cursor reflects: grabbing during a drag, pointer over a
  // clickable polygon (atlas + visited), grab over everything else.
  // Bubbles set their own cursor via CSS (pointer when data-clickable).
  function updateCanvasCursor(): void {
    if (!fullscreen) return;
    const canvas = mountEl.querySelector('canvas') as HTMLElement | null;
    if (!canvas) return;
    const next = isDragging
      ? 'grabbing'
      : hoveredCountryName
        ? 'pointer'
        : 'grab';
    if (canvas.style.cursor !== next) canvas.style.cursor = next;
  }
  const handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (isBubbleTarget(e.target)) {
      pointerDownActive = false;
      return;
    }
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    pointerDownTime = performance.now();
    pointerDownActive = true;
    isDragging = false;
    // Don't flip to `grabbing` yet — wait until the user actually moves.
    // A plain click should never show the drag cursor.
  };
  const handlePointerMove = (e: PointerEvent): void => {
    if (!pointerDownActive || isDragging) return;
    const dx = Math.abs(e.clientX - pointerDownX);
    const dy = Math.abs(e.clientY - pointerDownY);
    if (dx > CLICK_PIXEL_TOLERANCE || dy > CLICK_PIXEL_TOLERANCE) {
      isDragging = true;
      updateCanvasCursor();
    }
  };
  const handlePointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const wasActive = pointerDownActive;
    pointerDownActive = false;
    const wasDragging = isDragging;
    isDragging = false;
    updateCanvasCursor();
    if (!wasActive) return;
    if (isBubbleTarget(e.target)) return;
    if (wasDragging) return;
    const dx = Math.abs(e.clientX - pointerDownX);
    const dy = Math.abs(e.clientY - pointerDownY);
    if (dx > CLICK_PIXEL_TOLERANCE || dy > CLICK_PIXEL_TOLERANCE) return;
    if (performance.now() - pointerDownTime > CLICK_TIME_MS) return;
    const inst = globeRef.current;
    if (!inst) return;
    const canvas = mountEl.querySelector('canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const coords = inst.toGlobeCoords(x, y);
    if (!coords) return;
    const feature = findCountryAt(coords.lng, coords.lat);
    if (feature) selectCountry(feature);
  };
  if (fullscreen) {
    mountEl.addEventListener('pointerdown', handlePointerDown);
    mountEl.addEventListener('pointermove', handlePointerMove);
    mountEl.addEventListener('pointerup', handlePointerUp);
  }


  // Single-stage paint: sphere + country polygons (shimmer state) +
  // arcs all in the first render. Arcs animate immediately; photos
  // pop in independently as each texture mutates its material's
  // uniforms (no re-render needed — three-globe's autoRotate frame
  // loop picks the new uniforms up on the next tick).

  // Batched polygon feeding. Handing three-globe all ~241 features
  // (791 single polygons at 50m resolution) in one shot triangulates
  // every ConicPolygonGeometry in a single synchronous pass — a long
  // main-thread stall right at first paint. three-globe's data join
  // keys features by object identity, so feeding a growing prefix of
  // the same feature array each frame builds only the NEW meshes and
  // skips geometry rebuilds for the ones already in the scene. Photo
  // countries sort first so batch 1 carries the visually meaningful
  // landmasses; the remaining small countries stream in over the next
  // few frames, behind the loader crossfade.
  const orderedCountries = [...countries].sort(
    (a, b) =>
      Number(photoMaterials.has(b.properties.name)) -
      Number(photoMaterials.has(a.properties.name)),
  );
  const POLYGON_BATCH_INITIAL = 60;
  let polygonBatchSize = 48;
  let polygonFeed: CountryFeature[] = orderedCountries.slice(0, POLYGON_BATCH_INITIAL);

  // animateIn deliberately stays off. Three-globe's animateIn=true
  // animates the camera distance from MAX_DISTANCE down to the target
  // altitude over ~1500ms — the scene is fully rendered the whole
  // time, but the camera fly-in reads as "globe is loading" on top of
  // the post-storm tile fade-in. With animateIn=false the globe
  // appears at its final pose the moment it mounts; the wireframe →
  // canvas crossfade ([data-live]) already supplies the visual
  // entrance.
  function renderGlobe(): void {
    const animateIn = false;
    root.render(
      React.createElement(Globe, {
        ref: globeRef,
        width,
        height,
        backgroundColor: 'rgba(0,0,0,0)',
        globeMaterial,
        showAtmosphere: true,
        // Forest-green halo, very faint — picks up DESIGN's accent without
        // turning the tile into a "marketing globe."
        atmosphereColor: '#3a6b4a',
        atmosphereAltitude: 0.12,
        showGraticules: false,
        // Country polygons. Photo countries get a textured cap material
        // (the photo, UV-mapped to the country's lat/lng bbox); other
        // countries get the muted-cream fill. Photo polygons sit slightly
        // higher off the sphere so the textured cap reads as the focal
        // layer; the cream landmasses recede.
        //
        // photoMaterials is populated synchronously in loadGlobeAssets with
        // shimmer-state ShaderMaterials, then mutated in place as each
        // texture lands — no polygonsData invalidation needed.
        polygonsData: polygonFeed,
        polygonAltitude: POLYGON_ALTITUDE,
        // three-globe's default is 1000ms — every entering polygon
        // gets a Tween allocated and ticked for a second. With
        // animateIn off and a constant altitude there's nothing to
        // animate; 0 takes the direct-apply branch.
        polygonsTransitionDuration: 0,
        polygonCapMaterial: polygonCapMaterialFn,
        polygonCapColor: polygonCapColorFn,
        polygonSideColor: polygonSideColorFn,
        polygonStrokeColor: polygonStrokeColorFn,
        // Stage 1: empty arcs (timeline withheld for the second beat).
        // Stage 2: full journey wave.
        arcsData: arcs,
        // Per-arc 2-color gradient ([head, tail]) does the smoke-fade
        // automatically — pattern from the airline-routes example in
        // the react-globe.gl docs. The dash itself is uniform; the arc
        // it travels along has the gradient, so the dash sample
        // brightens at the origin and fades to invisible at the
        // destination.
        arcColor: arcColorFn,
        arcStroke: 0.4,
        arcDashLength: 0.5,
        arcDashGap: 1.5,
        arcDashAnimateTime: reduceMotion ? 0 : 6000,
        arcDashInitialGap: arcDashInitialGapFn,
        // Auto-scaled altitude. A fixed altitude (e.g. 0.2) keeps short
        // hops nicely arched but produces a bezier whose control points
        // sit *inside* the sphere for arcs spanning >~90° of great-circle
        // distance — Peru→Australia is ~135° and was getting depth-test
        // culled. arcAltitudeAutoScale multiplies the arc's angular
        // length (in radians) by this factor; 0.5 gives short arcs ~0.05
        // and antipodal arcs ~1.5 — long journeys arch high enough to
        // stay clear of the globe surface.
        arcAltitude: null,
        arcAltitudeAutoScale: 0.5,
        // Microstate bubbles. Countries too small to appear in NE 110m
        // (Singapore, etc.) get rendered as circular photo thumbnails
        // anchored at lat/lng. react-globe.gl handles the spherical
        // projection + far-side culling.
        htmlElementsData: overlayAtlasEntries,
        htmlLat: htmlLatFn,
        htmlLng: htmlLngFn,
        htmlAltitude: 0.02,
        htmlElement: htmlElementFn,
        htmlElementVisibilityModifier: htmlElementVisibilityModifierFn,
        // Tile (splash) stays view-only — pointer interaction there
        // would compete with the splash's own click-to-explore tile
        // affordance. Fullscreen (/explorer/) opts in so polygons are
        // clickable for the country detail modal.
        enablePointerInteraction: fullscreen,
        // Click detection runs through mountEl's pointer listeners
        // (see handlePointerDown / handlePointerUp above) — three-globe's
        // onPolygonClick / onArcClick drop clicks under any mouse drift.
        onPolygonHover: fullscreen ? polygonHoverFn : undefined,
        animateIn,
      } as Record<string, unknown>),
    );
  }

  // Resize observer guards (declared up here so the deferred 50m
  // re-render can poke `lastRenderAt`). See the ResizeObserver block
  // lower
  // for the full rationale on why both protections are needed.
  const SETTLE_MS = 400;
  let lastRenderAt = performance.now();
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  // Initial paint — sphere + batch 1 of country polygons (every
  // photo-eligible country renders its shader's shimmer state
  // immediately) + bubble overlays. Arcs withheld; they fire once
  // every photo has finished loading so the journey timeline lands as
  // one closing beat.
  renderGlobe();

  // Stream the remaining polygons in, one batch per frame. The frame
  // timestamp doubles as a governor: a long gap since the previous
  // feed means the last batch blew the frame budget, so halve the
  // batch before pulling more triangulation onto the main thread.
  let polygonFeedRaf: number | null = null;
  let lastFeedTs = 0;
  const feedPolygons = (ts: number): void => {
    polygonFeedRaf = null;
    if (lastFeedTs && ts - lastFeedTs > 40) {
      polygonBatchSize = Math.max(12, Math.floor(polygonBatchSize / 2));
    }
    lastFeedTs = ts;
    polygonFeed = orderedCountries.slice(0, polygonFeed.length + polygonBatchSize);
    renderGlobe();
    lastRenderAt = performance.now();
    if (polygonFeed.length < orderedCountries.length) {
      polygonFeedRaf = requestAnimationFrame(feedPolygons);
    }
  };
  if (polygonFeed.length < orderedCountries.length) {
    polygonFeedRaf = requestAnimationFrame(feedPolygons);
  }

  // Cross-fade WebGL onto the pre-mount loader (loading wireframe or
  // SSR'd static globe) once real polygon content has been added to
  // the scene. The polling loop is necessary because react-globe.gl
  // builds the scene asynchronously across several frames; the
  // MutationObserver that watches the canvas-mounted event fires
  // earlier than the polygons are visible.
  const canvasObserver = new MutationObserver(() => {
    const canvas = mountEl.querySelector('canvas');
    if (!canvas) return;
    canvasObserver.disconnect();
    // Seed the cursor as soon as the canvas exists so the user sees
    // `grab` over the ocean from the first frame, not the OS default.
    updateCanvasCursor();
  });
  canvasObserver.observe(mountEl, { childList: true, subtree: true });
  let realPaintRevealed = false;
  const revealRealGlobe = (): void => {
    if (realPaintRevealed) return;
    realPaintRevealed = true;
    reactMountEl.style.opacity = '1';
    // Strip the pre-mount loaders (loading wireframe, static globe)
    // 220 ms after the fade kicks off, so they don't show through the
    // crossfade once it completes.
    setTimeout(() => {
      for (const child of Array.from(mountEl.children)) {
        if (child !== reactMountEl) mountEl.removeChild(child);
      }
    }, 220);
  };
  // Reveal once (a) the scene has real content, (b) every polygon
  // batch has been fed, and (c) the shader programs have compiled.
  // compileAsync uses KHR_parallel_shader_compile where available, so
  // compilation happens off the driver thread while the pre-mount
  // loader is still showing — the crossfade then lands on clean
  // frames instead of right on top of the compile stall. Batch 1
  // contains every photo country, so both custom programs are in the
  // scene by the time we get here.
  let compileKicked = false;
  const tickPaint = (): void => {
    const inst = globeRef.current;
    let sceneCount = -1;
    try { sceneCount = inst?.scene?.()?.children?.length ?? -1; } catch { /* scene not yet available */ }
    if (sceneCount > 1 && polygonFeed.length >= orderedCountries.length && !compileKicked) {
      compileKicked = true;
      const renderer = inst?.renderer?.();
      const scene = inst?.scene?.();
      const camera = inst?.camera?.();
      if (renderer?.compileAsync && scene && camera) {
        // Belt for slow/broken drivers: don't hold the reveal past
        // 1.5s even if compileAsync never settles.
        const compileTimeout = setTimeout(revealRealGlobe, 1500);
        void renderer.compileAsync(scene, camera)
          .catch(() => { /* compile errors surface at render time anyway */ })
          .then(() => {
            clearTimeout(compileTimeout);
            revealRealGlobe();
          });
      } else {
        revealRealGlobe();
      }
    }
    if (!realPaintRevealed) requestAnimationFrame(tickPaint);
  };
  requestAnimationFrame(tickPaint);
  // Safety belt: even if the rAF stops firing for some reason, force
  // a reveal after 8 s. Better to flash a fade than leave the user
  // looking at a loader forever.
  setTimeout(revealRealGlobe, 8000);

  // Drive the shimmer animation + zoom-driven bubble scale. The
  // ShaderMaterials' uTime uniform is ticked every animation frame;
  // three-globe re-renders the scene each frame anyway (autoRotate
  // keeps OrbitControls active), so the shimmer animates without us
  // needing to call renderGlobe again. Each material that's already
  // had its photo swapped in will hit the `uHasPhoto > 0.5` branch
  // and skip the shimmer math.
  //
  // Bubble scale: read the camera's distance from the globe origin and
  // scale the [data-splash-globe-bubble] overlays inversely — closer camera
  // (smaller distance, smaller altitude multiple) makes the
  // microstate thumbnails bigger; pulling out makes them smaller.
  // The CSS variable cascades to every bubble through document root.
  // Reference altitude is the splash-tile resting pose (1.6) — bubble
  // renders at its natural 22px there.
  // Bubble sizing in pixels — clearer semantics than scale factors.
  // BASE is the natural size at the reference altitude; the bubble
  // grows or shrinks inversely with altitude, clamped between MIN and
  // MAX. CSS multiplies the base by var(--bubble-scale) to apply.
  const BUBBLE_REFERENCE_ALTITUDE = 1.6;
  const BUBBLE_BASE_PX = 22;
  const BUBBLE_MIN_PX = 11;
  const BUBBLE_MAX_PX = 50;
  // Hero-hover spin nudge (splash tile only). Hovering the hero link
  // eases the auto-rotation up to the hover speed; leaving eases it
  // back. The lerp lives in tickFrame so the change is a ramp, not a
  // visible snap. Pairs with the CSS halo in Splash.module.css
  // (.globeBox::after). Listeners go on the hero <a> — the mount
  // itself is pointer-events: none so the link stays clickable.
  const AUTOROTATE_BASE_SPEED = 0.4;
  const AUTOROTATE_HOVER_SPEED = 1.15;
  // Projected-pixel texture upgrades (see upgradePhotosForView). The
  // sphere's apparent diameter as a fraction of the canvas height:
  // tan(asin(1/(1+altitude))) / tan(fov/2), with three-globe's default
  // 50° vertical fov. Same derivation as the .wireLayer inset math in
  // Splash.module.css.
  const FOV_HALF_TAN = Math.tan((25 * Math.PI) / 180);
  let lastUpgradeCheck = 0;
  let lastBubbleScale = '';
  let autoRotateSpeedTarget = AUTOROTATE_BASE_SPEED;
  const heroHoverEl: HTMLElement | null =
    !fullscreen && !reduceMotion ? mountEl.closest('a') : null;
  const onHeroEnter = (): void => { autoRotateSpeedTarget = AUTOROTATE_HOVER_SPEED; };
  const onHeroLeave = (): void => { autoRotateSpeedTarget = AUTOROTATE_BASE_SPEED; };
  heroHoverEl?.addEventListener('pointerenter', onHeroEnter);
  heroHoverEl?.addEventListener('pointerleave', onHeroLeave);
  let shimmerRaf: number | null = null;
  function tickFrame(): void {
    const t = performance.now() / 1000;
    for (const m of shimmerMaterials) {
      if ('uniforms' in m && m.uniforms.uTime) m.uniforms.uTime.value = t;
    }
    const inst = globeRef.current;
    const controls = inst?.controls();
    const cam = controls?.object;
    if (cam) {
      const distance = cam.position.length();
      const altitude = Math.max(0.05, distance / GLOBE_RADIUS - 1);
      const rawPx = BUBBLE_BASE_PX * (BUBBLE_REFERENCE_ALTITUDE / altitude);
      const sizedPx = Math.min(BUBBLE_MAX_PX, Math.max(BUBBLE_MIN_PX, rawPx));
      // Only touch the CSS variable when the value actually changes —
      // writing it every frame invalidates style on the document root
      // even when nothing moved, and at rest the altitude is constant.
      const bubbleScale = (sizedPx / BUBBLE_BASE_PX).toFixed(3);
      if (bubbleScale !== lastBubbleScale) {
        lastBubbleScale = bubbleScale;
        document.documentElement.style.setProperty('--bubble-scale', bubbleScale);
      }
      // Full-res upgrades (explorer): whenever a visible country's
      // projected size outgrows its 768 mid at the current camera
      // altitude and canvas size, swap in the 2048 original. Big
      // countries cross the threshold at the resting pose on large
      // monitors; small ones never do. Throttled to twice a second
      // and metered to 2 swaps per check so the uploads trickle
      // through the pump instead of bursting.
      if (fullscreen && performance.now() - lastUpgradeCheck > 500) {
        lastUpgradeCheck = performance.now();
        const pov = inst?.pointOfView();
        if (typeof pov?.lat === 'number' && typeof pov?.lng === 'number') {
          const renderer = inst?.renderer?.();
          const ratio = renderer?.getPixelRatio() ?? Math.min(2, window.devicePixelRatio || 1);
          const sphereFraction = Math.tan(Math.asin(1 / (1 + altitude))) / FOV_HALF_TAN;
          const spherePxNow = height * ratio * sphereFraction;
          upgradePhotosForView(pov.lat, pov.lng, spherePxNow, 2);
        }
      }
    }
    if (controls && controls.autoRotate) {
      controls.autoRotateSpeed +=
        (autoRotateSpeedTarget - controls.autoRotateSpeed) * 0.08;
    }
    shimmerRaf = requestAnimationFrame(tickFrame);
  }
  if (!reduceMotion) {
    shimmerRaf = requestAnimationFrame(tickFrame);
  }

  // Photos are deferred until AFTER stage-1 paints. Fire-and-forget:
  // as each texture decodes + uploads, it mutates its material's
  // uniforms (uPhoto + uHasPhoto). Three-globe's autoRotate frame
  // loop is already running, so the next render tick picks up the
  // new uniforms automatically — no re-render call from us is needed.
  // Photos pop in piecemeal; the arcs and rotation animate the whole
  // time.
  let cancelled = false;
  requestAnimationFrame(() => {
    if (cancelled) return;
    void loadPhotos({
      getRenderer: () => {
        return globeRef.current?.renderer?.() ?? null;
      },
      // isDragging only flips in fullscreen (splash keeps pointer
      // interaction off), so the splash pump never pauses.
      isBusy: () => isDragging,
      camera: { lat: initialLat, lng: initialLng },
    });
  });

  // Recompute on container resize. Three layers of protection here:
  //
  //   1. Width gate: skip when only the container's height changed.
  //      iOS Safari's address-bar show/hide blips vh by ~60px without
  //      touching width, and the resulting height shift on any tile
  //      whose height isn't fully width-locked used to retrigger
  //      renderGlobe — re-mounting react-globe.gl, dropping the spin,
  //      and rebuilding bubble DOM for a visible flicker. Real
  //      rotations / window drags change width too, so they still pass.
  //   2. 150ms trailing debounce so an active window-drag doesn't
  //      thrash the WebGL context — only the final size of the drag
  //      reaches renderGlobe.
  //   3. 400ms post-render "settle" window during which observer fires
  //      are ignored. After we re-render, react-globe.gl's DOM
  //      (atmosphere overlay, label container, etc.) reflows for a
  //      few hundred ms and the mount's measured size shifts by ~1-2px
  //      per observer tick. Without this guard, render → observer →
  //      re-render → observer → … forms a feedback loop that walks the
  //      size up by ~13px over 1.5s as the splash loads in.
  let lastContainerWidth = mountEl.getBoundingClientRect().width;
  const ro = new ResizeObserver((entries) => {
    if (performance.now() - lastRenderAt < SETTLE_MS) return;
    const entry = entries[0];
    if (entry) {
      const w = entry.contentRect.width;
      if (Math.abs(w - lastContainerWidth) < 0.5) return;
      lastContainerWidth = w;
    }
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      const next = measure();
      if (next.width === width && next.height === height) return;
      width = next.width;
      height = next.height;
      renderGlobe();
      lastRenderAt = performance.now();
    }, 150);
  });
  ro.observe(mountEl);

  // Camera fly-in. react-globe.gl's default pointOfView altitude is
  // 2.5 (camera = 3.5 globe-radii from center, ~30% padding around the
  // sphere). Tile crop is tight at 1.6; fullscreen lands at 2.0.
  //
  // Animation: snap to a far altitude on the first frame, then
  // pointOfView-transition in to the target. Done via our own
  // pointOfView call instead of three-globe's `animateIn`.
  // Reduced-motion skips the transition.
  // Tile altitude compensates for the splash hero's oversized canvas:
  // .globeMount extends 12.5% past the globe box on every side (arc
  // headroom — arcs at altitude were clipping at the old canvas edge).
  // At the old 1.6 the sphere filled ~89% of its canvas; 2.16 keeps the
  // sphere at the same absolute pixel diameter inside the 1.25× canvas.
  // Change one, change the other.
  const targetAltitude = fullscreen ? 2.0 : 2.16;
  // Initial camera framing — Americas-centered. Default three-globe
  // pose is (0°N, 0°E) which lands on the Gulf of Guinea / west Africa;
  // the journey starts in San Francisco, so we open on the western
  // hemisphere instead. AutoRotate takes over once it's enabled below.
  const initialLat = 25;
  const initialLng = -90;

  // Auto-rotate setup as a callable. Called after the fly-in completes
  // (the pointOfView tween clobbers OrbitControls' rotation each frame
  // during transitions, so enabling autoRotate before/during the
  // fly-in gets silently undone).
  function enableAutoRotate(): void {
    if (reduceMotion) return;
    const inst = globeRef.current;
    if (!inst) return;
    const controls = inst.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = AUTOROTATE_BASE_SPEED;
  }

  // Wait until the globe ref is populated, then snap the camera to the
  // Americas pose at the target altitude. react-globe.gl's ref isn't
  // guaranteed to be populated by the first rAF after root.render —
  // its scene mount happens in a useEffect — so we poll briefly.
  // No fly-in: the globe lands at its final pose the moment it
  // mounts. AutoRotate then spins it from there.
  function setInitialCamera(retries = 12): void {
    const inst = globeRef.current;
    if (!inst) {
      if (retries > 0) requestAnimationFrame(() => setInitialCamera(retries - 1));
      return;
    }
    inst.pointOfView({ lat: initialLat, lng: initialLng, altitude: targetAltitude }, 0);
    // Camera distance clamp — altitude stays within [0.3, 4] globe
    // radii (distance = GLOBE_RADIUS × (1 + altitude)), so wheel-zoom
    // can never put the camera inside the sphere or shrink the globe
    // to a speck. Every scripted pose fits inside the window (selection
    // fly-to 1.1, explorer rest 2.0, splash rest 2.16). The splash
    // canvas is pointer-events:none, so the clamp only bites where
    // OrbitControls takes input: /explorer/.
    {
      const controls = inst.controls();
      controls.minDistance = GLOBE_RADIUS * (1 + 0.3);
      controls.maxDistance = GLOBE_RADIUS * (1 + 4);
    }
    // Fill-rate guard for very large canvases. three-render-objects
    // sets pixelRatio = min(2, devicePixelRatio) at init; on a 4K+
    // monitor both the fullscreen explorer and the near-viewport-height
    // splash hero raster 6M+ physical pixels per frame, which leaves
    // no headroom for texture uploads during the photo drip — each
    // pop then drops a frame mid-rotation. Capping at 1.5 cuts raster
    // cost ~44% for a softening that's hard to see at monitor viewing
    // distance. Laptop-sized canvases (< ~6M px) keep the full ratio.
    {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (width * height * dpr * dpr > 6_000_000 && dpr > 1.5) {
        inst.renderer?.()?.setPixelRatio(1.5);
      }
    }
    // Enable autoRotate on the next paint — one rAF gives the
    // pointOfView call a frame to apply through OrbitControls before
    // autoRotate starts driving it. (No fly-in delay needed; the
    // pointOfView call is instant — transitionMs=0.)
    requestAnimationFrame(() => enableAutoRotate());

    // Drag / zoom interaction → pause autoRotate + start the 5s
    // resume timer. OrbitControls fires 'start' on mouse-down + wheel.
    // Only wire in fullscreen — the splash tile leaves
    // enablePointerInteraction off so there's nothing to listen for.
    if (fullscreen) {
      const controls = inst.controls();
      controls.addEventListener?.('start', kickIdleTimer);
      options.onReady?.({
        kickIdleTimer,
        setSelectedCountry,
        setRotationLocked,
        selectCountryByName,
        visitableCountries,
      });
    }
  }
  setInitialCamera();

  return () => {
    cancelled = true;
    heroHoverEl?.removeEventListener('pointerenter', onHeroEnter);
    heroHoverEl?.removeEventListener('pointerleave', onHeroLeave);
    if (shimmerRaf !== null) cancelAnimationFrame(shimmerRaf);
    if (polygonFeedRaf !== null) cancelAnimationFrame(polygonFeedRaf);
    canvasObserver.disconnect();
    ro.disconnect();
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    if (idleTimer !== null) clearTimeout(idleTimer);
    disposeBorder();
    disposeHoverBorder();
    if (fullscreen) {
      mountEl.removeEventListener('pointerdown', handlePointerDown);
      mountEl.removeEventListener('pointermove', handlePointerMove);
      mountEl.removeEventListener('pointerup', handlePointerUp);
    }
    const inst = globeRef.current;
    inst?.controls().removeEventListener?.('start', kickIdleTimer);
    root.unmount();
    globeMaterial.dispose();
    // photoMaterials are NOT disposed here: they live in the
    // module-scoped material map so a subsequent mount (e.g.
    // navigating to /explorer/ after the splash) reuses the same
    // GPU textures instead of re-decoding 35 JPEGs. They're freed
    // when the page itself unloads.
    mountEl.innerHTML = '';
    // Tile mode: the CSS <WireGlobe> lives OUTSIDE the mount (a
    // sibling .wireLayer inside the hero's globe box — see Splash.tsx)
    // and effects.tsx hides it via data-live once the canvas exists.
    // Dropping the attribute un-hides it, so the hero never goes
    // blank. Fullscreen leaves the mount empty — the page is being
    // unmounted entirely.
    if (!fullscreen) {
      mountEl.parentElement?.removeAttribute('data-live');
    }
  };
}
