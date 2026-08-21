// Visited-country canonicalization, shared between the runtime globe
// (src/splash/Globe.tsx membership tests) and the build-time stat
// derivation (scripts/build-splash-stats.ts). journey.json waypoint
// labels use travel-diary names; atlas / Natural Earth polygons use
// canonical names. Folding here keeps "how many countries" and "which
// polygons paint green" answering from the same rule.

export const VISITED_NAME_ALIASES: ReadonlyMap<string, string> = new Map([
  ['Bahamas', 'The Bahamas'],
  ['England', 'United Kingdom'],
  ['Scotland', 'United Kingdom'],
  ['Wales', 'United Kingdom'],
  ['Northern Ireland', 'United Kingdom'],
]);

export function canonicalVisitedNames(labels: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const label of labels) out.add(VISITED_NAME_ALIASES.get(label) ?? label);
  return out;
}

// Visited places that paint on the globe but are NOT countries for the
// "N COUNTRIES" stat: Antarctica is a continent; Gibraltar is a British
// Overseas Territory (already covered by the United Kingdom entry).
// Sovereign microstates (Vatican, San Marino) DO count.
export const NON_COUNTRY_NAMES: ReadonlySet<string> = new Set([
  'Antarctica',
  'Gibraltar',
]);
