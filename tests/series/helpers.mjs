// =============================================================
// Utilidades compartidas de los tests de `js/series/tmdbTvClient.js`.
// Sin dependencias externas: usan `node:test`, `mock.module` (flag
// `--experimental-test-module-mocks`) y un `globalThis.fetch` falso.
// =============================================================

import assert from "node:assert/strict";
import { mock } from "node:test";

export const TEST_API_KEY = "test-api-key";

/**
 * Sustituye `js/config.js` por un doble con la clave indicada y devuelve el
 * cliente TMDB recién importado. Hay que llamarlo ANTES de tocar el módulo
 * bajo test (la importación de config es estática).
 *
 * @param {string} apiKey clave a inyectar ("" simula «sin clave»).
 */
export async function loadClientWithKey(apiKey) {
  mock.module(new URL("../../js/config.js", import.meta.url).href, {
    namedExports: {
      TMDB_API_KEY: apiKey,
      APP_VERSION: "00000000",
      firebaseConfig: {},
      GOOGLE_BOOKS_API_KEY: "",
      IGDB_PROXY_URL: "",
      STEAM_PROXY_URL: "",
    },
  });

  return import("../../js/series/tmdbTvClient.js");
}

/**
 * Instala un `fetch` falso que responde `payload` con 200 y registra cada
 * llamada `{ url, init }`. Si `payload` es una función se invoca con la URL
 * para devolver la respuesta (o lanzar un error).
 */
export function installFetchMock(payload = { results: [] }) {
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    const entry = { url: String(url), init };
    calls.push(entry);

    const body = typeof payload === "function" ? await payload(entry.url, entry) : payload;

    if (body && typeof body === "object" && "ok" in body && "status" in body) {
      return body; // respuesta completa ya construida (p. ej. 429)
    }

    return {
      ok: true,
      status: 200,
      json: async () => body,
    };
  };

  return calls;
}

/** Respuesta HTTP no-OK (429, 404, …). */
export function httpError(status) {
  return { ok: false, status, json: async () => ({ status_message: "error" }) };
}

/** Cuerpo de búsqueda/lista de series. */
export function pagedResults(results, { page = 1, totalPages = 1 } = {}) {
  return { page, total_pages: totalPages, results };
}

/** Tarjeta de serie de ejemplo (contrato TmdbSeriesSummary). */
export function summaryFixture(overrides = {}) {
  return {
    id: 70523,
    name: "Dark",
    original_name: "Dark",
    poster_path: "/darkPoster.jpg",
    first_air_date: "2017-12-01",
    genre_ids: [18, 878],
    overview: "Una familia perdida en el tiempo.",
    vote_average: 8.4,
    vote_count: 12345,
    ...overrides,
  };
}

/** Ficha completa de ejemplo (contrato TmdbSeriesDetail con append_to_response). */
export function detailFixture(overrides = {}) {
  return {
    id: 1399,
    name: "Juego de tronos",
    original_name: "Game of Thrones",
    poster_path: "/gosPoster.jpg",
    backdrop_path: "/gosBackdrop.jpg",
    first_air_date: "2011-04-17",
    genre_ids: [18, 10765],
    overview: "Siete casas por un trono.",
    vote_average: 8.4,
    vote_count: 12345,
    number_of_seasons: 3,
    number_of_episodes: 24,
    status: "Returning Series",
    episode_run_time: [57],
    networks: [{ name: "HBO" }, { name: "TNT" }],
    genres: [
      { id: 18, name: "Drama" },
      { id: 10765, name: "Ciencia ficción y fantasía" },
    ],
    created_by: [{ name: "David Benioff" }, { name: "D. B. Weiss" }],
    seasons: [
      { season_number: 0, name: "Especiales", air_date: "2010-01-01", episode_count: 1 },
      { season_number: 1, name: "Temporada 1", air_date: "2011-04-17", episode_count: 10 },
      { season_number: 2, name: "Temporada 2", air_date: "2012-04-01", episode_count: 10 },
      { season_number: 3, name: "Temporada 3", air_date: "2013-03-31", episode_count: 4 },
    ],
    credits: {
      cast: [
        { name: "Emilia Clarke" },
        { name: "Kit Harington" },
        { name: "Peter Dinklage" },
        { name: "Lena Headey" },
        { name: "Nikolaj Coster-Waldau" },
        { name: "Sofia Boutella" },
      ],
    },
    videos: {
      results: [
        { site: "YouTube", type: "Trailer", key: "trailerKey1", name: "Tráiler" },
        { site: "YouTube", type: "Teaser", key: "teaserKey1", name: "Teaser" },
      ],
    },
    "watch/providers": {
      results: {
        ES: {
          flatrate: [
            { provider_name: "HBO Max" },
            { provider_name: "Sky" },
            { provider_name: "HBO Max" },
          ],
          buy: [{ provider_name: "Apple TV" }],
        },
      },
    },
    ...overrides,
  };
}

/** Cuerpo de temporada (contrato TmdbSeasonDetail). */
export function seasonFixture(seasonNumber = 1) {
  return {
    id: 1399,
    name: `Temporada ${seasonNumber}`,
    season_number: seasonNumber,
    episodes: [
      {
        season_number: seasonNumber,
        episode_number: 2,
        name: "Reminiscencia",
        overview: "Un crimen antiguo resurge.",
        air_date: "2011-04-24",
        runtime: 55,
        still_path: "/ep2.jpg",
        vote_average: 7.9,
      },
      {
        season_number: seasonNumber,
        episode_number: 1,
        name: "El trono de hierro",
        overview: "El rey llega al norte.",
        air_date: "2011-04-17",
        runtime: 62,
        still_path: "/ep1.jpg",
        vote_average: 8.1,
      },
    ],
  };
}

/** Comprueba que una promesa se rechaza con un `TmdbError` concreto. */
export async function assertTmdbRejection(promise, code, messageIncludes) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "TmdbError", `name: ${error.name}`);
    assert.equal(error.code, code, `code: ${error.code}`);
    if (messageIncludes) {
      assert.ok(
        String(error.message).includes(messageIncludes),
        `mensaje «${error.message}» no contiene «${messageIncludes}»`
      );
    }
    return true;
  });
}
