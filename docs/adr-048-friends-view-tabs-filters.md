# ADR-048: Friends display by tabs and status filters (issue #49)

## Status
Accepted (revised in iteration 2: movie filters reduced)

## Date
2026-08-07

## Context

The **Friends** section's friend detail showed the three
categories (Movies, Series and Books) stacked vertically on a single
scroll page. With a large log, the vertical scroll became very
long and unusable (issue #49, `type: style`).

The issue asks to organize the display differently: **by tabs**
(closer to the profile's own view) and with **status filters**
(explicitly without search: «no hace falta búsqueda, pero sí filtros de
estados»).

Related issue: #49 — https://github.com/gonzalitojh/Registro-personal/issues/49

## Decision

### 1. Pill-style sub-tabs (Movies / Series / Books)

The friend detail switches to **showing one category at a time** via
pill-style sub-tabs, replicating the profile's own `.profile-subtab`
visual pattern:

- **Own classes** `.friend-subtabs` / `.friend-subtab` to avoid
  collisions: reusing `.profile-subtab` inside `#friend-detail` would
  collide with `openProfileSection` (profile.js), which walks the `profileSubtabs`
  NodeList (profile.js:151) for the section toggle
  (profile.js:263-267) and binds its open clicks
  (profile.js:412-416).
- **The pills' CSS is shared** with `.profile-subtab` via
  comma selectors (`.profile-subtab, .friend-subtab { ... }`), including
  the `max-width: 480px` media query's compaction.

### 2. Status filters (chips, no search)

Below each tab there is a group of **status filter chips**. The
set varies by scope and **in movies it matches the personal view**
(`ocio/peliculas.html`, which only offers Todos / Pendiente / Vista):

- **Movies**: Todos + Pendiente + Vista (completed). No Viendo,
  Standby nor Abandonada — same as the personal view (requirement added
  in iteration 2, gonzalitojh's comment of 2026-08-07).
- **Series**: Todos + pendiente + en_curso + completado + standby + abandonado.
- **Books**: Todos + pendiente + en_curso + completado + standby + abandonado.

- Labels per scope:
  - media (movies/series): Pendiente / Viendo / Vista / Standby / Abandonada.
  - book (books): Pendiente / Leyendo / Leído / Standby / Abandonado.
- Own classes `.friend-filters` / `.friend-chip`: `.filter-chips` nor
  `.chip` are not reused because the libraries' global filter logic
  selects them by class and binds clicks with each group's scope
  (app.js:218-227).

### 3. In-memory state and re-render of the active grid

- The state lives in `setupProfile`'s closure:
  `friendData {movies, tv, books}`, `friendFilters {movies:"todos", ...}`,
  `friendActiveTab = "movies"` and `currentFriendName`.
- Opening any friend **resets** the tab to `movies` and filters to
  `todos` (state and DOM chips).
- Data is loaded **once** with `Promise.all` of
  `getItemsOnce(uid, "movie"|"tv"|"book")`; on tab or chip change only the
  **active grid is re-rendered** without re-querying Firestore.
- On tab change the chosen filter is kept in memory until another friend
  is opened (then it is reset).

### 4. Accessibility (ARIA)

- Pills: `role="tablist"` / `role="tab"` / `role="tabpanel"` with
  `aria-selected`, `aria-controls` and `aria-labelledby`.
- Chips: a `role="group"` container with a descriptive `aria-label` per
  panel and buttons with `aria-pressed`.

### 5. Differentiated empty messages

- Category without items → «Nada por aquí todavía.»
- Filter without results → «No hay nada con ese estado.»

### 6. Responsiveness

- `flex-wrap` on pills and chips; relative units (rem); no horizontal
  scroll at 360/768/1280 px (AGENTS.md's rule 2); no
  `overflow-x: hidden` on body/html.

## Rejected alternatives

- **Infinite scroll**: does not solve the underlying problem (browsing the
  friend's whole log) and adds unneeded pagination complexity.
- **Accordion (expand/collapse categories)**: an interaction less direct
  than tabs and worse for viewing two categories in a row; the profile own already
  establishes the sub-tabs pattern.
- **Text search**: the issue explicitly discards it («no hace falta
  búsqueda, pero sí filtros de estados»); besides, friends' logs are
  read-only and the cards already show title/author.
- **Reusing `.filter-chips` / `.chip`**: rejected — they collide with the
  libraries' global filter logic (app.js:218-227 walks
  `.filter-chips` and binds clicks on `.chip`); own classes
  `.friend-filters` / `.friend-chip` are used.
- **Reusing `.profile-subtab` in the friend detail**: rejected —
  `profileSubtabs` (profile.js:151) picks up ALL the `.profile-subtab`;
  `openProfileSection` toggles `is-active`/`aria-selected` on them by
  `data-section` (profile.js:263-267) and binds the section opening
  (profile.js:412-416); injecting friend pills with that class would break
  the section toggle. That is why the friend pills are `.friend-subtab` and
  **share CSS** with `.profile-subtab` via comma selectors (not logic).

## Consequences

### Positive

- Friend detail's vertical scroll reduced to one category.
- Status filters with labels adapted to the scope (media/book) without
  search, as the issue asks.
- In movies only the filters **Todos / Pendiente / Vista** are offered,
  same as the user's personal view: a friend cannot filter
  movies by «Viendo», «Standby» nor «Abandonada», statuses that
  do not exist for movies in this product.
- Zero extra Firestore queries on tab/filter change (the data loads
  once per opened friend).
- Visual coherence with the profile's own view (same pill style) without
  colliding with its logic.
- Full ARIA on pills and chips (tablist/tab/tabpanel, aria-selected,
  aria-pressed).

### Negative / Risks

- The tab/filter state is per closure and is lost on leaving the detail
  (reset on reopening): desired behavior per the issue, but
  it means there is no persistence of the last view.
- The new `.friend-*` classes must be kept away from any future global
  selector to avoid reintroducing collisions.

### Neutral

- `docs/manual-de-usuario.md` updated (section 13.2 Amigos): the view
  changes for the user (tabs and filters), AGENTS.md's rule 3 applies.

### Future improvement

- **Counters on the chips** (items per status): discarded in
  this iteration for simplicity, but the data model and the per-active-grid
  re-render allow it without structural changes.

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **Modified**: `#friend-detail` goes from 3 stacked sections to sub-tabs `role="tablist"` (`.friend-subtab` with `data-friend-tab`) + 3 `role="tabpanel"` panels with per-status filter chips (`.friend-chip` with `data-status`) and their grid (`#friend-movies`, `#friend-tv` —formerly `#friend-series`—, `#friend-books`). **Iteration 2**: the movies panel keeps 3 chips (Todos / Pendiente / Vista), aligned with `ocio/peliculas.html` |
| `js/ui.js` | **Modified**: `renderFriendDetail` and `renderReadOnlyGrid` (private, only used by the former) removed; `renderFriendTab(tabKey, items, onOpen, emptyMessage)` added, rendering a single grid (`#friend-{tabKey}`) with a configurable empty message |
| `js/profile.js` | **Modified**: state in the closure (`friendData`, `friendFilters`, `friendActiveTab`, `currentFriendName`); `openFriend` resets tab/filters and loads the data once; new private functions `renderFriendTab`, `setFriendTab`, `setFriendFilter`; single listeners on `.friend-subtab` and delegation on `.friend-filters` |
| `css/styles.css` | **Modified**: `.friend-subtabs`/`.friend-subtab` share style with `.profile-subtabs`/`.profile-subtab` (comma selectors, including the 480px media query); new `.friend-filters`/`.friend-chip`; dead CSS `.friend-detail__section*` removed (and its light variant) |
| `docs/manual-de-usuario.md` | **Modified**: section 13.2 Amigos — Movies/Series/Books tabs, per-status filters by scope (movies: Todos/Pendiente/Vista in iteration 2), filter keeping across tabs and reset when re-entering a friend |
| `docs/adr-048-friends-view-tabs-filters.md` | **New**: this document |

## Verification

- Manual code review + DevTools at three widths (~360, ~768, ~1280 px):
  `document.documentElement.scrollWidth <= window.innerWidth` must be `true`.
- Iteration 2: in `#friend-panel-movies` there are only 3 `.friend-chip`
  (`todos`, `pendiente`, `completado`); the filtering JS is data-driven
  over the present chips, so it requires no changes.
- Control greps: no `renderFriendDetail`, `renderReadOnlyGrid`,
  `friend-series` nor `.friend-detail__section` in the code (`js/`,
  `index.html`, `css/`); the only remaining mention of
  `.friend-detail__section` is in the historical ADR
  `docs/adr-009-light-mode.md`.

Related issue: #49 — https://github.com/gonzalitojh/Registro-personal/issues/49
