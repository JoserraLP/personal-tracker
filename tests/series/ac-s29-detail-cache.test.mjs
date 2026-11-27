// AC-S29 (API-S06, ALG-S06): al abrir la ficha con `detailCachedAt`
// reciente (<30 días) no se invoca `getSeriesDetail` (0 peticiones);
// sin caché o con caché vencida se recarga; «Actualizar datos»
// (`force:true`) invoca exactamente una vez y sella `detailCachedAt`.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  loadRepository,
  resetStore,
  setUser,
  seedSeries,
  getStoredSeries,
  baseSeriesDoc,
  fakeTimestamp,
  DAY_MS,
  isServerTimestamp,
  getSeriesDetailCalls,
  setSeriesDetailResponse,
  installFetchCounter,
  detailResponse,
} from "./repository-helpers.mjs";

const repo = await loadRepository();

beforeEach(() => {
  resetStore();
  setUser("test-uid");
  setSeriesDetailResponse(detailResponse());
});

test("AC-S29 · caché de 5 días: al reabrir la ficha no se invoca getSeriesDetail (0 peticiones)", async () => {
  seedSeries(
    "70523",
    baseSeriesDoc({ detailCachedAt: fakeTimestamp(Date.now() - 5 * DAY_MS) })
  );
  const fetch = installFetchCounter();

  try {
    const result = await repo.ensureDetailCached("70523");

    assert.deepEqual(getSeriesDetailCalls(), [], "0 llamadas a getSeriesDetail");
    assert.equal(fetch.calls.length, 0, "0 peticiones a api.themoviedb.org");
    assert.equal(result.fromCache, true, "sirve desde la caché");
    assert.equal(result.refreshed, false);
    assert.equal(result.series.name, "Dark");
    assert.equal(result.series.numberOfEpisodes, 24, "sin recargar");
  } finally {
    fetch.restore();
  }
});

test("AC-S29 · sin caché se recarga una vez y sella detailCachedAt", async () => {
  seedSeries("70523", baseSeriesDoc({ detailCachedAt: null }));
  const fetch = installFetchCounter();

  try {
    const result = await repo.ensureDetailCached("70523");

    assert.equal(getSeriesDetailCalls().length, 1, "una única recarga");
    assert.equal(fetch.calls.length, 0, "el doble sustituye la red");
    assert.equal(result.refreshed, true);
    assert.equal(result.fromCache, false);
    assert.equal(result.series.numberOfEpisodes, 26, "metadatos frescos");

    const parent = getStoredSeries("70523");
    assert.ok(isServerTimestamp(parent.detailCachedAt), "detailCachedAt sellado");
    assert.equal(parent.numberOfEpisodes, 26);
    assert.ok(isServerTimestamp(parent.updatedAt));
  } finally {
    fetch.restore();
  }
});

test("AC-S29 · caché vencida (31 días) vuelve a llamar a getSeriesDetail", async () => {
  seedSeries(
    "70523",
    baseSeriesDoc({ detailCachedAt: fakeTimestamp(Date.now() - 31 * DAY_MS) })
  );

  const result = await repo.ensureDetailCached("70523");

  assert.equal(getSeriesDetailCalls().length, 1, "refetch al superar 30 días");
  assert.equal(result.refreshed, true);
  assert.equal(getStoredSeries("70523").numberOfEpisodes, 26);
});

test("AC-S29 · «Actualizar datos» (force) invoca getSeriesDetail exactamente una vez", async () => {
  seedSeries(
    "70523",
    baseSeriesDoc({ detailCachedAt: fakeTimestamp(Date.now() - 5 * DAY_MS) })
  );

  const result = await repo.ensureDetailCached("70523", { force: true });

  assert.equal(
    getSeriesDetailCalls().length,
    1,
    "force recarga exactamente una vez pese a la caché fresca"
  );
  assert.equal(result.refreshed, true);
  assert.equal(result.series.numberOfEpisodes, 26);
  assert.ok(
    isServerTimestamp(getStoredSeries("70523").detailCachedAt),
    "detailCachedAt se actualiza"
  );

  // Tras refrescar, una segunda apertura sin force no vuelve a red.
  const again = await repo.ensureDetailCached("70523");
  assert.equal(getSeriesDetailCalls().length, 1, "la caché ya está fresca");
  assert.equal(again.fromCache, true);
  assert.equal(again.refreshed, false);
});

test("AC-S29 · una serie manual nunca hace red ni con force", async () => {
  seedSeries(
    "manual-1",
    baseSeriesDoc({
      source: "manual",
      tmdbId: null,
      name: "Serie local",
      detailCachedAt: null,
    })
  );

  const result = await repo.ensureDetailCached("manual-1", { force: true });

  assert.deepEqual(getSeriesDetailCalls(), [], "cero llamadas a TMDB");
  assert.equal(result.fromCache, false);
  assert.equal(result.refreshed, false);
  assert.equal(result.series.source, "manual");
});
