# ADR-024: Uniform treatment of unreleased items at all levels: stripes, relegation and badge unified (issue #27, 2nd reopening)

## Status
Accepted

## Date
August 2026

**Note (updated by ADR-025, 3rd reopening):** the TV confirmation phase in `release.js` that the "Notable decision" below rejected due to the ES modules import cycle was **implemented** in the 3rd reopening of issue #27: `unreleasedConfirmMessage(item, airInfo = null)` receives `getNextEpisodeAirInfo` as an **injected parameter** from the consumer (`quick-actions.js`), so `release.js` still imports only `dates.js` and the cycle is avoided without moving dependencies. In addition, the sources story is extended: the new persisted field `seasonAirDates` (map season → `air_date`, where `null` = unaired season, refreshed daily and when opening the modal) becomes the **2nd source** in `getNextEpisodeAirInfo`'s precedence (toAir > season > stored), ahead of the `nextEpisodeAirDate` backfill; and `ensureNextEpisodeAirDate` and this ADR's `releasedNoticedAt` block propagate the fresh map in their spreads. See [adr-025-season-air-dates.md](adr-025-season-air-dates.md).

## Context

Issue #27 (2nd reopening) requested that the "not released" treatment be **uniform at all levels**: an item without a release date must be treated exactly the same as one with a future date — same stripe style in card and list, same relegation to the end in activity-based sorting and same "Aún no estrenado/a" label.

The issue's previous fixes (ADR-020 / PR #33 and ADR-023 / PR #36) had centralized the confirmation logic and the episode badge, but the **visual and sorting** treatment was still per type, with these gaps:

1. **Stripes only applied to series**: `renderGrid`/`renderList` used `isNextEpisodeUnreleased(item)`; movies with `awaitingRelease` (without a date or with a future date) did not get the stripe style.
2. **Activity-based sorting only relegated series**: `compareByActivityDesc` used the same per-type predicate, so an unreleased movie did not go to the end of the list.
3. **Series between seasons without a persisted datum**: if `nextEpisodeAirDate` had not yet been saved (neither season expansion nor backfill with `next_episode_to_air` present), the series showed no label, stripes or relegation, because `getNextEpisodeAirInfo` found no source.
4. **The movie badge had no stripes CSS class**: `item-card__upcoming--episode` only covered the episode case; the movie badge with `awaitingRelease` used the generic class without the distinctive stripe style.

Related issue: #27 — https://github.com/gonzalitojh/personal-tracker/issues/27

## Decision

Unify the "not released" criterion in a single predicate (`isItemUnreleased`) consumed by the card, the list, the badge and the sorting, with CSS classes renamed to a single suffix `--unreleased` (same stripe gradient), plus a daily backfill that closes the gap of series between seasons without a persisted datum and an idempotent cleanup of `awaitingRelease` when marking as watched.

### 1. Unified predicate `isItemUnreleased` (`js/sorting.js`)

New predicate that decides "not released" for any item:

