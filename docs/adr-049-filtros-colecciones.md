# ADR-049: Collection filters (issue #118)

## Status
Accepted

## Date
2026-08-07

## Context

Issue #118 (`type: style`) asks to reorganize the controls bar of the
three collections (Series, Movies, Books). Original text:

> No debe aparecer el texto "Mis series", "Mis películas" o "Mi
> biblioteca", ya que con el sistema de pestañas, se ve perfectamente
> claro donde está el usuario.
>
> Los filtros de estado deben estar todos en una misma línea, si no cabe
> por ancho (por ejemplo en móvil) debe poderse desplazar en horizontal
> sobre ese listado de filtros.
>
> El selector de orden y el de vista (cuadrícula o lista) deben estar en
> la misma línea y, siempre que se pueda, en la misma línea que los
> filtros. En móvil no es posible, así que mantener en dos líneas.
> Ademas, el selector de orden debe tener el mismo tamaño y tamaño de
> fuente que los filtros.
>
> Eliminar el margen superior de los filtros. El espacio que se encuentra
> entre las pestañas (o la barra de búsqueda en caso de móviles) y los
> filtros.

Previous state of the code:

- Each collection (`ocio/series.html`, `ocio/peliculas.html`,
  `ocio/libros.html`) started with a `<div class="library-head">` that
  contained an `<h2>` («Mis series», «Mis películas», «Mi biblioteca») and,
  inside, `.library-controls` with the filter chips (`.filter-chips` +
  `.chip`), the sort selector (`.sort-select`) and the view toggle
  (`.view-toggle`).
- `.library-head` had `margin-top: 2.2rem` (the «space between tabs
  and filters» the issue asks to remove).
- `.filter-chips` used `flex-wrap: wrap`, so the chips jumped
  to a new line on mobile instead of sliding.
- Sort and view were already on the same line, but it was not guaranteed
  that they shared a line with the filters, and `.sort-select` had a
  padding (`0.3rem 0.65rem`) different from `.chip`'s (`0.3rem 0.75rem`).
