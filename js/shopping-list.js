// =============================================================
// Recetas section (issue #64) — «Lista de la compra» tab.
// It automatically computes what is needed from the weekly menu
// (js/menu.js): each ingredient is multiplied by
// (diners / recipe servings). The «weekly recipes» do not scale
// (fixed amount) and the excluded recipes
// (recetasExcluidasCompra of the menu) are skipped.
//
// Improvements of issue #225:
//  - Selection of SEVERAL weeks at once: the toolbar chips allow
//    marking/unmarking weeks and the total ingredients of all the
//    selected ones are added up (each week scales with its own
//    diners and applies its own exclusions).
//  - Amount in PACKAGES: if the catalog ingredient has package
//    amount and unit (paqueteCantidad/paqueteUnidad, issue #224),
//    the needed amount is compared with the package's and rounded
//    up (550 g with a 1 Kg package → 1 package; 2.5 Kg → 3). The
//    user can adjust that amount with the −/+ stepper and the
//    adjustment persists in localStorage. If there is no package
//    data (or the units are not comparable) the needed amount is
//    shown.
//  - Delete items by SWIPING THEM LEFT: the swipe reveals the red
//    background and, if you keep swiping a bit further (extra
//    offset), the item is deleted on release — no need to press any
//    button. There is also a red ✕ always visible on the right of
//    each line (mainly for desktop). On hover the line is only
//    highlighted (no delete-state reveal). Recipe items stop being
//    computed in the selected weeks (itemsEliminados of the menu
//    document); extra items are removed from the weeks where they
//    were. There is undo (toast) and a note to re-include what was
//    removed.
// It also allows manual extra items (edible and non-edible)
// persisted in the menu document (itemsExtra), and marking what is
// already bought (visual state of the session).
// =============================================================

import { showToast, showUndoToast } from "./ui.js";
import {
  registerTabRenderer,
  getRecipes,
  getIngredients,
  bindIngredienteCombo,
  registerShoppingListAdder,
} from "./recipes.js";
import {
  INGREDIENT_CATEGORIES,
  DAY_KEYS,
  MEAL_KEYS,
  SHOPPING_UNITS,
  normalizeIngredientName,
  normalizeUnit,
  escapeHtml,
  formatCantidad,
  formatDateEs,
  mondayISO,
} from "./recipes-data.js";
import { getMenuDataByWeek, updateMenuWeek, getActiveWeekOffset } from "./menu.js";

// ---------- State ----------

let ctx = null;
let showingExtraForm = false;
// Visible chips window: weeks chipOffset-2 … chipOffset+2.
let chipOffset = 0;
// Selected weeks (ISO week start). Default: the active menu week;
// more can be added by checking the chips.
let selectedWeeks = new Set([mondayISO(0)]);
// Until the user touches the chips, the selection follows the active
// menu week (if you navigate the menu to another week, the list goes
// to that week). After touching the chips, the selection is the
// user's.
let userTouchedChips = false;
// Manual package adjustments (issue #225): key «nombre|unidad»
// → number of packages. Persisted in localStorage per user.
let pkgOverrides = new Map();

// Content offset when revealing the red background (px).
const SWIPE_OPEN = -88;
// Extra offset that triggers the direct deletion on
// release (issue #225, iteration): a small push beyond the reveal
// position deletes the item without pressing anything.
const SWIPE_DELETE = -112;

