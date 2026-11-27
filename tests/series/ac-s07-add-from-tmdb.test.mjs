// AC-S07 (DB-S01, DB-S04): alta desde el catálogo inicializa metadatos
// cacheados, `status:"watchlist"`, progreso en (1,1), contadores en 0,
// `isFavorite:false`, `rewatchCount:0`, `collectionIds:[]`, `addedAt` y
// `updatedAt`; volver a añadir la misma serie no crea un segundo doc.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  loadRepository,
  resetStore,
  setUser,
  seedSeries,
  getStoredSeries,
  countSeriesDocs,
  summaryInput,
  baseSeriesDoc,
  isServerTimestamp,
} from "./repository-helpers.mjs";

const repo = await loadRepository();

beforeEach(() => {
  resetStore();
  setUser("test-uid");
});

test("AC-S07 · el alta desde catálogo crea el documento con progreso y timestamps inicializados", async () => {
  const id = await repo.addFromTmdb(summaryInput());

  assert.equal(id, "70523", "el id del doc es String(tmdbId) (DB-S04)");
  assert.equal(countSeriesDocs(), 1);

  const doc = getStoredSeries("70523");

  // Metadatos cacheados
  assert.equal(doc.source, "tmdb");
  assert.equal(doc.tmdbId, 70523);
  assert.equal(doc.name, "Dark");
  assert.equal(doc.originalName, "Dark");
  assert.equal(doc.posterPath, "/darkPoster.jpg");
  assert.equal(doc.firstAirDate, "2017-12-01");
  assert.equal(doc.tmdbRating, 8.4);
  assert.equal(doc.tmdbVoteCount, 12345);
  assert.deepEqual(doc.genreIds, [18, 878]);

  // Estado y progreso inicial (DB-S01)
  assert.equal(doc.status, "watchlist");
  assert.equal(doc.currentSeason, 1);
  assert.equal(doc.currentEpisode, 1);
  assert.equal(doc.watchedEpisodesCount, 0);
  assert.equal(doc.favoriteEpisodesCount, 0);
  assert.equal(doc.isFavorite, false);
  assert.equal(doc.rewatchCount, 0);
  assert.deepEqual(doc.collectionIds, []);

  // Timestamps de alta
  assert.ok(isServerTimestamp(doc.addedAt), "addedAt con serverTimestamp()");
  assert.ok(isServerTimestamp(doc.updatedAt), "updatedAt con serverTimestamp()");
});

test("AC-S07 · re-añadir la misma serie no crea un segundo documento ni pisa lo personal", async () => {
  await repo.addFromTmdb(summaryInput());

  // El usuario ya personalizó la serie.
  seedSeries(
    "70523",
    baseSeriesDoc({
      status: "watching",
      userRating: 9,
      currentSeason: 2,
      currentEpisode: 5,
      watchedEpisodesCount: 4,
      favoriteEpisodesCount: 1,
      collectionIds: ["miniseries"],
    })
  );

  const idAgain = await repo.addFromTmdb(summaryInput());

  assert.equal(idAgain, "70523", "devuelve el id existente");
  assert.equal(countSeriesDocs(), 1, "sin un segundo documento");

  const doc = getStoredSeries("70523");
  assert.equal(doc.status, "watching", "no pisa el estado personal");
  assert.equal(doc.userRating, 9, "no pisa la nota personal");
  assert.equal(doc.currentSeason, 2, "no pisa el progreso");
  assert.equal(doc.currentEpisode, 5);
  assert.equal(doc.watchedEpisodesCount, 4);
  assert.equal(doc.favoriteEpisodesCount, 1);
  assert.deepEqual(doc.collectionIds, ["miniseries"]);
});
