// TreeDropdown — generic hierarchical, searchable multi-select dropdown.
// Both CategoryDropdown (Wildlife/Landscapes/Culture + species) and
// LocationDropdown (continents + countries) compose this — they
// translate their domain data into a flat `TreeRow[]` and pass click
// handlers; this component owns the trigger affordance, panel open
// state, search filtering, collapse state, and tri-state checkboxes.
//
// Why a flat row list rather than a nested tree shape: the search +
// collapse logic both depend on ancestor relationships, which are
// expressible with `depth` indices alone. Flat rows also keep the
// consumer's translation step simple (one map over their domain
// data → one TreeRow each) without recursion bookkeeping.

import { useEffect, useMemo, useRef, useState } from 'react';
import s from './TreeDropdown.module.css';

export type CheckState = 'on' | 'off' | 'partial';

export interface TreeRow {
  // Unique among all rows; used as the React key and to track
  // collapse state when collapsible.
  id: string;
  label: string;
  depth: number;             // 0 = top-level
  check: CheckState;
  // What clicking the row's label does. Most rows have a single
  // toggle; some are pure visual groups (no own selection).
  onClick?: () => void;
  // When set, the row renders an expand/collapse chevron and its
  // descendants hide when collapsed. Default expanded state can be
  // controlled by `defaultExpanded`.
  collapsible?: boolean;
  defaultExpanded?: boolean;
  // Optional count badge after the label (e.g. "(5)" or "3/12").
  countText?: string;
  // Visual register hints: bumps font weight at depth 0, dims at
  // species depth. The consumer can override via custom classes if
  // it ever needs to.
  emphasis?: 'heading' | 'normal' | 'quiet';
  // Display mode for the label — uppercase mono (default) vs.
  // mixed-case (species names like "Galápagos penguin").
  labelCase?: 'upper' | 'mixed';
  // Searchable text — defaults to label if omitted. Consumers can
  // include extra synonyms (e.g. country slug as well as name).
  searchText?: string;
}

interface TreeDropdownProps {
  // Trigger label when nothing is selected.
  placeholder: string;
  // Trigger label override when selected items exist; if omitted, the
  // component falls back to "N selected" so the consumer doesn't have
  // to compute a summary if it doesn't want to.
  selectedSummary?: string;
  // ARIA + search affordance label.
  ariaLabel: string;
  searchPlaceholder?: string;
  rows: TreeRow[];
}

// The collapsed trigger's text plus whether any row is selected (which
// drives the active styling).
type Summary = { label: string; active: boolean };

function defaultSummary(rows: TreeRow[], placeholder: string): Summary {
  const onLabels: string[] = [];
  for (const r of rows) if (r.check === 'on') onLabels.push(r.label);
  if (onLabels.length === 0) return { label: placeholder, active: false };
  if (onLabels.length <= 2) return { label: onLabels.join(', '), active: true };
  return { label: `${onLabels.slice(0, 2).join(', ')}…`, active: true };
}

// Compute, for each row, whether any descendant matches the query.
// Used to keep ancestors visible when a deep leaf matches the search.
function computeSearchVisibility(rows: TreeRow[], query: string): boolean[] | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const directMatch = rows.map(
    (r) => (r.searchText ?? r.label).toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
  );
  const visible = new Array<boolean>(rows.length).fill(false);
  for (let i = 0; i < rows.length; i++) {
    if (!directMatch[i]) continue;
    visible[i] = true;
    const myDepth = rows[i].depth;
    let d = myDepth - 1;
    for (let j = i - 1; j >= 0 && d >= 0; j--) {
      if (rows[j].depth === d) {
        visible[j] = true;
        d -= 1;
      }
    }
  }
  return visible;
}

// Compute, for each row, whether a collapsible ancestor is currently
// hiding it. Search visibility overrides — if the user is actively
// searching and the row matches, it shows regardless of collapse.
function computeCollapseMask(
  rows: TreeRow[],
  expanded: Set<string>,
  searchVisible: boolean[] | null,
): boolean[] {
  const mask = new Array<boolean>(rows.length).fill(true);
  let hidingFromDepth: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (hidingFromDepth != null && r.depth > hidingFromDepth) {
      // Search override: a matched row breaks through the collapse.
      mask[i] = !!(searchVisible && searchVisible[i]);
      continue;
    }
    if (hidingFromDepth != null && r.depth <= hidingFromDepth) {
      hidingFromDepth = null;
    }
    mask[i] = true;
    if (r.collapsible) {
      const isExpanded = expanded.has(r.id);
      const expandedBySearch =
        searchVisible &&
        searchVisible[i] &&
        rows.some((other, j) => j > i && other.depth > r.depth && searchVisible[j]);
      if (!isExpanded && !expandedBySearch) {
        hidingFromDepth = r.depth;
      }
    }
  }
  return mask;
}

