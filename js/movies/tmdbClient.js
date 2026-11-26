// =============================================================
// Cliente de TMDB API v3 (API-M01..M08, ALG-M05).
//
// Único punto de red del cambio «movies»: todas las peticiones salen
// de `requestJson` y todas las URL de imágenes/tráiler se construyen
// aquí. No se importan URLs de CDN (REQ-C1).
// =============================================================

import { TMDB_API_KEY } from "../config.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const TMDB_YOUTUBE_URL = "https://www.youtube.com/watch";

const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_LANGUAGE = "es-ES";
const DEFAULT_PAGE = 1;
const MAX_PAGE = 500;
const MAX_WATCH_PROVIDERS = 10;
const MAX_CAST = 5;
const DETAIL_APPEND = "credits,videos,watch/providers";
const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const POSTER_SIZES = new Set(["w92", "w185", "w500"]);
const BACKDROP_SIZES = new Set(["w780", "w1280"]);

/**
 * Error único del cliente TMDB. `code` pertenece al contrato
 * TmdbErrorCode (NO_API_KEY, NETWORK, HTTP_401, HTTP_429, HTTP_404, PARSE).
 */
export class TmdbError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "TmdbError";
    this.code = code;
  }
}

// -------------------------------------------------------------
// Configuración de la clave (ALG-M05)
// -------------------------------------------------------------

function getApiKey() {
  return typeof TMDB_API_KEY === "string" ? TMDB_API_KEY.trim() : "";
}

/** `true` solo si TMDB_API_KEY tiene contenido tras recortar espacios. */
export function isTmdbConfigured() {
  return getApiKey() !== "";
}

/**
 * Sin clave no se hace ninguna petición: se lanza NO_API_KEY antes de
 * tocar `fetch` (ALG-M05).
 */
function assertTmdbConfigured() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new TmdbError(
      "NO_API_KEY",
      "Falta la clave de TMDB: búsqueda desactivada."
    );
  }
  return apiKey;
}

// -------------------------------------------------------------
// Construcción de peticiones
// -------------------------------------------------------------

// Codifica los valores manteniendo comas y barras literales cuando el
// parámetro lo requiere, para que
// append_to_response=credits,videos,watch/providers viaje tal cual.
function encodeValue(value, keepSeparators = false) {
  let encoded = encodeURIComponent(String(value)).replace(/%2C/gi, ",");
  if (keepSeparators) encoded = encoded.replace(/%2F/gi, "/");
  return encoded;
}

/**
 * Toda petición lleva api_key, language=es-ES e include_adult=false.
 * `params` añade los parámetros propios de cada endpoint.
 */
function buildRequestUrl(path, params, apiKey) {
  const query = [
    ["api_key", apiKey],
    ["language", DEFAULT_LANGUAGE],
    ["include_adult", "false"],
    ...params,
  ]
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      const keepSeparators = key === "append_to_response";
      return `${key}=${encodeValue(value, keepSeparators)}`;
    })
    .join("&");

  return `${TMDB_BASE_URL}${path}?${query}`;
}

function toInteger(value, fallback) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizePage(page) {
  const parsed = toInteger(page, DEFAULT_PAGE);
  if (parsed < 1) return DEFAULT_PAGE;
  return Math.min(parsed, MAX_PAGE);
}

function normalizeYear(year) {
  if (year === null || year === undefined || year === "") return null;
  const parsed = toInteger(year, null);
  if (parsed === null || parsed < 1870 || parsed > 2100) return null;
  return parsed;
}

function httpErrorCode(status, notFoundCode) {
  if (status === 401) return "HTTP_401";
  if (status === 429) return "HTTP_429";
  if (status === 404) return notFoundCode;
  return "NETWORK";
}

function httpErrorMessage(code) {
  switch (code) {
    case "HTTP_401":
      return "TMDB rechazó la clave de API (401).";
    case "HTTP_429":
      return "TMDB ha limitado las peticiones (429).";
    case "HTTP_404":
      return "Película no encontrada en TMDB.";
    default:
      return "No se pudo conectar con TMDB.";
  }
}

/**
 * Punto único de acceso a la red.
 *
 * - Timeout de 10 s con AbortController (incluye la lectura del cuerpo).
 * - Los fallos de transporte/tiempo se convierten en NETWORK.
 * - 401/429/404 se mapean a su código; el resto de estados no OK, a NETWORK.
 * - Un cuerpo no JSON o ilegible se convierte en PARSE.
 */
