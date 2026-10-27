# ADR-068: Consistency of video game information — rating, trailer and platforms in the profile (issue #171)

## Status
Accepted

## Date
2026-08-10

## Context

Issue #171 detects that the video games' **profile (information
window)** does not offer the same information as those of movies and series
(taking into account they are different products). Specifically:

1. **It does not show IGDB's community rating**: it only appears on
   the grid's reduced card and in the search preview, not in the
   detail modal (`openGameModal`).
2. **It does not show a trailer link**: neither movies nor series
   are left without it when the API provides it; video games did not
   query any videos endpoint.
3. **The playable platforms are shown as plain text** inside
   `extraInfoHtml`, whereas movies and series show their
   streaming platforms visually (badges/chips).

The video games catalog is fed by **IGDB** through the
Cloudflare Worker proxy (ADR-067). IGDB exposes the **`game_videos`**
endpoint (fields `game`, `name`, `video_id` — the `video_id` is the YouTube ID),
which the proxy already forwards (`POST /v4/*` is pass-through), and the platforms
already arrive as `platforms.name` in search and detail (stored in
Firestore as `string[]`).

## Decision

Align the video games' profile with those of movies/series in three
points, reusing the existing components:

1. **Community rating**: the video games modal
   (`openGameModal` in `js/ui.js`) starts rendering
   `communityRatingDisplay(item)` — the same component that
   movies/series and the reduced card use, with the «IGDB» label. The
   data was already available (`total_rating` / `aggregated_rating`
   normalized to 0–10); no query is added.
