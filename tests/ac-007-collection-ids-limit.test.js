// Tests QA T-006 - AC-007 (REQ-007, parte pura): l\u00edmite de colecciones por
// objetivo y validaci\u00f3n de `collectionIds` (js/catalog.js).
import { describe, it, expect } from "vitest";
import {
  MAX_COLLECTIONS_PER_TARGET,
  validateItem,
  validateFavoriteChapter,
} from "../js/catalog.js";

const ids = (n) => Array.from({ length: n }, (_, i) => `col-${i}`);

const chapterBase = {
  parentMediaType: "series",
  parentItemId: "item-1",
  title: "Cap\u00edtulo 1",
};

describe("AC-007 l\u00edmite MAX_COLLECTIONS_PER_TARGET", () => {
  it("AC-007: MAX_COLLECTIONS_PER_TARGET es 20 (DB-001, DB-002)", () => {
    expect(MAX_COLLECTIONS_PER_TARGET).toBe(20);
  });

  it("AC-007: \u00edtem con 21 collectionIds es inv\u00e1lido", () => {
    const result = validateItem({ title: "Origen", collectionIds: ids(21) });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/20 colecciones/);
  });

  it("AC-007: cap\u00edtulo con 21 collectionIds es inv\u00e1lido", () => {
    const result = validateFavoriteChapter({ ...chapterBase, collectionIds: ids(21) });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/20 colecciones/);
  });

  it("AC-007: 20 collectionIds siguen siendo v\u00e1lidos en \u00edtems y cap\u00edtulos", () => {
    expect(validateItem({ title: "Origen", collectionIds: ids(20) }).valid).toBe(true);
    expect(validateFavoriteChapter({ ...chapterBase, collectionIds: ids(20) }).valid).toBe(true);
  });

  it("AC-007: 21 collectionIds con duplicados tambi\u00e9n se rechazan", () => {
    const result = validateItem({ title: "Origen", collectionIds: [...ids(20), "col-0"] });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/repetir|20 colecciones/);
  });
});
