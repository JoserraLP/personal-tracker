// =============================================================
// Cliente de TMDB API v3 para series de TV (API-S01..S09, ALG-S05,
// ALG-S07, NFR-S04).
//
// Único punto de red del cambio «series». Es independiente de
// `js/movies/tmdbClient.js`: no se importa nada de `js/movies/*`
// (aislamiento por categoría). Todas las URL de imágenes y de
// tráiler se construyen aquí; no se importan URLs de CDN (REQ-C1).
//
// Contratos: TmdbSeriesSummary, TmdbSeriesDetail, TmdbSeasonDetail,
// TmdbPagedResult, TmdbEpisodeSummary y TmdbError (ver
// openspec/changes/series/specs-delta.md).
// =============================================================

import { TMDB_API_KEY } from "../config.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const TMDB_YOUTUBE_URL = "https://www.youtube.com/watch";

const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_LANGUAGE = "es-ES";
const DEFAULT_PAGE = 1;
const MAX_PAGE = 500;
const MAX_NETWORKS = 10;
const MAX_CREATORS = 10;
const MAX_CAST = 5;
const MAX_WATCH_PROVIDERS = 10;
const MAX_SEASON_CACHE_ENTRIES = 50;
const DETAIL_APPEND = "credits,videos,watch/providers";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SPECIAL_SEASON_NAMES = new Set(["especiales", "specials"]);

const POSTER_SIZES = new Set(["w92", "w185", "w500"]);
const BACKDROP_SIZES = new Set(["w780", "w1280"]);
const STILL_SIZES = new Set(["w185", "w300"]);

// -------------------------------------------------------------
// Error único del cliente (ALG-S05)
// -------------------------------------------------------------

/**
 * Error del cliente TMDB. `code` pertenece al contrato TmdbErrorCode.
 */
export class TmdbError extends Error {
  /**
   * @param {"NO_API_KEY"|"NETWORK"|"HTTP_401"|"HTTP_429"|"HTTP_404"|"PARSE"} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "TmdbError";
    this.code = code;
  }
}

// -------------------------------------------------------------
// Configuración de la clave (ALG-S05)
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
 * tocar `fetch` (ALG-S05, AC-S01).
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

// Codifica manteniendo comas y barras literales cuando el parámetro lo
// requiere, para que append_to_response=credits,videos,watch/providers
// viaje tal cual.
function encodeValue(value, keepSeparators = false) {
  let encoded = encodeURIComponent(String(value)).replace(/%2C/gi, ",");
  if (keepSeparators) encoded = encoded.replace(/%2F/gi, "/");
  return encoded;
}

/**
 * Toda petición lleva api_key, language=es-ES e include_adult=false
 * (NFR-S04). `params` añade los parámetros propios de cada endpoint.
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
      return "Serie no encontrada en TMDB.";
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
async function requestJson(
  path,
  params = [],
  { notFoundCode = "NETWORK", notFoundMessage = "Serie no encontrada en TMDB." } = {}
) {
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
      const code = httpErrorCode(Number(response.status), notFoundCode);
      throw new TmdbError(
        code,
        code === "HTTP_404" && notFoundCode === "HTTP_404"
          ? notFoundMessage
          : httpErrorMessage(code)
      );
    }

    try {
      return await response.json();
    } catch (error) {
      // Un abort durante la lectura del cuerpo es un timeout, no un JSON
      // inválido (NFR-S04): se reporta como NETWORK.
      if (controller.signal.aborted) {
        throw new TmdbError("NETWORK", "No se pudo conectar con TMDB.", {
          cause: error,
        });
      }
      throw new TmdbError("PARSE", "Respuesta no válida de TMDB.", {
        cause: error,
      });
    }
  } catch (error) {
    if (error instanceof TmdbError) throw error;
    // Error de red, CORS, conexión abortada por timeout, etc.
    throw new TmdbError("NETWORK", "No se pudo conectar con TMDB.", {
      cause: error,
    });
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

function asPositiveNumberOrNull(value) {
  const parsed = asFiniteNumberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function asDateOrNull(value) {
  return typeof value === "string" && DATE_PATTERN.test(value) ? value : null;
}

function asIntegerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function asNumberArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => Number.isInteger(item));
}

function asPathOrNull(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asNameArray(value, limit) {
  if (!Array.isArray(value)) return [];
  const names = [];
  for (const item of value) {
    if (
      isPlainObject(item) &&
      typeof item.name === "string" &&
      item.name.trim() !== "" &&
      !names.includes(item.name)
    ) {
      names.push(item.name);
      if (names.length >= limit) break;
    }
  }
  return names;
}

function normalizeSummary(raw) {
  const originalName =
    typeof raw.original_name === "string" ? raw.original_name : "";
  const name =
    typeof raw.name === "string" && raw.name.trim() !== ""
      ? raw.name
      : originalName;

  return {
    id: raw.id,
    name,
    originalName,
    posterPath: asPathOrNull(raw.poster_path),
    firstAirDate: asDateOrNull(raw.first_air_date),
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

function pickSeasons(payload) {
  if (!Array.isArray(payload.seasons)) return [];

  return payload.seasons
    .filter((season) => {
      if (!isPlainObject(season) || !Number.isInteger(season.season_number)) {
        return false;
      }
      // Sin especiales: season_number > 0 y nombre detectable.
      if (season.season_number <= 0) return false;
      if (
        typeof season.name === "string" &&
        SPECIAL_SEASON_NAMES.has(season.name.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    })
    .map((season) => ({
      seasonNumber: season.season_number,
      name:
        typeof season.name === "string" && season.name.trim() !== ""
          ? season.name
          : `Temporada ${season.season_number}`,
      airDate: asDateOrNull(season.air_date),
      episodeCount:
        Number.isInteger(season.episode_count) && season.episode_count >= 0
          ? season.episode_count
          : 0,
    }))
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
}

/**
 * `episodeRuntime` sale de `episode_run_time[0]` (DB-S01). La media con la
 * temporada 1 es responsabilidad del repositorio, que es quien la carga
 * (D-S13); aquí se devuelve null si TMDB no lo aporta.
 */
function pickEpisodeRuntime(payload) {
  if (!Array.isArray(payload.episode_run_time)) return null;
  return asPositiveNumberOrNull(payload.episode_run_time[0]);
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
    backdropPath: asPathOrNull(payload.backdrop_path),
    numberOfSeasons: asIntegerOrNull(payload.number_of_seasons),
    numberOfEpisodes: asIntegerOrNull(payload.number_of_episodes),
    tmdbStatus:
      typeof payload.status === "string" && payload.status.trim() !== ""
        ? payload.status
        : null,
    networks: asNameArray(payload.networks, MAX_NETWORKS),
    episodeRuntime: pickEpisodeRuntime(payload),
    genres,
    creators: asNameArray(payload.created_by, MAX_CREATORS),
    cast: pickCast(payload.credits),
    trailerKey: pickTrailerKey(payload.videos),
    watchProviders: pickWatchProviders(payload),
    seasons: pickSeasons(payload),
  };
}

