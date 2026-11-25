// =============================================================
// Tests T-110 — GitHub issue #56 — spec 04 AC-130..AC-137.
//
//   AC-130 totales globales (REQ-301)
//   AC-131 distribución por tipo con % a 1 decimal (REQ-302)
//   AC-132 media de notas con 1 decimal (REQ-303)
//   AC-133 media null sin puntuaciones (REQ-303)
//   AC-134 actividad reciente ≤10, updatedAt desc (REQ-304)
//   AC-135 parte pura: determinista, sin red, sin coste apreciable (REQ-305)
//   AC-136 estado vacío (REQ-306)
//   AC-137 recálculo por snapshot sin re-ejecutar getStats (API-22)
//
// Todo es local: fixtures puras de `computeDashboard` (API-21) y los
// fakes + fixtures AC-137 compartidos de `tests/fakes.js` (T-121).
// Sin Firebase, sin red, sin emulador Firestore.
// =============================================================
import { describe, it, expect, vi } from "vitest";
import {
  computeDashboard,
  createDashboardService,
  DASHBOARD_PAGE_SIZE,
  EMPTY_STATE_MESSAGE,
  RECENT_LIMIT,
} from "../js/services/dashboard-service.js";
import { MEDIA_ITEM_TYPES } from "../js/catalog.js";
import {
  AC137_CATALOG_FIXTURE,
  AC137_TOTALS_AFTER,
  AC137_TOTALS_BEFORE,
  AC137_TRACKING_FIXTURE,
  FakeCatalogRepository,
  FakeTrackingRepository,
} from "./fakes.js";

// -------------------------------------------------------------
// Fixtures locales (puras, en memoria)
// -------------------------------------------------------------

let seq = 0;

/** Entry de fixture con valores por defecto (DB-103). */
function mkEntry(overrides = {}) {
  seq += 1;
  return {
    mediaId: `m-${seq}`,
    title: `Título ${seq}`,
    status: "PLANNED",
    updatedAt: `2026-01-${String((seq % 27) + 1).padStart(2, "0")}T10:00:00.000Z`,
    ...overrides,
  };
}

/** N entries con el mismo estado. */
function entriesWithStatus(status, count) {
  const entries = [];
  for (let i = 0; i < count; i += 1) entries.push(mkEntry({ status }));
  return entries;
}

/**
 * Mix de estados del AC-130: 4 COMPLETED, 3 IN_PROGRESS,
 * 2 PLANNED y 1 DROPPED (total 10). Un solo helper, sin duplicar
 * el fixture entre el cálculo puro y `getStats`.
 */
function statusMixEntries() {
  return [
    ...entriesWithStatus("COMPLETED", 4),
    ...entriesWithStatus("IN_PROGRESS", 3),
    ...entriesWithStatus("PLANNED", 2),
    ...entriesWithStatus("DROPPED", 1),
  ];
}

/**
 * Totales en el orden del contrato (spec 04 §2): una sola forma de
 * escribir el literal, usada por AC-130 y AC-136.
 */
function mkTotals(total, planned, inProgress, completed, dropped) {
  return { total, planned, inProgress, completed, dropped };
}

/** Mix del AC-130: `total: 10`. */
const MIX_TOTALS = mkTotals(10, 2, 3, 4, 1);

/** Estado vacío (AC-136): todo a 0. */
const ZERO_TOTALS = mkTotals(0, 0, 0, 0, 0);

/** Fixture `count` entries cuyo tipo vive en `catalog.mediaType` (DB-101). */
function fixtureWithType(mediaType, count) {
  const entries = [];
  const mediaById = new Map();
  for (let i = 0; i < count; i += 1) {
    const entry = mkEntry({ mediaId: `${mediaType.toLowerCase()}-${i}` });
    entries.push(entry);
    mediaById.set(entry.mediaId, {
      id: entry.mediaId,
      title: entry.title,
      mediaType,
    });
  }
  return { entries, mediaById };
}

/** Registro con las 7 claves de `MEDIA_ITEM_TYPES` (DB-101) por `factory`. */
function typeRecord(factory) {
  const record = {};
  for (const type of MEDIA_ITEM_TYPES) record[type] = factory();
  return record;
}

/** Registro esperado de tipos sin entries: `{count:0, pct:0}` (AC-131). */
function emptyTypeCounts() {
  return typeRecord(() => ({ count: 0, pct: 0 }));
}

