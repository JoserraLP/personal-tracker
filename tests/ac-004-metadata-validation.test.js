// Tests T-006 — AC-004 (REQ-004, §4.2 DB-002): validateMetadata y
// normalizeMetadata de js/catalog.js. Validación de tipos/rangos de la
// metadata manual; normalización ItemMetadata (§4.1: ausentes → null).
import { describe, it, expect } from "vitest";
import {
  validateMetadata,
  isValidMetadata,
  normalizeMetadata,
  METADATA_SOURCES,
} from "../js/catalog.js";

function expectInvalid(metadata, pattern) {
  const result = validateMetadata(metadata);
  expect(result.valid).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.errors.join(" ")).toMatch(pattern);
}

describe("AC-004 validateMetadata: casos válidos (DB-002)", () => {
  it("AC-004: metadata vacía es válida (todo opcional)", () => {
    expect(validateMetadata({})).toEqual({ valid: true, errors: [] });
    expect(isValidMetadata({})).toBe(true);
  });

  it("AC-004: metadata completa con valores correctos es válida", () => {
    const full = {
      director: "Christopher Nolan",
      cast: ["Leonardo DiCaprio", "Elliot Page"],
      backdropUrl: "https://image.tmdb.org/t/p/w780/x.jpg",
      tagline: "Tu mente es la escena del crimen",
      platforms: ["PC", "PlayStation 5"],
      developers: ["Supergiant Games"],
      publisher: "Plaza & Janés",
      authors: ["Patrick Rothfuss"],
      pageCount: 656,
      seasons: 3,
      episodes: 26,
      language: "es",
      metadataSource: "manual",
      metadataFetchedAt: new Date("2026-11-01T10:00:00.000Z"),
    };
    expect(validateMetadata(full)).toEqual({ valid: true, errors: [] });
  });

  it("AC-004: límites exactos de DB-002 son válidos", () => {
    const result = validateMetadata({
      director: "d".repeat(200),
      cast: Array.from({ length: 20 }, () => "c".repeat(100)),
      tagline: "t".repeat(300),
      platforms: Array.from({ length: 10 }, (_, i) => `p${i}`),
      developers: Array.from({ length: 10 }, (_, i) => `d${i}`),
      authors: Array.from({ length: 10 }, (_, i) => `a${i}`),
      publisher: "p".repeat(200),
      pageCount: 0,
      seasons: 0,
      episodes: 0,
      language: "l".repeat(50),
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("AC-004: los 4 valores de metadataSource son válidos", () => {
    for (const source of METADATA_SOURCES) {
      expect(isValidMetadata({ metadataSource: source })).toBe(true);
    }
    expect(METADATA_SOURCES).toEqual(["tmdb", "igdb", "googlebooks", "manual"]);
  });
});

describe("AC-004 validateMetadata: casos inválidos por DB-002", () => {
  it("AC-004: director de más de 200 caracteres se bloquea", () => {
    expectInvalid({ director: "d".repeat(201) }, /200 caracteres/);
  });

  it("AC-004: cast con más de 20 elementos se bloquea", () => {
    expectInvalid({ cast: Array.from({ length: 21 }, (_, i) => `actor ${i}`) }, /20 nombres/);
  });

  it("AC-004: elemento de cast de más de 100 caracteres se bloquea", () => {
    expectInvalid({ cast: ["c".repeat(101)] }, /100 caracteres/);
  });

  it("AC-004: platforms con más de 10 elementos se bloquea", () => {
    expectInvalid({ platforms: Array.from({ length: 11 }, (_, i) => `p${i}`) }, /10 elementos/);
  });

  it("AC-004: pageCount negativo se bloquea", () => {
    expectInvalid({ pageCount: -1 }, /negativo/);
  });

  it("AC-004: seasons negativo se bloquea", () => {
    expectInvalid({ seasons: -1 }, /negativo/);
  });

  it("AC-004: language de más de 50 caracteres se bloquea", () => {
    expectInvalid({ language: "l".repeat(51) }, /50 caracteres/);
  });

  it("AC-004: metadataSource fuera de {tmdb,igdb,googlebooks,manual} se bloquea", () => {
    expectInvalid({ metadataSource: "imdb" }, /Fuente de metadata inv.lida/);
  });

  it("AC-004: metadata que no es objeto se bloquea", () => {
    expect(validateMetadata(null).valid).toBe(false);
    expect(validateMetadata("x").valid).toBe(false);
    expect(validateMetadata([]).valid).toBe(false);
  });
});

describe("AC-004 normalizeMetadata: campos ausentes → null (§4.1)", () => {
  it("AC-004: escalares y arrays ausentes se serializan como null", () => {
    expect(normalizeMetadata({})).toEqual({
      title: null,
      year: null,
      posterUrl: null,
      backdropUrl: null,
      synopsis: null,
      genres: null,
      durationMinutes: null,
      director: null,
      cast: null,
      platforms: null,
      developers: null,
      publisher: null,
      authors: null,
      pageCount: null,
      seasons: null,
      episodes: null,
      tagline: null,
      language: null,
      metadataSource: null,
    });
  });

  it("AC-004: escalares presentes se recortan y convierten a número", () => {
    const item = normalizeMetadata({
      title: "  Origen  ",
      year: "2010",
      durationMinutes: "148",
      pageCount: 656,
      seasons: 3,
      episodes: 26,
      director: " Christopher Nolan ",
      tagline: " tagline ",
      language: " es ",
      publisher: " Plaza & Janés ",
      synopsis: " Sinopsis ",
      posterUrl: " https://x/1.jpg ",
      backdropUrl: " https://x/2.jpg ",
    });
    expect(item.title).toBe("Origen");
    expect(item.year).toBe(2010);
    expect(item.durationMinutes).toBe(148);
    expect(item.pageCount).toBe(656);
    expect(item.seasons).toBe(3);
    expect(item.episodes).toBe(26);
    expect(item.director).toBe("Christopher Nolan");
    expect(item.tagline).toBe("tagline");
    expect(item.language).toBe("es");
    expect(item.publisher).toBe("Plaza & Janés");
    expect(item.synopsis).toBe("Sinopsis");
    expect(item.posterUrl).toBe("https://x/1.jpg");
    expect(item.backdropUrl).toBe("https://x/2.jpg");
  });

  it("AC-004: números no finitos y textos vacíos → null", () => {
    const item = normalizeMetadata({
      year: "nada",
      durationMinutes: null,
      pageCount: Number.NaN,
      title: "   ",
      director: "",
    });
    expect(item.year).toBeNull();
    expect(item.durationMinutes).toBeNull();
    expect(item.pageCount).toBeNull();
    expect(item.title).toBeNull();
    expect(item.director).toBeNull();
  });

  it("AC-004: arrays se recortan, descartan no-textos y no-array → null", () => {
    const item = normalizeMetadata({
      cast: ["  Leonardo DiCaprio ", "", 3, "Elliot Page"],
      genres: "no-es-array",
      platforms: [" PC "],
      developers: [],
      authors: null,
    });
    expect(item.cast).toEqual(["Leonardo DiCaprio", "Elliot Page"]);
    expect(item.genres).toBeNull();
    expect(item.platforms).toEqual(["PC"]);
    expect(item.developers).toEqual([]);
    expect(item.authors).toBeNull();
  });

  it("AC-004: metadataSource válido se conserva; inválido → null", () => {
    expect(normalizeMetadata({ metadataSource: "tmdb" }).metadataSource).toBe("tmdb");
    expect(normalizeMetadata({ metadataSource: "manual" }).metadataSource).toBe("manual");
    expect(normalizeMetadata({ metadataSource: "imdb" }).metadataSource).toBeNull();
    expect(normalizeMetadata({ metadataSource: 42 }).metadataSource).toBeNull();
  });

  it("AC-004: normalizeMetadata no muta el objeto recibido", () => {
    const input = { title: " Origen ", cast: [" A "], year: "2010" };
    const snapshot = JSON.stringify(input);
    normalizeMetadata(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
