// EraGeneric — fork of src/entries/Era.tsx for the public /builder/
// page. Same era-head chrome (focus + period), same media (carousel +
// lightbox), but the bullet list collapses to a single description
// line: the first achievement's text. The rest of the achievements
// stay on /resume/.
//
// The lede renders through BuilderProse: the roman body register
// (upright, unlike /resume/'s italic .entry-summary asides) with the
// RedactedText anchor + tooltip treatment for redaction glyphs.

import { Figure } from '../media/Figure';
import { BuilderProse } from './BuilderProse';
import { EraChrome } from '../entries/EraChrome';
import type { Achievement, Era as EraData } from '../types';

interface EraGenericProps {
  era: EraData;
}

function firstAchievementText(achievements?: ReadonlyArray<Achievement>): string | undefined {
  if (!achievements || achievements.length === 0) return undefined;
  const a = achievements[0];
  return typeof a === 'string' ? a : a.text;
}

export function EraGeneric({ era }: EraGenericProps): JSX.Element | null {
  if (era.visibility === 'archived') return null;
  // builder_tagline is the authored override; first achievement is the
  // fallback for eras that haven't been tagline-authored yet.
  const lede = era.builder_tagline ?? firstAchievementText(era.achievements);
  return (
    <EraChrome focus={era.focus} period={era.period}>
      {lede && <BuilderProse text={lede} />}
      {era.media && <Figure media={era.media} />}
    </EraChrome>
  );
}
