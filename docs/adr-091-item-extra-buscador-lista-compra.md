# ADR-091: An extra item with the catalog's finder and "Add to the shopping list" from the ingredient's profile (issue #249)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #249 asks for two changes:

1. On the **Compra** tab (ADR-076, issue #225), the
   **«Item extra»**
   button must work like adding an ingredient on
   the recipes (issue #240): a
   **dropdown with a search
   for a
   catalog ingredient**, with
   a
   **quantity** and
   a
   **unit of measure**,
   but **without** a category
   selector nor the
   "it is/is not
   a
   cleaning-product"
   checkbox.
2. On the
   **Ingredients** tab,
   when pressing an
   ingredient (the
   detail modal, ADR-089, issue #248) there
   should be an
   **«Añadir a la
   lista de la
   compra»
   button** that unfolds
   a
   window to select
   **only**
   the
   quantity and the
   unit of measure.

Previous state: the extra item's
   form
  (the
  `renderExtraForm` in js/shopping-list.js)
  had a
  **free
  name** `<input>` (a
  maxlength of
  100), a
  **category**
  `<select>` and a
  **"No es comestible (limpieza,
  hogar…)"** checkbox; the item was
  written by hand on
  all the selected weeks. The
  ingredients
  catalog (ADR-089, issue #248)
  stores no "edible" flag: only a name, a photo, a category, supermarkets
  and the package's quantity.

Flow note
  (the
  same exception as
  ADR-083, ADR-085,
  ADR-087, ADR-088,
  ADR-089 and ADR-090):
  the work's base
  is the
  `content/issue-64-seccion-recetas` branch; the work
  branch is created from there and the
  PR goes **also
  to
  `content/issue-64-seccion-recetas`, not to
  `dev`**. The ADR is numbered
  **091** (the number 090 was
  already used by two ADRs of the
  issue #242).

## Decision

1. **The extra item's form with a
   combobox** (the
   `renderExtraForm` in js/shopping-list.js):
   the free
   name, the category
   select and the cleaning
   checkbox disappear; the form keeps
   the
   **recipes' same `.ing-combo` combobox** (issue #240:
   a search
   input + a toggle + a listbox, with
   hidden
   `data-*`s for the
   chosen value) plus the
   **quantity** fields (a
   `#extra-cantidad`, the
   `min="0"`)
   and
   **unit** (a
   `#extra-unit`, normalized with
   the
   `normalizeUnit`). The combobox is reused
   by exporting
   from js/recipes.js the
   `bindIngredienteCombo(combo, { emptyText })`
   and
   the
   `renderIngredienteComboList(combo, emptyText)`,
   with an
   own
   "no
   matches"
   message for the
   purchase that refers to the
   Ingredients
   tab.
   - **The unit of measure as a
     dropdown** (the
     iteration, a comment on the
    issue): `#extra-unit` stops being a
     free-text `<input>` and becomes an
     `<select>` with the exact options the user asked for —
     **g, Kg, mL, L and
     Units** —,
     served
     by the shared
     constant
     `SHOPPING_UNITS` of js/recipes-data.js
     (the same list
     for the ingredient's
     modal, point
     2, with the first
     option
     "g" preselected by the browser). The value is
     normalized as before with the
     `normalizeUnit` before persisting
     (g, kg, ml,
     l, units), so the reading
     does not change and the data stay
     compatible with the existing
     unit
     families (ADR-086).
   - **A category and an edible
     (non-cleaning-product) derived from the catalog**: the item takes
     the chosen
     ingredient's
     `categoriaId`, and
     the
     edible
     (non-cleaning) is
     deduced as a
     `categoriaId !== "hogar"` (the
     "hogar"
     category is the cleaning-products'
     one; the
     catalog does not store the
     flag). Free
     text by itself **does not** select
     anything: the
     `addExtraItem` requires the hidden value to be filled and the
     visible text to match it (the recipes' same validation pattern,
     issue #240), advising that one be chosen from the dropdown.
   - The form's `.shopping-extra-form__hint` beneath
     explains to the user that the
     category comes
     from the ingredient's profile and that if it is not on the
     catalog they must create it on the
     Ingredients
     tab.
2. **A button on the ingredient's profile** (js/recipes.js): the detail
   view of the
   modal (the
   `ingredientDetailHtml`,
   ADR-089)
   gains the
   **«🛒 Añadir a la lista de la compra»** button (the
   `data-ing-shopping`, next to Delete/Edit). Pressing it opens the
   same modal
in **shopping mode** (the
   `openIngredientModal(id, { shopping: true })`)
with the
   new
   `ingredientShoppingHtml` view:
   the ingredient's name in
   **read-only**, the quantity and the unit of measure, and a
   Cancel button (it goes back to the detail) / Add to the
   list button. The window only
   allows those two fields, as the issue asked. The unit of
   measure is likewise a `<select>` with the
   `SHOPPING_UNITS`' values (the
   g, Kg, mL, L, Units) — the issue's comment's iteration —; the styling comes from
   the already-existing `.ingredient-modal__field`
   pattern (the selects
   included, ADR-089), with no new rules.
   - **An injected dependency without an import
   cycle**: recipes.js does not import shopping-list.js
  (which imports recipes.js in turn):
     the modal persists the
     item via a function registered by
     the
     `registerShoppingListAdder(fn)`
     (a
     new export of
     recipes.js), which shopping-list.js calls
     in the setupShoppingList
     with the adder persisting
     on the
     `itemsExtra`. If
     the adder is not registered (a
     defensive case), an error
     toast shows and nothing breaks.
   - **Locking the involuntary closing**:
     like in edit mode, the backdrop/Escape closing stays locked while the
     quantity/unit window is
     open (the new
     `ingredientShoppingMode` flag,
     reset in the
     closeIngredientModal); the
     explicit ✕ and the
     buttons do close.
3. **Shared persistence**: the new
   `persistExtraItem(item, { create })`
   helper into the
   extra item's writes
   on
   **all the selected weeks**
   (the
   `selectedWeeks`) via
   the
   mutations'
   queue (the
   `enqueueMutation` +
   the
   `updateMenuWeek`, the issue #225's
   pattern). Both the extra item's form and the
   ingredient modal's adder use it. The adder **aligns the
   selection
   with the
   menu's active week** if the
   user has not touched the chips yet
   (`if (!userTouchedChips) syncSelectionWithMenu()`):
  that way the item added from the
   profile appears on the week they will see when opening the Compra
   tab.
4. **Themes and responsiveness**
   (AGENTS.md's §2 and §4):
   the combobox inside the extra form takes the
   form's inputs' styles
   (a pill
   with a
   `--ink-raised`/`--paper`,
   a teal focus) with
   grouped overrides for the
   light family (the
   `[data-theme="light"]/[data-theme="white"]`) and pure
   black; the
   `.ing-combo` is the
   `flex: 2 1 180px` on a row with
   the
   `flex-wrap: wrap` and a
   `min-width: 0`
   (at ~360 px the search drops to its line
   and
   quantity +
   unit fit on the second), and the
   `.ing-combo__list` dropdown (absolute,
   z-index 20) is not cut by any ancestor's overflow. AA contrasts in the
   four themes (the hint with
   the
   `--ink-soft`: a
   6.2:1 dark, a
   5.93:1 light).
5. **QA validation**: all the acceptance criteria met;
   a low
  -severity finding fixed in the iteration
   (the recipes' combobox's "no matches" message stayed empty on
   reopening by focus because the
   `emptyText: null` was passed to
   the
   `renderIngredienteComboList`, whose default only applies with an
   `undefined`: the option's parameter becomes
   `{ emptyText }`).
6. **User manual**:
   §8.4 (the extra item's form with a search,
   without the category nor the cleaning
   — they are taken from the
   profile —, added
   onto
   all the selected weeks) and
   §8.5 (the profile's ingredient's
   "Add to the
   shopping list" button, with
   a quantity-and-unit-only window).
7. **PWA**: the bump `20260922 → 20260923` in js/config.js
   (the
   `APP_VERSION`), the index.html (the
   `?v=`) and the
   service-worker.js (`STATIC_ASSETS`); on the unit dropdown's iteration
   (a comment on the
   issue) it gets raised to the
   `20260924`.

## Consequences

- **Positive**: the extra item's
  add always comes from the
  catalog, with the category and edibility
  coherent with its
  profile (the free-entered
  "lavavajillas" name without a
  category ends); adding an ingredient to the
  shopping from its
  profile is direct
  and only asks what the issue wants
  (the quantity
  and the
  unit of the item); the write shares a single
  path (the
  `persistExtraItem`) with the
  mutations'
  queue, with no circular
  dependence between modules.
- **Neutral**: the old already-stored
  extra items
  (with explicit
  `categoriaId` and
  comestible
  flags) keep being read
  and rendered as
  before; the cleaning
  checkbox and the extra form's category
   select
   disappear from the
   UI
   (and from the
   CSS: the
  `.shopping-extra-form__check`
   and
   its rules are removed); the
   quantity's `min="0"` on the
   extra form stays decorative (the
   form is a
   `<div>`, not a
   `<form>`; the shopping modal applies it because it
   uses a
   real `<form>`) — a
   pre-existing
  finding, with no
 regression. On the dropdown's iteration, the unit of
  measure
  moves from
  free
  text to a
   closed
  selection: the
  items that get added
  from now
  on
  always
  carry one of the five normalized
  units (the
  g, kg, ml,
  l,
  units), so the packages' comparison (ADR-086)
  and the
  "name|unit"-keyed aggregation (ADR-086, issue
  #225) become
  more consistent; the
  reading/persistence does not
  change (the same
  `normalizeUnit` over the
  select's
  `.value`). The
  select's
  CSS reuses the extra form's existing pill
  rules (with the
  "select"
  added to the
  base, light and pure
  black grouped
  selectors).
- **Negative**: none known.
  Validated: the
  JS
  syntax, the
  acceptance criteria 1-7 (the
  8, this
  ADR, is documented now), responsiveness at 360 / 768 / 1280 px with
  no
  horizontal
  scroll, four
  theme
  modes with AA
  contrast and a security
  scan without findings
  (all the user
  data go through `escapeHtml` on the
  new interpolations, the
  emptyText included).

Related issue: #249
