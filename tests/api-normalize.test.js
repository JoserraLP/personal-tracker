// Tests T-127 (GitHub Issue #73) — puente `js/api-normalize.js`.
//
// Specs cubiertas:
//   · REQ-108 — alta/importación desde APIs externas (TMDB, Google
//     Books, IGDB/Steam) normalizando a `MediaItem`.
//   · DB-120 — el resultado pasa `validateMediaItem` (title 1-200,
//     mediaType ∈ 7 tipos, metadata.kind coherente con mediaType).
//   · REQ-E4 — un fallo de API externa se devuelve como `Result`
//     (nunca lanza) y NO bloquea el alta manual.
//
// Todo es puro: sin red, sin Firebase y sin DOM.
import { describe, it, expect } from "vitest";
import {
  API_NORMALIZE_PROVIDERS,
  API_RESULT_CODES,
  normalizeTmdbToMediaItem,
  normalizeBookToMediaItem,
  normalizeIgdbToMediaItem,
  normalizeSteamToMediaItem,
  normalizeApiToMediaItem,
  normalizeApiItems,
  normalizeApiFailure,
  normalizeManualMediaItem,
  toMediaItemInput,
  toMediaItemType,
} from "../js/api-normalize.js";
import { validateMediaItem, metadataKindFor, MEDIA_ITEM_TYPES } from "../js/catalog.js";

/** Asserts de DB-120: todo `Result` de éxito es un `MediaItemInput` válido. */
function expectValidMediaItem(result) {
  expect(result.ok).toBe(true);
  const item = result.value;
  const report = validateMediaItem(item);
  expect(report.errors).toEqual([]);
  expect(report.valid).toBe(true);
  // DB-102/AC-104: metadata.kind coherente con mediaType.
  expect(item.metadata.kind).toBe(metadataKindFor(item.mediaType));
  expect(MEDIA_ITEM_TYPES).toContain(item.mediaType);
  expect(item.seed).toBe(false);
  return item;
}

/** Asserts de REQ-E4: el fallo es un `Result` navegable por la UI. */
function expectBlockingFreeFailure(result, provider) {
  expect(result).not.toBeNull();
  expect(result.ok).toBe(false);
  expect(result.provider).toBe(provider);
  expect(API_RESULT_CODES).toContain(result.code);
  expect(typeof result.message).toBe("string");
  expect(result.message.length).toBeGreaterThan(0);
  return result;
}

