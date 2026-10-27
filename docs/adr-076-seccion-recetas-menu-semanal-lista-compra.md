# ADR-076: The Recipes section — recipes, weekly menu and shopping list (issue #64)

## Status
Accepted

## Date
2026-08-11

## Context

Issue #64 asks for a
**new top-level
section** on the
web, at
the
same level
as the existing sections (the
Ocio and the
Profile), dedicated to the
kitchen. The
initial scope
is:

1. **Recipes**: log recipes
  with a
  name, a
  description, the
  ingredients (the
  name + the quantity + the unit + the category), the resulting
  servings, the step-by-step
  instructions, a photo (the
  URL) and the
  reference links.
2. **The weekly menu**: a
  day × meal grid with **several recipe options per meal** (so
  each diner can eat differently), the number of diners, and the
  "recipes per week" (e.g. bread for
  the
  breakfasts) that **do not scale per
  serving**.
3. **The shopping list**: the needed ingredients' automatic calculation based
  on
  the menu's recipes and the
  diners/servings
  factor, with recipes that can get
  **excluded**
  from the list, manual **extra items** (edible
  and non-edible, e.g. cleaning products)
  and marking what is already bought.
4. **Categorization**: predefined ingredient tags, the allergens and the meal
  types, **expandable with the user's custom tags**.
5. **The URL import**: adding a recipe by pasting a link, extracting
  the page's data when feasible and staying marked as "needs review".
6. **Searching** for recipes (by name/ingredient/categories).

