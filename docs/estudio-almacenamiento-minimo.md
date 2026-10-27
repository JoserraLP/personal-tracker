# Study of minimum database storage (issue #183)

## Date

2026-08-10

## Issue

#183 — «Estudio almacenamiento mínimo» [Minimum storage study]: carry out a
study, without implementing anything, on the possibility of storing a minimal
set of information in the database, so that most of the information is pulled
directly from the APIs (TMDB, Google Books, Open Library, IGDB).
https://github.com/gonzalitojh/personal-tracker/issues/183

## Status

Study finished, **no implementation**: this document does not contribute or
propose any code to the application (acceptance criterion no. 8: no file
outside `docs/` and `tasks/` is modified).

---

## 1. Executive summary

**Verdict: it is feasible and advisable to store less information in
Firestore, but there is no need to go to the extreme of storing "only the
id".** The optimal alternative is a **hybrid (A2)**: persist in the database
everything the interface needs to paint cards and notices without network
(card fields + notification fields), and request from the APIs on demand
(with cache) everything that is only seen when opening the item card
(synopsis, cast, director, trailer, collection/saga, platforms, developers,
etc.). Complemented by a **minimum daily pass (A5-a)** that only queries the
API for items pending release and series in progress, the estimated API cost
saving is ~72 % versus the status quo, without degrading the offline
experience or the social features (friends, feed, notifications).

The literal option from the issue («store only the id and the viewing and
rating data») **is rejected with data**: opening the movies tab would require
~300 calls to TMDB (one per card), opening the video games tab ~30 calls to
IGDB (7.5 s minimum due to the 4 req/s limit), the friends section O(n·m)
calls per visit, and it would not save the calls of the daily notice pass,
because `releaseDate`/`nextEpisodeToAir` would not be in the database. It
would also destroy the PWA's offline experience and the local statistics and
sorting (sections 4.1 and 7).

At-a-glance table (detail in sections 4 and 7; all figures are
**estimates** with the assumptions of section 6):

| Criterion (average user, daily values) | A0 status quo | A1 only id + user | A2 hybrid (proposed) | A3 local only | A4 proxy/central cache |
|---|---|---|---|---|---|
| API calls | ~445 | ~5,000-6,700 (with social use; UX collapse, breaks offline) | **~125** | 0 (but breaks everything social) | ~125 + backend |
| Firestore writes | ~120 | ~20 | **~35** | 0 | ~35 |
| Firestore reads | ~10,100 | ~10,100 (same number of docs) | ~10,100 | _n/a_ | ~10,100 |
| Storage (480 docs) | ~2.2 MB | ~0.45 MB | ~0.9 MB | _n/a_ | ~0.9 MB |
| First tab render latency | instant | 15-23 s (movies) / 7.5 s (games) | **instant** | instant | instant |
| Offline (PWA) | cards + visited cards | only visited items | **cards + visited cards** | total offline of the device itself, but no friends and no multi-device | same as A2 |
| Friends and feed | complete | extremely slow (M×N calls) | **complete** | broken (firestore.rules) | complete |
| Release notifications | full daily pass | full daily pass (no saving) | **minimum pass (A5-a)** | broken (no backend) | minimum pass |
| Complexity / migration risk | — (baseline) | high (rewrite of all consumers) | **medium** | medium (and abandoning Firestore) | high (new infrastructure) |

---

## 2. Scope and methodology

**What is studied**: the cost (Firestore and APIs), latency, offline
experience and functionality of all the app's data consumers under different
storage strategies: how many fields to store per item and which ones to
fetch live from the APIs. The risk of overloading the APIs is evaluated
quantitatively and a concrete set of fields to persist is recommended.

**What is NOT studied/done**: nothing is implemented. No code file is
touched (`js/`, `css/`, `index.html`, `service-worker.js`,
`firestore.rules`, `cloudflare/`, `config`). This document cites real paths
and lines of the current state only as evidence.

**Methodology**:

1. **Reading the current state**: `js/db.js`, `js/search.js`,
   `js/daily-check.js`, `js/api-movies.js`, `js/api-games.js`,
   `js/api-books.js`, `js/ui.js`, `js/modal-handlers.js`, `js/profile.js`,
   `js/activity-feed.js`, `js/tv-progress.js`, `js/release.js`,
   `js/sorting.js`, `js/settings.js`, `js/export-ics.js`,
   `js/export-backup.js`, `service-worker.js`, `firestore.rules`,
   `README.md` and ADR-021, ADR-067, ADR-025, ADR-062, ADR-065 and ADR-066,
   among others, were read and verified (via `grep`/`read`, with the real
   lines cited in each section).
2. **Documented limits of each API**: consulted in the official sources with
   consultation date (2026-08-10) in section 11.
3. **Declared quantitative model**: without real usage telemetry (the app
   records no metrics), all traffic figures are **estimates** built on a
   declared user profile (section 6). Any figure without an external source
   is marked as an estimate with its assumptions.

**Limitations**: there is no real document size data (Firestore could not be
measured from this environment); per-document sizes are structure estimates
based on the fields stored at registration (section 3.2). The effective
write limit of Firebase Spark (20,000/day) comes from the official Firebase
documentation; `README.md:307` only documents 50,000 reads/day and 1 GiB.
API limits can change without notice (TMDB: «this number can change at any
time», section 11).

---

## 3. Current state

### 3.1 Data architecture and rules

The app is 100 % client-side (Firebase Hosting, vanilla JS, PWA with service
worker, `js/firebase.js:7-29`). Data lives in Firestore with a model of user
→ subcollections by type:

- `users/{uid}/movies/{id}`, `users/{uid}/series/{id}`,
  `users/{uid}/books/{id}`, `users/{uid}/games/{id}` and
  `users/{uid}/notifications/{id}` (`js/db.js:1-14` and
  `COLLECTION_BY_TYPE` in `js/db.js:33-38`).
- `users/{uid}` (profile document) stores email, name, photo and stamps of
  the daily pass (`lastReleaseCheckAt`, `lastManualSyncAt`;
  `js/db.js:44-46`, `js/daily-check.js:467` and `:525`).

`firestore.rules:21-27` allows signing up to only 3 emails (the "friends");
each user writes only to their own documents and **any authorized user can
read any other's documents** (`allow read: if isAllowedUser()` in
`firestore.rules:36-57`) — prerequisite of the Friends and feed sections
(ADR-015). Notifications are private (`firestore.rules:60-62`).

### 3.2 Fields stored at registration, by type

All persistence is built at registration in `js/search.js` (`handleAdd`,
`doAddBook`, `handleAddSeen`, `handleManualAdd`) and updated with user
actions and with the daily pass. Verified in the real code:

**Movies** — draft in `js/search.js:171-182` (normal route and
`js/search.js:429-442` in "marked as watched"), enriched with
`getMovieDetails` (`js/search.js:187-189`) and overwritten daily:

