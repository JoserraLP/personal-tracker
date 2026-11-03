// Tests QA T-006 - AC-006 (REQ-006, DB-003): validaci\u00f3n y normalizaci\u00f3n
// de colecciones propias (js/catalog.js).
import { describe, it, expect } from "vitest";
import { validateCollection, normalizeCollection } from "../js/catalog.js";

const errorsOf = (collection) => validateCollection(collection).errors.join(" ");

describe("AC-006 validateCollection: nombre", () => {
  it("AC-006: nombre v\u00e1lido (1-60) pasa la validaci\u00f3n", () => {
    expect(validateCollection({ name: "Terror" }).valid).toBe(true);
    expect(validateCollection({ name: "x".repeat(60) }).valid).toBe(true);
  });

  it("AC-006: nombre vac\u00edo es error", () => {
    const result = validateCollection({ name: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/nombre/);
    expect(validateCollection({ name: "   " }).valid).toBe(false);
    expect(validateCollection({}).valid).toBe(false);
  });

  it("AC-006: nombre de m\u00e1s de 60 caracteres es error", () => {
    const result = validateCollection({ name: "x".repeat(61) });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/60/);
  });
});

describe("AC-006 validateCollection: descripci\u00f3n", () => {
  it("AC-006: descripci\u00f3n de m\u00e1s de 300 caracteres es error", () => {
    const result = validateCollection({ name: "Terror", description: "x".repeat(301) });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/300/);
  });

  it("AC-006: descripci\u00f3n de hasta 300 caracteres es v\u00e1lida", () => {
    expect(validateCollection({ name: "Terror", description: "x".repeat(300) }).valid).toBe(true);
    expect(validateCollection({ name: "Terror", description: null }).valid).toBe(true);
  });
});

describe("AC-006 validateCollection: color", () => {
  it("AC-006: color 'red' es inv\u00e1lido (solo #RRGGBB)", () => {
    const result = validateCollection({ name: "Terror", color: "red" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/#RRGGBB/);
  });

  it("AC-006: color '#GGG' es inv\u00e1lido", () => {
    const result = validateCollection({ name: "Terror", color: "#GGG" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/#RRGGBB/);
  });

  it("AC-006: color '#12345' es inv\u00e1lido (5 d\u00edgitos)", () => {
    const result = validateCollection({ name: "Terror", color: "#12345" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/#RRGGBB/);
  });

  it("AC-006: color '#8ab4f8' es v\u00e1lido", () => {
    expect(validateCollection({ name: "Terror", color: "#8ab4f8" }).valid).toBe(true);
    expect(validateCollection({ name: "Terror", color: "#ABCDEF" }).valid).toBe(true);
  });

  it("AC-006: color null (o ausente) es v\u00e1lido", () => {
    expect(validateCollection({ name: "Terror", color: null }).valid).toBe(true);
    expect(validateCollection({ name: "Terror" }).valid).toBe(true);
    expect(validateCollection({ name: "Terror", color: "#8ab4f" }).valid).toBe(false);
  });
});

describe("AC-006 normalizeCollection", () => {
  it("AC-006: recorta nombre y serializa opcionales ausentes como null", () => {
    const collection = normalizeCollection({ name: "  Terror  " });
    expect(collection).toEqual({ name: "Terror", description: null, color: null });
  });

  it("AC-006: recorta descripci\u00f3n y color; vac\u00edos \u2192 null", () => {
    const collection = normalizeCollection({
      name: "Comedia",
      description: "  Solo risas  ",
      color: "  #8ab4f8  ",
    });
    expect(collection).toEqual({
      name: "Comedia",
      description: "Solo risas",
      color: "#8ab4f8",
    });
    expect(normalizeCollection({ name: "Comedia", description: "   ", color: "  " })).toEqual({
      name: "Comedia",
      description: null,
      color: null,
    });
  });
});
