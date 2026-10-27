# ADR-045: Search unification — the top bar searches the collection and the catalog (issue #82)

## Status
Accepted

## Date
2026-08-07

## Context

Until issue #82 there were **two separate search flows**:

1. **The header's global search** (ADR-013, issue #46): the
   `#global-search-results` dropdown anchored under `#global-search-input`
   searched **only the user's collection** — movies, series, books (also
   by author) and friends, grouped with icons and with a **status
   chip** to the right of each row. Clicking a row opened the item's
   profile (closing the dropdown).
2. **"For adding" searchers inside each tab** (`ocio/*.html`): one
   `.search-slip` form per group («Busca una serie…», «Busca una
   película…», «Busca un libro o autor…») that searched the catalog (TMDB /
   Google Books with Open Library fallback) and painted the results in a
   **horizontal strip** (`.results-strip` with `.result-card`), with a
   "Load more" / "Hide results" toolbar (`#btn-load-more-*`,
   `#btn-hide-results-*`), manual-creation buttons (`#btn-manual-movie/tv/
   book`) and, in books, the **«Solo en español»** checkbox (`#books-span-
   only`, ADR-002). ADR-030's preview opened from those cards
   (`renderSearchResults` with the `onPreview` callback).

In addition, each tab had its **collection searcher** `.library-search`
(«Buscar en mi lista…»), which filtered the library in memory with its own
input (`librarySearchText` in `js/app.js`).

Issue #82 asks to **unify everything in the top bar**: when searching, the
collection's results must appear (current behavior) and, above them,
**type buttons** (Series / Movie / Book) to search the catalog; the
catalog's results are shown **as a list inside the same dropdown** (not
horizontal), with an **«Añadir»** button on the right (where the status
chip used to go); pressing a catalog result expands its information
(ADR-030 preview) **without closing the dropdown**; the row
**«Añadir manualmente»** moves to the end of the catalog results and
both the collection's search bar and all the add-search UI are
**removed**. The issue also asks to **study how to distinguish** "search
the collection" from "search something new".

Related issue: #82 — https://github.com/gonzalitojh/Registro-personal/issues/82

## Decision