export function setupShoppingList(opts) {
  ctx = opts?.ctx || null;

  document.getElementById("btn-add-extra-item").addEventListener("click", () => {
    showingExtraForm = !showingExtraForm;
    const form = document.getElementById("shopping-extra-form");
    form.classList.toggle("hidden", !showingExtraForm);
    if (showingExtraForm) renderExtraForm();
  });

  document.getElementById("shopping-extra-form").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-extra-action]");
    if (!btn) return;
    if (btn.dataset.extraAction === "add") addExtraItem();
    if (btn.dataset.extraAction === "cancel") {
      showingExtraForm = false;
      document.getElementById("shopping-extra-form").classList.add("hidden");
    }
  });

  // Navigation of the weeks window.
  document.getElementById("shopping-prev-week").addEventListener("click", () => {
    userTouchedChips = true;
    chipOffset -= 1;
    renderWeekChips();
  });
  document.getElementById("shopping-next-week").addEventListener("click", () => {
    userTouchedChips = true;
    chipOffset += 1;
    renderWeekChips();
  });

  // Week selection (multi-week, issue #225).
  document.getElementById("shopping-week-chips").addEventListener("change", (e) => {
    const box = e.target.closest("input[data-week-chip]");
    if (!box) return;
    userTouchedChips = true;
    if (box.checked) {
      selectedWeeks.add(box.dataset.weekChip);
    } else if (selectedWeeks.size > 1) {
      selectedWeeks.delete(box.dataset.weekChip);
    } else {
      box.checked = true;
      showToast("Selecciona al menos una semana.");
      return;
    }
    renderWeekChips();
    renderShoppingList();
  });

  document.getElementById("shopping-list").addEventListener("click", (e) => {
    // Delete an item (✕ on the right, issue #225 iteration).
    const delBtn = e.target.closest("[data-del-key]");
    if (delBtn) {
      deleteLine(delBtn.dataset.delKey);
      return;
    }
    // Re-include an item removed from the list.
    const restoreBtn = e.target.closest("[data-restore-key]");
    if (restoreBtn) {
      restoreKey(restoreBtn.dataset.restoreKey);
      return;
    }
    // Re-include a recipe excluded from the computation.
    const excludeBtn = e.target.closest("[data-exclude-recipe]");
    if (excludeBtn) {
      includeRecipe(excludeBtn.dataset.excludeRecipe);
      return;
    }
    // Package stepper (issue #225).
    const pkgBtn = e.target.closest("[data-pkg-op]");
    if (pkgBtn) {
      adjustPackages(pkgBtn.dataset.pkgKey, pkgBtn.dataset.pkgOp);
    }
  });

  // «Comprado»: visual state of the session (the line is struck
  // through).
  document.getElementById("shopping-list").addEventListener("change", (e) => {
    const box = e.target.closest("input[type=checkbox][data-bought]");
    if (!box) return;
    const lineEl = box.closest(".shopping-line-wrap");
    if (lineEl) lineEl.classList.toggle("is-bought", box.checked);
  });

  // Adder of the ingredient modal (issue #249): «Añadir a la lista de
  // la compra» persists the item in the same selected weeks as the
  // extra item form (the write shares the mutation queue). If the
  // user has not touched the chips yet, the selection aligns with the
  // active menu week (what they will see when opening the Compra
  // tab); if they already chose weeks, those are the ones used.
  // recipes.js invokes it via registerShoppingListAdder.
  registerShoppingListAdder(async (item) => {
    if (!userTouchedChips) syncSelectionWithMenu();
    await persistExtraItem(item, { create: true });
  });

  registerTabRenderer("compra", () => {
    syncSelectionWithMenu();
    renderShoppingList();
  });
}

// Clears the local state (called by app.js on logout, so the previous
// user's data is not shown to the next one).
export function resetShoppingListState() {
  showingExtraForm = false;
  chipOffset = 0;
  selectedWeeks = new Set([mondayISO(0)]);
  userTouchedChips = false;
  pkgOverrides = new Map();
}

// As long as the user has not touched the chips, the selection
// follows the active menu week (issue #225).
function syncSelectionWithMenu() {
  if (userTouchedChips) return;
  const off = getActiveWeekOffset();
  chipOffset = off;
  selectedWeeks = new Set([mondayISO(off)]);
}

// ---------- Package adjustments (localStorage per user) ----------

function pkgStorageKey() {
  const uid = ctx?.getCurrentUser?.()?.uid;
  return uid ? `compraPaquetes:${uid}` : null;
}

function loadPkgOverrides() {
  const key = pkgStorageKey();
  if (!key) return new Map();
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(key) || "{}")));
  } catch {
    return new Map();
  }
}

function savePkgOverrides() {
  const key = pkgStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(pkgOverrides)));
  } catch (err) {
    console.error("No se pudieron guardar los ajustes de paquetes:", err);
  }
}

function adjustPackages(lineKey, op) {
  const lines = computeLines([...selectedWeeks]);
  const line = lines.get(lineKey);
  const info = line ? pkgInfo(line) : null;
  if (!info) return;
  pkgOverrides = loadPkgOverrides();
  let value = pkgOverrides.has(lineKey) ? pkgOverrides.get(lineKey) : info.packages;
  if (op === "minus") value = Math.max(0, value - 1);
  if (op === "plus") value += 1;
  if (op === "reset") pkgOverrides.delete(lineKey);
  else pkgOverrides.set(lineKey, value);
  savePkgOverrides();
  renderShoppingList();
}

