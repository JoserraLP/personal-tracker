# ADR-023: Episode without a release date and without next_episode_to_air (series between seasons): confirmation and "Aún no estrenado" badge (issue #27, reopened)

## Status
Accepted

## Date
August 2026

**Note (expanded by ADR-024):** the 2nd reopening of issue #27 requested uniform treatment of "not released" at all levels. [ADR-024](adr-024-unreleased-uniform-treatment.md) renames the CSS classes cited in section 5 (`item-card--episode-unreleased` / `list-row--episode-unreleased` → `item-card--unreleased` / `list-row--unreleased`, and `item-card__upcoming--episode` → `item-card__upcoming--unreleased`), introduces the unified predicate `isItemUnreleased` as consumer of `getNextEpisodeAirInfo` for card, list, badge and sorting (movies included), and adds a **fourth write path** for `nextEpisodeAirDate`: the daily backfill `ensureNextEpisodeAirDate` for series between seasons whose data has not yet been persisted. The helpers described here (`episodeUnreleasedMessage`, `getNextEpisodeAirInfo`, `nextEpisodeAirDate`) remain as they are.

## Context

The original fix for issue #27 (ADR-020, PR #33) covered the cases of movies without a date and series with `nextEpisodeToAir` present (with or without a date). The issue was **reopened** because the case where TMDB returns `next_episode_to_air = null` was uncovered: a series **between seasons** without an announced date, like "Dune: La Profecía" T2. In that scenario the user's next episode (T2E1) has no release date and could be marked as watched without any warning.

The four failure points detected with `nextEpisodeToAir = null`:

1. **Quick action** (`quickMarkTv`): `unreleasedConfirmMessage(item)` returns `null` for TV when there is no `nextEpisodeToAir` (its guard `if (!nextEpisode || !nextEpisodeToAir) return null;`), so no confirmation was requested when marking the next episode.
2. **"Aún no estrenado" badge** (`isNextEpisodeUnreleased`): it depended exclusively on `nextEpisodeToAir`; with `null` it returned `false` and the badge, the card's CSS class and the activity-based sorting did not reflect the blocked episode.
3. **Individual checkbox in the series modal** (`js/ui.js`): it only blocked when `airDate` existed and was in the future; an episode without a date (T2E1) was marked as watched without confirmation.
4. **Season's "Marcar todo"** (`js/ui.js`): it did not check release dates at all.

Related issue: #27 — https://github.com/gonzalitojh/Registro-personal/issues/27

## Decision

Expand ADR-020's criterion to **specific episodes** whose `airDate` is unknown (null) or in the future, without depending on TMDB returning `next_episode_to_air`: a message helper for episodes is added, a verification fallback via the season, a persisted field as an alternative source for the badge, and confirmations at the marking points that were previously left out. Manual series are **excluded from all the control** (they have no real TMDB dates).

### 1. `episodeUnreleasedMessage` in `js/release.js`: single criterion for specific episodes

New helper `episodeUnreleasedMessage(title, season, episode, airDate)` that returns the `window.confirm` message for a specific episode whose air date we know (or do not):

- Future `airDate` ⇒ message with the date («Según TMDB este episodio (T2E1) se estrena el …»), identical in text to the pre-existing pattern.
- `null` `airDate` ⇒ message without a date («… no tiene fecha de estreno oficial en TMDB; suponemos que aún no está estrenado …»).
- Past/today `airDate` ⇒ `null` (released).

It is the **single criterion** for specific episodes: `quickMarkTv` (fallback) and the modal's individual checkbox consume it, guaranteeing the same warning at all points.

### 2. Fallback in `quickMarkTv` (`js/quick-actions.js`): verification via `getSeasonEpisodes`

When the base confirmation (`unreleasedConfirmMessage`) does not apply —typically due to missing `nextEpisodeToAir`— and the series **is not manual** and has `externalId`, `quickMarkTv` queries `getSeasonEpisodes(tvId, season)` and looks for the specific episode of the user's next episode; if it exists, it generates the message with `episodeUnreleasedMessage`.

- **Documented fail-open**: if the query fails (network/API), it is logged to the console and the marking proceeds **without confirmation** (marking is never blocked by a network failure). The call is not repeated: the fetched episodes are reused for the new field's persistence (point 4) and for the episode rating window (ADR-022).

### 3. `!item.manual` guard at all points

Manual series have `airDate: null` in all their episodes because there is no real TMDB data; applying the control there would block the manual progress flow. The `!item.manual` guard (or `manual` as a render option) excludes manual series from:

