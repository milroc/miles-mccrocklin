// Visited-country canonicalization, shared between the runtime globe
// (src/splash/Globe.tsx membership tests) and the build-time stat
// derivation (scripts/build-splash-stats.ts). journey.json waypoint
// labels use travel-diary names; atlas / Natural Earth polygons use
// canonical names. Folding here keeps "how many countries" and "which
// polygons paint green" answering from the same rule.

export const VISITED_NAME_ALIASES: Readonly<Record<string, string>> = {
  Bahamas: 'The Bahamas',
  England: 'United Kingdom',
  Scotland: 'United Kingdom',
  Wales: 'United Kingdom',
  'Northern Ireland': 'United Kingdom',
};

export function canonicalVisitedNames(labels: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const label of labels) out.add(VISITED_NAME_ALIASES[label] ?? label);
  return out;
}
