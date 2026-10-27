// =============================================================
// Recipe data (issue #64): predefined labels for ingredient
// categories, allergens and meal types, plus helpers for
// normalization and merging with the user's custom tags
// (users/{uid}/tags).
// =============================================================

// Ingredient categories (predefined for everyone). The issue asked
// to review the initial 9 and expand them: «Bebidas y cafés»,
// «Congelados» and «Otros» are added. Each category carries its own
// icon (emoji, with UI precedent: 👤 in sidebar/global-search) that
// shows next to its group title in the catalog (issue #224).
export const INGREDIENT_CATEGORIES = [
  { id: "frutas_verduras", label: "Frutas, verduras y hortalizas", icon: "🍎" },
  { id: "carnes_aves", label: "Carnes y aves", icon: "🥩" },
  { id: "pescado_mariscos", label: "Pescado y mariscos", icon: "🐟" },
  { id: "lacteos_huevos", label: "Lácteos y huevos", icon: "🥛" },
  { id: "legumbres_cereales", label: "Legumbres, cereales y harinas", icon: "🌾" },
  { id: "despensa_basicos", label: "Despensa y básicos", icon: "🧂" },
  { id: "especias_hierbas", label: "Especias, hierbas y condimentos", icon: "🌿" },
  { id: "aperitivos_dulces", label: "Aperitivos y dulces", icon: "🍿" },
  { id: "hogar", label: "Artículos del hogar", icon: "🧼" },
  { id: "bebidas_cafes", label: "Bebidas y cafés", icon: "☕" },
  { id: "congelados", label: "Congelados", icon: "❄️" },
  { id: "otros", label: "Otros", icon: "🗂️" },
];

// Icon of the user's custom categories (issue #224).
export const CUSTOM_CATEGORY_ICON = "🏷️";

// Icon of the «Sin categoría» group (issue #224).
export const UNCATEGORIZED_ICON = "🧺";

// Supermarkets for the ingredient detail view (issue #224):
// optional labels of where each ingredient can be bought. Brand
// colors live in the CSS (css/styles.css), not here: this file only
// defines ids and labels.
export const SUPERMARKETS = [
  { id: "lidl", label: "Lidl" },
  { id: "aldi", label: "Aldi" },
  { id: "mercadona", label: "Mercadona" },
  { id: "dia", label: "Día" },
  { id: "carrefour", label: "Carrefour" },
  { id: "el_corte_ingles", label: "El Corte Inglés" },
];

// Allergens / dietary tags (predefined). «Sin frutos secos» and
// «Sin huevo» are added to the four from the issue.
export const ALERGEN_TAGS = [
  { id: "sin_gluten", label: "Sin gluten" },
  { id: "vegetariano", label: "Vegetariano" },
  { id: "vegano", label: "Vegano" },
  { id: "sin_lactosa", label: "Sin lactosa" },
  { id: "sin_frutos_secos", label: "Sin frutos secos" },
  { id: "sin_huevo", label: "Sin huevo" },
];

// Meal types (predefined). «Salsas y guarniciones», «Desayunos»
// and «Bebidas» are added to the five from the issue.
export const MEAL_TYPES = [
  { id: "entrante", label: "Entrante" },
  { id: "cuchara", label: "Plato de cuchara" },
  { id: "principal", label: "Plato principal" },
  { id: "masas_panes", label: "Masas y panes" },
  { id: "postres", label: "Postres y dulces" },
  { id: "salsas_guarniciones", label: "Salsas y guarniciones" },
  { id: "desayunos", label: "Desayunos" },
  { id: "bebidas", label: "Bebidas" },
];

// Grouping by tag type (the value of `tipo` in the
// users/{uid}/tags collection and in the UI selectors).
export const TAGS_BY_TYPE = {
  ingrediente: INGREDIENT_CATEGORIES,
  alergeno: ALERGEN_TAGS,
  tipo: MEAL_TYPES,
};

// Week days and menu meals (fixed, not configurable). Breakfast was
// removed in issue #242: the menu covers lunch and dinner.
export const DAY_KEYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
export const DAY_LABELS = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sábado",
  domingo: "Domingo",
};
export const MEAL_KEYS = ["almuerzo", "cena"];
export const MEAL_LABELS = { almuerzo: "Almuerzo", cena: "Cena" };

// Slug normalization for tag and ingredient keys: removes accents,
// lowercases and replaces separators with "_".
export function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Normalized ingredient name (for aggregating quantities in the
// shopping list and for the ingredient catalog).
export function normalizeIngredientName(name) {
  return slugify(name).replace(/_+/g, " ");
}

// Normalized unit (free string: g, kg, ml, unidades...).
export function normalizeUnit(unit) {
  return String(unit || "").trim().toLowerCase();
}

// Measurement units to add an item to the shopping list (issue
// #249, iteration): dropdown with the exact options the user asked
// for. The value is normalized with normalizeUnit before persisting
// (g, kg, ml, l, unidades).
export const SHOPPING_UNITS = ["g", "Kg", "mL", "L", "Unidades"];

// Merges the predefined tags with the user's custom ones (docs of
// users/{uid}/tags with { nombre, tipo }). Custom ones carry
// custom: true for the selection UI.
export function mergeTags(predefined, customTags) {
  const out = (predefined || []).map((t) => ({ id: t.id, label: t.label, custom: false }));
  (customTags || []).forEach((t) => out.push({ id: t.id, label: t.nombre, custom: true }));
  return out;
}

// Returns the tags (predefined + custom) whose ids are in `ids`,
// keeping the order of the ids array.
export function tagsByIds(predefined, customTags, ids) {
  const byId = new Map(mergeTags(predefined, customTags).map((t) => [t.id, t]));
  return (ids || []).map((id) => byId.get(id)).filter(Boolean);
}

// Escapes text so it can be safely injected with innerHTML.
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

// Formats a quantity: rounds to 2 decimals and strips trailing
// zeros ("1.5", "2", "0.33").
export function formatCantidad(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

// ISO date (YYYY-MM-DD) of the Monday of the current week shifted
// `offset` weeks (0 = this week, -1 = previous, 1 = next).
// The weekly menu is stored anchored to the Monday of the ISO week.
export function mondayISO(offset = 0) {
  const now = new Date();
  const daysFromMonday = (now.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMonday + offset * 7);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Adds `days` days to an ISO date and returns it in the same
// format. Used to label the week days of the menu.
export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Readable date from an ISO date ("2026-08-10" → "10/08/2026").
export function formatDateEs(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}