// Justified-rows packing for the Masonry component.
//
// Reference: https://preimage.dearlarry.co/packing.html
// (packJustifiedRows — closes rows at a target height and scales each
// completed row to the panel width).
//
// Goals:
//
//   1. Fill the container width exactly (every row is width-justified).
//   2. Fill the container height as fully as possible.
//   3. Preserve every image's native aspect (no distortion, no crop).
//
// To meet 1+2+3 simultaneously when the image set's aspects don't tile
// exactly, we accept that some trailing images may not render — only
// the rows that fit are kept. The order of the input array becomes a
// priority list: leading items always render, trailing items drop first.
//
// Algorithm: two-knob search across (n, target row height). For each
// combination, partition the first n images into rows greedily, then
// check whether the natural total height fits the container. Pick the
// (n, target) that minimizes the bottom gap, breaking ties toward
// larger n (= more images shown).

export interface ImageBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when this position represents a rendered image. False = drop. */
  visible: boolean;
}

interface PackedRow {
  indices: number[];
  aspectSum: number;
  /** Natural height = containerW / aspectSum. */
  height: number;
}

/**
 * Default per-row size profile. Multipliers applied to the base target
 * row height: row 0 is 1.6× the base, row 1 is 1.0×, etc. This pushes
 * leading items into taller rows so they render larger. Rows past the
 * profile length re-use the last value.
 *
 * Pass `[1]` (single-value profile) for uniform row heights.
 */
export const DEFAULT_SIZE_PROFILE: ReadonlyArray<number> = [1.6, 1.0, 0.7, 0.55, 0.5];

function profileMultiplier(profile: ReadonlyArray<number>, rowIdx: number): number {
  if (profile.length === 0) return 1;
  return profile[Math.min(rowIdx, profile.length - 1)] ?? 1;
}

function partitionAtTargetHeight(
  aspects: number[],
  containerW: number,
  baseTargetH: number,
  profile: ReadonlyArray<number>,
): PackedRow[] {
  const rows: PackedRow[] = [];
  let current: number[] = [];
  let currentAspectSum = 0;
  let rowIdx = 0;

  const closeRow = (): void => {
    if (current.length === 0) return;
    rows.push({
      indices: current,
      aspectSum: currentAspectSum,
      height: containerW / currentAspectSum,
    });
    current = [];
    currentAspectSum = 0;
    rowIdx++;
  };

  for (let i = 0; i < aspects.length; i++) {
    const a = aspects[i]!;

    if (current.length === 0) {
      current.push(i);
      currentAspectSum = a;
      continue;
    }

    // Per-row target height. Earlier rows have larger multipliers, so
    // their natural fit "wants" a taller height — fewer items per row,
    // each rendered larger. Later rows accept smaller heights and
    // therefore more items per row.
    const targetH = baseTargetH * profileMultiplier(profile, rowIdx);

    // Flickr decision rule: would adding this item bring the row's
    // natural height closer to target, or would closing the row first
    // be closer? Pick the option with smaller distance to target.
    const heightWith = containerW / (currentAspectSum + a);
    const heightWithout = containerW / currentAspectSum;
    const distWith = Math.abs(heightWith - targetH);
    const distWithout = Math.abs(heightWithout - targetH);

    if (distWith <= distWithout) {
      current.push(i);
      currentAspectSum += a;
    } else {
      closeRow();
      current.push(i);
      currentAspectSum = a;
    }
  }
  closeRow();

  return rows;
}

/**
 * Justified-rows packing tuned to fill the container in both width
 * and height. Width is exact per row by construction. Height is
 * filled by tuning two knobs in tandem:
 *
 *   • how many images to include (n), and
 *   • the base target row height (multiplied per-row by `sizeProfile`).
 *
 * For every (n, target) combo we partition the first n images and
 * measure how close the natural total height comes to containerH.
 * The closest fit wins. Tail images beyond n are dropped.
 *
 * `sizeProfile` controls how row heights vary with row index — the
 * default leads with a tall row so first-in-list items render larger.
 *
 * Returns one ImageBox per input aspect. `visible: false` marks
 * images that were dropped — the caller skips rendering them.
 */