export function TreeDropdown({
  placeholder,
  selectedSummary,
  ariaLabel,
  searchPlaceholder = 'Search',
  rows,
}: TreeDropdownProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const init = new Set<string>();
    for (const r of rows) if (r.collapsible && r.defaultExpanded) init.add(r.id);
    return init;
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const summary = useMemo(() => {
    if (selectedSummary != null) {
      return { label: selectedSummary || placeholder, active: !!selectedSummary };
    }
    return defaultSummary(rows, placeholder);
  }, [rows, placeholder, selectedSummary]);

  const searchVisible = useMemo(
    () => computeSearchVisibility(rows, query),
    [rows, query],
  );
  const collapseMask = useMemo(
    () => computeCollapseMask(rows, expanded, searchVisible),
    [rows, expanded, searchVisible],
  );

  useEffect(() => {
    if (!open) return;
    // Skip auto-focus on touch primary devices — the keyboard pops up
    // and pushes the bottom sheet out of view. Desktop users still
    // benefit from immediate type-to-search.
    const isCoarsePointer =
      typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse)').matches;
    if (!isCoarsePointer) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    // pointerdown covers both mouse + touch with one listener — mousedown
    // alone misses outside-taps on iOS Safari when the page wasn't
    // already focused.
    const onDocPointer = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleExpand = (id: string): void => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isRowVisible = (i: number): boolean => {
    if (searchVisible && !searchVisible[i]) return false;
    if (!collapseMask[i]) return false;
    return true;
  };

  const anyVisible = rows.some((_, i) => isRowVisible(i));

  return (
    <div className={s.root} ref={rootRef}>
      <button
        type="button"
        className={`${s.trigger} ${summary.active ? s.triggerActive : ''} ${open ? s.triggerOpen : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={s.triggerLabel}>{summary.label}</span>
        <span aria-hidden="true" className={s.triggerChevron}>▾</span>
      </button>
      {open && (
        <>
          {/* Backdrop dims the page behind the bottom sheet on mobile;
              hidden on desktop via CSS. Tapping it closes the panel. */}
          <div
            className={s.backdrop}
            aria-hidden="true"
            onPointerDown={() => setOpen(false)}
          />
          <div
            className={s.panel}
            role="listbox"
            aria-label={ariaLabel}
            aria-multiselectable="true"
          >
          {/* Sheet header — only visible on mobile (label + explicit
              close). Drives the same setOpen(false) the backdrop does. */}
          <div className={s.sheetHeader}>
            <span className={s.sheetTitle}>{ariaLabel}</span>
            <button
              type="button"
              className={s.sheetClose}
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className={s.searchWrap}>
            <input
              ref={searchRef}
              type="search"
              className={s.search}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              aria-label={`Search ${ariaLabel.toLowerCase()}`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <ul className={s.list}>
            {rows.map((r, i) => {
              if (!isRowVisible(i)) return null;
              const emphasisClass =
                r.emphasis === 'heading'
                  ? s.heading
                  : r.emphasis === 'quiet'
                    ? s.quiet
                    : '';
              const caseClass = r.labelCase === 'mixed' ? s.labelMixed : '';
              const isExpanded =
                r.collapsible &&
                (expanded.has(r.id) ||
                  (searchVisible !== null &&
                    searchVisible[i] &&
                    rows.some((o, j) => j > i && o.depth > r.depth && searchVisible[j])));
              return (
                <li key={r.id}>
                  <div
                    className={`${s.row} ${r.check !== 'off' ? s.active : ''}`}
                    style={{ paddingLeft: `${6 + r.depth * 12}px` }}
                  >
                    {r.collapsible ? (
                      <button
                        type="button"
                        className={s.chevron}
                        onClick={() => toggleExpand(r.id)}
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                        aria-expanded={!!isExpanded}
                      >
                        <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                      </button>
                    ) : (
                      <span aria-hidden="true" className={s.chevronSpacer} />
                    )}
                    <button
                      type="button"
                      className={`${s.label} ${emphasisClass} ${caseClass}`}
                      onClick={r.onClick}
                      disabled={!r.onClick}
                      role="option"
                      aria-selected={r.check === 'on'}
                    >
                      <span
                        aria-hidden="true"
                        className={`${s.check} ${
                          r.check === 'on'
                            ? s.checkOn
                            : r.check === 'partial'
                              ? s.checkPartial
                              : ''
                        }`}
                      >
                        {r.check === 'on' ? '✓' : r.check === 'partial' ? '–' : ''}
                      </span>
                      <span className={s.labelText}>{r.label}</span>
                      {r.countText && (
                        <span className={s.count} aria-hidden="true">
                          {r.countText}
                        </span>
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
            {!anyVisible && <li className={s.empty}>No matches</li>}
          </ul>
          </div>
        </>
      )}
    </div>
  );
}
