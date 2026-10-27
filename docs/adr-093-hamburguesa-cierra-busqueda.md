# ADR-093: The hamburger button ☰ as the global search's close (issue #253)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #253 asks that when pressing the header's
**global search bar** (in any section of the
web), the
**hamburger button ☰**
(the
`#btn-sidebar-toggle`, which unfolds the
navigation sidebar) turns into an
**"X" with an animation** that, when pressed,
**closes the search**.

Previous state:

- The global search (the
  `js/global-search.js`) is a dropdown anchored to the
  header's bar with a module-level `isOpen`
  state. It opens when focusing or clicking the input, with a
  `Ctrl+K`/`Cmd+K` or with the
  `/`, and closes (the only exit
  point being the
  `closeGlobalSearch()`) with
  the
  `Esc`,
  an
  outside click,
  the
  inner
  ✕
  `#global-search-clear`, the
  `Ctrl+K`,
  when navigating to a result or when opening the sidebar (the
  `openSidebar()` from
  the
  `js/sidebar.js`). On close it does not clear the text nor move the
  focus (the
  Gmail pattern).
- The hamburger button lives
  in the header of the
  `index.html`, has an
  SVG with
  **three `<line>`s** (a
  24×24 viewBox, the y=6/12/18, the x=3→21)
  and its handler
  in the
  `js/sidebar.js` toggles the
  `openSidebar()`/`closeSidebar()`.
- The
  `openGlobalSearch()` marks
  the
  `isOpen = true` and, if the
  side drawer is open,
  fires the
  `toggle.click()` to close it
  (its
  backdrop,
  the z-index 55, would cover
  the dropdown's z-index 40). That makes the toggle
  handler's
  **checks'
  order** critical.
- The
  `js/sidebar.js` already imports from
  the
  `js/global-search.js` (a
  one-way
  import, no
  cycles); the
  `global-search.js` cannot import from
  the
  `sidebar.js`.
- The
  `css/styles.css` globally cancels animations and transitions with
  the
  `@media (prefers-reduced-motion: reduce)`; the header's
  icons use the
  `currentColor` via
  the
  `.icon-btn` (the
  `--paper`, with an
  override to
  the
  `--ink` on Light/Pure white).

## Decision

1. **The "✕ mode"'s state lives in the
   `js/global-search.js`** (the
   single source of truth): an
   `is-search-open`
   class on the toggle and its
   dynamic `aria-label` ("Close
   search" /
   "Open the navigation menu"). The
   `openGlobalSearch()` adds it (BEFORE the
   inner
   `toggle.click()`,
   so the icon stays as the ✕ even while closing an open drawer) and the
   `closeGlobalSearch()` removes it. Since
   every
   close goes through the
   `closeGlobalSearch()`, the
   restoration is
   centralized in a single point.
2. **A new
   export
   `isGlobalSearchOpen()`** queryable
   by other modules without breaking
   the
   one-way import.
3. **The toggle's handler in the
   `js/sidebar.js` with a deliberate
   order**:
   first `sidebar.classList.contains("is-open")` → the
   `closeSidebar()`;
   then `isGlobalSearchOpen()` → the
   `closeGlobalSearch()` (the
   ✕
   mode); if
   not, the
   `openSidebar()`. This order avoids the critical
   regression: when opening the search with the drawer open, the
   `isOpen` is already
   true by the time the inner
   `toggle.click()`
   arrives, so the drawer's check
   must come
   first
   so that that click
   closes the sidebar
   (and not the search).
4. **The ☰ → ✕ animation in the
   `css/styles.css`** transforming the
   SVG's three existing `<line>`s
   (without
   touching the
   HTML):
   a
   `transform-box: fill-box; transform-origin: center` on each
   line;
   the
   1:
   a
   `translateY(6px) rotate(45deg)`, the
   2:
   an
   `opacity: 0`, the
   3:
   a
   `translateY(-6px) rotate(-45deg)`, with a transition of
   the
   `transform 0.25s ease, opacity 0.25s ease`. Lines
   1 and 3 rotate around their own center
   (12,6)
   and
   (12,18)
  and shift
   6px to
   cross
   exactly at
   (12,12)
   of the
   viewBox, forming the ✕. With
   the
   `prefers-reduced-motion` the change is
   instant (the already-existing global rule).
  The ✕ inherits the
   `currentColor` from
   the
   `.icon-btn`:
  **no theme
   overrides**
  (correct on Dark, pure
   black, Light
   and pure
  white).
5. **The user manual**
   (section 9.2): the new way of closing the
   panel is documented
   (the
   ☰ turns into a ✕ while the search is open).

## Rejected alternatives

- **CSS-only with an
  `:focus-within`
  on
  the
  `.search-bar-wrap`**:
  rejected — when navigating the results with the keyboard the focus leaves
  the input but the dropdown stays open (the
  ✕
  would revert), and the focus is already in the
  JS
  (the
  `Ctrl+K`/`/`
  opening), duplicating the sources
  of
  truth.
- **Two
  buttons
  (the
  ☰ and ✕) with
  show/hide**:
  rejected — more
  DOM, no
  continuous animation
  between
  states and worse
  accessibility than
  a
  single
  button with
  an
  aria-label
  dynamic.
- **Animating the
  `<path>`'s
  `d` or crossing two
  SVGs**:
  rejected — more
  complex; transforming the three existing
  `<line>`s with a
  `transform-box: fill-box`
  is
  minimal
  and
  perfectly
  animatable.

## Consequences

- **The opened search can be
  closed from the
  header's
  left
  end**, with
  animated
  visual feedback and
  a
  dynamic
  a11y
  text
  (the
  aria-label);
  a
  single restoration point
  (the
  `closeGlobalSearch()`)
  covers all the existing closing paths
  (the
  Esc,
  the
  outside
  click, the
  inner
  ✕,
  the
  Ctrl+K,
  navigating to a
  result); zero
  drawer
  regressions thanks to
  the
  checks'
  order; with no theme
  or responsiveness
  changes (the ✕
  has the
  original ☰ icon's size, ~1.15rem).
- **Neutral**: with the search open the button no longer opens the
  side menu (the issue's deliberate behavior);
  if the user presses again after closing the search, the button is the
  ☰ again
  and opens the sidebar. If only one section is visible (issue
  #97) the toggle is hidden
  (replaced by
  the
  ⚙) and no ✕ shows:
  the search still closes on the existing paths.
- **Negative**: none known. Validated: the
  JS
  syntax (the
  `node --check`), the animation verified in a headless
  Chromium
  (the
  pixels: the resting ☰ and the ✕ centered on
  (12,12)
  with the class applied), the simulation of
  the
  toggle's
  6
  interaction flows (opening/closing the drawer, opening the
  search with the drawer open, closing by
  ✕, by
  Esc, a double click) and
  the security scan without findings
  (the changes do not interpolate user data; the string and aria-label
  are controlled literals).

Related issue: #253