- The focus on tab change landed on the panel's `h2`
  (`js/app.js`, guard `if (heading)`), and `css/styles.css` gave
  `scroll-margin-top` to `#main-content` and to `.panel h2` (issue #79).
- Minimum `font-size` of 16px in selects guaranteed by ADR-042
  (issue #92): the `.sort-select` was already at `1rem`.

Related issue: #118 — https://github.com/gonzalitojh/Registro-personal/issues/118

## Decision

### 1. HTML: the three collections' titles are removed

`ocio/series.html`, `ocio/peliculas.html` and `ocio/libros.html`:

- The `<div class="library-head">` and its `<h2>` («Mis
  series», «Mis películas», «Mi biblioteca») are **removed** in each file
  (preset ADR-046: remove entirely, do not hide).
- `.library-controls` becomes each file's **root element**.
- The block made of `.sort-select` + `.view-toggle` is wrapped in a new
  `<div class="library-controls__aux">` container (sort and view stay
  as a unit).

### 2. HTML: panels' ARIA (compensation for removing the h2s)

`index.html`:

- The three panels (`#panel-tv`, `#panel-movies`, `#panel-books`) gain
  `role="tabpanel"` and `aria-labelledby="tab-tv"` /
  `aria-labelledby="tab-movies"` / `aria-labelledby="tab-books"` (APG
  tabs pattern: the tab buttons already had `role="tab"`,
  `aria-controls` and `aria-selected`).
- Each panel's `aria-live="polite"` and `aria-atomic="true"` are kept.

### 3. CSS: filters on a single line with confined horizontal scroll

`ocio/ocio.css`, `.filter-chips`:

- `flex-wrap: nowrap` (all chips on one line).
- `overflow-x: auto` + `-webkit-overflow-scrolling: touch` (if they do
  not fit, the line slides horizontally).
- `scrollbar-width: none` + `.filter-chips::-webkit-scrollbar {
  display: none; }` — the scrollbar is not shown
  (user comment in the issue: «En el móvil, no debe aparecer
  la barra de desplazamiento horizontal»), but touch sliding
  still works.
- `flex: 1 1 auto` + `min-width: 0` (the filter line takes the available
  width and can shrink).

`.chip`:

- `flex: 0 0 auto` + `white-space: nowrap` (chips do not compress nor
  split their text when sliding).

Horizontal scroll stays **confined to the filter list**, a container
designed for it (allowed by AGENTS.md's rule 2; page-level
horizontal scroll remains forbidden).

### 4. CSS: sort and view as a unit, on the same line as the filters

`ocio/ocio.css`:

- **New** `.library-controls__aux`: `display: flex; align-items:
  center; gap: 0.7rem; flex-shrink: 0;` — wraps `.sort-select` +
  `.view-toggle` and neither shrinks nor splits.
- `.library-controls` (flex with `flex-wrap: wrap`) places in the
  **same line** the filters and the auxiliary block when the width allows
  (≥769 px).
- `@media (max-width: 768px) { .library-controls__aux { flex-basis: 100%;
  } }` → on mobile the auxiliary block jumps to a **second line**,
  keeping sort and view together (two lines in total: filters, and
  sort+view), as the issue asks.

### 5. CSS: same size and font for sort and filters

`ocio/ocio.css`:

- `.sort-select`: `padding` goes from `0.3rem 0.65rem` to `0.3rem 0.75rem`
  (identical to `.chip`'s); `font-size: 1rem` is kept (already required
  by ADR-042: no select with `font-size` < 16px due to iOS's automatic
  zoom).
- The library's chips are scaled **only** by the scoped rule
  `.library-controls .chip { font-size: 1rem; }`: the base `.chip` of
  `ocio/ocio.css` stays at `0.78rem` to not affect the global searcher's
  chip (`.global-search__item-status.chip` in
  `css/styles.css`, which depends via cascade on the base `font-size`).

### 6. CSS: no top margin between tabs/search and filters

`ocio/ocio.css`:

- The `.library-head` and `.library-head h2` rules are **removed**
  (including their `margin-top: 2.2rem`, which was the space between the
  tabs —or the search bar on mobile— and the filters).
- The base 1rem air comes from `.app`'s `padding` (ADR-040,
  untouched).
- `.library-controls` keeps `margin-bottom: 0.8rem` and adds
  `max-width: 100%`.

### 7. CSS: cleanup of orphaned rules

`css/styles.css`:

- `.panel h2` is **removed** from the `scroll-margin-top` rules (base and
  `@media (min-width: 768px)`); only `#main-content` remains, the target of
  the "Skip to content" link and of the focus on tab change (issue
  #79).
- The comment explaining those rules is **updated** (there is no more
  `h2` in the panels).

### 8. User manual updated

`docs/manual-de-usuario.md` (AGENTS.md obligation: change visible
to the user):

- Section 3: the active tab always indicates which collection you are
  in; each collection does not repeat a title like «Mis series» and on
  entering its toolbar is seen directly.
- Section 8: the filter chips are all on one line and, if they do not fit
  (mobile), the line slides horizontally (with no visible scrollbar; it
  slides with a finger); the sort selector and the view toggle always go
  together (same line as the filters on wide screens, second line on
  mobile); the sort selector has the same size and the same font as the
  chips.

### 9. PWA version bump

`index.html` (`?v=` in `css/styles.css`, `ocio/ocio.css` and `js/app.js`,
×3), `js/config.js` (`APP_VERSION`) and `service-worker.js`
(`STATIC_ASSETS`, ×6): `20260817` → `20260818`, to invalidate the service
worker's and browser's caches with the new styles and
markup.

## Rejected alternatives

- **Lowering `.sort-select` to `font-size: 0.78rem`** to match the chips:
  rejected — it violates ADR-042 (issue #92): a select with a computed
  `font-size` < 16px triggers iOS's automatic zoom when focused. The
  library's chip is raised to `1rem` instead.
- **Raising `ocio/ocio.css`'s base `.chip` to `1rem`** (affecting all
  chips at once): rejected — it would inflate the global searcher's
  status label (`.global-search__item-status.chip` in
  `css/styles.css`), which shares the `.chip` class and depends via
  cascade on its `0.78rem` base `font-size`. That is why the scaling is
  scoped: `.library-controls .chip`.
- **Hiding the `h2`s with `display: none`** keeping the markup:
  rejected — ADR-046 precedent: remove entirely, do not hide; an
  `h2` that does not render contributes nothing to the DOM and forces
  keeping useless CSS and text.
- **`overflow-x: hidden` on `body`/`html`** to contain the chips'
  overflow: rejected — forbidden by AGENTS.md's rule 2
  (it masks overflows and can cut content). Horizontal scroll is
  confined to `.filter-chips`, a container designed for it.
- **Keeping `scrollbar-width: thin`** (visible bar): rejected after the
  user's comment — on mobile the horizontal scrollbar must not appear.
  Hiding it is chosen (`scrollbar-width: none` +
  `::-webkit-scrollbar { display: none }`) while keeping touch
  scrolling.

## Consequences

### Positive

- The active tab is the only collection indication; each view lands
  directly on its toolbar, with no redundant title.
- The filters slide horizontally on mobile without taking more space nor
  overflowing the page (`document.documentElement.scrollWidth <=
  window.innerWidth` verified by QA at 360/768/1280 px), and without
  showing the scrollbar (user comment in the issue).
- Sort and view always stay together and share a line with the filters
  on wide screens; two lines on mobile, as the issue asks.
- Sort selector and chips with the same padding and the same font
  (1rem), respecting ADR-042.
- No extra space between the tabs (or the search bar on mobile) and the
  filters; the base air comes from `.app`'s `padding` (ADR-040).
- Full ARIA: panels with `role="tabpanel"` + `aria-labelledby`
  (APG pattern) without touching `aria-live`/`aria-atomic` nor the tab
  attributes.
- Orphaned CSS removed (`.panel h2` in `scroll-margin-top`) and
  `ocio/ocio.css`'s comment documenting the global searcher's chip's
  scoped dependency.
- Coherent PWA bump (3 `?v=` refs in `index.html` + `APP_VERSION`
  + 6 in `STATIC_ASSETS`).
- `js/app.js` unchanged (`.filter-chips`, `.sort-select` and
  `.view-toggle` selectors intact) and the friends view (`.friend-filters`
  / `.friend-chip`) untouched (out of the issue's scope).

### Negative / Risks

- **Accepted residue in `js/app.js`**: the `if (heading)` guard that
  moved the focus on tab change stays harmless (there is never an `h2`
  in the panels). It is kept to not touch JS out of scope; removable in a
  future refactor.
- **At exactly 768 px** the `max-width: 768px` media query forces the
  second line also for movies (3 chips), where everything might have fit
  on one line: accepted behavior — a single, coherent breakpoint with the
  rest of the app.
- **Without an `h2`, the focus on tab change does not land on a
  heading**: compensated with `role="tabpanel"` + `aria-labelledby`
  (the panels are properly labeled by their tab).
- **Fragile cascade dependency** of the global searcher's chip with the
  base `.chip`: a future change to `0.78rem` would affect it; mitigated
  with the scoped `.library-controls .chip` rule and its comment.

### Neutral

- **No automated tests**: the change is pure CSS/HTML; verification is
  done by cascade analysis (specificity and load order) and
  manual review at three widths (QA: 7/7 acceptance criteria met;
  security: 0 HIGH findings). The iteration (hidden scrollbar) was
  verified with Chromium headless at
  320/360/768/1280 px: `scrollbar-width: none`, working scroll at
  360 px and no page-level horizontal scroll.
- **`docs/manual-de-usuario.md` updated** (AGENTS.md's rule 3):
  sections 3 and 8 reflect the toolbar's new layout.
- **PWA bump applied in the same task** (unlike ADR-046, which left it
  for the release): each PR touching assets versions its URLs
  to invalidate caches.

## Created/modified files

| File | Change |
|---------|--------|
| `ocio/series.html` | **Modified**: `<div class="library-head">` with `<h2>Mis series</h2>` removed; `.library-controls` becomes the root element; the `.sort-select` + `.view-toggle` block is wrapped in `<div class="library-controls__aux">` |
| `ocio/peliculas.html` | **Modified**: `<div class="library-head">` with `<h2>Mis películas</h2>` removed; same restructuring as series (`.library-controls` root + `.library-controls__aux`) |
| `ocio/libros.html` | **Modified**: `<div class="library-head">` with `<h2>Mi biblioteca</h2>` removed; same restructuring as series (`.library-controls` root + `.library-controls__aux`) |
| `ocio/ocio.css` | **Modified**: `.library-head`/`.library-head h2` removed (including `margin-top: 2.2rem`); `.filter-chips` → `flex-wrap: nowrap; overflow-x: auto; flex: 1 1 auto; min-width: 0; -webkit-overflow-scrolling: touch; scrollbar-width: none` + `.filter-chips::-webkit-scrollbar { display: none; }` (iteration: bar hidden on mobile); `.chip` → `flex: 0 0 auto; white-space: nowrap`; new scoped rule `.library-controls .chip { font-size: 1rem; }` with a comment; `.library-controls` keeps `margin-bottom: 0.8rem` and adds `max-width: 100%`; new `.library-controls__aux`; `.sort-select` padding → `0.3rem 0.75rem`; `@media (max-width: 768px)` adds `.library-controls__aux { flex-basis: 100%; }` |
| `index.html` | **Modified**: the 3 panels (`#panel-tv`, `#panel-movies`, `#panel-books`) gain `role="tabpanel"` + `aria-labelledby="tab-tv"/"tab-movies"/"tab-books"` (`aria-live`/`aria-atomic` kept); bump `?v=20260818` (×3: `css/styles.css`, `ocio/ocio.css`, `js/app.js`) |
| `css/styles.css` | **Modified**: `.panel h2` removed from the `scroll-margin-top` rules (base and 768px media query; only `#main-content` remains) and comment updated |
| `js/config.js` | **Modified**: `APP_VERSION` `20260817` → `20260818` |
| `service-worker.js` | **Modified**: `STATIC_ASSETS` — 6 URLs with `?v=` move from `20260817` to `20260818` |
| `docs/manual-de-usuario.md` | **Modified**: section 3 (the active tab indicates the collection; no repeated title) and section 8 (chips on one line sliding horizontally on mobile; sort+view together — second line on mobile; same font size) |
| `js/app.js` | **Unchanged**: `.filter-chips`/`.sort-select`/`.view-toggle` selectors intact; the tab-change focus guard `if (heading)` is harmless without an `h2` (accepted residue) |
| `docs/adr-049-filtros-colecciones.md` | **New**: this document |

Related issue: #118 — https://github.com/gonzalitojh/Registro-personal/issues/118
