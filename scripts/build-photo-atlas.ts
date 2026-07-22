// Build the photo atlas for the splash globe.
//
// Scrape the portfolio index pages for each album's cover image (the
// `_carw_4x3xN` srcset, taking the largest variant). For each entry in
// MANIFEST below, look up the primary album's cover URL and download.
// One photo per country — composited multi-album grids were dropped
// because users were reading the grid cells as states/provinces
// inside the country shape.
//
// Output:
//   data/photo-atlas.json          — schema below
//   media/portfolio/<slug>.jpg     — texture for every entry
//
// Re-run idempotently after the portfolio adds/changes albums; cached
// raw downloads in .context/portfolio-raw/ short-circuit re-fetches.

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname;
const MEDIA_DIR = join(ROOT, 'media/portfolio');
const RAW_DIR = join(ROOT, '.context/portfolio-raw');
const ATLAS_PATH = join(ROOT, 'data/photo-atlas.json');

const MAX_LONG_EDGE = 2048;
// Splash-tile variant. The splash globe renders as a ~240 px square
// tile, so each polygon-cap texture maps to ~50–200 px on screen. The
// 2048-edge file is 10–40× more pixels than the splash can resolve.
// 384 px is ~1.6× the tile size — accounts for retina + autorotate
// motion blur — and lands at ~12–18 KB per JPEG, ~30× smaller than
// the full-size file. /explorer/ keeps using the 2048-edge originals.
const TILE_LONG_EDGE = 384;
const TILE_QUALITY = 70;
const TILE_SUFFIX = '-tile.jpg';
const tilePathFor = (destPath: string): string =>
  destPath.replace(/\.jpg$/, TILE_SUFFIX);
// Splash-mid variant. The 2026-07 globe-anchor splash renders the
// sphere at ~850-1080 px, where big countries (Brazil, Canada, USA)
// map their photo across 300-400 px of screen — the 384 tile reads
// soft there. 768 px covers that at ~40-60 KB per JPEG (~2 MB total),
// still loaded progressively after geometry. /explorer/ keeps the
// 2048-edge originals.
const MID_LONG_EDGE = 768;
const MID_QUALITY = 75;
const MID_SUFFIX = '-mid.jpg';
const midPathFor = (destPath: string): string =>
  destPath.replace(/\.jpg$/, MID_SUFFIX);

const ALBUM_HOST = 'https://milesmccrocklin.myportfolio.com';

export interface AlbumRef {
  title: string;
  url: string;
  // Populated at build time from the portfolio index cover map. Used
  // by the frontend (CountryPanel) to render a thumbnail next to each
  // album in the country detail panel.
  source_image_url?: string;
}

interface SingleEntry {
  country: string;
  country_slug: string;
  render_kind: 'polygon';
  // Either a portfolio album (resolved via the index cover map) or a
  // single local file. At least one must be set.
  primary_album?: AlbumRef;
  secondary_albums?: AlbumRef[];
  local_image?: LocalImageRef;
  // Paper trail for countries where the primary photo is a local file
  // but multiple shots exist on disk. Not consumed at build time —
  // preserved so future curation can swap the hero without re-discovering
  // the file paths. Originally these were composited into a grid texture
  // (`render_kind: 'polygon_grid'`); the grid was dropped because the
  // cells read as states/provinces within the country shape.
  secondary_local_images?: LocalImageRef[];
  notes?: string;
}

interface BubbleEntry {
  country: string;
  country_slug: string;
  render_kind: 'bubble';
  lat: number;
  lng: number;
  // Same dual-source rule as SingleEntry — see comment above.
  primary_album?: AlbumRef;
  secondary_albums?: AlbumRef[];
  local_image?: LocalImageRef;
  secondary_local_images?: LocalImageRef[];
  notes?: string;
}

// A single local-file photo used in place of a portfolio album. Carries
// a title (so the atlas record stays human-readable) and a project-root-
// relative path to the JPEG. Use for countries we haven't yet published
// a portfolio album for but already have suitable shots in
// media/sabbatical-travel or similar.
export interface LocalImageRef {
  title: string;
  path: string;
}

// Flat photo card overlay — rendered on a tangent-plane shader at
// lat/lng. Used for countries where the polygon's UV mapping distorts
// the photo (Antarctica, where the polygon wraps around the south
// pole). Same single-source shape as SingleEntry, plus lat/lng.
interface FlatEntry {
  country: string;
  country_slug: string;
  render_kind: 'flat';
  lat: number;
  lng: number;
  primary_album?: AlbumRef;
  secondary_albums?: AlbumRef[];
  local_image?: LocalImageRef;
  secondary_local_images?: LocalImageRef[];
  notes?: string;
}

export type Entry = SingleEntry | BubbleEntry | FlatEntry;

// Slug helper. Lowercases, replaces non-alphanumerics with hyphens.
const slug = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Album slug from URL path. e.g. ".../salar-de-uyuni" → "salar-de-uyuni".
const albumSlug = (url: string) => url.split('/').pop()!;

// =============================================================
// MANIFEST — the full country roster, encoded from the user's
// answers. Order: alphabetical by country except Antarctica first
// (no political ordering implied).
// =============================================================