The web already has the top-level sections' pattern with its own URL (the
Ocio since the
ADR-051/ADR-059, the Profile with the
`#/profile/...`), the
central
sections/tabs registry (the
`SECTION_REGISTRY`, issue #97), the hash routing (the
ADR-051) and the subscriptions with a backoff retry (issue #147, the `js/retry.js`). The Recipes section must
integrate with all
that following the same
patterns.

The implementation is **in progress on the working tree** (the
`feat/issue-64-*` branches), pending the
four theme modes',
the
responsivity's and the
security scan's QA; this ADR documents the
architecture decision, like the recent ones (the
ADR-059 to ADR-068).

Related issue: #64 — https://github.com/gonzalitojh/Registro-personal/issues/64

## Decision

Creating the
"Recipes" section as yet another **top-level
view** (the
`#recipes-view` on the
`index.html`, the same pattern as the
profile-view), with **three
tabs** (the
Recipes / the Menu / the
Shopping list), **three new JS
modules** (the
`js/recipes.js`, the
`js/menu.js`, the
`js/shopping-list.js`) plus a data/constants
module (the
`js/recipes-data.js`), and **four new
Firestore collections** under the
`users/{uid}`. The decision develops in
six points.

### 1. The `#/recipes[/tab]` hash route and the three tabs

- The
  `js/router.js` gains the `/recetas` prefix with the
  **`RECIPES_TAB_TO_PANEL`** map as the sole source of truth:
  the
  `recipes → panel-recipes-tab`, the
  `menu → panel-menu-tab`, the
  `shopping → panel-shopping-tab`.
- The
  `parseHash` returns
  `{ section: "recipes", tab, panelId }` for the
  `#/recetas/<tab>`; the **default tab's canonical one is the
  `#/recetas`** (with no segment, the
  `RECIPES_DEFAULT_TAB = "recipes"`), and the
  `recipesHashFor()` canonicalizes
  `#/recetas/recetas` → the
  `#/recetas` (a
  `history.replaceState`-based normalization, the
  Ocio and the Profile's same behavior).
  The unknown segments get sanitized to the default tab with the
  `invalid: true`.
- The
  `js/app.js` (the
  `initRouter`'s onRoute) treats
  the
  `route.section === "recetas"`
  the same as `"perfil"`: it hides
  the
  other views (the
  `#app`
  and the
  `#profile-view` stay `hidden`;
  the
  `#recipes-view` gets shown) and calls
  the
  `recipesApi.openRecipes({ tab, fromRouter: true })`. If
  the requested tab is hidden in the
  Settings, the
  `normalizeTabKey` substitutes it with the first
  visible one and the URL is rewritten with a
  `replace: true` (the
  Ocio's same guard, issue #97).
- The
  sidebar's "Recipes" entry (the
  `js/sidebar.js`, the
  `SECTIONS`) navigates with the
  `navigate({ section: "recipes", tab: getLastRecipesTab() })`: it returns to
  the **tab that was last active in the
  session** (a
  router
  memory, the
  lastOcioKey pattern).

### 2. The Firestore collections under the
  `users/{uid}` (the
  rest's same model)

Four new collections with the
existing ones' **same
rules pattern** (a
read among authorized friends, a
write only by the
owner):

| Collection | Content |
|-----------|-----------|
| `recipes/{id}` | Recipe: the
  name, the
  description, the
  servings, the instructions `[string]`, the
  photoUrl, the links `[string]`, the
  allergens/types (the tag ids), the ingredients `[{ nombre, cantidad, unidad, categoriaId }]`, the `needsReview`, the `sourceUrl`, the `addedAt`/`updatedAt` |
| `ingredients/{id}` | The ingredients' catalog: the
  name (the
  normalized), the
  categoriaId |
| `tags/{id}` | The custom tags: a
  `{ nombre, tipo }` (the
  type: the
  `ingrediente` \| the
  `alergeno` \| the
  `tipo`) |
| `menus/{id}` | **One document per
  week**: the
  `weekStart` (the
  ISO Monday), the
  `diners`, the
  `days` (the day × the meal → the recipeIds array), the
  weekly recipes, and the
  shopping list's data: the
  `recetasExcluidasCompra` and the `itemsExtra` |

On the
`firestore.rules`:

```
match /recipes/{itemId} { allow read: if isAllowedUser(); allow write: if isAllowedUser() && isOwner(userId); }
match /ingredients/{itemId} { ... identical ... }
match /menus/{itemId} { ... identical ... }
match /tags/{itemId} { ... identical ... }
```

The menus are stored **anchored to the
ISO week's Monday** (the
`mondayISO()` on the
`recipes-data.js`): the Menu tab navigates through weeks (the previous/the current/the next), and each week is a
`menus` document with the
`weekStart` = the Monday. The menu's document also persists the
shopping list's **extra items** (the
`itemsExtra`) and the
**exclusions** (the
`recetasExcluidasCompra`), so each week's shopping list travels with its menu. The
`js/db.js` exposes the per-collection functions (the
`subscribeToRecipes`, the
`addRecipe`, the
`updateRecipe`, the
`deleteRecipe`, the
`subscribeToIngredients`, the
`addIngredient`, the
`updateIngredientCategory`, the
`deleteIngredient`, the
`subscribeToTags`, the
`addTag`, the
`deleteTag`, the
`subscribeToMenus`, the
`addMenu`, the
`updateMenu`, the
`deleteMenu`), following the existing collections' pattern.

### 3. The JS modules and the
  shared data

- **The
  `js/recipes-data.js`** (the
  constants and the
  helpers, with no state): the
  predefined tags — **12 ingredient categories** (the issue's 9 + the
  "Drinks and coffees", the
  "Frozen" and the
  "Others"), **6 allergens** (the issue's 4 + the
  "Nut-free" and the
  "Egg-free") and **8 meal types** (the issue's 5 + the "Sauces and side dishes", the "Breakfasts" and the
  "Drinks") —; the
  `slugify` helpers, the
  `normalizeIngredientName` (a slug without accents → spaces), the
  `normalizeUnit` (the lowercase/trim), the
  `mondayISO`, the
  `mergeTags`/`tagsByIds` (the
  predefined + the
  `users/{uid}/tags`' customs), the
  `escapeHtml` and the
  `formatCantidad`.
- **The
  `js/recipes.js`**: the Recipes tab — a list with a search, a create/edit/import modal, the ingredients' catalog (a
  category
  edition), the
  custom tags and the other tabs' renderers registry (the
  `registerTabRenderer`). It exposes the
  `setupRecipes({ ctx, onRecipeDeleted })` → the
  `{ openRecipes({ tab }) }` API for the router.
- **The
  `js/menu.js`**: the Menu tab — the day × meal grid with a recipes picker (the
  options' arrays), a
  diners'
  selector, the
  weekly recipes, the shopping
  exclusion and the weeks' navigation. It exposes the
  `getActiveMenuData()`, the
  `setRecipeExcluded()`, the
  `updateMenuExtras()`.
- **The
  `js/shopping-list.js`**: the Shopping list tab — the
  automatic calculation and the manual extra items.

**The ingredients' catalog self-fills via a
normalized-name upsert**: on saving a recipe, each ingredient gets normalized with the
`normalizeIngredientName` and, if it does not already exist on the
`ingredients`, it gets created with its
`categoriaId` (the `js/recipes.js`); it never gets
duplicated (the
Set gets built on the
normalized names).

### 4. The URL import (a client-side, with no own backend)

- **A previous protocol
  validation**: the URL must start
  with the
  `http://` or the
  `https://` (a defensive regex that blocks
  schemes like the
  `data:` or the
  `file:` before touching the fetch).
- The
  `fetch(url, { mode: "cors" })` directly from the client and, if it responds, a
  parse with the
  **`document.implementation.createHTMLDocument("")`** (an
  **inert** document: the downloaded HTML **does not execute scripts** nor
  loads resources). The
  extraction via
  the
  **`textContent`** (the h1 → the title, the
  fallback to the `title`).
- If the fetch fails (the origin site's CORS, the network...), **the recipe gets
  saved anyway with its URL (the
  `sourceUrl`) and the
  "Review" flag (the
  `needsReview: true`)**, shown as a
  badge on the card (the `.recipe-card--review`); when
  editing and saving a reviewed recipe, the
  `needsReview` goes to the
  `false`. The import is an assisted filling: the user can always
  correct the fields before saving.

### 5. The shopping list's calculation

- For each day and meal of the active menu, each **non-excluded** recipe (the
  `recetasExcluidasCompra`) contributes its ingredients multiplied by the
  recipe's **`diners / servings` factor** (if the
  `servings`
  is 0, the
  factor = the diners).
- The **weekly recipes** (the
  `recetasPorSemana`) **do not scale**: they get added with their fixed quantity.
- The quantities get **aggregated by normalized ingredient
  name** (the same unit; the
  `normalizeUnit`), with the
  `formatCantidad` for the
  2-decimal rounding without trailing zeros.
- The **manual extra items** (the
  `itemsExtra`) accept
  edibles and **non-edibles** (the cleaning products, etc.) and persist on the menu's document; "mark as bought" is a
  session's visual state on this first version.

### 6. The app patterns'
  integration

- **The
  `SECTION_REGISTRY`** (the
  `js/settings.js`): a new
  `recipes` entry
  with its three tabs (the panelIds matching the
  `RECIPES_TAB_TO_PANEL`) and the
  `visibleSections`/`visibleTabs` with the
  visible/menu/shopping active by default (the tabs can get
  hidden from
  Settings, issue #97).
- **The
  `SECTIONS`** (the
  `js/sidebar.js`): the "Recipes" entry with its own icon, between the
  Ocio and the
  Settings.
- **The realtime subscriptions** with the
  **`subscribeWithRetry`** (the
  `js/retry.js`, issue #147): two
  new subscriptions on the
  `js/app.js` (the recipes+ingredients+tags via the
  `subscribeRecipesData`, and the menus via the
  `subscribeMenuData`), with the
  `onError`/`onRetrying` showing toasts and the
  app's
  rest's same backoff retry; they register on the
  `stopAllSubscriptions()` and the modules
  expose the
  `reset*` to
  empty the state on
  logout.
- **The cache
  version**: the
  `APP_VERSION` bump of
  the
  `20260903 → 20260905` via
  the
  `scripts/bump-version.sh` (it touches the precached assets: the
  `index.html`, the
  `js/config.js`, the
  `service-worker.js`).

## Consequences

### Positive

- **Shareable URLs**: each tab has its own canonical URL (the
  `#/recetas`, the
  `#/recetas/menu`, the
  `#/recetas/compra`); the reload and the back
  button return to the exact tab, and the hidden tabs' guard
  (issue #97) keeps the URL coherent with what's visible.
- **A realtime sync**: the four collections subscribe with the
  `onSnapshot` + the
  `subscribeWithRetry` (issue #147): another device's (or the
  app's own) changes reflect immediately, with no refresh button.
- **A consistent pattern**: the Ocio and the Profile's same architecture — the hash
  routes (the
  ADR-051), the
  collections under the
  `users/{uid}` with the
  `read isAllowedUser` / the
  `write isOwner` rules, the
  setup*-module → the
  router's API, the
  `SECTION_REGISTRY` for the
  Settings, the
  sidebar, and the
  PWA version bump per PR (the
  ADR-049/059/061/064/066).
- **A self-maintained ingredients'
  catalog**: the normalized-name upsert avoids
  duplicates and keeps the catalog always up-to-date with no manual management.
- **The import with no infrastructure**: the client-side extraction with an inert document (with no script execution) needs no proxy nor backend; if the site does not allow
  CORS, the recipe keeps the URL and the
  "Review" flag instead of losing the link.
- **Expandable tags**: the 12 predefined ingredient categories, the
  6 allergens and the 8 meal types combine with per-user custom tags (the
  `users/{uid}/tags`), meeting the issue's "-reviewing and expanding the lists" criterion.

### Negative / Risks

- **Four new collections** (the
  `recipes`, the
  `ingredients`, the
  `tags`) plus **a `menus` document per week**: more data and
  Firestore rules
  surface; the
  `menus`' documents with the
  `itemsExtra` and the
  `recetasExcluidasCompra` mix
  menu and shopping-list data on a
  single document (if the week gets deleted, its
  extra items go too — mitigated by the
  delete confirmation dialog).
- **The shopping list is per active menu**: it only gets calculated over the week being browsed on the Menu tab; there is no historical nor global aggregate (out of the issue's scope).
- **A CORS-dependent import**: most recipe sites do not expose CORS headers, so the flow will often fall to the "save with URL + Review" case; the automatic extraction will be the exception, not the rule.
- **Pending visual validations**: the section is new and
  broad (the cards, the modal, the dynamic forms, the chips, the badges, the menu's grid, the shopping list) — the **four theme modes**' verification (the
  AGENTS.md's rule 4, the
  WCAG AA minimum) and the
  **responsiveness** at the
  360/768/1280 px with no horizontal scroll (rule
  2) are missing, which the
  QA must close before merging.
- **A first version with fixed meals**: breakfast/lunch/dinner are not
  configurable (the issue's criterion asks to choose "several options on
  each meal", not to
  create new meals); "mark as bought" is a session's visual state, not a
  persisted
  one.

### Neutral

- **No new dependencies**: no libraries nor
  backends
  get added; the import uses the
  browser's `fetch` + the
  inert
  DOM.
- **The PWA bump of
  the
  `20260903 → 20260905`**: one bump per
  PR (the
  ADR-019/recent ADRs) via
  the
  `scripts/bump-version.sh`, for
  touching the precached assets (the
  `index.html`, the
  `js/config.js`, the
  `service-worker.js`).
- **The up-to-date user manual**: the new section gets documented on the
  `docs/manual-de-usuario.md` (the
  AGENTS.md's rule 3) — the tabs, the recipes'
  creation, the URL import with the
  "Review" flag, the weekly menu and the shopping list.

## Rejected alternatives

- **A single `recipes` collection with everything embedded** (the menus and the ingredients inside the recipe's
  document): rejected — the issue explicitly asks for separate collections for the
  recipes, the ingredients and the menus, and the ingredients' catalog is shared between the
  recipes and the shopping list.
- **A menu as a
  single document per user** (a single overwritten week): rejected — one document per week with the
  `weekStart` = the
  ISO Monday allows
  a history and a weeks'-navigation without
  migrating data.
- **Persisting the extra items and the exclusions on the shopping list's
  collection** (or on the local storage): rejected — they live on the menu's document so
  each week has its complete list and syncs
  in realtime between devices.
- **A scraper with an own backend/proxy**: rejected — the CORS client-side import
  is enough for the
  personal case; a proxy would add
  infrastructure to maintain (like the
  ADR-056 and ADR-067's
  proxies) with no real need.
- **Using the DOMParser with the
  `text/html`**: rejected — the
  `createHTMLDocument` creates the **inert** document (it downloads and executes nothing), which is the security
  requirement to process foreign HTML
  .

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **Modified**: the new
  `#recipes-view` view (the
  `profile-view` pattern, it hides the
  `#app` and the
  `#profile-view`) with a header and subtabs (the
  Recipes/Menu/Shopping list, the
  `profile-subtab` pattern) and the 3 panels (the
  `panel-recipes-tab`, the
  `panel-menu-tab`, the
  `panel-shopping-tab`) + a recipe
  modal with a complete form and the URL import |
| `js/router.js` | **Modified**: the
  `RECIPES_TAB_TO_PANEL`, the
  `RECIPES_DEFAULT_TAB`, the
  `RECIPES_PREFIX`, the
  `recipesHashFor` (the canonical
  `#/recetas`), the
  parseHash's Recipes
  branch, the
  `canonicalHashFor`, the
  `lastRecipesTab`/`getLastRecipesTab` |
| `js/app.js` | **Modified**: the
  `onRoute`'s
  `recipes` branch (it hides
  the
  profile/ocio, the
  `normalizeTabKey` guard, the
  `openRecipes`), the
  `setupRecipes`/`setupMenu`/`setupShoppingList`, the
  recipes' and the menus'
  `subscribeWithRetry` subscriptions (issue #147), the
  `resetRecipesData`/`resetMenuData` on
  logout, resuming the
  `#/recetas` after
  the
  login |
| `js/db.js` | **Modified**: the
  subscribeToRecipes/Ingredients/Tags/Menus + the
  per-collection add/update/delete (the existing pattern) |
| `js/recipes.js` | **New**: the
  Recipes tab — the list + the search, the
  create/edit modal, the URL import (the
  `http(s)://` validation, the
  CORS fetch, the inert `createHTMLDocument`, the
  `textContent`, the
  `needsReview` fallback), the
  ingredients' catalog with the normalized-name upsert, the
  custom tags, the
  `registerTabRenderer` |
| `js/menu.js` | **New**: the Menu tab — the day × meal grid, several options per meal, the
  diners, the weekly recipes, the shopping
  exclusion, the weeks' navigation (the
  `mondayISO`) |
| `js/shopping-list.js` | **New**: the Shopping list tab — the
  `diners/servings` factor, the non-scaled weekly recipes, the
  skipped exclusions, the edible/non-edible extra items, the
  visual bought |
| `js/recipes-data.js` | **New**: the 12 ingredient categories, the 6 allergens, the 8 meal types, the
  `slugify`, the
  `normalizeIngredientName`, the
  `normalizeUnit`, the
  `mondayISO`, the
  `mergeTags`/`tagsByIds`, the
  `escapeHtml`, the
  `formatCantidad`, the days/meals |
| `js/settings.js` | **Modified**: the
  `SECTION_REGISTRY.recetas` with its 3 tabs; the
  default
  `visibleSections`/`visibleTabs` (issue #97) |
| `js/sidebar.js` | **Modified**: the `SECTIONS` entry of
  "Recipes" with an icon and the
  `navigate({ section: "recetas", tab: getLastRecipesTab() })` |
| `firestore.rules` | **Modified**: the
  `recipes`, the
  `ingredients`, the
  `menus`, the
  `tags` under the
  `users/{uid}` with the
  `read isAllowedUser` / the
  `write isAllowedUser && isOwner` |
| `css/styles.css` | **Modified**: the
  `recipes-view`'s styles, the recipes' cards (the
  "Review" badge), the catalog, the menu's grid, the shopping list (the
  theme tokens, the pure-black overrides) |
| `js/config.js` | **Modified**: the
  `APP_VERSION`
  going
  `20260903` →
  `20260905` |
| `service-worker.js` | **Modified**: the
  `?v=20260903` → the
  `?v=20260905` bump
  on the
  `STATIC_ASSETS` (via the
  `scripts/bump-version.sh`) |
| `docs/manual-de-usuario.md` | **Modified**: the new
  Recipes section (the tabs, the recipes, the URL import, the
  weekly menu, the shopping list) — the
  AGENTS.md's rule 3 |
| `docs/adr-076-seccion-recetas-menu-semanal-lista-compra.md` | **New**: this document |

Related issue: #64 — https://github.com/gonzalitojh/Registro-personal/issues/64
