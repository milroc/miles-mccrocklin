// ChipRow — filter toolbar above the masonry wall. Search input plus
// two summary-trigger controls (Category tree (with species as leaves
// under wildlife sub-classes) and Location) plus a "Clear filters"
// link. Each dropdown summarizes its selection in its trigger label
// (1–2 items, then "…"), so the toolbar stays compact regardless of
// how much the user has stacked. Within-group is OR, across-group is
// AND (design D10). Search is its own AND constraint: every
// whitespace-separated token must match somewhere in the photo's text
// fields. See applyFilters in Photography.tsx for the algebra.
//
// State is owned upstream (Photography.tsx); this component renders
// the controls and emits change events.

import type { PhotographyManifest } from '../types';
import { CategoryDropdown } from './CategoryDropdown';
import { LocationDropdown } from './LocationDropdown';
import { SearchBox } from './SearchBox';
import s from './ChipRow.module.css';

interface ChipRowProps {
  speciesByClass: Record<string, string[]>;
  locations: PhotographyManifest['countries'];
  photoCounts: {
    byTheme: Map<string, number>;
    bySpecies: Map<string, number>;
    byCountry: Map<string, number>;
  };
  selectedCategories: Set<string>;
  selectedSpecies: Set<string>;
  selectedLocations: Set<string>;
  query: string;
  onToggleCategory: (id: string) => void;
  onToggleSpecies: (species: string) => void;
  onToggleLocation: (slug: string) => void;
  onSetLocations: (next: Set<string>) => void;
  onSetQuery: (next: string) => void;
  onClear: () => void;
}

export function ChipRow({
  speciesByClass,
  locations,
  photoCounts,
  selectedCategories,
  selectedSpecies,
  selectedLocations,
  query,
  onToggleCategory,
  onToggleSpecies,
  onToggleLocation,
  onSetLocations,
  onSetQuery,
  onClear,
}: ChipRowProps): JSX.Element {
  const hasSelection =
    selectedCategories.size > 0 ||
    selectedSpecies.size > 0 ||
    selectedLocations.size > 0 ||
    query.trim().length > 0;
  return (
    <div className={s.root} role="toolbar" aria-label="Photo filters">
      <SearchBox value={query} onChange={onSetQuery} />

      <CategoryDropdown
        speciesByClass={speciesByClass}
        themeCounts={photoCounts.byTheme}
        speciesCounts={photoCounts.bySpecies}
        selectedCategories={selectedCategories}
        selectedSpecies={selectedSpecies}
        onToggleCategory={onToggleCategory}
        onToggleSpecies={onToggleSpecies}
      />

      {locations.length > 0 && (
        <LocationDropdown
          locations={locations}
          countryCounts={photoCounts.byCountry}
          selected={selectedLocations}
          onToggle={onToggleLocation}
          onSetSelected={onSetLocations}
        />
      )}

      {hasSelection && (
        <button type="button" className={s.clear} onClick={onClear}>
          Clear filters
        </button>
      )}
    </div>
  );
}
