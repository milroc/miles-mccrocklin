# TODOS

## Move splash grid curation from code to data

**What:** Relocate the splash's hardcoded content — the door thumbnail
choices and the duplicated `SOCIALS` / `SPLASH_NAME` constants — into data
(`data/me.json` or a dedicated `data/splash.json`), while keeping the
bundle-size guard that motivated the hardcoding (the splash entry must not
drag all of me.json's prose into a chrome-only bundle). The old masonry
grid arrays this TODO originally targeted are deleted by the globe-anchor
redesign; what remains is one thumbnail per door plus the constants.

**Why:** Today "swap a splash image" is a code change, with commented-out lines
serving as the curation UI. Two independent design reviewers (2026-07-22)
flagged it as drift waiting to happen; a future PROJECTS door makes splash
edits more frequent.

**Context:** The globe-anchor splash redesign (see
`~/.gstack/projects/milroc-miles-mccrocklin/designs/splash-improve-20260721/splash-improve-design-plan-20260722.md`)
shrinks the door image lists to one image each, which makes this migration much
smaller than it was under the masonry layout.

**Depends on:** The globe-anchor splash redesign landing first.
