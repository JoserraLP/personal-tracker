# ADR-088: The ingredient window — read-only with ✏️ Editar, editable name and photo, no lower "Cerrar" button (issue #232)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #232 asks to turn the **ingredient window** (the one
that opens when pressing an ingredient's card on the Recetas
section's «Ingredientes» tab, issue #64) into a
**read-only version with explicit editing**:

1. **Read-only by default**, with a **pencil**
  button to switch to edition.
2. In edition, being able to change **the name too** and
   add a **photo**.
3. **No empty image / placeholder** when the ingredient has no
   photo.
4. **Removing the lower "Close"
   button** (the top ✕ serves
   that purpose, the same criterion as ADR-087 for recipes).
5. **Removing the text «Categoría actual: X. La lista de la compra se
   agrupa por esta categoría.»** that showed at the end of the detail.

Previous state: pressing an ingredient's
card opened a modal with directly
 editable fields — a category select,
  supermarket
  chips and the package's quantity — with an
  immediate
  save on every field's change («Categoría actualizada.»,
  «Supermercados
  actualizados.», etc.), a lower
  **«Cerrar»**
  button and the text «Categoría
  actual: …» at the
  end. The
  name could not be edited from the
  detail
  (only in manual creation, ADR-085) and no ingredient
  photo existed.

