# ADR-088: The recipes window in reading mode — a text view distinct from edition (issue #236)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #236 asks that the recipes' **reading mode** window not be
"the form with disabled fields" (as
ADR-087's decision 2 left
it), but a
**legible text view**, visually
 distinct from edition's:

1. **The photo first** and, right below, **the
  name** with the
  allergen and meal-type tags, the description and the servings.
2. Under that, the
  **ingredients as a list**, with no
  remove option nor the category: only
  **name and quantity**.
3. Below, the
  **instructions**, also as a
  list (numbered) with no remove
   option.
4. At the end, the
  **reference links**, if any.
5. The
  **allergen and meal-type labels must differ
  by color** to not
  be
  confused between them.
6. The
  reading view **must not look like
  uneditable boxes, but as text**: field names are not shown
  (Nombre, Descripción, Porciones...); the
  **recipe's name shows as a title** and the ingredients and
  instructions carry their own
  **heading
  title**.

Previous state: ADR-087 (issue
   #234) implemented the reading mode reusing
   the
   `recipeModalHtml` with all fields
   `disabled` (the same form structure, only
   blocked); with
   the "Editar" and
   "Delete"
   buttons; and the ✕ closing
   always with the
   backdrop/Escape only
  in reading. That window worked, but visually it was
  indistinguishable from an
  inaccessible form.

Flow note (the same exception as
 ADR-083, ADR-085 and
 ADR-087): the work's
 base is the
 `content/issue-64-seccion-recetas` branch; the work
 branch is created from there and the
 PR goes **also to that branch, not to
 `dev`**. The
 ADR is numbered **088**.

## Decision

1. **An own reading render**: `recipeModalHtml` (js/recipes.js)
   branches at the start with `if (modalReadOnly && recipe) return the
   recipeReadOnlyHtml(recipe)`. The
   new
   private
   `recipeReadOnlyHtml` generates a
   view
   **without
   a
   `<form>`**, without
   inputs, selects
  nor
   textareas, and
   **without field names**. The rest of
   `recipeModalHtml`
   (creation and
   edition) is untouched: the
   form stays intact to edit.
2. **The reading view's structure** (in order): an optional photo
   (an
   `img` with
   `alt=""` and
   the
   `loading="lazy"`), the
   **name as a title** on
   the
   `h3.recipe-view__title`, tags
   on
   the
   `div.recipe-view__tags`, the
   description, the servings («N
   porciones»), an
   **Ingredientes**
   section
   (a
   `ul` list with each
   row name
   + quantity), an
   **Instrucciones**
   section
   (a
   **numbered
   `ol`** list with the
   steps), an
   **Enlaces**
   section
   (if any,
   at the
   end) and, closing,
   the
   **Editar/Delete buttons** (the
   `data-recipe-edit` / `data-recipe-delete`,
   the
   same
   ones
   `bindRecipeModalHandlers` already wired in issue
   #234). The empty
   sections (without
   a
   description, a
   photo,
   links...) are simply omitted: an
   incompletely
   imported recipe leaves no
   gaps.
3. **Labels differentiated
   by color**: two classes,
   `recipe-view__tag--alergeno` (the
   teal
   `--teal-reel` with a
   `--white` text,
   ≈ 6.8:1) and
   `recipe-view__tag--tipo` (the
   ochre
   `--ochre-spine-dark`
   with
   a
   `--white` text,
   ≈ 5.2:1) — AA ≥
   4.5:1 for both.
   The
   translucent style of
  the
  `.recipe-card__tag`
   (a
   teal text over
   `--teal-alpha-18`) is discarded
   because
   the
   ochre over paper does not reach the text threshold
   (≈ 4.3:1). In
   **pure black**, a
   `[data-theme="black"]` block with the
   light
   variants and a
   `--ink` text: the
   `--teal-reel-dark` (≈ 6.5:1) and
   `--ochre-spine-dark #c99a4e` (≈
   8.2:1), the
   same
   pairs already approved in Recetas' filter
   (ADR-087). CSS comments document the
   ratios (AGENTS.md
   §4.4).
4. **The ingredients' quantities**: the
   `cantidadRecetaHtml`
   helper — it shows
   the
   `formatCantidad(cantidad) + unidad` (e.g.
   "200 g") only if there is
   a
   quantity or unit; never the category; never a
   remove
   button.
5. **Links with defensive hygiene**: the
   `enlaceRecetaHtml` helper — only
   the
   `http/https`
   schemes are clickable (an
   `<a>` with
   `target="_blank"` and
   `rel="noopener noreferrer"`); any other
   scheme (e.g.
   the
   `javascript:`)
   shows as plain text. All user data goes through
   `escapeHtml`
   (including
   `href` and
   `src`).
6. **Interactions unchanged**
   (ADR-087 intact): "Editar" re-renders in edit
   mode without
   closing
   the
   modal, releasing the previous
   focus
   trap and
   focusing
   the
   `#recipe-nombre`; "Delete" goes through
   the
   `deleteRecipeFlow`
   and
   closes only if it deletes; the
   ✕ always closes; the
   backdrop and Escape only close in
   reading; the
   `trapFocus` re-applies on the
   hot
   re-renders. The
   `bindRecipeModalHandlers`
   tolerates the form's
   absence (its accesses use
   `?.` and
   the
   `querySelectorAll` → safe
   no-ops in
   reading).
7. **Responsiveness**
   (AGENTS.md
   §2): the
   `.recipe-view`
   container and all its children with
   a
   `min-width: 0`; an
   `overflow-wrap: break-word` on title, description, tags, steps, names, quantities
  and
   links; on mobile (≤
   560 px) the ingredient row becomes
   `flex-wrap` and the long quantity ("250
   mililitros") drops to its own line. The
   ingredients'
  and
   links'
   `<ul>`s carry no bullets (`list-style: none` +
   a
   `padding-left: 0`); the instructions' `<ol>`
   recovers a
   `display: block` + a
   `list-style: decimal` so the numbers render
   (a
   flex
  block container
  makes the `<li>`s blocky and the
  `::marker`s disappear — a
  QA finding fixed in the iteration).
8. **User manual**: §8.1 describes the
   reading view as text
   (a
   photo,
   a
   name as
  title, green/ochre tags, the
   description, servings, ingredients as a
   list, numbered instructions, links at the end clickable only when
  http/https), alongside the
   Edit/Delete buttons and the already
  documented closings.
9. **PWA**: the version bumps `20260917 → 20260918` in
   `js/config.js` (the
   `APP_VERSION`), `index.html` (the
   `?v=` of styles and
   `app.js`) and
   `service-worker.js` (`STATIC_ASSETS`).

## Consequences

- **Positive**: the reading mode is distinguishable at
  a
  glance from edition and reads as content (a
  photo,
  a
  title,
  lists), not as a locked form;
  the
  allergen and type
  tags are no longer
  confused
  by color; the
   links open
   in a new
  tab with protection against
  dangerous schemes; incomplete recipes
   show without gaps (conditional sections).
- **Neutral**: the global search and the "Used in"
  modal inherit
  the new reading view (the same
  `openRecipeModal(recipe, { readOnly: true })`); the edit form
  does not change; the PWA bumps
  `20260917 → 20260918`. The
  photo- and the
  tag-less
  cases show the name directly as the first element (the
  photo is optional).
- **Negative**: none known. QA validated the 10 acceptance
  criteria (a view distinct from edition, photo/name/tags,
  differentiated
  colors,
  description+servings,
  ingredients
  name+quantity only,
  numbered instructions, links
  at the end, no
  field names, the
  name as a title with section
  headings, Edit/Delete and closings
  without regression), responsiveness at
  360 / 768 / 1280 px with no horizontal scroll, the
  four theme modes with AA contrast (the pills 5.2–8.2:1, the
  metas' full-ink
  15.2:1 in Dark
  — the previous
  `--ink-soft` gave
  2.8:1 and did not reach AA — and
  teal links ≥ 5.7:1) and the security scan without findings (all the
  user data go through `escapeHtml`; the non-http links generate no anchors).

## The iteration (2026-08-13, the issue's comment)

A new user comment on issue #236:

> Las etiquetas de alérgenos y tipo de plato, deben tener también los
> colores diferentes en la tarjeta, no solo dentro de la ventana de
> información. Añade un lápiz al botón de editar.

### Changes

1. **Per-type colors on the card too**: `recipeCardHtml`
   (js/recipes.js) renders the tags with the
   reading view's same modifiers (`recipe-card__tag--alergeno` teal
   /
   `recipe-card__tag--tipo` ochre). In
   CSS the color selectors are **grouped** with the
   reading view's ones (`.recipe-view__tag--alergeno,
   .recipe-card__tag--alergeno { ... }`), a
   single
   source
  of
  truth per rule (AGENTS.md
   §4.3), including
  the
  pure-black
  overrides. The old single translucent style
  of
  the
  `.recipe-card__tag` (a
  teal-alpha-18 +
  a
  teal text,
  ≈ 4.4:1, under AA) disappears:
  the
  base
  pill
  keeps
  only the
  shape (the
  radius,
  padding,
  size) and the color is provided
  by
  the
  modifier, with AA
   pairs (a
   6.7:1 teal
   and a
   5.2:1 ochre; in pure black the light variants 6.6:1
   and
   7.4:1 with
   ink
   textes).
2. **A pencil on the edit button**: the two "Editar"
   buttons of
  the recipes' flow (the reading view and the read-only branch
  of the
  `recipeModalHtml`) go
   from "Editar"
   to
   "✎ Editar", the
  same ✎ (U+270E)
  glyph
  the
   app's other
  edit
  buttons use
   (e.g. the
   `editButtonHtml` in ui.js).
3. **User manual**: §8.1 now describes that the
   cards also show the tags as colored pills (green
   allergens, ochre type)
   and that the edit button
   carries a ✎
   pencil.
4. **PWA**: the bump `20260918 → 20260919`
   (js/config.js,
   index.html and the
   service-worker.js) because the Recipes tab's CSS and JS change.

### Validation

- Acceptance criteria: no regression
  (all 10 re-verified); the
  iteration's new points validate against
  the card's and the view's real render (the
  modifiers present in the
  DOM, AA colors in the four themes).
- Responsiveness: 360 / 768 / 1280 px with no horizontal scroll on
  the card with long tags («Plato de cuchara», «Sin
  frutos secos»).
- Security: a scan without findings (the change adds no
  new user data; `escapeHtml` keeps covering
  the tags).

Related issue: #236
