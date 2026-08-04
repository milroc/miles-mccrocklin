// Shared canonical location data.
//
// The storage format for the `country` field is an ISO-3166-1 alpha-3
// code (USA, DEU, GBR, ATA, etc.). This file is the single source of
// truth for:
//
//   - which codes are recognized (any code NOT in this table gets
//     dropped at merge time so the build can't choke on it)
//   - the display name shown to the user (Photography filter chip,
//     review-photos dropdown, etc.) — the UI never displays the code
//   - the continent grouping (Photography filter groups by continent)
//   - aliases (kebab-case legacy slugs, US-state names like
//     "kentucky", common shortenings like "uk"/"usa") so input from
//     prior data files and from the LLM normalizes back to the
//     canonical code
//
// Antarctica gets its real ISO code (ATA) so it sits next to countries
// in the data layer even though it's a continent.

export interface LocationRow {
  /** ISO-3166-1 alpha-3 code. Lowercase here, callers uppercase as needed. */
  code: string;
  /** Display name shown to users. */
  name: string;
  /** Continent used by the Photography filter UI for grouping. */
  continent: string;
  /**
   * Lowercased kebab/space-stripped aliases that should normalize to
   * this code. The canonical code itself + name are accepted
   * implicitly. Include legacy slugs from the pre-migration data, the
   * alpha-2 code, common shortenings, and any sub-national values the
   * data accidentally collected (US states the prior model classed as
   * "country").
   */
  aliases: string[];
}

