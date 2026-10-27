# ADR-101: Robust data loading with watchdog and Firestore timeout (issue #286)

## Status
Accepted

## Date
2026-08-15

## Context

Issue #286 («Carga de datos» [Data loading], type: bug) reports that
sometimes data does not load when entering the web app: sometimes the
**«Cargando…»** [Loading…] indicator stays up indefinitely, other times
nothing appears at all, and the only option is to reload the page.

ADR-057 already covers transient errors in subscriptions
(`subscribeWithRetry` with 1 s/2 s/4 s backoff and waiting for the
«online» event), but it only reacts to `onError`: the case of a
**hung** subscription —neither error nor data— is missing, which leaves
the eternal «Cargando…» with no chance of a retry.

Root causes identified:

1. **The service worker cached Firestore GET reads** with `networkFirst`
   without a timeout and with `cache.put` into the dynamic cache. A
   Firestore response is a long-polling stream: the `cache.put` of an
   open stream **never resolves**, so the request hangs forever → the
   SDK never receives `onChange` or `onError` → the ADR-057 wrapper
   never finds out → eternal spinner. Additionally, Firestore protobufs
   should never be served from the dynamic (stale) cache.
2. **`subscribeWithRetry` only reacted to listener errors**; a
   subscription that neither fails nor delivers data triggered no
   retry.
3. **After exhausting the retries** (the final `onError` that shows the
   toast), the `.panel-loading` marker remained forever.
4. **The fetch of each tab's partial** (`loadOcioPartial`) had no
   timeout either: a hung network left the panel without content
   («nothing appears»).

Related issue: #286 — https://github.com/gonzalitojh/personal-tracker/issues/286

## Decision

### 1. First-snapshot watchdog in `subscribeWithRetry` (`js/retry.js`)

Each subscription attempt is watched with a timer: if no successful
snapshot arrives within `initialTimeoutMs` (new optional parameter,
default **12000 ms**, `0` disables it), the attempt is treated as a
**transient failure** and enters the existing retry flow (1/2/4 s
backoff or waiting for the «online» event). The timer is armed on each
`start()` and only watches the first snapshot of that attempt, with 5
cleanup points: armed with prior cleanup in `start()`, and cleaned up
in the successful `onChange`, in `handleError` (the real error arrives
before the watchdog — there is no double final error), in `retry()`
(the timer for attempt N must not fire in the middle of attempt N+1)
and in `cancel()`.

Additionally, `handleError` now calls `clearOnlineHandler()` **before**
registering the «online» listener: two consecutive `handleError` calls
while offline (e.g. watchdog + real stream error) no longer stack two
identical «online» listeners that would re-subscribe twice on every
reconnection.

### 2. Final error state in the Leisure panels (`js/app.js`)

- `showPanelLoadError(groupKey, message, { force = false })`: final
  error state that removes the `.panel-loading`, respects the
  `groupReady[groupKey]` guard (if the snapshot arrived late, the data
  is already painted and the subscription error makes no sense) except
  with `force` (partial path: without the panel HTML there is nothing
  to paint), and inserts a `.panel-error` with the message and a
  **«Reintentar»** [Retry] button (reuses `.btn--small`). It is
  idempotent (clears previous errors before painting).
- `retryPanelLoad(groupKey)`: restarts loading from the error state.
  It cancels and nulls `unsubscribeItems[groupKey]` (**required**:
  otherwise the `subscribeGroup` guard ignores the new subscription),
  deletes the panel id from `loadedPartials` (**required**: otherwise
  `loadOcioPartial` does not re-fetch the HTML), restores the loading
  marker and launches the partial fetch + `ensureGroupSubscribed`
  again.
- The **final** `onError` of `subscribeGroup` keeps the existing toast
  and adds `showPanelLoadError`. `renderLibraryFor` and the logout loop
  also remove the `.panel-error` (logout restores the loading marker
  when logging back in).

### 3. `AbortController` timeout in `loadOcioPartial` (`js/app.js`)

