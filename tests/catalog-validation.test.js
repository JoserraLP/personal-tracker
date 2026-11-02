// Tests T-007 — parte pura de js/catalog.js (sin red ni Firebase).
// Cobertura: AC-002, AC-005, AC-007, AC-010 (validación de ítem, DB-001..DB-006).
import { describe, it, expect } from "vitest";
import { validateItem, isValidItem, ITEM_STATUSES } from "../js/catalog.js";

describe("AC-010 validación de título y rating (REQ-014)", () => {
  it("AC-010: título vacío se bloquea con mensaje", () => {
    const result = validateItem({ title: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/El título es obligatorio/);
  });

  it("AC-010: título de solo espacios se bloquea", () => {
    const result = validateItem({ title: "   " });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/El título es obligatorio/);
  });

  it("AC-010: rating 0 se bloquea (fuera de 1-10)", () => {
    const result = validateItem({ title: "X", rating: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/La valoración debe estar entre 1 y 10/);
  });

  it("AC-010: rating 11 se bloquea (fuera de 1-10)", () => {
    const result = validateItem({ title: "X", rating: 11 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/La valoración debe estar entre 1 y 10/);
  });

  it("AC-010: rating 7.5 se bloquea (no entero)", () => {
    const result = validateItem({ title: "X", rating: 7.5 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/La valoración debe ser un número entero/);
  });

  it("AC-010: rating 1 y 10 (extremos) son válidos", () => {
    expect(isValidItem({ title: "X", rating: 1 })).toBe(true);
    expect(isValidItem({ title: "X", rating: 10 })).toBe(true);
  });
});

describe("AC-010 rangos numéricos (año, páginas, horas, %)", () => {
  it("AC-010: año fuera de 1888-2100 se bloquea", () => {
    expect(validateItem({ title: "X", year: 1887 }).valid).toBe(false);
    expect(validateItem({ title: "X", year: 2101 }).valid).toBe(false);
    expect(validateItem({ title: "X", year: 1887 }).errors.join(" ")).toMatch(
      /El año debe estar entre 1888 y 2100/,
    );
  });

  it("AC-010: año 1888 y 2100 (extremos) son válidos", () => {
    expect(isValidItem({ title: "X", year: 1888 })).toBe(true);
    expect(isValidItem({ title: "X", year: 2100 })).toBe(true);
  });

  it("AC-010: páginas negativas o leídas > total se bloquean", () => {
    expect(validateItem({ title: "X", pagesTotal: -1 }).valid).toBe(false);
    expect(validateItem({ title: "X", pagesRead: -1 }).valid).toBe(false);
    const over = validateItem({ title: "X", pagesTotal: 200, pagesRead: 300 });
    expect(over.valid).toBe(false);
    expect(over.errors.join(" ")).toMatch(/no pueden superar el total de páginas/);
  });

  it("AC-010: páginasRead = pagesTotal es válido", () => {
    expect(isValidItem({ title: "X", pagesTotal: 200, pagesRead: 200 })).toBe(true);
  });

  it("AC-010: horas jugadas negativas se bloquean; 0 es válido", () => {
    const negative = validateItem({ title: "X", hoursPlayed: -1 });
    expect(negative.valid).toBe(false);
    expect(negative.errors.join(" ")).toMatch(/Las horas jugadas no pueden ser negativas/);
    expect(isValidItem({ title: "X", hoursPlayed: 0 })).toBe(true);
  });

  it("AC-010: % completado fuera de 0-100 se bloquea", () => {
    expect(validateItem({ title: "X", completionPercent: -1 }).valid).toBe(false);
    expect(validateItem({ title: "X", completionPercent: 101 }).valid).toBe(false);
    expect(validateItem({ title: "X", completionPercent: -1 }).errors.join(" ")).toMatch(
      /debe estar entre 0 y 100/,
    );
  });

  it("AC-010: % completado 0 y 100 (extremos) son válidos", () => {
    expect(isValidItem({ title: "X", completionPercent: 0 })).toBe(true);
    expect(isValidItem({ title: "X", completionPercent: 100 })).toBe(true);
  });

  it("AC-010: logros negativos se bloquean", () => {
    expect(validateItem({ title: "X", achievementsUnlocked: -1 }).valid).toBe(false);
    expect(validateItem({ title: "X", achievementsTotal: -2 }).valid).toBe(false);
  });
});

describe("AC-002 estados válidos (REQ-002)", () => {
  it("AC-002: los 5 estados son válidos en validateItem", () => {
    expect(ITEM_STATUSES).toEqual([
      "pending",
      "in_progress",
      "completed",
      "paused",
      "abandoned",
    ]);
    for (const status of ITEM_STATUSES) {
      const result = validateItem({ title: "X", status });
      expect(result.valid, `estado ${status} debe ser válido`).toBe(true);
    }
  });

  it("AC-002: estado desconocido se bloquea con mensaje", () => {
    const result = validateItem({ title: "X", status: "watching" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Estado inválido/);
  });
});

describe("AC-005 valoración y reseña (REQ-008)", () => {
  it("AC-005: rating entero 1-10 y reseña corta son válidos", () => {
    const result = validateItem({
      title: "X",
      status: "completed",
      rating: 8,
      review: "Una obra maestra del cine.",
    });
    expect(result.valid).toBe(true);
  });

  it("AC-005: reseña de más de 500 caracteres se bloquea", () => {
    const result = validateItem({ title: "X", review: "x".repeat(501) });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/La reseña no puede superar los 500 caracteres/);
  });

  it("AC-005: rating no numérico se bloquea", () => {
    expect(validateItem({ title: "X", rating: "8" }).valid).toBe(false);
    expect(validateItem({ title: "X", rating: "8" }).errors.join(" ")).toMatch(
      /La valoración debe ser un número entero/,
    );
  });
});

describe("AC-007 campos de juego (REQ-010)", () => {
  it("AC-007: horas, %, plataforma y logros válidos se aceptan", () => {
    const result = validateItem({
      mediaType: "game",
      title: "Hades",
      status: "in_progress",
      hoursPlayed: 42.5,
      completionPercent: 80,
      platform: "Switch",
      achievementsUnlocked: 30,
      achievementsTotal: 49,
    });
    expect(result.valid).toBe(true);
  });

  it("AC-007: % 101 y horas -1 se bloquean en el mismo ítem", () => {
    const result = validateItem({
      mediaType: "game",
      title: "Hades",
      hoursPlayed: -1,
      completionPercent: 101,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Las horas jugadas no pueden ser negativas/);
    expect(result.errors.join(" ")).toMatch(/debe estar entre 0 y 100/);
  });

  it("AC-007: plataforma no textual se bloquea", () => {
    expect(validateItem({ title: "X", platform: 123 }).valid).toBe(false);
  });
});
