# ADR-052: «Deshacer» button in the rating window

## Status
Accepted

## Date
August 2026

## Context

Since ADR-022 (issue #21), when marking a movie, a
book or a series episode as watched/read the **pop-up rating
window** opens and the marking is persisted **before** the window opens.
If the user had marked an item by mistake, the path to reverse it went
through closing the window and finding the corresponding option: remove
the watch from the profile's history, un-mark the episode or
correct the reading's end date. Those were extra steps, barely
discoverable and with the risk of leaving incorrect data registered.

Issue #136 asks for a **«Deshacer»** button inside the rating
window itself: cancel the just-made marking **without leaving it**.
Behavioral requirements:

- The window shows «Deshacer» when marking a movie, when finishing a
  book or when marking a series episode.
- The undo restores the persisted previous state (watchLog
  /readLog/watched), the previous `status` and the previous
  `awaitingRelease` flag when applicable, and leaves the underlying UI
  coherent without reloading: the profile modal, or the series' episode
  row/banner/counter.
- External closings (✕, backdrop, Escape, «Ahora no») keep
  discarding **without undoing**.
- If the undo fails (e.g. no network), the web warns with an error
  toast and the window stays open.

Related issue: #136 — https://github.com/gonzalitojh/Registro-personal/issues/136

## Decision

Implement the «Deshacer» button as the **first button of the rating
window's action row** (`btn--outline` style, same visual language as
«Ahora no») with a **snapshot approach**: each caller captures the
item's previous state **BEFORE** persisting the marking and the
`onUndo` restores it with `ctx.updateItem` + in-memory mutation.
The marking's persistence helpers are not reused for the undo:
the movie's `persist()` forces `awaitingRelease:false` and the
recomputed status, so the undo is a direct `updateItem` restoring
the captured fields literally.

### 1. Expanded contract of `openRatingModal`

`js/rating-modal.js` accepts two new options:

```
openRatingModal({ ..., onUndo, undoLabel = "Deshacer" })
  => Promise<number|"undone"|null>
```

- `opts.onUndo` (optional): `async () => {}` that cancels the just-made
  marking. If present, the `#rm-undo` button renders as the **first
  element** of `.rating-modal__actions` (before
  «Ahora no» and «Guardar valoración»), with `btn btn--outline` and the
  `undoLabel` text escaped with `escapeHtml`.
