# ADR-037: Device (system) notifications for the internal notifications (issue #84)

## Status
Accepted

## Date
2026-08-06

## Context

The web's internal notifications (bell 🔔) are stored in
Firestore (`users/{uid}/notifications`) and shown **only inside the web**:
if the app is open but not in the foreground (e.g. PWA installed on the
phone in the background, or a hidden desktop tab), the user learns
nothing until they look again.

Issue #84 asked for those internal notifications to also reach the
**phone** (and the desktop) when the app is installed as a PWA.

State detected in the code:

- **100 % static architecture**: the app is served from GitHub Pages and
  uses Firestore directly; there is no backend nor Cloud Functions.
- Internal notifications are **only created with an open client
  session**: `js/daily-check.js` generates them (daily check: movie/series
  releases, new episodes, friend activity) and `js/db.js` →
  `addNotification(uid, ...)` stores them. They are never created from a
  server.
- `js/app.js` already listens to the `users/{uid}/notifications` snapshot
  with `subscribeToNotifications(...)` and renders the bell with
  `ui.renderNotifications(...)`.
- `service-worker.js` already exists with a **base dynamic relative to the
  scope** (multi-branch, ADR-036) and `js/sw-register.js`, plus the
  per-type notification settings (`settings.js` →
  `DEFAULT_SETTINGS.notifications`, `notif-*` toggles in `index.html`).

Related issue: #84 — https://github.com/gonzalitojh/personal-tracker/issues/84

## Decision

Show internal notifications as **system notifications** (Notifications API
+ local Service Worker) when the app is open but **not in the
foreground**. Since internal notifications are only generated with an open
session, the local delivery from the page itself to the service worker
covers the real case, with no need for a push server.

### 1. New module `js/push.js` (bell → system bridge)

- **Detection of new notifications by `id`** on every Firestore snapshot:
  the **first pass of the session is taken as the baseline** (existing ids
  are registered and NOTHING is notified); in later passes only unseen
  ids are forwarded.
- Seen ids are stored in a `Set` (`seenIds`) with the limit
  `MAX_SEEN = 500` (when exceeded the oldest ones are dropped).
- The system notification is only sent if **both conditions** hold: the
  `device_push` preference is active
  (`loadSettings().notifications.device_push === true`) and
  `document.visibilityState !== 'visible'` (the app is NOT in the
  foreground). Only `visibilityState` is used, not `document.hasFocus()`,
  to avoid false negatives in iOS standalone.
- Delivery is **fire-and-forget**: `navigator.serviceWorker.ready` →
  `postMessage({ type: 'SHOW_NOTIFICATION', id, message })`, with the
  message truncated to 140 characters, and errors silenced (`catch`).
- `resetDevicePush()` clears `seenIds` and the baseline; it is called on
  logout so the next session does not notify the previous session's old
  notifications.

### 2. `service-worker.js` (show and open)

- **`message` listener → `SHOW_NOTIFICATION`**: validates `id` and
  `message` and calls `self.registration.showNotification('Personal Tracker',
  {...})` with:
  - `icon` and `badge` relative to the scope:
    `resolved('./resources/icon.png')` (multi-branch, ADR-036).
  - `tag: 'notif-' + id`: **multi-tab deduplication** (two tabs with the
    same new notification do not show two alerts).
  - `data.url: './index.html'` (relative, to open the right branch).
- **`notificationclick` listener**: closes the notification, searches
  among `clients.matchAll({ type: 'window', includeUncontrolled: true })`
  for an existing window of the scope (`client.url.startsWith(scopePath)`)
  and gives it `focus()`; if there is none,
  `clients.openWindow(url)` with the relative route.

### 3. «Notificaciones en el dispositivo» setting

- New toggle in the Settings' **Notificaciones** card (`index.html`,
  id `notif-device`) with the hint «Avisos del sistema cuando la web no
  está en primer plano», below the type toggles.
- Preference key: `settings.notifications.device_push` (default `false`
  in `DEFAULT_SETTINGS`), independent of the type toggles.
- **Permission requested in a user gesture**: the `change` handler runs
  `Notification.requestPermission()` as the **first instruction** (so the
  gesture counts for the API). If the result is not `granted`, the toggle
  is reverted and reported with a toast («Permiso denegado. Actívalo en
  los ajustes del navegador.»).
- **No support or permission denied → toggle disabled**: in
  `renderSettings`, if the browser does not support `Notification` or the
  permission is `denied`, the toggle is shown unchecked and disabled.
  The stored preference is preserved: if the user re-grants the
  permission in the browser, the toggle appears checked again.
- `js/settings.js` imports the helpers from `js/push.js`
  (`isNotificationSupported`, `getPermission`,
  `requestDevicePushPermission`).

### 4. `js/app.js` (integration)

- Import of `handleNotificationsSnapshot` and `resetDevicePush`.
- `handleNotificationsSnapshot(notifications)` is called **after**
  `renderNotifications` in the `subscribeToNotifications` callback.
- `resetDevicePush()` is called on logout (alongside `cleanupSettings()`).

### 5. PWA versioning

`APP_VERSION` in `js/config.js` moves to `20260809` and
`scripts/bump-version.sh` synchronizes the `?v=20260809` refs of
`index.html` and `service-worker.js` (PWA cache invalidation).
`js/push.js` is added to the service worker's `STATIC_ASSETS`.
`css/styles.css` adds the `settings-row__text` /
`settings-row__hint` classes for the new toggle's row.

