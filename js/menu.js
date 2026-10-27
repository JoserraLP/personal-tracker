// =============================================================
// Recetas section (issue #64) — «Menú» tab.
// Weekly menu: day × meal grid with several options per meal (each
// diner can eat differently), number of diners and «weekly
// recipes» (which do NOT scale by diners). Since issue #242 the
// menu covers lunch and dinner (breakfast was removed) and each
// recipe added to a meal can carry ITS OWN diners (own diners or
// null to inherit the week's global one).
//
// A single «+ Añadir receta» button in the bar (issue #242,
// iteration) opens the search box with a destination selector: day
// of the week or «Toda la semana» and meal. What is added to each
// cell shows as miniature cards (photo, name and tags), clickable
// to see the recipe in read mode.
//
// One document per week in users/{uid}/menus (semanaInicio = ISO
// Monday). The shopping list (shopping-list.js) consumes this same
// document.
// =============================================================

import { showToast } from "./ui.js";
import { trapFocus } from "./focus-utils.js";
import { registerTabRenderer, notifyRecipesChanged, getRecipes, getCustomTags, openRecipeModal } from "./recipes.js";
import {
  ALERGEN_TAGS,
  MEAL_TYPES,
  DAY_KEYS,
  DAY_LABELS,
  MEAL_KEYS,
  MEAL_LABELS,
  mergeTags,
  normalizeIngredientName,
  escapeHtml,
  mondayISO,
  addDaysISO,
  formatDateEs,
} from "./recipes-data.js";

// ---------- State ----------

let currentUser = null;
let ctx = null;
let menus = [];
let weekOffset = 0; // 0 = this week, -1 = previous, 1 = next

export function setupMenu(opts) {
  ctx = opts?.ctx || null;

  document.getElementById("menu-prev-week").addEventListener("click", () => {
    weekOffset -= 1;
    renderMenu();
  });
  document.getElementById("menu-next-week").addEventListener("click", () => {
    weekOffset += 1;
    renderMenu();
  });
  document.getElementById("menu-delete-week").addEventListener("click", deleteActiveMenu);
  document.getElementById("menu-comensales").addEventListener("change", (e) => {
    const value = Math.max(1, Number(e.target.value) || 1);
    e.target.value = value;
    updateActiveMenu({ comensales: value });
  });
  // Single add-recipe button (issue #242, iteration): the destination
  // (day or whole week + meal) is chosen inside the search box.
  document.getElementById("btn-add-menu-recipe").addEventListener("click", () => openRecipePicker());
  // List of «weekly recipes» (issue #242, iteration): the same
  // .menu-meal__card cards as the cells — the ✕ removes the recipe
  // and the card (outside the ✕) opens the recipe in read mode.
  document.getElementById("menu-weekly-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-weekly-remove]");
    if (btn) {
      removeWeeklyRecipe(btn.dataset.weeklyRemove);
      return;
    }
    const card = e.target.closest("[data-menu-card]");
    if (!card) return;
    const recipe = getRecipes().find((r) => r.id === card.dataset.menuCard);
    if (!recipe) return;
    openRecipeModal(recipe, { readOnly: true });
  });
  // Keyboard of the week cards: Enter/Space open the read view
  // (the inner buttons handle their own Enter).
  document.getElementById("menu-weekly-list").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("button")) return;
    const card = e.target.closest("[data-menu-card]");
    if (!card) return;
    e.preventDefault();
    const recipe = getRecipes().find((r) => r.id === card.dataset.menuCard);
    if (!recipe) return;
    openRecipeModal(recipe, { readOnly: true });
  });

  registerTabRenderer("menu", renderMenu);
}

// Clears the local state (called by app.js on logout, so the previous
// user's data is not shown to the next one).
export function resetMenuData() {
  menus = [];
  weekOffset = 0;
}

export function subscribeMenuData(uid, onChange, onError) {
  currentUser = uid;
  return ctx.subscribeToMenus(uid, (items) => {
    menus = items;
    // Re-render of the active tab and of the others that consume the
    // menu (the shopping list, if open).
    notifyRecipesChanged();
    if (onChange) onChange();
  }, onError);
}

// ---------- Access to the active menu ----------

function activeMenu() {
  return menuForWeek(mondayISO(weekOffset));
}

// Menu of a specific week (semanaInicio = ISO Monday). If there is
// no stored document, one in memory without id is returned (the
// multi-week shopping list uses it for weeks without data: they
// contribute 0).
function menuForWeek(weekStart) {
  let menu = menus.find((m) => m.semanaInicio === weekStart);
  if (!menu) {
    menu = {
      id: null,
      semanaInicio: weekStart,
      comensales: 2,
      dias: emptyDias(),
      recetasPorSemana: [],
      recetasExcluidasCompra: [],
      itemsEliminados: [],
    };
  }
  return menu;
}

function emptyDias() {
  const dias = {};
  DAY_KEYS.forEach((d) => {
    dias[d] = {};
    MEAL_KEYS.forEach((m) => {
      dias[d][m] = [];
    });
  });
  return dias;
}

