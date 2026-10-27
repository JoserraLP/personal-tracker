# ADR-060: Hide navigation on scroll and floating «Volver arriba» button (issue #137)

## Status
Accepted

## Date
2026-08-09

## Context

Issue #137 (type: style) asks that when scrolling **down** in the
ocio lists (series, movies or books — and any future tab) the
**tabs** and the **top search bar** hide; as soon as one scrolls up,
both must reappear, with a simple animation "as if they emerged from
the screen's edge". As an addition, as soon as one scrolls past the
list's filters (out of view), a button **at the top, in the
center**, must appear to return to the beginning; the button **must not
take up a whole line**, but float over the item list.

Since ADR-040 (issue #79) the header and the tabs are fixed and
**always visible**:

- `.app-header` (`index.html`): `position: fixed; top: 0; z-index: 46`,
  contains the global search `#global-search-input` and the buttons
  (hamburger, bell `#btn-notifications`, profile
  `#btn-open-profile`). Height `--header-h` (3.5rem).
- `.tabs--bar`: `position: fixed; z-index: 45`, at the
  **bottom** (`bottom: 0`) on mobile (≤768px) and **under the header**
  (`top: var(--header-h)`) at ≥768px (ADR-040, iteration 4).
- The dropdowns `#notif-dropdown`, `#profile-dropdown` and
  `.global-search__results` live **inside** `.app-header`
  (`index.html`) and on mobile (≤600px) become `position: fixed` (the
  ADR-027 pattern).
- `.app` reserves space with `padding-top: calc(var(--header-h) +
  var(--tabs-bar-h) + 1rem)` at ≥768px (ADR-040); the content lives in
  `#main-content`.
- Each tab's filters are in `.library-controls` inside the active
  `.panel` (`ocio/*.html`).

The problem: in long lists the fixed navigation permanently takes up
~`--header-h` + `--tabs-bar-h` of vertical height not used for reading, and
"Back to top" required a long manual scroll when the list is very
extensive.

The implementation is validated (QA PASS, 9/9 acceptance criteria) and
scanned (security PASS, 0 findings); the user manual was updated in the
same task (AGENTS.md's rule 3). Re-validated in the
review of PR #158 (QA 9/9, security PASS; the wrapping of the click/focus
listeners was hardened). This ADR documents the decision
retrospectively, like the recent ones (ADR-059).

Related issue: #137 — https://github.com/gonzalitojh/Registro-personal/issues/137

## Decision

Create the module **`js/auto-hide-nav.js`** (ES module, integrated in
`js/app.js` via `initAutoHideNav()` inside `init()`) that decides the
navigation's state based on the scroll's direction, reflecting it in
**`<body>` classes**: `is-nav-hidden` and `is-back-to-top-visible`. The
CSS does the rest with **transforms on fixed elements** — the document
flow is untouched, no content reflows.

### 1. CSS (`css/styles.css`, «Ocultar navegación al desplazar» block)

- `body.is-nav-hidden .app-header { transform: translateY(-100%);
  visibility: hidden; transition: transform 0.25s ease, visibility 0s
  0.25s; }` — the header exits through the **top edge**;
  `translateY(-100%)` covers its full height even if it varies.
  The `visibility` is delayed (`0s 0.25s`) so the sliding is fully
  visible and only then does the element leave the accessibility/focus
  tree; when reappearing (class removed) the transition is gone and
  `visibility` returns instantly.
- `body.is-nav-hidden .tabs--bar`: **mobile** `transform: translateY(100%)`
  (exits through the **bottom edge**, where it hangs); **≥768px**
  `transform: translateY(calc(-100% - var(--header-h)))` (rises with the
  header to the viewport's top edge).
- `transform` transitions of **0.25s** in both cases; with
  `prefers-reduced-motion` the existing global media query cancels
  transitions and the change is instant.
- **`.back-to-top` button** (`#btn-back-to-top` in `index.html`, with
  `aria-label="Volver arriba"` and content `↑ Volver arriba`):
  `position: fixed; top: 0.75rem; left: 50%; transform: translateX(-50%)`,
  a floating pill over the list (no whole line), `z-index: 44` —
  **below** the header (46) and tabs (45) so it does not cover them when
  they reappear, and above the content. Base with
  `opacity: 0; visibility: hidden; pointer-events: none` and
  `body.is-back-to-top-visible .back-to-top` with
  `opacity: 1; visibility: visible; pointer-events: auto` (a 0.2s
  fade with a 0.15s delay on entry); `:focus-visible` with a
  `--teal-reel` outline.

### 2. `js/auto-hide-nav.js`: logic and thresholds

- `CONFIG = { hideThreshold: 80, deltaThreshold: 8 }`:
  - **`hideThreshold: 80`**: below 80px of `scrollY` the navigation
    is **never** hidden (do not hide it right when scrolling
    starts).
  - **`deltaThreshold: 8`**: the direction is decided only if the scroll
    delta exceeds ±8px; with smaller deltas the **previous state is
    kept** (inertia or a slow trackpad do not make the navigation flicker).
- **The delta is computed in the `scroll` listener** (not inside the
  rAF): the `scroll` event dispatches before the same frame's rAF,
  so inside the rAF `window.scrollY` already matches `lastY` and the
  delta would always be 0 (fixed in the QA review, commit `ac6d594`).
  The listener is `passive` and is **throttled with rAF** (one
  evaluation per frame).
- `evaluate(delta)`:
  1. If `isInteracting()` or `scrollY < hideThreshold` → show.
  2. If `delta > deltaThreshold` → hide.
  3. If `delta < -deltaThreshold` → show.
  4. In any case, re-evaluate the «Back to top» button
     (`updateBackToTop()`): the filters' position changes in the same
     descent that hides the navigation, not only when the state changes
     or on `resize`.
- `setNavHidden(hidden)`: only acts if the state changes (avoids
  unnecessary work and reflows) and keeps the button synced.
- **`isInteracting()` guards** — the navigation is NEVER hidden while
  the user interacts with it or there is overlap:
  - Focus inside `.app-header, .tabs--bar` (e.g. typing in the
    search).
  - Header-anchored dropdowns open: `#notif-dropdown`,
    `#profile-dropdown`, `.global-search__results` without `.hidden`.
  - Side drawer `.app-sidebar.is-open`.
  - Open modal `.modal:not(.hidden)`.
  - Hidden app (`#app.hidden`, access screen) or **no active list
    panel** (`activePanel()` → `#app:not(.hidden) .panel:not(.hidden)`,
    e.g. profile/settings): scroll hiding **only applies to the ocio
    lists**.
- **«Back to top» button**: visible only if `navHidden` AND the
  active list's filters went **completely out of view**
  (`controls.getBoundingClientRect().bottom <= 0` over the active
  panel's `.library-controls`). On press: `setNavHidden(false)` +
  `window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })` —
  with `prefers-reduced-motion` the jump is instant.
- **Reactivity**: a `MutationObserver` (attribute `class`, `subtree`) over
  `.panel, .modal, .app-sidebar, #notif-dropdown, #profile-dropdown,
  .global-search__results, #app, body` (the `<body>`'s own changes
  are harmless: `setNavHidden` is a no-op if the state does not change);
  `focusin` on header/tabs; clicks on `#btn-notifications` and
  `#btn-open-profile`; `focus` on `#global-search-input` (all three
  wrapped in `() => evaluate()`: passing the Event as a delta would
  coerce to NaN and keep the state by accident); the viewport's
  `resize`; and an initial `evaluate()` on load.

### 3. Integration, manual and PWA

- `js/app.js`: `import { initAutoHideNav }` + call in `init()`.
- `index.html`: `#btn-back-to-top` button before the scripts; bump
  `?v=20260832` → `?v=20260833` (×3).
- **Manual** (`docs/manual-de-usuario.md`): §3 corrected (the header is no
  longer «always visible») and new §3.2 «La cabecera y las pestañas al
  hacer scroll» (hiding on scroll down, the floating «Volver arriba»
  button, never hidden while the navigation is in use).
- **PWA bump** `20260832` → `20260833` (one bump per PR touching
  assets, cf. ADR-049): `js/config.js` (`APP_VERSION`), `index.html`
  (`?v=` ×3), `service-worker.js` (`?v=` ×6 in `STATIC_ASSETS` +
  **precache of the new module** `./js/auto-hide-nav.js`, no `?v`: the
  module is invalidated via `app.js?v=20260833`'s cache busting), applied with
  `scripts/bump-version.sh`.

## Rejected alternatives

- **Hiding only the header** (keeping the tabs always visible):
  rejected — the issue explicitly asks to hide «las pestañas y la barra
  de búsqueda superior»; besides, at ≥768px the tabs hang under the
  header and on mobile the bottom bar would keep stealing
  `--tabs-bar-h` of height in long lists.
- **JS-driven animation** (inline styles or classList on the
  elements, without classes on `body`): rejected — it couples the JS to
  the concrete layout and duplicates logic already living in CSS
  (transitions, `prefers-reduced-motion`); the `body` classes keep the
  animation in a single layer (CSS) and the state is inspectable.
- **"Back to top" button as a whole line** (an in-flow element
  between the filters and the list): rejected — the issue explicitly
  asks it to **not take a whole line** and to float over the list; an
  in-flow element would also push the items when appearing.
- **Without a «Back to top» button**: rejected — it is the issue's
  explicit addition: with the navigation hidden and the filters out of
  view, there would be no way back to the start without a long manual
  scroll.
- **Extending the hiding to the whole app** (access, profile,
  settings): rejected — they are screens without long lists nor a
  relevant search bar; hiding the navigation there would surprise and
  complicate the guards (the profile's panels have no
  `.library-controls`).
- **Hiding also with a small `scrollY`** (without `hideThreshold`):
  rejected — the navigation would flicker right when scrolling starts;
  the 80px margin stabilizes it at the scroll's start.

## Consequences

### Positive

- **More vertical reading space**: in long lists header and tabs leave
  the screen and the list takes the full height; they return instantly
  on scrolling up or interacting.
- **Cheap and isolated animation**: only 2 fixed elements' transforms
  (compositor work), without touching the document flow nor `.app`'s
  reserved padding; `prefers-reduced-motion` respected.
- **Robust interaction guards**: focus in the search, open dropdowns,
  modal, drawer and non-ocio screens — issue criterion 7 met; the
  header-anchored dropdowns are never left orphaned.
- **Accessibility**: delayed `visibility` shows the sliding and then
  takes header/tabs (and the hidden button) out of the focus tree;
  the button has an `aria-label` and `:focus-visible`; with
  `prefers-reduced-motion` the change is instant and the top jump is
  `auto`.
- **Floating button with `z-index: 44`**: below header/tabs
  (46/45) — when the navigation reappears it is never covered nor the
  button steps on it; above the list's content.
- **State centralized in `body`**: the `is-nav-hidden` and
  `is-back-to-top-visible` classes make the state inspectable from
  DevTools and reusable by future features.
- **Manual up to date**: AGENTS.md's rule 3 met in the same task
  (§3 and §3.2), and QA/security PASS before documenting.

### Negative / Risks

- **`fixed` dropdowns under an ancestor with a transform**: the dropdowns
  live inside `.app-header`; with an active `transform` the header becomes
  their `position: fixed`'s containing block (mobile ≤600px). The risk is
  **mitigated by the guards** (`isInteracting()` + opening listener): the
  header is never hidden with an open dropdown, and
  the `MutationObserver` re-evaluates when it closes. If a future
  dropdown does not go through those guards, it would have to be
  reviewed.
- **`visibility` with delay**: during the exit transition the element
  stays visible (0.25s); a very fast scroll swing can be perceived as
  residual flicker. Accepted so the sliding is fully visible; the 8
  px `deltaThreshold` dampens fast direction changes.
- **Empirical thresholds (80/8 px)**: the flicker behavior depends on the
  device, trackpad or mouse; if a device notices it, they are adjusted in
  the module's `CONFIG`.
- **Scope limited to ocio**: the hiding does not apply on profile,
  settings nor access. It is the requested scope (and any future tab
  with `.panel` and `.library-controls` inherits it), but a new section
  with long lists outside that pattern would need expanding the guards.
- **The observer reacts to its own `body` classes**: a harmless
  re-evaluation (a no-op if the state does not change) with negligible
  cost.

### Neutral

- **Routine PWA bump**: `20260832` → `20260833` (one bump per PR,
  ADR-049) with `scripts/bump-version.sh`; `js/auto-hide-nav.js` enters
  the service worker's precache.
- **ADR-040 remains in force as a historical record**: it documented the
  «always visible» navigation; this ADR describes its evolution, not a
  modification. The dropdowns' ADRs (ADR-027, ADR-035, ADR-038) are also
  untouched.
- **Branch `feat/issue-137-auto-hide-nav`** (base `dev`): commits
  `3541d29` (index.html: button + bump), `ffccffd` (styles.css: hiding
  block + button), `a77d68b` (js/auto-hide-nav.js), `0df13f7`
  (app.js: integration), `f8de71d` (manual §3.2), `ac6d594` (delta fix
  in the listener and state keeping), `9fe9dac` (PWA bump +
  precache), and `9f7900c` (ADR-060) + the review of PR #158 (listeners
  wrapped in `() => evaluate()` to not pass the Event as a delta).

## Created/modified files

| File | Change |
|---------|--------|
| `js/auto-hide-nav.js` | **New**: ES module with `initAutoHideNav()` — `CONFIG { hideThreshold: 80, deltaThreshold: 8 }`; `activePanel()` (`#app:not(.hidden) .panel:not(.hidden)`), `isInteracting()` (focus in header/tabs, dropdowns, drawer, modal, hidden app or no panel), `setNavHidden()` (`body.is-nav-hidden` class), `updateBackToTop()` (`body.is-back-to-top-visible` only with the nav hidden and `.library-controls` with `bottom <= 0`), `evaluate(delta)`; passive `scroll` listener with the delta computed in the listener + rAF throttle; `focusin`, clicks on `#btn-notifications`/`#btn-open-profile`, `focus` on `#global-search-input`, `MutationObserver` of class in subtree, `resize`, `#btn-back-to-top`'s click (scroll `smooth`, `auto` with `prefers-reduced-motion`) and initial evaluation |
| `css/styles.css` | **Modified**: «Ocultar navegación al desplazar (issue #137)» block — `body.is-nav-hidden .app-header` with `transform: translateY(-100%)` + delayed `visibility`; `.tabs--bar` with `translateY(100%)` on mobile and `translateY(calc(-100% - var(--header-h)))` at ≥768px; transitions `transform 0.25s ease, visibility 0s 0.25s`; `.back-to-top` (fixed, centered, `top: 0.75rem`, `z-index: 44`, pill) with `body.is-back-to-top-visible` (opacity/visibility/pointer-events, 0.2s fade with a 0.15s delay) and `:focus-visible` with `--teal-reel` |
| `index.html` | **Modified**: `#btn-back-to-top` button (`.back-to-top`, `aria-label="Volver arriba"`, `↑ Volver arriba`) before the scripts; bump `?v=20260832` → `?v=20260833` (×3) |
| `js/app.js` | **Modified**: `import { initAutoHideNav }` and `initAutoHideNav()` in `init()` (issue #137) |
| `js/config.js` | **Modified**: `APP_VERSION` `20260832` → `20260833` |
| `service-worker.js` | **Modified**: bump `?v=20260833` on the 6 assets of `STATIC_ASSETS` and a **new precache** `./js/auto-hide-nav.js` (via `scripts/bump-version.sh`) |
| `docs/manual-de-usuario.md` | **Modified**: §3 (the header and tabs "hide on scrolling down and return on scrolling up", no longer «always visible») and new §3.2 «La cabecera y las pestañas al hacer scroll» (hiding on scrolling down, the floating «Volver arriba» button, the navigation is never hidden while in use) — AGENTS.md's rule 3 |
| `docs/adr-060-ocultar-navegacion-al-desplazar.md` | **New**: this document |

Related issue: #137 — https://github.com/gonzalitojh/Registro-personal/issues/137
