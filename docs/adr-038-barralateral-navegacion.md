# ADR-038: Sidebar navigation and Gmail-style header (issue #46)

## Status
Accepted

## Date
2026-08-06

## Context

The web is **vanilla JS with no framework** (index.html + css/styles.css +
ocio/*.html + js/*.js) and until now its header was: an `<h1 class="app-title">
Mi Registro</h1>`, the 🔔 emoji as the notifications bell and a 🔍
(`#btn-global-search`) that opened the **global search in a modal** (centered
overlay with backdrop, documented in ADR-013).

Issue #46 asks for **preparing the navigation for future sections** (series,
movies and books as their own sections) with:

- A **Gmail-style sidebar** that unfolds with a hamburger button and that for
  now contains a single entry: **«Ocio»** (the current web, with its three
  Series/Movies/Books tabs).
- A **header with a single search bar**: the 🔍 button (which opened the
  global search) is replaced by the bar itself, and the **global search
  modal is removed** (the global search function is kept in the new bar:
  Ctrl+K / Cmd+K / «/» keep working).
- The bell becomes a **flat SVG icon** (not the 3D 🔔 emoji).
- The title **«Mi Registro» is removed from the main screen** and displayed
  as the search bar's text on entry, switching to the default placeholder
  after a few seconds.

Related issue: #46 — https://github.com/gonzalitojh/Registro-personal/issues/46

**Historical note**: this ADR documents the replacement of ADR-013's global
search modal (magnifier button + `#global-search` overlay) with a search bar
in the header with a results dropdown.

## Decision

A new **sidebar (drawer) fixed to the left** that opens via a hamburger button
in the header, and a **header with a single search bar** in Gmail style. The
global search stops being a modal and becomes a **dropdown anchored under the
bar** with the notifications dropdown's pattern.

### 1. Side drawer `js/sidebar.js` (new module)

- **Fixed drawer**: `aside#app-sidebar` with `position: fixed; left: 0` and
  width `min(300px, 85vw)`; it leaves the screen with `translateX(-100%)` +
  `visibility: hidden` and enters with a 0.25 s transition. The backdrop
  (`#app-sidebar-backdrop`) uses `z-index: 55` and the drawer `z-index: 60`.
- **Entries from an exported array**: `SECTIONS` (`js/sidebar.js`, exported)
  contains `{ id, label, icon, onClick }`; the drawer's `nav` renders from
  it, with the **«Ocio»** entry marked `is-active`. Adding a future section
  (series, movies, books) only requires adding an entry to the array,
  without touching the rest of the module.
- **Opening**: hamburger button `#btn-sidebar-toggle` with
  `aria-expanded`/`aria-controls`. On open, the drawer's `aria-hidden` is
  updated and the **focus trap** is activated (`trapFocus` from
  `focus-utils.js`, the same helper as the other panels); on close its
  cleanup runs and focus returns to the hamburger.
- **Closing** via any of these: the **Esc** key (single listener registered
  once, no leaks on repeated open/close), **click on the backdrop**, the
  **✕** button (`#btn-sidebar-close`) or **pressing an entry**.
- **«Ocio» action**: closes the drawer and does a **smooth scroll to the top**
  of the page; with `prefers-reduced-motion: reduce` the scroll is
  instant.
- **Mutual exclusion with the search**: opening the drawer calls
  `closeGlobalSearch()` from `js/global-search.js` (cross import): if the
  results dropdown were open, the drawer's backdrop
  (z-index 55) would cover it (z-index 40). Conversely, opening the search
  with the drawer open closes the drawer first (see point 3).

### 2. Gmail-style header (`index.html` + `css/styles.css`)

From left to right:

1. **Hamburger button** (`#btn-sidebar-toggle`) with an inline SVG icon.
2. **Global search bar**: `.search-bar-wrap` with `flex: 1;
   min-width: 0` (AGENTS.md's responsiveness rules), containing the
   input `#global-search-input`, the ✕ button `#global-search-clear` and the
   dropdown container `#global-search-results`.
3. **user-badge** on the right: **flat SVG bell** (stroke `currentColor`,
   replaces the 3D 🔔 emoji), ⚙️ gear, ☀️/🌙 theme and avatar.

**Removed**:

- `<h1 class="app-title">Mi Registro</h1>` from the header: the title becomes
  the search bar's **animated placeholder** — on entry it shows «Mi Registro»
  and after **3.5 s** it switches to the default placeholder
  «Buscar películas, series, libros o amigos...». The sequence lives in
  `js/ui.js` (`showApp`/`showAuthScreen`, constants
  `DEFAULT_SEARCH_PLACEHOLDER`, `SEARCH_BRAND_PLACEHOLDER`,
  `SEARCH_PLACEHOLDER_SWITCH_MS`) and the **timer is cleared on logout**
  (`showAuthScreen`) so the next session starts fresh.
- The `#btn-global-search` button (🔍).
- The **global search modal** (`#global-search` with backdrop and a
  `role="dialog" aria-modal="true"` panel).

### 3. `js/global-search.js`: from modal to anchored dropdown

Refactor of the module without changing the search function:

- The dropdown `#global-search-results` anchors under the bar
  (`position: absolute; top: calc(100% + 8px); left/right: 0; z-index: 40`)
  and uses the paper surface (`--paper`/`--ink`) valid in both themes
  (no light-mode overrides). `max-height: min(60vh, 480px)` with vertical
  scroll.
- **No `trapFocus`**: unlike the previous modal, the dropdown follows the
  notifications dropdown pattern (open/close, Escape closing and click
  outside): trapping focus in a non-modal panel would break the document's
  Tab navigation, which is the Gmail-style bar's metaphor.
- **Opening**: with `focus` or `click` on the input (the click covers
  re-pressing an already-focused bar) and with the **shortcuts Ctrl+K /
  Cmd+K and «/»** (which are kept; «/» only acts if no input is focused).
- **Closing**: the **Esc** key — inside the input with `stopPropagation()`
  only if the dropdown is open (if it is closed, Escape must propagate to
  the global handler of `modal-handlers.js`, e.g. to close an item
  modal); with focus outside the input, a document keydown closes it if it
  is open; **click outside** `.search-bar-wrap`; and the **✕** button
  (`#global-search-clear`) which additionally **clears the text** and returns
  focus to the input.
- **Results**: grouped (🎬 Películas, 📺 Series, 📚 Libros, 👤 Amigos)
  with limits **5/5/5/3**, a minimum of 2 characters to search and
  **keyboard navigation** (ArrowDown/ArrowUp with highlight, Enter
  activates, also click and Enter/Space on each result).
- **Navigation**: `navigateTo` → `openItem(item, searchCtx)` from
  `modal-handlers.js` with a small delay (150 ms) so closing the dropdown
  does not interfere; pressing a friend shows the toast «Próximamente
  podrás ver el perfil...».
- **Mutual exclusion with the drawer**: `openGlobalSearch()` checks whether
  `#app-sidebar` is open and, if so, triggers the hamburger's click to close
  it (its z-index 55 backdrop would cover the z-index 40 dropdown).

### 4. `js/modal-handlers.js`: global Escape without the removed modal

The global Escape keydown removes the global search branch (the
`#global-search` element no longer exists). The priority becomes:
**rating window > item modal > notifications dropdown**. The search
dropdown handles its own Escape (with `stopPropagation` only when open), so
it never reaches this handler.

### 5. Responsive (AGENTS.md rules)

- **Header in 2 rows ≤480 px**: row 1 = hamburger + search bar
  (`flex: 1`); row 2 = icons and avatar right-aligned
  (`.user-badge` with `flex-basis: 100%` and `justify-content: flex-end`).
  Verified at 360 px with no horizontal overflow.
- **Dropdown `fixed` ≤600 px**: same pattern as `.notif-dropdown`
  (`left/right: 1rem; top: 4.5rem; width: auto`) so the panel never leaves
  the visible width; on mobile titles/metadata wrap to 2
  lines (clamp) instead of ellipsis.
- **Drawer** `min(300px, 85vw)`, `overflow-y: auto` and staggered `z-index`
  (drawer 60 > backdrop 55 > dropdown 40).
- Relative units and `min-width: 0` on flex children (`search-bar-wrap`,
  `.global-search__item-info`), with no `overflow-x: hidden` on `body` as a
  patch.

### 6. PWA

- `APP_VERSION` in `js/config.js` moves from `20260809` to **`20260810`** and
  `scripts/bump-version.sh` synchronizes the `?v=20260810` refs of
  `index.html` and `service-worker.js` (PWA cache invalidation).
- `js/sidebar.js` is added to the service worker's `STATIC_ASSETS`.

## Rejected alternatives

- **Keeping the global search modal** (🔍 button + centered overlay):
  rejected — the issue explicitly asks to remove the general search across
  all collections (the modal) and leave **a single search bar** in the
  header.
- **Persistent sidebar on desktop (Gmail style)**: rejected — the issue asks
  for a **button that unfolds** the sidebar (drawer), not an always-visible
  column.
- **Integrating the drawer into `app.js`**: rejected — per the repo's
  convention of modules with `setup*`, the `js/sidebar.js` module was created
  with `setupSidebar()`, registered in `app.js` like the rest.
- **Bell with an external icon font**: rejected — the icon is included as an
  **inline SVG** (stroke `currentColor`), with no new dependencies nor extra
  requests (coherent with the hamburger's icon).

## Consequences

### Positive

- **Navigation ready for the future**: `SECTIONS` allows adding own sections
  (series, movies, books) without rewriting the drawer module.
- **Clean Gmail-style header**: a single central search bar replaces the 🔍
  button; the title «Mi Registro» is recovered as an animated placeholder
  without taking permanent space.
- **Coherent metaphor**: the global search is now a dropdown anchored to the
  bar (notifications dropdown pattern), not a modal; the Ctrl+K / Cmd+K and
  «/» shortcuts are kept.
- **Accessibility**: `aria-expanded`/`aria-hidden`/`aria-controls` on the
  hamburger and the drawer, focus trap with cleanup, focus restored to the
  hamburger on close, and `prefers-reduced-motion` respected in the scroll.
- **No new dependencies**: inline SVG icons (hamburger and bell) and styles
  with existing CSS variables.
- **Responsiveness verified** per AGENTS.md (360/768/1280 with no
  horizontal scroll, relative units, `min-width: 0`).

### Negative / Risks

- **Metaphor change for the search's regular users**: the global search is
  no longer a centered window; the anchored dropdown is less "modal" and
  depends on the header's bar. Mitigated by the central bar's
  discoverability and the kept keyboard shortcuts.
- **z-index overlap managed by mutual exclusion**: drawer and dropdown are
  never open at the same time; if the z-indexes were changed in the future
  that cross coupling would have to be reviewed (import of
  `closeGlobalSearch` in `sidebar.js` and drawer closing in
  `global-search.js`).
- **Conditional Escape**: the Escape's `stopPropagation` only acts with the
  dropdown open; it is subtle but necessary behavior to not break
  `modal-handlers.js`' closing chain.

### Neutral

- **PWA versioned to `20260810`**: `APP_VERSION`, `?v=` in `index.html` and
  `service-worker.js` invalidate previous caches; `js/sidebar.js` enters
  `STATIC_ASSETS`.
- **`docs/manual-de-usuario.md` updated** (AGENTS.md obligation:
  changes visible to the user): sections **3** (main screen: hamburger,
  sidebar with «Ocio», search bar with animated placeholder, bell), **7.3**
  (global search: drop-down panel, closing with Esc/click outside/✕),
  **12** (notifications: bell) and **15** (when the data updates). Mentions
  of the 🔍 magnifier and the modal removed.
- **The title «Mi Registro» persists** on the access card
  (`#auth-screen`) and as the drawer's title, besides the animated
  placeholder.

## Created/modified files

| File | Change |
|---------|--------|
| `js/sidebar.js` | **New**: side drawer with exported `SECTIONS` array («Ocio» entry), `setupSidebar()`, open/close (Escape with single listener, backdrop, ✕, entry), focus trap, `aria-expanded`/`aria-hidden`, smooth scroll with `prefers-reduced-motion`, `closeGlobalSearch()` on open |
| `index.html` | `aside#app-sidebar` + `#app-sidebar-backdrop`; header: `#btn-sidebar-toggle`, `.search-bar-wrap` with `#global-search-input`/`#global-search-clear`/`#global-search-results`, flat SVG bell; **removed** header's `<h1 class="app-title">Mi Registro</h1>`, `#btn-global-search` (🔍) and the `#global-search` modal; versioned `?v=20260810` |
| `css/styles.css` | `.app-sidebar*` (drawer `min(300px, 85vw)`, z-index 60) and `.app-sidebar-backdrop` (z-index 55); `.search-bar-wrap` (`flex: 1; min-width: 0`); `.icon-btn svg`; refactor `.global-search__*` (input in the header, anchored dropdown z-index 40, ✕, groups, states over paper); media queries: 2-row header ≤480 px and `fixed` dropdown ≤600 px (pattern `.notif-dropdown`); modal styles and their light-mode overrides removed |
| `js/global-search.js` | Refactor from modal to **anchored dropdown** (no `trapFocus`): opening with focus/click/shortcuts, closing with Escape (with `stopPropagation` only when open), click outside and ✕; grouped results 5/5/5/3; keyboard navigation; `navigateTo` → `openItem`/friend toast; drawer closing if open when starting the search |
| `js/ui.js` | Animated bar placeholder («Mi Registro» → default after 3.5 s) in `showApp` with timer cleared in `showAuthScreen` (logout); constants `DEFAULT_SEARCH_PLACEHOLDER`/`SEARCH_BRAND_PLACEHOLDER`/`SEARCH_PLACEHOLDER_SWITCH_MS` |
| `js/modal-handlers.js` | Global Escape without reference to the removed modal; priority: rating > item modal > notifications |
| `js/app.js` | Import of `setupSidebar` and call in `init()` |
| `js/config.js` | `APP_VERSION` from `20260809` to `20260810` |
| `service-worker.js` | `js/sidebar.js` added to `STATIC_ASSETS`; `?v=20260810` |
| `docs/manual-de-usuario.md` | Sections 3 (main screen), 7.3 (global search), 12 (notifications) and 15 (data updates): hamburger + sidebar with «Ocio», search bar with animated placeholder, drop-down results panel, closing with Esc/click outside/✕; mentions of the 🔍 magnifier and the modal removed |
| `docs/adr-038-barralateral-navegacion.md` | **New**: this document |

Related issue: #46 — https://github.com/gonzalitojh/Registro-personal/issues/46
