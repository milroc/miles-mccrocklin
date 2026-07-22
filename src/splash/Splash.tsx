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
// The reveal (chrome fade-in + desktop WebGL globe mount) is layered
// on by src/splash/effects.tsx after mount, via dynamic import from a
// useEffect. Mobile never mounts WebGL — the CSS <WireGlobe> is the
// shipped design, not a loading state (gate lives in effects.tsx,
// predicate in constants.ts).

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
import { VISITED_COUNTRY_COUNT } from '../generated/splash-stats';
import './splash-globals.css';
import s from './Splash.module.css';

// Socials — same set the resume Header renders, but icons-only on the
// splash for a tighter editorial register. URLs hardcoded for the same
// reason as SPLASH_NAME below: keep the splash bundle from importing
// data/me.json and dragging all the prose into a chrome-only entry.
// Source of truth lives in data/me.json contact_information; if a
// handle changes, update both places (tracked in TODOS.md).
const SOCIALS: ReadonlyArray<{
  id: string;
  href: string;
  Icon: typeof FaGithub;
  label: string;
}> = [
  { id: 'github',    href: 'https://github.com/milroc',                              Icon: FaGithub,    label: 'GitHub' },
  { id: 'linkedin',  href: 'https://www.linkedin.com/in/miles-mccrocklin-7b635127',  Icon: FaLinkedin,  label: 'LinkedIn' },
  { id: 'twitter',   href: 'https://twitter.com/Milr0c',                             Icon: FaXTwitter,  label: 'X (Twitter)' },
  { id: 'instagram', href: 'https://instagram.com/milroc',                           Icon: FaInstagram, label: 'Instagram' },
  { id: 'threads',   href: 'https://threads.com/@milroc',                            Icon: FaThreads,   label: 'Threads' },
  { id: 'email',     href: 'mailto:miles@mccrockl.in',                               Icon: FaEnvelope,  label: 'Email' },
];

// Door rows — one tight thumbnail each (a masonry collage at door size
// reads as mud; see the 2026-07 design review). Thumbnail curation is
// hardcoded for the bundle-guard reason above; TODOS.md tracks moving
// it to data.
const DOORS: ReadonlyArray<{
  id: string;
  href: string;
  thumb: string;
  label: string;
  sublabel: string;
  cta: string;
  aria: string;
}> = [
  {
    id: 'builder',
    href: '/builder/',
    thumb: '/media/meta-misinformation/fact-check-labels.jpg',
    label: 'BUILDER',
    sublabel: 'technologist',
    cta: 'view the resume →',
    aria: 'Builder — view resume',
  },
  {
    id: 'photographer',
    href: '/photographer/',
    thumb: '/media/sabbatical-travel/travel-09.jpeg',
    label: 'PHOTOGRAPHER',
    sublabel: 'artist',
    cta: 'view portfolio →',
    aria: 'Photographer — view the gallery',
  },
];

// Wordmark uses the same name string as the resume's contact_information.name.
// Hardcoded here to keep the splash bundle from importing data/me.json.
const SPLASH_NAME = 'Miles Kendrick McCrocklin';

// The placard's continent figure. journey.json has no continent field,
// so this can't be derived like VISITED_COUNTRY_COUNT is — it's
// hand-maintained (lifetime-true: all seven, Antarctica included).
const CONTINENT_COUNT = 7;

// Match Header.tsx's syllable wrapper. Unlike the resume version, the
// underline animation is dormant on splash (no handle links to drive it).
function syllable(str: string, sub: string, kind: 'mil' | 'roc'): ReactNode {
  const idx = str.toLowerCase().indexOf(sub.toLowerCase());
  if (idx === -1) return str;
  const sylClass = kind === 'mil' ? `${s.syl} ${s.sylMil}` : `${s.syl} ${s.sylRoc}`;
  return (
    <>
      {str.slice(0, idx)}
      <span className={sylClass}>{str.slice(idx, idx + sub.length)}</span>
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
      {prefix}<sup className={s.nameSup}>{smallCap}</sup>{syllable(rest!, SYL.roc, 'roc')}
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
        <h1 className={s.wordmark}>
          {syllable(first, SYL.mil, 'mil')}
          <br />
          <span className={s.last}>{renderLast(last)}</span>
        </h1>
        <p className={s.tagline}>
          Ten years at Meta fighting misinformation and building prediction
          markets. Now on sabbatical: seven continents, thousands of stories
          captured in frame.
        </p>
      </header>

      <a
        className={s.hero}
        href="/explorer/"
        aria-label="Explorer — fullscreen globe of every country I've been to"
      >
        <span className={s.globeBox} data-splash-globe-box="true">
          <span className={s.stat} aria-hidden="true">
            {VISITED_COUNTRY_COUNT} COUNTRIES
            <br />
            {CONTINENT_COUNT} CONTINENTS
          </span>
          <span className={s.wireLayer}>
            <WireGlobe />
          </span>
          <span className={s.globeMount} data-splash-globe-mount="true" />
        </span>
        <span className={s.heroDoor}>
          <span className={s.doorTitle}>
            <span className={s.doorLabel}>EXPLORER</span>
            <span className={s.doorSublabel}>traveler</span>
          </span>
          <span className={s.doorCta}>spin the globe →</span>
        </span>
      </a>

      <div className={s.doors}>
        {DOORS.map(({ id, href, thumb, label, sublabel, cta, aria }) => (
          <a key={id} className={s.door} data-id={id} href={href} aria-label={aria}>
            <img className={s.doorThumb} src={thumb} alt="" loading="lazy" />
            <span className={s.doorText}>
              <span className={s.doorTitle}>
                <span className={s.doorLabel}>{label}</span>
                <span className={s.doorSublabel}>{sublabel}</span>
              </span>
              <span className={s.doorCta}>{cta}</span>
            </span>
          </a>
        ))}
      </div>

      <nav className={s.socials} aria-label="Miles on the internet">
        {SOCIALS.map(({ id, href, Icon, label }) => (
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
        ))}
      </nav>
    </div>
  );
}
