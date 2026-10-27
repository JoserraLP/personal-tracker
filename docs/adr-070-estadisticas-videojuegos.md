# ADR-070: Video game statistics in the profile (issue #174)

## Status
Accepted

## Date
2026-08-10

## Context

The profile's **Estadísticas** section (`js/profile.js`) summarizes the user's
consumption and is generated 100 % on the client from the current state of
their collections: it covered **movies**
(watched), **series** (episodes and completed) and **books**
(read). **Video games** have been a product category of their own
since issue #47 (the `games` collection in Firestore with a per-game
`playLog` —sessions with `startedAt`/`finishedAt`—,
`genres[]`, `platforms[]` and statuses `pendiente`/`en_curso`/`completado`/
`standby`/`abandonado`), but they had no stats of their own: they did not appear
in the summary tiles, nor in "Actividad por mes", nor in "Estados
actuales".

ADR-067 (the video game APIs study, issue #162) explicitly left
«Stats del perfil (horas jugadas, géneros, plataformas…)»
as future work. Also, IGDB does not expose a game's average duration
(`playtime` comes `null`, see ADR-067), so played hours can only come from
an **optional per-session field** entered by the user
themselves.

Issue #174 asks to add video game statistics to the profile.

Related issue: #174 — https://github.com/gonzalitojh/Registro-personal/issues/174

## Decision

Expand `computeStats` (profile.js) with a video games block that
replicates the other categories' pattern (all on the client, respecting the
period filter), add two new horizontal bar charts and
expose the result in 8 summary tiles:

### 1. A `hours` field per session

Each `playLog` entry now accepts an optional
`hours` field:

| Aspect | Detail |
|---------|---------|
| Type | `number`, minimum 0, step 0.5, rounding to 1 decimal |
| Editing | Input in the game modal (`js/ui.js` `renderPlayLogRows` + a `change` listener in `openGameModal`) |
| Empty | `null` is persisted (never `undefined`: Firestore's `updateDoc` throws if a field is `undefined`) |
| Old sessions | Without `hours` → treated as 0 in the calculations |
| Persistence | Via the existing `onUpdateEntry` → `updatePlayEntry` (merge `{...entry, ...changes}`), without touching `game-log.js` nor `modal-handlers.js` |

### 2. Statistics computation (`computeStats`)

- **A session's effective date** = `finishedAt ?? startedAt`: a
  single date per session, avoiding double counts in "Actividad por
  mes".
- **Games played** (`gamesPlayed`): games with ≥1 session whose
  effective date falls in the period; fallback:`
  status === "completado"` and
  the normalized `updatedAt` in the period (`toDateStr`, the
  `maybePushDateEvent` pattern of activity-feed.js).
- **Games completed** (`gamesCompleted`): `status === "completado"` and the
  **last** finished session (the greatest `finishedAt`) in the
  period; the `updatedAt` fallback if there are no finished sessions.
- **Game sessions** (`gameSessions`): the number of `playLog` entries
  with an effective date in the period.
- **Hours played** (`gameHours`): the sum of the period's sessions'
  `entry.hours`.
- Everything respects the period filter (always / year / month / custom
  range) via `withinPeriod`.

### 3. Charts

| Chart | Integration |
|---------|-------------|
| «Actividad por mes» | The game sessions integrate into the existing `monthly` chart |
| «Estados actuales» | Games enter `statusCounts` (the 5 statuses are already in `STATUS_LABELS_NEUTRAL`) |
| «Géneros» (new) | Horizontal bars (`indexAxis: "y"`, Chart.js), top 6, games played in the period |
| «Plataformas» (new) | Horizontal bars (`indexAxis: "y"`, Chart.js), top 6, games played in the period |

In Géneros and Plataformas each game counts once per genre /platform
(dedupe with a `Set`, `trim` and discarding empties). The palette uses
theme variables (`--teal-reel`, `--ochre-spine`, `--stamp`,
`--ink-soft`, `--ochre-spine-dark`) read with `getComputedStyle`, with no
hardcoded hexes (AGENTS.md's rule 4).

### 4. UI

- **8 tiles** in the summary grid: the 4 existing ones (movies,
  series, books) + games played, completed, sessions and hours.
- The hours format with a decimal comma and the "h" suffix
  (`formatHours`).
- `index.html` adds the `#chart-genres` and `#chart-platforms`
  canvases inside `.stats-charts` (an `auto-fit` grid, no CSS changes in
  `styles.css`).

### 5. User manual

Sections 7.4 (the per-session hours field) and 14.1 (eight
figures, five charts, the played/sessions/hours semantics) are updated
(AGENTS.md's rule 3).

## Rejected alternatives

- **Using IGDB's average duration for the hours**: rejected — IGDB does
  not expose `playtime` (null, ADR-067); the hours can only be the
  user's per-session datum.
- **Hours at the game level instead of per session**: rejected — the
  `playLog` allows several sessions per game and the monthly
  statistics need to attribute hours to the specific session.
- **Persisting the hours in a new subcollection**: unnecessary — the
  optional per-entry field is backwards compatible and requires no
  migration.

## Consequences

### Positive

- Complete statistics for the 4 media types in the profile.
- The hours played are measurable even though IGDB does not expose
  them.
- No structural changes nor migrations: only one backwards-compatible
  optional field per session.

### Negative / Risks

- `updatedAt` updates on any write to the game (including the
  trailer fetch when opening the profile, `js/modal-handlers.js`): the
  `updatedAt` completion fallback may count games completed before the
  period if their profile was touched recently (accepted; the
  criterion's literal behavior).
- The `--stamp` color over dark surfaces is near the graphical contrast
  limit (3:1) — a pre-existing pattern of the statuses' doughnut.

### Neutral

- The `hours` field is optional and backwards compatible with
  existing sessions.
- Minimum duplication of `toDateStr` with activity-feed.js (a shared
  refactor is out of scope).

## Created/modified files

| File | Change |
|---------|--------|
| `js/profile.js` | **Modified**: the video games block in `computeStats` (`gamesPlayed`, `gamesCompleted`, `gameSessions`, `gameHours`), integration in `monthly`/`statusCounts`, the Géneros and Plataformas charts, `formatHours` |
| `js/ui.js` | **Modified**: `renderPlayLogRows` with a per-session `hours` input and a `change` listener in `openGameModal` |
| `index.html` | **Modified**: the `#chart-genres` and `#chart-platforms` canvases in `.stats-charts` |
| `docs/manual-de-usuario.md` | **Modified**: sections 7.4 (the hours field) and 14.1 (eight figures, five charts) |
| `docs/adr-070-estadisticas-videojuegos.md` | **New**: this document |

## Verification

- QA review: PASS — the 4 metrics computed with per-session effective
  dates, the `completado`/`updatedAt` fallbacks, the period filter in
  every case, the Set dedupe in Géneros/Plataformas, 8 tiles, 5 charts
  and the manual (7.4 and 14.1) updated.
- Persistence: PASS — `hours` stored as `null` when empty
  (never `undefined`), via `updatePlayEntry` with a merge, without
  touching `game-log.js` nor `modal-handlers.js`.
- Themes: PASS — the new charts' palette with theme variables via
  `getComputedStyle`; `--stamp` near the contrast limit is a
  pre-existing pattern.
- Responsiveness: PASS — `.stats-charts` with the existing `auto-fit`
  grid; no CSS changes in `styles.css`.
- Security scan: PASS with no findings (a pre-existing client pattern,
  no secrets nor PII).

Related issue: #174 — https://github.com/gonzalitojh/Registro-personal/issues/174
