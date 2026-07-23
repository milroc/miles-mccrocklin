// Redaction registry, sourced from `data/me.json` so the context
// strings live with the rest of the resume prose. The `redactions` array
// in the JSON powers two surfaces:
//
//   1. The inline anchor + hover tooltip rendered by KPText — the green
//      α/β/… that appears in running prose. Click navigates to the
//      matching footnote; hover shows the context inline as a tooltip.
//   2. The Notes section at the end of the resume, where each variable
//      gets a glyph + a brief description.
//
// See `Redaction` in src/types.ts for the field contract.
import ME from '../data/me.json' with { type: 'json' };
import type { Redaction, Resume } from './types';

const RESUME_DATA = ME as unknown as Resume;

export type { Redaction };

const REDACTIONS: readonly Redaction[] = RESUME_DATA.redactions ?? [];

// Lookup by glyph for the inline renderer (KPText.withRedactions).
export const REDACTION_BY_GLYPH: ReadonlyMap<string, Redaction> = new Map(
  REDACTIONS.map((r) => [r.glyph, r]),
);
