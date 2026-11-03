// Tests QA T-006 - AC-002 (REQ-002, DB-002): validaci\u00f3n y normalizaci\u00f3n
// de cap\u00edtulos favoritos (js/catalog.js).
import { describe, it, expect } from "vitest";
import {
  validateFavoriteChapter,
  normalizeFavoriteChapter,
  CHAPTER_PARENT_MEDIA_TYPES,
} from "../js/catalog.js";

const valid = {
  parentMediaType: "series",
  parentItemId: "item-1",
  season: 1,
  episode: 5,
  title: "Cap\u00edtulo 5",
  notes: "Gran episodio",
  rating: 8,
  watchCount: 2,
};

const errorsOf = (chapter) => validateFavoriteChapter(chapter).errors.join(" ");

describe("AC-002 validateFavoriteChapter: cap\u00edtulo v\u00e1lido", () => {
  it("AC-002: un cap\u00edtulo completo es v\u00e1lido", () => {
    const result = validateFavoriteChapter(valid);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("AC-002: solo los campos obligatorios bastan (opcionales ausentes)", () => {
    const result = validateFavoriteChapter({
      parentMediaType: "anime",
      parentItemId: "item-2",
      title: "Estreno",
    });
    expect(result.valid).toBe(true);
  });
});

describe("AC-002 validateFavoriteChapter: t\u00edtulo", () => {
  it("AC-002: t\u00edtulo vac\u00edo es error", () => {
    const result = validateFavoriteChapter({ ...valid, title: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/t.tulo es obligatorio/);
  });

  it("AC-002: t\u00edtulo de solo espacios es error", () => {
    expect(validateFavoriteChapter({ ...valid, title: "   " }).valid).toBe(false);
  });

  it("AC-002: t\u00edtulo de m\u00e1s de 200 caracteres es error", () => {
    const result = validateFavoriteChapter({ ...valid, title: "x".repeat(201) });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/200/);
    expect(validateFavoriteChapter({ ...valid, title: "x".repeat(200) }).valid).toBe(true);
  });
});

describe("AC-002 validateFavoriteChapter: rating", () => {
  it("AC-002: rating 0 es error (fuera de 1-10)", () => {
    const result = validateFavoriteChapter({ ...valid, rating: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/entre 1 y 10/);
  });

  it("AC-002: rating 11 es error (fuera de 1-10)", () => {
    const result = validateFavoriteChapter({ ...valid, rating: 11 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/entre 1 y 10/);
  });

  it("AC-002: rating 7.5 es error (debe ser entero)", () => {
    const result = validateFavoriteChapter({ ...valid, rating: 7.5 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/entero/);
  });
});

describe("AC-002 validateFavoriteChapter: watchCount, season y episode", () => {
  it("AC-002: watchCount -1 es error", () => {
    const result = validateFavoriteChapter({ ...valid, watchCount: -1 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/visionados/);
  });

  it("AC-002: season 0 es error", () => {
    const result = validateFavoriteChapter({ ...valid, season: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/season/);
  });

  it("AC-002: episode 0 es error", () => {
    const result = validateFavoriteChapter({ ...valid, episode: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/episode/);
  });
});

describe("AC-002 validateFavoriteChapter: padres e ids", () => {
  it("AC-002: parentMediaType 'movie' es error (enum series/anime/book)", () => {
    const result = validateFavoriteChapter({ ...valid, parentMediaType: "movie" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/parentMediaType/);
    expect(CHAPTER_PARENT_MEDIA_TYPES).toEqual(["series", "anime", "book"]);
  });

  it("AC-002: parentMediaType 'podcast' es error (enum series/anime/book)", () => {
    const result = validateFavoriteChapter({ ...valid, parentMediaType: "podcast" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/parentMediaType/);
  });

  it("AC-002: parentItemId ausente es error", () => {
    const { parentItemId, ...sinPadre } = valid;
    const result = validateFavoriteChapter(sinPadre);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/parentItemId/);
    expect(validateFavoriteChapter({ ...valid, parentItemId: "  " }).valid).toBe(false);
    void parentItemId;
  });
});

describe("AC-002 normalizeFavoriteChapter: defaults (DB-002)", () => {
  it("AC-002: defaults watchCount=0, isFavorite=true, collectionIds=[]", () => {
    const chapter = normalizeFavoriteChapter({
      parentMediaType: "series",
      parentItemId: "item-1",
      title: "Cap\u00edtulo 1",
    });
    expect(chapter.watchCount).toBe(0);
    expect(chapter.isFavorite).toBe(true);
    expect(chapter.collectionIds).toEqual([]);
  });

  it("AC-002: campos opcionales ausentes \u2192 null", () => {
    const chapter = normalizeFavoriteChapter({
      parentMediaType: "series",
      parentItemId: "item-1",
      title: "Cap\u00edtulo 1",
    });
    expect(chapter.season).toBeNull();
    expect(chapter.episode).toBeNull();
    expect(chapter.notes).toBeNull();
    expect(chapter.rating).toBeNull();
  });

  it("AC-002: recorta textos y conserva valores informados", () => {
    const chapter = normalizeFavoriteChapter({
      parentMediaType: " series ",
      parentItemId: " item-9 ",
      season: 2,
      episode: 3,
      title: "  Final  ",
      notes: "  Notas  ",
      rating: 7,
      watchCount: 3,
      isFavorite: false,
      collectionIds: ["a", "a", "b"],
    });
    expect(chapter).toMatchObject({
      parentMediaType: "series",
      parentItemId: "item-9",
      season: 2,
      episode: 3,
      title: "Final",
      notes: "Notas",
      rating: 7,
      watchCount: 3,
      isFavorite: false,
    });
    expect(chapter.collectionIds).toEqual(["a", "b"]);
    expect(chapter.notes).not.toBeNull();
    void errorsOf;
  });
});
