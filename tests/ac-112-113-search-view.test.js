// Tests T-115 — AC-112 y AC-113 (issue #61; spec 02 UI-03, REQ-102).
//
// Given: la vista de Búsqueda (input con debounce → `searchByTitle`).
// When:  se escribe un término y se consulta el repositorio.
// Then:  el término se normaliza (`normalizeTitle`) antes de consultar;
//        sin coincidencias/término vacío ⇒ estado vacío «Sin resultados»
//        SIN error (AC-113, API-04); un error real del repositorio ⇒
//        `showSearchError` controlado, sin excepción sin capturar; el
//        grid pinta con el `MediaCard` compartido (mismas opciones que
//        el catálogo) y el debounce es de 300 ms.
//
// Sin DOM: js/app.js toca `document`/Firebase al cargar, así que se lee
// su fuente (mismo patrón que ac-111-catalog-view.test.js) y la parte
// pura (normalizeTitle, searchByTitle) se comprueba importándola.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeTitle } from "../js/catalog.js";
import { resolveSearchByTitleQuery } from "../js/repositories/catalog-repository.js";

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL("../js/app.js", import.meta.url)),
  "utf8",
);
const INDEX_SOURCE = readFileSync(
  fileURLToPath(new URL("../index.html", import.meta.url)),
  "utf8",
);

/** Devuelve el tramo de fuente entre dos marcadores. */
function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

// Tramo de la vista de búsqueda (T-115): desde las constantes hasta
// el fin de `resetSearchView` (antes del Dashboard).
const SEARCH_BODY = sliceBetween(
  APP_SOURCE,
  "const SEARCH_DEBOUNCE_MS = 300;",
  "// Spec 003 — Dashboard",
);

// -------------------------------------------------------------
// AC-112 — búsqueda por prefijo tras normalizeTitle
// -------------------------------------------------------------

describe("AC-112 (REQ-102, UI-03): la vista normaliza antes de consultar", () => {
  it("AC-112: runSearch pasa normalizeTitle(rawTerm) a searchByTitle", () => {
    const runBody = sliceBetween(
      SEARCH_BODY,
      "async function runSearch",
      "/** Pinta el grid de `MediaCard` con los resultados (AC-116). */",
    );
    // El término se normaliza ANTES de la consulta («el últ»/«EL ÚLT»
    // ⇒ «el ult», mayúsculas/acento irrelevantes).
    expect(runBody).toContain("const term = normalizeTitle(rawTerm);");
    const normAt = runBody.indexOf("const term = normalizeTitle(rawTerm);");
    const queryAt = runBody.indexOf("catalogRepository.searchByTitle(term,");
    expect(queryAt).toBeGreaterThan(normAt);
    expect(runBody).toContain("catalogRepository.searchByTitle(term,");
    // Nunca se manda el crudo sin normalizar.
    expect(runBody).not.toContain("searchByTitle(rawTerm");
  });

  it("AC-112: la normalización usada es la compartida (DB-121) y el prefijo es de la query", () => {
    // Misma función que usa el repositorio ⇒ vista y repo coinciden.
    expect(normalizeTitle("el últ")).toBe("el ult");
    expect(normalizeTitle("EL ÚLT")).toBe("el ult");
    // Prefijo sobre titleNormalized (REQ-102): «ultimo sig» NO encuentra.
    const { term, spec } = resolveSearchByTitleQuery("ultimo sig");
    expect(term).toBe("ultimo sig");
    expect(spec.filters).toContainEqual({
      field: "titleNormalized",
      op: ">=",
      value: "ultimo sig",
    });
    const prefix = resolveSearchByTitleQuery("el últ");
    expect(prefix.spec.filters).toContainEqual({
      field: "titleNormalized",
      op: ">=",
      value: "el ult",
    });
  });

  it("AC-112: el input de búsqueda está cableado en index.html (UI-03)", () => {
    expect(INDEX_SOURCE).toContain('id="search-view-input"');
    expect(INDEX_SOURCE).toContain('id="search-view-form"');
    expect(INDEX_SOURCE).toContain('id="search-view-grid"');
  });
});

// -------------------------------------------------------------
// AC-113 — sin coincidencias ⇒ «Sin resultados» sin error;
//           errores del repositorio ⇒ estado de error controlado
// -------------------------------------------------------------

