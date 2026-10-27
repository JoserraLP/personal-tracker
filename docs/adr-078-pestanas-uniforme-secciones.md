# ADR-078: A uniform tab bar for all sections (issue #208)

## Status
Accepted

## Date
2026-08-11

## Context

Issue #208 asks that **the Recipes section's tabs
(Recetas, Menú and Lista de la compra) look the same as the Ocio
section's tabs** and that, in fact, **the navigation structure
(sidebar, search bar and profile) and the tabs be the same in all the
sections**, today's and any added in the
future, including their fixed-position features. The issue also
reports a **regression: the tabs were visible again on the login
screen**.

Previous state (built in ADR-076 and ADR-077):

- **Ocio** has used the fixed tab bar since issue
  #79 (`nav.tabs--bar` with
  `.tab` buttons of icon + text and an accent color): anchored to the
  bottom edge
  on mobile (with the safe margin) and under the global header at
  ≥768px; hideable per user from
  Settings (issue #97) and with scroll auto-hiding on its lists
  (issue #137).
- **Recetas** (ADR-076, issue
  #64) instead used the **profile's
  subtabs** (`.profile-subtabs` / `.profile-subtab`, pills) inside a
  `.recipes-view__header` sticky under the
  global header (ADR-077), with
  `data-recipes-tab` and `aria-controls` as the
  contract with `js/recipes.js`. The Recipes tabs were hideable in
  Settings (registered in `SECTION_REGISTRY`) but **did not leave the
  bar when hidden** (only the router normalized the route).
- **The login regression**: `js/app.js`
  (the Ocio route of `onRoute`)
  uncovered `#app` with an
  **unconditional** `classList.remove("hidden")` that
  the `content/issue-64-seccion-recetas`
  branch's merge re-introduced; issue #178 had made it
  **conditional on `currentUser`**.
  With that line, when loading or reloading without a session on the
  Ocio route (the default on open), `#app` stayed visible and the tab
  bar (which lives inside
  `#app`) showed over the access screen until Firebase resolved the
  session and `ui.showAuthScreen()` hid it again.

## Decision

1. **A single tabs component**: every section with tabs
   uses the same `nav.tabs--bar` (`.tabs` → `.tab` with
   icon + text and `--tab-accent`). **Ocio** keeps it; **Recetas**
   replaces `.recipes-view__header` +
   `.profile-subtabs` with that same bar,
   as the first child of `#recipes-view` (it hides with the view, like
   Ocio's does with `#app`). `data-recipes-tab` (`recetas|menu|compra`)
   and `aria-controls`
   (`panel-recipes-tab|panel-menu-tab|panel-shopping-tab`) are kept
   intact: they are the contract
   with `js/recipes.js` (the wiring in
   `setupRecipes` and the toggle in
   `openRecipes`), which **does not change**.
2. **Accents**: `.tab--recipes` (ochre), `.tab--menu` (green) and
   `.tab--shopping` (red) reuse the existing palette
   (`--ochre-spine`, `--teal-reel`, `--stamp`) with their pure black
   overrides (`[data-theme="black"] .tab--X.is-active` uses the
   `-dark` variant), the same pattern as Ocio's
   accents (ADR-009/ADR-064/ADR-066).
3. **Bar gaps**: `.recipes-view` reserves the fixed bar's space like
   `.app` itself: on mobile a
   `padding-bottom` with
   `--tabs-bar-h` + the safe margin; at
   ≥768px the `padding-top` accumulates
   header + bar. The view's width aligns with
   `#app` (980px) so content, header and bar share a
   column.
4. **Visibility (Settings)**: `js/app.js`'s
   `applyTabVisibility()`
   (issue #97) extends to
   `SECTION_REGISTRY.recetas.tabs`: the buttons
   `.tab[data-recipes-tab="..."]` leave the
   bar when hidden, like Ocio's. No
   active-tab guard is needed: visibility
   changes only fire from Settings and on
   (re)entering Recipes
   `openRecipes` re-renders with
   `normalizeTabKey` (the first visible one if
   the requested one is hidden).
5. **The login-regression fix**: the unconditional
   `classList.remove("hidden")` of the
   Ocio route in `js/app.js` is removed; the only
   way of uncovering `#app` is
   `ui.showApp()` after login (issue #178's remove
  conditional on `currentUser` remains the
   only one).
6. **The profile: a confirmed exception**. The profile keeps its own
   header with the back arrow and tabs in a
   row (the user's decision in issue #206's iteration,
   ADR-077): the `tabs--bar` bar
   does not apply there. Its `.profile-subtabs` are
   kept.

## Consequences

- **Positive**: visual and behavioural consistency between Ocio and
  Recipes (fixed bar, icons, accents, hiding in Settings); a
   single source of truth for the component (any future
   section with tabs reuses
   `tabs--bar`); the access screen is clean
  again.
- **Neutral**: in Recipes
  the tab bar does not auto-hide on
  scroll
  (issue #137's auto-hiding is scoped to
  Ocio's lists, where the
  `activePanel()` is non-null); the
  "Lista de la compra" label may wrap to
  two lines on mobile (never truncated, AGENTS.md).
- **Negative**: none known. The change is structural in the
   same component already validated in the
   four themes (the same variable and override
   mechanics), with no new colors nor surfaces.

Related issue: #208