// Deletes the active week's menu (document and local state).
async function deleteActiveMenu() {
  const menu = activeMenu();
  if (!menu.id) {
    showToast("El menú de esta semana todavía no tiene datos guardados.");
    return;
  }
  if (!confirm(`¿Borrar el menú completo de la semana del ${formatDateEs(menu.semanaInicio)}?`)) return;
  try {
    await ctx.deleteMenu(currentUser, menu.id);
    menus = menus.filter((m) => m.id !== menu.id);
    renderMenu();
    showToast("Menú de la semana borrado.");
  } catch (err) {
    console.error("No se pudo borrar el menú:", err);
    showToast("No se pudo borrar el menú.");
  }
}

// Fire-and-forget persistence: the document is created if it does
// not exist and its fields are updated in the one that exists. After
// each save the local state is updated optimistically: it avoids
// stale reads between quick saves and a second edition creating a
// duplicate document of the same week before the Firestore snapshot
// arrives.
async function updateActiveMenu(changes) {
  await updateMenuWeek(activeMenu().semanaInicio, changes, { create: true });
}

// Same as updateActiveMenu but for a specific week (multi-week
// shopping list, issue #225). With `create: false` it only updates
// if the week already has a document: deleting items from an empty
// week must not create a document.
export async function updateMenuWeek(weekStart, changes, { create = true } = {}) {
  const menu = { ...menuForWeek(weekStart), ...changes };
  try {
    if (menu.id) {
      await ctx.updateMenu(currentUser, menu.id, menuDataOf(menu));
    } else if (create) {
      const ref = await ctx.addMenu(currentUser, menuDataOf(menu));
      menu.id = ref.id;
    } else {
      return;
    }
    const idx = menus.findIndex((m) => m.id === menu.id);
    const fresh = { ...menuDataOf(menu), id: menu.id };
    if (idx >= 0) menus[idx] = fresh;
    else menus.push(fresh);
  } catch (err) {
    console.error("No se pudo guardar el menú:", err);
    showToast("No se pudo guardar el menú.");
  }
}

function menuDataOf(menu) {
  return {
    semanaInicio: menu.semanaInicio,
    comensales: menu.comensales,
    dias: menu.dias,
    recetasPorSemana: menu.recetasPorSemana,
    recetasExcluidasCompra: menu.recetasExcluidasCompra,
    // Extra items of the shopping list: they live in the week's menu
    // document (shopping-list.js consumes and updates them).
    itemsExtra: menu.itemsExtra || [],
    // Items deleted by the user from the shopping list (issue #225):
    // normalized keys «name|unit» that are no longer computed in that
    // week.
    itemsEliminados: menu.itemsEliminados || [],
  };
}

// ---------- Render ----------

export function renderMenu() {
  const menu = activeMenu();

  document.getElementById("menu-week-label").textContent = `Semana del ${formatDateEs(menu.semanaInicio)}`;
  const comensalesInput = document.getElementById("menu-comensales");
  if (Number(comensalesInput.value) !== Number(menu.comensales)) {
    comensalesInput.value = menu.comensales;
  }

  renderMenuGrid(menu);
  renderWeeklyRecipes(menu);
}

function renderMenuGrid(menu) {
  const grid = document.getElementById("menu-grid");
  const recipes = getRecipes();
  const byId = new Map(recipes.map((r) => [r.id, r]));

  grid.innerHTML = `<div class="menu-grid__head">${["Día", ...MEAL_KEYS.map((m) => MEAL_LABELS[m])]
    .map((h) => `<span class="menu-grid__cell menu-grid__cell--head">${h}</span>`).join("")}</div>
    ${DAY_KEYS.map((day) => {
      const dateLabel = formatDateEs(addDaysISO(menu.semanaInicio, DAY_KEYS.indexOf(day)));
      const cells = MEAL_KEYS.map((meal) => {
        const entries = (menu.dias[day][meal] || []).map(mealEntryOf).filter((e) => e.recipe && byId.has(e.recipe));
        const excluded = new Set(menu.recetasExcluidasCompra || []);
        return `<div class="menu-grid__cell menu-grid__cell--meal" data-day="${day}" data-meal="${meal}">
          <div class="menu-meal__items">
            ${entries.map(({ recipe, comensales }) => {
              const r = byId.get(recipe);
              const tagHtml = recipeTagsHtml(r);
              return `<article class="menu-meal__card${excluded.has(recipe) ? " is-excluded" : ""}"
                  role="button" tabindex="0" data-menu-card="${escapeHtml(recipe)}"
                  aria-label="Ver receta ${escapeHtml(r.nombre)}">
                  ${r.fotoUrl ? `<img class="menu-meal__card-photo" src="${escapeHtml(r.fotoUrl)}" alt="" loading="lazy" />` : ""}
                  <span class="menu-meal__card-copy">
                    <span class="menu-meal__card-name">${escapeHtml(r.nombre)}</span>
                    ${tagHtml ? `<span class="menu-meal__card-tags">${tagHtml}</span>` : ""}
                  </span>
                  ${comensales ? `<small class="menu-meal__comensales">· ${comensales}</small>` : ""}
                  <button type="button" class="menu-meal__remove" data-day="${day}" data-meal="${meal}" data-remove-recipe="${escapeHtml(recipe)}"
                    aria-label="Quitar ${escapeHtml(r.nombre)}">✕</button>
                </article>`;
            }).join("")}
          </div>
        </div>`;
      });
      return `<div class="menu-grid__row">
        <span class="menu-grid__cell menu-grid__cell--day">${DAY_LABELS[day]}<small>${dateLabel}</small></span>
        ${cells.join("")}
      </div>`;
    }).join("")}`;

  // Cards of the cells: click (or Enter/Space) opens the recipe in
  // read mode, the same window as the Recetas tab (issue #242,
  // iteration). The ✕ button removes the recipe from the meal.
  grid.querySelectorAll("[data-menu-card]").forEach((card) => {
    const openCard = () => {
      const recipe = byId.get(card.dataset.menuCard);
      if (!recipe) return;
      openRecipeModal(recipe, { readOnly: true });
    };
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove-recipe]")) return;
      openCard();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest("button")) return;
      e.preventDefault();
      openCard();
    });
  });

  // Remove recipe from a meal (and from the exclusion if it was there).
  grid.querySelectorAll("[data-remove-recipe]").forEach((btn) => {
    btn.addEventListener("click", () => removeRecipeFromMeal(btn.dataset.day, btn.dataset.meal, btn.dataset.removeRecipe));
  });
}

