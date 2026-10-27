# ADR-020: Items without a release date are treated as unreleased (fix issue #27)

## Status
Accepted

## Date
August 2026

**Note (scope expanded by ADR-023):** this document describes the original fix for issue #27 (PR #33). After the issue's reopening —the `next_episode_to_air = null` case in series between seasons with no announced date (e.g. "Dune: La Profecía" S2)—, the scope defined here is **expanded/superseded** by [ADR-023](adr-023-episode-unreleased-no-date.md): the individual episode checkboxes, the season's "Marcar todo" button and the badge when TMDB does not return `next_episode_to_air` are NOW covered.

**Note (CSS classes renamed and uniform treatment by ADR-024):** after the 2nd reopening of issue #27 (uniform treatment at all levels: stripes, relegation to the end and the "Aún no estrenado/a" badge identical for items without a date and with a future date), the CSS classes cited in section 4 (`item-card--episode-unreleased` / `list-row--episode-unreleased`) were renamed to `item-card--unreleased` / `list-row--unreleased`, and the visual and sorting treatment now covers **any** unreleased item —movies included— via the unified predicate `isItemUnreleased`, not only series with an unaired episode. See [adr-024-unreleased-uniform-treatment.md](adr-024-unreleased-uniform-treatment.md).

## Context

TMDB returns an empty release date for movies/episodes without an official date, and `js/api-movies.js` normalizes it to `null` (`releaseDate: data.release_date || null`). The frontend handled the "not released" case with the pattern `if (fecha && fecha > todayISO())` at all mark-as-watched points: since `null` is falsy, an item without a date was considered **already released** and could be marked as watched **without any warning**, even though in reality it was not known whether it had come out.

Issue #27 establishes the criterion: **no release date ⇒ the item is assumed NOT released** ⇒ same treatment as a future date (cannot be marked as watched without confirmation).

The affected points were: item creation (`awaitingRelease` flag), marking as watched (movie modal and quick actions), series' unreleased next episode badge (`isNextEpisodeUnreleased`) and the daily backfill check.

Related issue: #27 — https://github.com/gonzalitojh/personal-tracker/issues/27

## Decision

Adopt a single centralized criterion: **an item without an official release date is treated the same as one with a future date (unreleased)**, with soft confirmation (`window.confirm`) when marking it as watched, the `awaitingRelease` flag on creation, and progressive backfill of existing items. Components:

### 1. `js/release.js` (new): single criterion and confirmation messages

Module that centralizes the "not released" logic:

- **`isUnreleasedDate(dateStr)`**: returns `true` if `!dateStr || dateStr > todayISO()` — that is, an empty/`null` date, or a future date (string comparison `YYYY-MM-DD`).
- **`unreleasedConfirmMessage(item)`**: returns the appropriate `window.confirm` message, or `null` if not applicable:
  - **Movies**: manual ⇒ `null` (no warning); released ⇒ `null`; with a future date ⇒ message with the date (text identical to the pre-existing one); **no date** ⇒ message «no tiene fecha de estreno oficial en TMDB; suponemos que aún no está estrenada».
  - **Series**: only if `nextEpisodeToAir` matches `nextEpisode` (same season and episode); future `airDate` ⇒ message with the date; `null` `airDate` ⇒ message without a date; other cases ⇒ `null`.
  - **Other types** ⇒ `null`.

### 2. Item creation (`js/search.js`, `js/modal-handlers.js`): `awaitingRelease` flag with an empty date

In `handleAdd` (`js/search.js`) and in `addSagaMovie`/`addFromRecommendation` (`js/modal-handlers.js`), movie/series creation now uses `details.<fecha> !== undefined && isUnreleasedDate(details.<fecha>)` (`releaseDate` for movies, `firstAirDate` for series) instead of `fecha && fecha > todayISO()`:

- No official date ⇒ `awaitingRelease = true` (treated as unreleased).
- The `!== undefined` guard avoids flagging items when the API fails transiently: `getMovieDetails`/`getTvExtraDetails` return `{}` in the `catch` (creation is not blocked if this extra step fails).

### 3. Marking as watched (`js/ui.js`, `js/quick-actions.js`): unified confirmation

The ad-hoc control at each marking point is replaced by `unreleasedConfirmMessage(item)` + `window.confirm`:

- `js/ui.js` — handler of `#btn-add-watch` in the movie modal (`openMovieModal`).
- `js/quick-actions.js` — `quickMarkMovie` and `quickMarkTv`.

The **soft pattern** for future dates is kept (confirmation, not hard block): if the user confirms, the marking proceeds.

### 4. Series episodes (`js/sorting.js`): badge also with `null` `airDate`

In `isNextEpisodeUnreleased`, the `Boolean(item.nextEpisodeToAir.airDate)` was removed from the `&&` operator: a `nextEpisodeToAir` **without a date** is now also considered unreleased (via `isUnreleasedDate`). Consequently, the "Aún no estrenado" badge, the CSS class `item-card--episode-unreleased` / `list-row--episode-unreleased` and the activity-based sorting (blocked items at the end) also apply when `airDate` is `null`.

### 5. Backfill of existing items (`js/daily-check.js`): daily check

In `checkForUpdates`, if an item has no date, is not watched and does not have `awaitingRelease`, the flag is set:

