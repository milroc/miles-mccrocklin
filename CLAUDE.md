# CLAUDE.md

## Module boundaries

**`src/` never imports from `scripts/`.** `scripts/` is build-time
tooling (Node/Bun-only APIs, LLM calls, sharp, network fetches) and
must never be reachable from a shipped bundle — one careless import
drags tooling into the client graph. The dependency arrow points one
way: `scripts/` may import from `src/` (build-time can see everything),
never the reverse. A data module both sides need lives in `src/`
(e.g. `src/utils/locations.ts`, the ISO-3166 country table) and the
scripts reach up to it.

## Design System

Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

In QA / design-review mode, flag any code that doesn't match `DESIGN.md`,
including the "Known Drift" section at the end (D-numbered items). All
are currently closed; treat any reopened or new drift as a gap to flag.

### One component per file, one CSS module per component

- **One React component per file.** A "component" is anything that
  returns JSX (named like `Foo`, used as `<Foo />`). Each one lives in
  its own `Foo.tsx`. Don't define a second JSX-returning function in
  the same file as `Foo` — extract it to its own `Bar.tsx` instead.
  Helper functions that don't return JSX (formatters, type guards,
  pure utilities scoped to one component) may stay in the same file
  as their only caller; if more than one component needs them, lift
  them into a sibling `foo-utils.ts`.
- **One CSS module per component.** `Foo.tsx` pairs with
  `Foo.module.css`. Don't reach into a sibling component's module
  from outside that component, and don't pile multiple components'
  selectors into one shared module. If two components genuinely need
  the same styling, extract the third component that owns them.
- **Class names in a module describe the component, not the
  component's role in some larger layout.** Inside `CountryPanel.module.css`,
  the outer element is `.root`, not `.panel` — the `panel` prefix is
  redundant because the module already scopes the name.
- **Pages compose components; they don't grow them.** When a page's
  `.tsx` file starts accumulating inline `function Foo(): JSX.Element`
  definitions, that's the signal to extract — see `src/explorer/` for
  the pattern (`Explorer.tsx` composes `Toolbar`, `LoadingGlobe`,
  `CountryPanel`, each with its own module).

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

### Typography note

Bullets and summaries wrap natively. A Knuth-Plass line-breaking
pipeline (`src/utils/kp.ts` + soft-hyphen pre-processing) previously
chose the breaks; it was removed in 2026-07 after instrumented
comparison showed near-zero visible difference from browser wrapping
at this measure (PR #49/#50 have the full record, including a rejected
justification experiment). Redaction anchors — the one piece of that
pipeline with content value — live on in
`src/primitives/RedactedText.tsx`.

## Editing resume prose

Whenever you touch prose inside `data/me.json` (summaries, bullets,
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

## Labels pipeline data

The photography labels pipeline is event-sourced. Authoritative state
lives in:

- `data/photography-labels/{ingest,ai,human,refined}/*.jsonl` — append-only
  event log. `human/` events are curator inputs that cannot be regenerated.
  `refined/` events are cached LLM outputs keyed by a fingerprint of their
  inputs; throwing them away forces a re-run (slow + costs tokens).
- `data/photography.json` + `data/photo-classifications.json` — deterministic
  outputs of `scripts/merge-labels.ts` applied to the event log above.

**Rule: any commit that touches the labels pipeline must include every
modified or new file under `data/photography-labels/` AND the regenerated
`data/photography.json` / `data/photo-classifications.json`.** Never leave
JSONL events untracked because they look like build artifacts — they are
the source of truth. Never commit a code change to the merge/manifest
scripts without also committing the regenerated JSON, so a fresh
checkout's render matches what the author saw.

This is intentionally crude (a git-tracked event log inside the app repo).
The plan is to move this to a more reliable storage layer later; until
then, the working tree IS the database.
