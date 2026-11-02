// Tests T-006 — AC-009 (§4.1, REQ-010): clientes de detalle con fetch MOCKEADO.
// TMDB (movie/tv), IGDB (juegos) y Google Books (libros): normalización a
// ItemMetadata, códigos de error (not_found/rate_limited/unauthorized/timeout)
// y fallo parcial de créditos (partial: true).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchTmdbMovieMetadata,
  fetchTmdbTvMetadata,
} from "../js/api-tmdb.js";
import { fetchIgdbGameMetadata } from "../js/api-games.js";
import { fetchGoogleBookMetadata } from "../js/api-books.js";

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------
// TMDB — película (API-001)
// ---------------------------------------------------------------

const MOVIE_DETAIL = {
  id: 123,
  title: "Origen",
  original_title: "Inception",
  release_date: "2010-07-16",
  poster_path: "/origen.jpg",
  backdrop_path: "/origen_bg.jpg",
  overview: "Un ladrón roba secretos mediante sueños.",
  genres: [
    { id: 28, name: "Acción" },
    { id: 878, name: "Ciencia ficción" },
  ],
  runtime: 148,
  tagline: "Tu mente es la escena del crimen",
  original_language: "en",
};

const MOVIE_CREDITS = {
  cast: [
    { name: "Leonardo DiCaprio" },
    { name: "Elliot Page" },
    { name: "Leonardo DiCaprio" },
  ],
  crew: [
    { name: "Christopher Nolan", job: "Director" },
    { name: "Hans Zimmer", job: "Original Music Composer" },
  ],
};

describe("AC-009 fetchTmdbMovieMetadata: normalización (API-001, §4.1)", () => {
  it("AC-009: cast, director, runtime, backdrop y tagline se normalizan a ItemMetadata", async () => {
    fetchMock.mockResolvedValue(
      jsonRes(200, { ...MOVIE_DETAIL, credits: MOVIE_CREDITS }),
    );

    const res = await fetchTmdbMovieMetadata(123);
    expect(res.ok).toBe(true);
    expect(res.partial).toBeUndefined();
    expect(res.item).toMatchObject({
      title: "Origen",
      year: 2010,
      posterUrl: "https://image.tmdb.org/t/p/w500/origen.jpg",
      backdropUrl: "https://image.tmdb.org/t/p/w780/origen_bg.jpg",
      synopsis: "Un ladrón roba secretos mediante sueños.",
      genres: ["Acción", "Ciencia ficción"],
      durationMinutes: 148,
      director: "Christopher Nolan",
      tagline: "Tu mente es la escena del crimen",
      language: "en",
    });
    // cast: nombres deduplicados y en orden.
    expect(res.item.cast).toEqual(["Leonardo DiCaprio", "Elliot Page"]);
    // Campos de juego/libro → vacíos/null.
    expect(res.item.platforms).toEqual([]);
    expect(res.item.developers).toEqual([]);
    expect(res.item.authors).toEqual([]);
    expect(res.item.pageCount).toBeNull();
    expect(res.item.seasons).toBeNull();
    expect(res.item.episodes).toBeNull();
    expect(res.item.publisher).toBeNull();
  });

  it("AC-009: fallo parcial — detalle ok pero créditos ausentes/fallidos → {ok:true, item, partial:true}", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/movie/123/credits")) return jsonRes(500, {});
      return jsonRes(200, MOVIE_DETAIL); // sin bloque credits
    });

    const res = await fetchTmdbMovieMetadata(123);
    expect(res.ok).toBe(true);
    expect(res.partial).toBe(true);
    expect(res.item.title).toBe("Origen");
    expect(res.item.durationMinutes).toBe(148);
    expect(res.item.director).toBeNull();
    expect(res.item.cast).toEqual([]);
  });

  it("AC-009: 404 → {ok:false, code:'not_found'}", async () => {
    fetchMock.mockResolvedValue(jsonRes(404, {}));
    const res = await fetchTmdbMovieMetadata(999);
    expect(res).toMatchObject({ ok: false, provider: "tmdb", code: "not_found" });
    expect(res.partial).toBeUndefined();
    expect(typeof res.message).toBe("string");
  });

  it("AC-009: 429 → code 'rate_limited'", async () => {
    fetchMock.mockResolvedValue(jsonRes(429, {}));
    const res = await fetchTmdbMovieMetadata(123);
    expect(res).toMatchObject({ ok: false, provider: "tmdb", code: "rate_limited" });
  });

  it("AC-009: 401 → code 'unauthorized'", async () => {
    fetchMock.mockResolvedValue(jsonRes(401, { status_message: "Invalid API key" }));
    const res = await fetchTmdbMovieMetadata(123);
    expect(res).toMatchObject({ ok: false, provider: "tmdb", code: "unauthorized" });
  });
});

