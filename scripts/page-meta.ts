// Person JSON-LD injection — the one piece of metadata that genuinely
// needs to be data-driven, because its `sameAs` array, `name`, `jobTitle`,
// and `image` all derive from data/me.json. Hardcoding the schema in the
// HTML would silently drift from me.json the next time a social profile
// is added.
//
// Everything else (OG/Twitter tags, favicons) lives directly in each
// page's source HTML — different values per page anyway, and dev/prod
// parity stays automatic. Only the schema is injected at build time.
//
// dev.ts does NOT call this — the Person schema is crawler-only metadata
// that dev users never see. To verify schema content locally, run
// `bun run build && grep ld+json dist/index.html`, or use Google's Rich
// Results Test against the deployed URL.
//
//   data/me.json
//      │
//      ▼
//   loadMe() ──▶ buildContext() ──▶ MeContext { contact, siteUrl, ... }
//                                    │
//                                    ▼
//                          renderPersonSchema()
//                                    │
//                                    ▼
//                          injectPersonSchema(html, segment)
//                                    │
//                                    ▼
//                          build.ts writes into dist/*.html (only on
//                          pages listed in PERSON_SCHEMA_PATHS)

import { readFileSync } from 'node:fs';
import type { Contact, Resume } from '../src/types';

// me.json's top-level schema is `Resume` in src/types.ts — that file is
// the single source of truth for the data's shape. Re-exported here as
// `Me` so callers don't read as if they're loading a resume.
export type Me = Resume;
export type { Contact };

export type MeContext = {
  me: Me;
  contact: Contact;
  siteUrl: string;
  addressLocality: string;
  addressRegion: string;
};

// URL path segments (relative to the site root) that receive a Person
// JSON-LD schema. /explorer/ and /photographer/ are intentionally
// excluded — their primary topic is the globe / the photography work,
// not the person.
export const PERSON_SCHEMA_PATHS = ['', 'builder/'] as const;
export type PersonSchemaPath = (typeof PERSON_SCHEMA_PATHS)[number];

export function loadMe(jsonPath = './data/me.json'): Me {
  return JSON.parse(readFileSync(jsonPath, 'utf8')) as Me;
}

export function buildContext(me: Me): MeContext {
  const contact = me.contact_information;
  const siteUrl = contact.website.endsWith('/')
    ? contact.website
    : contact.website + '/';
  const [addressLocality, addressRegion] = contact.address.split(', ');
  if (!addressLocality || !addressRegion) {
    throw new Error(`Unexpected address format in me.json: "${contact.address}"`);
  }
  return { me, contact, siteUrl, addressLocality, addressRegion };
}

// JSON-LD Person schema describing the canonical entity. Google uses this
// to populate knowledge-panel-style cards on personal-name searches.
export function renderPersonSchema(ctx: MeContext): string {
  const { me, contact, siteUrl, addressLocality, addressRegion } = ctx;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: contact.display_name,
    givenName: contact.given_name,
    familyName: contact.family_name,
    url: siteUrl,
    image: siteUrl + contact.portrait,
    jobTitle: contact.tagline,
    description: me.summary.split('. ')[0] + '.',
    address: {
      '@type': 'PostalAddress',
      addressLocality,
      addressRegion,
      addressCountry: 'US',
    },
    sameAs: [
      contact.linkedin,
      contact.github,
      contact.twitter,
      contact.instagram,
      contact.threads,
    ].filter(Boolean),
  };
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

// Inject the Person schema just before </head> in a raw HTML string.
// Fails loudly if </head> isn't found.
export function injectPersonSchema(html: string, ctx: MeContext): string {
  const tag = renderPersonSchema(ctx);
  const updated = html.replace('</head>', `${tag}</head>`);
  if (updated === html) {
    throw new Error('Person schema injection failed: </head> not found in HTML');
  }
  return updated;
}
