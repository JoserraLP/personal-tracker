# ADR-025: Season air_date as source of truth: persisted map `seasonAirDates` and source precedence in `getNextEpisodeAirInfo` (issue #27, 3rd reopening)

## Status
Accepted

## Date
August 2026

## Context

In the 3rd reopening of issue #27 the user consulted the TMDB API and pointed out that the `air_date` field comes **both in the seasons and in the episodes**, and that when it comes `null` it should be understood that the series **is not released** and treated as such. The logic accumulated until then (ADR-020, ADR-023, ADR-024) only consumed two sources:

1. `nextEpisodeToAir` (live TMDB, main source for the badge and confirmations).
2. `nextEpisodeAirDate` (backfill persisted by PR #36 and ADR-024's `ensureNextEpisodeAirDate`).

**The gap**: the **season's** `air_date` was never used as a source. `getTvSeasonsMeta`/`getTvExtraDetails` already normalized it (`airDate: air_date || null`), but nobody persisted or consumed it. Concrete consequence: a series between seasons without `next_episode_to_air` and with a stale persisted `nextEpisodeAirDate` (e.g. `null` saved forever) was left without a source: `getNextEpisodeAirInfo` returned `null` and the series showed no badge, stripes or relegation, and could be marked without confirmation, even though its season's `air_date` indicated it was still unreleased.

Related issue: #27 — https://github.com/gonzalitojh/personal-tracker/issues/27

## Decision

Persist the per-season air dates map (`seasonAirDates`) in series items and use it as the **second source** in `getNextEpisodeAirInfo`'s precedence, with `null` inside the map as **real information** ("unaired season") that is never filtered out. Components:

### 1. `js/api-movies.js`: internal helper `normalizeSeasons` and export `seasonAirDateMap`

- **`normalizeSeasons(seasons)`** (internal): filters "specials" (`season_number > 0`) and normalizes `airDate: s.air_date || null`. `getTvSeasonsMeta` is refactored over it (unchanged contract: list of seasons with name and episode count).
- **`seasonAirDateMap(seasons)`** (export): returns the map `{ "1": "YYYY-MM-DD", "2": null }` via `Object.fromEntries`. **The `null`s are kept**: a season without `air_date` is "unaired season" and that information is real, not an API failure.
- **`getTvExtraDetails`** now returns `seasonAirDates: seasonAirDateMap(data.seasons)` in the series detail.

### 2. `js/sorting.js`: documented source precedence in `getNextEpisodeAirInfo`

The helper now resolves in this order:

1. **`nextEpisodeToAir`** (live TMDB) when it matches in `season` + `episode` the user's next episode → tag `source: "toAir"`.
2. **`seasonAirDates[temporada]`** (refreshed daily) when the next episode's season exists in the map — **includes `null`** (`!== undefined`), which means unaired season → tag `source: "season"`.
3. **`nextEpisodeAirDate`** (persisted historical backfill, ADR-023/024) when it matches in `season` + `episode` → tag `source: "stored"`.

**Precedence rationale** (key design decision): the seasons map is refreshed daily and when opening the modal, so it is **fresher than the stored backfill** — it avoids stale datums like `nextEpisodeAirDate = null` persisted forever. In addition, the season's **past** `air_date` takes precedence over a "ghost" episode without a date (rare case where the season already premiered but the specific episode has no date): in that case `isUnreleasedDate(past airDate)` is `false` and there is no base confirmation; it is covered by the per-episode confirmations (`getSeasonEpisodes` fallback + `episodeUnreleasedMessage`, individual checkbox and "Marcar todo", ADR-023).

The `source` tag is added in memory via spread (`{ ...toAir, source: "toAir" }`) and is **only informative for the predicate**: it is **never persisted** (the 5 write paths documented in point 3 build the persisted objects without the tag — verified).

### 3. Map persistence: 5 write paths for `seasonAirDates`

1. **Series creation** (`js/search.js` `handleAdd` and `js/modal-handlers.js` `addFromRecommendation`): if `details.seasonAirDates` comes with keys (`Object.keys(...).length`), it is added to the creation draft.
2. **Daily refresh** (`js/daily-check.js` `buildTvUpdates`): `updates.seasonAirDates` is overwritten with the fresh map. **Documented exception to ADR-021's truthy-only policy**: the map is **complete** when the call succeeds and a `null` inside is real information (not a missing datum to be preserved), so the `if (fresh.x) updates.x = fresh.x` pattern is not applied per field.
3. **Refresh when opening the modal** (`js/modal-handlers.js` `openTvItem`): fire-and-forget — if the freshly consulted meta differs from the persisted one (`JSON.stringify` comparison), it is assigned in memory (the modal's badge via `upcomingBadge` is painted immediately) and persisted with a non-throwing `.catch(...)`. Manual series are excluded.
4. **Quick action** (`js/quick-actions.js` `quickMarkTv`): same fire-and-forget pattern over the meta already queried by `getSeasonsMetaFor` (no additional call).
5. *(Manual series never receive the map: they have no real TMDB dates.)*

### 4. `js/daily-check.js`: propagation of the fresh map to the predicates

- `ensureNextEpisodeAirDate` injects `seasonAirDates: fresh.seasonAirDates` into the spread over which it queries `getNextEpisodeAirInfo`: if the season already resolves as a source, the per-episode backfill is not needed.
- The `releasedNoticedAt` block (blocked → released transition) also propagates fresh `seasonAirDates` to `isNextEpisodeUnreleased`: when the season's `air_date` is already past, the episode stops being blocked and `releasedNoticedAt` is set in the same run.

### 5. `js/release.js`: TV confirmation implemented via parameter injection

`unreleasedConfirmMessage(item, airInfo = null)` — the TV branch now uses the `airInfo` injected as a parameter instead of reading `nextEpisodeToAir` from the item itself:

- The consumer (`quick-actions.js`) passes `getNextEpisodeAirInfo(item)`; thus the **ES modules import cycle** that ADR-024 rejected is avoided (`release.js` only imports `dates.js`; the dependency on `sorting.js` stays on the consumer side).
- `season` + `episode` match guard with the user's next episode; without `airInfo` (or without a match) ⇒ `null` (no information, no confirmation).
- **Specific message for `source: "season"`**: «Según TMDB la temporada N de «Título» aún no está estrenada (se estrena el … | sin fecha oficial). ¿Marcarlo igualmente como visto?» — different from the per-episode message, because here it is the entire season that has not premiered yet.

### 6. `js/quick-actions.js` and `js/modal-handlers.js`: consumers

- `quick-actions.js`: import of `getNextEpisodeAirInfo`; the base confirmation becomes `unreleasedConfirmMessage(item, getNextEpisodeAirInfo(item))` (covers any source: live, season or backfill); fire-and-forget refresh of `seasonAirDates` (point 3.4).
- `modal-handlers.js` (`openTvItem`): fire-and-forget refresh of `seasonAirDates` **before** opening the modal (point 3.3).

## Rejected alternatives

- **Querying the season live on every render** (calling `getSeasonEpisodes`/`getSeasonEpisodesMeta` from the render to learn the season's status): rejected — expensive (one TMDB call per card/list rendering) and asynchronous (the render is synchronous; it would complicate the cache and the rendering). It was already the argument against the synchronous backfill in ADR-024; here it is reinforced by the map's persistence, which makes the query unnecessary.
- **Relying only on the backfill** (stored `nextEpisodeAirDate`, without the seasons map): rejected — it does not cover the reported case: a `nextEpisodeAirDate = null` persisted "forever" (series between seasons without an announced date) would never be corrected even if TMDB published the season's `air_date`; the daily-refreshed map does correct it.
- **Normalizing `null` to a distant date in `seasonAirDateMap`** (to keep the truthy-only policy without exception): rejected — it would misrepresent reality (a season without a date has no distant date) and would contaminate the messages to the user ("se estrena el …" with an invented date). The `null` as a real value with a documented exception in `buildTvUpdates` is more honest.

## Consequences

### Positive
- **The reported case is covered**: the **season's** `air_date` of the next episode is now a source of truth (if it is `null` or future ⇒ not released ⇒ stripes, relegation, badge and confirmation) even without `next_episode_to_air` or `nextEpisodeAirDate` (3rd reopening criterion no. 1); the **episode's** `air_date` is still covered by ADR-023's paths (criterion no. 2); and the map is persisted and kept up to date with the daily refresh + modal opening + quick action (criterion no. 3).
- **Stale data is self-healing**: a persisted `nextEpisodeAirDate = null` stops blocking the state because the season (fresher) wins.
- **`release.js`' TV confirmation phase is implemented** (rejected in ADR-024 due to the import cycle): solved with parameter injection, without touching the dependencies' direction.
- **QA approved**: 6/6 acceptance criteria and 60/60 tests; security scan CLEAR (`security-cleared` in the task file).
- **No contract changes**: `isItemUnreleased`, `isNextEpisodeUnreleased` and `upcomingBadge` consume `getNextEpisodeAirInfo` and do not change their interface; ADR-024's consumers keep working.

### Negative
- **One more persisted field in the series schema**: `seasonAirDates` (`{ "1": "YYYY-MM-DD", "2": null }`), written in the 5 paths of point 3 (more Firestore writes than before).
- **Low findings (non-blocking, documented in the QA)**:
  - *`JSON.stringify` sensitive to key order*: if TMDB reorders the seasons in its response, the comparison may yield "different" with identical content ⇒ a redundant and harmless write (the persisted content is the same).
  - *Past season + "ghost" episode*: if the season already has a past `air_date` but the specific episode has no date (rare case), the precedence makes the season win and there is no base confirmation; it is covered by the per-episode confirmations (`getSeasonEpisodes` fallback in `quickMarkTv`, individual checkbox and "Marcar todo", ADR-023).

### Neutral
- **`null` in the map is real information**: it is not filtered out nor replaced; it is the **documented exception** to ADR-021's truthy-only policy in `buildTvUpdates` (the whole map is overwritten whenever the call succeeds).
- **The `source` tag is an in-memory artifact**: it is added via spread in `getNextEpisodeAirInfo` and never persisted (the 5 verified write paths build the persisted objects without the tag).
- **Fail-open pattern preserved**: the fire-and-forget refreshes (`JSON.stringify` + `.catch`) do not break the modal opening nor the quick action if persistence fails.
- **Manual series excluded**: they do not receive the map (point 3.5); their manual progress flow is unaffected (consistent with ADR-020/023/024).
- **No changes in `service-worker.js`**: all touched modules are already precached (ADR-019).

## Created/modified files

| File | Change |
|---------|--------|
| `js/api-movies.js` | **New** internal helper `normalizeSeasons` (filters `season_number > 0`, `airDate: air_date \|\| null`); `getTvSeasonsMeta` refactored over it; **new export** `seasonAirDateMap(seasons)` (keeps `null`); `getTvExtraDetails` returns `seasonAirDates` |
| `js/sorting.js` | `getNextEpisodeAirInfo`: documented precedence 1) `nextEpisodeToAir` (source "toAir") 2) `seasonAirDates[temporada]` (source "season", `!== undefined`, includes `null`) 3) `nextEpisodeAirDate` (source "stored"); `source` tag in memory via spread, never persisted |
| `js/search.js` | `handleAdd` (series creation): persists `details.seasonAirDates` in the draft if it has keys |
| `js/modal-handlers.js` | `addFromRecommendation` (series creation): persists `details.seasonAirDates`; `openTvItem`: fire-and-forget refresh of `seasonAirDates` before opening the modal (`JSON.stringify` comparison + `.catch`, manual exclusion) |
| `js/daily-check.js` | `buildTvUpdates`: overwrites `seasonAirDates` with the fresh map (documented exception to the truthy-only policy); `ensureNextEpisodeAirDate` and the `releasedNoticedAt` block propagate fresh `seasonAirDates` to the spread (correct blocked → released transition) |
| `js/quick-actions.js` | Import of `getNextEpisodeAirInfo`; base confirmation `unreleasedConfirmMessage(item, getNextEpisodeAirInfo(item))`; fire-and-forget refresh of `seasonAirDates` over the already-queried meta |
| `js/release.js` | `unreleasedConfirmMessage(item, airInfo = null)`: TV branch uses the injected `airInfo` (avoids the import cycle with `sorting.js`); specific message for `source: "season"` («Según TMDB la temporada N de «Título» aún no está estrenada …») |
| `docs/adr-024-unreleased-uniform-treatment.md` | Update note: the TV confirmation phase (rejected there due to the import cycle) is implemented via parameter injection, and `seasonAirDates` extends the sources story |
| `docs/adr-025-season-air-dates.md` | **New**: this document |

Related issue: #27 — https://github.com/gonzalitojh/personal-tracker/issues/27