// ---------- Computation ----------

// Adds up the ingredients of the selected weeks (issue #225).
// Each week scales with its own diners and applies its own
// exclusions (recetasExcluidasCompra) and removed items
// (itemsEliminados).
function computeLines(weekStarts) {
  const recipes = getRecipes();
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const lines = new Map(); // key (name|unit) → line

  function addLine(nombre, cantidad, unidad, categoriaId, comestible, origen) {
    if (!nombre) return;
    const key = `${normalizeIngredientName(nombre)}|${normalizeUnit(unidad)}`;
    if (!lines.has(key)) {
      lines.set(key, {
        key,
        nombre: normalizeIngredientName(nombre),
        cantidad: 0,
        unidad: normalizeUnit(unidad),
        categoriaId: categoriaId || "",
        comestible: comestible !== false,
        origen,
      });
    }
    const line = lines.get(key);
    const value = Number(cantidad || 0);
    line.cantidad += value;
  }

  weekStarts.forEach((weekStart) => {
    const data = getMenuDataByWeek(weekStart);
    const excluded = new Set(data.recetasExcluidasCompra || []);
    const eliminados = new Set(data.itemsEliminados || []);
    const skip = (nombre, unidad) =>
      eliminados.has(`${normalizeIngredientName(nombre)}|${normalizeUnit(unidad)}`);

    // Menu recipes (by day and meal), scaled by diners.
    // Since issue #242 each entry can be a string (id) or an
    // object { recipeId, comensales } with its own diners:
    // if it carries them, it scales with them; if not, with the
    // global ones.
    const comensales = Number(data.comensales) || 1;
    DAY_KEYS.forEach((day) => {
      MEAL_KEYS.forEach((meal) => {
        (data.dias?.[day]?.[meal] || []).forEach((entry) => {
          const recipeId = typeof entry === "string" ? entry : entry?.recipeId;
          if (!recipeId) return;
          if (excluded.has(recipeId)) return;
          const recipe = byId.get(recipeId);
          if (!recipe) return;
          const entryComensales = typeof entry === "object" && entry !== null && entry.comensales
            ? Number(entry.comensales)
            : null;
          const factorBase = entryComensales || comensales;
          const factor = Number(recipe.porciones) > 0 ? factorBase / Number(recipe.porciones) : factorBase;
          (recipe.ingredientes || []).forEach((ing) => {
            if (skip(ing.nombre, ing.unidad)) return;
            addLine(ing.nombre, Number(ing.cantidad || 0) * factor, ing.unidad, ing.categoriaId, true, recipe.nombre);
          });
        });
      });
    });

    // Weekly recipes: fixed amount, no scaling.
    (data.recetasPorSemana || []).forEach((entry) => {
      if (excluded.has(entry.recipeId)) return;
      const recipe = byId.get(entry.recipeId);
      if (!recipe) return;
      (recipe.ingredientes || []).forEach((ing) => {
        if (skip(ing.nombre, ing.unidad)) return;
        addLine(ing.nombre, Number(ing.cantidad || 0), ing.unidad, ing.categoriaId, true, recipe.nombre);
      });
    });

    // Manual extra items (edible and non-edible).
    (data.itemsExtra || []).forEach((item) => {
      if (skip(item.nombre, item.unidad)) return;
      addLine(item.nombre, item.cantidad, item.unidad, item.categoriaId, item.comestible, "extra");
    });
  });

  return lines;
}

// ---------- Amount in packages (issue #225) ----------

// Families of units comparable between «needed amount» and
// «package amount»: mass (g/Kg), volume (mL/L) and units.
// `base` converts the unit to the base unit of its family.
function unitFamily(unit) {
  const u = normalizeUnit(unit);
  if (["g", "gr", "grs", "gramo", "gramos"].includes(u)) return { family: "mass", base: 1 };
  if (["kg", "kilo", "kilos", "kilogramo", "kilogramos"].includes(u)) return { family: "mass", base: 1000 };
  if (["ml", "mililitro", "mililitros"].includes(u)) return { family: "volume", base: 1 };
  if (["l", "litro", "litros"].includes(u)) return { family: "volume", base: 1000 };
  if (["unidad", "unidades", "ud", "uds", "u", "pieza", "piezas", "pza"].includes(u)) return { family: "count", base: 1 };
  return null;
}

