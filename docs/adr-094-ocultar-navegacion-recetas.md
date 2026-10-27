# ADR-094: The Recipes section's header and tabs auto-hiding (issue #256)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #256 (type: style) asks that on the
**Recipes** section, when
 scrolling **down**, the
 **tabs** and the
 **top bar**
 hide, and a
 **back to the top**
 button appears; when
 scrolling
 **up**,
 they
 reappear. The
 behavior already exists on the
 **Ocio**
 section (issue #137, ADR-060)
 and must be on
 **all the
 web's
 sections**;
 for now only
 Ocio and
 Recipes.

Previous state:

- **Ocio**
  (issue #137, ADR-060):
  the
  `js/auto-hide-nav.js`
  hides
  the
  global
  header
  (the
  `body.is-nav-hidden .app-header`)
  and the
  tab bar (the
  `body.is-nav-hidden .tabs--bar`)
  when scrolling
  down
  the
  lists, and shows the floating
  "Back to the top"
  button (the
  `body.is-back-to-top-visible .back-to-top`) when the
  filters (the
  active panel's
  `.library-controls`)
  are
  out of view. The CSS uses the
  **generic
  selectors over the
  `body`**, with no
  section
  distinction.
- **Recipes** has, since
  ADR-078
  (issue
  #208),
  its
  **own
  `nav.tabs--bar`**
  as the
  first
  child of
  the
  `#recipes-view`,
  with the
  same
  class as Ocio's. The
  `#recipes-view`
  is a
  top
  level
  **sister of the profile-view and outside
  the
  `#app`**
  (issue #64, ADR-076);
  when visible, **the
  `#app` is hidden**
  (the Recipes
  view's normal
  state).
- ADR-077
  (issue #206)
  documented that the auto-hiding
  was
  **restricted
  to
  Ocio's lists**
  ("in
  Recipes the header is
  fixed"); the
  user's manual (the
  §3.2)
  said the same.
- **Why it did not work in Recipes**: the
  `activePanel()`
  guard
  only
  resolved
  the
  `#app:not(.hidden) .panel:not(.hidden)`,
  which
  in Recipes is the
  `null`
  (because
  the
  `#app`
  is hidden);
  besides, the
  `isInteracting()`
  returned
  `true`
  whenever the
  `#app`
  had the
  `.hidden`
  — a
  **permanent**
  condition on the
  Recipes view —,
  so the
  navigation was never
  hidden. The
  `MutationObserver`
  did not watch the
  `#recipes-view`
  nor its
  sections either, and the
  `updateBackToTop()`
  only looked for the
  `.library-controls`.

The implementation is validated
  (a
  QA PASS) and scanned
  (a
  security
  PASS,
  0 findings); the user manual updated in the
  same task
  (the
  AGENTS.md's rule 3, the docs
  commits of this branch). This ADR
  documents the decision retrospectively,
  like the recent ones
  (the
  ADR-093).

Related issue: #256 — https://github.com/gonzalitojh/personal-tracker/issues/256

## Decision

Expand **`js/auto-hide-nav.js`**
(the
auto-hiding's
single source of truth)
so it also resolves
Recipes'
active panel,
**without touching the CSS**: the
hiding selectors (the
`body.is-nav-hidden .app-header`,
the
`body.is-nav-hidden .tabs--bar`, the
`body.is-back-to-top-visible .back-to-top`)
are generic and the
Recipes bar uses the same
`tabs--bar` class (ADR-078), so the
existing rules
apply
automatically.

### 1. The `activePanel()`: a resolution across two views

- If the
  `#app`
  is visible → the
  active ocio
  panel
  (the
  `#app .panel:not(.hidden)`),
  as until now.
- If the
  `#app`
  is hidden
  but the
  `#recipes-view`
  is visible → the
  **active Recipes
  section**
  (the
  `#recipes-view .recipes-view__body section:not(.hidden)`); the Recipes
  tabs are sibling
  `<section>`s inside the
  `.recipes-view__body` and the active one is
  the
  only
  one without the
  `.hidden`.
- In any other
  case
  (the
  access
  screen, the profile/settings) → the
  `null`: there the scroll-hiding does not
  apply.

### 2. The `isInteracting()`: the hidden `#app`'s guard
  disappears

- The "the
  hidden
  `#app` →
  interacting" block is
  **removed**. In Recipes the hidden
  `#app`
  is the normal
  case;
  the
  `!activePanel()`
  guard is enough
  (it returns
  the
  `null`
  on
  the
  access
  and profile/settings, and
  also when the
  `#recipes-view`
  is hidden).
- **A new guard** for
  Recipes'
  filter panels (the
  `.recipes-filter__panel:not(.hidden)`,
  the
  `.ingredients-filter__panel:not(.hidden)`):
  on mobile they anchor to the viewport **beneath the header** (the
  `top: var(--header-h)`),
  so hiding it would leave
  them orphaned — the header
  dropdowns' same pattern.

### 3. The `updateBackToTop()`: a unified
 `CONTROLS_SELECTOR`

- A new constant
  `CONTROLS_SELECTOR = ".library-controls,
  .recipes-toolbar, .ingredients-toolbar, .menu-toolbar,
  .shopping-toolbar"`: it covers Ocio's
  filters and the Recipes'
  4 tabs' **toolbars**
  (the Recipes, Ingredients, Menú and Compra).
- The "Back to the top" button keeps showing only if the
  navigation is hidden AND the active panel's controls went
  entirely
  out of view (the
  `getBoundingClientRect().bottom <= 0`);
  if the panel has
  no controls, the button does not
  appear.

### 4. The `MutationObserver` expanded

- New observed targets: the
  `#recipes-view`
  (it hides/shows when entering/leaving the section), the
  `.recipes-view__body section`
  (a Recipes tab change), the
  `.recipes-filter__panel`
  and the
  `.ingredients-filter__panel`
  (the filters' opening/closing).

### 5. The user manual
  (already done on this branch)

- §3: the header "hides when scrolling
  down
  the Ocio **or
  Recipes** lists" and the Recipes tab
  bar "hides when scrolling the list like Ocio's".
- §3.2: the auto-hiding
  also
  applies to Recipes
  (the
  Recipes, Ingredients, Menú or Compra);
  the "Back to the top" button appears when the list's
  controls
  (the
  ocio's
  filters
  or the active Recipes tab's toolbar) go
  out
  of view;
  the profile keeps
  its
  own header
  (the back arrow + the tabs on the same row).

## Rejected alternatives

- **A separate JS module for Recipes**
  (e.g. the
  `js/auto-hide-nav-recetas.js`):
  rejected — it would duplicate state and
  logic (the thresholds, the guards, the button) and break the
  `auto-hide-nav.js`'s single source of truth.
- **CSS specific per section**
  (the
  `#recipes-view .tabs--bar`
  selectors, etc.):
  rejected — unnecessary: ADR-078's
  unification (a
  common
  `tabs--bar`)
  means ADR-060's
  generic
  selectors
  cover
  both
  sections with no changes.
- **Extending the hiding to the profile**:
  rejected — ADR-077's
  confirmed exception:
  the profile does not show the global header
  (it has
  its own with the
  back
  arrow)
  and there are no long lists with a search bar.

## Consequences

### Positive

- **The Ocio/Recipes
  consistency**: the issue's requested behavior
  (hiding on scrolling
  down, reappearing on scrolling
  up, the
  "Back to the top" button) is identical in both
  sections; the Recipes tab
  bar
  (the
  ADR-078) behaves like Ocio's
  (the
  ADR-060).
- **A single source of truth**: all the auto-hiding keeps
  living in the
  `js/auto-hide-nav.js`;
  no
  CSS
  rule
  is
  new nor logic
  duplicated.
- **Guards by
  purpose, not
  by assumption**: the
  `isInteracting()`
  no longer depends on the
  `#app`'s visibility
  (which has
  nothing to do with interaction
  in Recipes), and the
  Recipes filters' panels never get orphaned when
  hiding the header on mobile.
- **The manual up to date**:
  the
  AGENTS.md's rule 3 met
  in the same task
  (the
  §3 and §3.2),
  correcting the previous contradiction
  ("in Recipes it stays fixed").

### Neutral

- **The profile stays out by design**:
  ADR-077's confirmed exception
  (an own header with
  the
  back
  arrow); the auto-hiding does not apply.
- **The
  ADR-060 and ADR-077/ADR-078 remain in force
  as historical records**:
  they
  documented the
  previous
  state (the auto-hiding only
  in Ocio);
  this ADR describes their evolution
  without modifying
  them.
- **With the Recipes filters' panels open the navigation stays
  visible**:
  a deliberate
  behavior (the same criterion as the
  header's dropdowns).

### Negative / Risks

- **None known.**
  Validated: a
  QA PASS
  of the whole flow
  (the
  scroll on the
  Recipes'
  4 tabs, the "Back to
  the top" button, the
  open filters, entering/leaving the section)
  and a
  security PASS
  (0
  findings; the changes do not interpolate user data). The CSS
  selectors did not change, so there is no visual
  regression risk in Ocio or in the four
  theme modes
  (the
  ADR-009/ADR-064/ADR-066).

## Created/modified files

| File | Change |
|---------|--------|
| `js/auto-hide-nav.js` | **Modified**: the `activePanel()` also resolves `#recipes-view .recipes-view__body section:not(.hidden)` when the `#app` is hidden; `isInteracting()` removes the `#app.hidden` block (the `!activePanel()` is enough) and adds the `.recipes-filter__panel`/`.ingredients-filter__panel` guard; `updateBackToTop()` uses the `CONTROLS_SELECTOR` (the `.library-controls` + the Recipes' 4 toolbars); the `MutationObserver` watches the `#recipes-view`, the `.recipes-view__body section`, the `.recipes-filter__panel`, the `.ingredients-filter__panel` |
| `css/styles.css` | **Unchanged**: the hiding selectors (ADR-060) are generic and the Recipes bar uses the same `tabs--bar` class (ADR-078) |
| `docs/manual-de-usuario.md` | **Modified**: §3 (the header and the tab bar hide when scrolling down in Ocio **and Recipes**) and §3.2 (the auto-hiding on the Recipes' 4 tabs; the "Back to the top" button with the active tab's toolbar; the profile keeps its own header) — AGENTS.md's rule 3 |
| `docs/adr-094-ocultar-navegacion-recetas.md` | **New**: this document |

Related issue: #256 — https://github.com/gonzalitojh/personal-tracker/issues/256