export const LOCATIONS: LocationRow[] = [
  // ─── Africa ──────────────────────────────────────────────────────
  { code: 'egy', name: 'Egypt',         continent: 'Africa',  aliases: ['eg'] },
  { code: 'ken', name: 'Kenya',         continent: 'Africa',  aliases: ['ke'] },
  { code: 'mdg', name: 'Madagascar',    continent: 'Africa',  aliases: ['mg'] },
  { code: 'mar', name: 'Morocco',       continent: 'Africa',  aliases: ['ma'] },
  { code: 'rwa', name: 'Rwanda',        continent: 'Africa',  aliases: ['rw'] },
  { code: 'zaf', name: 'South Africa',  continent: 'Africa',  aliases: ['south-africa', 'za'] },
  { code: 'uga', name: 'Uganda',        continent: 'Africa',  aliases: ['ug'] },

  // ─── Antarctica ──────────────────────────────────────────────────
  { code: 'ata', name: 'Antarctica',    continent: 'Antarctica', aliases: ['aq'] },

  // ─── Asia ────────────────────────────────────────────────────────
  { code: 'arm', name: 'Armenia',       continent: 'Asia',    aliases: ['am'] },
  { code: 'ind', name: 'India',         continent: 'Asia',    aliases: ['in'] },
  { code: 'jpn', name: 'Japan',         continent: 'Asia',    aliases: ['jp'] },
  { code: 'mys', name: 'Malaysia',      continent: 'Asia',    aliases: ['my'] },
  { code: 'sgp', name: 'Singapore',     continent: 'Asia',    aliases: ['sg'] },
  { code: 'tha', name: 'Thailand',      continent: 'Asia',    aliases: ['th'] },
  { code: 'tur', name: 'Türkiye',       continent: 'Asia',    aliases: ['turkey', 'tr'] },
  { code: 'are', name: 'United Arab Emirates', continent: 'Asia', aliases: ['uae', 'united-arab-emirates', 'ae'] },

  // ─── Europe ──────────────────────────────────────────────────────
  { code: 'aut', name: 'Austria',       continent: 'Europe',  aliases: ['at'] },
  { code: 'bel', name: 'Belgium',       continent: 'Europe',  aliases: ['be'] },
  { code: 'hrv', name: 'Croatia',       continent: 'Europe',  aliases: ['croatia', 'hr'] },
  { code: 'cze', name: 'Czechia',       continent: 'Europe',  aliases: ['czechia', 'czech-republic', 'cz'] },
  { code: 'dnk', name: 'Denmark',       continent: 'Europe',  aliases: ['denmark', 'dk'] },
  { code: 'fra', name: 'France',        continent: 'Europe',  aliases: ['fr'] },
  { code: 'deu', name: 'Germany',       continent: 'Europe',  aliases: ['germany', 'de'] },
  { code: 'gib', name: 'Gibraltar',     continent: 'Europe',  aliases: ['gi'] },
  { code: 'grc', name: 'Greece',        continent: 'Europe',  aliases: ['gr'] },
  { code: 'irl', name: 'Ireland',       continent: 'Europe',  aliases: ['ie'] },
  { code: 'ita', name: 'Italy',         continent: 'Europe',  aliases: ['it'] },
  { code: 'lie', name: 'Liechtenstein', continent: 'Europe',  aliases: ['li'] },
  { code: 'nld', name: 'Netherlands',   continent: 'Europe',  aliases: ['nl'] },
  { code: 'nor', name: 'Norway',        continent: 'Europe',  aliases: ['no'] },
  { code: 'prt', name: 'Portugal',      continent: 'Europe',  aliases: ['pt'] },
  { code: 'smr', name: 'San Marino',    continent: 'Europe',  aliases: ['san-marino', 'sm'] },
  { code: 'esp', name: 'Spain',         continent: 'Europe',  aliases: ['es'] },
  { code: 'swe', name: 'Sweden',        continent: 'Europe',  aliases: ['se'] },
  { code: 'che', name: 'Switzerland',   continent: 'Europe',  aliases: ['ch'] },
  { code: 'gbr', name: 'United Kingdom', continent: 'Europe', aliases: ['united-kingdom', 'uk', 'great-britain', 'england', 'gb'] },
  { code: 'vat', name: 'Vatican City',  continent: 'Europe',  aliases: ['vatican', 'va'] },

  // ─── North America ──────────────────────────────────────────────
  { code: 'blz', name: 'Belize',        continent: 'North America', aliases: ['bz'] },
  { code: 'can', name: 'Canada',        continent: 'North America', aliases: ['ca'] },
  { code: 'slv', name: 'El Salvador',   continent: 'North America', aliases: ['el-salvador', 'sv'] },
  { code: 'gtm', name: 'Guatemala',     continent: 'North America', aliases: ['gt'] },
  { code: 'mex', name: 'Mexico',        continent: 'North America', aliases: ['mx'] },
  { code: 'pan', name: 'Panama',        continent: 'North America', aliases: ['pa'] },
  {
    code: 'usa',
    name: 'United States',
    continent: 'North America',
    aliases: [
      'united-states', 'united-states-of-america', 'us', 'america',
      // The pre-migration data used a US state as a country slug for
      // a handful of photos; map it to the USA so the build doesn't
      // break. The state itself is lost — curator can re-record it
      // via the new `state` field in the review tool.
      'kentucky',
    ],
  },

  // ─── Oceania ─────────────────────────────────────────────────────
  { code: 'aus', name: 'Australia',     continent: 'Oceania', aliases: ['au'] },
  { code: 'nzl', name: 'New Zealand',   continent: 'Oceania', aliases: ['new-zealand', 'nz'] },

  // ─── South America ───────────────────────────────────────────────
  { code: 'arg', name: 'Argentina',     continent: 'South America', aliases: ['ar'] },
  { code: 'bol', name: 'Bolivia',       continent: 'South America', aliases: ['bo'] },
  { code: 'bra', name: 'Brazil',        continent: 'South America', aliases: ['br'] },
  { code: 'chl', name: 'Chile',         continent: 'South America', aliases: ['cl'] },
  { code: 'col', name: 'Colombia',      continent: 'South America', aliases: ['co'] },
  { code: 'ecu', name: 'Ecuador',       continent: 'South America', aliases: ['ec'] },
  { code: 'pry', name: 'Paraguay',      continent: 'South America', aliases: ['py'] },
  { code: 'per', name: 'Peru',          continent: 'South America', aliases: ['pe'] },
  { code: 'ury', name: 'Uruguay',       continent: 'South America', aliases: ['uy'] },
];

// Lowercased index of every accepted spelling → canonical code.
// Built once at module load.
const INDEX = new Map<string, string>();
const BY_CODE = new Map<string, LocationRow>();
for (const row of LOCATIONS) {
  const code = row.code.toLowerCase();
  BY_CODE.set(code, row);
  INDEX.set(code, code);
  INDEX.set(row.name.toLowerCase(), code);
  for (const alias of row.aliases) {
    INDEX.set(alias.toLowerCase(), code);
  }
}

/** Lowercased, hyphen-normalized form of an input string. */
function keyOf(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Resolve any country input (ISO code, legacy slug, display name, alias)
 * to a canonical lowercase ISO-3 code. Returns undefined when the input
 * doesn't match any known location.
 */
export function normalizeCountryCode(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const key = keyOf(input);
  if (!key) return undefined;
  return INDEX.get(key);
}

/** Display name for an ISO code, falling back to the code itself. */
export function countryNameForCode(code: string): string {
  return BY_CODE.get(code.toLowerCase())?.name ?? code;
}

/** Continent for an ISO code, falling back to 'Other'. */
export function continentForCode(code: string): string {
  return BY_CODE.get(code.toLowerCase())?.continent ?? 'Other';
}

/** Every recognized ISO code (lowercase). */
export const ALL_COUNTRY_CODES = new Set(LOCATIONS.map((r) => r.code.toLowerCase()));