function normalizeEpisode(raw, seasonNumber) {
  return {
    seasonNumber: Number.isInteger(raw.season_number)
      ? raw.season_number
      : seasonNumber,
    episodeNumber: raw.episode_number,
    name: typeof raw.name === "string" ? raw.name : "",
    overview: typeof raw.overview === "string" ? raw.overview : "",
    airDate: asDateOrNull(raw.air_date),
    runtime: asPositiveNumberOrNull(raw.runtime),
    stillPath: asPathOrNull(raw.still_path),
    voteAverage: asFiniteNumberOrNull(raw.vote_average),
  };
}

function normalizeSeasonDetail(payload, seasonNumber) {
  if (!isPlainObject(payload) || !Array.isArray(payload.episodes)) {
    throw new TmdbError("PARSE", "Respuesta no válida de TMDB.");
  }

  const episodes = payload.episodes
    .filter(
      (episode) =>
        isPlainObject(episode) && Number.isInteger(episode.episode_number)
    )
    .map((episode) => normalizeEpisode(episode, seasonNumber))
    .sort((a, b) => a.episodeNumber - b.episodeNumber);

  return {
    id: Number.isFinite(payload.id) ? payload.id : 0,
    name:
      typeof payload.name === "string" && payload.name.trim() !== ""
        ? payload.name
        : `Temporada ${seasonNumber}`,
    seasonNumber: Number.isInteger(payload.season_number)
      ? payload.season_number
      : seasonNumber,
    episodes,
  };
}

// -------------------------------------------------------------
// API pública de red (API-S01..S07)
// -------------------------------------------------------------

/**
 * Búsqueda de series. El mínimo de 2 caracteres lo garantiza la UI
 * (debounce 300 ms); una consulta más corta no hace red y devuelve vacío,
 * pero sin clave prevalece NO_API_KEY (ALG-S05).
 */
export async function searchSeries(query, firstAirYear = null, page = DEFAULT_PAGE) {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";

  if (normalizedQuery.length < 2) {
    assertTmdbConfigured();
    return { page: normalizePage(page), totalPages: 0, results: [] };
  }

  const params = [["query", normalizedQuery]];
  const normalizedYear = normalizeYear(firstAirYear);
  if (normalizedYear !== null) {
    params.push(["first_air_date_year", normalizedYear]);
  }
  params.push(["page", normalizePage(page)]);

  const payload = await requestJson("/search/tv", params);
  return normalizePagedResult(payload);
}