// Computes the packages of a line: it looks the ingredient up in the
// catalog, compares units (only if they are from the same family)
// and rounds up with floating point tolerance. Returns null if the
// ingredient has no package amount or it is not comparable (in that
// case the needed amount is shown).
function pkgInfo(line) {
  const ing = getIngredients().find((i) => normalizeIngredientName(i.nombre) === line.nombre);
  if (!ing) return null;
  const pkgCant = Number(ing.paqueteCantidad);
  const needed = unitFamily(line.unidad);
  const pkg = unitFamily(ing.paqueteUnidad);
  if (!(pkgCant > 0) || !needed || !pkg || needed.family !== pkg.family) return null;
  const neededBase = Number(line.cantidad) * needed.base;
  const pkgBase = pkgCant * pkg.base;
  if (!(pkgBase > 0)) return null;
  const packages = Math.max(0, Math.ceil(neededBase / pkgBase - 1e-9));
  return { packages, pkgUnit: normalizeUnit(ing.paqueteUnidad) };
}

// ---------- Render ----------

export function renderShoppingList() {
  const weekStarts = [...selectedWeeks].sort();
  document.getElementById("shopping-week-label").textContent =
    weekStarts.length === 1
      ? `Lista de la semana del ${formatDateEs(weekStarts[0])}`
      : `Lista de la compra · ${weekStarts.length} semanas`;

  renderWeekChips();

  const lines = computeLines(weekStarts);
  pkgOverrides = loadPkgOverrides();
  const container = document.getElementById("shopping-list");

  // Grouping by category (predefined in order + no category).
  const groups = new Map();
  INGREDIENT_CATEGORIES.forEach((c) => groups.set(c.id, []));
  groups.set("", []);
  lines.forEach((line) => {
    const key = line.categoriaId || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  });

  const hasLines = [...groups.values()].some((l) => l.length);
  if (!hasLines) {
    container.innerHTML = `<p class="empty-state">No hay nada que comprar. Añade recetas al menú semanal
      (o un ítem extra con «+ Ítem extra») y aquí aparecerá la lista calculada.
      Puedes marcar varias semanas en los chips para sumarlas.</p>`;
    return;
  }

  container.innerHTML = [...groups.entries()].map(([catId, groupLines]) => {
    if (!groupLines.length) return "";
    const catLabel = catId
      ? (INGREDIENT_CATEGORIES.find((c) => c.id === catId)?.label || catId)
      : "Sin categoría";
    return `<section class="shopping-group">
      <h3 class="shopping-group__title">${escapeHtml(catLabel)}</h3>
      <ul class="shopping-group__list">
        ${groupLines.map((line) => lineHtml(line)).join("")}
      </ul>
    </section>`;
  }).join("");

  container.insertAdjacentHTML("beforeend", deletedItemsNote());
  container.insertAdjacentHTML("beforeend", excludedRecipesNote());
  container.insertAdjacentHTML("beforeend", `<p class="shopping-hint">Desliza un ítem hacia la izquierda
    y continúa deslizando un poco más (o pulsa la ✕ de la derecha) para quitarlo de la lista. Los ajustes de
    paquetes se guardan en este dispositivo.</p>`);

  // Swipe to delete (issue #225): ADR-028 pattern with axis lock.
  container.querySelectorAll(".shopping-line-wrap").forEach((wrap) => {
    attachLineSwipe(wrap, wrap.querySelector(".shopping-line__content"));
  });
}

function lineHtml(line) {
  const pkgQty = qtyHtml(line);
  return `<li class="shopping-line-wrap${line.comestible ? "" : " shopping-line-wrap--hogar"}">
    <div class="shopping-line__swipe-bg" aria-hidden="true">
      <span class="shopping-line__swipe-icon">✕</span>
    </div>
    <div class="shopping-line__content">
      <label class="shopping-line__main">
        <input type="checkbox" data-bought="${escapeHtml(line.key)}" aria-label="Marcar ${escapeHtml(line.nombre)} como comprado" />
        <span class="shopping-line__name">${escapeHtml(line.nombre)}</span>
      </label>
      ${pkgQty}
      <button type="button" class="shopping-line__remove" data-del-key="${escapeHtml(line.key)}"
        aria-label="Eliminar ${escapeHtml(line.nombre)} de la lista" title="Quitar de la lista">✕</button>
    </div>
  </li>`;
}

