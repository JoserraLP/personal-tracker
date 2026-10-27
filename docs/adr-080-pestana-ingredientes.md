# ADR-080: A dedicated Ingredients tab, split out of the Recipes tab (issue #209)

## Status
Accepted

## Date
2026-08-11

## Context

Issue #209 asks to **take the ingredients catalog out of the
«Recetas» tab** (where it coexisted with the recipes list, an
«Ingredientes» toggle and a
local search bar) and **give it its own tab** on the Recipes section's
tab bar. The «Recetas» tab must end up
**only with the «+ Nueva receta» button**: without
a local search bar, without a toggle
and without the catalog. The
recipes search moves to living only in the header's global search
(issue #206).

Previous state (built in ADR-076, ADR-077 and ADR-078):

- The Recipes section has had the uniform `tabs--bar` tab
  bar since issue #208 (the same component as
  Ocio): Recetas/Menú/Lista
  de la compra tabs with ochre/green/red accents, hideable from
  Settings (issue #97, `SECTION_REGISTRY` in
  `js/settings.js` and `applyTabVisibility` in
  `js/app.js`).
- In the «Recetas» tab (`panel-recipes-tab`) coexisted:
  the local search input `#recipes-search-input` (which fed
  `activeFilter` in `js/recipes.js`), the «Ingredientes»
  toggle (`#btn-toggle-ingredients`, the
  `showingIngredients` state) which showed/hid
  the `#ingredients-catalog` catalog, and the button
  «+ Nueva receta». `js/recipes.js` renders the
  catalog (`renderIngredientsCatalog`) and allows assigning
  categories (`ctx.updateIngredientCategory`); it also shows
  which
  recipes each ingredient is used in.
- The header's global search (issue #206) uses
  `searchRecipes`/`filterRecipes` and is independent of the
  tab's local input.

## Decision

1. **A new «Ingredientes» tab** on the Recipes bar, between
   «Recetas» and «Menú»: a `.tab--ingredients` button with
   `data-recipes-tab="ingredientes"`,
   `aria-controls="panel-ingredients-tab"` and a leaf
   icon. Its panel is a new
   `<section id="panel-ingredients-tab" class="hidden">` containing the
   `#ingredients-catalog` (without the
   `hidden` class: `openRecipes`' panel toggle controls the
   visibility, like Menú and Lista de la
   compra).
2. **A clean «Recetas» tab**: the local search input, the
   «Ingredientes» toggle and the catalog are removed; the
   button «+ Nueva receta» remains
   (`#recipe-ingredients-datalist` is kept, used by
   the recipe modal). In `js/recipes.js`, `activeFilter`,
   `showingIngredients`, `toggleIngredientsCatalog` and
   the input's and the toggle's listeners are removed.
   `renderRecipesList` stops filtering by
   `activeFilter` (it shows all the recipes);
   `searchRecipes` and `filterRecipes` **stay intact** for the
   global search.
3. **Render per active tab**: `openRecipes` tracks the
   active tab in `currentTab` and renders the catalog when opening
   `tab === "ingredientes"`; the recipes' and
   ingredients' realtime subscriptions only
   re-render the catalog if the tab is visible
   (`currentTab === "ingredientes"`), so «Usada en: …»
   and the categories are always up to date without needless work.
   `resetRecipesData` resets
   `currentTab` (the `openRecipes` panel toggle already guarantees the
   panel stays hidden).
4. **Router**: `RECIPES_TAB_TO_PANEL` gains
   `ingredientes: "panel-ingredients-tab"`, so
   `#/recetas/ingredientes` works like the other tabs (canonical,
   last-tab memory, back/forward).
5. **Settings (issue #97)**: the default `visibleTabs` gains
   `ingredientes: true` and
   `SECTION_REGISTRY.recetas.tabs` the
   `ingredientes: { label: "Ingredientes", panelId:
   "panel-ingredients-tab" }` entry.
   `applyTabVisibility` and
   `normalizeTabKey` treat it
   automatically by deriving from
   `SECTION_REGISTRY`: hideable in Settings
   and normalization of the active tab if hidden
   (the same mechanics as the rest).
6. **A violet accent**: `.tab--ingredients` uses `--tab-accent:
   var(--games)` (the palette's only free accent, Video
   games')
   with the pure
   black override
   `[data-theme="black"] .tab--ingredients.is-active`
   with `--games-dark`, the same pattern as
   `.tab--games` (ADR-009/064/066). The dead CSS of
   `.recipes-search-input` and
   `.recipes-toolbar__actions` is
   removed.
7. **User manual and PWA**: the manual is updated (sections 3,
   3.2, 8, 8.1, a new
   8.5 and
   16) and the PWA version is bumped
   (20260909 →
   20260910) to refresh the cache.

## Consequences

- **Positive**: the «Recetas» tab ends up clean (only
  «+ Nueva receta»); the ingredients catalog gains presence and
  its own URL (`#/recetas/ingredientes`); the recipes search has a
  single path (the global header's), without the local input kept by
  habit (issue #206); there is no
  `showingIngredients` state to maintain, the catalog's render is
  tied to the visible tab.
- **Neutral**: the catalog renders when opening the tab (and
  updates live only if
  visible); users who had the
  tab hidden in `localStorage`
  keep it hidden by default until
  they enable it (`sanitizeVisibility`'s
  tolerance).
- **Negative**: none known. The change reuses the tabs component
  and the visibility mechanisms already validated in the four
  themes; the only new color is the violet accent, already used by
  Video games with its verified
  pure black overrides.

Related issue: #209
