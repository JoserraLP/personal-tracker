// AC-S19 (DB-S02, DB-S04, UI-S02): marcar la estrella de un episodio
// crea/actualiza `episodes/S01E02` con `isFavorite:true`, sube
// `favoriteEpisodesCount` a 1 en el mismo lote y la stat «Capítulos
// favoritos» lo refleja tras recargar la biblioteca.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { computeSeriesStats } from "../../js/series/seriesState.js";
import {
  loadRepository,
  resetStore,
  setUser,
  seedSeries,
  seedEpisode,
  getStoredSeries,
  getStoredEpisode,
  baseSeriesDoc,
  baseEpisodeDoc,
  batches,
} from "./repository-helpers.mjs";

const repo = await loadRepository();

beforeEach(() => {
  resetStore();
  setUser("test-uid");
});

test("AC-S19 · la estrella crea el episodio, sube el contador del padre y la stat lo refleja", async () => {
  seedSeries(
    "70523",
    baseSeriesDoc({ favoriteEpisodesCount: 0, status: "watchlist" })
  );

  await repo.setEpisodeFavorite("70523", 1, 2, true);

  const episode = getStoredEpisode("70523", "S01E02");
  assert.equal(episode.isFavorite, true, "isFavorite:true en el doc");
  assert.equal(episode.seasonNumber, 1);
  assert.equal(episode.episodeNumber, 2);
  assert.equal(episode.watched, false, "el favorito no marca el episodio");

  const parent = getStoredSeries("70523");
  assert.equal(
    parent.favoriteEpisodesCount,
    1,
    "el contador del padre pasa a 1"
  );

  // Episodio y padre en un único writeBatch (DB-S04)
  assert.equal(batches.length, 1, "un solo writeBatch");
  assert.ok(
    batches[0].sets.some((path) => path.endsWith("/episodes/S01E02")),
    "el episodio viaja en el lote"
  );
  assert.ok(
    batches[0].updates.some((path) => path.endsWith("/series/70523")),
    "el padre viaja en el mismo lote"
  );

  // Recarga de la biblioteca: la stat «Capítulos favoritos» lo refleja.
  const library = await repo.listSeries();
  const stats = computeSeriesStats(library);
  assert.equal(stats.favoriteEpisodes, 1, "Capítulos favoritos = 1");
});

test("AC-S19 · el contador se recalcula: alternar y desmarcar dejan la coherencia", async () => {
  seedSeries("70523", baseSeriesDoc({ favoriteEpisodesCount: 0 }));
  seedEpisode(
    "70523",
    "S01E02",
    baseEpisodeDoc(1, 2, { watched: true, watchedAt: null })
  );

  await repo.setEpisodeFavorite("70523", 1, 2, true);
  await repo.setEpisodeFavorite("70523", 1, 3, true);
  assert.equal(getStoredSeries("70523").favoriteEpisodesCount, 2);

  await repo.setEpisodeFavorite("70523", 1, 2, false);
  const parent = getStoredSeries("70523");
  assert.equal(parent.favoriteEpisodesCount, 1, "recalculado, no −1 a ciegas");
  assert.equal(getStoredEpisode("70523", "S01E02").isFavorite, false);
  assert.equal(
    getStoredEpisode("70523", "S01E02").watched,
    true,
    "desmarcar el favorito no toca el visto"
  );
});
