// AC-S02 (API-S01): con clave válida, la búsqueda «dark» (≥2 chars) usa
// /search/tv, language=es-ES y devuelve título, año de `first_air_date` y
// puntuación TMDB. También cubre el mínimo de 2 caracteres (NFR-S04/ALG-S05).

import assert from "node:assert/strict";
import test from "node:test";

import {
  loadClientWithKey,
  installFetchMock,
  pagedResults,
  summaryFixture,
  TEST_API_KEY,
} from "./helpers.mjs";

const client = await loadClientWithKey(TEST_API_KEY);

test("AC-S02 · isTmdbConfigured() es true con clave", () => {
  assert.equal(client.isTmdbConfigured(), true);
});

test("AC-S02 · buscar «dark» trae título, año de estreno y puntuación", async () => {
  const calls = installFetchMock(
    pagedResults(
      [
        summaryFixture(),
        summaryFixture({ id: 1, name: "Otra serie", poster_path: null }),
      ],
      { page: 1, totalPages: 3 }
    )
  );

  const result = await client.searchSeries("dark");

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://api.themoviedb.org/3/search/tv");
  assert.equal(url.searchParams.get("api_key"), TEST_API_KEY);
  assert.equal(url.searchParams.get("language"), "es-ES");
  assert.equal(url.searchParams.get("include_adult"), "false");
  assert.equal(url.searchParams.get("query"), "dark");
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(calls[0].init.method, "GET");

  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 3);
  assert.equal(result.results.length, 2);

  const [first] = result.results;
  assert.equal(first.name, "Dark"); // título visible
  assert.equal(first.firstAirDate, "2017-12-01"); // año de estreno (first_air_date)
  assert.equal(first.voteAverage, 8.4); // puntuación TMDB
  assert.equal(first.voteCount, 12345);
});

test("AC-S02 · año de estreno y página se envían como parámetros", async () => {
  const calls = installFetchMock(pagedResults([summaryFixture()], { page: 2, totalPages: 9 }));

  const result = await client.searchSeries("  dark  ", 2017, 2);

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("query"), "dark"); // recortado
  assert.equal(url.searchParams.get("first_air_date_year"), "2017");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(result.page, 2);
  assert.equal(result.totalPages, 9);
});

test("AC-S02 · consulta de menos de 2 caracteres no hace red y devuelve vacío", async () => {
  const calls = installFetchMock(pagedResults([summaryFixture()]));

  const result = await client.searchSeries("d");
  const resultWhitespace = await client.searchSeries("   ");

  assert.equal(calls.length, 0);
  assert.deepEqual(result, { page: 1, totalPages: 0, results: [] });
  assert.deepEqual(resultWhitespace, { page: 1, totalPages: 0, results: [] });
});
