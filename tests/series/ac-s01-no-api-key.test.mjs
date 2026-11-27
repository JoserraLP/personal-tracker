// AC-S01 (API-S01, ALG-S05): TMDB_API_KEY vacío ⇒ aviso exacto, cero red,
// sin excepciones sin capturar y el alta manual (helpers puros) sigue operativa.

import assert from "node:assert/strict";
import test from "node:test";

import {
  loadClientWithKey,
  installFetchMock,
  assertTmdbRejection,
} from "./helpers.mjs";

const client = await loadClientWithKey("");

test("AC-S01 · isTmdbConfigured() es false sin clave", () => {
  assert.equal(client.isTmdbConfigured(), false);
});

test("AC-S01 · searchSeries lanza NO_API_KEY con el aviso exacto y sin red", async () => {
  const calls = installFetchMock();

  await assertTmdbRejection(
    client.searchSeries("dark"),
    "NO_API_KEY",
    "Falta la clave de TMDB: búsqueda desactivada."
  );

  assert.equal(calls.length, 0, "no debe haber peticiones de red");
});

test("AC-S01 · NO_API_KEY prevalece sobre consulta corta y sobre ficha/temporada", async () => {
  const calls = installFetchMock();

  await assertTmdbRejection(client.searchSeries("d"), "NO_API_KEY");
  await assertTmdbRejection(client.getSeriesDetail(1399), "NO_API_KEY");
  await assertTmdbRejection(client.getSeasonDetail(1399, 1), "NO_API_KEY");
  await assertTmdbRejection(client.fetchTrendingWeek(), "NO_API_KEY");
  await assertTmdbRejection(client.fetchPopularSeries(), "NO_API_KEY");
  await assertTmdbRejection(client.fetchTopRatedSeries(), "NO_API_KEY");
  await assertTmdbRejection(client.fetchOnTheAir(), "NO_API_KEY");

  assert.equal(calls.length, 0, "ninguna llamada debe tocar fetch");
});

test("AC-S01 · el error es capturable (TmdbError, no excepción suelta) y lo manual sigue funcionando", async () => {
  installFetchMock();

  const error = await client.searchSeries("dark").then(
    () => assert.fail("debió rechazar"),
    (err) => err
  );

  assert.ok(error instanceof Error, "debe ser un Error capturable");
  assert.equal(error.name, "TmdbError");
  assert.equal(error.code, "NO_API_KEY");
  assert.ok(!(error instanceof TypeError), "no debe escapar como TypeError");

  // El alta manual no pasa por TMDB: helpers de imagen/tráiler sin clave.
  assert.equal(client.posterUrl("/p.jpg"), "https://image.tmdb.org/t/p/w500/p.jpg");
  assert.equal(client.trailerUrl("abc"), "https://www.youtube.com/watch?v=abc");
});
