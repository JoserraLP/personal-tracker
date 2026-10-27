# ADR-095: Half-star ratings (issue #276)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #276 asks to be able
to give
**half stars**
in the personal ratings (movies, books, video
games, series and episodes). The
user's textual proposal:
"when pressing once, on the
3
for example, 3
stars would get marked, but if pressing again
on the
3, the
half would get marked and therefore
it would be
2.5".

The code's state before the change:

- The rating picker (the
  `ratingPickerHtml` and the
  `wireRatingAndGetValue` on
  the
  `js/ui.js`) offered 5 numeric
  buttons (1-5)
  with
  binary toggling:
  pressing
  the same
  value removed
  the rating
  (it went to
  0).
- The series
  episodes' stars (the
  `renderEpisodeRows`, the
  `applyEpisodeRowState` and the click
  handler in the
  `js/ui.js`)
  used a
  count
  of
  active
  stars (the
  `querySelectorAll(".is-active").length`)
  to decide
  the unmarking, a
  fragile logic that does not support
  the .5 values.
- The informative displays (the
  grid's cards from the
  `renderGrid` and the read-only
  profile from the
  `openReadOnlyModal`) painted the
  `"★".repeat(rating)`,
  which would truncate
  2.5 →
  "★★", losing the half.
- The
  `computeEpisodeAverageRating`
  (the
  `js/tv-progress.js`) discarded
  ratings
  < 1.
- The data model (the
  `item.rating`, the
  `episode.rating`)

  stores numbers;
  Firestore accepts floats with no
  schema changes.

## Decision

Allow ratings in 0.5 steps at all the personal-rating
points, centralizing the logic in the
`js/ui.js`:

1. **A uniform pressing
  cycle** (the
  main
  picker and the
  episodes'
  stars): on the same button N, the
  1st
  press → N, the
  2nd → N−0.5, the
  3rd → 0 (the
  removal
  keeps the previous
  undo).
  The
  N=1
  case also
  produces the
  0.5
  (a
  uniform
  cycle, no
  special
  branches).
2. **The half's display**: the affected button (the one of
  value N when the rating is N−0.5)
  paints with the
  `is-half`
  class, the same colors as the
  `is-active` (the theme variables of
  the
  `--ochre-spine` /
  `--ink`, with no extra
  overrides) and its content becomes
  "½". On the informative displays the new exported helper
  `ratingStarsHtml(rating)` paints the
  "★★½" (the
  U+00BD
  glyph, universal
  support).
3. **A central normalization**:
  a new private
  `normalizeRating(v)`
  = the
  `Math.round(v * 2) / 2`
  with the
  [0, 5]
  bounds, applied on the entry
  points (the
  picker and the episodes'
  stars) and on
  the
  displays.
  A
  per-button dynamic `aria-label`
  ("2,5 stars"
  on the
  half, "N
  stars"
  on the rest).
4. **The episodes'
  stars**: the click handler stops counting
  active
  stars and compares against the
  `item.watched`'s
  real
  rating (issue #136's pattern:
  derive from the data, never from the visual state).
  The
  `applyEpisodeRowState`
  also paints
  the
  `is-half`.
5. **The episodes' average**: the `computeEpisodeAverageRating`'s
  floor drops
  from
  1 to the
  0.5
  (the half stars count as a
  valid rating); the display's
  `toFixed(1)`
  was already compatible.
6. **The user manual**
  (the
  `docs/manual-de-usuario.md`, the
  AGENTS.md's rule 3):
  the sections 5.3, 11
  and 12 update with the new
  cycle and the "★★½" /
  2.5
  examples.

Rejected alternatives:

- **Skipping 0.5 in the N=1
  cycle**
  (1 → 0
  directly): an
  asymmetry depending on the button, more
  code
  branches and it breaks the cycle's uniformity.
- **A pseudo-element filling
  the half
  star**:
  more CSS and
  positioning, a
  bigger visual
  risk
  on the
  four theme
  modes; the
  "½"
  glyph
  is plain text with universal support.
- **A sliding/continuous
  picker** (the
  0.1-5):
  a much bigger interaction
  change, out of
  the issue's
  scope.

## Consequences

**Positive:**

- The user can express finer ratings
  (the
  2.5, the
  4.5...)
  with the minimal interaction change: one
  extra press
  on the same button.
- A centralized change:
  all the picker's consumers (the
  profiles, issue #21's pop-up
  rating window,
  the quick
  actions,
  the search)
  inherit the halves without
  being touched.
- The previous undo
  ("pressing again removes")
  stays as
  the third
  step of the cycle;
  no
  regression.
- The displays (the
  grid,
  the read-only profile) and the episodes'
  average correctly reflect
  the halves.

**Negative:**

- The cycle
  requires an extra press to remove a whole
  rating (3 presses instead of the 2); compensated by the
  uniformity and documented in the
  manual.
- The
  "½" glyph depends on the system
  font;
  the
  U+00BD has
  universal support
  on the project's
  fonts
  (documented
  on the ADR).

**Neutral:**

- It does not change the
  data schema nor the exports
  (the
  ICS, the
  backup): the
  rating keeps being a number.
- The ratings'
  sorting does not exist
  (the
  `js/sorting.js` does not sort
  by rating), so there are no changes there.

## Created/modified files

| File | Change |
|---------|--------|
| `js/ui.js` | **Modified**: `normalizeRating`, `ratingButtonAriaLabel`, `ratingStarsHtml` (new); `ratingPickerHtml` and `wireRatingAndGetValue` with halves and the N → N−0.5 → 0 cycle; `renderEpisodeRows`, `applyEpisodeRowState` and the episodes' stars' handler with `is-half`; `renderGrid` and `openReadOnlyModal` use `ratingStarsHtml` |
| `js/tv-progress.js` | **Modified**: the `computeEpisodeAverageRating`'s floor getting lowered 1 → 0.5 |
| `js/rating-modal.js` | **Modified**: the toast “Choose a rating (from 1 to 5 stars, with halves).” |
| `ocio/ocio.css` | **Modified**: `.rating-picker button.is-half`, `.episode-rating__star.is-half`; the grouped `[data-theme="black"]` selector expanded with `is-half` |
| `docs/manual-de-usuario.md` | **Modified**: the 5.3, 12 and 13.2 sections with the half-stars cycle |
| `docs/adr-095-medias-estrellas-valoracion.md` | **New**: this document |
| `js/config.js`, `index.html`, `service-worker.js` | **Modified**: the PWA's version bump `20260926` → `20260927` |
| `tasks/task-issue-276.json` | The task's task file (the status of `review` + the `pr` block when publishing) |

Related issue: #276
