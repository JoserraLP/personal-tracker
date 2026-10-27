# ADR-051: Hash routing — shareable URLs per tab and per profile section (issue #59)

## Status
Accepted

## Date
2026-08-07 (expanded 2026-08-08)

## Context

The app is a static SPA **without a build step** (native ES modules) that
deploys on GitHub Pages both at the root and in per-branch subdirectories
(`_site/dev/<branch>/`, ADR-036). All internal navigation happened in
`index.html` and the Ocio section (the three collections Series,
Movies and Books) used tabs controlled in `js/app.js`:
none of them had its own URL.

Issue #59 asks that each tab have its own shareable URL
(the «/ocio endpoint»), that the active tab persist when reopening the
page and that the browser's back/forward buttons change tabs as if they
were part of the same page. Starting constraints:

- **The deployment route varies** (root or `_site/dev/<branch>/`),
  so a router reading `location.pathname` would yield different routes
  per deploy: the router must depend exclusively on
  `location.hash`.
- **The accessibility skip-link** uses the `#main-content` hash
  (`href="#main-content"`): the routing must not intercept it nor break
  the content jump.
- There is a **service worker with versioned asset caching**
  (ADR-007): any new module must enter `STATIC_ASSETS` and
  touched assets must raise their PWA version.

Related issue: #59 — https://github.com/gonzalitojh/Registro-personal/issues/59

## Decision

Implement a **hash router for the Ocio section** with the routes
`#/ocio` (Series, the default tab), `#/ocio/series`,
`#/ocio/peliculas` and `#/ocio/libros`, in a new, dependency-free
module, orchestrated by `js/app.js`.

### 1. New module `js/router.js` (no dependencies, `location.hash` only)

- **`KEY_TO_PANEL`** is the single source of truth: it maps each route key
  (`series`, `peliculas`, `libros`) to its panel id
  (`panel-tv`, `panel-movies`, `panel-books`). A future tab only
  requires an entry here.
- **`DEFAULT_KEY = "series"`** (first tab) and
  **`ROUTE_PREFIX = "/ocio"`**: the section prefix.
- **`parseHash(hash)`** interprets the fragment and returns a typed
  result:
  - `{ key }` for canonical `#/ocio/<key>` routes and the aliases
    `#/ocio` and `#/ocio/` (→ Series).
  - `{ key, default: true }` for an empty hash, `"#"` or `"#/"` (a
    default state whose URL must be normalized).
  - `{ key: null, invalid: true }` for hashes within the prefix with an
    unknown segment (e.g. `#/ocio/otracosa`).
  - `{ key: null }` for hashes **foreign** to the prefix (e.g.
    `#main-content` of the skip-link): they are not Ocio routes and are
    ignored.
- **`hashForKey` / `hashForPanel` / `keyForPanel`** produce the canonical
  hashes and a panel's key, sanitizing to the default key.
- **`navigate(key, { replace })`**: points `location.hash` at the desired
  key (or `history.replaceState` if `replace: true`); if the hash is already
  the target, it does nothing (avoids redundant `hashchange`s).
- **`initRouter({ onRoute })`** starts the router, returns its API and
  `destroy()`:
  - **Initial load**: applies the URL's hash (direct load or
    reload). Empty/non-canonical hashes are normalized to
    `#/ocio/series` with `history.replaceState` (without dirtying the
    history) and `onRoute` is called with the corresponding tab.
  - **Runtime**: a `hashchange` listener (browser back/forward
    and manual hash changes). It only reacts to Ocio hashes: those
    foreign to the prefix (`parsed.key === null`) are completely ignored,
    so the skip-link (`#main-content`) keeps jumping to the
    content without changing tabs. The non-canonical ones within the
    prefix are re-normalized with `replaceState` and the tab activates.
  - The module **never reads `location.pathname`**: it is the critical
    condition of the multi-branch deployment (root and
    `_site/dev/<branch>/`).

### 2. `js/app.js`: extraction of `activatePanel(panelId, { moveFocus = false })`

Tab handling goes from a repeated inline listener to a single function
that **replicates the previous behavior**:

