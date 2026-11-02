// Tests T-007 — parte pura de js/catalog.js (sin red ni Firebase).
// Cobertura: AC-016 (filtro y orden, REQ-012 / Q-003),
// AC-002 (el filtro por estado refleja el cambio de estado).
import { describe, it, expect } from "vitest";
import {
  filterItems,
  matchesFilter,
  sortItems,
  ITEM_STATUSES,
} from "../js/catalog.js";

const ITEMS = [
  {
    mediaType: "movie",
    title: "El Zorro",
    status: "completed",
    rating: 9,
    year: 2020,
    updatedAt: "2025-01-01T00:00:00Z",
  },
  {
    mediaType: "game",
    title: "Zelda",
    status: "in_progress",
    rating: 8,
    year: 2017,
    platform: "Switch",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    mediaType: "book",
    title: "Cien años de soledad",
    status: "pending",
    rating: null,
    year: 1967,
    author: "Gabriel García Márquez",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

describe("AC-016 filterItems / matchesFilter (REQ-012)", () => {
  it("AC-016: filtra por estado (valor único)", () => {
    const result = filterItems(ITEMS, { status: "completed" });
    expect(result.map((i) => i.title)).toEqual(["El Zorro"]);
  });

  it("AC-016: filtra por estado (lista de valores)", () => {
    const result = filterItems(ITEMS, { status: ["pending", "paused"] });
    expect(result.map((i) => i.title)).toEqual(["Cien años de soledad"]);
  });

  it("AC-016: filtra por tipo de medio (mediaType)", () => {
    expect(filterItems(ITEMS, { mediaType: "game" }).map((i) => i.title)).toEqual([
      "Zelda",
    ]);
    expect(filterItems(ITEMS, { mediaType: ["movie", "book"] })).toHaveLength(2);
  });

  it("AC-016: filtra por búsqueda de texto (título, autor y plataforma)", () => {
    expect(filterItems(ITEMS, { search: "zorro" }).map((i) => i.title)).toEqual([
      "El Zorro",
    ]);
    expect(filterItems(ITEMS, { search: "garcía" }).map((i) => i.title)).toEqual([
      "Cien años de soledad",
    ]);
    expect(filterItems(ITEMS, { search: "switch" }).map((i) => i.title)).toEqual([
      "Zelda",
    ]);
  });

  it("AC-016: filtra por rango de valoración y de año", () => {
    expect(filterItems(ITEMS, { minRating: 8 }).map((i) => i.title)).toEqual([
      "El Zorro",
      "Zelda",
    ]);
    expect(filterItems(ITEMS, { maxRating: 8 }).map((i) => i.title)).toEqual(["Zelda"]);
    expect(filterItems(ITEMS, { minYear: 2018 }).map((i) => i.title)).toEqual([
      "El Zorro",
    ]);
    expect(filterItems(ITEMS, { year: 2017 }).map((i) => i.title)).toEqual(["Zelda"]);
    expect(filterItems(ITEMS, { maxYear: 1999 }).map((i) => i.title)).toEqual([
      "Cien años de soledad",
    ]);
  });

  it("AC-016: sin filtros devuelve todos los ítems (y uno no-objeto no casa)", () => {
    expect(filterItems(ITEMS, {})).toHaveLength(3);
    expect(matchesFilter(null, {})).toBe(false);
    expect(matchesFilter(ITEMS[0], {})).toBe(true);
  });
});

describe("AC-016 sortItems (REQ-012, Q-003)", () => {
  it("AC-016: ordena por título ascendente", () => {
    expect(sortItems(ITEMS, "title").map((i) => i.title)).toEqual([
      "Cien años de soledad",
      "El Zorro",
      "Zelda",
    ]);
    expect(sortItems(ITEMS, "title", "desc").map((i) => i.title)[0]).toBe("Zelda");
  });

  it("AC-016: ordena por valoración descendente (vacíos al final)", () => {
    expect(sortItems(ITEMS, "rating").map((i) => i.title)).toEqual([
      "El Zorro",
      "Zelda",
      "Cien años de soledad",
    ]);
    expect(sortItems(ITEMS, "rating", "asc").map((i) => i.title)[0]).toBe("Zelda");
  });

  it("AC-016: ordena por año descendente", () => {
    expect(sortItems(ITEMS, "year").map((i) => i.year)).toEqual([2020, 2017, 1967]);
  });

  it("AC-016: ordena por estado en orden canónico", () => {
    expect(sortItems(ITEMS, "status").map((i) => i.status)).toEqual([
      "pending",
      "in_progress",
      "completed",
    ]);
  });

  it("AC-016: por defecto ordena por updatedAt descendente (Q-003)", () => {
    expect(sortItems(ITEMS).map((i) => i.title)).toEqual([
      "Zelda",
      "El Zorro",
      "Cien años de soledad",
    ]);
  });

  it("AC-016: campo de orden desconocido cae al orden por defecto", () => {
    expect(sortItems(ITEMS, "no-existe").map((i) => i.title)[0]).toBe("Zelda");
  });
});

describe("AC-002 el filtro por estado refleja el cambio de estado (REQ-002)", () => {
  it("AC-002: tras cambiar el estado, filterItems lo refleja en los 5 estados", () => {
    const item = { mediaType: "series", title: "Dark", status: "pending" };
    for (const status of ITEM_STATUSES) {
      const updated = { ...item, status };
      expect(filterItems([updated], { status })).toHaveLength(1);
      const others = ITEM_STATUSES.filter((s) => s !== status);
      expect(filterItems([updated], { status: others })).toHaveLength(0);
    }
  });
});
