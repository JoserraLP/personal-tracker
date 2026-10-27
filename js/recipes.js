// =============================================================
// Recetas section (issue #64) — «Recetas» tab.
// Handles the recipe list with search, the add/edit/import modal,
// the ingredient catalog and the user's custom tags
// (users/{uid}/tags).
//
// Pattern: like profile.js, it is wired from app.js via
// setupRecipes({ ctx }), which returns the view-opening API
// ({ openRecipes({ tab }) }) for the router and the sidebar.
// =============================================================

import { navigate } from "./router.js";
import { trapFocus } from "./focus-utils.js";
import { showToast } from "./ui.js";
import {
  INGREDIENT_CATEGORIES,
  ALERGEN_TAGS,
  MEAL_TYPES,
  SUPERMARKETS,
  CUSTOM_CATEGORY_ICON,
  UNCATEGORIZED_ICON,
  SHOPPING_UNITS,
  normalizeIngredientName,
  normalizeUnit,
  mergeTags,
  tagsByIds,
  escapeHtml,
  formatCantidad,
} from "./recipes-data.js";

// Predefined tags by scope (the custom tag type matches
// the selector's scope: "ingrediente" | "alergeno" | "tipo").
const PRESET_BY_SCOPE = {
  ingrediente: INGREDIENT_CATEGORIES,
  alergeno: ALERGEN_TAGS,
  tipo: MEAL_TYPES,
};

// ---------- Module state ----------

let currentUser = null;
let ctx = null;
let recipes = [];
let ingredients = [];
let customTags = [];
// Active Recetas tab (issue #209): the ingredient catalog
// lives in its own tab, so it is only re-rendered if it is on
// screen when new data arrives.
let currentTab = "recetas";
// Ingredient catalog state (issue #218): categories
// selected in the filter (all by default). The "touched" flag
// prevents freshly loaded own categories from breaking the selection
// made by the user. (The sort selector was removed in
// issue #224: the catalog always shows in alphabetical order.)
let ingredientFilterTouched = false;
let activeCategoryFilter = new Set(INGREDIENT_CATEGORIES.map((c) => c.id));
let ingredientModalCleanup = null;
let modalCleanup = null;
let editingRecipeId = null;
let modalReadOnly = false;
// Ingredient window mode (issue #232): true while editing. The
// backdrop/Escape close only applies in read mode (recipe window
// pattern, issue #234); while editing the exits are the ✕,
// «Cancelar» and «Guardar».
let ingredientEditMode = false;
// «Add to shopping list» mode (issue #249): like editing, the
// backdrop/Escape close is blocked while the amount and unit form is
// open.
let ingredientShoppingMode = false;
// Shopping list adder (issue #249): registered by
// shopping-list.js with registerShoppingListAdder; the ingredient
// modal uses it to persist the item (avoids recipes.js importing
// shopping-list.js, which in turn imports recipes.js).
let shoppingListAdder = null;
let onRecipeDeleted = null;
// Recetas tab filters (issue #234): allergens and meal type,
// multi-select with «all» checked by default. The "touched" flag
// prevents freshly loaded own tags from breaking the selection made
// by the user (pattern of ingredientFilterTouched).
let recipeFilterTouched = false;
let activeAlergenoFilter = new Set(ALERGEN_TAGS.map((t) => t.id));
let activeTipoFilter = new Set(MEAL_TYPES.map((t) => t.id));

// Renderers of the other tabs (registered by menu.js and
// shopping-list.js): openRecipes calls them when activating their tab.
const tabRenderers = {};

export function registerTabRenderer(tab, fn) {
  tabRenderers[tab] = fn;
}

export function getRecipes() {
  return recipes;
}

// User's custom tags (users/{uid}/tags). The Menú tab
// (menu.js) needs them for the recipe search box (issue #242).
export function getCustomTags() {
  return customTags;
}

// Ingredient catalog (users/{uid}/ingredients). The shopping list
// (shopping-list.js) queries it for the package amount
// (issue #225): paqueteCantidad + paqueteUnidad (issue #224).
export function getIngredients() {
  return ingredients;
}

// Registers the shopping list «adder» (issue #249): the
// function that persists an item added from the ingredient modal.
// shopping-list.js registers it in setupShoppingList; recipes.js
// invokes it when confirming the amount and unit window. This way
// no circular dependency is created (shopping-list.js already
// imports recipes.js) and the ingredient modal does not know the
// implementation.
export function registerShoppingListAdder(fn) {
  shoppingListAdder = fn;
}

// Clears the local state (called by app.js on logout, so the previous
// user's data is not shown to the next one).
export function resetRecipesData() {
  recipes = [];
  ingredients = [];
  customTags = [];
  currentTab = "recetas";
  ingredientFilterTouched = false;
  activeCategoryFilter = new Set(INGREDIENT_CATEGORIES.map((c) => c.id));
  recipeFilterTouched = false;
  activeAlergenoFilter = new Set(ALERGEN_TAGS.map((t) => t.id));
  activeTipoFilter = new Set(MEAL_TYPES.map((t) => t.id));
  closeIngredientModal();
  closeIngredientFilterPanel();
  closeRecipeAlergenoFilterPanel();
  closeRecipeTipoFilterPanel();
}

export function notifyRecipesChanged() {
  if (tabRenderers.menu) tabRenderers.menu();
  if (tabRenderers.compra) tabRenderers.compra();
}

// ---------- Setup ----------

export function setupRecipes(opts) {
  ctx = opts?.ctx || null;
  onRecipeDeleted = opts?.onRecipeDeleted || null;

  document.getElementById("btn-new-recipe").addEventListener("click", () => openRecipeModal());

  // Inner subtabs: the UI only navigates; the router (fromRouter) does
  // the render. Identical pattern to the profile (profile.js).
  document.querySelectorAll("[data-recipes-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate({ section: "recetas", tab: btn.dataset.recipesTab });
    });
  });

  // Recipe modal: close via ✕, backdrop and Escape.
  document.getElementById("recipe-modal-close").addEventListener("click", closeRecipeModal);
  // Backdrop and Escape (issue #234): they only close in read mode.
  // While editing they are blocked to not lose the form progress; the
  // ✕ and «Cancelar» remain the explicit close paths.
  document.getElementById("recipe-modal-backdrop").addEventListener("click", () => {
    if (modalReadOnly) closeRecipeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("recipe-modal").classList.contains("hidden") && modalReadOnly) {
      e.preventDefault();
      closeRecipeModal();
    }
  });

  // Ingredient modal (issue #218): close via ✕, backdrop and Escape.
  // Backdrop and Escape (issue #232): they only close in read mode;
  // while editing they are blocked to not lose the form progress
  // (the ✕, «Cancelar» and «Guardar» are the explicit paths).
  document.getElementById("ingredient-modal-close").addEventListener("click", closeIngredientModal);
  document.getElementById("ingredient-modal-backdrop").addEventListener("click", () => {
    if (!ingredientEditMode && !ingredientShoppingMode) closeIngredientModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("ingredient-modal").classList.contains("hidden") && !ingredientEditMode && !ingredientShoppingMode) {
      e.preventDefault();
      closeIngredientModal();
    }
  });

  // Toolbar of the ingredient catalog (issue #218).
  document.getElementById("btn-new-ingredient").addEventListener("click", () => openIngredientModal(null));
  setupIngredientFilter();

  // Action delegation of the ingredient cards: the card is
  // a <button> with the name; pressing it opens the detail modal.
  document.getElementById("ingredients-catalog").addEventListener("click", (e) => {
    const card = e.target.closest("[data-ingredient-id]");
    if (!card) return;
    openIngredientModal(card.dataset.ingredientId);
  });

  // Action delegation of the recipe cards (issue #234): the whole
  // card is the button; pressing it opens the detail in read-only
  // mode (there are no View/Edit/Delete buttons on the card anymore).
  document.getElementById("recipes-list").addEventListener("click", (e) => {
    const card = e.target.closest("[data-recipe-id]");
    if (!card) return;
    const recipe = recipes.find((r) => r.id === card.dataset.recipeId);
    if (!recipe) return;
    openRecipeModal(recipe, { readOnly: true });
  });
  // Keyboard support for the card (role="button" + tabindex): Enter
  // or Space opens the detail like the click.
  document.getElementById("recipes-list").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest("[data-recipe-id]");
    if (!card) return;
    e.preventDefault();
    const recipe = recipes.find((r) => r.id === card.dataset.recipeId);
    if (!recipe) return;
    openRecipeModal(recipe, { readOnly: true });
  });

  setupRecipeFilters();

  return { openRecipes };
}

// Starts the real-time subscriptions (called by app.js after login,
// like the rest of the libraries). Returns the cancellation
// function.
export function subscribeRecipesData(uid, onChange, onError) {
  currentUser = uid;
  const subs = [];

  subs.push(ctx.subscribeToRecipes(uid, (items) => {
    recipes = items;
    renderRecipesList();
    // The catalog shows which recipes use each ingredient:
    // refresh it if the Ingredientes tab is on screen.
    if (currentTab === "ingredientes") renderIngredientsCatalog();
    notifyRecipesChanged();
    if (onChange) onChange();
  }, onError));

  subs.push(ctx.subscribeToIngredients(uid, (items) => {
    ingredients = items;
    if (currentTab === "ingredientes") renderIngredientsCatalog();
  }, onError));

  subs.push(ctx.subscribeToTags(uid, (items) => {
    customTags = items;
    // The default filter includes all the tags: if the user has not
    // touched it yet, the freshly loaded own ones are added to the
    // Sets of the Recetas tab filters (issue #234) and to the ones
    // of the Ingredientes catalog.
    if (!ingredientFilterTouched) {
      ingredientFilterCategoryIds().forEach((id) => activeCategoryFilter.add(id));
      if (currentTab === "ingredientes") {
        updateIngredientFilterLabel();
        renderIngredientsCatalog();
      }
    }
    if (!recipeFilterTouched) {
      recipeFilterTagIds("alergeno").forEach((id) => activeAlergenoFilter.add(id));
      recipeFilterTagIds("tipo").forEach((id) => activeTipoFilter.add(id));
      if (currentTab === "recetas") {
        updateRecipeAlergenoFilterLabel();
        updateRecipeTipoFilterLabel();
      }
    }
    renderRecipesList();
  }, onError));

  return () => subs.forEach((unsub) => unsub && unsub());
}

// ---------- Opening / closing of the view ----------

