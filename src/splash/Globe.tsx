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
import journeyData from '../../data/journey.json' with { type: 'json' };
import splashStyles from './Splash.module.css';
// Type-only — three is dynamic-imported below. The `import type` form
// is erased at compile time, so it doesn't pull three into the splash
// entry chunk; we use it only for type annotations on cached state.
import type * as THREE_T from 'three';

interface Waypoint {
  label: string;
  lat: number;
  lng: number;
  startYear?: number;
}

interface JourneyJson {
  waypoints: Waypoint[];
}

// Visited countries (post-alias). Built from journey.json's waypoint
// labels, with UK constituents and Bahamas folded onto their atlas /
// 110m polygon names so membership tests against polygon names work.
// Used by polygonCapColor to paint visited countries that don't have a
// photo texture in the forest-green accent — currently just The Bahamas
// (1988–2001 visit predates the digital archive), but stays correct as
// new visits land before their albums do.
const VISITED_NAME_ALIASES: Readonly<Record<string, string>> = {
  Bahamas: 'The Bahamas',
  England: 'United Kingdom',
  Scotland: 'United Kingdom',
  Wales: 'United Kingdom',
  'Northern Ireland': 'United Kingdom',
};

const WAYPOINTS: Waypoint[] = (journeyData as JourneyJson).waypoints;

const VISITED_COUNTRIES: ReadonlySet<string> = new Set(
  WAYPOINTS.map((w) => VISITED_NAME_ALIASES[w.label] ?? w.label),
);

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
type AtlasEntry =
  | {
      country: string;
      country_slug: string;
      render_kind: 'polygon';
      image: string;
      // 384-edge low-res variant of `image`. Splash uses this (~15 KB
      // each) so the first paint isn't waiting on 26 MB of full-res
      // photos. /explorer/ uses the full-size `image`. Generated
      // alongside `image` by scripts/build-photo-atlas.ts.
      image_tile?: string;
    }
  | {
      country: string;
      country_slug: string;
      render_kind: 'bubble' | 'flat';
      image: string;
      image_tile?: string;
      lat: number;
      lng: number;
    };

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

interface MountGlobeOptions {
  // When true, fill the full mount rect with a non-square globe canvas
  // (used by the /explorer/ page). When false (default), the globe is a
  // centered square sized to min(rect.width, rect.height) and the
  // 2D-fallback perf check applies — used by the splash tile.
  fullscreen?: boolean;
}

// Cached country-feature view of the bundled world atlas. Narrowed to
// just the field we touch from JS — ConicPolygonGeometry consumes the
// full geometry directly without us peeking inside.
type CountryFeature = {
  type: 'Feature';
  properties: { name: string };
  geometry: object;
};

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
  // in-flight promise.
  loadPhotos: () => Promise<void>;
}

