# Services improvement report (per application service)

Date: 2026-10-27. Scope: each service/consumer surface of the app,
current status, why, and what to improve. Written for the owner, not
for end users.

## Context

The app is a pure-frontend PWA (GitHub Pages) with:
- Auth: Firebase Authentication (Google popup).
- Data: Firestore (collections per type under `users/{uid}/…`), rules
  as the only source of truth for authorization.
- External catalogs: TMDB (movies/shows), Google Books + Open
  Library + covers, IGDB via Cloudflare Worker (`igdb-proxy`),
  Steam via Cloudflare Worker (`steam-proxy`: API key + OpenID
  sign-in).
- App layer: hash router, lazy partials per tab, service worker cache,
  i18n es/en, push notifications, backup export/import, daily check.

## 1. Authentication & access rules — WORKING (with caveat)

- Status OK: Google popup sign-in; access control ONLY by
  `firestore.rules` `isAllowedUser()` (single email whitelisted);
  unauthorized emails are signed out with a clear message.
- Caveat / to improve: **the rules deploy has been a recurring
  failure point** — `wishlist` permissions failed in production for a
  long time because `deploy-rules` only runs on `main` pushes of
  `firestore.rules` and had not been triggered. Recommendations:
  - Add a production health check (the GET of the user profile) to
    detect permission-denied systematically and surface a banner.
  - Consider making `deploy-rules` also manual-dispatchable from the
    GitHub UI (it already is) and document the "publish needs rules
    deploy" checklist.

## 2. Firestore data layer — Pier minor

- Verified working: media collections, recipes catalog, menus, gym
  catalog, notifications, wishlist; live subscriptions with retry +
  watchdog.
- JUST FIXED (this task): the two private list sections (Shopping /
  Experiences) were stuck in an infinite reload loop caused by
  `renderLibraryFor()` being called for groups it does not support
  (TypeError → partial retry → …). Also exposed the missing CRUD
  methods on ctx and the `createdAt` vs `addedAt` ordering mismatch.
- To improve:
  - Add a query smoke test helper (a checklist: try one snapshot per
    collection and log) so a mis-deployed rules/field mismatch is
    detectable in the browser console.
  - The studio (docs/estudio-almacenamiento-minimo.md) suggests more
    fields could be pruned from documents; keep monitoring.

## 3. Ocio: movies — Mostly OK

- Search (TMDB), add, mark watched, ratings over 10, trailers watch
  log, saga info, collections/sagas, community rating badge, watch
  providers.
- To improve:
  - "Aún no estrenada" badge relies on `releaseDate`; pending titles
    without a date never leave the unreleased badge flow (documented
    edge case).
  - Watch providers depend on TMDB region; currently no region
    selector → default region may hide availability.

## 4. Ocio: shows — Mostly OK

- Search, season marking, per-episode rewatch counter, episode
  ratings over 10, episode actions dialog, next-episode banner, TVDB
  via TV Time import: FULLY IMPORTED SEASONS now shown (ADR-117; the
  hardcoded "single season" fallback was the bug).
- To improve:
  - Imported shows keep generic episode names ("Episodio N") — TV Time
    export does not carry them. Option: re-fetch names by matching
    TMDB by title when a duplicate suggestion exists.
  - Season watch dates for manual shows are naive.

## 5. Ocio: books — Mostly OK

- Search via Google Books, Open Library description enrichment,
  reading sessions, reading log, completion dates, cover picker,
  multiple editions.
- To improve:
  - Goodreads scraper study concluded not feasible (ADR-065) — keep as
    manual-entry-only category; document it in the manual tab.

## 6. Ocio: video games — Mostly OK (with two services)

- IGDB catalog via `igdb-proxy` worker; Steam hours via `steam-proxy`
  counter sessions; backup export includes game sessions.
- To improve:
  - IGDB: the Twitch credentials rotate? add an alerting on 401/429 of
    the worker (currently an error toast only).
  - Steam: the OpenID sign-in needs the exact `ALLOWED_ORIGIN` secret
    (already fixed once); consider a "diagnóstico" button in Settings
    that probes the worker `/` endpoint and shows which secret is
    missing (the worker already has a status endpoint).
  - Epic Games: no public API; documented as not integrable.

## 7. Shopping & Experiences (private lists) — JUST UNIFIED (ADR-119)

- Both were partial clones with two bugs each (see §2). Now ONE
  factory builds both sections: same list UI as Recipes (cards listed
  vertically with chips filters), one shared editing window, one
  mark + date model, one logout reset.
- To improve:
  - Add sorting (price/date/title) later if needed — deliberately not
    added now to keep the section small.

## 8. Daily check — WORKING

- Comprobar estrenos manual button + once-per-session daily pass;
  Steam hours backfill sessions with `source: steam`; fail-open.
- To improve:
  - The daily pass reads with `getItemsOnce` per group; a wasted read
    could be avoided by reusing the live snapshot when `groupReady`.
  - TV episodes "next episode" updates rely on TMDB (+TV Time next
    episode for manual ones); fine.

## 9. Push notifications — WORKING (browser + device-OS bridge)

- Bell dropdown → system notification; device push permission with
  denied-state handling.
- To improve: schedule explorer: the system notification tag
  `notif-<id>` can coalesce too aggressively if the id is reused.

## 10. Backup export/import — WORKING (brand renamed)

- Backup version checks by major; import adds to existing data.
- To improve: add a "validate & preview" step before import (show
  counts per type); also hide the raw JSON behind a folder selection.

## 11. Service worker & caches — WORKING (after the CSS path fix)

- The ocio CSS was precached with a WRONG path (`./css/ocio.css`);
  fixed now (`./ocio/ocio.css`); list of missing module assets
  (wishlist/section-lists/api-steam/counter) added to precache.
- To improve:
  - Keep the precache list authoritative: consider generating it from
    a glob at build time (script) so every new module auto-includes.
  - The dynamic cache limit (100 entries) is fine.

## 12. i18n es/en — WORKING (v2 coverage)

- Static chrome + dynamic detail modal strings now translate
  (MutationObserver checks the active language per callback).
- Remaining Spanish: strings that CONCATENATE interpolated data
  (documented; next iteration: convert to `t(key, params)`).

## 13. Ratings & counters — WORKING

- Notes over 10 (ADR-116) with bidirectional half-scale storage.
- ×N counters with manual override (ADR-107).

## 14. Known broken / limbo services

- **Amigos/Actividad social surfaces**: REMOVED (ADR-103).
- **Goodreads**: not feasible (ADR-065).
- **Epic Games**: not feasible (ADR-067).
- **TV Time re-import**: re-running the import duplicates items (it
  does not dedupe). To improve: dedupe by title before adding.

## Priority list (suggested order)

1. (done this task) Loop+bugs fixes in the private lists.
2. Query smoke test helper + rules health check.
3. i18n `t(key, params)` conversion for the interpolated toasts.
4. Generate the SW precache list from a glob.
5. Imported shows: dedupe + TMDB name fetch matching.
6. Shopping/Experiences sorting polish (optional).
