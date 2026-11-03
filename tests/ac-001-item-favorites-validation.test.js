// Tests QA T-006 - AC-001 (REQ-001, DB-001): `isFavorite` y `collectionIds`
// en validateItem/normalizeItem (js/catalog.js).
import { describe, it, expect } from "vitest";
import { validateItem, normalizeItem } from "../js/catalog.js";

const base = { title: "Origen" };

describe("AC-001 isFavorite en validateItem/normalizeItem (DB-001)", () => {
  it("AC-001: normalizeItem aplica default isFavorite=false", () => {
    const item = normalizeItem("movie", base);
    expect(item.isFavorite).toBe(false);
  });

  it("AC-001: normalizeItem conserva isFavorite=true si viene informado", () => {
    expect(normalizeItem("movie", { ...base, isFavorite: true }).isFavorite).toBe(true);
    expect(normalizeItem("movie", { ...base, isFavorite: false }).isFavorite).toBe(false);
  });

  it("AC-001: validateItem acepta isFavorite booleano (true/false)", () => {
    expect(validateItem({ ...base, isFavorite: true }).valid).toBe(true);
    expect(validateItem({ ...base, isFavorite: false }).valid).toBe(true);
  });

  it("AC-001: validateItem rechaza isFavorite no booleano", () => {
    const result = validateItem({ ...base, isFavorite: "yes" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/isFavorite/);
    expect(result.errors.join(" ")).toMatch(/booleano/);
    expect(validateItem({ ...base, isFavorite: 1 }).valid).toBe(false);
    expect(validateItem({ ...base, isFavorite: {} }).valid).toBe(false);
  });

  it("AC-001: validateItem acepta isFavorite ausente (migraci\u00f3n perezosa)", () => {
    expect(validateItem(base).valid).toBe(true);
    expect(validateItem({ ...base, isFavorite: null }).valid).toBe(true);
  });
});

describe("AC-001 collectionIds en validateItem/normalizeItem (DB-001)", () => {
  it("AC-001: normalizeItem aplica default collectionIds=[]", () => {
    expect(normalizeItem("movie", base).collectionIds).toEqual([]);
  });

  it("AC-001: validateItem acepta lista de ids \u00fanicos (<=20)", () => {
    expect(validateItem({ ...base, collectionIds: ["a", "b"] }).valid).toBe(true);
    const twenty = Array.from({ length: 20 }, (_, i) => `c${i}`);
    expect(validateItem({ ...base, collectionIds: twenty }).valid).toBe(true);
  });

  it("AC-001: validateItem rechaza m\u00e1s de 20 collectionIds", () => {
    const twentyOne = Array.from({ length: 21 }, (_, i) => `c${i}`);
    const result = validateItem({ ...base, collectionIds: twentyOne });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/20 colecciones/);
  });

  it("AC-001: validateItem rechaza collectionIds duplicados (sin duplicados)", () => {
    const result = validateItem({ ...base, collectionIds: ["a", "b", "a"] });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/repetir/);
  });

  it("AC-001: validateItem rechaza collectionIds que no son texto", () => {
    const result = validateItem({ ...base, collectionIds: ["a", 3] });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/texto/);
  });

  it("AC-001: normalizeItem dedupe de collectionIds (JSDoc toCollectionIds)", () => {
    const item = normalizeItem("movie", {
      ...base,
      collectionIds: [" a ", "b", "a", "", 7, "b"],
    });
    expect(item.collectionIds).toEqual(["a", "b"]);
  });
});
