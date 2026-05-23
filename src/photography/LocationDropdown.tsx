// LocationDropdown — thin wrapper around TreeDropdown. Maps the
// continent → country shape into TreeRow form, matching the same
// hierarchical multi-select UX as the Category dropdown.
//
// Continent headers toggle every country in their group (atomic via
// onSetSelected). Country leaves toggle one at a time.

import { useMemo } from 'react';
import { TreeDropdown, type TreeRow, type CheckState } from './TreeDropdown';

interface LocationOption {
  slug: string;
  name: string;
  continent: string;
}

interface LocationDropdownProps {
  locations: LocationOption[];
  // Photo count per country slug. Used for the count badges. Total
  // across the manifest (not filtered) so the numbers stay stable as
  // the user narrows their selection.
  countryCounts: Map<string, number>;
  selected: Set<string>;
  onToggle: (slug: string) => void;
  // Atomic group toggle: replaces selection state with `next`. Used by
  // the continent header so a 20-country toggle is one state update.
  onSetSelected: (next: Set<string>) => void;
}

interface ContinentGroup {
  continent: string;
  options: LocationOption[];
}

function groupCheck(opts: LocationOption[], selected: Set<string>): CheckState {
  let any = false;
  let all = true;
  for (const o of opts) {
    if (selected.has(o.slug)) any = true;
    else all = false;
  }
  if (all && opts.length > 0) return 'on';
  if (any) return 'partial';
  return 'off';
}

export function LocationDropdown({
  locations,
  countryCounts,
  selected,
  onToggle,
  onSetSelected,
}: LocationDropdownProps): JSX.Element {
  const groups = useMemo<ContinentGroup[]>(() => {
    const byContinent = new Map<string, LocationOption[]>();
    for (const opt of locations) {
      const list = byContinent.get(opt.continent);
      if (list) list.push(opt);
      else byContinent.set(opt.continent, [opt]);
    }
    return [...byContinent.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([continent, options]) => ({ continent, options }));
  }, [locations]);

  const rows = useMemo<TreeRow[]>(() => {
    const out: TreeRow[] = [];
    const sumPhotos = (opts: LocationOption[]): number => {
      let total = 0;
      for (const o of opts) total += countryCounts.get(o.slug) ?? 0;
      return total;
    };
    for (const g of groups) {
      // Singleton continents whose only country shares the continent's
      // name (Antarctica) collapse: header itself is the toggle, no
      // child row needed.
      const collapseSingleton =
        g.options.length === 1 && g.options[0].name === g.continent;
      const check = groupCheck(g.options, selected);
      if (collapseSingleton) {
        const only = g.options[0];
        const n = countryCounts.get(only.slug) ?? 0;
        out.push({
          id: `loc:${only.slug}`,
          label: g.continent,
          depth: 0,
          check: selected.has(only.slug) ? 'on' : 'off',
          emphasis: 'heading',
          countText: n > 0 ? `(${n})` : undefined,
          onClick: () => onToggle(only.slug),
        });
        continue;
      }
      const continentTotal = sumPhotos(g.options);
      out.push({
        id: `grp:${g.continent}`,
        label: g.continent,
        depth: 0,
        check,
        emphasis: 'heading',
        // Continents are themselves expand/collapse-able like every
        // other branch. Default-expanded so the 2-level depth (continent
        // + country) is visible out of the gate.
        collapsible: true,
        defaultExpanded: true,
        countText: continentTotal > 0 ? `(${continentTotal})` : undefined,
        onClick: () => {
          const allSelected = g.options.every((o) => selected.has(o.slug));
          const next = new Set(selected);
          if (allSelected) for (const o of g.options) next.delete(o.slug);
          else for (const o of g.options) next.add(o.slug);
          onSetSelected(next);
        },
      });
      for (const o of g.options) {
        const n = countryCounts.get(o.slug) ?? 0;
        out.push({
          id: `loc:${o.slug}`,
          label: o.name,
          depth: 1,
          check: selected.has(o.slug) ? 'on' : 'off',
          searchText: `${o.name} ${o.slug}`,
          countText: n > 0 ? `(${n})` : undefined,
          onClick: () => onToggle(o.slug),
        });
      }
    }
    return out;
  }, [groups, selected, onToggle, onSetSelected, countryCounts]);

  // Selected summary — concatenate country names (singletons already
  // contribute via their loc:slug row).
  const summary = useMemo(() => {
    const labels: string[] = [];
    for (const o of locations) {
      if (selected.has(o.slug)) labels.push(o.name);
    }
    if (labels.length === 0) return undefined;
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')}…`;
  }, [locations, selected]);

  return (
    <TreeDropdown
      placeholder="Location"
      ariaLabel="Locations"
      searchPlaceholder="Search locations"
      selectedSummary={summary}
      rows={rows}
    />
  );
}
