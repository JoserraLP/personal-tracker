// AC-S12 (ALG-S03): con 23 de 24 vistos, marcar el último ⇒
// `status:"watched"`; desmarcar ⇒ `watching` y la posición apunta al
// primer episodio no visto; desmarcar todo ⇒ contador 0 y
// `status:"watchlist"` (nunca «Completada» con 0 episodios); una serie
// en `"dropped"` nunca cambia por estas reglas.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  loadRepository,
  resetStore,
  setUser,
  seedSeries,
  seedEpisode,
  getStoredSeries,
  baseSeriesDoc,
  baseEpisodeDoc,
  fakeTimestamp,
  range,
  batches,
} from "./repository-helpers.mjs";

const repo = await loadRepository();

beforeEach(() => {
  resetStore();
  setUser("test-uid");
});

/** Serie con los `count` primeros episodios de la temporada 1 vistos. */
function seedProgress(count, overrides = {}) {
  const old = fakeTimestamp(Date.now() - 1000);
  seedSeries(
    "70523",
    baseSeriesDoc({
      numberOfEpisodes: 24,
      status: "watching",
      watchedEpisodesCount: count,
      lastWatchedAt: old,
      ...overrides,
    })
  );

  for (const episode of range(count)) {
    seedEpisode(
      "70523",
      `S01E${String(episode).padStart(2, "0")}`,
      baseEpisodeDoc(1, episode, { watched: true, watchedAt: old })
    );
  }
}

test("AC-S12 · marcar el último episodio (23/24) pasa el estado a watched", async () => {
  seedProgress(23, { status: "watching" });

  await repo.setEpisodeWatched("70523", 1, 24);

  const parent = getStoredSeries("70523");
  assert.equal(parent.watchedEpisodesCount, 24);
  assert.equal(parent.status, "watched", "Completada al llegar a 24/24");
});

test("AC-S12 · desmarcar un episodio vuelve a watching y apunta al primero no visto", async () => {
  seedProgress(24, { status: "watched", currentSeason: 1, currentEpisode: 25 });

  await repo.unmarkEpisode("70523", 1, 5);

  const parent = getStoredSeries("70523");
  assert.equal(parent.status, "watching", "vuelve a Viendo");
  assert.equal(parent.watchedEpisodesCount, 23);
  assert.equal(parent.currentSeason, 1);
  assert.equal(
    parent.currentEpisode,
    5,
    "currentSeason/currentEpisode apuntan al primer episodio no visto"
  );
});

test("AC-S12 · desmarcar todos deja contador 0 y status watchlist (nunca watched con 0)", async () => {
  seedProgress(24, { status: "watched" });

  await repo.unmarkSeason("70523", 1, range(24));

  const parent = getStoredSeries("70523");
  assert.equal(parent.watchedEpisodesCount, 0, "el contador queda en 0");
  assert.equal(parent.status, "watchlist", "nunca queda Completada con 0");
  assert.equal(parent.lastWatchedAt, null, "se revierte la última fecha");
  assert.equal(parent.currentSeason, 1);
  assert.equal(parent.currentEpisode, 1);
  assert.equal(batches.length, 1, "un solo writeBatch para la temporada");
});

test("AC-S12 · una serie dropped nunca cambia automáticamente por marcar ni desmarcar", async () => {
  seedProgress(3, { status: "dropped" });

  await repo.setEpisodeWatched("70523", 1, 4);
  assert.equal(getStoredSeries("70523").status, "dropped", "sigue Abandonada al marcar");

  await repo.unmarkEpisode("70523", 1, 1);
  assert.equal(
    getStoredSeries("70523").status,
    "dropped",
    "sigue Abandonada al desmarcar"
  );

  await repo.unmarkSeason("70523", 1, range(24));
  assert.equal(
    getStoredSeries("70523").status,
    "dropped",
    "sigue Abandonada al desmarcar la temporada"
  );
});
