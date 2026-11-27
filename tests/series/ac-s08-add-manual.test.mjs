// AC-S08 (REQ-S02, DB-S04): alta manual con «Serie local» sin conexión ⇒
// aparece en la biblioteca con `source:"manual"`, `tmdbId:null` y cero
// llamadas a `fetch` / a `getSeriesDetail` de TMDB.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  loadRepository,
  resetStore,
  setUser,
  getStoredSeries,
  installFetchCounter,
  getSeriesDetailCalls,
  isServerTimestamp,
} from "./repository-helpers.mjs";

const repo = await loadRepository();

beforeEach(() => {
  resetStore();
  setUser("test-uid");
});

test("AC-S08 · «Serie local» se guarda con source:manual, tmdbId:null y sin ninguna petición a TMDB", async () => {
  const fetch = installFetchCounter();

  try {
    const id = await repo.addManual({
      name: "Serie local",
      year: 2020,
      seasons: 1,
      episodes: 6,
      overview: "Alta hecha sin conexión.",
      genres: ["Drama"],
    });

    assert.equal(fetch.calls.length, 0, "cero llamadas a fetch de TMDB");
    assert.deepEqual(
      getSeriesDetailCalls(),
      [],
      "cero llamadas a getSeriesDetail"
    );

    const doc = getStoredSeries(id);
    assert.equal(doc.source, "manual");
    assert.equal(doc.tmdbId, null);
    assert.equal(doc.tmdbRating, null);
    assert.equal(doc.name, "Serie local");
    assert.equal(doc.originalName, "Serie local");
    assert.equal(doc.firstAirDate, null);
    assert.equal(doc.firstAirYear, 2020);
    assert.equal(doc.numberOfSeasons, 1);
    assert.equal(doc.numberOfEpisodes, 6);
    assert.deepEqual(doc.genres, ["Drama"]);
    assert.equal(doc.status, "watchlist");
    assert.equal(doc.watchedEpisodesCount, 0);
    assert.deepEqual(doc.collectionIds, []);
    assert.ok(isServerTimestamp(doc.addedAt));
    assert.ok(isServerTimestamp(doc.updatedAt));
  } finally {
    fetch.restore();
  }
});

test("AC-S08 · tras guardar, la serie aparece en la biblioteca leída", async () => {
  const fetch = installFetchCounter();

  try {
    const id = await repo.addManual({ name: "Serie local" });
    const library = await repo.listSeries();

    assert.equal(library.length, 1, "aparece en la biblioteca");
    assert.equal(library[0].id, id);
    assert.equal(library[0].name, "Serie local");
    assert.equal(library[0].source, "manual");
    assert.equal(library[0].tmdbId, null);
    assert.equal(fetch.calls.length, 0, "la lectura tampoco usa TMDB");
  } finally {
    fetch.restore();
  }
});

test("AC-S08 · el nombre obligatorio se valida en español", async () => {
  await assert.rejects(
    repo.addManual({ name: "   " }),
    (error) =>
      error.name === "SeriesRepositoryError" &&
      error.code === "VALIDATION" &&
      error.message === "El nombre de la serie es obligatorio."
  );
});
