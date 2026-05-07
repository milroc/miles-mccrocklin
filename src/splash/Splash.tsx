// Splash page chrome. SSR-safe: no browser-API imports, no lightning,
// no react-globe.gl. Renders the full static end-state visible to
// crawlers, no-JS users, and prefers-reduced-motion users.
//
// The reveal animation (lightning strikes + globe mount) is layered on
// top by src/splash/effects.tsx after hydration, via dynamic import
// triggered from a useEffect — guaranteed to run after React commits
// the DOM in both dev (createRoot) and prod (hydrateRoot).
//
// Architecture rule (locked in /plan-eng-review):
//   SSR renders the chrome. Client layers the effects on top.
//
// Wordmark renders with the same style register as the resume's
// Header.name: Georgia 300, "M^c" superscript, syllable-styled "mil"
// and "roc" spans. Only the color register changes (cream on dark mat
// instead of ink on cream paper).

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
import { Masonry, type MasonryItem } from '../media/Masonry';
import { CodeChips } from './CodeChips';
import { Terminal } from './Terminal';
import {PORTFOLIO} from '../me';
import './splash-globals.css';
import s from './Splash.module.css';

// Socials — same set the resume Header renders, but icons-only on the
// splash for a tighter editorial register. URLs hardcoded for the same
// reason as SPLASH_NAME below: keep the splash bundle from importing
// data/resume.json and dragging all the prose into a chrome-only entry.
// Source of truth lives in data/resume.json contact_information; if a
// handle changes, update both places.
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

// Photographer tile content — Miles's wildlife, landscape, and travel
// shots. Order mirrors data/resume.json: first the curated personal
// shots from `summary_media.items` (skipping the work-related fact-
// checking summit photos and the badge post), then the sabbatical
// travel set in the order it appears under the Travel & Wildlife
// Photography track. Earlier items render larger via the masonry's
// graduated size profile.
const PHOTOGRAPHER_GRID: ReadonlyArray<MasonryItem> = [
  // From the Travel & Wildlife Photography era media (sabbatical-travel)
  { src: '/media/sabbatical-travel/travel-11.jpeg', alt: 'Motherland, Yerevan, Armenia',                aspect: 0.6664 },
  { src: '/media/sabbatical-travel/travel-09.jpeg', alt: 'Emperor penguins reuniting, Antarctica',      aspect: 1.5006 },
  { src: '/media/sabbatical-travel/travel-27.jpeg', alt: '100% sunrise, Salar de Uyuni, Bolivia',       aspect: 1.5003 },
  // { src: '/media/sabbatical-travel/travel-06.jpeg', alt: 'Baby iceberg, Antarctica',                    aspect: 0.6664 },
  { src: '/media/sabbatical-travel/travel-15.jpeg', alt: 'Lone penguin trek, Antarctica',               aspect: 1.5006 },
  { src: '/media/sabbatical-travel/travel-24.jpeg', alt: 'Splash!, Sydney, Australia',                  aspect: 0.7998 },
  { src: '/media/sabbatical-travel/travel-08.jpeg', alt: 'Machu Picchu, Peru',                          aspect: 1.7778 },
  // { src: '/media/sabbatical-travel/travel-05.jpeg', alt: 'A journey, Lake Nakuru, Kenya',               aspect: 1.5006 },
  { src: '/media/sabbatical-travel/travel-22.jpeg', alt: 'Silverback stare, Volcanoes National Park, Rwanda', aspect: 1.5003 },
  // { src: '/media/sabbatical-travel/travel-13.jpeg', alt: 'Pyramids, Antarctica',                        aspect: 1.5006 },
  // { src: '/media/sabbatical-travel/travel-04.jpeg', alt: 'Rainy moment after a failed hunt, Nairobi National Park, Kenya', aspect: 1.7778 },
  // { src: '/media/sabbatical-travel/travel-10.jpeg', alt: 'Mother koala sheltering her baby, Sydney, Australia', aspect: 1.5006 },
  // { src: '/media/sabbatical-travel/travel-07.jpeg', alt: 'A plea, Jane Goodall Sanctuary, Ngamba Island, Uganda', aspect: 1.5006 },
  // { src: '/media/sabbatical-travel/travel-12.jpeg', alt: 'Parthenon, Athens, Greece',                   aspect: 1.5006 },
  { src: '/media/sabbatical-travel/travel-02.jpeg', alt: 'Team Labs Borderless, Tokyo, Japan',          aspect: 1.5006 },
  // { src: '/media/sabbatical-travel/travel-14.jpeg', alt: 'Cajon del Maipo, Chile',                      aspect: 1.5006 },
  // { src: '/media/sabbatical-travel/travel-16.jpeg', alt: 'Caving for Christmas, Mammoth Caves National Park, Kentucky', aspect: 1.7777 },
  // { src: '/media/sabbatical-travel/travel-17.jpeg', alt: "World's largest hummingbird, Santiago, Chile", aspect: 1.5003 },
  // { src: '/media/sabbatical-travel/travel-18.jpeg', alt: "Tourist's key to the temple, Abu Simbel, Egypt", aspect: 1.7716 },
  // { src: '/media/sabbatical-travel/travel-19.jpeg', alt: 'Neon nights, Tokyo, Japan',                   aspect: 1.7777 },
  // { src: '/media/sabbatical-travel/travel-20.jpeg', alt: 'The creation of sakura, Kyoto, Japan',        aspect: 1.7777 },
  // { src: '/media/sabbatical-travel/travel-21.jpeg', alt: 'Lobos del rio, Amazon Rainforest, Peru',      aspect: 1.5003 },
  // { src: '/media/sabbatical-travel/travel-23.jpeg', alt: 'Curious child, Volcanoes National Park, Rwanda', aspect: 1.5003 },
  // { src: '/media/sabbatical-travel/travel-25.jpeg', alt: "Darwin's finch, Galapagos Islands, Ecuador",  aspect: 1.5003 },
  // { src: '/media/sabbatical-travel/travel-28.jpeg', alt: 'Shadows in the sky, Dubai, UAE',              aspect: 1.5003 },
  // { src: '/media/sabbatical-travel/travel-26.jpeg', alt: 'Recursive reptiles, Galapagos Islands, Ecuador', aspect: 1.5003 },

    // From summary_media (curated leads)
  // { src: '/media/summary/egypt.jpg',                alt: 'Valley of the Kings, Luxor, Egypt',           aspect: 1.5002 },
  // { src: '/media/summary/antarctica.jpg',           alt: 'Submarine expedition, Antarctic Peninsula',   aspect: 1.3333 },
  // { src: '/media/summary/peru.jpg',                 alt: 'Machu Picchu, Peru',                          aspect: 1 },
  // { src: '/media/summary/redwoods.jpg',             alt: "Nature's skyscrapers, Redwood National Park", aspect: 0.6665 },
  // { src: '/media/summary/self_reflection.jpg',      alt: 'Self-reflection, Salar de Uyuni, Bolivia',    aspect: 0.6665 },
  // { src: '/media/summary/lemurs_madagascar.jpg',    alt: 'Lemurs saying hello, Kirindy Reserve, Madagascar', aspect: 0.75 },
  // { src: '/media/summary/bolivia.jpg',              alt: 'Salar de Uyuni, Bolivia',                     aspect: 0.6667 },

];