// -------------------------------------------------------------
// REQ-108 — TMDB / Google Books / IGDB / Steam → MediaItemInput
// -------------------------------------------------------------
describe("REQ-108 normalización de APIs externas a MediaItemInput", () => {
  it("REQ-108: película TMDB cruda → MediaItemInput válido (DB-120)", () => {
    const result = normalizeTmdbToMediaItem({
      id: 123,
      title: "Origen",
      release_date: "2010-07-16",
      poster_path: "/origen.jpg",
      overview: "Un ladrón roba secretos mediante sueños.",
      genres: [
        { id: 28, name: "Acción" },
        { id: 878, name: "Ciencia ficción" },
      ],
      runtime: 148,
      vote_average: 8.4,
      credits: { crew: [{ job: "Director", name: "Christopher Nolan" }] },
    });

    const item = expectValidMediaItem(result);
    expect(item.mediaType).toBe("MOVIE");
    expect(item.title).toBe("Origen");
    expect(item.releaseYear).toBe(2010);
    expect(item.coverUrl).toBe("https://image.tmdb.org/t/p/w500/origen.jpg");
    expect(item.genres).toEqual(["Acción", "Ciencia ficción"]);
    expect(item.avgRating).toBe(8.4);
    expect(item.creator).toBe("Christopher Nolan");
    expect(item.synopsis).toContain("sueños");
    expect(item.metadata).toEqual({ kind: "duration", durationMinutes: 148 });
  });

  it("REQ-108: serie TMDB cruda → SERIES con metadata de episodios", () => {
    const result = normalizeTmdbToMediaItem({
      id: 456,
      name: "Dark",
      first_air_date: "2017-12-01",
      poster_path: "/dark.jpg",
      overview: "Cuatro familias, un misterio.",
      episode_run_time: [60],
      genres: [{ id: 10765, name: "Ciencia ficción" }],
      number_of_episodes: 26,
    });

    const item = expectValidMediaItem(result);
    expect(item.mediaType).toBe("SERIES");
    expect(item.title).toBe("Dark");
    expect(item.releaseYear).toBe(2017);
    expect(item.metadata).toEqual({ kind: "episodes", totalEpisodes: 26 });
  });

  it("REQ-108: anime TMDB (origen JP) → ANIME con metadata de episodios", () => {
    const item = expectValidMediaItem(
      normalizeTmdbToMediaItem({
        id: 89,
        name: "Cowboy Bebop",
        first_air_date: "1998-04-03",
        origin_country: ["JP"],
        number_of_episodes: 26,
      }),
    );
    expect(item.mediaType).toBe("ANIME");
    expect(item.metadata).toEqual({ kind: "episodes", totalEpisodes: 26 });
  });

  it("REQ-108: SearchResult TMDB ya normalizado también se adapta", () => {
    const item = expectValidMediaItem(
      normalizeTmdbToMediaItem({
        source: "tmdb",
        externalId: "999",
        mediaType: "movie",
        title: "Sin datos",
        year: null,
        posterUrl: null,
        synopsis: null,
        genres: [],
        durationMinutes: null,
      }),
    );
    expect(item.mediaType).toBe("MOVIE");
    expect(item.title).toBe("Sin datos");
    expect(item.releaseYear).toBeNull();
    // DB-102: kind "duration" exige durationMinutes → 0 (pendiente).
    expect(item.metadata).toEqual({ kind: "duration", durationMinutes: 0 });
  });

  it("REQ-108: volumen de Google Books → BOOK con pages y autor", () => {
    const result = normalizeBookToMediaItem({
      id: "vol-1",
      volumeInfo: {
        title: "Dune",
        authors: ["Frank Herbert"],
        publishedDate: "1965-08-01",
        description: "Una saga de desierto y politics.",
        pageCount: 412,
        categories: ["Fiction"],
        imageLinks: { thumbnail: "http://books.google.com/books/picture.jpg" },
      },
    });

    const item = expectValidMediaItem(result);
    expect(item.mediaType).toBe("BOOK");
    expect(item.title).toBe("Dune");
    expect(item.creator).toBe("Frank Herbert");
    expect(item.releaseYear).toBe(1965);
    expect(item.coverUrl).toBe("https://books.google.com/books/picture.jpg");
    expect(item.genres).toEqual(["Fiction"]);
    expect(item.metadata).toEqual({ kind: "pages", totalPages: 412 });
  });

  it("REQ-108: juego IGDB crudo → GAME con plataformas y desarrollador", () => {
    const result = normalizeIgdbToMediaItem({
      id: 1025,
      name: "The Witcher 3: Wild Hunt",
      first_release_date: 1430550000,
      summary: "RPG de mundo abierto.",
      cover: { image_id: "co2x2v" },
      platforms: [{ name: "PC" }, { name: "PlayStation 4" }],
      involved_companies: [
        { company: { name: "CD Projekt Red" }, developer: true, publisher: false },
      ],
    });

    const item = expectValidMediaItem(result);
    expect(item.mediaType).toBe("GAME");
    expect(item.title).toBe("The Witcher 3: Wild Hunt");
    expect(item.releaseYear).toBe(2015);
    expect(item.coverUrl).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co2x2v.jpg",
    );
    expect(item.creator).toBe("CD Projekt Red");
    expect(item.metadata).toEqual({
      kind: "platforms",
      platforms: ["PC", "PlayStation 4"],
    });
  });

  it("REQ-108: juego de la biblioteca de Steam → GAME con platforms ['PC']", () => {
    const item = expectValidMediaItem(
      normalizeSteamToMediaItem({ appid: 480, name: "Counter-Strike", playtimeHours: 12 }),
    );
    expect(item.mediaType).toBe("GAME");
    expect(item.title).toBe("Counter-Strike");
    expect(item.metadata).toEqual({
      kind: "platforms",
      platforms: ["PC"],
      totalHours: 12,
    });
  });

  it("REQ-108: normalizeApiToMediaItem detecta el proveedor por la forma", () => {
    expect(
      expectValidMediaItem(
        normalizeApiToMediaItem({ volumeInfo: { title: "Neuromante", authors: ["W. Gibson"] } }),
      ).mediaType,
    ).toBe("BOOK");
    expect(
      expectValidMediaItem(normalizeApiToMediaItem({ appid: 730, name: "CS2" })).mediaType,
    ).toBe("GAME");
    expect(
      expectValidMediaItem(
        normalizeApiToMediaItem({
          id: 1,
          title: "Alien",
          release_date: "1979-05-25",
          poster_path: "/alien.jpg",
        }),
      ).mediaType,
    ).toBe("MOVIE");
    expect(
      expectValidMediaItem(
        normalizeApiToMediaItem({ poster_path: "/x.jpg", title: "Señal", release_date: "2002-09-11" }),
      ).mediaType,
    ).toBe("MOVIE");
  });
});

