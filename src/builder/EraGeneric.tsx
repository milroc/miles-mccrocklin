// EraGeneric — fork of src/entries/Era.tsx for the public /builder/
// page. Same era-head chrome (focus + period), same media (carousel +
// lightbox), but the bullet list collapses to a single description
// line: the first achievement's text. The rest of the achievements
// stay on /resume/.
//
// KPText is the render path because achievement text carries
// redaction glyphs (Ξ, α, β, σ, Σ, Ψ, Ω, Φ) that need the anchor +
// tooltip treatment — plain divs would render them as literal
// characters with no signal.

import { Figure } from '../media/Figure';
import { KPText } from '../primitives/KPText';
import { KP_BODY_FONT } from '../utils/kp-font';
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
      {lede && (
        <div className="entry-summary">
          <KPText text={lede} font={KP_BODY_FONT} />
        </div>
      )}
      {era.media && <Figure media={era.media} />}
    </EraChrome>
  );
}
