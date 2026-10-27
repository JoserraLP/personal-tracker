# ADR-092: The recipe ingredients' unit of measure as a dropdown (issue #251)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #251 asks that when
**creating or editing a
 recipe** the
 ingredients' unit of
 measure be a
 **dropdown** with
 the
 **g, Kg, mL, L and Units** options.

Previous state: in the
 `ingredientRowHtml`
 (js/recipes.js, ~line
 1593) the unit was a
 **free-text**
 `<input type="text" class="ing-unit">` with the
 "Unit"
 placeholder, so each recipe could store
 any
 text
 (the
 g, gr, gramos,
 spoon…),
 which made
 comparing against the package's quantity and the
 "name|unit"-keyed aggregation (ADR-086) harder.

An already-existing
 pattern in the app:

- The
  `SHOPPING_UNITS = ["g", "Kg", "mL", "L", "Units"]` in
  js/recipes-data.js (line
  121), the
  same list the extra item's
  `#extra-unit` and the
  add-to-shopping
  modal's
  `#ing-shopping-unit` already use
  (issue #249, ADR-091).
- The
  `PACKAGE_UNITS` (js/recipes.js, line
  901) with its
  **first
  empty "—" option** for
  "unspecified" (issue #224, ADR-085).

Flow note (the
 same exception as
 ADR-083, ADR-085,
 ADR-087, ADR-088,
 ADR-089, ADR-090 and
 ADR-091): the
 work's base is the
 `content/issue-64-seccion-recetas` branch; the work
 branch is created from there and the
 PR goes **also
 to
 `content/issue-64-seccion-recetas`, not to
 `dev`**. The ADR is
 numbered
 **092** (the
 number 090 was used by two
 ADRs of the
 issue #242, and the
 091 by the
 #249).

## Decision

1. **A new helper `unitOptionsHtml(unit)`** in js/recipes.js
   (next to the
   `ingredientRowHtml`): it generates a
   `<select class="ing-unit" aria-label="Unit of measure">` with the
   **first
   empty "—" option** (an
   explicit
   selected
   when the row
   has no
   unit, the
   `PACKAGE_UNITS`
   pattern
  — it prevents the browser from preselecting
  the
  "g" on new rows) followed by the
   **5
   options of
   the
   `SHOPPING_UNITS`** (the
   g, Kg, mL, L, Units). The match with the
   stored
   unit is compared **normalizing both sides with the
   `normalizeUnit`**, so a stored "kg" matches the list's "Kg" option.
2. **Legacy data**: if the stored unit matches no
   standard one (e.g.
   a
   "cucharada", from when
   the field was a free text), it is added as an
   **extra
   option at the end, selected**, with the
   `value` and
   label
   escaped with
   the
   `escapeHtml` (they are user data); the
   datum stays
   as-is when editing and saving. The
   `selected` ends up
   **exactly on one option** in all
   cases
   (empty,
   standard
   or
   legacy), never
   on two.
3. **The reading/persistence unchanged**: the
   `readRecipeFromForm` keeps reading the
   `.ing-unit` and normalizing with
   the
   `normalizeUnit` (a select's
   `.value` is read just like an input's); the new
   data always stay in the normalized
   set (the
   g, kg, ml,
   l,
   units), improving the consistency with the
   packages'
   comparison and the
   "name|unit"-keyed aggregation (ADR-086).
4. **CSS (css/styles.css)**: the select
   is added to the
   base
   `.recipe-form__ingrediente` pill's
   grouped selectors (the
   `--paper-dim`/`--ink` with
   a
   `min-width: 0`), to the
   **light family's overrides**
   group (the
   `[data-theme="light"]`/`[data-theme="white"]`, a
   grouped
   pattern, a single source of truth) and to the
   **pure
   black's override**
   (the
   `[data-theme="black"]`). Also, the
   own rule being added is the
   `.recipe-form__ingrediente select { width: 100% }` so the
   select's
   `min-content` (the widest option, e.g. a long legacy
   unit) does not overflow its
  `1.4fr 0.7fr 0.9fr auto` grid cell
   (and the two columns at ≤560 px): with no horizontal scroll
   at
   360 / 768 / 1280 px (AGENTS.md
   §2).
5. **The user manual's §8.1**: "A cada ingrediente le pones la
   **cantidad** y eliges su **unidad de medida** en un desplegable con
   las opciones **g, Kg, mL, L y Unidades** (puedes dejarla sin
   elegir)".
6. **PWA**: the bump `20260924 → 20260925` in js/config.js
   (the
   `APP_VERSION`), the index.html (the
   `?v=` ×3: styles.css, ocio.css,
   app.js) and the
   service-worker.js (the
   `STATIC_ASSETS`, its 7
   versioned entries with a
   `?v=`).

## Consequences

- **Positive**: the unit of measure becomes a
   closed choice
   with the five units the user asked for; the new
   data always stay in the normalized set (the
   g, kg, ml, l,
   units), so the packages' comparison (ADR-086)
   and
   the
   name+unit-keyed (ADR-086,
   issue #225) aggregation become
   more consistent; the experience is the extra item's and the
   add-to-shopping
   modal's same (ADR-091), with the
   shared
   `SHOPPING_UNITS` list.
- **Neutral**: the legacy units (the old recipes' free text) keep
   being seen and stay as-is when edited, as the dropdown's extra
   option; the
   empty
   unit ("—") stays allowed as before; on mobile the native selects use the
   system's
   popup —
   the app's already-pre-existing behavior (the extra
   item and the shopping
   modal, ADR-091). The CSS reuses the existing grouped-selectors
   pattern, adding the
   "select" to the
   base, light and pure black rules.
- **Negative**: none known.
  Validated: the
  JS
  syntax, the acceptance criteria, responsiveness at
  360 / 768 / 1280 px with no horizontal
  scroll
  (AGENTS.md §2), the four theme modes with the sibling inputs' inherited AA contrast
  (AGENTS.md §4) and a security scan with no findings —
  every user-data
  interpolation goes
  through
  the
  `escapeHtml` (the
  legacy extra option
  included
).

Related issue: #251