// -------------------------------------------------------------
// AC-130 (REQ-301) — KPIs globales
// -------------------------------------------------------------

describe("AC-130 (REQ-301): KPIs globales a partir de las entries", () => {
  it("AC-130: totals = {total:10, completed:4, inProgress:3, planned:2, dropped:1}", () => {
    const stats = computeDashboard(statusMixEntries(), new Map());
    expect(stats.totals).toEqual(MIX_TOTALS);
  });

  // El «When» del AC es `getStats`: mismos totales con el repositorio
  // en memoria (sin Firestore) y una sola query paginada (REQ-301).
  it("AC-130: getStats sobre FakeTrackingRepository devuelve los mismos totales", async () => {
    const tracking = new FakeTrackingRepository(statusMixEntries());
    const catalog = new FakeCatalogRepository();
    const service = createDashboardService({
      trackingRepository: tracking,
      catalogRepository: catalog,
    });

    const result = await service.getStats("user-10");

    expect(result.ok).toBe(true);
    expect(result.value.totals).toEqual(MIX_TOTALS);
    // 1 sola query de entries agregada en cliente (REQ-301).
    expect(tracking.readLog).toEqual(["listEntries"]);
    expect(catalog.readLog).toEqual(["getAll"]);
  });

  // API-20: con >DASHBOARD_PAGE_SIZE entries el recorrido del cursor
  // cuesta UNA query de entries + UNA lectura batch por página.
  it("AC-130/API-20: >DASHBOARD_PAGE_SIZE entries ⇒ readLog [listEntries, getAll] por página", async () => {
    const pageSize = DASHBOARD_PAGE_SIZE;
    const totalEntries = pageSize + 5; // 2 páginas: 30 + 5
    const entries = [];
    for (let i = 0; i < totalEntries; i += 1) {
      entries.push(
        mkEntry({
          mediaId: `page-${i}`,
          title: `Página ${i}`,
          status: "COMPLETED",
          updatedAt: `2026-02-${String((i % 27) + 1).padStart(2, "0")}T10:00:00.000Z`,
        }),
      );
    }
    const tracking = new FakeTrackingRepository(entries);
    const catalog = new FakeCatalogRepository(
      entries.map((entry) => ({
        id: entry.mediaId,
        title: entry.title,
        mediaType: "GAME",
      })),
    );
    const service = createDashboardService({
      trackingRepository: tracking,
      catalogRepository: catalog,
    });

    const result = await service.getStats("user-paged");

    expect(result.ok).toBe(true);
    expect(result.value.totals).toEqual(mkTotals(totalEntries, 0, 0, totalEntries, 0));
    expect(result.value.byType.GAME).toEqual({ count: totalEntries, pct: 100 });

    // 2 páginas ⇒ 2 queries de entries + 2 lecturas batch (sin N+1).
    // Cada log se afirma EXACTO: un `getAll` de más rompería el
    // presupuesto de 1 lectura adicional por página (API-20).
    expect(pageSize).toBe(30);
    expect(tracking.readLog).toEqual(["listEntries", "listEntries"]);
    expect(catalog.readLog).toEqual(["getAll", "getAll"]);
  });
});

// -------------------------------------------------------------
// AC-131 (REQ-302) — Distribución por categoría
// -------------------------------------------------------------

describe("AC-131 (REQ-302): distribución por tipo con % a 1 decimal", () => {
  it("AC-131: 3 GAME = {count:3, pct:50}, 2 MOVIE = {count:2, pct:33.3} y tipos vacíos = {count:0, pct:0}", () => {
    const game = fixtureWithType("GAME", 3);
    const movie = fixtureWithType("MOVIE", 2);
    const book = fixtureWithType("BOOK", 1);
    const entries = [...game.entries, ...movie.entries, ...book.entries];
    const mediaById = new Map([
      ...game.mediaById,
      ...movie.mediaById,
      ...book.mediaById,
    ]);

    const stats = computeDashboard(entries, mediaById);

    expect(stats.byType.GAME).toEqual({ count: 3, pct: 50 });
    expect(stats.byType.MOVIE).toEqual({ count: 2, pct: 33.3 });
    expect(stats.byType.BOOK).toEqual({ count: 1, pct: 16.7 });

    // Los 7 tipos (DB-101) siempre están; los vacíos, a 0.
    expect(Object.keys(stats.byType).sort()).toEqual(
      [...MEDIA_ITEM_TYPES].sort(),
    );
    const expected = emptyTypeCounts();
    expected.GAME = { count: 3, pct: 50 };
    expected.MOVIE = { count: 2, pct: 33.3 };
    expected.BOOK = { count: 1, pct: 16.7 };
    expect(stats.byType).toEqual(expected);

    // pct siempre con 1 decimal.
    for (const { pct } of Object.values(stats.byType)) {
      expect(Math.round(pct * 10) / 10).toBe(pct);
    }
  });
});

