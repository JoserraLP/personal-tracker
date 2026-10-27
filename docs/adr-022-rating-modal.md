# ADR-022: Pop-up rating window (rating modal)

## Status
Accepted

## Date
August 2026

## Context

When marking a series episode, a movie or a book as watched/read, the user
had to wait to open the item's profile to assign their personal rating
(1 to 5 stars). In series, per-episode rating was only editable from the
expanded episode itself, and there was noreminder inviting the user to rate
at the moment of marking.

Issue #21 asked for a **pop-up rating window**: when marking an item as
watched/read, a floating window unfolds showing the community rating and
allows saving the personal rating without leaving the current context.
Behavioral requirements:

- The window opens when marking a series episode, a movie or a book as
  watched/read.
- For series, the community score shown must be **the episode's** (via
  TMDB), not the series'.
- Marking an **entire season** does NOT open the window (mass action, not
  individual).
- The user can save their 1-to-5-star rating, or dismiss the window
  without saving.

In addition, the window must work both from the detail modal (which stays
open underneath) and from quick actions (list button and swipe), where
there is no modal behind.

Related issue: #21 — https://github.com/gonzalitojh/Registro-personal/issues/21

## Decision

Implement the rating window as a **second overlapping modal** with a new
module (`js/rating-modal.js`) and hook points in the persistence layer
(`modal-handlers.js` and `quick-actions.js`), without touching `ui.js`.

### 1. Second overlapping modal, not content replacement

A static frame `#rating-modal` was added in `index.html`, sibling of the
existing detail modal `#item-modal`:

- `#item-modal` keeps `z-index: 50` (class `.modal`).
- `#rating-modal` uses the new class `.modal--top` with `z-index: 70`, so
  it overlaps the detail modal without replacing its content: when the
  rating window closes, the item's profile remains open and keeps its
  state (without re-rendering).
- The frame reuses the existing modal pattern: backdrop, close button
  (✕), `role="dialog" aria-modal="true"`, trapped focus (`trapFocus` from
  `focus-utils.js`) and focus restoration to the previous element after
  closing.
- The card uses `.modal__card--small` (narrower) and is marked
  `aria-label="Valorar ítem"`.

### 2. New module `js/rating-modal.js`

The module's API is a single promise-based opening function:

```
openRatingModal({ type, title, coverUrl, episodeLabel, communityRating,
                  communityLabel, initialRating, onSave })
  => Promise<number|null>
```

- The promise **resolves with the saved rating (1-5)** or with `null` if
  the window was dismissed (✕, backdrop or "Ahora no").