| Field | Source | Function/consumer |
|---|---|---|
| `externalId`, `type`, `title`, `year`, `coverUrl`, `author`, `pages` | search result (TMDB) | identity + card (grid/list, `js/ui.js:342-381` and `:455-498`) |
| `status`, `rating`, `notes`, `watchLog` | user (statuses, rating, notes, watch log) | cards, card detail, sorting (`js/sorting.js:81-107`), feed (`js/activity-feed.js:44-54`), statistics |
| `runtime`, `overview`, `genres`, `cast`, `director` | `getMovieDetails` (`js/api-movies.js:146-150`) | card detail (`extraInfoHtml`, `js/ui.js:623-665`) |
| `releaseDate`, `communityRating`, `trailerUrl` | `getMovieDetails` (`js/api-movies.js:151-153`) | release notice + badge «Aún no estrenada» [Not yet released] (`upcomingBadge`, `js/ui.js:326-340`; `release.js:13-15`) and community rating on the card (`js/ui.js:46-53`) |
| `collectionId`, `collectionName`, `collectionPoster` | `getMovieDetails` (`js/api-movies.js:154-158`) | saga/collection in card detail and «Añadir resto de la saga» [Add rest of the saga] |
| `awaitingRelease`, `releasedNoticedAt` | notice logic (`js/daily-check.js:271-281`) | notification bell |
| `manual` (manual registration only), `addedAt`, `updatedAt` | registration/write (`js/db.js:96-109`) | daily pass filters (`js/daily-check.js:264`) and sorting (`js/sorting.js:81`) |

**Series** — draft in `js/search.js:171-182`, enriched with
`getTvExtraDetails` (`js/search.js:200-206`) + the user's series state
(`js/search.js:194-199`):

| Field | Source | Function/consumer |
|---|---|---|
| `externalId`, `type`, `title`, `year`, `coverUrl` | search (TMDB) | card (same as movies) |
| `watched`, `nextEpisode`, `firstWatchedAt`, `lastWatchedAt`, `timesCompleted`, `history` | user (episode progress) | card detail, progress (`js/tv-progress.js:48-85`), feed (`js/activity-feed.js:57-154`), sorting, statistics |
| `status`, `rating`, `notes` | user | cards, card detail, feed, statistics |
| `episodeRuntime`, `overview`, `genres`, `cast`, `creators` | `getTvExtraDetails` (`js/api-movies.js:195-199`) | card detail (`extraInfoHtml`) |
| `firstAirDate`, `tmdbStatus`, `nextEpisodeToAir`, `communityRating`, `trailerUrl` | `getTvExtraDetails` (`js/api-movies.js:200-210`) | release badge, premiere/new episode notice (`js/daily-check.js:321-342`), blocked sorting |
| `seasonAirDates` (map season→date, null = not yet aired) | `getTvExtraDetails` (`js/api-movies.js:212-215`), normalized in `seasonAirDateMap` (`js/api-movies.js:81-85`) | «not released» notices even if TMDB stops returning `next_episode_to_air` (ADR-025; `js/sorting.js:20-36`; live refresh in `js/modal-handlers.js:420-435`) |
| `nextEpisodeAirDate` (persisted backfill) | daily pass (`js/daily-check.js:139-143` and `ensureNextEpisodeAirDate` `:171-194`) | between-seasons notices |
| `manualEpisodeCount` (manual registration only) | `js/search.js:634` | progress of manual series |
| `awaitingRelease`, `releasedNoticedAt`, `lastNotifiedEpisode` | notice logic | notification bell |

**Books** — draft in `js/search.js:66-80` (`doAddBook`) and
`js/search.js:277-291` (`doAddBookSeen`):

| Field | Source | Function/consumer |
|---|---|---|
| `externalId`, `type`, `title`, `year`, `coverUrl`, `author`, `pages` | Google Books (primary; `js/api-books.js:146-160`) or Open Library (fallback; `js/api-books.js:212-234`) | card and card detail |
| `status`, `rating`, `notes`, `progress`, `readLog` | user | cards, card detail, feed (`js/activity-feed.js:156-173`), statistics |
| `description` | Google Books in the result, or Open Library on demand at registration (`js/search.js:84-90`; `js/api-books.js:238-247`) | card detail (`extraInfoHtml`, `js/ui.js:661-662`) |

**Video games** — draft in `js/search.js:134-144` and `js/search.js:365-376`,
enriched with `getGameDetails` (`js/search.js:146-152`; `js/api-games.js:202-228`):

| Field | Source | Function/consumer |
|---|---|---|
| `externalId`, `type`, `title`, `year`, `coverUrl` | IGDB search (`js/api-games.js:144-159`) | card |
| `status`, `rating`, `notes`, `playLog`, `progress` (manual only) | user | cards, card detail, feed (`js/activity-feed.js:175-190`), statistics (ADR-070) |
| `description`, `genres`, `platforms`, `developers`, `publishers`, `esrbName`, `metacritic` (always null), `playtime` (always null) | `getGameDetails` (`js/api-games.js:209-221`) | card detail (`extraInfoHtml`, `js/ui.js:643-660`) |
| `releaseDate`, `communityRating`, `trailerUrl` | `getGameDetails` / `mapGameResult` | release notice (ADR-071; `js/daily-check.js:434-464`), badge, IGDB community rating |
| `awaitingRelease`, `releasedNoticedAt` | notice logic (`js/daily-check.js:443-456`) | bell |

Notes on this section (verified in the code):

- Registration always pulls the **full enriched snapshot**: movies and
  series call `getMovieDetails`/`getTvExtraDetails` at registration
  (`js/search.js:187` and `:201`), and games call `getGameDetails`
  (`js/search.js:146`), whose results are `Object.assign`ed to the draft with
  the block «do not block registration if this extra step fails»
  (`js/search.js:153-155`, `:190-192`, `:207-209`).
- `releaseDate` **required to be truthy** for movies/series/games:
  `isUnreleasedDate(null)` returns true (`js/release.js:13-15`) and an item
  without a date would stay `awaitingRelease` forever (`js/search.js:149-152`).
- Manual items store the synthetic `externalId` `manual-…`
  (`js/search.js:606-608`) and `manual: true`; they are excluded from the
  daily pass and from TMDB notices.

### 3.3 Daily refresh and synchronization (ADR-021)

`js/daily-check.js` (`checkForUpdates`, `:217`) executes a daily pass per
user and a «Sincronizar ahora» [Sync now] button (`syncNow`, `:491`;
ADR-021). Verified mechanics:

- **Full coverage**: all non-manual items with `externalId` (movies `:264`,
  series «including abandoned ones» `:302`, Open Library `/works/` books
  `:406`) are queried from the API and overwritten with a **truthy-only**
  policy (`buildMovieUpdates` `:102-119`, `buildTvUpdates` `:123-158`,
  `buildBookUpdates` `:162-165`): a field is updated only if the fresh value
  is non-empty. Exception: `nextEpisodeToAir`/`seasonAirDates` are always
  overwritten (`js/daily-check.js:133-144` and `:154-156`, documented in
  ADR-021).
- **Video games are NOT refreshed**: the pass never queries IGDB
  (`js/daily-check.js:10-12` and `:434-464`); it only warns about releases
  with the stored data (ADR-071 criterion).
