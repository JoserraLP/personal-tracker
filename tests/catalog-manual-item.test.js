// Tests T-007 — parte pura de js/catalog.js (sin red ni Firebase).
// Cobertura: AC-004 (alta manual con solo título, REQ-007),
// AC-017 (edición: merge de parche sin perder datos).
import { describe, it, expect } from "vitest";
import { normalizeItem, validateItem, isValidItem } from "../js/catalog.js";

describe("AC-004 alta manual: ítem mínimo (REQ-007)", () => {
  it("AC-004: un ítem con solo título es válido y se puede guardar", () => {
    const item = normalizeItem("movie", { title: "Solo título" });
    const result = validateItem(item);
    expect(result.valid, result.errors.join(" | ")).toBe(true);
  });

  it("AC-004: se guarda sin datos externos (source null, resto null/vacío)", () => {
    const item = normalizeItem("movie", { title: "Solo título" });
    expect(item.source).toBeNull();
    expect(item.year).toBeNull();
    expect(item.posterUrl).toBeNull();
    expect(item.synopsis).toBeNull();
    expect(item.durationMinutes).toBeNull();
    expect(item.rating).toBeNull();
    expect(item.review).toBeNull();
    expect(item.genres).toEqual([]);
    expect(item.sessions).toEqual([]);
    expect(item.status).toBe("pending");
  });

  it("AC-004: el título con espacios se recorta antes de validar", () => {
    const item = normalizeItem("book", { title: "  El nombre del viento  " });
    expect(item.title).toBe("El nombre del viento");
    expect(isValidItem(item)).toBe(true);
    expect(item.author).toBeNull();
    expect(item.pagesTotal).toBeNull();
    expect(item.pagesRead).toBeNull();
  });

  it("AC-004: sin título no se puede guardar", () => {
    const item = normalizeItem("game", {});
    expect(validateItem(item).valid).toBe(false);
    expect(validateItem(item).errors.join(" ")).toMatch(/El título es obligatorio/);
  });
});

describe("AC-017 edición de ítem: merge de parche (REQ-013)", () => {
  it("AC-017: el parche se aplica y los demás campos se conservan", () => {
    const current = normalizeItem("game", {
      title: "Hades",
      year: 2020,
      rating: 8,
      hoursPlayed: 30,
      completionPercent: 50,
      platform: "PC",
      achievementsUnlocked: 10,
      achievementsTotal: 49,
    });
    const patch = { ...current, completionPercent: 60, hoursPlayed: 35 };
    const edited = normalizeItem("game", patch);
    expect(validateItem(edited).valid).toBe(true);
    expect(edited.completionPercent).toBe(60);
    expect(edited.hoursPlayed).toBe(35);
    expect(edited.title).toBe("Hades");
    expect(edited.year).toBe(2020);
    expect(edited.rating).toBe(8);
    expect(edited.platform).toBe("PC");
    expect(edited.achievementsTotal).toBe(49);
  });

  it("AC-017: la edición con datos inválidos se bloquea con mensaje", () => {
    const current = normalizeItem("movie", { title: "Origen", rating: 9 });
    const edited = normalizeItem("movie", { ...current, rating: 7.5 });
    const result = validateItem(edited);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/La valoración debe ser un número entero/);
  });

  it("AC-017: normalizar no muta el objeto recibido", () => {
    const src = { title: "  A  ", rating: 5, sessions: [{ date: "2025-01-01" }] };
    const snapshot = JSON.parse(JSON.stringify(src));
    const item = normalizeItem("movie", src);
    expect(src).toEqual(snapshot);
    expect(item.title).toBe("A");
    expect(item).not.toBe(src);
  });
});