// -------------------------------------------------------------
// AC-132 (REQ-303) — Media de notas
// -------------------------------------------------------------

describe("AC-132 (REQ-303): media de notas solo de entries puntuadas", () => {
  it("AC-132: scores 8, 9, 6 y 2 entries sin score ⇒ average = 7.7, count = 3", () => {
    // El tipo viene de `catalog.mediaType` (DB-101) vía mediaById.
    const movie = fixtureWithType("MOVIE", 5);
    const scores = [8, 9, 6, undefined, null];
    const entries = movie.entries.map((entry, index) => ({
      ...entry,
      score: scores[index],
    }));

    const stats = computeDashboard(entries, movie.mediaById);

    expect(stats.scores.average).toBe(7.7); // (8+9+6)/3, 1 decimal
    expect(stats.scores.count).toBe(3);
    expect(stats.scores.byType.MOVIE).toEqual({ average: 7.7, count: 3 });
    expect(stats.scores.byType.GAME).toEqual({ average: null, count: 0 });
    // 1 decimal exacto.
    expect(Math.round(stats.scores.average * 10) / 10).toBe(
      stats.scores.average,
    );
    // Las 5 entries agrupadas por el tipo del catálogo (REQ-302).
    expect(stats.byType.MOVIE).toEqual({ count: 5, pct: 100 });
  });
});

// -------------------------------------------------------------
// AC-133 (REQ-303) — Sin puntuaciones
// -------------------------------------------------------------

describe("AC-133 (REQ-303): ninguna entry con score", () => {
  it("AC-133: average = null y count = 0 cuando 0 entries tienen score", () => {
    // Tipo resuelto desde `catalog.mediaType` (mediaById), no del fallback.
    const game = fixtureWithType("GAME", 3);
    const scores = [undefined, undefined, null];
    const entries = game.entries.map((entry, index) => ({
      ...entry,
      score: scores[index],
    }));

    const stats = computeDashboard(entries, game.mediaById);

    expect(stats.scores.average).toBeNull();
    expect(stats.scores.count).toBe(0);
    expect(stats.scores.byType.GAME).toEqual({ average: null, count: 0 });
    for (const type of MEDIA_ITEM_TYPES) {
      expect(stats.scores.byType[type]).toEqual({ average: null, count: 0 });
    }
    expect(stats.byType.GAME).toEqual({ count: 3, pct: 100 });
  });
});

// -------------------------------------------------------------
// AC-134 (REQ-304) — Actividad reciente
// -------------------------------------------------------------

describe("AC-134 (REQ-304): actividad reciente, últimas 10 por updatedAt desc", () => {
  it("AC-134: 12 entries con distinto updatedAt ⇒ recent.length = 10, de más reciente a más antiguo", () => {
    const entries = [];
    for (let day = 1; day <= 12; day += 1) {
      const dd = String(day).padStart(2, "0");
      entries.push(
        mkEntry({
          mediaId: `day-${day}`,
          title: `Día ${day}`,
          status: "IN_PROGRESS",
          updatedAt: `2026-03-${dd}T12:00:00.000Z`,
        }),
      );
    }

    const stats = computeDashboard(entries);

    expect(RECENT_LIMIT).toBe(10);
    expect(stats.recent).toHaveLength(10);
    expect(stats.recent.map((item) => item.mediaId)).toEqual([
      "day-12",
      "day-11",
      "day-10",
      "day-9",
      "day-8",
      "day-7",
      "day-6",
      "day-5",
      "day-4",
      "day-3",
    ]);
    expect(stats.recent[0]).toEqual({
      mediaId: "day-12",
      title: "Día 12",
      status: "IN_PROGRESS",
      updatedAt: "2026-03-12T12:00:00.000Z",
    });

    // Orden estrictamente descendente (DB-114).
    const stamps = stats.recent.map((item) => Date.parse(item.updatedAt));
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]).toBeLessThan(stamps[i - 1]);
    }
  });
});

