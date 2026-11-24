// Tests T-105 — AC-111, AC-112 y AC-113 sobre
// js/repositories/catalog-repository.js (spec 02 API-01..API-05,
// REQ-101..REQ-103; spec 01 DB-110..DB-113; spec 00 REQ-E1/REQ-E2).
//
// Se usa la PARTE PURA del repositorio con un store falso inyectado
// (`createCatalogRepository(fakeStore)`): sin red, sin Firebase.
// El store falso simula el comportamiento de Firestore (filtros,
// orderBy, limit, startAfter) y registra cada query, de modo que se
// puede comprobar que una página = UNA lectura (AC-111).
import { describe, it, expect } from "vitest";
import {
  createCatalogRepository,
  resolveListByTypeQuery,
  resolveSearchByTitleQuery,
  resolvePageSize,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  CATALOG_COLLECTION,
  PREFIX_UPPER_BOUND,
} from "../js/repositories/catalog-repository.js";
import { normalizeTitle } from "../js/catalog.js";

// -------------------------------------------------------------
// Store falso (parte store de API-01, sustituible en tests)
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

function createFakeStore(docs, { failWith } = {}) {
  const calls = [];
  return {
    calls,
    async query(spec) {
      if (failWith) {
        const error = new Error(failWith.message ?? "Fallo del store");
        if (failWith.code) error.code = failWith.code;
        throw error;
      }
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
// Datos de prueba
// -------------------------------------------------------------

function movie(id, title, extra = {}) {
  return {
    id,
    mediaType: "MOVIE",
    title,
    titleNormalized: normalizeTitle(title),
    coverUrl: null,
    releaseYear: 2020,
    genres: ["Drama"],
    avgRating: 7.5,
    creator: null,
    synopsis: null,
    metadata: { kind: "duration" },
    seed: false,
    ...extra,
  };
}

function game(id, title, extra = {}) {
  return { ...movie(id, title, extra), mediaType: "GAME", metadata: { kind: "platforms" } };
}

// 30 películas para paginar (AC-110/AC-111) + el ítem de AC-112.
const PAGINATION_MOVIES = Array.from({ length: 30 }, (_, index) => {
  const n = String(index + 1).padStart(2, "0");
  return movie(`movie-${n}`, `Película ${n}`, { releaseYear: 2000 + index });
});

const SIGN_ITEM = movie("movie-el-ultimo-signo", "El Último Signo", {
  titleNormalized: "el ultimo signo",
  releaseYear: 2024,
});

const DATASET = [
  ...PAGINATION_MOVIES,
  SIGN_ITEM,
  game("game-hades", "Hades"),
  game("game-zelda", "Zelda: Breath of the Wild"),
];

// -------------------------------------------------------------
// AC-111 — 1 lectura por página, pageSize 24 (max 48), cursor opaco
// -------------------------------------------------------------

describe("AC-111 (REQ-101, API-01/API-02): listByType", () => {
  it("AC-111: pageSize por defecto 24 (limit 25) y máximo 48", () => {
    expect(resolvePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(DEFAULT_PAGE_SIZE).toBe(24);
    expect(MAX_PAGE_SIZE).toBe(48);

    const base = resolveListByTypeQuery("MOVIE");
    expect(base.pageSize).toBe(24);
    expect(base.spec.limit).toBe(25);

    expect(resolveListByTypeQuery("MOVIE", { pageSize: 48 }).spec.limit).toBe(49);
    // Por encima del máximo se recorta a 48.
    expect(resolveListByTypeQuery("MOVIE", { pageSize: 500 }).pageSize).toBe(48);
    expect(resolveListByTypeQuery("MOVIE", { pageSize: 500 }).spec.limit).toBe(49);
    // Opciones inválidas ⇒ Result `validation` (REQ-E1/E2).
    expect(() => resolvePageSize(0)).toThrow();
    expect(() => resolvePageSize(2.5)).toThrow();
  });

  it("AC-111: filtra por mediaType y hace UNA sola lectura por página", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    const first = await repo.listByType("MOVIE");
    expect(first.ok).toBe(true);
    // Una lectura por página.
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0].collection).toBe(CATALOG_COLLECTION);
    expect(store.calls[0].filters).toContainEqual({
      field: "mediaType",
      op: "==",
      value: "MOVIE",
    });

    // Solo docs del tipo filtrado y solo 24 por página.
    expect(first.value.items).toHaveLength(24);
    for (const item of first.value.items) {
      expect(item.mediaType).toBe("MOVIE");
    }

    const second = await repo.listByType("MOVIE", { cursor: first.value.cursor });
    expect(second.ok).toBe(true);
    expect(store.calls).toHaveLength(2); // 2 lecturas = 2 páginas
    expect(second.value.items).toHaveLength(7); // 31 MOVIE - 24
    for (const item of second.value.items) {
      expect(item.mediaType).toBe("MOVIE");
    }
    // Sin página siguiente ⇒ cursor null (API-02).
    expect(second.value.cursor).toBeNull();

    // Sin solapes entre páginas.
    const firstIds = first.value.items.map((item) => item.id);
    const secondIds = second.value.items.map((item) => item.id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(firstIds.length + secondIds.length).toBe(31);
  });

  it("AC-111: el cursor es opaco (base64url) y sigue el listado", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    const page = await repo.listByType("MOVIE");
    const { cursor } = page.value;
    expect(typeof cursor).toBe("string");
    // Opaco: solo caracteres base64url; no es JSON ni un snapshot a la vista.
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => JSON.parse(cursor)).toThrow();

    // Es una posición de orden reutilizable en la siguiente página.
    const keys = decodeCursor(cursor);
    expect(Array.isArray(keys)).toBe(true);
    expect(keys).toHaveLength(2); // titleNormalized + __name__

    // Cursor corrupto o manipulado ⇒ Result `validation`, nunca throw.
    const bad = await repo.listByType("MOVIE", { cursor: "¡¡no-opaco!!" });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("validation");
  });
});

