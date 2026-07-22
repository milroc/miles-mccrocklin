# TODOS

(No open items.)

## Done

- **Move splash grid curation from code to data** — completed on
  `feat/splash-globe-anchor`, 2026-07-22. Splash content now lives in
  `data/splash.json` (doors, tagline, continent count) with name,
  portrait, and socials derived from `data/me.json`'s
  `contact_information`; `scripts/build-splash-content.ts` regenerates
  `src/generated/splash-content.ts` on every build/dev boot. The
  bundle guard holds (me.json prose never enters the splash chunk) and
  the socials/name drift the 2026-07-22 reviewers flagged is
  structurally impossible now.