export const MANIFEST: Entry[] = [
  {
    // 'flat' polygon: Antarctica's NE 110m polygon wraps the south pole
    // and ConicPolygonGeometry stretches a UV-mapped photo into an
    // unreadable smear. Render via the FLAT shader on a tangent plane
    // at the south pole — circumpolar geometry projects symmetrically
    // there. Globe.tsx sizes the rect to the polygon's tangent-plane
    // bbox so the photo fills Antarctica's actual footprint, with the
    // polygon clipping any overflow.
    country: 'Antarctica', country_slug: 'antarctica', render_kind: 'flat',
    lat: -90, lng: 0,
    primary_album: { title: 'Antarctica - Glaciers', url: `${ALBUM_HOST}/antarctica-glaciers` },
    secondary_albums: [
      { title: 'Antarctica - Penguins', url: `${ALBUM_HOST}/antarctica-penguins` },
      { title: 'Antarctica - Otherwildlife', url: `${ALBUM_HOST}/antarctica-otherwildlife-1` },
      { title: 'Antarctica - Everything else', url: `${ALBUM_HOST}/antarctica-everything-else-1` },
    ],
  },
  {
    country: 'Argentina', country_slug: 'argentina', render_kind: 'polygon',
    primary_album: { title: 'Buenos Aires', url: `${ALBUM_HOST}/buenos-aires` },
    secondary_albums: [],
  },
  {
    country: 'Armenia', country_slug: 'armenia', render_kind: 'polygon',
    primary_album: { title: 'Armenia', url: `${ALBUM_HOST}/armenia` },
    secondary_albums: [],
  },
  {
    // Hero: "Splash!" — Sydney swimmer mid-air, the most iconic
    // Australia frame in the splash gallery. Was previously pinned to
    // the visual-center cell of a 3×3 grid; with the grid dropped, it
    // becomes the country's single texture. Portfolio albums kept
    // below as a paper trail for future hero swaps.
    country: 'Australia', country_slug: 'australia', render_kind: 'polygon',
    local_image: { title: 'Splash!, Sydney, Australia', path: 'media/sabbatical-travel/travel-24.jpeg' },
    secondary_albums: [
      { title: 'Sydney', url: `${ALBUM_HOST}/sydney` },
      { title: 'Toranga Zoo', url: `${ALBUM_HOST}/toranga-zoo` },
      { title: 'Blue Mountains', url: `${ALBUM_HOST}/blue-mountains` },
      { title: 'Australian Road Trip - Brisbane to Sydney', url: `${ALBUM_HOST}/australian-road-trip-brisbane-to-sydney` },
      { title: 'Brisbane', url: `${ALBUM_HOST}/brisbane` },
      { title: 'Chillagoe', url: `${ALBUM_HOST}/chillagoe` },
      { title: 'Port Douglass', url: `${ALBUM_HOST}/port-douglass` },
      { title: 'Daintree', url: `${ALBUM_HOST}/daintree` },
      { title: 'Melbourne', url: `${ALBUM_HOST}/melbourne` },
    ],
  },
  {
    country: 'Austria', country_slug: 'austria', render_kind: 'polygon',
    local_image: { title: 'Vienna — Stephansplatz + Haas Haus', path: 'media/europe-2010/austria-vienna-stephansplatz.jpg' },
    secondary_local_images: [
      { title: 'Vienna — Hundertwasserhaus', path: 'media/europe-2010/austria-vienna-hundertwasserhaus.jpg' },
      { title: 'Vienna — math.space stairs at the Museumsquartier', path: 'media/europe-2010/austria-vienna-math-space.jpg' },
    ],
  },
  {
    country: 'Belgium', country_slug: 'belgium', render_kind: 'polygon',
    primary_album: { title: 'Belgium', url: `${ALBUM_HOST}/belgium` },
    secondary_albums: [],
  },
  {
    country: 'Belize', country_slug: 'belize', render_kind: 'polygon',
    primary_album: { title: 'Quay Caulker', url: `${ALBUM_HOST}/quay-caulker` },
    secondary_albums: [],
    notes: 'Album title is "Quay Caulker" (sic); refers to Caye Caulker, Belize.',
  },
  {
    country: 'Bolivia', country_slug: 'bolivia', render_kind: 'polygon',
    primary_album: { title: 'Salar de Uyuni', url: `${ALBUM_HOST}/salar-de-uyuni` },
    secondary_albums: [
      { title: 'La Paz', url: `${ALBUM_HOST}/la-paz` },
      { title: 'Lago Colorado, Bolivia', url: `${ALBUM_HOST}/lago-colorado-bolivia` },
      { title: 'Bolivian Desert', url: `${ALBUM_HOST}/bolivian-desert` },
    ],
  },
  {
    country: 'Brazil', country_slug: 'brazil', render_kind: 'polygon',
    local_image: { title: 'Sugarloaf — Botafogo Bay from Corcovado', path: 'media/brazil-2025/rio-sugarloaf-from-corcovado.jpg' },
    secondary_local_images: [
      { title: 'Iguaçu Falls with rainbow',                   path: 'media/brazil-2025/iguazu-falls-rainbow.jpg' },
      { title: 'Christ the Redeemer — face',                  path: 'media/brazil-2025/rio-christ-face.jpg' },
      { title: 'Royal Portuguese Reading Room',               path: 'media/brazil-2025/rio-royal-portuguese-library.jpg' },
      { title: 'Catedral Metropolitana — Rio',                path: 'media/brazil-2025/rio-catedral-metropolitana.jpg' },
      { title: 'Toco toucan',                                 path: 'media/brazil-2025/iguazu-toucan.jpg' },
      { title: 'South American coati',                        path: 'media/brazil-2025/iguazu-coati.jpg' },
      { title: 'Ipanema / Leblon between Lagoa and Atlantic', path: 'media/brazil-2025/rio-ipanema-leblon.jpg' },
      { title: "Christ the Redeemer — outstretched hand",     path: 'media/brazil-2025/rio-christ-hand.jpg' },
      { title: 'Christ the Redeemer — face profile',          path: 'media/brazil-2025/rio-christ-face-profile.jpg' },
    ],
  },
  {
    country: 'Canada', country_slug: 'canada', render_kind: 'polygon',
    primary_album: { title: 'Niagra Falls', url: `${ALBUM_HOST}/niagra-falls` },
    secondary_albums: [],
    notes: 'Niagara Falls span US/Canada border; assigned to Canada per user.',
  },
  {
    country: 'Chile', country_slug: 'chile', render_kind: 'polygon',
    primary_album: { title: 'Cajon de Maipo', url: `${ALBUM_HOST}/cajon-de-maipo` },
    secondary_albums: [
      { title: 'Valle de la Luna y San Pedro de Atacama', url: `${ALBUM_HOST}/valle-de-la-luna-y-san-pedro-de-atacama` },
      { title: 'El Tatio', url: `${ALBUM_HOST}/el-tatio` },
      { title: 'Santiago Bird Watching', url: `${ALBUM_HOST}/santiago-bird-watching` },
      { title: '2025 New Years Eve', url: `${ALBUM_HOST}/2025-new-years-eve` },
      { title: 'Valparaíso & Viña del Mar', url: `${ALBUM_HOST}/valparaiso-vina-del-mar` },
      { title: 'Santiago', url: `${ALBUM_HOST}/santiago` },
    ],
  },
  {
    country: 'Colombia', country_slug: 'colombia', render_kind: 'polygon',
    primary_album: { title: 'Salento', url: `${ALBUM_HOST}/salento` },
    secondary_albums: [
      { title: 'Cartagena', url: `${ALBUM_HOST}/cartagena` },
      { title: 'Medellín', url: `${ALBUM_HOST}/medellin` },
      { title: 'Bogotá & Giradot', url: `${ALBUM_HOST}/bogota-giradot` },
    ],
  },
  {
    country: 'Croatia', country_slug: 'croatia', render_kind: 'polygon',
    local_image: { title: 'Plitvice Lakes — turquoise cascades + boardwalk', path: 'media/europe-2010/croatia-plitvice-lakes.jpg' },
  },
  {
    country: 'Czechia', country_slug: 'czechia', render_kind: 'polygon',
    local_image: { title: "Prague — Týn Church", path: 'media/europe-2010/czechia-prague-tyn-church.jpg' },
    secondary_local_images: [
      { title: 'Prague — Astronomical Clock',           path: 'media/europe-2010/czechia-prague-astronomical-clock.jpg' },
      { title: 'Prague — Astronomical Clock dial',      path: 'media/europe-2010/czechia-prague-astronomical-clock-dial.jpg' },
      { title: 'Prague — Dancing House (Gehry)',        path: 'media/europe-2010/czechia-prague-dancing-house.jpg' },
      { title: 'Prague — Žižkov Tower with Černý babies', path: 'media/europe-2010/czechia-prague-zizkov-tower-babies.jpg' },
    ],
  },
  {
    country: 'Denmark', country_slug: 'denmark', render_kind: 'polygon',
    primary_album: { title: 'Copenhagen', url: `${ALBUM_HOST}/copenhagen` },
    secondary_albums: [],
  },
  {
    // Local-file source: there's no Ecuador portfolio album yet. When
    // one lands, swap `local_image` for `primary_album`.
    country: 'Ecuador', country_slug: 'ecuador', render_kind: 'polygon',
    local_image: { title: 'Recursive reptiles, Galapagos Islands, Ecuador', path: 'media/sabbatical-travel/travel-26.jpeg' },
    secondary_local_images: [
      { title: "Darwin's finch, Galapagos Islands, Ecuador", path: 'media/sabbatical-travel/travel-25.jpeg' },
    ],
  },
  {
    country: 'Egypt', country_slug: 'egypt', render_kind: 'polygon',
    primary_album: { title: 'Luxor', url: `${ALBUM_HOST}/luxor` },
    secondary_albums: [
      { title: 'Cairo', url: `${ALBUM_HOST}/cairo-1` },
      { title: 'Aswan', url: `${ALBUM_HOST}/aswan-1` },
    ],
  },
  {
    country: 'El Salvador', country_slug: 'el-salvador', render_kind: 'polygon',
    local_image: { title: 'Iglesia El Rosario — rainbow stained glass', path: 'media/el-salvador-2025/iglesia-el-rosario.jpg' },
  },
  {
    country: 'France', country_slug: 'france', render_kind: 'polygon',
    primary_album: { title: 'Paris', url: `${ALBUM_HOST}/paris` },
    secondary_albums: [],
  },
  {
    country: 'Germany', country_slug: 'germany', render_kind: 'polygon',
    primary_album: { title: 'Munich', url: `${ALBUM_HOST}/munich` },
    secondary_albums: [
      { title: 'Frankfurt', url: `${ALBUM_HOST}/frankfurt` },
    ],
  },
  {
    country: 'Gibraltar', country_slug: 'gibraltar', render_kind: 'bubble',
    lat: 36.1408, lng: -5.3536,
    local_image: { title: 'BA plane on the runway, Rock of Gibraltar behind', path: 'media/gibraltar-2009/gibraltar-rock-runway-ba-plane.jpg' },
    notes: 'British Overseas Territory; not in NE 110m. Render as bubble at lat/lng.',
  },
  {
    country: 'Greece', country_slug: 'greece', render_kind: 'polygon',
    primary_album: { title: 'Greece - Athens, Spetses, Zakynthos', url: `${ALBUM_HOST}/greece-athens-spetses-zakynthos` },
    secondary_albums: [],
  },
  {
    country: 'Guatemala', country_slug: 'guatemala', render_kind: 'polygon',
    primary_album: { title: 'Tikal', url: `${ALBUM_HOST}/tikal` },
    secondary_albums: [
      { title: 'Chichicastenango & San Andrés Xecul', url: `${ALBUM_HOST}/chichicastenango-san-andres-xecul-2` },
      { title: 'Lake Atitlán', url: `${ALBUM_HOST}/lake-atitlan` },
      { title: 'Antigua', url: `${ALBUM_HOST}/antigua` },
    ],
  },
  {
    country: 'India', country_slug: 'india', render_kind: 'polygon',
    primary_album: { title: 'Amritsar', url: `${ALBUM_HOST}/amritsar` },
    secondary_albums: [
      { title: 'Taj Mahal', url: `${ALBUM_HOST}/taj-mahal-1` },
      { title: 'India Work Trip', url: `${ALBUM_HOST}/jaipur-hyderabad-taj-mahal` },
      { title: 'Srinagar, Kashmir', url: `${ALBUM_HOST}/srinagar-kashmir` },
      { title: 'Dharamshala', url: `${ALBUM_HOST}/dharamshala-1` },
      { title: 'Bir & Keori', url: `${ALBUM_HOST}/bir-keori` },
      { title: 'Palpung Sherabling Monastery', url: `${ALBUM_HOST}/palpung-sherabling-monastery-1` },
      { title: 'Wagah Border', url: `${ALBUM_HOST}/wagah-border` },
      { title: 'Bullet Baba Temple', url: `${ALBUM_HOST}/bullet-baba-temple` },
      { title: 'Jodhpur', url: `${ALBUM_HOST}/jodhpur` },
      { title: 'Rajasthan Bus & Desert', url: `${ALBUM_HOST}/rajasthan-bus-desert` },
      { title: 'Jaipur', url: `${ALBUM_HOST}/jaipur` },
      { title: 'Red Temple', url: `${ALBUM_HOST}/red-temple` },
      { title: 'Agra Fort', url: `${ALBUM_HOST}/agra-fort` },
      { title: 'Delhi', url: `${ALBUM_HOST}/delhi` },
    ],
  },
  {
    country: 'Ireland', country_slug: 'ireland', render_kind: 'polygon',
    local_image: { title: 'Cliffs of Moher — sun flare', path: 'media/ireland-2009/ireland-cliffs-of-moher-sunflare.jpg' },
    secondary_local_images: [
      { title: "Cliffs of Moher — O'Brien's Tower", path: 'media/ireland-2009/ireland-cliffs-of-moher-obriens-tower.jpg' },
    ],
  },
  {
    country: 'Italy', country_slug: 'italy', render_kind: 'polygon',
    local_image: { title: 'Venice — canal at sunset', path: 'media/alps-2025/italy-venice-canal.jpg' },
    secondary_local_images: [
      { title: 'Naples — Spanish Quarter', path: 'media/alps-2025/italy-naples.jpg' },
    ],
  },
  {
    // Japan is an archipelago — its NE 110m geometry is three sub-
    // polygons (Honshu, Hokkaido, Kyushu/Shikoku). Each polygon gets
    // its own UV-mapped sample of the same hero photo, which is fine:
    // a recognizable shot reads three times instead of distorted once.
    country: 'Japan', country_slug: 'japan', render_kind: 'polygon',
    primary_album: { title: 'Japan', url: `${ALBUM_HOST}/japan` },
    secondary_albums: [
      { title: 'Japan - Sakura Festival', url: `${ALBUM_HOST}/japan-sakura-festival` },
      { title: 'Japan - Team Labs Planets', url: `${ALBUM_HOST}/japan-team-labs-planets` },
    ],
  },
  {
    country: 'Kenya', country_slug: 'kenya', render_kind: 'polygon',
    primary_album: { title: 'Nairobi National Park', url: `${ALBUM_HOST}/nairobi-national-park` },
    secondary_albums: [
      { title: 'Masai Mara', url: `${ALBUM_HOST}/masai-mara` },
      { title: 'GRAPHIC! - Lion Hunt in Masai Mara', url: `${ALBUM_HOST}/graphic-lion-hunt-in-masai-mara` },
      { title: 'Lake Nakuru', url: `${ALBUM_HOST}/lake-nakuru` },
    ],
  },
  {
    country: 'Liechtenstein', country_slug: 'liechtenstein', render_kind: 'bubble',
    lat: 47.166, lng: 9.555,
    local_image: { title: 'Vaduz — castle reflected in glass', path: 'media/alps-2025/liechtenstein-vaduz.jpg' },
    notes: 'Microstate; not in NE 110m. Render as bubble at lat/lng.',
  },
  {
    country: 'Madagascar', country_slug: 'madagascar', render_kind: 'polygon',
    primary_album: { title: 'Andasibe Analamazaotra National Park', url: `${ALBUM_HOST}/andasibe-analamazaotra-national-park` },
    secondary_albums: [
      { title: 'Zazamalala Wildlife Centre', url: `${ALBUM_HOST}/zazamalala-wildlife-centre` },
      { title: 'Avenue of the Baobabs', url: `${ALBUM_HOST}/avenue-of-the-baobabs` },
      { title: 'Tsingy of Bemaraha National Park', url: `${ALBUM_HOST}/tsingy-of-bemaraha-national-park` },
      { title: 'Kirindy Reserve', url: `${ALBUM_HOST}/kirindy-reserve` },
    ],
  },
  {
    country: 'Malaysia', country_slug: 'malaysia', render_kind: 'polygon',
    primary_album: { title: 'Kuala Lampur', url: `${ALBUM_HOST}/kuala-lampur` },
    secondary_albums: [],
  },
  {
    country: 'Mexico', country_slug: 'mexico', render_kind: 'polygon',
    primary_album: { title: 'Teotihuacan & Mexcio City', url: `${ALBUM_HOST}/teotihuacan-mexcio-city` },
    secondary_albums: [],
  },
  {
    country: 'Morocco', country_slug: 'morocco', render_kind: 'polygon',
    local_image: { title: 'Marrakech — Madrasa Ben Youssef', path: 'media/morocco-2010/morocco-marrakech-madrasa-ben-youssef.jpg' },
    secondary_local_images: [
      { title: 'Marrakech — Jemaa el-Fna at night',     path: 'media/morocco-2010/morocco-marrakech-jemaa-el-fna.jpg' },
      { title: 'Sahara — sunset over the dunes',        path: 'media/morocco-2010/morocco-sahara-sunset.jpg' },
      { title: 'Sahara — camel caravan',                path: 'media/morocco-2010/morocco-sahara-camel-caravan.jpg' },
      { title: 'Medina alley — djellaba walker',        path: 'media/morocco-2010/morocco-medina-alley.jpg' },
      { title: '"Internet Lilane" cafe',                path: 'media/morocco-2010/morocco-internet-cafe.jpg' },
      { title: 'Marrakech — tannery',                   path: 'media/morocco-2010/morocco-marrakech-tannery.jpg' },
      { title: 'Marrakech — Menara Gardens pool jump',  path: 'media/morocco-2010/morocco-marrakech-menara-gardens.jpg' },
      { title: 'Marrakech — souk sweets stall',         path: 'media/morocco-2010/morocco-marrakech-souk-sweets.jpg' },
      { title: 'Marrakech — drying leather hide',       path: 'media/morocco-2010/morocco-marrakech-leather-hide.jpg' },
      { title: 'High Atlas Mountains',                  path: 'media/morocco-2010/morocco-atlas-mountains.jpg' },
    ],
  },
  {
    country: 'Netherlands', country_slug: 'netherlands', render_kind: 'polygon',
    local_image: { title: 'Amsterdam — stepped-gable house', path: 'media/europe-2010/netherlands-amsterdam-gable-house.jpg' },
    secondary_local_images: [
      { title: 'Amsterdam — canal with tour boats', path: 'media/europe-2010/netherlands-amsterdam-canal-boats.jpg' },
      { title: 'Amsterdam — red Canta microcar',    path: 'media/europe-2010/netherlands-amsterdam-canta-car.jpg' },
      { title: 'Amsterdam — canal houseboat garden', path: 'media/europe-2010/netherlands-amsterdam-canal-houseboat.jpg' },
    ],
  },
  {
    country: 'Norway', country_slug: 'norway', render_kind: 'polygon',
    primary_album: { title: 'Tromsø', url: `${ALBUM_HOST}/tromso` },
    secondary_albums: [
      { title: 'Polar Park', url: `${ALBUM_HOST}/polar-park` },
      { title: 'Bergen', url: `${ALBUM_HOST}/bergen` },
      { title: 'Aurlandsfjord - Flåm', url: `${ALBUM_HOST}/aurlandsfjord-flam` },
      { title: 'Oslo', url: `${ALBUM_HOST}/oslo` },
    ],
  },
  {
    country: 'Panama', country_slug: 'panama', render_kind: 'polygon',
    local_image: { title: 'Panama Canal — Baltic Spirit in the locks', path: 'media/panama-2025/panama-canal-baltic-spirit.jpg' },
    secondary_local_images: [
      { title: 'Panama City — skyline + F&F Tower',  path: 'media/panama-2025/panama-city-skyline.jpg' },
      { title: 'Three-toed sloth in the rainforest', path: 'media/panama-2025/panama-three-toed-sloth.jpg' },
      { title: 'Biomuseo — Frank Gehry roof',        path: 'media/panama-2025/panama-biomuseo.jpg' },
      { title: 'Panama Canal — tanker with tugboat', path: 'media/panama-2025/panama-canal-tanker.jpg' },
    ],
  },
  {
    country: 'Paraguay', country_slug: 'paraguay', render_kind: 'polygon',
    local_image: { title: 'River canoe through wetlands', path: 'media/paraguay-2025/paraguay-river-canoe.jpg' },
    secondary_local_images: [
      { title: 'Red-and-green macaw',        path: 'media/paraguay-2025/paraguay-scarlet-macaw.jpg' },
      { title: 'Wetland cumulus reflection', path: 'media/paraguay-2025/paraguay-wetland-cloud.jpg' },
    ],
  },
  {
    country: 'Peru', country_slug: 'peru', render_kind: 'polygon',
    primary_album: { title: 'Machu Picchu', url: `${ALBUM_HOST}/machu-picchu-1` },
    secondary_albums: [
      { title: 'Lake Titicaca', url: `${ALBUM_HOST}/lake-titicaca` },
      { title: 'Tambopata', url: `${ALBUM_HOST}/tambopata` },
      { title: 'Peru - Cusco', url: `${ALBUM_HOST}/peru-cusco` },
      { title: 'Peru - Sacred Valley', url: `${ALBUM_HOST}/peru-sacred-valley` },
      { title: 'Peru - Lima', url: `${ALBUM_HOST}/peru-lima` },
    ],
  },
  {
    country: 'Portugal', country_slug: 'portugal', render_kind: 'polygon',
    primary_album: { title: 'Lisbon', url: `${ALBUM_HOST}/lisbon-1` },
    secondary_albums: [
      { title: 'Porto', url: `${ALBUM_HOST}/porto` },
      { title: 'Pena Palace & Castelo de São Jorge', url: `${ALBUM_HOST}/pena-palace-castelo-de-sao-jorge` },
    ],
  },
  {
    country: 'Rwanda', country_slug: 'rwanda', render_kind: 'polygon',
    primary_album: { title: 'Gorilla Trek - Rwanda', url: `${ALBUM_HOST}/gorilla-trek-rwanda` },
    secondary_albums: [],
  },
  {
    country: 'San Marino', country_slug: 'san-marino', render_kind: 'bubble',
    lat: 43.9424, lng: 12.4578,
    local_image: { title: 'Three Towers — Mount Titano', path: 'media/alps-2025/san-marino-three-towers.jpg' },
    notes: 'Microstate; not in NE 110m. Render as bubble at lat/lng.',
  },
  {
    country: 'South Africa', country_slug: 'south-africa', render_kind: 'polygon',
    primary_album: { title: 'Sabi Sands - Big Cats', url: `${ALBUM_HOST}/sabi-sands-big-cats` },
    secondary_albums: [
      { title: 'Cape Town', url: `${ALBUM_HOST}/cape-town-2` },
      { title: 'Kirstenbosch National Botanical Garden', url: `${ALBUM_HOST}/kirstenbosch-national-botanical-garden` },
      { title: 'Cape of Good Hope', url: `${ALBUM_HOST}/cape-of-good-hope` },
      { title: 'Boulders Beach', url: `${ALBUM_HOST}/boulders-beach-1` },
      { title: 'Sabi Sands', url: `${ALBUM_HOST}/sabi-sands` },
    ],
  },
  {
    country: 'Spain', country_slug: 'spain', render_kind: 'polygon',
    primary_album: { title: 'Barcelona', url: `${ALBUM_HOST}/barcelona` },
    secondary_albums: [
      { title: 'Sevilla', url: `${ALBUM_HOST}/sevilla` },
      { title: 'Dali Museum', url: `${ALBUM_HOST}/dali-museum` },
    ],
  },
  {
    country: 'Sweden', country_slug: 'sweden', render_kind: 'polygon',
    primary_album: { title: 'Stockholm', url: `${ALBUM_HOST}/stockholm` },
    secondary_albums: [],
  },
  {
    country: 'Switzerland', country_slug: 'switzerland', render_kind: 'polygon',
    local_image: { title: 'Zurich — old town alley', path: 'media/alps-2025/switzerland-zurich-old-town.jpg' },
    secondary_local_images: [
      { title: 'Lucerne — Hofkirche St. Leodegar',         path: 'media/alps-2025/switzerland-lucerne-hofkirche.jpg' },
      { title: 'Lake Lucerne — sailboat under the Alps',   path: 'media/alps-2025/switzerland-lake-lucerne.jpg' },
      { title: 'Lucerne — Hofkirche from across the lake', path: 'media/alps-2025/switzerland-lucerne-hofkirche-wide.jpg' },
    ],
  },
  {
    country: 'Thailand', country_slug: 'thailand', render_kind: 'polygon',
    primary_album: { title: 'Thailand', url: `${ALBUM_HOST}/thailand-1` },
    secondary_albums: [],
  },
  {
    country: 'Turkey', country_slug: 'turkey', render_kind: 'polygon',
    local_image: { title: 'Cappadocia — hot-air balloon at dawn', path: 'media/turkey-2010/turkey-cappadocia-balloon.jpg' },
    secondary_local_images: [
      { title: 'Cappadocia — fairy chimneys', path: 'media/turkey-2010/turkey-cappadocia-fairy-chimneys.jpg' },
    ],
  },
  {
    country: 'Uganda', country_slug: 'uganda', render_kind: 'polygon',
    primary_album: { title: 'Lake Victoria Chimpanzee Sanctuary', url: `${ALBUM_HOST}/lake-victoria-chimpanzee-sanctuary` },
    secondary_albums: [
      { title: 'Lake Victoria', url: `${ALBUM_HOST}/lake-victoria-1` },
      { title: 'Kampala & Entebbe', url: `${ALBUM_HOST}/kampala-entebbe` },
      { title: 'Kazinga Channel', url: `${ALBUM_HOST}/kazinga-channel` },
      { title: 'Kalinzu Forest', url: `${ALBUM_HOST}/kalinzu-forest` },
      { title: 'Queen Elizabeth National Park', url: `${ALBUM_HOST}/queen-elizabeth-national-park-1` },
    ],
  },
  {
    country: 'United Arab Emirates', country_slug: 'united-arab-emirates', render_kind: 'polygon',
    primary_album: { title: 'Dubai', url: `${ALBUM_HOST}/dubai` },
    secondary_albums: [],
  },
  {
    country: 'United Kingdom', country_slug: 'united-kingdom', render_kind: 'polygon',
    primary_album: { title: 'London Layover', url: `${ALBUM_HOST}/london-layover-1` },
    secondary_albums: [],
  },
  {
    country: 'United States of America', country_slug: 'united-states-of-america', render_kind: 'polygon',
    primary_album: { title: 'Minneapolis', url: `${ALBUM_HOST}/minneapolis-1` },
    secondary_albums: [
      { title: 'Grand Canyon', url: `${ALBUM_HOST}/grand-canyon` },
      { title: 'New Orleans', url: `${ALBUM_HOST}/new-orleans-1` },
      { title: 'Meowwolf - Denver', url: `${ALBUM_HOST}/meowwolf-denver` },
      { title: 'Rocky Mountain National Park', url: `${ALBUM_HOST}/rocky-mountain-national-park` },
      { title: 'Everglades', url: `${ALBUM_HOST}/everglades` },
      { title: 'Death Valley', url: `${ALBUM_HOST}/death-valley` },
      { title: 'Honolulu', url: `${ALBUM_HOST}/honolulu` },
      { title: "O'ahu", url: `${ALBUM_HOST}/oahu` },
      { title: 'Lassen National Park', url: `${ALBUM_HOST}/lassen-national-park` },
      { title: 'San Francisco', url: `${ALBUM_HOST}/san-francisco` },
      { title: 'San Francisco (older)', url: `${ALBUM_HOST}/san-francisco-1` },
      { title: 'Cleveland', url: `${ALBUM_HOST}/cleveland` },
      { title: 'Chicago', url: `${ALBUM_HOST}/chicago` },
      { title: 'Sapphire, North Carolina', url: `${ALBUM_HOST}/sapphire-north-carolina` },
      { title: 'Florida Keys', url: `${ALBUM_HOST}/florida-keys` },
      { title: 'New Orleans (older)', url: `${ALBUM_HOST}/new-orleans-2` },
      { title: 'Red Rocks Ampitheater', url: `${ALBUM_HOST}/red-rocks-ampitheater` },
      { title: 'San Diego', url: `${ALBUM_HOST}/san-diego` },
      { title: 'Portland', url: `${ALBUM_HOST}/portland` },
      { title: 'Napa Valley', url: `${ALBUM_HOST}/napa-valley` },
    ],
  },
  {
    country: 'Uruguay', country_slug: 'uruguay', render_kind: 'polygon',
    primary_album: { title: 'Uruguay', url: `${ALBUM_HOST}/uruguay` },
    secondary_albums: [],
  },
  // Microstates — bubble overlay (not in Natural Earth 110m polygons).
  // Liechtenstein and San Marino entries above for alphabetical sort,
  // but they share the same render kind as the entries below.
  {
    country: 'Singapore', country_slug: 'singapore', render_kind: 'bubble',
    lat: 1.3521, lng: 103.8198,
    primary_album: { title: 'Singapore', url: `${ALBUM_HOST}/singapore` },
    secondary_albums: [],
    notes: 'Microstate; not in NE 110m. Render as bubble at lat/lng.',
  },
  {
    country: 'Vatican', country_slug: 'vatican', render_kind: 'bubble',
    lat: 41.9029, lng: 12.4534,
    local_image: { title: 'Gallery of Maps — Vatican Museums', path: 'media/alps-2025/vatican-gallery-of-maps.jpg' },
    notes: 'Microstate; not in NE 110m. Render as bubble at lat/lng.',
  },
];