- **Pass limits**: pool of 4 concurrent requests
  (`REFRESH_CONCURRENCY = 4`, `:26`, with `mapConcurrent` `:80-96`), abort
  if more than 5 consecutive failures chain up (`MAX_CONSECUTIVE_FAILURES = 5`,
  `:29`, checked at `:290-295`), 30 min cooldown for manual sync
  (`MANUAL_SYNC_COOLDOWN_MS = 30 min`, `:24`, `:504-509`), daily guard
  `lastReleaseCheckAt === today` (`:248`), anti-concurrency flag
  `isRefreshing` (`:35`, `:238-239`).
- The pass is triggered when the app loads, once per session
  (`maybeTriggerDailyCheck`, `js/app.js:124-129`).

### 3.4 Consumers of the stored fields

What each consumer reads from the document (and with what network
dependency):

| Consumer | File:line | Data used from the document | Network? |
|---|---|---|---|
| Grid/list cards (title, year, cover, status, stars, community rating, progress, release badge) | `js/ui.js:342-381` (`renderGrid`), `:455-498` (`renderList`), `:326-340` (`upcomingBadge`), `:46-53` (`communityRatingHtml`), `:257` (`progressLine`) | almost all fields | no (in-memory snapshot via `onSnapshot`) |
| Modal card detail (extended information) | `js/ui.js:623-665` (`extraInfoHtml`), `openMovieModal` `:965`, `openBookModal` `:1196`, `openGameModal` `:1316`, `openTvModal` `:1554` | runtime/episodeRuntime, overview/description, genres, cast, director, creators, developers/publishers/metacritic/esrbName/playtime, trailer | `js/modal-handlers.js:115` (`getWatchProviders`), `:126` (`getSimilarMovies`), `:443`, `:512` — live calls when opening the card detail, cached 24 h in memory (`js/api-movies.js:227-243`) |
| Series progress | `js/tv-progress.js:48-85` (`computeProgress`), `js/modal-handlers.js:408-437` | `watched`, `seasonAirDates` + **live seasons** from TMDB (`getTvSeasonsMeta`, `js/api-movies.js:90-96`) | seasons yes (the series card detail queries TMDB); `getSeasonEpisodes` with 24 h cache (`js/api-movies.js:102-119`) |
| Release/episode notices | `js/daily-check.js:217-475`, `js/release.js:13-80`, `js/sorting.js:20-60` | `releaseDate`, `firstAirDate`, `nextEpisodeToAir`, `seasonAirDates`, `nextEpisodeAirDate`, `awaitingRelease`, `lastNotifiedEpisode` | daily pass yes (TMDB/OL), games no |
| Friends (read-only) | `js/db.js:65-70` (`getItemsOnce`), `js/profile.js:411-451` (`openFriend`), `js/ui.js:2126-2164` (`openReadOnlyModal`) | point-in-time copy of ALL the friend's documents | Firestore only (no APIs) |
| Activity feed | `js/profile.js:587-630` (`loadActivityFeed`), `js/activity-feed.js:40-202` (`buildFriendFeed`) | `watchLog`, `watched`, `history`, `readLog`, `playLog`, `status`, `updatedAt`, `pages`, `progress` | Firestore only |
| ICS export | `js/export-ics.js:120-197` (`collectUpcomingEvents`) | `nextEpisodeToAir`, `releaseDate`, `title`, `overview`, `playLog`, `status`, `awaitingRelease` | no |
| Backup/restore | `js/export-backup.js:29-93` (`exportBackup`), `:100-240` (`importBackup`) | **complete documents** (metadata included) | Firestore only |
| Statistics | `js/profile.js:72` (`computeStats`), consumed in `js/profile.js:207-217` (`renderStats`→tiles, charts) | `watchLog`, `watched`, `readLog`, `playLog`, `status`, `genres`, `platforms`, `timesCompleted` | no (ctx in memory) |
| Sorting and filters | `js/sorting.js:20-145` (`getSortDate`, `isItemUnreleased`, `applySort`), `js/app.js:115-121` | `watchLog`, `lastWatchedAt`, `readLog`, `playLog`, `releasedNoticedAt`, `releaseDate`, `nextEpisode`, `awaitingRelease` | no |
| Manual metadata editing | `js/ui.js:739-778` (`openEditModal`), `saveMeta` in `modal-handlers.js` | title, year, author, pages, cover (editable fields) | Firestore |
| «Add rest of the saga» search | `js/api-movies.js:166-185` (`getCollectionDetails`) | `collectionId`, `collectionName` of the document | yes, when the button is pressed |
| Recommendations | `js/api-movies.js:284-296` | `externalId` | yes, on demand |

### 3.5 Existing caches and network

- **Service worker** (`service-worker.js`): `cacheFirst` for images from
  TMDB, Open Library and IGDB (`:287-303`); `networkFirst` for
  `api.themoviedb.org`, `www.googleapis.com` and `openlibrary.org`
  (`:305-313`) and for Firestore GET reads (`:315-322`); Firestore writes
  and auth pass through untouched (`:221-234`). The **dynamic cache is
  capped at 50 entries** (`DYNAMIC_MAX_ENTRIES = 50`, `:21`, pruning in
  `trimCache` `:204-212`).
- **24 h in-memory cache** (`js/api-movies.js:227-243`): watch providers and
  season episodes (`getSeasonEpisodes` `:102-119`).
- Offline: card details of previously visited items are served from the SW
  cache (up to 50 URLs); cards come from Firestore (GET cached by the SW
  during network outages).

### 3.6 Platform and API limits (sources in section 11, consulted 2026-08-10)

| Platform/API | Limit | Note |
|---|---|---|
| Firebase Firestore Spark (free) | **50,000 reads/day**, **20,000 writes/day**, **1 GiB storage**, 1 MiB per document | 50K/1 GiB documented in `README.md:307`; 20K writes in the official Firebase documentation |
| TMDB | ~**40-50 req/s** (anti-scraping mitigation ceiling; the official docs say «40 requests per second range» and that it «can change at any time») | no published daily quota; respect 429 |
| IGDB (via Cloudflare Worker `cloudflare/igdb-proxy`) | **4 req/s** | documented in `cloudflare/igdb-proxy/README.md:54` («admite 4 peticiones por segundo» [allows 4 requests per second]) |
| Google Books | **1,000 queries/day per key** by default (configurable daily quota) and ~100 queries/100 s per user | the app README documents retries on 503 (`README.md:288-297`) |
| Open Library | no published limit (courtesy: ~1 req/s recommended by the community) | fallback of Google Books and synopsis on demand (`js/api-books.js:162-247`) |

### 3.7 Estimated current cost (A0 baseline)

With the average profile of section 6 (480 items, M=3 users, L=5 openings,
D=20 card details, V=2 friend visits, 1 daily pass + 1 manual sync/week;
all figures **estimated**):

- **API calls per user and day**: ~410 TMDB (300 movies + 100 series + ~10
  season backfills) + ~35 Open Library (`/works/` books) + 0 IGDB ≈
  **~445**. In the pass, with pool 4 and ~250-400 ms latency per call, the
  spike lasts ~25-40 s per user (asynchronous, in the background).
- **Firestore writes per user and day**: ~100 from the pass (movies ~10 %,
  series ~65 % with `nextEpisodeToAir`/`seasonAirDates`, books ~15 %, games
  ~0) + ~20 from user actions ≈ **~120** (≈ 1.8 % of the daily cap among
  the 3 users: 360 of 20,000).