Flow note (the same exception as
 ADR-083, ADR-085
  and ADR-087): the
  work's base
  is the
  `content/issue-64-seccion-recetas` branch; the
  `content/issue-232-ventana-ingrediente` branch is
  created from there and the
  PR goes **also to that branch, not to
  `dev`**. The
  ADR is numbered **088** (087 is already
  taken by the Recipes
  tab, issue #234).

## Decision

1. **The reading view**
   (`ingredientDetailHtml`): the
   **name as a
   title**
   (`ingredient-modal__title`); the
   **photo only if it exists**
   (`ing.fotoUrl` →
   `<img class="ingredient-modal__photo">`, with
   no
   placeholder nor
   "sin imagen" when there is none); the
   **category** and
   the
   **package's quantity** as plain
  text
   (`ingredient-modal__text` with
   `--ink-soft`); the
   **supermarkets** as
   **non-interactive**
   labels (`supermarket-tag--{id}`, already existing
   since ADR-085 with documented
  hardcoded
   brand
   colors);
   "Used in N
   recipes" **unchanged**
   (links opening the recipe in reading
   mode). **No lower "Cerrar"
   button** (only the
   top
   ✕ and
   "Delete"/«✏️ Editar» on
   `.ingredient-modal__actions`)
   and **without
   the
   text "Categoría actual: …"**, which disappears from
   the
   UI.
2. **The «✏️ Editar» button** (`data-ing-edit`): a
   **hot
   re-render**
   of the
   same modal to edit mode via the
   `openIngredientModal(id, { edit: true })`,
   with
   the
   `openRecipeModal` pattern
   of issue #234: it
   releases
   the
   previous
   focus
   trap
   (an
   `ingredientModalCleanup()`), **it does not re-store**
   `_previousActiveElement` if the
   modal was already visible (the
   `wasHidden`),
   and
   focuses
   the
   name
   field on a
   second
   `requestAnimationFrame` (after
   the
   `trapFocus`, which
   focuses
   the
   ✕) without
   breaking
   the
   trap.
3. **The edit view** (`#ingredient-edit-form`,
   `ingredientEditHtml`):
   a
   **name**
   (required,
   `maxlength="200"`),
   a
   **photo
   (the
   URL)**
   (a
   `type="url"`), a
   **category** (a
   select), the
   **supermarkets**
   (chips with
   an
   immediate visual mark, without saving
  at
   that
   moment)
   and
   the
   **package's
   quantity**
   (a
   number
   + unit, with
   ADR-085's
   `>= 0` / empty →
   `null` validation). **"Guardar"**
   persists
   in
   bulk via the
   `ctx.updateIngredient(currentUser, id, { nombre, fotoUrl,
   categoriaId, supermercados, paqueteCantidad, paqueteUnidad })`,
   **refreshes the local**
  `ingredients` **array** so the
   reading view shows
   the
   data instantly
   (the Firestore snapshot arrives later)
   and
   returns to
   reading with
   the
   toast "Ingrediente
   actualizado.". **"Cancelar"**
   (`data-ing-cancel`) returns to
   reading without
   saving.
4. **The detail's immediate per-field saving is removed**: in the
   detail the category, supermarkets
  or
  quantity are
   no longer persisted on
   change;
   everything saves in
   bulk with
  "Guardar" (the
   manual-creation
   "Nuevo ingrediente" keeps
   its usual single submit). The
   creation does not change except that
   `addIngredient` now accepts an
   **optional
   `fotoUrl`**
   (it is only
   persisted when defined; **it is not exposed
   in
   creation**, only in the
   detail's
   edition).
5. **The backdrop and Escape only close in read mode**: the
   `!ingredientEditMode` guard on both
   listeners; in edition they are
   **blocked**
   to not lose the form's
   progress (the
   recipe window's
   pattern,
   issue #234). In edition the
   exit
   paths
   are
   the
   top
   ✕,
  "Cancelar" and
   "Guardar".
6. **The global
   `ingredientEditMode`
   state** (a
   bool): it sets to
   `true` when opening
   in edition and
   to
   `false` when opening
   in reading or closing the
   modal (the
   `closeIngredientModal` always resets it).
7. **Responsiveness**
   (AGENTS.md §2): the new texts use
   an
   `overflow-wrap: break-word` + a
   `min-width: 0` (the
   title, the fields' textes); the photo
   `width: 100%; max-height: 180px; object-fit: cover` (the
   `.recipe-card__photo` pattern).
8. **Themes**
   (AGENTS.md §4): the
   reading voices use
   `--ink-soft` with
   the
   override added to the
   grouped
   `[data-theme="black"]` block; supermarkets
   reuse the
   hardcoded
  brand
  colors
   (documented
   with a comment
  since
   ADR-085, identical in the 4
   modes).
9. **User manual**: §8.5 updated (the window in read
   mode
   with
   ✏️ Editar — name
   and
   photo included —,
   "Cancelar"/"Guardar",
   without
   a
   lower
   "Cerrar"). **PWA**: the bump
  `20260915 → 20260916`
   in `js/config.js` (`APP_VERSION`),
   `index.html` (the
   `?v=` of
   styles and
   `app.js`) and
   `service-worker.js` (`STATIC_ASSETS`).
10. **Security**: `escapeHtml` at all the interpolation points
   (including the photo's
   `src` and
   `value`); the
   `fotoUrl`
   field is
   stored
   as-is
   — a
   pattern consistent with
   recipes (ADR-087); the
   security
   scan left
   a
   **MEDIUM
   informative
   finding** about
   unifying in the
   future
   with
  `safeCoverUrl` (which already sanitizes
   the global
  search's
   recipes'
  photos).

## Consequences

- **Positive**: the ingredient window follows the recipe
  window's (issue #234) same mental model: a
  clean
  reading,
  an
  explicit
  edition with
   the
  pencil
  and
  a
  form protected from
  accidental
  closure; the
  name can finally be corrected from the
   detail; the
  photo (optional, by
   URL, with
  no
  upload infrastructure) enriches the
  profile
  and the future catalog;
  without
   a
  placeholder the visual noise is avoided
  in photo-less
   ingredients;
  the bulk save reduces Firestore
  calls
  and toasts versus the per-field
  immediate save;
  "Cancelar" allows discarding
  changes with
  one
  gesture.
- **Neutral**: the
  photo is
  stored
  as a
  URL
  and
  shown as-is, with
  `escapeHtml` but without
  domain
  sanitization (the
  recipes' same criterion; the
  MEDIUM
  informative finding is noted
  for
  unifying with
  `safeCoverUrl` in the
  future); the
  manual
  creation still
  offers no photo
  (only
  the
  edition); the PWA bumps
  `20260915 → 20260916` (it invalidates the previous
  cache); the
  ADR is numbered 088 because 087 is
  already taken by the Recipes
  tab.
- **Negative**: in edit
   mode, pressing outside or Escape no longer
   closes the
  window (a deliberate
   behavior to not lose the form; the
  exit means
  are
  ✕ / Cancel / Save); no
  other one
  known. QA validated the issue's
  criteria
  (a
  reading by default, the
  pencil, an
  editable name and
  photo, without
  a
  placeholder, without
  a
  lower
  "Cerrar", without
  "Categoría actual"), responsiveness at
  360 / 768 / 1280 px with no horizontal scroll and the
  four theme modes without dead points or insufficient contrasts
  (`--ink-soft` AA on every family); the security scan found
  no
  new findings (all the user data go through `escapeHtml`).

Related issue: #232
