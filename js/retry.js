// =============================================================
// Subscription retry (issue #147).
//
// The initial data subscriptions (Firestore onSnapshot) can fail due
// to transient errors when entering the site (network, connection to
// Firestore...). Previously, a failure left the library empty until
// closing and reopening the app, because the onError callback only
// showed a warning and never retried.
//
// subscribeWithRetry() wraps any subscription and retries it with a
// progressive wait (backoff: 1s, 2s, 4s...) up to a maximum number of
// retries. If the device is offline, it waits for the "online" event
// instead of burning the retries. It returns a stable cancel() that
// cleans the active subscription, timers and pending network
// listener.
//
// In addition, each attempt has a watchdog (issue #286): if no
// successful snapshot arrives within `initialTimeoutMs`, the attempt
// is treated as a transient failure (before, a subscription that
// neither failed nor delivered data — e.g. a hung stream — left the
// eternal «Cargando…» with no chance of retry).
// =============================================================

/**
 * Wraps a subscription with automatic retry.
 *
 * @param {Object} options
 * @param {(handlers: { onChange: (data: any) => void, onError: (err: any) => void }) => () => void} options.subscribe
 *        Function that creates the subscription and returns its cancellation function.
 * @param {(data: any) => void} options.onChange  — data callback (called with each successful snapshot).
 * @param {(err: any) => void} options.onError    — FINAL error after retries are exhausted.
 * @param {(attempt: number) => void} [options.onRetrying] — informational notice (only the 1st time per failure episode).
 * @param {number} [options.maxRetries = 3]       — retries after the initial attempt (4 attempts in total).
 * @param {number} [options.baseDelayMs = 1000]   — base backoff wait (baseDelay * 2^(n-1)).
 * @param {boolean} [options.waitForOnline = true]— if the device is offline, wait for the "online" event
 *                                                 instead of spending the retries with timers.
 * @param {number} [options.initialTimeoutMs = 12000] — attempt watchdog (issue #286): if no
 *                                                 successful snapshot arrives within that time, the attempt is treated
 *                                                 as a transient failure and retried with the existing backoff.
 *                                                 Setting 0 disables the watchdog.
 * @returns {() => void} cancel() — stable cancellation: cancels the current subscription, timers and
 *                                   the pending "online" listener. It is safe to call it several times.
 */
export function subscribeWithRetry({
  subscribe,
  onChange,
  onError,
  onRetrying,
  maxRetries = 3,
  baseDelayMs = 1000,
  waitForOnline = true,
  initialTimeoutMs = 12000,
}) {
  let cancelled = false;
  let attempts = 0;
  let notifiedRetry = false;
  let retryTimer = null;
  let watchdogTimer = null;
  let onlineHandler = null;
  let currentUnsubscribe = null;

  function clearOnlineHandler() {
    if (onlineHandler) {
      window.removeEventListener("online", onlineHandler);
      onlineHandler = null;
    }
  }

  // Common error path: inform (if it is due), decide whether to retry
  // (with backoff) or wait until online, and exhaust with a final onError.
  function handleError(err) {
    if (cancelled || retryTimer) return;
    // The watchdog only watches the attempt in progress: if the real
    // error arrives before it, the watchdog is withdrawn to avoid
    // firing a double final onError while the timer of the already
    // failed attempt is still pending.
    clearTimeout(watchdogTimer);
    watchdogTimer = null;

    if (!notifiedRetry && onRetrying) {
      notifiedRetry = true;
      onRetrying(attempts + 1);
    }

    // No connection: do not spend retries with timers. When the
    // network comes back ("online") it re-subscribes right away. The
    // previous listener is cleared before registering the new one:
    // two consecutive handleError calls while offline (e.g. watchdog
    // + real stream error) must not stack two identical "online"
    // listeners (issue #286).
    if (waitForOnline && navigator.onLine === false) {
      clearOnlineHandler();
      onlineHandler = retry;
      window.addEventListener("online", onlineHandler);
      return;
    }

    if (attempts < maxRetries) {
      attempts++;
      console.warn("Suscripción falló, se reintentará:", err);
      retryTimer = setTimeout(retry, baseDelayMs * 2 ** (attempts - 1));
    } else {
      console.error("Suscripción agotó los reintentos:", err);
      onError(err);
    }
  }

  function start() {
    if (cancelled) return;
    // Attempt watchdog (issue #286): if no successful snapshot arrives
    // within `initialTimeoutMs`, the attempt is treated as a transient
    // failure. It is armed on EVERY attempt (start) and only watches
    // the first snapshot of that attempt: the successful onChange
    // withdraws it.
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
    if (initialTimeoutMs > 0) {
      watchdogTimer = setTimeout(() => {
        handleError(new Error("watchdog: sin primer snapshot en " + initialTimeoutMs + "ms"));
      }, initialTimeoutMs);
    }
    try {
      currentUnsubscribe = subscribe({
        onChange: (data) => {
          // Success: the failure episode is reset so that a future
          // error warns and retries from scratch again.
          if (cancelled) return;
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
          attempts = 0;
          notifiedRetry = false;
          onChange(data);
        },
        onError: handleError,
      });
    } catch (err) {
      // onSnapshot can throw synchronously; it is treated the same as
      // an async listener error.
      handleError(err);
    }
  }

  function retry() {
    if (cancelled) return;
    // Clear the already-fired timer and the "online" listener: if not,
    // the `retryTimer` guard in handleError would block further
    // retries (the id of the fired timer is still truthy) and the
    // listener would fire spurious re-subscriptions on every
    // reconnection.
    clearTimeout(retryTimer);
    retryTimer = null;
    // Critical: the watchdog of attempt N must die here. Otherwise its
    // timer fires in the middle of attempt N+1 and causes a spurious
    // retry (the new attempt arms its own watchdog in start()).
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
    clearOnlineHandler();
    // Never leave two live subscriptions: cancel the broken one before
    // creating again (unsubscribing an already dead stream is harmless).
    if (currentUnsubscribe) {
      currentUnsubscribe();
      currentUnsubscribe = null;
    }
    start();
  }

  function cancel() {
    cancelled = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
    clearOnlineHandler();
    if (currentUnsubscribe) {
      currentUnsubscribe();
      currentUnsubscribe = null;
    }
  }

  start();
  return cancel;
}
