# ADR-090: The Menú tab — breakfast's removal, a recipe finder with per-recipe diners and a single add button (issue #242)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #242 asks for four
 changes on the
 **Menú** tab (ADR-076, the recipes
 section, issue #64):

1. **Removing
 the breakfast** from
 the
 menu: it now
 covers
 only
 **Comida** and
 **Cena
**.

2. When adding a recipe to a
 meal, **replacing
 the
 dropdown** with a
 **window
 with cards** of the
 recipes: a
 small photo (if it has
 one)
  on
  the
  left,
 the
 name as a
  title
  on
  the
  top
  right and
 the
 **allergen and meal-type
  tags**
  below.
3. That
  finder must
  allow
  **searching
  by
  text** and
  **filtering
  by
  the
  two
  tags**
  (the
  allergens and the meal type).
4. Pressing
  a
  recipe opens
  the
  **reading window** just like the
  Recipes tab's
  (ADR-088, issue
  #236).
5. When adding a recipe, that
  recipe's **diners**
  can be chosen
  (not everyone eats everything);
  if none is given, the
  menu's **global selection** is used.

Previous state:
 `addRecipeToMeal` in
  js/menu.js
  showed an
  inline
  `<select>`
  under
  the
  "+ Receta"
  button with the
  not-yet-added recipes;
  meal entries in the
  Firestore document (the
  `users/{uid}/menus`, the
  `dias[day][meal]`)
  were
  **strings** with the
  recipe's
  id;
  the
  menu had
  three
  fixed meals
  (the
  `MEAL_KEYS`
  with
  `desayuno`,
  `almuerzo`,
  `cena`);
  the
  "recipes
  for
  the
  week"
  (the
  `weeklyRecipes`)
  was a
  separate block with its
  own
  dropdown and
  **is** not the
  object
  of
  this issue.

Flow note
  (the
  same exception as
  ADR-083, ADR-085,
  ADR-087, ADR-088
  and
  ADR-089): the
  work's base
  is the
  `content/issue-64-seccion-recetas` branch; the work
  branch is
  created from there and the
  PR goes
  **also
  to
  `content/issue-64-seccion-recetas`, not to
  `dev`**. The ADR is
  numbered
  **090**.

## Decision

1. **A two-meal menu**: `MEAL_KEYS`/`MEAL_LABELS`
   in js/recipes-data.js become
   `["almuerzo", "cena"]`. The old
   stored `dias[day].desayuno` data in
   Firestore is ignored
   (the grid
   and
   the
   shopping
   list iterate only the
   current
   meals).
   The "Desayunos"
   meal
   type of
   the
   `MEAL_TYPES` (a
   recipe
   tag)
   **stays**:
   it is a
   plate-type
   tag, not a
   menu
   meal. The
   hint of
   the
   weekly
   recipes in index.html updates
   (the
   bread
   no longer has
   any
   place to
   go).
2. **The recipe
   finder's window** (the
   `recipe-picker-modal`
   in
   index.html,
   the
   `renderRecipePicker`
   render
   in
   js/menu.js):
   a
   modal with the
   recipe's
   same
   pattern (a
   `modal__card--wide`), whose content is
   a
   **card
   list** of
   `.recipe-pick__card`s:
   a
   small photo on
   the
   left
   (only if there is a
   `fotoUrl`), the
   name on
   the
   top
   right and
   the
   allergen / type
   tags
   below
   (the
   same
   `.recipe-card__tag--alergen/tipo`
   pills
   as the
   Recipes
   tab). Each card is
   pressable (a
   role button,
   a
   tabindex
   0) and
   has
   its
   own
   "+ Añadir"
   button.
   - **The search and the filters**: a
     live search field (a
     name, normalized-ingredient and tag
     match, the
     Recipes
     tab's
     criterion)
     and two
     dropdown
     filter buttons (the
     allergens and the
     meal
     type) that
     **reuse the
     pattern and
     classes
     `.recipes-filter__*`**
     of the
     Recipes
     tab (issue
     #234): multi-selection with "Todas"
     checked by default, a
     source of
     truth in Sets (the
     `pickerAlergenoFilter`/`pickerTipoFilter`)
     and a
     panel painted only when opened. It opens with
     all checked on each opening; there is no "touched"
     flag (the
     finder's state is
     ephemeral, it is discarded on close).
   - **Reading**:
     pressing a card
     (click, Enter
     or
     Espacio) closes
     the
     finder and opens
     the
     `openRecipeModal(recipe, { readOnly: true,
     onClose })`:
     the
     Recipes
     tab's
     same reading
     window. An
     **`onClose` callback**
     is added to `openRecipeModal`
     (issue
     #242) which is
     invoked
     only
     once when
     closing the modal and is
     cleared;
     menu.js
     uses it to **restore the finder**
     (trap focus
     and
     focus
     to
     the
     search field; the
     search/filters'
     state is kept because
     the
     list is not
     re-rendered).
3. **Per-recipe diners**: the meal entries go
  from
  strings
  to
  **objects `{ recipeId, diners }`**
  (the
  diners being a
  number
  or
 null when they
  inherit the
  global).
  The
  `mealEntryOf` normalizes both
  formats (an
  old string →
  `{ entry, diners: null }`)
  and is
  used on the grid, the add,
  the delete and the cleanup of
  deleted recipes
  (the
  `cleanupDeletedRecipe`),
  which compared the
  id
  against the whole
  entry and
  would not have
  deleted the
  new
  ones.
   - On the
     finder's card, the
     "+ Add"
     unfolds a
     **diners row**
     (an
     optional number with
     the
     "Menu (N)"
     placeholder) with
      the
      **Add**
      button (confirming
      the add) and
      the
      **Cancel**
      (collapsing);
     Enter on the number also confirms. Empty/0 →
     null
     (it
     inherits the
     menu's
     global).
     The
     grid shows the number as a small badge next to
     the
     name (the
     `.menu-meal__diners`) and on the
     tooltip.
   - **The shopping list** (js/shopping-list.js,
     ADR-076): the
     calculation scales each recipe with
     its
     **own diners**
     if it has
     them, and with
     the
     **global**
     ones
     if not:
     the
     `factor = diners ÷
     servings`. It is compatible with old
     string
     entries.
4. **Accessibility and listeners**: the
   modal uses
   a
   `trapFocus` and returns the
   focus when
   opened;
   Escape closes;
   the
   document's
   global listeners
   (Escape and the
   panels' closing on an
   outside
   click) wire
   **only
   once**
   (the
   `pickerDocEventsBound`): the
   modal
   new
   content re-renders on each opening and otherwise they would
   accumulate. The recipes' `onClose`
   callback is
   invoked
   in
   the
   `closeRecipeModal`
   **after** restoring the
   focus and resetting the
   `editingRecipeId`/`modalReadOnly`
   (the
   WIP save left
   those lines outside the
   function and broke the module's
   load).
5. **Responsiveness**
   (AGENTS.md
   §2): the
   card uses
   a
   `flex-wrap`,
   a
   `min-width: 0`
   and
   an
   `overflow-wrap: break-word`; the search field is
   a
   `flex: 1 1 200px` and the
   filter panels
   are
   limited
   to
   the
   `max-width: calc(100vw - 3.5rem)`. With no horizontal scroll at
   360 / 768 / 1280
   px.
6. **Four theme modes**
   (AGENTS.md
   §4): all the new
   styles use only
   theme variables (the
   `--ink-raised`/`--paper` on
   the
   chip, the
   `--paper-dim`/`--ink`
   on the
   diners' input, the
   `--ink-soft`
   on
   secondary
   textes, the
   `--paper-alpha-*`
   on borders); the
   tags' pills reuse the
   modifiers already
   grouped with their
   per-family
   overrides. With no hardcoded
   colors.
7. **User manual**:
   §8.3 describes the two-meal menu, the cards'
   window with search/filters, the recipe's
   reading and the per-recipe
   diners.
8. **PWA**: the
   bump `20260920 → 20260921`
   in js/config.js (the
   `APP_VERSION`), the
   index.html (the
   `?v=`) and the
   service-worker.js (`STATIC_ASSETS`).

## The iteration (2026-08-13): the finder's contrast in the dark and pure black modes

The user's finding
   after the initial
   PR: **the
   dark
   mode looked bad on the
   recipe
   search
   window**. The
   root
   cause: the
   `.recipe-pick__card`
   cards and the
   empty-message `.recipe-pick__empty` did not
   declare an
   explicit
   text-color and **inherited the
   modal's
   `--ink`**
   (which in the
   dark
   family is a
   light paper with a
   dark
   ink); over the
   card's
   `--ink-raised`
   chip, the
   ink gave ≈ the
   **1.1:1**
   (invisible)
   and the
   message with the
   `--ink-soft` ≈
   the
   **2.84:1**
   (not
   AA).

The applied correction
   (the
   `.recipes-filter__btn`
   and
   `.recipe-view__meta`'s same
   pattern, grouped
   selectors with
   a
   single
   source of
   truth per
   rule):

- `.recipe-pick__card`: an
   explicit
   `color: var(--paper)` on
   the
   base
   (the
   dark
   family)
   and a
   grouped
   `[data-theme="light"]/[data-theme="white"]`
   override to
   the
   `--ink`.
- `.recipe-pick__empty`: `--ink → --ink` (the
   heavy
   content's
   ink,
   15.2:1
   over the
   modal's paper) and an
   override
   `[data-theme="black"]`
   to
   the
   `--paper`
   (in pure
   black the
   modal is a
   dark
   surface and the
   `--ink` is
   #000, invisible).
- `.recipe-pick__search` in pure
   black: an
   override to
   the
   `--ink` +
   a
   `--paper-alpha-20`
   border, the
   `ingredient-modal__field` /
   `.recipe-pick__diners`
   input's pattern
   —
   without
   it, the field
   (the
   base
   `--ink-raised`) would share its
   background with the
   pure-black modal and not be
   distinguishable.

The resulting contrasts: the card 13.85:1
   (dark)
   /
   16.51:1 (pure
   black)
   /
   14.65:1 and
   21:1
   (light and pure
   white); the empty
   message 15.2:1
   /
   16.51:1; the
   search's placeholder 6.16:1
   (pure
   black, AA). With no behavior,
   HTML or
   JS
   changes:
   only theme CSS, so the user's manual needs no update.

## Iteration 2 (2026-08-13): the grid's diners badge's AA

The previous iteration's QA re-validation's finding: the
     badge
     `.menu-meal__diners`
     (the
     `· N` next to the
     recipe's
     name on the
     menu
     grid, new on this PR) used
     the
     `--ink-soft`
     and over
     the
     `--paper-alpha-10` on the
     `--ink-raised`
     cell gave ≈ the
     **3.73:1**
     on the
     Dark theme — under AA 4.5:1
    for a 0.68rem text.

The applied correction (the previous iteration's
     `.recipe-pick__empty`'s
     same pattern): the base
     becomes `--paper-alpha-92` over the dark chip (the
     blend ≈
     9.24:1 in Dark,
     12.2:1 in pure black) and
     the
     light
     family recovers
     an
     `--ink-soft` in a
     grouped override
     `[data-theme="light"]/[data-theme="white"]`
     (5.02:1 and
     5.44:1, AA)
     — on
     those themes the
     base's translucent paper is white and would be invisible over the
     light chip. With no behavior,
     HTML nor
     JS changes: only theme CSS.

## Iteration 3 (2026-08-13): the
  finder in the
  light family inside the paper
  modal and full
  pure-black
  overrides

The user's finding after iteration
  1: on the
  **Dark** theme the finder's
  window
  (a
  `--paper` paper
  modal) showed **cards,
  a search field and the filters' pills in dark chips** (the
  `--ink-raised` with a paper
  text), an internal contrast the user described as ugly,
  with the
  **recipe's
  name unreadable** (it
  inherited the modal's
  ink, almost black, over the dark chip). They asked to invert
  the colors to fit the window to the web's rest.

Decision: inside the Dark theme's paper modal, the finder's controls move to the **light family** (the
  same source of truth as the
  `.ingredient-modal__field input` and
  the
  `.recipe-form__field input`, and
  the
  Recipes tab's `.recipe-card`
  card — light surfaces over paper, which is the app's rest's visual language):

- `.recipe-pick__card`
     →
     a
     `--paper-dim`/`--ink` with
     a
     `--paper-line`
     border; the
     name stays in a legible
     dark
     ink (a 13.1:1).
- The
     `.recipe-pick__search` →
     a
     `--paper-dim`/`--ink`
     (placeholder to the
     content's ink: the
     `--ink-soft` gave ≈
     2.45:1, not
     AA).
- The
     `.recipe-pick .recipes-filter__btn`
     →
     a
     light pill (a
     `--paper-dim`/`--ink`/`--paper-line`).
- The
     `.recipe-pick__diners` →
     the
     `--ink` (the
     soft
     ink gave ≈
     2.45:1).
- The photo placeholder's tint being the
     `--ink-alpha-08`.

And in
  **pure black**
  (where the
  modal is a
  `--ink-raised` dark surface), the grouped overrides the
  light base requires
  — the base being its
  `--paper-dim`/`--ink` almost black on that theme
  (a
  #000 text over
  #111,
  invisible ≈ the
  1.07:1):

- `.recipe-pick__card` → a
  dark chip of
  `--ink-raised`/`--paper` (a
  16.5:1) with a
  hover/focus in the teal's
  light variant (`--teal-reel-dark`,
  #4f9c8e, a
  6.11:1).
- The
  `.recipe-pick .recipes-filter__btn` → the
  same dark chip (a
  16.5:1).
- The
  `.recipe-pick__diners` → an
  `--ink-soft` (a
  5.8:1, AA
  compliant).
- The
  `.recipe-pick__search::placeholder` →
  an
  `--ink-soft` (a
  6.16:1, AA;
  without the override it would be
  #000 over the
  #000 field).
- The field and the
  diners' input keep
  the
  previous iterations' overrides (the
  `--ink`/`--paper`); the
  tags' pills use the
  already-grouped
  `--allergen/--tipo` modifiers
  (a
  light teal/ochre with ink
  textes, a
  6.5:1 and
  an
  8.2:1).

The resulting contrasts (an AA/AAA text in the four themes): the
  card 13.1:1 (Dark) /
  16.5:1 (pure black) /
  12.9:1 (Light)
  /
  21:1 (Pure white); the recipe's
  name is always legible;
  the
  placeholder is a 6.16:1 (pure black). With no behavior,
  HTML nor
  JS changes: only
  theme CSS, so the user's manual needs no update.

## Iteration 4 (2026-08-13):
 the
 single
 recipe-add
 button
 with a
 target
 picker
 and
 cards on the
 cells

The user's
 comment
 (2026-08-13T09:06:39Z):
 replace
 **all** the
 recipe-add
 buttons with **a
 single
 button on the
 top**
 allowing choosing
 the
 **day
 of the
 week or the
 whole week** and the
 **lunch or
 dinner**;
 removing
 the
 separate "add a recipe to the week"
 button
 (it adds with the same button);
 and what gets added to each
 cell being
 **cards
 like the search's**, not non-clickable empty items.

The applied changes (js/menu.js, css/styles.css,
 index.html and the
 manual §8.3):

1. **The single button**: the
   `#btn-add-menu-recipe` on the
   menu's bar (the
   `.menu-toolbar`) replaces
   the
   "+ Receta" buttons of
   each cell (the
   `menu-meal__add`) and the
   "Recipes for the week" button/dropdown (the
   `btn-add-weekly-recipe` and
   the
   `addWeeklyRecipe`,
   removed along with the
   CSS `.menu-weekly__addrow`). Pressing it opens the
   finder
  with a
  **target
  picker**
  `.recipe-pick__target`:
  a
  day (Monday…
  Sunday) or
  "The whole week"
  + the
  meal (Comida/Cena). With
  "The whole week"
  the meal is deactivated and
  the
  `.recipe-pick__week-hint`
  warning shows (it adds once and is not multiplied
  by the diners). The
  target lives in the
  `pickerDay` (a
  `"*"` = the
  whole week,
  `pickerMeal` =
  null) and the
  state stays when
  opening a recipe's reading
  (the
  same
  `restoreRecipePicker`).
2. **The weekly high through the same flow**: the
  `addRecipeToMeal`
  accepts a
  `day "*"` and
  writes
  to the
  `weeklyRecipes` with the same
  shape
  `{ recipeId, cantidad: 1 }`; the
  finder's candidate list excludes the ones already
  added to the
  chosen target (the
  day's meal or the
  whole week) and adapts the
  empty message.
3. **The cards on the cells**: each recipe of a meal renders
  as a
  `.menu-meal__card` (a
  thumbnail photo, a name, tags — the
  same source of truth
  recipeTagsHtml
  and pills
  `.recipe-card__tag` —, a
  diners badge
  and a ✕ button). The
  card is clickable
  (click, Enter or
  Espacio) and opens the recipe in
  reading mode (the
  `openRecipeModal`), like the finder's. The shopping list's
  exclusion (issue
  #225) strikes
  through only the
  name instead of the whole row.
4. **Four theme modes**: the cell's card uses the
  `--paper-alpha-10` tint, inheriting the cell's text; in the
  light
  family the grouped override moves to the
  `--ink-alpha-10` (the
  paper's being a translucent white, invisible over the white
  cell) and in pure black the tint is reasserted with a hover/focus in
  the
  `--teal-reel-dark`. The target
  picker
  follows the finder's field pattern (the
  `--paper-dim`/`--ink` over the paper modal) with an inversion in
  pure black (the
  `--ink`/`--paper`) and field
  label and warning with the content's ink (the
  `--ink`, the
  `--paper` in pure black), the same AA contrasts as the
  previous iterations' ones.
5. **The user manual's §8.3**:
  the single button, the target picker
  and the cells' clickable cards.

## Iteration 5 (2026-08-13):
 cards
 on the
 weekly recipes and a
 hover/animation on the
 ✕

The user's
 comment
 (2026-08-13T09:42:41Z):
 (1) on "recipes
 for the week"
 the added cards must
 **look
 like the ones on the
 day-by-day
 menu
 table**, instead of
 just
 the
 name;
 (2) the
 menus' cards'
 **«X»**
 button must have
 a
 **hover or animation** when
 passing
 over or
 pressing
 it.

The applied changes (js/menu.js, css/styles.css, the
 manual §8.3 and a
 PWA
 bump
 `20260921 → 20260922`):

1. **"Recipes for the week" as cards** (the
  `renderWeeklyRecipes` in js/menu.js):
  each weekly recipe renders with the
  **same**
  `.menu-meal__card` classes as the
  cells (a
  thumbnail
  photo, a name, tags with the
  same
  `recipeTagsHtml` and the ✕). The
  `.menu-weekly` block already shares its background with the
  cells
  (the
  `--ink-raised`), so the theme
  overrides of the `.menu-meal__card` (the
  light
  family's
  `--ink-alpha-10` and
  pure black's
  `--paper-alpha-10`) cover the weekly list with no
  new rules; the
  `#menu-weekly-list` just stacks the cards with
  a
  `gap: 0.3rem` (the
  `.menu-weekly__item`,
  its
  text row with a
  "Remove" button, and its separate borders are removed). The
  weekly card is **clickable**
  (click, Enter or
  Espacio, with
  the
  same recipe-reading opening as the cells do via
  `openRecipeModal(recipe, { readOnly: true })`) and the ✕
  removes it
  (the
  `removeWeeklyRecipe`); the
  keyboard does not interfere with the inner
  button (the
  `closest("button")` guard).
2. **The ✕'s hover and animation** (the
  `.menu-meal__remove`, shared by cells and week):
  it becomes a **round** button of
  1.5rem (24 px, WCAG
  2.2 AA 2.5.8) with
  a
  `border-radius: 999px` and a
  transition;
  the
  `:hover`/`:focus-visible` fill
  the circle with
  the
  `--paper-alpha-14`
  (a translucent paper in the dark family, a translucent ink in the light:
  visible on the chip in both
  ones) and the
  `:active` shrinks it (a
  `transform: scale(0.8)`,
  the
  `.btn:active`/`.trailer-btn:active`'s pattern). The
  `prefers-reduced-motion`'s global media query
  cancels the animations.
3. **The dark-family ✕'s AA contrast**
  (the QA re-validation's finding): the
  `--stamp` (#a63b2e)
  over the chip gave ≈
  2:1 in Dark and ≈
  2.6:1 in pure black (under the graphical
  components' 3:1, WCAG
  1.4.11). The
  `.shopping-line__remove`'s
  pattern applies
  (issue
  #225): a
  base with
  the
  hardcoded
  light
  red `#d16a59` (≈
  4.7:1,
  AA,
  commented) and a
  grouped override
  `[data-theme="light"]/[data-theme="white"]`
  to
  the
  `--stamp` (≈
  5.3:1, AA).
  In pure black the base already works (≈
  4.7:1), with no override.
4. **Responsiveness and themes**:
  verified in a
  headless browser at
  360 / 768 / 1280 px on the
  four themes — with no horizontal scroll
  (12/12 combinations) and with weekly cards with a long
  name (120+ chars without
  spaces) fitted by the
  `overflow-wrap: break-word` and a
  `min-width: 0`.
5. **The manual §8.3**:
  the "Recipes for the week" section describes the
  cards identical
  to
  each day's (seeing them by pressing, removing
  them with the ✕). **PWA**: the
  bump `20260921 → 20260922`
  in js/config.js,
  index.html and the
  service-worker.js.

## Consequences

- **Positive**: adding recipes to a meal is no longer a flat dropdown: the
  cards'
  window
  with search and filters makes it easy to find recipes with
  restrictions (the
  allergens) and types; the per-recipe diners
  reflect that not everyone eats everything, and the shopping list scales
  each recipe by what is actually
  cooked; the menu gets fitted to lunch
  and dinner.
- **Neutral**: the old entries
  (the strings) stay valid; the
  stored-desayuno breakfast in existing documents has no
  visible use; "recipes
  for the week" adds
  with the same
  single button choosing
  "The whole week" (iteration 4; it no longer has its own dropdown); the
  PWA bumps
  `20260920 → 20260922` (the iterations 4 and 5).
- **Negative**: none known. The plan is to validate
  the
  acceptance criteria (no
  breakfast,
  the cards'
  window with photo/name/tags, a search and filtering
  by the two tags, the recipe's reading, the per-recipe diners
  with the
  global's inheritance), the
  responsiveness at 360 / 768 / 1280 px with no horizontal
  scroll, the four theme modes with AA contrast and the security
  scan without findings
  (all the user data go through `escapeHtml`, including the recipes'
  names, the tags and the `data-*`
  attributes).

Related issue: #242