// =============================================================
// Pipeline
// =============================================================

async function fetchHTML(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'photo-atlas-builder/1.0' },
  });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.text();
}

// Walk an index page's HTML and build a map of album URL → cover image
// URL at the largest available width. Adobe Portfolio uses two cover
// transforms: `_carw_4x3xN` (auto 4:3 center-crop at width N) and
// `_rwc_{x}x{y}x{w}x{h}xN` (manual crop region at width N). In both,
// the last integer before `.jpg` is the rendered width. Each variant
// has its own `?h=` hash, so we can't transform a small variant into
// a large one — we have to read the real URL from the srcset.
//
// Some albums share the same cover image but differ only by the crop
// (e.g. duplicate uploads in different albums). We key by album path,
// so collisions are not a concern here.
function parseIndexCovers(html: string, host: string): Map<string, string> {
  const map = new Map<string, string>();

  // Each album is rendered as <a class="project-cover" href="/foo"> with
  // its <img srcset="..."> inside. Match each anchor and inspect its
  // inner srcset for cover variants.
  const anchorRe = /<a[^>]+href="(\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g;
  // Captures: [full url] and [width-in-px]. The `(?:\d+x)+` swallows
  // however many `Nx` segments precede the final width, which is the
  // common shape of both transforms (carw has 2 leading ints, rwc has 4).
  const variantRe = /https:\/\/cdn\.myportfolio\.com\/[a-z0-9-]+\/[a-z0-9-]+_(?:carw|rwc)_(?:\d+x)+(\d+)\.jpg\?h=[a-f0-9]+/g;

  for (const m of html.matchAll(anchorRe)) {
    const path = m[1]!;
    const inner = m[2]!;
    if (path === '/' || path.startsWith('/2012-2023')) continue;

    let bestWidth = 0;
    let bestUrl: string | null = null;
    for (const v of inner.matchAll(variantRe)) {
      const w = parseInt(v[1]!, 10);
      if (w > bestWidth) { bestWidth = w; bestUrl = v[0]; }
    }
    if (bestUrl) map.set(`${host}${path}`, bestUrl);
  }
  return map;
}