2. **YouTube trailer** when IGDB provides it:
   - A new query `getGameTrailerUrl(id)` in `js/api-games.js` that does
     `igdbPost("game_videos", 'fields video_id, name; where game = <id>;
     limit 5;')` through the existing proxy, with an **inner try/catch
     returning `null`** (the trailer is a non-critical extra: if it
     fails, the profile does not break).
   - `extractTrailerUrl(videos)` replicates
     `api-movies.js`' `_extractTrailerUrl` pattern (it prioritizes the
     video whose name contains "trailer", otherwise it uses the first with a
     `video_id`, and builds `https://www.youtube.com/watch?v=<video_id>`).
   - `getGameDetails` returns the new optional field
     **`trailerUrl`**.
   - The modal renders `trailerButtonHtml(item)` (an existing
     component); without `trailerUrl` nothing is painted, with no gaps.
   - **Lazy fetch for already-saved games** (`openGameItem` in
     `js/modal-handlers.js`): if the game has an `externalId` but does not
     yet have `trailerUrl`, when opening its profile IGDB is queried and, if
     there is a trailer, it is persisted with `ctx.updateItem` (the same
     pattern as the movies' watchProviders fetch). All in a
     non-blocking try/catch: the modal **always** opens even if the query
     fails. Video games **still do not update themselves** (`daily-check.js`
     is untouched): the fetch is triggered by a user action
     (opening the profile).
3. **Playable platforms as visual chips**:
   - A new function `gamePlatformsHtml(item)` in `js/ui.js` renders
     `<div class="game-platforms">` with the «Plataformas:» title and a
     chip list `<li class="game-platform">` per platform (escaped with
     `escapeHtml`); it returns `""` if there are no platforms.
   - The plain-text platforms branch is **removed** from
     `extraInfoHtml` (developers, publishers, Metacritic/runtime and ESRB are
     kept).
   - The chips also show in the **search preview**
     (`openSearchPreviewModal`, initial render and the enrich's re-render) and
     in the **read-only modal** (`openReadOnlyModal`, friends'
     profiles).
   - CSS in `ocio/ocio.css` following `.watch-providers`' visual pattern but
     with **theme tokens** (`--paper-dim`,
     `--ink-soft`, `--paper`, `--ink`, `--radius`), no hardcoded hexes,
     with `flex-wrap` + `overflow-wrap: break-word` + `min-width: 0`
     (`white-space: nowrap` is forbidden: long names like «PC (Microsoft
     Windows)» must be able to wrap) and the pure black override integrated in
     the existing `.watch-provider` **grouped selector** (a single
     source of truth, AGENTS.md rule 4).

### Why no platform logos (IGDB's `platform_logo`)

IGDB offers `platform_logo`,

 but using it would force changing the shape of
`platforms` stored in Firestore (today `string[]`) and of
**migrating the existing data**. The text chips meet the issue's
criterion («más visual, parecido a las plataformas de streaming») with
zero migration and keep the current shape.

### Why the dedicated `game_videos` endpoint and not expanding `DETAIL_FIELDS`

The alternative of expanding the detail query with
`game_videos.video_id` is viable (the code already expands
`involved_companies.company.name`), but the dedicated endpoint is IGDB's
documented one, with no ambiguity, and is only invoked when needed
(the profile's detail), not on every search result.

## Consequences

### Positive

- **Coherence between profiles**: video games, movies and series show
  the community rating, trailer and platforms in the same format.
- **No data migration**: `platforms` stays `string[]`;
  `trailerUrl` is a new optional field (Firestore does not validate
  fields).
- **The proxy nor the secrets are not touched**: the `game_videos`
  endpoint goes through the existing IGDB proxy; nothing new is
  deployed.
- **Graceful degradation**: without a trailer on IGDB (or with the
  proxy down) the profile still opens, with no button and no
  awkward gaps.
- **Reused components**: `communityRatingDisplay`,
  `trailerButtonHtml` and `escapeHtml` already existed and were validated in
  the four theme modes; the only new CSS (`.game-platform*`) uses
  theme tokens with its pure black override.

### Negative / Risks

- **Request cost**: opening a game's profile makes 2 IGDB queries
  (detail + `game_videos`), within the free plan's 4 req/s limit;
  negligible volume for personal use.
- **Point latency on opening**: `openGameItem`'s lazy fetch
  waits for IGDB before opening the modal (2 queries with retry in
  `igdbPost`); it is the same behavior the movies' profile already has
  with the watchProviders, and the try/catch guarantees the modal
  always opens.
- **No negative cache**: a game without a trailer re-queries IGDB on
  every opening (games with a trailer get persisted). A possible
  future improvement.
- **The «Plataformas:» title's contrast in the Dark mode**: `--ink-soft`
  over `--paper-dim` falls below AA 4.5:1, same as the existing
  `.watch-providers__title` pattern (a pattern debt, not new); the
  rest of the modes meet AA.

### Neutral

- **`trailerUrl` in backups**: it is stored with the rest of the game's
  record (`users/{uid}/games`), like the other fields.
- **`.wrangler/` ignored**: the security-champion detected that
  wrangler's local cache contains the Cloudflare account ID and the email
  (PII); `.wrangler/` is added to the `.gitignore` so it can never be
  accidentally committed.

## Rejected alternatives

- **IGDB's platform logos** (`platform_logo`): rejected —
  they require changing the shape of `platforms` and migrating the
  existing data; the text chips meet the goal with zero migration.
- **Expanding `DETAIL_FIELDS` with `game_videos.video_id`**: rejected —
  the dedicated `game_videos` endpoint is the documented one, with no
  ambiguity, and is only queried in the profile.
- **A violet color variant (`--games`) for the rating**: rejected —
  the existing component's teal is kept (identical to cards and to
  movies/series, with already-validated contrast).
- **Automatic trailer update (daily-check)**: rejected — the manual's
  §16 promises that video games do not update on their own; the lazy
  fetch when opening the profile is a user action.
- **Persisting the trailer only in memory** (without
  `ctx.updateItem`): rejected — persisting makes the second opening
  instant and the read-only profiles (friends) show the stored
  trailer.

## Created/modified files

| File | Change |
|---------|--------|
| `js/api-games.js` | **Existing**: `GAME_VIDEO_FIELDS`, `extractTrailerUrl`, `getGameTrailerUrl` (the `game_videos` endpoint, try/catch → null) and the `trailerUrl` field in `getGameDetails` |
| `js/ui.js` | **Existing**: `gamePlatformsHtml`; `openGameModal` with `communityRatingDisplay` + `trailerButtonHtml` + `gamePlatformsHtml`; the plain-text platforms removed from `extraInfoHtml`; chips in the search preview and in `openReadOnlyModal` |
| `js/modal-handlers.js` | **Existing**: `openGameItem` async with the trailer's lazy fetch (a non-blocking try/catch + `ctx.updateItem` persistence) |
| `ocio/ocio.css` | **Existing**: the `.game-platforms*` / `.game-platform` block (theme tokens, no nowrap) and the pure black override in `.watch-provider`'s grouped selector |
| `docs/manual-de-usuario.md` | **Existing**: §10 (video games' trailer when IGDB has it; platforms as tags) and §16 (trailer saved when opening the profile) |
| `.gitignore` | **Existing**: `.wrangler/` added (PII: account ID + email) |

Related to: tasks/task-issue-171.json

Related issue: #171 — https://github.com/gonzalitojh/Registro-personal/issues/171
