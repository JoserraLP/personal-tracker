// =============================================================
// Tests T-110 — GitHub issue #56 — spec 04 AC-130..AC-137.
//
//   AC-130 totales globales (REQ-301)
//   AC-131 distribución por tipo con % a 1 decimal (REQ-302)
//   AC-132 media de notas con 1 decimal (REQ-303)
//   AC-133 media null sin puntuaciones (REQ-303)
//   AC-134 actividad reciente ≤10, updatedAt desc (REQ-304)
//   AC-135 parte pura: determinista, sin red, <50 ms (REQ-305)
//   AC-136 estado vacío (REQ-306)
//   AC-137 recálculo por snapshot sin re-ejecutar getStats (API-22)
//
// Todo es local: fixtures puras de `computeDashboard` (API-21) y fakes
// en memoria definidos en este mismo archivo (T-121 aún no aporta fakes
// compartidos). Sin Firebase, sin red, sin emulador Firestore.
// =============================================================
import { describe, it, expect, vi } from "vitest";
import {
  computeDashboard,
  createDashboardService,
  EMPTY_STATE_MESSAGE,
  RECENT_LIMIT,
} from "../js/services/dashboard-service.js";
import { MEDIA_ITEM_TYPES } from "../js/catalog.js";

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

/** Registro esperado de tipos sin entries: `{count:0, pct:0}` (AC-131). */
function emptyTypeCounts(except = []) {
  const record = {};
  for (const type of MEDIA_ITEM_TYPES) {
    record[type] = except.includes(type) ? null : { count: 0, pct: 0 };
  }
  return record;
}

// -------------------------------------------------------------
// AC-130 (REQ-301) — KPIs globales
// -------------------------------------------------------------

describe("AC-130 (REQ-301): KPIs globales a partir de las entries", () => {
  it("AC-130: totals = {total:10, completed:4, inProgress:3, planned:2, dropped:1}", () => {
    const entries = [
      ...entriesWithStatus("COMPLETED", 4),
      ...entriesWithStatus("IN_PROGRESS", 3),
      ...entriesWithStatus("PLANNED", 2),
      ...entriesWithStatus("DROPPED", 1),
    ];
    const stats = computeDashboard(entries, new Map());
    expect(stats.totals).toEqual({
      total: 10,
      planned: 2,
      inProgress: 3,
      completed: 4,
      dropped: 1,
    });
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
    const entries = [
      mkEntry({ mediaType: "MOVIE", score: 8 }),
      mkEntry({ mediaType: "MOVIE", score: 9 }),
      mkEntry({ mediaType: "MOVIE", score: 6 }),
      mkEntry({ mediaType: "MOVIE" }), // sin score: no cuenta
      mkEntry({ mediaType: "MOVIE", score: null }), // sin score: no cuenta
    ];

    const stats = computeDashboard(entries);

    expect(stats.scores.average).toBe(7.7); // (8+9+6)/3, 1 decimal
    expect(stats.scores.count).toBe(3);
    expect(stats.scores.byType.MOVIE).toEqual({ average: 7.7, count: 3 });
    expect(stats.scores.byType.GAME).toEqual({ average: null, count: 0 });
    // 1 decimal exacto.
    expect(Math.round(stats.scores.average * 10) / 10).toBe(
      stats.scores.average,
    );
  });
});

// -------------------------------------------------------------
// AC-133 (REQ-303) — Sin puntuaciones
// -------------------------------------------------------------

