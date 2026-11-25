// Tests T-114 — AC-116 (issue #60; spec 02 UI-01/UI-02, REQ-106).
//
// Given: las vistas que pintan tarjetas.
// When:  renderizan el grid del catálogo (1ª página y «Cargar más»).
// Then:  usan el MISMO componente `MediaCard` compartido
//        (`mountMediaCards` / `createMediaCard` de js/ui/media-card.js),
//        con las mismas opciones ⇒ mismo DOM y mismos estilos.
//
// Sin DOM: js/ui/media-card.js es importable en Node (parte pura +
// export de la parte DOM) y el cableado de la vista se comprueba
// sobre el fuente de js/app.js (que toca `document`/Firebase al
// cargar y por eso no se importa en Node).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as mediaCard from "../js/ui/media-card.js";

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

describe("AC-116 (UI-01/REQ-106): MediaCard compartida en el grid del catálogo", () => {
  it("AC-116: js/ui/media-card.js exporta createMediaCard y mountMediaCards", () => {
    expect(typeof mediaCard.createMediaCard).toBe("function");
    expect(typeof mediaCard.mountMediaCards).toBe("function");
    expect(mediaCard.default).toBe(mediaCard.createMediaCard);
    // El componente es único y polimórfico: 7 tipos y su mapa de etiquetas.
    expect(mediaCard.MEDIA_TYPES).toHaveLength(7);
    expect(Object.keys(mediaCard.MEDIA_TYPE_LABELS)).toHaveLength(7);
  });

  it("AC-116: la vista importa SOLO el componente compartido", () => {
    const imports = APP_SOURCE.match(/from\s+"\.\/ui\/media-card\.js"/g) ?? [];
    expect(imports).toHaveLength(1);

    // Bloque `import { … } from "./ui/media-card.js";` (CRLF-safe).
    const endMarker = "} from \"./ui/media-card.js\";";
    const endAt = APP_SOURCE.indexOf(endMarker);
    expect(endAt).toBeGreaterThanOrEqual(0);
    const importBlock = APP_SOURCE.slice(Math.max(0, endAt - 600), endAt + endMarker.length);
    expect(importBlock).toContain("createMediaCard,");
    expect(importBlock).toContain("mountMediaCards,");
    expect(importBlock).toContain("MEDIA_TYPES as CATALOG_MEDIA_TYPES");
    expect(importBlock).toContain("MEDIA_TYPE_LABELS as CATALOG_MEDIA_TYPE_LABELS");
  });

  it("AC-116: el grid se pinta con mountMediaCards/createMediaCard", () => {
    // 1ª página ⇒ mountMediaCards (mismo DOM que el resto de vistas).
    const renderBody = sliceBetween(
      APP_SOURCE,
      "function renderCatalogGrid",
      "function appendCatalogItems",
    );
    expect(renderBody).toContain(
      "mountMediaCards(grid, catalogView.items, catalogCardOptions());",
    );

    // «Cargar más» ⇒ createMediaCard con las MISMAS opciones (AC-110+AC-116).
    const appendBody = sliceBetween(
      APP_SOURCE,
      "function appendCatalogItems",
      "function updateCatalogGenreSuggestions",
    );
    expect(appendBody).toContain(
      "fragment.appendChild(createMediaCard(item, catalogCardOptions()));",
    );

    // Ambas rutas comparten opciones ⇒ mismo DOM/estilos en las 4 vistas.
    expect(renderBody).toContain("catalogCardOptions()");
    expect(appendBody).toContain("catalogCardOptions()");
    expect(APP_SOURCE).toContain("function catalogCardOptions()");

    // El grid reutiliza la clase compartida de rejilla (estilos únicos).
    expect(APP_SOURCE).toContain('grid.className = "media-grid";');
  });

  it("AC-116: el catálogo no pinta tarjetas con markup propio", () => {
    // La vista del catálogo NO construye `<li class="catalog-card">`
    // (markup legacy de Favoritos/Colecciones): solo `MediaCard`.
    const catalogBody = sliceBetween(
      APP_SOURCE,
      "function mountCatalogView",
      "function syncCatalogTabs",
    );
    expect(catalogBody).not.toContain("catalog-card");
    expect(catalogBody).not.toContain("innerHTML");

    // Ninguna función del catálogo genera el marcado legacy.
    const catalogFns = [
      "function renderCatalogGrid",
      "function appendCatalogItems",
      "function renderCatalogState",
    ];
    for (const marker of catalogFns) {
      const start = APP_SOURCE.indexOf(marker);
      expect(start).toBeGreaterThanOrEqual(0);
      const body = APP_SOURCE.slice(start, start + 1600);
      expect(body).not.toContain("<li class=\"catalog-card\"");
      expect(body).not.toContain("innerHTML =");
    }
  });
});