- **Never rejects**: `onSave` errors are notified with a toast ("No se
  pudo guardar la valoración: …") and the window stays open to retry; the
  "Guardar valoración" button is disabled while saving and re-enabled on
  failure.
- The close listeners (✕ and backdrop) are registered **only once at
  module level** (the frame is static in `index.html`), not on each open;
  `closeRatingModal()` is exported so the global Escape handler (in
  `modal-handlers.js`) can close it with priority. Closing is idempotent
  (single `currentClose` + `settled` guard).
- Content is rendered inside `#rating-modal-content` on each opening:
  header with cover/title/episode line (`episodeLabel`, e.g. `T1E3 ·
  Piloto`), community score line (same style
  `.modal-detail__ratings` / `.community-rating` as ADR-005) and the star
  picker.

### 3. Hook points in the persistence layer

The window opens from the handlers that already persist the marking, in
`modal-handlers.js` (detail modal) and `quick-actions.js` (list button
and swipe), **not from `ui.js`** (which still knows nothing about the
window):

- **Movie** (`onAddWatch`): `maybeOpenItemRatingWindow(item, ctx, "movie")`
  after persisting the watch.
- **Book** (`onFinishReading`): `maybeOpenItemRatingWindow(item, ctx,
  "book")` **only when finishing** the reading (not when starting it); in
  quick actions, `quickMarkBook` applies the same rule (`isReading`).
- **Series, episode** (`onSetEpisodeDate`): `maybeOpenEpisodeRatingWindow`
  only in the transition **not-watched → watched** (`!wasWatched &&
  dateOrNull`); un-marking an episode or re-marking it does not reopen the
  window. In quick actions, `quickMarkTv` does the equivalent after
  `saveTvProgress`.
- **Entire season** (`onToggleSeason`): **does NOT open the window**; it
  is a mass action and individual rating makes no sense in that context.
- All wrappers are in `try/catch` and never throw: if something fails, the
  already-persisted marking remains intact.

### 4. Episode community rating (TMDB)

`getSeasonEpisodes` (`js/api-movies.js`) now maps each episode with:

```
episodeRating: e.vote_count > 0 ? e.vote_average : null
```

(same `vote_count > 0` semantics as ADR-005, so that a 0 with no votes is
not treated as a real rating), and the results are cached in memory with a
24 h TTL under the key `season_{tvId}_{seasonNumber}` (same shared cache
as the watch providers).

The episode query is made **on demand** at the moment of opening the
window (`getSeasonEpisodes` + `find` by `episodeNumber`). If there is no
data —manual series (no `externalId`), episode with no votes or failed
fetch— the window still opens showing **"Sin puntuaciones"** (semantics
identical to ADR-005), with `communityLabel` "TMDB · episodio" when there
is a score.

### 5. Persistence of the user's rating

- **Movie / book**: `updateItem({ rating })` on the item's document —
  reuses the existing `rating` field of the model (1-5), no schema
  changes.
- **Series**: `watched[season][ep].rating` via `setEpisodeRating` +
  `persistWatched` (detail modal) or the full progress payload
  (`saveTvProgress` in quick actions), same as episode marking.
- The picker reuses `ratingPickerHtml` / `wireRatingAndGetValue` from
  `ui.js` with `idPrefix: "rm-rating"` to **avoid duplicate ids** with the
  detail modal (`#item-modal` stays open underneath, with its own star
  picker).
- In series, `initialRating` is read with `normalizeEntry` on the
  `watched` entry; in movies/books, from `item.rating`.

### 6. Books without community rating

Books have no `communityRating` in the model (there is no TMDB for
books), so the window shows **"Sin puntuaciones"** with the same
semantics as ADR-005. The Google Books rating is not added to the window
nor to the model: it is **out of scope** of issue #21.

### 7. Security: `safeCoverUrl` and `escapeHtml`

`js/rating-modal.js` includes a `safeCoverUrl(url)` helper that only
accepts `https:` or `data:image/` schemes (the repo's pattern for
placeholders, e.g. `PLACEHOLDER_COVER`); any other scheme
(`javascript:`, `data:text/html`, …) or invalid URL falls back to the
placeholder. All new interpolations (`src`, title, subtitle, labels) are
escaped with `escapeHtml` as defense in depth.

This **does not perpetuate the pre-existing pattern** of unsanitized
`coverUrl` in other interpolations (MEDIUM finding of the security scan);
the global fix of the pre-existing interpolations is left as a separate
ticket, out of this issue.

### 8. Toast above the window

The toast moved from `z-index: 60` to `z-index: 80` in `css/styles.css`,
so that save errors (and the "Elige una valoración…" notice) are visible
above the rating modal (z-index 70), which in turn covers the detail
modal (z-index 50).

## Rejected alternatives

- **Replacing the detail modal's content** (`#modal-content`): rejected:
  on closing the rating, the whole profile would have to be re-rendered,
  losing state (expanded tab, scroll) and mixing two responsibilities in
  a single modal. The second overlapping modal leaves the detail intact
  underneath.
- **Hooking the opening in `ui.js`** (where the marking is rendered):
  rejected: `ui.js` is pure rendering and knows nothing about
  persistence; the wrappers live in the layer that already persists
  (`modal-handlers.js` and `quick-actions.js`), where `ctx` and the state
  after persisting are available.
- **Opening the window also when marking an entire season**: rejected: it
  is a mass action; opening a rating window per episode would be annoying
  and pointless.
- **Showing the series' community score on episodes**: rejected: the
  issue's requirement is explicit — the score must be **the episode's**
  via TMDB.
- **Adding Google Books rating for books**: rejected due to scope: the
  books model has no `communityRating` and issue #21 does not ask for it;
  showing "Sin puntuaciones" is coherent with ADR-005.
- **Removing the window in quick actions**: rejected: the list button and
  the swipe are the main marking path on mobile; omitting the window
  there would make it invisible for the most common usage.
- **Using `innerHTML` without sanitizing the cover (pre-existing
  pattern)**: rejected for the new interpolations: `safeCoverUrl` +
  `escapeHtml` (defense in depth) were added without waiting for the
  global fix of the MEDIUM finding of the security scan.

## Consequences

### Positive
- The user rates at the moment of marking, without extra steps; the
  context (profile or list) stays intact underneath the window.
- Series show the community score **of the episode**, which is the
  relevant information when marking a specific episode.
- The window never blocks the flow: dismissable with ✕, backdrop or
  Escape (with priority over the detail modal), and save failures do not
  lose the already-persisted marking.
- No schema changes: movies/books reuse `rating`; series reuse
  `watched[season][ep].rating`; books without community show "Sin
  puntuaciones" without touching the model.
- The new interpolations are sanitized (`safeCoverUrl` + `escapeHtml`),
  closing the path of the MEDIUM finding for this component.

### Negative
- One additional TMDB request per episode marked in series (only the
  first time per season and day, thanks to the 24 h `season_*` cache); in
  manual series or on failures none is made.
- The user may feel interrupted if they mark several items in a row;
  mitigated because the window is dismissable in one gesture and "Ahora
  no" closes it without saving.
- Flow closing with double modal: Escape and focus require coordination
  (solved with the exported `closeRatingModal()` and the priority of the
  global handler in `modal-handlers.js`).

### Neutral
- `getSeasonEpisodes` now includes `episodeRating` and uses the shared
  cache with 24 h TTL; the rest of the function's consumers (season
  expansion) ignore the new field.
