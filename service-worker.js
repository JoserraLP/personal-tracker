// =============================================================
// Service Worker — Personal Tracker (PWA offline support)
// Strategies: Cache First for static assets, Network First for
// external APIs, Network Only for writes and authentication
// endpoints, and Network Only with timeout for Firestore GET
// reads (issue #286): a hung stream becomes a 503 that triggers
// the retries of the subscribeWithRetry wrapper (issue #147),
// and Firestore responses are never cached (stale protobufs,
// long-polling streams impossible to store).
// =============================================================

// -------------------------------------------------------------
// Dynamic base: each branch is deployed in its own
// subdirectory (e.g. .../<branch>/), so all routes are resolved
// RELATIVE to the SW's own scope (self.registration.scope).
// The same file serves the root (main) and each branch preview,
// with nothing hardcoded.
// -------------------------------------------------------------
const scopeURL = new URL(self.registration.scope);
const scopePath = scopeURL.pathname;
const resolved = (p) => new URL(p, scopeURL).toString();

const CACHE_STATIC = 'mi-registro-v18-static';
const CACHE_DYNAMIC = 'mi-registro-v11-dynamic';
const DYNAMIC_MAX_ENTRIES = 100; // issue #200: the on-demand detail caches more images (posters/backdrops) in the dynamic cache

// -------------------------------------------------------------
// Assets preloaded during the "install" event.
// Scope-relative paths: they are resolved with `resolved()` at
// install, so they work the same at the root and in
// subdirectories.
// -------------------------------------------------------------
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css?v=20261030',
  './ocio/ocio.css?v=20261030',
  './js/app.js?v=20261030',
  './js/router.js',
  './js/i18n.js',
  './js/ui.js',
  './js/db.js',
  './js/firebase.js',
  './js/config.js',
  './js/constants.js',
  './js/dates.js',
  './js/http.js',
  './js/retry.js',
  './js/release.js',
  './js/modal-handlers.js',
  './js/notifications-setup.js',
  './js/profile.js',
  './js/quick-actions.js',
  './js/rating-modal.js',
  './js/reading-log.js',
  './js/search.js',
  './js/sorting.js',
  './js/tv-progress.js',
  './js/watch-log.js',
  './js/daily-check.js',
  './js/item-details.js',
  './js/migration.js',
  './js/undo-delete.js',
  './js/api-books.js',
  './js/api-movies.js',
  './js/api-games.js',
  './js/game-log.js',
  './js/sw-register.js',
  './js/activity-feed.js',
  './js/export-backup.js',
  './js/export-ics.js',
  './js/episode-actions-modal.js',
  './js/focus-utils.js',
  './js/global-search.js',
  './js/settings.js',
  './js/sidebar.js',
  './js/auto-hide-nav.js',
  './js/push.js',
  // Recipes section (issue #64)
  './js/recipes-data.js',
  './js/recipes.js',
  './js/menu.js',
  './js/shopping-list.js',
  // Gym section (issue #62)
  './js/gym.js',
  './js/wishlist.js',
  './js/experiences.js',
  './js/api-steam.js',
  './js/counter.js',
  './resources/icon.png',
  './ocio/series.html?v=20261030',
  './ocio/peliculas.html?v=20261030',
  './ocio/libros.html?v=20261030',
  './ocio/videojuegos.html?v=20261030',
  './ocio/compras.html?v=20261030',
  './ocio/experiences.html?v=20261031b',
];