- the `quickMarkTv` fallback;
- the individual checkbox confirmation (`!item.manual && isUnreleasedDate(airDate)`);
- the count and confirmation of "Marcar todo";
- the "(sin estrenar)" indicator of `renderEpisodeRows` (`{ manual }` option);
- the persistence of `nextEpisodeAirDate` when expanding a season;
- `getNextEpisodeAirInfo` (returns `null`).

### 4. Persisted field `nextEpisodeAirDate`: alternative source for the badge

New field in series documents, shaped `{ season, episode, airDate }` (airDate can be `null` for "no official date"). It stores locally the air date of the next episode so that the "Aún no estrenado" badge keeps working even if TMDB stops returning `next_episode_to_air` (series between seasons). It is written from three paths:

- **`quickMarkTv`** (`js/quick-actions.js`): `saveTvProgress` accepts a 5th parameter `nextEpisodeAirDate`; if after marking the episode the user's next one is still in the same season and the episodes were already queried, it persists its `airDate` (or `null` if TMDB does not have it) along with the progress. The field is also mutated in memory.
- **`js/daily-check.js`** (`buildTvUpdates`): when `fresh.nextEpisodeToAir` exists, besides overwriting it (ADR-021 policy) it is copied locally as `nextEpisodeAirDate` with `airDate` normalized to `null` if it comes empty.
- **Season expansion in the modal** (`js/ui.js` → `js/modal-handlers.js`): when expanding the season where the user's next episode is, its `airDate` is persisted via the `onUpdateNextEpisodeAirDate` callback (**fire-and-forget**: `Promise.resolve(...).catch(() => {})` on the `ui.js` side and a non-throwing `.catch` on the `modal-handlers.js` side; a failure does not break the modal).

### 5. `getNextEpisodeAirInfo` in `js/sorting.js`: unified badge source

New helper `getNextEpisodeAirInfo(item)` that returns `{ season, episode, airDate }` of the user's next episode, or `null` if not applicable:

- It prioritizes `nextEpisodeToAir` (live TMDB) **only if it matches** in `season` + `episode` with the user's `nextEpisode`.
- Otherwise, it uses the stored `nextEpisodeAirDate` **only if it matches** in `season` + `episode`.
- Manual series, without `nextEpisode` or without a match ⇒ `null`.

The **invalidation by `season` + `episode` match** guarantees that a stale stored datum (from another season or episode) is never applied. `isNextEpisodeUnreleased` is refactored over this helper (`!!info && isUnreleasedDate(info.airDate)`), so that the "Aún no estrenado" badge, the CSS classes `item-card--episode-unreleased` / `list-row--episode-unreleased` and the activity-based sorting (ADR-020) automatically cover the `nextEpisodeToAir = null` case. The badge rendered in `upcomingBadge` (`js/ui.js`) now shows "Aún no estrenado · T2E1" with or without a formatted date according to what `getNextEpisodeAirInfo` returns.

### 6. Confirmation in "Marcar todo" (`js/ui.js`)

When marking an entire season (`season-mark-all`, only when marking, not un-marking, and only if the series is not manual), the number of unaired episodes is counted (`isUnreleasedDate(e.airDate)`: without an official date or with a future date) and, if there is any, **a single confirmation** is requested stating the number: «… N episodio(s) sin estrenar (sin fecha oficial o con fecha futura). ¿Marcarlos todos igualmente como vistos?».

- Episodes are read from the already-expanded season block if loaded; otherwise they are queried with `onExpandSeason` (fail-open: if the query fails, `episodes = null` and the marking proceeds without confirmation).
- If the user cancels, nothing is marked.

## Rejected alternatives

