# ADR-019: Service worker cache update strategy (fix issue #25)

## Status
Accepted

## Date
August 2026

## Context

The PWA installed on mobile **did not reflect new changes after each deploy**: the interface kept showing the old version indefinitely, even when forcing reloads. Root cause analysis (issue #25) identified four combined problems:

1. **SW registration was dead code**: `index.html` did not import `js/sw-register.js`. The accessibility commit `240d1b5` removed the inline registration block and the module import was never restored, so in recent deployments the service worker was not even registered.
2. **`service-worker.js` served EVERYTHING it owned with cache-first**, including navigation: once `index.html` was cached, it was served from cache forever, never checking the network.
3. **Unversioned assets**: a deploy did not invalidate the existing SW cache, because the resources' URLs did not change between versions.
4. **`STATIC_ASSETS` outdated**: 6 JS modules were missing (`activity-feed`, `export-backup`, `export-ics`, `focus-utils`, `global-search`, `settings`), so they were not precached with the old resources or not precached at all.

The goal was for the installed PWA to receive the changes of each deploy reliably and automatically, without requiring the user's manual interaction (the old update toast) nor uninstalling/reinstalling the app.

Related issue: #25 — https://github.com/gonzalitojh/personal-tracker/issues/25

## Decision

Adopt a service worker cache update strategy based on **explicit asset versioning + auto-apply of updates + network-first navigation with timeout**, with the following components:

### 1. `service-worker.js`: v2 caches, network-first navigation and versioned assets

- **Caches bumped**: `mi-registro-v2-static` / `mi-registro-v2-dynamic`. The `activate` event deletes any cache not in the allowed list (v1 caches are automatically deleted on the first v2 activate).
- **`fetchWithTimeout(request, ms = 3000)`**: helper that rejects the request if it takes longer than 3 s. It is used **ONLY for navigation**.
- **`networkFirst(request, timeoutMs = null)`**: now takes an optional `timeoutMs` (`null` for APIs → no timeout, avoiding false "offline" on slow networks) and returns `{ response, fromNetwork }` so the caller knows the origin of the response. It keeps the 50-entry limit in the dynamic cache and the fallbacks (cache → app shell for navigation → `503` JSON for APIs).
- **Reordered fetch handler**: first the network-only exceptions (Firestore writes and auth endpoints), then the **`navigate` block with network-first + timeout (3000 ms) BEFORE the own-path cache-first**, and then the remaining strategies (cache-first for own/static/CDN/posters, network-first for APIs). The old `navigate` block at the end of the handler was removed.
- **Refresh of the canonical entry**: when a navigation responds `fromNetwork === true`, `/personal-tracker/index.html` is rewritten in `CACHE_STATIC` with the fresh response, so the offline fallback never lags behind the last deploy. If the response came from cache (timeout/offline), it is not touched.
- **`STATIC_ASSETS` updated**: the 6 missing modules were added (`activity-feed.js`, `export-backup.js`, `export-ics.js`, `focus-utils.js`, `global-search.js`, `settings.js`) and asset URLs were versioned with `?v=20260803` (`styles.css`, `ocio.css`, `app.js` and the `ocio/*.html` fragments).

### 2. `js/sw-register.js`: reliable registration and auto-apply of updates

- `register()` registers the SW with **`updateViaCache: 'none'`**, so the browser always checks whether there is a new SW version (the SW's HTTP check is never served from the HTTP cache).
- **Auto-apply of the update without toast**: `postMessage({ type: 'SKIP_WAITING' })` is sent if `registration.waiting` exists (update pending from an earlier registration) or when a new worker reaches `installed` state with `navigator.serviceWorker.controller` present.
- The **`refreshing` guard** remains intact: the reload on `controllerchange` runs only once, avoiding double reloads.
- `notifyUpdateReady()` (and `applySWUpdate()`) remain exported **for compatibility** with existing code; registration no longer uses them.
- The dependency on the "Nueva versión disponible" toast documented in ADR-007 is removed.

### 3. `index.html`: SW registration restored and iOS metas

- **Registration block restored** at the end of the body: import of `./js/sw-register.js` + call to `registerSW()` when the browser supports service workers.
- **3 versioned refs** with `?v=20260803` (`css/styles.css`, `ocio/ocio.css`, `js/app.js`).
- **iOS metas restored** (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`), removed by the regression of the accessibility commit `240d1b5`.

### 4. `js/config.js`: centralized app version

- New `export const APP_VERSION = '20260803'`, single source of truth for the deploy/cache version number.

### 5. `js/app.js`: versioned ocio fragments

- Import of `APP_VERSION` from `./config.js` and fetch of the `ocio/*.html` fragments with `'?v=' + APP_VERSION`, so changes to those partials invalidate the cache on the client.

### 6. `scripts/bump-version.sh` (new): coherent version bump

Bash script that centralizes the versioning of each deploy:

- Replaces `?v=<old>` → `?v=<new>` in `index.html` and `service-worker.js` (STATIC_ASSETS), and `APP_VERSION = '<old>'` → `APP_VERSION = '<new>'` in `js/config.js`.
- **Validates the argument** (exactly one, only `[0-9A-Za-z]+`, and `help` mode).
- **Verifies the final coherence** of the three files (warning + exit `3` if anything was not coherent), so forgetting the bump is detectable and nothing is deployed with inconsistent versions.

## Rejected alternatives

- **`stale-while-revalidate` for assets without hashes**: rejected because, without versioning in the URLs, the strategy returns the cached (old) version to the user and only updates in the background, so the change is not visible on the first load after the deploy; it does not solve the perception that "it does not update". The chosen option (network-first navigation + versioning) guarantees that the new document and assets arrive in the same visit.
- **Only bumping the cache name without versioning assets**: rejected because, although the new SW is installed, the resources' URLs do not change and the v2 cache entries would be filled with the same old resources; it also did not cover the broken registration case (issue #25, point 1).
- **Keeping the manual update toast instead of auto-apply**: rejected because the toast depended on `notifyUpdateReady` which the page no longer fired after the regression, it required user interaction on every deploy (friction on mobile) and the underlying problem was the navigation strategy, not the notification. The exports are kept for compatibility, but the active flow is auto-applied.

## Consequences

### Positive
- **The installed PWA receives the changes of each deploy**: with registration restored and network-first navigation, the canonical entry of `index.html` is refreshed in the static cache and the user sees the new version on their next opening, without reinstalling the app.
- **No false "offline" on APIs**: the timeout applies only to navigation; API/Firestore calls keep network-first with no time limit and only fall back to cache or `503` on real failures.
- **Resilient navigation**: a slow or hung network no longer blocks the document load; after 3 s the cached app shell is served.
- **Frictionless auto-update**: the user does not have to press any "Update" button after each deploy.
- **Centralized and verifiable versioning**: `bump-version.sh` synchronizes the three files and detects inconsistencies before deploying.
- **Complete precache**: the 6 missing modules are now included in `STATIC_ASSETS`.

### Negative
- **Potential navigation latency**: with a hung network, the first load waits up to 3 s before serving the cache.
- **Double versioning source**: the `?v=` refs and `APP_VERSION` must be kept in sync on every deploy; skipping `bump-version.sh` would reintroduce stale caches (mitigated by the script's coherence check).
- **Unexpected reload**: auto-apply reloads the page when the new SW takes control, which can interrupt the user in the middle of an action (single reload thanks to the `refreshing` guard).
- **Network cost from `updateViaCache: 'none'`**: the browser checks the SW on every load, even though it is a conditional request (304) in most cases.

### Neutral
- **Caches move to v2**: users with v1 caches receive v2 on the first `activate` of the new SW (v1 ones are deleted automatically).
- **New version number per deploy**: `20260803` is the initial version; each subsequent deploy should increment it (day or sequence) with `bump-version.sh`.
- **ADR-007 is partially superseded**: the navigation strategy and update flow described there (update toast) are replaced by this ADR; the rest of the cache strategies remain in force.

## Created/modified files

| File | Change |
|---------|--------|
| `service-worker.js` | Caches `mi-registro-v2-*`, `fetchWithTimeout` (3 s navigation only), `networkFirst` with optional `timeoutMs` and `{ response, fromNetwork }`, reordered fetch handler (navigate before own-path), refresh of the canonical `index.html` entry only when `fromNetwork`, `STATIC_ASSETS` with the 6 missing modules and URLs `?v=20260803` |
| `js/sw-register.js` | `register()` with `updateViaCache: 'none'`, auto-apply of the update (`SKIP_WAITING`) without toast, `refreshing` guard intact, `notifyUpdateReady`/`applySWUpdate` exported for compatibility |
| `index.html` | SW registration block restored at the end of the body (import `./js/sw-register.js` + `registerSW()`), 3 refs `?v=20260803`, iOS metas restored |
| `js/config.js` | New `export const APP_VERSION = '20260803'` |
| `js/app.js` | Import of `APP_VERSION` from `./config.js` and fetch of `ocio/*.html` fragments with `?v=APP_VERSION` |
| `scripts/bump-version.sh` | **New**: synchronizes `?v=` and `APP_VERSION` between `index.html`, `js/config.js` and `service-worker.js`; validates the argument and verifies final coherence |
| `docs/adr-007-pwa-service-worker.md` | Initial note stating that the navigation strategy and update flow are superseded by this ADR |
