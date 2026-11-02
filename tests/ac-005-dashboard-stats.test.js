// Tests T-006 — AC-005 (REQ-005, D-005): computeDashboardStats de js/catalog.js.
// Función PURA: totales por tipo/estado, media SOLO de valorados, horas
// jugadas, completados y las 2 listas de 5 recientes. Sin red ni Firebase.
import { describe, it, expect } from "vitest";
import { computeDashboardStats, RECENT_ITEMS_LIMIT, MEDIA_TYPES, ITEM_STATUSES } from "../js/catalog.js";

let seq = 0;
function mkItem(overrides = {}) {
  seq += 1;
  return {
    id: `item-${seq}`,
    mediaType: "movie",
    status: "pending",
    title: `Título ${seq}`,
    createdAt: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("AC-005 computeDashboardStats: totales por tipo y estado (REQ-005)", () => {
  it("AC-005: totalsByType cuenta los ítems de cada tipo", () => {
    const stats = computeDashboardStats({
      movie: [mkItem({ mediaType: "movie" }), mkItem({ mediaType: "movie" })],
      series: [mkItem({ mediaType: "series" })],
      game: [mkItem({ mediaType: "game" })],
      book: [],
      anime: [mkItem({ mediaType: "anime" }), mkItem({ mediaType: "anime" })],
    });
    expect(stats.totalsByType).toEqual({
      movie: 2,
      series: 1,
      game: 1,
      book: 0,
      anime: 2,
    });
  });

  it("AC-005: totalsByStatus cuenta los 5 estados", () => {
    const stats = computeDashboardStats({
      movie: [
        mkItem({ status: "pending" }),
        mkItem({ status: "in_progress" }),
        mkItem({ status: "completed" }),
        mkItem({ status: "completed" }),
        mkItem({ status: "paused" }),
        mkItem({ status: "abandoned" }),
      ],
    });
    expect(stats.totalsByStatus).toEqual({
      pending: 1,
      in_progress: 1,
      completed: 2,
      paused: 1,
      abandoned: 1,
    });
  });
});

describe("AC-005 computeDashboardStats: averageRating solo de valorados (REQ-005)", () => {
  it("AC-005: la media usa SOLO los ítems con rating (excluye sin valorar)", () => {
    const stats = computeDashboardStats({
      movie: [
        mkItem({ rating: 8 }),
        mkItem({ rating: 6 }),
        mkItem({ rating: null }),
        mkItem({ rating: undefined }),
        mkItem({}),
      ],
    });
    expect(stats.averageRating).toBe(7);
  });

  it("AC-005: averageRating es null si ningún ítem tiene rating", () => {
    const stats = computeDashboardStats({
      movie: [mkItem({ rating: null }), mkItem({})],
      game: [mkItem({ mediaType: "game", rating: undefined })],
    });
    expect(stats.averageRating).toBeNull();
  });
});

describe("AC-005 computeDashboardStats: horas jugadas y completados (REQ-005)", () => {
  it("AC-005: totalHoursPlayed suma hoursPlayed SOLO de los juegos", () => {
    const stats = computeDashboardStats({
      game: [
        mkItem({ mediaType: "game", hoursPlayed: 10.5 }),
        mkItem({ mediaType: "game", hoursPlayed: 2.5 }),
        mkItem({ mediaType: "game", hoursPlayed: null }),
        mkItem({ mediaType: "game", hoursPlayed: -5 }),
      ],
      movie: [mkItem({ mediaType: "movie", hoursPlayed: 999 })],
    });
    expect(stats.totalHoursPlayed).toBe(13);
  });

  it("AC-005: completedCount cuenta los ítems con estado completed", () => {
    const stats = computeDashboardStats({
      movie: [mkItem({ status: "completed" }), mkItem({ status: "pending" })],
      book: [mkItem({ mediaType: "book", status: "completed" })],
    });
    expect(stats.completedCount).toBe(2);
  });
});

describe("AC-005 computeDashboardStats: recientes (REQ-005, D-005)", () => {
  it("AC-005: recentlyAdded devuelve 5 ítems ordenados por createdAt desc", () => {
    const items = [];
    for (let day = 1; day <= 7; day += 1) {
      items.push(
        mkItem({
          id: `added-${day}`,
          createdAt: `2026-03-0${day}T10:00:00.000Z`,
        }),
      );
    }
    const stats = computeDashboardStats({ movie: items });
    expect(stats.recentlyAdded).toHaveLength(RECENT_ITEMS_LIMIT);
    expect(stats.recentlyAdded.map((i) => i.id)).toEqual([
      "added-7",
      "added-6",
      "added-5",
      "added-4",
      "added-3",
    ]);
  });

  it("AC-005: recentlyCompleted usa completedAt desc e ignora ítems sin completedAt", () => {
    const items = [];
    for (let day = 1; day <= 6; day += 1) {
      items.push(
        mkItem({
          id: `done-${day}`,
          status: "completed",
          completedAt: `2026-02-0${day}T10:00:00.000Z`,
          createdAt: "2025-01-01T10:00:00.000Z",
        }),
      );
    }
    // Completados pero sin fecha de finalización → fuera de la lista.
    items.push(mkItem({ id: "sin-fecha", status: "completed", completedAt: null }));
    items.push(mkItem({ id: "fecha-vacia", status: "completed", completedAt: "" }));
    // Con completedAt pero sin completar → sí cuenta (fecha de visionado).
    items.push(
      mkItem({ id: "fecha-sin-estado", status: "in_progress", completedAt: "2026-02-07T10:00:00.000Z" }),
    );

    const stats = computeDashboardStats({ movie: items });
    expect(stats.recentlyCompleted).toHaveLength(RECENT_ITEMS_LIMIT);
    expect(stats.recentlyCompleted.map((i) => i.id)).toEqual([
      "fecha-sin-estado",
      "done-6",
      "done-5",
      "done-4",
      "done-3",
    ]);
  });
});

describe("AC-005 computeDashboardStats: caso de entrada vacía (REQ-005)", () => {
  it("AC-005: sin ítems devuelve contadores a cero, media null y listas vacías", () => {
    const stats = computeDashboardStats();
    const emptyTypes = {};
    for (const type of MEDIA_TYPES) emptyTypes[type] = 0;
    const emptyStatuses = {};
    for (const status of ITEM_STATUSES) emptyStatuses[status] = 0;

    expect(stats.totalsByType).toEqual(emptyTypes);
    expect(stats.totalsByStatus).toEqual(emptyStatuses);
    expect(stats.averageRating).toBeNull();
    expect(stats.totalHoursPlayed).toBe(0);
    expect(stats.completedCount).toBe(0);
    expect(stats.recentlyAdded).toEqual([]);
    expect(stats.recentlyCompleted).toEqual([]);
  });
});
