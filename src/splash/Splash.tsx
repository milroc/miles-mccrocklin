// Splash page chrome — globe-anchor composition (2026-07 redesign).
//
// Layout: asymmetric two-column on desktop (wordmark + tagline + door
// rows + socials left, wireframe-globe hero right), single stacked
// column on mobile (wordmark → tagline → globe → doors → socials).
// The globe is the page's one visual anchor; Builder and Photographer
// are compact "door" rows that scale to future doors (e.g. PROJECTS)
// without recomposing the page.
//
// First paint is JS paint — there is NO SSR for this page. build.ts
// ships an empty #root (the renderToString pass never worked and was
// removed the day it shipped, commit aa94552; see build.ts for the
// two options if SSR is ever wanted). The old <noscript> fallback was
// dead code for the same reason and has been deleted.
//
// The reveal (chrome fade-in + WebGL globe mount) is layered on by
// src/splash/effects.tsx after mount, via dynamic import from a
// useEffect. The WebGL globe mounts on every viewport (mobile
// included); the CSS <WireGlobe> renders underneath as the pre-mount
// state.

import { useEffect, useRef, type ReactNode } from 'react';
import {
  FaGithub,
  FaLinkedin,
  FaXTwitter,
  FaInstagram,
  FaThreads,
  FaEnvelope,
} from 'react-icons/fa6';
import { SYL, SMALLCAP_PREFIX_RE } from '../me';
import { WireGlobe } from '../globe/WireGlobe';
import {
  SPLASH_NAME,
  SPLASH_PORTRAIT,
  SPLASH_TAGLINE,
  SOCIALS,
  DOORS,
  EXPLORER_DOOR,
} from '../generated/splash-content';
import './splash-globals.css';
import s from './Splash.module.css';

// All splash content comes from src/generated/splash-content.ts,
// regenerated on every build/dev boot by scripts/build-splash-content.ts:
// door curation + tagline + continent count from data/splash.json,
// name/portrait/socials derived from data/me.json (single source of
// truth — no more hand-synced duplicates), country count from
// data/journey.json. The generated module is a few hundred bytes, so
// the bundle guard holds: me.json's prose never enters this chunk.
// Icons are presentation, so the id → component map lives here.
const SOCIAL_ICONS: Record<string, typeof FaGithub> = {
  github: FaGithub,
  linkedin: FaLinkedin,
  twitter: FaXTwitter,
  instagram: FaInstagram,
  threads: FaThreads,
  email: FaEnvelope,
};

// Match Header.tsx's syllable wrapper. Unlike the resume version, the
// underline animation is dormant on splash (no handle links to drive
// it), so both syllables share the one inert .syl class (the resume's
// per-syllable variants don't exist in this module).
function syllable(str: string, sub: string): ReactNode {
  const idx = str.toLowerCase().indexOf(sub.toLowerCase());
  if (idx === -1) return str;
  return (
    <>
      {str.slice(0, idx)}
      <span className={s.syl}>{str.slice(idx, idx + sub.length)}</span>
      {str.slice(idx + sub.length)}
    </>
  );
}

// Match Header.tsx's renderLast: split "Mc..." or "Mac..." prefix off,
// render with sup'd small-cap, then continue with the styled "roc" syllable.
function renderLast(name: string): ReactNode {
  const m = name.match(SMALLCAP_PREFIX_RE);
  if (!m) return name;
  const [, prefix, smallCap, rest] = m;
  return (
    <>
      {prefix}<sup className={s.nameSup}>{smallCap}</sup>{syllable(rest!, SYL.roc)}
    </>
  );
}

export function Splash(): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // Safety timer: if the reveal hasn't completed in 4s (network blip,
    // slow device, runtime error in effects), force the end-state.
    const safetyTimer = setTimeout(() => {
      if (root.classList.contains(s.revealing)) {
        console.warn('Splash reveal timed out at 4s; falling back to end-state.');
        root.classList.remove(s.revealing);
      }
    }, 4000);

    let cancelled = false;

    import('./effects')
      .then(({ runReveal }) => {
        if (cancelled) return;
        return runReveal(root);
      })
      .then(() => {
        clearTimeout(safetyTimer);
      })
      .catch((err: unknown) => {
        clearTimeout(safetyTimer);
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('Splash effects failed; showing end-state.', msg);
        root.classList.remove(s.revealing);
      });

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
    };
  }, []);

  // Render name parts: keep ALL pre-last tokens (e.g. middle name) so
  // "Miles Kendrick" reads in full ahead of the bolded "McCrocklin".
  const parts = SPLASH_NAME.split(' ');
  const last = parts.pop() ?? '';
  const first = parts.join(' ');

  return (
    <div
      className={`${s.root} ${s.revealing}`}
      data-splash-root="true"
      ref={rootRef}
    >
      <header className={s.header}>
        <div className={s.byline}>
          <img
            className={s.portrait}
            src={SPLASH_PORTRAIT}
            alt="Portrait of Miles McCrocklin"
            loading="lazy"
          />
          <h1 className={s.wordmark}>
            {syllable(first, SYL.mil)}
            <br />
            <span className={s.last}>{renderLast(last)}</span>
          </h1>
        </div>
        <p className={s.tagline}>{SPLASH_TAGLINE}</p>
      </header>

      <a className={s.hero} href={EXPLORER_DOOR.href} aria-label={EXPLORER_DOOR.aria}>
        <span className={s.globeBox} data-splash-globe-box="true">
          <span className={s.wireLayer}>
            <WireGlobe />
          </span>
          <span className={s.globeMount} data-splash-globe-mount="true" />
        </span>
        <span className={s.heroDoor}>
          <span className={s.doorLabel}>{EXPLORER_DOOR.label}</span>
          <span className={s.doorSublabel}>{EXPLORER_DOOR.sublabel}</span>
          <span className={s.doorCta}>{EXPLORER_DOOR.cta}</span>
        </span>
      </a>

      <div className={s.doors}>
        {DOORS.map(({ id, href, thumb, label, sublabel, cta, aria }) => (
          <a key={id} className={s.door} data-id={id} href={href} aria-label={aria}>
            <img className={s.doorImage} src={thumb} alt="" loading="lazy" />
            <span className={s.doorText}>
              <span className={s.doorLabel}>{label}</span>
              <span className={s.doorSublabel}>{sublabel}</span>
              <span className={s.doorCta}>{cta}</span>
            </span>
          </a>
        ))}
      </div>

      <nav className={s.socials} aria-label="Miles on the internet">
        {SOCIALS.map(({ id, href, label }) => {
          const Icon = SOCIAL_ICONS[id];
          if (!Icon) return null;
          return (
            <a
              key={id}
              href={href}
              target={href.startsWith('mailto:') ? undefined : '_blank'}
              rel={href.startsWith('mailto:') ? undefined : 'noreferrer'}
              className={s.socialLink}
              aria-label={label}
              title={label}
            >
              <Icon className={s.socialIcon} aria-hidden="true" />
            </a>
          );
        })}
      </nav>
    </div>
  );
}
