// Tests de aceptación de js/services/recommendation-service.js
// (spec 05 REQ-401..REQ-408 / ALG-01..ALG-08, AC-140..AC-155;
// SEC-01, API-05). Motor puro sin red: repositorios falsos inyectados.

import { describe, expect, it } from "vitest";
import { normalizeTitle } from "../js/catalog.js";
import {
  AFFINITY_THRESHOLD,
  CREATOR_AFFINITY_WEIGHT,
  FALLBACK_REASON,
  GENRE_AFFINITY_WEIGHT,
  RECOMMENDATION_LIMIT,
  WEAK_AFFINITY_FACTOR,
  affinityWeightsFor,
  buildAffinity,
  createRecommendationService,
  recommend,
} from "../js/services/recommendation-service.js";

/** `scoreMatch` siempre entero dentro de 0..100 (AC-154). */
function expectValidScores(results) {
  for (const result of results) {
    expect(Number.isInteger(result.scoreMatch)).toBe(true);
    expect(result.scoreMatch).toBeGreaterThanOrEqual(0);
    expect(result.scoreMatch).toBeLessThanOrEqual(100);
  }
}

const ids = (results) => results.map((result) => result.item.id);

describe("AC-140 afinidad por género compartido", () => {
  it("AC-140: 'Y' puntúa con scoreMatch > 0 y reason 'Porque te gustó X'", () => {
    const entries = [{ mediaId: "x", score: 9 }];
    const catalog = [
      { id: "x", title: "X", genres: ["Sci-Fi", "Drama"] },
      { id: "y", title: "Y", genres: ["Sci-Fi", "Thriller"] },
    ];
    const results = recommend(entries, catalog);
    const y = results.find((result) => result.item.id === "y");
    expect(y).toBeDefined();
    expect(y.scoreMatch).toBeGreaterThan(0);
    expect(y.reason).toBe("Porque te gustó X");
    expect(y.reasonSourceId).toBe("x");
    expectValidScores(results);
  });
});

describe("AC-141 afinidad por creator", () => {
  it("AC-141: mismo creator con géneros distintos aporta 3 y la razón cita 'X'", () => {
    const entries = [{ mediaId: "x", score: 9 }];
    const catalog = [
      { id: "x", title: "X", genres: ["Sci-Fi"], creator: "A. Director" },
      { id: "y", title: "Y", genres: ["Horror"], creator: "A. Director" },
    ];
    const results = recommend(entries, catalog);
    const y = results.find((result) => result.item.id === "y");
    expect(y).toBeDefined();
    expect(y.scoreMatch).toBeGreaterThan(0);
    expect(y.reason).toBe("Porque te gustó X");
    // Aporte 3 del creator (REQ-403) por encima del género no coincidente.
    expect(y.scoreMatch).toBe(60);
  });
});

describe("AC-142 umbral de afinidad", () => {
  it("AC-142: entry con score 7 (umbral 8) no genera afinidad", () => {
    expect(affinityWeightsFor({ mediaId: "x", score: AFFINITY_THRESHOLD - 1 })).toBe(null);
    expect(affinityWeightsFor({ mediaId: "x", score: AFFINITY_THRESHOLD })).toEqual({
      genre: GENRE_AFFINITY_WEIGHT,
      creator: CREATOR_AFFINITY_WEIGHT,
    });

    const entries = [
      { mediaId: "x", score: 7, genres: ["Sci-Fi"], creator: "A. Director" },
      { mediaId: "w", score: 9, genres: ["Action"], creator: "B. Director" },
    ];
    const catalog = [
      { id: "x", title: "X", genres: ["Sci-Fi"], creator: "A. Director" },
      { id: "y", title: "Y", genres: ["Sci-Fi"], creator: "A. Director" },
      { id: "w", title: "W", genres: ["Action"], creator: "B. Director" },
      { id: "z", title: "Z", genres: ["Action"], creator: "B. Director" },
    ];
    const results = recommend(entries, catalog);
    // Ni el género ni el creator de "X" suman: "Y" queda excluido.
    expect(ids(results)).toEqual(["z"]);
    expect(results.every((result) => !result.reason.includes("X"))).toBe(true);
  });
});

