# ADR-056: Automatic re-search on the active catalog and cover fallback in the global search (issue #149)

## Status
Accepted

## Date
2026-08-09

## Context

Issue #149 («Múltiple búsqueda en catálogo») reports two bugs in the
global search (`js/global-search.js`):

1. **Bug 1 — "stuck" catalog**: when searching in the catalog (e.g.
   movies), clearing the text to search something else and typing a new
   query, the catalog section stays **hung on "Buscando en el
   catálogo…"** and the type button (Series/Movie/
   Book) stays marked, even though nothing is being searched anymore. The
   issue's diagnosis: `performSearch()` does not reset `activeGroup` when the
   query is empty or < 2 characters, and when typing a new query with
   an active group, `renderResults()` shows the loading state without
   calling `runExternalSearch()` again for the new query (the cache
   `externalCache[group].query` does not match the new query). The
   issue proposed two options: unmark the catalog on clearing, or
   wait 1-2 seconds without input (debounce) and re-search the already
   selected catalog.
2. **Bug 2 — 403 errors in the console**: collection covers stored with
   `coverUrl` (e.g. URLs from CDNs that block
   hotlinking, like `fbcdn.net`) fail to load with 403 (Forbidden) and there is
   no fallback replacing the image with the placeholder,
   generating console errors. The same can happen with friend
   avatars.

Related issue: #149 — https://github.com/gonzalitojh/personal-tracker/issues/149

## Decision

### 1. Bug 1 — unmark on clearing + automatic re-search of the active catalog

In `performSearch()` (the 200 ms-debounced entry point for
input changes) two changes are made:

- **When clearing the text (empty query or < 2 characters)**:
  `activeGroup = null` is assigned **before** calling `renderHint()`. It is
  enough to visually unmark the type button because
  `renderTypeButtons()` marks the `is-active` class by comparing each
  group against `activeGroup`; when re-rendering the hint, the three buttons
  go back to unpressed and the user chooses the catalog type again.
- **When typing a new query (>= 2 characters) with an active catalog**:
  if the current query **has no state** in that group,
  `runExternalSearch(group, trimmed)` is automatically relaunched and an
  explicit `return` is done. `runExternalSearch()` does its own
  `renderResults()` (first shows «Buscando en el catálogo…» via
  `externalSectionLoadingHtml()` and then the result); the `return`
  avoids running the final `renderResults(collectionResults(trimmed),
  trimmed)` of `performSearch()` and rendering twice.

Thus **the issue's two proposed options are combined** (unmark on
clearing + automatic re-search while continuing to type), instead of
adding a 1-2-second debounce: the existing 200 ms
debounce is enough and does not delay the catalog's response.

**Why in `performSearch()` and not in `renderResults()`**:
`renderResults()` is a pure rendering function with several callers
(`runExternalSearch`, `refreshExternalResults`, `handleTypeClick`,
`performSearch`); putting the relaunch logic there would create
recursion (`runExternalSearch` → `renderResults` → `runExternalSearch`
→ …) and fire searches in flows that are not user input.
Instead, `performSearch()` is the only entry point for text changes
(debounced), it already invalidates searches in progress
(`searchSeq++`) and knows the input's current value.

**Why the three guards** (it only relaunches if none holds):

- `sameQueryInFlight` (`inFlight[group] && externalQuery[group] ===
  trimmed`): if a search is already in flight for that exact query,
  relaunching would duplicate the API call (the `searchSeq` mechanism
  would discard it, but it would be wasted work).
- `cachedForQuery` (`externalCache[group] && externalCache[group].query
  === trimmed`): if there is a valid cache for that exact query, the
  section already renders from cache in `renderResults()`; relaunching
  would hit the API unnecessarily.
- `erroredForQuery` (`externalError[group] && externalError[group].query
  === trimmed`): if that query's last search failed, the
  automatic relaunch on every keystroke would spam the API with
  retries; the error section shows anyway (rendered by
  `renderResults()`) and the user can retry explicitly
  by pressing the type button again (`handleTypeClick()` relaunches
  when there is no valid cache).

Issue #82's **single selection** is respected: only the pressed group's
catalog section shows, and the state (loading/error/cache) is
kept per group so one can return without re-searching.

### 2. Bug 2 — cover and avatar fallback with an "error" listener in capture phase

One `error` listener is registered once, in `setupGlobalSearch()`, in
**CAPTURE phase** over `#global-search-results` (the dropdown's
persistent container):

- When any descendant `<img>` fails to load
  (403/404 from blocked hotlinking, network…), its `src` is replaced with
  `ui.PLACEHOLDER_COVER` (the fixed "Sin imagen" data URI of `ui.js`) if the
  image is an `HTMLImageElement` and has the class
  `.global-search__item-cover` (collection covers) or
  `.global-search__friend-avatar` (friend avatars) — the only two
  image classes the dropdown renders.
- **Anti-loop guard**: if `img.src` is already `ui.PLACEHOLDER_COVER`, it is
  not reassigned (`return`). Reassigning `src` fires a new load; without
  the guard, a repeated failure would enter an infinite loop of
  error → reassignment → error.

