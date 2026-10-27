# ADR-073: Minimum database storage study — the A2 + A5-a minimal-run hybrid is adopted for a future implementation (issue #183)

## Status
Accepted (a study decision: it defines the strategy to implement in a future
issue; this issue implements nothing).

## Date
2026-08-10

## Context

Issue #183 asks to **carry out a study, without implementing anything**,
on the possibility of a save of **minimal information in the database**,
in such a way most of the information is pulled directly from the APIs
(TMDB, Google Books, Open Library, IGDB). The issue itself poses
the central question: would storing only the id and the watch/rating
data be too little (an API overload), or is it better to store the cards'
basic information and query the APIs when viewing the information?

The starting point, verified against the real code (study section 3):

- A **100 % client architecture**: Firebase Hosting, vanilla JS, a PWA with
  a service worker (`js/firebase.js:7-29`), no backend of its own except
  IGDB's proxy (ADR-067). The data live in Firestore with the model
  `users/{uid}/movies|series|books|games` and `users/{uid}/notifications`
  (`js/db.js:1-14` and `:33-38`).
- **Full save on creation**: movies/series/games persist the APIs'
  enriched snapshot when the item is added (the search's snapshot +
  `getMovieDetails`/`getTvExtraDetails`/`getGameDetails`), and there is a
  **massive daily refresh** with a **truthy-only** policy (ADR-021) querying
  the APIs for **all** non-manual items: movies, series (including
  abandoned ones) and Open Library books; games do not refresh. An item
  without a `releaseDate` would remain `awaitingRelease` forever
  (`isUnreleasedDate(null)` is true, `js/release.js:13-15`).
- **Consumers**: cards, the modal profile, series' progress, release
  notices, friends, the feed, ICS, backup/restore, statistics and sorting
  read almost everything from the Firestore document (section 3.4); only
  the profile already makes live calls (providers/similar, 24 h cached,
  `js/api-movies.js:227-243`).
- **Existing caches**: a service worker with `networkFirst` for the APIs
  and Firestore GETs (`service-worker.js:305-322`) and a 50-entry cap in the
  dynamic cache (`DYNAMIC_MAX_ENTRIES`, `:21`).

**Why the study was needed**: the current cost (the A0 baseline, study
section 3.7) is **proportional to the library's size** and grows with
ADR-021's full coverage: ~445 API calls/day/user (410 TMDB +
~35 Open Library), ~120 Firestore writes/day, ~10,100 reads/day and
~2.2 MB/user (480 items). Although the limits are not hit today
(Spark: 50,000 reads/day, 20,000 writes/day, 1 GiB), the risk of
overloading the APIs with repeated TMDB/IGDB calls (4 req/s) is
the issue's explicit concern and justifies quantitatively evaluating what
should be stored.

The study is already **done and validated (QA PASS)**:
`docs/estudio-almacenamiento-minimo.md` (788 lines, evidence verified
against the real code and each API's official limits consulted on
2026-08-10). Its verdict: **it is feasible and advisable to store less
information in Firestore, but there is no need to go to the extreme of
storing "only the id"**. This ADR documents the decision/conclusion
retrospectively, as ADR-065 and ADR-067 did for their studies, and fulfills
`tasks/task-issue-183.json`'s definition of done («ADR documentando
la decisión/conclusión del estudio (with 'Related issue: #183')»).

Related issue: #183 — https://github.com/gonzalitojh/Registro-personal/issues/183

## Decision

