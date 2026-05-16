// One-time migration: priority/omit (legacy) → visibility (new).
//   priority: 1     → visibility: "all"
//   priority: 2 / 3 → drop the field (default not_1pager preserves behavior)
//   priority: 4     → visibility: "archived"
//   omit: true      → visibility: "archived"
// MediaItem.priority stays — that's a sort key for the carousel, not a
// visibility filter. We detect MediaItems by their {id, type} shape.
//
// Run: `bun scripts/migrate-priority-to-visibility.ts`
import me from '../data/me.json' with { type: 'json' };

type Visibility = 'all' | 'not_1pager' | '1pager_only' | 'archived';

function isMediaItem(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const o = node as { id?: unknown; type?: unknown };
  return typeof o.id === 'string'
    && (o.type === 'image' || o.type === 'video' || o.type === 'embed');
}

function migrate(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(migrate);
  if (node && typeof node === 'object') {
    if (isMediaItem(node)) return node;
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let visibility: Visibility | undefined;
    for (const [k, v] of Object.entries(src)) {
      if (k === 'priority' && typeof v === 'number') {
        if (v === 1) visibility = 'all';
        else if (v === 4) visibility = 'archived';
        // 2 and 3 collapse to default (no field)
      } else if (k === 'omit' && v === true) {
        visibility = 'archived';
      } else {
        out[k] = migrate(v);
      }
    }
    if (visibility) out.visibility = visibility;
    return out;
  }
  return node;
}

const migrated = migrate(me);
await Bun.write('./data/me.json', JSON.stringify(migrated, null, 2) + '\n');
console.log('Migrated data/me.json: priority/omit → visibility');
