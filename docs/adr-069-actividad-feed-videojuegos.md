# ADR-069: Video games in the activity feed (issue #173)

## Status
Accepted

## Date
2026-08-10

## Context

The **Actividad** section's **activity feed** (ADR-015,
issue #27) shows in chronological order what friends have been doing:
movies, series and books. The feed is **generated 100 % on the client**
(`js/activity-feed.js`): there are no event collections in Firestore;
whenever the Actividad tab opens, the current data of all friends is
read (`loadActivityFeed` in `js/profile.js`) and `buildGlobalFeed`
/ `buildFriendFeed` rebuild the events with `maybePushDateEvent`.

**Video games** have been a product category of their own since issue
#47 (the `games` collection in Firestore, a tab in Ocio with
`ocio/videojuegos.html`, statuses Pendiente / Jugando / Jugado /
Standby / Abandonado and a per-game `playLog` with
`startedAt`/`finishedAt`), and the friend detail has shown them since
issue #172 (ADR-068, the «Videojuegos» tab with `openReadOnlyModal`
supporting items of type `game`:
`gamePlatformsHtml` and `statusLabel`). However, the activity feed still
did not generate video game events: «Está jugando…» and «Terminó de
jugar…» did not appear among the friends' activities.

Issue #173 asks to include video game activity in the feed.

Related issue: #173 — https://github.com/gonzalitojh/Registro-personal/issues/173

## Decision

Expand the feed's event generation to include video games,
replicating ADR-015's pattern (all on the client, without touching Firestore
nor CSS):

### 1. New event types (activity-feed.js)

Two constants are added to `EVENT_TYPES`:

| Event                 | Constant         | Label               | Trigger condition                                       |
|------------------|------------------|---------------------|--------------------------------------------------------|
| Started playing   | `GAME_STARTED`   | «Está jugando»      | A `playLog` entry with `startedAt` and no `finishedAt` |
| Finished playing  | `GAME_FINISHED`  | «Terminó de jugar»  | A `playLog` entry with `finishedAt`                    |

### 2. `buildFriendFeed` with a 5th parameter `games`

- The signature becomes `buildFriendFeed(friendName, movies, series, books,
  games = [])`; the parameter defaults to `[]` to not break
  calls that do not pass the category.
- Per game, its `playLog`'s entries are walked:
  - An entry with `startedAt` and no `finishedAt` → a `game_started`
    event, «Está jugando» with the `startedAt` date.
  - An entry with `finishedAt` → a `game_finished` event, «Terminó de
    jugar» with the `finishedAt` date.
- **Fallback**: a game with `status === "completado"` and no
  `playLog` entries → a `game_finished` event, «Terminó de jugar» with
  `updatedAt`, covering games completed before the `playLog` existed or
  imported without history.

### 3. `buildGlobalFeed` forwards `games`

Each friend's destructure goes from `{ profile, movies, series,
books }` to `{ profile, movies, series, books, games }` and forwards `games`
to `buildFriendFeed`.

### 4. Loading in `loadActivityFeed` (profile.js)

Each friend's `Promise.all` includes the fourth category:
`ctx.getItemsOnce(profile.uid, "game")` (the same one-off read
without a subscription as the existing ones; reading other users'
`games` has been allowed by `firestore.rules` since ADR-068). The object
returned per friend becomes `{ profile, movies, series, books, games }`.

### 5. Event icons (ui.js)

`eventIcon` incorporates `game_started: "🎮"` and
`game_finished: "🏆"`; any unknown event keeps falling to the
`📌` fallback.

### 6. No structural changes

Neither Firestore nor CSS are touched: the feed keeps being
generated 100 % on the client (ADR-015's pattern) and the read-only
modal already supported `game` items since ADR-068 (issue
#172).

## Rejected alternatives

- **Persisting video game events in Firestore**: rejected following
  ADR-015's principle — the feed is rebuilt on the client from the
  current state; persisting events would add new collections
  without benefit.
- **Deduping `startedAt` and `finishedAt` into a single
  `playLog` entry**: the same session can generate both events
  (started and finished), as happens with books (`book_started` +
  `book_finished`); no new suppression logic was introduced.
- **Reusing the generic 📌 icon**: rejected for consistency with the
  rest of the categories, which have their own icon in `eventIcon`.

## Consequences

### Positive

- The activity feed is complete: besides movies/series/books, it shows
  «Está jugando…» and «Terminó de jugar…» with the 🎮 and 🏆 icons.
- Zero Firestore and CSS changes; one extra one-off read per friend,
  in parallel with the existing ones.
- The display is coherent with the rest of the product: the chips,
  statuses and the game's profile were already aligned since
  ADR-068.

### Negative / Risks

- The Actividad tab's load now makes 4 parallel reads per
  friend instead of 3 (the same one-off read cost as the existing
  ones).
- The `status === "completado"` fallback without a `playLog` uses
  `updatedAt`, which may not reflect the real completion date of old
  games; it is the only available datum in that case.

### Neutral

- `docs/manual-de-usuario.md` updated (section 14.3 Actividad): the
  activities list includes «Está jugando…» and «Terminó de jugar…»
  (AGENTS.md's rule 3).

## Created/modified files

| File | Change |
|---------|--------|
| `js/activity-feed.js` | **Modified**: `EVENT_TYPES` with `game_started`/`game_finished`; `buildFriendFeed` accepts a 5th parameter `games = []` and generates events from `playLog` (and the `completado` fallback without a `playLog` with `updatedAt`); `buildGlobalFeed` destructures and forwards `games` |
| `js/profile.js` | **Modified**: `loadActivityFeed` loads `ctx.getItemsOnce(profile.uid, "game")` in the same `Promise.all` and returns `{ profile, movies, series, books, games }` |
| `js/ui.js` | **Modified**: `eventIcon` adds `game_started: "🎮"` and `game_finished: "🏆"` |
| `docs/manual-de-usuario.md` | **Modified**: section 14.3 — the new activities «Está jugando…» and «Terminó de jugar…» |
| `docs/adr-069-actividad-feed-videojuegos.md` | **New**: this document |

## Verification

- QA review: PASS — the `game_started`/`game_finished` events generated
  from `playLog`, the `completado` fallback without history, the
  forwarding in `buildGlobalFeed`, the 4th category's load in
  `loadActivityFeed`, the 🎮/🏆 icons and the updated manual section
  14.3.
- No Firestore nor CSS changes: the feed follows ADR-015's
  100 % client pattern; `openReadOnlyModal` already supported `games`
  since ADR-068 (issue #172).
- Security scan: PASS with no findings (a pre-existing read-only
  pattern, no secrets nor PII).

Related issue: #173 — https://github.com/gonzalitojh/Registro-personal/issues/173
