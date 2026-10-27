// =============================================================
// Service Worker registration and life cycle.
// Imported from index.html as an ES module.
// =============================================================

// -------------------------------------------------------------
// Dynamic base: this module lives in js/ and the service worker in
// the root, so we go up one level from import.meta.url. This makes
// the registration work the same in the root (main) and in each
// branch's subdirectory (<branch>/), where each branch has its own
// files.
// -------------------------------------------------------------
const SITE_BASE = new URL('../', import.meta.url).href;
const SW_PATH = new URL('service-worker.js', SITE_BASE).href;
const SW_SCOPE = SITE_BASE;

let swRegistration = null;

/**
 * Registers the service worker and handles updates.
 * Updates are auto-applied (SKIP_WAITING) without asking the user
 * for confirmation.
 */
export function registerSW() {
  if (!('serviceWorker' in navigator)) {
    console.log('[SW] Service Worker no soportado por este navegador.');
    return;
  }

  navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE, updateViaCache: 'none' })
    .then((registration) => {
      swRegistration = registration;
      console.log('[SW] Registrado correctamente. Ámbito:', registration.scope);

      // If there is already a worker waiting (pending update from a
      // previous registration), auto-apply it directly.
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      // Detect new workers as soon as they appear
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version installed and ready to activate:
            // auto-apply without asking the user (no toast).
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    })
    .catch((err) => {
      console.error('[SW] Error al registrar:', err);
    });

  // Reload the page when the SW takes control.
  // The "refreshing" guard avoids double reloads if the SW
  // reactivates more than once.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

/**
 * Notifies the user that a new version is available.
 * Fires a custom event picked up by index.html.
 * Kept as an export for compatibility with existing code;
 * registration no longer uses it (auto-update without toast).
 */
export function notifyUpdateReady(registration) {
  const event = new CustomEvent('sw-update-ready', {
    detail: { registration },
  });
  document.dispatchEvent(event);
}

/**
 * Activates the waiting service worker (skipWaiting).
 * Kept as an export for compatibility with existing code.
 */
export function applySWUpdate(registration) {
  if (!registration || !registration.waiting) return;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
}

/**
 * Returns a reference to the current registration (useful for debugging).
 */
export function getRegistration() {
  return swRegistration;
}
