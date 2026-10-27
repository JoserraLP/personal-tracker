# ADR-027: General responsiveness review — root-cause fixes in CSS (issue #41)

## Status
Accepted

## Date
August 2026

## Context

Issue #41 asks for a **general responsiveness review of the whole web**: the application (vanilla JS SPA + Firebase) must look correct on computer, tablet and mobile, at any screen width, without page-level horizontal scroll or text off screen. The scope covers `index.html`, the pages `ocio/*.html`, `css/styles.css`, `css/ocio.css` and the dynamic markup generated in `js/ui.js`.

The project already had the «Responsividad obligatoria» rule defined in `AGENTS.md` (ADR-026), with 4 verifiable criteria:

1. **No page-level horizontal scroll** at any width; horizontal scroll is only allowed inside containers designed for it (e.g. tables with `overflow-x: auto`).
2. **No text off screen**: titles, dates, author names and long synopses must fit their container (`overflow-wrap: break-word`, `min-width: 0` on flex/grid children, relative units). Essential content is not truncated with ellipsis on mobile.
3. **Relative units** (%, rem, em, fr, vw/vh, `minmax()`) for widths, columns and body typography; avoid fixed `px` in full-width containers.
4. **`overflow-x: hidden` on `body`/`html` forbidden as a patch**: it masks the overflow and can cut content; the root cause is always fixed.

The architect's audit detected real overflows in several components at mobile viewports (~360 px) and ultra-small widths (< 340 px): the toast (long messages and undo-type ones), episode names, the grids (library, statistics, friends), the library search, the detail modal header, the notification and settings rows, the profile's 5 sub-tabs and the app header. In addition, several card and result texts used `nowrap` + ellipsis, truncating essential content on mobile.

Related issue: #41 — https://github.com/gonzalitojh/Registro-personal/issues/41

## Decision

Fix the overflows at their **root cause** (CSS), replace ellipsis truncation with **line-clamp** for essential content on mobile, compact the overflowing components (profile sub-tabs and header) and do a **PWA version bump** to propagate the changes to clients with cache-first caching. `overflow-x: hidden` is never used as a patch.

### 1. Root-cause fixes in CSS (`css/styles.css` and `ocio/ocio.css`)

The detected overflows were fixed with `overflow-wrap` and `min-width: 0` (flex/grid children), without masking the problem:

