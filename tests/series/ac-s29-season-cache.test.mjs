// AC-S29 (parcial — API-S06, ALG-S07/NFR-S04): el cliente NO cachea el
// detalle (la caché `detailCachedAt` vive en el repositorio, ALG-S06, por lo
// que «Actualizar datos» puede forzarse con una única llamada) y SÍ cachea
// temporadas en memoria por sesión: `getSeasonDetail` se invoca una sola vez
// por temporada aunque se cambie dos veces.

import assert from "node:assert/strict";
import test from "node:test";

import {
  loadClientWithKey,
  installFetchMock,
  detailFixture,
  seasonFixture,
  TEST_API_KEY,
} from "./helpers.mjs";

const client = await loadClientWithKey(TEST_API_KEY);

test("AC-S29 · getSeasonDetail se llama una sola vez por temporada en la sesión", async () => {
  client.clearSeasonCache();
  const calls = installFetchMock((url) =>
    url.includes("/season/2/") ? seasonFixture(2) : seasonFixture(1)
  );

  // Dos cambios de temporada idénticos (v1 → v2 → v1) en la misma sesión:
  const first = await client.getSeasonDetail(1399, 1);
  await client.getSeasonDetail(1399, 2);
  const again = await client.getSeasonDetail(1399, 1);

  const season1Calls = calls.filter((call) => call.url.includes("/season/1"));
  const season2Calls = calls.filter((call) => call.url.includes("/season/2"));
  assert.equal(season1Calls.length, 1, "una sola petición a la temporada 1");
  assert.equal(season2Calls.length, 1, "una sola petición a la temporada 2");
  assert.equal(calls.length, 2, "1 petición de temporada por sesión y temporada (NFR-S04)");
  assert.equal(again, first, "devuelve el mismo objeto cacheado");

  // La petición va al endpoint API-S07 con language=es-ES.
  assert.match(season1Calls[0].url, /\/tv\/1399\/season\/1\?/);
  assert.ok(season1Calls[0].url.includes("language=es-ES"));
});

test("AC-S29 · la caché de temporada no mezcla series distintas", async () => {
  client.clearSeasonCache();
  const calls = installFetchMock(() => seasonFixture(1));

  await client.getSeasonDetail(1399, 1);
  await client.getSeasonDetail(66732, 1);
  await client.getSeasonDetail(1399, 1);

  assert.equal(calls.length, 2, "clave de caché por seriesId:seasonNumber");
  assert.ok(calls[0].url.includes("/tv/1399/season/1"));
  assert.ok(calls[1].url.includes("/tv/66732/season/1"));
});

test("AC-S29 · los fallos de temporada no se cachean: el reintento vuelve a ir a red", async () => {
  client.clearSeasonCache();

  let fail = true;
  const calls = installFetchMock(() => {
    if (fail) throw new TypeError("fetch failed");
    return seasonFixture(3);
  });

  await assert.rejects(
    client.getSeasonDetail(1399, 3),
    (error) => error.code === "NETWORK"
  );
  assert.equal(calls.length, 1);

  fail = false;
  const season = await client.getSeasonDetail(1399, 3);
  assert.equal(calls.length, 2, "el error no quedó cacheado");
  assert.equal(season.seasonNumber, 3);
});

test("AC-S29 · clearSeasonCache() vacía la caché de sesión (fuerza una nueva petición)", async () => {
  client.clearSeasonCache();
  const calls = installFetchMock(() => seasonFixture(1));

  await client.getSeasonDetail(1399, 1);
  client.clearSeasonCache();
  await client.getSeasonDetail(1399, 1);

  assert.equal(calls.length, 2);
});

test("AC-S29 · el detalle NO se cachea en el cliente: la caché es del repositorio (ALG-S06)", async () => {
  // Dos aperturas de ficha ⇒ dos llamadas: así «Actualizar datos» puede
  // invocar getSeriesDetail exactamente una vez desde el repositorio.
  const calls = installFetchMock(detailFixture());

  const first = await client.getSeriesDetail(1399);
  const second = await client.getSeriesDetail(1399);

  assert.equal(calls.length, 2, "sin caché de detalle en el cliente");
  assert.notEqual(first, second, "normaliza cada respuesta");
  assert.deepEqual(first, second, "pero con el mismo contenido");
});

test("AC-S29 · la temporada se normaliza (episodios ordenados y contrato TmdbSeasonDetail)", async () => {
  client.clearSeasonCache();
  installFetchMock(() => seasonFixture(1));

  const season = await client.getSeasonDetail(1399, 1);

  assert.equal(season.id, 1399);
  assert.equal(season.name, "Temporada 1");
  assert.equal(season.seasonNumber, 1);
  assert.deepEqual(
    season.episodes.map((episode) => episode.episodeNumber),
    [1, 2],
    "ordenados por número de episodio"
  );
  const [first] = season.episodes;
  assert.equal(first.name, "El trono de hierro");
  assert.equal(first.stillPath, "/ep1.jpg");
  assert.equal(first.voteAverage, 8.1);
  assert.equal(first.runtime, 62);
  assert.equal(first.airDate, "2011-04-17");
});
