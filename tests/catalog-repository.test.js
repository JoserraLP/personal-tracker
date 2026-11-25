// Tests T-122 (issue #68) — AC-110, AC-111, AC-112, AC-113 y AC-118
// sobre js/repositories/catalog-repository.js (spec 02 API-01..API-05,
// REQ-101..REQ-105; spec 01 DB-110..DB-113; REQ-C4: nombre de archivo
// <área>-<tema>.test.js y cada it() cita el ID que cubre).
//
// Se usa la PARTE PURA del repositorio con un store falso inyectado
// (`createCatalogRepository(fakeStore)`): sin red, sin Firebase.
// El store falso simula Firestore (filtros, orderBy, limit, startAfter)
// y registra cada query para poder comprobar que una página = UNA
// lectura (AC-111) y que LoadMore no recarga la primera página (AC-110).
import { describe, it, expect } from "vitest";
import {
  createCatalogRepository,
  resolveSearchByTitleQuery,
  PREFIX_UPPER_BOUND,
  CATALOG_COLLECTION,
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

function createFakeStore(docs) {
  const rows = docs.map((doc) => ({ ...doc }));
  const calls = [];
  return {
    calls,
    rows,
    async query(spec) {
      calls.push(spec);
      let found = rows.filter((doc) =>
        (spec.filters ?? []).every((filter) => matchesFilter(doc, filter)),
      );
      found = found.slice().sort((a, b) => {
        for (const order of spec.orderBy ?? []) {
          const r = cmpValues(docValue(a, order.field), docValue(b, order.field), order.direction);
          if (r !== 0) return r;
        }
        return 0;
      });
      if (Array.isArray(spec.startAfter) && spec.startAfter.length > 0) {
        found = found.filter((doc) => cmpAfter(doc, spec.orderBy, spec.startAfter) > 0);
      }
      if (typeof spec.limit === "number" && Number.isFinite(spec.limit)) {
        found = found.slice(0, spec.limit);
      }
      return { docs: found.map((doc) => ({ ...doc })) };
    },
    async getById(mediaId) {
      return rows.find((doc) => doc.id === mediaId) ?? null;
    },
    async save(mediaId, payload) {
      const saved = { id: mediaId, ...payload };
      rows.push(saved);
      return { ...saved };
    },
  };
}

// -------------------------------------------------------------
// Datos de prueba
// -------------------------------------------------------------

function game(id, title, extra = {}) {
  return {
    id,
    mediaType: "GAME",
    title,
    titleNormalized: normalizeTitle(title),
    coverUrl: null,
    releaseYear: 2020,
    genres: ["Rol"],
    avgRating: 8,
    creator: null,
    synopsis: null,
    metadata: { kind: "platforms", platforms: ["PC"] },
    seed: false,
    ...extra,
  };
}

function movie(id, title, extra = {}) {
  return { ...game(id, title, extra), mediaType: "MOVIE", metadata: { kind: "duration", durationMinutes: 100 } };
}

// >24 ítems GAME para la pestaña Juegos (AC-110).
const GAMES = Array.from({ length: 30 }, (_, index) => {
  const n = String(index + 1).padStart(2, "0");
  return game(`game-${n}`, `Juego ${n}`);
});

// Ítem de AC-112: titleNormalized fijo "el ultimo signo" (DB-101).
const SIGN_ITEM = movie("movie-el-ultimo-signo", "El Último Signo", {
  titleNormalized: "el ultimo signo",
  releaseYear: 2024,
});

const OTHER_MOVIES = [
  movie("movie-01", "Película 01"),
  movie("movie-02", "Película 02"),
];

const DATASET = [...GAMES, SIGN_ITEM, ...OTHER_MOVIES];

// -------------------------------------------------------------
// AC-110 — pestaña Juegos con >24 ítems: 24 tarjetas + LoadMore
// -------------------------------------------------------------

describe("AC-110 (REQ-101, API-01): listado GAME >24 ítems", () => {
  it("AC-110: la primera página muestra 24 tarjetas y LoadMore añade el siguiente lote", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    const first = await repo.listByType("GAME");
    expect(first.ok).toBe(true);
    expect(first.value.items).toHaveLength(24);
    for (const item of first.value.items) {
      expect(item.mediaType).toBe("GAME");
    }
    expect(first.value.cursor).toBeTruthy();

    // LoadMore: siguiente lote con el cursor, sin recargar la primera
    // página (sin solapes y sin re-leer el lote ya mostrado).
    const second = await repo.listByType("GAME", { cursor: first.value.cursor });
    expect(second.ok).toBe(true);
    expect(second.value.items).toHaveLength(6); // 30 - 24
    expect(second.value.cursor).toBeNull(); // sin más lotes

    const firstIds = first.value.items.map((item) => item.id);
    const secondIds = second.value.items.map((item) => item.id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(firstIds.length + secondIds.length).toBe(30);

    // 2 páginas = 2 lecturas (una por lote, sin recarga).
    expect(store.calls).toHaveLength(2);
    expect(store.calls[0].collection).toBe(CATALOG_COLLECTION);
  });
});

// -------------------------------------------------------------
// AC-111 — filtro mediaType=MOVIE: solo docs MOVIE, 1 lectura/página
// -------------------------------------------------------------

describe("AC-111 (REQ-101, API-01): filtro mediaType=MOVIE", () => {
  it("AC-111: solo se leen docs mediaType MOVIE en UNA lectura por página", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    const page = await repo.listByType("MOVIE");
    expect(page.ok).toBe(true);
    // Una lectura por página.
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0].collection).toBe(CATALOG_COLLECTION);
    expect(store.calls[0].filters).toContainEqual({
      field: "mediaType",
      op: "==",
      value: "MOVIE",
    });

    // Solo docs del tipo filtrado (los GAME del dataset quedan fuera).
    expect(page.value.items.length).toBeGreaterThan(0);
    for (const item of page.value.items) {
      expect(item.mediaType).toBe("MOVIE");
    }
    expect(page.value.items.map((item) => item.id)).not.toContain("game-01");
  });
});