async function requestJson(path, params = [], { notFoundCode = "NETWORK" } = {}) {
  const apiKey = assertTmdbConfigured();
  const url = buildRequestUrl(path, params, apiKey);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = Number(response.status);
      const code = httpErrorCode(status, notFoundCode);
      throw new TmdbError(code, httpErrorMessage(code));
    }

    try {
      return await response.json();
    } catch (error) {
      throw new TmdbError(
        "PARSE",
        "Respuesta no válida de TMDB.",
        { cause: error }
      );
    }
  } catch (error) {
    if (error instanceof TmdbError) throw error;
    // Error de red, CORS, conexión abortada por timeout, etc.
    throw new TmdbError(
      "NETWORK",
      "No se pudo conectar con TMDB.",
      { cause: error }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

// -------------------------------------------------------------
// Normalización de respuestas al contrato
// -------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asReleaseDateOrNull(value) {
  return typeof value === "string" && RELEASE_DATE_PATTERN.test(value)
    ? value
    : null;
}

function asNumberArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => Number.isInteger(item));
}

function normalizeSummary(raw) {
  const originalTitle =
    typeof raw.original_title === "string" ? raw.original_title : "";
  const title =
    typeof raw.title === "string" && raw.title !== ""
      ? raw.title
      : originalTitle;

  return {
    id: raw.id,
    title,
    originalTitle,
    posterPath:
      typeof raw.poster_path === "string" && raw.poster_path !== ""
        ? raw.poster_path
        : null,
    releaseDate: asReleaseDateOrNull(raw.release_date),
    genreIds: asNumberArray(raw.genre_ids),
    overview: typeof raw.overview === "string" ? raw.overview : "",
    voteAverage: asFiniteNumberOrNull(raw.vote_average),
    voteCount: asFiniteNumberOrNull(raw.vote_count),
  };
}

function normalizePagedResult(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.results)) {
    throw new TmdbError("PARSE", "Respuesta no válida de TMDB.");
  }

  const results = payload.results
    .filter((item) => isPlainObject(item) && Number.isFinite(item.id))
    .map(normalizeSummary);

  return {
    page: Math.max(DEFAULT_PAGE, toInteger(payload.page, DEFAULT_PAGE)),
    totalPages: Math.max(0, toInteger(payload.total_pages, 0)),
    results,
  };
}

function pickDirector(credits) {
  if (!isPlainObject(credits) || !Array.isArray(credits.crew)) return null;

  const director = credits.crew.find(
    (member) =>
      isPlainObject(member) &&
      typeof member.job === "string" &&
      member.job.trim().toLowerCase() === "director" &&
      typeof member.name === "string" &&
      member.name.trim() !== ""
  );

  return director ? director.name : null;
}

function pickCast(credits) {
  if (!isPlainObject(credits) || !Array.isArray(credits.cast)) return [];

  return credits.cast
    .filter(
      (member) =>
        isPlainObject(member) &&
        typeof member.name === "string" &&
        member.name.trim() !== ""
    )
    .slice(0, MAX_CAST)
    .map((member) => member.name);
}

function pickTrailerKey(videos) {
  if (!isPlainObject(videos) || !Array.isArray(videos.results)) return null;

  const youtubeVideos = videos.results.filter(
    (video) =>
      isPlainObject(video) &&
      typeof video.site === "string" &&
      video.site.toLowerCase() === "youtube" &&
      typeof video.key === "string" &&
      video.key.trim() !== ""
  );

  if (youtubeVideos.length === 0) return null;

  const trailer = youtubeVideos.find(
    (video) =>
      typeof video.type === "string" &&
      video.type.toLowerCase() === "trailer"
  );

  return (trailer ?? youtubeVideos[0]).key;
}

function pickWatchProviders(payload) {
  const providers = payload["watch/providers"];
  const spain =
    isPlainObject(providers) && isPlainObject(providers.results)
      ? providers.results.ES
      : null;

  if (!isPlainObject(spain)) return [];

  const names = [];
  for (const kind of ["flatrate", "buy", "rent"]) {
    const list = Array.isArray(spain[kind]) ? spain[kind] : [];
    for (const provider of list) {
      if (
        isPlainObject(provider) &&
        typeof provider.provider_name === "string" &&
        provider.provider_name.trim() !== "" &&
        !names.includes(provider.provider_name)
      ) {
        names.push(provider.provider_name);
        if (names.length >= MAX_WATCH_PROVIDERS) return names;
      }
    }
  }

  return names;
}