// Amount of the line: with package → only the number of packages
// (without the «paquetes» word nor the weight, issue #225 iteration)
// with −/+ stepper (and ↺ to go back to the automatic computation if
// there is a manual adjustment); without package → the needed amount.
function qtyHtml(line) {
  const info = pkgInfo(line);
  if (!info) {
    return `<span class="shopping-line__qty shopping-line__qty--plain">${formatCantidad(line.cantidad)} ${escapeHtml(line.unidad)}</span>`;
  }
  const override = pkgOverrides.has(line.key);
  const shown = override ? pkgOverrides.get(line.key) : info.packages;
  const shownText = formatCantidad(shown);
  const paqueteLabel = `${shownText} ${shown === 1 ? "paquete" : "paquetes"}`;
  return `<span class="shopping-line__qty">
      <button type="button" class="shopping-line__stepper" data-pkg-key="${escapeHtml(line.key)}" data-pkg-op="minus"
        aria-label="Quitar un paquete de ${escapeHtml(line.nombre)}" title="Quitar un paquete">−</button>
      <span class="shopping-line__pkgcount" aria-label="${paqueteLabel}">${shownText}</span>
      <button type="button" class="shopping-line__stepper" data-pkg-key="${escapeHtml(line.key)}" data-pkg-op="plus"
        aria-label="Añadir un paquete de ${escapeHtml(line.nombre)}" title="Añadir un paquete">+</button>
      ${override ? `<button type="button" class="shopping-line__pkgreset" data-pkg-key="${escapeHtml(line.key)}" data-pkg-op="reset"
        aria-label="Volver al cálculo automático de ${escapeHtml(line.nombre)}" title="Volver al cálculo automático">↺</button>` : ""}
    </span>`;
}

// Week chips (issue #225): window of 5 around chipOffset.
function renderWeekChips() {
  const container = document.getElementById("shopping-week-chips");
  const chips = [];
  for (let off = chipOffset - 2; off <= chipOffset + 2; off++) {
    const iso = mondayISO(off);
    const checked = selectedWeeks.has(iso);
    chips.push(`<label class="shopping-week-chip${checked ? " is-checked" : ""}">
      <input type="checkbox" data-week-chip="${iso}" ${checked ? "checked" : ""} />
      <span class="shopping-week-chip__label" title="Semana del ${formatDateEs(iso)}">${formatDateEs(iso).slice(0, 5)}</span>
    </label>`);
  }
  container.innerHTML = chips.join("");
}

// Note with the items removed from the list in the selected
// weeks (issue #225): press one to re-include it.
function deletedItemsNote() {
  const seen = new Map(); // key → nombre
  [...selectedWeeks].forEach((weekStart) => {
    const data = getMenuDataByWeek(weekStart);
    (data.itemsEliminados || []).forEach((key) => {
      if (!seen.has(key)) seen.set(key, key.split("|")[0] || key);
    });
  });
  if (!seen.size) return "";
  return `<div class="shopping-deleted">
    <p>Quitados de la lista (dejan de calcularse en las semanas marcadas):
      ${[...seen.entries()].map(([key, nombre]) => `<button type="button" class="shopping-deleted__btn"
        data-restore-key="${escapeHtml(key)}">${escapeHtml(nombre)}</button>`).join(", ")}
    </p>
  </div>`;
}

// Note with the recipes excluded from the computation in the
// selected weeks (and a button to re-include them).
function excludedRecipesNote() {
  const recipes = getRecipes();
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const ids = new Set();
  [...selectedWeeks].forEach((weekStart) => {
    const data = getMenuDataByWeek(weekStart);
    (data.recetasExcluidasCompra || []).forEach((id) => ids.add(id));
  });
  const excluded = [...ids].map((id) => byId.get(id)).filter(Boolean);
  if (!excluded.length) return "";
  return `<div class="shopping-excluded">
    <p>Recetas fuera de la lista (marcadas como ya hechas en el menú):
      ${excluded.map((r) => `<button type="button" class="shopping-excluded__btn" data-exclude-recipe="${escapeHtml(r.id)}">${escapeHtml(r.nombre)}</button>`).join(", ")}
    </p>
  </div>`;
}