- **`.toast`**: `max-width: min(480px, calc(100vw - 2rem))` + `overflow-wrap: anywhere`; toast text (including `.toast--undo span`, which gets `flex: 1` + `min-width: 0`) wraps at any word, and **only the undo button keeps `nowrap`**.
- **`.episode-row__name`**: `min-width: 0` + `overflow-wrap: anywhere` (long episode names without spaces no longer overflow the row).
- **Grids with `minmax(min(Npx, 100%), 1fr)`** to support viewports < 340 px: `.library-grid` (`min(150px, 100%)`), `.stats-grid` (`min(280px, 100%)`), `.friends-list` (`min(120px, 100%)`) and `.cover-picker` (`min(150px, 100%)`).
- **`.search-slip input`**: `min-width: 0` (the library search's input no longer pushes the container).
- **Detail modal**: `.modal-detail__header > div` with `min-width: 0` and `.modal-detail__title` with `overflow-wrap: anywhere` (long titles without spaces wrap instead of overflowing the modal).
- **`.notif-row__text`** and **`.settings-row label:first-child`**: `min-width: 0` + `overflow-wrap: anywhere` (notification texts and long settings labels wrap; the select/switch stays intact).
- **Notifications dropdown (`.notif-dropdown`)**: on mobile the header wraps into two rows and the absolute anchor (`right: 0` relative to `.user-badge`) was left off-screen to the left, opening the panel outside the viewport. Double fix: `.user-badge` with `margin-left: auto` (anchored to the right when wrapping) and `@media (max-width: 600px)` with `position: fixed; left: 1rem; right: 1rem; top: 4.5rem; width: auto` (the panel anchors to the viewport: by construction it can never overflow horizontally).

### 2. Truncation with line-clamp instead of nowrap + ellipsis (essential content on mobile)

Essential content (titles, activity texts) goes from `nowrap` + ellipsis to a **2-3-line line-clamp** at the widths where it was previously truncated:

- **`.activity-event__text`**: 3-line clamp at all widths (activity feed text).
- **`.list-row__title`**: 2-line clamp at all widths.
- **`.friend-card__name`**: 2-line clamp (long friend names).
- **`.result-card__title`**: 2-line clamp.
- **`.global-search__item-title` / `.global-search__item-meta`**: 2-line clamp **only ≤ 600 px**; on desktop they keep `nowrap` + ellipsis + the `title` attribute.
- **`.item-card__meta`**: 2-line clamp **only ≤ 480 px**; on desktop it keeps `nowrap` + ellipsis + `title` (ADR-003 decision).

The `title` attribute is kept in the dynamic markup (`js/ui.js`) to recover the truncated content on desktop (native tooltip).

### 3. Profile sub-tabs (`.profile-subtabs`) — wrap instead of hiding

The profile's 5 tabs (Estadísticas, Amigos, …) overflowed the viewport on mobile. Fixed with `flex-wrap: wrap` + a media query ≤ 480 px with reduced paddings and `font-size` (`padding: 0.3rem 0.6rem`, `font-size: 0.78rem`, `justify-content: center`). **No tab is hidden** and the logout button is never hidden.

### 4. Compact header at ≤ 480 px

Media query that reduces the gaps and paddings of `.app-header__top` (`gap: 0.5rem`, `margin-bottom: 1rem`), `.app-title` (`font-size: 1.45rem`) and `.user-badge` (`gap: 0.4rem`, `.btn--ghost` with `padding: 0.3rem 0.6rem` and `font-size: 0.78rem`). The top row already wraps into two lines (`flex-wrap: wrap`) without overflowing and **without hiding the "Salir" button**.

### 5. PWA version bump to `20260805`

`scripts/bump-version.sh` was run to invalidate the service worker cache (cache-first strategy, ADR-019) and propagate the CSS/HTML changes:

- `js/config.js`: `APP_VERSION` → `'20260805'`.
- `index.html`: versioned refs `?v=20260805` (`css/styles.css`, `ocio/ocio.css`, `js/app.js`).
- `service-worker.js`: `STATIC_ASSETS` updated to `?v=20260805` (including the `ocio/*.html` fragments).

### 6. Respect for previous decisions

The review does **not** alter previously documented decisions:

- **ADR-003**: `.item-card__meta` keeps ellipsis + `title` on desktop (the clamp only applies ≤ 480 px).
- **ADR-016**: the accessibility patterns (focus, ARIA, contrast) are not touched.
- **ADR-017**: `.trailer-btn__label` keeps its `white-space: nowrap` intact.
- The **designed horizontal scrolls** (`.results-strip`, `.cover-picker`, `.recommendations__scroll`) are kept: they are containers meant for horizontal scroll, allowed by rule 1 of `AGENTS.md`.

## Rejected alternatives

- **`overflow-x: hidden` on `body`/`html` as a patch**: rejected by the explicit prohibition of `AGENTS.md` (ADR-026): it masks the overflow and can cut content. All overflows were fixed at their root cause.
- **Hiding profile sub-tabs on mobile**: showing only a subset of the 5 tabs was considered, but it would hide functionality; `flex-wrap: wrap` + compaction keeps 100 % of the tabs visible.
- **Generalized ellipsis (`text-overflow: ellipsis` with `nowrap`) for titles**: rejected because rule 2 of `AGENTS.md` forbids truncating essential content on mobile; the line-clamp wraps up to 2-3 lines preserving readability.
- **Keeping fixed `px` in full-width containers**: rejected by rule 3; the grids use `minmax(min(Npx, 100%), 1fr)` and the toast `calc(100vw - 2rem)` to degrade at small viewports.

## Consequences

### Positive
- **No overflows at any width**: verified the 6 acceptance criteria of the issue — correct display at 360/768/1280 px, `document.documentElement.scrollWidth <= window.innerWidth` at all 3 widths, `overflow-wrap`/`min-width: 0` applied, no fixed `px` in full-width containers, no `overflow-x: hidden` on `body`/`html`, and horizontal scroll only in designed containers (`.results-strip`, `.cover-picker`, `.recommendations__scroll`).
- **Essential content readable on mobile**: line-clamp of 2-3 lines instead of ellipsis; truncated content remains recoverable on desktop via the `title` attribute.
- **No functionality lost**: no profile tab nor the logout button are hidden on mobile.
- **QA and security**: QA validated the 6 acceptance criteria and the security scan reported no HIGH findings.
- **Guaranteed propagation**: the bump to `20260805` invalidates the service worker's cache-first cache, so clients receive the new styles.

### Negative
- **Broad CSS changes**: the review touches a high number of selectors in `css/styles.css` and `ocio/ocio.css`, increasing the risk of conflicts with future branches; mitigated by the version bump and by the QA coverage at the 3 widths.
- **Line-clamp requires `display: -webkit-box`**: the `-webkit-` prefix support is universal in modern browsers, but the clamp does not degrade gracefully if a browser does not support it (the content would be shown complete, untruncated — acceptable degradation).

### Neutral
- **`js/ui.js` is not modified**: the `title` attribute already existed in the dynamic markup; the change is purely CSS + version bump.
- **`.item-card__title` already used a 2-line clamp**; the review confirms it and extends the pattern to the rest of the titles, unifying the criterion.
- The toast with undo button (`.toast--undo`) may now take more height on mobile as the text wraps, but the button stays on the same line (nowrap).

## Created/modified files

| File | Change |
|---------|--------|
| `css/styles.css` | `.toast` with `max-width: min(480px, calc(100vw - 2rem))` + `overflow-wrap: anywhere` (and `.toast--undo span` with `flex: 1` + `min-width: 0`), `.notif-row__text` and `.settings-row label:first-child` with `min-width: 0` + `overflow-wrap: anywhere`, `.stats-grid`/`.friends-list` with `minmax(min(Npx, 100%), 1fr)`, `.friend-card__name` clamp 2, `.global-search__item-title/meta` clamp 2 ≤ 600 px, `.profile-subtabs` with `flex-wrap: wrap` + compaction ≤ 480 px, compact header ≤ 480 px (`.app-header__top`, `.app-title`, `.user-badge`), `.user-badge` with `margin-left: auto`, `.notif-dropdown` with `position: fixed` ≤ 600 px |
| `ocio/ocio.css` | `.episode-row__name` with `min-width: 0` + `overflow-wrap: anywhere`, `.library-grid`/`.cover-picker` with `minmax(min(Npx, 100%), 1fr)`, `.search-slip input` with `min-width: 0`, `.modal-detail__header > div` with `min-width: 0` and `.modal-detail__title` with `overflow-wrap: anywhere`, `.activity-event__text` clamp 3, `.list-row__title` clamp 2, `.result-card__title` clamp 2, `.item-card__meta` clamp 2 ≤ 480 px (desktop keeps ADR-003's ellipsis + title); `.trailer-btn__label` nowrap intact (ADR-017) |
| `js/config.js` | `APP_VERSION` → `'20260805'` |
| `index.html` | Versioned refs `?v=20260805` (`css/styles.css`, `ocio/ocio.css`, `js/app.js`) |
| `service-worker.js` | `STATIC_ASSETS` updated to `?v=20260805` (including `ocio/*.html` fragments) |
| `scripts/bump-version.sh` | **Used** (unchanged) to run the version bump |
| `docs/adr-027-responsividad-review.md` | **New**: this document |

Related issue: #41 — https://github.com/gonzalitojh/Registro-personal/issues/41
