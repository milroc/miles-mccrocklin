// Owner-coupled constants — code-shaped data that doesn't fit in
// resume.json (regexes, derived URL labels, typographic syllables, fallback
// URLs) but would change for any other person using this site. Update
// here whenever resume.json's identity-bearing fields change.

// Toolbar wordmark — name · /human handle · year register.
export const WORDMARK = 'Miles McCrocklin · /human · v2026';

// Two syllables of "milroc" pulled out and underline-linked across the
// name and the social handles on hover. The Twitter handle is the same
// shape with a leetspeak vowel ("Mil" + "r0c").
export const SYL = {
  mil: 'mil',
  roc: 'roc',
  twitter: { mil: 'Mil', roc: 'r0c' },
} as const;

// "McCrocklin" / "MacIntyre" / etc — recognize Mc/Mac prefixes so the
// suffix renders as M{small-cap c}rocklin instead of an all-caps "MC".
export const SMALLCAP_PREFIX_RE = /^(M)(c|ac)([A-Z].*)$/;

// 1-pager / printed PDF spells out full handle URLs (icons don't print
// well; "milroc" alone has no context off-site). Update when usernames
// change.
export const PRINT_URL_LABELS = {
  github: 'github.com/milroc',
  linkedin: 'linkedin.com/in/miles-mccrocklin',
} as const;

// Tooltip + aria-label copy reused across the social handle row.
export const HANDLE_TITLE = 'mil + roc — drawn from Miles McCrocklin';
export const HANDLE_TWITTER_TITLE = 'Mil + r0c — drawn from Miles McCrocklin';
export const LINKEDIN_ARIA = 'LinkedIn — miles-mccrocklin';
export const LINKEDIN_HANDLE_TEXT = 'miles-mccrocklin';

export const REDACTION_DESCRIPTION = 'Greek letters above mark figures and names intentionally withheld out of respect for the people who built the work with me. Each is described below; reach out to learn more about my role on these efforts'

// Community group names that should render in the mono "code" register.
// Used to build a regex at the call site.
export const CODE_GROUPS = ['d3.unconf()', 'd3.js'] as const;

// Airbnb listing fallback (used only if reviews data lacks listing_url).
export const AIRBNB_LISTING_FALLBACK = 'https://www.airbnb.com/rooms/1575184';

// Lightning marquees — bio fragments that streak across the canvas mat.
// Five lists fire on staggered cadences; each list is one rhythmic theme.
export const LIGHTNING_MARQUEES: readonly (readonly string[])[] = [
  // Names
  ['Miles Kendrick McCrocklin', 'milroc', 'Miles', 'Kilometers', 'MKM'],
  // Roles
  ['human', 'engineer', 'traveler', 'manager', 'builder', 'photographer', 'investor',
   'artist', 'vagabond', 'airbnb superhost', 'husband', 'friend'],
  // Teams
  ['Facebook', 'Meta', 'Facebook Creators', 'Facebook Integrity', 'Newsfeed', 'New Product Experiences'],
  // Products
  ['Fact-checking', 'Forecast', 'Prediction Markets', 'Fighting Misinformation',
   'Professional Mode', 'NLP @ FB scale', 'data products'],
  // Tools
  ['React', 'GraphQL', 'claude-code', 'Typescript', 'Python', 'Sony A7CR',
   'Sony 100-400mm G Master', 'Laowa 10mm ZD'],
];