Unify the searches into a **single entry point**: the header's bar. The
`#global-search-results` dropdown integrates the collection's results
(ADR-013's previous behavior) and the catalog sections
(TMDB / Google Books / Open Library) under the type buttons, with the
creation (`handleAdd`), the preview (ADR-030) and the manual creation
(`handleManualAdd`) of `js/search.js`. The UI orchestration stays in
`js/global-search.js` (existing module, **no new module**); `js/search.js`
becomes **stateless** (pure logic and API calls only, without touching
the DOM).

### 1. Collection vs. catalog distinction: `kind` in `flatResults`

The unification's key is that **a single flat list** (`flatResults`)
feeds the dropdown, and each entry carries a `kind` discriminator:

- `{ kind: "collection", type, item, group }` — an item of the user's
  collection (or a friend). Click → open profile (closes the dropdown).
- `{ kind: "external", type, item, group }` — an API catalog result.
  Click → preview (ADR-030) **without closing the dropdown**.
- `{ kind: "manual", type, group, item: null }` — the «Añadir
  manualmente» row. Click → `openManualAddModal` without closing the
  dropdown.

Both the collection rows and the catalog rows use the **same CSS class
`.global-search__item`** (same structure: cover, title, metadata); the
only thing that changes is the **right-hand element**: the status chip
(`.global-search__item-status`, collection only) vs the
**«Añadir»/«Añadido» button** (`.global-search__item-add`, catalog
only). Keyboard navigation (arrows + Enter/Space, `data-global-idx`) and
highlighting are common to the three `kind`s. The horizontal strip UI
(`.result-card` / `renderSearchResults`) is removed from the creation
flow.

### 2. `js/search.js` refactored to stateless (no new module)

`js/search.js` stops touching the DOM and storing results state
(`searchState`, `lastMoviesResults`, etc. disappear) and only exports
pure logic:

- **`searchExternal(group, query, page = 1)`**: delegates to
  `api-movies.js` (`searchMovies`/`searchTv`) or `api-books.js`
  (`searchBooks`). For books it always calls with `spanishOnly = true`
  (point 7). Returns `{ items, hasMore, source }`.
- **`handleAdd(item, btn, ctx)`** and **`handleManualAdd(type, data, ctx)`**:
  existing creation flows (including the multi-cover book path via
  `openBookConfirmModal`), no behavior change.
- **`openSearchPreviewFromResults(item, added, ctx)`**: ADR-030's
  preview; recomputes `added` with the `ctx`'s current state.
- **`existingIdsFor(group, ctx)`**, **`existingBookKeys(ctx)`** and
  **`isBookAlreadyAdded(item, idsSet, keysSet)`**: "already added"
  detection by `externalId` and, in books, by title+author cross-check.
- **`enrichSearchItem(item)`**: the preview's non-blocking enrichment
  (never throws).

**Removed**: `setupSearch`, `clearAllSearches`, `refreshSearchAddButtons`,
`hideResults` and `toggleResultsToolbar` (and with them their
`addEventListener`s over `#form-search-*`, `#btn-load-more-*`,
`#btn-hide-results-*`, `.search-clear-btn`, `#btn-manual-*` and
`#books-spanish-only`). The dropdown UI (collection + catalog) lives in
`js/global-search.js`.

### 3. Type buttons ALWAYS visible above the results

The **«Serie» / «Película» / «Libro»** buttons (`renderTypeButtons`,
`.global-search__type-buttons`) render **in all the dropdown's states**:
initial hint (< 2 characters), results, catalog states and "no
results". Pressing one marks the group as active
(`activeGroup` → `.is-active`) and launches the catalog search
(`runExternalSearch(group, query)`) with the current query; with a short
query it shows the 2-character minimum hint without calling the API.

### 4. Catalog sections as a list inside the dropdown

**Single selection** (user comment in issue #82, option B): pressing a
type button shows **only the active group's «Catálogo · X» section**
(`activeGroup`); the previously open catalog's results are **hidden**
immediately. The user's collection (groups Películas/Series/Libros/Amigos)
always renders and is never affected by the catalog selection. Each
external group's state (loading `inFlight`, error `externalError` or cache
`externalCache`) is **kept in memory** so one can return to the previous
group without re-calling the API, but only the active group's is
rendered.

Each section has four possible states — and in **all** of them the
**«¿No la encuentras? Añadir manualmente…»** row at the end (`manualRowHtml`;
in the "loading" state `externalSectionLoadingHtml` adds it):

| State | Content |
|---|---|
| **Searching** | «Buscando en el catálogo…» + manual row |
| **Error** | «No se pudo buscar: \<mensaje\>» + manual row |
| **Empty** | «No hay resultados de serie/película/libro para "X".» + manual row |
| **Results** | Up to 5 rows with cover, title, year (and author in books) and the **«Añadir»** button on the right (`.global-search__item-add`, `btn--small`) + manual row |

The «Añadir» button uses `handleAdd(entry.item, btn, ctx)` with
`e.stopPropagation()` (does not open the preview); on successful add it
becomes `disabled` + «Añadido». **Clicking the row** (or Enter/Space)
opens the **preview** (`openSearchPreviewFromResults`, ADR-030)
**without closing the dropdown**: the modal overlaps and, on closing it,
the user stays in their search.

### 5. Anti-race: `searchSeq` + per-group cache + `inFlight`

So that API responses never overwrite newer state:

- **`searchSeq`**: monotonic counter incremented on each new search
  (`performSearch`), on each `runExternalSearch` and in
  `closeGlobalSearch()`. Each search captures its `seq`; on resolution, if
  `seq !== searchSeq` (or the dropdown is no longer open) the response is
  **silently discarded**.
- **Per-group cache** `externalCache[group] = { query, items, source }`:
  only the successful search for the current query is stored;
  `renderExternalSection` decides the state by comparing
  `cache.query === query`.
- **`inFlight[group]`** and **`externalError[group] = { query, message }`**:
  mark searches in progress and errors (the error only paints if its
  `query` is the current one).
- **`closeGlobalSearch()` invalidates everything**: increments `searchSeq`
  and clears the cache, `inFlight`, errors and `activeGroup`; the input's
  text is kept (Gmail pattern, already documented in ADR-013).

### 6. No pagination in the dropdown (first page only)

Unlike the old `.results-strip` (with per-group "Load more"), the
dropdown **does not paginate**: `runExternalSearch` always calls
`searchExternal(group, query, 1)` and trims to **5 results per group**
(`slice(0, 5)`). The collection keeps its pre-existing cap (5 per group of
items, 3 friends). The dropdown is a quick-action panel: the preview
(ADR-030) and the manual creation cover the discovery cases.

### 7. Books always in Spanish (checkbox removed)

`searchExternal` for `books` calls `apiSearchBooks(query, page, null,
true)` — `spanishOnly` always `true`. The `#books-spanish-only`
checkbox (ADR-002) and its `change` listener that relaunched the search
are **removed**; the default behavior (discarding confirmed editions in
another language, keeping those with no language data) becomes the only
one. The `searchBooks` API keeps the parameter for internal
compatibility.

### 8. `refreshExternalResults(ctx)`: «Añadir»/«Añadido» buttons up to date

New exported function of `js/global-search.js`: **re-renders the
external sections from the cache** with the collection's current state.
`js/app.js` calls it after **each Firestore snapshot**
(`subscribeToItems` of movie/tv/book, replacing the
`refreshSearchAddButtons` calls): if the dropdown is open, the
«Añadir» buttons become «Añadido» (and vice versa) without redoing
searches or losing the user's position.

### 9. UI removed (collection and "for adding")

- `ocio/*.html`: the `.search-slip` forms are **removed**
  (`#form-search-movies/tv/books`, `#search-*-input`, `.search-clear-btn`),
  the `.results-strip` strips (`#search-*-results`), the toolbars
  (`#results-toolbar-*`, `#btn-load-more-*`, `#btn-hide-results-*`),
  the `#btn-manual-movie/tv/book` buttons, the `#books-spanish-only`
  checkbox and the `.library-search` collection searcher («Buscar en mi
  lista…»).
- `js/app.js`: `librarySearchText` and the `.library-search-input`
  listeners removed; `clearAllSearches()` on section change removed.
- `js/ui.js`: `renderSearchResults` removed (and its `.result-card`
  helpers); `openSearchPreviewModal`, `openBookConfirmModal` and
  `openManualAddModal` are kept (ADR-030's preview and manual creation
  remain, now fed from the dropdown).
- `ocio/ocio.css`: cleanup of the `.search-slip`, `.results-strip`,
  `.result-card*`, `.results-toolbar`, `.lang-filter-check` and
  `.library-search*` styles (which ADR-027/042/016/009 referenced).

### 10. Responsiveness (AGENTS.md)

- **Type buttons with `flex-wrap`**: `.global-search__type-buttons`
  wraps to a second line when they do not fit (base and reinforcement in
  the ≤600 px media query), without overflowing.
- **Fixed dropdown on mobile (≤600 px)**: `#global-search-results` moves
  to `position: fixed; left/right: 1rem; top: 4.5rem` (the exact pattern
  of ADR-027's `.notif-dropdown`): the bar's wrap is narrow and the panel
  would overflow; anchored to the viewport it never leaves the visible
  width.
- **Titles and metadata on mobile**: `white-space: normal` with a 2-line
  clamp (on desktop they keep nowrap + ellipsis + `title`); rows with
  `min-width: 0` and `overflow-wrap`, no page-level horizontal scroll at
  360/768/1280 px.

### 11. No PWA versioning change

`APP_VERSION` (`js/config.js`), the `?v=` refs of `index.html` and the
service worker's `STATIC_ASSETS` are not modified: version `20260816`
(introduced in issue #92) is already active in the integration branch
and covers this issue's UI changes when deploying together with them.

## Rejected alternatives

- **Keeping the "for adding" searchers in the tabs and only linking them
  from the top bar**: rejected — the issue explicitly asks to remove the
  collection's search bar and the add search; a single search point
  avoids UI and state duplication.
- **A new module for the catalog search** (e.g.
  `js/catalog-search.js`): rejected — `js/search.js` already housed the
  search/creation logic; the stateless refactor keeps it without DOM, and
  `js/global-search.js` already orchestrates the dropdown (ADR-013). Zero
  new modules.
- **Catalog rows with their own CSS class**
  (`.global-search__item--external` or another): rejected — the same
  `.global-search__item` class with a different right-hand element (chip
  vs. Add button) reuses layout, hover, focus and responsiveness; the
  `kind` of `flatResults` already differentiates the behavior.
- **Pagination in the dropdown** ("Load more" per section, as in the old
  `.results-strip`): rejected — the dropdown is a quick-action palette,
  not a search page; the per-group cap of 5 plus the preview and manual
  creation cover discovery without complexity.
- **Closing the dropdown when opening the preview** (collection's
  pattern): rejected — it would interrupt the "search → compare → add"
  flow; the preview overlaps the dropdown and on closing it the user
  resumes their search exactly where they were.
- **Keeping the «Solo en español» checkbox**: rejected — the app is in
  Spanish and the checkbox was on by default; removing it simplifies
  the books UI (ADR-002) without losing search capability.
- **Multi-selection of catalogs (option A of issue #82's comment)**: keep
  several type buttons marked at once and allow un-marking them to hide
  their results — rejected in favor of **single selection** (option B):
  the dropdown is a quick-action panel and accumulating several
  «Catálogo · X» sections made it long and confusing (the user reported
  that pressing Movies after Series kept both results); with a single
  active catalog the panel stays readable, and the other groups' state is
  kept in cache to return without re-querying the API.
- **Keeping the catalog cache when closing the dropdown** (reopen and
  reuse): rejected — the cache is invalidated in `closeGlobalSearch()`
  so no section shows results from another session; the cost is one API
  call when pressing the type button again.
- **Keeping the `.library-search` collection searcher**: rejected —
  the issue asks to remove it; the top bar already filters the collection
  (and by author in books), so it was functionally redundant.

## Consequences

### Positive

- **A single search point**: searching your stuff and adding new stuff
  happens in the same panel, with the same list pattern, keyboard and
  responsiveness.
- **Less UI to maintain**: 3 `.search-slip`, 3 `.results-strip`, 3
  toolbars, 6 buttons (`#btn-load-more-*`, `#btn-hide-results-*`), 3
  `#btn-manual-*`, 3 `.library-search`, the language checkbox and
  `renderSearchResults` disappear (~650 net lines fewer in the global
  diff between removed and added).
- **`search.js` stateless**: pure, testable logic, with no DOM coupling
  nor results state; the creation/preview functions (ADR-030) are
  reused with no behavior change.
- **Robust anti-race**: `searchSeq` + per-group cache + `inFlight`
  discard stale responses; `closeGlobalSearch()` invalidates everything at
  once, with no hanging states.
- **«Añadir»/«Añadido» buttons always up to date**: `refreshExternalResults`
  re-renders from cache after every Firestore snapshot, without new
  searches nor loss of context.
- **Continuous creation flow**: the preview does not close the dropdown;
  adding, comparing and searching again do not require reopening the
  panel.
- **Fewer options in books**: always in Spanish, with no checkbox to
  manage (ADR-002 is reduced to its default behavior).
- **Responsiveness verified** per AGENTS.md (360/768/1280 px with no
  horizontal scroll): `flex-wrap` on the type buttons, `fixed` dropdown on
  mobile, 2-line clamp on mobile titles/metadata, `min-width: 0` on rows.

### Negative / Risks

- **No pagination nor "Load more"**: from a search with many results only
  the first 5 per group are seen in the dropdown; the preview and manual
  creation mitigate, but there is no way to browse the rest from the
  panel.
- **The external cache is invalidated when closing the dropdown**:
  reopening and repeating the catalog search implies a new API call
  (network and quota cost); accepted in exchange for not showing stale
  results.
- **Habit change**: whoever searched inside the tab («Buscar en mi
  lista…» or the "for adding" searcher) must use the top bar; the user
  manual was updated to reflect it (AGENTS.md obligation).
- **The dropdown grows**: with collection + several catalog sections the
  panel can exceed the viewport's height; `max-height: min(60vh,
  480px)` + `overflow-y: auto` (pre-existing) keep it scrollable without
  overflowing.

### Neutral

- **ADR-013 partially superseded**: the global search it documented
  (collection + friends, status chips) is kept as-is as the first part of
  the dropdown; its scope is expanded with the catalog sections.
- **ADR-030 in force but with a new host**: the preview stays intact
  (modal, enrichment, `isConnected` guards), but it now opens from
  dropdown rows instead of `.result-card`; `renderSearchResults` (with its
  6th `onPreview` parameter) is removed as the horizontal strip
  disappears.
- **ADR-002 reduced**: the books search keeps Google Books with Open
  Library fallback and editions grouping; the «Solo en español» checkbox
  disappears and its on behavior becomes the only one.
- **ADR-042/027/016/009**: the `.search-slip input` and
  `.library-search-input` selectors they mention no longer exist; their
  global `font-size: 16px` rule still applies to the remaining inputs.
- **PWA**: no change in this issue; the `20260816` versioning (issue #92)
  already covered the partials and modules touched here.
- **`docs/manual-de-usuario.md` updated**: sections 3, 4.2 (series),
  5.2 (movies), 6.2 (books, always in Spanish) and 7 (How to search:
  7.1 catalog with type buttons, 7.2 your log, 7.3 add manually)
  and TOC, reflecting the unified flow.

## Created/modified files

| File | Change |
|---------|--------|
| `js/search.js` | **Refactor to stateless**: `setupSearch`, `clearAllSearches`, `refreshSearchAddButtons`, `hideResults`, `toggleResultsToolbar` and the results state removed; exports `searchExternal(group, query, page=1)` (delegates to api-movies/api-books; books always `spanishOnly=true`), `existingIdsFor`, `existingBookKeys`, `isBookAlreadyAdded`, `handleAdd`, `handleManualAdd`, `openSearchPreviewFromResults`, `enrichSearchItem` (the latter with no behavior change) |
| `js/global-search.js` | **Unified dropdown (issue #82)**: `flatResults` with `kind` `"collection"`/`"external"`/`"manual"`; type buttons ALWAYS visible (`renderTypeButtons`, `activeGroup`); **single selection**: only the active group's «Catálogo · X» section (pressing another type hides the previous ones; cache kept to return without re-calling); list sections with Add/Added button and manual row at the end (also in searching/error/empty: `manualRowHtml`, `externalSectionLoadingHtml`); click on an external row → preview without closing the dropdown; anti-race `searchSeq` + per-group cache `{ query, items, source }` + `inFlight` + `externalError`; `closeGlobalSearch()` invalidates everything; no pagination (page 1, cap 5); new exported `refreshExternalResults(ctx)`; Add button with `stopPropagation` and refresh to «Añadido» after success |
| `js/app.js` | Imports `refreshExternalResults` (replaces `refreshSearchAddButtons`); calls it after each `subscribeToItems` snapshot (movie/tv/book); `librarySearchText` and the `.library-search-input` listeners removed; `clearAllSearches()` removed |
| `js/ui.js` | `renderSearchResults` removed (and the horizontal strip's `.result-card` render); `openSearchPreviewModal`, `openBookConfirmModal` and `openManualAddModal` kept |
| `ocio/series.html`, `ocio/peliculas.html`, `ocio/libros.html` | Removed `.search-slip` (`#form-search-*`, `#search-*-input`, `.search-clear-btn`), `.results-strip` (`#search-*-results`), `.results-toolbar` (`#btn-load-more-*`, `#btn-hide-results-*`), `#btn-manual-movie/tv/book`, `#books-spanish-only` and `.library-search` («Buscar en mi lista…») |
| `css/styles.css` | `.global-search__type-buttons`/`__type-btn`/`.is-active` (flex-wrap), `.global-search__group-title`, `.global-search__status`, `.global-search__item-add` (Add button), `.global-search__manual-add`, `.global-search__item-status` (chip, shared with the collection); `@media (max-width: 600px)`: flex-wrap reinforcement and titles/metadata with 2-line clamp (the dropdown was already `position: fixed` on mobile) |
| `ocio/ocio.css` | Cleanup of the styles of `.search-slip`, `.results-strip`, `.result-card*`, `.results-toolbar`, `.lang-filter-check`, `.library-search*` |
| `js/config.js` | `APP_VERSION` from `20260815` to **`20260816`** |
| `service-worker.js` | `STATIC_ASSETS` with `?v=20260816` (styles, ocio.css, app.js and `ocio/*.html`); invalidates `20260815` and older caches |
| `docs/manual-de-usuario.md` | Sections 3, 4.2, 5.2, 6.2 and 7 (7.1 catalog with type buttons and manual row; 7.2 your log; 7.3 add manually) and TOC updated to the unified flow: books always in Spanish, no «Buscar en mi lista…» nor searchers inside the tabs |
| `docs/adr-045-unificacion-buscadores.md` | **New**: this document |

Related issue: #82 — https://github.com/gonzalitojh/Registro-personal/issues/82
