// Category hierarchy + treatment vocabulary for the photography page.
// Shared between:
//   - src/photography/CategoryDropdown.tsx (renders the tree)
//   - src/photography/Photography.tsx (initial filter validation)
//   - scripts/classify-photography.ts (constrains the classifier output)
//
// The hierarchy is purely a UI organization concern. Each node is its
// own filter tag — the classifier is instructed to emit the ENTIRE
// ancestor chain when it tags a photo (a primate gets
// ["wildlife", "mammals", "primates"]), so picking "Wildlife" in the
// dropdown matches the same photo as picking "Primates", just at a
// different specificity. No expand-to-descendants logic needed at
// filter time — the OR over the selected tag set does the right thing.

export interface CategoryNode {
  // Tag emitted by the classifier and stored in PhotographyEntry.theme[].
  id: string;
  // Human-readable label shown in the dropdown.
  label: string;
  children?: CategoryNode[];
}

export const CATEGORY_TREE: CategoryNode[] = [
  {
    id: 'wildlife',
    label: 'Wildlife',
    children: [
      { id: 'birds', label: 'Birds' },
      { id: 'mammals', label: 'Mammals' },
      { id: 'reptiles-amphibians', label: 'Reptiles & amphibians' },
      { id: 'marine-life', label: 'Marine life' },
      { id: 'insects', label: 'Insects' },
      { id: 'flora', label: 'Flora' },
    ],
  },
  {
    id: 'landscape',
    label: 'Landscapes',
    children: [
      // Condensed to 5 leaves with concrete photo-count warrant for
      // each. Forest/desert/underwater dropped because each had <5
      // photos — sparse buckets don't earn a dropdown slot, and
      // those photos still find each other via the `landscape`
      // parent tag + entity tokens ("forest", "dunes", "coral",
      // "rainforest"). `sky` merges the old `sky-weather` + the
      // never-promoted `astro` (both atmospheric subjects, both
      // small enough that splitting them was overkill). Snow/ice
      // scenes fall under `water` since the actual subject is
      // glaciers/icebergs/snowfields — consistent with how
      // Antarctica photos already classify.
      { id: 'water', label: 'Water' },
      { id: 'mountains', label: 'Mountains' },
      { id: 'sky', label: 'Sky' },
      { id: 'cityscape', label: 'Cityscape' },
      { id: 'aerial', label: 'Aerial' },
    ],
  },
  {
    id: 'culture',
    label: 'Culture',
    children: [
      // Net swaps from the previous taxonomy:
      //   - `portrait`   → folded into the broader `people` bucket
      //   - `documentary` → dropped (it's a STYLE, not a subject —
      //                     closer kin to the treatment tags we
      //                     retired)
      //   - `art`         → NEW (sculpture, museums, public art,
      //                     performance — subject, not "fine art" as
      //                     a style)
      { id: 'people', label: 'People' },
      { id: 'street', label: 'Street' },
      { id: 'architecture', label: 'Architecture' },
      { id: 'history', label: 'History' },
      { id: 'art', label: 'Art' },
      { id: 'religion', label: 'Religion' },
      { id: 'festival', label: 'Festival' },
    ],
  },
];

// Legacy → current tag rewrites. Applied in the merger as theme
// values flow from event JSONL into the merged output, so old
// classifier output keeps mapping to the right bucket without
// re-running classify on every photo. Tag mapped to `null` means
// "drop this tag entirely."
export const LEGACY_THEME_REWRITES = {
  // Culture taxonomy condensation:
  portrait: 'people',
  documentary: null,
  // Landscape taxonomy condensation (sub-cats <5 photos dropped;
  // sky-weather/astro merged into a single `sky`):
  'sky-weather': 'sky',
  astro: 'sky',
  'snow-ice': 'water',
  forest: null,
  desert: null,
  underwater: null,
} satisfies Record<string, string | null>;

