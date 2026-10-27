# ADR-021: Data synchronization with TMDB/Open Library: full refresh with truthy-only policy (issue #23)

## Status
Accepted (partially replaced by ADR-093, issue #200: see the
"Update (issue #200)" section at the end of the document)

## Date
August 2026

## Context

Issue #23 establishes that **Firestore data must always reflect the current TMDB/Open Library data**: an item cannot be updated only at creation time and then stay frozen. The canonical example: a movie added before TMDB included it in a saga (`belongs_to_collection`) never received its collection data, because the daily refresh ignored "completed" items.

Before this change, `js/daily-check.js` ran `checkForUpdates` once a day (guard `profile.lastReleaseCheckAt === today`) but with two limitations:

1. **It only reviewed incomplete items**: `needsCheck` filters (movies) and `needsBackfill` (series), and abandoned series (`status === "abandonado"`) were excluded.
2. **It only filled gaps**: assignments of the type `if (!movie.X && fresh.X)`, so a field already present (e.g. the saga, `communityRating`, `trailerUrl` or the genres) was never refreshed even if the API had changed it.

The ideal option raised in the issue — keeping the DB synced in real time with the API — is not viable due to cost (one call per item on every change is unaffordable), so the recommended minimal option was adopted: **complete daily refresh** (no longer only gaps) plus a **manual sync button** in Settings.

Related issue: #23 — https://github.com/gonzalitojh/personal-tracker/issues/23

## Decision

Refresh the metadata of **all** non-manual items once a day (and on demand with the "Sincronizar ahora" button), overwriting fields with the **truthy-only** policy: a field is updated only if the fresh value is non-empty; if the API returns an empty/`null` value, the stored one is kept. Fields edited by the user (history, status, notes) are never touched.

### 1. Truthy-only overwrite (`buildMovieUpdates`, `buildTvUpdates`, `buildBookUpdates`)

Three `updates` builder functions in `js/daily-check.js` apply the same semantics per type:

- **Movies** (`buildMovieUpdates`): `runtime`, `overview`, `genres` (non-empty array), `cast` (non-empty array), `director`, `releaseDate` (only if it differs from the stored one), `communityRating` (`!= null`), `trailerUrl`, `collectionId`/`collectionName`/`collectionPoster` (saga) and `coverUrl`.
- **Series** (`buildTvUpdates`): the previous ones except `releaseDate`/saga, plus `creators`, `episodeRuntime`, `firstAirDate` (only if it differs), `tmdbStatus` (new) and `coverUrl` (new).
- **Books** (`buildBookUpdates`): only `description` (synopsis), and only if the new one is non-empty (Open Library sometimes does not return it).

**Exception**: `nextEpisodeToAir` is always overwritten when the API returns it, with no truthy-only condition, because it is a transient field (historical behavior that the episode refresh needs).

**Stable fields (never overwritten)**: `title`, `year`, `externalId`, `manual`, `status`, `watchLog`, `readLog`, `notas` and the notification flags (`awaitingRelease`, `lastNotifiedEpisode`, `releasedNoticedAt`). These are only moved by the run's own alert logic (release, new episode), never by the metadata refresh.

### 2. Full coverage

The `needsCheck`/`needsBackfill` filters and the skip for books that already had a synopsis (`if (book.manual || book.description) continue`) were removed. The run now traverses **all** non-manual items with `externalId`:

- **Movies**: `!m.manual && m.externalId`.
- **Series**: `!s.manual && s.externalId`, **including abandoned ones** (previously excluded with `s.status !== "abandonado"`); their `status` remains intact because it is a stable field.
- **Books**: `!b.manual && b.externalId && b.externalId.startsWith("/works/")` (the latter filter is kept: only *work* keys have a queryable description in Open Library).

### 3. Cost limits

- **Daily run per user**: guard `profile.lastReleaseCheckAt === today`; the stamp is applied only when the run finishes successfully (not when aborting), so a failed run is retried on the next load.
- **Manual cooldown of 30 minutes**: `MANUAL_SYNC_COOLDOWN_MS` persisted in `profile.lastManualSyncAt` (stamped only if the manual run completed without aborting).
- **Pool of 4 concurrent requests**: `REFRESH_CONCURRENCY` with `mapConcurrent(items, limit, fn)` (promises in order, no dependencies between items).
- **Abort on chained failures**: if `consecutiveFailures` exceeds `MAX_CONSECUTIVE_FAILURES` (= 5, i.e. on the **sixth consecutive failure**) the run aborts (`{ aborted: true }`) so it does not keep hitting an API that is down; it retries on the next run.

