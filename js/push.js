// =============================================================
// On-device notifications (Push): bridge between the internal
// bell notifications and the operating system / browser
// notifications (Service Worker).
// When the app is open but NOT in the foreground (tab hidden,
// another app in the phone with the PWA installed), new
// notifications arriving via Firestore are forwarded to the
// Service Worker so they show as system notifications.
// =============================================================

import { loadSettings, saveSettings } from "./settings.js";

// Limit of remembered ids so already-seen items are not notified
// again. Prevents seenIds from growing forever: once exceeded, the
// oldest ones are discarded (the Set keeps insertion order).
const MAX_SEEN = 500;

let seenIds = new Set();
let initialized = false;

// ---- Browser support and permission ----

/** Does the browser support the Notifications API? */
export function isNotificationSupported() {
  return "Notification" in window;
}

/** Notification permission state ('granted' | 'denied' | 'default'). */
export function getPermission() {
  return Notification.permission;
}

// ---- User preference (persisted in settings) ----

/** Does the user have on-device notifications enabled? */
export function isDevicePushEnabled() {
  return loadSettings().notifications.device_push === true;
}

/** Enables or disables the preference in the saved settings. */
export function setDevicePushEnabled(enabled) {
  const s = loadSettings();
  s.notifications.device_push = enabled;
  saveSettings(s);
}

/** Asks the user for the browser's notification permission. */
export async function requestDevicePushPermission() {
  return Notification.requestPermission();
}

/**
 * Is the app in the foreground? Product decision: only
 * document.visibilityState is checked (NOT document.hasFocus()) to
 * avoid false negatives on iOS standalone. We notify when the app is
 * NOT in the foreground.
 */
export function isAppInForeground() {
  return document.visibilityState === "visible";
}

// ---- Detection of new notifications and forwarding to the SW ----

/** Discards the oldest ids when seenIds exceeds MAX_SEEN. */
function trimSeenIds() {
  while (seenIds.size > MAX_SEEN) {
    seenIds.delete(seenIds.values().next().value);
  }
}

/**
 * Processes each snapshot from the bell: detects NEW notifications
 * by id and, if the app is in the background and the user has push
 * enabled, forwards them to the Service Worker (fire-and-forget) so
 * they show as system notifications.
 */
export function handleNotificationsSnapshot(items) {
  if (!initialized) {
    // Baseline: when the app opens, existing notifications are NOT notified.
    for (const n of items || []) {
      if (n && n.id) seenIds.add(n.id);
    }
    initialized = true;
    return;
  }

  const nuevas = (items || []).filter((n) => n && n.id && !seenIds.has(n.id));

  for (const n of items || []) {
    if (n && n.id) seenIds.add(n.id);
  }
  trimSeenIds();

  if (!isDevicePushEnabled() || isAppInForeground()) return;

  for (const n of nuevas) {
    navigator.serviceWorker.ready
      .then((reg) =>
        reg.active &&
        reg.active.postMessage({
          type: "SHOW_NOTIFICATION",
          id: n.id,
          message: String(n.message || "").slice(0, 140),
        })
      )
      .catch(() => {});
  }
}

/**
 * Resets the detection state (e.g. on logout) so that the next
 * sign-in takes a baseline again and old notifications from the
 * previous session are not notified.
 */
export function resetDevicePush() {
  seenIds.clear();
  initialized = false;
}
