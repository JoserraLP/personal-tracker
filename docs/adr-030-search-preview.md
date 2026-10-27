# ADR-030: Preview modal in search results — full information of an item before adding it (issue #22)

## Status
Accepted

## Date
August 2026

## Context

Issue #22 reports that when searching for a new series, movie or book to add (pages `ocio/peliculas.html`, `ocio/series.html`, `ocio/libros.html`), the search results (`.result-card` inside `.results-strip`) only showed cover, title, year and an "Añadir" button. The user could not see the synopsis, runtime, cast, community rating nor the trailer of a result **before** adding it to their collection: the only path was to create the item and open its detail modal, at the cost of an unwanted creation if the information was not convincing.

The collection's detail modals (`openMovieModal`/`openTvModal`/`openBookModal` in `js/ui.js`) already had all the necessary render helpers (`extraInfoHtml`, `communityRatingDisplay`, `trailerButtonHtml`, `modal-detail__*` classes), but they were coupled to the flow of an already-added item: they include editing, progress, logs and persistence callbacks that do not apply to a non-added item. `js/search.js` already knew the collection's state (`existingIdsFor`) and the creation paths (`handleAdd`/`doAddBook`), including the multi-cover book path (`openBookConfirmModal`).

Related issue: #22 — https://github.com/gonzalitojh/Registro-personal/issues/22

## Decision

Implement a **read-only preview modal** that opens when clicking a result card (click or Enter/Space key) and shows the item's information **as if it were already in the collection**, with the "Añadir" button delegating to the existing creation flow. The decision is organized in four layers: accessible clickable card, modal reusing the existing render helpers, non-blocking asynchronous enrichment, and orchestration in `js/search.js` (the UI module does not talk to APIs).

### 1. Clickable and accessible result card (`js/ui.js`, `renderSearchResults`)

`renderSearchResults` accepts an **optional 6th parameter** `onPreview(item, added)`. When defined:

- Each `.result-card` gains `role="button"`, `tabindex="0"` and a descriptive `aria-label` ("Ver información de <título>").
- **Clicking** the card opens the preview, **respecting the enabled Add button**: if the event comes from a non-disabled `button`, the button handles its own click and the card does not react; a disabled button ("Añadido") does let the click pass to the card.
- The **Enter/Space** keys open the preview only when focus is not on a button (if focus is on "Añadir", the button handles its own key).

### 2. `openSearchPreviewModal(item, { added, onAdd, onEnrich })` (`js/ui.js`)

New exported function reusing the detail modal's existing render helpers:

- **Header** `modal-detail__header`: cover, title and metadata line (year, and `autor · págs.` for books).
- **Editions note** for grouped books with several editions: `"N ediciones — al añadir podrás elegir portada"`.
- **`#preview-details`** with `extraInfoHtml(item)`: the synopsis (or other data) already carried by the search result is painted **immediately**.
- **Community rating + trailer** (`communityRatingDisplay`/`trailerButtonHtml`) only for movies and series; books do not have those blocks.
- **Footer** with "Cerrar" and "Añadir" buttons: the latter is shown disabled with the text "Ya añadido" when `added` is `true`, and delegates to `onAdd` when defined.
- Opening with the **project's standard pattern**: `_previousActiveElement` + `trapFocus`.

### 3. Non-blocking asynchronous enrichment

If `onEnrich` is passed, the modal first paints the search result's data, shows the hint `"Cargando detalles…"` and launches the enrichment in an `async` **without blocking the render or the Add button**:

- On resolution, `Object.assign(item, details)` is done and **only `#preview-details`** is re-rendered (never the modal structure).
- The rating/trailer blocks are refreshed **only if new data arrived**: if the trailer did not exist in the initial render (search results never carry `trailerUrl`), the button is **inserted** before `.modal-actions`.
- The loading hint is always removed, both on success and failure (the `catch` does not block the preview).
- **Validity guards**: before touching the DOM it checks `previewDetailsEl.isConnected` and that the modal is not hidden (`modal.classList.contains("hidden")`), to avoid stepping on a closed or meanwhile **replaced** modal — e.g. the preview → add multi-cover book flow, where `openBookConfirmModal` re-renders `#modal-content` and registers its own focus trap.