// Builder tile content. Aspect ratios sourced from data/resume.json
// where available; estimated for the LinkedIn-cover assets that don't
// appear in the resume's media. Estimates drive first paint; <Masonry>
// then refines via image-load measurement so cells match each image's
// real native aspect.
const BUILDER_GRID: ReadonlyArray<MasonryItem> = [
  // Misinformation product + the people behind it
  // {
  //   src: '/media/meta-misinformation/fact-check-ui-1.jpeg',
  //   alt: 'Fact-checked content on Facebook & Instagram',
  //   aspect: 1.0925,
  // },
  {
    src: '/media/meta-misinformation/fact-check-labels.jpg',
    alt: 'Misinformation warning labels — Facebook & Instagram surfaces',
    aspect: 1.5,
  },
  {
    src: '/media/summary/3PFC_LATAM_2019.jpg',
    alt: 'LATAM fact-checking partner roundtable, Buenos Aires 2019',
    aspect: 1.5,
  },

  // Forecast (Meta social prediction market)
  {
    src: '/media/meta-forecast/forecast-web.png',
    alt: 'Forecast — Meta social prediction market, public web app',
    aspect: 0.689,
  },
  {
    src: '/media/meta-forecast/Election_Forecasts.jpg',
    alt: 'Forecast — 2020 US election prediction markets',
    aspect: 1.5,
  },
  {
    src: '/media/meta-forecast/forecast-us-canada.jpeg',
    alt: 'Forecast — US/Canada prediction market view',
    aspect: 1.5,
  },

  // Forecast continued + LATAM team
  {
    src: '/media/meta-forecast/forecast-ui.png',
    alt: 'Forecast prediction-market social feed',
    aspect: 0.4618,
  },
  {
    src: '/media/meta-forecast/forecast-trading-flow.jpg',
    alt: 'Forecast — prediction market trading flow',
    aspect: 0.4605,
  },
  {
    src: '/media/summary/3PFC_LATAM_2019_TEAM.JPG',
    alt: 'Fact-checking partner summit team, Buenos Aires 2019',
    aspect: 1.9231,
  },

  // Bulletin / Pro Mode + leaving Meta
  // {
  //   src: '/media/meta-bulletin-promode/pro-mode-hero.jpeg',
  //   alt: 'Facebook Professional Mode for Creators',
  //   aspect: 1.7778,
  // },
  // {
  //   src: '/media/meta-bulletin-promode/bulletin.jpeg',
  //   alt: 'Bulletin — newsletter platform for creators',
  //   aspect: 1.5,
  // },
  // {
  //   src: '/media/summary/badge_post-poster.jpg',
  //   alt: 'Leaving Meta after 10 years — badge post, Menlo Park 2024',
  //   aspect: 1.7778,
  // },

  // Earlier work + Forecast motion
  // {
  //   src: '/media/bluenose/bluenose-ui.gif',
  //   alt: 'Bluenose Analytics — customer success app',
  //   aspect: 1.8205,
  // },
  // {
  //   src: '/media/bluenose/bluenose-usage-visualization.png',
  //   alt: 'Bluenose Analytics — customer usage visualization',
  //   aspect: 1.8205,
  // },
  // {
  //   src: '/media/meta-forecast/forecast-trading-movement-poster.jpg',
  //   alt: 'Forecast — trading volume motion analysis',
  //   aspect: 1.7846,
  // },
];

