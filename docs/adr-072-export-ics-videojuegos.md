# ADR-072: ICS export of video games (issue #176)

## Status
Accepted

## Date
2026-08-10

## Context

The **.ics export** (`js/export-ics.js`, ADR-014) generates a downloadable
iCalendar file (RFC 5545) from the Settings' data card
(`#btn-export-ics`, ADR-058) with the **upcoming series episodes**
on air and the **pending movie releases**
(a future `nextEpisodeToAir` and `releaseDate`, UIDs `mi-registro-tv-*` and
`mi-registro-movie-*`).

**Video games** have been their own category since issue #47
(the `games` collection in Firestore, a per-game `playLog`, ADR-067 for
the APIs study and ADR-068 for the consistency of their information) and,
after issue #175 (ADR-071), they have a `releaseDate` when added from
IGDB and a daily release notice in the bell. However, the .ics export
(and its card's and the manual §15's text) only
covered series and movies: pending video game releases did not
reach the user's personal calendar.

Issue #176 asks to expand the .ics export to include
**pending video game releases**: games with a future
`releaseDate` and no play history.

Relevant design constraint (inherited from ADR-071): `quick-actions.js`
and `modal-handlers.js` do not clear the `awaitingRelease` flag when
marking a game as played (they only write `playLog` + `status`), so the
flag is not a reliable source to know whether a game is still pending
release; the `playLog` is the source of truth (the same predicate as
issue #175's daily run).

Related issue: #176 — https://github.com/gonzalitojh/Registro-personal/issues/176

## Decision

Add video games to the .ics export with a **direct criterion**
(future date + an empty `playLog`), without depending on the
`awaitingRelease` flag, and enabled **by default**.

### 1. New parameter `includeGames` (default true)

- `collectUpcomingEvents(ctx, includeMovies, includeTv, includeGames)`:
  a new fourth parameter with the video games **block after** the
  movies' one.
- `downloadIcs(ctx, options)`: a new `includeGames` option with the
  same pattern as the existing ones (`options.includeGames !== false` →
  default `true`).
- `setupExportIcs`: the button's call passes `includeGames: true`
  explicitly alongside `includeMovies: true` and `includeTv: true`.

The feature is included by default in the full export, and the
internal API allows excluding the games (`includeGames: false`) without
UI or toast changes.

### 2. The video games block: direct criterion (not `awaitingRelease`)

Per game in `ctx.getItemsByGroup("games")`:

| Guard | Effect |
|--------|--------|
| `!item.releaseDate` → `continue` | **Manual** games (no IGDB date) and dateless games stay out: there is no release to export |
| `item.releaseDate < today` → `continue` | Only **future** releases (today included) |
| `item.playLog && item.playLog.length` → `continue` | **Already played** games stay out |

**Why `awaitingRelease` is not used** (justification): the flag is
written on adding (issue #175), but `quick-actions.js` and
`modal-handlers.js` **do not clear it** when marking a game as played —
they only persist `playLog` and `status`—; relying on it would export
games already finished. Also, games saved before issue #175 do not
have the flag at all. The **`playLog` is the source of truth**: it is the
same predicate (date + no history) that issue #175's daily run uses
(ADR-071), keeping the bell and the calendar coherent.

An additional defensive guard: `formatIcsDate` may return `null` for
an unparseable ISO date, so `if (!dtstart) continue` is added
before creating the event.

### 3. The video game event's format

It follows the same pattern as the rest of the events (ADR-014:
`VALUE=DATE`,
`TRANSP:TRANSPARENT`, no `DTEND`, stable UID):

- `UID`: `mi-registro-game-{id}@registro-personal`
  (`generateUid("game", item.id)`).
- `DTSTART;VALUE=DATE`: the release date in `YYYYMMDD` (the full day,
  no time zone).
- `SUMMARY`: `Lanzamiento: {título}`.
- `DESCRIPTION`: the `overview` truncated to 250 characters if it exists, or
  the fallback `Lanzamiento del videojuego {título} el {fecha}.`.

The **global date sorting** (`events.sort(...)`, already existing)
also applies to the games' events, and the toasts
(«Preparando calendario…», «No hay estrenos próximos que exportar.»,
«Calendario descargado (N eventos).») and the file name
(`calendario-estrenos-{fecha}.ics`) do not change.

### 4. Texts (AGENTS.md's rule 3) and PWA bump

- `index.html` (~line 439): the .ics card's text now mentions
  «…the pending movie releases and **your video games'
  releases**…». The instructional text is: «…los estrenos de
  películas pendientes y los **lanzamientos de tus videojuegos**…».
- `docs/manual-de-usuario.md` §15: the same change in the .ics export's
  description.
- **The deploy version bump
  20260903 → 20260904** in `index.html`
  (the `?v=` of `css/styles.css`, `ocio/ocio.css` and `js/app.js`),
  `js/config.js` (`APP_VERSION`) and `service-worker.js`
  (`STATIC_ASSETS`),
  to invalidate the service worker's caches (the ADR-019
  convention; `scripts/bump-version.sh` verified coherent).
- A **text-only change**: no new colors, surfaces nor layout
  (AGENTS.md's rules 2 and 4).

## Rejected alternatives

- **Relying only on `awaitingRelease`** (the predicate equivalent to
  the movies': `status === "pendiente" || awaitingRelease`): rejected —
  the flag is not cleared when marking played in `quick-actions.js`/
  `modal-handlers.js`, so already-finished games would keep
  being exported; and games saved before issue #175 do not have
  the flag and would stay out even if unplayed. The direct
  criterion (date + `playLog`) is robust to both cases (the same
  conclusion as ADR-071's daily run).
- **Clearing `awaitingRelease` in `quick-actions.js` and
  `modal-handlers.js` to be able to use it**: rejected — it would expand
  the change surface to all the "mark played" flows and would not
  solve pre-#175 games (without the flag); the `playLog` guard at the
  read point achieves the same result without touching those
  flows.
- **Conditioning the export on the daily run having backfilled
  the flag**: rejected — a newly added game with a future
  date would not appear in the calendar until the next run (up to
  a day of delay); the direct criterion works immediately with the
  stored data.
- **Including the platforms in the `DESCRIPTION`**: rejected — it adds
  nothing to the event's purpose (knowing when it goes on sale) and
  would break parity with the series and movies events (the same
  pattern: an `overview` truncated to 250 or a text fallback,
  ADR-014).

## Consequences

### Positive

- **Pending video game releases** reach the personal calendar
  with one click, completing the .ics export with the log's
  third category (ADR-014).
- A **robust criterion consistent with the bell**: the same
  predicate (future date + no `playLog`) as issue #175's daily
  run (ADR-071); the `playLog` is the only source of truth on whether a
  game is still pending.
- **No regressions**: the series and movies blocks are untouched, and
  `includeGames` defaulting to `true` keeps the feature active with no UI
  changes; the `includeGames: false` option allows excluding games from
  the internal API.
- **Manual** games (without a `releaseDate`) and **already played** ones
  stay out automatically thanks to the guards.

### Negative / Risks

- A game marked as played by paths that do not write the `playLog`
  could appear in the export (an accepted edge case, the same
  ADR-071 documents for the bell).
- Games without a release date (manual or dateless on IGDB) never
  appear in the calendar: there is no date to export (accepted).
- As already happened with series and movies (ADR-014), there is no
  automatic sync: when adding new games the file must be
  exported again.

### Neutral

- A **text-only** UI change: the .ics card's text
  (`index.html` ~439) and manual §15 (AGENTS.md's rule 3); no
  new colors, surfaces nor layout (AGENTS.md's rules 2 and 4).
- The deploy version bump **20260903 → 20260904** (the
  ADR-019 convention; `scripts/bump-version.sh` coherent):
  `index.html` (`?v=` ×3),
  `js/config.js` (`APP_VERSION`) and `service-worker.js`
  (`STATIC_ASSETS`).
- The video game event reuses the rest of the events' format
  (`VALUE=DATE`, `TRANSP:TRANSPARENT`, no `DTEND`, stable UID); only
  the UID's type (`"game"`), the `SUMMARY` and the
  `DESCRIPTION`'s content change.

## Created/modified files

| File | Change |
|---------|--------|
| `js/export-ics.js` | **Modified**: the `includeGames` parameter (default `true`) in `collectUpcomingEvents` and `downloadIcs`; the video games block after the movies' one (the `releaseDate` truthy and ≥ today guards, an empty `playLog`, the `!dtstart` defense); the UID of type `"game"`, the `SUMMARY` «Lanzamiento: …», the `DESCRIPTION` with the `overview` truncated to 250 or the fallback; `setupExportIcs` passes `includeGames: true` |
| `index.html` | **Modified**: the .ics card's text (~line 439) with «…los lanzamientos de tus videojuegos…»; bump `?v=20260903` → `?v=20260904` (×3) |
| `docs/manual-de-usuario.md` | **Modified**: §15 (Settings → the .ics export) mentions the pending video game releases |
| `js/config.js` | **Modified**: `APP_VERSION` `'20260903'` → `'20260904'` |
| `service-worker.js` | **Modified**: `STATIC_ASSETS` with `?v=20260904` (styles, ocio.css, app.js and `ocio/*.html`) |
| `docs/adr-072-export-ics-videojuegos.md` | **New**: this document |

## Verification

- QA review: PASS — games with a future `releaseDate` and no `playLog`
  exported with the UID `mi-registro-game-*`, DTSTART and the
  «Lanzamiento: …» SUMMARY correct; already-played games, with a past
  date or without a date excluded; series and movies exported as before
  (no regressions); the «No hay estrenos próximos que exportar.» toast
  intact; the card's text and manual §15 updated.
- Functional harness: **22/22 PASS** — no regressions in the rest
  of the application's flows.
- Security scan: PASS **without HIGH/MEDIUM findings** — only
  reading the user's own data and generating text on the
  client (no network, no secrets nor PII).
- Themes and responsiveness: PASS — a purely textual change, with no
  new colors nor layout (AGENTS.md's rules 2 and 4).

Related issue: #176 — https://github.com/gonzalitojh/Registro-personal/issues/176