### 4. Orchestration in `js/search.js` (the UI does not talk to APIs)

- **`handleAdd`/`doAddBook` now return a success boolean**: `true` after `addItem`, `false` in the `catch`; the multi-cover path returns `undefined` because the flow continues in `openBookConfirmModal` (which handles its own closing).
- **`enrichSearchItem(item)`** (private): `movie` → `getMovieDetails`, `tv` → `getTvExtraDetails`, book from Open Library (externalId `/works/...`) without `description` → `getOpenLibraryDescription`. **Never throws**: it returns `{}` on any network/API failure.
- **`openSearchPreviewFromResults(item, added, ctx)`** (private): **recomputes `added`** with the `ctx`'s current state (defense against changes between render and click), mapping the singular `type` to the plural group `"movies"`/`"tv"`/`"books"` used by `ctx`; for books it reuses `isBookAlreadyAdded` (cross-check by title+author). The `onAdd` calls `handleAdd` and **closes the modal if creation succeeded** — `closeModal` is idempotent, so the multi-cover path (which already closed inside `doAddBook`) breaks nothing.
- **The 6 call sites of `renderSearchResults`** (3 in `refreshSearchAddButtons`, 3 in `setupSearch`) pass the preview callback.
- In `openBookConfirmModal` (`js/ui.js`) the **previous focus trap's cleanup** was added (`if (modal._focusTrapCleanup) modal._focusTrapCleanup()`), necessary in the preview → add multi-cover book flow to avoid leaving two traps active on the same modal.

### 5. CSS (`ocio/ocio.css`)

- `.result-card`: `cursor: pointer` (the card is clickable; harmless when the callback is not defined).
- `.result-card:hover`: `box-shadow: var(--shadow-pop)` — elevation indicating clickability.
- `.result-card:focus-visible`: `outline: 2px solid var(--teal-reel)` — visible focus for keyboard navigation.

### 6. Expansion after user feedback (seasons and pages)

The user requested more information in the preview: **seasons and episodes in series** and **the page count in books**.

- **Series — seasons block** (`previewSeasonsHtml` in `js/ui.js`): when the enrichment provides `seasonsMeta` (array `{seasonNumber, name, episodeCount, airDate}`), a read-only block is rendered with one row per season (name, episode count with correct plural and air date if it exists) and the total "N temporadas · M episodios". `seasonsMeta` is fetched in `enrichSearchItem` via `getTvSeasonsMeta` (TMDB) in a separate inner `try/catch`: if it fails, the preview still shows without the block (graceful degradation, same non-blocking philosophy).
- **Books — page count** (`previewPagesHtml` in `js/ui.js`): "Páginas: N" line in the details block when the search result carries `pages` (Google Books provides `pageCount`; Open Library does not).
- Both blocks render in both the initial render and the post-enrichment re-render, and return an empty string when not applicable (books without pages, series without data), without touching the modal structure or the focus trap.
- The `.preview-seasons*` styles are layout/typography only with relative units, `overflow-wrap: anywhere` and `min-width: 0`; with many seasons the modal scrolls vertically (`max-height: 88vh; overflow-y: auto`), never horizontally.

## Rejected alternatives