async function downloadImage(imgUrl: string, dest: string): Promise<void> {
  const res = await fetch(imgUrl);
  if (!res.ok) throw new Error(`${res.status} downloading ${imgUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

// Resolve an album URL → local raw JPEG path using a pre-built index
// cover map. Cached on disk: a sidecar `.url` records the source URL
// so re-runs short-circuit re-downloads only when both the local file
// and the cached source URL match the current cover URL. If the
// portfolio updates a cover, the new URL won't match and we re-fetch.
async function resolveAlbumCover(
  album: AlbumRef,
  coverByUrl: Map<string, string>,
): Promise<{ path: string; sourceUrl: string }> {
  const slug = albumSlug(album.url);
  const dest = join(RAW_DIR, `${slug}.jpg`);
  const meta = join(RAW_DIR, `${slug}.url`);
  const coverUrl = coverByUrl.get(album.url);
  if (!coverUrl) throw new Error(`no index cover found for ${album.url}`);

  if (existsSync(dest) && existsSync(meta)) {
    const cachedUrl = (await readFile(meta, 'utf8')).trim();
    if (cachedUrl === coverUrl) return { path: dest, sourceUrl: coverUrl };
  }
  console.log(`  fetch cover ${album.title}`);
  await downloadImage(coverUrl, dest);
  await writeFile(meta, coverUrl);
  return { path: dest, sourceUrl: coverUrl };
}

async function resizeToTexture(srcPath: string, destPath: string): Promise<void> {
  await sharp(srcPath)
    .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(destPath);
  // Splash-tile variant — see TILE_LONG_EDGE comment near the top.
  await sharp(srcPath)
    .resize({ width: TILE_LONG_EDGE, height: TILE_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: TILE_QUALITY, mozjpeg: true })
    .toFile(tilePathFor(destPath));
  // Splash-mid variant — see MID_LONG_EDGE comment near the top.
  await sharp(srcPath)
    .resize({ width: MID_LONG_EDGE, height: MID_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: MID_QUALITY, mozjpeg: true })
    .toFile(midPathFor(destPath));
}

export async function buildIndexCoverMap(): Promise<Map<string, string>> {
  const indexes = [
    `${ALBUM_HOST}/`,
    `${ALBUM_HOST}/2012-2023`,
  ];
  const map = new Map<string, string>();
  for (const url of indexes) {
    const html = await fetchHTML(url);
    const partial = parseIndexCovers(html, ALBUM_HOST);
    for (const [k, v] of partial) map.set(k, v);
    console.log(`  scraped ${partial.size} covers from ${url}`);
  }
  return map;
}

async function main() {
  await mkdir(MEDIA_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(join(ROOT, 'data'), { recursive: true });

  console.log('Building index→cover map...');
  const coverByUrl = await buildIndexCoverMap();
  console.log(`  total ${coverByUrl.size} covers indexed\n`);

  // Sanity check: every album URL referenced in MANIFEST must exist in
  // the cover map. Fail loud at startup rather than mid-run. Validates
  // both `primary_album` (the source for the texture) and any
  // `secondary_albums` paper trail — catches dead URLs even when the
  // album isn't currently used as a source.
  const missing: string[] = [];
  for (const entry of MANIFEST) {
    const refs: AlbumRef[] = [
      ...(entry.primary_album ? [entry.primary_album] : []),
      ...(entry.secondary_albums ?? []),
    ];
    for (const r of refs) {
      if (!coverByUrl.has(r.url)) missing.push(`  ${entry.country}: ${r.url}`);
    }
  }
  if (missing.length) {
    console.error('Album URLs missing from index cover map:');
    for (const m of missing) console.error(m);
    process.exit(1);
  }

  // Wholesale cache invalidation — needed only on a schema rewrite
  // (e.g. switching from "first photo in album" to "index cover" as the
  // texture source). Per-album URL check in resolveAlbumCover otherwise
  // catches changed covers correctly. Opt in via WIPE_RAW=1 so routine
  // re-runs (adding a country, regridding) reuse cached downloads.
  if (process.env.WIPE_RAW === '1' && existsSync(RAW_DIR)) {
    console.log('WIPE_RAW=1 → wiping raw cache');
    await rm(RAW_DIR, { recursive: true, force: true });
    await mkdir(RAW_DIR, { recursive: true });
  }

  const atlas: object[] = [];

  for (const entry of MANIFEST) {
    const dest = join(MEDIA_DIR, `${entry.country_slug}.jpg`);
    process.stdout.write(`\n[${entry.country}] (${entry.render_kind}) → ${dest}\n`);

    // All three render kinds (polygon, bubble, flat) use a single source
    // photo. local_image wins over primary_album when both are set
    // (Australia: hero pinned to a local file, portfolio albums stay as
    // a paper trail in secondary_albums).
    const needsLatLng = entry.render_kind === 'bubble' || entry.render_kind === 'flat';
    const record: Record<string, unknown> = {
      country: entry.country,
      country_slug: entry.country_slug,
      render_kind: entry.render_kind,
      ...(needsLatLng ? { lat: entry.lat, lng: entry.lng } : {}),
      image: `media/portfolio/${entry.country_slug}.jpg`,
      // Splash uses the 768-edge mid variant (~40-60 KB) since the
      // 2026-07 globe-anchor hero; the 384-edge tile remains as the
      // small-surface fallback; /explorer/ uses the full-res `image`.
      // All generated by resizeToTexture.
      image_tile: `media/portfolio/${entry.country_slug}-tile.jpg`,
      image_mid: `media/portfolio/${entry.country_slug}-mid.jpg`,
    };

    // Attach the portfolio's CDN cover URL to every album reference.
    // The frontend uses it as a thumbnail; the validation pass at
    // startup guarantees every album.url is present in coverByUrl, so
    // a `.get(...) ?? ''` would mask a real bug — throw instead.
    const withCover = (a: AlbumRef): AlbumRef => {
      const url = coverByUrl.get(a.url);
      if (!url) throw new Error(`no index cover for ${a.url}`);
      return { ...a, source_image_url: url };
    };

    if (entry.local_image) {
      const localPath = join(ROOT, entry.local_image.path);
      if (!existsSync(localPath)) {
        console.error(`local image missing for ${entry.country}: ${localPath}`);
        process.exit(1);
      }
      await resizeToTexture(localPath, dest);
      record.local_image = entry.local_image;
      if (entry.secondary_local_images && entry.secondary_local_images.length) {
        record.secondary_local_images = entry.secondary_local_images;
      }
      // An entry with a local_image hero may still carry portfolio
      // albums as a paper trail (e.g. Australia). Preserve them.
      if (entry.secondary_albums && entry.secondary_albums.length) {
        record.secondary_albums = entry.secondary_albums.map(withCover);
      }
    } else if (entry.primary_album) {
      const { path, sourceUrl } = await resolveAlbumCover(entry.primary_album, coverByUrl);
      await resizeToTexture(path, dest);
      record.primary_album = { ...entry.primary_album, source_image_url: sourceUrl };
      record.secondary_albums = (entry.secondary_albums ?? []).map(withCover);
    } else {
      console.error(`${entry.country}: needs primary_album or local_image`);
      process.exit(1);
    }

    if (entry.notes) record.notes = entry.notes;
    atlas.push(record);
  }

  await writeFile(ATLAS_PATH, JSON.stringify(atlas, null, 2) + '\n');
  console.log(`\nwrote ${ATLAS_PATH} (${atlas.length} entries)`);
}

void slug; // exported helper kept for future curated-rename passes

// Only run main() when invoked directly (e.g. `bun run scripts/build-photo-atlas.ts`).
// Other scripts import MANIFEST + helpers from this module without triggering a build.
if (import.meta.main) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