// -------------------------------------------------------------
// DB-120 — dato inválido → `Result` de validación, nunca throw
// -------------------------------------------------------------
describe("DB-120 validateMediaItem aplicado por los normalizadores", () => {
  it("DB-120: película TMDB sin título → { ok:false, code:'validation' }", () => {
    let result;
    expect(() => {
      result = normalizeTmdbToMediaItem({ id: 1, release_date: "2020-01-01" });
    }).not.toThrow();
    expectBlockingFreeFailure(result, "tmdb");
    expect(result.code).toBe("validation");
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.join(" ")).toMatch(/título/i);
  });

  it("DB-120: volumen de Google Books sin título → Result de validación", () => {
    const result = normalizeBookToMediaItem({ volumeInfo: { pageCount: 100 } });
    expectBlockingFreeFailure(result, "googlebooks");
    expect(result.code).toBe("validation");
    expect(result.errors.join(" ")).toMatch(/título/i);
  });

  it("DB-120: juego IGDB sin nombre → Result de validación", () => {
    const result = normalizeIgdbToMediaItem({ id: 1, first_release_date: 0 });
    expectBlockingFreeFailure(result, "igdb");
    expect(result.code).toBe("validation");
  });

  it("DB-120: juego Steam sin nombre → Result de validación", () => {
    const result = normalizeSteamToMediaItem({ appid: 42 });
    expectBlockingFreeFailure(result, "steam");
    expect(result.code).toBe("validation");
  });

  it("DB-120: entrada no objeto / tipo desconocido → Result de validación", () => {
    expectBlockingFreeFailure(normalizeTmdbToMediaItem(null), "tmdb");
    expectBlockingFreeFailure(normalizeBookToMediaItem("boom"), "googlebooks");
    expectBlockingFreeFailure(normalizeIgdbToMediaItem(undefined), "igdb");
    expectBlockingFreeFailure(normalizeSteamToMediaItem([]), "steam");
    expectBlockingFreeFailure(
      toMediaItemInput({ mediaType: "podcast", title: "X" }, { provider: "tmdb" }),
      "tmdb",
    );
  });

  it("DB-120: toMediaItemType traduce alias a los 7 tipos del modelo", () => {
    expect(toMediaItemType("movie")).toBe("MOVIE");
    expect(toMediaItemType("tv")).toBe("SERIES");
    expect(toMediaItemType("BOOK")).toBe("BOOK");
    expect(toMediaItemType("podcast")).toBeNull();
    expect(toMediaItemType(42)).toBeNull();
  });
});

