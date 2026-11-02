// Tests T-007 — js/api-books.js con fetch MOCKEADO (sin red).
// Cobertura: AC-012 (autofill de libros, API-005), AC-014 (sin resultados),
// AC-015 (fallo de API → contrato de error §4.1).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { searchGoogleBooks, normalizeBook } from "../js/api-books.js";

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

describe("AC-012 autofill de libro Google Books (API-005, REQ-006)", () => {
  it("AC-012: título, autor, año, sinopsis y póster se autorellenan; duración null", async () => {
    fetchMock.mockResolvedValue(
      jsonRes(200, {
        totalItems: 1,
        items: [
          {
            id: "vol-1",
            volumeInfo: {
              title: "Cien años de soledad",
              authors: ["Gabriel García Márquez"],
              publishedDate: "1967-05-30",
              description: "<p>Una historia de la familia Buendía.</p>",
              imageLinks: { thumbnail: "http://books.google.com/cover.jpg" },
              categories: ["Novela"],
              pageCount: 471,
            },
          },
        ],
      }),
    );

    const res = await searchGoogleBooks("cien años");
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      source: "googlebooks",
      externalId: "vol-1",
      mediaType: "book",
      title: "Cien años de soledad",
      author: "Gabriel García Márquez",
      year: 1967,
      posterUrl: "https://books.google.com/cover.jpg",
      synopsis: "Una historia de la familia Buendía.",
      genres: ["Novela"],
      durationMinutes: null,
    });
  });

  it("AC-012: campos ausentes → null (autor, año, póster y sinopsis)", async () => {
    fetchMock.mockResolvedValue(
      jsonRes(200, {
        items: [{ id: "vol-2", volumeInfo: { title: "Sin datos" } }],
      }),
    );
    const res = await searchGoogleBooks("sin datos");
    const item = res.items[0];
    expect(item.author).toBeNull();
    expect(item.year).toBeNull();
    expect(item.posterUrl).toBeNull();
    expect(item.synopsis).toBeNull();
    expect(item.durationMinutes).toBeNull();
    expect(item.genres).toEqual([]);
  });

  it("AC-012: varios autores se unen con coma; durationMinutes sigue siendo null", () => {
    const item = normalizeBook({
      id: "vol-3",
      volumeInfo: {
        title: "Good Omens",
        authors: ["Terry Pratchett", "Neil Gaiman"],
        pageCount: 400,
      },
    });
    expect(item.author).toBe("Terry Pratchett, Neil Gaiman");
    expect(item.durationMinutes).toBeNull();
    expect(item.year).toBeNull();
  });

  it("AC-012: la portada http se pasa a https y se prefiere la imagen más grande", () => {
    const item = normalizeBook({
      id: "vol-4",
      volumeInfo: {
        title: "Con portada",
        imageLinks: { smallThumbnail: "http://x/small.jpg", large: "http://x/large.jpg" },
      },
    });
    expect(item.posterUrl).toBe("https://x/large.jpg");
    expect(normalizeBook({ id: "v", volumeInfo: { title: "S" } }).posterUrl).toBeNull();
  });
});

describe("AC-014 búsqueda sin resultados (§4.1: {ok:true, items:[]})", () => {
  it("AC-014: cero resultados → {ok:true, items:[]}", async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { totalItems: 0 }));
    const res = await searchGoogleBooks("zzzz");
    expect(res).toEqual({ ok: true, items: [] });
  });

  it("AC-014: consulta vacía → {ok:true, items:[]} sin llamar a la API", async () => {
    const res = await searchGoogleBooks("");
    expect(res).toEqual({ ok: true, items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AC-015 fallo de API → contrato de error §4.1", () => {
  it("AC-015: HTTP 401 → code 'unauthorized'", async () => {
    fetchMock.mockResolvedValue(
      jsonRes(401, { error: { message: "API key not valid", status: "UNAUTHORIZED" } }),
    );
    const res = await searchGoogleBooks("x");
    expect(res.ok).toBe(false);
    expect(res.provider).toBe("googlebooks");
    expect(res.code).toBe("unauthorized");
    expect(CONTRACT_CODES).toContain(res.code);
    expect(res.message).toBe("API key not valid");
  });

  it("AC-015: HTTP 429 → code 'rate_limited'", async () => {
    fetchMock.mockResolvedValue(jsonRes(429, {}));
    const res = await searchGoogleBooks("x");
    expect(res).toMatchObject({ ok: false, provider: "googlebooks", code: "rate_limited" });
  });

  it("AC-015: timeout (AbortError) → code 'timeout'", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const res = await searchGoogleBooks("x");
    expect(res).toMatchObject({ ok: false, provider: "googlebooks", code: "timeout" });
  });

  it("AC-015: error de red → code 'unknown'", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await searchGoogleBooks("x");
    expect(res).toMatchObject({ ok: false, provider: "googlebooks", code: "unknown" });
    expect(typeof res.message).toBe("string");
    expect(res.message.length).toBeGreaterThan(0);
  });
});