describe("AC-133 (REQ-303): ninguna entry con score", () => {
  it("AC-133: average = null y count = 0 cuando 0 entries tienen score", () => {
    const entries = [
      mkEntry({ mediaType: "GAME" }),
      mkEntry({ mediaType: "GAME", score: undefined }),
      mkEntry({ mediaType: "GAME", score: null }),
    ];

    const stats = computeDashboard(entries);

    expect(stats.scores.average).toBeNull();
    expect(stats.scores.count).toBe(0);
    expect(stats.scores.byType.GAME).toEqual({ average: null, count: 0 });
    for (const type of MEDIA_ITEM_TYPES) {
      expect(stats.scores.byType[type]).toEqual({ average: null, count: 0 });
    }
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
// AC-135 (REQ-305) — Parte pura: sin red, determinista, <50 ms
// -------------------------------------------------------------

describe("AC-135 (REQ-305): computeDashboard es pura y determinista", () => {
  it("AC-135: misma fixture ⇒ mismo resultado, sin red/Firebase y <50 ms", () => {
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

    let first;
    let second;
    let elapsed;
    try {
      const startedAt = performance.now();
      first = computeDashboard(entries, mediaById);
      elapsed = performance.now() - startedAt;
      second = computeDashboard(entries, mediaById);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(elapsed).toBeLessThan(50);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(second).toEqual(first); // determinismo
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

    expect(stats.totals).toEqual({
      total: 0,
      planned: 0,
      inProgress: 0,
      completed: 0,
      dropped: 0,
    });
    expect(stats.recent).toEqual([]);
    expect(stats.scores.average).toBeNull();
    expect(stats.scores.count).toBe(0);

    const emptyByType = emptyTypeCounts();
    expect(stats.byType).toEqual(emptyByType);

    const emptyScoresByType = {};
    for (const type of MEDIA_ITEM_TYPES) {
      emptyScoresByType[type] = { average: null, count: 0 };
    }
    expect(stats.scores.byType).toEqual(emptyScoresByType);

    // Mensaje visible para la UI (UI-20..UI-23).
    expect(EMPTY_STATE_MESSAGE).toBe("Añade tu primer título");
  });

  it("AC-136: getStats sin entries devuelve el vacío y NO lee el catálogo", async () => {
    let catalogReads = 0;
    const tracking = {
      async listEntries() {
        return { ok: true, value: { items: [] } };
      },
    };
    const catalog = {
      async getAll() {
        catalogReads += 1;
        return [];
      },
    };
    const service = createDashboardService({
      trackingRepository: tracking,
      catalogRepository: catalog,
    });

    const result = await service.getStats("user-empty");

    expect(result.ok).toBe(true);
    expect(result.value.totals).toEqual({
      total: 0,
      planned: 0,
      inProgress: 0,
      completed: 0,
      dropped: 0,
    });
    expect(result.value.scores.average).toBeNull();
    expect(result.value.recent).toEqual([]);
    expect(catalogReads).toBe(0); // 0 entries ⇒ 0 lecturas de catálogo
  });
});

// -------------------------------------------------------------
// Fakes en memoria para AC-137 (sin emulador Firestore)
// -------------------------------------------------------------

/** Entries de partida: m-1 y m-4 en PLANNED. */
const TRACKING_FIXTURE = [
  {
    mediaId: "m-1",
    title: "Alpha",
    status: "PLANNED",
    updatedAt: "2026-04-01T10:00:00.000Z",
  },
  {
    mediaId: "m-2",
    title: "Beta",
    status: "IN_PROGRESS",
    updatedAt: "2026-04-02T10:00:00.000Z",
  },
  {
    mediaId: "m-3",
    title: "Gamma",
    status: "COMPLETED",
    updatedAt: "2026-04-03T10:00:00.000Z",
  },
  {
    mediaId: "m-4",
    title: "Delta",
    status: "PLANNED",
    updatedAt: "2026-04-04T10:00:00.000Z",
  },
];

const CATALOG_FIXTURE = [
  { id: "m-1", title: "Alpha", mediaType: "SERIES" },
  { id: "m-2", title: "Beta", mediaType: "GAME" },
  { id: "m-3", title: "Gamma", mediaType: "MOVIE" },
  { id: "m-4", title: "Delta", mediaType: "BOOK" },
];

const TOTALS_BEFORE = {
  total: 4,
  planned: 2,
  inProgress: 1,
  completed: 1,
  dropped: 0,
};

/** m-1 cambia de PLANNED a COMPLETED (AC-137). */
const TOTALS_AFTER = {
  total: 4,
  planned: 1,
  inProgress: 1,
  completed: 2,
  dropped: 0,
};

/**
 * FakeTrackingRepository en memoria (spec 04 AC-137): 1 query de
 * `listEntries` + evento de snapshot simulado vía `subscribeEntries`,
 * sin emulador Firestore. Expone contadores de lecturas.
 */
function createFakeTrackingRepository(initialEntries) {
  let entries = initialEntries.map((entry) => ({ ...entry }));
  const listeners = new Set();
  let listEntriesCalls = 0;

  return {
    get entries() {
      return entries.map((entry) => ({ ...entry }));
    },
    get listEntriesCalls() {
      return listEntriesCalls;
    },
    async listEntries() {
      listEntriesCalls += 1;
      return { ok: true, value: { items: entries.map((e) => ({ ...e })) } };
    },
    subscribeEntries(uid, onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    setStatus(mediaId, status) {
      entries = entries.map((entry) =>
        entry.mediaId === mediaId ? { ...entry, status } : entry,
      );
    },
    emitSnapshot() {
      const payload = entries.map((entry) => ({ ...entry }));
      for (const listener of [...listeners]) listener(payload);
    },
  };
}

/** Fake catálogo en memoria con contador de lecturas batch (API-20). */
function createFakeCatalogRepository(mediaItems) {
  let batchReads = 0;
  return {
    get batchReads() {
      return batchReads;
    },
    async getAll(...ids) {
      batchReads += 1;
      const wanted = new Set(
        ids.length === 1 && Array.isArray(ids[0]) ? ids[0] : ids,
      );
      return mediaItems.filter((item) => wanted.has(item.id));
    },
  };
}

// -------------------------------------------------------------
// AC-137 (API-22) — Recálculo por snapshot sin getStats
// -------------------------------------------------------------

describe("AC-137 (API-22): los KPIs se recalculan por snapshot sin re-ejecutar getStats", () => {
  it("AC-137: el evento del FakeTrackingRepository actualiza KPIs y distribución sin getStats ni lecturas", async () => {
    const tracking = createFakeTrackingRepository(TRACKING_FIXTURE);
    const catalog = createFakeCatalogRepository(CATALOG_FIXTURE);
    const service = createDashboardService({
      trackingRepository: tracking,
      catalogRepository: catalog,
    });

    const first = await service.getStats("user-1");
    expect(first.ok).toBe(true);
    expect(first.value.totals).toEqual(TOTALS_BEFORE);
    expect(first.value.byType.SERIES).toEqual({ count: 1, pct: 25 });

    const listCallsAfterGetStats = tracking.listEntriesCalls;
    const catalogReadsAfterGetStats = catalog.batchReads;
    expect(listCallsAfterGetStats).toBe(1);
    expect(catalogReadsAfterGetStats).toBe(1);

    // Suscripción reactiva (API-22) + evento de snapshot simulado.
    const received = [];
    const unsubscribe = service.subscribe("user-1", (stats) =>
      received.push(stats),
    );

    tracking.setStatus("m-1", "COMPLETED"); // PLANNED -> COMPLETED
    tracking.emitSnapshot();

    expect(received).toHaveLength(1);
    // KPIs y distribución se actualizan con el cálculo puro.
    expect(received[0].totals).toEqual(TOTALS_AFTER);
    expect(received[0].byType.SERIES).toEqual({ count: 1, pct: 25 });
    expect(received[0].byType.BOOK).toEqual({ count: 1, pct: 25 });

    // Sin re-ejecutar getStats: 0 lecturas nuevas.
    expect(tracking.listEntriesCalls).toBe(listCallsAfterGetStats);
    expect(catalog.batchReads).toBe(catalogReadsAfterGetStats);

    unsubscribe();
  });

  it("AC-137: applySnapshot y recalculate actualizan KPIs sin re-ejecutar getStats", async () => {
    const tracking = createFakeTrackingRepository(TRACKING_FIXTURE);
    const catalog = createFakeCatalogRepository(CATALOG_FIXTURE);
    const service = createDashboardService({
      trackingRepository: tracking,
      catalogRepository: catalog,
    });

    const first = await service.getStats("user-1");
    expect(first.ok).toBe(true);
    expect(first.value.totals).toEqual(TOTALS_BEFORE);

    const listCallsAfterGetStats = tracking.listEntriesCalls;
    const catalogReadsAfterGetStats = catalog.batchReads;

    // Espía sobre la superficie pública: nada debe volver a llamarla.
    const getStatsSpy = vi.spyOn(service, "getStats");

    // Snapshot: m-1 pasa de PLANNED a COMPLETED.
    const snapshot = tracking.entries.map((entry) =>
      entry.mediaId === "m-1" ? { ...entry, status: "COMPLETED" } : entry,
    );
    const applied = service.applySnapshot("user-1", snapshot);
    expect(applied.ok).toBe(true);
    expect(applied.value.totals).toEqual(TOTALS_AFTER);
    expect(applied.value.byType.GAME).toEqual({ count: 1, pct: 25 });

    // Recálculo con el estado cacheado (mismo snapshot, sin I/O).
    const recalculated = service.recalculate("user-1");
    expect(recalculated.ok).toBe(true);
    expect(recalculated.value.totals).toEqual(TOTALS_AFTER);
    expect(recalculated.value.byType).toEqual(applied.value.byType);

    // Sin re-ejecutar getStats ni hacer lecturas.
    expect(getStatsSpy).not.toHaveBeenCalled();
    expect(tracking.listEntriesCalls).toBe(listCallsAfterGetStats);
    expect(catalog.batchReads).toBe(catalogReadsAfterGetStats);

    getStatsSpy.mockRestore();
  });
});
