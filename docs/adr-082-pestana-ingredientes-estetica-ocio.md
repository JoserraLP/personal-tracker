# ADR-082: Ocio-like aesthetics on the Ingredients tab — toolbar, grouped cards and detail modal (issue #218)

## Status
Accepted

## Date
2026-08-11

## Context

Issue #218 asks to improve the Recipes section's
**«Ingredientes»** tab's display (issue #64) to bring it
aesthetically close to the **Ocio**
tabs' (issue
#118/#208): a top
toolbar with a **manual creation
button**, a **category filter**
(multi-selection, all by default) and **sorting**,
the catalog **split by categories** and
**cards showing only the
name**, with the expanded information in a **modal window** when
pressed.

Previous state (built in ADR-080,
issue #209): the tab showed the
catalog as a **list** (`renderIngredientsCatalog`) with the name, an
**inline select** to change
 the category and a footer
"Used in: …" with links to the recipes. There was no way of adding
ingredients by hand (the catalog filled only from the recipes) nor
of filtering or sorting.

Design's key decisions:

1. **An Ocio-style toolbar**: the `ocio/libros.html` patterns are
   reused (`.library-controls` + a
   `.sort-select`) — a
   «+ Nuevo ingrediente»
   button (`btn--primary`), a
   filter dropdown and a
   sort select
   (Alphabetical A-Z / Z-A,
   Recently added, Most used). The
   filter is a **own
   dropdown with checkboxes**
   (there is no native multiselect pattern with
   a good look):
   a pill button (`aria-expanded`/`aria-haspopup`/`aria-controls`) + a
   panel with "Todas" and one
   checkbox per category (the predefined ones +
   the user's own), closed with click-outside
   and Escape (the
   `.profile-dropdown` pattern
   of `profile.js`).
2. **«Todas» by default**: the filter starts with
   **all the categories selected**; the "Todas"
   checkbox is checked if and only if all
   the visible ones are (predefined
   + own). The
   `ingredientFilterTouched`
   flag prevents the newly loaded
   own categories (an
   async
   subscription) from breaking
   a user-made selection: if
   the filter has not been touched, the
   own ones join the default
   set.
3. **«Sin categoría» is not filterable**:
   ingredients
   without
   a category always
   show (they are the
   incoming bucket which
   gets their category assigned from the
   modal) and
   their
   group goes **last** on the list.
   *(The 2026-08-11
   iteration — see
   «Actualización» at the end: the
   filter applies and colors live, as one
   selects, not on panel close.)*
4. **Grouping by
   categories**:
   the shopping
   list's pattern (`shopping-list.js`): predefined ones
   in their order, personalized ones
   present in the data by
   label's alphabetical order and "Sin
   categoría" last.
5. **Name-only cards**:
   each ingredient is a
   `<button>` `.ingredient-card`
   in an
   `auto-fill` grid
   (the `.library-grid`
   pattern). The expanded information (an
   editable category, the recipes using it,
   delete) lives in a
   **new
   modal**.
6. **An own modal `#ingredient-modal`**: a
   new modal is created following
   `#recipe-modal`'s pattern
   instead
   of
   reusing
   `#item-modal`, which
   manages
   Ocio
   with its own binding in
   `ui.js`/`modal-handlers.js`
   (touching it would be a high
   risk). The
   modal has two
   modes over the
   same frame: **detail** (the
   category with an
   immediate change + toast,
   "Used in N
   recipes" with links opening the recipe
   in
   reading mode, Delete with a
   `confirm`) and
   **manual creation**
   (name
   +
 category,
   with deduplication by
   normalized name).
7. **Sorting**:
   4 modes — Alphabetical A-Z (default),
   Z-A, Recently added (`addedAt`, default
   0) and Most
   used (the
   usage index's count), all with a deterministic tie-break
   (the name, then the id).
8. **Four themes**: all the new elements use
  theme variables with grouped overrides of the
  light family
  (`light`+`white`) and of
  pure
  black (`black`), following
  AGENTS.md
  §4: violet
  `--games` for
  the filter's
  marked
  items with
  `--games-dark`
  in
  pure black,
  surfaces `--paper`→`--ink-raised`
  in
  pure black, etc. The previous list's dead
  CSS is removed (`.ingredient-row*`,
  `.ingredients-catalog__*`).
9. **Responsiveness**:
  the toolbar with
  `flex-wrap`, the
  filter
  panel in
  `position: fixed` with
  lateral margins on mobile
  (≤767px, the
  `.profile-dropdown` pattern) to
  not overflow the
  viewport, the grid with
  `minmax(min(150px, 100%), 1fr)`,
  `overflow-wrap: break-word` on
  cards and titles (AGENTS.md
  §2).

## Decision

1. **HTML** (`index.html`): a static toolbar in
   `#panel-ingredients-tab` (the button
   `#btn-new-ingredient`, the wrapper
   `#ingredients-filter` with
   `#btn-ingredient-filter` +
   `#ingredient-filter-panel` and the
   select
   `#ingredient-sort`) and the
   modal `#ingredient-modal` (backdrop
   + card +
   close + content) after
   `#recipe-modal`. `js/recipes.js` paints the
   panel's checkbox list from
   `INGREDIENT_CATEGORIES` +
   the own labels (a single source of truth, not
   duplicated in HTML).
2. **JS** (`js/recipes.js`): new module state
   (`ingredientSort`, a
   Set
   `activeCategoryFilter` with all by default,
   `ingredientFilterTouched`,
   `ingredientModalCleanup`), the
   helpers
   `getUsageIndex()` / `compareIngredients()` /
   `ingredientFilterCategoryIds()` /
   `ingredientFilterAllChecked()`, a rewritten
   `renderIngredientsCatalog()` (a count +
   groups + the cards' grid + differentiated empty
   states), `renderIngredientFilter()` /
   `updateIngredientFilterLabel()` /
   `syncIngredientFilterAll()` /
   `syncIngredientFilterItems()` (the iteration: a live
   visual mark of each checkbox from
   `activeCategoryFilter`) /
   `closeIngredientFilterPanel()` /
   `setupIngredientFilter()` (the
   toggle +
   click-outside
   + Escape with listener
   cleanup; on
   `change`:
   it updates the
   Set, syncs
   the `is-checked` marks and re-renders
   the catalog immediately
   ), and the
   modal
   `openIngredientModal()` / `closeIngredientModal()` /
   `ingredientDetailHtml()` / `ingredientNewHtml()` /
   `bindIngredientModalHandlers()`
   (an immediate category
   change, links to the recipe
   closing
   the modal first
   — both share
   the z-index —,
   delete with a
   confirm, manual creation
   with normalization and no
   duplicates). `setupRecipes` registers the bindings;
   `openRecipes` closes the
   panel on tab change;
   `resetRecipesData` resets
   sorting/filter and closes the
   modal and the panel.
3. **CSS** (`css/styles.css`): a new
   block
   `/* --- Catálogo de ingredientes (issue #218): estética tipo Ocio --- */`
   with `.ingredients-toolbar`,
   `.ingredients-filter*`,
   `.ingredients-count`, `.ingredient-group*`,
   `.ingredient-grid`,
   `.ingredient-card`, `.ingredient-modal__*`
   and the 4
   themes' overrides (grouped
   light+white and
   black selectors separately). The
   sort select reuses
   `ocio/ocio.css`'s
   `.sort-select` (already
   loaded in `index.html` and
   with its own Overrides; precedent:
   `.empty-state`).
4. **User manual**: §8.5 rewritten with the
   new
   behavior (the toolbar, the
   multi-selection
   filter, sorting,
   cards, the
   detail modal, manual creation and
   deletion).
5. **PWA**: the version bumps
   `20260910 → 20260911` with
   `scripts/bump-version.sh`.
## Consequences

- **Positive**: the «Ingredientes» tab reaches Ocio's visual level; the
  catalog gains management tools (manual creation, a filter,
  sorting, delete) without losing any previous functionality (the
  category's change and "Used in" stay in the modal); the cards
  declutter the list; the own modal isolates the change
  from Ocio's logic (`#item-modal` intact). After the
  iteration, the filter gives **immediate feedback**: the
  checkbox colors and the list updates at the
  moment of check/uncheck, without depending on
  the panel's closing.
- **Neutral**: the category change and the recipes query now
  require one more click (the modal) than
  before (inline controls); category-less ingredients
  cannot be hidden with the filter (
  a deliberate decision, documented in this ADR).
- **Negative**: none known. All the new elements use
  existing theme variables and patterns already validated in the four
  themes (the profile's dropdown, the recipe form's chips, the shopping
  list's groups); QA validated functionality, responsiveness (360 / 768 /
  1280 px with no horizontal scroll) and the four theme modes; the
  security scan found no findings (all the user data go through
  `escapeHtml`).

### The 2026-08-11 update (iteration): a live filter

Issue #218's comment pointed out that, although the filter
worked, "the marked ones get colored on closing" and one did not know
what had been selected: the `change`
handler only synced the "Todas"
mark; the individual items did not toggle their
`is-checked` until reopening the panel (and on mobile the panel covered
the catalog, so the filter seemed to apply on closing).
`syncIngredientFilterItems()` is
added, which toggles the `is-checked`
class (and
the hidden
input's state) of all the checkboxes from
`activeCategoryFilter` on each `change`, alongside
the already-existing catalog re-render. Result: the selection colors and the
filter applies **as one selects**; closing the panel only
hides it, it applies no
pending changes. There are no CSS changes (the
`is-checked` classes were already styled in the four themes) nor
HTML markup changes; the manual's §8.5 updates.

Related issue: #218
