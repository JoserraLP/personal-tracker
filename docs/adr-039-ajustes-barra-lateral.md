# ADR-039: Settings in the sidebar and header without ⚙️/☀️🌙 (issue #75)

## Status
Accepted

## Date
2026-08-06

## Context

After ADR-038 (issue #46), the header was Gmail-style —hamburger,
search bar, bell, ⚙️, ☀️/🌙 and avatar— and the side drawer only
contained the **«Ocio»** entry. In that state:

1. **Duplicated shortcuts**: the ⚙️ `#btn-settings` button of the header and
   the avatar's menu (ADR-035) led to the same destination (profile →
   Ajustes section); the ☀️/🌙 `#btn-theme-toggle` toggle duplicated
   the theme selector (ADR-012's `#settings-theme-select`). Two header
   buttons repeating already-covered functionality.
2. **Drawer with a single entry**: the sidebar did not offer the typical
   apps' "background" navigation (settings at the bottom, separated from
   the rest), and issue #75 asks to add **«Ajustes» at the bottom**,
   visually separated from «Ocio».
3. **Dead code**: `syncThemeSelect()` from `js/settings.js` existed only
   to keep the select in sync with the header toggle; if the toggle is
   removed, the function has no consumers.

Issue #75 also asks to **remove the ⚙️ and ☀️/🌙 buttons from the header**
and leave the theme as an option exclusive to the Ajustes section.

Related issue: #75 — https://github.com/gonzalitojh/Registro-personal/issues/75

**Historical note**: this ADR documents the removal of the header shortcuts
to Ajustes (⚙️) and the theme (☀️/🌙) that ADR-009, ADR-012 and ADR-035
documented, and their replacement by an «Ajustes» entry pinned to the footer
of ADR-038's side drawer.

## Decision

### 1. `pinned` «Ajustes» entry in the drawer's footer

ADR-038's **declarative `SECTIONS` pattern** is kept, adding a `pinned`
property to the entries:

- `index.html`: new `<div class="app-sidebar__footer"
  id="app-sidebar-footer">` inside the `aside#app-sidebar`, immediately
  after the `nav`.
- `js/sidebar.js`: new entry in `SECTIONS`:
  `{ id: "settings", label: "Ajustes", pinned: true, icon: inline SVG gear
  (currentColor stroke), onClick }`. The render is split:
  `#app-sidebar-nav` receives `SECTIONS.filter((s) => !s.pinned)` and the
  footer `SECTIONS.filter((s) => s.pinned)` (if the footer does not exist
  —old HTML— nothing is done: defensive).
