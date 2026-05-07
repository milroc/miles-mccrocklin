// Build the photo atlas for the splash globe.
//
// Scrape the portfolio index pages for each album's cover image (the
// `_carw_4x3xN` srcset, taking the largest variant). For each entry in
// MANIFEST below, look up the cover URL and download. For
// `polygon_grid` countries (India, USA), do that for every album, then
// composite into a single square grid texture via sharp.
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
const ALBUM_HOST = 'https://milesmccrocklin.myportfolio.com';

interface AlbumRef {
  title: string;
  url: string;
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
  notes?: string;
}

// A single local-file photo used in place of a portfolio album. Carries
// a title (so the atlas record stays human-readable) and a project-root-
// relative path to the JPEG. Use for countries we haven't yet published
// a portfolio album for but already have suitable shots in
// media/sabbatical-travel or similar.
interface LocalImageRef {
  title: string;
  path: string;
}

interface GridEntry {
  country: string;
  country_slug: string;
  render_kind: 'polygon_grid';
  grid: { rows: number; cols: number };
  // Either pull cells from the portfolio (`albums`) or from local files
  // (`local_images`) — at least one must be non-empty. Mixed not
  // supported for now; if a country needs both, publish the local shots
  // to the portfolio first.
  albums?: AlbumRef[];
  local_images?: LocalImageRef[];
  // Optional per-cell overrides keyed by zero-based cell index (row-
  // major, top-left = 0). Replaces whatever album/local would have
  // landed in that cell with a specific local file. Used for spotting
  // a hand-picked hero shot in the visual center of a country
  // (Australia's 3×3 → cell 4 = center → "Splash!" Sydney photo).
  cell_overrides?: Record<number, LocalImageRef>;
  notes?: string;
}

// Flat photo card overlay — rendered as a rectangular HTML element
// anchored at lat/lng, like a bubble but bigger. Used for countries
// where the polygon's UV mapping distorts the photo (Antarctica, where
// the polygon wraps around the south pole). Composite image is built
// the same way as a polygon_grid; only the renderer differs.
interface FlatEntry {
  country: string;
  country_slug: string;
  render_kind: 'flat';
  lat: number;
  lng: number;
  grid: { rows: number; cols: number };
  albums?: AlbumRef[];
  local_images?: LocalImageRef[];
  cell_overrides?: Record<number, LocalImageRef>;
  notes?: string;
}

type Entry = SingleEntry | BubbleEntry | GridEntry | FlatEntry;

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

