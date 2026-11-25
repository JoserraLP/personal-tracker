// Tests T-114 — AC-110 (issue #60; spec 02 UI-02 / REQ-101, API-02).
//
// Given: catálogo con >24 ítems de un tipo.
// When:  se abre la pestaña del tipo y se pulsa «Cargar más».
// Then:  24 tarjetas por página; `LoadMore` añade el siguiente lote
//        SIN recargar, con cursor opaco (nunca un snapshot).
//
// Dos niveles, sin DOM:
//  1. Comportamiento — `CatalogRepository.listByType` puro con store
//     falso (misma técnica que tests/ac-111-113-catalog-repository):
//     24 por página, cursor opaco y páginas sin solapes. Aquí se usa
//     el repositorio REAL (no un mock) porque el cursor y el corte de
//     página son justamente lo que hay que comprobar; `vi.mock` sobre
//     el módulo sustituiría esa lógica.
//  2. Cableado de la vista — aserciones sobre el fuente de js/app.js:
//     el módulo toca `document`/Firebase al cargar, así que no se
//     importa en Node; se verifica que la vista usa el pageSize
//     exportado, concatena con `append` y no recarga la página.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createCatalogRepository,
  DEFAULT_PAGE_SIZE,
} from "../js/repositories/catalog-repository.js";
import { normalizeTitle } from "../js/catalog.js";

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL("../js/app.js", import.meta.url)),
  "utf8",
);

/** Devuelve el tramo de fuente entre dos maradores (para ordenar aseveraciones). */
function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

// -------------------------------------------------------------
// Store falso (parte store de API-01) — soporta filtros, orderBy,
// limit y startAfter, y registra cada query (= cada lectura).
// -------------------------------------------------------------

function docValue(doc, field) {
  return field === "__name__" ? doc.id : doc[field];
}

function cmpValues(a, b, direction) {
  let r = 0;
  if (a === b) r = 0;
  else if (a === null || a === undefined) r = 1;
  else if (b === null || b === undefined) r = -1;
  else if (a < b) r = -1;
  else if (a > b) r = 1;
  else r = 0;
  return direction === "desc" ? -r : r;
}

function cmpAfter(doc, orderBy, after) {
  for (let i = 0; i < orderBy.length; i += 1) {
    const r = cmpValues(docValue(doc, orderBy[i].field), after[i], orderBy[i].direction);
    if (r !== 0) return r;
  }
  return 0;
}

function matchesFilter(doc, filter) {
  const value = docValue(doc, filter.field);
  if (filter.op === "==") return value === filter.value;
  if (filter.op === ">=") return value !== null && value !== undefined && value >= filter.value;
  if (filter.op === "<=") return value !== null && value !== undefined && value <= filter.value;
  throw new Error(`Op no soportada en el store falso: ${filter.op}`);
}

function createFakeStore(docs) {
  const calls = [];
  return {
    calls,
    async query(spec) {
      calls.push(spec);
      let rows = docs.filter((doc) =>
        (spec.filters ?? []).every((filter) => matchesFilter(doc, filter)),
      );
      rows = rows.slice().sort((a, b) => {
        for (const order of spec.orderBy ?? []) {
          const r = cmpValues(docValue(a, order.field), docValue(b, order.field), order.direction);
          if (r !== 0) return r;
        }
        return 0;
      });
      if (Array.isArray(spec.startAfter) && spec.startAfter.length > 0) {
        rows = rows.filter((doc) => cmpAfter(doc, spec.orderBy, spec.startAfter) > 0);
      }
      if (typeof spec.limit === "number" && Number.isFinite(spec.limit)) {
        rows = rows.slice(0, spec.limit);
      }
      return { docs: rows.map((doc) => ({ ...doc })) };
    },
    async getById(mediaId) {
      return docs.find((doc) => doc.id === mediaId) ?? null;
    },
    async save(mediaId, payload) {
      return { id: mediaId, ...payload };
    },
  };
}

// -------------------------------------------------------------
// Datos: 60 juegos (>24, AC-110) + 3 películas (ruido de otro tipo)
// -------------------------------------------------------------

function item(id, mediaType, title, extra = {}) {
  return {
    id,
    mediaType,
    title,
    titleNormalized: normalizeTitle(title),
    coverUrl: null,
    releaseYear: 2015,
    genres: ["RPG"],
    avgRating: 8.1,
    creator: null,
    synopsis: null,
    metadata: {},
    seed: false,
    ...extra,
  };
}

