// Tests T-104 (issue #50) — validadores puros del modelo de datos.
// spec 01 §4: DB-120..DB-123; §5: AC-102, AC-103, AC-104; REQ-C4 (nombres).
import { describe, it, expect } from "vitest";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeTitle,
  validateMediaItem,
  validateEntry,
  validateCollection,
  MEDIA_ITEM_TYPES,
  ENTRY_STATUSES,
  METADATA_KIND_BY_MEDIA_TYPE,
} from "../js/catalog.js";

// REQ-C4: cada `it()` debe citar el ID que cubre. El wrapper registra el
// nombre usado, de modo que el test REQ-C4 puede comprobarlo después.
const citedNames = [];
function itId(id, name, fn) {
  const fullName = `${id}: ${name}`;
  citedNames.push(fullName);
  it(fullName, fn);
}

/** `MediaMetadata` mínimo válido para cada `mediaType` (DB-102). */
function metadataFor(mediaType) {
  switch (METADATA_KIND_BY_MEDIA_TYPE[mediaType]) {
    case "episodes":
      return { kind: "episodes", totalEpisodes: 10 };
    case "pages":
      return { kind: "pages", totalPages: 300 };
    case "duration":
      return { kind: "duration", durationMinutes: 90 };
    default:
      return { kind: "platforms", platforms: ["PC"] };
  }
}

describe("DB-120 validateMediaItem", () => {
  itId("DB-120", "los 7 mediaType con metadata coherente son válidos", () => {
    expect(MEDIA_ITEM_TYPES).toHaveLength(7);
    for (const mediaType of MEDIA_ITEM_TYPES) {
      const report = validateMediaItem({
        mediaType,
        title: "Título de prueba",
        metadata: metadataFor(mediaType),
      });
      expect(report.valid, `${mediaType}: ${report.errors.join(" | ")}`).toBe(true);
    }
  });

  itId("DB-120", "title obligatorio 1-200 y mediaType obligatorio", () => {
    const base = { mediaType: "BOOK", title: "Libro", metadata: metadataFor("BOOK") };
    expect(validateMediaItem({ ...base, title: "" }).errors.join(" ")).toMatch(
      /El título es obligatorio/,
    );
    expect(validateMediaItem({ ...base, title: "x".repeat(201) }).valid).toBe(false);
    expect(validateMediaItem({ title: "Libro", metadata: metadataFor("BOOK") }).errors.join(" ")).toMatch(
      /El tipo de medio \(mediaType\) es obligatorio/,
    );
    expect(validateMediaItem({ ...base, mediaType: "PODCAST" }).errors.join(" ")).toMatch(
      /mediaType inválido/,
    );
    expect(validateMediaItem({ ...base }).valid).toBe(true);
    expect(validateMediaItem({ mediaType: "BOOK", title: "Libro" }).errors.join(" ")).toMatch(
      /La metadata es obligatoria/,
    );
  });

  itId("DB-120", "releaseYear 1888-2100, genres ≤10 y avgRating 0-10", () => {
    const base = { mediaType: "BOOK", title: "Libro", metadata: metadataFor("BOOK") };
    expect(validateMediaItem({ ...base, releaseYear: 1888 }).valid).toBe(true);
    expect(validateMediaItem({ ...base, releaseYear: 2100 }).valid).toBe(true);
    expect(validateMediaItem({ ...base, releaseYear: 1887 }).errors.join(" ")).toMatch(
      /El año de estreno debe estar entre 1888 y 2100/,
    );
    expect(validateMediaItem({ ...base, releaseYear: 2101 }).valid).toBe(false);
    expect(validateMediaItem({ ...base, genres: Array(10).fill("g") }).valid).toBe(true);
    expect(validateMediaItem({ ...base, genres: Array(11).fill("g") }).errors.join(" ")).toMatch(
      /No se pueden guardar más de 10 géneros/,
    );
    expect(validateMediaItem({ ...base, avgRating: 0 }).valid).toBe(true);
    expect(validateMediaItem({ ...base, avgRating: 10 }).valid).toBe(true);
    expect(validateMediaItem({ ...base, avgRating: 10.5 }).errors.join(" ")).toMatch(
      /La valoración media debe estar entre 0 y 10/,
    );
    expect(validateMediaItem({ ...base, avgRating: -1 }).valid).toBe(false);
  });

  itId("DB-120", "metadata.kind coherente con mediaType (DB-102)", () => {
    const base = { mediaType: "GAME", title: "Hades" };
    expect(validateMediaItem({ ...base, metadata: metadataFor("GAME") }).valid).toBe(true);
    expect(
      validateMediaItem({ ...base, metadata: { kind: "duration", durationMinutes: 60 } }).errors.join(" "),
    ).toMatch(/no es coherente con mediaType "GAME"/);
  });
});