`PARTIAL_FETCH_TIMEOUT_MS = 8000`: the partial fetch uses an
`AbortController`; if the network hangs, it is aborted and falls into
the panel error state with a different message depending on the cause:
**«Esta sección tardó demasiado en cargarse.»** [This section took too
long to load.] (`AbortError`) vs **«No se pudo cargar esta sección.»**
[This section could not be loaded.] (any other failure). The id is
removed from `loadedPartials` in both cases (retryable with the button
or on the next activation) and the timer is cleared in a `finally`.

### 4. Service worker: Firestore network-only with timeout (`service-worker.js`)

- `offlineApiResponse()`: **single source** of the friendly 503
  (`{ error: 'offline', message: 'No hay conexión' }`); used by
  `networkFirst` (API fallback) and `networkOnlyWithTimeout`.
- `networkOnlyWithTimeout(request, ms = 8000)`: for Firestore GET
  reads. `fetchWithTimeout` **without** `cache.put` or `cache.match`
  (an open stream would hang the `put`, and protobufs are never served
  stale) and a `catch` that returns the 503 **without propagating the
  rejection**. The 503 remains the proven path that triggers the SDK's
  `onError` → wrapper retries (ADR-057).
- Caches `mi-registro-v4-*` → `mi-registro-v5-*`.

### 5. Versioning

`APP_VERSION` `20260929` → **`20261001`** in `js/config.js`,
`index.html` (3 `?v=` references) and `service-worker.js` (7 `?v=`
references). Note: `20260930` is **not** used because PR #284 (open)
already took it.

### Relationship with ADR-057

Modifies its **decision 3** in the service worker part: Firestore GET
reads go from `networkFirst` (with an optional timeout for navigation
only, no timeout for APIs) to **network-only with timeout** and no
caching. The rest of ADR-057 remains intact: wrapper, backoff, waiting
for the «online» event, toasts and ADR-057's own versioning. The 503
remains the path that triggers the SDK's `onError`, now also for the
hung case.

## Considerations

- **The watchdog is the backstop for clients with an old SW (v4)**:
  with the new SW the hang becomes a 503 after 8 s (SW timeout), before
  the watchdog (12 s); with an old SW the request hangs without ever
  failing and only the watchdog detects it.
- **The watchdog only watches the first snapshot of the attempt**: a
  stream already delivering live data is not cut (its `onChange`
  removes the timer).
- **Visible change for the user**: yes, AGENTS.md rule 3 applies —
  `docs/manual-de-usuario.md` is updated in the same task (sections 3,
  18 and 21).
- **Scope**: the `.panel-error` with the «Reintentar» button applies to
  the 4 Leisure panels (series, movies, books, video games); the rest
  of the subscriptions only inherit the watchdog (see Neutral
  Consequences).

## Rejected alternatives

- **Caching Firestore reads with TTL (stale + streams)**: rejected —
  Firestore responses are protobufs that must not be served stale, and
  a long-polling stream is impossible to cache (`cache.put` never
  resolves).
- **Infinite retry**: rejected — accumulating timers with no clear
  outcome for the user; the retry cap with backoff and the final error
  state remain the outcome (ADR-057).
- **Watchdog outside the wrapper, in `app.js`**: rejected — it would
  duplicate the logic per subscription and would not cover those that
  do not go through `app.js` (notifications, recipes, menu, gym).
- **Error state without a «Reintentar» button**: rejected — it would
  force reloading the page, which is exactly the symptom reported by
  issue #286.
- **Watchdog only in the client, no SW timeout**: rejected — the
  `cache.put` hang leaves the network request alive and impossible to
  retry; the SW timeout is the cure for the root cause and the watchdog
  remains as a backstop for clients with an old SW.

## Consequences

### Positive