// -------------------------------------------------------------
// AC-135 (REQ-305) — Parte pura: sin red, determinista, rápido
// -------------------------------------------------------------

describe("AC-135 (REQ-305): computeDashboard es pura y determinista", () => {
  it("AC-135: misma fixture ⇒ mismo resultado, sin red/Firebase y sin coste apreciable", () => {
    const statuses = ["PLANNED", "IN_PROGRESS", "COMPLETED", "DROPPED"];
    const entries = [];
    const mediaById = new Map();
    for (let i = 1; i <= 500; i += 1) {
      const mediaType = MEDIA_ITEM_TYPES[i % MEDIA_ITEM_TYPES.length];
      const mediaId = `f-${i}`;
      entries.push(
        mkEntry({
          mediaId,
          title: `Fixture ${i}`,
          mediaType,
          status: statuses[i % statuses.length],
          score: i % 3 === 0 ? (i % 10) + 1 : undefined,
          updatedAt: new Date(Date.UTC(2026, 0, 1 + (i % 28), i % 24)).toISOString(),
        }),
      );
      mediaById.set(mediaId, { id: mediaId, title: `Fixture ${i}`, mediaType });
    }
    const untouched = structuredClone(entries);

    // Si algo de la función intentara tocar la red, el test falla.
    const fetchSpy = vi.fn(() => {
      throw new Error("computeDashboard no debe usar la red");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const RUNS = 5;
    let first;
    const durations = [];
    const results = [];
    try {
      first = computeDashboard(entries, mediaById);
      for (let run = 0; run < RUNS; run += 1) {
        const startedAt = performance.now();
        results.push(computeDashboard(entries, mediaById));
        durations.push(performance.now() - startedAt);
      }
    } finally {
      vi.unstubAllGlobals();
    }

    // Presupuesto del spec (<50 ms, AC-135): se afirma con la MEDIANA
    // de 5 corridas, robusta frente a picos aislados de GC/CI.
    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(RUNS / 2)];
    expect(Number.isFinite(median)).toBe(true);
    expect(median).toBeGreaterThanOrEqual(0);
    expect(median).toBeLessThan(50);

    expect(fetchSpy).not.toHaveBeenCalled();
    for (const result of results) expect(result).toEqual(first); // determinismo
    expect(entries).toEqual(untouched); // no muta sus entradas
    expect(first.totals.total).toBe(500);
    expect(first.recent).toHaveLength(RECENT_LIMIT);
  });
});

// -------------------------------------------------------------
// AC-136 (REQ-306) — Estado vacío
// -------------------------------------------------------------

describe("AC-136 (REQ-306): usuario sin entries ⇒ estado vacío", () => {
  it("AC-136: KPIs en 0, scores.average null, byType en 0 y mensaje «Añade tu primer título»", () => {
    const stats = computeDashboard([]);

    expect(stats.totals).toEqual(ZERO_TOTALS);
    expect(stats.recent).toEqual([]);
    expect(stats.scores.average).toBeNull();
    expect(stats.scores.count).toBe(0);

    const emptyByType = emptyTypeCounts();
    expect(stats.byType).toEqual(emptyByType);

    const emptyScoresByType = typeRecord(() => ({ average: null, count: 0 }));
    expect(stats.scores.byType).toEqual(emptyScoresByType);

    // Mensaje visible para la UI (UI-20..UI-23).
    expect(EMPTY_STATE_MESSAGE).toBe("Añade tu primer título");
  });

  it("AC-136: getStats sin entries devuelve el vacío y NO lee el catálogo", async () => {
    const tracking = new FakeTrackingRepository(); // sin entries
    const catalog = new FakeCatalogRepository(); // sin items
    const service = createDashboardService({
      trackingRepository: tracking,
      catalogRepository: catalog,
    });

    const result = await service.getStats("user-empty");

    expect(result.ok).toBe(true);
    expect(result.value.totals).toEqual(ZERO_TOTALS);
    expect(result.value.scores.average).toBeNull();
    expect(result.value.recent).toEqual([]);
    expect(catalog.reads).toBe(0); // 0 entries ⇒ 0 lecturas de catálogo
    expect(catalog.readLog).toEqual([]);
  });
});

// -------------------------------------------------------------
// AC-137 (API-22) — Recálculo por snapshot sin getStats.
// Fixtures y fakes compartidos de `tests/fakes.js` (un solo hogar
// para el escenario AC-137, sin emulador Firestore).
// -------------------------------------------------------------

describe("AC-137 (API-22): los KPIs se recalculan por snapshot sin re-ejecutar getStats", () => {
  it("AC-137: el evento del FakeTrackingRepository actualiza KPIs y distribución sin getStats ni lecturas", async () => {
    const tracking = new FakeTrackingRepository(AC137_TRACKING_FIXTURE);
    const catalog = new FakeCatalogRepository(AC137_CATALOG_FIXTURE);
    const service = createDashboardService({
      trackingRepository: tracking,
      catalogRepository: catalog,
    });

    const first = await service.getStats("user-1");
    expect(first.ok).toBe(true);
    expect(first.value.totals).toEqual(AC137_TOTALS_BEFORE);
    expect(first.value.byType.SERIES).toEqual({ count: 1, pct: 25 });

    expect(tracking.readLog).toEqual(["listEntries"]);
    expect(catalog.readLog).toEqual(["getAll"]);

    const readsAfterGetStats = {
      tracking: tracking.reads,
      catalog: catalog.reads,
    };
    expect(readsAfterGetStats.tracking).toBe(1);
    expect(readsAfterGetStats.catalog).toBe(1);

    // Suscripción reactiva (API-22) + evento de snapshot simulado.
    const received = [];
    const unsubscribe = service.subscribe("user-1", (stats) =>
      received.push(stats),
    );

    await tracking.setStatus("user-1", "m-1", "COMPLETED"); // PLANNED -> COMPLETED
    tracking.emitSnapshot();

    expect(received).toHaveLength(1);
    // KPIs y distribución se actualizan con el cálculo puro.
    expect(received[0].totals).toEqual(AC137_TOTALS_AFTER);
    expect(received[0].byType.SERIES).toEqual({ count: 1, pct: 25 });
    expect(received[0].byType.BOOK).toEqual({ count: 1, pct: 25 });

    // Sin re-ejecutar getStats: 0 lecturas nuevas.
    expect(tracking.reads).toBe(readsAfterGetStats.tracking);
    expect(catalog.reads).toBe(readsAfterGetStats.catalog);

    unsubscribe();
  });

  it("AC-137: applySnapshot y recalculate actualizan KPIs sin re-ejecutar getStats", async () => {
    const tracking = new FakeTrackingRepository(AC137_TRACKING_FIXTURE);
    const catalog = new FakeCatalogRepository(AC137_CATALOG_FIXTURE);
    const service = createDashboardService({
      trackingRepository: tracking,
      catalogRepository: catalog,
    });

    const first = await service.getStats("user-1");
    expect(first.ok).toBe(true);
    expect(first.value.totals).toEqual(AC137_TOTALS_BEFORE);

    const readsAfterGetStats = {
      tracking: tracking.reads,
      catalog: catalog.reads,
    };

    // Espía sobre la superficie pública: nada debe volver a llamarla.
    const getStatsSpy = vi.spyOn(service, "getStats");

    // Snapshot: m-1 pasa de PLANNED a COMPLETED.
    const snapshot = tracking.entries.map((entry) =>
      entry.mediaId === "m-1" ? { ...entry, status: "COMPLETED" } : entry,
    );
    const applied = service.applySnapshot("user-1", snapshot);
    expect(applied.ok).toBe(true);
    expect(applied.value.totals).toEqual(AC137_TOTALS_AFTER);
    expect(applied.value.byType.GAME).toEqual({ count: 1, pct: 25 });

    // Recálculo con el estado cacheado (mismo snapshot, sin I/O).
    const recalculated = service.recalculate("user-1");
    expect(recalculated.ok).toBe(true);
    expect(recalculated.value.totals).toEqual(AC137_TOTALS_AFTER);
    expect(recalculated.value.byType).toEqual(applied.value.byType);

    // Sin re-ejecutar getStats ni hacer lecturas.
    expect(getStatsSpy).not.toHaveBeenCalled();
    expect(tracking.reads).toBe(readsAfterGetStats.tracking);
    expect(catalog.reads).toBe(readsAfterGetStats.catalog);

    getStatsSpy.mockRestore();
  });
});