// ---------- Delete items (swipe left, issue #225) ----------

// Serializes the shopping list writes (issue #225): two quick
// consecutive deletions both read the same previous itemsEliminados
// and the second overwrote the first.
let mutationQueue = Promise.resolve();
function enqueueMutation(fn) {
  mutationQueue = mutationQueue.then(fn, fn);
  return mutationQueue;
}

// Applies the deletion to the selected weeks and offers undo.
// Recipe items → itemsEliminados (they stop being computed in those
// weeks); extra items → they are removed from itemsExtra of the
// weeks where they were. The key is only marked in the weeks that
// actually contain the item.
async function deleteLine(key) {
  const lines = computeLines([...selectedWeeks]);
  const line = lines.get(key);
  if (!line) return;
  const isExtra = line.origen === "extra";
  const snapshots = []; // for the undo

  await enqueueMutation(async () => {
    for (const weekStart of [...selectedWeeks]) {
      const data = getMenuDataByWeek(weekStart);
      if (!data.hasDoc) continue;
      if (isExtra) {
        const rest = (data.itemsExtra || []).filter(
          (item) => `${normalizeIngredientName(item.nombre)}|${normalizeUnit(item.unidad)}` !== key
        );
        if (rest.length === (data.itemsExtra || []).length) continue;
        snapshots.push({ weekStart, extraBefore: data.itemsExtra || [] });
        await updateMenuWeek(weekStart, { itemsExtra: rest }, { create: false });
      } else {
        if ((data.itemsEliminados || []).includes(key)) continue;
        if (!computeLines([weekStart]).has(key)) continue;
        snapshots.push({ weekStart, eliminadosBefore: data.itemsEliminados || [] });
        await updateMenuWeek(weekStart, { itemsEliminados: [...(data.itemsEliminados || []), key] }, { create: false });
      }
    }
  });

  if (!snapshots.length) return;
  renderShoppingList();
  const { hide } = showUndoToast(line.nombre, () => {
    enqueueMutation(async () => {
      for (const s of snapshots) {
        const fields = {};
        if (s.extraBefore !== undefined) fields.itemsExtra = s.extraBefore;
        if (s.eliminadosBefore !== undefined) fields.itemsEliminados = s.eliminadosBefore;
        await updateMenuWeek(s.weekStart, fields, { create: false });
      }
      renderShoppingList();
      hide();
    });
  });
}

// Re-includes a removed item: it deletes its key from
// itemsEliminados in the selected weeks that have it.
async function restoreKey(key) {
  await enqueueMutation(async () => {
    for (const weekStart of [...selectedWeeks]) {
      const data = getMenuDataByWeek(weekStart);
      if (!data.hasDoc) continue;
      const rest = (data.itemsEliminados || []).filter((k) => k !== key);
      if (rest.length !== (data.itemsEliminados || []).length) {
        await updateMenuWeek(weekStart, { itemsEliminados: rest }, { create: false });
      }
    }
  });
  renderShoppingList();
  showToast("Ítem de vuelta en la lista.");
}

// Re-includes an excluded recipe in the selected weeks.
async function includeRecipe(recipeId) {
  await enqueueMutation(async () => {
    for (const weekStart of [...selectedWeeks]) {
      const data = getMenuDataByWeek(weekStart);
      if (!data.hasDoc) continue;
      const rest = (data.recetasExcluidasCompra || []).filter((id) => id !== recipeId);
      if (rest.length !== (data.recetasExcluidasCompra || []).length) {
        await updateMenuWeek(weekStart, { recetasExcluidasCompra: rest }, { create: false });
      }
    }
  });
  renderShoppingList();
  showToast("Receta de vuelta en la lista.");
}