### 4. Anti-concurrency

- The `isRefreshing` flag is managed by **`checkForUpdates`**, not `syncNow`, to cover both the automatic daily run and the manual one with a single guard. The check and the set are **synchronous and contiguous** (no `await` between them), so two calls never cross the guard at the same time; the cleanup happens in `finally`.
- `checkForUpdates` returns `{ aborted: boolean }`: `true` if it entered while a run was in progress (reentrancy) or if the run aborted due to failures; in that case it does **not stamp `lastReleaseCheckAt`** or `lastManualSyncAt`.
- `syncNow` does a **double check** of `isRefreshing` (before and after reading the profile) and, if the run aborted, returns an error **without burning the cooldown** and without reporting success.

### 5. New fields in `js/api-movies.js`

- `tmdbStatus: data.status || null` in `getTvExtraDetails`: the series' airing status according to TMDB ("Returning Series", "Ended", "Canceled", ...), now refreshable.
- `coverUrl: data.poster_path ? IMG_BASE + poster_path : null` in `getMovieDetails` and `getTvExtraDetails`, with `IMG_BASE = "https://image.tmdb.org/t/p/w342"` — the **same w342 pattern as creation** (search results), so a cover removed or added by TMDB propagates to existing profiles.

### 6. UI: "Sincronización de datos" card in Settings

- New card in `index.html` with the `#btn-sync-now` button (`btn btn--outline` class).
- `wireSyncButton` (`js/settings.js`) launches `syncNow(ctx)` and translates the result into toasts: success ("Datos sincronizados con las APIs."), cooldown ("Sincronización reciente, inténtalo en un rato."), run in progress ("Ya hay una sincronización en curso.") or error.
- The button is **disabled during execution** (text "Sincronizando…", restored in `finally`) and also while any run is in progress via `isSyncRunning()` (exported by `daily-check.js` and consulted in `renderSettings`).

### 7. Version bump

`APP_VERSION` moves to `'20260804'` in `js/config.js`, with the corresponding `?v=20260804` in `index.html` (styles, ocio.css, app.js) and in `STATIC_ASSETS` of `service-worker.js`, so the new `daily-check.js`/`settings.js` reaches clients (consistency with ADR-019).

## Rejected alternatives

- **Real-time / reactive sync (every API change propagates instantly)**: the ideal option of the issue, rejected due to cost: TMDB offers no webhooks and continuous polling per item would exceed the API limits. The manual button covers the "I want fresh data now" case.
- **Refresh only incomplete items (status quo)**: rejected by definition — it is exactly the behavior reported by the issue: a completed item (e.g. with a missing saga) was never healed.
- **Unconditional overwrite (API data always wins)**: rejected: if the API transiently returns `overview: ""` or `communityRating: null`, valid data would be destroyed. The truthy-only policy refreshes without risk of erasure.
- **Manual button without cooldown**: rejected: it would allow launching full runs of N items indefinitely and take down the TMDB limits; the 30 min cooldown persisted in `profile.lastManualSyncAt` prevents this.
- **Anti-concurrency flag managed in `syncNow`**: rejected: it would not cover the daily run (two daily runs from different tabs could run in parallel, duplicating cost and notifications); centralizing it in `checkForUpdates` means the guard covers both paths.

## Consequences

### Positive
- **The DB reflects the current API data**: a completed item is healed when TMDB adds its saga, changes its rating, cover or trailer, or when a series becomes "Ended" (`tmdbStatus`).
- **No risk of erasure**: the truthy-only policy never destroys a stored field due to an empty response or a transient API failure.
- **User data is untouchable**: `watchLog`, `readLog`, `status`, `notas` and the notification flags are outside the refresh.
- **Full coverage**: abandoned series and books with a synopsis are now included in the daily run.
- **Cost control and robustness**: one run per day and user, a 30 min cooldown for the manual run, a pool of 4 requests and early abort on chained failures avoid exceeding TMDB limits and do not block the user indefinitely (the cooldown is not burned if the run aborts).
- **No duplicated runs**: the `isRefreshing` flag with synchronous contiguous set closes the race between the daily run and the manual one.