- **Firestore reads per user and day**: ~486 per app load (4 subscribed
  subcollections + profile + notifications; `onSnapshot`, `js/db.js:79-94`)
  × 5 openings ≈ 2,430 + friend visits (2 × 1,920 = 3,840) + feed
  (1 × 1,920-3,840) ≈ **~10,100** (×3 users ≈ 30,300/day = 61 % of the cap;
  each write snapshot adds extra reads).
- **Storage**: ~2.2 MB per average user (Annex A.1) ≈ 6.6 MB total ≈
  **0.6 % of the Spark GiB** (not a limiting factor).

Baseline conclusion: today the limits are NOT hit, but the API and write
cost is **proportional to the library size** and grows with the full
coverage of ADR-021 (which was precisely the decision of issue #23), and
reads are the component that comes closest to a cap.

---

## 4. Storage alternatives

### 4.0 A0 — Status quo (full snapshot + massive daily refresh)

**What is stored**: everything in section 3.2 (full snapshot at registration
+ daily truthy-only refresh for movies/series/books; games without
refresh).

**Flow**: registration queries the APIs and persists; the daily pass queries
EVERYTHING again and rewrites what changed; the UI reads only from
Firestore.

**Advantages**: zero changes; cards and card details 100 % offline with no
new logic; instant card detail; API data is always curated (ADR-021).

**Drawbacks** (measured in 3.7): ~445 calls/day/user to APIs; ~120
writes/day/user; ~2.2 MB/user; cost scales with N and with the number of
users; duplicates the API's work in the DB (same info in two places, daily
verification that it has not changed).

### 4.1 A1 — Only `externalId` + user data; everything else live

**What is stored**: `externalId`, `type`, `status`, `rating`, `notes`,
`watchLog`/`watched`/`readLog`/`playLog`/`history`/`progress`, and nothing
else. Everything else (title, cover, year, dates, synopsis, community
rating, trailer, collection…) would be requested from the API on every
render and every card detail.

**Quantifying the collapse** (assumptions of section 6; the app does NOT
paginate cards — `renderGrid`/`renderList` paint the whole array,
`js/ui.js:342-381` and `:455-498`):

- **Opening the movies tab = ~300 calls to TMDB** (one per card). With the
  daily-check pool of 4 (~300 ms per call) ≈ **23 s** of loading; with the
  browser limit of ~6 connections per host ≈ **15 s**. Every sort/filter
  change with re-render would request it again (unless building a whole new
  live cache from scratch).
- **Opening the video games tab = ~30 calls to IGDB = 7.5 s minimum** due
  to the 4 req/s limit (section 3.6), plus queue waiting. With the 3 users
  simultaneous, 90 calls = 22.5 s.
- **Friends = M×N calls**: opening the tracker of 2 average-size friends =
  960 calls (TMDB 800 + IGDB 60 with ~15 s just for the games), every time
  the section is opened. The feed (which already reads each friend's whole
  history, `js/profile.js:597-611`) would add the same. The quota spikes at
  the API account level, shared among friends.
- **Notifications: saves nothing**: the release notice requires fresh
  `releaseDate`/`firstAirDate`/`nextEpisodeToAir`, and `isUnreleasedDate`
  needs the date (or absence) per item (`js/release.js:13-15`); without
  those fields in the DB, the daily pass would keep calling TMDB for
  **all** items (~410 calls/day). The only gain would be storing fewer
  bytes.
- **Breaks offline**: without `title`/`coverUrl`/`status` in the document,
  the SW (`networkFirst`, `service-worker.js:305-322`) cannot paint cards or
  the card detail without network; it tears down the PWA and the games'
  «offline daily guard» (`js/daily-check.js:429-433`).
- **Breaks/degrades local consumers**: activity and blocked sorting
  (`js/sorting.js:81-107`), statistics (`js/profile.js:72`, `:207-217`),
  ICS (`js/export-ics.js:120-197`) and the feed depend on stored dates and
  logs (those would be kept), but alphabetical/year order would require
  `title`/`year` live.

**Verdict**: rejected with numbers: it overloads the APIs at tab level
(acceptance criterion 5), destroys the first-render UX, breaks offline and
does not save the notice system's calls.

### 4.2 A2 — Hybrid (the issue's option): card fields + notification fields in DB; details on demand with cache

**What is stored**: the fields the UI needs **without network** (full card:
`externalId`, `type`, `title`, `year`, `coverUrl`, `status`, `rating`,
`notes`, user logs, `releaseDate`/`firstAirDate`,
`nextEpisodeToAir`/`nextEpisodeAirDate`, `seasonAirDates`, `awaitingRelease`,
`releasedNoticedAt`, `lastNotifiedEpisode`, `manual`, `addedAt`/`updatedAt`,
and `communityRating` — see explicit decision in 8.1) and **on demand with
cache** the card-detail fields (`overview`/`description`, `runtime`,
`episodeRuntime`, `genres`, `cast`, `director`, `creators`, `trailerUrl`,
`collection*`, `platforms`, `developers`, `publishers`, `esrbName`,
`metacritic`, `playtime`). Books keep `author`, `pages` and `description` in
the DB because they are fields the card/card detail itself consumes
instantly (see 8.1, justified exception).

**Flow**: registration = store the card in the DB (without the enrichment
call or with it optional, decided in 8/10); tab renders and notifications =
Firestore only (0 API calls); opening a card detail = 1-2 API calls per
item, cached in memory 24 h (already existing pattern:
`js/api-movies.js:102-119` and `:227-243`) and leveraging the SW's
`networkFirst` (`service-worker.js:305-313`) for offline after the first
visit.

**Advantages** (measured in section 7): instant and offline cards; card
detail with 1-2 calls instead of the ~480 already paid today; notifications
intact with the A5-a minimum pass; storage ~-59 %; writes ~-70 %; no new
infrastructure.

**Honest drawbacks** (developed as counterarguments in 8.2): loss of daily
curation of card-detail data; the minimum daily pass is no longer «totally
free» (still needed for notices, though ~7 times cheaper); the first card
opening requires network (or SW cache capped at 50); migration of existing
documents.

### 4.3 A3 — Local-only storage (IndexedDB/localStorage)

**What would be stored**: everything on the device; Firestore would remain
only for identity.

**Why it is rejected with data**:

1. **Friends and feed broken by design**: both read other users' documents
   (`firestore.rules:36-57` expressly allows it; `js/profile.js:411-451`
   and `:587-630`). With no data in Firestore there is nothing to read (or
   writes would have to be duplicated, returning to the original problem).
2. **Multi-device lost**: the app is a PWA used from several browsers;
   Firestore is the only shared source (real-time sync function,
   `js/db.js:79-94`).
3. **Notifications broken**: the release notice is decided in the daily
   pass by comparing dates (`js/daily-check.js:271-281`); without data in
   the cloud, each device would notify independently (or not notify if it
   is closed) and device push (`js/push.js`, ADR-037) would lose its
   common base.
4. **Backup/ICS/statistics** become per-device (today they use Firestore).

