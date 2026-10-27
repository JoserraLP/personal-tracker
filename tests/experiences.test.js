import { describe, it, expect } from "vitest";
import { validateExperienceDraft } from "../js/section-lists.js";

describe("experiences.js — validateExperienceDraft (ADR-113)", () => {
  it("el título es obligatorio y se trimea", () => {
    const d = validateExperienceDraft("  ", "", "");
    expect(d.ok).toBe(false);
    expect(d.errors).toEqual(["El título es obligatorio."]);
    const d2 = validateExperienceDraft(" Viaje a Kioto ", "", "");
    expect(d2.ok).toBe(true);
    expect(d2.data.title).toBe("Viaje a Kioto");
  });

  it("la fecha opcional debe ser ISO yyyy-mm-dd", () => {
    expect(validateExperienceDraft("X", "2026-05-01", "").ok).toBe(true);
    const d = validateExperienceDraft("X", "05-01-2026", "");
    expect(d.ok).toBe(false);
    expect(d.errors[0]).toContain("yyyy-mm-dd");
    expect(d.data.date).toBeNull();
  });

  it("sin fecha la fecha es null y la descripción se trimea", () => {
    const d = validateExperienceDraft("X", "", "  mucho detalle  ");
    expect(d.ok).toBe(true);
    expect(d.data).toEqual({ title: "X", date: null, description: "mucho detalle" });
  });

  it("sin título y sin fecha: dos errores independientes", () => {
    const d = validateExperienceDraft("", "mal", "");
    expect(d.errors.length).toBe(2);
  });
});
