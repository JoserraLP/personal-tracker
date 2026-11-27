// AC-S06 (API-S*, ALG-S05): caída de red o error 429 ⇒ TmdbError con el código
// que la UI mapea a «No se pudo conectar con TMDB. Puedes añadir la serie
// manualmente.» (mapa ALG-S05) y la app sigue operativa.
// Incluye el timeout de 10 s de NFR-S04.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  loadClientWithKey,
  installFetchMock,
  pagedResults,
  summaryFixture,
  httpError,
  TEST_API_KEY,
} from "./helpers.mjs";

const client = await loadClientWithKey(TEST_API_KEY);

const AC_S06_TEXT =
  "No se pudo conectar con TMDB. Puedes añadir la serie manualmente.";

test("AC-S06 · caída de red ⇒ TmdbError NETWORK con mensaje de conexión", async () => {
  installFetchMock(() => {
    throw new TypeError("fetch failed");
  });

  const error = await client
    .searchSeries("dark")
    .then(() => assert.fail("debió rechazar"), (err) => err);

  assert.equal(error.name, "TmdbError");
  assert.equal(error.code, "NETWORK");
  assert.equal(error.message, "No se pudo conectar con TMDB.");
  assert.ok(error instanceof Error, "capturable, nunca promesa sin manejar");

  // La app sigue operativa: helpers siguen respondiendo y se puede reintentar.
  assert.equal(client.posterUrl("/p.jpg"), "https://image.tmdb.org/t/p/w500/p.jpg");
  const calls = installFetchMock(pagedResults([summaryFixture()]));
  const result = await client.searchSeries("dark");
  assert.equal(calls.length, 1);
  assert.equal(result.results.length, 1);
});

test("AC-S06 · error 429 de TMDB ⇒ TmdbError HTTP_429", async () => {
  const calls = installFetchMock(httpError(429));

  const error = await client
    .fetchTrendingWeek()
    .then(() => assert.fail("debió rechazar"), (err) => err);

  assert.equal(error.name, "TmdbError");
  assert.equal(error.code, "HTTP_429");
  assert.equal(error.message, "TMDB ha limitado las peticiones (429).");
  assert.equal(calls.length, 1);

  // Sigue operativa tras el 429.
  assert.equal(client.stillUrl("/s.jpg"), "https://image.tmdb.org/t/p/w300/s.jpg");
});

test("AC-S06 · 401 ⇒ HTTP_401 y cuerpo no JSON ⇒ PARSE (ambos mapeados en ALG-S05)", async () => {
  installFetchMock(httpError(401));
  await assert.rejects(
    client.fetchPopularSeries(),
    (error) => error.code === "HTTP_401" && error.name === "TmdbError"
  );

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token <");
    },
  });
  await assert.rejects(
    client.fetchTopRatedSeries(),
    (error) => error.code === "PARSE" && error.name === "TmdbError"
  );

  assert.equal(client.isTmdbConfigured(), true, "la sesión sigue operativa");
});

test("AC-S06 · los códigos NETWORK/HTTP_429/HTTP_401 son los que ALG-S05 mapea al texto visible del AC", async () => {
  // Cruce entre el código real que emite el cliente y el mapa de ALG-S05
  // que produce el mensaje visible citado en AC-S06.
  const spec = await readFile(
    new URL("../../openspec/changes/series/specs-delta.md", import.meta.url),
    "utf8"
  );

  const flat = spec.replace(/\s+/g, " ");
  const start = flat.indexOf("AC-S06 (");
  const end = flat.indexOf("AC-S07 (");
  assert.ok(start >= 0, "AC-S06 presente en la spec");
  const acBlock = flat.slice(start, end);
  assert.ok(
    acBlock.includes("No se pudo conectar con TMDB. Puedes añadir la serie manualmente."),
    `texto visible del AC-S06 no encontrado en: ${acBlock}`
  );

  assert.match(
    flat,
    /`NETWORK`\/`HTTP_429`\/`HTTP_401` → «No se pudo conectar con TMDB\. Puedes añadir la serie manualmente\.»/,
    "mapa ALG-S05: los códigos emitidos por el cliente conducen al texto del AC"
  );
});

test("NFR-S04 · timeout de 10 s aborta la petición y se lanza NETWORK", async (t) => {
  globalThis.fetch = (url, init = {}) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const abortError = new Error("This operation was aborted");
        abortError.name = "AbortError";
        reject(abortError);
      });
    });

  t.mock.timers.enable({ apis: ["setTimeout"] });

  const pending = client.searchSeries("dark");
  const assertion = assert.rejects(pending, (error) => {
    assert.equal(error.name, "TmdbError");
    assert.equal(error.code, "NETWORK");
    return true;
  });

  t.mock.timers.tick(10_000);
  await assertion;
  t.mock.timers.reset();
});
