# ADR-007: Service Worker for a full PWA with offline support

## Status
Accepted

> **Note (August 2026):** this ADR describes the original implementation of the
> service worker (`mi-registro-v1-*` caches). The **navigation strategy**
> and the **update flow** ("New version available" toast and
> manual SW registration) are **superseded by ADR-019** — *Service worker cache
> update strategy* (fix issue #25). Since then,
> navigation uses network-first with a timeout (3 s), updates are
> auto-applied (`SKIP_WAITING`) with no toast, assets carry
> `?v=`/`APP_VERSION` versioning and the caches moved to `mi-registro-v2-*`. The rest of the
> cache strategies (cache-first for statics/CDNs/posters, network-first
> for APIs, network-only for writes and auth) remain in force.

## Context
The "Mi Registro" application already had a `manifest.json` that
defined the basic metadata for being a Progressive Web App
(name, icons, theme, `display: standalone`). However, it lacked the
**service worker**, which is the essential component that enables:

1. **"Add to home screen"** in supporting browsers
   (Chrome, Edge, Safari, Samsung Internet). Without a service worker, the
   browser does not consider the app installable.
2. **Offline operation**: without a service worker, the application
   requires an internet connection even to load its own HTML,
   CSS and JavaScript.
3. **Controlled updates**: the service worker allows
   managing application versions without interfering with the
   user experience.

The application is served from the subpath `/Registro-personal/` on
GitHub Pages, and uses multiple external resources: Firebase for
authentication and database, TMDB for movie/series data,
Google Books and Open Library for book data, Google Fonts for
typography, and the Chart.js CDN for statistics.

## Decision
Implement a hand-written service worker (no external libraries like
Workbox) with the following cache strategies:

### Cache strategies

| Resource type | Examples | Strategy | Cache name |
|---|---|---|---|
| **App shell (statics)** | HTML, CSS, JS, manifest, icons, HTML partials | Cache First | `mi-registro-v1-static` |
| **Google Fonts** | `fonts.googleapis.com`, `fonts.gstatic.com` | Cache First | `mi-registro-v1-static` |
| **Library CDNs** | Chart.js, Firebase SDK (`www.gstatic.com`) | Cache First | `mi-registro-v1-static` |
| **Posters/covers** | `image.tmdb.org`, `covers.openlibrary.org` | Cache First | `mi-registro-v1-static` |
| **External APIs** | TMDB, Google Books, Open Library | Network First | `mi-registro-v1-dynamic` |
| **Firestore GET** | Data reads | Network First | `mi-registro-v1-dynamic` |
| **Firestore writes** | POST/PUT/DELETE to Firestore | Network Only | — |
| **Firebase Auth** | `identitytoolkit`, `securetoken` | Network Only | — |

### Architecture

```
service-worker.js              → Classic file (not a module) at the root
js/sw-register.js              → ES module for registration and lifecycle
index.html                     → Imports sw-register.js and adds the update UI
manifest.json                  → Added scope and description
```

### Installation flow

1. The user visits the page.
2. `sw-register.js` registers `service-worker.js` with the scope
   `/Registro-personal/`.
3. The SW's `install` event preloads all static assets
   (30+ files) into the `mi-registro-v1-static` cache.
4. The `activate` event clears old caches and takes control of
   all open tabs.

### Update flow

1. When a new version of the SW is deployed, the new worker
   installs but stays in the `waiting` state (because the previous one still
   controls the page).
2. `sw-register.js` detects the change via the
   `updatefound` event and the transition to `installed`.
3. A custom event `sw-update-ready` is dispatched.
4. The page shows a toast with the message "New version
   available" and an "Update" button.
5. On click, a `SKIP_WAITING` message is sent to the waiting SW.
6. The active SW calls `self.skipWaiting()`, which triggers
   `controllerchange` on the page.
7. The page reloads automatically with the new SW version
   in charge.

### Offline fallback mechanism

- **Navigation**: If a navigation request fails (user
  offline), the cached `index.html` is returned.
- **APIs**: If an API call fails, the previously cached result is returned,
  or a JSON with error `503` if there is no cache.
- **Realtime Firestore**: `onSnapshot` subscriptions use
  WebSocket/gRPC, which do not go through the SW. The Firebase SDK handles
  reconnection internally. The existing error messages in
  `app.js` already show toasts when data loading fails.
- **Writes**: mutations to Firestore (POST/PUT/DELETE) pass through
  without SW intervention, so they are not accidentally cached.

### Dynamic cache limiting
The dynamic cache (`mi-registro-v1-dynamic`) is limited to 50 entries
to prevent it from growing out of control. Oldest entries are
removed automatically when the limit is exceeded.

### Rejected alternatives

- **Workbox**: Google library that simplifies creating
  service workers. Rejected to keep the project free of
  additional dependencies and because the manual implementation is
  straightforward for this use case.
- **Using `importScripts`**: Not necessary; all the SW logic
  fits in a single file.
- **Dedicated offline page (`offline.html`)**: It was decided to use the
  cached `index.html` itself as the fallback, since the app shows
  the login screen which is useful even without a connection.
- **Firebase Auth caching**: Explicitly excluded for security
  (authentication credentials must not be cached).

## Consequences

### Positive
- The application is now a **full PWA** and can be "Added to
  home screen" on mobile and desktop devices.
- **The basic interface loads offline**: the user sees at least the
  login screen even without a connection.
- **Static assets load faster** on subsequent visits thanks to
  the local cache.
- **Updates are managed in a controlled way**: the user decides when to apply a new version via the update toast.

### Negative
- The service worker adds **complexity to the development cycle**: changes to static assets require changing the cache name (version) so users receive the new version.
- **The first visit gets no cache benefit**: the SW installs
  asynchronously and assets are cached in the background.
- **Old browsers** (IE11, old Safari) do not support
  service workers, but the application keeps working without SW on
  these browsers (graceful degradation).

### Neutral
- The project goes from ~22 KB of JS to ~24 KB (`sw-register.js` is added). `service-worker.js` is downloaded only once
  and is not included in the bundle.
- Firebase `onSnapshot` (WebSocket/gRPC) cannot be intercepted by the
  SW; realtime subscriptions keep working exactly as
  before.

## Files created/modified
- `service-worker.js` — New: main service worker with caching logic and network strategies (258 lines).
- `js/sw-register.js` — New: module for registering and managing the SW lifecycle (80 lines).
- `index.html` — Modified: added iOS PWA metadata, SW update toast, and registration script.
- `manifest.json` — Modified: added `description` and `scope`.
