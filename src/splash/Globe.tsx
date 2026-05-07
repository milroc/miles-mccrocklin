// Globe — react-globe.gl wrapper with server-safe shell + perf fallback.
//
// The Splash chrome (Splash.tsx) renders a static wireframe globe div.
// effects.tsx, after hydration, calls mountGlobe() to replace the static
// content with the live three.js globe (or a 2D d3-geo fallback under
// the perf threshold).
//
// react-globe.gl + three are dynamic-imported here so the splash entry
// chunk doesn't pull three.js into its initial bundle. Three is loaded
// only after the reveal completes (effects.tsx waits 1.8s before
// calling mountGlobe).

import { SPLASH_CONFIG } from '../me';
import journeyData from '../../data/journey.json' with { type: 'json' };
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
//   polygon       — country polygon textured with the primary album's
//                    first photo (UV-mapped to the lat/lng bbox).
//   polygon_grid  — country polygon textured with a pre-composited
//                    grid image of every album in that country.
//   bubble        — microstate not represented as a polygon in
//                    Natural Earth 110m (Singapore today). Rendered
//                    as a circular thumbnail anchored at lat/lng.
type AtlasEntry =
  | {
      country: string;
      country_slug: string;
      render_kind: 'polygon' | 'polygon_grid';
      image: string;
    }
  | {
      country: string;
      country_slug: string;
      // bubble — circular thumbnail anchored at lat/lng (microstates).
      // flat   — rectangular photo card anchored at lat/lng (countries
      //          where the polygon distorts the texture too aggressively
      //          to read, e.g. Antarctica wrapping around the south pole).
      render_kind: 'bubble' | 'flat';
      image: string;
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

// Result of the heavy preload phase. Stored at module scope so the
// promise is reused across calls (Splash hydration → splash mount,
// /explorer page → explorer mount, hot navigation between them).
//
// Materials wrap GPU textures and are cached for the lifetime of the
// page — not disposed in mountGlobe's cleanup — so subsequent mounts
// reuse the same GPU uploads instead of re-decoding 35 JPEGs.
interface PrewarmedGlobe {
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
  // Resolves when every atlas entry has been processed (photo loaded
  // OR errored OR skipped). Lets mountGlobe stage a fast first paint
  // of just the sphere + country polygons, then a second paint with
  // the photo textures and the journey arcs.
  photosReady: Promise<void>;
}

let prewarmPromise: Promise<PrewarmedGlobe> | null = null;

// Kick off all the work mountGlobe would otherwise do at the last
// minute. Idempotent — repeat calls return the same in-flight promise.
//
// Splash.tsx calls this at hydration time so the three.js bundle
// (~1.3 MB) and the 35 portfolio JPEGs (~14 MB) download in parallel
// with the lightning reveal animation, instead of after it. By the
// time runReveal() finishes and mountGlobe() is invoked, the imports
// are usually resolved and the texture bytes are sitting in the HTTP
// cache, so the first frame paints almost immediately.
//
// Cheap to call: returns a no-op resolved promise when the globe gate
// is closed and we're not in /explorer/, so callers don't need to
// gate themselves.
export function prewarmGlobe(options: MountGlobeOptions = {}): Promise<PrewarmedGlobe | null> {
  const fullscreen = options.fullscreen ?? false;

  // Same gates as mountGlobe — don't burn bandwidth on the prewarm
  // when the production state is the static wireframe, or when the
  // device fails the perf check and we'd fall back to 2D anyway.
  if (!SPLASH_CONFIG.globeReady && !fullscreen) {
    return Promise.resolve(null);
  }
  if (!fullscreen && shouldUse2DFallback()) {
    return Promise.resolve(null);
  }
  if (prewarmPromise) return prewarmPromise;

  prewarmPromise = (async () => {
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
    const [globeMod, reactDomClientMod, reactMod, THREE, world, atlas] = await Promise.all([
      import('react-globe.gl'),
      import('react-dom/client'),
      import('react'),
      import('three'),
      fetch('/data/world-countries-110m.json').then((r) => r.json() as Promise<{ features: CountryFeature[] }>),
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
    const { createRoot } = reactDomClient;

    const countries = world.features;

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
    // 'polygon'/'polygon_grid' (geometry UVs) and 'flat' (tangent plane).
    //
    // The shimmer is a slow gradient sweep across the polygon: muted
    // canvas-fg (#7a7770) → cream canvas-fg-strong (#ece9e2). Keeps
    // the editorial register intact; reads as "loading" without
    // shouting.
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
          // so they pass through without re-encoding.
          float sweep = 0.5 + 0.5 * sin((vUv.x + vUv.y * 0.3) * 6.2832 - uTime * 1.6);
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
          float sweep = 0.5 + 0.5 * sin(u * 3.1416 - uTime * 1.6);
          vec3 muted = vec3(0.478, 0.467, 0.439);
          vec3 cream = vec3(0.925, 0.913, 0.886);
          gl_FragColor = vec4(mix(muted, cream, sweep), 1.0);
        }
      }
    `;

    // Build the materials synchronously, register in photoMaterials,
    // then kick off lazy texture loads. photosReady resolves after every
    // texture has either landed or failed — used to time the stage 2
    // paint (arcs).
    const loadPromises: Array<Promise<void>> = [];
    for (const entry of atlas) {
      if (entry.render_kind === 'bubble') {
        const img = new Image();
        img.src = `/${entry.image}`;
        // <img> in the DOM does its own decode; Image() warms the cache.
        continue;
      }
      if (!countries.find((f) => f.properties.name === entry.country)) {
        console.warn(`[Globe] no GeoJSON match for country "${entry.country}"`);
        continue;
      }

      const isFlat = entry.render_kind === 'flat';
      let mat: THREE_T.ShaderMaterial;
      if (isFlat) {
        // Tangent-plane frame for the flat shader.
        const phi = (90 - entry.lat) * Math.PI / 180;
        const theta = (entry.lng + 180) * Math.PI / 180;
        const center = new THREE.Vector3(
          -Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta),
        ).multiplyScalar(GLOBE_RADIUS);
        const normal = center.clone().normalize();
        const refUp = new THREE.Vector3(0, 1, 0);
        let uAxis = new THREE.Vector3().crossVectors(refUp, normal);
        if (uAxis.lengthSq() < 1e-6) uAxis.set(0, 0, -1);
        uAxis.normalize();
        const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();
        // Half-extents — width adjusts to photo aspect once the texture
        // loads. Initialized with a square assumption; the load handler
        // updates uHalfWidth when the real aspect is known.
        const FLAT_HALF_HEIGHT = 22;
        mat = new THREE.ShaderMaterial({
          uniforms: {
            uPhoto: { value: placeholderTex },
            uHasPhoto: { value: 0.0 },
            uTime: { value: 0.0 },
            uCenter: { value: center },
            uUAxis: { value: uAxis },
            uVAxis: { value: vAxis },
            uHalfWidth: { value: FLAT_HALF_HEIGHT },
            uHalfHeight: { value: FLAT_HALF_HEIGHT },
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
      photoMaterials.set(entry.country, mat);
      shimmerMaterials.push(mat);

      // Kick off lazy texture load. On success, swap uniforms; the
      // existing material reference is unchanged so three-globe doesn't
      // need to rebuild the polygon — next render samples the new
      // uPhoto and the uHasPhoto > 0.5 branch.
      const src = `/${entry.image}`;
      loadPromises.push(new Promise<void>((resolve) => {
        textureLoader.load(
          src,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 4;
            tex.flipY = true;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            mat.uniforms.uPhoto.value = tex;
            mat.uniforms.uHasPhoto.value = 1.0;
            if (isFlat && tex.image && tex.image.width && tex.image.height) {
              const photoAspect = tex.image.width / tex.image.height;
              mat.uniforms.uHalfWidth.value =
                (mat.uniforms.uHalfHeight.value as number) * photoAspect;
            }
            resolve();
          },
          undefined,
          () => {
            console.warn(`[Globe] failed to load photo texture: ${src}`);
            resolve();
          },
        );
      }));
    }
    const photosReady = Promise.all(loadPromises).then(() => {});

    return { Globe, createRoot, React, THREE, countries, atlas, photoMaterials, photosReady, shimmerMaterials };
  })();

  return prewarmPromise;
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

  // Heavy work (imports + image preloads) is centralized in
  // prewarmGlobe so Splash.tsx can kick it off at hydration time, in
  // parallel with the lightning reveal. By the time we reach this
  // line on the splash path, the promise is usually already resolved
  // and this await returns the cached state synchronously. On the
  // /explorer/ path (or if a caller skipped the prewarm), this kicks
  // it off here and waits.
  const prewarm = await prewarmGlobe({ fullscreen });
  if (!prewarm) {
    // Gate failed (globeReady=false on splash, or 2D fallback fired).
    // Same no-op behavior as before the prewarm refactor.
    return () => {};
  }
  const { Globe, createRoot, React, THREE, countries, atlas, photoMaterials, photosReady, shimmerMaterials } = prewarm;

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
  mountEl.innerHTML = '';
  const reactMountEl = document.createElement('div');
  reactMountEl.style.width = '100%';
  reactMountEl.style.height = '100%';
  reactMountEl.style.display = 'flex';
  reactMountEl.style.alignItems = 'center';
  reactMountEl.style.justifyContent = 'center';
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

  // countries + atlas + photoMaterials come from the prewarm above —
  // texture decode + material creation happened in parallel with the
  // lightning reveal, so by the time we get here the materials are
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
  const polygonAltitudeFn = (d: object): number =>
    photoMaterials.has((d as CountryFeature).properties.name) ? 0.012 : 0.006;
  const polygonCapMaterialFn = (d: object): THREE_T.Material | undefined =>
    photoMaterials.get((d as CountryFeature).properties.name);
  const polygonCapColorFn = (d: object): string => {
    const name = (d as CountryFeature).properties.name;
    if (photoMaterials.has(name)) return 'rgba(0,0,0,0)'; // ignored when capMaterial is set, but keeps `hasCap` truthy
    if (VISITED_COUNTRIES.has(name)) return 'rgba(58, 107, 74, 0.78)'; // --splash-accent — visited but no photo (e.g. The Bahamas)
    return 'rgba(184, 181, 173, 0.55)'; // --canvas-fg @ ~55% — un-visited
  };
  const polygonSideColorFn = (): string => 'rgba(28, 31, 26, 0.0)';
  // No coastline stroke — borders strip the editorial register and
  // fight the photo textures for visual attention. three-globe hides
  // the stroke layer entirely when this returns falsy.
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
    img.src = `/${entry.image}`;
    img.alt = entry.country;
    img.loading = 'lazy';
    img.decoding = 'async';
    wrap.appendChild(img);
    return wrap;
  };
  const htmlElementVisibilityModifierFn = (el: HTMLElement, isVisible: boolean): void => {
    el.style.opacity = isVisible ? '1' : '0';
  };


  // Two-stage paint:
  //   stage 1 (immediate): sphere + country polygons (cream fill
  //                        because photoMaterials Map is still empty).
  //                        No arcs yet — the journey timeline is part
  //                        of stage 2 so it lands together with the
  //                        photos as a single second beat.
  //   stage 2 (photosReady): same render, but photoMaterials is now
  //                        populated and arcsData carries the journey.
  // The `staged` flag is the only thing that changes between calls —
  // every other prop is built from stable closures so React's
  // reconciliation only updates the fields that actually moved.
  let staged = false;

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
        // photoMaterials is populated synchronously in prewarm with
        // shimmer-state ShaderMaterials, then mutated in place as each
        // texture lands — no polygonsData invalidation needed.
        polygonsData: countries,
        polygonAltitude: polygonAltitudeFn,
        polygonCapMaterial: polygonCapMaterialFn,
        polygonCapColor: polygonCapColorFn,
        polygonSideColor: polygonSideColorFn,
        polygonStrokeColor: polygonStrokeColorFn,
        // Stage 1: empty arcs (timeline withheld for the second beat).
        // Stage 2: full journey wave.
        arcsData: staged ? arcs : [],
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

  // Resize observer guards (declared up here so the staged re-render
  // below can poke `lastRenderAt`). See the ResizeObserver block lower
  // for the full rationale on why both protections are needed.
  const SETTLE_MS = 400;
  let lastRenderAt = performance.now();
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  // Initial paint — sphere + country polygons (every photo-eligible
  // country renders its shader's shimmer state immediately) + bubble
  // overlays. Arcs withheld; they fire once every photo has finished
  // loading so the journey timeline lands as one closing beat.
  renderGlobe();

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

  // Stage 2 paint — fires once every photo has loaded (or failed). At
  // this point every shader has had its photo uniform swapped in, so the
  // re-render is just for the arcs (timeline). Single closing beat.
  let cancelled = false;
  const readyPromise = photosReady ?? Promise.resolve();
  void readyPromise.then(() => {
    if (cancelled) return;
    staged = true;
    renderGlobe();
    lastRenderAt = performance.now();
    // Re-apply autoRotate — the re-render runs through react-globe.gl's
    // controls reset path and would otherwise drop the spin.
    requestAnimationFrame(enableAutoRotate);
  });

  // Recompute on container resize. Two layers of protection here:
  //
  //   1. 150ms trailing debounce so an active window-drag doesn't
  //      thrash the WebGL context — only the final size of the drag
  //      reaches renderGlobe.
  //   2. 400ms post-render "settle" window during which observer fires
  //      are ignored. After we re-render, react-globe.gl's DOM
  //      (atmosphere overlay, label container, etc.) reflows for a
  //      few hundred ms and the mount's measured size shifts by ~1-2px
  //      per observer tick. Without this guard, render → observer →
  //      re-render → observer → … forms a feedback loop that walks the
  //      size up by ~13px over 1.5s as the splash loads in. Real
  //      user-driven resizes (window drag, device rotation) sit well
  //      outside the 400ms window so they still apply normally.
  const ro = new ResizeObserver(() => {
    if (performance.now() - lastRenderAt < SETTLE_MS) return;
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
  // pointOfView call instead of three-globe's `animateIn` so the
  // staged second paint (photos + arcs arriving after textures load)
  // doesn't restart the fly-in. Reduced-motion skips the transition.
  const targetAltitude = fullscreen ? 2.0 : 1.6;
  // Initial camera framing — Americas-centered. Default three-globe
  // pose is (0°N, 0°E) which lands on the Gulf of Guinea / west Africa;
  // the journey starts in San Francisco, so we open on the western
  // hemisphere instead. AutoRotate takes over once it's enabled below.
  const initialLat = 25;
  const initialLng = -90;

  // Auto-rotate setup as a callable. Called after the fly-in completes
  // (the pointOfView tween clobbers OrbitControls' rotation each frame
  // during transitions, so enabling autoRotate before/during the fly-in
  // gets silently undone) and again after the staged second paint
  // (re-rendering with new props re-applies the controls config and
  // would otherwise reset autoRotate=false).
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
    // Tiny delay before turning on autoRotate so the camera-set has a
    // frame to apply before OrbitControls starts driving it.
    setTimeout(enableAutoRotate, 50);
  }
  setInitialCamera();

  return () => {
    cancelled = true;
    if (shimmerRaf !== null) cancelAnimationFrame(shimmerRaf);
    ro.disconnect();
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    root.unmount();
    globeMaterial.dispose();
    // photoMaterials are NOT disposed here: they live in the
    // module-scoped prewarm cache so a subsequent mount (e.g.
    // navigating to /explorer/ after the splash) reuses the same
    // GPU textures instead of re-decoding 35 JPEGs. They're freed
    // when the page itself unloads.
    mountEl.innerHTML = '';
    // Tile mode restores the static wireframe so the tile doesn't go
    // blank. Fullscreen leaves the mount empty — the page is being
    // unmounted entirely.
    if (!fullscreen) {
      const fallback = document.createElement('div');
      fallback.className = 'splash-globe-static';
      fallback.setAttribute('aria-hidden', 'true');
      mountEl.appendChild(fallback);
    }
  };
}
