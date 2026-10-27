# ADR-077: Section navigation — global header and section-scoped search (issue #206)

## Status
Accepted

## Date
2026-08-11

## Context

Issue #206 asks that **the web's navigation be kept in all the
sections**: the navigation sidebar (the hamburger), the
top search bar and the profile button must be available
both in Ocio and in Recetas and in the profile. In exchange, the
**back button** and the **section's title** that today head the
Profile and Recetas views are removed, and the
**top search stops being global**: it only searches
**within the active section**.

Previous state (built in ADR-051/ADR-059, ADR-064, ADR-066 and
ADR-076):

- The header (`<header class="app-header">` with the hamburger,
  search, bell and profile
  button) lived **inside `#app`**, the Ocio view; the sibling
  top-level views (Profile, Recetas) were full screens outside `#app`
  with their own minimal header: a «back» button
  (the arrow) + title (`<h1 class="app-title">`), forcing one to go
  back to Ocio to navigate.
- The header's search engine (`js/global-search.js`,
  ADR-022/ADR-082) searched
  **simultaneously** in the collection, the external catalog and
  friends, showing the toast «soon you will be able to view their
  profile» when pressing a friend.
- The Profile and Recetas views did not reserve a top gap for a
  fixed header (`.profile-view` and `.recipes-view` started at the
  top edge; Ocio's tab bar does not exist there either).

## Decision

1. **A global header**: the `header.app-header` moves **out of
   `#app`** to body level, with the `hidden` class by default and the
   **id `app-header`** (the requirement of
   `ui.js`'s toggle: without it,
   `getElementById("app-header")` returns `null` and the header
   stays hidden on all pages; a regression detected in the 2026-08-11
   iteration). `ui.showApp()` shows it at login and
   `ui.showAuthScreen()` hides it (never on the access screen).
   The scroll auto-hiding (issue #137) stays
   **restricted to Ocio's lists** (its `activePanel()` guard already
   limited it); in Recetas the header is
   fixed.
2. **The 2026-08-11 iteration (the issue's feedback): the profile does
   NOT show the global header.** The user prefers in the profile the
   previous
   pattern: **the back arrow (`#btn-close-profile`) and the tabs
   (Estadísticas/Amigos/Actividad/Ajustes) on the same row**. Therefore:
   - `#app-header` hides when
     `parseHash().section === "perfil"`
     (a toggle in `app.js`'s
     `onRoute`; with a session only, because the
     access screen hides it always). In Ocio and Recetas it stays
     visible.
   - `#btn-close-profile` is restored in `index.html` (a left
     arrow icon, ADR-061's `.icon-btn` pattern) with its handler in
     `js/profile.js`: it closes the view and returns to the last Ocio
     tab (normalized to the first visible, issue #97).
   - `.profile-view` recovers its simple top padding (`1.5rem`):
     there is no more fixed header to reserve a gap for.
   - `openGlobalSearch()`'s guard in `js/global-search.js` prevents the
     keyboard shortcuts (Ctrl+K, "/") from opening the search
     dropdown in the profile, where the header is hidden.
   - **Searching friends from the header stops being available in the
     profile** (the bar does not exist there); the profile's «Amigos»
     section keeps working with its own list.
3. **Marking the active section in the sidebar**: before, the
   `.is-active` marking was **fixed on «Ocio»** (`s.id === "ocio"`
   in `renderSidebar`), so navigating to Recipes or Settings the
   marking did not change. Now `js/sidebar.js` exports
   `setActiveSection(sectionId)` (Ocio/Recetas/Settings or
   `null`), which `app.js`'s
   `onRoute` calls on every route change: in the profile only
   «Ajustes» (the pinned entry) is marked when in that
   subsection; the profile's rest has no own entry.
4. **Views without a back or title (Recetas)**: in **Recetas** they
   keep having
   `#btn-close-recipes` and the `<h1 class="app-title">`
   removed; the `.app-title` CSS class (and its mobile
   override) disappears for being dead code. The Recipes subtabs go
   from `margin-left: auto` to the left (there is no title
   pushing them).
5. **Per-section search** (`js/global-search.js`): the active
   section comes from `parseHash().section`
   (Ocio/Recipes; the profile stays
   excluded in the 2026-08-11 iteration because it does not show the
   header).
   - **Ocio**: the collection (movies, series, books, video games)
     + the external catalog with the type buttons
     (Series/Movie/Book/Video game). **Friends no longer appear**
     in Ocio.
   - **Recetas**: recipes only (the local `searchRecipes()` filter
     of `recipes.js`, reusing the tab's name/ingredient/tag filter);
     pressing a result **opens the recipe's modal in read-only mode**
     (`openRecipeModal(recipe, { readOnly: true })`).
   - The type buttons and the catalog sections only
     render in Ocio; the dropdown's hint and the bar's placeholder adapt
     to the section (`ui.setSearchSection()` is called from
     `app.js`'s
     `onRoute`).
6. **Focus after opening a recipe**: when opening the recipe's modal
   from the dropdown, the search input refocuses with a
   **suppressed-focus counter** (`suppressFocusCount`, armed with 2):
   one for the opening's programmatic focus and one for the refocus that
   `closeRecipeModal` does when closing the modal, so the dropdown does
   not reopen itself in either moment and the bar recovers its
   normal behavior with the next manual focus.
7. **CSS adjustments**: `padding-top: calc(var(--header-h) + 1rem)` on
   `.recipes-view`
   (a gap for the fixed global header, the same pattern as
   `.app`); Recipes' sticky header goes
   from `top: 0` to `top: var(--header-h)` to sit under the global
   header. `.profile-view` uses simple padding (see point 2).

## Consequences

- **Positive**: the navigation (sidebar, search,
  profile) is available in Ocio and Recipes without
  passing through the previous screen; the top search
  gains focus by being scoped to the section; the profile
  recovers the light header (arrow + tabs) the user asked for;
  the sidebar's marking reflects the active section.
- **Neutral**: the header's search in Recipes
  coexists with the tab's internal engine (a live
  filter); the header's
  opens the modal in read mode. Both are kept for having
  different interactions.
- **Negative**: friends are no longer searchable from the top search
  (they stopped being in Ocio in the first iteration and in the
  profile in this
  second one, when the header hides there); the
  Ctrl+K / "/" shortcuts do not open the search in the profile (the
  header is not there).
- The issue's task file and the responsiveness criteria
  (AGENTS.md) are respected: no horizontal scroll
  at 360/768/1280 px and verifiable contrast in the
  four themes (the header uses the existing theme
  variables, with no new colors).

Related issue: #206