describe("AC-143 afinidad débil COMPLETED sin score", () => {
  it("AC-143: genera afinidad con peso 0.5 (genres +1, creator +1.5)", () => {
    const entry = { mediaId: "x", status: "COMPLETED" };
    expect(affinityWeightsFor(entry)).toEqual({
      genre: GENRE_AFFINITY_WEIGHT * WEAK_AFFINITY_FACTOR,
      creator: CREATOR_AFFINITY_WEIGHT * WEAK_AFFINITY_FACTOR,
    });

    const catalog = [
      { id: "x", title: "X", genres: ["Sci-Fi"], creator: "A. Director" },
      { id: "y", title: "Y", genres: ["Sci-Fi"], creator: "A. Director" },
    ];
    const model = buildAffinity([entry], catalog);
    expect(model.genreAffinity.get(normalizeTitle("Sci-Fi"))).toBe(1);
    expect(model.creatorAffinity.get(normalizeTitle("A. Director"))).toBe(1.5);

    const results = recommend([entry], catalog);
    expect(ids(results)).toEqual(["y"]);
    expect(results[0].scoreMatch).toBe(100);
    expect(results[0].reason).toBe("Porque te gustó X");
  });
});

describe("AC-144 exclusión de ítems con entry propia", () => {
  it("AC-144: candidato 'Z' con entry propia (PLANNED) no aparece", () => {
    const entries = [
      { mediaId: "x", score: 9 },
      { mediaId: "z", status: "PLANNED" },
    ];
    const catalog = [
      { id: "x", title: "X", genres: ["Sci-Fi"] },
      { id: "y", title: "Y", genres: ["Sci-Fi"] },
      { id: "z", title: "Z", genres: ["Sci-Fi"] },
    ];
    const results = recommend(entries, catalog);
    expect(ids(results)).toEqual(["y"]);
    expect(ids(results)).not.toContain("z");
  });
});