export async function fetchTrendingWeek(page = DEFAULT_PAGE) {
  const payload = await requestJson("/trending/tv/week", [
    ["page", normalizePage(page)],
  ]);
  return normalizePagedResult(payload);
}

export async function fetchPopularSeries(page = DEFAULT_PAGE) {
  const payload = await requestJson("/tv/popular", [
    ["page", normalizePage(page)],
  ]);
  return normalizePagedResult(payload);
}

export async function fetchTopRatedSeries(page = DEFAULT_PAGE) {
  const payload = await requestJson("/tv/top_rated", [
    ["page", normalizePage(page)],
  ]);
  return normalizePagedResult(payload);
}

export async function fetchOnTheAir(page = DEFAULT_PAGE) {
  const payload = await requestJson("/tv/on_the_air", [
    ["page", normalizePage(page)],
  ]);
  return normalizePagedResult(payload);
}

/**
 * Ficha completa con créditos, vídeos y plataformas de España.
 * Un 404 real de TMDB se propaga como HTTP_404 (API-S06); HTTP_404 queda
 * reservado a respuestas de TMDB, así que un id inválido lanza
 * TmdbError("PARSE") sin tocar la red. No cachea aquí: la persistencia es
 * del repositorio (`detailCachedAt`, ALG-S06).
 */
export async function getSeriesDetail(seriesId) {
  // La falta de clave prevalece sobre cualquier validación de entrada.
  assertTmdbConfigured();

  if (!Number.isInteger(seriesId) || seriesId <= 0) {
    throw new TmdbError("PARSE", "Identificador de serie no válido.");
  }

  const payload = await requestJson(
    `/tv/${seriesId}`,
    [["append_to_response", DETAIL_APPEND]],
    { notFoundCode: "HTTP_404" }
  );

  return normalizeDetail(payload);
}

// -------------------------------------------------------------
// Caché de temporada en memoria (ALG-S07)
// -------------------------------------------------------------

/**
 * Caché de temporada de sesión, acotada (ALG-S07, NFR-S04): como máximo
 * `MAX_SEASON_CACHE_ENTRIES` entradas. Al insertar con la caché llena se
 * descarta la entrada más antigua (orden de inserción del Map).
 * @type {Map<string, import("./tmdbTvClient.js").TmdbSeasonDetail>}
 */
const seasonCache = new Map();

function seasonCacheKey(seriesId, seasonNumber) {
  return `${seriesId}:${seasonNumber}`;
}

function cacheSeasonDetail(key, season) {
  if (seasonCache.size >= MAX_SEASON_CACHE_ENTRIES) {
    const oldestKey = seasonCache.keys().next().value;
    if (oldestKey !== undefined) seasonCache.delete(oldestKey);
  }
  seasonCache.set(key, season);
}

/** Vacía la caché de temporadas (solo pruebas/depuración). */
export function clearSeasonCache() {
  seasonCache.clear();
}

/**
 * Temporada completa. Se cachea en memoria por `seriesId:seasonNumber`
 * durante la sesión (ALG-S07, NFR-S04, AC-S29): no se persiste y los
 * fallos no se cachean. Un id inválido lanza TmdbError("PARSE") sin
 * tocar la red; HTTP_404 solo refleja un 404 real de TMDB.
 */
export async function getSeasonDetail(seriesId, seasonNumber) {
  // La falta de clave prevalece sobre cualquier validación de entrada.
  assertTmdbConfigured();

  if (!Number.isInteger(seriesId) || seriesId <= 0) {
    throw new TmdbError("PARSE", "Identificador de serie no válido.");
  }
  if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) {
    throw new TmdbError("PARSE", "Número de temporada no válido.");
  }

  const key = seasonCacheKey(seriesId, seasonNumber);
  const cached = seasonCache.get(key);
  if (cached !== undefined) return cached;

  const payload = await requestJson(
    `/tv/${seriesId}/season/${seasonNumber}`,
    [],
    {
      notFoundCode: "HTTP_404",
      notFoundMessage: "Temporada no encontrada en TMDB.",
    }
  );

  const season = normalizeSeasonDetail(payload, seasonNumber);
  cacheSeasonDetail(key, season);
  return season;
}

// -------------------------------------------------------------
// Helpers de imagen/tráiler (API-S08, API-S09)
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

/** URL del still de episodio (por defecto w300) o null si no hay ruta. */
export function stillUrl(path, size = "w300") {
  return imageUrl(path, STILL_SIZES.has(size) ? size : "w300");
}

/** URL del tráiler en YouTube o null si no hay clave. */
export function trailerUrl(key) {
  if (typeof key !== "string") return null;

  const cleanKey = key.trim();
  if (cleanKey === "") return null;

  return `${TMDB_YOUTUBE_URL}?v=${encodeURIComponent(cleanKey)}`;
}
