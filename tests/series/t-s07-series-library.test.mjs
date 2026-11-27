// =============================================================
// T-S07 — QA de `js/series/seriesView.js` (UI-S05, ALG-S02,
// REQ-S13). Criterios: AC-S13 (favorito optimista de la tarjeta),
// AC-S24 (cuatro filtros combinados con AND + «Limpiar filtros») y
// AC-S25 (siete claves de orden, colación es-ES y nulls al final).
//
// `seriesView.js` importa `seriesRepository.js` (Firebase), así que
// no se puede cargar tal cual en Node. Igual que en T-S06, estas
// pruebas extraen del fuente (solo lectura) las funciones puras y las
// ejecutan contra un DOM falso; `seriesState.js` sí se importa
// directamente porque es puro. No se modifica ningún fichero de la
// aplicación.
// =============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_SORT_KEY,
  createLibraryFilters,
  filterSeries,
  parseUserRating,
  SORT_OPTIONS,
  sortSeries,
} from "../../js/series/seriesState.js";

const viewSrc = readFileSync(
  new URL("../../js/series/seriesView.js", import.meta.url),
  "utf8"
);
const htmlSrc = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

// -------------------------------------------------------------
// Extractores (el cierre de cada función/constante está en la
// columna 0 del fichero)
// -------------------------------------------------------------

function extractFunction(name) {
  const start = viewSrc.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `función no encontrada: ${name}`);
  const end = viewSrc.indexOf("\n}\n", start);
  assert.ok(end > start, `cierre no encontrado: ${name}`);
  return viewSrc.slice(start, end + 2);
}

function extractSimpleConst(name) {
  const start = viewSrc.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `constante no encontrada: ${name}`);
  const end = viewSrc.indexOf(";", start);
  assert.ok(end > start, `cierre no encontrado: ${name}`);
  return viewSrc.slice(start, end + 1);
}

/** Evalúa `const <name> = …;` y devuelve su valor. */
function constValue(name) {
  return new Function(`${extractSimpleConst(name)}\nreturn ${name};`)();
}

// -------------------------------------------------------------
// DOM falso mínimo
// -------------------------------------------------------------

class FakeElement {}

function fakeNode(props = {}) {
  const node = Object.create(FakeElement.prototype);
  Object.assign(node, {
    textContent: "",
    hidden: false,
    id: "",
    value: "",
    style: {},
    attrs: {},
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    getAttribute(key) {
      return key in this.attrs ? this.attrs[key] : null;
    },
    removeAttribute(key) {
      delete this.attrs[key];
    },
    querySelector() {
      return null;
    },
    closest() {
      return null;
    },
    ...props,
  });
  return node;
}

function roleOf(selector) {
  const match = /\[data-series-role="([^"]+)"\]/.exec(selector);
  return match ? match[1] : null;
}

/** `<select>` falso: `clearNode` recorre `firstChild`/`removeChild`. */
function fakeSelect(value = "") {
  const children = [];
  const node = fakeNode({
    value,
    append(child) {
      children.push(child);
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
    },
  });
  Object.defineProperty(node, "firstChild", { get: () => children[0] ?? null });
  node.children = children;
  return node;
}

// -------------------------------------------------------------
// AC-S13 — favorito optimista: aria-pressed + parcheo de estado
// -------------------------------------------------------------

function buildFavoriteHarness() {
  const cardModels = new WeakMap();
  const state = {
    library: [
      { id: "d1", name: "Dark", isFavorite: false },
      { id: "d2", name: "Otra", isFavorite: false },
    ],
    libraryFiltered: [
      { id: "d1", name: "Dark", isFavorite: false },
      { id: "d2", name: "Otra", isFavorite: false },
    ],
    libraryByDocId: new Map([
      ["d1", { id: "d1", name: "Dark", isFavorite: false }],
    ]),
  };

  const code = [
    extractFunction("updateFavoriteButton"),
    extractFunction("applyLibraryFavorite"),
    "return { updateFavoriteButton, applyLibraryFavorite };",
  ].join("\n");

  const fns = new Function("cardModels", "state", code)(cardModels, state);
  return { ...fns, cardModels, state };
}