describe("AC-113 (REQ-102, API-04/API-05): estados vacío y de error", () => {
  it("AC-113: estado vacío «Sin resultados» (SEARCH_EMPTY_TEXT) sin error", () => {
    // Texto único para el estado vacío (UI-03).
    expect(SEARCH_BODY).toContain('const SEARCH_EMPTY_TEXT = "Sin resultados";');
    // Se aplica al nodo vacío al montar y al pintar el estado.
    expect(SEARCH_BODY.match(/emptyText\.textContent = SEARCH_EMPTY_TEXT;/g)).toHaveLength(2);

    // `hasSearched` + sin ítems ⇒ vacío visible; el error permanece oculto.
    const stateBody = sliceBetween(
      SEARCH_BODY,
      "function renderSearchState()",
      "/** Muestra u oculta el botón «Cargar más» según el cursor (API-02). */",
    );
    expect(stateBody).toContain(
      "searchViewDom.empty.hidden = hasItems || !searchView.hasSearched || searchView.loading;",
    );
    expect(stateBody).toContain("} else if (searchView.hasSearched) {");
    expect(stateBody).toContain("searchViewDom.status.textContent = SEARCH_EMPTY_TEXT;");

    // La ruta de éxito NUNCA toca el nodo de error.
    const runBody = sliceBetween(
      SEARCH_BODY,
      "async function runSearch",
      "/** Pinta el grid de `MediaCard` con los resultados (AC-116). */",
    );
    expect(runBody).toContain("hideSearchError();");
    // `ok:true` ⇒ items (aunque sea []) y hasSearched al final.
    expect(runBody).toContain("searchView.hasSearched = true;");
    expect(runBody).toContain("const items = Array.isArray(page.items) ? page.items : [];");
    // Un resultado ok SIN excepción: no hay throw en la ruta de éxito.
    expect(runBody).not.toContain("throw ");
  });

  it("AC-113: error del repositorio ⇒ showSearchError (Result), sin excepción sin capturar", () => {
    const runBody = sliceBetween(
      SEARCH_BODY,
      "async function runSearch",
      "/** Pinta el grid de `MediaCard` con los resultados (AC-116). */",
    );
    // Result `ok:false` ⇒ error controlado + grid limpio (no tarjetas viejas).
    expect(runBody).toContain("if (!result || result.ok !== true) {");
    expect(runBody).toContain("showSearchError(");
    expect(runBody).toContain("No se ha podido completar la búsqueda.");
    expect(runBody).toContain("clearSearchGrid();");
    // El error se muestra por mensaje del Result (API-05), no por throw.
    const errorBody = sliceBetween(
      SEARCH_BODY,
      "function showSearchError(message)",
      "/** Oculta el error de la vista de búsqueda. */",
    );
    expect(errorBody).toContain("error.textContent = message;");
    expect(errorBody).toContain("error.hidden = false;");
    // Ninguna ruta de runSearch lanza: todo es Result, no excepción.
    expect(runBody).not.toContain("throw ");
    expect(runBody).not.toContain("reject(");

    // La vista consume Result, no promesas rechazadas (contrato API-04/05).
    expect(INDEX_SOURCE).toContain('id="search-view-error"');
    expect(INDEX_SOURCE).toContain('role="alert"');
  });
});

// -------------------------------------------------------------
// Done-when — debounce 300 ms y grid con MediaCard compartido
// -------------------------------------------------------------

describe("T-115 done-when: debounce 300 ms y MediaCard compartida", () => {
  it("debounce: SEARCH_DEBOUNCE_MS === 300 y el temporizador se programa en handleSearchInput", () => {
    expect(SEARCH_BODY).toContain("const SEARCH_DEBOUNCE_MS = 300;");
    const inputBody = sliceBetween(
      SEARCH_BODY,
      "function handleSearchInput()",
      "/** Envío explícito del formulario: busca sin esperar al debounce. */",
    );
    // Se reprograma en cada pulsación (clearTimeout + setTimeout 300 ms):
    // una sola consulta a los 300 ms, ninguna antes.
    expect(inputBody).toContain("clearTimeout(searchView.debounceTimer);");
    expect(inputBody).toContain("searchView.debounceTimer = setTimeout(() => {");
    expect(inputBody).toContain("}, SEARCH_DEBOUNCE_MS);");
    // La consulta SOLO sale del callback del debounce (o submit/cambio
    // de tipo), nunca de forma síncrona al escribir.
    expect(inputBody).toContain("void runSearch({ append: false });");
    // Solo hay UNA llamada a runSearch en el handler de input (la del
    // callback del debounce): ninguna consulta es síncrona al escribir.
    expect(inputBody.match(/runSearch\(/g)).toHaveLength(1);
    // El envío explícito cancela el temporizador pendiente.
    const submitBody = sliceBetween(
      SEARCH_BODY,
      "function handleSearchSubmit(event)",
      "/** Cambio de tipo: relanza la búsqueda con el tipo elegido. */",
    );
    expect(submitBody).toContain("clearTimeout(searchView.debounceTimer);");
    // Al desmontar/cerrar sesión no queda ningún timer vivo.
    const resetBody = sliceBetween(
      SEARCH_BODY,
      "function resetSearchView()",
      "// =============================================================",
    );
    expect(resetBody).toContain("clearTimeout(searchView.debounceTimer);");
    expect(resetBody).toContain("searchView.debounceTimer = null;");
  });

  it("grid: renderSearchGrid usa mountMediaCards(..., mediaCardOptions())", () => {
    const renderBody = sliceBetween(
      SEARCH_BODY,
      "function renderSearchGrid()",
      "function appendSearchItems(items)",
    );
    expect(renderBody).toContain(
      "mountMediaCards(grid, searchView.items, mediaCardOptions());",
    );
    // «Cargar más» ⇒ mismo componente con las mismas opciones.
    const appendBody = sliceBetween(
      SEARCH_BODY,
      "function appendSearchItems(items)",
      "/** Vacía el grid de resultados. */",
    );
    expect(appendBody).toContain(
      "fragment.appendChild(createMediaCard(item, mediaCardOptions()));",
    );
    // Mismas opciones que el catálogo (fuente única compartida).
    expect(APP_SOURCE).toContain("function mediaCardOptions()");
    expect(APP_SOURCE).toContain("return mediaCardOptions();");
    // Y la clase compartida de rejilla (mismos estilos).
    expect(INDEX_SOURCE).toContain('<ul id="search-view-grid" class="media-grid"');
  });
});
