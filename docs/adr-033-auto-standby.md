# ADR-033: Automatic standby transition for ongoing series with no activity in the last year (issue #48)

## Status
Accepted

## Date
2026-08-05

## Context

The web «Mi Registro» stores series in Firestore with a `status` field that can be `pendiente`, `en_curso`, `completado`, `standby` or `abandonado`. Until now, **all status changes were manual**: pausing (standby), abandoning or resuming a series always required the user's explicit action. The daily check (`js/daily-check.js`, function `checkForUpdates`) was limited to refreshing TMDB metadata once a day (missing data, `nextEpisodeToAir`, `seasonAirDates`, backfill of `nextEpisodeAirDate`, release alerts) without ever modifying any item's status. It was verified before implementing that no automatic status change existed in the code.

Issue #48 asks that series that were started watching and then left aside automatically move to *Standby* when there has been no activity in the last year, with two explicit rules:

1. If the series is **waiting for new episodes to be released**, it must NOT be moved (even if it does not have a release date yet).
2. If new episodes have already been released, but they were released **less than a year ago**, it must NOT be moved.
3. Activity criterion: take the **most recent** date between the last episode's air date and the last watch date to check for activity in the last year.

Related issue: #48 — https://github.com/gonzalitojh/Registro-personal/issues/48

## Decision

Implement auto-standby due to inactivity inside the existing daily check, via a **pure function** `shouldAutoStandby(show, today)` (exported, `js/daily-check.js`) that decides whether a series should move to standby, integrated into the same `checkForUpdates` run without extra API requests.

### 1. Pure function `shouldAutoStandby(show, today)` (exported)

It is the decision's single source of truth; it takes the series and today's date (`YYYY-MM-DD`) and returns `true` if it should move to standby:

1. **Only status `"en_curso"`**: if `show.status !== "en_curso"` ⇒ `false`. The statuses `pendiente`, `completado`, `standby` and `abandonado` are not touched (standby is already paused; the use case is the series started and de facto abandoned).
2. **Issue rule 1 — next episode not released**: if `isNextEpisodeUnreleased(show)` (future date **or without a date**, unified criterion of ADR-020/ADR-023/ADR-024) ⇒ `false`. The series is "waiting for new episodes" and must not move, even if it does not have a release date yet.
3. **Issue rules 2 and 3 — activity criterion**: `lastAirDate` is computed as `getNextEpisodeAirInfo(show).airDate` **only when that episode already aired** (if the next episode were unreleased, step 2 would already have returned `false`), and `lastWatched` as `show.lastWatchedAt`. The activity date is the **most recent** of both: `activity = max(lastAirDate, lastWatchedAt)`. If `activity <= subtractDays(today, 365)` (more than a year ago) ⇒ `true` (move to standby); if within the last year ⇒ `false`.
4. **Without known dates — conservative**: if neither `lastAirDate` nor `lastWatchedAt` exists ⇒ `false` (do not move).

