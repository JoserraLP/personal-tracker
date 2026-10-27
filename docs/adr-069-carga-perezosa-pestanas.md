# ADR-069: Per-tab lazy loading and loading indicator (issue #178)

## Status
Accepted

## Date
2026-08-11

## Context

Issue #178 complains about several **page loading** problems on the
web (a static SPA with 4 Ocio tabs: Series, Movies, Books and
Video games):

1. On the **login screen** the search bar, tabs and filters are visible (a
   flash that then hides): the router uncovered `#app` without checking the
   session.
2. After logging in, while the data loads, the **4 tabs' filters are seen
   together** (and on reload, overlapped tabs):
   `applyTabVisibility` did `classList.toggle("hidden", false)` on
   all the panels with a visible tab, undoing `activatePanel`'s
   work (which only shows one).
3. **There was no loading indicator**: between "partial injected" and the
   "first Firestore snapshot" the user saw filters with an empty
   grid.
4. Everything loaded at once: the 4 HTML partials (a fetch in `init()`) and
   the 4 Firestore subscriptions launched simultaneously on entry,
   even though the user will only look at one tab.

Besides, `SECTION_REGISTRY.ocio.tabs` (the central registry of tabs,
issue #97) did not include `videojuegos`, so the Video games tab did not
participate in the visibility logic nor appear in Settings.

## Decision

Redesign the loading so that **each tab is independent** and only
loads its own content when activated for the first time, with a loading
indicator while the data arrives:

1. **`#app` only shows with a session**: the router's `onRoute`
   activates the tab (internal state) but no longer uncovers `#app`
   without a user; `ui.showApp()` shows it on entry (and `showAuthScreen()`
   hides it on logout). This removes the login screen's flash.
2. **`applyTabVisibility` only hides, never uncovers**: for panels it only adds
   `hidden` when their tab is hidden (it never removes it); the
   visible panel is controlled exclusively by `activatePanel`. If the
   active tab is hidden from Settings, it falls to the first
   visible one (the same `activatePanel` guard). `videojuegos` is added
   to `SECTION_REGISTRY` and to `DEFAULT_SETTINGS.visibleTabs` so all 4
   tabs participate equally (old settings sanitize
   themselves via `sanitizeVisibility`: missing keys stay visible).
3. **Lazy loading of the partials** (`loadOcioPartial`): a tab's
   HTML (`ocio/*.html`) downloads only the first time it is
   activated (the `loadedPartials` cache); the partial's controls
   (filters, sort, view) wire on injection (`wirePanelControls`),
   replacing the global `querySelectorAll` that only covered
   already-injected partials. `renderLibraryFor` does an *early
   return* if the grid does not exist yet and repaints at the end of the load
   if the snapshot already arrived.
4. **Lazy loading of the Firestore subscriptions**: the 4 subscriptions
   refactor into `subscribeGroup` (config in `GROUP_CONFIG`) and start with
   `ensureGroupSubscribed` only for the active tab's group (in
   `activatePanel` when a session exists and after login in
   `watchAuthState`). `subscribeWithRetry` is kept
   (issue #147).
5. **Loading indicator**: a new `.panel-loading` + `.spinner`
   component (CSS with the theme variables `--ink-soft`/`--ink-alpha-15`,
   AA contrast in all 4 modes and covered by the
   global `prefers-reduced-motion`), `role="status"` for accessibility.
   Each panel starts with it in `index.html`; `loadOcioPartial` prepends it
   when injecting the partial and `renderLibraryFor` removes it
   when painting data (or the empty state). On logout it is restored in the
   already-loaded panels so it reappears on re-entry.
6. **The daily check stops depending on in-memory state**:
   `checkForUpdates` reads the data with `getItemsOnce` (a one-off
   Firestore read) instead of `getItemsByGroup`, so it no longer
   requires the 4 tabs to be loaded; `maybeTriggerDailyCheck` is
   called once per session after login. The same applies to ICS
   export (`export-ics.js`).
7. **Defense in depth against duplicates**: the "already added"
   checks (creation from the global search, recommendations/sagas in the
   modal) use the new `ctx.getGroupItemsResolved(group)`, which returns
   the in-memory state if the group already has a snapshot and falls to
   `getItemsOnce` if not — thus an unvisited tab is not treated as empty
   when adding.

The profile (statistics, friends, activity, settings) was already
lazy (a previous issue) and is not modified.

## Consequences

**Positive**:

- The login screen is clean (no search, tabs or filters).
- Only the active tab shows content and its «Cargando…» indicator
  while the data arrives; on reload there is no overlap.
- Less initial load: 1 partial + 1 subscription on entering instead of
  4 + 4. The rest is requested when activating each tab.
- The Video games tab joins the Settings visibility logic
  (issue #97) coherently with the other three.

**Negative / to watch**:

- The daily check and ICS export make an extra Firestore read per
  group (a slightly higher read cost, negligible against
  the API requests the daily run already makes).
- The global search dropdown's duplicate checks keep
  reading memory for the button's render (they may show «Añadir» on
  an already-added item until the tab is visited); the actual
  creation is protected by `getGroupItemsResolved` in
  `handleAdd`/`handleAddSeen`.

## Related issues

- Related issue: #178 (page loading)
- It builds on: #59 (router), #97 (sections/tabs
  visibility), #147 (subscription retry), #145 (the SDD flow)
