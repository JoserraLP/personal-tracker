// Tests T-007 — js/api-tmdb.js con fetch MOCKEADO (sin red).
// Cobertura: AC-003 (película), AC-011 (TV/anime), AC-014 (sin resultados),
// AC-015 (fallo de API → contrato de error §4.1).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  searchTmdbMovies,
  searchTmdbTv,
  searchTmdbAnime,
  normalizeTmdbMovie,
  normalizeTmdbTv,
  fetchTmdbTvDetail,
} from "../js/api-tmdb.js";

const CONTRACT_CODES = ["timeout", "unauthorized", "rate_limited", "not_found", "unknown"];

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

describe("AC-003 autofill de película TMDB (API-001/003, REQ-006)", () => {
  it("AC-003: póster, sinopsis, año, géneros y durationMinutes se autorellenan", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/search/movie")) {
        expect(u).toContain("api.themoviedb.org/3/search/movie");
        return jsonRes(200, {
          results: [
            {
              id: 123,
              title: "Origen",
              release_date: "2010-07-16",
              poster_path: "/origen.jpg",
              overview: "Un ladrón roba secretos mediante sueños.",
            },
          ],
        });
      }
      if (u.includes("/movie/123")) {
        return jsonRes(200, {
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
        });
      }
      return jsonRes(404, {});
    });

    const res = await searchTmdbMovies("origen");
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      source: "tmdb",
      externalId: "123",
      mediaType: "movie",
      title: "Origen",
      year: 2010,
      posterUrl: "https://image.tmdb.org/t/p/w500/origen.jpg",
      synopsis: "Un ladrón roba secretos mediante sueños.",
      genres: ["Acción", "Ciencia ficción"],
      durationMinutes: 148,
    });
  });

  it("AC-003: campos ausentes → null (nunca undefined)", async () => {
    fetchMock.mockResolvedValue(
      jsonRes(200, { results: [{ id: 999, title: "Sin datos" }] }),
    );
    const res = await searchTmdbMovies("sin datos", { withDetails: false });
    expect(res.ok).toBe(true);
    const item = res.items[0];
    expect(item.year).toBeNull();
    expect(item.posterUrl).toBeNull();
    expect(item.synopsis).toBeNull();
    expect(item.durationMinutes).toBeNull();
    expect(item.genres).toEqual([]);
    expect(item.title).toBe("Sin datos");
  });

  it("AC-003: la sinopsis larga se recorta al límite de DB-001 (≤2000)", () => {
    const item = normalizeTmdbMovie({ id: 1, title: "Larga", overview: "x".repeat(3000) });
    expect(item.synopsis.length).toBeLessThanOrEqual(2000);
    expect(item.synopsis.endsWith("…")).toBe(true);
  });
});

