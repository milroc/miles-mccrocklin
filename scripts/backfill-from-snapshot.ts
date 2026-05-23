// One-shot recovery: an earlier run of migrate-themes collapsed
// `architecture` (and other Culture sub-tags) into just `['culture']`,
// losing the leaf granularity. Now that `architecture` is a leaf under
// Culture in categories.ts, recover those tags by reading the
// pre-migration photography.json from a git checkpoint and merging the
// missing leaf tags back into the live file.
//
// Run:
//   git show <pre-migration-sha>:data/photography.json > /tmp/snap.json
//   bun scripts/backfill-from-snapshot.ts /tmp/snap.json
//
// Idempotent — only adds tags that exist in the new hierarchy AND are
// missing from the current entry. Pass --dry-run to preview.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATEGORY_TREE, TREATMENT_TAGS, type CategoryNode } from '../src/photography/categories';

const ROOT = resolve(import.meta.dir, '..');
const LIVE_PATH = join(ROOT, 'data', 'photography.json');

interface Entry {
  id: string;
  theme?: string[];
  [k: string]: unknown;
}

// Tag renames between the snapshot vocabulary and the current
// hierarchy. Keys are old snapshot tags; values are arrays of new tags
// to add (including ancestors). Anything not listed here passes through
// the validity check unchanged.
const TAG_RENAMES: Record<string, string[]> = {
  historical: ['culture', 'history'],
};

const validCategoryIds = (() => {
  const out = new Set<string>();
  const walk = (nodes: CategoryNode[]): void => {
    for (const n of nodes) {
      out.add(n.id);
      if (n.children) walk(n.children);
    }
  };
  walk(CATEGORY_TREE);
  return out;
})();
const validTreatmentIds = new Set<string>(TREATMENT_TAGS);

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const snapshotPath = args.find((a) => !a.startsWith('--'));
  if (!snapshotPath) {
    console.error('Usage: bun scripts/backfill-from-snapshot.ts <snapshot.json> [--dry-run]');
    process.exit(1);
  }

  const snapshot: Entry[] = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const live: Entry[] = JSON.parse(readFileSync(LIVE_PATH, 'utf8'));
  const liveById = new Map(live.map((e) => [e.id, e]));

  let touched = 0;
  const addedCounts = new Map<string, number>();
  for (const snap of snapshot) {
    const cur = liveById.get(snap.id);
    if (!cur || !snap.theme) continue;
    const before = new Set(cur.theme ?? []);
    const after = new Set(before);
    for (const t of snap.theme) {
      const norm = t.toLowerCase().trim();
      // Translate via the rename map first (e.g. snapshot's
      // "historical" → ["culture","history"]). Otherwise pass the tag
      // through unchanged.
      const targets =
        TAG_RENAMES[norm] ??
        (validCategoryIds.has(norm) || validTreatmentIds.has(norm) ? [norm] : []);
      for (const tag of targets) {
        if (!after.has(tag)) {
          after.add(tag);
          addedCounts.set(tag, (addedCounts.get(tag) ?? 0) + 1);
        }
      }
    }
    if (after.size !== before.size) {
      cur.theme = [...after];
      touched += 1;
    }
  }

  console.log(`backfill: ${touched}/${live.length} entries got new tags`);
  if (addedCounts.size > 0) {
    console.log('tags restored:');
    for (const [tag, n] of [...addedCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${tag.padEnd(20)} ${n}`);
    }
  }
  if (!dryRun) {
    writeFileSync(LIVE_PATH, JSON.stringify(live, null, 2) + '\n');
    console.log(`wrote ${LIVE_PATH}`);
  } else {
    console.log('(dry-run: photography.json NOT modified)');
  }
}

if (import.meta.main) main();