// -------------------------------------------------------------
// AC-112 — prefijo tras normalizeTitle (acento/mayúsculas irrelevantes)
// -------------------------------------------------------------

describe("AC-112 (REQ-102, DB-113/DB-121): searchByTitle por prefijo", () => {
  it("AC-112: 'el últ' y 'EL ÚLT' encuentran 'El Último Signo'", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    const accented = await repo.searchByTitle("el últ");
    expect(accented.ok).toBe(true);
    expect(accented.value.items.map((item) => item.id)).toContain("movie-el-ultimo-signo");

    const upper = await repo.searchByTitle("EL ÚLT");
    expect(upper.ok).toBe(true);
    expect(upper.value.items.map((item) => item.id)).toContain("movie-el-ultimo-signo");

    // La query usa el prefijo normalizado sobre `titleNormalized` (DB-113).
    const spec = store.calls[store.calls.length - 1];
    expect(spec.filters).toContainEqual({
      field: "titleNormalized",
      op: ">=",
      value: normalizeTitle("el últ"),
    });
    expect(spec.filters).toContainEqual({
      field: "titleNormalized",
      op: "<=",
      value: normalizeTitle("el últ") + PREFIX_UPPER_BOUND,
    });
    expect(resolveSearchByTitleQuery("EL ÚLT").term).toBe("el ult");
  });

  it("AC-112: 'ultimo sig' no es prefijo ⇒ 0 resultados (fuera de alcance)", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    const result = await repo.searchByTitle("ultimo sig");
    expect(result.ok).toBe(true);
    expect(result.value.items).toEqual([]);
    expect(result.value.cursor).toBeNull();
    expect(store.calls).toHaveLength(1); // sigue siendo una sola lectura
  });
});

// -------------------------------------------------------------
// AC-113 — sin coincidencias ⇒ ok:true + items:[] (estado vacío)
// -------------------------------------------------------------

describe("AC-113 (REQ-102, API-04): estado vacío sin error", () => {
  it("AC-113: búsqueda sin coincidencias devuelve ok:true con items:[]", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    const result = await repo.searchByTitle("zzz-no-existe-ninguno");
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ items: [], cursor: null });
    expect(result.code).toBeUndefined();
  });

  it("AC-113: término vacío/insignificante también es estado vacío", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    for (const term of ["", "   ", "¿?!"]) {
      const result = await repo.searchByTitle(term);
      expect(result.ok, String(term)).toBe(true);
      expect(result.value).toEqual({ items: [], cursor: null });
    }
    // El término no string sí es `validation` (REQ-E1), nunca throw.
    const invalid = await repo.searchByTitle(null);
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe("validation");
  });

  it("AC-113: los errores se traducen a Result (REQ-E1/E2, API-05)", async () => {
    const denied = createFakeStore(DATASET, {
      failWith: { code: "permission-denied", message: "denied" },
    });
    const deniedResult = await createCatalogRepository(denied).listByType("MOVIE");
    expect(deniedResult.ok).toBe(false);
    expect(deniedResult.code).toBe("permission_denied");
    // El mensaje mantiene visible el allowlist de login (API-05).
    expect(deniedResult.message).toMatch(/lista de personas autorizadas/);

    const broken = createFakeStore(DATASET, { failWith: { message: "boom" } });
    const brokenResult = await createCatalogRepository(broken).searchByTitle("el últ");
    expect(brokenResult.ok).toBe(false);
    expect(brokenResult.code).toBe("unknown");

    // Entrada inválida ⇒ Result `validation`, sin lanzar.
    const repo = createCatalogRepository(createFakeStore(DATASET));
    const badType = await repo.listByType("NO_ES_UN_TIPO");
    expect(badType.ok).toBe(false);
    expect(badType.code).toBe("validation");
  });
});
