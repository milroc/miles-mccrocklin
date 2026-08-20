// Provenance lookup for a single photo.
//
// Walks every label event for a namespaced id across all four tiers
// (ingest, ai, human, refined), prints them in chronological order,
// and shows which tier currently wins each field.
//
// Run:
//   bun run scripts/whence.ts <namespaced-id>           # all fields
//   bun run scripts/whence.ts <namespaced-id> <field>   # one field

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { JsonObject, JsonValue } from '../src/utils/json';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const LABELS_DIR = join(ROOT, 'data', 'photography-labels');

const TIERS = ['ingest', 'ai', 'human', 'refined'] as const;
type Tier = typeof TIERS[number];

interface Event {
  id: string;
  timestamp: string;
  tier: Tier;
  sessionFile: string;
  fields: JsonObject;
  source_fingerprint?: { human: string; ai: string };
}

function loadAllEvents(): Event[] {
  const out: Event[] = [];
  for (const tier of TIERS) {
    const dir = join(LABELS_DIR, tier);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort()) {
      const sessionFile = f.replace(/\.jsonl$/, '');
      const text = readFileSync(join(dir, f), 'utf8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const o = JSON.parse(trimmed) as JsonObject;
          if (typeof o.id !== 'string') continue;
          const event: Event = {
            id: o.id,
            timestamp: typeof o.timestamp === 'string' ? o.timestamp : sessionFile,
            tier,
            sessionFile,
            fields: (o.fields ?? {}) as JsonObject,
          };
          if (o.source_fingerprint) {
            event.source_fingerprint = o.source_fingerprint as { human: string; ai: string };
          }
          out.push(event);
        } catch { /* skip malformed */ }
      }
    }
  }
  // Sort by timestamp, sessionFile as tiebreaker.
  out.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return a.sessionFile < b.sessionFile ? -1 : a.sessionFile > b.sessionFile ? 1 : 0;
  });
  return out;
}

// Tier precedence (highest first): refined > human > ai > ingest.
const TIER_PRIORITY = {
  refined: 4, human: 3, ai: 2, ingest: 1,
} satisfies Record<Tier, number>;

// Empty values: human tier "clears" a field, others are no-ops.
function isEmpty(v: JsonValue): boolean {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

interface Winner {
  tier: Tier;
  timestamp: string;
  sessionFile: string;
  value: JsonValue;
}

// Walk events highest priority first, then chronological within tier.
// Returns the winning event per field plus a "cleared by" note when the
// highest-priority statement was a human clear.
function resolveWinners(events: Event[]): Map<string, Winner | 'cleared'> {
  const winners = new Map<string, Winner | 'cleared'>();
  // Group events by tier in chronological order.
  const byTier = new Map<Tier, Event[]>(TIERS.map((t) => [t, []]));
  for (const ev of events) byTier.get(ev.tier)?.push(ev);

  // Walk tiers low → high. Within each tier, latest write per field
  // overwrites earlier. Higher tier overrides lower entirely (per field).
  const state = new Map<string, Winner>();
  for (const tier of TIERS) {
    for (const ev of byTier.get(tier) ?? []) {
      for (const [k, v] of Object.entries(ev.fields)) {
        if (isEmpty(v)) {
          if (tier === 'human') {
            // Empty in human tier clears the field (signal).
            state.delete(k);
            winners.set(k, 'cleared');
          }
          continue;
        }
        state.set(k, { tier, timestamp: ev.timestamp, sessionFile: ev.sessionFile, value: v });
        winners.set(k, state.get(k)!);
      }
    }
  }
  return winners;
}

function fmtValue(v: JsonValue): string {
  const s = JSON.stringify(v);
  return s.length > 120 ? s.slice(0, 117) + '…' : s;
}

const TIER_BADGE = {
  ingest:  'ING',
  ai:      'AI ',
  human:   'HUM',
  refined: 'REF',
} satisfies Record<Tier, string>;

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: bun run scripts/whence.ts <namespaced-id> [field]');
    process.exit(1);
  }
  const id = args[0];
  const field = args[1] ?? null;

  const all = loadAllEvents();
  const events = all.filter((ev) => ev.id === id);
  if (events.length === 0) {
    console.log(`whence: no events found for ${id}`);
    return;
  }

  console.log(`whence: ${id}  (${events.length} events across tiers)`);
  console.log('');
  console.log('  CHRONOLOGY');
  for (const ev of events) {
    const keys = Object.keys(ev.fields).filter((k) => field == null || k === field);
    if (keys.length === 0) continue;
    const badge = TIER_BADGE[ev.tier];
    const fp = ev.source_fingerprint
      ? `  fp(human=${ev.source_fingerprint.human.slice(0, 19)}, ai=${ev.source_fingerprint.ai.slice(0, 19)})`
      : '';
    console.log(`  [${badge}] ${ev.timestamp}  session=${ev.sessionFile}${fp}`);
    for (const k of keys) {
      console.log(`         ${k.padEnd(14)} ${fmtValue(ev.fields[k])}`);
    }
  }

  const winners = resolveWinners(events);
  console.log('');
  console.log('  WINNERS');
  const keys = field ? [field] : [...winners.keys()].sort();
  for (const k of keys) {
    const w = winners.get(k);
    if (!w) {
      console.log(`  ${k.padEnd(14)} (no winning event)`);
      continue;
    }
    if (w === 'cleared') {
      console.log(`  ${k.padEnd(14)} CLEARED by human tier`);
      continue;
    }
    const badge = TIER_BADGE[w.tier];
    console.log(`  ${k.padEnd(14)} [${badge}] ${w.timestamp}  ${fmtValue(w.value)}`);
  }
}

if (import.meta.main) main();