// -------------------------------------------------------------
// REQ-E4 — el fallo externo nunca bloquea el alta manual
// -------------------------------------------------------------
describe("REQ-E4 fallos de API externa no bloquean el alta manual", () => {
  it("REQ-E4: normalizeApiFailure convierte errores en Result con provider", () => {
    const timeout = normalizeApiFailure(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
      "tmdb",
    );
    expectBlockingFreeFailure(timeout, "tmdb");
    expect(timeout.code).toBe("unavailable");

    const unauthorized = normalizeApiFailure(
      Object.assign(new Error("no autorizado"), { status: 401 }),
      "googlebooks",
    );
    expectBlockingFreeFailure(unauthorized, "googlebooks");
    expect(unauthorized.code).toBe("permission_denied");

    const notFound = normalizeApiFailure(
      Object.assign(new Error("404"), { status: 404 }),
      "igdb",
    );
    expectBlockingFreeFailure(notFound, "igdb");
    expect(notFound.code).toBe("not_found");
  });

  it("REQ-E4: respuesta { ok:false } → Result y el alta manual sigue viva", () => {
    const failure = normalizeApiItems(
      { ok: false, code: "timeout", message: "Sin red", provider: "tmdb" },
      { provider: "tmdb" },
    );
    expectBlockingFreeFailure(failure, "tmdb");
    expect(failure.code).toBe("unavailable");

    // La ruta manual es independiente y sigue funcionando (REQ-105).
    const manual = expectValidMediaItem(
      normalizeManualMediaItem({ mediaType: "movie", title: "Alta manual" }),
    );
    expect(manual.mediaType).toBe("MOVIE");
    expect(manual.metadata).toEqual({ kind: "duration", durationMinutes: 0 });
  });

  it("REQ-E4: respuesta vacía/null → Result de error, nunca throw", () => {
    expectBlockingFreeFailure(normalizeApiItems(null, { provider: "tmdb" }), "tmdb");
    expectBlockingFreeFailure(
      normalizeApiItems(undefined, { provider: "igdb" }),
      "igdb",
    );
    expectBlockingFreeFailure(normalizeApiItems("boom", { provider: "steam" }), "steam");
  });

  it("REQ-E4: ítem inválido dentro de un lote se omite sin romper el resto", () => {
    const response = normalizeApiItems({
      ok: true,
      items: [
        { id: 1, title: "Origen", release_date: "2010-07-16", poster_path: "/o.jpg" },
        { id: 2 }, // sin título → DB-120 lo descarta
        { volumeInfo: { title: "Dune", authors: ["Frank Herbert"] } },
      ],
    });
    expect(response.ok).toBe(true);
    expect(response.value).toHaveLength(2);
    expect(response.total).toBe(3);
    expect(response.skipped).toEqual([
      { index: 1, code: "validation", message: expect.stringContaining("título") },
    ]);
    for (const item of response.value) expectValidMediaItem({ ok: true, value: item });
  });

  it("REQ-E4: un normalizador que lanza se convierte en ítem omitido", () => {
    const response = normalizeApiItems(
      { ok: true, items: ["x", "y"] },
      {
        provider: "tmdb",
        normalize: () => {
          throw new Error("boom");
        },
      },
    );
    expect(response.ok).toBe(true);
    expect(response.value).toEqual([]);
    expect(response.skipped).toHaveLength(2);
    expect(response.skipped[0]).toMatchObject({ index: 0, code: "unknown" });
    expect(response.skipped[1]).toMatchObject({ index: 1, code: "unknown" });
  });

  it("REQ-E4: alta manual inválida → Result de validación (no lanza)", () => {
    expectBlockingFreeFailure(normalizeManualMediaItem(null), "manual");
    expectBlockingFreeFailure(normalizeManualMediaItem({ mediaType: "movie" }), "manual");
  });

  it("REQ-E4: proveedores soportados y códigos de Result (§4.1)", () => {
    expect(API_NORMALIZE_PROVIDERS).toEqual([
      "tmdb",
      "googlebooks",
      "igdb",
      "steam",
    ]);
    expect(API_RESULT_CODES).toEqual([
      "not_found",
      "permission_denied",
      "validation",
      "unavailable",
      "unknown",
    ]);
  });
});
