# ADR-062: Mark items as watched while searching the catalog (issue #115)

## Status
Accepted (partially revised by issue #177 — see «Revisión: textos por tipo»)

## Date
2026-08-09

## Context

Issue #115 asks to be able to **mark an item as watched directly at the
moment of searching it** in the global search's catalog: «Marcar ítems
vistos al buscar». Until now, adding a catalog result (series,
movie or book) implied **two steps**:

1. Pressing **«Añadir»** on the result row (`handleAdd`, in
   `js/search.js`), which creates the item in a pending state
   (not watched/read).
2. Marking the item as watched/read afterwards from the row's
   **quick actions** (`js/quick-actions.js`:
   `quickMarkMovie` / `quickMarkBook` / `quickMarkSeries`, issue #136's
   undo pattern) or opening its profile.

The add-then-mark intermediate step is what the issue asks to remove: a
button on each catalog result row that creates it **already
as watched** and opens the rating right away.

The implementation is **validated (QA PASS)** on this branch
(`feature/issue-115-marcar-visto-al-buscar`), with a later robustness fix
(TMDB cover `null` and the button's final state in multi-cover
books); the user manual was updated in the same task
(`docs/manual-de-usuario.md` §7.1, AGENTS.md's rule 3). This ADR
documents the decision retrospectively, like the recent ones
(ADR-059, ADR-060, ADR-061).

Related issue: #115 — https://github.com/gonzalitojh/Registro-personal/issues/115

## Decision

Add the **«Marcar visto»** button alongside **«Añadir»** on each result row
of the global search's catalog. The button creates the item
directly with a **completed** status (watched/read today) and opens the
**rating right away**, with a **«Deshacer»** that removes the newly
created item. The button is **not** added to the preview modal.

### 1. Button on the dropdown row (`js/global-search.js`)

In `renderExternalSection()` it renders next to «Añadir»:

```html
<button type="button" class="global-search__item-seen btn btn--small" data-seen-index="${index}">Marcar visto</button>
```

- **Only if `!added`** (the same predicate as «Añadir»: `ids.has(externalId)`
  for movies/series and `isBookAlreadyAdded` for books): an item already
  in the log does not offer the button.
- The listener uses `e.stopPropagation()` (it does not open the
  preview), reads `data-seen-index` and, during the flow, **disables
  both buttons of the row** (`btn` and the «Añadir» of
  `btn.closest(".global-search__item")`)
  with the text «Marcando…» to avoid double creations. On promise
  resolution: if `ok` → `disabled` + «Visto»; if not → restores «Marcar
  visto» and re-enables «Añadir» (with a `!btn.isConnected` guard for
  the case where the Firestore snapshot already re-rendered the row).
- **Keyboard improvement**: the guard `if (e.target !== el) return;` is
  added to the row's `keydown` — with focus on a button,
  Enter/Space no longer triggers `navigateTo` (the preview), but the
  button receives its own native activation.

### 2. `handleAddSeen` in `js/search.js`: one flow per type

New export `handleAddSeen(item, btn, ctx)` → `Promise<boolean>`
(`true` = added and flow completed; `false` = aborted, errored or
undone), with private internal helpers:

- **Movies**: `getMovieDetails` for `communityRating` and
  `releaseDate` (non-blocking: a failure does not abort the creation),
  a draft with `status: "completado"`, `watchLog: [todayISO()]` and
  `awaitingRelease: false`, and a **cover fallback**
  (`draft.coverUrl = draft.coverUrl || item.coverUrl`) because TMDB may
  return `poster_path` `null` (the QA review's fix).
- **Books** (`doAddBookSeen`): the same skeleton as `doAddBook` but with
  `status: "completado"` and `readLog: [{ startedAt: todayISO(), finishedAt: todayISO() }]`
  (read today); it keeps Open Library's **synopsis backfill**
  (`getOpenLibraryDescription` for `"/works/..."` IDs) and, in books with
  **multi-cover or multi-synopsis**, keeps the
  `ui.openBookConfirmModal` modal with `onConfirm: doAddBookSeen` (the
  same predicate as `handleAdd`). On that path the promise is not
  awaited: the **button's final state is set by `doAddBookSeen`**
  («Visto» if `ok`, `restoreSeenBtn` if not), because the dropdown's
  listener does not consume the promise.
- **Series**: see point 3.

### 3. Series: all seasons and the whole's rating

- **Fail-closed gate**: `getTvSeasonsMeta(item.externalId)` in
  `try/catch`; if it returns no seasons, the toast
  «No se pudo marcar «…»: no se pudieron obtener sus temporadas.» shows and
  `false` is returned **with no half-done creation**.
- With seasons: `watched = markAllSeasonsWatched({}, seasonsMeta, todayISO())`
  and `progress = computeProgress(seasonsMeta, watched)`; the draft carries
  the full `watched`, `status: "completado"`, `nextEpisode: null`,
  `firstWatchedAt`/`lastWatchedAt` taken from `progress`,
  `timesCompleted: 0`, `history: []` and `awaitingRelease: false`.
- `getTvExtraDetails` (non-blocking) provides `communityRating` and
  `seasonAirDates`.
- **The series rating as a WHOLE**: `openSeenRating` is called
  without `episodeLabel` (unlike the episode rating modal),
  and uses `getTvExtraDetails`' `communityRating`.

### 4. Undo: `deleteItem` over `addItem`'s `DocumentReference`

`openSeenRating(uid, type, ref, opts)` reuses `js/quick-actions.js`'s
`maybeQuickItemRating` pattern (issue #21): it opens
`openRatingModal` with `communityLabel: "TMDB"` and `initialRating: null`,
`onSave: updateItem(uid, type, ref.id, { rating })` and
`onUndo: deleteItem(uid, type, ref.id)`.

Since `addItem` (`js/db.js`) returns `addDoc`'s
`DocumentReference`, the **onUndo can delete the newly created item**: if the
user presses «Deshacer» in the stars window, the result is
`RATING_MODAL_UNDONE` and `openSeenRating` shows the toast
«Marcado deshecho.» and returns `false` (the button is restored). Issue
#136's undo pattern (in quick-actions the previous state is restored;
here, being a new creation, the undo is a full delete).
`openSeenRating` never throws: if the window cannot open, the already
persisted creation stays intact.

### 5. Not-released confirmations

- **Movies**: search results do not carry `releaseDate`, so the one from
  `getMovieDetails` is used (with a `null` fallback, which the
  message treats as "no official date") via
  `unreleasedConfirmMessage({ type: "movie", manual: false, releaseDate, title })`
  and `window.confirm`.
- **Series**: `seasonsMeta.filter((s) => isUnreleasedDate(s.airDate))`
  (per-season date, ADR-025); if there are unreleased seasons it
  asks: ««…» · N de M temporadas aún no están estrenadas. ¿Marcarlas
  todas igualmente como vistas?». Canceling restores the button and adds
  nothing.

### 6. `markAllSeasonsWatched` in `js/tv-progress.js`

New **pure** helper next to `setSeasonWatched`:

```js
export function markAllSeasonsWatched(watched, seasonsMeta, date) {
  return seasonsMeta.reduce(
    (acc, s) => setSeasonWatched(acc, s.seasonNumber, s.episodeCount, true, date),
    watched || {}
  );
}
```

It marks ALL seasons as watched by applying `setSeasonWatched`
with `allWatched: true` per season, without mutating the state.

### 7. CSS (`css/styles.css`)

`.global-search__item-seen`: the same compact skeleton as «Añadir»
(`font-size: 0.72rem`, `padding: 3px 10px`, `white-space: nowrap`,
`flex-shrink: 0`, `border-radius: 999px`, `font-weight: 600`) but in a
**teal outline** style (`background: transparent`,
`border: 1px solid var(--teal-reel)`, `color: var(--teal-reel)`) to
differentiate it from the solid «Añadir»; an inverted `:hover` (a
`--teal-reel` background, `--paper` text) and `:disabled` with
`opacity: 0.55` and `cursor: default`. No layout change: it coexists with
the same row's «Añadir» button.

### 8. User manual (§7.1)

`docs/manual-de-usuario.md` §7.1 (Buscar en el catálogo) documents the
button: movies are marked as watched with today's date, series with
every episode of all their seasons and books as read; the rating opens
right away (a single one for the series, as a whole); «Deshacer» removes
the title from the log; and the web asks before continuing if the movie
is not released or the series has unaired seasons — AGENTS.md's rule
3.

### 9. PWA bump `20260834` → `20260835`

The PR touches versioned assets, so the **one bump per PR** practice is
applied (ADR-049/059/061) via `scripts/bump-version.sh`:
`js/config.js` (`APP_VERSION = '20260835'`), `index.html` (`?v=` ×3:
`styles.css`, `ocio.css`, `app.js`) and `service-worker.js` (`?v=` ×6 in
`STATIC_ASSETS`: `styles.css`, `ocio.css`, `app.js`, `series.html`,
`peliculas.html`, `libros.html`).

## Rejected alternatives

- **The «Marcar visto» button also in the preview modal**:
  rejected — the modal is read-only (ADR-030) and would duplicate the
  action unnecessarily; the issue asks for the direct access in the
  results list, and the creation with rating already covers the rest.
- **Per-gender text variants** («Marcar vista» for movies,
  «Marcar leído» for books): rejected originally — a uniform
  «Marcar visto» text for the three types. **Revised by issue #177**:
  the button's text and its states now depend on the item type
  (`SEEN_ACTION_LABELS` in `js/constants.js`): «Marcar visto»/«Visto»
  for movies and series, «Marcar leído»/«Leído» for books and
  «Marcar jugado»/«Jugado» for video games. Gender (watched-f vs.
  watched-m) is still not distinguished; the term is.
- **Per-episode confirmation for series**: rejected — the goal is to mark
  the whole series at once; asking episode by episode contradicts the
  one-click flow and the manual would explain it as a special case. The
  confirmation exists, but at the unaired-seasons level.
- **Allowing a half-done creation if `getTvSeasonsMeta` fails** (create
  the series and mark the seasons after): rejected — the fail-closed gate
  avoids series with an incoherent `watched` and the button is
  restored leaving a clean state; the user can retry.
- **`timesCompleted: 1` on series creation**: rejected — it is the
  first watch; `timesCompleted: 0` + `history: []` with real
  `firstWatchedAt`/`lastWatchedAt` leave the history correct for
  the existing re-completion pattern (ADR-015).

## Consequences

### Positive

- **One click instead of two steps**: creation + mark as watched/read +
  rating right away, exactly what issue #115 asks.
- **Undo with no leftovers**: being a new creation, «Deshacer» deletes the
  whole item via `addItem`'s `DocumentReference` (issue #136's
  pattern); no pending creation nor half-restored state remains.
- **Series with a coherent state**: full `watched`, `nextEpisode:
  null`, `awaitingRelease: false`, `timesCompleted: 0`, `history: []` —
  the series enters "finished" with the history ready for
  re-completions.
- **Visual consistency**: the same skeleton as «Añadir», differentiated
  with a teal outline; the inverted hover and the `:disabled` with
  opacity communicate the button's state.
- **Keyboard accessibility**: the `e.target !== el` guard makes
  Enter/Space on the button activate the button (before it always opened
  the preview); the `disabled` states during the flow avoid double
  actions.
- **Informative toasts per type**: «añadida y marcada como vista»
  (movie/series), «añadido y marcado como leído» (book), «Marcado
  deshecho.» (undo).
- **Manual up to date** (§7.1) and no data model changes:
  it reuses the existing `watchLog`/`readLog`/`watched`/`status`.

### Negative / Risks

- **Massive marking of series**: the user can mark as watched a
  series they have not watched (all seasons at once); mitigated by the
  unaired-seasons confirmation and, above all, by the immediate undo
  («Deshacer» removes the item). Accepted by the issue's design.
- **Native `window.confirm`** for the not-released confirmations:
  the same pattern as the rest of the app (quick-actions), with its
  foreign look. No own dialog is introduced.
- **TMDB dependence for series**: if `getTvSeasonsMeta` fails the
  action aborts with a toast (fail-closed) and there is no alternative
  one-click path; the user can add normally and mark later.
- **Extra steps in multi-cover books**: the cover/synopsis selection
  modal interrupts the "one click" fluidity; necessary to
  not lose the choice flow inherited from `handleAdd`.
- **Asymmetry in the books' multi-cover path**: `handleAddSeen`
  returns `undefined` there (the promise is not awaited and the button's
  final state is set by `doAddBookSeen`); documented in the code and in
  this ADR.

### Neutral

- **Routine PWA bump**: `20260834` → `20260835`, one bump per PR
  (ADR-049/059/061), applied with `scripts/bump-version.sh`.
- **`handleAddSeen` does not touch `handleAdd`'s pending state**: both
  flows coexist; «Añadir» remains the normal creation path and the
  «Marcar visto» button only appears on non-added items.
- **Data model intact**: there are no new fields nor collections in
  Firestore; only the existing ones are reused with concrete values.

## Created/modified files

| File | Change |
|---------|--------|
| `js/search.js` | **Modified**: new section «Alta directa como visto desde el catálogo (issue #115)» with `handleAddSeen(item, btn, ctx)` (export, `Promise<boolean>`) and the private helpers `openSeenRating(uid, type, ref, opts)` (openRatingModal with onSave `updateItem({rating})` and onUndo `deleteItem(ref.id)`, toasts per type and «Marcado deshecho.» on `RATING_MODAL_UNDONE`) and `doAddBookSeen(item, btn, ctx, choices)` (completed book with `readLog` of today, Open Library backfill, button's final state in multi-cover); imports `getTvSeasonsMeta`, `markAllSeasonsWatched`, `computeProgress` and `openRatingModal`/`RATING_MODAL_UNDONE` |
| `js/global-search.js` | **Modified**: rendering of the `.global-search__item-seen btn btn--small` button with `data-seen-index` only if `!added`; a listener with `e.stopPropagation()` that disables both buttons of the row during the flow («Marcando…») and restores them if `!ok` («Visto» if ok); the guard `if (e.target !== el) return;` in the row's `keydown` so Enter/Space activates the buttons (issue #115); import of `handleAddSeen` |
| `js/tv-progress.js` | **Modified**: new pure helper `markAllSeasonsWatched(watched, seasonsMeta, date)` (a reduce of `setSeasonWatched` with `allWatched: true` per season) |
| `css/styles.css` | **Modified**: `.global-search__item-seen` rules (teal outline: transparent background, 1px border and `--teal-reel` text, weight 600, radius 999px; inverted `:hover`; `:disabled` opacity 0.55 and `cursor: default`) |
| `docs/manual-de-usuario.md` | **Modified**: §7.1 (Buscar en el catálogo) adds the «Marcar visto» bullet (creation as watched with today's date, complete series, rating right away, undo that removes, not-released confirmations) — AGENTS.md's rule 3 |
| `js/config.js` | **Modified**: `APP_VERSION` `20260834` → `20260835` |
| `index.html` | **Modified**: bump `?v=20260834` → `?v=20260835` (×3: `styles.css`, `ocio.css`, `app.js`) |
| `service-worker.js` | **Modified**: bump `?v=20260834` → `?v=20260835` on the 6 versioned assets of `STATIC_ASSETS` (via `scripts/bump-version.sh`) |
| `docs/adr-062-marcar-visto-al-buscar.md` | **New**: this document |

Related issue: #115 — https://github.com/gonzalitojh/Registro-personal/issues/115

## Revisión: per-type texts (issue #177)

Issue #177 asks that each item type use its own term for the
"completed" state: video games must say **«jugado»** and never
"visto" nor another variant. The catalog button's uniform-text decision
is revised:

- **`js/constants.js`**: new `SEEN_ACTION_LABELS` and
  `seenActionLabels(type)` with `action` («Marcar visto»/«Marcar
  leído»/«Marcar jugado») and `done` («Visto»/«Leído»/«Jugado») per
  scope (`media`/`book`/`game`).
- **`js/global-search.js`**: the catalog's `.global-search__item-seen`
  button renders with `seenActionLabels(item.type).action` and the
  flow's final/restoration state uses `labels.done` / `labels.action`.
- **`js/search.js`**: `restoreSeenBtn(btn, type)` uses
  `seenActionLabels(type).action`; the books' multi-cover path sets
  `seenActionLabels("book").done`.
- **Manual**: §7.2 and §8.1 document the per-type term.
- **PWA bump** `20260902` → `20260903`.

The success toasts were already per type («añadido y marcado como
jugado», «añadida y marcada como vista», «añadido y marcado como
leído») and are untouched. The collection's statuses (`STATUS_LABELS`)
already distinguished per type and are not affected either.

Related issue: #177 — https://github.com/gonzalitojh/Registro-personal/issues/177