- Removes `is-active` from all tabs and degrades `aria-selected` to
  `"false"`.
- Hides all panels and shows the target, with a defense against a
  stale `data-panel` (falls back to `panel-tv` instead of breaking).
- The active tab reclaims `is-active` + `aria-selected="true"`, so
  **`aria-selected` always reflects the real active tab**.
- **Focus only moves with `moveFocus: true`** (same previous pattern:
  `tabindex="-1"` + `focus()` on the panel's `h2`, reusing the
  `if (heading)` guard).

### 3. Wiring: manual click vs. URL activations

- **Tab click** → `activatePanel(panelId, { moveFocus: true })`
  (focus to the panel's title, reproducing the previous behavior) +
  `router.navigate(keyForPanel(panelId))` to sync the URL.
- **Router** (`initRouter` → `onRoute`) → `activatePanel(panelId)`
  **without focus**: URL-based activation (direct load, reload,
  back/forward, shared hash) visibly changes tabs but **never steals
  keyboard focus**.

### 4. Sidebar (js/sidebar.js): «Ocio» syncs with the router

The sidebar's «Ocio» entry, besides closing the drawer and
smooth-scrolling to the top, goes back to the **last active Ocio tab**
of the session and **syncs the URL** with
`router.navigate(getLastOcioKey())`. Since the profile's expansion
(section 6), this is also the destination of the profile's «← Volver»
button: `getLastOcioKey()` remembers the last Ocio tab, so that
returning from the profile lands where the user was. The `onGoOcio`
callback is injected by `app.js` via
`setupSidebar({ onGoOcio: () => router.navigate(getLastOcioKey()) })`,
the same injection pattern as `onOpenSettings` (ADR-035/ADR-039),
so `sidebar.js` does not import the router.

### 5. PWA: version bump and inclusion of the new module

Follows the recent ADRs' practice (one bump per PR touching
assets, cf. ADR-049):

- **`js/config.js`**: `APP_VERSION` `20260818` → `20260821`.
- **`service-worker.js`**: `STATIC_ASSETS` with `?v=20260821` on the touched
  URLs (`css/styles.css`, `ocio/ocio.css`, `js/app.js`,
  `ocio/series.html`, `ocio/peliculas.html`, `ocio/libros.html`) and
  **inclusion of `./js/router.js`** (without `?v=`, like the rest of
  the JS modules).
- **`index.html`**: `?v=20260821` on the 3 CSS/JS refs
  (`css/styles.css`, `ocio/ocio.css`, `js/app.js`).

### 6. Expansion (user comment): Profile routes

