# ADR-093: Minimum storage (A2) and a minimum daily run (A5-a) (issue #200)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #200 asks to **redo how the information is stored** seeking
maximum optimization, per
the issue #183's
study
(the
`docs/estudio-almacenamiento-minimo.md`, an
ADR-073). The study quantifies the problem:
today the
creation persists the
API's
**full
snapshot** (the
synopsis, cast,
genres, trailer, saga, platforms...) into
Firestore and the daily run `checkForUpdates` (ADR-021) **re-queries and rewrites it every
day** for all non-manual items (~75 API calls per day for an average
user), with a truthy-only policy.

That cost has no counterpart on the
UI: the profile's fields are only read when opening the
modal, and the stored data become
stale
just the same
between runs. The study proposes (its
section 10) the
**A2**
hybrid +
the
A5-a
minimal
run, which is what this ADR implements.

## Decision

### 1. Minimum storage on creation (A2)

`minimalStoredFields(details, type)` (the
`js/search.js`) filters the expanded snapshot and persists
**only**:

- **the card**: the
`title`, `year`, `coverUrl`, `externalId`;
- **notices and badges**: the
`releaseDate`, `firstAirDate`, `nextEpisodeToAir`
(and its
local copy
`nextEpisodeAirDate`), the
`seasonAirDates`,
the
`awaitingRelease`,
`releasedNoticedAt`,
`lastNotifiedEpisode`, the
`status`/`autoStandbyAt`;
- **the community rating**: the
`communityRating` (the
card paints it).

**The books' exception** (the
study §8.1): they keep the
`author`, `pages` and
`description` — the
card and book modal paint them instantly and
always having to recorver
them, i.e. the
fetching would require network.

The profile's fields (the
`overview`, `runtime`,
`episodeRuntime`, `genres`,
`cast`, `director`, `creators`,
`trailerUrl`, the
`collectionId`/`Name`/
`Poster`, the
`platforms`, `developers`,
`publishers`, `esrbName`,
`metacritic`,
`playtime` (the games)) go into the
`ON_DEMAND_DETAIL_FIELDS`
(the
`js/constants.js`) and are **not persisted** on the new creations (the
search, watched,
saga, recommendation).

### 2. The profile on demand (A2)

- js/item-details.js — a `needsDetailFetch(item)`
 and
  `loadItemDetails(item)`:
  if the item lacks details it fetches
  the
  API with the **24 h in-memory cache**
  the
  `getMovieDetails`/`getTvExtraDetails` already used
  (the
  `js/api-movies.js`, the same cache as the
  `getWatchProviders`); it never
  throws
  (a
  graceful degradation on network failure).
- The
  `js/modal-handlers.js` — the
  `loadDetailsForModal(item, ctx, rerender)`
  wired into the
  `openMovieItem`/`openTvItem`/`openGameItem`:
  a
  loading placeholder («Cargando
  detalles…»), a
  re-render when the data arrive and the
  **stale-while-revalidate** of the
  `coverUrl`/`communityRating` (cover/rating
  changes
  persist back, the rest does not).
- The
  `js/ui.js` — the
  `extraInfoHtml`
  degrades to the
  `detailStatusHtml` when there are no details; the
  `openReadOnlyModal`
  (a friend's
  profile) loads on demand with a
  degradation to a
  "card only" and **without
  writes** to Firestore.
- The
  `js/api-games.js` — an IGDB
  throttle ≤ 4 req/s
  (the
  `IGDB_MIN_INTERVAL_MS = 250`) as a
  formal
  rate-limiter to not collide with the API's own per-second allowance
  when opening several game profiles in a row.

### 3. The minimum daily run (A5-a)

`checkForUpdates` (the
`js/daily-check.js`) no longer heals
metadata: it only queries the APIs for what **can generate a notice**:

- **Movies**: only those awaiting a release (the
  `movieNeedsCheck`:
  an
  `awaitingRelease` or a future
  `releaseDate`
  not watched — the old
  items'
  backfill). The
  `releaseDate` is refreshed
  if changed and the release notice rendered.
