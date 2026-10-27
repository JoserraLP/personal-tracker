# ADR-057: Automatic retry on the initial data load (issue #147)

## Status
Accepted

## Date
2026-08-09

## Context

Issue #147 («Recarga de ítems») reports a reliability bug on
entering the web: sometimes the data did not load (movies, series,
books and notifications) and the only recourse was to close the tab
and reopen it.

Root cause: the realtime `onSnapshot` subscriptions of Firestore
(`subscribeToItems`/`subscribeToNotifications` in `js/db.js`, used in
`js/app.js` within `watchAuthState` → `init()`) fail due to transient
errors (network, connection to Firestore…). The `onError` callback only
showed a toast («No se pudieron cargar tus películas/series/libros»)
and never retried: the stream stayed dead and the library empty
until closing and reopening the web.

The scenario is further favored by the service worker: GET requests to
`firestore.googleapis.com` are served with
`networkFirst` and, without connection, the SW returns a **fake 503** (the
API fallback). The Firestore SDK receives that 503 as a subscription
error and fires `onError` — even if the user is merely
without network at that moment.

Related issue: #147 — https://github.com/gonzalitojh/personal-tracker/issues/147

## Decision

### 1. Generic wrapper `subscribeWithRetry()` in `js/retry.js`

`js/retry.js` is created with `subscribeWithRetry({ subscribe, onChange,
onError, onRetrying, maxRetries = 3, baseDelayMs = 1000,
waitForOnline = true })`, a wrapper that wraps **any**
subscription and keeps it alive against transient failures:

