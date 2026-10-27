# ADR-107: «Times» counters and Steam integration for video games

## Status
Accepted

## Date
2026-10-24

## Context

Two requests from the owner:

1. **Counter of how many times an item has been watched/read/played**
   (series, episode, book, movie). The web app ALREADY records each
   session/viewing with a date in histories (movie watchLog, book
   readLog with finished sessions, video game playLog, series
   timesCompleted and per-episode times, D-105), so the natural counter
   already existed; what it lacked was being shown as a clear counter
   and the ability to ANNOTATE/CORRECT when the record does not reflect
   reality.
2. **Game library integration (Steam, Epic Games)** to fetch the
   user's games and THEIR PLAYED HOURS.

Technical restrictions investigated:

- **Steam**: the official API (api.steampowered.com, e.g.
  `IPlayerService/GetOwnedGames`) requires a proprietary key
  (STEAM_API_KEY) and does NOT respond with browser CORS. The key
  cannot live in the SPA.
- **Epic Games**: there is NO public API returning a user's library or
  their playtime (it would require store OAuth with developer
  permissions and there is no public playtime endpoint). NO integration
  possible for a third party without an Epic partnership.

## Decision

### 1. Counters (js/counter.js, pure and tested)

- `naturalTimes(item)`: natural count by type (length of the
  corresponding log; for series, `timesCompleted`).
- `timesCount(item)`: what the web app DISPLAYS — the manual
  annotation (`seenCount`, as long as it is >= 1) if present;
  otherwise, the natural count. Never shows less than recorded
  (max(natural, manual)).
- **«×N» chip on the cards** (grid and list) in the 4 media types when
  the value is >= 1 (`.item-card__counter`).
- **Manual adjustment in the edit modal** (opened from any item's
  card): numeric field "Veces vista / completada / leído / jugada"
  [Times watched / completed / read / played] with validation
  (integer >= 1; empty = automatic count; value equal to the natural
  one = nothing is annotated).
- The counter does NOT multiply anything by itself: release/episode
  notices and statistics keep working with their histories (the
  `seenCount` is presentation/correction).

### 2. Steam (cloudflare/steam-proxy + js/api-steam.js)

- **New Worker `cloudflare/steam-proxy/`** (same pattern as the
  existing igdb-proxy): stores `STEAM_API_KEY` as a Cloudflare secret,
  exposes `GET /owned?steamid=<SteamID64>`, calls
  `IPlayerService/GetOwnedGames` (with `include_appinfo` and
  `include_played_free_games`), and returns a normalized list
  `{ appid, name, playtimeHours, lastPlayedAt }` sorted by hours, with
  CORS and optional origin verification (`ALLOWED_ORIGIN`).
- **Client `js/api-steam.js`** (purely composable with config):
  sanitizes the SteamID64 (17 digits), normalizes hours ("134,7 h"),
  and requests the library from the worker with clear errors.
- **Config `STEAM_PROXY_URL`** (""): a Settings card warns if no proxy
  is deployed; deployment instructions live in
  `cloudflare/steam-proxy/README.md` (wrangler secret put + deploy)
  with step-by-step verification.
- **UI in Ajustes → Integración de Steam** [Settings → Steam
  Integration]: SteamID64 (remembers the last value with the same
  settings storage), button «Buscar mis juegos de Steam» [Search my
  Steam games], and a list with played hours and day of the last
  session. **Registering in the tracker** adds the game as a manual item
  (`steamAppId` and `steamPlaytimeHours`) with ONE play session that
  groups the hours (they add up in the profile's "played hours"
  statistic), status "completado" [completed] (= "Played"); duplicates
  marked "Añadido ✓" [Added ✓].

### 3. Epic Games

Stays **out** with a note: without a public API an official
synchronization cannot be implemented. If Epic releases a public API or
an official export, it would be added with a new ADR.

## Consequences

- The user sees "×N" on their titles and can correct the count when the
  record does not reflect reality.
- The Steam integration requires no new server: it reuses the existing
  Cloudflare Worker pattern and exposes no secrets.
- Known risk: the Steam list arrives in English (original name) and
  WITHOUT covers; if the game uses a different name on IGDB, the user
  corrects it from the card (edit title).
