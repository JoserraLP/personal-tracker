// Tests T-114 — AC-111 (issue #60; spec 02 UI-02 / REQ-101, API-01).
//
// Given: filtro `mediaType` (pestaña de tipo) + filtros de FilterBar.
// When:  se consulta `listByType` y se pinta el grid.
// Then:  solo se leen/docs del tipo filtrado (1 lectura por página),
//        el grid se vacía ANTES de cada recarga y solo se pintan ítems
//        del tipo activo (filtro defensivo en la vista).
//
// Cobertura en 2 niveles:
//  1. Lectura — tests/ac-111-113-catalog-repository.test.js comprueba
//     contra un store falso que `listByType` emite el filtro
//     `mediaType == tipo`, hace UNA lectura por página y devuelve solo
//     docs de ese tipo.
//  2. Vista — este archivo comprueba el cableado de js/app.js: 7
//     pestañas, `clearCatalogGrid()` antes de leer y el filtro
//     defensivo de mediaType. Sin DOM: js/app.js toca
//     `document`/Firebase al cargar, así que se lee su fuente.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MEDIA_TYPES, MEDIA_TYPE_LABELS } from "../js/ui/media-card.js";

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL("../js/app.js", import.meta.url)),
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

describe("AC-111 (REQ-101, UI-02): pestañas por tipo y filtro defensivo", () => {
  it("AC-111: 7 pestañas (una por tipo) con su mediaType", () => {
    // Fuente único de tipos: el componente MediaCard (DB-101).
    expect(MEDIA_TYPES).toHaveLength(7);
    for (const mediaType of MEDIA_TYPES) {
      expect(MEDIA_TYPE_LABELS[mediaType]).toBeTruthy();
    }

    const tabsBody = sliceBetween(
      APP_SOURCE,
      "for (const mediaType of CATALOG_MEDIA_TYPES) {",
      "tabs.addEventListener(\"keydown\", handleCatalogTabsKeydown);",
    );
    // Se generan 7 botones, uno por tipo, con dataset.mediaType.
    expect(APP_SOURCE).toContain("MEDIA_TYPES as CATALOG_MEDIA_TYPES");
    expect(tabsBody).toContain("const tab = createCatalogElement(");
    expect(tabsBody).toContain("tab.dataset.mediaType = mediaType;");
    expect(tabsBody).toContain(
      "tab.addEventListener(\"click\", () => selectCatalogType(mediaType));",
    );

    // La vista solo admite tipos del enum (defensa al cambiar de pestaña).
    const selectBody = sliceBetween(
      APP_SOURCE,
      "function selectCatalogType(mediaType)",
      "function resetCatalogFilters",
    );
    expect(selectBody).toContain("if (!CATALOG_MEDIA_TYPES.includes(mediaType)) return;");
  });

  it("AC-111: el grid se vacía ANTES de leer (y antes de cambiar de tipo)", () => {
    const clearBody = sliceBetween(
      APP_SOURCE,
      "function clearCatalogGrid()",
      "function resetCatalogPaging",
    );
    expect(clearBody).toContain("if (catalogViewDom.grid) catalogViewDom.grid.replaceChildren();");
    expect(clearBody).toContain("catalogView.items = [];");

    // Orden dentro de `loadCatalogPage`: vaciar → leer → pintar.
    const loadBody = sliceBetween(
      APP_SOURCE,
      "async function loadCatalogPage",
      "function catalogCardOptions",
    );
    const clearAt = loadBody.indexOf("clearCatalogGrid();");
    const readAt = loadBody.indexOf("catalogRepository.listByType(");
    const nonAppendAt = loadBody.indexOf("if (!append) {");
    expect(nonAppendAt).toBeGreaterThanOrEqual(0);
    expect(clearAt).toBeGreaterThan(nonAppendAt);
    expect(clearAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(clearAt);

    // Cambiar de pestaña resetea paginación (⇒ grid) ANTES de leer.
    const selectBody = sliceBetween(
      APP_SOURCE,
      "function selectCatalogType(mediaType)",
      "function resetCatalogFilters",
    );
    expect(selectBody.indexOf("resetCatalogPaging();")).toBeLessThan(
      selectBody.indexOf("loadCatalogPage({ append: false })"),
    );
    // Y vacía también filtros, para no mezclar criterios entre tipos.
    expect(selectBody).toContain("resetCatalogFilters();");
  });

  it("AC-111: solo se pintan ítems del tipo filtrado (filtro defensivo)", () => {
    const loadBody = sliceBetween(
      APP_SOURCE,
      "async function loadCatalogPage",
      "function catalogCardOptions",
    );
    expect(loadBody).toContain(
      "const typed = items.filter((item) => item && item.mediaType === catalogView.mediaType);",
    );
    // Tanto la carga inicial como el append pintan solo `typed`/`fresh`.
    expect(loadBody).toContain("catalogView.items = typed;");
    const appendBody = sliceBetween(
      APP_SOURCE,
      "function appendCatalogItems",
      "function updateCatalogGenreSuggestions",
    );
    expect(appendBody).toContain("items.filter((item) => item && !known.has(item.id));");
  });

  it("AC-111: el logout invalida la página en vuelo (no quedan tarjetas viejas)", () => {
    const resetBody = sliceBetween(
      APP_SOURCE,
      "function resetCatalogView()",
      "function catalogCleanup",
    );
    expect(resetBody).toContain("catalogView.requestId += 1;");
    expect(resetBody).toContain("clearCatalogGrid();");
    // La respuesta obsoleta se descarta antes de pintar.
    const loadBody = sliceBetween(
      APP_SOURCE,
      "async function loadCatalogPage",
      "function catalogCardOptions",
    );
    expect(loadBody).toContain("if (requestId !== catalogView.requestId) return;");
  });
});
