// AC-S03 (API-S02..S05): catálogo sin búsqueda activa ⇒ cuatro listas
// (Tendencias de la semana, Populares, Mejor valoradas, En emisión) con
// tarjetas de póster, título y año.

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

const LISTS = [
  { name: "Tendencias de la semana", fn: "fetchTrendingWeek", path: "/trending/tv/week" },
  { name: "Populares", fn: "fetchPopularSeries", path: "/tv/popular" },
  { name: "Mejor valoradas", fn: "fetchTopRatedSeries", path: "/tv/top_rated" },
  { name: "En emisión", fn: "fetchOnTheAir", path: "/tv/on_the_air" },
];

for (const list of LISTS) {
  test(`AC-S03 · ${list.name} (${list.path}) devuelve tarjetas con póster, título y año`, async () => {
    const calls = installFetchMock(
      pagedResults([
        summaryFixture(),
        summaryFixture({ id: 66732, name: "Stranger Things", first_air_date: "2016-07-15" }),
      ])
    );

    const result = await client[list.fn]();

    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, `https://api.themoviedb.org/3${list.path}`);
    assert.equal(url.searchParams.get("api_key"), TEST_API_KEY);
    assert.equal(url.searchParams.get("language"), "es-ES");
    assert.equal(url.searchParams.get("page"), "1");

    assert.equal(result.results.length, 2);
    for (const card of result.results) {
      assert.equal(typeof card.name, "string");
      assert.ok(card.name.length > 0, "título visible");
      assert.match(card.firstAirDate, /^\d{4}-\d{2}-\d{2}$/, "año de estreno visible");
      assert.ok(card.firstAirDate.startsWith("20"), "año extraíble de first_air_date");
      assert.ok(
        card.posterPath === null || typeof card.posterPath === "string",
        "póster presente o placeholder"
      );
    }
  });
}

test("AC-S03 · las cuatro listas son independientes y todas responden", async () => {
  const calls = installFetchMock(pagedResults([summaryFixture()]));

  const results = await Promise.all(
    LISTS.map((list) => client[list.fn]())
  );

  assert.equal(calls.length, 4);
  const paths = calls.map((call) => new URL(call.url).pathname);
  assert.equal(new Set(paths).size, 4, "cuatro endpoints distintos");
  for (const result of results) {
    assert.equal(result.results.length, 1);
  }
});
