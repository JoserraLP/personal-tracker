// AC-S04 (API-S06): ficha con `append_to_response=credits,videos,watch/providers`
// ⇒ poster, backdrop, título original, fecha de estreno, «3 temporadas ·
// 24 episodios», estado de TMDB (traducción en UI-S09), cadenas, géneros,
// sinopsis, creadores, reparto, tráiler y «TMDB 8,4 (12.345 votos)».

import assert from "node:assert/strict";
import test from "node:test";

import {
  loadClientWithKey,
  installFetchMock,
  httpError,
  detailFixture,
  TEST_API_KEY,
} from "./helpers.mjs";

const client = await loadClientWithKey(TEST_API_KEY);

test("AC-S04 · getSeriesDetail pide credits,videos,watch/providers sin codificar", async () => {
  const calls = installFetchMock(detailFixture());

  const detail = await client.getSeriesDetail(1399);

  assert.equal(calls.length, 1);
  const url = calls[0].url;
  assert.ok(
    url.startsWith("https://api.themoviedb.org/3/tv/1399?"),
    `url: ${url}`
  );
  assert.ok(
    url.includes("append_to_response=credits,videos,watch/providers"),
    `las comas y la barra deben viajar literales: ${url}`
  );
  assert.ok(url.includes(`api_key=${TEST_API_KEY}`));
  assert.ok(url.includes("language=es-ES"));
  assert.ok(url.includes("include_adult=false"));
  assert.equal(calls[0].init.method, "GET");
  assert.equal(detail.id, 1399);
});

test("AC-S04 · la ficha normalizada contiene todos los datos visibles del diálogo", async () => {
  installFetchMock(detailFixture());

  const detail = await client.getSeriesDetail(1399);

  // poster · backdrop · título original · fecha de estreno
  assert.equal(detail.posterPath, "/gosPoster.jpg");
  assert.equal(detail.backdropPath, "/gosBackdrop.jpg");
  assert.equal(detail.originalName, "Game of Thrones");
  assert.equal(detail.firstAirDate, "2011-04-17");

  // «3 temporadas · 24 episodios»
  assert.equal(detail.numberOfSeasons, 3);
  assert.equal(detail.numberOfEpisodes, 24);

  // Estado de emisión (crudo para la etiqueta «En emisión» de UI-S09)
  assert.equal(detail.tmdbStatus, "Returning Series");

  // cadenas · géneros · sinopsis · creadores · reparto
  assert.deepEqual(detail.networks, ["HBO", "TNT"]);
  assert.deepEqual(detail.genres, ["Drama", "Ciencia ficción y fantasía"]);
  assert.equal(detail.overview, "Siete casas por un trono.");
  assert.deepEqual(detail.creators, ["David Benioff", "D. B. Weiss"]);
  assert.deepEqual(detail.cast, [
    "Emilia Clarke",
    "Kit Harington",
    "Peter Dinklage",
    "Lena Headey",
    "Nikolaj Coster-Waldau",
  ]);
  assert.equal(detail.cast.length, 5, "máximo 5 (API-S06)");

  // enlace a tráiler
  assert.equal(detail.trailerKey, "trailerKey1");
  assert.equal(
    client.trailerUrl(detail.trailerKey),
    "https://www.youtube.com/watch?v=trailerKey1"
  );

  // «TMDB 8,4 (12.345 votos)»
  assert.equal(detail.voteAverage, 8.4);
  assert.equal(detail.voteCount, 12345);

  // dónde ver (España) y temporadas sin especiales
  assert.deepEqual(detail.watchProviders, ["HBO Max", "Sky", "Apple TV"]);
  assert.deepEqual(
    detail.seasons.map((season) => season.seasonNumber),
    [1, 2, 3]
  );
  assert.deepEqual(
    detail.seasons.map((season) => season.episodeCount),
    [10, 10, 4]
  );
  assert.equal(detail.episodeRuntime, 57);
});

test("AC-S04 · un 404 de TMDB se propaga como HTTP_404 (API-S06)", async () => {
  installFetchMock(httpError(404));

  await assert.rejects(
    client.getSeriesDetail(999999),
    (error) =>
      error.name === "TmdbError" &&
      error.code === "HTTP_404" &&
      error.message === "Serie no encontrada en TMDB."
  );
});

test("AC-S04 · id inválido se rechaza sin red y sigue siendo un error capturable", async () => {
  const calls = installFetchMock(detailFixture());

  // El cliente reserva HTTP_404 para respuestas reales de TMDB; una entrada
  // inválida se valida aquí como TmdbError("PARSE") sin tocar la red
  // (js/series/tmdbTvClient.js:561).
  for (const invalidId of [0, -1, "1399", null]) {
    const error = await client
      .getSeriesDetail(invalidId)
      .then(() => assert.fail(`id ${String(invalidId)} debió rechazar`), (err) => err);

    assert.ok(error instanceof Error, "siempre rechaza con un Error capturable");
    assert.equal(error.name, "TmdbError", `llegó ${error.name}: ${error.message}`);
    assert.equal(error.code, "PARSE");
    assert.equal(error.message, "Identificador de serie no válido.");
  }

  assert.equal(calls.length, 0, "validación sin peticiones a api.themoviedb.org");
});