// Normalizes a menu meal entry: new entries (issue #242) are objects
// { recipeId, comensales } with the number of diners of that recipe
// (null = inherit the week's global one); old ones stored in
// Firestore are strings with just the id. Returns { recipe,
// comensales } with the resolved recipe or null.
function mealEntryOf(entry) {
  if (typeof entry === "string") return { recipe: entry, comensales: null };
  return { recipe: entry?.recipeId || null, comensales: entry?.comensales ?? null };
}

// ---------- Recipe search box (issue #242) ----------
//
// Modal window that replaces the add-recipe dropdown: list of cards
// (photo on the left, name on top, tags below), with a text search
// and filters by allergens and dish type. When pressing a card the
// recipe opens in read mode (the same window as the Recetas tab);
// «Añadir» lets you choose the diners of that recipe (empty =
// inherit the menu's global one).

let pickerDay = null;
let pickerMeal = null;
let pickerQuery = "";
// Search box filters (issue #242): multi-select with «all» checked
// by default (pattern of the Recetas tab, issue #234).
let pickerAlergenoFilter = new Set();
let pickerTipoFilter = new Set();
// Cleanup of the focus trap of the search box modal.
let pickerCleanup = null;
// Document listeners (Escape and closing panels by clicking
// outside) are wired once: the modal is re-rendered on each open and
// otherwise they would accumulate.
let pickerDocEventsBound = false;

// Ids of all the tags visible in the search box panel
// (predefined + the user's own).
function pickerTagIds(scope) {
  const preset = scope === "alergeno" ? ALERGEN_TAGS : MEAL_TYPES;
  return mergeTags(preset, getCustomTags().filter((t) => t.tipo === scope)).map((t) => t.id);
}

// «All» is checked if and only if ALL the tags of the panel are in
// the filter (pattern of recipeFilterAllChecked).
function pickerFilterAllChecked(scope) {
  const ids = pickerTagIds(scope);
  return ids.length > 0 && ids.every((id) =>
    scope === "alergeno" ? pickerAlergenoFilter.has(id) : pickerTipoFilter.has(id)
  );
}

function pickerFilterLabel(scope) {
  if (pickerFilterAllChecked(scope)) return scope === "alergeno" ? "Todos los alérgenos" : "Todos los tipos";
  const n = scope === "alergeno" ? pickerAlergenoFilter.size : pickerTipoFilter.size;
  const word = scope === "alergeno" ? "alérgeno" : "tipo";
  return `${n} ${n === 1 ? word : word + "s"}`;
}

// Opening of the search box for a meal (day × meal of the grid).
// The single «+ Añadir receta» button (issue #242, iteration) opens
// it with no destination: the user chooses inside the day (or
// «Toda la semana») and the meal. pickerDay "*" = whole week
// (pickerMeal = null).
function openRecipePicker(day = DAY_KEYS[0], meal = MEAL_KEYS[0]) {
  pickerDay = day;
  pickerMeal = meal;
  pickerQuery = "";
  pickerAlergenoFilter = new Set(pickerTagIds("alergeno"));
  pickerTipoFilter = new Set(pickerTagIds("tipo"));

  const modal = document.getElementById("recipe-picker-modal");
  if (!modal) return;
  modal._previousActiveElement = document.activeElement;
  renderRecipePicker();
  modal.classList.remove("hidden");
  if (pickerCleanup) pickerCleanup();
  pickerCleanup = trapFocus(modal.querySelector(".modal__card"));
  // Focus the search box (after the trapFocus rAF, which focuses the ✕).
  requestAnimationFrame(() => {
    document.getElementById("recipe-pick-search")?.focus({ preventScroll: false });
  });
}