/** Tarjeta de biblioteca con su botón de favorito y modelo vivo. */
function makeFavoriteButton(cardModels, docId) {
  const model = { context: "library", docId, title: "Dark", isFavorite: false };
  const card = fakeNode();
  cardModels.set(card, model);

  const label = fakeNode();
  const button = fakeNode({
    querySelector(selector) {
      return roleOf(selector) === "favorite-label" ? label : null;
    },
    closest(selector) {
      return roleOf(selector) === "card" ? card : null;
    },
  });
  return { button, label, model };
}

/** Réplica del camino optimista de `handleToggleFavorite`. */
function toggleFavorite(harness, button, model) {
  const next = !model.isFavorite;
  model.isFavorite = next;
  harness.updateFavoriteButton(button, next);
  harness.applyLibraryFavorite(model.docId, next);
}

test("AC-S13 · el favorito de la tarjeta alterna aria-pressed y parchea la biblioteca (UI-S04)", () => {
  const harness = buildFavoriteHarness();
  const { button, label, model } = makeFavoriteButton(harness.cardModels, "d1");
  const otherLibraryItem = harness.state.library[1];
  const otherFilteredItem = harness.state.libraryFiltered[1];

  // Pulsar: false → true.
  toggleFavorite(harness, button, model);
  assert.equal(button.getAttribute("aria-pressed"), "true", "aria-pressed activo");
  assert.equal(label.textContent, "Favorita");
  assert.equal(button.getAttribute("aria-label"), "Quitar Dark de favoritas");
  assert.equal(harness.state.library[0].isFavorite, true, "state.library parcheado");
  assert.equal(harness.state.libraryFiltered[0].isFavorite, true, "libraryFiltered parcheado");
  assert.equal(harness.state.libraryByDocId.get("d1").isFavorite, true);
  // Las series que no son la pulsada conservan su referencia.
  assert.equal(harness.state.library[1], otherLibraryItem);
  assert.equal(harness.state.libraryFiltered[1], otherFilteredItem);
  assert.equal(otherLibraryItem.isFavorite, false);

  // Pulsar de nuevo: true → false (la inversión es simétrica).
  toggleFavorite(harness, button, model);
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(label.textContent, "Marcar favorita");
  assert.equal(button.getAttribute("aria-label"), "Marcar Dark como favorita");
  assert.equal(harness.state.library[0].isFavorite, false);
  assert.equal(harness.state.libraryFiltered[0].isFavorite, false);
  assert.equal(harness.state.libraryByDocId.get("d1").isFavorite, false);

  // El manejador real encadena modelo → botón → estado → Firestore.
  assert.match(viewSrc, /model\.isFavorite = next;/);
  assert.match(
    viewSrc,
    /updateFavoriteButton\(button, next\);\s*\n\s*applyLibraryFavorite\(docId, next\);/
  );
  assert.match(viewSrc, /await setFavorite\(docId, next\);/, "persiste en Firestore");
});

// -------------------------------------------------------------
// AC-S24 — cuatro filtros combinados con AND
// -------------------------------------------------------------

/** Biblioteca de 7 series: solo dos cumplen los cuatro filtros. */
const AC_S24_LIBRARY = [
  { id: "s1", name: "Cumple ocho", status: "watched", genreIds: [18], collectionIds: ["c1"], userRating: 8 },
  { id: "s2", name: "Cumple diez", status: "watched", genreIds: [18], collectionIds: ["c1"], userRating: 10 },
  { id: "s3", name: "Nota 7,9", status: "watched", genreIds: [18], collectionIds: ["c1"], userRating: 7.9 },
  { id: "s4", name: "Sin nota", status: "watched", genreIds: [18], collectionIds: ["c1"], userRating: null },
  { id: "s5", name: "Otro estado", status: "watching", genreIds: [18], collectionIds: ["c1"], userRating: 9 },
  { id: "s6", name: "Otro género", status: "watched", genreIds: [35], collectionIds: ["c1"], userRating: 9 },
  { id: "s7", name: "Otra colección", status: "watched", genreIds: [18], collectionIds: ["c2"], userRating: 9 },
];