- **End of the eternal «Cargando…» (issue #286)**: a hung subscription
  is detected (SW: 8 s; watchdog: 12 s) and treated as a transient
  failure with automatic retry.
- **Automatic recovery**: with the new SW, the hang becomes a 503 →
  SDK `onError` → wrapper retries → data loads without reloading the
  page.
- **«Reintentar» button**: if retries are exhausted, there is an
  immediate manual path without reloading the page (and the panel ends
  in a clear final state instead of the eternal spinner).
- **Backstop for old SWs**: clients still running the v4 cache recover
  anyway thanks to the wrapper watchdog.

### Negative / Risks

- **Wait until the final error state**: in the worst case ~43 s with an
  old SW (4 attempts cut by the 12 s watchdog plus the backoffs) and
  ~16 s with the new SW (8 s SW timeout + backoffs) until the
  `.panel-error` is shown. Accepted: it is the cost of exhausting the
  retries before giving up.
- **Final toast sometimes with visible data**: if the late snapshot
  arrives just before the final `onError`, the `groupReady` guard
  prevents the `.panel-error` but the toast («No se pudieron cargar…»
  [Could not load…]) still shows, even though the library already has
  content. Cosmetic warning, accepted.

### Neutral

- **Other subscriptions inherit the watchdog unchanged**: the
  `initialTimeoutMs` parameter has a default; notifications, recipes,
  menu and gym benefit from it without touching their code.
- **Recipes, menu and gym remain toast-only**: the `.panel-error` with
  the «Reintentar» button is only added to the 4 Leisure panels.
- **Notifications keep retrying silently** (`onError: () => {}`), also
  when the watchdog cuts an attempt.
- **SW caches v4 → v5**: browsers with v4 purge it on the next
  `activate` (existing SW mechanism).

## Files created/modified

| File | Change |
|---------|--------|
| `js/retry.js` | **Modified**: first-snapshot watchdog `initialTimeoutMs` (default 12000 ms, `0` disables it) in `subscribeWithRetry` — a timer per attempt that treats a subscription delivering no successful snapshot within that time as a transient failure, with 5 cleanup points (armed in `start()`; cleaned in the successful `onChange`, `handleError`, `retry()` and `cancel()`); `clearOnlineHandler()` before registering the «online» listener in `handleError` (avoids duplicate listeners while offline) |
| `js/app.js` | **Modified**: `showPanelLoadError(groupKey, message, {force})` — final error state of the Leisure panels (removes `.panel-loading`, `groupReady` guard except with `force`, inserts `.panel-error` with message and «Reintentar» button, idempotent); `retryPanelLoad(groupKey)` — cancels and nulls `unsubscribeItems[groupKey]` (`subscribeGroup` guard), removes it from `loadedPartials` (`loadOcioPartial` guard), restores the loading marker and relaunches partial + subscription; final `onError` of `subscribeGroup` keeps the toast and adds the panel error; `renderLibraryFor` and the logout loop remove `.panel-error`; `loadOcioPartial` with `AbortController` (`PARTIAL_FETCH_TIMEOUT_MS = 8000`) and different messages for `AbortError` vs the rest; new `GROUP_TO_PANEL` map |
| `css/styles.css` | **Modified**: `.panel-error` and `.panel-error__message` — same pattern as `.panel-loading`, only with theme variables (`--ink-soft`), `overflow-wrap: break-word`; the «Reintentar» button reuses `.btn--small` |
| `service-worker.js` | **Modified**: `offlineApiResponse()` as the single source of the friendly 503; `networkOnlyWithTimeout(request, ms = 8000)` for Firestore GET reads — `fetchWithTimeout` without `cache.put` or `cache.match`, `catch` → 503 without propagating the rejection; caches `mi-registro-v4-*` → `mi-registro-v5-*` |
| `js/config.js` | **Modified**: `APP_VERSION` `20260929` → `20261001` (20260930 is not used: PR #284 already took it) |
| `index.html` | **Modified**: `?v=20260929` → `?v=20261001` in `css/styles.css`, `ocio/ocio.css` and `js/app.js` |
| `docs/manual-de-usuario.md` | **Modified**: sections 3, 18 and 21 — if the data does not arrive within a few seconds the app has already tried several times and shows a notice with a «Reintentar» button; it also retries if the connection hangs (AGENTS.md rule 3) |

Related issue: #286 — https://github.com/gonzalitojh/personal-tracker/issues/286