// ---------------------------------------------------------------
// TMDB — serie/anime (API-002)
// ---------------------------------------------------------------

const TV_DETAIL = {
  id: 456,
  name: "Dark",
  first_air_date: "2017-12-01",
  poster_path: "/dark.jpg",
  backdrop_path: "/dark_bg.jpg",
  overview: "Cuatro familias, un misterio.",
  genres: [{ id: 10765, name: "Ciencia ficción" }],
  episode_run_time: [45],
  number_of_seasons: 3,
  number_of_episodes: 26,
  created_by: [{ name: "Baran bo Odar" }],
  tagline: "El fin es el principio",
  original_language: "de",
};

const TV_CREDITS = {
  cast: [{ name: "Louis Hofmann" }, { name: "Karoline Eichhorn" }],
  crew: [{ name: "Alguien", job: "Director of Photography" }],
};

describe("AC-009 fetchTmdbTvMetadata: normalización (API-002, §4.1)", () => {
  it("AC-009: creador, episode_run_time, temporadas/episodios, backdrop y tagline se normalizan", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/tv/456/credits")) return jsonRes(200, TV_CREDITS);
      return jsonRes(200, TV_DETAIL);
    });

    const res = await fetchTmdbTvMetadata(456);
    expect(res.ok).toBe(true);
    expect(res.partial).toBeUndefined();
    expect(res.item).toMatchObject({
      title: "Dark",
      year: 2017,
      posterUrl: "https://image.tmdb.org/t/p/w500/dark.jpg",
      backdropUrl: "https://image.tmdb.org/t/p/w780/dark_bg.jpg",
      synopsis: "Cuatro familias, un misterio.",
      genres: ["Ciencia ficción"],
      durationMinutes: 45,
      director: "Baran bo Odar",
      cast: ["Louis Hofmann", "Karoline Eichhorn"],
      seasons: 3,
      episodes: 26,
      tagline: "El fin es el principio",
      language: "de",
    });
  });

  it("AC-009: fallo parcial — detalle ok pero créditos fallidos → {ok:true, item, partial:true}", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/tv/456/credits")) return jsonRes(500, {});
      return jsonRes(200, TV_DETAIL);
    });

    const res = await fetchTmdbTvMetadata(456);
    expect(res.ok).toBe(true);
    expect(res.partial).toBe(true);
    expect(res.item.title).toBe("Dark");
    expect(res.item.seasons).toBe(3);
    expect(res.item.cast).toEqual([]);
  });

  it("AC-009: 404 en el detalle → {ok:false, code:'not_found'} (no parcial)", async () => {
    fetchMock.mockResolvedValue(jsonRes(404, {}));
    const res = await fetchTmdbTvMetadata(999);
    expect(res).toMatchObject({ ok: false, provider: "tmdb", code: "not_found" });
    expect(res.partial).toBeUndefined();
  });

  it("AC-009: 403 → code 'unauthorized'", async () => {
    fetchMock.mockResolvedValue(jsonRes(403, {}));
    const res = await fetchTmdbTvMetadata(456);
    expect(res).toMatchObject({ ok: false, provider: "tmdb", code: "unauthorized" });
  });

  it("AC-009: timeout (AbortError) → code 'timeout'", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    );
    const res = await fetchTmdbTvMetadata(456);
    expect(res).toMatchObject({ ok: false, provider: "tmdb", code: "timeout" });
    expect(typeof res.message).toBe("string");
  });
});

// ---------------------------------------------------------------
// IGDB — juegos (API-003)
// ---------------------------------------------------------------

const IGDB_GAME = {
  id: 1025,
  name: "Hades",
  summary: "Un roguelike de acción con dioses griegos.",
  first_release_date: 1602115200,
  cover: { image_id: "co1r76" },
  platforms: [{ name: "PC" }, { name: "Nintendo Switch" }],
  involved_companies: [
    { developer: true, publisher: false, company: { name: "Supergiant Games" } },
    { developer: false, publisher: true, company: { name: "Supergiant Games" } },
  ],
};