- **Massive daily backfill in `daily-check.js` querying the seasons** (calling `getSeasonEpisodes` for each series during the daily run): rejected due to cost — one additional call per series per day would noticeably increase TMDB requests — and lag — the data would arrive up to 24 h late relative to the moment of marking, which is when the warning is needed. On-demand writing (point 4) was preferred, which persists the date exactly when the season is queried.
- **Hard block (prevent marking, don't ask)**: rejected for consistency with the repo's and ADR-020's historical pattern: soft confirmation (`window.confirm`) is the established criterion for unaired items, and an episode without a date may actually have aired.
- **"Marcar todo" only for aired episodes** (mark all except unaired): rejected because it changes the button's semantics — "Marcar todo" must mark everything or mark nothing; the single confirmation preserves that semantics and leaves the decision to the user.
- **Leaving the badge out when `nextEpisodeToAir` is null**: rejected for UX: the user would not see that the series is blocked between seasons, and the activity-based sorting would not relegate it to the end either.

## Consequences

### Positive
- **The reported case is covered at all three marking points**: an episode without a date in a series between seasons (`next_episode_to_air = null`) is no longer marked without warning from the quick action, the individual checkbox or "Marcar todo".
- **The "Aún no estrenado" badge survives the absence of `next_episode_to_air`**: thanks to the stored `nextEpisodeAirDate` (written when querying the season or in the daily run), the card, the list and the activity-based sorting keep reflecting the blocked episode.
- **Single criterion for specific episodes**: `episodeUnreleasedMessage` centralizes the message and the "released/not released" decision for a given episode; consumers do not repeat logic with different nuances.
- **No regressions in manual series**: the `!item.manual` guard at all points preserves the manual progress flow (the reason why ADR-020 had excluded them).
- **No duplicated calls**: the episodes queried in the `quickMarkTv` fallback are reused to persist `nextEpisodeAirDate` and for the rating window (ADR-022).

### Negative
- **Additional call to `getSeasonEpisodes` in the quick action** when the base confirmation does not apply (typically series between seasons); mitigated by `getSeasonEpisodes`' 24 h in-memory cache (ADR-022), which amortizes repetitions within the same day.
- **The stored `nextEpisodeAirDate` can become stale** (it depends on the last daily run or the last time the season was queried, and the 24 h cache may serve an old `airDate`). The impact is limited because the confirmation is soft (if the episode already aired, the user simply confirms) and the data is rewritten with each fresh query.
- **Fail-open on network errors**: if `getSeasonEpisodes` fails in the `quickMarkTv` fallback or in the "Marcar todo" count, the marking proceeds without confirmation. This is a deliberate trade-off: a network failure must never block marking (documented in the code comments).

### Neutral
- **New field in the series schema**: `nextEpisodeAirDate` `{ season, episode, airDate }`; it does not come directly from TMDB (it is a derived local copy), it is persisted in Firestore and it is never globally overwritten with `null`: it is only replaced when the paths of point 4 write a new object (or it is kept intact).
- **`onUpdateNextEpisodeAirDate` is fire-and-forget**: a persistence failure does not break the modal opening nor the season expansion.
- **`isNextEpisodeUnreleased` changes implementation but not contract**: consumers (`ui.js`, `daily-check.js`, sorting) do not change; behavior is expanded to the `nextEpisodeToAir = null` case.
- **No changes in `service-worker.js`**: the new helpers live in modules already precached (`release.js`, `sorting.js`, `quick-actions.js`, `ui.js`, `daily-check.js`, `modal-handlers.js`).

## Created/modified files

| File | Change |
|---------|--------|
| `js/release.js` | **New helper** `episodeUnreleasedMessage(title, season, episode, airDate)`: confirmation message for a specific episode (future date or no official date); `null` if already released |
| `js/sorting.js` | **New** `getNextEpisodeAirInfo(item)`: unified source of the next episode (prioritizes `nextEpisodeToAir` if it matches `nextEpisode`; otherwise the stored `nextEpisodeAirDate`; invalidation by `season` + `episode`); `isNextEpisodeUnreleased` refactored over it |
| `js/quick-actions.js` | `quickMarkTv`: confirmation fallback via `getSeasonEpisodes` (fail-open, episodes reused) and persistence of `nextEpisodeAirDate`; `saveTvProgress` with 5th parameter `nextEpisodeAirDate` |
| `js/ui.js` | `renderEpisodeRows`: "(sin estrenar)" indicator also without a date (`manual` option); individual checkbox with confirmation for empty/future `airDate` (`!item.manual` guard); "Marcar todo" with confirmation counting unaired episodes; `upcomingBadge` with `getNextEpisodeAirInfo`; season expansion triggers `onUpdateNextEpisodeAirDate` (fire-and-forget) |
| `js/daily-check.js` | `buildTvUpdates`: persists `nextEpisodeAirDate` `{ season, episode, airDate }` (airDate normalized to `null`) when `nextEpisodeToAir` exists |
| `js/modal-handlers.js` | New callback `onUpdateNextEpisodeAirDate` (fire-and-forget): mutates `item.nextEpisodeAirDate` and persists in Firestore without throwing |
| `docs/adr-023-episode-unreleased-no-date.md` | **New**: this document |

Related issue: #27 — https://github.com/gonzalitojh/Registro-personal/issues/27
