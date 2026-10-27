# ADR-089: Recipe ingredients picked from the catalog — a search combobox and creation from the form (issue #240)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #240 asks that in a recipe's **edit** view the
ingredients **not be freely writable** nor allow
choosing their **category**:

1. Adding an ingredient should have a **dropdown
   with a search** to pick from the
   ingredients list's entries
  (the ingredients
   catalog,
   `users/{uid}/ingredients`).
2. There should be a **button to create a
   new
   one**, which unfolds the
   same
   ingredient-creation window
   as
   the
   Ingredients
   tab.

Previous state: each ingredient row of
  the
  form (the
  `ingredientRowHtml` in js/recipes.js)
  was a
  free-text
  `input` with
  an
  autocomplete
  `<datalist>` (the
  user could
  write anything), plus a
  row-own
  category
  `<select>`. The
  catalog filled
  only on save (the
  `syncIngredientsCatalog`, an
  upsert by
  normalized
  name,
  issue #224). ADR-088/ADR-087
  introduced the
  recipe window's
  reading mode, which does not touch the
  edit form.

Flow note (the same exception as
 ADR-083, ADR-085,
  ADR-087 and
  ADR-088): the
  work's
  base
  is the
  `style/issue-236-ventana-recetas-lectura` branch; the work
  branch is
  created from there and the
  PR goes
  **also to
  `content/issue-64-seccion-recetas`, not to
  `dev`**. The
  ADR is numbered
  **089**.

## Decision

1. **A search
   combobox over the
   catalog**: each ingredient
  row of
  the
  form becomes
  an
  `.ing-combo`: an
  `input` (the
  `combobox`
  role) that on focus or while writing opens
  an
  `.ing-combo__list` dropdown (the
  `listbox`
  role) with the
  catalog's options filtered
  live
  (a
  normalized-name match,
  without
  accents/uppercases) and sorted alphabetically. Only the
  **catalog's options** assign
  the
  selection: free
  text not matching an option
  selects nothing (the
  row is ignored on save and a
  toast lists
  the
  discarded
  names). The
  `<datalist id="recipe-ingredients-datalist">`
  of index.html is
  removed (it was an
  autocomplete
   allowing free text).
2. **The category is no longer edited in the
   recipe**: the
   row's `<select .ing-categoria>`
   disappears. The
   category is taken from the
   catalog on save
   (the `ingredientCategoriaDe`:
   it finds the ingredient by
   normalized name; if missing, e.g. because
   it was removed from the catalog, it keeps
   the category stored in the recipe). The
   catalog's profile (the
   Ingredients
   tab,
   ADR-085/#218)
   stays
   the
   only place where it changes.
3. **The "New
   ingredient" button**: on the
   Ingredients
  fieldset, next to
   "+ Ingrediente", a
   second
   button opening the
   existing
  ingredient-creation modal (`openIngredientModal(null)`,
   the
   same window
  as the
   Ingredients
   tab's "+ Nuevo
   ingrediente"). When the creation saves, the
  `onCreated({ nombre, categoriaId })` adds a
   row to the
   recipe with that ingredient already chosen and
   focuses the
   quantity. The
   ingredient modal overlaps the
   recipe's
  without z-index changes (both
   share
   the
   `z-index: 50` and the
   ingredient's comes
  after in the
   DOM); the
   focus
   traps are independent and
   closing
   returns
  focus
   to
  the
   button.
4. **Selection and
   keyboard**: clicking an option or pressing Enter selects
   (Enter
   picks the
   active option or the first); the
   ↑/↓ arrows
   navigate with
   the
   `.is-active`;
   Escape
   reverts to
   the
   selected value; the
   dropdown closes on leaving the
   field (a
   120-ms-delayed
   blur
   to not run
   ahead of
   an
   option's
   click, whose
   `mousedown` with
   a
   `preventDefault` keeps
   focus). The
   chosen value is
   stored on
   the
  hidden `.ing-nombre-valor` /
   `.ing-categoria-valor`, which
   `readRecipeFromForm` reads on save. Each combo is
   bound to the
   modal's
  render and to
   each new
   row's
   insertion (`bindIngredientCombo`),
   with no global
   listeners.
5. **Legacy data**: if
  the
  recipe already had an ingredient no
  longer in the
  catalog (it may have been removed
  from
  it without
  touching the
  recipes), the
  row shows it and keeps it selectable in the
  dropdown so the
  data are not lost on save.
6. **Responsiveness**
   (AGENTS.md §2): the
   row goes
   from 5 columns to 4
   (the
   `1.4fr 0.7fr 0.9fr auto`:
   combo, quantity, unit,
   ✕); on mobile (≤
   560 px) the
   combo takes the whole
   row (a
   `grid-column: 1 / -1`)
   so the
   dropdown has
   the
   full
   width and
   the
   options (a
   `overflow-wrap: break-word`, the
   `max-height: 200px`
   with
   scroll)
   never overflow the
   viewport.
7. **Four theme modes**
   (AGENTS.md §4): the
   dropdown uses
   a
   `--paper`/`--ink`
   surface (an
   elevated background over
   the
   form's
   `--paper-dim`) and in pure
   black
   the
   `--ink-raised`/`--paper` with
   a
   `--paper-alpha-20`
   border
   and
   the
   hover
   `--paper-alpha-10`
   (grouped
   selectors
   with
   a
   single
   source
   of truth); the generic hover/is-active uses
  the
  `--teal-alpha-18`, enough
   for the
   light
   family's modes.
8. **User manual**: §8.1 describes the ingredients as a
   catalog
   choice with
   a
   search, the
   "New
   ingredient"
   button (the
   same
   window
   as the
   Ingredients
   tab) and that the
   category is managed
   from the
   catalog.
9. **PWA**: the version bumps `20260919 → 20260920` in
   `js/config.js` (the
   `APP_VERSION`), `index.html` (the
   `?v=` of
   styles and
   `app.js`) and
   `service-worker.js` (`STATIC_ASSETS`).

## Consequences

- **Positive**: the ingredient's name always comes from the
  catalog (clean data consistent
  with the
  shopping
  list and the normalized-name
  dedupes); the
  recipe's category follows the
  catalog in real
  time; creating an
  ingredient on the
  fly from
  the
  recipe is a flow with
  the
  already-known
  window; badly-written free
  text is not
  stored as a
  ghost
  ingredient.
- **Neutral**: the `syncIngredientsCatalog` on
   save becomes
   a
  safeguard (with a
  catalog-only selection it adds nothing new); the
  Ingredients
  tab's manual creation is identical
  (the
  `onCreated`
  is
  optional); the
  PWA bumps
  `20260919 → 20260920`.
- **Negative**: none known. The plan is to validate
  the
  acceptance criteria (no
  free
  text, a
  dropdown with a
  search, a creation button with the catalog's window, the
  category not
  editable in the
  recipe), responsiveness at
  360 / 768 / 1280 px with no horizontal scroll, the
  four theme modes with AA contrast and the security scan
  without findings (all the
  user
  data go through `escapeHtml`, including the
  options'
  `data-nombre`/`data-categoria`s).

## The iteration (2026-08-13, QA findings)

The QA review validated the acceptance criteria and pointed out four
low
-severity points, fixed in the iteration:

1. **AA contrast in the Dark mode**: the
   toggle's ▾ glyph (previously a
   `--ink-soft`, ≈
   2.4:1 over
   the
   `--paper-dim`) and
   the
   message "Sin coincidencias…" (previously
   a
   `--ink-soft` ≈
   2.8:1 over
   the
   `--paper`)</
   move to the
   full
  `--ink` on the
   base
   rule, with the
   override
   `[data-theme="black"] .ing-combo__list .ing-combo__empty`
   to
   the
   `--paper` (in pure
   black
   the
   `--ink` is
   black over
   a
   dark
   surface). CSS
   comments document the
   ratios
   (AGENTS.md
   §4.4).
2. **Enter without selectable options**: if the
   dropdown only shows the
   «No matches» message (an
   `aria-disabled`
   option), Enter no longer tries to select: it
   closes the
   dropdown (before it
   required
   Escape + Enter).
3. **The visible-text / selection coherence on save**: if the
   user types over a selection (free
   text), the
   row is discarded with the
   warning
   toast (previously the
   previous selection was silently
   kept). A
   valid selection requires the
   visible
   normalized text to match the
   row's
   hidden value.

Validation: the acceptance criteria re-verify without regression;
AA contrast of the toggle and of the empty message on the
four themes;
`node --check js/recipes.js`
OK;
the security scan without findings
(all the user data go through `escapeHtml`).

Related issue: #240