const MANIFEST: Entry[] = [
  {
    // 'flat' instead of 'polygon_grid': Antarctica's polygon wraps
    // around the south pole and ConicPolygonGeometry stretches the
    // composite into an unreadable smear. Render as a rectangular HTML
    // overlay anchored deep in Antarctica (lat -78) — react-globe.gl
    // handles the spherical projection, photo never warps.
    country: 'Antarctica', country_slug: 'antarctica', render_kind: 'flat',
    lat: -78, lng: 0,
    grid: { rows: 2, cols: 2 }, // 4 cells, 4 photos — no cycling needed
    albums: [
      { title: 'Antarctica - Penguins', url: `${ALBUM_HOST}/antarctica-penguins` },
      { title: 'Antarctica - Glaciers', url: `${ALBUM_HOST}/antarctica-glaciers` },
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
    country: 'Australia', country_slug: 'australia', render_kind: 'polygon_grid',
    grid: { rows: 3, cols: 3 }, // 9 cells, 9 photos — no cycling needed
    albums: [
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
    // Spot the "Splash!" shot (Sydney swimmer mid-air, the most
    // iconic Australia frame in the splash gallery) at the visual
    // center of the 3×3 grid.
    cell_overrides: {
      4: { title: 'Splash!, Sydney, Australia', path: 'media/sabbatical-travel/travel-24.jpeg' },
    },
  },
  {
    country: 'Austria', country_slug: 'austria', render_kind: 'polygon_grid',
    grid: { rows: 1, cols: 3 }, // 3 cells, 3 photos. Austria is E-W
    // elongated, so a horizontal strip matches the country shape.
    local_images: [
      { title: 'Vienna — Hundertwasserhaus', path: 'media/europe-2010/austria-vienna-hundertwasserhaus.jpg' },
      { title: 'Vienna — math.space stairs at the Museumsquartier', path: 'media/europe-2010/austria-vienna-math-space.jpg' },
      { title: 'Vienna — Stephansplatz + Haas Haus', path: 'media/europe-2010/austria-vienna-stephansplatz.jpg' },
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
    country: 'Brazil', country_slug: 'brazil', render_kind: 'polygon_grid',
    grid: { rows: 3, cols: 4 }, // 12 cells, 10 photos + 2 cycled. Brazil
    // is roughly square; the slightly wider 3×4 grid spreads Rio + Iguaçu
    // + wildlife shots across the bbox.
    local_images: [
      { title: 'Sugarloaf — Botafogo Bay from Corcovado',     path: 'media/brazil-2025/rio-sugarloaf-from-corcovado.jpg' },
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
    country: 'Chile', country_slug: 'chile', render_kind: 'polygon_grid',
    grid: { rows: 3, cols: 3 }, // 9 cells, 7 albums + 2 cycled. Chile's
    // bbox aspect is 0.18 (5.5× taller than wide) so a single photo
    // gets crushed horizontally — grid fixes that.
    albums: [
      { title: 'Cajon de Maipo', url: `${ALBUM_HOST}/cajon-de-maipo` },
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
    country: 'Czechia', country_slug: 'czechia', render_kind: 'polygon_grid',
    grid: { rows: 2, cols: 3 }, // 6 cells, 5 photos + 1 cycled. Czechia
    // bbox is wider than tall (~3:1) — wider grid mirrors the country shape.
    local_images: [
      { title: 'Prague — Astronomical Clock',           path: 'media/europe-2010/czechia-prague-astronomical-clock.jpg' },
      { title: 'Prague — Astronomical Clock dial',      path: 'media/europe-2010/czechia-prague-astronomical-clock-dial.jpg' },
      { title: "Prague — Týn Church",                   path: 'media/europe-2010/czechia-prague-tyn-church.jpg' },
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
    country: 'Ecuador', country_slug: 'ecuador', render_kind: 'polygon_grid',
    grid: { rows: 2, cols: 1 }, // 2 cells stacked, both filled.
    // Sources are local sabbatical-travel files (Galapagos shots) since
    // there's no Ecuador portfolio album yet. When one lands, swap to
    // `albums:` with portfolio URLs.
    local_images: [
      { title: "Darwin's finch, Galapagos Islands, Ecuador", path: 'media/sabbatical-travel/travel-25.jpeg' },
      { title: 'Recursive reptiles, Galapagos Islands, Ecuador', path: 'media/sabbatical-travel/travel-26.jpeg' },
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
    country: 'India', country_slug: 'india', render_kind: 'polygon_grid',
    grid: { rows: 4, cols: 4 }, // 16 cells, 15 photos + 1 empty
    albums: [
      { title: 'Taj Mahal', url: `${ALBUM_HOST}/taj-mahal-1` },
      { title: 'India Work Trip', url: `${ALBUM_HOST}/jaipur-hyderabad-taj-mahal` },
      { title: 'Srinagar, Kashmir', url: `${ALBUM_HOST}/srinagar-kashmir` },
      { title: 'Dharamshala', url: `${ALBUM_HOST}/dharamshala-1` },
      { title: 'Bir & Keori', url: `${ALBUM_HOST}/bir-keori` },
      { title: 'Palpung Sherabling Monastery', url: `${ALBUM_HOST}/palpung-sherabling-monastery-1` },
      { title: 'Wagah Border', url: `${ALBUM_HOST}/wagah-border` },
      { title: 'Amritsar', url: `${ALBUM_HOST}/amritsar` },
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
    country: 'Ireland', country_slug: 'ireland', render_kind: 'polygon_grid',
    grid: { rows: 1, cols: 2 }, // 2 cells, 2 photos. Cliffs of Moher pair.
    local_images: [
      { title: 'Cliffs of Moher — sun flare',           path: 'media/ireland-2009/ireland-cliffs-of-moher-sunflare.jpg' },
      { title: "Cliffs of Moher — O'Brien's Tower",     path: 'media/ireland-2009/ireland-cliffs-of-moher-obriens-tower.jpg' },
    ],
  },
  {
    country: 'Italy', country_slug: 'italy', render_kind: 'polygon_grid',
    grid: { rows: 1, cols: 2 }, // 2 cells, 2 photos. From Alps 2025 trip.
    local_images: [
      { title: 'Naples — Spanish Quarter', path: 'media/alps-2025/italy-naples.jpg' },
      { title: 'Venice — canal at sunset',  path: 'media/alps-2025/italy-venice-canal.jpg' },
    ],
  },
  {
    country: 'Japan', country_slug: 'japan', render_kind: 'polygon_grid',
    grid: { rows: 2, cols: 2 }, // 4 cells, 3 albums + 1 cycled.
    // Archipelago — three sub-polygons (Honshu, Hokkaido, Kyushu/Shikoku)
    // each get the full texture, so a single photo gets repeated
    // verbatim 3× across the islands. Grid spreads it.
    albums: [
      { title: 'Japan', url: `${ALBUM_HOST}/japan` },
      { title: 'Japan - Sakura Festival', url: `${ALBUM_HOST}/japan-sakura-festival` },
      { title: 'Japan - Team Labs Planets', url: `${ALBUM_HOST}/japan-team-labs-planets` },
    ],
  },
  {
    country: 'Kenya', country_slug: 'kenya', render_kind: 'polygon',
    primary_album: { title: 'Masai Mara', url: `${ALBUM_HOST}/masai-mara` },
    secondary_albums: [
      { title: 'GRAPHIC! - Lion Hunt in Masai Mara', url: `${ALBUM_HOST}/graphic-lion-hunt-in-masai-mara` },
      { title: 'Lake Nakuru', url: `${ALBUM_HOST}/lake-nakuru` },
      { title: 'Nairobi National Park', url: `${ALBUM_HOST}/nairobi-national-park` },
    ],
  },
  {
    country: 'Liechtenstein', country_slug: 'liechtenstein', render_kind: 'bubble',
    lat: 47.166, lng: 9.555,
    local_image: { title: 'Vaduz — castle reflected in glass', path: 'media/alps-2025/liechtenstein-vaduz.jpg' },
    notes: 'Microstate; not in NE 110m. Render as bubble at lat/lng.',
  },
  {
    country: 'Madagascar', country_slug: 'madagascar', render_kind: 'polygon_grid',
    grid: { rows: 3, cols: 2 }, // 6 cells, 5 albums + 1 cycled. Long
    // N-S island, bbox aspect 0.5 (twice as tall as wide).
    albums: [
      { title: 'Zazamalala Wildlife Centre', url: `${ALBUM_HOST}/zazamalala-wildlife-centre` },
      { title: 'Avenue of the Baobabs', url: `${ALBUM_HOST}/avenue-of-the-baobabs` },
      { title: 'Tsingy of Bemaraha National Park', url: `${ALBUM_HOST}/tsingy-of-bemaraha-national-park` },
      { title: 'Kirindy Reserve', url: `${ALBUM_HOST}/kirindy-reserve` },
      { title: 'Andasibe Analamazaotra National Park', url: `${ALBUM_HOST}/andasibe-analamazaotra-national-park` },
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
    country: 'Morocco', country_slug: 'morocco', render_kind: 'polygon_grid',
    grid: { rows: 3, cols: 4 }, // 12 cells, 11 photos + 1 cycled. Morocco
    // bbox is wider than tall (~1.4:1) — Atlas range plus coast.
    local_images: [
      { title: 'Marrakech — Jemaa el-Fna at night',     path: 'media/morocco-2010/morocco-marrakech-jemaa-el-fna.jpg' },
      { title: 'Sahara — sunset over the dunes',        path: 'media/morocco-2010/morocco-sahara-sunset.jpg' },
      { title: 'Sahara — camel caravan',                path: 'media/morocco-2010/morocco-sahara-camel-caravan.jpg' },
      { title: 'Medina alley — djellaba walker',        path: 'media/morocco-2010/morocco-medina-alley.jpg' },
      { title: '"Internet Lilane" cafe',                path: 'media/morocco-2010/morocco-internet-cafe.jpg' },
      { title: 'Marrakech — tannery',                   path: 'media/morocco-2010/morocco-marrakech-tannery.jpg' },
      { title: 'Marrakech — Menara Gardens pool jump',  path: 'media/morocco-2010/morocco-marrakech-menara-gardens.jpg' },
      { title: 'Marrakech — souk sweets stall',         path: 'media/morocco-2010/morocco-marrakech-souk-sweets.jpg' },
      { title: 'Marrakech — drying leather hide',       path: 'media/morocco-2010/morocco-marrakech-leather-hide.jpg' },
      { title: 'Marrakech — Madrasa Ben Youssef',       path: 'media/morocco-2010/morocco-marrakech-madrasa-ben-youssef.jpg' },
      { title: 'High Atlas Mountains',                  path: 'media/morocco-2010/morocco-atlas-mountains.jpg' },
    ],
  },
  {
    country: 'Netherlands', country_slug: 'netherlands', render_kind: 'polygon_grid',
    grid: { rows: 2, cols: 2 }, // 4 cells, 4 photos. Netherlands is roughly square.
    local_images: [
      { title: 'Amsterdam — stepped-gable house',   path: 'media/europe-2010/netherlands-amsterdam-gable-house.jpg' },
      { title: 'Amsterdam — canal with tour boats', path: 'media/europe-2010/netherlands-amsterdam-canal-boats.jpg' },
      { title: 'Amsterdam — red Canta microcar',    path: 'media/europe-2010/netherlands-amsterdam-canta-car.jpg' },
      { title: 'Amsterdam — canal houseboat garden', path: 'media/europe-2010/netherlands-amsterdam-canal-houseboat.jpg' },
    ],
  },
  {
    country: 'Norway', country_slug: 'norway', render_kind: 'polygon_grid',
    grid: { rows: 3, cols: 2 }, // 6 cells, 5 albums + 1 cycled. Fjord
    // coastline gives Norway a 15% bbox-fill ratio — single photo
    // wastes most of its texture on ocean.
    albums: [
      { title: 'Tromsø', url: `${ALBUM_HOST}/tromso` },
      { title: 'Polar Park', url: `${ALBUM_HOST}/polar-park` },
      { title: 'Bergen', url: `${ALBUM_HOST}/bergen` },
      { title: 'Aurlandsfjord - Flåm', url: `${ALBUM_HOST}/aurlandsfjord-flam` },
      { title: 'Oslo', url: `${ALBUM_HOST}/oslo` },
    ],
  },
  {
    country: 'Panama', country_slug: 'panama', render_kind: 'polygon_grid',
    grid: { rows: 2, cols: 3 }, // 6 cells, 5 photos + 1 cycled. Panama
    // is elongated E-W, so the wider grid mirrors the country shape.
    local_images: [
      { title: 'Panama City — skyline + F&F Tower',         path: 'media/panama-2025/panama-city-skyline.jpg' },
      { title: 'Panama Canal — Baltic Spirit in the locks', path: 'media/panama-2025/panama-canal-baltic-spirit.jpg' },
      { title: 'Three-toed sloth in the rainforest',         path: 'media/panama-2025/panama-three-toed-sloth.jpg' },
      { title: 'Biomuseo — Frank Gehry roof',                path: 'media/panama-2025/panama-biomuseo.jpg' },
      { title: 'Panama Canal — tanker with tugboat',         path: 'media/panama-2025/panama-canal-tanker.jpg' },
    ],
  },
  {
    country: 'Paraguay', country_slug: 'paraguay', render_kind: 'polygon_grid',
    grid: { rows: 2, cols: 2 }, // 4 cells, 3 photos + 1 cycled. Paraguay
    // bbox is essentially square (aspect 0.94), so a 2×2 fits its shape.
    local_images: [
      { title: 'River canoe through wetlands',  path: 'media/paraguay-2025/paraguay-river-canoe.jpg' },
      { title: 'Red-and-green macaw',           path: 'media/paraguay-2025/paraguay-scarlet-macaw.jpg' },
      { title: 'Wetland cumulus reflection',    path: 'media/paraguay-2025/paraguay-wetland-cloud.jpg' },
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
    primary_album: { title: 'Porto', url: `${ALBUM_HOST}/porto` },
    secondary_albums: [
      { title: 'Lisbon', url: `${ALBUM_HOST}/lisbon-1` },
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
    country: 'Switzerland', country_slug: 'switzerland', render_kind: 'polygon_grid',
    grid: { rows: 2, cols: 2 }, // 4 cells, 4 photos. From Alps 2025 trip.
    local_images: [
      { title: 'Lucerne — Hofkirche St. Leodegar',         path: 'media/alps-2025/switzerland-lucerne-hofkirche.jpg' },
      { title: 'Zurich — old town alley',                  path: 'media/alps-2025/switzerland-zurich-old-town.jpg' },
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
    country: 'Turkey', country_slug: 'turkey', render_kind: 'polygon_grid',
    grid: { rows: 1, cols: 2 }, // 2 cells, 2 photos. Turkey bbox is wide
    // (1600km × 600km, ~2.7:1) so a horizontal pair matches the shape.
    local_images: [
      { title: 'Cappadocia — fairy chimneys',          path: 'media/turkey-2010/turkey-cappadocia-fairy-chimneys.jpg' },
      { title: 'Cappadocia — hot-air balloon at dawn', path: 'media/turkey-2010/turkey-cappadocia-balloon.jpg' },
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
    country: 'United States of America', country_slug: 'united-states-of-america', render_kind: 'polygon_grid',
    grid: { rows: 5, cols: 5 }, // 25 cells, 21 photos + 4 empty
    albums: [
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
      { title: 'Minneapolis', url: `${ALBUM_HOST}/minneapolis-1` },
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
}

// Composite N images into a rows×cols grid texture. Each cell gets
// center-crop fit (sharp.resize with fit:cover) so the cells line up
// flush regardless of source aspect.
//
// `srcPaths` fills cells in row-major order, cycling if shorter than
// rows*cols. `cellOverrides` (optional) replaces specific cell indices
// with a different local file — used to pin a hand-picked hero photo
// at a known position (e.g. center of a 3×3 grid).
async function buildGridTexture(
  srcPaths: string[],
  rows: number, cols: number,
  destPath: string,
  cellOverrides?: Record<number, string>,
): Promise<void> {
  const cellSize = Math.floor(MAX_LONG_EDGE / Math.max(rows, cols));
  const canvasW = cellSize * cols;
  const canvasH = cellSize * rows;
  const totalCells = rows * cols;

  // Pre-resize each cell to a Buffer (one per unique photo, then we cycle
  // them across all cells below).
  const cellBuffers = await Promise.all(
    srcPaths.map((p) =>
      sharp(p)
        .resize({ width: cellSize, height: cellSize, fit: 'cover', position: 'attention' })
        .toBuffer(),
    ),
  );

  // Pre-resize override buffers, indexed by cell position.
  const overrideBuffers: Record<number, Buffer> = {};
  if (cellOverrides) {
    for (const [idxStr, path] of Object.entries(cellOverrides)) {
      const idx = parseInt(idxStr, 10);
      overrideBuffers[idx] = await sharp(path)
        .resize({ width: cellSize, height: cellSize, fit: 'cover', position: 'attention' })
        .toBuffer();
    }
  }

  // Cycle through photos to fill every cell. Without this, leftover cells
  // stay the empty splash-canvas background — and because polygon-grid
  // textures are bbox-mapped onto the country polygon, those empty cells
  // are sampled by real geography. For the USA the empty trio in the
  // bottom-right of the grid landed exactly on Florida.
  if (cellBuffers.length === 0) {
    throw new Error(`no photos to composite into ${rows}x${cols} grid`);
  }
  const composite = Array.from({ length: totalCells }, (_, i) => ({
    input: overrideBuffers[i] ?? cellBuffers[i % cellBuffers.length]!,
    top: Math.floor(i / cols) * cellSize,
    left: (i % cols) * cellSize,
  }));

  await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 3,
      background: { r: 28, g: 31, b: 26 }, // matches splash-canvas
    },
  })
    .composite(composite)
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(destPath);
}

async function buildIndexCoverMap(): Promise<Map<string, string>> {
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
  // the cover map. Fail loud at startup rather than mid-run. Local-file
  // entries (no portfolio URL) skip this check; their files are verified
  // at processing time below.
  const missing: string[] = [];
  for (const entry of MANIFEST) {
    let refs: AlbumRef[];
    if (entry.render_kind === 'polygon_grid' || entry.render_kind === 'flat') {
      refs = entry.albums ?? [];
    } else if (entry.local_image) {
      refs = []; // local-file polygon/bubble — nothing to validate against the portfolio
    } else {
      refs = [
        ...(entry.primary_album ? [entry.primary_album] : []),
        ...(entry.secondary_albums ?? []),
      ];
    }
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

    if (entry.render_kind === 'polygon' || entry.render_kind === 'bubble') {
      if (entry.local_image) {
        const localPath = join(ROOT, entry.local_image.path);
        if (!existsSync(localPath)) {
          console.error(`local image missing for ${entry.country}: ${localPath}`);
          process.exit(1);
        }
        await resizeToTexture(localPath, dest);
        atlas.push({
          country: entry.country,
          country_slug: entry.country_slug,
          render_kind: entry.render_kind,
          ...(entry.render_kind === 'bubble' ? { lat: entry.lat, lng: entry.lng } : {}),
          image: `media/portfolio/${entry.country_slug}.jpg`,
          local_image: entry.local_image,
          ...(entry.notes ? { notes: entry.notes } : {}),
        });
      } else if (entry.primary_album) {
        const { path, sourceUrl } = await resolveAlbumCover(entry.primary_album, coverByUrl);
        await resizeToTexture(path, dest);
        atlas.push({
          country: entry.country,
          country_slug: entry.country_slug,
          render_kind: entry.render_kind,
          ...(entry.render_kind === 'bubble' ? { lat: entry.lat, lng: entry.lng } : {}),
          image: `media/portfolio/${entry.country_slug}.jpg`,
          primary_album: {
            ...entry.primary_album,
            source_image_url: sourceUrl,
          },
          secondary_albums: entry.secondary_albums ?? [],
          ...(entry.notes ? { notes: entry.notes } : {}),
        });
      } else {
        console.error(`${entry.country}: needs primary_album or local_image`);
        process.exit(1);
      }
    } else {
      // polygon_grid OR flat — both use a composite grid texture.
      // Sources are either portfolio albums or local files. Mixed
      // sources aren't supported (publish locals to the portfolio
      // first if you need them in the same grid).
      // Resolve cell_overrides (if any) into absolute paths and verify
      // they exist on disk. Same for both branches below.
      let overrideMap: Record<number, string> | undefined;
      if (entry.cell_overrides) {
        overrideMap = {};
        for (const [idx, ref] of Object.entries(entry.cell_overrides)) {
          const p = join(ROOT, ref.path);
          if (!existsSync(p)) {
            console.error(`cell_override image missing for ${entry.country} cell ${idx}: ${p}`);
            process.exit(1);
          }
          overrideMap[parseInt(idx, 10)] = p;
        }
      }

      if (entry.local_images && entry.local_images.length > 0) {
        const localPaths = entry.local_images.map((img) => join(ROOT, img.path));
        for (const p of localPaths) {
          if (!existsSync(p)) {
            console.error(`local image missing for ${entry.country}: ${p}`);
            process.exit(1);
          }
        }
        await buildGridTexture(localPaths, entry.grid.rows, entry.grid.cols, dest, overrideMap);
        atlas.push({
          country: entry.country,
          country_slug: entry.country_slug,
          render_kind: entry.render_kind,
          ...(entry.render_kind === 'flat' ? { lat: entry.lat, lng: entry.lng } : {}),
          grid: entry.grid,
          image: `media/portfolio/${entry.country_slug}.jpg`,
          local_images: entry.local_images,
          ...(entry.cell_overrides ? { cell_overrides: entry.cell_overrides } : {}),
          ...(entry.notes ? { notes: entry.notes } : {}),
        });
      } else {
        const albums = entry.albums ?? [];
        const resolved: Array<{ album: AlbumRef; path: string; sourceUrl: string }> = [];
        for (const album of albums) {
          const r = await resolveAlbumCover(album, coverByUrl);
          resolved.push({ album, ...r });
        }
        await buildGridTexture(resolved.map((r) => r.path), entry.grid.rows, entry.grid.cols, dest, overrideMap);
        atlas.push({
          country: entry.country,
          country_slug: entry.country_slug,
          render_kind: entry.render_kind,
          ...(entry.render_kind === 'flat' ? { lat: entry.lat, lng: entry.lng } : {}),
          grid: entry.grid,
          image: `media/portfolio/${entry.country_slug}.jpg`,
          albums: resolved.map((r) => ({ ...r.album, source_image_url: r.sourceUrl })),
          ...(entry.cell_overrides ? { cell_overrides: entry.cell_overrides } : {}),
          ...(entry.notes ? { notes: entry.notes } : {}),
        });
      }
    }
  }

  await writeFile(ATLAS_PATH, JSON.stringify(atlas, null, 2) + '\n');
  console.log(`\nwrote ${ATLAS_PATH} (${atlas.length} entries)`);
}

void slug; // exported helper kept for future curated-rename passes
main().catch((err) => { console.error(err); process.exit(1); });
