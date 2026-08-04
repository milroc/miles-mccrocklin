// Builder — public-facing /builder/ page. Forked from src/App.tsx (the
// detailed resume now at /resume/), trimmed to: shared SiteNav chrome,
// the resume's contact-stack Header, and Experience rendered with
// era_prose instead of bullets. No toolbar (no mode switcher, no
// print), no Summary section, no Skills, no Community, no Education,
// no Notes, no edit mode.
//
// Cards dropped from the public page:
//   - visibility: 'archived'  — author's resume-side hide flag
//   - hide_on_builder: true   — author's public-page hide flag
//     (currently unset on every entry; Cisco and Northrop stay on the
//     page as compact entries via `inline: true` instead)
//
// Visual identity is intentionally the same as /resume/: cream paper
// on dark canvas, document register, editorial typography. The two
// pages share .entry / .entry-head / .entry-sub / .entry-summary and
// the Era / Figure / lightbox primitives. The only authored difference
// is the prose vs. bulleted-achievements substitution.

import { Header } from '../layout/Header';
import { Section } from '../layout/Section';
import { SiteNav } from '../layout/SiteNav';
import { TerminalDock } from '../layout/TerminalDock';
import { SummaryGallery } from '../media/SummaryGallery';
import { MediaProvider } from '../media/MediaProvider';
import { Skills } from '../entries/Skills';
import { SkillsCaption } from '../entries/SkillsCaption';
import { EduEntry } from '../entries/EduEntry';
import { ModeContext } from '../utils/mode';
import { BuilderFooter } from './BuilderFooter';
import { BuilderTagline } from './BuilderTagline';
import { ExperienceEntryGeneric } from './ExperienceEntryGeneric';
import ME from '../../data/me.json' with { type: 'json' };
import type { Resume } from '../types';
import '../App.css';

const RESUME_DATA = ME as unknown as Resume;

export function Builder(): JSX.Element {
  const r = RESUME_DATA;
  const experience = r.experience.filter(
    (j) => j.visibility !== 'archived' && !j.hide_on_builder,
  );

  return (
    <ModeContext.Provider value="interactive">
    <MediaProvider>
      <div className="app mode-interactive" data-app>
        <a href="#builder-content" className="skip-link">Skip to content</a>
        <div className="toolbar-row">
          <SiteNav current="builder" />
        </div>
        {/* #builder-content matches the App.css max-width rule shared
            with /resume/'s #resume-content. Distinct IDs per page so
            view-source doesn't leak the resume label onto /builder/
            and the skip-link target stays accurate. */}
        <main id="builder-content">
          <article className="page mode-interactive">
            <Header contact={r.contact_information} />
            <BuilderTagline />

            {r.summary && (
              <Section title="Summary">
                <p className="entry-summary lead">
                  {r.summary}
                </p>
                <SummaryGallery media={r.summary_media} />
              </Section>
            )}

            <Section title="Skills">
              <SkillsCaption />
              <Skills skills={r.skills} />
            </Section>

            <Section title="Experience">
              {experience.map((j, i) => (
                <ExperienceEntryGeneric key={i} job={j} />
              ))}
            </Section>

            {r.education && r.education.length > 0 && (
              <Section title="Education">
                {r.education.map((e, i) => (
                  <EduEntry key={i} school={{ ...e, details: undefined }} />
                ))}
              </Section>
            )}
          </article>
        </main>
        <BuilderFooter email={r.contact_information.email} />
        <TerminalDock />
      </div>
    </MediaProvider>
    </ModeContext.Provider>
  );
}