function closeRecipePicker() {
  const modal = document.getElementById("recipe-picker-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  if (pickerCleanup) {
    pickerCleanup();
    pickerCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
}

// Restores the search box after closing a recipe's read window
// (onClose callback of openRecipeModal). The state (day, meal,
// query and filters) lives in module variables and is not reset on
// re-render, so the search box reappears as it was left.
function restoreRecipePicker() {
  const modal = document.getElementById("recipe-picker-modal");
  if (!modal) return;
  renderRecipePicker();
  modal.classList.remove("hidden");
  if (pickerCleanup) pickerCleanup();
  pickerCleanup = trapFocus(modal.querySelector(".modal__card"));
  requestAnimationFrame(() => {
    document.getElementById("recipe-pick-search")?.focus({ preventScroll: false });
  });
}

function renderRecipePicker() {
  const content = document.getElementById("recipe-picker-content");
  const wholeWeek = pickerDay === "*";
  content.innerHTML = `
    <div class="recipe-pick">
      <h3 class="recipe-pick__title"></h3>
      <div class="recipe-pick__target">
        <label class="recipe-pick__field" for="recipe-pick-day">Día
          <select id="recipe-pick-day">
            <option value="*">Toda la semana</option>
            ${DAY_KEYS.map((d) => `<option value="${d}">${DAY_LABELS[d]}</option>`).join("")}
          </select>
        </label>
        <label class="recipe-pick__field" for="recipe-pick-meal">Comida
          <select id="recipe-pick-meal">
            ${MEAL_KEYS.map((m) => `<option value="${m}">${MEAL_LABELS[m]}</option>`).join("")}
          </select>
        </label>
      </div>
      <p class="recipe-pick__week-hint hidden" aria-live="polite">Se añade una vez a la semana y NO se multiplica
        por los comensales (p. ej. una masa de pizza para toda la semana).</p>
      <div class="recipe-pick__toolbar">
        <input type="search" id="recipe-pick-search" class="recipe-pick__search"
          placeholder="Buscar receta…" aria-label="Buscar receta" autocomplete="off" />
        <div class="recipes-filter" id="recipe-pick-alergeno-filter">
          <button type="button" id="btn-recipe-pick-alergeno" class="recipes-filter__btn"
            aria-haspopup="true" aria-expanded="false" aria-controls="recipe-pick-alergeno-panel">
            <span id="recipe-pick-alergeno-label">${pickerFilterLabel("alergeno")}</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <div id="recipe-pick-alergeno-panel" class="recipes-filter__panel recipe-pick__panel hidden"></div>
        </div>
        <div class="recipes-filter" id="recipe-pick-tipo-filter">
          <button type="button" id="btn-recipe-pick-tipo" class="recipes-filter__btn"
            aria-haspopup="true" aria-expanded="false" aria-controls="recipe-pick-tipo-panel">
            <span id="recipe-pick-tipo-label">${pickerFilterLabel("tipo")}</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <div id="recipe-pick-tipo-panel" class="recipes-filter__panel recipe-pick__panel hidden"></div>
        </div>
      </div>
      <div id="recipe-pick-list" class="recipe-pick__list"></div>
    </div>`;

  // Initial state of the destination selectors (day / meal). With
  // «Toda la semana» the meal does not apply: the select becomes
  // disabled.
  const daySel = content.querySelector("#recipe-pick-day");
  const mealSel = content.querySelector("#recipe-pick-meal");
  daySel.value = pickerDay === "*" ? "*" : pickerDay;
  mealSel.value = pickerMeal || MEAL_KEYS[0];
  if (wholeWeek) mealSel.disabled = true;
  updatePickerTargetUi(content);

  bindRecipePickerEvents(content);
  renderRecipePickerList();
}

// Title of the search box and the «Toda la semana» notice based on the destination.
function updatePickerTargetUi(content) {
  const title = content.querySelector(".recipe-pick__title");
  const targetLabel = pickerDay === "*"
    ? "toda la semana"
    : `${DAY_LABELS[pickerDay]} · ${MEAL_LABELS[pickerMeal]}`;
  title.textContent = `Añadir receta a ${targetLabel}`;
  const hint = content.querySelector(".recipe-pick__week-hint");
  if (hint) hint.classList.toggle("hidden", pickerDay !== "*");
}

function bindRecipePickerEvents(content) {
  document.getElementById("recipe-picker-close").addEventListener("click", closeRecipePicker);
  document.getElementById("recipe-picker-backdrop").addEventListener("click", closeRecipePicker);
  ensureRecipePickerDocEvents();

  // Live search.
  content.querySelector("#recipe-pick-search").addEventListener("input", (e) => {
    pickerQuery = e.target.value.trim().toLowerCase();
    renderRecipePickerList();
  });

  // Destination selector: day (or whole week) and meal. Changing the
  // day to «Toda la semana» disables the meal and shows the notice.
  const daySel = content.querySelector("#recipe-pick-day");
  const mealSel = content.querySelector("#recipe-pick-meal");
  daySel.addEventListener("change", () => {
    pickerDay = daySel.value === "*" ? "*" : daySel.value;
    if (pickerDay === "*") {
      pickerMeal = null;
      mealSel.disabled = true;
    } else {
      pickerMeal = mealSel.value || MEAL_KEYS[0];
      mealSel.disabled = false;
    }
    updatePickerTargetUi(content);
    renderRecipePickerList();
  });
  mealSel.addEventListener("change", () => {
    if (pickerDay === "*") return;
    pickerMeal = mealSel.value;
    updatePickerTargetUi(content);
    renderRecipePickerList();
  });

  // Filters by tags (pattern of the Recetas tab panels): they are
  // painted on open and only the check is toggled.
  ["alergeno", "tipo"].forEach((scope) => {
    const btn = content.querySelector(`#btn-recipe-pick-${scope}`);
    const panel = content.querySelector(`#recipe-pick-${scope}-panel`);
    btn.addEventListener("click", () => {
      if (panel.classList.contains("hidden")) {
        renderRecipePickerFilterPanel(scope, panel);
        panel.classList.remove("hidden");
        btn.setAttribute("aria-expanded", "true");
      } else {
        panel.classList.add("hidden");
        btn.setAttribute("aria-expanded", "false");
      }
    });
    panel.addEventListener("change", (e) => {
      const input = e.target.closest("input[type='checkbox']");
      if (!input) return;
      const active = scope === "alergeno" ? pickerAlergenoFilter : pickerTipoFilter;
      if (input.value === "__all__") {
        if (input.checked) {
          pickerTagIds(scope).forEach((id) => active.add(id));
        } else {
          active.clear();
        }
      } else if (input.checked) {
        active.add(input.value);
      } else {
        active.delete(input.value);
      }
      syncPickerFilterPanel(scope, panel);
      content.querySelector(`#recipe-pick-${scope}-label`).textContent = pickerFilterLabel(scope);
      renderRecipePickerList();
    });
  });

  // Card list: delegation (see recipe in read mode / add).
  const list = content.querySelector("#recipe-pick-list");
  list.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-pick-add]");
    if (addBtn) {
      expandComensalesRow(addBtn);
      return;
    }
    const confirmBtn = e.target.closest("[data-pick-confirm]");
    if (confirmBtn) {
      // Double-click guard: the button is disabled and, if the add
      // did not happen (recipe already added), it is re-enabled.
      confirmBtn.disabled = true;
      const card = confirmBtn.closest("[data-pick-card]");
      if (!card) return;
      const input = card.querySelector(".recipe-pick__comensales input");
      const raw = Number(input?.value);
      const comensales = input && input.value !== "" && Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : null;
      addRecipeToMeal(pickerDay, pickerMeal, card.dataset.pickCard, comensales).then((added) => {
        if (!added) confirmBtn.disabled = false;
      });
      return;
    }
    const cancelBtn = e.target.closest("[data-pick-cancel]");
    if (cancelBtn) {
      const card = cancelBtn.closest("[data-pick-card]");
      if (!card) return;
      collapseComensalesRow(card);
      return;
    }
    // Click on the card (outside its buttons and the diners row):
    // opens the recipe in read mode, the same window as the Recetas
    // tab.
    const cardEl = e.target.closest("[data-pick-card]");
    if (cardEl && !e.target.closest("button, input, label")) {
      const recipe = getRecipes().find((r) => r.id === cardEl.dataset.pickCard);
      if (!recipe) return;
      closeRecipePicker();
      openRecipeModal(recipe, { readOnly: true, onClose: restoreRecipePicker });
    }
  });
  // Keyboard support: Enter/Space on the card (outside buttons and
  // inputs) opens the read view; Enter in the diners number confirms
  // the recipe add.
  list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.matches(".recipe-pick__comensales input")) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const inputEl = e.target;
      if (inputEl.disabled) return; // double Enter guard
      inputEl.disabled = true;
      const card = inputEl.closest("[data-pick-card]");
      if (!card) return;
      const input = card.querySelector(".recipe-pick__comensales input");
      const raw = Number(input?.value);
      const comensales = input && input.value !== "" && Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : null;
      addRecipeToMeal(pickerDay, pickerMeal, card.dataset.pickCard, comensales).then((added) => {
        if (!added) inputEl.disabled = false;
      });
      return;
    }
    // The card's inner buttons handle their own Enter (native
    // click): do not open the read view.
    if (e.target.closest("button")) return;
    const card = e.target.closest("[data-pick-card]");
    if (!card) return;
    e.preventDefault();
    const recipe = getRecipes().find((r) => r.id === card.dataset.pickCard);
    if (!recipe) return;
    closeRecipePicker();
    openRecipeModal(recipe, { readOnly: true, onClose: restoreRecipePicker });
  });
}

