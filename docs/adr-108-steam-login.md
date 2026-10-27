# ADR-108: Steam linking via sign-in and automatic daily refresh

## Status
Accepted

## Date
2026-10-24

## Context

The first design of the Steam integration (PR #4) was manual: the user
pasted their SteamID64 and pressed a button. The owner now asks for:

1. **Linking by sign-in**, not by pasted code.
2. **Continuous refresh**: data (played hours) should keep refreshing.

Technical research:

- Steam does NOT offer OAuth2 for user web apps (only for publishers
  with a partner account). The official, standard mechanism is
  **OpenID 2.0** ("Sign in through Steam"): the web app sends the user
  to `steamcommunity.com/openid/login`, Steam authenticates and returns
  to the callback a signed `openid.identity` that must be VERIFIED with
  `openid.mode=check_authentication` (against Steam, server to server).
  The verification must happen ON THE SERVER (anti-spoof fingerprint),
  so the natural place is the existing steam-proxy Worker.
- For continuous refresh: the web app's daily pass (`js/daily-check.js`)
  is the natural place (it runs when the app is opened each day with a
  signed-in session).

## Decision

### 1. steam-proxy Worker: two new routes

- `GET /login?return_to=<app url>` → 302 to Steam's OpenID endpoint
  (`checkid_setup`), with `openid.return_to` pointing to the worker's
  own callback and `openid.realm` to the worker's origin.
- `GET /callback?return_to=...&openid.*`:
  1. Forwards ALL the `openid.*` parameters to Steam with
     `openid.mode=check_authentication` (POST form-urlencoded).
  2. Checks `is_valid:true` in the response.
  3. Extracts the SteamID64 from `openid.identity`
     (`…/openid/id/<steamid>`).
  4. Redirects 302 to the app with `#/steam-callback?steamid=…` (or
     `#/steam-callback?error=verify` if verification fails).
- **`validateReturnTo`**: only https `return_to` values are accepted
  and, if the worker has `ALLOWED_ORIGIN`, from the same host
  (anti-open redirect). No cookie/session is persisted in the worker.
- The `/owned` route stays as is (the web app already has the steamid).

### 2. Web app: linking (settings.js + api-steam.js)

- `steamLoginUrl()`: URL of the worker's /login with `return_to` being
  the current web origin (null without proxy or without window).
- **Button «Vincular mi cuenta de Steam»** [Link my Steam account] in
  Ajustes → Integración de Steam [Settings → Steam Integration]
  (`browser.location.href = ...`). On return, `app.js` intercepts the
  `#/steam-callback?...` hash BEFORE routing (applySteamCallback):
  saves the SteamID in the settings, shows a toast and resets the hash
  to `#/ocio` (without reloading the page).
- The manual SteamID64 setting **remains as a fallback** (it is
  auto-filled when linking). «Re-vincular» [Re-link] repeats the flow
  (in case the account changed).

### 3. Automatic refresh (daily-check.js)

New step at the end of `checkForUpdates` (daily pass or «Comprobar
estrenos» [Check releases]), **fail-open and silent**:

- If there is a linked steamId and tracker items with `steamAppId`: it
  requests the library from the proxy and, for each known game, updates
  `steamPlaytimeHours` and its session hours (`source: "steam"`), with
  session backfill for old games without the mark.
- It does NOT auto-add new Steam games (avoids flooding the tracker
  with hundreds of titles; registration remains manual and chosen).
- A Steam failure does not abort the pass or burn the cooldown.

## Consequences

- "Link me" = one click on Steam; no more hand-pasted IDs.
- Hours stay fresh on their own, with no button, every day the app is
  opened (or via «Comprobar estrenos»).
- Risk: if the profile becomes private, Steam returns 0 games and the
  hours stop refreshing until privacy is reviewed (the /owned UI
  already explains this).