**The A2 hybrid is adopted (card fields + notification fields in
Firestore; profile details on demand with a cache) complemented by the A5-a
minimal daily run**, as the strategy for a future implementation
issue — **out of this issue's scope**, which implements nothing
(the study's sections 4.2, 4.5 and 8). Against the status quo it means, per
average user and day (sections 6 and 7; all figures are estimates
declared in section 6):

- **API calls**: ~445 → **~125** (~-72 %); the daily run goes from
  ~445 to **~70** (~-85 %).
- **Firestore writes**: ~120 → **~35** (~-70 %).
- **Storage**: ~2.2 MB → **~0.9 MB** (~-59 %; Annex A.1).
- **Firestore reads**: intact (~10,100/day): they depend on the
  documents' number, not the fields'.
- **Cards' latency**: instant and offline-capable in all the alternatives
  that store the card.

### Fields to ALWAYS store in Firestore (study section 8.1)

| Group | Fields |
|---|---|
| Identity + card | `externalId`, `type`, `title`, `year`, `coverUrl` |
| User's data | `status`, `rating`, `notes`, `watchLog`, `watched` (+ `nextEpisode`, `firstWatchedAt`, `lastWatchedAt`, `timesCompleted`, `history`), `readLog`, `playLog`, `progress`, `manual` |
| Notices (notifications) | `releaseDate`, `firstAirDate`, `nextEpisodeToAir`, `nextEpisodeAirDate`, `seasonAirDates`, `awaitingRelease`, `releasedNoticedAt`, `lastNotifiedEpisode` |
| Control | `manual`, `addedAt`, `updatedAt` |
| Community rating | `communityRating` (**an explicit decision**: the card shows it, `js/ui.js:46-53`; storing it avoids a call per card and its freshness is recovered with *stale-while-revalidate* when opening the profile) |
| Books (a justified exception) | `author`, `pages`, `description` |

The books exception: the book's card and profile paint them
instantly and
the book profile has no detail call (Google Books/Open Library only
give the description in the search); re-querying the synopsis on every opening
would add per-item calls with no value.

### On-demand fields, with a 24 h in-memory cache + the SW's `networkFirst` (section 8.2)

`overview`/`description` (not books), `runtime`, `episodeRuntime`, `genres`,
`cast`, `director`, `creators`, `trailerUrl`, `collectionId/Name/Poster`
(movies), `platforms`, `developers`, `publishers`, `esrbName`,
`metacritic`, `playtime` (games). They are all only consumed in the profile
(`extraInfoHtml`, `js/ui.js:623-665`), which already makes live calls to
`getWatchProviders`/`getSimilarMovies` with the existing 24 h cache
(`js/modal-handlers.js:115` and `:126`).

### The A5-a minimal daily run (section 4.5)

The run queries the API **only** for `awaitingRelease` items
(unreleased movies/series/games) and **ongoing
series** with a pending `nextEpisode` (detecting a new episode and
auto-standby, ADR-033), plus `/works/` books without a synopsis: ~65
TMDB + ~5 Open Library ≈ **~70 calls/day** (vs
445), keeping 100 % of today's notice system. The A5-d variant (asking
 only the notification fields) is practically
equal to A5-a and does not reduce the per-item calls further, so
A5-a is assumed.

### The quantitative rejection of the issue's literal option (section 4.1)

**Storing only `externalId` + user/watch data (A1) is quantitatively
rejected**: without `title`/`coverUrl`/dates in the document, the app does
not paginate the cards (`renderGrid`/`renderList` paint the whole array,
`js/ui.js:342-381` and `:455-498`), so:

- Opening the movies tab = **~300 TMDB calls** (one per card):
  ~23 s with the daily-check's pool
  4, ~15 s with the browser's ~6-connections limit
  per host.
- Opening the video games tab = **~30 IGDB calls ≈
  a 7.5 s minimum** due to the 4 req/s limit; with 3 simultaneous users,
  90 calls =
  22.5 s.
- Friends = **M×N calls per visit** (~960 for 2 friends of medium size,
  with ~15 s for the games alone); the feed would add the same. The quota
  fires at the API-account level, shared among friends.
- **It does not save the notice run**: with
  no `releaseDate`/`nextEpisodeToAir` in the DB, the daily run would keep
  calling TMDB for all the items (~410
  calls/day).
- **It breaks the PWA's offline mode** (the `networkFirst` SW cannot
  paint cards without network) and **degrades local consumers**
  (live alphabetical/year sorting, statistics, ICS).

## Rejected alternatives

- **A1 — Only `externalId` + user data, everything else live**
  (section 4.1): rejected with numbers (see the previous rejection): it
  collapses the UX with spikes of 300 calls per tab and 960 per
  friend, breaks offline and does not save the notice system's
  calls.
- **A3 — Local-only storage (IndexedDB/localStorage)** (section
  4.3): rejected — it breaks friends and the feed (they read other users'
  documents, `firestore.rules:36-57`), multi-device (the PWA uses
  Firestore as the only shared source) and release notifications
  (the daily run compares dates in the cloud); backup/ICS/statistics would
  become per-device.
- **A4 — A proxy / centralized cache layer (an IGDB Worker-like
  one, precedent ADR-067)** (section 4.4): rejected now — for 3 users it
  does not pay off (a profile opened by 2 friends generates 2 calls
  anyway; the marginal saving does not justify running a new service and
  it would break the no-backend architecture). It stays documented as the
  **future option if the group grows**
  (the M=10 scenario).
- **A5-b — No run (only *stale-while-revalidate* in the profile)**
  (section 4.5): rejected — it breaks the notices: an item the
  user never opens would never be notified.
- **A5-c — A weekly run** (section 4.5): rejected — it delays release/
  episode notices by up to 7 days; with M=3 users A5-a's cost is already
  low and does not merit the UX risk.