// Horizontal swipe with axis lock (ADR-028 pattern): to the left
// it reveals the red background; if the gesture exceeds the extra
// offset (SWIPE_DELETE) the item is deleted directly on release
// (issue #225, iteration) — with no button to press. Swiping to the
// right closes again. The final position is applied by the CSS
// (.is-revealed → translateX(-88px)); during the drag an inline
// transform is used, which wins over the class. The ✕ button on the
// right stays always visible (keyboard accessible) and does not
// depend on this gesture.
//
// Iteration 2 (issue #225): the transform and the reveal are ONLY
// applied when the axis lock decides 'horizontal'. A vertical
// scroll (even while dragging a bit horizontally) never reveals the
// red background: on release with a 'vertical' lock it closes
// (snap(false)) — before, a drift of >44 px during the scroll left
// the item marked red without having selected it.
function attachLineSwipe(wrap, content) {
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let dragging = false;
  let lock = null; // null | 'vertical' | 'horizontal'
  let startTouchId = null;
  let revealed = false;
  const lockThreshold = 10;

  const snap = (isOpen) => {
    revealed = isOpen;
    content.style.transform = "";
    wrap.classList.toggle("is-revealed", isOpen);
  };

  wrap.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.changedTouches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTouchId = touch.identifier;
      dragging = true;
    },
    { passive: true }
  );

  wrap.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging) return;
      const touch = Array.from(e.touches).find((t) => t.identifier === startTouchId) || e.touches[0];
      deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      // Axis lock (ADR-028): when crossing the slop the axis is
      // decided and not turned back; a tie wins 'vertical' (scroll
      // rules). 'is-dragging' (which shows the white ✕ of the
      // background and removes the transition) is ONLY activated if
      // the gesture is horizontal: a vertical scroll must not show
      // the ✕ (issue #225, iteration 2).
      if (lock === null && (Math.abs(deltaX) >= lockThreshold || Math.abs(deltaY) >= lockThreshold)) {
        lock = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
        if (lock === "horizontal") wrap.classList.add("is-dragging");
      }
      // Until the lock decides, or if it is 'vertical', nothing is
      // moved: the scroll must never drag the item (issue #225,
      // iteration 2 — before, a finger scrolling the page could
      // reveal the red background).
      if (lock !== "horizontal") return;
      const offset = Math.max(SWIPE_DELETE, Math.min(0, (revealed ? SWIPE_OPEN : 0) + deltaX));
      content.style.transform = `translateX(${offset}px)`;
      wrap.classList.toggle("is-revealed", offset < SWIPE_OPEN / 2);
      // When crossing the delete threshold, the red background
      // communicates it visually (darker) so the gesture is
      // perceived.
      wrap.classList.toggle("is-deleting", offset <= SWIPE_DELETE);
    },
    { passive: true }
  );

  const resetGesture = () => {
    dragging = false;
    wrap.classList.remove("is-dragging");
    wrap.classList.remove("is-deleting");
    lock = null;
    startTouchId = null;
    deltaX = 0;
  };

  wrap.addEventListener(
    "touchend",
    (e) => {
      // Delete or reveal only if the gesture was horizontal (axis
      // lock): a vertical scroll with horizontal drift must not
      // delete or mark the item red (issue #225, iteration 2 —
      // before, the item stayed revealed on scroll release).
      if (lock === "vertical") {
        snap(false);
      } else if (lock === "horizontal") {
        const offset = Math.max(SWIPE_DELETE, Math.min(0, (revealed ? SWIPE_OPEN : 0) + deltaX));
        if (offset <= SWIPE_DELETE) {
          // Extra offset: delete directly (issue #225, iteration),
          // no need to press anything.
          const delBtn = wrap.querySelector(".shopping-line__remove");
          const key = delBtn?.dataset.delKey;
          snap(false);
          if (key) deleteLine(key);
        } else {
          snap(offset < SWIPE_OPEN / 2);
        }
      }
      // lock === null (tap without offset): the state is not
      // touched — a tap on a revealed line keeps it revealed; on a
      // closed one, closed.
      // Ghost click (issue #225): after a horizontal gesture the
      // browser synthesizes a click on release, which would fall on
      // the checkbox/stepper of the shifted row and activate them
      // unintentionally. Suppressing it here avoids those synthetic
      // events; deliberate taps (e.g. pressing the ✕) are new
      // gestures with deltaX ≈ 0 and are not affected. The listener
      // is non-passive only to be able to preventDefault on the
      // touchend (it does not block the scroll).
      if (lock === "horizontal" && Math.abs(deltaX) > lockThreshold) {
        e.preventDefault();
      }
      resetGesture();
    },
    { passive: false }
  );

  wrap.addEventListener(
    "touchcancel",
    () => {
      snap(revealed);
      resetGesture();
    },
    { passive: true }
  );
}

