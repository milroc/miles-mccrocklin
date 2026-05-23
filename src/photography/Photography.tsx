// Photography — root composer for /photographer. Owns the chip filter
// state and the filter algebra:
//
//   (category1 OR category2 ...)       — Wildlife / Landscapes / People tree
//   AND
//   (species1 OR species2 ...)
//   AND
//   (country1 OR country2 ...)
//   AND
//   (every search token matches somewhere in the photo's text fields)
//
// State syncs to URL search params via replaceState (design D4: back
// button exits page in one press, no filter cycling). Deep links work
// because state initializes from URL on mount.
//
// The category hierarchy (Wildlife / Landscapes / People + sub-leaves)
// is defined in ./categories.ts and rendered by CategoryDropdown. Each
// node is its own independent tag — the classifier emits the entire
// ancestor chain (a primate gets ["wildlife","mammals","primates"]),
// so picking "Wildlife" matches the same photo as picking "Primates",
// just at different specificity. No expand-to-descendants logic at
// filter time — the OR over the selected tag set does the right thing.
//
// The MediaProvider wraps the content so the existing FigureCarousel
// lightbox chrome handles photo display + Adobe Portfolio CTA.

import { useEffect, useMemo, useState } from 'react';
import { MediaProvider } from '../media/MediaProvider';
import { SiteNav } from '../layout/SiteNav';
import { ChipRow } from './ChipRow';
import { EditorialTopFold } from './EditorialTopFold';
import { MasonryWall } from './MasonryWall';
import { allCategoryIds, buildCategoryDescendants } from './categories';
import type { PhotographyManifest, PhotographyEntry } from '../types';
import s from './Photography.module.css';

const PORTFOLIO_URL = 'https://milesmccrocklin.myportfolio.com/';

interface PhotographyProps {
  manifest: PhotographyManifest;
}

interface FilterState {
  categories: Set<string>;
  species: Set<string>;
  countries: Set<string>;
  query: string;
}

