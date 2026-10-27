# ADR-071: Video game release notice (issue #175)

## Status
Accepted

## Date
2026-08-10

## Context

The **daily check** (`checkForUpdates` in `js/daily-check.js`)
reviews once a day, with no network except for specific exceptions, the
releases of pending movies (`movie_release`), series'
premieres (`series_premiere`) and new episodes (`new_episode`), and creates the
corresponding notifications in the bell (ADR-037, ADR-012).

**Video games** have been their own category since issue #47
(the `games` collection in Firestore, a per-game `playLog,` ADR-067 for the
APIs study and ADR-068 for the consistency of its information), but they
had no place in the daily check: when adding them the year (`year`) was
stored but **not the release date** (IGDB's `first_release_date`
was not mapped), and the user manual (§16) explicitly said that
«the video games do not update themselves… there is no daily check of
new stuff for them».

Issue #175 asks to include video games in the daily checks and the
notifications: warn when a pending game **goes on sale**.

Relevant design constraint: IGDB is queried through a
Cloudflare Worker proxy with a **4 req/s rate limit** (ADR-067);
refreshing all the saved games' metadata daily is not viable due to the
proxy's cost and the requests limit.

Related issue: #175 — https://github.com/gonzalitojh/Registro-personal/issues/175

## Decision

Add a video game release notice **without network**: the date is
stored when adding the game and the daily run only compares it with
the current date, following the manual series' fail-open pattern.

### 1. `releaseDate` in api-games.js

A new helper `dateFromTimestamp(ts)`: converts IGDB's Unix timestamp (in
**seconds**) to `"YYYY-MM-DD"` using **local date
parts** (`getFullYear`/`getMonth`/`getDate`, never `toISOString()`,
which would use UTC and shift a day near midnight — the same local
criterion as `yearFromTimestamp`). It returns `null` if there is no
timestamp or it is invalid. `releaseDate` is added to `mapGameResult`'s
result (search) and to `getGameDetails`' (details on adding).

### 2. `awaitingRelease` on adding (search.js)

- **Normal flow** (`handleAdd`): after enriching the draft with
  `getGameDetails`, if `details.releaseDate && isUnreleasedDate(details.releaseDate)`
  → `draft.awaitingRelease = true`. The **truthy `releaseDate` guard is
  mandatory**: `isUnreleasedDate(null)` returns `true` and a
  dateless game would stay `awaitingRelease` forever (there is no daily
  refresh to resolve it).
- **The "mark played" flow** (`handleAddSeen`): the draft carries
  an explicit `awaitingRelease: false` — a game already marked
  as played at creation time does not wait for a release.

### 3. Network-free daily run (daily-check.js)

A new video games pass in `checkForUpdates`, after the manual series'
block. **Without network**: it uses the stored data (IGDB is not
queried in the run). **Fail-open** like `manualShows`: a write
error does not abort the run nor count as an API failure. All non-manual
games are reviewed, with two phases per game:

| Phase | Condition | Action |
|------|-----------|--------|
| **Flag backfill** | `!g.awaitingRelease && g.releaseDate && isUnreleasedDate(g.releaseDate) && !(g.playLog && g.playLog.length)` | `updates.awaitingRelease = true` |
| **Release notice** | `prefs.game_release !== false && g.awaitingRelease && g.releaseDate && g.releaseDate <= today && !(g.playLog && g.playLog.length)` | `addNotification` with ««Título» ya está a la venta (dd/mm/aaaa).» (`formatDateEs`), `awaitingRelease = false`, `releasedNoticedAt = today` |

- The **backfill** covers games saved before issue #175 that
  already have a `releaseDate`; the truthy guard prevents marking
  dateless games (without a date there is no release to wait for).
- **The `playLog` guard** in both phases is necessary because
  `quick-actions.js` and `modal-handlers.js` do not clear
  `awaitingRelease` when marking a game as played: without it games
  already finished would be notified.
- `releasedNoticedAt` is persisted as a record that the notice was
  issued (and avoids repeating it if a future metadata refresh
  reintroduces the flag).

### 4. The `game_release` preference (settings.js + index.html)

- `game_release: true` in `DEFAULT_SETTINGS.notifications` (between
  `series_premiere` and `friend_activity`).
- Added to settings.js's **two maps** of checkboxes: the one of
  `renderSettings` and the one of `wireNotificationToggles`, both with
  the id `"notif-game-release": "game_release"`.
- `index.html`: a new settings row «Estrenos de videojuegos» with the
  `notif-game-release` checkbox (checked by default), after «Estrenos de
  series».

