# ADR-067: Hiding sections and tabs from Settings (issue #97)

## Status
Accepted

## Date
2026-08-10

## Context

Issue #97 asks to be able to **hide sections** (and each
section's tabs) from **Settings**. Today there is a single section —«Ocio», with
the Series/Movies/Books tabs— but the design must be
**extensible to future sections**. When only **one section
remains visible**, the navigation sidebar (the ☰ drawer) loses
its purpose and is replaced by a **gear button in the header**
that opens Settings; when more than one section becomes visible
again, the sidebar reappears.

Key acceptance criteria: a «Secciones y pestañas» card in
Settings with a switch per section and per tab, generated from
a central registry; hiding a tab removes it from the tab bar and
from the view (the active one falls to the first visible one and URLs
pointing to a hidden one normalize); guards (the last section cannot
be hidden nor the last visible tab of a section);
persistence in localStorage (`mi-registro-settings`) and
sync with Firestore (preferences) with debounce; correct
display in the four theme modes and no horizontal scroll; updated
user manual.

## Decision

A central sections/tabs registry in `js/settings.js`
(`SECTION_REGISTRY`) as the **single source of truth**: adding a
future section only requires adding an entry
(`{ id: { label, tabs } }`, with a `panelId` per tab). The states
live in `DEFAULT_SETTINGS.visibleSections` / `visibleTabs` and are
sanitized on load with `sanitizeVisibility` (invariants: never 0
sections nor 0 tabs of a section; keys outside the registry are
ignored). The rest of the modules consume read-only
helpers (`isSectionVisible`, `countVisibleSections`, `normalizeTabKey`, …)
that read a fresh `loadSettings()` on every call.

### 1. Central registry and helpers (`js/settings.js`)

- `SECTION_REGISTRY` exported, with the keys' order = the
  sidebar's order and the "first visible" one.
- Exported helpers: `isSectionVisible(id)`,
  `getVisibleSectionIds()`, `countVisibleSections()`,
  `isTabVisible(key)`, `getFirstVisibleTabKey(sectionId)`,
  `getFirstVisibleTabPanel(sectionId)` and
  `normalizeTabKey(sectionId, key)` (key → the first visible
  one if the requested one is hidden).
- `sanitizeVisibility(settings)` at the end of `loadSettings()`: if
  no section is visible all are enabled; if a section
  was left with no visible tabs all its tabs are enabled; keys
  not in the registry are discarded (tolerant). It is also applied
  on the no-localStorage return.
- `scheduleFirestoreSync` stores `preferences` with
  `notifications` + `visibleSections` + `visibleTabs`.

### 2. The «Secciones y pestañas» card in Settings

- `renderSettings(ctx)` calls `renderSectionsCard(settings)`, which
  paints in `#sections-visibility-list` (static HTML in index.html,
  between the «Apariencia» and «Notificaciones» cards) one row per
  section (`.settings-row` with `label.settings-row__text` + a switch
  `data-vis-section`) and its tabs nested in `.settings-group`
  (a switch `data-vis-tab` + an id
  `tab-visible-<sectionId>-<tabKey>`).
- **Guards**: the single visible section's switch is
  `disabled` with the note «No puedes ocultar la última sección
  visible.»; the last visible tab of a section's, with
  «No puedes ocultar la última pestaña visible de <Label>.». Defense
  in depth in the handler (`wireVisibilityToggles`)
  reverts the change if, despite that, 0 sections or 0 tabs
  of the affected section were left.
- The wiring is a **delegated `change`** on the container: the
  checks re-render after every change but the listener is
  registered only once.
- Minimal CSS with existing variables: `opacity` + `cursor` for
  disabled switches and an indent with a `--paper-line` border for the
  tabs' group (valid in the four themes with no overrides).

### 3. Tab removal from the bar and the view (`js/app.js`)

- `applyTabVisibility()`: adds/removes `hidden` on the tabs
  (`.tab[data-panel=…]`) and the panels per `isTabVisible`. The
  subscriptions and data loads stay active.
