// ExperienceEntryGeneric — fork of src/entries/ExperienceEntry.tsx
// for the public /builder/ page. Same .entry chrome (entry-head
// company + dates, optional sub-line, media at job level), but the
// bullet list collapses to job.summary (a one-liner that already
// lives in me.json) and tracks drop. Nested eras render through
// EraGeneric, which does the same collapse.
//
// Sabbatical: no nested eras, falls back to jobHeroMedia → first
// track's first media group so the page picks up the travel
// photography carousel without re-authoring it at job level.

import { Figure } from '../media/Figure';
import { KPText } from '../primitives/KPText';
import { KP_BODY_FONT } from '../utils/kp-font';
import { EraGeneric } from './EraGeneric';
import { InlineEntry } from '../entries/InlineEntry';
import { SabbaticalEntry } from '../entries/SabbaticalEntry';
import type { Job, MediaGroup } from '../types';

interface ExperienceEntryGenericProps {
  job: Job;
}

function jobHeroMedia(job: Job): MediaGroup | undefined {
  if (job.media) return job.media;
  for (const track of job.tracks ?? []) {
    if (track.media) return track.media;
  }
  return undefined;
}

export function ExperienceEntryGeneric({ job }: ExperienceEntryGenericProps): JSX.Element {
  // Inline jobs (Cisco, Northrop) render as a single line: company ·
  // role · date range. The resume's existing InlineEntry already
  // does exactly that — reuse it verbatim so the two pages share the
  // same minimal treatment for older roles.
  if (job.company === 'Sabbatical') {
    // On /builder/ the sabbatical is a side-note: header + summary
    // visible by default, every track behind the "Learn more" toggle.
    // Drop the Building track entirely — the rest of this page is the
    // builder pitch, so re-stating it inside the sabbatical is
    // redundant. /resume/ shows everything inline.
    const builderJob: Job = {
      ...job,
      tracks: (job.tracks ?? []).filter((t) => t.focus !== 'Building'),
    };
    return <SabbaticalEntry job={builderJob} collapseAll />;
  }
  if (job.inline) return <InlineEntry job={job} />;

  const dateRange = `${job.start_date} – ${job.end_date}`;
  const heroMedia = jobHeroMedia(job);
  const hasEras = !!(job.eras && job.eras.length > 0);
  return (
    <div className="entry">
      <div className="entry-head">
        <div className="l">{job.company}</div>
        <div className="r">{dateRange}</div>
      </div>
      {job.summary && (
        <div className="entry-summary">
          <KPText text={job.summary} font={KP_BODY_FONT} />
        </div>
      )}
      {hasEras
        ? job.eras!.map((e, i) => <EraGeneric key={i} era={e} />)
        : heroMedia && <Figure media={heroMedia} />}
    </div>
  );
}
