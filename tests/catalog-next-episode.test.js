// Tests T-007 — parte pura de js/catalog.js (sin red ni Firebase).
// Cobertura: AC-006 «siguiente episodio» (DB-003 / DB-006).
import { describe, it, expect } from "vitest";
import { nextEpisodeLabel, normalizeItem } from "../js/catalog.js";

describe("AC-006 nextEpisodeLabel (DB-003, algoritmo)", () => {
  it("AC-006: S2E6 → S2E7 (siguiente episodio de la misma temporada)", () => {
    expect(
      nextEpisodeLabel({
        currentSeason: 2,
        currentEpisode: 6,
        totalSeasons: 3,
        totalEpisodes: 10,
      }),
    ).toBe("S2E7");
  });

  it("AC-006: fin de temporada → S3E1 (siguiente temporada)", () => {
    expect(
      nextEpisodeLabel({
        currentSeason: 2,
        currentEpisode: 10,
        totalSeasons: 5,
        totalEpisodes: 10,
      }),
    ).toBe("S3E1");
  });

  it("AC-006: serie completa → 'Finalizado'", () => {
    expect(
      nextEpisodeLabel({
        currentSeason: 5,
        currentEpisode: 10,
        totalSeasons: 5,
        totalEpisodes: 10,
      }),
    ).toBe("Finalizado");
  });

  it("AC-006: totales ausentes → null", () => {
    // Sin ningún total no se puede calcular.
    expect(
      nextEpisodeLabel({ currentSeason: 2, currentEpisode: 6 }),
    ).toBeNull();
    // Sin totalSeasons, agotados los episodios conocidos: no se puede determinar.
    expect(
      nextEpisodeLabel({ currentSeason: 2, currentEpisode: 10, totalEpisodes: 10 }),
    ).toBeNull();
  });

  it("AC-006: sin progreso actual (temporada/episodio) → null", () => {
    expect(nextEpisodeLabel({ totalSeasons: 3, totalEpisodes: 10 })).toBeNull();
    expect(nextEpisodeLabel(null)).toBeNull();
    expect(nextEpisodeLabel(undefined)).toBeNull();
  });
});

describe("AC-006 regresión T-003 (DB-003: totales incompletos → null)", () => {
  it("AC-006: falta totalEpisodes → null (hallazgo QA: S2E6 con totalSeasons pero sin totalEpisodes)", () => {
    expect(
      nextEpisodeLabel({ currentSeason: 2, currentEpisode: 6, totalSeasons: 3 }),
    ).toBeNull();
  });

  it("AC-006: falta totalSeasons → null", () => {
    expect(
      nextEpisodeLabel({
        currentSeason: 2,
        currentEpisode: 6,
        totalEpisodes: 10,
      }),
    ).toBeNull();
  });

  it("AC-006: falta currentEpisode → null", () => {
    expect(
      nextEpisodeLabel({ currentSeason: 2, totalSeasons: 3, totalEpisodes: 10 }),
    ).toBeNull();
    expect(
      nextEpisodeLabel({ currentEpisode: 6, totalSeasons: 3, totalEpisodes: 10 }),
    ).toBeNull();
  });

  it("AC-006: totales completos sin regresión — avance de episodio → S2E7", () => {
    expect(
      nextEpisodeLabel({
        currentSeason: 2,
        currentEpisode: 6,
        totalSeasons: 3,
        totalEpisodes: 10,
      }),
    ).toBe("S2E7");
  });

  it("AC-006: totales completos sin regresión — salto de temporada → S3E1", () => {
    expect(
      nextEpisodeLabel({
        currentSeason: 2,
        currentEpisode: 10,
        totalSeasons: 3,
        totalEpisodes: 10,
      }),
    ).toBe("S3E1");
  });

  it("AC-006: totales completos sin regresión — serie completa → 'Finalizado'", () => {
    expect(
      nextEpisodeLabel({
        currentSeason: 3,
        currentEpisode: 10,
        totalSeasons: 3,
        totalEpisodes: 10,
      }),
    ).toBe("Finalizado");
  });
});

describe("AC-006 nextEpisode en la normalización (series y anime)", () => {
  it("AC-006: normalizeItem de series calcula nextEpisode", () => {
    const item = normalizeItem("series", {
      title: "Dark",
      currentSeason: 1,
      currentEpisode: 3,
      totalSeasons: 3,
      totalEpisodes: 8,
    });
    expect(item.nextEpisode).toBe("S1E4");
  });

  it("AC-006: normalizeItem de anime calcula nextEpisode (DB-006)", () => {
    const item = normalizeItem("anime", {
      title: "One Piece",
      currentSeason: 1,
      currentEpisode: 8,
      totalSeasons: 2,
      totalEpisodes: 8,
    });
    expect(item.nextEpisode).toBe("S2E1");
  });
});