## Rejected alternatives

- **Daily refresh of IGDB's metadata**: rejected — the
  Cloudflare Worker proxy's cost and IGDB's rate limit (4 req/s,
  ADR-067) make querying all games every day unviable; the information
  is filled at adding time and the daily run works
  without network with the stored data.
- **Treating "no date" as `awaitingRelease`**: rejected — it would be
  a dead flag: without `releaseDate` the notice could never fire and the
  backfill would have no date to check; it would stay `true` forever
  (and the manual's §16 promised games do not update on
  their own, so nothing would resolve it).
- **Migrating existing games with a one-off refresh**: rejected — it
  would imply a massive one-time network run (the proxy's cost/rate
  limit); the daily run's backfill achieves the same
  result for free for games already holding a `releaseDate`.
- **Clearing `awaitingRelease` in quick-actions.js and modal-handlers.js**:
  rejected — it would expand the change surface to all the
  "mark played" flows; the daily run's `playLog` guard achieves the
  same effect without touching those flows.

## Consequences

### Positive

- Video games with a future release date notify their going on sale in
  the bell, with their own deactivatable preference in
  Settings.
- The daily run stays **network-free** for games (the same
  fail-open pattern as the manual series).
- The backfill automatically covers pre-existing games already
  holding a `releaseDate`, with no migrations.

### Negative / Risks

- Games saved **before** this feature and **without** a
  `releaseDate` will never get the notice: without a migration nor a
  metadata refresh there is no way to know their date (accepted; the
  backfill only applies to those already holding a date).
- Games without a release date on IGDB never notify either (nor
  should they: there is no release to wait for).
- The `playLog` guard depends on the game having history: a game
  marked played by other paths without touching the `playLog` could
  get the notice (an accepted edge case).

### Neutral

- The video games' notification "escapes" (shows) in the
  **3 render sinks** without per-type code: the bell's list and the
  badge (`renderNotifications`, app.js) and the system
  notification via push (js/push.js `handleNotificationsSnapshot` →
  `SHOW_NOTIFICATION` → service-worker.js), because the message is free
  text and the sinks do not distinguish types.
- `docs/manual-de-usuario.md` updated (§13 notifications, §15
  settings and §16 sync — the latter no longer promises that video
  games are outside the daily check) (AGENTS.md's rule
  3).

## Created/modified files

| File | Change |
|---------|--------|
| `js/api-games.js` | **Modified**: `dateFromTimestamp(ts)` (a Unix timestamp in seconds → `"YYYY-MM-DD"` with local time, `null` without a date) and `releaseDate` in `mapGameResult` and `getGameDetails` |
| `js/search.js` | **Modified**: `awaitingRelease: true` on adding if the `releaseDate` is truthy and future (a mandatory guard); an explicit `awaitingRelease: false` in `handleAddSeen` |
| `js/daily-check.js` | **Modified**: the network-free video games pass (fail-open): the flag's backfill and the release notice with the truthy `releaseDate` and `playLog` guards, `releasedNoticedAt` |
| `js/settings.js` | **Modified**: `game_release: true` in `DEFAULT_SETTINGS.notifications` and in the two checkbox maps (`renderSettings` and `wireNotificationToggles`) with the id `notif-game-release` |
| `index.html` | **Modified**: the settings row «Estrenos de videojuegos» (the `notif-game-release` checkbox, checked), after «Estrenos de series» |
| `docs/manual-de-usuario.md` | **Modified**: §13 (a new alert type), §15 (a new setting) and §16 (games are no longer outside the daily release check) |
| `docs/adr-071-aviso-lanzamiento-videojuegos.md` | **New**: this document |

## Verification

- QA review: PASS — the `releaseDate` stored on adding (search and
  details), `awaitingRelease` only with a really future date and no
  `playLog`, the backfill of pre-existing games with a date, the
  notice with the message ««Título» ya está a la venta (dd/mm/aaaa).», clearing the flag
  and `releasedNoticedAt` after notifying, the working `game_release`
  preference in the two settings maps and the checkbox checked by
  default.
- No network in the run: PASS — the games' daily check only reads
  stored data; IGDB is not queried (the proxy's
  cost/rate limit respected).
- Render sinks: PASS — the notification appears in the bell's list, the
  badge and the system notification (push) with no
  changes in those flows.
- Themes: PASS — the settings row reuses the existing switch
  pattern, with no new colors nor surfaces.
- Security scan: PASS with no findings (only reading prefs and
  writing to the game itself, no secrets nor PII).

Related issue: #175 — https://github.com/gonzalitojh/Registro-personal/issues/175
