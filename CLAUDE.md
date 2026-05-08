# CLAUDE.md

## Design System

Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

In QA / design-review mode, flag any code that doesn't match `DESIGN.md`,
including the "Known Drift" section (D1–D6) — those are the open gaps.

### CSS Modules

All component-scoped styles live in `*.module.css` files and are
imported as `import s from './Foo.module.css'`. Class names are hashed
by the bundler and applied via `className={s.foo}` (or
`` `${s.foo} ${s.bar}` `` for compound classes). The `.module.css`
suffix is what triggers Bun's CSS Modules transform.

Rules:

- **Default to CSS Modules.** Any new component CSS must live in a
  sibling `*.module.css` file. Don't add new selectors to
  `src/styles/globals.css` unless they're genuinely page-level (body,
  `:root` tokens, `@page` print rules).
- **Page-level globals are the only exception** — `:root` token
  definitions, `html`/`body` styling, `@keyframes` referenced from a
  module via `animation:`, and `@page`. Keep these in a global file
  next to the module (e.g. `splash-globals.css` next to
  `Splash.module.css`).
- **camelCase class names.** `.tileVisual`, not `.tile-visual` —
  CSS Modules expose them as JS object keys, and kebab-case requires
  bracket access (`s['tile-visual']`).
- **No string literals for hashed classes in TS.** Don't write
  `'splash-tile'` anywhere. If `effects.tsx` needs to query a
  component class, it imports the same module and uses
  `` `.${s.tile}` ``.
- **`data-*` attributes for cross-component hooks.** When a non-React
  consumer (an external script) needs to find an element inside a
  component, expose a `data-*` attribute (`data-splash-skip`), not a
  class. Class names are hashed; data attributes aren't.
- **`<noscript>` fallbacks** that need to reference hashed names must
  be rendered from inside the React component, with the class names
  templated in via `dangerouslySetInnerHTML` so SSR'd HTML carries the
  correct hashes.

### Custom typography pipeline

The `.bullets` block runs through a Knuth-Plass line breaker
(`vendor/kp.js`) plus a soft-hyphen pre-processor (`vendor/hyphenate.js`).
`.kp-line` is set to `display: inline; white-space: nowrap` on purpose.
Do not add `word-wrap`, `overflow-wrap`, or `hyphens` rules to `.bullets`
without reading the KP wrap logic — it will fight the line-breaker and
produce visible jitter.

## Editing resume prose

Whenever you touch prose inside `data/resume.json` (summaries, bullets,
taglines, captions, project descriptions, community details), run the
`/humanizer` skill against the result before writing. Specifically watch
for tells of AI-generated writing:

- **Spaced em-dashes (` — `).** Banned. Replace with a period, comma,
  colon, parens, or by rewriting the sentence so the break isn't needed.
  Vary the replacement so the prose doesn't read as a one-tic-for-another
  swap.
- The full Wikipedia "Signs of AI writing" list: "It's not just X, it's
  Y" framing; promo verbs (delve, leverage, robust, meticulous,
  seamless); triadic asyndeton; inflated symbolism; etc. The
  `/humanizer` skill enumerates them and is the canonical reference.

The applies to text fields the user authored *and* to anything you draft
inline (project descriptions, image captions, summary lines). It does
NOT apply to structured fields (dates, urls, paths, tags) or to media
filenames.
