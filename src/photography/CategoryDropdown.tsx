// CategoryDropdown — thin wrapper around TreeDropdown that maps the
// Wildlife/Landscapes/Culture hierarchy + per-class species (grouped
// by sub-class like Penguins/Primates/etc) into the TreeRow shape.
//
// Selection semantics:
//   - Category nodes (Wildlife, Birds, Mountains, …) toggle the
//     category-id tag (matches via theme[] intersection in the filter).
//   - Subgroups (Penguins, Primates, Other) toggle every member
//     species in their bucket at once. Indeterminate when partial.
//   - Species leaves toggle their species name in the species bucket.

import { useMemo } from 'react';
import {
  CATEGORY_TREE,
  OTHER_SUBGROUP_PREFIX,
  SUBGROUPS,
  buildSpeciesToSubgroup,
  walkCategoryTree,
  type CategoryNode,
  type SubgroupDef,
} from './categories';
import { TreeDropdown, type TreeRow, type CheckState } from './TreeDropdown';

interface CategoryDropdownProps {
  speciesByClass: Record<string, string[]>;
  // Photo count per category tag (theme id) and per species name.
  // Used for the count badges. Total across the manifest, not filtered.
  themeCounts: Map<string, number>;
  speciesCounts: Map<string, number>;
  selectedCategories: Set<string>;
  selectedSpecies: Set<string>;
  onToggleCategory: (id: string) => void;
  onToggleSpecies: (name: string) => void;
}

// Bucket the species in a single wildlife class into named subgroups +
// an Other catch-all. Subgroups (named or Other) only render when
// they have 2+ members; singletons stay flat under the class.
// A wildlife class split three ways: subgroups big enough to render as
// their own branch, the 2+ leftovers that become an "Other" branch, and
// the leftovers that stay flat under the class.
type ClassPartition = {
  named: { def: SubgroupDef; members: string[] }[];
  other: string[];
  orphans: string[];
};

function partitionClass(
  classId: string,
  species: string[],
  s2g: Map<string, SubgroupDef>,
): ClassPartition {
  const byGroup = new Map<string, string[]>();
  const unmatched: string[] = [];
  for (const sp of species) {
    const g = s2g.get(sp.toLowerCase());
    if (g && g.class === classId) {
      const arr = byGroup.get(g.id) ?? [];
      arr.push(sp);
      byGroup.set(g.id, arr);
    } else {
      unmatched.push(sp);
    }
  }
  const named: { def: SubgroupDef; members: string[] }[] = [];
  const orphans: string[] = [];
  for (const def of SUBGROUPS) {
    if (def.class !== classId) continue;
    const members = byGroup.get(def.id) ?? [];
    if (members.length >= 2) {
      members.sort((a, b) => a.localeCompare(b));
      named.push({ def, members });
    } else if (members.length === 1) {
      // Singleton subgroup → unmatched (will fall into Other or orphans).
      unmatched.push(members[0]);
    }
  }
  unmatched.sort((a, b) => a.localeCompare(b));
  // "Other" only makes sense alongside at least one named subgroup —
  // when a class has no named subgroups at all (e.g. Reptiles &
  // amphibians with just chameleon + crocodile), wrapping the lone
  // unmatched species in a singleton "Other" parent is just noise.
  // Render them flat under the class instead.
  if (named.length > 0 && unmatched.length >= 2) {
    return { named, other: unmatched, orphans: [] };
  }
  return { named, other: [], orphans: unmatched };
}

function subgroupCheck(members: string[], selected: Set<string>): CheckState {
  let any = false;
  let all = true;
  for (const m of members) {
    if (selected.has(m)) any = true;
    else all = false;
  }
  if (all && members.length > 0) return 'on';
  if (any) return 'partial';
  return 'off';
}

function toggleSet(
  members: string[],
  selected: Set<string>,
  onToggle: (id: string) => void,
): void {
  const allSelected = members.every((m) => selected.has(m));
  if (allSelected) {
    for (const m of members) onToggle(m);
  } else {
    for (const m of members) if (!selected.has(m)) onToggle(m);
  }
}

// Flatten a category node into its self id plus every static descendant
// id (Wildlife → [wildlife, birds, mammals, reptiles-amphibians, …]).
// Species under those classes aren't included — they live on a separate
// selection axis (selectedSpecies) and have their own subgroup toggles.
function collectCategoryDescendants(node: CategoryNode): string[] {
  const out: string[] = [node.id];
  if (node.children) {
    for (const ch of node.children) {
      for (const id of collectCategoryDescendants(ch)) out.push(id);
    }
  }
  return out;
}

