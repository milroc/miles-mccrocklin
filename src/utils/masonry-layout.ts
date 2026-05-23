// Flickr-justified masonry packing.
//
// Greedy row builder: keep appending photos to a row while their summed
// aspect-ratio is below the row's `aspect budget` (containerWidth /
// targetRowHeight). Once we cross the budget, scale every photo in the
// row uniformly so the row exactly fills containerWidth — that's the
// "justification" step. Each photo lands at a width proportional to its
// aspect ratio, so landscape pairs side-by-side and portraits get more
// horizontal real estate when they're alone.
//
// "Adaptive per-aspect" on mobile (the design D9 decision) comes free:
// at narrow container widths the aspect budget shrinks, so the algorithm
// naturally lets portraits stand alone (one per row) and lets pairs of
// landscapes share a row when they fit.
//
// Reference: https://flickr.com/services/api/misc.bandwidth.html
// (the "justified gallery" pattern is what Flickr ships on flickr.com)

export interface LayoutInput {
  id: string;
  aspect: number;
}

export interface LayoutCell<T extends LayoutInput> {
  item: T;
  width: number;
  height: number;
}

export interface LayoutRow<T extends LayoutInput> {
  cells: LayoutCell<T>[];
  height: number;
}

export interface LayoutOptions {
  containerWidth: number;     // CSS px
  targetRowHeight: number;    // CSS px (the height each row aims for)
  gap: number;                // CSS px between photos
  // Clamp aspect ratios that would otherwise break the layout (eng review
  // critical gap: very tall portraits or very wide ultrawides). The clamp
  // is applied during packing, not to the rendered photo — the photo
  // itself still uses its true aspect for the <img>, but layout math
  // pretends the aspect is within bounds.
  minAspect?: number;         // default 0.3
  maxAspect?: number;         // default 3.0
}

const DEFAULT_MIN_ASPECT = 0.3;
const DEFAULT_MAX_ASPECT = 3.0;

function clampAspect(a: number, opts: LayoutOptions): number {
  const lo = opts.minAspect ?? DEFAULT_MIN_ASPECT;
  const hi = opts.maxAspect ?? DEFAULT_MAX_ASPECT;
  if (!Number.isFinite(a) || a <= 0) return 1;
  return Math.min(hi, Math.max(lo, a));
}

// Pack items into rows that exactly fill containerWidth.
export function layoutMasonry<T extends LayoutInput>(
  items: T[],
  opts: LayoutOptions,
): LayoutRow<T>[] {
  if (items.length === 0) return [];
  if (opts.containerWidth <= 0 || opts.targetRowHeight <= 0) return [];

  // Aspect budget for one row: total aspect (sum of widths-as-multiples
  // of-height) at target height equals containerWidth minus the gaps
  // between cells.
  const rows: LayoutRow<T>[] = [];
  let current: T[] = [];
  let currentAspectSum = 0;

  const flush = (justify: boolean): void => {
    if (current.length === 0) return;
    const gapTotal = opts.gap * (current.length - 1);
    const availableWidth = opts.containerWidth - gapTotal;
    // Justified row height: scale the target row so the sum of cell
    // widths fits exactly. For an unfilled last row (justify=false),
    // use the target row height directly so it doesn't get blown up.
    const rowHeight = justify
      ? availableWidth / currentAspectSum
      : opts.targetRowHeight;
    const cells: LayoutCell<T>[] = current.map((item) => {
      const a = clampAspect(item.aspect, opts);
      return {
        item,
        width: a * rowHeight,
        height: rowHeight,
      };
    });
    rows.push({ cells, height: rowHeight });
    current = [];
    currentAspectSum = 0;
  };

  // Target aspect sum: at target row height, container width / target row
  // height = how many aspect-units fit. Treat gaps as part of width.
  const targetAspectBudget = opts.containerWidth / opts.targetRowHeight;

  for (const item of items) {
    const a = clampAspect(item.aspect, opts);
    const tentative = currentAspectSum + a;
    current.push(item);
    currentAspectSum = tentative;
    // Once the row would overflow, justify it and start a new row. We
    // justify the row that just overflowed — the design language is "the
    // wall is always justified" except for the last partial row.
    if (currentAspectSum >= targetAspectBudget) {
      flush(true);
    }
  }
  // Last partial row: render at target row height without justification.
  flush(false);

  return rows;
}