// Global listeners of the search box (Escape and closing panels with
// an outside click): they are wired once on first open and the
// elements of the current render are resolved at event time.
function ensureRecipePickerDocEvents() {
  if (pickerDocEventsBound) return;
  pickerDocEventsBound = true;
  const modal = document.getElementById("recipe-picker-modal");
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      e.preventDefault();
      closeRecipePicker();
    }
  });
  document.addEventListener("click", (e) => {
    const content = document.getElementById("recipe-picker-content");
    if (!content) return;
    ["alergeno", "tipo"].forEach((scope) => {
      const wrap = content.querySelector(`#recipe-pick-${scope}-filter`);
      const panel = content.querySelector(`#recipe-pick-${scope}-panel`);
      if (wrap && panel && !wrap.contains(e.target) && !panel.classList.contains("hidden")) {
        panel.classList.add("hidden");
        content.querySelector(`#btn-recipe-pick-${scope}`).setAttribute("aria-expanded", "false");
      }
    });
  });
}

// Filter panel of the search box: «All» + tags (predefined and
// own). Painted only on open.
function renderRecipePickerFilterPanel(scope, panel) {
  const preset = scope === "alergeno" ? ALERGEN_TAGS : MEAL_TYPES;
  const tags = mergeTags(preset, getCustomTags().filter((t) => t.tipo === scope));
  const active = scope === "alergeno" ? pickerAlergenoFilter : pickerTipoFilter;
  const allChecked = pickerFilterAllChecked(scope);
  panel.innerHTML = `<label class="recipes-filter__all${allChecked ? " is-checked" : ""}">
      <input type="checkbox" value="__all__"${allChecked ? " checked" : ""} />
      <span>Todas</span>
    </label>
    <div class="recipes-filter__separator" role="presentation"></div>
    ${tags.map((t) => {
      const checked = active.has(t.id);
      return `<label class="recipes-filter__item${checked ? " is-checked" : ""}">
        <input type="checkbox" value="${escapeHtml(t.id)}"${checked ? " checked" : ""} />
        <span>${escapeHtml(t.label)}${t.custom ? " (propia)" : ""}</span>
      </label>`;
    }).join("")}`;
}