const DATASET = [
  ...Array.from({ length: 60 }, (_, index) => {
    const n = String(index + 1).padStart(2, "0");
    return item(`game-${n}`, "GAME", `Juego ${n}`);
  }),
  item("movie-1", "MOVIE", "Película Uno"),
  item("movie-2", "MOVIE", "Película Dos"),
  item("movie-3", "MOVIE", "Película Tres"),
];

// -------------------------------------------------------------
// AC-110 — 24 tarjetas por página + LoadMore con cursor opaco
// -------------------------------------------------------------

describe("AC-110 (REQ-101, UI-02): 24 por página y LoadMore por cursor", () => {
  it("AC-110: pageSize de la vista = 24 (DEFAULT_PAGE_SIZE exportado)", async () => {
    // Constante real del repositorio: la que importa la vista.
    expect(DEFAULT_PAGE_SIZE).toBe(24);

    // La vista importa ESA misma constante y la usa en su query.
    expect(APP_SOURCE).toMatch(/DEFAULT_PAGE_SIZE as CATALOG_PAGE_SIZE/);
    const loadBody = sliceBetween(
      APP_SOURCE,
      "async function loadCatalogPage",
      "function catalogCardOptions",
    );
    expect(loadBody).toContain("pageSize: CATALOG_PAGE_SIZE,");
    // y el cursor solo se reenvía al concatener (página 1 ⇒ null).
    expect(loadBody).toContain("cursor: append ? catalogView.cursor : null,");
  });

  it("AC-110: página 1 = 24 tarjetas con cursor opaco", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    const first = await repo.listByType("GAME");
    expect(first.ok).toBe(true);
    expect(first.value.items).toHaveLength(24);
    // Una sola lectura por página (LoadMore no relee el listado).
    expect(store.calls).toHaveLength(1);

    const { cursor } = first.value;
    expect(typeof cursor).toBe("string");
    // Opaco (API-02): base64url, no JSON ni identificadores a la vista.
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => JSON.parse(cursor)).toThrow();
    expect(cursor).not.toContain("game-");
    expect(cursor).not.toContain("Juego");
  });

  it("AC-110: «Cargar más» añade el lote siguiente sin recargar (ids distintos)", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    const page1 = await repo.listByType("GAME");
    const page2 = await repo.listByType("GAME", { cursor: page1.value.cursor });
    expect(page2.ok).toBe(true);
    expect(page2.value.items).toHaveLength(24);

    const ids1 = page1.value.items.map((entry) => entry.id);
    const ids2 = page2.value.items.map((entry) => entry.id);

    // «Añade el siguiente lote»: concatenación sin solapes.
    const combined = [...ids1, ...ids2];
    expect(combined).toHaveLength(48);
    expect(new Set(combined).size).toBe(48);

    const page3 = await repo.listByType("GAME", { cursor: page2.value.cursor });
    expect(page3.ok).toBe(true);
    expect(page3.value.items).toHaveLength(12);
    // Fin del listado ⇒ cursor null (API-02) y «Cargar más» se oculta.
    expect(page3.value.cursor).toBeNull();
    const all = [...combined, ...page3.value.items.map((entry) => entry.id)];
    expect(new Set(all).size).toBe(60);
    // 3 páginas = 3 lecturas (1 por lote).
    expect(store.calls).toHaveLength(3);

    // Solo docs del tipo pedido (los 3 MOVIE no entran).
    for (const entry of [...page1.value.items, ...page2.value.items, ...page3.value.items]) {
      expect(entry.mediaType).toBe("GAME");
    }
  });

  it("AC-110: la vista concatena sin recargar la página", () => {
    // El botón «Cargar más» llama a la carga con append (sin reload).
    expect(APP_SOURCE).toContain("loadCatalogPage({ append: true })");
    expect(APP_SOURCE).not.toContain("location.reload(");
    expect(APP_SOURCE).not.toMatch(/window\.location\s*=/);

    // `appendCatalogItems` añade SOLO ids nuevos y concatena al estado.
    const appendBody = sliceBetween(
      APP_SOURCE,
      "function appendCatalogItems",
      "function updateCatalogGenreSuggestions",
    );
    expect(appendBody).toContain("const fresh = items.filter((item) => item && !known.has(item.id));");
    expect(appendBody).toContain("catalogView.items = catalogView.items.concat(fresh);");
    expect(appendBody).toContain("grid.appendChild(fragment);");
    // El grid NO se vacía al concatener (eso sería «recargar»).
    expect(appendBody).not.toContain("replaceChildren()");
  });
});
