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

## Linting

`bun run lint` runs [oxlint](https://oxc.rs) with the vendored
[anti-slop](https://github.com/dmmulroy/anti-slop) plugin
(`tools/oxlint/anti-slop/`, configured in `oxlint.config.ts`). The
plugin rejects low-evidence TypeScript: `unknown` parameters and
returns, `Record<string, unknown>` dictionaries, `typeof` narrowing
used in place of boundary parsing, type assertions without a `SAFETY:`
comment, and inferred types deliberately widened away.

The vendored plugin is ours to edit. If a rule is wrong for this
codebase, change the rule in `tools/oxlint/anti-slop/` and say why;
don't sprinkle `oxlint-disable` at the call site. The fixes the rules
want are real ones: parse at the I/O boundary into a named type, use
`satisfies` instead of a widening annotation, and write down the
invariant that makes an assertion safe.

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

## End-to-end tests

`bun run test:e2e` runs the Playwright suite in `e2e/`. It drives the
real UI: every page, every control, both viewports.

Three projects, defined in `playwright.config.ts`:

- **prod** — the default. Runs against `dist/` (built and served by
  `scripts/serve-dist.ts` on :4318), because that is the artifact that
  ships: prerendered splash markup, inlined photography manifest,
  `EDIT_ENABLED` compiled to `false`.
- **mobile** — `*.mobile.spec.ts`, iPhone 13 viewport + touch, on
  Chromium. Covers the responsive branches only (splash restack,
  bottom-sheet filters, masonry columns); this is not a cross-engine
  matrix.
- **dev** — `*.dev.spec.ts`, against `bun run dev` on :4317. Edit mode
  is the only feature that exists solely in the dev build.

Playwright starts and stops both servers itself. It does **not** reuse a
server already listening on those ports unless you set
`E2E_REUSE_SERVER=1` — reuse skips the `bun run build` step, and a stale
`dist/` graded as if it were current is worse than a slow run.

Writing specs here:

- **Select by role and accessible name.** CSS Modules hash every class,
  so `.locator('.tile')` cannot work. Where a role is not enough, use a
  `data-*` attribute (`[data-figure-card]`, `[data-splash-globe-box]`,
  `[data-id="builder"]`) and add one to the component if none fits.
- **Two surfaces hide their chrome when the pointer goes still** —
  Explorer's nav/toolbar/title after 3s, the media viewer's topbar and
  arrows after 1.2s — and the hidden plate stops taking pointer events.
  `clickIdleChrome` in `e2e/fixtures.ts` wakes the plate and presses it;
  the keyboard path is unaffected and is simpler where it exists.

  Pointer-clicking a *hidden* plate is racy in a way no helper fully
  fixes, so prefer not to. Waking is a React state change, and a
  mousedown queued behind an unrendered wake is hit-tested against
  `pointer-events: none` and lands on whatever sits underneath — the
  press disappears with no error. That is issue #79. Explorer's specs
  sidestep it by opening on `?country=ata`, which pins the chrome
  visible (the idle effect returns early while a country is selected)
  and makes an ordinary `click()` deterministic. Look for a state that
  pins the chrome before reaching for the helper.
- **A plate that fades also goes `aria-hidden`, so `getByRole` cannot
  see anything inside it.** Explorer's toolbar and nav both do this.
  A role locator against idle-hidden chrome resolves to zero elements
  and stays that way, which reads as "the button vanished" rather than
  as a selector problem — and it only shows up on a slow machine, where
  the idle delay elapses before the first assertion. Select those by
  attribute (`button[aria-label$="rotation"]`, `a[aria-label$="home"]`).
  Nothing is given up: a `<button>` carries the button role implicitly
  and `aria-label` is the accessible name.
- **The country index on /explorer/ is keyboard-only** by design
  (`clip-path: inset(50%)` under the globe canvas). Activate it with
  `.press('Enter')`; a mouse click can never reach it.
- **Globe specs fail rather than skip** when WebGL is unavailable.
  `requireLiveGlobe` used to skip; the config forces software rendering
  (`--use-angle=swiftshader`), which needs no GPU, and across every local
  and CI run that branch was never once taken. It was dead weight that
  could silently turn a dozen specs into no-ops behind a green check, so
  it is now a hard assertion carrying a message about what to try. The
  no-WebGL path is asserted deliberately instead, in
  `explorer-no-webgl.spec.ts`.
- **Record a known defect with `test.fail()`, never `test.fixme`.** A
  fixme skips: it sits in the output forever without checking anything,
  and nothing tells you when the bug is gone. `test.fail()` runs the
  spec, expects it to fail, and reports "expected to fail but passed"
  the day someone fixes it — at which point they delete the annotation.
  Put the call inside the test body; at describe scope it applies to
  every test in the file. Two specs do this today, both for issue #80.
  A `test.fail()` spec must fail *deterministically*, so pin down any
  race first — the focus one waits for the panel's search box to hold
  focus, because pressing Escape faster than TreeDropdown's
  requestAnimationFrame wins the race and the bug doesn't reproduce.
- **A spec blocked on an app bug that fails *intermittently* gets
  removed and filed, not annotated.** `test.fail()` needs a
  deterministic failure; a spec that passes four runs in five would
  report "expected to fail but passed" most of the time and teach
  everyone to ignore it. Delete it, and put the code verbatim on the
  issue with whatever you measured, so it goes back the day the bug
  does. `e2e/lightbox.spec.ts` carries a block comment naming the five
  navigation specs that left this way and why (#81); that comment is
  the coverage gap staying visible in the file rather than only in the
  tracker.
- **Every spec fails on an unexpected `console.error` or `pageerror`.**
  The fixture that does this is `{ auto: true }` — that flag is what
  makes it run at all, since no spec requests it by name. For a page
  that legitimately produces one (the 404 route logs its own status),
  declare it with `test.use({ expectedConsoleErrors: [...] })` at that
  spec, not by widening the global `IGNORED_CONSOLE`.
- **Assert the number the app computed, not a direction.** Each filter
  option carries its own photo count, rolled up by a different code path
  than the one that filters the wall, so `expect(resultCount).toBe(n)`
  cross-checks two independent computations. `toBeLessThanOrEqual` does
  not: a filter that does nothing satisfies it.
- **Locators re-resolve on every use.** Anything selected by a name that
  changes when clicked (a dropdown trigger that summarises its
  selection, a Translate button that becomes "Show original") must be
  pinned first — by index, by a stable label captured up front, or with
  `elementHandle()`. Several specs carry a comment where this bit.
- **`getByRole('article')` matches the resume page's own root**, and
  `getByRole` cannot see an `aria-hidden` subtree at all. Scope to a
  container, and remember that a control's absence from the role tree
  is sometimes the assertion (the gated photo tiles).
- **Not every figure card is a lightbox trigger.** `FigureCarousel`
  renders three copies of the strip, so two thirds of its cards are
  loop clones (`aria-hidden`, `tabIndex -1`), and any card whose centre
  falls in the masked edge zone carries `data-edge="true"` and centres
  itself on click instead of opening. Specs that want a real trigger
  use `[data-figure-card]:not([aria-hidden]):not([data-edge])`.

  The edge-click behaviour itself is deliberately **not** covered: the
  marker is recomputed from live geometry on every scroll, and
  Playwright scrolls a target into view before clicking it, which moves
  the card out of the zone under test. It resisted three approaches
  (locator click, pinned element handle, raw mouse coordinates) and a
  flaky spec here would be worse than none. Verify it by eye.