- **Series**: only those awaiting a release or with
  an
  unaired
  next
  episode
  (the
  `showNeedsCheck`,
  via
  the
  `getNextEpisodeAirInfo`). The
  notices
  (premiere,
  new
  episode,
  the
  blocked one's release) are kept and the
  auto-standby evaluated with fresh
  data. For
  **ongoing
  series with an already-aired
  episode**,
  the
  auto-standby
  (ADR-033) is evaluated **without
  network**,
  with the stored
  data (the new loop
  `offlineStandbyShows`).
- **Books**: only the
  `/works/` **without a
  stored synopsis**
  (an Open Library
  book); the truthy-only policy stays.
- **Video games**: without network, as until
  now
  (the release
  notice with stored data, ADR-071).

With the
  cache of
  24 h, a profile
  consulted today
  does not repeat its call in the
  run. The
  concurrency
  (a
  pool of
  4),
  the
  abort
  per
  consecutive
  failures
  and the
  daily
  guard
  `lastReleaseCheckAt` stay
  intact.

### 4. "Sync
now" → "Check
releases"

The
  Settings'
  button is redefined
  with the minimal run's scope
  (revalidating pending releases), keeping the
  **30-min
  cooldown**
  (the
  `profile.lastManualSyncAt`) and the
  status
  toasts. The
  `syncNow` and the
  `isSyncRunning`
  keep
  their shape.

### 5. The existing data's migration (deferred cleanup)

`js/migration.js` — the
  `runStorageMigration(uid, ctx)`: **once per user**
  (the
  `profile.storageMigration = "200-a2"` marker), it prunes the
  old documents' fields of the
  `ON_DEMAND_DETAIL_FIELDS`
  (the
  `deleteField`
  per
  field
  present; **the
  books keep the
  `description`**).
  It is idempotent, best-effort and
  fail-open: if it fails it does not
  block the startup and
  retries on the next session. It fires
  from the
  `app.js` after the login, in
  parallel with the
  subscriptions. The
  profile recovers
  those fields on demand, so the
  pruning is invisible to the
  user and reduces the
  documents'
  billed size.

### 6. The caches and the version

`scripts/bump-version.sh 20260926` — the
  `APP_VERSION`/refs of the
  `?v=` to
  the
  20260926
  (the
  SW invalidates the static cache); `DYNAMIC_MAX_ENTRIES`
  50 →
  100
  (the
  on-demand profile caches more images on the
  dynamic cache).

## Rejected alternatives

A summary of the study's section 10
 (the detail is in the
 ADR-073):

- **A1 (a strictly total minimum) and the
  B/B2/B3**:
  rejected for the
  functionality's loss
  (the cards' community
  ratings, the
  activity-date ordering) or for the
  complexity without
  benefit.
- **Keeping
  the
  ADR-021 (a full daily refresh)**:
  rejected
  for the
  cost's
  sake of
  ~75
  calls/day without
  real
  consumption
  (the
  fields are only read when opening the profile); the A2 + the
  A5-a reduce the daily calls to
  the
  items with pending notices
  (usually
  0-2), keeping all the
  notifications.
- **Persisting the synopsis on the books' creation**:
  it is kept because of the
  §8.1
  exception
  (the
  card and the
  modal paint it instantly
  ).

## Consequences

- **ADR-021 is partially replaced**: there is no more daily
  metadata healing nor a manual everything-sync; the daily
  guard, the
  `isRefreshing` anti-concurrency, the 30-min
  cooldown and the failure-based
  abort remain in force.
  The
  ADR-020 (the
  `awaitingRelease`),
  the
  ADR-033 (the
  auto-standby) and the
  ADR-071 (the games'
  releases) remain in force.
- Series between seasons with no
  announced date stop being queried daily
  (their
  auto-standby is offline); the "an available
  episode"
  notices
  depend on TMDB returning
  the
  `next_episode_to_air`
  with
  a
  today-or-past
  date at the run's
  moment (the same behavior as before: the daily run always
  saw that window on the release day).
- Latencies: the
  profile
  shows the loading placeholder the first time
  (then the 24 h
  cache and the
  partial's
  preload); if the network fails it degrades to
  "card only".
- The migration's benefit is
  deferred until each user's
  first session after the
  deploy (a single pruning, idempotent).
- AGENTS.md's rule 3: the
  `docs/manual-de-usuario.md`'s
  §§16-17 rewritten
  ("Check releases", the data on demand).

## Touched files

| File | Change |
|---|---|
| `js/constants.js` | `ON_DEMAND_DETAIL_FIELDS` (the on-demand fields' list) |
| `js/api-movies.js` | The 24 h cache in `getMovieDetails`/`getTvExtraDetails` |
| `js/api-games.js` | The IGDB throttle ≤ 4 req/s |
| `js/item-details.js` | **New**: `needsDetailFetch`/`loadItemDetails` |
| `js/search.js` | `minimalStoredFields`; creations without enrichment |
| `js/modal-handlers.js` | `loadDetailsForModal` (on-demand + stale-while-revalidate) |
| `js/ui.js` | `detailStatusHtml`; `openReadOnlyModal` on-demand (friends) |
| `js/daily-check.js` | The A5-a minimal run (`movieNeedsCheck`, `showNeedsCheck`, the offline auto-standby) |
| `js/migration.js` | **New**: a one-off pruning per user (`storageMigration`) |
| `js/app.js` | The migration firing after the login |
| `js/firebase.js` | A `deleteField` re-export |
| `js/settings.js` + `index.html` | The "Check releases" button |
| `service-worker.js` + `js/config.js` | The 20260926 version, `DYNAMIC_MAX_ENTRIES` 100 |
| `docs/manual-de-usuario.md` | §§16-17 rewritten |
| `docs/adr-021-db-data-sync.md` | Noted as partially replaced |

Related issue: #200 — https://github.com/gonzalitojh/Registro-personal/issues/200