/** Entorno real de `readLibraryFilters`/`clearLibraryFilters` con DOM falso. */
function buildLibraryFilterHarness() {
  const cleared = [];
  const calls = { sync: 0, render: 0, ranges: [] };

  const dom = {
    library: {
      search: fakeNode({ value: "" }),
      status: fakeNode({ value: "" }),
      genre: fakeNode({ value: "" }),
      collection: fakeNode({ value: "" }),
      ratingMin: fakeNode({ value: "" }),
      ratingMax: fakeNode({ value: "" }),
      sort: fakeNode({ value: DEFAULT_SORT_KEY }),
    },
  };
  const state = { libraryFilters: null, libraryRatingRange: null };

  const factory = new Function(
    "dom",
    "state",
    "createLibraryFilters",
    "parseUserRating",
    "DEFAULT_SORT_KEY",
    "applyRatingRangeState",
    "syncServerSubscription",
    "renderLibrary",
    "clearTimeout",
    `
    let librarySearchTimer = null;
    ${extractFunction("readRatingValue")}
    ${extractFunction("readRatingRange")}
    ${extractFunction("readLibraryFilters")}
    ${extractFunction("applyLibraryFilters")}
    ${extractFunction("clearLibraryFilters")}
    return {
      readLibraryFilters,
      clearLibraryFilters,
      setLibrarySearchTimer: (timer) => { librarySearchTimer = timer; },
      getLibrarySearchTimer: () => librarySearchTimer,
    };
    `
  );

  const harness = factory(
    dom,
    state,
    createLibraryFilters,
    parseUserRating,
    DEFAULT_SORT_KEY,
    (range) => calls.ranges.push(range),
    () => {
      calls.sync += 1;
    },
    () => {
      calls.render += 1;
    },
    (timer) => cleared.push(timer)
  );

  return { ...harness, dom, state, calls, cleared };
}

test("AC-S24 · estado + género + colección + nota 8–10 se combinan con AND (ALG-S02)", () => {
  const { dom, readLibraryFilters } = buildLibraryFilterHarness();

  dom.library.status.value = "watched"; // «Completadas»
  dom.library.genre.value = "18"; // «Drama»
  dom.library.collection.value = "c1";
  dom.library.ratingMin.value = "8";
  dom.library.ratingMax.value = "10";
  dom.library.sort.value = "addedAt";

  const filters = readLibraryFilters();
  assert.deepEqual(filters, {
    query: "",
    status: "watched",
    favorite: false,
    genreId: 18,
    collectionId: "c1",
    ratingMin: 8,
    ratingMax: 10,
    sort: "addedAt",
  });

  const visible = filterSeries(AC_S24_LIBRARY, filters);
  // Solo las que cumplen los cuatro: 8 y 10 son límites inclusivos.
  assert.deepEqual(
    visible.map((series) => series.id),
    ["s1", "s2"]
  );
  for (const id of ["s3", "s4", "s5", "s6", "s7"]) {
    assert.ok(
      !visible.some((series) => series.id === id),
      `${id} no cumple los cuatro filtros y debe quedar fuera`
    );
  }
  // Exclusión explícita de `userRating: null` con rango fijado.
  assert.equal(visible.some((series) => series.userRating === null), false);
});