export function openRecipes({ tab = "recetas", fromRouter = false } = {}) {
  if (!fromRouter) {
    navigate({ section: "recetas", tab });
  }
  currentTab = tab;
  document.getElementById("app").classList.add("hidden");
  document.getElementById("profile-view").classList.add("hidden");
  document.getElementById("recipes-view").classList.remove("hidden");

  document.querySelectorAll("[data-recipes-tab]").forEach((btn) => {
    const isActive = btn.dataset.recipesTab === tab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  const panels = {
    recetas: "panel-recipes-tab",
    ingredientes: "panel-ingredients-tab",
    menu: "panel-menu-tab",
    compra: "panel-shopping-tab",
  };
  Object.entries(panels).forEach(([key, panelId]) => {
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle("hidden", key !== tab);
  });

  // If the filter panels were left open, close them when
  // switching tabs (avoids stale state when coming back).
  if (tab !== "ingredientes") closeIngredientFilterPanel();
  if (tab !== "recetas") {
    closeRecipeAlergenoFilterPanel();
    closeRecipeTipoFilterPanel();
  }

  if (tab === "recetas") {
    renderRecipesList();
  } else if (tab === "ingredientes") {
    renderIngredientsCatalog();
  } else if (tabRenderers[tab]) {
    tabRenderers[tab]();
  }
}

// ---------- Recetas tab: list ----------

// Recipe search for the header's global search box
// (issue #206): the top search is scoped to the active section,
// so from Recetas it filters the local list. Reuses the tab
// filter (name, ingredient and tag).
export function searchRecipes(query) {
  return filterRecipes(recipes, query.trim().toLowerCase());
}

function renderRecipesList() {
  const container = document.getElementById("recipes-list");
  if (!container) return;

  if (!recipes.length) {
    container.innerHTML = `<p class="empty-state">Aún no hay recetas. Pulsa «+ Nueva receta» para crear la primera.</p>`;
    return;
  }

  // Tab filters (issue #234): allergens and meal type.
  const filtered = recipes.filter((r) => recipeMatchesAlergenoFilter(r) && recipeMatchesTipoFilter(r));
  if (!filtered.length) {
    container.innerHTML = `<p class="empty-state">Ninguna receta coincide con los filtros seleccionados.
      Ajusta los filtros de alérgenos o tipo de comida para ver más.</p>`;
    return;
  }

  container.innerHTML = `<div class="recipes-grid">
    ${filtered.map(recipeCardHtml).join("")}
  </div>`;
}

// Match of a recipe against the allergen filter (issue #234):
// with «all» selected (default) everything passes; otherwise the
// recipe must be tagged with at least one of the chosen allergens.
// Recipes with no allergens tagged always pass (like uncategorized
// ingredients in the catalog). Same criterion for the meal type.
function recipeMatchesAlergenoFilter(r) {
  if (recipeFilterAllChecked(activeAlergenoFilter, "alergeno")) return true;
  return !(r.alergenos || []).length || (r.alergenos || []).some((id) => activeAlergenoFilter.has(id));
}

function recipeMatchesTipoFilter(r) {
  if (recipeFilterAllChecked(activeTipoFilter, "tipo")) return true;
  return !(r.tipos || []).length || (r.tipos || []).some((id) => activeTipoFilter.has(id));
}

// Search: by name, by ingredient (recipes using it) and by
// tags (allergens, types and ingredient categories).
function filterRecipes(items, filter) {
  if (!filter) return items;
  const q = filter.toLowerCase();
  return items.filter((r) => {
    if ((r.nombre || "").toLowerCase().includes(q)) return true;
    const ingNames = (r.ingredientes || [])
      .map((i) => normalizeIngredientName(i.nombre).toLowerCase());
    if (ingNames.some((n) => n.includes(q))) return true;
    const tagNames = [
      ...(r.alergenos || []).map((id) => tagLabel("alergeno", id).toLowerCase()),
      ...(r.tipos || []).map((id) => tagLabel("tipo", id).toLowerCase()),
      ...(r.ingredientes || []).map((i) => tagLabel("ingrediente", i.categoriaId).toLowerCase()),
    ];
    return tagNames.some((t) => t && t.includes(q));
  });
}

function recipeCardHtml(r) {
  const alergenos = tagsByIds(ALERGEN_TAGS, customTags, r.alergenos || []);
  const tipos = tagsByIds(MEAL_TYPES, customTags, r.tipos || []);
  const badge = r.needsReview
    ? `<span class="recipe-card__badge" title="Importada desde una URL, pendiente de revisar">Revisar</span>`
    : "";
  // The whole card is the button (issue #234): pressing it opens the
  // detail in read mode. role="button" + tabindex for keyboard.
  // The tags carry the same color by type as in the read view
  // (issue #236, iteration): allergens in teal and type in ochre.
  const alergenoTags = alergenos.map((t) => `<span class="recipe-card__tag recipe-card__tag--alergeno">${escapeHtml(t.label)}</span>`).join("");
  const tipoTags = tipos.map((t) => `<span class="recipe-card__tag recipe-card__tag--tipo">${escapeHtml(t.label)}</span>`).join("");
  return `<article class="recipe-card${r.needsReview ? " recipe-card--review" : ""}"
    role="button" tabindex="0" data-recipe-id="${r.id}"
    aria-label="Ver receta ${escapeHtml(r.nombre)}">
    <div class="recipe-card__top">
      <h3 class="recipe-card__title">${escapeHtml(r.nombre)}</h3>
      ${badge}
    </div>
    ${r.fotoUrl ? `<img class="recipe-card__photo" src="${escapeHtml(r.fotoUrl)}" alt="" loading="lazy" />` : ""}
    <p class="recipe-card__meta">
      ${Number(r.porciones) ? `${formatCantidad(r.porciones)} porciones` : ""}
      ${r.ingredientes?.length ? ` · ${r.ingredientes.length} ingredientes` : ""}
    </p>
    ${(alergenoTags || tipoTags) ? `<p class="recipe-card__tags">${alergenoTags}${tipoTags}</p>` : ""}
  </article>`;
}

async function deleteRecipeFlow(recipe) {
  if (!confirm(`¿Eliminar la receta «${recipe.nombre}»?`)) return false;
  try {
    await ctx.deleteRecipe(currentUser, recipe.id);
    // Clean up references in the menus (if app.js injected the callback).
    if (onRecipeDeleted) onRecipeDeleted(recipe.id);
    showToast("Receta eliminada.");
    return true;
  } catch (err) {
    console.error("No se pudo eliminar la receta:", err);
    showToast("No se pudo eliminar la receta.");
    return false;
  }
}

function tagLabel(scope, id) {
  if (!id) return "";
  const preset = PRESET_BY_SCOPE[scope].find((t) => t.id === id);
  if (preset) return preset.label;
  const custom = customTags.find((t) => t.id === id);
  if (custom) return custom.nombre || custom.id;
  return id;
}

// ---------- Ingredient catalog («Ingredientes» tab, issue #209 / #218) ----------

// Recipe index by ingredient (recipes using each one). Used
// in the detail modal («Usada en»).
function getUsageIndex() {
  const byName = new Map();
  recipes.forEach((r) => {
    (r.ingredientes || []).forEach((i) => {
      const key = normalizeIngredientName(i.nombre);
      if (!byName.has(key)) byName.set(key, new Set());
      byName.get(key).add(r.id);
    });
  });
  return byName;
}

function renderIngredientsCatalog() {
  const container = document.getElementById("ingredients-catalog");
  if (!container) return;

  const sorted = [...ingredients].sort(compareIngredients);
  if (!sorted.length) {
    container.innerHTML = `<p class="empty-state">El catálogo de ingredientes se rellena solo: cada vez que guardas una
      receta con ingredientes, aparecen aquí para poder asignarles una categoría (y se usan para la lista de la compra).
      También puedes añadirlos a mano con «+ Nuevo ingrediente».</p>`;
    return;
  }

  // Category filter (issue #218): multi-select with all
  // selected by default. Ingredients without a category are
  // always shown (they are the entry bucket awaiting assignment).
  const filtered = sorted.filter(
    (ing) => !ing.categoriaId || activeCategoryFilter.has(ing.categoriaId)
  );
  if (!filtered.length) {
    container.innerHTML = `<p class="empty-state">Ningún ingrediente en las categorías seleccionadas.
      Ajusta el filtro de categorías para ver más.</p>`;
    return;
  }

  // Grouping by category (pattern of the shopping list): the
  // predefined ones in their order, the custom ones present in the
  // data by alphabetical label order and «Sin categoría» at the end.
  // Each title carries its icon (issue #224): the predefined
  // category's, the generic tag one for the own ones and the
  // «Sin categoría» one.
  const groups = new Map();
  INGREDIENT_CATEGORIES.forEach((c) => groups.set(c.id, []));
  groups.set("", []);
  filtered.forEach((ing) => {
    const key = ing.categoriaId || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ing);
  });
  const customGroupIds = [...groups.keys()]
    .filter((id) => id && !INGREDIENT_CATEGORIES.some((c) => c.id === id))
    .sort((a, b) => tagLabel("ingrediente", a).localeCompare(tagLabel("ingrediente", b), "es"));

  container.innerHTML = `<p class="ingredients-count" aria-live="polite">${filtered.length}
    ${filtered.length === 1 ? "ingrediente" : "ingredientes"}</p>
    ${INGREDIENT_CATEGORIES.map((c) => {
      const items = groups.get(c.id);
      if (!items?.length) return "";
      return `<section class="ingredient-group">
        <h3 class="ingredient-group__title"><span class="ingredient-group__icon" aria-hidden="true">${c.icon}</span>${escapeHtml(c.label)}</h3>
        <div class="ingredient-grid">
          ${items.map((ing) => ingredientCardHtml(ing)).join("")}
        </div>
      </section>`;
    }).join("")}
    ${customGroupIds.map((id) => `<section class="ingredient-group">
      <h3 class="ingredient-group__title"><span class="ingredient-group__icon" aria-hidden="true">${CUSTOM_CATEGORY_ICON}</span>${escapeHtml(tagLabel("ingrediente", id))}</h3>
      <div class="ingredient-grid">
        ${groups.get(id).map((ing) => ingredientCardHtml(ing)).join("")}
      </div>
    </section>`).join("")}
    ${groups.get("").length ? `<section class="ingredient-group">
      <h3 class="ingredient-group__title"><span class="ingredient-group__icon" aria-hidden="true">${UNCATEGORIZED_ICON}</span>Sin categoría</h3>
      <div class="ingredient-grid">
        ${groups.get("").map((ing) => ingredientCardHtml(ing)).join("")}
      </div>
    </section>` : ""}`;
}

// Catalog comparator: alphabetical A-Z order (es) with a
// deterministic id tie-break. (The sort selector was removed in
// issue #224 and this is the only order.)
function compareIngredients(a, b) {
  return a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id);
}