After the first delivery, the user asked for the same routing for the
rest of the web (comment on issue #59): the **five profile sections**
and the **friend detail** must have their own URL. The router is
expanded over the same design (two top-level sections under their own
prefixes):

- **`PROFILE_PREFIX = "/perfil"`** and a token map (Spanish) → internal
  section in `js/profile.js`:
  `#/perfil/estadisticas` → `stats`, `#/perfil/amigos` → `friends`,
  `#/perfil/actividad` → `activity`, `#/perfil/datos` → `data` and
  `#/perfil/ajustes` → `settings`.
- **`#/perfil/amigos/<uid>`**: a friend's profile has its own
  URL. The uid is validated with `FIREBASE_UID_RE`
  (`[A-Za-z0-9._-]{1,128}`) after `decodeURIComponent`; if invalid or the
  friend no longer exists, the URL normalizes to the list
  (`#/perfil/amigos`) and the list is shown.
- **Aliases**: `#/perfil` and `#/perfil/` are aliases of Estadísticas
  (`default: true`, normalized with `replaceState`). Unknown tokens and
  extra segments are also normalized (same Ocio pattern:
  `default: true, invalid: true`).
- **`navigate()` now accepts two forms**: a string (Ocio key,
  backwards compatible) or an object `{ section: "perfil", profileSection,
  uid? }` (and for Ocio). `canonicalHashFor()` produces the canonical hash
  of both sections; the no-op when the hash is already the target is kept.
- **`onRoute` in `app.js`** dispatches by section: profile →
  `profileApi.openProfileSection(section, ctx, { fromRouter: true,
  friendUid })`; ocio → close the profile and activate the tab.
  `profileApi` is declared before `initRouter` (the initial load may
  request a profile route without a session: `onRoute` ignores it and,
  after login, `router.applyRoute()` resumes it — guard in
  `watchAuthState`).
- **`js/profile.js`**: the UI no longer opens sections directly; it only
  **navigates** (`navigate({ section: "perfil", profileSection, uid? })`) and
  the router does the render via `openProfileSection` with `fromRouter`,
  avoiding double fetches (e.g. clicking a friend card navigates
  to `#/perfil/amigos/<uid>` and `openFriendByUid` reuses the list's
  load). The profile's «Volver» button closes the view and navigates to
  the last active Ocio tab (`getLastOcioKey()`).
- **`getCurrentSection()`** returns `"ocio" | "perfil" | null` (null =
  foreign hash) and **`getLastOcioKey()`** remembers the session's last
  Ocio tab for the returns from the profile.
- **PWA**: the expansion touches `js/router.js` and `js/profile.js`
  (modules, no `?v=`), so only `APP_VERSION` goes from
  `20260821` to `20260823` in `config.js`, `index.html` (×3) and
  `service-worker.js` (×6).

## Rejected alternatives

- **History API with `location.pathname` (`#/ocio` → `/ocio`)**: rejected
  — the multi-branch deployment (root and `_site/dev/<branch>/`) makes the
  base change per branch; a real route requires `<base>` or porting logic
  that breaks Pages' static serving. Hash is the only stable
  mechanism without a build step nor server configuration.
- **Router in the click switch without a separate module**: rejected —
  hash parsing, URL normalization and the `hashchange`
  listener are infrastructure logic that deserves a dependency-free
  module (the rest of `js/`'s pattern).
- **Profile routes by section without the uid in the URL**: rejected — the
  friend detail is a navigable state; without its uid in the URL one could
  not share a profile nor go back/forward to it.
- **Normalizing also foreign hashes (`#main-content`)**: rejected — the
  skip-link requires the `#main-content` fragment to land on the
  `id="main-content"` element; rewriting the URL or changing the tab
  would break the content jump.
- **Moving focus also on URL activations**: rejected —
  URL-based activation (back/forward, reload, shared hash) steals keyboard
  focus and disorients screen reader users; focus only moves on
  manual clicks (`moveFocus`).

## Consequences

### Positive

- **Shareable URLs and favorites**: each tab has a stable URL that can
  be shared, bookmarked or sent to another device; on opening it, the web
  shows directly on that tab.
- **Useful browser history**: back/forward change tabs via
  `hashchange`, as if they were part of the same page.
- **Sanitized URL without dirtying the history**: empty hashes, `"#"`,
  `"#/"` and `#/ocio/<unknown>` are normalized with
  `history.replaceState` to `#/ocio/series` (no extra entries), i.e., no
  degraded stack nor console noise.
- **Skip-link intact**: hashes foreign to the prefix are ignored at
  runtime; the content jump (`#main-content`) keeps working.
- **No dependencies and no `pathname`**: the router works the same at the
  root as in any branch subdirectory, and adding a future tab only
  requires an entry in `KEY_TO_PANEL`.
- **Correct ARIA**: `aria-selected` always reflects the active tab,
  and URL activations never steal focus (only the manual click moves
  it, replicating the previous behavior).
- **Orchestration bonus**: the tab click logic is extracted to
  `activatePanel` (reusable and defensive) and the sidebar's «Ocio» and
  the profile's «← Volver» go back to the last active Ocio tab
  (`getLastOcioKey()`) syncing the URL with an injected callback.

### Negative / Risks

- **The hash is not silent on screen**: the URL shows `#/ocio/...` in
  the address bar; accepted (it is GitHub Pages' default mechanism on
  static SPAs).
- **`js/router.js` is a new SW asset**: if forgotten in
  `STATIC_ASSETS` in future edits, the service worker could serve a
  stale version; the inclusion in this PR is explicit.
- **Initial-load normalization uses `replaceState`**: if the
  user opens the app with an empty/non-canonical hash, the URL is rewritten
  to `#/ocio/series` (desired and reentrant effect, but visible in the
  address bar).

### Neutral

- **User manual updated** (AGENTS.md's rule 3 — change
  visible to the user): subsection 3.1 «Compartir direcciones
  y volver a las pestañas» (`#/ocio/...` URLs) and subsection
  13.0 with the profile's URLs (`#/perfil/...`).
- **Initial load and reload**: the hash decides the tab/section in
  both cases (the view reopens on load or reload).
- **No API/DB/styles changes**: the PR does not affect data nor layout;
  only `index.html` (bump `?v=`), `app.js`, `profile.js`,
  `sidebar.js`, `config.js`, `service-worker.js` and the new module.

## Created/modified files

| File | Change |
|---------|--------|
| `js/router.js` | **New**: dependency-free hash routing module (`KEY_TO_PANEL`, `DEFAULT_KEY`, `ROUTE_PREFIX`, `PROFILE_PREFIX`, maps `PROFILE_KEY_TO_SECTION`/`PROFILE_SECTION_TO_KEY`, `FIREBASE_UID_RE`, `parseHash`, `hashForKey`/`hashForPanel`/`keyForPanel`/`profileHashKey`, `navigate`, `initRouter` with `onRoute`/`destroy`, `getCurrentSection`/`getLastOcioKey`). `location.hash` only, never `location.pathname`; normalization with `history.replaceState`; hashes foreign to the prefix ignored at runtime |
| `js/app.js` | **Modified**: import of `initRouter`/`keyForPanel`/`getLastOcioKey`; extraction of `activatePanel(panelId, { moveFocus = false })` (removes `is-active` and degrades `aria-selected` from all, hides panels, shows the target with a defense falling back to `panel-tv`, focus to the `h2` only if `moveFocus`); tab click → `activatePanel(moveFocus: true)` + `router.navigate`; `initRouter({ onRoute })` dispatches Ocio/Perfil (`profileApi.openProfileSection(section, ctx, { fromRouter: true, friendUid })`; `let profileApi = null` before the router and route re-application after login); `setupSidebar` receives `onOpenSettings` (→ `#/perfil/ajustes`) and `onGoOcio` (→ last Ocio tab) |
| `js/profile.js` | **Modified**: the UI navigates via router (subtabs, dropdown `[data-section]`, friend cards, the profile's «← Volver» → `navigate(getLastOcioKey())`, «← Volver a amigos» → `#/perfil/amigos`); `openProfileSection(section, ctx, { fromRouter, friendUid })` respects rendering only via the router; `openFriendCard` → `navigate({ section: "perfil", profileSection: "friends", uid })`; `openFriendByUid` reuses the list and falls back to the list if the uid does not exist |
| `js/sidebar.js` | **Modified**: the «Ocio» entry adds, after the smooth scroll to the top, `if (onGoOcio) onGoOcio()`; module variable `onGoOcio = null` injected by `setupSidebar` from `opts.onGoOcio` (same pattern as `onOpenSettings`) |
| `js/config.js` | **Modified**: `APP_VERSION` `20260818` → `20260821` (iteration 1) and `20260823` (Profile expansion) |
| `service-worker.js` | **Modified**: `STATIC_ASSETS` — inclusion of `./js/router.js` and bump `?v=` `20260818` → `20260821` on the 6 touched CSS/JS/HTML URLs; expansion: bump to `20260823` |
| `index.html` | **Modified**: bump `?v=20260821` (×3) and iteration 2: `?v=20260823` (×3) |
| `docs/manual-de-usuario.md` | **Modified**: subsection 3.1 («Compartir y volver a las pestañas») and, with the expansion, subsection 13.0 «Compartir direcciones de tu perfil» |
| `tasks/task-issue-59.json` | Task file of the task (title/description, change plan, acceptance criteria and the `issue` block with issue #59) |
| `docs/adr-051-enrutamiento-hash.md` | **New**: this document (section 6 covers the Profile expansion) |

Related issue: #59 — https://github.com/gonzalitojh/Registro-personal/issues/59