// Species sub-groups within a wildlife class — collapses related
// species (multiple penguins, multiple primates) under a labelled
// folder in the dropdown. Each subgroup only renders when 2+ of its
// listed species are actually present in the manifest; with only one
// match the lone species shows directly under the class.
//
// To extend, add an entry with species names exactly as the classifier
// emits them. Case-insensitive matching is applied at render time so
// "Mountain Gorilla" and "gorilla" both land under primates.
export interface SubgroupDef {
  id: string;         // slug used for selection state + URL
  label: string;      // display name
  class: string;      // wildlife class this group nests under
  species: string[];  // species names that belong (case-insensitive)
}
export const SUBGROUPS: SubgroupDef[] = [
  // Birds
  {
    id: 'penguins',
    label: 'Penguins',
    class: 'birds',
    species: [
      'penguin',
      'adélie penguin',
      'emperor penguin',
      'gentoo penguin',
      'king penguin',
    ],
  },
  {
    id: 'wading-birds',
    label: 'Wading birds',
    class: 'birds',
    species: ['flamingo', 'shoebill', 'sandpiper'],
  },
  // Mammals
  {
    id: 'primates',
    label: 'Primates',
    class: 'mammals',
    species: [
      'chimpanzee',
      'gorilla',
      'mountain gorilla',
      'colobus monkey',
      'crowned sifaka',
      'lemur',
      'black-and-white ruffed lemur',
    ],
  },
  {
    id: 'big-cats',
    label: 'Big cats',
    class: 'mammals',
    species: ['lion', 'leopard'],
  },
  {
    id: 'ungulates',
    label: 'Ungulates',
    class: 'mammals',
    species: ['antelope', 'deer', 'giraffe', 'llama', 'hippopotamus'],
  },
  {
    id: 'marsupials',
    label: 'Marsupials',
    class: 'mammals',
    species: ['kangaroo', 'koala'],
  },
  {
    id: 'marine-mammals',
    label: 'Marine mammals',
    class: 'mammals',
    species: ['humpback whale', 'otters'],
  },
  {
    id: 'carnivores',
    label: 'Carnivores',
    class: 'mammals',
    species: ['black-backed jackal', 'fossa'],
  },
];

// Synthetic "Other" subgroup id used by the dropdown to bucket species
// that don't fit any named subgroup. Different per wildlife class (we
// build `other-mammals`, `other-birds`, etc. at render time) so the
// click handler can disambiguate.
export const OTHER_SUBGROUP_PREFIX = 'other-';

// species name (lowercase) → subgroup def. Lookup map used by both the
// dropdown render and the parent's filter logic.
export function buildSpeciesToSubgroup(): Map<string, SubgroupDef> {
  const m = new Map<string, SubgroupDef>();
  for (const g of SUBGROUPS) {
    for (const sp of g.species) m.set(sp.toLowerCase(), g);
  }
  return m;
}

// Orthogonal style/treatment tags. Live in a separate flat dropdown so
// they compose cleanly with category selections (AND across groups).
export const TREATMENT_TAGS = [
  'monochrome',
  'silhouette',
  'sunrise',
  'sunset',
  'night',
  'macro',
  'abstract',
  'minimalist',
  'reflection',
] as const;

// Pre-flattened ID set for membership tests (validating URL params).
export function allCategoryIds(): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: CategoryNode[]): void => {
    for (const n of nodes) {
      out.add(n.id);
      if (n.children) walk(n.children);
    }
  };
  walk(CATEGORY_TREE);
  return out;
}

// Map every node id → its descendant ids (the node itself plus the
// transitive closure of children). Used by the filter pass so picking
// a top-level node ("Wildlife") matches photos tagged with any sub-cat
// ("mammals", "birds", …) even when the classifier didn't emit the
// parent in the photo's theme list.
export function buildCategoryDescendants(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const collect = (node: CategoryNode): Set<string> => {
    const ids = new Set<string>([node.id]);
    if (node.children) {
      for (const ch of node.children) {
        for (const d of collect(ch)) ids.add(d);
      }
    }
    out.set(node.id, ids);
    return ids;
  };
  for (const n of CATEGORY_TREE) collect(n);
  return out;
}

// Walk every node with its depth (0 = top-level). Used by the
// dropdown's render — controls indentation + label weight.
export function walkCategoryTree(
  cb: (node: CategoryNode, depth: number) => void,
  nodes: CategoryNode[] = CATEGORY_TREE,
  depth = 0,
): void {
  for (const n of nodes) {
    cb(n, depth);
    if (n.children) walkCategoryTree(cb, n.children, depth + 1);
  }
}
