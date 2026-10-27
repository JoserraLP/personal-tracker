# ADR-079: The profile's back button returns to the previous section (Ocio or Recetas) (issue #213)

## Status
Accepted

## Date
2026-08-11

## Context

Issue #213 (type: bug, priority: high) detects that **the
profile's back button always went to the Ocio section**, even though the
user had entered the profile from the **Recetas**
section. With Recipes' arrival (issue #64,
 ADR-076) the web has two top-level content sections
(Ocio and Recipes), and the
"always go back to Ocio" pattern no longer reflected the user's
intent.

Previous state (built in ADR-061, ADR-077 and ADR-078):

- The profile has its own header (`#profile-view__header`) with
  the **back arrow** (`#btn-close-profile`, an
  `.icon-btn` with the
  `arrow-left` SVG, ADR-061) and the tabs
  (Estadísticas/Amigos/Actividad/Ajustes)
  on the same row; the **global header does not show** in the
  profile (ADR-077, issue #206).
  It is an exception to the single
  `tabs--bar` tabs component (ADR-078).
- `js/profile.js`'s `#btn-close-profile`
  handler closed the
  view with a manual toggle and **always** did
  `navigate(normalizeTabKey("ocio", getLastOcioKey()))`: it went back to
  the last active
  Ocio tab (normalized to the first visible
  if it was hidden, issue #97), ignoring that the user could
  be coming from Recipes.
- The router (`js/router.js`) already kept per-section memories
  (`lastOcioKey` and
  `lastRecipesTab`, updated in
  `applyRoute`),
  but it **did not remember
  which had been the last top-level section**
  (ocio or recetas) before entering the profile.

## Decision

1. **A last-section memory in the router** (`js/router.js`): a new
   `lastSection` variable (initial value `"ocio"`) updated in
   `applyRoute()` **only** when the route is
   `ocio` or
   `recetas` (the
   `perfil` routes deliberately do NOT update it: on entering the
   profile, the content section one came
   from is protected).
   `getLastSection()` is exported and added to the
   API
   returned by `initRouter`.
2. **The back handler decides per section** (`js/profile.js`):
   - If `getLastSection() === "recetas"` → it navigates to
     `{ section: "recetas", tab: normalizeTabKey("recetas",
     getLastRecipesTab()) }`. The hash's change fires
     the `onRoute` →
     `openRecipes({ fromRouter: true })` (js/recipes.js), which closes
     `#app` and
     `#profile-view`, uncovers
     `#recipes-view` with its tab and repaints the global
     header: there is no need to touch
     `#app` on this
     branch.
   - Otherwise (Ocio or the default value) → the previous
     behavior:
     closing `#profile-view`, showing
     `#app` and navigating to
     `normalizeTabKey("ocio", getLastOcioKey())` (the last Ocio tab,
     normalized to the first visible if it was hidden,
     #97).
   - The manual
     close toggle of the view is kept (it
     covers navigating without changing the hash).
3. **No CSS changes**: there are no visual changes; only
   navigation logic.
4. **PWA
   bump** `20260908` → `20260909` (`scripts/bump-version.sh`,
   touching `js/config.js`, `index.html`,
   `service-worker.js`), the
   one-bump-per-PR
   practice (ADR-049/059).
5. **User manual updated** (§3.2 and §15): the profile's
   back arrow returns to the section one entered
   from (Ocio or Recipes), with the tab that was active
   (AGENTS.md's rule 3).

### View toggles (verified against the real code)

- **The Recipes branch**: `navigate({ section: "recetas", ... })` changes the
   hash (`#/perfil/...` → `#/recetas/...`) and fires the
   onRoute's `recetas` branch (js/app.js) → the
   `recipesApi.openRecipes({ tab, fromRouter: true })` (js/recipes.js
  `openRecipes`), which does exactly:
   `#app.hidden`,
   `#profile-view.hidden`, `#recipes-view` visible and
   alternates bar/panels per tab. The onRoute itself re-normalizes the
   tab with `normalizeTabKey` and rewrites the URLs if they were hidden
   (#97). There is no need to show
   `#app` nor touch `#recipes-view` on the
   handler.
- **The Ocio branch**: the current manual toggle is
   kept
   (close `#profile-view` + show
   `#app`) and Ocio's
   onRoute re-hides `#profile-view` and
   `#recipes-view`, activates the panel and shows
   `#app` (conditional on
   `currentUser`) — with no regression from the previous
   behavior.

## Rejected alternatives

- **Tracing the browser's history (history.back)**: rejected —
   the router's session memories are the
   existing source of truth and avoid
   history dependencies (reload,
   direct deep-link).
- **A router guard for sections hidden in Settings**:
   rejected — out of #213's
   scope and consistent with
   Ocio's pre-existing behavior (the
   router does not block navigating to a section
   hidden by URL).

## Consequences

- **Positive**: the profile's back reflects
  the user's real intent (Ocio or Recipes)
  with their last active tab; zero visual
  changes; the edge cases are covered (a direct deep-link
  to `#/perfil`
  with no visited section falls back to Ocio by default; entry
  from the sidebar's
  "Ajustes" or the
  profile menu respects the origin section).
- **Neutral**: the
  `lastSection`/`lastOcioKey`/`lastRecipesTab`
  memories are per session and do not interfere with the
  browser's back/forward history (which follows its
  own
  hash history).
- **Negative**: none known.

## Created/modified files

| File | Change |
|---------|--------|
| `js/router.js` | **Modified**: the new `lastSection` memory (the default `"ocio"`) updated in `applyRoute()` only for ocio/recetas; `getLastSection()` exported and added to the `initRouter` API; header comment expanded |
| `js/profile.js` | **Modified**: import of `getLastRecipesTab`/`getLastSection`; the `#btn-close-profile` handler chooses the destination by `getLastSection()` (Recipes → the last normalized Recipes tab; otherwise → Ocio) |
| `js/config.js` | **Modified**: `APP_VERSION` `20260908` → `20260909` |
| `index.html` | **Modified**: the `?v=20260908` refs → `?v=20260909` |
| `service-worker.js` | **Modified**: 7 versioned entries `?v=20260908` → `?v=20260909` |
| `docs/manual-de-usuario.md` | **Modified**: §3.2 and §15 — the profile's back arrow returns to the section (Ocio or Recipes) one entered from, with its active tab |
| `docs/adr-079-boton-volver-perfil-seccion.md` | **New**: this document |

Related issue: #213