// Catalog card: shows only the name (issue #218); the
// extended information lives in the modal opened by pressing it.
function ingredientCardHtml(ing) {
  return `<button type="button" class="ingredient-card" data-ingredient-id="${ing.id}">${escapeHtml(ing.nombre)}</button>`;
}

// ---------- Category filter (issue #218) ----------

// Filter panel checkboxes: «Todas» + the categories (predefined
// and the user's own). The panel is painted only on open; later
// changes only toggle is-checked classes (no re-render) to not lose
// focus and to make the visual check immediate (iteration after a
// comment on issue #218: the filter applies and colors as you
// select, not when the panel closes).

// Ids of all the categories visible in the panel (predefined + own).
function ingredientFilterCategoryIds() {
  return mergeTags(
    INGREDIENT_CATEGORIES,
    customTags.filter((t) => t.tipo === "ingrediente")
  ).map((t) => t.id);
}

// «All» is checked if and only if ALL the categories of the panel
// (predefined and own) are in the filter.
function ingredientFilterAllChecked() {
  const ids = ingredientFilterCategoryIds();
  return ids.length > 0 && ids.every((id) => activeCategoryFilter.has(id));
}

function renderIngredientFilter() {
  const panel = document.getElementById("ingredient-filter-panel");
  if (!panel) return;
  const tags = mergeTags(
    INGREDIENT_CATEGORIES,
    customTags.filter((t) => t.tipo === "ingrediente")
  );
  const allChecked = ingredientFilterAllChecked();
  panel.innerHTML = `<label class="ingredients-filter__all${allChecked ? " is-checked" : ""}">
      <input type="checkbox" value="__all__"${allChecked ? " checked" : ""} />
      <span>Todas</span>
    </label>
    <div class="ingredients-filter__separator" role="presentation"></div>
    ${tags.map((t) => {
      const checked = activeCategoryFilter.has(t.id);
      return `<label class="ingredients-filter__item${checked ? " is-checked" : ""}">
        <input type="checkbox" value="${escapeHtml(t.id)}"${checked ? " checked" : ""} />
        <span>${escapeHtml(t.label)}${t.custom ? " (propia)" : ""}</span>
      </label>`;
    }).join("")}`;
}

function updateIngredientFilterLabel() {
  const label = document.getElementById("ingredient-filter-label");
  if (!label) return;
  if (ingredientFilterAllChecked()) {
    label.textContent = "Todas las categorías";
    return;
  }
  const n = activeCategoryFilter.size;
  label.textContent = `${n} ${n === 1 ? "categoría" : "categorías"}`;
}

// Check-state toggle of the «Todas» checkbox (checked only if all the
// panel's categories are).
function syncIngredientFilterAll() {
  const all = document.querySelector("#ingredient-filter-panel .ingredients-filter__all");
  if (!all) return;
  const checked = ingredientFilterAllChecked();
  all.classList.toggle("is-checked", checked);
  const input = all.querySelector("input");
  input.checked = checked;
}

// Real-time visual check of each checkbox (issue #218, iteration
// after a comment): the input is hidden (opacity: 0) and the only
// selected signal is the label's is-checked class, so it toggles at
// the moment of checking/unchecking, not when re-opening the panel.
// The source of truth is activeCategoryFilter, not input.checked:
// when pressing «Todas» the browser only updates that input, the
// others would get out of sync.
function syncIngredientFilterItems() {
  document.querySelectorAll("#ingredient-filter-panel .ingredients-filter__item").forEach((item) => {
    const input = item.querySelector("input");
    if (!input) return;
    const checked = activeCategoryFilter.has(input.value);
    item.classList.toggle("is-checked", checked);
    input.checked = checked;
  });
}

function closeIngredientFilterPanel() {
  const panel = document.getElementById("ingredient-filter-panel");
  const btn = document.getElementById("btn-ingredient-filter");
  if (!panel || panel.classList.contains("hidden")) return;
  panel.classList.add("hidden");
  btn?.setAttribute("aria-expanded", "false");
  // Unregister the panel's Escape (registered when opening it) so it
  // does not steal focus after external closes (openRecipes,
  // resetRecipesData).
  document.removeEventListener("keydown", escHandlerRef);
}

// Reference to the panel's Escape handler (registered when opening
// it); stored in the module so closeIngredientFilterPanel can
// unregister it without coupling the close to the setup.
let escHandlerRef = null;

function setupIngredientFilter() {
  const wrap = document.getElementById("ingredients-filter");
  const panel = document.getElementById("ingredient-filter-panel");
  const btn = document.getElementById("btn-ingredient-filter");
  if (!wrap || !panel || !btn) return;

  const escHandler = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeIngredientFilterPanel();
      btn.focus();
    }
  };
  escHandlerRef = escHandler;

  btn.addEventListener("click", () => {
    if (panel.classList.contains("hidden")) {
      renderIngredientFilter();
      panel.classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("keydown", escHandler);
    } else {
      closeIngredientFilterPanel();
      btn.focus();
    }
  });

  // Click outside the wrapper: close (profile dropdown pattern).
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target) && !panel.classList.contains("hidden")) {
      closeIngredientFilterPanel();
    }
  });

  panel.addEventListener("change", (e) => {
    const input = e.target.closest("input[type='checkbox']");
    if (!input) return;
    ingredientFilterTouched = true;
    if (input.value === "__all__") {
      activeCategoryFilter = input.checked
        ? new Set(ingredientFilterCategoryIds())
        : new Set();
    } else if (input.checked) {
      activeCategoryFilter.add(input.value);
    } else {
      activeCategoryFilter.delete(input.value);
    }
    // Visual check and live filter (issue #218, iteration): color the
    // selection and apply the filter as you select, not when the
    // panel closes.
    syncIngredientFilterItems();
    syncIngredientFilterAll();
    updateIngredientFilterLabel();
    renderIngredientsCatalog();
  });
}

// ---------- Recetas tab filters (issue #234) ----------

// Filter panel checkboxes: «Todas» + the tags
// (predefined and the user's own). Same pattern as the category
// filter of the ingredient catalog (issue #218): the panel is
// painted only on open; later changes only toggle is-checked
// classes (no re-render) and filtering applies live.

// Ids of all the tags visible in a scope's panel
// (predefined + own).
function recipeFilterTagIds(scope) {
  return mergeTags(
    PRESET_BY_SCOPE[scope],
    customTags.filter((t) => t.tipo === scope)
  ).map((t) => t.id);
}

// «All» is checked if and only if ALL the tags of the panel
// (predefined and own) are in the filter.
function recipeFilterAllChecked(activeSet, scope) {
  const ids = recipeFilterTagIds(scope);
  return ids.length > 0 && ids.every((id) => activeSet.has(id));
}

// Config of both filters (DOM element ids per scope).
const RECIPE_FILTER_UI = {
  alergeno: {
    btnId: "btn-recipe-alergeno-filter",
    panelId: "recipe-alergeno-filter-panel",
    labelId: "recipe-alergeno-filter-label",
  },
  tipo: {
    btnId: "btn-recipe-tipo-filter",
    panelId: "recipe-tipo-filter-panel",
    labelId: "recipe-tipo-filter-label",
  },
};

// Reference to each panel's Escape handlers (registered when opening
// them; stored so the close can unregister them).
const recipeFilterEscHandlers = {};

function recipeFilterActiveSet(scope) {
  return scope === "alergeno" ? activeAlergenoFilter : activeTipoFilter;
}

function recipeFilterSetActive(scope, set) {
  if (scope === "alergeno") activeAlergenoFilter = set;
  else activeTipoFilter = set;
}

function renderRecipeFilterPanel(scope) {
  const { panelId } = RECIPE_FILTER_UI[scope];
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const tags = mergeTags(
    PRESET_BY_SCOPE[scope],
    customTags.filter((t) => t.tipo === scope)
  );
  const activeSet = recipeFilterActiveSet(scope);
  const allChecked = recipeFilterAllChecked(activeSet, scope);
  panel.innerHTML = `<label class="recipes-filter__all${allChecked ? " is-checked" : ""}">
      <input type="checkbox" value="__all__"${allChecked ? " checked" : ""} />
      <span>Todos</span>
    </label>
    <div class="recipes-filter__separator" role="presentation"></div>
    ${tags.map((t) => {
      const checked = activeSet.has(t.id);
      return `<label class="recipes-filter__item${checked ? " is-checked" : ""}">
        <input type="checkbox" value="${escapeHtml(t.id)}"${checked ? " checked" : ""} />
        <span>${escapeHtml(t.label)}${t.custom ? " (propia)" : ""}</span>
      </label>`;
    }).join("")}`;
}

function updateRecipeAlergenoFilterLabel() {
  updateRecipeFilterLabel("alergeno");
}

function updateRecipeTipoFilterLabel() {
  updateRecipeFilterLabel("tipo");
}

function updateRecipeFilterLabel(scope) {
  const { labelId } = RECIPE_FILTER_UI[scope];
  const label = document.getElementById(labelId);
  if (!label) return;
  const activeSet = recipeFilterActiveSet(scope);
  if (recipeFilterAllChecked(activeSet, scope)) {
    label.textContent = scope === "alergeno" ? "Todos los alérgenos" : "Todos los tipos";
    return;
  }
  const n = activeSet.size;
  const word = scope === "alergeno" ? "alérgeno" : "tipo";
  label.textContent = `${n} ${n === 1 ? word : word + "s"}`;
}

// Check-state toggle of the «Todas» checkbox (checked only if all the
// panel's tags are).
function syncRecipeFilterAll(scope) {
  const { panelId } = RECIPE_FILTER_UI[scope];
  const all = document.querySelector(`#${panelId} .recipes-filter__all`);
  if (!all) return;
  const checked = recipeFilterAllChecked(recipeFilterActiveSet(scope), scope);
  all.classList.toggle("is-checked", checked);
  const input = all.querySelector("input");
  input.checked = checked;
}

// Real-time visual check of each checkbox (pattern of
// syncIngredientFilterItems): the source of truth is the active Set,
// not input.checked.
function syncRecipeFilterItems(scope) {
  const { panelId } = RECIPE_FILTER_UI[scope];
  const activeSet = recipeFilterActiveSet(scope);
  document.querySelectorAll(`#${panelId} .recipes-filter__item`).forEach((item) => {
    const input = item.querySelector("input");
    if (!input) return;
    const checked = activeSet.has(input.value);
    item.classList.toggle("is-checked", checked);
    input.checked = checked;
  });
}