export function CategoryDropdown({
  speciesByClass,
  themeCounts,
  speciesCounts,
  selectedCategories,
  selectedSpecies,
  onToggleCategory,
  onToggleSpecies,
}: CategoryDropdownProps): JSX.Element {
  const s2g = useMemo(() => buildSpeciesToSubgroup(), []);

  const rows = useMemo<TreeRow[]>(() => {
    const out: TreeRow[] = [];

    // Photo count for a node. Categories look up theme counts; species
    // and subgroups sum across their member species. Returns undefined
    // when the count is 0 — TreeDropdown then omits the badge entirely.
    const fmtCount = (n: number | undefined): string | undefined =>
      n && n > 0 ? `(${n})` : undefined;
    const sumSpecies = (members: string[]): number => {
      let total = 0;
      for (const sp of members) total += speciesCounts.get(sp) ?? 0;
      return total;
    };

    walkCategoryTree((n: CategoryNode, depth: number) => {
      // A category node is collapsible if it has children — either
      // static (in CATEGORY_TREE) or dynamic species/subgroups injected
      // below. We mark it collapsible whenever it's a top-level node
      // OR has species under it.
      const hasDynamicChildren =
        (speciesByClass[n.id] ?? []).length > 0;
      const hasStaticChildren = !!n.children && n.children.length > 0;
      const collapsible = hasStaticChildren || hasDynamicChildren;
      // Parent categories (Wildlife / Landscapes / Culture) toggle their
      // entire static subtree at once: click → select all descendant
      // category ids; click again when all are on → deselect all. The
      // check state aggregates over the descendants the same way
      // subgroups aggregate over their species, so the badge reads
      // on / partial / off based on what's actually selected. Leaf
      // nodes (no static children) keep the single-id toggle.
      const descendantIds = hasStaticChildren
        ? collectCategoryDescendants(n)
        : null;
      const check = descendantIds
        ? subgroupCheck(descendantIds, selectedCategories)
        : (selectedCategories.has(n.id) ? 'on' : 'off');
      out.push({
        id: `cat:${n.id}`,
        label: n.label,
        depth,
        check,
        emphasis: depth === 0 ? 'heading' : 'normal',
        collapsible,
        // Default-expand only depth-0 nodes (Wildlife / Landscapes /
        // Culture). Their children (Birds / Mammals / Mountains /…)
        // start collapsed per the design — keeps the panel scannable
        // on first open.
        defaultExpanded: depth === 0,
        countText: fmtCount(themeCounts.get(n.id)),
        onClick: descendantIds
          ? () => toggleSet(descendantIds, selectedCategories, onToggleCategory)
          : () => onToggleCategory(n.id),
      });
      if (!hasDynamicChildren) return;
      const speciesHere = speciesByClass[n.id];
      const { named, other, orphans } = partitionClass(n.id, speciesHere, s2g);
      const childDepth = depth + 1;
      // Named subgroups (Penguins, Primates, ...).
      for (const { def, members } of named) {
        const check = subgroupCheck(members, selectedSpecies);
        out.push({
          id: `sub:${def.id}`,
          label: def.label,
          depth: childDepth,
          check,
          collapsible: true,
          countText: fmtCount(sumSpecies(members)),
          onClick: () => toggleSet(members, selectedSpecies, onToggleSpecies),
        });
        for (const sp of members) {
          out.push({
            id: `sp:${sp}`,
            label: sp,
            depth: childDepth + 1,
            check: selectedSpecies.has(sp) ? 'on' : 'off',
            emphasis: 'quiet',
            labelCase: 'mixed',
            countText: fmtCount(speciesCounts.get(sp)),
            onClick: () => onToggleSpecies(sp),
          });
        }
      }
      // Other catch-all.
      if (other.length > 0) {
        const otherId = `${OTHER_SUBGROUP_PREFIX}${n.id}`;
        const check = subgroupCheck(other, selectedSpecies);
        out.push({
          id: `sub:${otherId}`,
          label: 'Other',
          depth: childDepth,
          check,
          collapsible: true,
          countText: fmtCount(sumSpecies(other)),
          onClick: () => toggleSet(other, selectedSpecies, onToggleSpecies),
        });
        for (const sp of other) {
          out.push({
            id: `sp:${sp}`,
            label: sp,
            depth: childDepth + 1,
            check: selectedSpecies.has(sp) ? 'on' : 'off',
            emphasis: 'quiet',
            labelCase: 'mixed',
            countText: fmtCount(speciesCounts.get(sp)),
            onClick: () => onToggleSpecies(sp),
          });
        }
      }
      // Lone species (≤1 unmatched, no Other) — render directly.
      for (const sp of orphans) {
        out.push({
          id: `sp:${sp}`,
          label: sp,
          depth: childDepth,
          check: selectedSpecies.has(sp) ? 'on' : 'off',
          emphasis: 'quiet',
          labelCase: 'mixed',
          countText: fmtCount(speciesCounts.get(sp)),
          onClick: () => onToggleSpecies(sp),
        });
      }
    });
    return out;
  }, [
    speciesByClass,
    themeCounts,
    speciesCounts,
    selectedCategories,
    selectedSpecies,
    onToggleCategory,
    onToggleSpecies,
    s2g,
  ]);

  // Trigger summary: union of selected categories + species labels.
  // Skips subgroup ids (they're a UI grouping, not a separate selection
  // axis — the species inside them already contribute their labels).
  const summary = useMemo(() => {
    const labels: string[] = [];
    for (const r of rows) {
      if (r.id.startsWith('sub:')) continue;
      if (r.check === 'on') {
        labels.push(r.label);
        continue;
      }
      // Parent categories aggregate their subtree into `check`, so a
      // top-level filter applied on its own (hero buttons / deep link
      // ?categories=wildlife) reads 'partial' even though the row's own
      // id is selected. Include those rows so the trigger names the
      // filter and lights up instead of showing the placeholder.
      if (r.id.startsWith('cat:') && selectedCategories.has(r.id.slice(4))) {
        labels.push(r.label);
      }
    }
    if (labels.length === 0) return undefined;
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')}…`;
  }, [rows, selectedCategories]);

  return (
    <TreeDropdown
      placeholder="Category"
      ariaLabel="Categories"
      searchPlaceholder="Search categories"
      selectedSummary={summary}
      rows={rows}
    />
  );
}
