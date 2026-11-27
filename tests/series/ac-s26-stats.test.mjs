// AC-S26 (ALG-S01): barra de estadísticas con A (watched, 78 vistos, 45 min,
// 12 favoritos, 8,5 / 8,4), B (watching, 10 vistos, runtime null, 7 / 7,6) y
// C (watchlist, sin episodios): Completadas=1, En curso=1, Episodios
// vistos=88, Capítulos favoritos=12, Horas=66,0, Mi nota media=7,8 y
// Nota media TMDB=8,0 (C excluida de las medias).

import assert from "node:assert/strict";
import test from "node:test";

import { computeSeriesStats } from "../../js/series/seriesState.js";

const library = [
  {
    name: "A",
    status: "watched",
    watchedEpisodesCount: 78,
    episodeRuntime: 45,
    favoriteEpisodesCount: 12,
    userRating: 8.5,
    tmdbRating: 8.4,
  },
  {
    name: "B",
    status: "watching",
    watchedEpisodesCount: 10,
    episodeRuntime: null,
    userRating: 7,
    tmdbRating: 7.6,
  },
  {
    name: "C",
    status: "watchlist",
    watchedEpisodesCount: 0,
    userRating: null,
    tmdbRating: null,
  },
];

test("AC-S26 · recuentos: Completadas=1, En curso=1, episodios=88, favoritos=12", () => {
  const stats = computeSeriesStats(library);

  assert.equal(stats.completedCount, 1);
  assert.equal(stats.watchingCount, 1);
  assert.equal(stats.pendingCount, 1); // C está en watchlist
  assert.equal(stats.totalEpisodes, 88); // 78 + 10 + 0
  assert.equal(stats.favoriteEpisodes, 12);
});

test("AC-S26 · Horas=66,0 (88×45/60 con 45 min para runtime desconocido)", () => {
  const stats = computeSeriesStats(library);

  assert.equal(stats.totalHours, "66,0");
});

test("AC-S26 · Mi nota media=7,8 y Nota media TMDB=8,0 (C excluida)", () => {
  const stats = computeSeriesStats(library);

  assert.equal(stats.avgUserRating, "7,8"); // (8,5 + 7) / 2 = 7,75 → 7,8
  assert.equal(stats.avgTmdbRating, "8,0"); // (8,4 + 7,6) / 2 = 8,0
});

test("AC-S26 · biblioteca vacía → todas las cifras son «—»", () => {
  const stats = computeSeriesStats([]);

  for (const value of Object.values(stats)) {
    assert.equal(value, "—");
  }
});

test("AC-S26 · runtime 0 no activa el respaldo de 45 (solo null/undefined)", () => {
  // `episodeRuntime: 0` se respeta: 60 vistos × 0 min = 0,0 horas.
  const zero = computeSeriesStats([
    { status: "watching", watchedEpisodesCount: 60, episodeRuntime: 0 },
  ]);
  assert.equal(zero.totalEpisodes, 60);
  assert.equal(zero.totalHours, "0,0");

  // Contraste: null sí cae al respaldo 45 min → 60×45/60 = 45,0 horas.
  const missing = computeSeriesStats([
    { status: "watching", watchedEpisodesCount: 60, episodeRuntime: null },
  ]);
  assert.equal(missing.totalHours, "45,0");
});