// Visual check state of the panel checkboxes (the source of truth is
// the active Set, not input.checked; pattern of the Recetas filter).
function syncPickerFilterPanel(scope, panel) {
  const active = scope === "alergeno" ? pickerAlergenoFilter : pickerTipoFilter;
  const allChecked = pickerFilterAllChecked(scope);
  const all = panel.querySelector(".recipes-filter__all");
  if (all) {
    all.classList.toggle("is-checked", allChecked);
    all.querySelector("input").checked = allChecked;
  }
  panel.querySelectorAll(".recipes-filter__item").forEach((item) => {
    const input = item.querySelector("input");
    const checked = active.has(input.value);
    item.classList.toggle("is-checked", checked);
    input.checked = checked;
  });
}

// Tags of a recipe (allergens + dish type) as .recipe-card__tag pill
// HTML: the same source of truth for the search box cards and the
// miniature cards of the grid.
function recipeTagsHtml(r) {
  const alergenos = mergeTags(ALERGEN_TAGS, getCustomTags().filter((t) => t.tipo === "alergeno"))
    .filter((t) => (r.alergenos || []).includes(t.id));
  const tipos = mergeTags(MEAL_TYPES, getCustomTags().filter((t) => t.tipo === "tipo"))
    .filter((t) => (r.tipos || []).includes(t.id));
  return [
    ...alergenos.map((t) => `<span class="recipe-card__tag recipe-card__tag--alergeno">${escapeHtml(t.label)}</span>`),
    ...tipos.map((t) => `<span class="recipe-card__tag recipe-card__tag--tipo">${escapeHtml(t.label)}</span>`),
  ].join("");
}

// Search box card list: photo on the left (if it has one), name as
// title at the top right and allergen and dish type tags below. The
// whole card opens the read view; the «Añadir» button expands the
// diners selection.
function renderRecipePickerList() {
  const list = document.getElementById("recipe-pick-list");
  if (!list) return;
  const menu = activeMenu();
  // Already added to the chosen destination: the meal of the day
  // (specific days) or the week's recipes (destination «Toda la
  // semana»).
  const existing = new Set(
    pickerDay === "*"
      ? (menu.recetasPorSemana || []).map((e) => e.recipeId)
      : (menu.dias?.[pickerDay]?.[pickerMeal] || []).map((e) => (typeof e === "string" ? e : e.recipeId))
  );
  const candidates = getRecipes().filter((r) => {
    if (existing.has(r.id)) return false;
    if (!pickerFilterAllChecked("alergeno") && !(r.alergenos || []).some((id) => pickerAlergenoFilter.has(id))) return false;
    if (!pickerFilterAllChecked("tipo") && !(r.tipos || []).some((id) => pickerTipoFilter.has(id))) return false;
    if (pickerQuery && !recipeMatchesQuery(r, pickerQuery)) return false;
    return true;
  });

  if (!candidates.length) {
    const all = getRecipes();
    const allInTarget = pickerDay === "*"
      ? "Ya están todas tus recetas en la semana."
      : "Ya están todas tus recetas en esta comida.";
    const msg = !all.length
      ? "Aún no hay recetas. Crea la primera en la pestaña Recetas."
      : existing.size === all.length
        ? allInTarget
        : "Ninguna receta coincide con la búsqueda o los filtros.";
    list.innerHTML = `<p class="recipe-pick__empty">${msg}</p>`;
    return;
  }

  list.innerHTML = candidates.map((r) => {
    const tagHtml = recipeTagsHtml(r);
    return `<article class="recipe-pick__card" role="button" tabindex="0" data-pick-card="${escapeHtml(r.id)}"
        aria-label="Ver receta ${escapeHtml(r.nombre)}">
      <div class="recipe-pick__card-main">
        ${r.fotoUrl ? `<img class="recipe-pick__photo" src="${escapeHtml(r.fotoUrl)}" alt="" loading="lazy" />` : ""}
        <span class="recipe-pick__copy">
          <span class="recipe-pick__name">${escapeHtml(r.nombre)}</span>
          ${tagHtml ? `<span class="recipe-pick__tags">${tagHtml}</span>` : ""}
        </span>
      </div>
      <button type="button" class="btn btn--small btn--primary recipe-pick__add" data-pick-add="${escapeHtml(r.id)}">+ Añadir</button>
    </article>`;
  }).join("");
}