**Verdict**: rejected: it solves the network cost at the price of destroying
the project's social and multi-device features, which depend on the data
being in Firestore.

### 4.4 A4 — Proxy layer / centralized cache (IGDB Worker type, precedent ADR-067)

**What it would be**: a lightweight backend (e.g. Cloudflare Worker, like
the existing `cloudflare/igdb-proxy/` — ADR-067) acting as a shared cache of
TMDB/IGDB/GB/OL details with TTL, so that a card detail requested by one
user also serves the others.

**Evaluation**:

- **Real precedent**: the project already has a Worker as an IGDB proxy
  (`cloudflare/igdb-proxy/worker.js`), but it is a **forwarder with no
  cache**: it only hides the Client Secret; IGDB's limit, if A1/A2 were
  adopted, would still apply at the origin.
- **For 3 users it is not worth it**: the TMDB account is unique and
  shared; a card detail opened by 2 friends generates 2 calls all the same.
  The cache only saves when the same item repeats in a short window (an
  effect already covered by the 24 h memory cache and the SW). The marginal
  saving does not justify operating and monitoring a new service (the
  `isRefreshing` function and client-level guards would be more complex).
- **Risk**: a centralized cache returning stale data would attack exactly
  the guarantee ADR-021 established; it would require TTL and version
  invalidation, and the card detail would still need the live call on the
  first user.
- **Future option**: if the group grew (section 6, scenario M=10) and the
  same release were queried many times, this would be the natural next
  step; not today.

**Verdict**: not worth it now; documented as future evolution (section 10).

### 4.5 A5 — Refresh variants over A2

Four variants over the daily pass, evaluated on the same A2 schema:

| Variant | Description | API cost/day/user (average) | Verdict |
|---|---|---|---|
| **A5-a (RECOMMENDED)**: minimum notice pass | Only queries the API for `awaitingRelease` items (unreleased movies/series/games) and series in progress with a pending `nextEpisode` (to detect new episode airing and auto-standby, ADR-033). Books: only the `/works/` ones without `description`. | ~65 TMDB (15 movies + 40 series in progress + ~10 awaiting series) + ~5 OL ≈ **~70** (vs 445) | keeps all notices and auto-standby with ~85 % fewer calls; does not dry out card-detail metadata (on demand) |
| A5-b: no pass (stale-while-revalidate in the card detail) | Zero scheduled pass; the card detail revalidates its data when opened (and stores the result). | ~50-80 (card details only; D=20) | viable if it is accepted that notices depend on the user opening card details: **breaks notices** (an item never opened is never noticed) → rejected as the only path |
| A5-c: weekly pass | Same as A5-a but every 7 days (÷7). | ~10/day on average | saves more, but delays release/episode notices by up to 7 days; with M=3 users the cost is already low → not worth the UX risk |
| A5-d: daily pass with notification fields only | Same as A5-a but requesting only what is necessary (in TMDB, a minimal `append_to_response`). | ~70 (same) | in practice it is A5-a; calls cannot be reduced further per item (TMDB has no lite dates endpoint) |

**Conclusion of A5**: A5-a is the recommended variant: it keeps 100 % of the
current notice system with ~85 % fewer API calls (~445 → ~70) and ~70 %
fewer writes than A0 (~120 → ~35).

---

## 5. Evaluation criteria and metrics

Ten criteria, with their metric and goodness direction:

| # | Criterion | Metric | Better if… |
|---|---|---|---|
| C1 | Firestore cost: reads | reads/day/user (and global) | ↓ |
| C2 | Firestore cost: writes | writes/day/user | ↓ |
| C3 | Firestore cost: storage | bytes per document and total (vs 1 GiB) | ↓ |
| C4 | API calls (TMDB, GB, OL, IGDB) | calls/day/user and **spikes per action** (open tab, open card detail, open friend) | ↓ and no violent spikes |
| C5 | Latency/UX | time to first render of tab and card detail | instant for cards; card detail < 1 s online |
| C6 | Offline/PWA | what can be seen without network (cards, visited card details, pending notices) | cards always; card details after first visit |
| C7 | Friends and feed | number of API calls per visit to Friends/feed section (M×N) | 0 (Firestore only) |
| C8 | Release notifications | detection guarantees (maximum delay) and required calls | detection ≤ 24 h with few calls |
| C9 | ICS / backup / statistics | which fields they need and how much network | no network; self-sufficient from the metadata snapshot |
| C10 | Complexity / migration risk | files to touch, migration of existing data, regression risk | minimal |

---

## 6. Quantitative model

**Base profile (average user)**: 300 movies, 100 series, 50 books,
30 video games = **480 items**. Sensitivity scenarios: small user
(50/20/10/5 = 85), medium (300/100/50/30 = 480) and large (1,000/300/150/100
= 1,550).

**Activity parameters (estimated, no telemetry)**:

| Parameter | Value | Assumption |
|---|---|---|
| M (users) | 3 today (those in `firestore.rules:22-26`); scenario M=10 | small group of friends |
| L (app openings/day) | 5 | browser tabs / reloads |
| D (card details opened/day) | 20 | realistic card-detail browsing |
| V (Friends section visits/day) | 2 | — |
| F (feed openings/day) | 1 | — |
| Daily pass | 1/day (`js/daily-check.js:248`) + 1 manual sync/week | ADR-021 |
| TMDB/OL latency per call | 250-400 ms | home network |
| Pass pool | 4 concurrent (`js/daily-check.js:26`) | real implementation |
| Browser limit per host | ~6 connections | standard HTTP/1.1 |

**Formulas (all figures marked as estimates)**:

- `ApiCalls(A0) = P+S+0.1·S+(0.7·B)` (pass: 1 call per movie and per
  non-manual series + 10 % of series with season backfill + 70 % of books
  `/works/`) → medium: 300+100+10+35 = **445**.
- `ApiCalls(A1, open tab X) = N of the group` (each card live) → movies 300,
  games 30 (≈ 7.5 s at 4 req/s). `Open friend = M·N` (all groups) → 960 for
  2 average-size friends.
- `ApiCalls(A2) = D·(1.2 TMDB + 0.5 OL) + minimumPass` → 20·1.7 = 34 +
  70 ≈ **~105-125**.
- `ApiCalls(A5-a) = 0.05·P + 0.4·S + 0.1·S + 0.1·B` (5 % of movies
  awaitingRelease, 40 % series in progress, 10 % awaitingRelease series, 10
  % of `/works/` books without synopsis) → 15+40+10+5 = **~70**.
- `FirestoreWrites(A0) = ~0.1·P+0.65·S+0.15·B+0.1·G + 20` (user actions) →
  30+65+7+0+20 ≈ **~120**.
- `FirestoreWrites(A2+A5-a) = ~0.02·P+0.1·S+0.02·B + 20` (2 % of
  movies/games with revalidation in the card detail, 10 % of series) →
  6+10+1+20 = 37 ≈ **~35** (rounding; saving vs A0 ≈ **-70 %** in both
  cases).
- `FirestoreReads = (4 collections+profile+bell)·L + V·4collections·N +
  F·(M-1)·4collections·N` → (486)·5 + 2·1,920 + 1·3,840 ≈ **~10,100**
  (identical in A0 and A2: it does not depend on the fields but on the
  number of documents).