describe("AC-145 orden determinista ante empate", () => {
  it("AC-145: empate en match ⇒ titleNormalized asc y repetición idéntica", () => {
    const entries = [{ mediaId: "x", score: 9 }];
    const catalog = [
      { id: "x", title: "X", genres: ["Sci-Fi"] },
      { id: "2", title: "Zebra", genres: ["Sci-Fi"] },
      { id: "1", title: "Ácido", genres: ["Sci-Fi"] },
    ];
    const first = recommend(entries, catalog);
    const second = recommend(entries, catalog);
    expect(ids(first)).toEqual(["1", "2"]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("AC-146 alfabeto normalizado en empates", () => {
  it("AC-146: 'A' antes que 'B' cuando empatan en match", () => {
    const entries = [{ mediaId: "x", score: 9 }];
    const catalog = [
      { id: "x", title: "X", genres: ["Sci-Fi"] },
      { id: "b", title: "B", genres: ["Sci-Fi"] },
      { id: "a", title: "A", genres: ["Sci-Fi"] },
    ];
    expect(ids(recommend(entries, catalog))).toEqual(["a", "b"]);
  });
});

describe("AC-147 reason con título original", () => {
  it("AC-147: reason contiene literalmente 'Porque te gustó X' (título original)", () => {
    const originalTitle = "El Ñandú Bravo";
    const entries = [{ mediaId: "x", score: 10 }];
    const catalog = [
      { id: "x", title: originalTitle, genres: ["Sci-Fi"] },
      { id: "y", title: "Otra Cosa", genres: ["Sci-Fi"] },
    ];
    const results = recommend(entries, catalog);
    const y = results.find((result) => result.item.id === "y");
    expect(y.reason).toBe(`Porque te gustó ${originalTitle}`);
    expect(y.reason).toContain(originalTitle);
    expect(y.reason).not.toContain("nandu");
    expect(y.reason).not.toContain("el nandu bravo");
  });
});

describe("AC-148 fallback por avgRating", () => {
  it("AC-148: sin entries ni afinidad ⇒ top por avgRating con razón de fallback", () => {
    const catalog = [
      { id: "c", title: "Tercero", avgRating: 7.2 },
      { id: "a", title: "Primero", avgRating: 9.4 },
      { id: "b", title: "Segundo", avgRating: 8.5 },
    ];
    const results = recommend([], catalog);
    expect(ids(results)).toEqual(["a", "b", "c"]);
    expect(results.every((result) => result.reason === FALLBACK_REASON)).toBe(true);
    expect(results.every((result) => result.reasonSourceId === null)).toBe(true);
    expectValidScores(results);
  });
});

describe("AC-149 estado vacío no es error", () => {
  it("AC-149: recommend([], []) ⇒ []", () => {
    expect(recommend([], [])).toEqual([]);
  });

  it("AC-149: getRecommendations ⇒ { ok:true, value: [] }", async () => {
    const service = createRecommendationService({
      trackingRepository: { listEntries: async () => ({ ok: true, value: [] }) },
      catalogRepository: { listSeeded: async () => ({ ok: true, value: [] }) },
    });
    const result = await service.getRecommendations("user-1");
    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe("AC-150 límite 20", () => {
  it("AC-150: 50 candidatos elegibles con limit 20 ⇒ length = 20", () => {
    const entries = [{ mediaId: "seed", score: 9 }];
    const catalog = [{ id: "seed", title: "Seed", genres: ["Sci-Fi"] }];
    for (let index = 0; index < 50; index += 1) {
      catalog.push({
        id: `c${String(index).padStart(2, "0")}`,
        title: `Título ${String(index).padStart(2, "0")}`,
        genres: ["Sci-Fi"],
      });
    }
    const results = recommend({ entries, catalog, limit: 20 });
    expect(results).toHaveLength(RECOMMENDATION_LIMIT);
    expect(results).toHaveLength(20);
    // El límite además está acotado a 20 por defecto (REQ-407).
    expect(recommend({ entries, catalog, limit: 999 })).toHaveLength(20);
    expect(recommend(entries, catalog)).toHaveLength(20);
  });
});

describe("AC-151 determinismo byte a byte", () => {
  it("AC-151: misma fixture ⇒ resultados idénticos byte a byte", () => {
    const entries = [
      { mediaId: "x", score: 10 },
      { mediaId: "w", status: "COMPLETED" },
    ];
    const catalog = [
      { id: "x", title: "X", genres: ["Sci-Fi", "Drama"], creator: "A. Director" },
      { id: "w", title: "W", genres: ["Action"], creator: "B. Director" },
      { id: "a", title: "Alfa", genres: ["Sci-Fi"], creator: "A. Director", avgRating: 8 },
      { id: "b", title: "Beta", genres: ["Action", "Drama"], avgRating: 9 },
      { id: "c", title: "Gama", genres: ["Horror"], creator: "B. Director", avgRating: 7 },
    ];
    const first = recommend(entries, catalog);
    const second = recommend(entries, catalog);
    expect(first.length).toBeGreaterThan(0);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("AC-152 fallback con afinidad presente", () => {
  it("AC-152: cero candidatos con match > 0 ⇒ fallback a avgRating sin 'Porque te gustó'", () => {
    const entries = [{ mediaId: "x", score: 9, genres: ["Sci-Fi"], creator: "A. Director" }];
    const catalog = [
      { id: "x", title: "X", genres: ["Sci-Fi"], creator: "A. Director" },
      { id: "y", title: "Y", genres: ["Horror"], creator: "C. Otro", avgRating: 8.5 },
      { id: "z", title: "Z", genres: ["Comedy"], creator: "D. Otro", avgRating: 9.1 },
    ];
    const results = recommend(entries, catalog);
    expect(ids(results)).toEqual(["z", "y"]);
    expect(results.every((result) => result.reason === FALLBACK_REASON)).toBe(true);
    expect(results.every((result) => !result.reason.includes("Porque te gustó"))).toBe(true);
    expect(results.every((result) => result.reasonSourceId === null)).toBe(true);
    expectValidScores(results);
  });
});

describe("AC-153 coste de lecturas", () => {
  it("AC-153: 30 entries + 500 candidatos ⇒ reads ≤ 2 (sin N+1)", async () => {
    const reads = { entries: 0, candidates: 0 };
    const entries = [];
    for (let index = 0; index < 30; index += 1) {
      entries.push({
        mediaId: `e${index}`,
        score: index % 2 === 0 ? 9 : 7,
        genres: ["Sci-Fi"],
        creator: "A. Director",
      });
    }
    const catalog = entries.map((entry) => ({
      id: entry.mediaId,
      title: `Entry ${entry.mediaId}`,
      genres: entry.genres,
      creator: entry.creator,
    }));
    for (let index = 0; index < 500; index += 1) {
      catalog.push({
        id: `c${index}`,
        title: `Candidato ${index}`,
        genres: index % 3 === 0 ? ["Sci-Fi"] : ["Drama"],
        creator: index % 5 === 0 ? "A. Director" : "B. Otro",
        avgRating: 6 + ((index % 40) / 10),
      });
    }

    const trackingRepository = {
      async listEntries() {
        reads.entries += 1;
        return { ok: true, value: { items: entries } };
      },
    };
    const catalogRepository = {
      async listSeeded() {
        reads.candidates += 1;
        return { ok: true, value: { items: catalog } };
      },
    };
    const service = createRecommendationService({ trackingRepository, catalogRepository });

    const result = await service.getRecommendations("user-1");
    expect(result.ok).toBe(true);
    expect(result.value.length).toBeLessThanOrEqual(RECOMMENDATION_LIMIT);
    expect(reads.entries).toBe(1);
    expect(reads.candidates).toBe(1);
    expect(reads.entries + reads.candidates).toBeLessThanOrEqual(2);
  });
});

describe("AC-154 scoreMatch entero 0-100", () => {
  it("AC-154: match = maxPossible ⇒ 100; nunca <0 ni >100; siempre entero", () => {
    const entries = [{ mediaId: "x", score: 10 }];
    const catalog = [
      { id: "x", title: "X", genres: ["Sci-Fi"], creator: "A. Director" },
      // Coincide en las dos señales ⇒ match = maxPossible ⇒ 100.
      { id: "full", title: "Full", genres: ["Sci-Fi"], creator: "A. Director" },
      // Match mínimo (solo un género) ⇒ scoreMatch pequeño pero ≥ 0.
      {
        id: "small",
        title: "Small",
        genres: ["Sci-Fi", "Drama", "Thriller", "Horror", "Action"],
      },
    ];
    const results = recommend(entries, catalog);
    const full = results.find((result) => result.item.id === "full");
    const small = results.find((result) => result.item.id === "small");
    expect(full.scoreMatch).toBe(100);
    expect(small.scoreMatch).toBeGreaterThanOrEqual(0);
    expectValidScores(results);
  });

  it("AC-154: el fallback también devuelve enteros 0..100", () => {
    const catalog = [
      { id: "a", title: "A", avgRating: 9.9 },
      { id: "b", title: "B", avgRating: 45 },
      { id: "c", title: "C" },
      { id: "d", title: "D", avgRating: -3 },
    ];
    const results = recommend([], catalog);
    expectValidScores(results);
    expect(results.find((result) => result.item.id === "a").scoreMatch).toBe(99);
    expect(results.find((result) => result.item.id === "b").scoreMatch).toBe(100);
    expect(results.find((result) => result.item.id === "c").scoreMatch).toBe(0);
    expect(results.find((result) => result.item.id === "d").scoreMatch).toBe(0);
  });
});

describe("AC-155 errores en español", () => {
  it("AC-155: sin sesión ⇒ permission_denied con mensaje en español", async () => {
    const service = createRecommendationService({
      trackingRepository: { listEntries: async () => ({ ok: true, value: [] }) },
      catalogRepository: { listSeeded: async () => ({ ok: true, value: [] }) },
    });
    for (const uid of [undefined, null, "", "   "]) {
      const result = await service.getRecommendations(uid);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("permission_denied");
      expect(result.message).toMatch(/sesión|permiso/i);
    }
  });

  it("AC-155: permission_denied del repositorio (SEC-01) se propaga en español", async () => {
    const repositoryMessage =
      "No tienes permiso para acceder a estos datos (SEC-01).";
    const service = createRecommendationService({
      trackingRepository: {
        async listEntries() {
          return { ok: false, code: "permission-denied", message: repositoryMessage };
        },
      },
      catalogRepository: { listSeeded: async () => ({ ok: true, value: [] }) },
    });
    const result = await service.getRecommendations("user-1");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("permission_denied");
    expect(result.message).toBe(repositoryMessage);
    expect(result.message).toMatch(/[áéíóúñ¿¡]|permiso/i);
  });
});
