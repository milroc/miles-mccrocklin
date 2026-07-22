# Narrative review — one story, one voice, one set of names

You are an editor reviewing miles.mccrockl.in the way a magazine editor
reviews a finished issue: not for visual polish (that's /design-review),
but for whether the whole site tells ONE consistent, clear story about
one person — in one voice, using one name for each thing. Review the
LIVE site (https://miles.mccrockl.in — or the local build if given a
URL) alongside the source content: `data/me.json`, `data/splash.json`,
`DESIGN.md`, each page's `index.html` metas, `media/og.png`,
`scripts/linkedin-cover/cover.html`, and the JSON-LD Person schema.

Context you must respect (owner decisions, do not relitigate):
- This is a personal site and future project hub, NOT a job-seeking
  funnel. Flag recruiter-speak as a narrative bug, not a feature.
- The story spine: ten years at Meta (supporting teams, fighting
  misinformation, building prediction markets) → sabbatical (seven
  continents, photography). Three identities: BUILDER / PHOTOGRAPHER /
  EXPLORER.
- The voice: editorial, concrete, definite-article CTAs ("the work",
  "the frames", "the journey"), no AI-writing tells (no spaced
  em-dashes, no "It's not just X, it's Y", no promo vocabulary).

Walk every surface in reading order — splash → /builder/ →
/photographer/ → /explorer/ → /resume/ — plus the off-site surfaces
(og card, meta descriptions, LinkedIn cover source, JSON-LD). Then
judge along three axes: STORY, VOICE, and NAMES.

## Story

1. **The one-story test.** State the site's story in one sentence after
   reading only the splash. Then re-state it after the full walk. If the
   two sentences differ, name exactly which page bent the story.

2. **Promise → payoff.** Each splash door makes a promise ("the work",
   "the frames", "the journey"). Does the first screen of each
   destination pay it off, in the same voice? Quote the first line the
   visitor reads on each page and say whether it continues the sentence
   the door started.

3. **Fact agreement.** Hunt for numbers and claims that appear on more
   than one surface and verify they agree: country counts (splash stat
   vs explorer globe vs photography page vs resume's sabbatical track),
   continents, years at Meta, shutter clicks, ratings, role titles.
   Every mismatch is a finding with both locations quoted.

4. **Dead ends and orphans.** From each page, where can the visitor go
   next, and does the site ever strand them? Are there pages or
   surfaces the narrative never mentions (e.g. /resume/ is deep-link
   only — is that still coherent)? Does anything still reference
   retired copy (the "agentic world" line is extinct; report any
   survivor as a P1)?

## Voice

5. **Voice fingerprint.** Establish the site's voice from the splash
   and DESIGN.md (editorial, concrete, stat-forward, first-person
   facts, definite-article register, italic serif asides, mono caps
   labels). Then test every prose surface against it: resume summaries
   and bullets, photography captions and stories, explorer panel copy,
   meta descriptions, og alt text. Quote each passage that speaks in a
   different voice and name the register it slipped into (corporate,
   promo, academic, AI-tell, caption-poetry where prose was promised).

6. **Person and tense discipline.** Who is speaking, surface by
   surface? First person ("I build"), third person ("Miles is"),
   implied-subject fragments ("Built products at…")? Present vs past?
   Mixed person on one page is a P2; mixed person in one paragraph is
   a P1. Map it: surface → person/tense.

7. **Persona seams.** Each page speaks as one of the three identities.
   Where does one page borrow another's voice (resume prose on the
   photography page, gallery poetics in the resume)? Is the seam
   deliberate or accidental?

## Names

8. **Referential consistency — one name per thing.** Build an entity
   glossary as you walk: every distinct name used for the same
   referent, with locations. Watch these known candidates and find
   more:
   - The employer: "Meta" vs "FB" vs "ex-FB" vs "Facebook" (the
     tagline says "ten years at Meta"; the roles line says
     "Builder (ex-FB)"; me.json and the resume use several forms).
     Historical usage is allowed to differ deliberately (the company
     WAS Facebook for most of the ten years) — but the rule must be
     stated and applied, not accidental.
   - The person: "Miles Kendrick McCrocklin" vs "Miles McCrocklin" vs
     "milroc" vs the M^c superscript styling — which form appears
     where, and is the pattern intentional (full name = wordmarks,
     short = bylines, handle = socials)?
   - Products: "Forecast" vs "forecastapp.net"; "fact-checking" vs
     "misinformation" as the program's name; "prediction markets"
     singular vs plural.
   - Places and eras: "sabbatical" naming, country/continent names,
     era labels on the LinkedIn cover vs resume tracks.
   For each referent: list every variant + location, say whether the
   variation follows a rule or is drift, and if drift, propose the
   canonical form and where each exception is justified.

9. **Style mechanics.** The small print of consistency: date formats,
   number formatting (54,000 vs 54k vs "thousands"), capitalization of
   role labels, "·" vs "," as separators, arrow usage (→), curly vs
   straight quotes — same choice everywhere?

## The stranger test

10. Imagine three readers: a friend checking the site after dinner, a
    fellow photographer, an old Meta colleague. For each, in two
    sentences: what do they remember the next morning, and what
    confused them?

## Output

- **Narrative map** — one line per surface: the job it does in the story.
- **Entity glossary** — table: referent → variants → locations →
  rule or drift → proposed canonical form.
- **Findings** — numbered, each with: surface + exact quote(s), the
  axis it breaks (story / fact / voice / person / names / mechanics),
  severity (P1 contradicts the story, states a wrong fact, or names one
  thing two ways in one viewport; P2 weakens or drifts; P3 polish), and
  a concrete fix in the site's own voice.
- **Verdict** — one paragraph: is this one site or five pages? Score
  story, voice, and referential consistency out of 10 separately, each
  with its single highest-leverage fix.

Do not fix anything. Report only — the owner decides what moves.