// Match against the search text: by name, ingredient and tags (same
// criteria as the Recetas tab search).
function recipeMatchesQuery(r, q) {
  if ((r.nombre || "").toLowerCase().includes(q)) return true;
  if ((r.ingredientes || []).some((i) => normalizeIngredientName(i.nombre).toLowerCase().includes(q))) return true;
  const labels = [
    ...(r.alergenos || []).map((id) => tagLabelInMenu("alergeno", id)),
    ...(r.tipos || []).map((id) => tagLabelInMenu("tipo", id)),
    ...(r.ingredientes || []).map((i) => tagLabelInMenu("ingrediente", i.categoriaId)),
  ];
  return labels.some((t) => t && t.toLowerCase().includes(q));
}

function tagLabelInMenu(scope, id) {
  if (!id) return "";
  const preset = scope === "alergeno" ? ALERGEN_TAGS : scope === "tipo" ? MEAL_TYPES : [];
  const found = preset.find((t) => t.id === id);
  if (found) return found.label;
  const custom = getCustomTags().find((t) => t.id === id);
  return custom ? custom.nombre || custom.id : id;
}

// Diners row of the card: an optional number plus the «Add» (confirms
// the add) and «Cancel» buttons. Empty (or 0) → the recipe inherits
// the menu's global diners.
function expandComensalesRow(addBtn) {
  const card = addBtn.closest("[data-pick-card]");
  if (!card) return;
  const global = Number(activeMenu().comensales) || 1;
  const pickId = escapeHtml(card.dataset.pickCard);
  addBtn.insertAdjacentHTML("beforebegin", `<span class="recipe-pick__comensales">
      <label for="pick-com-${pickId}">Comensales</label>
      <input type="number" id="pick-com-${pickId}" min="1" max="99" inputmode="numeric"
        placeholder="Menú (${global})" aria-label="Comensales de esta receta (vacío = los del menú)" />
      <button type="button" class="btn btn--small btn--primary recipe-pick__confirm" data-pick-confirm>Añadir</button>
      <button type="button" class="btn btn--small recipe-pick__cancel" data-pick-cancel>Cancelar</button>
    </span>`);
  addBtn.hidden = true;
  card.querySelector(".recipe-pick__comensales input").focus();
}

function collapseComensalesRow(card) {
  card.querySelector(".recipe-pick__comensales")?.remove();
  const addBtn = card.querySelector("[data-pick-add]");
  if (addBtn) addBtn.hidden = false;
}

// Adds the recipe to the destination with its own diners (or null
// when not given → inherits the menu's global one). With day "*" the
// recipe goes to «weekly recipes» (it is NOT multiplied by the
// diners). Returns true if added and false if it was already there
// (the search box stays open).
async function addRecipeToMeal(day, meal, recipeId, comensales = null) {
  const current = activeMenu();
  if (day === "*") {
    const list = current.recetasPorSemana || [];
    if (list.some((e) => e.recipeId === recipeId)) {
      showToast("Esa receta ya está en la semana.");
      renderMenu();
      return false;
    }
    await updateActiveMenu({ recetasPorSemana: [...list, { recipeId, cantidad: 1 }] });
    closeRecipePicker();
    renderMenu();
    showToast("Receta añadida a la semana.");
    return true;
  }
  const entries = (current.dias[day][meal] || []).map(mealEntryOf).map((e) => e.recipe);
  if (entries.includes(recipeId)) {
    showToast("Esa receta ya está en esa comida.");
    renderMenu();
    return false;
  }
  const dias = {
    ...current.dias,
    [day]: { ...current.dias[day], [meal]: [...(current.dias[day][meal] || []), { recipeId, comensales }] },
  };
  await updateActiveMenu({ dias });
  closeRecipePicker();
  renderMenu();
  showToast("Receta añadida al menú.");
  return true;
}

async function removeRecipeFromMeal(day, meal, recipeId) {
  const menu = activeMenu();
  const entries = (menu.dias[day][meal] || []).filter((e) => mealEntryOf(e).recipe !== recipeId);
  const dias = { ...menu.dias, [day]: { ...menu.dias[day], [meal]: entries } };
  await updateActiveMenu({ dias });
  renderMenu();
}

// ---------- Weekly recipes (they do not scale) ----------

