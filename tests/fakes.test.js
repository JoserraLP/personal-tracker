// Tests T-121 — GitHub issue #67 — tests/fakes.js
// (spec 03 API-14; spec 05 AC-153; spec 04 AC-137).
//
// Los tres fakes son 100% memoria: sin red, sin Firebase y con
// contador de lecturas. Aquí se verifica el contrato de API-14, el
// presupuesto `reads ≤ 2` de AC-153 y el recálculo por snapshot sin
// nuevas lecturas de AC-137.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  FakeCatalogRepository,
  FakeCollectionRepository,
  FakeTrackingRepository,
} from "./fakes.js";
import { createDashboardService } from "../js/services/dashboard-service.js";
import { createRecommendationService } from "../js/services/recommendation-service.js";

// -------------------------------------------------------------
// API-14 (spec 03): fakes en memoria, sin red ni Firebase
// -------------------------------------------------------------

describe("API-14: FakeTrackingRepository/FakeCollectionRepository en memoria sin red", () => {
  it("API-14: el módulo no importa Firebase ni usa fetch", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./fakes.js", import.meta.url)),
      "utf8",
    );
    // Ni import estático ni dinámico de `firebase.js`.
    expect(source).not.toMatch(/from\s+["'][^"']*firebase/);
    expect(source).not.toMatch(/import\s*\([^)]*firebase/);
    // Ni llamadas de red.
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
  });

  it("API-14: FakeTrackingRepository cubre el contrato de entries con Result", async () => {
    const tracking = new FakeTrackingRepository();

    const created = await tracking.upsertEntry("user-1", "m-1", {});
    expect(created.ok).toBe(true);
    expect(created.value).toEqual(
      expect.objectContaining({ mediaId: "m-1", status: "PLANNED", score: null }),
    );
    // Doc id = mediaId: el segundo clic no duplica (AC-120).
    await tracking.upsertEntry("user-1", "m-1", { status: "PLANNED" });
    expect((await tracking.listEntries("user-1", {})).value.items).toHaveLength(1);

    // Validación ANTES de escribir (API-12, AC-122).
    const writesBeforeInvalid = tracking.writes;
    const invalid = await tracking.setScore("user-1", "m-1", 11);
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe("validation");
    expect(tracking.writes).toBe(writesBeforeInvalid);

    expect((await tracking.setScore("user-1", "m-1", 7)).value.score).toBe(7);
    expect((await tracking.setStatus("user-1", "m-1", "COMPLETED")).value.status).toBe(
      "COMPLETED",
    );

    // Filtrado por estado (AC-124).
    const completed = await tracking.listEntries("user-1", { status: "COMPLETED" });
    expect(completed.value.items.map((entry) => entry.mediaId)).toEqual(["m-1"]);
    expect(
      (await tracking.listEntries("user-1", { status: "PLANNED" })).value.items,
    ).toEqual([]);

    // listByMinScore (DB-116): score 7 < 8.
    expect((await tracking.listByMinScore("user-1", 8)).value).toEqual([]);
    expect((await tracking.listByMinScore("user-1", 7)).value).toHaveLength(1);

    expect((await tracking.deleteEntry("user-1", "m-1")).value).toBe(true);
    expect((await tracking.getEntry("user-1", "m-1")).value).toBeNull();

    expect(tracking.reads).toBeGreaterThan(0);
    expect(tracking.writes).toBeGreaterThan(0);
    tracking.resetReads();
    expect(tracking.reads).toBe(0);
    expect(tracking.readLog).toEqual([]);
  });

  it("API-14: FakeCollectionRepository cubre el contrato de colecciones con Result", async () => {
    const collections = new FakeCollectionRepository();

    const created = await collections.create("user-1", {
      name: "Favoritos",
      description: "Los míos",
    });
    expect(created.ok).toBe(true);
    const id = created.value.id;
    expect(created.value.itemIds).toEqual([]);

    // addItem idempotente (API-13, AC-125).
    expect((await collections.addItem("user-1", id, "m-1")).value.itemIds).toEqual([
      "m-1",
    ]);
    expect((await collections.addItem("user-1", id, "m-1")).value.itemIds).toEqual([
      "m-1",
    ]);
    // Quitar solo toca itemIds (AC-127).
    expect((await collections.removeItem("user-1", id, "m-1")).value.itemIds).toEqual(
      [],
    );

    // Validación sin escritura (DB-123).
    const writesBeforeInvalid = collections.writes;
    const emptyName = await collections.create("user-1", { name: "" });
    expect(emptyName.ok).toBe(false);
    expect(emptyName.code).toBe("validation");
    expect(collections.writes).toBe(writesBeforeInvalid);

    expect((await collections.update("user-1", id, { name: "Top" })).value.name).toBe(
      "Top",
    );
    expect((await collections.list("user-1")).value).toHaveLength(1);
    expect((await collections.get("user-1", id)).value.name).toBe("Top");
    expect((await collections.delete("user-1", id)).value).toBe(true);
    expect((await collections.get("user-1", id)).value).toBeNull();

    expect(collections.reads).toBeGreaterThan(0);
    expect(collections.writes).toBeGreaterThan(0);
  });

  it("API-14: FakeCatalogRepository lee en memoria (listByType, searchByTitle, getById, getAll)", async () => {
    const catalog = new FakeCatalogRepository([
      { id: "s-1", title: "Alpha", mediaType: "SERIES", genres: ["Sci-Fi"], seed: true },
      { id: "g-1", title: "Beta", mediaType: "GAME", genres: ["RPG"], avgRating: 8 },
      { id: "m-1", title: "Alfa", mediaType: "MOVIE", genres: ["Drama"] },
    ]);

    expect((await catalog.listSeeded()).value.map((item) => item.id)).toEqual(["s-1"]);
    expect((await catalog.getById("g-1")).value.title).toBe("Beta");
    expect((await catalog.getById("no-existe")).value).toBeNull();

    const byType = await catalog.listByType("MOVIE");
    expect(byType.value.items.map((item) => item.id)).toEqual(["m-1"]);

    const found = await catalog.searchByTitle("alp");
    expect(found.value.items.map((item) => item.id)).toEqual(["s-1"]);

    // getAll(...ids): 1 lectura por lote (API-20).
    catalog.resetReads();
    const batch = await catalog.getAll("s-1", "g-1", "no-existe");
    expect(batch.value.map((item) => item.id)).toEqual(["s-1", "g-1"]);
    expect(catalog.reads).toBe(1);
    expect(catalog.readLog).toEqual(["getAll"]);
  });

  it("API-14: ninguna operación toca la red aunque fetch esté disponible", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("Red inesperada en un test con fakes");
    };
    try {
      const tracking = new FakeTrackingRepository([
        { mediaId: "m-1", status: "PLANNED", score: 9 },
      ]);
      const catalog = new FakeCatalogRepository([
        { id: "m-1", title: "Alpha", mediaType: "SERIES", seed: true },
      ]);
      const collections = new FakeCollectionRepository();

      expect((await tracking.getEntry("u", "m-1")).ok).toBe(true);
      expect((await catalog.listSeeded()).value).toHaveLength(1);
      const created = await collections.create("u", { name: "Favoritos" });
      expect(created.ok).toBe(true);
      expect((await collections.addItem("u", created.value.id, "m-1")).value.itemIds).toEqual([
        "m-1",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// -------------------------------------------------------------
// AC-153 (spec 05): presupuesto de lecturas con fakes instrumentados
// -------------------------------------------------------------

describe("AC-153: getRecommendations con fakes instrumentados", () => {
  it("AC-153: 30 entries + 500 candidatos ⇒ reads ≤ 2 (1 query entries + 1 candidatos, sin N+1)", async () => {
    // 30 entries del usuario (afinidad plena y débil).
    const entries = [];
    for (let index = 0; index < 30; index += 1) {
      entries.push({
        mediaId: `e${index}`,
        title: `Entry ${index}`,
        status: index % 2 === 0 ? "COMPLETED" : "PLANNED",
        score: index % 2 === 0 ? 9 : null,
        genres: ["Sci-Fi"],
        creator: "A. Director",
        updatedAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
      });
    }

    // Catálogo: los 30 items de las entries + 500 candidatos seed.
    const catalog = entries.map((entry) => ({
      id: entry.mediaId,
      title: entry.title,
      mediaType: "SERIES",
      genres: ["Sci-Fi"],
      creator: "A. Director",
      seed: true,
    }));
    for (let index = 0; index < 500; index += 1) {
      catalog.push({
        id: `c${index}`,
        title: `Candidato ${String(index).padStart(3, "0")}`,
        mediaType: index % 2 === 0 ? "SERIES" : "MOVIE",
        genres: index % 3 === 0 ? ["Sci-Fi"] : ["Drama"],
        creator: index % 5 === 0 ? "A. Director" : "B. Otro",
        avgRating: 6 + ((index % 40) / 10),
        seed: true,
      });
    }

    const tracking = new FakeTrackingRepository(entries);
    const catalogRepository = new FakeCatalogRepository(catalog);
    const service = createRecommendationService({
      trackingRepository: tracking,
      catalogRepository,
    });

    const result = await service.getRecommendations("user-1");

    expect(result.ok).toBe(true);
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value.length).toBeLessThanOrEqual(20);
    // 1 lectura de entries + 1 de candidatos: sin N+1 (ALG-08).
    expect(tracking.readLog).toEqual(["listEntries"]);
    expect(catalogRepository.readLog).toEqual(["listSeeded"]);
    expect(tracking.reads + catalogRepository.reads).toBeLessThanOrEqual(2);
  });
});

// -------------------------------------------------------------
// AC-137 (spec 04): recálculo por snapshot sin getStats
// -------------------------------------------------------------

describe("AC-137: FakeTrackingRepository simula snapshots sin emulador Firestore", () => {
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

  it("AC-137: el evento del FakeTrackingRepository actualiza KPIs y distribución sin getStats ni lecturas", async () => {
    const tracking = new FakeTrackingRepository(TRACKING_FIXTURE);
    const catalogRepository = new FakeCatalogRepository(CATALOG_FIXTURE);
    const service = createDashboardService({
      trackingRepository: tracking,
      catalogRepository,
    });

    const first = await service.getStats("user-1");
    expect(first.ok).toBe(true);
    expect(first.value.totals).toEqual(TOTALS_BEFORE);
    expect(first.value.byType.SERIES).toEqual({ count: 1, pct: 25 });
    expect(tracking.readLog).toEqual(["listEntries"]);
    expect(catalogRepository.readLog).toEqual(["getAll"]);

    const readsAfterGetStats = {
      tracking: tracking.reads,
      catalog: catalogRepository.reads,
    };

    // Suscripción reactiva (API-22) + evento de snapshot simulado.
    const received = [];
    const unsubscribe = service.subscribe("user-1", (stats) =>
      received.push(stats),
    );

    await tracking.setStatus("user-1", "m-1", "COMPLETED"); // PLANNED -> COMPLETED
    tracking.emitSnapshot();

    expect(received).toHaveLength(1);
    expect(received[0].totals).toEqual(TOTALS_AFTER);
    expect(received[0].byType.SERIES).toEqual({ count: 1, pct: 25 });
    expect(received[0].byType.BOOK).toEqual({ count: 1, pct: 25 });

    // Sin re-ejecutar getStats: 0 lecturas nuevas.
    expect(tracking.reads).toBe(readsAfterGetStats.tracking);
    expect(catalogRepository.reads).toBe(readsAfterGetStats.catalog);

    unsubscribe();
  });

  it("AC-137: applySnapshot y recalculate actualizan KPIs sin re-ejecutar getStats", async () => {
    const tracking = new FakeTrackingRepository(TRACKING_FIXTURE);
    const catalogRepository = new FakeCatalogRepository(CATALOG_FIXTURE);
    const service = createDashboardService({
      trackingRepository: tracking,
      catalogRepository,
    });

    const first = await service.getStats("user-1");
    expect(first.ok).toBe(true);
    expect(first.value.totals).toEqual(TOTALS_BEFORE);

    const readsAfterGetStats = {
      tracking: tracking.reads,
      catalog: catalogRepository.reads,
    };
    const getStatsSpy = vi.spyOn(service, "getStats");

    // Snapshot: m-1 pasa de PLANNED a COMPLETED.
    const snapshot = tracking.entries.map((entry) =>
      entry.mediaId === "m-1" ? { ...entry, status: "COMPLETED" } : entry,
    );
    const applied = service.applySnapshot("user-1", snapshot);
    expect(applied.ok).toBe(true);
    expect(applied.value.totals).toEqual(TOTALS_AFTER);

    // Recálculo con el estado cacheado (mismo snapshot, sin I/O).
    const recalculated = service.recalculate("user-1");
    expect(recalculated.ok).toBe(true);
    expect(recalculated.value.totals).toEqual(TOTALS_AFTER);

    expect(getStatsSpy).not.toHaveBeenCalled();
    expect(tracking.reads).toBe(readsAfterGetStats.tracking);
    expect(catalogRepository.reads).toBe(readsAfterGetStats.catalog);

    getStatsSpy.mockRestore();
  });
});
