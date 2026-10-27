# ADR-063: Episodes' average rating in the series profile (issue #80)

## Status
Accepted

## Date
2026-08-09

## Context

Issue #80 asks that, in series, next to the overall rating the user
gives the series, the **average rating of all rated episodes** be shown,
with one decimal (e.g. «Media episodios: 4.2»).
Un-rated episodes **do not count**: an episode's rating can
never be 0, the minimum is 1. If there is no rated episode, the average
**is not shown** (neither a 0 nor a misleading text).

Before this decision, the series detail modal (`openTvModal` in
`js/ui.js`) showed the series' rating picker
(`ratingPickerHtml(item.rating)`) with no aggregate data about the
episodes' ratings, even though the data already existed in
`item.watched` (shaped `{ "season": { "episode": { date,
rating: 1-5|null } } }`, normalized with `normalizeEntry` in
`js/tv-progress.js`). Since `persistWatched` (`js/modal-handlers.js`)
mutates `item.watched` in memory, the average could be computed and
**updated live** when rating/un-rating or marking/un-marking episodes,
without persisting anything new to Firestore.

The implementation is **validated (QA PASS)** and **security-scanned
(PASS)** on this branch
(`feature/issue-80-valoracion-media-series`), with a later fix forcing
the hiding via CSS (`[hidden]` respected, see point 4) and
fixing the tooltip's grammar (singular/plural); the user manual was
updated in the same task (`docs/manual-de-usuario.md` §9 and §10,
AGENTS.md's rule 3). This ADR documents the decision retrospectively,
like the recent ones (ADR-059, ADR-060, ADR-061, ADR-062).

Related issue: #80 — https://github.com/gonzalitojh/personal-tracker/issues/80

## Decision

Show «Media episodios: X.X» (one decimal) next to the series' rating
picker, computed **only** over episodes with a valid rating
(1-5), hidden when there is no average and updated **live**
from `item.watched` as the single source of truth. The decision is
organized in five layers: pure computation function, modal render,
live update, CSS and versioning.

### 1. Pure function `computeEpisodeAverageRating(watched)` (`js/tv-progress.js`)

```js
export function computeEpisodeAverageRating(watched) {
  // → null | { count, average } with average UNROUNDED (total/count)
}
```

- It walks `Object.values(watched || {})` (season maps; non-objects are
  ignored) and, inside, each episode normalized with
  `normalizeEntry` (legacy entries included).
- **Strict exclusion**: an episode only counts if its `rating` is a
  finite number (`Number.isFinite`) **and** is within `1..5`. A watched
  episode without a rating (`rating: null`) never enters the average — it
  is not penalized as a 0. The episode rating's minimum is 1.
- It returns `null` if `count === 0` (no rated episodes) and, if not,
  `{ count, average }` with the average **unrounded** (rounding to one
  decimal is presentation only, in `js/ui.js`).

### 2. Render in the series modal (`js/ui.js`)

- **`ratingPickerHtml(rating, idPrefix = "field-rating", extraHtml = "")`**:
  a new optional third parameter injected at the end of the
  `.field-group` (after the stars div). It is **backwards compatible**:
  the 3 previous uses (the pop-up rating window, the movie/book modal,
  etc.) do not pass `extraHtml` and their output is identical.
- **`episodeAverageHtml(watched, idPrefix)`** (private helper): generates
  the average's span:
  - With average: `<span class="episode-average" id="{idPrefix}-episode-average" title="Media de N episodios valorados">Media episodios: <strong>X.X</strong></span>` (a tooltip with singular/plural: «1 episodio valorado» / «N episodios valorados»).
  - Without average: the same span but **`hidden`** and empty (a
    placeholder that point 3's closure updates).
- In `openTvModal` the picker becomes `ratingPickerHtml(item.rating,
  "field-rating", episodeAverageHtml(item.watched, "field-rating"))`. It is
  only used in the **series** modal: movies and books do not show the
  average (they have no episodes).

### 3. Live update: the `updateEpisodeAverage()` closure

Inside `openTvModal`, after the render, `updateEpisodeAverage()` recomputes
`computeEpisodeAverageRating(item.watched)` and updates the
`#field-rating-episode-average` span:

- `el.hidden = !avg` (shows/hides).
- With average: `title` («Media de N episodios valorados», singular/plural)
  and `innerHTML` with `avg.average.toFixed(1)` (one decimal on display).
- Without average: `title` and `textContent` empty — defense in depth: if
  the CSS ever stopped respecting the `[hidden]` for any reason, no stale
  text remains visible.

It is invoked after **the three paths** that mutate `item.watched`:

1. **Episode checkbox** (`onSetEpisodeDate`): the painting derives
   from `item.watched` (not from the pressed checkbox), so it also
   reflects a possible «Undo» of the pop-up rating window
   (issue #136's pattern) — undoing an un-mark leaves
   `rating: null` and the average is recomputed likewise.
2. **Episode stars** (`onSetEpisodeRating`): rating
   (`newValue`) or **removing the rating** (`value === currentlyActive →
   null`).
3. **Season's «Marcar todo» / «Desmarcar todo»**
   (`onToggleSeason`): on un-marking, the active stars are cleared and
   the average is recomputed (unrated episodes do not alter it).

### 4. CSS (`ocio/ocio.css`)

- `.episode-average`: `display: block`, `margin-top: 0.4rem`, a mono
  font (`var(--font-mono)`), `0.75rem`, color `--ink-soft` and
  `<strong>` in `--ink` — relative measures in `rem` (AGENTS.md's
  responsiveness criterion / ADR-026); short text that does not provoke
  horizontal scroll.
- **`.episode-average[hidden] { display: none; }`**: an explicit rule
  is needed because the class's `display: block` would beat the
  browser `[hidden]`'s `display: none` (author styles beat
  user-agent styles). Without this rule, the hidden span
  would stay visible — it was the QA review's fix.

### 5. Data and versioning

- **No new persistence**: the average is not stored in Firestore; it
  always derives from `item.watched` (mutated in memory by
  `persistWatched` in `js/modal-handlers.js`), the single source of
  truth. There are no new fields nor collections in the data model.
- **PWA bump `20260835` → `20260836`**: the PR touches `js/ui.js` and
  `js/tv-progress.js`, both precached by the service worker
  (ADR-019), so the one-bump-per-PR practice is applied
  (ADR-049/059/061) via `scripts/bump-version.sh`: `js/config.js`
  (`APP_VERSION = '20260836'`), `index.html` (`?v=` ×3: `styles.css`,
  `ocio.css`, `app.js`) and `service-worker.js` (`?v=` ×6 in
  `STATIC_ASSETS`).

## Rejected alternatives

- **Showing `0` or «—» when there are no rated episodes**: rejected —
  it is the issue's explicit acceptance criterion: with no rated
  episodes the average is not shown. A "0" would be misleading and
  contradictory with the episode rating's semantics (minimum
  1, never 0).
- **Computing the average only of watched episodes with a date**:
  rejected — the issue asks for the average of the *rated* episodes;
  a watched episode without a rating (`rating: null`) must not penalize
  the average as a 0. Excluding it keeps the average faithful to the user's
  scores.
- **Reusing TMDB's `.community-rating` style (ADR-005/ADR-031)**:
  rejected — that badge communicates a *community* score with the
  «TMDB» label; the episodes' average is the user's *personal*
  score, with different semantics. Also the issue asks for a text («Media
  episodios: X.X») next to the picker, not a compact badge in the
  episodes list.
- **Persisting the average in Firestore** (a derived field in the series'
  document): rejected — it would be redundant and unsynchronizable
  data: `item.watched` is already the source of truth in memory and in
  the DB, and every episode write would force recomputing/validating
  the field with no observable benefit.
- **Showing the average also in movies and books**: rejected — the
  issue is exclusive to series; movies and books have no episodes,
  and their modal does not touch `item.watched`.

## Consequences

### Positive

- **Issue #80 solved**: the series' profile shows the rated episodes'
  average next to the overall rating, with one decimal
  (acceptance criterion 1).
- **Accurate computation, rounding only on display**: the average is
  computed unrounded (`total/count`) and only formatted with
  `toFixed(1)` when painted; the tooltip reports the number of counting
  episodes.
- **Live update without reloading** for the three paths that mutate
  `item.watched` (rate, un-rate, mark/un-mark all),
  **including the pop-up window's undo** (issue #136), because all the
  painting derives from `item.watched` — not from the event that caused
  it.
- **Independent of expanded seasons and TMDB**: the average computes
  directly over `item.watched`; manual series
  (without TMDB data) also benefit, and it does not depend on which
  seasons the user has expanded in the modal.
- **Backwards compatibility**: `ratingPickerHtml` keeps its signature and
  output for the 3 previous uses; the default empty `extraHtml` does not
  alter any existing render.
- **Responsive verified**: the span uses `rem` units and short text;
  no horizontal scroll on mobile (~360 px), tablet (~768 px) and
  computer (~1280 px) (acceptance criterion 6).
- **No data model changes**: nothing new is persisted in
  Firestore.

### Negative / Risks

- **The average may not match the series' overall rating**: a user can
  rate the series with 5 stars and its episodes with 3; both scores
  coexist with different meanings. It is the behavior requested by the
  issue, and the tooltip with the count helps interpret the average.
- **High average with few rated episodes**: by excluding the unrated,
  a single episode with 5 stars shows «Media episodios: 5.0». The
  tooltip («Media de 1 episodio valorado») mitigates the ambiguity; it is
  coherent with acceptance criterion 2.
- **Singular/plural formatting duplicated**: the «1 episodio
  valorado / N episodios valorados» string is generated in two places
  (`episodeAverageHtml` and `updateEpisodeAverage`); it is a single short
  string, accepted for simplicity (the initial render does not reuse the
  closure, which is defined afterwards).

### Neutral

- **Routine PWA bump**: `20260835` → `20260836`, one bump per PR
  (ADR-049/059/061), applied with `scripts/bump-version.sh`, for touching
  precached assets (`js/ui.js`, `js/tv-progress.js`, ADR-019).
- **Explicit `[hidden]` CSS rule**: needed because of
  `.episode-average`'s `display: block`; documented in the CSS itself so
  it is not removed by cleanup.
- **User manual up to date** (§9 and §10: the «Media episodios: 4.2»
  format, only rated episodes count, minimum 1, hidden without an
  average, updates itself when rating/un-rating/un-marking) — AGENTS.md's
  rule 3.

## Created/modified files

| File | Change |
|---------|--------|
| `js/tv-progress.js` | **Modified**: new pure function `computeEpisodeAverageRating(watched)` → `null` \| `{ count, average }` (an unrounded average); walks `item.watched` with `normalizeEntry` and excludes non-finite or out-of-`1..5` ratings |
| `js/ui.js` | **Modified**: `ratingPickerHtml` with an optional 3rd parameter `extraHtml = ""` (backwards compatible, the 3 previous uses intact); private helpers `episodeAverageHtml(watched, idPrefix)` (the `#field-rating-episode-average` span, `hidden` without an average, singular/plural tooltip) and closure `updateEpisodeAverage()` (hidden/title/innerHTML from `item.watched`); invoked after the episode checkbox (including issue #136's undo), episode stars and «Marcar todo/Desmarcar todo»; used in `openTvModal` (series only) |
| `ocio/ocio.css` | **Modified**: the `.episode-average` class (block, mono 0.75rem, `--ink-soft`, `<strong>` in `--ink`, margins in `rem`) and `.episode-average[hidden] { display: none; }` (the `display:block` would beat the browser's `[hidden]`) |
| `docs/manual-de-usuario.md` | **Modified**: §9 and §10 document the «Media episodios: X.X» (only rated episodes, minimum 1, hidden without an average, updates live) — AGENTS.md's rule 3 |
| `js/config.js` | **Modified**: `APP_VERSION` `20260835` → `20260836` |
| `index.html` | **Modified**: bump `?v=20260835` → `?v=20260836` (×3: `styles.css`, `ocio.css`, `app.js`) |
| `service-worker.js` | **Modified**: bump `?v=20260835` → `?v=20260836` on the 6 versioned assets of `STATIC_ASSETS` (via `scripts/bump-version.sh`) |
| `docs/adr-063-valoracion-media-episodios.md` | **New**: this document |

Related issue: #80 — https://github.com/gonzalitojh/personal-tracker/issues/80