test("AC-S24 · «Limpiar filtros» restablece los controles y restaura la lista completa", () => {
  const harness = buildLibraryFilterHarness();
  const { dom, state, calls, cleared } = harness;

  // Filtros activos distintos de los defaults (lista estrictamente parcial).
  dom.library.search.value = "Cumple";
  dom.library.status.value = "watched";
  dom.library.genre.value = "18";
  dom.library.collection.value = "c1";
  dom.library.ratingMin.value = "8";
  dom.library.ratingMax.value = "10";
  dom.library.sort.value = "name";
  harness.setLibrarySearchTimer({ id: "timer-1" });

  const partial = filterSeries(AC_S24_LIBRARY, harness.readLibraryFilters());
  assert.equal(partial.length, 2, "con filtros activos no se ve la lista completa");

  harness.clearLibraryFilters();

  // Cancela el debounce de búsqueda y limpia todos los controles.
  assert.deepEqual(cleared, [{ id: "timer-1" }]);
  assert.equal(harness.getLibrarySearchTimer(), null);
  assert.equal(dom.library.search.value, "");
  assert.equal(dom.library.status.value, "");
  assert.equal(dom.library.genre.value, "");
  assert.equal(dom.library.collection.value, "");
  assert.equal(dom.library.ratingMin.value, "");
  assert.equal(dom.library.ratingMax.value, "");
  assert.equal(dom.library.sort.value, "addedAt", "orden vuelve a «Fecha de añadido»");

  // Filtros y rango de nota vuelven a sus valores por defecto.
  assert.deepEqual(state.libraryFilters, {
    query: "",
    status: "",
    favorite: false,
    genreId: null,
    collectionId: "",
    ratingMin: null,
    ratingMax: null,
    sort: "addedAt",
  });
  assert.deepEqual(state.libraryRatingRange, constValue("EMPTY_RATING_RANGE"));
  assert.equal(calls.ranges.length, 1, "el rango se valida una sola vez");
  assert.equal(calls.sync, 1, "renueva la suscripción sin filtros");
  assert.equal(calls.render, 1, "repinta la biblioteca");

  // La lista completa vuelve a pintarse.
  const full = filterSeries(AC_S24_LIBRARY, state.libraryFilters);
  assert.equal(full.length, AC_S24_LIBRARY.length);

  // El botón «Limpiar filtros» existe y llama a clearLibraryFilters.
  assert.ok(htmlSrc.includes('id="series-library-clear"'));
  assert.ok(htmlSrc.includes(">Limpiar filtros</button>"));
  assert.match(
    viewSrc,
    /library\.clear\?\.addEventListener\("click", clearLibraryFilters\)/
  );
});

// -------------------------------------------------------------
// AC-S25 — siete claves de orden con etiquetas en español
// -------------------------------------------------------------

const EXPECTED_SORT_LABELS = [
  ["addedAt", "Fecha de añadido"],
  ["lastWatchedAt", "Último episodio visto"],
  ["progress", "Progreso"],
  ["userRating", "Mi puntuación"],
  ["tmdbRating", "Puntuación TMDB"],
  ["firstAirYear", "Año de estreno"],
  ["name", "Título (A-Z)"],
];

/** Construye `populateSortFilter` real con un `<select>` falso. */
function buildSortPopulateHarness() {
  const select = fakeSelect();
  const dom = { library: { sort: select } };
  const document = { createElement: () => fakeNode() };

  const code = [
    extractFunction("clearNode"),
    extractFunction("populateSortFilter"),
    "return populateSortFilter;",
  ].join("\n");

  const populateSortFilter = new Function(
    "dom",
    "document",
    "SORT_OPTIONS",
    "DEFAULT_SORT_KEY",
    code
  )(dom, document, SORT_OPTIONS, DEFAULT_SORT_KEY);

  return { populateSortFilter, select };
}