- The promise now resolves with the **saved rating (1-5)**, with the
  exported constant **`RATING_MODAL_UNDONE` (`"undone")** if the
  user undid the marking, or with `null` if dismissed. It still never
  rejects: `onSave` and `onUndo` failures are notified with a robust
  toast (`String(err && err.message ? err.message : err)`, without
  "undefined") and the window stays open to retry.
- **`undoInProgress` guard on closing**: while the undo runs,
  `close()` ignores any external closing (✕, backdrop, Escape,
  «Ahora no») so the promise does not resolve with `null` mid
  restoration. Double click is impossible: `disabled` on «Deshacer» and
  «Guardar valoración» during the operation + the `settled` guard + the
  `undoInProgress` guard.

### 2. Prior snapshot in the 4 callers (detail modal)

The windows open from ADR-022's same wrappers, which now
accept `opts` and return `true` if the result was
`RATING_MODAL_UNDONE`:

`modal-handlers.js`:

- **Movie** (`onAddWatch`): captures `prevWatchLog`, `prevStatus` and
  `prevAwaitingRelease` before `persist(addWatch(...))`. `onUndo`
  restores with `updateItem({ watchLog, status, awaitingRelease })`
  + in-memory mutation. The status is restored **literally** to the
  captured one (not recomputed from the log) in case the user had it in a
  manual state (QA's resource, LOW findings).
- **Book** (`onFinishReading`): captures `prevReadLog` and `prevStatus`
  before the `persist(finishReading(...))`; `onUndo` restores
  `readLog` and `status` («Leyendo» goes back to «Leyendo», a previous
  pause/abandonment is kept).
- **Series, episode** (`onSetEpisodeDate`): captures the previous entry
  (`prevEntry` via `normalizeEntry`), `wasWatched`,
  `prevAwaitingRelease` and `prevStatus`. It only opens the window on the
  not-watched → watched transition (same criterion as ADR-022). `onUndo`
  **un-marks** with `setEpisodeDate(item.watched, s, e, null)` via
  `persistWatched` (removes the date and the rating set in the window),
  and afterwards restores the previous `awaitingRelease` and `status` with
  `updateItem`. If the result is undo, `onSetEpisodeDate` returns the
  **recomputed progress of the reverted state**
  (`computeProgress(seasonsMeta, item.watched)`) so `ui.js`
  paints the banner with the real state — without changing the signature.

`quick-actions.js`:

- `maybeQuickItemRating` / `maybeQuickEpisodeRating` equivalents; the
  rest of the snapshots live in each type's quick actions (below).

### 3. Undo in quick actions and conditional toasts

`js/quick-actions.js`:

- **`quickMarkMovie`**: captures `prevWatchLog`, `prevAwaitingRelease`,
  `prevStatus` before persisting; same restoration `onUndo`.
- **`quickMarkBook`**: only offers the window on finishing
  (`isReading`); captures `prevReadLog` and `prevStatus`.
- **`quickMarkTv`**: captures `prevWatched`, `prevAwaitingRelease`,
  `prevStatus` and `prevNextEpisodeAirDate`. `onUndo` restores the
  **whole payload** of the previous progress: `watched`, literal
  `status`, `nextEpisode`/`firstWatchedAt`/`lastWatchedAt` recomputed from
  `prevWatched` with `computeProgress`, `awaitingRelease` and the
  previous `nextEpisodeAirDate` (or `null` if it did not exist), so the
  next episode's «not released» notice also goes back to its
  state.
- **Conditional toasts**: each quick action shows the marking toast
  only if there was **no** undo:
  - Movie/book: `«Marcado deshecho.»` instead of ««Título» marcada
    como vista.» / ««Título» terminado.».
  - Episode: «Desmarcado.» instead of «T2E5 marcado como visto.».

### 4. UI repainting without reloading (`js/ui.js`)

- **Episode (series detail modal)**: after `onSetEpisodeDate`, the
  row is painted by **deriving from `item.watched`** (normalized entry),
  not from the pressed checkbox: checkbox state, `is-watched` class,
  enabled date/value and the rating's stars (hidden if not watched,
  active per `entry.rating`). Thus an «Undo» from the window is
  reflected in the checkbox, the season counter
  (`updateSeasonCount`) and the banner (`updateBanner` with the
  reverted returned progress).
- **Movie/book (profile modal)**: the already existing `rerender()`
  (after `onAddWatch` / `onFinishReading`) runs after the window
  closes — and since `onUndo` mutates `item` in memory before
  resolving, the re-rendered modal shows the reverted state.

### 5. Responsiveness: `flex-wrap` on `.rating-modal__actions`

The row goes from 2 to **3 buttons** (Deshacer · Ahora no · Guardar
valoración). In `ocio/ocio.css`, `.rating-modal__actions` adds
`flex-wrap: wrap` so the 3 buttons do not overflow on mobile
(~360 px), meeting AGENTS.md's mandatory responsiveness
(no horizontal scroll).

## Rejected alternatives

- **Undoing by `watchLog` index (`removeWatch` blindly)**:
  rejected — `addWatch` does `.sort()` on the array before
  persisting, so the newly added entry's position is not
  deterministic; the snapshot of the whole log restores exactly the
  previous state (including logs with identical dates and intermediate
  re-watches).
- **Reusing `persist()` for the movie's undo**: rejected —
  the movie's `persist()` forces `awaitingRelease:false` after
  `statusFromWatchLog`, so an undone "not released" item would not go
  back to being unreleased nor would manual states be kept. The
  undo is a direct `updateItem` with the three/ two captured fields.
- **Changing `onSetEpisodeDate`'s signature to `{ progress, undone }`**:
  rejected — it would alter the contract for all the callback's consumers
  (checkbox, date, «Marcar todo»); returning the progress of the undo
  branch (`computeProgress(seasonsMeta, item.watched)`) keeps the
  `Promise<progress>` signature and `ui.js` does not change its
  painting.
- **Blocking the external closing by disabling ✕/backdrop/elements**:
  rejected — it would change the modal's look and focus during the
  operation; the `undoInProgress` guard inside `close()` solves the
  same problem (ignoring the external closings) without touching the UI.
- **«Deshacer» button at the end of the action row**: rejected —
  as the first button of `.rating-modal__actions` it sits next to «Ahora
  no» (both `btn--outline`, "cancellation" family) and far from the
  primary button «Guardar valoración», and it reads as the answer to the
  window's implicit question ("did you mark it? did you undo it?").

## Consequences

### Positive
- The user reverses the mistaken marking **without leaving the context**:
  one gesture inside the already-open window, without searching histories.
- The reversal's persistence is a direct `updateItem` restoring the
  **previous literal state** (logs, `status` and `awaitingRelease`/
  `nextEpisodeAirDate`), including manual states (pause/abandonment).
- The UI stays coherent without reloading: the profile modal re-renders
  the existing way and the episode's row paints by deriving from the
  real state (checkbox, date and stars included).
- The external closings (✕, backdrop, Escape, «Ahora no») keep their
  discard semantics; the rating's save flow is
  unaffected.
- No schema nor Firebase rules changes.

### Negative
- **One or two extra `updateItem`s per undo** (only when the
  user presses «Deshacer», not in the normal flow): in the detail modal's
  episode undo, the first `updateItem` un-marks
  (with `awaitingRelease:false` and recomputed status) and the
  following one(s) restore the previous flag/status: **transient window
  in Firestore** with an intermediate state visible to friends (Friends
  section). **LOW** finding of the security scan, already documented in a
  code comment: cosmetic, idempotent and self-mending, not blocking.
- `openRatingModal`'s promise contract grows to
  `number | "undone" | null`: existing consumers must compare against
  `RATING_MODAL_UNDONE` (the 4 new callers already do; the rest keep
  interpreting `null` and the number as before). Documented in the
  module's JSDoc.

### Neutral
- `ui.js` only changes the episode row's painting
  (derived from `item.watched` instead of the pressed checkbox); the rest
  of the renders are untouched.
- `.rating-modal__actions` adds `flex-wrap: wrap`: it affects the
  window's layout on narrow screens, not other components.
- User manual updated (AGENTS.md's rule 3 — change visible
  to the user): the «Deshacer» button documented in sections 4.3,
  5.3, 6.3, 10 and 11, and in Frequent problems.
- No schema nor Firebase Security Rules changes.

## Created/modified files

| File | Change |
|---------|--------|
| `js/rating-modal.js` | **Modified**: exported constant `RATING_MODAL_UNDONE ("undone")`; `opts.onUndo`/`opts.undoLabel` in `openRatingModal` with `#rm-undo` button (first button, `btn--outline`); promise `number\|"undone"\|null`; `undoInProgress` guard in `close()`; robust toasts for save/undo; contract's JSDoc updated |
| `js/modal-handlers.js` | **Modified**: `maybeOpenItemRatingWindow`/`maybeOpenEpisodeRatingWindow` with `opts` (they return `result === RATING_MODAL_UNDONE`); previous snapshots in `onAddWatch` (movie), `onFinishReading` (book) and `onSetEpisodeDate` (series: un-marks with `setEpisodeDate(null)`, restores `awaitingRelease`/`status`; returns `computeProgress` of the reverted state if there was an undo) |
| `js/quick-actions.js` | **Modified**: previous snapshots in `quickMarkMovie`, `quickMarkBook` and `quickMarkTv` (full payload: `watched`, `status`, `nextEpisode`, dates, `awaitingRelease`, previous `nextEpisodeAirDate` or `null`); conditional toasts («Marcado deshecho.» / «Desmarcado.») based on `RATING_MODAL_UNDONE` |
| `js/ui.js` | **Modified**: episode row painted by deriving from `item.watched` (check/stars/date) to reflect the undo; season counter and banner updated with the progress (reverted if there was an undo) |
| `ocio/ocio.css` | **Modified**: `.rating-modal__actions` adds `flex-wrap: wrap` (3 buttons with no overflow at ~360 px) |
| `docs/manual-de-usuario.md` | **Modified**: the «Deshacer» button documented in 4.3 (episodes), 5.3 (movies), 6.3 (books), 10 (rating window), 11 (quick actions, toasts) and in 18 (frequent problems) |
| `docs/adr-052-undo-rating-window.md` | **New**: this document |
| `tasks/task-issue-136.json` | Task file of the task (plan, QA validation, security scan LOW, acceptance criteria and the `issue` block with issue #136) |

Related issue: #136 — https://github.com/gonzalitojh/Registro-personal/issues/136