- A guard at `activatePanel`'s start: if the requested tab is
  hidden, it falls to `getFirstVisibleTabPanel("ocio")` and
  **normalizes the hash in-place with `history.replaceState`**
  (no `router.navigate` nor `location.hash`: it does not fire
  hashchange and avoids loops). It deliberately does not use
  `router`: on the initial load `onRoute` runs
  inside `initRouter()`, before the `const router` is
  assigned (TDZ), so the normalization is done directly on the
  URL.
- Consumers navigating to a tab use `normalizeTabKey`:
  the sidebar's «Ocio» entry (`onGoOcio`) and the profile's return
  (`btn-close-profile` in profile.js).

### 4. Sidebar ☰ ↔ gear ⚙ (`js/sidebar.js` + index.html)

- `setupSidebar` receives the `isSectionVisible` predicate by
  **injection** (sidebar.js does not import settings.js: no cycles);
  it registers the click of the new `#btn-header-settings` (static
  HTML in `.app-header__top`, next to the ☰ toggle, with the
  `hidden` class by default) that opens Settings (the same callback as
  the pinned entry).
- New export `renderSidebar()`: a nav re-render (only visible
  sections) and footer (pinned, unfiltered) plus
  `updateHeaderNavButtons()`, which shows ☰ or ⚙ depending on
  `countVisibleSections() <= 1`. If the drawer is open and left with no
  sections, it closes first. `setupSidebar` calls
  `renderSidebar()` at the end (initial state).
- `app.js` wires the refresh: `setupSettings(ctx,
  { onVisibilityChange: refreshNavigation })` →
  `applyTabVisibility()` + `renderSidebar()`, and calls
  `applyTabVisibility()` once after startup.

## Rejected alternatives

- **Storing the visibility state separately (another
  localStorage key or a different Firestore field)**: rejected for
  coherence with notifications (everything in `preferences`) and so
  the existing backup/restore includes it unchanged.
- **Hiding sections/tabs only in memory (without persistence)**:
  the preference would be lost on every reload; the acceptance
  criterion requires persistence and sync.
- **Reusing `router.navigate` in `activatePanel`'s guard**:
  rejected due to the initial load's TDZ (see decision 3); it would
  also fire `hashchange` and re-frame the route.
- **Filtering by section in the drawer's footer**: «Ajustes» is
  pinned and always needed (especially with the ⚙ only visible when
  there is a single section), so the visibility filter only applies
  to the nav's non-pinned entries.

## Consequences

- The web allows hiding sections and tabs from Settings; the
  sidebar is replaced by the header's gear with a
  single visible section and reappears with more than one.
- Adding a future section is only registering an entry in
  `SECTION_REGISTRY` (and its panel/tabs in HTML): the sidebar,
  the Settings card, the guards and the URL normalization adapt by
  themselves.
- `sidebar.js` still does not import settings.js (an injected
  predicate); `settings.js` still does not import sidebar/app/router.
- The user manual documents the new feature (sections 3 and 14).
  PWA version bumped to `20260839`
  (scripts/bump-version.sh).

## Created/modified files

- `js/settings.js`: registry, helpers, sanitization, the Settings
  card, the toggles' wiring and the extended Firestore sync.
- `js/sidebar.js`: injected predicate, `renderSidebar`,
  `#btn-header-settings` wiring.
- `js/app.js`: `applyTabVisibility`, `activatePanel`'s guard,
  `refreshNavigation`, imports and wiring.
- `js/profile.js`: `normalizeTabKey` on the profile's return.
- `index.html`: the header's ⚙ button and the «Secciones y
  pestañas» card.
- `css/styles.css`: guards and `.settings-group`.
- `js/config.js`, `service-worker.js`, `index.html`: bump to
  20260839.
- `docs/manual-de-usuario.md`: sections 3 and 14.

Related issue: #97 — https://github.com/gonzalitojh/Registro-personal/issues/97