// -------------------------------------------------------------
// Install: preload all the static assets
// -------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      // We use cache.addAll but with individual error handling
      // so a failing asset does not block the rest
      return Promise.allSettled(
        STATIC_ASSETS.map((path) => {
          const url = resolved(path);
          return cache.add(url).catch((err) => {
            console.warn('[SW] No se pudo precachear:', url, err);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// -------------------------------------------------------------
// Activate: clean old caches and take control
// -------------------------------------------------------------
self.addEventListener('activate', (event) => {
  const allowedCaches = [CACHE_STATIC, CACHE_DYNAMIC];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !allowedCaches.includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// -------------------------------------------------------------
// Caching helpers
// -------------------------------------------------------------

/**
 * Cache First: responds from the cache if present; if not,
 * fetches, stores in the static cache and responds.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Offline fallback: for navigation, return the app shell
    if (request.mode === 'navigate') {
      return caches.match(resolved('./index.html'));
    }
    throw err;
  }
}

/**
 * Fetch with timeout: prevents a slow or hung network from
 * blocking navigation. Rejects if the response takes longer than
 * `ms` ms, letting the networkFirst cache fallback act.
 */
function fetchWithTimeout(request, ms = 3000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`[SW] Timeout: la petición tardó más de ${ms}ms`)), ms)
  );
  return Promise.race([fetch(request), timeout]);
}

/**
 * Friendly 503 response for when a request fails or hangs.
 * It is the single source of the fallback: the Firestore SDK
 * interprets it as a network error and fires the subscription's
 * onError, which the subscribeWithRetry wrapper turns into a
 * retry (ADR-057).
 */
function offlineApiResponse() {
  return new Response(
    JSON.stringify({ error: 'offline', message: 'No hay conexión' }),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Network First: tries the network first; if it fails, looks in
 * the dynamic cache. Limits the number of cached entries.
 *
 * `timeoutMs` is optional and must ONLY be used for navigation:
 * it prevents a slow or hung network from blocking the document
 * load. External APIs carry no timeout to avoid false "offline"
 * on slow networks. (Firestore GET reads no longer go through
 * here: since issue #286 they use networkOnlyWithTimeout.)
 *
 * Returns `{ response, fromNetwork }` so the caller knows whether
 * the response came from the network (to refresh canonical caches).
 */
async function networkFirst(request, timeoutMs = null) {
  let fromNetwork = false;
  try {
    const response = timeoutMs
      ? await fetchWithTimeout(request, timeoutMs)
      : await fetch(request);
    if (response && response.ok) {
      fromNetwork = true;
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
      // Limit the size of the dynamic cache
      trimCache(CACHE_DYNAMIC, DYNAMIC_MAX_ENTRIES);
    }
    return { response, fromNetwork };
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return { response: cached, fromNetwork: false };
    // Fallback for navigation
    if (request.mode === 'navigate') {
      return { response: await caches.match(resolved('./index.html')), fromNetwork: false };
    }
    // For APIs, return a friendly 503
    return { response: offlineApiResponse(), fromNetwork: false };
  }
}

/**
 * Network Only with timeout (issue #286): for Firestore GET
 * reads. No cache of any kind (neither match nor put: an open
 * long-polling stream makes cache.put never resolve, and
 * protobufs must not be served stale from the dynamic cache) and
 * without propagating the rejection: the timeout or the failure
 * returns the friendly 503, which is the tested path that fires
 * the SDK's onError and the retries of the subscribeWithRetry
 * wrapper (ADR-057).
 */
async function networkOnlyWithTimeout(request, ms = 8000) {
  try {
    return await fetchWithTimeout(request, ms);
  } catch (err) {
    return offlineApiResponse();
  }
}

/**
 * Limits the dynamic cache to a maximum number of entries.
 * Deletes the oldest ones when the limit is exceeded.
 */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    // Delete the oldest entries (the first ones of the list)
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
  }
}

// -------------------------------------------------------------
// Fetch: strategy routing depending on the resource type
// -------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ---- Network Only: write operations and auth ----
  if (
    url.hostname === 'firestore.googleapis.com' &&
    event.request.method !== 'GET'
  ) {
    return; // They pass without SW intervention
  }

  if (
    url.hostname === 'identitytoolkit.googleapis.com' ||
    url.hostname === 'securetoken.googleapis.com'
  ) {
    return; // They pass without SW intervention
  }

  // ---- Navigation: Network First (with timeout) and fallback to the app shell ----
  if (event.request.mode === 'navigate') {
    event.respondWith(
      networkFirst(event.request, 3000).then(({ response, fromNetwork }) => {
        // Only if it came from the network, refresh the canonical
        // app shell entry in the static cache, so the offline
        // fallback never stays outdated with respect to the last
        // deploy. If the response came from the cache
        // (timeout/offline), it is left untouched.
        if (fromNetwork && response && response.ok) {
          caches
            .open(CACHE_STATIC)
            .then((cache) => cache.put(resolved('./index.html'), response.clone()))
            .catch((err) =>
              console.warn('[SW] No se pudo refrescar el app shell en caché:', err)
            );
        }
        return response;
      })
    );
    return;
  }

  // ---- Cache First: own static assets ----
  if (url.pathname.startsWith(scopePath)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: Firebase SDK (CDN) ----
  if (url.hostname === 'www.gstatic.com') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: Google Fonts ----
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: Chart.js ----
  if (
    url.hostname === 'cdnjs.cloudflare.com' &&
    url.pathname.includes('/Chart.js/')
  ) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: TMDB images (posters) ----
  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: Open Library covers ----
  if (url.hostname === 'covers.openlibrary.org') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Cache First: IGDB images (covers) ----
  if (url.hostname === 'images.igdb.com') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ---- Network First: external APIs (TMDB, Google Books, Open Library) ----
  if (
    url.hostname === 'api.themoviedb.org' ||
    url.hostname === 'www.googleapis.com' ||
    url.hostname === 'openlibrary.org'
  ) {
    event.respondWith(networkFirst(event.request).then(({ response }) => response));
    return;
  }

  // ---- Network Only with timeout: Firestore GET reads (issue #286) ----
  // networkFirst does NOT work here: Firestore responses are
  // long-polling streams; the cache.put of an open stream never
  // resolves and leaves the request hung forever (neither onChange nor
  // onError in the SDK → eternal «Cargando…», no retries), and
  // protobufs should never be served from the dynamic cache. With
  // networkOnlyWithTimeout, a hung request becomes a 503 that the
  // SDK treats as a network error: the subscribeWithRetry wrapper
  // (issue #147) retries and the site recovers on its own.
  if (
    url.hostname === 'firestore.googleapis.com' &&
    event.request.method === 'GET'
  ) {
    event.respondWith(networkOnlyWithTimeout(event.request));
    return;
  }

  // ---- Everything else: pass without intervention ----
});

// -------------------------------------------------------------
// Messages from the page (e.g. SKIP_WAITING to update)
// -------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // System notification: the page (js/push.js) forwards here the
  // internal bell notifications when the app is in the background
  // and the user has device push enabled.
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { id, message } = event.data || {};
    if (!id || typeof message !== 'string' || !message) return;
    event.waitUntil(
      self.registration.showNotification('Personal Tracker', {
        body: message,
        icon: resolved('./resources/icon.png'),
        badge: resolved('./resources/icon.png'),
        tag: 'notif-' + id,
        data: { url: './index.html' },
      }).catch((err) => console.warn('[SW] showNotification falló:', err))
    );
  }
});

// -------------------------------------------------------------
// Click on a system notification: bring focus to the existing
// app window or open it if there is none.
// -------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = resolved((event.notification.data && event.notification.data.url) || './index.html');
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((client) => client.url.startsWith(scopePath));
      if (existing) {
        return existing.focus();
      }
      return clients.openWindow(url);
    })
  );
});