describe("DB-121 / AC-102 normalizeTitle", () => {
  itId("DB-121", "trim → minúsculas → sin acentos → colapsar espacios", () => {
    expect(normalizeTitle("  MUCHA   Espaciado  ")).toBe("mucha espaciado");
    expect(normalizeTitle("Café Münster")).toBe("cafe munster");
    expect(normalizeTitle("Ñandú")).toBe("nandu");
    expect(normalizeTitle(123)).toBe("");
    expect(normalizeTitle(null)).toBe("");
  });

  itId("DB-121", "es determinista: misma entrada ⇒ misma salida", () => {
    const input = "El Último Signo  (2020)";
    expect(normalizeTitle(input)).toBe(normalizeTitle(input));
    expect(normalizeTitle(input)).toBe(normalizeTitle(input));
  });

  itId("AC-102", '"El Último Signo  (2020)" ⇒ "el ultimo signo 2020" y se repite idéntico', () => {
    const first = normalizeTitle("El Último Signo  (2020)");
    expect(first).toBe("el ultimo signo 2020");
    expect(normalizeTitle("El Último Signo  (2020)")).toBe(first);
  });
});

describe("DB-122 validateEntry", () => {
  const valid = {
    status: "IN_PROGRESS",
    score: 8,
    review: "Muy buena.",
    progress: { current: 3, total: 10 },
    mediaType: "SERIES",
    metadata: { kind: "episodes" },
  };

  itId("DB-122", "status ∈ enum de 4 estados", () => {
    expect(ENTRY_STATUSES).toHaveLength(4);
    for (const status of ENTRY_STATUSES) {
      const report = validateEntry({ ...valid, status });
      expect(report.valid, `estado ${status}: ${report.errors.join(" | ")}`).toBe(true);
    }
    expect(validateEntry({ ...valid, status: "watching" }).errors.join(" ")).toMatch(
      /Estado inválido/,
    );
  });

  itId("DB-122", "score entero 1-10 o null; review ≤500", () => {
    expect(validateEntry({ ...valid, score: null }).valid).toBe(true);
    expect(validateEntry({ ...valid, score: 1 }).valid).toBe(true);
    expect(validateEntry({ ...valid, score: 10 }).valid).toBe(true);
    expect(validateEntry({ ...valid, score: 0 }).valid).toBe(false);
    expect(validateEntry({ ...valid, score: 7.5 }).errors.join(" ")).toMatch(
      /La puntuación debe ser un número entero/,
    );
    expect(validateEntry({ ...valid, review: "x".repeat(501) }).errors.join(" ")).toMatch(
      /La reseña no puede superar los 500 caracteres/,
    );
    expect(validateEntry({ ...valid, review: "x".repeat(500) }).valid).toBe(true);
  });

  itId("DB-122", "progress.current ≥ 0 y ≤ progress.total si total existe", () => {
    expect(validateEntry({ ...valid, progress: { current: 10, total: 10 } }).valid).toBe(true);
    expect(validateEntry({ ...valid, progress: { current: 12, total: 10 } }).errors.join(" ")).toMatch(
      /El progreso actual no puede superar el total/,
    );
    expect(
      validateEntry({ ...valid, progress: { current: -1, total: 10 } }).errors.join(" "),
    ).toMatch(/El progreso current debe ser un número mayor o igual que 0/);
    expect(validateEntry({ ...valid, progress: { current: 5 } }).valid).toBe(true);
  });

  itId("DB-122", "unidad de progress coherente con metadata.kind (DB-103)", () => {
    // kind "episodes" ⇒ enteros (episodios).
    expect(
      validateEntry({ ...valid, progress: { current: 2.5, total: 10 } }).errors.join(" "),
    ).toMatch(/debe ser un número entero/);
    // kind "duration" ⇒ minutos consumidos, admite decimales.
    expect(
      validateEntry({
        status: "IN_PROGRESS",
        mediaType: "MOVIE",
        metadata: { kind: "duration" },
        progress: { current: 30.5, total: 120 },
      }).valid,
    ).toBe(true);
    // Forma con `context` (sin kind embebido en la entry).
    expect(
      validateEntry(
        { status: "PLANNED", progress: { current: 1, total: 2 } },
        { mediaType: "SERIES", metadata: { kind: "episodes" } },
      ).valid,
    ).toBe(true);
    // Conflicto entre kind de la entry y el del contexto.
    expect(
      validateEntry(
        { status: "PLANNED", mediaType: "MANGA", metadata: { kind: "pages" } },
        { mediaType: "MANGA", metadata: { kind: "episodes" } },
      ).errors.join(" "),
    ).toMatch(/metadata.kind en conflicto/);
  });
});