describe("AC-011 autofill de serie/anime TMDB (API-002/003, D-005)", () => {
  it("AC-011: duración desde episode_run_time y campos autorellenados", async () => {
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/search/tv")) {
        return jsonRes(200, {
          results: [
            {
              id: 456,
              name: "Dark",
              first_air_date: "2017-12-01",
              poster_path: "/dark.jpg",
              overview: "Cuatro familias, un misterio.",
            },
          ],
        });
      }
      if (u.includes("/tv/456")) {
        return jsonRes(200, {
          id: 456,
          name: "Dark",
          first_air_date: "2017-12-01",
          poster_path: "/dark.jpg",
          overview: "Cuatro familias, un misterio.",
          episode_run_time: [60],
          genres: [{ id: 10765, name: "Ciencia ficción" }],
          origin_country: ["DE"],
          original_language: "de",
        });
      }
      return jsonRes(404, {});
    });

    const res = await searchTmdbTv("dark");
    expect(res.ok).toBe(true);
    expect(res.items[0]).toMatchObject({
      mediaType: "series",
      title: "Dark",
      year: 2017,
      durationMinutes: 60,
      genres: ["Ciencia ficción"],
      posterUrl: "https://image.tmdb.org/t/p/w500/dark.jpg",
    });
  });

  it("AC-011: sin episode_run_time ni runtime → durationMinutes null", async () => {
    fetchMock.mockResolvedValue(
      jsonRes(200, {
        results: [{ id: 7, name: "Sin duración", first_air_date: "2020-01-01" }],
      }),
    );
    const res = await searchTmdbTv("sin duracion", { withDetails: false });
    expect(res.items[0].durationMinutes).toBeNull();
  });

  it("AC-011: mediaType 'anime' por género animación u origen japonés (D-005)", () => {
    expect(
      normalizeTmdbTv({ id: 1, name: "One Piece", genre_ids: [16, 12] }).mediaType,
    ).toBe("anime");
    expect(
      normalizeTmdbTv({ id: 2, name: "Serie JP", origin_country: ["JP"] }).mediaType,
    ).toBe("anime");
    expect(
      normalizeTmdbTv({ id: 3, name: "Idioma ja", original_language: "ja" }).mediaType,
    ).toBe("anime");
    expect(normalizeTmdbTv({ id: 4, name: "Dark", genres: [{ id: 18 }] }).mediaType).toBe(
      "series",
    );
  });

  it("AC-011: searchTmdbAnime usa /search/tv + with_genres=16 y marca mediaType 'anime'", async () => {
    fetchMock.mockResolvedValue(
      jsonRes(200, { results: [{ id: 89, name: "Cowboy Bebop", first_air_date: "1998-04-03" }] }),
    );
    const res = await searchTmdbAnime("bebop", { withDetails: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/search/tv");
    expect(url).toContain("with_genres=16");
    expect(res.items[0].mediaType).toBe("anime");
    expect(res.items[0].title).toBe("Cowboy Bebop");
    expect(res.items[0].year).toBe(1998);
  });

  it("AC-011: fetchTmdbTvDetail devuelve el detalle normalizado (API-003)", async () => {
    fetchMock.mockResolvedValue(
      jsonRes(200, {
        id: 456,
        name: "Dark",
        first_air_date: "2017-12-01",
        episode_run_time: [45],
      }),
    );
    const res = await fetchTmdbTvDetail(456);
    expect(res.ok).toBe(true);
    expect(res.item.durationMinutes).toBe(45);
    expect(res.item.mediaType).toBe("series");
  });
});

describe("AC-014 búsqueda sin resultados (§4.1: {ok:true, items:[]})", () => {
  it("AC-014: cero resultados → {ok:true, items:[]}", async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { results: [], total_results: 0 }));
    const res = await searchTmdbMovies("zzzz");
    expect(res).toEqual({ ok: true, items: [] });
  });

  it("AC-014: consulta vacía → {ok:true, items:[]} sin llamar a la API", async () => {
    const res = await searchTmdbMovies("   ");
    expect(res).toEqual({ ok: true, items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AC-015 fallo de API → contrato de error §4.1", () => {
  it("AC-015: HTTP 401 → code 'unauthorized'", async () => {
    fetchMock.mockResolvedValue(jsonRes(401, { status_message: "Invalid API key" }));
    const res = await searchTmdbMovies("x");
    expect(res.ok).toBe(false);
    expect(res.provider).toBe("tmdb");
    expect(res.code).toBe("unauthorized");
    expect(CONTRACT_CODES).toContain(res.code);
    expect(typeof res.message).toBe("string");
    expect(res.message.length).toBeGreaterThan(0);
  });

  it("AC-015: HTTP 429 → code 'rate_limited'", async () => {
    fetchMock.mockResolvedValue(jsonRes(429, {}));
    const res = await searchTmdbTv("x");
    expect(res).toMatchObject({ ok: false, provider: "tmdb", code: "rate_limited" });
  });

  it("AC-015: timeout (AbortError) → code 'timeout'", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    );
    const res = await searchTmdbMovies("x");
    expect(res).toMatchObject({ ok: false, provider: "tmdb", code: "timeout" });
  });

  it("AC-015: HTTP 404 → code 'not_found'", async () => {
    fetchMock.mockResolvedValue(jsonRes(404, {}));
    const res = await searchTmdbMovies("x");
    expect(res).toMatchObject({ ok: false, provider: "tmdb", code: "not_found" });
  });

  it("AC-015: error de red → code 'unknown'", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await searchTmdbAnime("x");
    expect(res).toMatchObject({ ok: false, provider: "tmdb", code: "unknown" });
    expect(typeof res.message).toBe("string");
  });
});