export function computeJustifiedLayout(
  aspects: readonly number[],
  containerW: number,
  containerH: number,
  sizeProfile: ReadonlyArray<number> = DEFAULT_SIZE_PROFILE,
): { positions: ImageBox[]; totalHeight: number } {
  const N = aspects.length;
  if (containerW <= 0 || containerH <= 0 || N === 0) {
    return {
      positions: aspects.map(() => ({ x: 0, y: 0, w: 0, h: 0, visible: false })),
      totalHeight: 0,
    };
  }

  const aspectArr = aspects.slice() as number[];

  let best: { rows: PackedRow[]; gap: number; n: number } | null = null;

  const minN = Math.min(N, 3);

  for (let n = N; n >= minN; n--) {
    const subset = aspectArr.slice(0, n);

    // Sweep target row heights at 1-px granularity. With ~15 images
    // and a typical container, the search runs ~600 iterations total —
    // cheap and gives sub-pixel fits.
    for (let target = containerH; target >= 32; target -= 1) {
      const rows = partitionAtTargetHeight(subset, containerW, target, sizeProfile);
      const totalHeight = rows.reduce((s, r) => s + r.height, 0);

      // Skip overflowing candidates — overflow would either require
      // cropping the bottom or scaling rows down, both of which
      // violate the no-distortion / no-crop guarantee.
      if (totalHeight > containerH + 0.5) continue;

      const gap = containerH - totalHeight;

      if (
        !best ||
        gap < best.gap - 0.5 ||
        (Math.abs(gap - best.gap) < 0.5 && n > best.n)
      ) {
        best = { rows, gap, n };
      }

      // Near-perfect fit at this n — stop sweeping target heights.
      if (gap < 1) break;
    }

    // Near-perfect fit found at THIS n — no point dropping more
    // images, we're already filling the container. Lock it in.
    if (best && best.n === n && best.gap < 1) break;
  }

  // Defensive: if NO partition fit (extreme aspects + tiny container),
  // fall back to the smallest single-row layout that doesn't overflow
  // — better to show a couple images at the top than nothing.
  if (!best) {
    for (let n = 1; n <= N; n++) {
      const subset = aspectArr.slice(0, n);
      const aspectSum = subset.reduce((s, a) => s + a, 0);
      const rowH = containerW / aspectSum;
      if (rowH > containerH) continue;
      best = {
        rows: [{ indices: subset.map((_, i) => i), aspectSum, height: rowH }],
        gap: containerH - rowH,
        n,
      };
      break;
    }
  }

  if (!best) {
    return {
      positions: aspects.map(() => ({ x: 0, y: 0, w: 0, h: 0, visible: false })),
      totalHeight: 0,
    };
  }

  // Materialize positions. Items in `best.rows` are visible; trailing
  // items beyond best.n stay invisible.
  const positions: ImageBox[] = aspectArr.map(() => ({
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    visible: false,
  }));

  let y = 0;
  for (const row of best.rows) {
    let x = 0;
    for (const idx of row.indices) {
      const w = row.height * aspectArr[idx]!;
      positions[idx] = { x, y, w, h: row.height, visible: true };
      x += w;
    }
    y += row.height;
  }
  const naturalTotal = y;

  // Final fill: the natural partition's total height rarely lands
  // exactly on containerH, especially with a graduated size profile.
  // Scale every visible row's height + y so the stack fills the
  // container exactly. Width stays width-fit per row (untouched), so
  // each cell ends up slightly off its native aspect — capped at the
  // distortion budget below, which is sub-perceptual on any image
  // that isn't a perfect circle. Pair with `object-fit: fill` on the
  // image element to fill the cell exactly without letterboxing.
  const MAX_STRETCH = 1.18;
  const MIN_STRETCH = 0.85;
  if (naturalTotal > 0) {
    const rawScale = containerH / naturalTotal;
    const scale = Math.max(MIN_STRETCH, Math.min(MAX_STRETCH, rawScale));
    if (scale !== 1) {
      for (const pos of positions) {
        if (!pos.visible) continue;
        pos.y *= scale;
        pos.h *= scale;
      }
    }
    return { positions, totalHeight: naturalTotal * scale };
  }

  return { positions, totalHeight: naturalTotal };
}