// -------------------------------------------------------------
// AC-112 — prefijo tras normalizeTitle (acento/mayúsculas irrelevantes)
// -------------------------------------------------------------

describe("AC-112 (REQ-102, DB-113/DB-121): búsqueda por prefijo", () => {
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

  it("AC-112: 'ultimo sig' no es prefijo ⇒ sin resultados (fuera de alcance REQ-102)", async () => {
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
// AC-113 — sin coincidencias ⇒ items: [] y estado vacío, sin error
// -------------------------------------------------------------

describe("AC-113 (REQ-102, API-04): estado vacío sin error", () => {
  it("AC-113: búsqueda sin coincidencias devuelve ok:true con items: []", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    const result = await repo.searchByTitle("zzz-no-existe-ninguno");
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ items: [], cursor: null });
    expect(result.code).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it("AC-113: término vacío/insignificante también es estado vacío, nunca un error", async () => {
    const store = createFakeStore(DATASET);
    const repo = createCatalogRepository(store);

    for (const term of ["", "   ", "¿?!"]) {
      const result = await repo.searchByTitle(term);
      expect(result.ok, String(term)).toBe(true);
      expect(result.value).toEqual({ items: [], cursor: null });
    }
    // El término no string sí es `validation` (REQ-E1), sin lanzar.
    const invalid = await repo.searchByTitle(null);
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe("validation");
  });
});

// -------------------------------------------------------------
// AC-118 — alta manual con título válido: createMediaItem guarda y
// aparece en listado con seed: false
// -------------------------------------------------------------

describe("AC-118 (REQ-105, DB-101): alta manual createMediaItem", () => {
  const MANUAL_INPUT = {
    mediaType: "MOVIE",
    title: "Título No Disponible En Las APIs",
    metadata: { kind: "duration", durationMinutes: 95 },
  };

  it("AC-118: createMediaItem guarda el ítem y aparece en listado con seed: false", async () => {
    const store = createFakeStore([...DATASET]);
    const repo = createCatalogRepository(store);

    const created = await repo.createMediaItem({ ...MANUAL_INPUT });
    expect(created.ok, created.message).toBe(true);
    expect(created.value.id).toBeTruthy();
    expect(created.value.title).toBe(MANUAL_INPUT.title);
    expect(created.value.titleNormalized).toBe(normalizeTitle(MANUAL_INPUT.title));
    expect(created.value.seed).toBe(false);

    // Aparece en el listado del tipo (una lectura más).
    const page = await repo.listByType("MOVIE");
    expect(page.ok).toBe(true);
    const listed = page.value.items.find((item) => item.id === created.value.id);
    expect(listed).toBeDefined();
    expect(listed.seed).toBe(false);
    expect(listed.mediaType).toBe("MOVIE");
  });

  it("AC-118: el alta manual nunca queda marcada como seed (seed: false) aunque el input lo pida", async () => {
    const store = createFakeStore([...DATASET]);
    const repo = createCatalogRepository(store);

    const created = await repo.createMediaItem({ ...MANUAL_INPUT, seed: true });
    expect(created.ok, created.message).toBe(true);
    expect(created.value.seed).toBe(false);

    // El segundo alta con el mismo título determinista no duplica.
    const again = await repo.createMediaItem({ ...MANUAL_INPUT });
    expect(again.ok).toBe(false);
    expect(again.code).toBe("validation");
  });
});
