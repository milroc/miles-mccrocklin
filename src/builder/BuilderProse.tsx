// BuilderProse — the body paragraph register for /builder/ era + job
// prose. Shares .entry-summary's size/color/leading but sets upright:
// on /resume/ an entry summary is a one-line italic aside above the
// bullets, while on /builder/ these paragraphs ARE the body content
// (five deep on the Meta entry alone), and the italic register isn't
// meant to carry sustained reading. Owner decision 2026-08-04 — see
// DESIGN.md Decisions Log. /resume/ and the builder Summary lede /
// taglines keep the italic register.
//
// RedactedText is the render path because the prose carries redaction
// glyphs (Ξ, α, β, σ, Σ, Ψ, Ω, Φ) that need the anchor + tooltip
// treatment.

import { RedactedText } from '../primitives/RedactedText';
import s from './BuilderProse.module.css';

interface BuilderProseProps {
  text: string;
}

export function BuilderProse({ text }: BuilderProseProps): JSX.Element {
  return (
    <div className={`entry-summary ${s.root}`}>
      <RedactedText text={text} />
    </div>
  );
}
