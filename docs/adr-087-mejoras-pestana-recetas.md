# ADR-087: Recipes tab improvements — clickable cards, an information window with Edit/Delete and multi-selection filters (issue #234)

## Status
Accepted

## Date
2026-08-12

## Context

Issue #234 asks to redesign the interaction with the Recipes
section's «Recetas» tab's recipes (issue #64), in line with what
ADR-082/ADR-085 did with the Ingredients tab:

1. **Removing the "Ver", "Editar" and "Delete" buttons**
   from the
   recipe cards.
2. **The whole
   card is clickable**: pressing
   anywhere
   opens
   the
   recipe's **information window** in
   **read-only mode**.
3. The
   window **has no
   "Cerrar"
   button at the end**
   (the top ✕ already serves that), but
   **it does have "Editar" and "Delete" buttons**.
4. In
   **edit mode**, pressing outside the window
   **does not close it**
   (avoiding losing
   what was written);
   in
   **read mode** it can be closed
   by pressing outside.
5. Adding
   **two multi-selection
   dropdown filters** above the
   list:
   one of
   **allergens** and
   another of
   **meal type**, with
   the
   same pattern ("Todas"
   + checkable tags,
   live
   filtering)
  as the
   Ingredients tab's categories
   filter.

Previous state: the cards `recipeCardHtml`
  showed carried
  three buttons (  `data-action="view|edit|delete"`); the recipe modal opened
   always in edit mode;
   the window in the read-only flows
   (global search, "Usada in") reused that same modal; only the
   header's search existed as a means of filtering recipes.
   always
   in edit mode;
   the
   window in
   read-only
   flows
   (global
   search, "Used
   in")
   reused the
   same
   modal; only
   the header's
   search existed
  as a
   means of
   filtering
  recipes.

Flow note (the same exception as
 ADR-083 and
 ADR-085): the work's base
 is the
 `content/issue-64-seccion-recetas` branch; the work
 branch is created from there and the
 PR goes
 **also to that branch, not to
 `dev`**. The
 ADR is numbered
 **087** (086 is
 already taken
 by the
 shopping
 list).

## Decision

1. **Cards
   without
   buttons,
   fully clickable**: `recipeCardHtml`
   stops
   emitting
   `.recipe-card__actions`
   and
   the
   three
   buttons; the
   card becomes
   a
   `role="button"` with
   `tabindex="0"` and
   `data-recipe-id`. A
   single
   delegated
   listener on
   `#recipes-list` (click,
   and
   the
   Enter/Espacio keydown with
   `preventDefault`) opens
   the
   `openRecipeModal(recipe, { readOnly: true })` — there are
   no interactive elements inside the
   card, so the
   delegation does not conflict
   with anything. Aesthetics:
   a
   `cursor: pointer`,
   hover with
   `--shadow-pop` and
   a
   `:focus-visible` with
   `--ochre-spine` (the
   Recipes tab's ochre
   accent, the
   previous
   `.recipe-card:focus-visible` pattern).
2. **The read-only information window**: `recipeModalHtml`
   detects the
   read mode and
   renders the
   fields with
   `disabled`, the
   buttons `[data-recipe-edit]`
   (Editar) and
   `[data-recipe-delete]` (Delete)
   and
   **without
   a
   "Cerrar" button** at
   the
   end. `bindRecipeModalHandlers` wires:
   **Editar** re-renders the
   same window in edit mode (the
   `openRecipeModal(recipe)` within
   the
   same
   call, without
   closing nor
   hiding
   the
   modal, releasing the
   previous
   `trapFocus` via the
   `modalCleanup()` and
   returning
   focus
   to
   the
   `#recipe-nombre`); **Delete** goes
   through
   the
   `deleteRecipeFlow` (now
   returning
   `true/false`)
   and
   only
   closes
   the
   window if the
   delete
   succeeded.
3. **An outside-closing
   and Escape per mode**: the
   backdrop's
   listener and
   the
   Escape key's only
   act if
   `modalReadOnly` is
   truthy; in edit
   mode the
   explicit
   exits
   are
   the
   top ✕ and
   "Cancelar". In
   reading, the
   ✕ and
   the
   outside
   click
   close
   like before
   (the
   focus
   returns
   to
   the
   origin card, the
   `_previousActiveElement` preserved by
   the
   `wasHidden`).
4. **Allergen and type multi-selection filters**: two
   dropdowns in
   `.recipes-toolbar`
   with
   the
   Ingredients'
   categories-filter pattern (a
   pill
   `__btn` with
   `aria-expanded`/`aria-controls`, a
   `__panel` with
   an
   `__all` + an
   `__item`
   per
   label,
   a
   hidden
   checkbox and
   the
   `is-checked`
   state on the
   label):
   - Live
     state: `activeAlergenoFilter` and
     `activeTipoFilter`
     (Sets
     of
     ids), plus
     the
     `recipeFilterTouched` (a
     flag replicating
     the
     `ingredientFilterTouched`: it prevents
     the
     late
     loading
     of the
     own
     tags from overwriting
     the
     user's selection; the
     tags'
     subscription only
     syncs
     the
     filters if they have not been touched).
   - Render: `renderRecipeFilterPanel(scope)` paints the
     panel from the
     `ALERGEN_TAGS`/`MEAL_TYPES` constants
     + the
     own
     labels; `updateRecipeFilterLabel` puts
     "Todos los alérgenos"/"Todos los
     tipos" or
     "N alérgenos"/"N tipos"; the
     `syncRecipeFilterAll/Items`
     keep
     coherence without re-rendering
     the
     panel.
   - Filtering: `renderRecipesList` applies
     `recipeMatchesAlergenoFilter && recipeMatchesTipoFilter`
     with the
     "**at least
     one** tag checked in each filter; recipes
     **without
     tags** of that type
     always
     show" semantics (the
     same
     criterion as the
     category-less ingredients). An
     empty-state with
     a
     filter-adjustment
     message.
   - Behavior: the panels close when changing
     tab (a
     new
     tab
     scroll in
     `resetRecipesData`, which also
     resets
     selections and
     the
     `recipeFilterTouched`); Escape and
     the
     outside
     click
     close
     the
     open
     panel; on mobile (≤767px)
     the
     panel anchors to the
     viewport (a
     `position: fixed`) to
     not overflow the
     screen (AGENTS.md
     §2).
5. **The filter's aesthetics (issue #218/ADR-082)**: pills
     with
     `--ink-raised`/`--paper`
     (the
     light
     family's overrides to
     `--white`/`--ink`), a
     panel with
     `--paper`/`--ink`,
     items with
     hover
     `--paper-dim`, the
     `is-checked`
     mark with
     **`--ochre-spine-dark`** +
     a
     `--white` text (≈6.2:1 in Dark/Light/White; in pure black
     the
     light
     variant `#c99a4e` with
     an
     almost-black
     text ≈7.4:1 — a
     comment documenting the
     why, AGENTS.md §4.4). In
     **pure black**, a
     `[data-theme="black"] .recipes-filter__*`
     block mirroring the
     Ingredients': a
     panel with
     `--ink-raised`/`--paper` and
     a
     `--paper-alpha-20` border, items with
     a
     `--paper` text, a
     hover
     `--paper-alpha-10`
     and
     the
     `.is-checked:hover`
     keeping
     the
     ochre (the
     override's specificity prevents the
     generic
     hover from leaving
     unreadable
     text). The filter's
     `:focus-visible`s use
     **ochre** (Recipes' accent), in a
     block separate from
     the
     Ingredients filter's teal.
6. **User manual**: §8.1 reflects the new
     behavior (a
     pressable card, a
     reading with
     Edit/Delete, a
     closing via ✕ and
     outside-only-in-reading,
     multi-selection filters with the
     "at least one" semantics).
7. **PWA**: the version bumps `20260914 → 20260915` in `js/config.js`
   (the `APP_VERSION`), `index.html` (the
   `?v=` of
   styles and
   `app.js`) and
   `service-worker.js` (`STATIC_ASSETS`).

## Consequences

- **Positive**: the card ends up clean (a single
  gesture opens the
  recipe, as in Ingredients); the read-mode
  information window clearly shows its
  two
  actions (Edit/Delete) without
  a redundant "Cerrar"
  button; the
  edit mode's
  protection against accidental
  closure avoids losing forms; the multi-selection filters make the
  tab much more usable. when
  there are
  many recipes, with the
  same
  mechanics as the
  already-known Ingredients
  filter; "Editar" from
  reading keeps
  focus and the visual state continuously.
- **Neutral**: the global
  search and the "Used in"
  modal reuse the same read modal
  (now with
  Edit/Delete, coherent); recipes without
  tags always pass the filters (a deliberate decision,
  like the category-less ingredients); the PWA bumps
  `20260914 → 20260915`.
- **Negative**: pressing outside
  the
  window in read mode closes it — whoever wants
  to
  keep
  reading
  without
  interacting must avoid hitting
  the
  background (the
  behavior
  requested by the
  issue); no
  other one known. QA validated
  the 9 acceptance criteria (cards
  without
  buttons,
  the
  click and keyboard opening, a
  reading without
  a
  "Cerrar" with
  Edit/Delete,
  the
  outside closing only in reading, the
  live
  multi-selection filters with a
  reset and an
  empty state), responsiveness at
  360 / 768 / 1280 px with no horizontal scroll and the
  four theme modes without dead points or insufficient contrasts
  (the ochre mark AA, ≥6.2:1; pure black's
  hover 7.4:1); the security scan found no findings (all the
  user data go through
  `escapeHtml`).

Related issue: #234