- `css/styles.css`: `.app-sidebar__footer` with `margin-top: auto`
  (pushes the block to the drawer's bottom edge) and
  `border-top: 1px solid var(--paper-line)` (visual separator with the
  existing token).
- The **click delegation moved from the `nav` to the `aside`** (the whole
  sidebar): it still uses `closest(".app-sidebar__link")` +
  `SECTIONS.find()`, closing the drawer and running `section.onClick()`.
  The ✕ button uses the `app-sidebar__close` class, so it does not
  interfere with the delegate.

### 2. `onOpenSettings` callback injected from `app.js`

- `setupSidebar(opts)` now accepts an options object; the callback is
  stored in a module variable (`let openSettings = null`), which the
  «Ajustes» `onClick` invokes if it exists. The drawer module knows
  nothing about the profile: it just fires a callback.
- `js/app.js`: `setupSidebar({ onOpenSettings: () =>
  profileApi.openProfileSection("settings", ctx) })`.
- **`init()` reordering**: `setupProfile(ctx)` (which returns
  `profileApi`) and `setupSettings(ctx)` run **before**
  `setupSidebar(...)` so the callback is available. Before,
  `setupSidebar()` was called without arguments and before
  `setupProfile`.

### 3. Removal of ⚙️ and ☀️/🌙 from the header

- `index.html`: `#btn-settings` (⚙️) and `#btn-theme-toggle` (with
  `#theme-toggle-icon`, `role="switch"` and `aria-checked`) removed.
- `js/app.js`: their handlers removed; the `syncThemeSelect` import is
  dropped from `settings.js`.
- `css/styles.css`: the `.theme-toggle` and `#btn-settings` styles
  removed.
- `js/settings.js`: the exported `syncThemeSelect()` function removed
  (dead code); `wireThemeSelect` (private; connects
  `#settings-theme-select` → `saveSettings()` + `ctx.setTheme()`) and
  `syncThemeToSettings()` are kept (see point 4).

### 4. Simplified `setTheme()` and theme only from Ajustes

- `setTheme(theme)` no longer references the toggle or its icon: it keeps
  `document.documentElement.dataset.theme`, `localStorage` (key
  `mi-registro-theme`) and the `meta[name="theme-color"]` (`#f5f0e8`
  light / `#171512` dark). The theme is now changed **only** from the
  Ajustes selector.
- `syncThemeToSettings(getSavedTheme())` is kept in the `init()` to keep
  the `mi-registro-theme` and `mi-registro-settings` keys coherent.

### 5. PWA

- `js/config.js`: `APP_VERSION` from `20260810` to **`20260811`**.
- `index.html`: `?v=20260811` on `css/styles.css`, `ocio/ocio.css` and
  `js/app.js`.
- `service-worker.js`: `STATIC_ASSETS` updated to `?v=20260811`
  (styles, app.js and `ocio/*.html`). Invalidates previous caches.

### 6. User manual

- Sections **3** (main screen) and **14** (Ajustes): the ⚙️ and ☀️/🌙
  buttons removed from the header; «Ajustes» at the bottom of the sidebar
  as a new access path (alongside the photo's menu);
  the theme is chosen only in Ajustes.

## Rejected alternatives

- **`margin-top: auto` on the single `nav` with CSS tied to the last child**
  (e.g. `:last-child` on «Ocio»): rejected — it couples the style to the
  array's order and breaks when more entries are added; the declarative
  `SECTIONS` pattern with a `pinned` property and a dedicated footer
  container was preferred.
- **Mutable global state in `sidebar.js`** (e.g. exporting a setter or a
  callbacks registry): rejected — the repo's convention is injection via
  `setup*` functions with options from `app.js`; the `onOpenSettings`
  parameter keeps the module self-contained and testable.
- **Cross import of `profile.js` in `sidebar.js`** (calling
  `openProfileSection` directly): rejected — it would create a drawer →
  profile coupling and the module would stop being reusable; the drawer
  only needs to know that «Ajustes» fires a callback somebody injects.
- **Keeping the ☀️/🌙 toggle in the header**: rejected — the issue asks to
  remove it; Ajustes' theme selector already existed (ADR-012) and becomes
  the only path, removing the double change source and its sync code.

## Consequences

### Positive

- **Cleaner header**: hamburger, search bar, bell and avatar remain; access
  to Ajustes lives in the drawer and in the avatar's menu
  (no duplicates).
- **A single theme-change path**: the toggle's bidirectional sync is
  removed (including `syncThemeSelect`, dead code) and its styles.
- **`SECTIONS` pattern intact**: adding future sections (series,
  movies, books) or pinned entries stays declarative, with footer
  separation without fragile CSS tied to array positions.
- **Fewer elements in the header's icon row**, also in the compact
  mode ≤480 px (the `user-badge` is lightened).

### Negative / Risks

- **Change of user habits**: changing the theme now takes two steps
  (open the drawer and press «Ajustes», or photo menu → Ajustes)
  instead of one header click. Mitigated by the drawer footer's permanent
  entry and the updated manual.
- **`setTheme()` no longer updates any header button's ARIA state**:
  the only change point is Ajustes' select, which does not need that
  sync.

### Neutral

- **PWA versioned to `20260811`**: `APP_VERSION`, `?v=` in `index.html` and
  the service worker's `STATIC_ASSETS` invalidate previous caches.
- **`docs/manual-de-usuario.md` updated** (AGENTS.md obligation:
  changes visible to the user): sections **3** and **14**.
- **Historical ADRs superseded regarding the header buttons**:
  ADR-009 (documented `#btn-theme-toggle` and the `.theme-toggle` styles),
  ADR-012 (documented `#btn-settings`, `syncThemeSelect` and
  `syncThemeToSettings`) and ADR-035 (documented the ⚙️ vs. avatar menu
  duplication) are partially superseded at those specific points; the
  rest of their decisions (theme variables, settings page, profile
  dropdown) remain in force.
- Minor documentation debt: `syncThemeToSettings()`'s internal comment in
  `js/settings.js` still mentions the removed «header toggle»; it does
  not affect behavior.

### 7. Follow-up adjustment (user comment on the issue): single-row header on mobile

After the PR, the user pointed out in issue #75 that on the mobile view the
bell and the profile photo were **below** the search bar (second row),
and asked that hamburger, search bar, bell and avatar share a **single
row** (the search gets narrower).

- `css/styles.css`: in the header's `@media (max-width: 480px)`,
  `flex-wrap: nowrap` on `.app-header__top` and the `flex-basis: 100%` of
  `.user-badge` (which forced the second row) is removed;
  `flex-shrink: 0` is added so the icons do not compress. The search bar
  keeps `flex: 1; min-width: 0` and absorbs the leftover width (the
  input narrows without overflow; verified at 360 px).
- No changes in HTML, JS nor manual (the manual describes the elements,
  not the number of rows).

## Created/modified files

| File | Change |
|---------|--------|
| `js/sidebar.js` | **«Ajustes»** entry with `pinned: true` in `SECTIONS` (inline SVG gear icon, `onClick` → module callback); `setupSidebar(opts)` with injectable `onOpenSettings`; render split `nav`/`footer` (`filter(!pinned)` / `filter(pinned)`, defensive); click delegation moved from the `nav` to the `aside` |
| `index.html` | New `#app-sidebar-footer` after the drawer's `nav` (aside comment updated); **removed** `#btn-settings` (⚙️) and `#btn-theme-toggle`/`#theme-toggle-icon`; versioned `?v=20260811` |
| `js/app.js` | Removed `#btn-theme-toggle` and `#btn-settings` handlers and the `syncThemeSelect` import; simplified `setTheme()` (data-theme + `mi-registro-theme` + meta theme-color); `init()` reordered: `setupProfile`/`setupSettings` before `setupSidebar({ onOpenSettings: () => profileApi.openProfileSection("settings", ctx) })`; `syncThemeToSettings(getSavedTheme())` kept |
| `js/settings.js` | Exported `syncThemeSelect` function removed (dead code); `wireThemeSelect` (Ajustes theme selector) and `syncThemeToSettings` kept |
| `css/styles.css` | New `.app-sidebar__footer` (`margin-top: auto`, `border-top: 1px solid var(--paper-line)`, `gap`, `padding-top`); **removed** `.theme-toggle` and `#btn-settings` styles; mobile header ≤480 px in **a single row** (`flex-wrap: nowrap`, `user-badge` without `flex-basis: 100%`, `flex-shrink: 0`) |
| `js/config.js` | `APP_VERSION` from `20260810` to `20260811` |
| `service-worker.js` | `STATIC_ASSETS` with `?v=20260811` (styles, ocio.css, app.js, `ocio/*.html`) |
| `docs/manual-de-usuario.md` | Sections 3 and 14: ⚙️ and ☀️/🌙 removed from the header; «Ajustes» at the bottom of the sidebar as a new access path; theme only from Ajustes |
| `docs/adr-039-ajustes-barra-lateral.md` | **New**: this document |

Related issue: #75 — https://github.com/gonzalitojh/Registro-personal/issues/75