- `Space = ΣN_t·avg_size_t` (Annex A.1).

**Sensitivity table** (all columns are estimates; profile → average size per
type according to Annex A.1; average username in bold):

| Scenario | items | A0 storage | A2 storage | A0 calls/day | A2+A5-a calls/day | Firestore reads/day (M=3) |
|---|---|---|---|---|---|---|
| Small (50/20/10/5) | 85 | ~340 KB | ~150 KB | ~85 | ~25 | ~6,500 |
| **Medium (300/100/50/30)** | **480** | **~2.2 MB** | **~0.9 MB** | **~445** | **~125** | **~30,300** |
| Large (1000/300/150/100) | 1,550 | ~7.4 MB | ~3.1 MB | ~1,470 | ~390 | ~107,000 (would require a paid plan or fewer subscriptions) |

*Note: the A2+A5-a calls in the table assume that card details opened per
day (D) scale with the library (≈7 % of items; D = 20 → ~105 in the large
profile, D ≈ 6 in the small one), same as the minimum pass; with D fixed at
20 the figures would be ~47 (small) and ~73 (large), and the conclusions do
not change.*

---

## 7. Comparative evaluation

A0–A5 matrix over the criteria of section 5 (figures for the average user;
assumptions of section 6; ▲ good, ● acceptable, ▼ bad):

| Criterion | A0 | A1 | A2+A5-a | A3 | A4 |
|---|---|---|---|---|---|
| C1 Firestore reads | ● ~10,100/day/user (61 % of the cap with M=3) | ● identical (does not reduce reads) | ● identical | ▼ n/a (not shared) | ● identical |
| C2 Writes | ▼ ~120/day | ▲ ~20 (but with C4 cost) | ▲ ~35 | ▲ 0 (but C7 broken) | ▲ ~35 |
| C3 Storage | ▼ ~2.2 MB/user | ▲ ~0.45 MB | ▲ ~0.9 MB | — | ▲ ~0.9 MB |
| C4 API calls | ▼ ~445/day | ▼▼ ~5,000-6,700/day + **spikes of 300 per movies tab and 960 per friend** | ▲ ~125/day, no spikes | ▲ 0 (social degradation) | ▲ ~125/day |
| C5 Latency | ▲ instant cards and card details | ▼▼ tabs 15-23 s, games 7.5 s minimum | ▲ instant cards; card detail ~0.3-1 s | ▲ | ▲ |
| C6 Offline | ▲ cards + visited card details (SW) | ▼ no offline cards | ▲ cards + visited card details | ▼ local device only | ▲ |
| C7 Friends/feed | ▲ Firestore only | ▼▼ M×N calls per visit | ▲ Firestore only | ▼▼ broken | ▲ |
| C8 Notifications | ▲ 100 % notices ≤ 24 h | ▼ same cost as A0 (no saving) | ▲ notices ≤ 24 h with minimum pass | ▼ broken | ▲ |
| C9 ICS/backup/statistics | ▲ | ● partial (dates/logs yes; card-detail metadata not includable in backup) | ▲ (backup keeps the full card) | ▼ per-device | ▲ |
| C10 Complexity/risk | ▲ (baseline) | ▼▼ total rewrite of renders | ● medium (migration + card details on demand) | ▼▼ abandoning Firestore | ▼▼ new infrastructure |

**Reading the matrix**: A1 and A3 are eliminated by criteria C4-C8 with
quantitative data; A4 shows no benefit for M=3; A2+A5-a wins or ties in all
criteria except for the specific counterarguments of section 8.2 (freshness
of card-detail metadata, first card opening offline), which have mitigations
in sections 9 and 10.

---

## 8. Recommendation and justification

**Adopting A2 (hybrid) with the A5-a refresh variant is recommended** in a
future implementation issue (outside the scope of this study, which
implements nothing). The justification: (1) it is the only alternative that
reduces API traffic (~-72 % of calls, -85 % in the pass) without degrading
UX, offline or social features; (2) it leverages already existing caches
(`service-worker.js:305-313`, `js/api-movies.js:227-243`); (3) the storage
saving, although significant (-59 %), proves that it is not the critical
factor (the real cap is in reads and in the calls/users ratio).

### 8.1 Fields to store ALWAYS in Firestore

| Group | Fields | Reason |
|---|---|---|
| Identity + card | `externalId`, `type`, `title`, `year`, `coverUrl` | without network there is no card (grid/list, `js/ui.js:342-381`) |
| User state | `status`, `rating`, `notes`, `watchLog`, `watched` (+ `nextEpisode`, `firstWatchedAt`, `lastWatchedAt`, `timesCompleted`, `history`), `readLog`, `playLog`, `progress`, `manual` | exclusively user data; consumed by feed, statistics, sorting and ICS without network |
| Notices (notifications) | `releaseDate` (movies/games), `firstAirDate`, `nextEpisodeToAir`, `nextEpisodeAirDate`, `seasonAirDates` (series), `awaitingRelease`, `releasedNoticedAt`, `lastNotifiedEpisode` | without them there is no release notice nor «not released» badge; they enable the A5-a minimum pass |
| Books (justified exception) | `author`, `pages`, `description` | the book card and card detail paint them instantly and the card detail has no detail call (Google Books/OL only give the description in the search); re-querying the synopsis on every card detail would add calls per item with no value |
| Control | `manual`, `addedAt`, `updatedAt` | stable sorting (`js/sorting.js:81`) and pass stamps |
| Community rating | `communityRating` **is stored** (explicit decision) | the card shows it (`js/ui.js:46-53`); storing it (8 bytes) avoids a call per card; its freshness is recovered with *stale-while-revalidate* when opening the card detail (section 9, mitigation M2) |

### 8.2 On-demand fields (with 24 h in-memory cache + SW networkFirst)

`overview`/`description` (not books), `runtime`, `episodeRuntime`, `genres`,
`cast`, `director`, `creators`, `trailerUrl`, `collectionId/Name/Poster`
(movies), `platforms`/`developers`/`publishers`/`esrbName`/`metacritic`/
`playtime` (games). All of them are only seen in the card detail
(`extraInfoHtml`, `js/ui.js:623-665`), and the card detail already makes
live calls to `getWatchProviders`/`getSimilarMovies`
(`js/modal-handlers.js:115`, `:126`, `:443`, `:512`) with the existing 24 h
cache.

### 8.3 Honest counterarguments (mandatory to consider)

1. **Loss of metadata freshness in cards/card detail**: today the daily pass
   curates `communityRating`, `trailerUrl`, collection and covers (ADR-021;
   `js/daily-check.js:112-117`, `:145-148`). With A2, a cover retired from
   TMDB or a rating that goes up stop refreshing on their own. **Nuance**:
   the real visual impact is low (title/year/cover rarely change), and the
   card detail (where the rest is consumed) revalidates when opened — as
   long as *stale-while-revalidate* is implemented (M2). The cover is
   indeed a sensitive field: it is recommended to revalidate it when opening
   the card detail too and, in any case, not remove it from the document
   (negligible cost).
