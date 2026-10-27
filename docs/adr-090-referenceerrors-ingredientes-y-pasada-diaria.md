# ADR-090: Fix of two ReferenceErrors — a broken ingredient modal and an aborted daily check (issue #243)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #243 reports two console
errors that break
 independent
 functions of the
 web:

1. **`recipes.js:912 Uncaught ReferenceError: edit is not defined at
   openIngredientModal`** — when
   pressing
   "Add ingredient" (the
   Ingredients
   tab's
   button) or
   **any
   catalog ingredient**, the
   modal does not open. The
   root cause: a
   **merge
   regression**. The
   merge
   `e30f073` (the
   issue #240 branch,
   ADR-089) resolved the
   `openIngredientModal`
   conflict by
   keeping
   issue #240's
   signature
   (`{ onCreated = null }`) but
   leaving in
   the
   body references to
   issue #232's
   `edit` option (ADR-088): the
   `ingredientEditMode = edit;`
   and the
   `if (!ingredient || edit)`
   guard remained present without an
  `edit` in
  scope, and the conditional render branch (the
   `edit ? ingredientEditHtml(...) :
   ingredientDetailHtml(...)`)
   was lost
   (it always
   went through the
   `ingredientDetailHtml`). Issue #232
   (an
   ADR-088 ingredient window)
   had added the
  modal's edit
   mode; the
  issue #240
   (ADR-089)
   added the
   recipe-form's
   `onCreated` of the other
   (creation). Both options
   coexist on the
   same
   signature and the merge broke them.
2. **`daily-check.js:440 ReferenceError: getItemsByGroup is not
   defined at
   checkForUpdates`** — the
   daily check
   failed entirely: the
   error fired on the
   video games block and aborted the whole
  run, including the
  `lastReleaseCheckAt`
   stamping (the next
  run retried the next
  day with the same
  failure). The
   root cause: issue #178
   (lazy
   loading, ADR-069) replaced
   in the
   `daily-check.js` the
   destructuring and the reads by
   `getItemsByGroup` with one-off reads via
   the
   `getItemsOnce`
   for movies/tv/books, but the video
   games block (issue
   #175, the release
   notice, ADR-071) stayed calling
   the
   `getItemsByGroup("games")`, a
   helper that no longer exists in
   scope since
   that change.

Flow note (the
 same exception as
 ADR-083, ADR-085,
 ADR-087, ADR-088
 and ADR-089):
 the work's base
 is the
 `content/issue-64-seccion-recetas` branch;
 the work branch
 (the
 `wip/issue-243`) is created from there and the
 PR goes
 **also to that branch,
 not to
 the
 `dev`**. The
 ADR is numbered
 **090** (the
 highest existing was the
 089).

## Decision

### 1. The ingredient modal: restoring the
 `edit` option
 (js/recipes.js)

- **The signature**: the
   `openIngredientModal(id, { edit = false, onCreated = null } = {})`
   — the
   `edit` is restored with its
   default
   value
   `false`, alongside
   the
   issue #240's
   `onCreated`. By default the
   detail opens
   in reading mode (issue #232); with an
   `edit:` true it opens directly to
   the edit view.
   The
   `openIngredientModal(ingredient.id, { edit: true })`
   call of the
   catalog
   card (issue
   #232's "✏️ Editar"
   row) works again.
- **The conditional render**: the
   `content.innerHTML = ingredient ? (edit ?
   ingredientEditHtml(ingredient) :
   ingredientDetailHtml(ingredient)) :
   ingredientNewHtml()`
   — the edition
   branch lost on the merge is restored.
- **The focus guard**: the
   `if (!ingredient || edit)` is active again: on the manual high and
   entering
   edition the focus goes directly to the
  `#ing-modal-nombre` input on the second
  rAF (after the trapFocus's, which
  focuses
  the ✕).
- **The code
  documentation**: the
   function's
   JSDoc updates
   to describe
   both
   parameters and the issues
   #232/#240 that introduced them.

### 2. The daily check:
the video games via the
 `getItemsOnce` (js/daily-check.js)

- A
   `getItemsOnce(user.uid, "game")`
   is added to the one-off reads' `Promise.all`
   (already containing movie/tv/book since
   issue #178), as the
   fourth
  `allGames` entry.
- The release-notice block
   (issue #175) goes
   from
   the
   `getItemsByGroup("games")`
   to the
   `allGames.filter((g) => !g.manual)`,
  with the same
  manual-games filter and the same fail-open pattern
  (a write error does not
   abort the run).
- The video games **do not refresh metadata** on the run (IGDB is not
   queried, ADR-067/ADR-071's same rate-limit
  restriction): they only
   participate in the release notice comparing the
   `releaseDate`
   with the current date. The code comment is corrected
   to reflect it
   (it said «the video games do not participate in the
daily run»).

## Consequences

- **Positive**: the Ingredients tab's
  buttons work again ("Add
  ingredient" opens the empty creation form; pressing an
  ingredient opens its detail
   in reading mode and
   the "✏️ Editar" opens the edition form, issue #232's
  behaviors); the
   recipe-form's
  add
  (the
  issue #240's
  `onCreated`) stays
  intact; the daily check completes its
  run without
  errors and stamps the
  `lastReleaseCheckAt` again; the video
  games keep
  generating
  the release
  notice (issue
  #175) without querying IGDB.
- **Neutral**: the daily run now makes an extra
  Firestore read
  (the
  `games`) that it did not before, in line with issue #178's
  one-off-reads
  pattern; without a PWA
  bump (the
  `daily-check.js` change does not
  affect the UI's precached
  assets).
- **Negative**: none
  known. QA validated the
  (without
  ReferenceErrors on the console when pressing "Add ingredient" or
  any
  ingredient, a modal in edit mode
  with existing
  data
  and empty
  on creation, a complete daily check
  without errors) and the security scan finished in PASS;
  a
  `node --check`
  of
  the
  `js/recipes.js` and the
  `js/daily-check.js`
  OK.

## References

- Issue #232 (an
  ADR-088 ingredient window): the ingredient modal's
  edit mode, the origin of the
  `edit` option.
- Issue #240 (ADR-089): the ingredient high's
  `onCreated` from the
   recipe form, the origin of the
   signature that survived the merge.
- Issue #178 (ADR-069): per-tab lazy loading,
  the origin of the
  `getItemsOnce` in the
  `daily-check.js`.
- Issue #175 (ADR-071): the video games' release notice in the
  daily
  run, the block
  left calling the
  `getItemsByGroup`.

Related issue: #243 — https://github.com/gonzalitojh/Registro-personal/issues/243