## Rejected alternatives

- **Real push with FCM + Cloud Functions** (notification with the app
  fully closed): rejected — the architecture is 100 % static
  (GitHub Pages + Firestore, no backend) and adding Cloud Functions would
  mean no longer being static, with the costs and maintenance of a
  server. Besides, internal notifications are only generated with an open
  session, so the SW's local push covers the real case. Documented as a
  **future evolution** if there is ever a backend: it would be the only
  way to notify with the app fully closed.
- **`new Notification()` from the page**: rejected — not reliable when the
  tab is hidden (browsers may suppress it) and there is no service worker
  channel to reuse `notificationclick` with focus/open window.
- **Periodic Background Sync**: rejected — it only allows synchronizing
  data in the background; it cannot show notifications to the user, which
  is exactly what the issue asks.

## Consequences

### Positive

- **System alerts** when the app is open but not in the foreground:
  phone with the PWA installed and desktop with the tab hidden.
- **No spam on open**: the per-session baseline avoids notifying what
  already existed; only new items are alerted (by `id`).
- **No multi-tab duplicates**: the `notif-<id>` `tag` makes the browser
  deduplicate alerts from the same notification.
- **Permission properly requested**: in a user gesture, as the API
  requires; if denied, the toggle is reverted with a clear toast.
- **Multi-branch**: icon/badge, `data.url` and the `notificationclick`'s
  window search use scope-relative routes (ADR-036 inheritance), so it
  works the same at the root and in each branch preview.
- **Independent and conservative setting**: `device_push` is its own
  toggle, off by default, which does not interfere with the bell's type
  toggles.
- **Session safety**: `resetDevicePush()` on logout prevents the next
  session from notifying the previous one's old alerts.

### Negative / Risks

- **No notification with the app fully closed**: without a push server
  (FCM/Cloud Functions), the local service worker only receives messages
  while the page is still alive (even in the background); if the app is
  closed, nobody detects the new notifications. It is an inherent
  limitation of the approach, accepted in the issue and documented in the
  user manual.
- **iOS**: requires **16.4+** and the app to be **installed** (Add to
  Home Screen); without installation, Safari does not deliver web
  notifications.
- **Firefox Android**: does not support `showNotification` in service
  workers, so the setting will not be able to show alerts in that
  browser.
- **Revocable permissions**: the user can deny the permission in the
  browser settings at any time; the toggle stays disabled until it is
  re-granted (the stored preference is preserved).
- **Bounded alert window**: if the app is in the foreground when the
  notification arrives, the system one is not shown (by design: the user
  is already looking at the bell).
- **Bounded memory**: `MAX_SEEN = 500` drops the oldest ids; in practice
  it is irrelevant for normal usage.

### Neutral

- **PWA versioned to `20260809`**: `APP_VERSION`, `?v=` in `index.html`
  and `service-worker.js` invalidate previous caches.
- **`docs/manual-de-usuario.md` updated**: unlike ADR-036, here there is
  a visible change for the user (new setting, system alerts), so
  AGENTS.md's obligation to update the manual applies (sections 12, 14
  and 18).

## Implementation note

- The snapshot callback in `app.js` first calls `renderNotifications` and
  then `handleNotificationsSnapshot`; the baseline is taken on the
  **first invocation** of the session, which matches the initial load of
  the list.
- The `postMessage` to the service worker is fire-and-forget: if the SW is
  not yet active (`reg.active` null) or the delivery fails, it is
  silently ignored; the user will see the notification in the bell
  anyway.
- The toggle handler does the `requestPermission` before touching
  `device_push`: so the user's click counts as a gesture for the API and
  the preference is only stored if the permission ends up granted.

## Created/modified files

| File | Change |
|---------|--------|
| `js/push.js` | **New**: bell → system bridge module: per-session baseline, detection by `id` (`seenIds`, `MAX_SEEN`), `device_push` + `visibilityState` conditions, `postMessage` `SHOW_NOTIFICATION`, support/permission helpers, `resetDevicePush()` |
| `service-worker.js` | `message` listener `SHOW_NOTIFICATION` → `showNotification('Personal Tracker', ...)` with dedup `tag` and scope-relative routes; `notificationclick` listener → focus of existing window or `clients.openWindow`; `js/push.js` in `STATIC_ASSETS`; `?v=20260809` |
| `js/settings.js` | `device_push: false` in `DEFAULT_SETTINGS`; sync of the `notif-device` toggle; disabled if no support or permission `denied`; `change` handler with `requestPermission()` in a user gesture, reverted + toast if denied |
| `index.html` | Toggle «Notificaciones en el dispositivo» (`id=notif-device`, hint) in the Settings' Notificaciones card; versioned `?v=20260809` |
| `js/app.js` | Import of `push.js`; `handleNotificationsSnapshot(notifications)` after `renderNotifications` in the `subscribeToNotifications` callback; `resetDevicePush()` on logout |
| `js/config.js` | `APP_VERSION` from `20260808` to `20260809` |
| `css/styles.css` | Classes `settings-row__text` and `settings-row__hint` for the new toggle's row (with `min-width: 0` on flex, per AGENTS.md's responsiveness rules) |
| `docs/adr-037-device-notifications.md` | **New**: this document |
| `docs/manual-de-usuario.md` | Sections 12 (Notificaciones), 14 (Ajustes → Notificaciones) and 18 (Problemas frecuentes) updated |

Related issue: #84 — https://github.com/gonzalitojh/personal-tracker/issues/84