2. **Release notices require a minimum pass (A5-a)**: the issue poses «not
   maintaining a database data update»; with A2+A5-a a daily pass does
   remain, but **~85 % cheaper** than today and limited to items with
   `awaitingRelease`/series in progress. The «zero pass» alternative (A5-b)
   would break notices for items the user does not open: it is rejected. If
   the user wanted to save down to the last call, the only way would be to
   notify only when opening the app (service degradation, not recommended).
3. **Latency/offline of the first card opening**: the card detail needs
   network the first time a specific item is opened; the SW caches it
   (`networkFirst`, `service-worker.js:305-313`) but **capped at 50
   entries** (`DYNAMIC_MAX_ENTRIES`, `:21`). With 480 items, the LRU evicts
   soon. **Mandatory mitigation** in the implementation: raise the limit or
   persist detail responses in IndexedDB by `externalId`+type (section 10).
   Cards never lose offline.
4. **Friends' read-only card details**: today they show the stored snapshot
   (`openReadOnlyModal`, `js/ui.js:2126-2164`). With A2, if the friend has
   not opened that card detail, the viewer would have to do the on-demand
   fetch (the **viewer's** quota, shared among all friends) or show only
   the card (degradation). The optional on-demand fetch with cache and
   graceful degradation to «card only» on failure is recommended
   (section 10).
5. **IGDB at 4 req/s**: the on-demand enrichment of games
   (`getGameDetails`) must be serialized with a **throttle ≤ 4 req/s**
   (currently adding a single game does not need it; a card detail does,
   and several consecutive card details would require it). Reuse the
   `mapConcurrent` pattern of `js/daily-check.js:80-96` or a simple
   semaphore.
6. **Backup/restore stops including card-detail metadata**: the current
   backup exports complete documents (`js/export-backup.js:44-49`); with
   A2, a restore would bring cards without synopsis/cast/trailer until each
   card detail is opened (refetch on restore or while navigating).
   Acceptable: the restore that imports (`:100-240`) already recreates
   documents; re-enrichment would be needed.
7. **The «Sincronizar ahora» button (ADR-021) loses its meaning**: its
   function was to curate EVERYTHING from the APIs (`syncNow`,
   `js/daily-check.js:491-531`); with A2+A5-a it would only make sense as
   «revalidate pending releases» (and would keep its 30 min cooldown). It
   would have to be **redefined** (text, scope and Settings card,
   `js/settings.js:277`).
8. **Migration of existing documents**: the current ~480×M documents carry
   leftover metadata. Options: coexistence (ignore old fields, zero risk)
   or cleanup (one pass that deletes the fields moved to on-demand, -59 %
   of bytes). Coexistence + deferred cleanup is recommended (section 10);
   in no case deleting before the on-demand card detail UI is deployed.

---

## 9. Risks and mitigations

| # | Risk | Probability | Impact | Mitigation (for the future implementation) |
|---|---|---|---|---|
| R1 | Card detail without network the first time (SW cap of 50) | high | medium (offline UX) | detail cache in IndexedDB by `externalId`+type; raise `DYNAMIC_MAX_ENTRIES` for API responses |
| R2 | IGDB 4 req/s with consecutive card details | medium | medium (429, card detail without data) | throttle/semaphore ≤ 4 req/s in `api-games.js`; in-memory cache as in `api-movies.js:227-243` |
| R3 | Forgetting to revalidate the card (cover, communityRating) and it freezing | medium | low (cosmetic) | *stale-while-revalidate*: when opening the card detail, revalidate and `updateItem` cover/rating/trailer (1 write per visited card detail, ~20/day) |
| R4 | Degraded notices if the minimum pass omitted cases (e.g. series «on pause» without `status` en_curso) | low | medium | A5-a must review ALL series with pending `nextEpisode` and `awaitingRelease`, not only `en_curso` (equivalent to the current criterion of `js/daily-check.js:302-317`) |
| R5 | Migration with premature deletion | low | high (data loss) | coexistence first; field migration only after validating on-demand card details in staging (branch previews of the CI workflow) |
| R6 | Firestore read overload as M grows (>3) | medium (only if the group grows) | medium (cap 50K/day) | trimming subscriptions (load visible collection), feed cache, friend pagination; at M=10 the paid plan is revisited |
| R7 | Regression in consumers not touched (ICS, stats, sorting) | medium | medium | manual test suite of the user manual (ADR-032) + responsiveness/themes review (rules 2 and 4 of AGENTS.md) in the implementation PR |
| R8 | Google Books (1,000/day quota) if on-demand registration queries the synopsis repeatedly | low | low | registration only queries when missing (`js/search.js:84-90`); Open Library as fallback (`js/api-books.js:270-277`) |
| R9 | User confusion with the redefined «Sincronizar ahora» button | low | low | update the user manual (`docs/manual-de-usuario.md`) in the same task (AGENTS.md rule 3) |

---

## 10. Future work if adopted (outline without code)

Outside the scope of this issue (study without implementation); work list
for a later implementation issue:

1. **Registration without enrichment**: `handleAdd` would store only the
   card (`js/search.js:171-182`); enrichment moves to the on-demand card
   detail. Or (intermediate option) keep enrichment at registration (1 call
   per registration is trivial) — decision of the implementation issue;
   this study does not prejudge it (both respect A2, only where the first
   call is paid changes).
2. **On-demand card detail** (`js/modal-handlers.js:614-619`,
   `js/ui.js:623-665`): load details with spinner, 24 h in-memory cache,
   IndexedDB persistence, *stale-while-revalidate* of
   cover/communityRating/trailer.
3. **Friend card detail** (`openReadOnlyModal`, `js/ui.js:2126-2164`):
   opt-in on-demand fetch with degradation to «card only».
4. **IGDB throttle** ≤ 4 req/s in `js/api-games.js` (pattern of
   `js/daily-check.js:80-96`).
5. **A5-a minimum pass**: rewrite `checkForUpdates` (~70 calls/day);
   `/works/` books without synopsis; games without network (as today).
6. **Redefinition of the «Sincronizar ahora» button**: scope «revalidate
   pending releases», keeping the 30 min cooldown (ADR-021).
7. **Migration**: field coexistence + deferred cleanup; **backup
   (ADR-008)**: also export the detail cache or regenerate it on restore.
8. **User manual**: update affected sections (AGENTS.md rule 3) and ADR-021
   with the new policy.
9. **SW dynamic cache**: raise the cap or move detail responses to IndexedDB
   (`service-worker.js:21`).

---

## 11. References and evidence

**Cited code (verified in the current repo state, branch `dev`)**:

| File | Key lines |
|---|---|
| `js/db.js` | 1-14 (data model), 33-38 (collections by type), 65-70 (`getItemsOnce`), 79-94 (`subscribeToItems`), 96-109 (`addItem`/`updateItem`) |
| `js/search.js` | 62-102 (`doAddBook`), 129-165 (game registration), 167-221 (movie/series registration), 606-650 (manual registration) |
| `js/api-movies.js` | 90-96 (`getTvSeasonsMeta`), 102-119 (`getSeasonEpisodes` + cache), 138-161 (`getMovieDetails`), 166-185 (`getCollectionDetails`), 190-217 (`getTvExtraDetails`), 227-243 (24 h cache) |
| `js/api-games.js` | 144-159 (`mapGameResult`), 202-228 (`getGameDetails`), 32-70 (`igdbPost` with the 4 req/s limit commented) |
| `js/api-books.js` | 146-160 (Google Books), 212-234 (Open Library), 238-247 (synopsis on demand) |
| `js/daily-check.js` | 24-29 (cooldown/pool/abort), 102-165 (`build*Updates` truthy-only), 217-475 (`checkForUpdates`), 491-531 (`syncNow`) |
| `js/ui.js` | 46-53 (`communityRatingHtml`), 257 (`progressLine`), 326-340 (`upcomingBadge`), 342-381 (`renderGrid`), 455-498 (`renderList`), 623-665 (`extraInfoHtml`), 2126-2164 (`openReadOnlyModal`) |
| `js/modal-handlers.js` | 115-134 (movie card detail + providers/similar), 408-447 (series card detail), 614-619 (`openItem`) |
| `js/tv-progress.js` | 48-85 (`computeProgress`), 152-157 (`markAllSeasonsWatched`) |
| `js/profile.js` | 207-217 (statistics), 411-451 (`openFriend`), 587-630 (`loadActivityFeed`) |
| `js/activity-feed.js` | 40-202 (`buildFriendFeed`), 210-228 (`buildGlobalFeed`) |
| `js/sorting.js` | 20-60 (release sources), 81-107 (`getSortDate`), 138-145 (`applySort`) |
| `js/release.js` | 13-15 (`isUnreleasedDate`), 40-80 (confirmations) |
| `js/export-ics.js` | 120-197 (`collectUpcomingEvents`) |
| `js/export-backup.js` | 29-93 (export), 100-240 (import) |
| `js/settings.js` | 277 (`wireSyncButton`), 451 (`getNotificationPrefs`) |
| `js/app.js` | 124-129 (`maybeTriggerDailyCheck`) |
| `service-worker.js` | 21 (`DYNAMIC_MAX_ENTRIES`), 287-322 (cache strategies) |
| `firestore.rules` | 21-27 (authorized users), 33-63 (shared reads) |
| `README.md` | 305-313 (limits and daily pass; 50,000 reads and 1 GiB on line 307) |
| `cloudflare/igdb-proxy/README.md` | 54 (IGDB: 4 requests per second) |

**Platform and API limits (all consulted on 2026-08-10)**:

- Firebase Firestore quotas (Spark): 50,000 reads/day, 20,000 writes/day, 1
  GiB storage, 1 MiB per document —
  https://firebase.google.com/docs/firestore/quotas (also `README.md:307`
  for reads/GiB).