- The toast moves from `z-index` 60 to 80: it affects the global
  stacking, not just this window (toasts were already the highest element
  except the modals; now they are also above the rating window).
- `ui.js` stays intact: the picker is reused with `idPrefix` ("rm-rating")
  instead of duplicating it.

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **New frame** `#rating-modal` (`.modal--top`, `.modal__card--small`, backdrop, ✕, `#rating-modal-content`) next to `#item-modal` |
| `js/rating-modal.js` | **New**: `openRatingModal()` (Promise), `closeRatingModal()`, `safeCoverUrl`, `escapeHtml`, single close listeners, trapped/restored focus |
| `js/modal-handlers.js` | Wrappers `maybeOpenItemRatingWindow` (onAddWatch movie, onFinishReading book) and `maybeOpenEpisodeRatingWindow` (onSetEpisodeDate with `!wasWatched && dateOrNull`); `onToggleSeason` without window; Escape with priority for `closeRatingModal()` |
| `js/quick-actions.js` | Equivalent wrappers for quick actions (`quickMarkMovie`, `quickMarkBook` only on finish, `quickMarkTv` with on-demand `getSeasonEpisodes`) |
| `js/api-movies.js` | `getSeasonEpisodes`: new `episodeRating` (`vote_count > 0 ? vote_average : null`) and in-memory cache `season_{tvId}_{seasonNumber}` 24 h TTL |
| `css/styles.css` | `.modal--top` (z-index 70); `.toast` moves to z-index 80 (comment updated) |
| `service-worker.js` | `js/rating-modal.js` added to `STATIC_ASSETS` |

Related issue: #21 — https://github.com/gonzalitojh/Registro-personal/issues/21