// «Weekly recipes» (issue #242, iteration): the same .menu-meal__card
// cards as the grid cells (photo, name and tags; the ✕ removes and
// the card opens the recipe in read mode), instead of the simple
// name with a «Quitar» button from before. They reuse the same
// classes and the same recipeTagsHtml, so their look and behavior
// match the per-day menu.
function renderWeeklyRecipes(menu) {
  const list = document.getElementById("menu-weekly-list");
  const recipes = getRecipes();
  const byId = new Map(recipes.map((r) => [r.id, r]));

  if (!menu.recetasPorSemana?.length) {
    list.innerHTML = `<p class="menu-weekly__empty">Ninguna receta a la semana.</p>`;
    return;
  }
  list.innerHTML = menu.recetasPorSemana.map((entry) => {
    const recipe = byId.get(entry.recipeId);
    if (!recipe) return "";
    const tagHtml = recipeTagsHtml(recipe);
    return `<article class="menu-meal__card" role="button" tabindex="0"
        data-menu-card="${escapeHtml(entry.recipeId)}"
        aria-label="Ver receta ${escapeHtml(recipe.nombre)}">
        ${recipe.fotoUrl ? `<img class="menu-meal__card-photo" src="${escapeHtml(recipe.fotoUrl)}" alt="" loading="lazy" />` : ""}
        <span class="menu-meal__card-copy">
          <span class="menu-meal__card-name">${escapeHtml(recipe.nombre)}</span>
          ${tagHtml ? `<span class="menu-meal__card-tags">${tagHtml}</span>` : ""}
        </span>
        <button type="button" class="menu-meal__remove" data-weekly-remove="${escapeHtml(entry.recipeId)}"
          aria-label="Quitar ${escapeHtml(recipe.nombre)} de la semana">✕</button>
      </article>`;
  }).join("");
}

async function removeWeeklyRecipe(recipeId) {
  const menu = activeMenu();
  const list = (menu.recetasPorSemana || []).filter((e) => e.recipeId !== recipeId);
  await updateActiveMenu({ recetasPorSemana: list });
  renderMenu();
}

// ---------- Shared with the shopping list ----------

// Exclude / include a recipe from the shopping list computation.
export async function setRecipeExcluded(recipeId, excluded) {
  const menu = activeMenu();
  const list = (menu.recetasExcluidasCompra || []).filter((id) => id !== recipeId);
  if (excluded) list.push(recipeId);
  await updateActiveMenu({ recetasExcluidasCompra: list });
  renderMenu();
  notifyRecipesChanged();
}

export function isRecipeExcluded(recipeId) {
  return (activeMenu().recetasExcluidasCompra || []).includes(recipeId);
}

// Active week of the menu (offset). The shopping list uses it to
// start its selection in the same week as the menu (issue #225).
export function getActiveWeekOffset() {
  return weekOffset;
}

// Data of the active menu for the shopping list: returns
// { semanaInicio, comensales, dias, recetasPorSemana, recetasExcluidasCompra }.
export function getActiveMenuData() {
  return getMenuDataByWeek(activeMenu().semanaInicio);
}

// Data of a specific week for the multi-week shopping list
// (issue #225): same shape as getActiveMenuData but for any week
// (with or without a stored document).
export function getMenuDataByWeek(weekStart) {
  const menu = menuForWeek(weekStart);
  return {
    semanaInicio: menu.semanaInicio,
    comensales: Number(menu.comensales) || 1,
    dias: menu.dias || emptyDias(),
    recetasPorSemana: menu.recetasPorSemana || [],
    recetasExcluidasCompra: menu.recetasExcluidasCompra || [],
    itemsExtra: menu.itemsExtra || [],
    itemsEliminados: menu.itemsEliminados || [],
    // Weeks with no stored document: id null (so no docs are created
    // when deleting items from empty weeks, issue #225).
    hasDoc: Boolean(menu.id),
  };
}

// Updates the shopping list's extra items (persisted in the active
// menu's document).
export async function updateMenuExtras(itemsExtra) {
  await updateActiveMenu({ itemsExtra });
}

// Cleans up references to a deleted recipe in the existing menus
// (old string entries and the { recipeId, comensales } objects of
// issue #242, via mealEntryOf).
export async function cleanupDeletedRecipe(recipeId) {
  for (const menu of menus) {
    const data = menuDataOf(menu);
    let changed = false;
    let dias = data.dias;
    DAY_KEYS.forEach((day) => {
      MEAL_KEYS.forEach((meal) => {
        const entries = (dias[day]?.[meal] || []).filter((e) => mealEntryOf(e).recipe !== recipeId);
        if (entries.length !== (dias[day]?.[meal] || []).length) {
          dias = { ...dias, [day]: { ...dias[day], [meal]: entries } };
          changed = true;
        }
      });
    });
    const recetasPorSemana = (data.recetasPorSemana || []).filter((e) => e.recipeId !== recipeId);
    const recetasExcluidasCompra = (data.recetasExcluidasCompra || []).filter((id) => id !== recipeId);
    if (recetasPorSemana.length !== (data.recetasPorSemana || []).length) changed = true;
    if (recetasExcluidasCompra.length !== (data.recetasExcluidasCompra || []).length) changed = true;
    if (changed) {
      try {
        await ctx.updateMenu(currentUser, menu.id, { ...data, dias, recetasPorSemana, recetasExcluidasCompra });
      } catch (err) {
        console.error("No se pudo limpiar el menú:", err);
      }
    }
  }
}