- TMDB Rate Limiting: «somewhere in the 40 requests per second range»
  (official documentation; the limit can change; respect 429) —
  https://developer.themoviedb.org/docs/rate-limiting (page updated on
  2025-10-20; community mirror: ~50 req/s).
- IGDB rate limits: 4 requests per second — https://api-docs.igdb.com/#rate-limits
  and `cloudflare/igdb-proxy/README.md:54`.
- Google Books API: default quota of 1,000 queries/day per key
  (configurable) and per-user limits —
  https://developers.google.com/books/docs/v1/using (the app documents the
  503 failure and the retries in `README.md:288-297`).
- Open Library: no published limit; used with courtesy —
  https://openlibrary.org/developers/api.

**Relevant existing ADRs**: ADR-021 (daily truthy-only refresh), ADR-025
(per-season air dates), ADR-033 (auto-standby), ADR-005 (community rating),
ADR-006 (TMDB collections/sagas), ADR-007 (PWA/service worker), ADR-008
(backup), ADR-014 (ICS), ADR-015 (activity feed), ADR-037 (device
notifications), ADR-045/056/057/062 (search, covers, retries, mark as
watched), ADR-065 (feasibility study — formatting precedent of this
document), ADR-067 (IGDB + proxy Worker), ADR-069/070/071/072 (video games:
feed, statistics, notices, ICS). All the analysis of section 3 was checked
against these ADRs and the user manual (`docs/manual-de-usuario.md`).

---

## Annex A — Calculation tables

### A.1 Estimated average size per document and alternative (structure estimates, no real Firestore measurement)

| Type | A0 (status quo) | A2 (hybrid) | A1 (only id + user) |
|---|---|---|---|
| Movie | ~2.5-4 KB (overview 0.6-1.5 KB, cast 5 names, genres, collection, trailer, rating) | ~1.2-1.8 KB (card + dates + flags) | ~0.5-0.8 KB |
| Series | ~3.5-8 KB (`seasonAirDates`, `nextEpisodeToAir`, `watched` can grow with hundreds of episodes) | ~1.5-3 KB (card + dates + flags; `watched` kept as is) | ~0.6-1 KB (`watched`/`history` kept) |
| Book | ~1.5-3 KB (Google Books/OL description 0.5-2 KB) | ~0.8-1.5 KB (card + author/pages + description, exception 8.1) | ~0.4-0.6 KB (`readLog`/`progress` kept) |
| Video game | ~2-3 KB (description, genres, platforms, developers, publishers, ESRB) | ~1-1.5 KB (card + dates + flags) | ~0.4-0.7 KB (`playLog` kept) |
| **Average user (480 docs)** | **~2.2 MB** | **~0.9 MB** | **~0.45 MB** |
| **3 users** | **~6.6 MB (0.6 % of the GiB)** | **~2.7 MB (0.3 %)** | **~1.3 MB (0.1 %)** |

Annex conclusions: storage is **never the bottleneck** (≈ 0.6 % of the GiB
with the 3 average users and ≈ 2.2 % in the large scenario of section 6);
the real bottleneck is reads (C1, section 7) and the API-calls/users ratio
(C4).

### A.2 Call breakdown by scenario (one user, normal day)

| Scenario | Action | A0 | A1 | A2+A5-a |
|---|---|---|---|---|
| Tab renders (L=5) | 4 tabs from memory | 0 | 5×(300+100+50+30) = ~730-2,400 TMDB + IGDB, depending on how many tabs are navigated per load (upper bound: the 4) | 0 |
| Open card detail (D=20) | details + providers + similar | 0 (already stored) | 20×(1-3) = 20-60 | 20×(1-3) ≈ 40, cached 24 h |
| Open 1 friend (V=2) | friend's 4 collections | 0 | 2×960 ≈ **1,920** | 0 (Firestore only) |
| Feed (F=1) | 4 collections × (M-1) | 0 | 1×1,920 ≈ **1,920** | 0 |
| Daily pass | notices + curation | **~445** (TMDB+OL) | ~410 (same, saves no notices) | ~70 (only pending + in progress) |
| **Total** | | **~445** | **~5,000-6,700** | **~125** |

*The A1 range reflects the day's social use: without opening friends or the
feed the minimum drops to ~1,200-2,900 (tabs + card details + pass only),
but the normal case of the section 6 profile (V=2 friends and F=1 feed)
falls in ~5,000-6,700.*

All the figures in this annex are estimates built on the assumptions of
section 6; the app has no telemetry to measure them.

---

Related issue: #183 — https://github.com/gonzalitojh/personal-tracker/issues/183