### Negative
- **More daily requests to TMDB**: the daily run now queries the API for **all** non-manual items, not only incomplete ones; with large libraries the daily cost per user grows proportionally (mitigated by the pool of 4 and the one-run/day frequency).
- **Additional Firestore writes**: although `buildMovieUpdates` returns `{}` when there is nothing to change (without `updateItem`), it is expected that more items receive `updateItem` than before.

### Neutral
- `checkForUpdates(ctx, { force })` now returns `{ aborted: boolean }` (previously `undefined`); the only consumer of the daily run (`app.js` → `maybeTriggerDailyCheck`) does not use the return value, and `syncNow` interprets it to avoid burning the cooldown.
- `syncNow(ctx)` and `isSyncRunning()` are new exports of `daily-check.js`; `settings.js` imports them (no cycles: `settings.js` already imported from `daily-check.js` via `getNotificationPrefs`).
- `coverUrl` is stored in movie/series documents; profiles that show the cover read it from the document, so the daily refresh updates them without UI changes.

## Created/modified files

| File | Change |
|---------|--------|
| `js/daily-check.js` | Refactor of `checkForUpdates`: now `(ctx, { force })` and returns `{ aborted }`; internal `isRefreshing` flag with synchronous set + `finally`; removed `needsCheck`/`needsBackfill` and the book skip; full coverage of non-manual items (including abandoned series); new functions `buildMovieUpdates`/`buildTvUpdates`/`buildBookUpdates` (truthy-only), `mapConcurrent` (pool `REFRESH_CONCURRENCY` = 4), abort with `MAX_CONSECUTIVE_FAILURES`; new exports `syncNow(ctx)` (cooldown `MANUAL_SYNC_COOLDOWN_MS` = 30 min + double check) and `isSyncRunning()` |
| `js/api-movies.js` | `getTvExtraDetails`: new `tmdbStatus` (`data.status`); `getMovieDetails` and `getTvExtraDetails`: new `coverUrl` (`IMG_BASE` w342 pattern, same as creation) |
| `index.html` | "Sincronización de datos" card in Settings with `#btn-sync-now` button (`btn--outline`); assets with `?v=20260804` |
| `js/settings.js` | `wireSyncButton` (toasts per result, disabled during execution with "Sincronizando…") and `renderSettings` disables the button if `isSyncRunning()` |
| `js/config.js` | `APP_VERSION` → `'20260804'` |
| `service-worker.js` | `STATIC_ASSETS` updated to `?v=20260804` to propagate the change (consistency with ADR-019) |
| `docs/adr-021-db-data-sync.md` | **New**: this document |

## Update (issue #200)

The **daily full metadata refresh** described in this ADR is **partially
replaced** by the **minimum storage A2 + minimum run A5-a** of issue #200
(study of issue #183, ADR-073; implementation in **ADR-093**):

- Creations **no longer persist** the profile snapshot (synopsis, cast,
  genres, trailer, saga, streaming platforms...): details are requested
  **on demand** when opening the modal, with a 24 h cache.
- The daily run **no longer queries all non-manual items**: only those that
  can generate an alert (movies with a pending release, series with a
  premiere/unaired episode, /works/ books without a synopsis; games
  without a network). This removes `buildMovieUpdates`, `buildTvUpdates`
  and the daily refresh of `coverUrl`/`communityRating`/`trailerUrl`/saga
  (cover and rating are revalidated when opening the profile,
  stale-while-revalidate).
- The button **«Sincronizar ahora»** becomes **«Comprobar estrenos»** with
  the reduced scope of the minimum run (same 30 min cooldown).
- Old documents keep the historical fields until the one-time pruning per
  user (`js/migration.js`, marker `profile.storageMigration`).

Still in force from this ADR: the daily guard (`lastReleaseCheckAt`), the
`isRefreshing` anti-concurrency flag (centralized management in
`checkForUpdates`, synchronous contiguous set), the pool of 4 requests,
the abort on chained failures and the 30 min cooldown without burning if
the run aborts. The truthy-only policy remains in the minimal run's
fragments that still write (`releaseDate`, series airing fields, book
synopses).

Related issue: #23 — https://github.com/gonzalitojh/personal-tracker/issues/23
