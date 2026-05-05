# CLAUDE.md

## Design System

Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

In QA / design-review mode, flag any code that doesn't match `DESIGN.md`,
including the "Known Drift" section (D1–D6) — those are the open gaps.

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