// ---------- Manual extra items ----------

// Extra item form (issue #249): the name is no longer typed freely,
// nor is category or «edible/non-edible» chosen: it is a combo box
// with a search over the ingredient catalog (the same one as the
// recipes, issue #240). Name and category come from there (and with
// them whether it is edible or household); the user only adds the
// amount and the measurement unit.
function renderExtraForm() {
  const form = document.getElementById("shopping-extra-form");
  form.innerHTML = `<div class="shopping-extra-form__row">
      <div class="ing-combo">
        <input type="text" class="ing-nombre" placeholder="Buscar ingrediente…"
               role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off"
               aria-label="Ingrediente (elige uno del catálogo)" />
        <button type="button" class="ing-combo__toggle" aria-label="Elegir ingrediente del catálogo" tabindex="-1">▾</button>
        <ul class="ing-combo__list" role="listbox" hidden></ul>
        <input type="hidden" class="ing-nombre-valor" />
        <input type="hidden" class="ing-categoria-valor" />
      </div>
      <input type="number" id="extra-cantidad" placeholder="Cant." step="any" min="0" />
      <select id="extra-unidad" aria-label="Unidad de medida">
        ${SHOPPING_UNITS.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("")}
      </select>
    </div>
    <p class="shopping-extra-form__hint">Elige un ingrediente del catálogo: la categoría (y si es
      producto del hogar) se toma de su ficha. Si no está, créalo en la pestaña Ingredientes.</p>
    <div class="shopping-extra-form__actions">
      <button type="button" class="btn btn--small btn--primary" data-extra-action="add">Añadir</button>
      <button type="button" class="btn btn--small shopping-btn--ghost" data-extra-action="cancel">Cancelar</button>
    </div>`;
  bindIngredienteCombo(form.querySelector(".ing-combo"), {
    emptyText: "Sin coincidencias. Crea el ingrediente en la pestaña Ingredientes.",
  });
}

// Persists an extra item in all the selected weeks (issue #225):
// the write goes through the mutation queue so it does not
// overwrite near-simultaneous deletions or adds. Both the extra item
// form and the ingredient modal use it (issue #249).
async function persistExtraItem(item, { create = true } = {}) {
  await enqueueMutation(async () => {
    for (const weekStart of [...selectedWeeks]) {
      const data = getMenuDataByWeek(weekStart);
      await updateMenuWeek(weekStart, { itemsExtra: [...(data.itemsExtra || []), item] }, { create });
    }
  });
}

async function addExtraItem() {
  const form = document.getElementById("shopping-extra-form");
  // Name and category come from the combo box (only the catalog
  // options write the hidden value; free text is not valid, recipes
  // pattern, issue #240). If there is no selection or the visible
  // text no longer matches, the row is discarded with a notice.
  const nombre = form.querySelector(".ing-nombre-valor").value.trim();
  const textoVisible = form.querySelector(".ing-nombre").value.trim();
  if (!nombre || normalizeIngredientName(textoVisible) !== normalizeIngredientName(nombre)) {
    showToast("Elige el ingrediente del desplegable (o créalo en la pestaña Ingredientes).");
    return;
  }
  const item = {
    nombre,
    cantidad: form.querySelector("#extra-cantidad").value === "" ? null : Number(form.querySelector("#extra-cantidad").value),
    unidad: normalizeUnit(form.querySelector("#extra-unidad").value),
    categoriaId: form.querySelector(".ing-categoria-valor").value,
    // The catalog does not store «edible»: it is inferred from the
    // category (the «hogar» category holds the cleaning products, and
    // the list marks those lines with their own style).
    comestible: form.querySelector(".ing-categoria-valor").value !== "hogar",
  };
  try {
    await persistExtraItem(item);
    showToast("Ítem añadido a la lista.");
    showingExtraForm = false;
    form.classList.add("hidden");
    renderShoppingList();
  } catch (err) {
    console.error("No se pudo añadir el ítem:", err);
    showToast("No se pudo añadir el ítem.");
  }
}
