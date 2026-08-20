// Splash page chrome — globe-anchor composition (2026-07 redesign).
//
// Layout: asymmetric two-column on desktop (wordmark + tagline + door
// rows + socials left, wireframe-globe hero right), single stacked
// column on mobile (wordmark → tagline → globe → doors → socials).
// The globe is the page's one visual anchor; Builder and Photographer
// are compact "door" rows that scale to future doors (e.g. PROJECTS)
// without recomposing the page.
//
// First paint is the PRERENDERED document: build.ts bundles
// src/splash/ssr-entry.tsx and injects renderToString(<Splash />)
// into dist/index.html's #root, so the full chrome (wordmark,
// tagline, doors, socials, CSS wireframe globe) is real HTML before
// any JavaScript runs — and IS the page when JavaScript never runs.
// splash-entry.tsx hydrates that markup in prod and fresh-renders in
// dev (dev.ts serves the source HTML's empty #root).
//
// The chrome fade-in is a pure-CSS entrance animation
// (splash-chrome-enter, see Splash.module.css) — content is never
// withheld waiting for JS. The WebGL globe mount is layered on by
// src/splash/effects.tsx after mount, via dynamic import from a
// useEffect. It mounts on every viewport (mobile included); the CSS
// <WireGlobe> renders underneath as the pre-mount state and the
// permanent no-JS / perf-fallback state.

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
const SOCIAL_ICONS = {
  github: FaGithub,
  linkedin: FaLinkedin,
  twitter: FaXTwitter,
  instagram: FaInstagram,
  threads: FaThreads,
  email: FaEnvelope,
} satisfies Record<string, typeof FaGithub>;

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

    // The chrome fade-in is pure CSS (splash-chrome-enter) — effects
    // only mounts the WebGL globe now, so a failure here leaves the
    // CSS WireGlobe in place and costs nothing else. No safety timer:
    // there is no hidden state to force out of anymore.
    let cancelled = false;

    import('./effects')
      .then(({ runReveal }) => {
        if (cancelled) return;
        return runReveal(root);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('Splash effects failed; keeping the CSS wireframe globe.', msg);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Render name parts: keep ALL pre-last tokens (e.g. middle name) so
  // "Miles Kendrick" reads in full ahead of the bolded "McCrocklin".
  const parts = SPLASH_NAME.split(' ');
  const last = parts.pop() ?? '';
  const first = parts.join(' ');

  return (
    <div
      className={s.root}
      data-splash-root="true"
      ref={rootRef}
    >
      {/* No-JS override, per the CLAUDE.md <noscript> rule: rendered
          from inside the component so the SSR'd HTML carries the
          hashed class names. The prerendered chrome already works
          JS-less; the one thing to fix is the entrance fade — no-JS
          visitors should get the content instantly, not after a
          480ms animation. suppressHydrationWarning: browsers parse
          live <noscript> children as a text node, so its innerHTML
          never matches what renderToString emitted. */}
      <noscript
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html:
            `<style>.${s.header},.${s.hero},.${s.door},.${s.socials}{animation:none}</style>`,
        }}
      />
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