- **Manual** ⇒ `false` (manual series have no real TMDB dates; ADR-020's historical exclusion is kept).
- **Movie** ⇒ `!(item.watchLog && item.watchLog.length) && isUnreleasedDate(item.releaseDate)` — without a date or a future date and not watched.
- **Series** ⇒ without `nextEpisode` ⇒ `false` (completed, never "not released"); otherwise, `item.awaitingRelease === true || isNextEpisodeUnreleased(item)` — covers both the unaired premiere and the ongoing series with the next episode unaired.

`compareByActivityDesc` now uses `isItemUnreleased` (previously `isNextEpisodeUnreleased`), so **all** unreleased items —movies included— are relegated to the end. `isNextEpisodeUnreleased` is kept: `isItemUnreleased` uses it internally and `daily-check.js` still uses it for `wasEpisodeBlocked`.

### 2. Unified CSS classes in `renderGrid`/`renderList` and `upcomingBadge` (`js/ui.js`)

- `renderGrid`/`renderList` apply `item-card--unreleased` / `list-row--unreleased` via `isItemUnreleased` (previously `item-card--episode-unreleased` / `list-row--episode-unreleased` via `isNextEpisodeUnreleased`). Unreleased movies finally get the stripes.
- `upcomingBadge` is rewritten with a **single guard** (`if (!isItemUnreleased(item)) return "";`) and a **unified class** `item-card__upcoming item-card__upcoming--unreleased` for the three cases:
  - **Movie**: «Aún no estrenada» (+ date if it exists).
  - **Unaired series premiere** (`awaitingRelease && nextEpisode`): «Aún no estrenada» (+ `firstAirDate` if it exists).
  - **Ongoing series** with the next episode unaired: «Aún no estrenado · TSE» (+ date if it exists), with a **safety guard**: if `getNextEpisodeAirInfo` returns `null`, the badge is not painted (in practice `isItemUnreleased` already guarantees there is info).

### 3. Class renaming in `ocio/ocio.css` (same gradient)

- `.item-card--episode-unreleased` → `.item-card--unreleased`
- `.list-row--episode-unreleased` → `.list-row--unreleased`
- `.item-card__upcoming--episode` → `.item-card__upcoming--unreleased`

The stripe gradient (`repeating-linear-gradient` between the "Viendo" and "Abandonada" colors) is identical to the previous one; only the selector's scope changes (it now covers movies and series equally). Comments updated.

### 4. Daily backfill `ensureNextEpisodeAirDate` (`js/daily-check.js`)

New helper that fills `updates.nextEpisodeAirDate` when **neither** `nextEpisodeToAir` **nor** the stored datum matches the user's next episode (series between seasons, ADR-023 case with data not yet persisted):

- `show.manual || !show.nextEpisode` ⇒ `null` (not applicable).
- If `getNextEpisodeAirInfo({ ...show, nextEpisodeToAir: fresh.nextEpisodeToAir })` already resolves, ⇒ `null` (there is already a source).
- Otherwise, it queries `getSeasonEpisodes(show.externalId, show.nextEpisode.season)`, searches the episode by `episodeNumber` and returns `{ season, episode, airDate: ep ? ep.airDate : null }` (`null` airDate = «no official date»).
- **Fail-open**: if the query fails, it logs to the console and returns `null`; it **does not abort the run nor increment `consecutiveFailures`** (unlike the rest of the run, which aborts on chained failures per ADR-021).

`checkForUpdates` invokes it for each series (with `getSeasonEpisodes` from the `ctx`) and, if it returns something, adds it to `updates.nextEpisodeAirDate`. It is the **fourth write path** of `nextEpisodeAirDate` (ADR-023 documented three: `quickMarkTv`, `buildTvUpdates` and the modal's season expansion).

### 5. Idempotent cleanup of `awaitingRelease` when marking as watched (`js/modal-handlers.js`, `js/quick-actions.js`)

The **4 mark-as-watched paths** now clear `awaitingRelease: false` —both in the Firestore payload and in the in-memory object— idempotently: an already-watched item cannot keep being "not released".

- `persist` (movie modal, `js/modal-handlers.js`).
- `persistWatched` (series modal, `js/modal-handlers.js`).
- `quickMarkMovie` (`js/quick-actions.js`).
- `saveTvProgress` (`js/quick-actions.js`, used by `quickMarkTv` and episode marking).

### Notable decision: TV confirmation phase in `release.js` NOT applied

Extending `release.js` with a TV confirmation message based on `getNextEpisodeAirInfo` was evaluated (which would unify the "not released" warning also for series between seasons). **It was not applied**: `release.js` is imported by `sorting.js` (which consumes `isUnreleasedDate`), and the reverse import (`release.js` → `sorting.js` for `getNextEpisodeAirInfo`) would create an **ES modules import cycle**. No functional impact: the `next_episode_to_air = null` case in confirmations is already covered by PR #36 (`nextEpisodeAirDate` backfill in `daily-check.js` + per-episode confirmations via `episodeUnreleasedMessage` in the quick action, the individual checkbox and "Marcar todo").

## Rejected alternatives

- **Keeping per-type predicates (`isNextEpisodeUnreleased` for series + `awaitingRelease` for movies) and only adding stripes to movies**: rejected for having two sources of truth with the risk of divergence between card, list, badge and sorting; the issue explicitly requested "all the same" treatment.
- **Badge per type (different class for movie, premiere and episode)**: rejected: the unified class `item-card__upcoming--unreleased` reduces CSS and guarantees the same look for the three cases (requirement of the 2nd reopening).
- **Synchronous season query in the UI** (`getSeasonEpisodes` in the render to learn the next episode's date of series between seasons): rejected: it would block the render, add TMDB calls per rendering and complicate the cache; the daily backfill (`ensureNextEpisodeAirDate`) covers the case asynchronously and fail-open.
- **TV confirmation phase in `release.js` via `getNextEpisodeAirInfo`**: rejected due to the ES modules import cycle described in the Decision.
- **Keeping the old class names as aliases**: rejected: the CSS classes are internal (no external consumers) and the `--episode` suffix no longer describes the scope (it now covers any item).

## Consequences

### Positive
- **Uniformity at all levels**: stripes, relegation to the end and badge identical for items without a date and with a future date, in movies, series premieres and ongoing series.
- **Single source of truth**: `isItemUnreleased` is consumed by `renderGrid`, `renderList`, `upcomingBadge` and `compareByActivityDesc`; there is no duplicated per-type "not released" logic in the UI.
- **Unreleased movies are now visible**: they get stripes, go to the end and show the badge (gaps 1 and 2 of the Context closed).
- **Series between seasons without a persisted datum are covered**: the daily backfill fills `nextEpisodeAirDate` in the next run (gap 3 closed), without blocking the render.
- **`awaitingRelease` is always cleared when marking as watched** in the 4 paths (payload + memory): a watched item cannot remain "not released" even if the daily run has not arrived yet.
- **QA approved**: 6/6 acceptance criteria and 20/20 edge cases; low non-blocking findings documented below.

### Negative
- **Visual change for movies with `awaitingRelease`**: movies without a date or with a future date now show the stripes (before only series did); it is the requested behavior, but it alters the previous look.
- **One additional TMDB call per series in the daily run** when neither `nextEpisodeToAir` nor the stored datum matches the next episode; mitigated by `getSeasonEpisodes`' 24 h in-memory cache (ADR-022).
- **Low findings (non-blocking, documented in the QA)**:
  - *Series premiere without `nextEpisode`* (the user has not watched any episode): `isItemUnreleased` returns `false` (`!item.nextEpisode` guard) and the series gets no stripes or relegation; accepted because there is no specific episode to protect and the guard avoids false positives in completed series.
  - *`series_premiere` pref disabled*: the daily run block that clears `awaitingRelease` when the premiere is released is conditioned on the pref (`prefs.series_premiere !== false`), so with the pref disabled the flag can persist transiently on a series already released (which will keep the stripes) until the user marks the first episode as watched, at which point the idempotent cleanup of point 5 removes it.

### Neutral
- **`isNextEpisodeUnreleased` keeps its contract**: it remains in `sorting.js`, is consumed internally by `isItemUnreleased` and `daily-check.js` uses it for `wasEpisodeBlocked`; the renaming only affects the predicate facing the UI.
- **The CSS class renaming is internal**: there are no external consumers (the other selectors referenced in HTML are the generic `item-card__upcoming`, etc., which do not change).
- **No changes in `service-worker.js`**: no new modules are created; the touched files (`sorting.js`, `ui.js`, `daily-check.js`, `modal-handlers.js`, `quick-actions.js`) are already precached (ADR-019).
- **`ensureNextEpisodeAirDate` is fail-open by design**: a network failure does not abort the run (unlike ADR-021's abort via `MAX_CONSECUTIVE_FAILURES`) nor increments the failure counter.

## Created/modified files

| File | Change |
|---------|--------|
| `js/sorting.js` | **New** `isItemUnreleased(item)`: unified predicate (manual→`false`; movie: not watched and `isUnreleasedDate(releaseDate)`; series: `awaitingRelease === true \|\| isNextEpisodeUnreleased(item)`, `false` without `nextEpisode`); `compareByActivityDesc` uses it to relegate to the end |
| `js/ui.js` | `renderGrid`/`renderList`: classes `item-card--unreleased`/`list-row--unreleased` via `isItemUnreleased`; `upcomingBadge` rewritten with a single guard, unified class `item-card__upcoming--unreleased` and safety guard if `getNextEpisodeAirInfo` returns `null` |
| `ocio/ocio.css` | Class renaming (`.item-card--episode-unreleased`→`.item-card--unreleased`, `.list-row--episode-unreleased`→`.list-row--unreleased`, `.item-card__upcoming--episode`→`.item-card__upcoming--unreleased`) with the same stripe gradient; comments updated |
| `js/daily-check.js` | **New** `ensureNextEpisodeAirDate(show, fresh, getSeasonEpisodes)`: backfill of `nextEpisodeAirDate` when neither `nextEpisodeToAir` nor the stored datum matches (fail-open, without aborting the run nor touching `consecutiveFailures`); `checkForUpdates` invokes it per series and adds the result to `updates` |
| `js/modal-handlers.js` | `persist` (movie) and `persistWatched` (series): idempotent cleanup `awaitingRelease: false` in the Firestore payload and in the in-memory object |
| `js/quick-actions.js` | `quickMarkMovie` and `saveTvProgress`: idempotent cleanup `awaitingRelease: false` in the Firestore payload and in the in-memory object |
| `docs/adr-024-unreleased-uniform-treatment.md` | **New**: this document |

Related issue: #27 — https://github.com/gonzalitojh/personal-tracker/issues/27