function closeRecipeFilterPanel(scope) {
  const { panelId, btnId } = RECIPE_FILTER_UI[scope];
  const panel = document.getElementById(panelId);
  const btn = document.getElementById(btnId);
  if (!panel || panel.classList.contains("hidden")) return;
  panel.classList.add("hidden");
  btn?.setAttribute("aria-expanded", "false");
  if (recipeFilterEscHandlers[scope]) {
    document.removeEventListener("keydown", recipeFilterEscHandlers[scope]);
    delete recipeFilterEscHandlers[scope];
  }
}

function closeRecipeAlergenoFilterPanel() {
  closeRecipeFilterPanel("alergeno");
}

function closeRecipeTipoFilterPanel() {
  closeRecipeFilterPanel("tipo");
}

function setupRecipeFilters() {
  ["alergeno", "tipo"].forEach((scope) => {
    const { btnId, panelId } = RECIPE_FILTER_UI[scope];
    const wrap = document.getElementById(`recipes-${scope}-filter`);
    const panel = document.getElementById(panelId);
    const btn = document.getElementById(btnId);
    if (!wrap || !panel || !btn) return;

    const escHandler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRecipeFilterPanel(scope);
        btn.focus();
      }
    };

    btn.addEventListener("click", () => {
      if (panel.classList.contains("hidden")) {
        renderRecipeFilterPanel(scope);
        panel.classList.remove("hidden");
        btn.setAttribute("aria-expanded", "true");
        recipeFilterEscHandlers[scope] = escHandler;
        document.addEventListener("keydown", escHandler);
      } else {
        closeRecipeFilterPanel(scope);
        btn.focus();
      }
    });

    // Click outside the wrapper: close (profile dropdown pattern).
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target) && !panel.classList.contains("hidden")) {
        closeRecipeFilterPanel(scope);
      }
    });

    panel.addEventListener("change", (e) => {
      const input = e.target.closest("input[type='checkbox']");
      if (!input) return;
      recipeFilterTouched = true;
      if (input.value === "__all__") {
        recipeFilterSetActive(
          scope,
          input.checked ? new Set(recipeFilterTagIds(scope)) : new Set()
        );
      } else if (input.checked) {
        recipeFilterActiveSet(scope).add(input.value);
      } else {
        recipeFilterActiveSet(scope).delete(input.value);
      }
      // Visual check and live filter (catalog pattern).
      syncRecipeFilterAll(scope);
      syncRecipeFilterItems(scope);
      updateRecipeFilterLabel(scope);
      renderRecipesList();
    });
  });
}

// ---------- Ingredient modal (issue #218) ----------

// Available units for the package amount (issue #224); the first
// empty option («—») means unspecified.
const PACKAGE_UNITS = ["", "g", "Kg", "mL", "L", "unidades"];

// Supermarket chips (issue #224): the same labels in the add form
// and the detail. `selected` are the checked ids (in the add, none).
function supermarketChipsHtml(selected = []) {
  return SUPERMARKETS.map((s) => {
    const checked = selected.includes(s.id);
    return `<label class="supermarket-chip supermarket-chip--${s.id}${checked ? " is-checked" : ""}" data-supermercado="${s.id}">
      <input type="checkbox" value="${s.id}"${checked ? " checked" : ""} />
      <span>${escapeHtml(s.label)}</span>
    </label>`;
  }).join("");
}

// «Package amount» row (number + unit, issue #224): the ids
// are the same in the add form and the detail to reuse reads.
function packageQtyRowHtml(ing = {}) {
  const cantidad = ing.paqueteCantidad ?? "";
  const unidad = ing.paqueteUnidad || "";
  return `<div class="ingredient-modal__qty-row">
    <input type="number" id="ing-modal-paquete" min="0" step="any" placeholder="Cantidad" value="${escapeHtml(cantidad)}" />
    <select id="ing-modal-unidad" aria-label="Unidad de la cantidad del paquete">
      ${PACKAGE_UNITS.map((u) => `<option value="${escapeHtml(u)}"${u === unidad ? " selected" : ""}>${u === "" ? "—" : escapeHtml(u)}</option>`).join("")}
    </select>
  </div>`;
}

// Opens the ingredient modal: with id = extended detail (category,
// recipes using it, delete); without id = manual add. By default
// (issue #232) the detail is shown in read mode; with `edit: true`
// it opens the edit view directly. `onCreated` (issue #240) is
// called when saving a manual add, with the freshly created
// ingredient ({ nombre, categoriaId }), so the recipe form can use
// it right away. With `shopping: true` (issue #249) it opens the
// amount and unit window to add the ingredient to the shopping list.
function openIngredientModal(id, { edit = false, onCreated = null, shopping = false } = {}) {
  const modal = document.getElementById("ingredient-modal");
  const content = document.getElementById("ingredient-modal-content");
  const ingredient = id ? ingredients.find((i) => i.id === id) : null;
  const wasHidden = modal.classList.contains("hidden");
  ingredientEditMode = edit;
  ingredientShoppingMode = shopping;

  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    ingredient
      ? (shopping
          ? `Añadir ${ingredient.nombre} a la lista de la compra`
          : `Ingrediente: ${ingredient.nombre}`)
      : "Nuevo ingrediente"
  );
  content.innerHTML = ingredient
    ? (shopping
        ? ingredientShoppingHtml(ingredient)
        : (edit ? ingredientEditHtml(ingredient) : ingredientDetailHtml(ingredient)))
    : ingredientNewHtml();
  bindIngredientModalHandlers(content, ingredient, onCreated);

  if (wasHidden) {
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
  }
  // Hot re-render (read → edit or vice versa): release the previous
  // focus trap before creating the new one.
  if (ingredientModalCleanup) ingredientModalCleanup();
  ingredientModalCleanup = trapFocus(modal.querySelector(".modal__card"));
  // In the manual add, when entering editing and in the add-to-shopping
  // window, focus directly on the first field: it happens in a second
  // rAF after the trapFocus one (which focuses the ✕, the first
  // focusable): callbacks of the same frame run in order, so the final
  // focus ends on the input and the trap is not broken.
  if (!ingredient || edit || shopping) {
    requestAnimationFrame(() => {
      content.querySelector("#ing-modal-nombre")?.focus({ preventScroll: false });
      content.querySelector("#ing-shopping-cantidad")?.focus({ preventScroll: false });
    });
  }
}