// Load the dynamic imports + topology + photo atlas + per-country
// materials that mountGlobe needs. Called once per page mount.
async function loadGlobeAssets(fullscreen: boolean): Promise<GlobeAssets> {
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
    // Country polygons ship as TopoJSON in two variants. /explorer/
    // (fullscreen) fetches the full 1:50m dataset (~97 KB gz) for
    // visible coastline detail at fullscreen camera distance. The
    // splash tile fetches an aggressively-simplified variant
    // (~25 KB gz) — at 240 px square, sub-degree detail just becomes
    // high-frequency noise. One fetch per page, no mid-flight swap.
    const polygonsUrl = fullscreen
      ? '/data/world-countries-50m.topo.json'
      : '/data/world-countries-tile.topo.json';
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
    const unwrap = <T,>(mod: unknown): T => {
      const m = mod as { default?: unknown };
      if (m && typeof m === 'object' && 'default' in m && m.default && typeof m.default === 'object') {
        return m.default as T;
      }
      return mod as T;
    };
    const Globe = ((globeMod as { default?: typeof import('react-globe.gl').default }).default
      ?? (globeMod as unknown as typeof import('react-globe.gl').default));
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
    ) as unknown as { features: CountryFeature[] };
    const countries = decoded.features;

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
    // Splash renders all photos at ~240 px tile size, so we prefer the
    // 384-edge `image_tile` variant (~15 KB each, 27× smaller than the
    // 2048-edge originals). /explorer/ uses the full-res `image`.
    const photoSrcOf = (entry: AtlasEntry): string =>
      `/${(!fullscreen && entry.image_tile) ? entry.image_tile : entry.image}`;
    interface PhotoLoadJob {
      src: string;
      mat: THREE_T.ShaderMaterial;
      isFlat: boolean;
      flatBboxHalfWidth: number;
      flatBboxHalfHeight: number;
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
      if (!countries.find((f) => f.properties.name === entry.country)) {
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
        const phi = (90 - entry.lat) * Math.PI / 180;
        const theta = (entry.lng + 180) * Math.PI / 180;
        const anchor = new THREE.Vector3(
          -Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta),
        ).multiplyScalar(GLOBE_RADIUS);
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
            const th = (lng + 180) * Math.PI / 180;
            tmp.set(
              -Math.sin(ph) * Math.cos(th),
              Math.cos(ph),
              Math.sin(ph) * Math.sin(th),
            ).multiplyScalar(GLOBE_RADIUS);
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
      photoLoadJobs.push({
        src: photoSrcOf(entry),
        mat,
        isFlat,
        flatBboxHalfWidth,
        flatBboxHalfHeight,
      });
    }

    // Idempotent. mountGlobe calls this from a requestAnimationFrame
    // after the stage-1 paint; the returned promise drives the stage-2
    // arc paint. On the splash path, photo bytes are only ~800 KB
    // total (image_tile variants), so this resolves in ~1–2 s on
    // mobile bandwidth. On /explorer/ the full ~26 MB downloads
    // progressively while the user is already looking at geometry.
    // Texture-upload drip: when each JPEG finishes downloading +
    // decoding, we queue it for assignment instead of immediately
    // mutating `mat.uniforms.uPhoto.value`. A rAF loop pulls one
    // queued texture per frame and does the assignment, which is
    // what triggers the synchronous `texImage2D` upload to the GPU.
    // Effect: instead of a single ~1.3 s burst of 49 uploads (during
    // which the autoRotate animation freezes), the cost is amortized
    // at ~25 ms per frame, one upload per ~16 ms tick. Animation
    // never pauses; photos pop in over ~1 s, distributed.
    let photosReadyPromise: Promise<void> | null = null;
    const loadPhotos = (): Promise<void> => {
      if (photosReadyPromise) return photosReadyPromise;
      interface Pending {
        tex: THREE_T.Texture;
        mat: THREE_T.ShaderMaterial;
        isFlat: boolean;
        flatBboxHalfWidth: number;
        flatBboxHalfHeight: number;
      }
      const queue: Pending[] = [];
      let pumpScheduled = false;
      const pumpOne = (): void => {
        pumpScheduled = false;
        const job = queue.shift();
        if (!job) {
          // Nothing decoded yet; wait for the next decode to schedule us.
          return;
        }
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
        if (queue.length > 0) schedulePump();
      };
      const schedulePump = (): void => {
        if (pumpScheduled) return;
        pumpScheduled = true;
        requestAnimationFrame(pumpOne);
      };

      const jobPromises = photoLoadJobs.map(
        ({ src, mat, isFlat, flatBboxHalfWidth, flatBboxHalfHeight }) =>
          new Promise<void>((resolve) => {
            textureLoader.load(
              src,
              (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.anisotropy = 4;
                tex.flipY = true;
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                queue.push({ tex, mat, isFlat, flatBboxHalfWidth, flatBboxHalfHeight });
                schedulePump();
                resolve();
              },
              undefined,
              () => {
                console.warn(`[Globe] failed to load photo texture: ${src}`);
                resolve();
              },
            );
          }),
      );
      photosReadyPromise = Promise.all(jobPromises).then(() => {});
      return photosReadyPromise;
    };

    return { Globe, createRoot, React, THREE, countries, atlas, photoMaterials, loadPhotos, shimmerMaterials };
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
  const assets = await loadGlobeAssets(fullscreen);
  const { Globe, createRoot, React, THREE, countries, atlas, photoMaterials, loadPhotos, shimmerMaterials } = assets;

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
  const overlayAtlasEntries = atlas.filter(
    (e): e is AtlasEntry & { render_kind: 'bubble' } => e.render_kind === 'bubble',
  );

  const globeRef = React.createRef<{
    controls: () => {
      autoRotate: boolean;
      autoRotateSpeed: number;
      // OrbitControls.object is the camera; we read its position to
      // derive the current altitude for the bubble-scale calculation
      // in the rAF loop below.
      object?: { position: { length: () => number } };
    };
    pointOfView: (pov: { lat?: number; lng?: number; altitude?: number }, transitionMs?: number) => void;
  }>();

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
  const POLYGON_ALTITUDE = 0.01;
  const polygonCapMaterialFn = (d: object): THREE_T.Material | undefined =>
    photoMaterials.get((d as CountryFeature).properties.name);
  const polygonCapColorFn = (d: object): string => {
    const name = (d as CountryFeature).properties.name;
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
  const arcDashInitialGapFn = (d: object): number =>
    ((d as Arc).order / arcSpan) * arcStaggerCycles;
  const htmlLatFn = (d: object): number => (d as AtlasEntry & { lat: number }).lat;
  const htmlLngFn = (d: object): number => (d as AtlasEntry & { lng: number }).lng;
  const htmlElementFn = (d: object): HTMLElement => {
    const entry = d as AtlasEntry & { lat: number; lng: number };
    const wrap = document.createElement('div');
    wrap.className = 'splash-globe-bubble';
    wrap.title = entry.country;
    const img = document.createElement('img');
    // Splash bubbles use the 384-edge tile variant (~15 KB) for first
    // paint; /explorer/ renders bubbles at full ~2048-edge.
    const tileSrc = (!fullscreen && entry.image_tile) ? entry.image_tile : entry.image;
    img.src = `/${tileSrc}`;
    img.alt = entry.country;
    img.loading = 'lazy';
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


  // Single-stage paint: sphere + country polygons (shimmer state) +
  // arcs all in the first render. Arcs animate immediately; photos
  // pop in independently as each texture mutates its material's
  // uniforms (no re-render needed — three-globe's autoRotate frame
  // loop picks the new uniforms up on the next tick).

  // animateIn deliberately stays off. Three-globe's animateIn=true
  // animates the camera distance from MAX_DISTANCE down to the target
  // altitude over ~1500ms — the scene is fully rendered the whole
  // time, but the camera fly-in reads as "globe is loading" on top of
  // the post-storm tile fade-in. With animateIn=false the globe
  // appears at its final pose the moment it mounts; the fade-in from
  // .revealing → .revealed already supplies the visual entrance.
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
        polygonsData: countries,
        polygonAltitude: POLYGON_ALTITUDE,
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
        enablePointerInteraction: false,
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

  // Initial paint — sphere + country polygons (every photo-eligible
  // country renders its shader's shimmer state immediately) + bubble
  // overlays. Arcs withheld; they fire once every photo has finished
  // loading so the journey timeline lands as one closing beat.
  renderGlobe();

  // Cross-fade WebGL onto the pre-mount loader (loading wireframe or
  // SSR'd static globe) once real polygon content has been added to
  // the scene. The polling loop is necessary because react-globe.gl
  // builds the scene asynchronously across several frames; the
  // MutationObserver that watches the canvas-mounted event fires
  // earlier than the polygons are visible.
  const canvasObserver = new MutationObserver(() => {
    const canvas = mountEl.querySelector('canvas');
    if (canvas) canvasObserver.disconnect();
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
  const tickPaint = (): void => {
    const inst = globeRef.current as (typeof globeRef.current & { scene?: () => { children: unknown[] } }) | null;
    let sceneCount = -1;
    try { sceneCount = inst?.scene?.()?.children?.length ?? -1; } catch { /* scene not yet available */ }
    if (sceneCount > 1) revealRealGlobe();
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
  // scale the .splash-globe-bubble overlays inversely — closer camera
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
  let shimmerRaf: number | null = null;
  function tickFrame(): void {
    const t = performance.now() / 1000;
    for (const m of shimmerMaterials) {
      if ('uniforms' in m && m.uniforms.uTime) m.uniforms.uTime.value = t;
    }
    const inst = globeRef.current;
    const cam = inst?.controls().object;
    if (cam) {
      const distance = cam.position.length();
      const altitude = Math.max(0.05, distance / GLOBE_RADIUS - 1);
      const rawPx = BUBBLE_BASE_PX * (BUBBLE_REFERENCE_ALTITUDE / altitude);
      const sizedPx = Math.min(BUBBLE_MAX_PX, Math.max(BUBBLE_MIN_PX, rawPx));
      document.documentElement.style.setProperty('--bubble-scale', (sizedPx / BUBBLE_BASE_PX).toFixed(3));
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
    void loadPhotos();
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
  const targetAltitude = fullscreen ? 2.0 : 1.6;
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
    controls.autoRotateSpeed = 0.4;
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
    // Enable autoRotate on the next paint — one rAF gives the
    // pointOfView call a frame to apply through OrbitControls before
    // autoRotate starts driving it. (No fly-in delay needed; the
    // pointOfView call is instant — transitionMs=0.)
    requestAnimationFrame(() => enableAutoRotate());
  }
  setInitialCamera();

  return () => {
    cancelled = true;
    if (shimmerRaf !== null) cancelAnimationFrame(shimmerRaf);
    canvasObserver.disconnect();
    ro.disconnect();
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    root.unmount();
    globeMaterial.dispose();
    // photoMaterials are NOT disposed here: they live in the
    // module-scoped material map so a subsequent mount (e.g.
    // navigating to /explorer/ after the splash) reuses the same
    // GPU textures instead of re-decoding 35 JPEGs. They're freed
    // when the page itself unloads.
    mountEl.innerHTML = '';
    // Tile mode restores the static 3D wireframe so the tile doesn't
    // go blank. Fullscreen leaves the mount empty — the page is being
    // unmounted entirely. Mirrors the structure SSR'd by Splash.tsx
    // (perspective container → preserve-3d sphere → meridians +
    // parallels) so the visual is identical to the pre-mount state.
    if (!fullscreen) {
      const outer = document.createElement('div');
      outer.className = splashStyles.globeStatic ?? '';
      outer.setAttribute('aria-hidden', 'true');
      const inner = document.createElement('div');
      inner.className = splashStyles.globeStaticInner ?? '';
      const meridianClass = splashStyles.staticMeridian ?? '';
      const parallelClass = splashStyles.staticParallel ?? '';
      for (let i = 0; i < 6; i++) {
        const m = document.createElement('div');
        m.className = meridianClass;
        inner.appendChild(m);
      }
      for (const variantKey of ['staticParallelEq', 'staticParallel30N', 'staticParallel30S', 'staticParallel60N', 'staticParallel60S'] as const) {
        const p = document.createElement('div');
        p.className = `${parallelClass} ${splashStyles[variantKey] ?? ''}`;
        inner.appendChild(p);
      }
      outer.appendChild(inner);
      mountEl.appendChild(outer);
    }
  };
}
