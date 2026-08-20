// Top-level app shell. Owns mode state (interactive / text / 1pager),
// the print sync (auto-switch to 1pager when the browser prints), and
// the toolbar that lets the visitor swap modes manually.
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Header } from './layout/Header';
import { Section } from './layout/Section';
import { SiteNav } from './layout/SiteNav';
import { TerminalDock } from './layout/TerminalDock';
import { ExperienceEntry } from './entries/ExperienceEntry';
import { EduEntry } from './entries/EduEntry';
import { Skills } from './entries/Skills';
import { SkillsCaption } from './entries/SkillsCaption';
import { Community } from './entries/Community';
import { RedactionLegend } from './primitives/RedactionLegend';
import { RedactionNotes } from './primitives/RedactionNotes';
import { SummaryGallery } from './media/SummaryGallery';
import { MediaProvider } from './media/MediaProvider';
import { ModeContext, visible, isArchived as isArchivedItem } from './utils/mode';
import { EDIT_ENABLED, EditToolbar, HighLevelFeedback, useEdit } from './edit';
import { RESUME_DATA } from './resume-data';
import type { Mode } from './types';
import './App.css';

function isMode(v: string | null): v is Mode {
  return v === 'interactive' || v === 'text' || v === '1pager';
}

export function App() {
  // In edit mode the renderable resume is the imported JSON with the
  // user's pending change records applied on top (`displayResume`).
  // In production the provider isn't mounted; useEdit() returns a stub
  // with `active=false` so the imported JSON is used directly.
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  const r = editActive ? edit.displayResume : RESUME_DATA;

  // Three modes: interactive (full + media), text (full, no media), 1pager
  // (priority-1 only, no media). Migrate legacy `resume-density` key.
  const [mode, setMode] = useState<Mode>(() => {
    const stored = localStorage.getItem('resume-mode');
    // 1-pager is a print/preview target, not a landing state — a
    // returning visitor gets the full mode back instead.
    if (isMode(stored)) return stored === '1pager' ? 'interactive' : stored;
    const legacy = localStorage.getItem('resume-density');
    if (legacy === 'compact') return 'text';
    return 'interactive';
  });
  const [printing, setPrinting] = useState(false);
  const savedModeBeforePrint = useRef<Mode | null>(null);

  useEffect(() => {
    localStorage.setItem('resume-mode', mode);
  }, [mode]);

  useEffect(() => {
    document.body.classList.toggle('printing', printing);
  }, [printing]);

  // Edit mode locks the resume into "text" so the chrome doesn't fight
  // the editor. While active, the mode buttons in the toolbar render
  // disabled. We don't restore the prior mode on toggle-off — leaving
  // it on text is fine; the user can switch back manually.
  useEffect(() => {
    if (editActive && mode !== 'text') setMode('text');
  }, [editActive, mode]);

  // Auto-switch to 1pager + flip the printing flag when the user prints.
  // flushSync is required: beforeprint snapshots the DOM synchronously, so
  // a normal async setState wouldn't land in the printed output.
  useEffect(() => {
    const before = (): void => {
      savedModeBeforePrint.current = mode;
      flushSync(() => {
        setPrinting(true);
        if (mode !== '1pager') setMode('1pager');
      });
    };
    const after = (): void => {
      const prev = savedModeBeforePrint.current;
      flushSync(() => {
        setPrinting(false);
        if (prev && prev !== '1pager') setMode(prev);
      });
      savedModeBeforePrint.current = null;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [mode]);

  const isInteractive = mode === 'interactive';
  const pageClass = `page mode-${mode}` + (isInteractive ? '' : ' text-only');

  // In edit mode we render every non-deleted entry so the user can
  // see and re-classify them. Mode is forced to "text" while editing
  // (see effect below) — visible() would still hide `1pager_only`
  // items in text mode, so we bypass it when editActive.
  // ARCHIVED styling is reserved for items the user explicitly marked
  // `visibility: "archived"` — a 1pager_only item shown in text mode
  // is a *mode mismatch*, not an archive, and renders as normal.
  const renderable = (item: unknown): boolean =>
    editActive ? true : visible(item, mode);
  const isArchived = (item: unknown): boolean =>
    editActive && isArchivedItem(item);

  const expEntries = r.experience.filter(renderable);
  const eduEntries = (r.education || []).filter(renderable);
  const commEntries = (r.community_organization || []).filter(renderable);
  const skillsHasAny = Object.values(r.skills || {}).some(
    (list) => Array.isArray(list) && (editActive || list.some((item) => visible(item, mode))),
  );
  const showSummary = !!r.summary;
  const showExperience = expEntries.length > 0;
  const showCommunity = commEntries.length > 0;
  const showSkills = skillsHasAny;
  const showEducation = eduEntries.length > 0;

  return (
    <ModeContext.Provider value={mode}>
    <MediaProvider>
    <div className={`app mode-${mode}`} data-app>
      <a href="#resume-content" className="skip-link">Skip to resume</a>
      <div className="toolbar-row">
        {/* Shared cross-page nav (favicon + name on the left,
            builder · photographer · explorer on the right). The
            previous back-link + WORDMARK lived in the toolbar below;
            SiteNav.brand replaces back, the spelled-out name
            replaces WORDMARK, and the right-hand pillar links wire
            this page into the three-pillar story consistently with
            /photographer and /explorer. */}
        <SiteNav current="builder" />
        <nav className="toolbar" aria-label="Resume controls">
          <button
            className={mode === 'interactive' ? 'active' : ''}
            aria-pressed={mode === 'interactive'}
            onClick={() => setMode('interactive')}
            disabled={editActive}
            title={editActive
              ? 'Mode is locked to "Text only" while editing'
              : 'Full portfolio: photos, videos, reviews, all detail'}
          >
            Full
          </button>
          <button
            className={mode === 'text' ? 'active' : ''}
            aria-pressed={mode === 'text'}
            onClick={() => setMode('text')}
            disabled={editActive}
            title="Terse text — deliverables only, no media"
          >
            Text only
          </button>
          <button
            className={mode === '1pager' ? 'active' : ''}
            aria-pressed={mode === '1pager'}
            onClick={() => setMode('1pager')}
            disabled={editActive}
            title={editActive
              ? 'Mode is locked to "Text only" while editing'
              : 'Single-page resume — must-have items only, used automatically when printing'}
          >
            1-Pager
          </button>
          <button onClick={() => window.print()} disabled={editActive}>Print / PDF</button>
        </nav>
      </div>

      <main id="resume-content">
      <article className={pageClass}>
        <Header contact={r.contact_information} />
        <HighLevelFeedback />

        <Section title="Summary" show={showSummary}>
          <p className="entry-summary lead">
            {r.summary}
          </p>
          {isInteractive && <SummaryGallery media={r.summary_media} />}
        </Section>

        <Section title="Skills" show={showSkills}>
          <SkillsCaption />
          <Skills skills={r.skills} path="/skills" />
        </Section>

        <Section title="Experience" show={showExperience}>
          {r.experience.map((j, i) => renderable(j) && (
            <ExperienceEntry
              key={i}
              job={j}
              path={`/experience/${i}`}
              archived={isArchived(j)}
            />
          ))}
        </Section>

        <Section title="Community" show={showCommunity}>
          <Community
            items={r.community_organization}
            path="/community_organization"
          />
        </Section>

        <Section title="Education" show={showEducation}>
          {(r.education || []).map((e, i) => renderable(e) && (
            <EduEntry
              key={i}
              school={e}
              path={`/education/${i}`}
              archived={isArchived(e)}
            />
          ))}
        </Section>

        <Section title="Notes" show={mode !== '1pager'}>
          <RedactionNotes items={r.redactions} />
        </Section>

        {/* 1-pager hides the Notes section to hold one Letter page,
            so the printed PDF gets this one-line key instead. */}
        {mode === '1pager' && <RedactionLegend items={r.redactions} />}

      </article>
      </main>
      <EditToolbar />
      {isInteractive && <TerminalDock />}
    </div>
    </MediaProvider>
    </ModeContext.Provider>
  );
}