function closeIngredientModal() {
  const modal = document.getElementById("ingredient-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  ingredientEditMode = false;
  ingredientShoppingMode = false;
  if (ingredientModalCleanup) {
    ingredientModalCleanup();
    ingredientModalCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
}

// Read-only view of the ingredient window (issue #232): the name as
// title, the photo only if it exists (no placeholder nor "no image"
// when there is none), the category and the package amount as text
// and the supermarkets as non-interactive tags. Without a «Close»
// button (the ✕ remains) and without the text «Categoría actual: …».
function ingredientDetailHtml(ing) {
  const byName = getUsageIndex();
  const usedRecipes = recipes.filter((r) =>
    (byName.get(normalizeIngredientName(ing.nombre)) || new Set()).has(r.id)
  );
  const catLabel = tagLabel("ingrediente", ing.categoriaId);
  const qtyText = ing.paqueteCantidad != null && ing.paqueteCantidad !== ""
    ? `${ing.paqueteCantidad}${ing.paqueteUnidad ? ` ${ing.paqueteUnidad}` : ""}`
    : "Sin indicar";
  const supers = (ing.supermercados || [])
    .map((id) => SUPERMARKETS.find((s) => s.id === id))
    .filter(Boolean);
  return `<div class="ingredient-modal__view">
    ${ing.fotoUrl ? `<img class="ingredient-modal__photo" src="${escapeHtml(ing.fotoUrl)}" alt="" loading="lazy" />` : ""}
    <h3 class="ingredient-modal__title">${escapeHtml(ing.nombre)}</h3>
    <div class="ingredient-modal__field">
      <span class="ingredient-modal__label">Categoría</span>
      <p class="ingredient-modal__text">${catLabel ? escapeHtml(catLabel) : "Sin categoría"}</p>
    </div>
    <div class="ingredient-modal__field">
      <span class="ingredient-modal__label">Supermercados</span>
      ${supers.length
        ? `<div class="ingredient-modal__chips">${supers.map((s) => `<span class="supermarket-tag supermarket-tag--${s.id}">${escapeHtml(s.label)}</span>`).join("")}</div>`
        : `<p class="ingredient-modal__text">Sin indicar</p>`}
    </div>
    <div class="ingredient-modal__field">
      <span class="ingredient-modal__label">Cantidad del paquete</span>
      <p class="ingredient-modal__text">${escapeHtml(qtyText)}</p>
    </div>
    ${usedRecipes.length ? `<p class="ingredient-modal__used">Usada en ${usedRecipes.length}
      ${usedRecipes.length === 1 ? "receta" : "recetas"}:
      ${usedRecipes.map((r) =>
        `<button type="button" class="ingredient-modal__link" data-recipe-id="${r.id}">${escapeHtml(r.nombre)}</button>`).join(", ")}</p>`
      : `<p class="ingredient-modal__used">No se usa en ninguna receta aún.</p>`}
    <div class="ingredient-modal__actions">
      <button type="button" class="btn btn--small btn--primary" data-ing-shopping>🛒 Añadir a la lista de la compra</button>
      <button type="button" class="btn btn--small btn--danger" data-ing-delete>Eliminar</button>
      <button type="button" class="btn btn--small" data-ing-edit>✏️ Editar</button>
    </div>
  </div>`;
}

// Edit view of the ingredient window (issue #232): name, photo
// (URL), category, supermarkets and package amount are edited, and
// all saved together with «Guardar» (unlike the previous immediate
// save, here the form persists as a block).
function ingredientEditHtml(ing) {
  return `<form id="ingredient-edit-form" class="ingredient-modal__form">
    <h3 class="ingredient-modal__title">Editar ingrediente</h3>
    <div class="ingredient-modal__field">
      <label for="ing-modal-nombre">Nombre *</label>
      <input type="text" id="ing-modal-nombre" required maxlength="200" autocomplete="off"
             value="${escapeHtml(ing.nombre)}" />
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-modal-foto">Foto (URL)</label>
      <input type="url" id="ing-modal-foto" placeholder="https://…" autocomplete="off"
             value="${escapeHtml(ing.fotoUrl || "")}" />
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-modal-categoria">Categoría</label>
      <select id="ing-modal-categoria" aria-label="Categoría de ${escapeHtml(ing.nombre)}">
        ${optionsFor("ingrediente", ing.categoriaId)}
      </select>
    </div>
    <div class="ingredient-modal__field">
      <label>Supermercados</label>
      <div class="ingredient-modal__chips">
        ${supermarketChipsHtml(ing.supermercados || [])}
      </div>
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-modal-paquete">Cantidad del paquete</label>
      ${packageQtyRowHtml(ing)}
    </div>
    <div class="ingredient-modal__actions">
      <button type="button" class="btn btn--small btn--outline" data-ing-cancel>Cancelar</button>
      <button type="submit" class="btn btn--small btn--primary">Guardar</button>
    </div>
  </form>`;
}

function ingredientNewHtml() {
  return `<form id="ingredient-new-form" class="ingredient-modal__form">
    <h3 class="ingredient-modal__title">Nuevo ingrediente</h3>
    <div class="ingredient-modal__field">
      <label for="ing-modal-nombre">Nombre *</label>
      <input type="text" id="ing-modal-nombre" required maxlength="200" autocomplete="off"
             placeholder="P. ej. azúcar moreno" />
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-modal-categoria-nueva">Categoría</label>
      <select id="ing-modal-categoria-nueva" aria-label="Categoría del nuevo ingrediente">
        ${optionsFor("ingrediente", "")}
      </select>
    </div>
    <div class="ingredient-modal__field">
      <label>Supermercados</label>
      <div class="ingredient-modal__chips">
        ${supermarketChipsHtml()}
      </div>
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-modal-paquete">Cantidad del paquete</label>
      ${packageQtyRowHtml()}
    </div>
    <p class="ingredient-modal__cat-hint">Si el ingrediente ya está en el catálogo, no se añadirá otra vez.</p>
    <div class="ingredient-modal__actions">
      <button type="button" class="btn btn--small" data-ing-close>Cancelar</button>
      <button type="submit" class="btn btn--small btn--primary">Guardar</button>
    </div>
  </form>`;
}

// «Add to shopping list» view (issue #249): it only asks for amount
// and measurement unit. The name, the category and whether it is
// edible or not are taken from the catalog ingredient (which is the
// one who knows them); persistence is done by the adder registered
// by shopping-list.js (registerShoppingListAdder).
function ingredientShoppingHtml(ing) {
  return `<form id="ingredient-shopping-form" class="ingredient-modal__form">
    <h3 class="ingredient-modal__title">Añadir a la lista de la compra</h3>
    <div class="ingredient-modal__field">
      <span class="ingredient-modal__label">Ingrediente</span>
      <p class="ingredient-modal__text">${escapeHtml(ing.nombre)}</p>
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-shopping-cantidad">Cantidad</label>
      <input type="number" id="ing-shopping-cantidad" min="0" step="any" placeholder="P. ej. 250" />
    </div>
    <div class="ingredient-modal__field">
      <label for="ing-shopping-unidad">Unidad de medida</label>
      <select id="ing-shopping-unidad">
        ${SHOPPING_UNITS.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("")}
      </select>
    </div>
    <div class="ingredient-modal__actions">
      <button type="button" class="btn btn--small btn--outline" data-ing-shopping-cancel>Cancelar</button>
      <button type="submit" class="btn btn--small btn--primary">Añadir a la lista</button>
    </div>
  </form>`;
}

function bindIngredientModalHandlers(content, ingredient, onCreated = null) {
  content.querySelector("[data-ing-close]")?.addEventListener("click", closeIngredientModal);

  // Editing (issue #232): Cancel goes back to the read view without
  // saving; the Save form persists as a block all the fields.
  content.querySelector("[data-ing-cancel]")?.addEventListener("click", () => {
    openIngredientModal(ingredient.id);
  });

  // Supermarket chips: the visual check changes instantly in the add
  // form and the editing; the edit save is done as a block with
  // «Guardar» (issue #232), not immediately.
  content.querySelectorAll(".ingredient-modal__chips").forEach((chips) => {
    chips.addEventListener("change", (e) => {
      const label = e.target.closest("[data-supermercado]");
      if (!label) return;
      label.classList.toggle("is-checked", e.target.checked);
    });
  });

  // Read view (issue #232): the pencil switches to edit mode; the
  // lower «Close» button is gone (the top ✕ remains).
  content.querySelector("[data-ing-edit]")?.addEventListener("click", () => {
    openIngredientModal(ingredient.id, { edit: true });
  });

  // Add to the shopping list (issue #249): the detail's button opens
  // the amount and unit window; «Cancel» goes back to the detail.
  content.querySelector("[data-ing-shopping]")?.addEventListener("click", () => {
    openIngredientModal(ingredient.id, { shopping: true });
  });
  content.querySelector("[data-ing-shopping-cancel]")?.addEventListener("click", () => {
    openIngredientModal(ingredient.id);
  });
  // Confirmar: name, category and edibility are taken from the
  // catalog ingredient; only amount and unit are chosen. An empty
  // amount is stored as null (line with no computed amount).
  content.querySelector("#ingredient-shopping-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const cantidadRaw = content.querySelector("#ing-shopping-cantidad").value;
    const cantidad = cantidadRaw === "" ? null : Number(cantidadRaw);
    const unidad = normalizeUnit(content.querySelector("#ing-shopping-unidad").value);
    if (!shoppingListAdder) {
      showToast("No se pudo añadir a la lista de la compra.");
      return;
    }
    try {
      await shoppingListAdder({
        nombre: ingredient.nombre,
        cantidad,
        unidad,
        categoriaId: ingredient.categoriaId || "",
        comestible: (ingredient.categoriaId || "") !== "hogar",
      });
      closeIngredientModal();
      showToast("Añadido a la lista de la compra.");
    } catch (err) {
      console.error("No se pudo añadir a la lista de la compra:", err);
      showToast("No se pudo añadir a la lista de la compra.");
    }
  });
  content.querySelector("[data-ing-delete]")?.addEventListener("click", async () => {
    if (!confirm(`¿Eliminar el ingrediente «${ingredient.nombre}» del catálogo? No afecta a las recetas que lo usan.`)) return;
    try {
      await ctx.deleteIngredient(currentUser, ingredient.id);
      closeIngredientModal();
      showToast("Ingrediente eliminado del catálogo.");
    } catch (err) {
      console.error("No se pudo eliminar el ingrediente:", err);
      showToast("No se pudo eliminar el ingrediente.");
    }
  });

  // Block save of the edit view (issue #232): name, photo (URL),
  // category, supermarkets and package amount are persisted at once
  // with updateIngredient; then the read view shows again with the
  // saved data.
  content.querySelector("#ingredient-edit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = content.querySelector("#ing-modal-nombre").value.trim();
    if (!nombre) return;
    const fotoUrl = content.querySelector("#ing-modal-foto").value.trim();
    const categoriaId = content.querySelector("#ing-modal-categoria").value;
    const supermercados = [...content.querySelectorAll(".ingredient-modal__chips input:checked")].map((i) => i.value);
    const qtyRaw = content.querySelector("#ing-modal-paquete").value;
    const qtyNum = qtyRaw === "" ? null : Number(qtyRaw);
    const paqueteCantidad = qtyNum !== null && Number.isFinite(qtyNum) && qtyNum >= 0 ? qtyNum : null;
    const paqueteUnidad = content.querySelector("#ing-modal-unidad").value;
    try {
      await ctx.updateIngredient(currentUser, ingredient.id, {
        nombre, fotoUrl, categoriaId, supermercados, paqueteCantidad, paqueteUnidad,
      });
      // Immediate local refresh (the Firestore snapshot arrives
      // later): the read view already shows the saved data.
      const idx = ingredients.findIndex((i) => i.id === ingredient.id);
      if (idx !== -1) {
        ingredients[idx] = { ...ingredients[idx], nombre, fotoUrl, categoriaId, supermercados, paqueteCantidad, paqueteUnidad };
      }
      openIngredientModal(ingredient.id);
      showToast("Ingrediente actualizado.");
    } catch (err) {
      console.error("No se pudo actualizar el ingrediente:", err);
      showToast("No se pudo actualizar el ingrediente.");
    }
  });

  // «Usada en» links: they open the recipe in read mode; the
  // ingredient modal closes first (both share the z-index).
  content.querySelectorAll("[data-recipe-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const recipe = recipes.find((r) => r.id === btn.dataset.recipeId);
      if (!recipe) return;
      closeIngredientModal();
      openRecipeModal(recipe, { readOnly: true });
    });
  });

  // Manual add: the name is saved exactly as typed (accents and
  // capitals, issue #224); deduplication still follows the normalized
  // name (no accents, lowercase).
  content.querySelector("#ingredient-new-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = content.querySelector("#ing-modal-nombre").value.trim();
    if (!raw) return;
    const nombre = raw;
    const exists = ingredients.some((i) => normalizeIngredientName(i.nombre) === normalizeIngredientName(raw));
    if (exists) {
      showToast("Ese ingrediente ya existe en el catálogo.");
      return;
    }
    const categoriaId = content.querySelector("#ing-modal-categoria-nueva").value;
    // Optional fields (issue #224): checked supermarkets (array of
    // ids) and package amount (number, empty → null; unit).
    const supermercados = [...content.querySelectorAll(".ingredient-modal__chips input:checked")].map((i) => i.value);
    const qtyRaw = content.querySelector("#ing-modal-paquete").value;
    const qtyNum = qtyRaw === "" ? null : Number(qtyRaw);
    const paqueteCantidad = qtyNum !== null && Number.isFinite(qtyNum) && qtyNum >= 0 ? qtyNum : null;
    const paqueteUnidad = content.querySelector("#ing-modal-unidad").value;
    try {
      await ctx.addIngredient(currentUser, { nombre, categoriaId, supermercados, paqueteCantidad, paqueteUnidad });
      closeIngredientModal();
      showToast("Ingrediente añadido al catálogo.");
      if (onCreated) onCreated({ nombre, categoriaId });
    } catch (err) {
      console.error("No se pudo añadir el ingrediente:", err);
      showToast("No se pudo añadir el ingrediente.");
    }
  });
}

// ---------- Tag selectors (predefined + own) ----------

function optionsFor(scope, selectedId) {
  const tags = mergeTags(
    PRESET_BY_SCOPE[scope],
    customTags.filter((t) => t.tipo === scope)
  );
  return `<option value="">—</option>
    ${tags.map((t) => `<option value="${escapeHtml(t.id)}"${t.id === selectedId ? " selected" : ""}>${escapeHtml(t.label)}${t.custom ? " (propia)" : ""}</option>`).join("")}`;
}

