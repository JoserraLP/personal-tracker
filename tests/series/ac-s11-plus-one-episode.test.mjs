// AC-S11 (ALG-S03, DB-S04): «+1 Episodio» crea `episodes/S01E01` con
// `watched:true` y `watchedAt` actual, sube el contador, sella
// `lastWatchedAt`, avanza `currentEpisode` a 2 y pasa a `"watching"`;
// en una serie ya viendo, el contador suma 1, la posición avanza a 4 y
// el estado permanece en `"watching"`. Episodio y padre en un único
// `writeBatch` (DB-S04).

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

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
  fakeTimestamp,
  isRecentTime,
  batches,
} from "./repository-helpers.mjs";

const repo = await loadRepository();

beforeEach(() => {
  resetStore();
  setUser("test-uid");
});

test("AC-S11 · desde watchlist, marcar S01E01 crea el episodio y pasa a watching", async () => {
  seedSeries(
    "70523",
    baseSeriesDoc({
      status: "watchlist",
      currentSeason: 1,
      currentEpisode: 1,
      watchedEpisodesCount: 0,
      lastWatchedAt: null,
    })
  );

  const result = await repo.setEpisodeWatched("70523", 1, 1);
  const episode = getStoredEpisode("70523", "S01E01");
  const parent = getStoredSeries("70523");

  // Episodio creado con la hora actual
  assert.equal(episode.seasonNumber, 1);
  assert.equal(episode.episodeNumber, 1);
  assert.equal(episode.watched, true, "watched:true");
  assert.ok(isRecentTime(episode.watchedAt), "watchedAt es la hora actual");
  assert.equal(episode.isFavorite, false, "valores neutros al crear");

  // Padre recalculado
  assert.equal(parent.watchedEpisodesCount, 1, "el contador pasa a 1");
  assert.ok(isRecentTime(parent.lastWatchedAt), "lastWatchedAt es la hora actual");
  assert.equal(parent.currentSeason, 1);
  assert.equal(parent.currentEpisode, 2, "currentEpisode pasa a 2");
  assert.equal(parent.status, "watching", "el estado cambia a watching");

  assert.equal(result.watchedEpisodesCount, 1);
  assert.equal(result.status, "watching");

  // Lote único: episodio + padre en el mismo writeBatch (DB-S04)
  assert.equal(batches.length, 1, "un solo writeBatch");
  assert.ok(
    batches[0].sets.some((path) => path.endsWith("/episodes/S01E01")),
    "el episodio viaja en el lote"
  );
  assert.ok(
    batches[0].updates.some((path) => path.endsWith("/series/70523")),
    "el padre viaja en el mismo lote"
  );
});

test("AC-S11 · en watching con 2 vistos, marcar S01E03 suma 1, avanza a 4 y sigue en watching", async () => {
  const old = fakeTimestamp(Date.now() - 60 * 1000);

  seedSeries(
    "70523",
    baseSeriesDoc({
      status: "watching",
      currentSeason: 1,
      currentEpisode: 3,
      watchedEpisodesCount: 2,
      numberOfEpisodes: 24,
      lastWatchedAt: old,
    })
  );
  seedEpisode(
    "70523",
    "S01E01",
    baseEpisodeDoc(1, 1, { watched: true, watchedAt: old })
  );
  seedEpisode(
    "70523",
    "S01E02",
    baseEpisodeDoc(1, 2, { watched: true, watchedAt: old })
  );

  const result = await repo.setEpisodeWatched("70523", 1, 3);
  const episode = getStoredEpisode("70523", "S01E03");
  const parent = getStoredSeries("70523");

  assert.equal(episode.watched, true);
  assert.ok(isRecentTime(episode.watchedAt));
  assert.equal(parent.watchedEpisodesCount, 3, "el contador suma 1");
  assert.equal(parent.currentEpisode, 4, "currentEpisode pasa a 4");
  assert.equal(parent.currentSeason, 1);
  assert.equal(parent.status, "watching", "permanece en watching");
  assert.equal(result.status, "watching");

  assert.equal(batches.length, 1, "un solo writeBatch");
});