function normalizeDetail(payload) {
  if (!isPlainObject(payload) || !Number.isFinite(payload.id)) {
    throw new TmdbError("PARSE", "Respuesta no válida de TMDB.");
  }

  const summary = normalizeSummary(payload);

  const genres = Array.isArray(payload.genres)
    ? payload.genres
        .filter(
          (genre) =>
            isPlainObject(genre) &&
            typeof genre.name === "string" &&
            genre.name.trim() !== ""
        )
        .map((genre) => genre.name)
    : [];

  // La ficha puede no traer genre_ids, pero sí genres[].id.
  let genreIds = summary.genreIds;
  if (genreIds.length === 0 && Array.isArray(payload.genres)) {
    genreIds = payload.genres
      .filter((genre) => isPlainObject(genre) && Number.isInteger(genre.id))
      .map((genre) => genre.id);
  }

  return {
    ...summary,
    genreIds,
    backdropPath:
      typeof payload.backdrop_path === "string" && payload.backdrop_path !== ""
        ? payload.backdrop_path
        : null,
    runtime: asFiniteNumberOrNull(payload.runtime),
    genres,
    director: pickDirector(payload.credits),
    cast: pickCast(payload.credits),
    trailerKey: pickTrailerKey(payload.videos),
    watchProviders: pickWatchProviders(payload),
  };
}

// -------------------------------------------------------------
// API pública de red (API-M01..M06)
// -------------------------------------------------------------

/**
 * Búsqueda de películas. El mínimo de 2 caracteres lo garantiza la UI;
 * si llega una consulta más corta no se hace red y se devuelve vacío.
 */
export async function searchMovies(query, year = null, page = 1) {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";

  if (normalizedQuery.length < 2) {
    // Sin clave debe prevalecer NO_API_KEY (ALG-M05), incluso aquí.
    assertTmdbConfigured();
    return { page: DEFAULT_PAGE, totalPages: 0, results: [] };
  }

  const params = [["query", normalizedQuery]];
  const normalizedYear = normalizeYear(year);
  if (normalizedYear !== null) params.push(["year", normalizedYear]);
  params.push(["page", normalizePage(page)]);

  const payload = await requestJson("/search/movie", params);
  return normalizePagedResult(payload);
}

export async function fetchTrendingWeek(page = DEFAULT_PAGE) {
  const payload = await requestJson("/trending/movie/week", [
    ["page", normalizePage(page)],
  ]);
  return normalizePagedResult(payload);
}

export async function fetchPopular(page = DEFAULT_PAGE) {
  const payload = await requestJson("/movie/popular", [
    ["page", normalizePage(page)],
  ]);
  return normalizePagedResult(payload);
}

export async function fetchTopRated(page = DEFAULT_PAGE) {
  const payload = await requestJson("/movie/top_rated", [
    ["page", normalizePage(page)],
  ]);
  return normalizePagedResult(payload);
}

export async function fetchUpcoming(page = DEFAULT_PAGE) {
  const payload = await requestJson("/movie/upcoming", [
    ["page", normalizePage(page)],
  ]);
  return normalizePagedResult(payload);
}

/**
 * Ficha completa con créditos, vídeos y plataformas de España.
 * Un 404 de TMDB se propaga como HTTP_404 (API-M06).
 */
export async function getMovieDetail(tmdbId) {
  // La falta de clave prevalece sobre cualquier validación de entrada.
  assertTmdbConfigured();

  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new TmdbError("HTTP_404", "Identificador de película no válido.");
  }

  const payload = await requestJson(
    `/movie/${tmdbId}`,
    [["append_to_response", DETAIL_APPEND]],
    { notFoundCode: "HTTP_404" }
  );

  return normalizeDetail(payload);
}

// -------------------------------------------------------------
// Helpers de imagen/tráiler (API-M07, API-M08)
// -------------------------------------------------------------

function imageUrl(path, size) {
  if (typeof path !== "string") return null;

  const cleanPath = path.trim();
  if (cleanPath === "" || cleanPath.includes("://")) return null;

  const relativePath = cleanPath.startsWith("/")
    ? cleanPath
    : `/${cleanPath}`;

  return `${TMDB_IMAGE_BASE_URL}/${size}${relativePath}`;
}

/** URL del póster (por defecto w500) o null si no hay ruta. */
export function posterUrl(path, size = "w500") {
  return imageUrl(path, POSTER_SIZES.has(size) ? size : "w500");
}

/** URL del backdrop (por defecto w1280) o null si no hay ruta. */
export function backdropUrl(path, size = "w1280") {
  return imageUrl(path, BACKDROP_SIZES.has(size) ? size : "w1280");
}

/** URL del tráiler en YouTube o null si no hay clave. */
export function trailerUrl(key) {
  if (typeof key !== "string") return null;

  const cleanKey = key.trim();
  if (cleanKey === "") return null;

  return `${TMDB_YOUTUBE_URL}?v=${encodeURIComponent(cleanKey)}`;
}
