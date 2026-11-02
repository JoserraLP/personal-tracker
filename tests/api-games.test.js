// Tests T-007 — js/api-games.js con fetch MOCKEADO (sin red).
// Cobertura: AC-013 (autofill de juegos, API-004 vía proxy IGDB),
// AC-014 (sin resultados), AC-015 (fallo de API → contrato §4.1).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { searchIgdbGames, normalizeIgdbGame } from "../js/api-games.js";

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

describe("AC-013 autofill de juego IGDB (API-004, REQ-006)", () => {
  it("AC-013: nombre, año y póster se autorellenan; sinopsis opcional", async () => {
    const release = Date.UTC(2017, 1, 21) / 1000; // 2017-02-21 UTC
    fetchMock.mockResolvedValue(
      jsonRes(200, [
        {
          id: 1025,
          name: "Hollow Knight",
          first_release_date: release,
          cover: { image_id: "co1r76" },
          summary: "Un metroidvania de acción y aventura.",
        },
      ]),
    );

    const res = await searchIgdbGames("hollow knight");
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      source: "igdb",
      externalId: "1025",
      mediaType: "game",
      title: "Hollow Knight",
      year: 2017,
      posterUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r76.jpg",
      synopsis: "Un metroidvania de acción y aventura.",
      genres: [],
      durationMinutes: null,
    });

    // La búsqueda va al proxy con la consulta Apicalypse (API-004).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v4/games");
    expect(options.method).toBe("POST");
    expect(options.body).toContain('search "hollow knight"');
    expect(options.body).toContain("fields name, first_release_date");
    expect(options.body).toContain("limit 10;");
  });

  it("AC-013: sinopsis opcional ausente → null (autofill parcial)", async () => {
    fetchMock.mockResolvedValue(
      jsonRes(200, [{ id: 1, name: "Sin sinopsis", first_release_date: 0 }]),
    );
    const res = await searchIgdbGames("sin sinopsis");
    expect(res.items[0].synopsis).toBeNull();
    expect(res.items[0].year).toBeNull();
    expect(res.items[0].posterUrl).toBeNull();
    expect(res.items[0].durationMinutes).toBeNull();
  });

  it("AC-013: 'story' se usa si no hay 'summary'; sin nombre el resultado se descarta", () => {
    const withStory = normalizeIgdbGame({ id: 2, name: "Con historia", story: "Historia." });
    expect(withStory.synopsis).toBe("Historia.");
    expect(normalizeIgdbGame({ id: 3, name: "x", summary: "" }).synopsis).toBeNull();
  });

  it("AC-013: la consulta con comillas no rompe la sintaxis Apicalypse", async () => {
    fetchMock.mockResolvedValue(jsonRes(200, []));
    await searchIgdbGames('zelda "breath"');
    expect(fetchMock.mock.calls[0][1].body).toContain('search "zelda breath"');
  });
});

describe("AC-014 búsqueda sin resultados (§4.1: {ok:true, items:[]})", () => {
  it("AC-014: cero resultados → {ok:true, items:[]}", async () => {
    fetchMock.mockResolvedValue(jsonRes(200, []));
    const res = await searchIgdbGames("zzzz");
    expect(res).toEqual({ ok: true, items: [] });
  });

  it("AC-014: consulta vacía → {ok:true, items:[]} sin llamar a la API", async () => {
    const res = await searchIgdbGames("   ");
    expect(res).toEqual({ ok: true, items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AC-015 fallo de API → contrato de error §4.1", () => {
  it("AC-015: HTTP 401 → code 'unauthorized'", async () => {
    fetchMock.mockResolvedValue(jsonRes(401, { error: "Invalid credentials" }));
    const res = await searchIgdbGames("x");
    expect(res.ok).toBe(false);
    expect(res.provider).toBe("igdb");
    expect(res.code).toBe("unauthorized");
    expect(CONTRACT_CODES).toContain(res.code);
    expect(typeof res.message).toBe("string");
  });

  it("AC-015: HTTP 429 → code 'rate_limited'", async () => {
    fetchMock.mockResolvedValue(jsonRes(429, {}));
    const res = await searchIgdbGames("x");
    expect(res).toMatchObject({ ok: false, provider: "igdb", code: "rate_limited" });
  });

  it("AC-015: timeout (AbortError) → code 'timeout'", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const res = await searchIgdbGames("x");
    expect(res).toMatchObject({ ok: false, provider: "igdb", code: "timeout" });
  });

  it("AC-015: error de red → code 'unknown'", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await searchIgdbGames("x");
    expect(res).toMatchObject({ ok: false, provider: "igdb", code: "unknown" });
    expect(typeof res.message).toBe("string");
    expect(res.message.length).toBeGreaterThan(0);
  });
});