describe("AC-009 fetchIgdbGameMetadata: ids y normalización (API-003, §4.1)", () => {
  it("AC-009: id numérico funciona (regresión fix r1) y normaliza platforms/developers/synopsis/cover/year", async () => {
    fetchMock.mockResolvedValue(jsonRes(200, [IGDB_GAME]));

    const res = await fetchIgdbGameMetadata(1025);
    expect(res.ok).toBe(true);
    expect(res.item).toMatchObject({
      title: "Hades",
      year: 2020,
      posterUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r76.jpg",
      synopsis: "Un roguelike de acción con dioses griegos.",
      platforms: ["PC", "Nintendo Switch"],
      developers: ["Supergiant Games"],
      publisher: "Supergiant Games",
    });
    expect(res.item.cast).toEqual([]);
    expect(res.item.pageCount).toBeNull();
  });

  it("AC-009: id string numérico también funciona (regresión fix r1)", async () => {
    fetchMock.mockResolvedValue(jsonRes(200, [IGDB_GAME]));

    const res = await fetchIgdbGameMetadata(" 1025 ");
    expect(res.ok).toBe(true);
    expect(res.item.title).toBe("Hades");
    // La consulta Apicalypse filtra por el id numérico.
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).toContain("where id = 1025");
  });

  it("AC-009: id vacío o no numérico → code 'not_found' sin llamar a la API", async () => {
    for (const badId of ["", "   ", "abc", null, undefined, 0, -5]) {
      const res = await fetchIgdbGameMetadata(badId);
      expect(res).toMatchObject({ ok: false, provider: "igdb", code: "not_found" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AC-009: id válido sin resultados → code 'not_found'", async () => {
    fetchMock.mockResolvedValue(jsonRes(200, []));
    const res = await fetchIgdbGameMetadata(1025);
    expect(res).toMatchObject({ ok: false, provider: "igdb", code: "not_found" });
  });
});

// ---------------------------------------------------------------
// Google Books — libros (API-004)
// ---------------------------------------------------------------

const BOOK_VOLUME = {
  id: "abc123",
  volumeInfo: {
    title: "El nombre del viento",
    authors: ["Patrick Rothfuss", "Elodin"],
    publisher: "Plaza & Janés",
    publishedDate: "2009-06-18",
    pageCount: 656,
    language: "es",
    categories: ["Ficción", "Fantasía"],
    description: "<p>Kvothe relata su historia.</p>",
    imageLinks: { thumbnail: "http://books.google.com/portada.jpg" },
  },
};

describe("AC-009 fetchGoogleBookMetadata: normalización y errores (API-004, §4.1)", () => {
  it("AC-009: authors, publisher, pageCount, language y categories se normalizan", async () => {
    fetchMock.mockResolvedValue(jsonRes(200, BOOK_VOLUME));

    const res = await fetchGoogleBookMetadata("abc123");
    expect(res.ok).toBe(true);
    expect(res.item).toMatchObject({
      title: "El nombre del viento",
      year: 2009,
      authors: ["Patrick Rothfuss", "Elodin"],
      publisher: "Plaza & Janés",
      pageCount: 656,
      language: "es",
      genres: ["Ficción", "Fantasía"],
      synopsis: "Kvothe relata su historia.",
    });
    // Portada http → https.
    expect(res.item.posterUrl).toBe("https://books.google.com/portada.jpg");
    // Campos de juego/película → vacíos/null.
    expect(res.item.cast).toEqual([]);
    expect(res.item.platforms).toEqual([]);
    expect(res.item.developers).toEqual([]);
    expect(res.item.director).toBeNull();
    expect(res.item.seasons).toBeNull();
  });

  it("AC-009: 404 → code 'not_found'", async () => {
    fetchMock.mockResolvedValue(jsonRes(404, { error: { message: "Volume not found" } }));
    const res = await fetchGoogleBookMetadata("zzz");
    expect(res).toMatchObject({ ok: false, provider: "googlebooks", code: "not_found" });
    expect(typeof res.message).toBe("string");
  });

  it("AC-009: id vacío → code 'not_found' sin llamar a la API", async () => {
    const res = await fetchGoogleBookMetadata("");
    expect(res).toMatchObject({ ok: false, provider: "googlebooks", code: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AC-009: 429 → code 'rate_limited'", async () => {
    fetchMock.mockResolvedValue(jsonRes(429, {}));
    const res = await fetchGoogleBookMetadata("abc123");
    expect(res).toMatchObject({ ok: false, provider: "googlebooks", code: "rate_limited" });
  });
});