- **Failure flow**: when the subscription fires `onError`, the
  wrapper cancels the broken subscription and resubscribes with
  **exponential backoff** (`baseDelayMs * 2^(n-1)` → 1 s, 2 s, 4 s)
  up to `maxRetries` retries (4 attempts in total: the initial one + 3
  retries). When exhausted, the **final** `onError` is called (each
  group's original toast).
- **Waiting for the «online» event**: if `navigator.onLine === false`
  (the user's main scenario: the SW returns the fake 503 without
  network), the wrapper **does not spend the retries** with timers: it
  registers an `online` event listener and resubscribes on the fly as
  soon as the connection returns.
- **Informative `onRetrying`, once per episode**: the
  `notifiedRetry` flag guarantees that the notice «Hay problemas de
  conexión. Reintentando…» shows **once** per failure episode, not on
  every retry; it resets with the first successful snapshot (`attempts =
  0; notifiedRetry = false;` in the wrapper's `onChange`), so a future
  failure warns and retries again from scratch.
- **Stable `cancel()`**: returns a cancellation function safe to call
  several times: a `cancelled` guard discarding late callbacks, a
  `clearTimeout` of the backoff timer, a `removeEventListener` of the
  `online` listener and cancellation of the active subscription. It is
  compatible with the signature `stopAllSubscriptions()` already
  expected.
- **Synchronous errors covered**: `onSnapshot` may throw
  synchronously; `start()`'s `try/catch` treats that exception the same as
  an asynchronous listener error.
- **Never two live subscriptions**: `retry()` cancels the broken
  subscription before recreating it (the unsubscribe of an already-dead
  stream is harmless).

### 2. The 4 subscriptions of `js/app.js` get wrapped

- **Movies, series and books**: each `subscribeToItems` is wrapped
  with `subscribeWithRetry`. The **final** `onError` keeps the original
  toasts («No se pudieron cargar tus películas/series/libros») and
  `onRetrying` shows «Hay problemas de conexión. Reintentando…».
- **Notifications**: `subscribeToNotifications` uses the same wrapper
  but **retries silently** (`onError: () => {}`, like its original
  error which did not disturb); the badge fills in when the retry
  succeeds.
- **No collateral changes**: `stopAllSubscriptions()` is untouched (the
  returned `cancel()` is stable) and the `onChange` bodies
  (`ready` flags, `renderLibraryFor`, `maybeTriggerDailyCheck`, badge)
  stay intact — only the container changes.

### 3. Service worker and versioning

- `service-worker.js`: `./js/retry.js` is added to `STATIC_ASSETS`
  (prerequisite: `app.js` imports it and the SW serves the modules
  offline) and `CACHE_STATIC`/`CACHE_DYNAMIC` move from
  `mi-registro-v3-*` to `mi-registro-v4-*`.
- Full versioning of the deploy: `APP_VERSION` `20260823` →
  `20260830` in `js/config.js`; `?v=20260830` in `index.html`
  (`css/styles.css`, `ocio/ocio.css`, `js/app.js`) and in the versioned
  entries of `STATIC_ASSETS` (`ocio/series.html`,
  `ocio/peliculas.html`, `ocio/libros.html`).

### 4. QA iteration's fix: full cleanup in `retry()` (commit 2f15541)

In the first iteration, `retry()` resubscribed without cleaning the
previous state, which broke subsequent retries in two ways: the
already-fired timer's id stayed truthy and the `retryTimer` guard of
`handleError` blocked any later error; and the `online`
listener stayed orphaned, firing spurious resubscriptions on every
reconnection. As part of the final decision, `retry()` now does
`clearTimeout(retryTimer); retryTimer = null; clearOnlineHandler();`
**before** canceling the broken subscription and resubscribing.

## Considerations

- **The SW's fake 503 becomes the wrapper's entry signal**: the APIs'
  `networkFirst` strategy is not modified; when the user is without
  network, the subscription's error arrives anyway and the wrapper decides: if
  `navigator.onLine === false`, it waits for the «online» event without
  spending retries (the bug's main scenario); if the device believes it
  is online but Firestore truly fails, it uses the backoff.
- **Times**: with the defaults, the accumulated wait
  until the final toast is ~7 s (1+2+4). The user sees the informative
  notice first and the error one only if the retries are exhausted.
- **Visible change for the user**: AGENTS.md's rule 3 applies —
  `docs/manual-de-usuario.md` is updated in the same task
  (sections 15 and 18).
- **Scope bounded to subscriptions**: one-off reads
  (`getDoc`/`getDocs`, e.g. the manual sync) are outside the
  mechanism (see Rejected alternatives).

## Rejected alternatives

- **Retrying with `getDoc`/`getDocs` instead of resubscribing**:
  rejected — out of the issue's scope. It would change the realtime
  semantics (the `onSnapshot` live updates that already work when the
  first connection succeeds would be lost) and would duplicate the
  read logic; besides, the failing flow was the initial subscription, not
  the one-off reads (which already have their own error
  handling).
- **Spinner or persistent loading state**: rejected — toasts already
  inform without blocking the interface; a fixed loader would hide
  already-loaded content and complicate the library's state, for
  a problem lasting a few seconds.
- **Infinite retry (no cap)**: rejected — with the network down, the
  loop would be eternal and timers would accumulate; the cap of 3
  retries with backoff and the final toast give the user a clear way
  out.
- **Resubscribing without canceling the broken subscription**: rejected —
  it would accumulate live streams (leaks); `retry()` cancels the previous
  one before recreating.
- **Informative notice on every retry**: rejected — with the
  1/2/4 s backoff there would be up to 3 toasts in a row per group; the
  `notifiedRetry` flag reduces it to one per failure episode.

## Consequences

### Positive

- **End of issue #147's bug**: if a subscription fails on entry
  due to a transient error, the web retries it by itself (1 s, 2 s, 4 s) and
  the data loads without closing and reopening.
- **No connection, no spent retries**: when the network returns (the
  «online» event) it resubscribes immediately; the final error toast does
  not appear due to a momentary outage.
- **A single reusable piece**: `subscribeWithRetry` is generic and
  serves to wrap any future subscription, not just today's four.
- **Stable cancellation**: `stopAllSubscriptions()` works the same and
  calling `cancel()` several times is safe (`cancelled` guard).
- **Clear notices without noise**: 1 informative toast per failure
  episode + 1 final toast only if the retries are exhausted; notifications
  retry silently as before.
- **User manual up to date**: sections 15 and 18 document the new
  behavior — AGENTS.md's rule 3 met in the same task.

### Negative / Risks

- **Loading delay of up to ~7 s**: if the first connection fails, the
  library may take the 1+2+4 s of backoff to load, with the
  «Hay problemas de conexión. Reintentando…» notice in between.
  Accepted: it is the cost of retrying instead of failing instantly.
- **No retry after exhausting the maximum**: if the problem is not
  transient (network truly down, Firestore down), the user sees the
  final toast and the wrapper does not retry on its own. Mitigation: once
  the connection recovers and the web reloads, the cycle starts again.
- **`getDoc`/`getDocs` out of scope**: transient errors in one-off reads
  are not covered by this mechanism (they may keep failing and asking for
  a manual retry if the API alone does not).

### Neutral

- **`stopAllSubscriptions()` unchanged**: `subscribeWithRetry`'s
  `cancel()` is compatible with the existing signature.
- **`ready` and `maybeTriggerDailyCheck` flags intact**: the `onChange`
  bodies do not change, only their container (wrapper).
- **Final toasts' texts unchanged**: «No se pudieron cargar
  tus películas/series/libros» are kept as they are.
- **SW caches v3 → v4**: browsers with v3 purge it on the
  next `activate` (the SW's existing mechanism).

## Created/modified files

| File | Change |
|---------|--------|
| `js/retry.js` | **New**: `subscribeWithRetry()` — generic cancelable wrapper with automatic retry (backoff 1 s/2 s/4 s, max. 3 retries = 4 attempts), wait for the «online» event if `navigator.onLine === false` (without spending retries), `onRetrying` once per failure episode (`notifiedRetry` flag reset on a successful snapshot), stable `cancel()` with the `cancelled` guard; `retry()` clears the timer and the «online» listener and cancels the broken subscription before resubscribing (QA fix of commit 2f15541) |
| `js/app.js` | **Modified**: the 4 subscriptions (movies, series, books and notifications) get wrapped with `subscribeWithRetry`; the final `onError` keeps the original toasts; `onRetrying` shows «Hay problemas de conexión. Reintentando…» in the 3 groups; notifications retry silently; `stopAllSubscriptions()` and the `ready`/`maybeTriggerDailyCheck` flags intact |
| `service-worker.js` | **Modified**: `./js/retry.js` added to `STATIC_ASSETS`; `CACHE_STATIC`/`CACHE_DYNAMIC` `mi-registro-v3-*` → `mi-registro-v4-*`; asset entries with `?v=20260830` |
| `js/config.js` | **Modified**: `APP_VERSION` `20260823` → `20260830` |
| `index.html` | **Modified**: `?v=20260823` → `?v=20260830` in `css/styles.css`, `ocio/ocio.css` and `js/app.js` |
| `docs/manual-de-usuario.md` | **Modified**: sections 15 and 18 — the web retries by itself for a few seconds on transient connection failures on entry (AGENTS.md's rule 3) |
| `docs/adr-057-reintento-carga-inicial.md` | **New**: this document |

Related issue: #147 — https://github.com/gonzalitojh/personal-tracker/issues/147