- **Reusing the collection's detail modals (`openMovieModal`/`openTvModal`/`openBookModal`) as they are**: rejected — they include editing, progress and logs that do not apply to a non-added item, and they require persistence callbacks that do not exist for an item not yet in the collection; besides, their opening assumes already-enriched data.
- **Embedded profile without a modal (expanding the card or an inline panel)**: rejected — it breaks consistency with the project's modal pattern (all details show in `#item-modal`) and complicates focus management in `.results-strip`.
- **Without enrichment (only the search result's data)**: rejected — TMDB already has the details (synopsis, cast, runtime, rating, trailer) and the enrichment is non-blocking: the user sees the search data instantly and the expanded ones when they arrive, at no perceptible cost.

## Consequences

### Positive
- **Full information without adding**: the user decides with synopsis, runtime, community rating and trailer before creation; unwanted creations are avoided.
- **No duplication of creation logic**: the modal's "Añadir" button delegates to the existing `handleAdd`/`doAddBook`, including the multi-cover book path; `handleAdd` only reported status, now it returns success, which does not break its callers (they ignored the return value).
- **Zero render duplication**: the preview reuses `extraInfoHtml`, `communityRatingDisplay`, `trailerButtonHtml` and the detail modal's `modal-detail__*` classes.
- **Accessible**: the card is a semantic button (`role="button"` + `tabindex="0"` + `aria-label`), operable with Enter/Space, with visible `:focus-visible` and standard focus trap in the modal.
- **Robust enrichment**: the `isConnected` + non-hidden modal guards avoid stepping on a closed or replaced modal (multi-cover books flow), and the loading hint is always cleaned up.
- **Responsive**: the modal reuses the `modal-detail__*` structure already verified in the responsiveness review; it introduces no new containers.

### Negative
- **One extra TMDB call per opened preview** of a movie or series (and to Open Library for `/works/` books without a synopsis); the cost is assumed because the enrichment does not block and only happens on user demand.
- **The trailer only appears after enrichment**: the button is inserted on resolution, not in the initial render; if the API fails, the user does not see the trailer in that preview.
- **Google Books results already carry a synopsis**, so books barely need enrichment (only the Open Library source via `getOpenLibraryDescription`); the editions note and the cover selector remain delegated to the creation flow.

### Neutral
- **`openSearchPreviewModal` and `openSearchPreviewFromResults` are exported/used as new functions**: they do not change `renderSearchResults`' signature (the 6th parameter is optional and `undefined` for consumers without preview).
- **No contract changes in `handleAdd`/`doAddBook`**: the boolean return is additive; existing callers ignored the return value.

## Created/modified files

| File | Change |
|---------|--------|
| `js/ui.js` | `renderSearchResults`: 6th parameter `onPreview` (card with `role="button"`/`tabindex="0"`/`aria-label`, click respecting the enabled Add button, Enter/Space outside buttons). New `openSearchPreviewModal` (header, editions note, `#preview-details`, rating/trailer for movies/series, Cerrar/Añadir footer with `added` state, `_previousActiveElement` + `trapFocus`, asynchronous enrichment with `isConnected`/hidden modal guards and partial re-render). `openBookConfirmModal`: cleanup of the previous focus trap. V2 expansion: `previewSeasonsHtml` (seasons/episodes block for series) and `previewPagesHtml` (book pages), included in initial and post-enrich renders |
| `js/search.js` | `handleAdd`/`doAddBook` return a success boolean. New `enrichSearchItem` (never throws; movie/tv/book Open Library) and `openSearchPreviewFromResults` (recomputes `added` mapping type → `movies`/`tv`/`books`; `onAdd` closes the modal if creation succeeded). The 6 call sites of `renderSearchResults` pass the preview callback. V2 expansion: `enrichSearchItem` (tv) adds `seasonsMeta` via `getTvSeasonsMeta` in an inner try/catch |
| `ocio/ocio.css` | `.result-card`: `cursor: pointer`; `.result-card:hover`: `box-shadow: var(--shadow-pop)`; `.result-card:focus-visible`: `outline: 2px solid var(--teal-reel)`. V2 expansion: `.preview-seasons*` styles (title, list, rows with `overflow-wrap: anywhere`/`min-width: 0`, total) |
| `docs/adr-030-search-preview.md` | **New**: this document |

Related issue: #22 — https://github.com/gonzalitojh/Registro-personal/issues/22