// ---------- Recipe modal ----------

// Optional modal close callback (issue #242): menu.js uses it to
// restore the recipe search box when closing the read window opened
// from the menu. It is invoked on every close and cleared afterwards,
// so callbacks from one opening do not accumulate.
// The read → edit transition (openRecipeModal without onClose)
// does NOT overwrite it: the callback stays alive until the modal
// closes.
let recipeModalCloseCb = null;

export function openRecipeModal(recipe = null, { readOnly = false, onClose = null } = {}) {
  const modal = document.getElementById("recipe-modal");
  const content = document.getElementById("recipe-modal-content");
  const wasHidden = modal.classList.contains("hidden");
  editingRecipeId = recipe?.id || null;
  modalReadOnly = readOnly;
  if (onClose) recipeModalCloseCb = onClose;

  content.innerHTML = recipeModalHtml(recipe);
  bindRecipeModalHandlers(content);

  if (wasHidden) {
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
  }
  // Hot re-render (e.g. read → edit): release the previous focus
  // trap before creating the new one.
  if (modalCleanup) modalCleanup();
  modalCleanup = trapFocus(modal.querySelector(".modal__card"));
  // Transition to edit mode: focus goes to the first form field.
  if (!wasHidden && !modalReadOnly && recipe) {
    requestAnimationFrame(() => {
      content.querySelector("#recipe-nombre")?.focus({ preventScroll: false });
    });
  }
}