`YYYY-MM-DD` string comparisons (the project's canonical format), without `Date` manipulation inside the function itself.

### 2. Helper `subtractDays(iso, days)` in `js/dates.js` (new, exported)

Subtracts days from a `"YYYY-MM-DD"` date and returns another date in the same canonical format. It uses **UTC arithmetic** (`new Date(iso + "T00:00:00Z")`, `setUTCDate`/`toISOString`) to avoid timezone drifts crossing local midnights; it guarantees the result is directly comparable as text with the stored dates.

### 3. Integration in `checkForUpdates` (`js/daily-check.js`)

- **Non-manual series**: inside the existing main loop for series with TMDB data, after the `nextEpisodeAirDate` backfill, an `evaluatedShow` is built with the data **fresh from the same run** (`nextEpisodeToAir`, `seasonAirDates` and the freshly computed `nextEpisodeAirDate`) and `shouldAutoStandby(evaluatedShow, today)` is evaluated. If it moves, `{ status: "standby", autoStandbyAt: today }` is persisted into the **same `updateItem`** that was already writing the rest of the series' updates (a single write, no extra requests).
- **Manual ongoing series** (without TMDB data): a separate mini-loop, **without network**, with the data stored in Firestore (the evaluation falls back to `lastWatchedAt` when there are no air dates). Each write goes in its own `try/catch` with **fail-open**: a write error is logged (`console.error`) and does not abort the run nor count as an API failure.
- **Scope**: only series with `status === "en_curso"`. `pendiente`/`completado`/`standby`/`abandonado` are not touched. **No notifications**: the change is visible in the list (the «Viendo» filter hides it; the user sees it when filtering by Standby).
- **Traceability**: the new `autoStandbyAt` field stores the date (`YYYY-MM-DD`) on which the system moved the series to standby, distinguishing automatic pauses from manual ones.

### 4. Notorious decision: series with NO airing information at all

A series without `nextEpisodeToAir`, without `seasonAirDates` and without `nextEpisodeAirDate` (that is, with no known air date) **IS moved** if `lastWatchedAt` is old: the issue's criterion falls back to the last watch date, which is the only available activity. For **non-manual** series this case is almost impossible in practice, because the daily run fills `seasonAirDates` with `null` and the backfill provides `nextEpisodeAirDate`; for **manual** series it is the normal path (there is no TMDB data supporting "recent releases"). Only when neither of the two dates exists (`lastAirDate` and `lastWatchedAt`) is the conservative no-move criterion applied.

## Rejected alternatives

- **Evaluating only with stored data (also for non-manual series)**: rejected — the fresh TMDB data of the daily run is the source of truth for detecting "recent releases"; evaluating with old data would erroneously move series that already resumed airing. That is why non-manual series are evaluated with fresh `nextEpisodeToAir`/`seasonAirDates`/`nextEpisodeAirDate` from the same run, and only manual ones (which have no TMDB data) use the stored data.
- **Expanding the main loop's filter to include manual series**: rejected — putting manual series into the API series loop would dirty the network flow (it would call TMDB for series that have no `externalId`); the separate mini-loop, without network, keeps each flow clean.
- **Calendar year instead of 365 days**: rejected — «the last 365 days» is simpler to compute and to explain, and the impact of 1 day (e.g. a release on January 1 of the previous year) is irrelevant to the decision to pause a series.
- **Notifying the user of the status change**: rejected — issue #48 does not ask for it and the change is visible in the list (the series leaves the «Viendo» filter and appears in the «Standby» filter); in addition the `autoStandbyAt` field provides traceability for later queries.

## Consequences

### Positive
- **Issue #48 solved**: ongoing series without activity in the last year (last aired release or last watch, whichever is most recent) automatically move to standby in the daily check.
- **No regressions in active series**: series with an unreleased next episode (waiting for new episodes) and those that released within the last year do not move, per the issue's rules.
- **Zero network cost**: the decision is computed with the data already fetched by the daily run (non-manual series) or with stored data (manual series, without network); the write is added to the existing `updateItem`.
- **Testable logic**: `shouldAutoStandby` is a pure, exported function; 14 edge cases verified in validation (recent dates do not move, old ones move, unreleased next episodes do not move, the exact 1-year threshold moves, manual ones work, without dates it does not move, etc.). QA approved and security scan with no findings (CLEAN).
- **Robustness against failures**: write errors in the manual series mini-loop do not abort the run (fail-open), preserving the rest of the daily check.

### Negative
- **Status change without user action**: a series can move to standby "by itself"; it is the behavior requested by the issue, and it is mitigated because there is no data deletion nor progress loss (the `watched` history is preserved and the series can be resumed from Standby).
- **Dependence on data accuracy**: if `lastWatchedAt` or the last episode's `airDate` were corrupt or missing, the decision is made with the available date; the conservative criterion (no date at all ⇒ do not move) limits the risk.

### Neutral
- **New field `autoStandbyAt`** in automatically moved series; it distinguishes automatic from manual pauses and provides traceability.
- **`subtractDays` becomes a general utility** of `js/dates.js` (exported), reusable by other date-threshold logics.
- **No UI changes**: the standby status already existed with its visual and filter treatment; there are no notifications or new texts (the user manual was already updated by the implementation).

## Created/modified files

| File | Change |
|---------|--------|
| `js/daily-check.js` | New exported pure function `shouldAutoStandby(show, today)` (only `en_curso`, unreleased next episode ⇒ does not move, `max(airDate of the last aired episode, lastWatchedAt)` against the threshold `subtractDays(today, 365)`, no dates ⇒ does not move) and constant `AUTO_STANDBY_DAYS = 365`; integration in `checkForUpdates`: evaluation with fresh run data for non-manual series (persisted in the same `updateItem` as `{ status: "standby", autoStandbyAt: today }`) and a network-free mini-loop for manual series with fail-open |
| `js/dates.js` | New exported function `subtractDays(iso, days)` with UTC arithmetic and result in the canonical `YYYY-MM-DD` format |
| `docs/adr-033-auto-standby.md` | **New**: this document |

Related issue: #48 — https://github.com/gonzalitojh/Registro-personal/issues/48