- **Movies**: `needsCheck` is expanded with `(!movie.releaseDate && !(movie.watchLog && movie.watchLog.length))`; a new block sets `updates.awaitingRelease = true` when `!movie.awaitingRelease && fresh.releaseDate !== undefined && !(movie.watchLog && movie.watchLog.length) && isUnreleasedDate(fresh.releaseDate)`.
- **Series**: new helper `hasAnyWatchedEpisode(show)` — traverses `watched` (season → episode → `{ date, rating }`) and tolerates the old format of dates as plain text via `normalizeEntry` from `tv-progress.js`; the flag is set with `fresh.firstAirDate !== undefined` and `isUnreleasedDate(fresh.firstAirDate)`.
- **Self-healing**: when TMDB publishes the date, the existing flow (`updates.releaseDate = fresh.releaseDate` and the release notice with `fresh.releaseDate <= today`, which also clears `awaitingRelease`) fills it in and notifies the release.

### Scope explicitly excluded

- **Individual episode checkboxes in the series modal**: NOT touched. Manual series have `airDate: null` in all their episodes; applying the control there would break the manual progress flow. The protection of the "next episode" (`isNextEpisodeUnreleased` + `unreleasedConfirmMessage`) covers the main path of series progress with TMDB data.
- **`js/export-ics.js`**: it already excluded items without a date (`if (!item.releaseDate) continue;`), so it required no changes.
- **SUPERSEDED by ADR-023**: the reopening of issue #27 (series between seasons with `next_episode_to_air = null`, e.g. "Dune: La Profecía" S2) led to covering what was excluded in the points above. ADR-023 does protect the individual episode checkbox (with the guard `!item.manual`, which preserves the manual-series flow) and the season's "Marcar todo" button (confirmation counting unaired episodes), and also covers the "Aún no estrenado" badge when TMDB does not return `next_episode_to_air` (persisted field `nextEpisodeAirDate` + `getNextEpisodeAirInfo`). See [adr-023-episode-unreleased-no-date.md](adr-023-episode-unreleased-no-date.md).

## Rejected alternatives

- **Hard block (prevent marking without confirmation)**: rejected because the established pattern for future dates was soft confirmation (`window.confirm`) and a hard block would be inconsistent with it; in addition, an item without an official date may actually be released, and requiring confirmation (not preventing) keeps flexibility without losing the warning.
- **Touching the episode checkboxes in the series modal**: rejected because manual series have `airDate: null` in all their episodes, so the control would block the whole manual progress flow. Next-episode protection covers the main path of a series' progress without affecting the manual case. *(This decision is expanded by ADR-023: the reopening of issue #27 added the control to the individual checkbox and to "Marcar todo" with the guard `!item.manual`, which leaves the manual-series flow intact.)*
- **Not doing backfill**: rejected because existing items (created before the fix) without a date and without `awaitingRelease` would remain markable without warning; expanding `checkForUpdates` heals them progressively in the daily check.

## Consequences

### Positive
- **Single, centralized criterion**: all the "not released" logic and its messages live in `js/release.js`; the rest of the modules consume the helpers instead of repeating date comparisons with different nuances.
- **No warnings that get skipped**: an item without an official release date can no longer be marked as watched without confirmation, just like one with a future date (movies, series and next episodes).
- **Coverage of dateless episodes**: the "Aún no estrenado" badge, the card CSS class and the activity-based sorting now also apply when `airDate` is `null`.
- **Self-healing data**: when TMDB publishes the date of an item that lacked one, the daily check fills it in, clears the flag and notifies the release without user intervention.
- **Pre-existing texts intact**: the messages with a date are identical to the previous ones, so the experience does not change for items with a future date.

### Negative
- **Extra confirmation when marking dateless movies**: even if the movie is actually released, if TMDB has no official date the user will see an additional `confirm` when marking it as watched.
- **Additional TMDB call per day**: expanding `needsCheck` for movies makes the daily check query the API for each item without a date and without watch history (until the `awaitingRelease` flag is set or TMDB publishes the date).

### Neutral
- **New module `js/release.js`**: imported by `ui.js`, `quick-actions.js`, `search.js`, `sorting.js`, `modal-handlers.js` and `daily-check.js`. Included in `STATIC_ASSETS` of `service-worker.js` for static precache (consistency with ADR-019).
- **Series modal episode checkboxes remain outside the "unreleased" control** by design (manual series), while the main path (next episode) is protected.

## Created/modified files

| File | Change |
|---------|--------|
| `js/release.js` | **New**: `isUnreleasedDate(dateStr)` (`!dateStr \|\| dateStr > todayISO()`) and `unreleasedConfirmMessage(item)` with messages for movies (manual/future date/no date) and series (only if `nextEpisodeToAir` matches `nextEpisode`; with date/without date) |
| `js/search.js` | `handleAdd`: movie/series creation with `details.<fecha> !== undefined && isUnreleasedDate(...)` to set `awaitingRelease` (guard against `{}` from the API) |
| `js/modal-handlers.js` | `addSagaMovie` and `addFromRecommendation` (movie and tv branches): same criterion `!== undefined && isUnreleasedDate(...)` |
| `js/ui.js` | Handler of `#btn-add-watch` in the movie modal: ad-hoc control replaced by `unreleasedConfirmMessage` + `window.confirm` |
| `js/quick-actions.js` | `quickMarkMovie` and `quickMarkTv`: ad-hoc control replaced by `unreleasedConfirmMessage` + `window.confirm` |
| `js/sorting.js` | `isNextEpisodeUnreleased`: removed `Boolean(airDate)`; now uses `isUnreleasedDate(airDate)` (null also ⇒ unreleased) |
| `js/daily-check.js` | `checkForUpdates`: `needsCheck` expanded for dateless movies; `awaitingRelease` backfill for movies and series; new helper `hasAnyWatchedEpisode` with `normalizeEntry` from `tv-progress.js` |
| `service-worker.js` | `js/release.js` added to `STATIC_ASSETS` for static precache |
| `docs/adr-020-unreleased-without-date.md` | **New**: this document |

Related issue: #27 — https://github.com/gonzalitojh/personal-tracker/issues/27