describe("DB-123 validateCollection", () => {
  itId("DB-123", "name 1-60 y description ≤300", () => {
    expect(validateCollection({ name: "Favoritos" }).valid).toBe(true);
    expect(validateCollection({ name: "" }).errors.join(" ")).toMatch(
      /El nombre de la colección es obligatorio/,
    );
    expect(validateCollection({ name: "n".repeat(61) }).errors.join(" ")).toMatch(
      /El nombre no puede superar los 60 caracteres/,
    );
    expect(validateCollection({ name: "Ok", description: "x".repeat(300) }).valid).toBe(true);
    expect(
      validateCollection({ name: "Ok", description: "x".repeat(301) }).errors.join(" "),
    ).toMatch(/La descripción no puede superar los 300 caracteres/);
  });

  itId("DB-123", "itemIds sin duplicados y ≤50", () => {
    expect(validateCollection({ name: "Ok", itemIds: ["a", "b"] }).valid).toBe(true);
    expect(
      validateCollection({ name: "Ok", itemIds: ["a", "a"] }).errors.join(" "),
    ).toMatch(/No se pueden repetir ítems \(itemIds\) en una colección/);
    const many = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    expect(validateCollection({ name: "Ok", itemIds: many }).errors.join(" ")).toMatch(
      /No se pueden guardar más de 50 ítems en una colección/,
    );
    const fifty = Array.from({ length: 50 }, (_, i) => `id-${i}`);
    expect(validateCollection({ name: "Ok", itemIds: fifty }).valid).toBe(true);
  });
});

describe("AC-103 score fuera de rango en validateEntry", () => {
  itId("AC-103", "entry con score 11 es inválida con el mensaje exacto", () => {
    const report = validateEntry({ status: "PLANNED", score: 11 });
    expect(report.valid).toBe(false);
    expect(report.errors.join(" ")).toContain("La puntuación debe estar entre 1 y 10");
  });
});

describe("AC-104 coherencia mediaType/metadata.kind", () => {
  itId("AC-104", "AUDIOBOOK + kind duration es válido; kind episodes inválido", () => {
    const ok = validateMediaItem({
      mediaType: "AUDIOBOOK",
      title: "Audiolibro de prueba",
      metadata: { kind: "duration", durationMinutes: 120 },
    });
    expect(ok.valid, ok.errors.join(" | ")).toBe(true);

    const bad = validateMediaItem({
      mediaType: "AUDIOBOOK",
      title: "Audiolibro de prueba",
      metadata: { kind: "episodes", totalEpisodes: 12 },
    });
    expect(bad.valid).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/no es coherente con mediaType "AUDIOBOOK"/);
  });
});

describe("REQ-C4 convención de nombres de test", () => {
  itId("REQ-C4", "cada it() cita su ID y el archivo sigue tests/<área>-<tema>.test.js", () => {
    expect(citedNames.length).toBeGreaterThanOrEqual(8);
    for (const name of citedNames) {
      expect(name, `sin ID citado: ${name}`).toMatch(/\b(?:AC-\d+|DB-\d+|REQ-C\d+)\b/);
    }
    expect(basename(fileURLToPath(import.meta.url))).toMatch(
      /^[a-z0-9]+(?:-[a-z0-9]+)+\.test\.js$/,
    );
  });
});
