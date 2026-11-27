// AC-S20 (ALG-S08): «Marcar temporada como vista» deja los 10 episodios
// `watched:true` con `watchedAt`, `watchedEpisodesCount` suma exactamente
// 10, los contadores del padre son coherentes y `status` aplica ALG-S03;
// «Desmarcar temporada» deja `watched:false`, `watchedAt:null`, el contador
// baja 10 y conserva favoritos, notas y comentarios. Un solo writeBatch.

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
  range,
  batches,
} from "./repository-helpers.mjs";

const repo = await loadRepository();

beforeEach(() => {
  resetStore();
  setUser("test-uid");
});

const SEASON = range(10);

function episodeKey(episode) {
  return `S01E${String(episode).padStart(2, "0")}`;
}

test("AC-S20 · marcar la temporada 1 deja 10 vistos, contadores coherentes y status watchlist→watched", async () => {
  seedSeries(
    "70523",
    baseSeriesDoc({
      numberOfEpisodes: 10,
      status: "watchlist",
      watchedEpisodesCount: 0,
      favoriteEpisodesCount: 1,
      lastWatchedAt: null,
    })
  );
  // Capítulo ya favorito con nota y comentario antes de marcar.
  seedEpisode(
    "70523",
    episodeKey(3),
    baseEpisodeDoc(1, 3, {
      isFavorite: true,
      userRating: 9,
      userReview: "Gran capítulo.",
      hasSpoilers: true,
    })
  );

  await repo.markSeason("70523", 1, SEASON);

  for (const episode of SEASON) {
    const doc = getStoredEpisode("70523", episodeKey(episode));
    assert.equal(doc.watched, true, `${episodeKey(episode)} watched:true`);
    assert.ok(
      isRecentTime(doc.watchedAt),
      `${episodeKey(episode)} tiene watchedAt actual`
    );
  }

  const parent = getStoredSeries("70523");
  assert.equal(parent.watchedEpisodesCount, 10, "suma exactamente 10");
  assert.equal(parent.favoriteEpisodesCount, 1, "favoritos coherentes");
  assert.equal(parent.status, "watched", "ALG-S03: 10/10 ⇒ Completada");
  assert.equal(parent.currentSeason, 1);
  assert.equal(parent.currentEpisode, 11, "todo visto: posición siguiente");

  // Un solo writeBatch con los 10 upserts + el padre (ALG-S08)
  assert.equal(batches.length, 1, "un solo writeBatch");
  const episodeSets = batches[0].sets.filter((path) => path.includes("/episodes/"));
  assert.equal(episodeSets.length, 10, "los 10 episodios en el lote");
  assert.ok(
    batches[0].updates.some((path) => path.endsWith("/series/70523")),
    "el padre en el mismo lote"
  );
});

test("AC-S20 · desmarcar la temporada baja 10 y conserva favoritos, notas y comentarios", async () => {
  seedSeries(
    "70523",
    baseSeriesDoc({
      numberOfEpisodes: 10,
      status: "watched",
      watchedEpisodesCount: 10,
      favoriteEpisodesCount: 1,
      lastWatchedAt: fakeTimestamp(Date.now() - 60 * 1000),
    })
  );
  for (const episode of SEASON) {
    seedEpisode(
      "70523",
      episodeKey(episode),
      baseEpisodeDoc(1, episode, {
        watched: true,
        watchedAt: fakeTimestamp(Date.now() - 60 * 1000),
      })
    );
  }
  seedEpisode(
    "70523",
    episodeKey(3),
    baseEpisodeDoc(1, 3, {
      watched: true,
      watchedAt: fakeTimestamp(Date.now() - 60 * 1000),
      isFavorite: true,
      userRating: 9,
      userReview: "Gran capítulo.",
      hasSpoilers: true,
    })
  );

  batches.length = 0;
  await repo.unmarkSeason("70523", 1, SEASON);

  for (const episode of SEASON) {
    const doc = getStoredEpisode("70523", episodeKey(episode));
    assert.equal(doc.watched, false, `${episodeKey(episode)} watched:false`);
    assert.equal(doc.watchedAt, null, `${episodeKey(episode)} watchedAt:null`);
  }

  const parent = getStoredSeries("70523");
  assert.equal(parent.watchedEpisodesCount, 0, "el contador baja 10");
  assert.equal(parent.status, "watchlist", "ALG-S03: 0 ⇒ Pendiente");
  assert.equal(parent.lastWatchedAt, null);
  assert.equal(parent.favoriteEpisodesCount, 1, "el favorito se conserva");

  // Lo personal del capítulo se conserva (no se eliminan documentos)
  const kept = getStoredEpisode("70523", episodeKey(3));
  assert.equal(kept.isFavorite, true, "favorito conservado");
  assert.equal(kept.userRating, 9, "nota conservada");
  assert.equal(kept.userReview, "Gran capítulo.", "comentario conservado");
  assert.equal(kept.hasSpoilers, true, "spoilers conservados");

  assert.equal(batches.length, 1, "un solo writeBatch en la desmarcada");
});
