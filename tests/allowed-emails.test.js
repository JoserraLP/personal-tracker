import { describe, it, expect } from "vitest";
import {
  ALLOWED_EMAILS,
  isEmailAllowed,
  normalizeEmail,
} from "../js/allowed-emails.js";

describe("normalizeEmail (spec 001, §2.1)", () => {
  it("escenario 4: minúsculas y sin espacios", () => {
    expect(normalizeEmail("  ADMIN@Admin.ES ")).toBe("admin@admin.es");
  });

  it("escenario 5: null/undefined → cadena vacía", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });

  it("escenario 5 (contrato §2.1): valores no string → \"\" / false", () => {
    expect(normalizeEmail(123)).toBe("");
    expect(isEmailAllowed(123)).toBe(false);
    expect(isEmailAllowed({})).toBe(false);
  });
});

describe("isEmailAllowed (spec 001, §2.1)", () => {
  it("requisito: la lista semilla incluye el correo de ejemplo", () => {
    expect(ALLOWED_EMAILS).toContain("admin@admin.es");
  });

  it("escenario 2: correo de la lista, exacto → true", () => {
    expect(isEmailAllowed("admin@admin.es")).toBe(true);
  });

  it("escenario 4: mismo correo con mayúsculas y espacios → true", () => {
    expect(isEmailAllowed("  Admin@Admin.ES ")).toBe(true);
  });

  it("escenario 3: correo ajeno a la lista → false", () => {
    expect(isEmailAllowed("otro@correo.com")).toBe(false);
  });

  it("escenario 5: correos vacíos o nulos → false", () => {
    expect(isEmailAllowed("")).toBe(false);
    expect(isEmailAllowed("   ")).toBe(false);
    expect(isEmailAllowed(null)).toBe(false);
    expect(isEmailAllowed(undefined)).toBe(false);
  });

  it("escenario 5: lista vacía → false para cualquier correo", () => {
    expect(isEmailAllowed("admin@admin.es", [])).toBe(false);
  });

  it("acepta una lista explícita con normalización propia", () => {
    expect(isEmailAllowed("B@B.ES", ["a@a.es", " b@b.es "])).toBe(true);
    expect(isEmailAllowed("c@c.es", ["a@a.es", "b@b.es"])).toBe(false);
  });

  it("comparación exacta: sin wildcards ni prefijos/sufijos", () => {
    expect(isEmailAllowed("x-admin@admin.es")).toBe(false);
    expect(isEmailAllowed("admin@admin.es.evil.com")).toBe(false);
  });
});