// Read filter selection from URL search params. CSV-encoded for
// readable URLs:
//   ?categories=wildlife,mammals&locations=antarctica
//   &species=king+penguin&q=ice+at+dawn
function initFromUrl(): FilterState {
  if (typeof window === 'undefined') {
    return {
      categories: new Set(),
      species: new Set(),
      countries: new Set(),
      query: '',
    };
  }
  const url = new URL(window.location.href);
  const csv = (v: string | null): Set<string> =>
    new Set((v ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  return {
    categories: csv(url.searchParams.get('categories')),
    species: csv(url.searchParams.get('species')),
    countries: csv(url.searchParams.get('locations')),
    query: url.searchParams.get('q') ?? '',
  };
}

// Apply current state to URL search params. Empty selections drop the
// param entirely so the URL stays clean.
function syncUrl(state: FilterState): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const setOrDelete = (key: string, value: string): void => {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  };
  setOrDelete('categories', [...state.categories].join(','));
  setOrDelete('species', [...state.species].join(','));
  setOrDelete('locations', [...state.countries].join(','));
  setOrDelete('q', state.query.trim());
  // Remove the legacy ?treatments= param if present in a bookmarked
  // URL — the filter has been retired but old links may still carry it.
  url.searchParams.delete('treatments');
  // replaceState (not pushState) per design D4: back button exits page
  // in one press, doesn't cycle through filter states.
  window.history.replaceState({}, '', url.toString());
}

// Build the haystack string for a photo once per filter pass. Joins
// every searchable text field with newlines (delimiter that can't
// appear inside any single field) so token match isn't sensitive to
// where in the structured data the match lands.
function buildHaystack(p: PhotographyEntry, countryName?: string): string {
  const parts: string[] = [];
  if (p.caption) parts.push(p.caption);
  if (p.alt) parts.push(p.alt);
  if (p.story) parts.push(p.story);
  if (p.species) parts.push(p.species);
  if (p.country) parts.push(p.country);
  if (countryName) parts.push(countryName);
  if (p.theme && p.theme.length) parts.push(p.theme.join(' '));
  if (p.entities && p.entities.length) parts.push(p.entities.join(' '));
  return parts.join('\n').toLowerCase();
}

// Featured photos always render before non-featured. Within the
// featured set, lower sort_order wins (top of array = best). Within
// the non-featured set, photos are sorted by shoot date descending
// (most recent first); shoot date comes from the YYYYMMDD prefix
// baked into photo-* ids (e.g. photo-20241128-dsc06513). Entries
// without an extractable date (me-*, atlas-*) fall to the end of the
// non-featured tier in stable order.
const DATE_RE = /(\d{8})/;
function shootDateKey(p: PhotographyEntry): number {
  const m = p.id.match(DATE_RE) ?? p.src.match(DATE_RE);
  return m ? Number(m[1]) : 0;
}
function rankFeatured(a: PhotographyEntry, b: PhotographyEntry): number {
  const af = a.featured ? 1 : 0;
  const bf = b.featured ? 1 : 0;
  if (af !== bf) return bf - af;
  if (af) {
    const ao = a.sort_order ?? Infinity;
    const bo = b.sort_order ?? Infinity;
    return ao - bo;
  }
  return shootDateKey(b) - shootDateKey(a);
}

// Top-level → descendant ids map, built once. Selecting "wildlife"
// matches any photo tagged with wildlife, mammals, birds, … even
// when the classifier missed the parent tag.
const CATEGORY_DESCENDANTS = buildCategoryDescendants();
function expandCategories(selected: Set<string>): Set<string> {
  if (selected.size === 0) return selected;
  const out = new Set<string>();
  for (const id of selected) {
    const desc = CATEGORY_DESCENDANTS.get(id);
    if (desc) for (const d of desc) out.add(d);
    else out.add(id);
  }
  return out;
}

function applyFilters(
  photos: PhotographyEntry[],
  state: FilterState,
  countryNames: Map<string, string>,
): PhotographyEntry[] {
  const tokens = state.query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const noOp =
    state.categories.size === 0 &&
    state.species.size === 0 &&
    state.countries.size === 0 &&
    tokens.length === 0;
  if (noOp) return [...photos].sort(rankFeatured);
  const expandedCategories = expandCategories(state.categories);
  return photos.filter((p) => {
    const themes = p.theme ?? [];
    const categoryOk =
      expandedCategories.size === 0 ||
      themes.some((t) => expandedCategories.has(t));
    const speciesOk =
      state.species.size === 0 ||
      (p.species != null && state.species.has(p.species));
    const countryOk =
      state.countries.size === 0 ||
      (p.country != null && state.countries.has(p.country));
    let queryOk = true;
    if (tokens.length > 0) {
      const hay = buildHaystack(p, p.country ? countryNames.get(p.country) : undefined);
      queryOk = tokens.every((t) => hay.includes(t));
    }
    return categoryOk && speciesOk && countryOk && queryOk;
  }).sort(rankFeatured);
}

export function Photography({ manifest }: PhotographyProps): JSX.Element {
  const initial = useMemo(() => initFromUrl(), []);
  const [categories, setCategories] = useState<Set<string>>(initial.categories);
  const [species, setSpecies] = useState<Set<string>>(initial.species);
  const [countries, setCountries] = useState<Set<string>>(initial.countries);
  const [query, setQuery] = useState<string>(initial.query);
  // Hero-category hover preview, shared across the page so the
  // EditorialTopFold (where the user hovers) and the MasonryWall
  // (which dims non-matching tiles) read the same value. Empty string
  // = no preview active.
  const [previewTheme, setPreviewTheme] = useState<string>('');

  const validCategoryIds = useMemo(() => allCategoryIds(), []);
  const countryNames = useMemo(
    () => new Map(manifest.countries.map((c) => [c.slug, c.name])),
    [manifest.countries],
  );

  // Photo counts per theme tag / species / country slug across the
  // entire manifest. Powers the count badges shown next to each
  // filter row. Total counts (unfiltered) so the badge stays stable as
  // the user narrows the selection.
  //
  // byTheme uses an ANCESTOR ROLLUP: a tag's count includes every photo
  // matching the tag itself OR any descendant tag. So "Wildlife" counts
  // all photos that match wildlife + birds + mammals + … as a deduped
  // union, mirroring what selecting "Wildlife" in the filter would
  // surface (see expandCategories above). Each photo is counted once
  // per ancestor — never double-counted within a single node's tally.
  // Tags outside the category tree (treatment tags like 'monochrome')
  // still get their literal per-tag count.
  const photoCounts = useMemo(() => {
    // tag → set of ancestor tags. Includes self. Built once from
    // CATEGORY_DESCENDANTS by inverting the (node → descendants) map.
    const tagToAncestors = new Map<string, Set<string>>();
    for (const [parentId, descendants] of CATEGORY_DESCENDANTS) {
      for (const childId of descendants) {
        let s = tagToAncestors.get(childId);
        if (!s) { s = new Set(); tagToAncestors.set(childId, s); }
        s.add(parentId);
      }
    }
    const byTheme = new Map<string, number>();
    const bySpecies = new Map<string, number>();
    const byCountry = new Map<string, number>();
    for (const p of manifest.photos) {
      // Per-photo set of buckets to bump — dedupes so a photo tagged
      // ['wildlife', 'birds'] only contributes 1 to the "Wildlife"
      // count, not 2.
      const buckets = new Set<string>();
      for (const t of (p.theme ?? [])) {
        const ancestors = tagToAncestors.get(t);
        if (ancestors) for (const a of ancestors) buckets.add(a);
        else buckets.add(t); // treatment / non-hierarchy tag — literal count
      }
      for (const b of buckets) byTheme.set(b, (byTheme.get(b) ?? 0) + 1);
      if (p.species) {
        bySpecies.set(p.species, (bySpecies.get(p.species) ?? 0) + 1);
      }
      if (p.country) {
        byCountry.set(p.country, (byCountry.get(p.country) ?? 0) + 1);
      }
    }
    return { byTheme, bySpecies, byCountry };
  }, [manifest.photos]);

  // Drop URL chips that aren't selectable. Categories drop anything not
  // in the hierarchy. Species + countries drop anything not in the
  // manifest.
  useEffect(() => {
    const validSpecies = new Set(manifest.species);
    const validCountries = new Set(manifest.countries.map((c) => c.slug));
    const filterSet = (
      set: Set<string>,
      valid: Set<string>,
    ): { next: Set<string>; changed: boolean } => {
      const next = new Set<string>();
      let changed = false;
      for (const v of set) {
        if (valid.has(v)) next.add(v);
        else changed = true;
      }
      return { next, changed };
    };
    const c = filterSet(categories, validCategoryIds);
    const sp = filterSet(species, validSpecies);
    const co = filterSet(countries, validCountries);
    if (c.changed) setCategories(c.next);
    if (sp.changed) setSpecies(sp.next);
    if (co.changed) setCountries(co.next);
    // Only run on mount — once cleaned, the toggle handlers maintain
    // validity by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync URL whenever state changes.
  useEffect(() => {
    syncUrl({ categories, species, countries, query });
  }, [categories, species, countries, query]);

  const filtered = useMemo(
    () =>
      applyFilters(
        manifest.photos,
        { categories, species, countries, query },
        countryNames,
      ),
    [manifest.photos, categories, species, countries, query, countryNames],
  );

  const toggleCategory = (id: string): void => {
    setCategories((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSpecies = (sp: string): void => {
    setSpecies((cur) => {
      const next = new Set(cur);
      if (next.has(sp)) next.delete(sp);
      else next.add(sp);
      return next;
    });
  };
  const toggleCountry = (country: string): void => {
    setCountries((cur) => {
      const next = new Set(cur);
      if (next.has(country)) next.delete(country);
      else next.add(country);
      return next;
    });
  };
  const clear = (): void => {
    setCategories(new Set());
    setSpecies(new Set());
    setCountries(new Set());
    setQuery('');
  };
  // Hero category buttons in the EditorialTopFold behave like radio
  // buttons rather than toggles: tapping one replaces whatever
  // categories are currently selected with just that id. Tapping the
  // already-selected sole category turns it off (familiar "toggle on
  // second tap" pattern). Other filter axes (species/location/search)
  // are left alone — only the categories axis is replaced.
  const applyHeroCategory = (id: string): void => {
    setCategories((cur) => {
      if (cur.size === 1 && cur.has(id)) return new Set();
      return new Set([id]);
    });
  };

  return (
    <MediaProvider>
      <div className={s.app}>
        <SiteNav current="photographer" />

        <main className={s.main}>
          <EditorialTopFold
            manifest={manifest}
            selectedCategories={categories}
            onApplyCategory={applyHeroCategory}
            previewTheme={previewTheme}
            onPreviewTheme={setPreviewTheme}
          />

          <ChipRow
            speciesByClass={manifest.speciesByClass}
            locations={manifest.countries}
            photoCounts={photoCounts}
            selectedCategories={categories}
            selectedSpecies={species}
            selectedLocations={countries}
            query={query}
            onToggleCategory={toggleCategory}
            onToggleSpecies={toggleSpecies}
            onToggleLocation={toggleCountry}
            onSetLocations={setCountries}
            onSetQuery={setQuery}
            onClear={clear}
          />

          <MasonryWall photos={filtered} previewTheme={previewTheme} />
        </main>

        <footer className={s.footer}>
          <a
            className={s.footerCta}
            href={PORTFOLIO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            View the full catalog on Adobe Portfolio →
          </a>
        </footer>
      </div>
    </MediaProvider>
  );
}
