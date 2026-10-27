# ADR-085: Ingredients tab improvements — original spelling, supermarkets, package quantity, category icons and a fixed A-Z sorting (issue #224)

## Status
Accepted

## Date
2026-08-11

## Context

Issue #224 asks for four improvements on the Recipes
section's **«Ingredientes»** tab
(issue #64):

1. **Keeping the original spelling**: store and show the
   ingredients exactly as written, respecting accents and
   capitalization.
2. **An expanded profile**: on adding or viewing
   an ingredient, show
   optional fields — **supermarkets** where
   one can buy
   it (with color labels matching
   each
   chain:
   Lidl, Aldi, Mercadona, Día, Carrefour
   and
   El
   Corte
   Inglés) and the
   **package's quantity** (a
   number
   +
   unit:
   g, Kg, mL, L, units).
3. **An icon next to the title** of each catalog category.
4. **Removing the sort selector** from the
   toolbar.

Previous state (built in
 ADR-080, issue #209, and ADR-082, issue
 #218): the
   tab showed the
   catalog as
   **cards grouped
  by
   categories** with a
   **toolbar** of a
   manual
   creation button, a
   **category
   filter**
   (multi-select,
   all by
   default) and
   a
   **sort
   select** (`#ingredient-sort`, the
   4 modes: Alphabetical A-Z by
  default,
   Z-A, Recently
   added and
   Most
   used). **The
   manual
   creation normalized the
  name** before
  storing
  it
   (no accents,
   lowercased,
   via
   `normalizeIngredientName`), so the
  user-written
   spelling
  was
  lost. The
  detail modal only allowed editing the
   **category**
   (with an
  immediate
  save); the
  creation one, name
  +
   category.

Flow note: the work's base
 is the
 `content/issue-64-seccion-recetas` branch; the work
 branch is
 created from there and the
 PR goes
 **also to that branch, not to
 `dev`** — a
 one-off exception to AGENTS.md §1's
 PRs-against-`dev` rule, explicitly requested by the user in the issue,
 like in ADR-083. Also, this issue's
 ADR gets
 numbered
 **085** (not
 084) because the sibling branch
 `style/issue-221-pestana-lista-compra` (over the
 same
 base) already takes the number 084 with
 `docs/adr-084-lista-compra-estetica-ocio.md`.

Key decisions:

1. **The original
   spelling in the
   catalog,
   dedup
lication
   intact**: the
   ingredient document (the `users/{uid}/ingredients`
  collection) stores the
   **name
   exactly as written** (with accents and
  capitals), both in the manual
   creation and in the auto-fill from recipes
   (`syncIngredientsCatalog` persists
   `ing.nombre.trim()`). **Deduplication** (manual
   creation and
   `syncIngredientsCatalog`) and the
   **aggregation**
   (recipes using the
  ingredient and
   the
   shopping
  list) **keep using
   `normalizeIngredientName`**
   (a
   slug: no accents,
   lowercased): the
   catalog keeps the
   **first written
  spelling** and
  retries with another
   spelling (other
   capitals, without
  accents) do not duplicate.
2. **New optional
   fields in the
   document**:
   `supermercados`
  (a `string[]` with the
  `SUPERMARKETS`
  constant's ids:
   `lidl`,
  `aldi`,
  `mercadona`,
  `dia`,
  `carrefour`,
  `el_corte_ingles`),
   `paqueteCantidad` (a `number|null`) and
  `paqueteUnidad` (a
   `string`:
   `""`, `g`, `Kg`, `mL`, `L`, `units`). They are
   optional: old documents without them render empty. In
  `db.js`, `addIngredient` expands (fields only
   persisted when defined) and
   `updateIngredientCategory` is
   replaced by a
   **generic**
   `updateIngredient(uid, id, fields)`
  (partially updating `updateDoc` +
   `updatedAt`).
3. **The modal's UI**: the
   **«Supermercados»** block is
   **selection chips**
   (a hidden checkbox +
   an `is-checked` state on the label, the
   `.recipe-form__chip`
   pattern) and
   the
   **«Cantidad del paquete»** a
   row with
   a
   `number` input +
   select
   (`—`, g, Kg, mL, L, units), the
  same
   ids
   in creation and in the
  detail. In the
   **detail** the
  saving is
   **immediate**
   on change (the
   category's change pattern), with
   validation (the
   quantity
   `>= 0`;
   empty →
   `null`; invalid
  values reverted); in
   **creation**
   only the visual mark changes and
   everything is
  collected on the
  submit.
4. **Brand colors hardcoded on purpose** (AGENTS.md
  §4.4): the
  checked
   chips and
   the
   labels use each
  chain's
   corporate
   color, identical in all
  4 theme
  modes, with
   a
   verified
  AA contrast:
   Lidl `#0050AA`
  with
   a
   white
   text,
   Aldi `#002B5C`
  white,
   Mercadona `#FFCB05` (its
  brand
  yellow)
  with
   a
   black
   text,
   Día `#A50F26` (a
  brand
  red darkened
  for
  AA contrast)
  white,
   Carrefour `#004E9F`
  white
   and
  El
  Corte
  Inglés `#00543F`
  white. Only the
   **unchecked**
  chips use
  theme
  variables (and thus need an
  override in pure
  black).
5. **Category
   icons**: each
   catalog
  group carries an
   **emoji
  icon** (`aria-hidden`) next to the
  title: the 12 predefined ones with
   an
   own
  icon in
   `INGREDIENT_CATEGORIES`
  (🍎🥩🐟🥛🌾🧂🌿🍿🧼☕❄️🗂️), the
   **custom** ones with
  🏷️ (`CUSTOM_CATEGORY_ICON`) and
   **"Sin
   categoría"** with
  🧺 (`UNCATEGORIZED_ICON`). Emoji was chosen for
   the app's precedent (the
  global
  search's "friends" group
  keeps its 👤, issue
  #134) and
   the
   assets' zero cost.
6. **Removal of the
  sort
  selector**: `#ingredient-sort`
  is removed (the
  HTML),
  the
   `ingredientSort`
  state (including its reset in
   `resetRecipesData`), its
  listener and
   the comparator's
  `za`/`recent`/`used`
  branches; the
  catalog achieves
  fixed
   alphabetical A-Z
   order (`localeCompare`
  `es`) with a deterministic tie-break by
  `id`. It partially supersedes ADR-082's decision
  7.
7. **Accessibility and
  styles**: a
  visible
  keyboard
  focus on the
  chips via
  `:focus-within` (an
  outline
  `--teal-reel`, the
  catalog's own), unchecked
  chips with
  theme
  variables + grouped
  pure-black
  overrides (`--ink-raised`) and
  the quantity
  and unit row with a
  responsive
  `flex-wrap`
  (wrapping on mobile ≤480px, AGENTS.md
  §2).

## Decision

1. **HTML** (`index.html`): the label and the
   `#ingredient-sort` select
  of the
  toolbar are
   **removed** (the
  tab's comment no longer mentions
  sorting).
   Nothing else changes in the
   markup: `js/recipes.js` renders the
  chips and
   the
  quantity row inside the
  modal, like
  all other fields.
2. **JS**:
   - `js/recipes-data.js`: `INGREDIENT_CATEGORIES` gains the
      `icon` field
     (an emoji per category); the new constants
     `CUSTOM_CATEGORY_ICON` (`🏷️`),
     `UNCATEGORIZED_ICON` (`🧺`)
     and `SUPERMARKETS` (an
     array of
     `{id, label}` of
     the
     6
     chains; the
     colors
     live in the
     CSS, not
     here).
   - `js/recipes.js`: the
      `ingredientSort`
     state is removed (including its reset in
     `resetRecipesData`), the
     `#ingredient-sort`'s
     `change`
     listener in
     `setupRecipes` and
     the comparator's
     branches;
     `compareIngredients(a, b)`
     stays in A-Z with
     a
     tie-break
     by
     `id` and
     `renderIngredientsCatalog` no longer computes
      `getUsageIndex()` for
      the
      render (the
      index
      only
      serves the
      "Usada en"
      modal). The
      groups'
      render adds
      `<span class="ingredient-group__icon"
      aria-hidden="true">` with
      the
      corresponding
      icon. The
      modal gains
      `supermarketChipsHtml(selected)` (the
      labels
      `.supermarket-chip`
      with
      a
      hidden
      checkbox
      and
      `data-supermercado`), `packageQtyRowHtml(ing)`
      (the
      shared
      ids
      `ing-modal-paquete`/`ing-modal-unidad`) and
      the
      constant
      `PACKAGE_UNITS`. In the
      **manual
      creation** the
      name
      is
      stored
      as-is (`trim`, without normalizing) and
      the
      dedupe
      compares by
      `normalizeIngredientName` from
      both sides;
      `syncIngredientsCatalog` persists
      `ing.nombre.trim()`.
      `bindIngredientModalHandlers` manages:
      a category and
      supermarket change (an
      immediate save in the
      detail, a
      whole
      new
      array) and
      the
      package's
      quantity/unit (in the
      detail, with
      the
      `>= 0` validation, empty
      → `null` and
      invalid
      values reverted; in the
      creation they are
      collected on the
      submit with
      the
      same
      numeric
      validation).
   - `js/db.js`: `addIngredient` expanded with the
      3
      optional
      fields (only
      persisted
      if
      defined) and
      the
      new
      `updateIngredient(uid, ingredientId, fields)` doing
      a
      partial
      `updateDoc` +
      `updatedAt`, replacing
      `updateIngredientCategory` (removed;
      `js/app.js` re-exports
      `updateIngredient` in the
      context).
3. **CSS** (`css/styles.css`): a new
   block
   `/* Supermarkets and quantity of the ingredient's package (issue
   #224) */`
   with `.ingredient-modal__chips`, `.supermarket-chip` (a
   `--paper-dim` background, a
   `--paper-line` border, the
   `--ink` text; a
   grouped
   `[data-theme="black"]` override with
   `--ink-raised`/`--paper`/
   `--paper-alpha-20`),
   `.supermarket-chip:focus-within` (an
   `--teal-reel` outline), the
   brand
   classes
   `.supermarket-chip--{id}.is-checked`
   and
   `.supermarket-tag--{id}` with
   the hardcoded
   corporate
   hexes and
   the
   AA
   contrast-justifying comment, `.supermarket-tag` (a
   non-interactive
   label, with
   the
   same look as the
   checked
   chip, ready for
  read-only views), the
   `.ingredient-modal__qty-row` row (a flexible
   input with a
   `min-width: 0`, a
   fixed select,
   `flex-wrap` on ≤480px) and the
   icon
   `.ingredient-group__icon` with
   the
   group title in
   flex (AGENTS.md
   §2: `min-width: 0`,
   `overflow-wrap: break-word`).
4. **User manual**: §8.5 updated — with no
   mention of
   "Ordenar"; the
   original
   spelling («they are
   stored and shown exactly
   as you write them», without duplicates if one
   exists
   with
   another spelling);
   supermarkets and the
   package's
   quantity
   **when adding** (optional) and
   **editable in the
   detail** (the
   change
   saves
   at that
   moment, like the
   category).
5. **PWA**: the version bumps
   `20260913 → 20260914` in `js/config.js`
   (`APP_VERSION`), `index.html` (the
   `?v=` of
   styles and
   `app.js`) and
   `service-worker.js` (`STATIC_ASSETS`).

## Consequences

- **Positive**: the ingredients look **exactly
  as the user wrote them** (accents
  and
  capitals respected in the
  catalog, the
  modal and the recipes using them), without losing the normalized-name
  dedupe (the
   catalog keeps the first
   spelling); the
  ingredient's
  profile gains useful shopping data (where
  one
  buys
  it and
  how much the
  package holds) optional and editable
  at
  that
  moment; the icons make the categories
  recognizable at a glance; the toolbar becomes cleaner and the fixed
  A-Z removes a redundant
   control; the generic
   `updateIngredient` stays reusable for future partial
   edits.
- **Neutral**: the supermarkets and the package's
   quantity are
   **informative in the ingredient's
   profile**: the shopping
  list keeps aggregating the same (a
  normalized name + the unit, as until now); old
   documents without the new fields render empty; the emoji
  icons depend on the device's font (they are
   standard Unicode and need no assets); the PWA bumps
  `20260913 →
   20260914` (it invalidates the previous
  cache to
  propagate the new CSS/JS); the
   ADR is numbered 085 because
   084 is already taken by the sibling branch of
  the shopping list.
- **Negative**: the Z-A / Recently added / Most
   used sorting **disappears** from the UI (a
  deliberate decision of issue #224, which partially
  supersedes ADR-082's decision
   7); no other one known. QA validated
  the acceptance criteria (the original spelling in
  creation and the catalog, the expanded profile, the icons, the
  removed selector), responsiveness at
  360 / 768 / 1280 px with no horizontal scroll and the
  four theme modes without dead points or insufficient contrasts
  (the marks exceed AA, ≥7,7:1 in the five with a
  white text and
  13,9:1 for black over
  Mercadona's
  yellow); the security scan found no findings (all the user data go
  through
  `escapeHtml`).

Related issue: #224