function closeRecipeModal() {
  const modal = document.getElementById("recipe-modal");
  if (modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  if (modalCleanup) {
    modalCleanup();
    modalCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
  editingRecipeId = null;
  modalReadOnly = false;
  // Close callback (issue #242): restore the menu's search box.
  const cb = recipeModalCloseCb;
  recipeModalCloseCb = null;
  if (cb) cb();
}

function recipeModalHtml(recipe) {
  // Read mode (issue #236): not the form with disabled fields, but a
  // text view of its own (photo, name as title, tags, description,
  // servings, lists and links).
  if (modalReadOnly && recipe) return recipeReadOnlyHtml(recipe);
  const r = recipe || {};
  const alergenos = r.alergenos || [];
  const tipos = r.tipos || [];
  const ingredientes = r.ingredientes?.length ? r.ingredientes : [{ nombre: "", cantidad: "", unidad: "", categoriaId: "" }];
  const instrucciones = r.instrucciones?.length ? r.instrucciones : [""];
  const ro = modalReadOnly ? " disabled" : "";
  const alergenoTags = mergeTags(ALERGEN_TAGS, customTags.filter((t) => t.tipo === "alergeno"));
  const tipoTags = mergeTags(MEAL_TYPES, customTags.filter((t) => t.tipo === "tipo"));

  const importBox = !recipe
    ? `<div class="recipe-form__import">
        <label for="recipe-import-url">Importar desde una URL</label>
        <div class="recipe-form__import-row">
          <input type="url" id="recipe-import-url" placeholder="https://…" autocomplete="off" />
          <button type="button" id="btn-import-recipe" class="btn btn--small">Importar</button>
        </div>
        <p class="recipe-form__hint">Muchas webs no permiten leer su contenido desde otra página; en ese caso se
          guardará la URL y la receta quedará marcada como «Revisar» para que completes los datos.</p>
      </div>` : "";

  return `<form id="recipe-form" class="recipe-form">
    <h3 class="recipe-form__title">${recipe ? (modalReadOnly ? "Receta" : "Editar receta") : "Nueva receta"}</h3>
    ${importBox}
    <div class="recipe-form__field">
      <label for="recipe-nombre">Nombre *</label>
      <input type="text" id="recipe-nombre" required maxlength="200" value="${escapeHtml(r.nombre || "")}" ${ro} />
    </div>
    <div class="recipe-form__field">
      <label for="recipe-descripcion">Descripción</label>
      <textarea id="recipe-descripcion" rows="2" maxlength="1000" ${ro}>${escapeHtml(r.descripcion || "")}</textarea>
    </div>
    <div class="recipe-form__row">
      <div class="recipe-form__field">
        <label for="recipe-porciones">Porciones *</label>
        <input type="number" id="recipe-porciones" min="1" step="1" required value="${escapeHtml(r.porciones ?? "")}" ${ro} />
      </div>
      <div class="recipe-form__field">
        <label for="recipe-foto">Foto (URL)</label>
        <input type="url" id="recipe-foto" placeholder="https://…" value="${escapeHtml(r.fotoUrl || "")}" ${ro} />
      </div>
    </div>
    <div class="recipe-form__field">
      <label for="recipe-enlaces">Enlaces de referencia (uno por línea)</label>
      <textarea id="recipe-enlaces" rows="2" placeholder="https://…" ${ro}>${escapeHtml((r.enlaces || []).join("\n"))}</textarea>
    </div>

    <fieldset class="recipe-form__fieldset" ${ro}>
      <legend>Ingredientes</legend>
      <div id="recipe-ingredientes">
        ${ingredientes.map((ing, i) => ingredienteRowHtml(ing, i)).join("")}
      </div>
      <div class="recipe-form__ingredientes-actions">
        <button type="button" id="btn-add-ingrediente" class="btn btn--small">+ Ingrediente</button>
        <button type="button" id="btn-nuevo-ingrediente-receta" class="btn btn--small">+ Nuevo ingrediente</button>
      </div>
      <p class="recipe-form__hint">Los ingredientes se eligen del catálogo (con buscador); la categoría viene de
        ahí. Con «Nuevo ingrediente» lo creas al momento si no está.</p>
    </fieldset>

    <fieldset class="recipe-form__fieldset" ${ro}>
      <legend>Instrucciones</legend>
      <div id="recipe-instrucciones">
        ${instrucciones.map((paso, i) => instruccionRowHtml(paso, i)).join("")}
      </div>
      <button type="button" id="btn-add-paso" class="btn btn--small">+ Paso</button>
    </fieldset>

    <fieldset class="recipe-form__fieldset" ${ro}>
      <legend>Alérgenos / dieta</legend>
      <div class="recipe-form__chips" id="recipe-alergenos">
        ${alergenoTags.map((t) => chipHtml(t, alergenos.includes(t.id))).join("")}
      </div>
      ${customTagInput("alergeno", "alergeno-nueva")}
    </fieldset>

    <fieldset class="recipe-form__fieldset" ${ro}>
      <legend>Tipo de comida</legend>
      <div class="recipe-form__chips" id="recipe-tipos">
        ${tipoTags.map((t) => chipHtml(t, tipos.includes(t.id))).join("")}
      </div>
      ${customTagInput("tipo", "tipo-nuevo")}
    </fieldset>

    <div class="recipe-form__actions">
      ${modalReadOnly
        ? `<button type="button" class="btn btn--small btn--danger" data-recipe-delete>Eliminar</button>
           <button type="button" class="btn btn--small" data-recipe-edit>✎ Editar</button>`
        : `<button type="button" id="btn-recipe-cancel" class="btn btn--outline">Cancelar</button>
           <button type="submit" class="btn btn--primary">Guardar</button>`}
    </div>
  </form>`;
}

// Read-only recipe view (issue #236): its own render, as readable
// text (not as the form with disabled fields).
// Order: photo, name as title with the tags (allergens and type
// differentiated by color), description, servings, ingredients in
// a list (only name and amount), numbered instructions and reference
// links at the end if any. Field names are not shown.
function recipeReadOnlyHtml(recipe) {
  const r = recipe || {};
  const alergenos = tagsByIds(ALERGEN_TAGS, customTags, r.alergenos || []);
  const tipos = tagsByIds(MEAL_TYPES, customTags, r.tipos || []);
  const ingredientes = r.ingredientes || [];
  const instrucciones = r.instrucciones || [];
  const enlaces = r.enlaces || [];

  const foto = r.fotoUrl
    ? `<img class="recipe-view__photo" src="${escapeHtml(r.fotoUrl)}" alt="" loading="lazy" />`
    : "";
  const tags = alergenos.length || tipos.length
    ? `<div class="recipe-view__tags">
        ${alergenos.map((t) => `<span class="recipe-view__tag recipe-view__tag--alergeno">${escapeHtml(t.label)}</span>`).join("")}
        ${tipos.map((t) => `<span class="recipe-view__tag recipe-view__tag--tipo">${escapeHtml(t.label)}</span>`).join("")}
      </div>`
    : "";
  const descripcion = r.descripcion
    ? `<p class="recipe-view__descripcion">${escapeHtml(r.descripcion)}</p>`
    : "";
  const porciones = Number(r.porciones)
    ? `<p class="recipe-view__meta">${formatCantidad(r.porciones)} porciones</p>`
    : "";
  const ingredientesHtml = ingredientes.length
    ? `<section class="recipe-view__section">
        <h4 class="recipe-view__heading">Ingredientes</h4>
        <ul class="recipe-view__list">
          ${ingredientes.map((i) => `<li class="recipe-view__ingrediente">
            <span class="recipe-view__ing-nombre">${escapeHtml(i.nombre)}</span>
            ${cantidadRecetaHtml(i)}
          </li>`).join("")}
        </ul>
      </section>`
    : "";
  const instruccionesHtml = instrucciones.length
    ? `<section class="recipe-view__section">
        <h4 class="recipe-view__heading">Instrucciones</h4>
        <ol class="recipe-view__list recipe-view__pasos">
          ${instrucciones.map((p) => `<li class="recipe-view__paso">${escapeHtml(p)}</li>`).join("")}
        </ol>
      </section>`
    : "";
  const enlacesHtml = enlaces.length
    ? `<section class="recipe-view__section">
        <h4 class="recipe-view__heading">Enlaces</h4>
        <ul class="recipe-view__list recipe-view__links">
          ${enlaces.map((url) => `<li>${enlaceRecetaHtml(url)}</li>`).join("")}
        </ul>
      </section>`
    : "";

  return `<div class="recipe-view">
    ${foto}
    <h3 class="recipe-view__title">${escapeHtml(r.nombre)}</h3>
    ${tags}
    ${descripcion}
    ${porciones}
    ${ingredientesHtml}
    ${instruccionesHtml}
    ${enlacesHtml}
    <div class="recipe-view__actions">
      <button type="button" class="btn btn--small btn--danger" data-recipe-delete>Eliminar</button>
      <button type="button" class="btn btn--small" data-recipe-edit>✎ Editar</button>
    </div>
  </div>`;
}

// Amount of an ingredient in the read view: "200 g" or empty.
// Shown next to the name (the category is not shown, issue #236).
function cantidadRecetaHtml(ing) {
  const cantidad = ing.cantidad ?? "";
  const unidad = (ing.unidad || "").trim();
  const partes = [cantidad !== "" && cantidad !== null ? formatCantidad(cantidad) : "", unidad].filter(Boolean);
  if (!partes.length) return "";
  return `<span class="recipe-view__ing-cantidad">${partes.map(escapeHtml).join(" ")}</span>`;
}

// Reference link in the read view. Defensive hygiene: only the
// http/https schemes are clickable (a `javascript:` pasted by hand
// into the form must not execute on press); the rest shows as plain
// text.
function enlaceRecetaHtml(url) {
  const texto = escapeHtml(url);
  return /^https?:\/\//i.test(url)
    ? `<a class="recipe-view__link" href="${texto}" target="_blank" rel="noopener noreferrer">${texto}</a>`
    : texto;
}

function chipHtml(tag, checked) {
  return `<label class="recipe-form__chip${checked ? " is-checked" : ""}">
    <input type="checkbox" value="${escapeHtml(tag.id)}"${checked ? " checked" : ""} />
    <span>${escapeHtml(tag.label)}${tag.custom ? " (propia)" : ""}</span>
  </label>`;
}

// Field to create a custom tag from the modal itself.
function customTagInput(scope, id) {
  return `<div class="recipe-form__newtag">
    <input type="text" id="${id}" placeholder="Nueva etiqueta propia…" maxlength="60" autocomplete="off" aria-label="Nueva etiqueta" />
    <button type="button" class="btn btn--small" data-newtag-scope="${scope}" data-newtag-input="${id}">Añadir</button>
  </div>`;
}

// Category of a recipe ingredient (issue #240): the source of truth
// is the catalog (the form no longer selects it); if the name is not
// in the catalog (e.g. it was removed from it), the value stored in
// the recipe is kept so the data is not lost.
function ingredientCategoriaDe(nombre, guardada) {
  if (!nombre) return guardada || "";
  const cat = ingredients.find((i) => normalizeIngredientName(i.nombre) === normalizeIngredientName(nombre));
  return cat ? (cat.categoriaId || "") : (guardada || "");
}

// Options of the recipe form's unit dropdown (issue #251): the first
// empty option («—») means unspecified (pattern of PACKAGE_UNITS,
// issue #224) and prevents the browser from preselecting «g» in new
// rows; after it the five standard units of SHOPPING_UNITS (g, Kg,
// mL, L, Unidades, same as the extra item and the add-to-shopping
// modal, ADR-091). If the unit stored in the recipe does not match
// any standard one (legacy data from when the field was free text),
// it is added as an extra option at the end, selected, so the data is
// not lost when editing: it is user data and escaped with escapeHtml.
// The comparison is always done normalizing both sides
// (normalizeUnit), so a stored «kg» matches the «Kg» option. The
// selected falls on exactly one option.
function unidadOptionsHtml(unidad) {
  const norm = normalizeUnit(unidad);
  const options = [{ value: "", label: "—", selected: !norm }];
  let matched = false;
  SHOPPING_UNITS.forEach((u) => {
    const isMatch = !!norm && normalizeUnit(u) === norm;
    if (isMatch) matched = true;
    options.push({ value: u, label: u, selected: isMatch });
  });
  if (norm && !matched) {
    options.push({ value: unidad, label: unidad, selected: true });
  }
  return options
    .map((o) => `<option value="${escapeHtml(o.value)}"${o.selected ? " selected" : ""}>${escapeHtml(o.label)}</option>`)
    .join("");
}

// Recipe form's ingredient row (issue #240): the name is no longer
// typed freely nor is the category chosen. It is a combo box with a
// search over the ingredient catalog (input + dropdown); the
// selection lands in the hidden .ing-nombre-valor /
// .ing-categoria-valor, which readRecipeFromForm reads when saving.
// Free text not matching an option selects nothing (the row is
// ignored).
function ingredienteRowHtml(ing, i) {
  const nombre = ing.nombre || "";
  return `<div class="recipe-form__ingrediente" data-row="${i}">
    <div class="ing-combo">
      <input type="text" class="ing-nombre" placeholder="Buscar ingrediente…" value="${escapeHtml(nombre)}"
             role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off"
             aria-label="Ingrediente (elige uno del catálogo)" />
      <button type="button" class="ing-combo__toggle" aria-label="Elegir ingrediente del catálogo" tabindex="-1">▾</button>
      <ul class="ing-combo__list" role="listbox" hidden></ul>
      <input type="hidden" class="ing-nombre-valor" value="${escapeHtml(nombre)}" />
      <input type="hidden" class="ing-categoria-valor" value="${escapeHtml(ingredientCategoriaDe(nombre, ing.categoriaId))}" />
    </div>
    <input type="number" class="ing-cantidad" placeholder="Cant." step="any" min="0" value="${escapeHtml(ing.cantidad ?? "")}" />
    <select class="ing-unidad" aria-label="Unidad de medida">${unidadOptionsHtml(ing.unidad || "")}</select>
    <button type="button" class="btn btn--small btn--danger ing-remove" aria-label="Quitar ingrediente">✕</button>
  </div>`;
}

// Paints the options of an ingredient combo box's dropdown:
// the catalog ones matching the typed text (alphabetical order), plus
// the row's already selected value if it is not in the catalog
// (legacy data kept visible and selectable). `emptyText` customizes
// the «no matches» message (the shopping list uses one that points to
// the Ingredientes tab, issue #249).
export function renderIngredienteComboList(combo, emptyText = "Sin coincidencias. Crea el ingrediente con «Nuevo ingrediente».") {
  const list = combo.querySelector(".ing-combo__list");
  const texto = combo.querySelector(".ing-nombre").value.trim();
  const norm = normalizeIngredientName(texto);
  const matches = ingredients
    .filter((i) => !norm || normalizeIngredientName(i.nombre).includes(norm))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const currentVal = combo.querySelector(".ing-nombre-valor").value;
  const matched = new Set(matches.map((i) => normalizeIngredientName(i.nombre)));
  if (currentVal && !matched.has(normalizeIngredientName(currentVal))) {
    matches.unshift({ nombre: currentVal, categoriaId: combo.querySelector(".ing-categoria-valor").value });
  }
  list.innerHTML = matches.length
    ? matches.map((i) => `<li role="option" data-nombre="${escapeHtml(i.nombre)}" data-categoria="${escapeHtml(i.categoriaId || "")}">${escapeHtml(i.nombre)}</li>`).join("")
    : `<li role="option" class="ing-combo__empty" aria-disabled="true">${escapeHtml(emptyText)}</li>`;
}

// Ingredient combo box behavior (issue #240): open on focus or while
// typing, live filtering, selection with click / Enter (and up/down
// arrows), close with Escape or on leaving the field. Free text on
// its own does NOT select anything: only the catalog options write
// the row's hidden value. Exported (issue #249) so the shopping list
// reuses the same dropdown in the extra item form.
export function bindIngredienteCombo(combo, { emptyText } = {}) {
  const input = combo.querySelector(".ing-nombre");
  const toggle = combo.querySelector(".ing-combo__toggle");
  const list = combo.querySelector(".ing-combo__list");
  let activeIndex = -1;
  let closeTimer = null;

  const close = () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  };

  const open = () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    renderIngredienteComboList(combo, emptyText);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const selectOption = (option) => {
    if (!option || option.getAttribute("aria-disabled") === "true") return;
    combo.querySelector(".ing-nombre-valor").value = option.dataset.nombre;
    combo.querySelector(".ing-categoria-valor").value = option.dataset.categoria || "";
    input.value = option.dataset.nombre;
    close();
  };

  input.addEventListener("focus", open);
  input.addEventListener("input", () => {
    renderIngredienteComboList(combo);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    activeIndex = -1;
  });
  input.addEventListener("keydown", (e) => {
    const options = [...list.querySelectorAll('[role="option"]')];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!options.length) return;
      const max = options.length - 1;
      activeIndex = activeIndex < 0 ? (e.key === "ArrowDown" ? 0 : max) : activeIndex + (e.key === "ArrowDown" ? 1 : -1);
      activeIndex = Math.min(max, Math.max(0, activeIndex));
      options.forEach((o, i) => o.classList.toggle("is-active", i === activeIndex));
    } else if (e.key === "Enter") {
      if (!list.hidden) {
        e.preventDefault();
        const opts = [...list.querySelectorAll('[role="option"]')];
        const target = opts[activeIndex] || opts[0];
        // No selectable options (e.g. only the «No matches»
        // message): Enter does not select and closes the dropdown.
        if (!target || target.getAttribute("aria-disabled") === "true") close();
        else selectOption(target);
      }
    } else if (e.key === "Escape" && !list.hidden) {
      e.preventDefault();
      input.value = combo.querySelector(".ing-nombre-valor").value;
      close();
    }
  });
  // The blur closes the dropdown with a small delay so it does not
  // beat the click of an option (the list's mousedown with
  // preventDefault keeps the focus, so only closes from pressing
  // outside or tabbing get here).
  input.addEventListener("blur", () => {
    closeTimer = setTimeout(close, 120);
  });
  toggle.addEventListener("click", () => {
    if (list.hidden) {
      open();
      input.focus();
    } else {
      close();
    }
  });
  list.addEventListener("mousedown", (e) => {
    const option = e.target.closest('[role="option"]');
    if (option) e.preventDefault();
  });
  list.addEventListener("click", (e) => {
    const option = e.target.closest('[role="option"]');
    if (option) selectOption(option);
  });
}

function instruccionRowHtml(paso, i) {
  return `<div class="recipe-form__paso" data-row="${i}">
    <span class="recipe-form__paso-num">${i + 1}.</span>
    <input type="text" class="paso-texto" placeholder="Paso ${i + 1}" value="${escapeHtml(paso || "")}" />
    <button type="button" class="btn btn--small btn--danger paso-remove" aria-label="Quitar paso">✕</button>
  </div>`;
}