test("AC-S25 · SORT_OPTIONS tiene 7 claves en español y populateSortFilter usa addedAt por defecto", () => {
  assert.equal(SORT_OPTIONS.length, 7, "siete claves de orden");
  assert.deepEqual(
    SORT_OPTIONS.map((option) => [option.value, option.label]),
    EXPECTED_SORT_LABELS
  );
  assert.equal(DEFAULT_SORT_KEY, "addedAt");
  const allLabels = SORT_OPTIONS.map((option) => option.label).join(" | ");
  assert.match(allLabels, /[áéíóúñ]/, "etiquetas en español con tildes/ñ");
  assert.match(allLabels, /Título \(A-Z\)/);

  const { populateSortFilter, select } = buildSortPopulateHarness();
  populateSortFilter();
  assert.deepEqual(
    select.children.map((node) => [node.value, node.textContent]),
    EXPECTED_SORT_LABELS
  );
  assert.equal(select.value, "addedAt", "orden por defecto «Fecha de añadido»");

  // Una segunda llamada repuebla sin duplicar opciones (clearNode).
  populateSortFilter();
  assert.equal(select.children.length, 7);
});

// -------------------------------------------------------------
// AC-S25 — orden de cliente (colación es-ES y nulls al final)
// -------------------------------------------------------------

test("AC-S25 · «Título (A-Z)» respeta la colación es-ES", () => {
  const series = [
    { id: "z", name: "Zoé" },
    { id: "a", name: "Álvaro" },
    { id: "b", name: "Beta" },
  ];

  const sorted = sortSeries(series, "name");
  assert.deepEqual(
    sorted.map((item) => item.name),
    ["Álvaro", "Beta", "Zoé"]
  );

  // No es la ordenación por códigos de unidad (Á va después de Z ahí).
  assert.notDeepEqual(
    sorted.map((item) => item.name),
    series.map((item) => item.name).sort()
  );
  // Y coincide exactamente con Intl.Collator("es-ES").
  const collator = new Intl.Collator("es-ES");
  assert.deepEqual(
    sorted.map((item) => item.name),
    series.map((item) => item.name).sort(collator.compare)
  );
  // No muta la entrada.
  assert.deepEqual(series.map((item) => item.id), ["z", "a", "b"]);
});

test("AC-S25 · «Mi puntuación» deja los userRating null al final sin perder series", () => {
  const series = [
    { id: "r9", name: "Nueve", userRating: 9 },
    { id: "rn1", name: "Zeta sin nota", userRating: null },
    { id: "r75", name: "Siete", userRating: 7.5 },
    { id: "rn2", name: "Alfa sin nota", userRating: null },
    { id: "r8", name: "Ocho", userRating: 8 },
  ];

  const sorted = sortSeries(series, "userRating");
  assert.equal(sorted.length, series.length, "ninguna serie desaparece");
  // Descendente por nota; los null empatados van al final por nombre.
  assert.deepEqual(
    sorted.map((item) => item.id),
    ["r9", "r8", "r75", "rn2", "rn1"]
  );
  assert.equal(sorted[3].userRating, null);
  assert.equal(sorted[4].userRating, null);
  assert.ok(
    sorted.slice(0, 3).every((item) => typeof item.userRating === "number"),
    "las puntuadas encabezan la lista"
  );
});

test("AC-S25 · «Progreso» deja al final las series sin numberOfEpisodes", () => {
  const series = [
    { id: "p3", name: "Sin total", watchedEpisodesCount: 999, numberOfEpisodes: null },
    { id: "p1", name: "Completa", watchedEpisodesCount: 20, numberOfEpisodes: 20 },
    { id: "p4", name: "Cero episodios", watchedEpisodesCount: 3, numberOfEpisodes: 0 },
    { id: "p2", name: "A medias", watchedEpisodesCount: 5, numberOfEpisodes: 20 },
  ];

  const sorted = sortSeries(series, "progress");
  assert.equal(sorted.length, series.length, "ninguna serie desaparece");
  // 20/20 = 100 % por delante de 5/20 = 25 % (descendente).
  assert.deepEqual(
    sorted.slice(0, 2).map((item) => item.id),
    ["p1", "p2"]
  );
  // Sin total conocido (null o 0) al final, aunque tengan más vistos.
  assert.deepEqual(
    sorted.slice(2).map((item) => item.id).sort(),
    ["p3", "p4"]
  );
});