- **A5-d — A daily run only with notification fields** (section
  4.5): in practice it is A5-a (TMDB has no "lite" endpoint for dates);
  it provides no distinct alternative.

## Consequences

### Positive

- **Cost savings** (per average user and day): ~-72 % of API calls
  (with -85 % in the daily run), ~-70 % of Firestore writes and ~-59 %
  of storage, leaving the reads untouched (sections 6 and 7).
- **Cards, friends, the feed, ICS, backup and statistics keep working
  without API calls**: everything they consume is in the stored
  document (section 3.4).
- **It leverages existing caches**: the 24 h memory one
  (`js/api-movies.js:227-243`)
  and the service worker's `networkFirst`
  (`service-worker.js:305-313`) for the profiles
  on demand.
- **No new infrastructure**: the 100 % client architecture is kept;
  nothing to deploy or watch.
- **Offline preserved**: cards always; profiles after the first visit
  (the PWA's current pattern, section 3.5).

### Negative / Risks

- **Loss of metadata freshness in cards/profile** (covers,
  `communityRating`, collection, trailer stopped being healed
  daily; section
  8.3.1): a mandatory mitigation in the implementation — *stale-while-
  revalidate* when opening the profile (the cover/rating's
  `updateItem`, ~20 writes/day;
  the risks R1-R3 of section 9).
- **The service worker's 50-entry cap** (`DYNAMIC_MAX_ENTRIES`): with 480
  items the LRU quickly evicts the profile's responses; mitigation — a
  details cache in IndexedDB by `externalId`+type and/or raising the cap
  (section 8.3.3, risk R1).
- **IGDB at 4 req/s**: the games' on-demand enrichment must
  serialize with a **throttle ≤ 4 req/s** (reusing `mapConcurrent` of
  `js/daily-check.js:80-96` or a semaphore; section 8.3.5, risk
  R2).
- **Backup/restore stops including profile metadata** (synopsis, cast,
  trailer): a restore would bring cards without details until opening each
  profile; acceptable if re-enriched on restore (section
  8.3.6).
- **The "Sincronizar ahora" button (ADR-021) loses its full-healing
  scope**: it would have to be redefined («revalidate pending
  releases», keeping the 30 min cooldown; section 8.3.7, risk
  R9).
- **Migration of the existing documents** (~480×M with leftover
  metadata): **coexistence first** is mandatory (ignore the old
  fields) and field cleanup only after validating the profiles
  on demand; never delete beforehand (section 8.3.8, risk R5).
- **Release notices require keeping the A5-a minimal run**: the issue
  asked about «not maintaining a database data update»;
  with A2+A5-a there is a daily run, but ~85 % cheaper and limited to the
  relevant items (section 8.3.2). The "zero run" (A5-b) is
  rejected.
- **Read-only friend profiles**: if the friend did not open that
  profile, the reader makes the fetch on-demand (the reader's quota)
  or sees only the card — a documented graceful
  degradation (section 8.3.4).

### Neutral

- **No UX changes now**: this issue implements nothing; the strategy
  is fixed for the future implementation issue.
- **The study remains as a reference**: `docs/estudio-almacenamiento-minimo.md`
  (788 lines, QA PASS) serves as quantitative evidence (section 6's
  model, section 11's API limits) and as the
  starting point for the implementation (the future work sketched in
  section 10: creation without enrichment, the profile on demand, the
  IGDB throttle, the A5-a run, the redefinition of "Sincronizar ahora",
  migration, the user manual and ADR-021).
- **ADR-021 is not modified** by this decision; its current policy
  remains in force until the
  implementation issue.

## Created/modified files

| File | Change |
|---------|--------|
| `docs/adr-073-estudio-almacenamiento-minimo.md` | **New**: this document |
| `docs/estudio-almacenamiento-minimo.md` | **New in this issue**: the full study (788 lines, QA PASS) whose conclusion this ADR documents — it is not modified |
| `tasks/task-issue-183.json` | **New**: the definition of done (criterion "ADR documenting the study's decision/conclusion (with 'Related issue: #183')") that this ADR fulfills |

**No code file is modified**: the issue was "without implementing
anything" (its acceptance criterion no. 8: `js/`, `css/`, `index.html`,
`service-worker.js`, `firestore.rules`, `cloudflare/` nor `config` are
untouched). All the routes and lines cited in this ADR are evidence of the current
state, verified in the study (section 3).

Related to: docs/estudio-almacenamiento-minimo.md

Related issue: #183 — https://github.com/gonzalitojh/Registro-personal/issues/183