// Wordmark uses the same name string as the resume's contact_information.name.
// Hardcoded here to keep the splash bundle from importing data/resume.json
// (which would pull all bullet/review prose into a chrome-only entry).
const SPLASH_NAME = 'Miles Kendrick McCrocklin';

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
        root.classList.add(s.revealed);
      }
    }, 4000);

    let cancelled = false;

    import('./effects')
      .then(({ runReveal, prewarmGlobe }) => {
        if (cancelled) return;
        // Fire-and-forget: kick off three.js + texture downloads in
        // parallel with the lightning reveal. Idempotent — when
        // mountGlobe runs after the storm, it awaits the same promise
        // and gets the cached state. Failures swallowed: mountGlobe's
        // own error path takes over if the prewarm rejected.
        void prewarmGlobe().catch(() => {});
        return runReveal(root);
      })
      .then(() => {
        clearTimeout(safetyTimer);
      })
      .catch((err: unknown) => {
        clearTimeout(safetyTimer);
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('Splash effects failed; showing end-state.', msg);
        if (root.classList.contains(s.revealing)) {
          root.classList.remove(s.revealing);
          root.classList.add(s.revealed);
        }
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

  // No-JS fallback: inline a <style> with hashed class names, sourced
  // from this same CSS Module. When JS runs, this stylesheet is parsed
  // but the classes are managed by effects.tsx. When JS is disabled,
  // these rules un-hide everything. <noscript> only renders its content
  // when scripts are disabled, so the styles activate cleanly.
  const noscriptCss = `
    .${s.revealing} .${s.wordmark},
    .${s.revealing} .${s.tile},
    .${s.revealing} .${s.socials},
    .${s.revealing} .${s.cta} {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
  `;

  return (
    <div
      className={`${s.root} ${s.revealing}`}
      data-splash-root="true"
      ref={rootRef}
    >
      <noscript>
        <style dangerouslySetInnerHTML={{ __html: noscriptCss }} />
      </noscript>

      <h1 className={s.wordmark}>
        {syllable(first, SYL.mil, 'mil')}{' '}
        <span className={s.last}>{renderLast(last)}</span>
      </h1>

      <div className={s.tiles}>
        <a
          className={s.tile}
          data-id="builder"
          href="/long-form/"
          aria-label="Builder — view resume"
        >
          <div className={s.tileVisual}>
            <Masonry items={BUILDER_GRID} imageClassName={s.builderImage} />
            <CodeChips />
            <Terminal />
            <div className={s.tileLabelOverlay}>
              <p className={s.tileLabel}>BUILDER</p>
              <p className={s.tileSublabel}>technologist</p>
              <p className={s.tileCta}>learn more →</p>
            </div>
          </div>
        </a>

        <a
          className={s.tile}
          data-id="photographer"
          href={PORTFOLIO}
          aria-label="Photographer — view resume"
        >
          <div className={s.tileVisual}>
            <Masonry items={PHOTOGRAPHER_GRID} imageClassName={s.photo} />
            <div className={s.tileLabelOverlay}>
              <p className={s.tileLabel}>PHOTOGRAPHER</p>
              <p className={s.tileSublabel}>artist</p>
              <p className={s.tileCta}>view portfolio →</p>
            </div>
          </div>
        </a>

        <a
          className={s.tile}
          data-id="explorer"
          href="/explorer/"
          aria-label="Explorer — fullscreen globe of every country I've been to"
        >
          <div className={s.tileVisual}>
            <div className={s.explorerContent}>
              <div className={s.globeMount} data-splash-globe-mount="true">
                <div className={s.globeStatic} aria-hidden="true" />
              </div>
            </div>
            <div className={s.tileLabelOverlay}>
              <p className={s.tileLabel}>EXPLORER</p>
              <p className={s.tileSublabel}>traveler</p>
              <p className={s.tileCta}>spin the globe →</p>
            </div>
          </div>
        </a>
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

      <a className={s.cta} href="/long-form/">
        learn more →
      </a>
    </div>
  );
}

