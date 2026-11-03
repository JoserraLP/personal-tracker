// Tests QA T-006 - AC-005 (REQ-005): computeFavoritesStats (js/catalog.js).
// Contador global y atajos de los 5 favoritos m\u00e1s recientes del dashboard.
import { describe, it, expect } from "vitest";
import { computeFavoritesStats } from "../js/catalog.js";

const at = (iso) => new Date(iso);

const item = (id, updatedAt, createdAt, extra = {}) => ({
  id,
  mediaType: "movie",
  title: `Item ${id}`,
  updatedAt: at(updatedAt),
  createdAt: at(createdAt),
  ...extra,
});

const chapter = (id, updatedAt, createdAt, extra = {}) => ({
  id,
  parentMediaType: "series",
  parentItemId: "parent-1",
  title: `Cap\u00edtulo ${id}`,
  updatedAt: at(updatedAt),
  createdAt: at(createdAt),
  ...extra,
});

describe("AC-005 computeFavoritesStats: contador", () => {
  it("AC-005: count = \u00edtems + cap\u00edtulos", () => {
    const stats = computeFavoritesStats(
      [item("i1", "2026-01-05T10:00:00Z", "2026-01-01T10:00:00Z")],
      [
        chapter("c1", "2026-01-04T10:00:00Z", "2026-01-02T10:00:00Z"),
        chapter("c2", "2026-01-03T10:00:00Z", "2026-01-02T10:00:00Z"),
      ],
    );
    expect(stats.count).toBe(3);
  });

  it("AC-005: entrada vac\u00eda \u2192 count 0 y recent []", () => {
    expect(computeFavoritesStats([], [])).toEqual({ count: 0, recent: [] });
    expect(computeFavoritesStats()).toEqual({ count: 0, recent: [] });
    expect(computeFavoritesStats(null, undefined)).toEqual({ count: 0, recent: [] });
  });
});

describe("AC-005 computeFavoritesStats: recent (updatedAt desc, createdAt desc)", () => {
  it("AC-005: mezcla \u00edtems y cap\u00edtulos por updatedAt desc", () => {
    const stats = computeFavoritesStats(
      [item("i1", "2026-01-05T10:00:00Z", "2026-01-01T10:00:00Z")],
      [chapter("c1", "2026-01-04T10:00:00Z", "2026-01-02T10:00:00Z")],
    );
    expect(stats.recent.map((entry) => entry.id)).toEqual(["i1", "c1"]);
  });

  it("AC-005: empate por updatedAt se deshace con createdAt desc", () => {
    const stats = computeFavoritesStats(
      [item("i1", "2026-01-05T10:00:00Z", "2026-01-01T10:00:00Z")],
      [chapter("c1", "2026-01-05T10:00:00Z", "2026-01-03T10:00:00Z")],
    );
    expect(stats.recent.map((entry) => entry.id)).toEqual(["c1", "i1"]);
  });

  it("AC-005: recent se limita a 5 entradas", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      item(`i${i}`, `2026-02-0${i + 1}T10:00:00Z`, "2026-01-01T10:00:00Z"),
    );
    const chapters = Array.from({ length: 3 }, (_, i) =>
      chapter(`c${i}`, `2026-01-0${i + 1}T10:00:00Z`, "2026-01-01T10:00:00Z"),
    );
    const stats = computeFavoritesStats(items, chapters);
    expect(stats.count).toBe(7);
    expect(stats.recent).toHaveLength(5);
    expect(stats.recent.map((entry) => entry.id)).toEqual(["i3", "i2", "i1", "i0", "c2"]);
  });
});

describe("AC-005 computeFavoritesStats: forma de las entradas", () => {
  it("AC-005: entrada de \u00edtem expone kind/mediaType/id/title (y posterUrl?)", () => {
    const stats = computeFavoritesStats(
      [item("i1", "2026-01-05T10:00:00Z", "2026-01-01T10:00:00Z", { posterUrl: "https://img/p.png" })],
      [],
    );
    expect(stats.recent[0]).toEqual({
      kind: "item",
      mediaType: "movie",
      id: "i1",
      title: "Item i1",
      posterUrl: "https://img/p.png",
    });
  });

  it("AC-005: entrada de cap\u00edtulo usa parentMediaType como mediaType y expone parentItemId", () => {
    const stats = computeFavoritesStats(
      [],
      [chapter("c1", "2026-01-05T10:00:00Z", "2026-01-01T10:00:00Z", { parentMediaType: "anime" })],
    );
    expect(stats.recent[0]).toEqual({
      kind: "chapter",
      mediaType: "anime",
      id: "c1",
      title: "Cap\u00edtulo c1",
      parentItemId: "parent-1",
    });
    expect(stats.recent[0]).not.toHaveProperty("posterUrl");
  });

  it("AC-005: el \u00edtem no lleva parentItemId y el cap\u00edtulo sin padre no lo expone", () => {
    const stats = computeFavoritesStats(
      [item("i1", "2026-01-05T10:00:00Z", "2026-01-01T10:00:00Z")],
      [
        {
          id: "c1",
          parentMediaType: "book",
          title: "Sin padre",
          updatedAt: at("2026-01-04T10:00:00Z"),
          createdAt: at("2026-01-02T10:00:00Z"),
        },
      ],
    );
    expect(stats.recent[0]).not.toHaveProperty("parentItemId");
    expect(stats.recent[1]).not.toHaveProperty("parentItemId");
  });
});