**Why `capture: true`**: media elements' (`<img>`, `<video>`…) `error`
event **does not bubble**, so a bubble-phase listener on the container
would never fire. In capture phase, the event does pass through the
container on its way from the root to the target, so the errors of
**any** descendant image are captured,
**including future renders** injected with `innerHTML` (the container
persists and the listener is not re-registered per render — the same
delegation pattern the type buttons' click already uses).

## Considerations

- **The fallback replaces the image, it does not erase the console's
  history**: the 403 errors printed before the replacement do not
  disappear from the log; new ones are avoided (the browser does not log
  the placeholder data URI's error, which always loads).
- **Coverage bounded to the dropdown**: the listener only acts on the
  two classes of `#global-search-results`. Covers with 403 outside the
  dropdown (e.g. the detail modal) are out of issue #149's
  scope (they already shows a placeholder only if the URL is missing at
  the source, via `safeCoverUrl()`/`coverUrl || PLACEHOLDER_COVER`).
- **More API calls while continuing to type with an active catalog**:
  each new query (debounced 200 ms) fires an external search.
  Before, the flow hung; now it actually searches — it is the
  behavior requested by the issue, and the guards bound it to really new
  queries.
- **Visible change for the user**: AGENTS.md's rule 3 applies —
  `docs/manual-de-usuario.md` is updated in the same task (section
  7.1), unlike ADR-054/055 (internal CI changes).

## Rejected alternatives

- **1-2-second debounce to re-search the active catalog**
  (issue's option 2): rejected as a substitute — the existing 200 ms
  debounce already batches typing; a long debounce would delay
  the catalog's response without contributing anything, and does not solve the
  bug of the marked button on clearing. Option 1 is kept (unmark on
  clearing) and the immediate re-search is added with the current debounce.
- **`error` listener in bubble phase on the container**:
  rejected — unviable: `error` does not bubble, it would never fire.
- **Inline `onerror` attribute per image or per-render listener**:
  rejected — it would force re-registering listeners on every
  `innerHTML`/re-render (cost and leak risk) or mixing logic into
  the templates; the persistent single capture listener also covers
  future renders.

## Consequences

### Positive

- **End of the "stuck" catalog**: when clearing the text, the type button
  unmarks and the three go back to unpressed; while continuing to type
  with an active catalog, the search relaunches automatically in that
  same catalog (no more hanging on "Buscando…").
- **No 403 errors in the console**: collection covers and friend
  avatars that fail (blocked hotlinking, e.g. `fbcdn.net`) are replaced
  by the "Sin imagen" image, and the result
  stays functional (navigation, «Añadir», preview).
- **A single permanent listener**: capture delegation covers
  all future renders with zero per-render cost.
- **Anti-duplicate guards**: the API is not called for queries already in
  flight, cached or errored; there are also no automatic in-loop
  retries over a failed query.
- **Issue #82 intact**: single selection of the pressed group's catalog
  and state (loading/error/cache) kept per group.
- **User manual up to date**: section 7.1 documents the new
  behavior (unmarking on clearing, automatic re-search and
  replacement of broken covers) — AGENTS.md's rule 3 met in the
  same task.

### Negative / Risks

- **More traffic to the catalog API**: while continuing to type with an
  active catalog, each new query fires an external search (the previous
  flow did not even search). Accepted: it is the behavior requested by
  the issue; the guards avoid duplicates for the same query.
- **No automatic retry over a query with an error**: if a query's last
  search failed, retyping that same query does not relaunch the search
  (`erroredForQuery` guard). Mitigation: the
  user can retry by pressing the type button again, which
  always relaunches when there is no valid cache.
- **The fallback's coverage is limited to the dropdown**: images with 403
  outside `#global-search-results` keep having no replacement (out of
  #149's scope).

### Neutral

- **No changes to the existing interaction**: keyboard navigation,
  type buttons, pagination (cap 5), preview and manual creation are
  untouched (issue's AC4).
- **Per-group state unchanged**: closing the dropdown still clears
  all the external state (`closeGlobalSearch()`); the per-group
  cache still allows returning to a catalog without re-searching.

## Created/modified files

| File | Change |
|---------|--------|
| `js/global-search.js` | **Modified**: `performSearch()` — `activeGroup = null` when clearing the query (< 2 characters) before `renderHint()`; automatic relaunch of `runExternalSearch(group, trimmed)` with an explicit `return` if the query (>= 2 characters) has no state in the active group (guards `sameQueryInFlight` / `cachedForQuery` / `erroredForQuery`); new `error` event listener in capture phase over `#global-search-results` replacing failed `.global-search__item-cover` and `.global-search__friend-avatar` images with `ui.PLACEHOLDER_COVER`, with the anti-loop guard (`img.src === ui.PLACEHOLDER_COVER` → `return`) |
| `docs/manual-de-usuario.md` | **Modified**: section 7.1 — when clearing the text the chosen catalog unmarks and the type button must be pressed again; while continuing to type with an already-chosen catalog the search repeats automatically in that same catalog; covers that cannot load are automatically replaced by the «Sin imagen» image (AGENTS.md's rule 3) |
| `docs/adr-056-buscador-catalogo-rebusqueda-y-fallback-portadas.md` | **New**: this document |

Related issue: #149 — https://github.com/gonzalitojh/personal-tracker/issues/149