function bindRecipeModalHandlers(content) {
  // Dynamic ingredient and instruction rows.
  content.querySelector("#btn-add-ingrediente")?.addEventListener("click", () => {
    const wrap = content.querySelector("#recipe-ingredientes");
    wrap.insertAdjacentHTML("beforeend", ingredienteRowHtml({}, wrap.children.length));
    bindIngredienteCombo(wrap.lastElementChild.querySelector(".ing-combo"));
  });
  // New ingredient from the recipe (issue #240): opens the same
  // creation window of the catalog; when saved, a row is added with
  // that ingredient already selected.
  content.querySelector("#btn-nuevo-ingrediente-receta")?.addEventListener("click", () => {
    openIngredientModal(null, { onCreated: (ing) => {
      const wrap = content.querySelector("#recipe-ingredientes");
      wrap.insertAdjacentHTML("beforeend", ingredienteRowHtml(ing, wrap.children.length));
      bindIngredienteCombo(wrap.lastElementChild.querySelector(".ing-combo"));
      wrap.lastElementChild.querySelector(".ing-cantidad").focus();
    } });
  });
  content.querySelector("#btn-add-paso")?.addEventListener("click", () => {
    const wrap = content.querySelector("#recipe-instrucciones");
    wrap.insertAdjacentHTML("beforeend", instruccionRowHtml("", wrap.children.length));
    renumberPasos(content);
  });
  content.querySelector("#recipe-ingredientes")?.addEventListener("click", (e) => {
    const row = e.target.closest(".recipe-form__ingrediente");
    if (e.target.closest(".ing-remove") && row) row.remove();
  });
  content.querySelector("#recipe-instrucciones")?.addEventListener("click", (e) => {
    const row = e.target.closest(".recipe-form__paso");
    if (e.target.closest(".paso-remove") && row) {
      row.remove();
      renumberPasos(content);
    }
  });

  // Chips: visual state when checking.
  content.querySelectorAll(".recipe-form__chips").forEach((chips) => {
    chips.addEventListener("change", (e) => {
      const label = e.target.closest(".recipe-form__chip");
      if (label) label.classList.toggle("is-checked", e.target.checked);
    });
  });

  content.querySelector("#btn-recipe-cancel")?.addEventListener("click", closeRecipeModal);

  // Read mode (issue #234): the info window has edit and delete
  // buttons; closing is left to the ✕ (and the backdrop only in read
  // mode, see setupRecipes).
  content.querySelector("[data-recipe-edit]")?.addEventListener("click", () => {
    const recipe = recipes.find((r) => r.id === editingRecipeId);
    if (!recipe) return;
    openRecipeModal(recipe); // hot re-render in edit mode
  });
  content.querySelector("[data-recipe-delete]")?.addEventListener("click", async () => {
    const recipe = recipes.find((r) => r.id === editingRecipeId);
    if (!recipe) return;
    if (await deleteRecipeFlow(recipe)) closeRecipeModal();
  });

  // Import from URL.
  content.querySelector("#btn-import-recipe")?.addEventListener("click", () => {
    importRecipeFromUrl(content.querySelector("#recipe-import-url").value, content);
  });

  // Custom tags.
  content.querySelectorAll("[data-newtag-scope]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const input = content.querySelector(`#${btn.dataset.newtagInput}`);
      const name = input.value.trim();
      if (!name) return;
      try {
        await ctx.addTag(currentUser, { nombre: name, tipo: btn.dataset.newtagScope });
        input.value = "";
        showToast("Etiqueta añadida.");
      } catch (err) {
        console.error("No se pudo añadir la etiqueta:", err);
        showToast("No se pudo añadir la etiqueta.");
      }
    });
  });

  content.querySelector("#recipe-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveRecipeFromForm(content);
  });

  // Ingredient combo boxes (issue #240): one per row.
  content.querySelectorAll("#recipe-ingredientes .ing-combo").forEach(bindIngredienteCombo);
}

function renumberPasos(content) {
  content.querySelectorAll(".recipe-form__paso .recipe-form__paso-num").forEach((num, i) => {
    num.textContent = `${i + 1}.`;
  });
}

function readRecipeFromForm(content) {
  const nombre = content.querySelector("#recipe-nombre").value.trim();
  if (!nombre) {
    content.querySelector("#recipe-nombre").focus();
    throw new Error("El nombre es obligatorio.");
  }
  const porciones = Number(content.querySelector("#recipe-porciones").value);
  if (!porciones || porciones < 1) {
    content.querySelector("#recipe-porciones").focus();
    throw new Error("Las porciones son obligatorias.");
  }

  // Ingredients (issue #240): only the combo box selection counts
  // (the hidden value written by a catalog option), and only if the
  // visible text is still the one of that selection: if the user
  // typed over it (free text), the row is discarded with a notice.
  // The category is taken from the catalog (or from the one stored in
  // the recipe if it is no longer there).
  const sinSeleccion = [];
  const ingredientes = [...content.querySelectorAll("#recipe-ingredientes .recipe-form__ingrediente")]
    .map((row) => {
      const ingNombre = row.querySelector(".ing-nombre-valor").value.trim();
      const textoVisible = row.querySelector(".ing-nombre").value.trim();
      if (!ingNombre || normalizeIngredientName(textoVisible) !== normalizeIngredientName(ingNombre)) {
        if (textoVisible) sinSeleccion.push(textoVisible);
        return null;
      }
      return {
        nombre: ingNombre,
        cantidad: row.querySelector(".ing-cantidad").value === "" ? null : Number(row.querySelector(".ing-cantidad").value),
        unidad: normalizeUnit(row.querySelector(".ing-unidad").value),
        categoriaId: ingredientCategoriaDe(ingNombre, row.querySelector(".ing-categoria-valor").value),
      };
    })
    .filter(Boolean);
  if (sinSeleccion.length) {
    const lista = sinSeleccion.map((n) => `«${n}»`).join(", ");
    showToast(`No se añadió ${lista}: elige el ingrediente del desplegable (o créalo con «Nuevo ingrediente»).`);
  }

  const instrucciones = [...content.querySelectorAll("#recipe-instrucciones .recipe-form__paso")]
    .map((row) => row.querySelector(".paso-texto").value.trim())
    .filter(Boolean);

  const alergenos = [...content.querySelectorAll("#recipe-alergenos input:checked")].map((i) => i.value);
  const tipos = [...content.querySelectorAll("#recipe-tipos input:checked")].map((i) => i.value);

  const enlaces = content.querySelector("#recipe-enlaces").value.split("\n").map((s) => s.trim()).filter(Boolean);
  // The URL pasted into «Importar desde una URL» is kept as the
  // source link even when the extraction could not read it (CORS,
  // etc.).
  const importUrl = content.querySelector("#recipe-import-url")?.value.trim();
  if (importUrl && !enlaces.includes(importUrl)) enlaces.unshift(importUrl);

  return {
    nombre,
    descripcion: content.querySelector("#recipe-descripcion").value.trim(),
    porciones,
    fotoUrl: content.querySelector("#recipe-foto").value.trim(),
    enlaces,
    ingredientes,
    instrucciones,
    alergenos,
    tipos,
  };
}

async function saveRecipeFromForm(content) {
  let data;
  try {
    data = readRecipeFromForm(content);
  } catch (err) {
    showToast(err.message);
    return;
  }

  try {
    if (editingRecipeId) {
      // Saving an edit implies reviewing it: the «Revisar» badge is
      // removed from imported recipes (see manual 8.2).
      await ctx.updateRecipe(currentUser, editingRecipeId, { ...data, needsReview: false });
      showToast("Receta actualizada.");
    } else {
      const imported = Boolean(content.querySelector("#recipe-import-url")?.value.trim());
      await ctx.addRecipe(currentUser, { ...data, needsReview: imported });
      showToast(imported ? "Receta guardada (pendiente de revisar)." : "Receta guardada.");
    }
    // The ingredient catalog fills itself (upsert by name).
    await syncIngredientsCatalog(data.ingredientes);
    closeRecipeModal();
  } catch (err) {
    console.error("No se pudo guardar la receta:", err);
    showToast("No se pudo guardar la receta.");
  }
}

// Adds the new ingredients to the catalog (existing ones are not
// touched). The catalog keeps the first written spelling (issue
// #224): the name is saved with its accents and capitals exactly as
// it came in the recipe, while deduplication still uses the
// normalized name (no accents, lowercase).
async function syncIngredientsCatalog(ingredientes) {
  const known = new Set(ingredients.map((i) => normalizeIngredientName(i.nombre)));
  for (const ing of ingredientes || []) {
    const name = normalizeIngredientName(ing.nombre);
    if (!name || known.has(name)) continue;
    known.add(name);
    try {
      await ctx.addIngredient(currentUser, { nombre: ing.nombre.trim(), categoriaId: ing.categoriaId || "" });
    } catch (err) {
      console.error("No se pudo añadir el ingrediente al catálogo:", err);
    }
  }
}

// ---------- Import from URL ----------

async function importRecipeFromUrl(url, content) {
  const trimmed = (url || "").trim();
  if (!trimmed) {
    showToast("Pega una URL de la receta.");
    return;
  }
  // Defensive hygiene: only http/https protocols (blocks data:,
  // file: and other schemes the browser's fetch must not touch).
  if (!/^https?:\/\//i.test(trimmed)) {
    showToast("La URL debe empezar por http:// o https://.");
    return;
  }
  const btn = content.querySelector("#btn-import-recipe");
  btn.disabled = true;
  btn.textContent = "Importando…";
  try {
    const res = await fetch(trimmed, { mode: "cors" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    // Minimal regex extraction over the HTML: title, description
    // and image (og:image or the first <img>). It is not semantic
    // parsing: the recipe is left marked for review.
    const doc = document.implementation.createHTMLDocument("");
    doc.documentElement.innerHTML = text;
    const nombre = doc.querySelector("h1")?.textContent.trim()
      || doc.querySelector("title")?.textContent.trim()
      || "";
    const descripcion = doc.querySelector('meta[name="description"]')?.content
      || doc.querySelector('meta[property="og:description"]')?.content
      || "";
    const fotoUrl = doc.querySelector('meta[property="og:image"]')?.content
      || doc.querySelector("img")?.src
      || "";
    // Fills the form with what was found and marks the recipe as
    // pending review (if saved with the form in this state).
    if (nombre) {
      content.querySelector("#recipe-nombre").value = nombre;
      content.querySelector("#recipe-foto").value = fotoUrl || "";
      content.querySelector("#recipe-descripcion").value = descripcion || "";
      showToast("Datos extraídos. Repasa los campos y guarda (quedará marcada como «Revisar»).");
    } else {
      showToast("No se pudo extraer la receta de esa web; se guardará la URL y la revisarás después.");
    }
  } catch (err) {
    // CORS or other failure: the recipe is saved with the URL and
    // needsReview.
    showToast("No se pudo leer esa web (bloquea la lectura desde otra página). La receta se guardará con la URL.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Importar";
  }
}
