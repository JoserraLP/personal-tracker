// =============================================================
// Cliente de búsqueda externa en TMDB (spec 002, T-004).
//
// Cubre API-001 (GET /search/movie), API-002 (GET /search/tv,
// series y anime) y API-003 (GET /movie/{id}, GET /tv/{id}).
//
// CONTRATO COMÚN (§4.1 de spec.md):
//   éxito  → { ok: true, items: SearchResult[] }
//   vacío  → { ok: true, items: [] }
//   fallo  → { ok: false, provider, code, message }
//            code ∈ 'timeout' | 'unauthorized' | 'rate_limited'
//                  | 'not_found' | 'unknown'
//
// SearchResult (autofill parcial, REQ-006):
//   { source, externalId, mediaType, title, year, posterUrl,
//     synopsis, genres[], durationMinutes }
//   · Los campos ausentes se normalizan a null (nunca undefined),
//     de modo que el formulario nunca se bloquea por un dato que
//     falte (AC-003, AC-011).
//   · mediaType usa el enum de REQ-001: 'movie' | 'series' |
//     'anime' (este cliente no devuelve 'game' ni 'book').
//
// El patrón es el de js/api-steam.js: la NORMALIZACIÓN es PURA
// (funciones sin red, testeables en Node) y el fetch vive en
// funciones aparte que devuelven el contrato §4.1.
//
// D-005: el anime se busca en TMDB por /search/tv con el filtro de
// animación (with_genres=16); una serie se marca como 'anime' si
// tiene el género de animación o si es de origen japonés.
// =============================================================

import { TMDB_API_KEY } from "./config.js";

// -------------------------------------------------------------
// Constantes
// -------------------------------------------------------------

export const TMDB_PROVIDER = "tmdb";
export const TMDB_BASE_URL = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
export const TMDB_TIMEOUT_MS = 8000;
export const TMDB_LANGUAGE = "es-ES";
export const TMDB_ANIMATION_GENRE_ID = 16;
export const TMDB_MAX_GENRES = 10;
export const TMDB_SYNOPSIS_MAX = 2000;
export const TMDB_DEFAULT_LIMIT = 10;
export const TMDB_MAX_LIMIT = 20;

// =============================================================
// PARTE PURA (sin red)
// =============================================================

// Normaliza un texto: null/undefined/no string → "".
function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Normaliza un identificador (TMDB usa ids numéricos).
function asId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim();
  return "";
}

// Recorta un texto largo al límite de DB-001 (sinopsis ≤ 2000).
function clampSynopsis(text) {
  const value = asText(text);
  if (!value) return null;
  if (value.length <= TMDB_SYNOPSIS_MAX) return value;
  return `${value.slice(0, TMDB_SYNOPSIS_MAX - 1).trimEnd()}…`;
}

// Primer valor no nulo/no vacío (0 sí cuenta como valor).
function firstPresent(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return null;
}

// Normaliza el límite de resultados pedido por el frontend.
export function clampTmdbLimit(limit) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) return TMDB_DEFAULT_LIMIT;
  return Math.min(Math.floor(value), TMDB_MAX_LIMIT);
}

// URL del póster de TMDB: https://image.tmdb.org/t/p/w500{poster_path}.
// Sin poster_path → null (autofill parcial).
export function tmdbPosterUrl(posterPath) {
  const path = asText(posterPath);
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${TMDB_IMAGE_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

// "1999-12-15" → 1999. Valor inválido → null.
export function tmdbYear(dateValue) {
  const text = asText(dateValue);
  if (!text) return null;
  const match = /^(\d{4})/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

// Géneros de TMDB → string[] (nombres, sin duplicados, máx. 10).
// Acepta tanto [{id, name}] como ["Acción"].
export function tmdbGenreNames(genres) {
  const list = Array.isArray(genres) ? genres : [];
  const names = list
    .map((genre) => {
      if (genre && typeof genre === "object") return asText(genre.name);
      return asText(genre);
    })
    .filter((name) => name !== "");
  return Array.from(new Set(names)).slice(0, TMDB_MAX_GENRES);
}

// ¿Es anime? (D-005) → género de animación (16) u origen japonés
// (origin_country "JP" / original_language "ja").
export function isAnimeMedia(raw) {
  if (!raw || typeof raw !== "object") return false;

  const genreIds = Array.isArray(raw.genre_ids)
    ? raw.genre_ids.map((id) => Number(id))
    : [];
  const genres = Array.isArray(raw.genres) ? raw.genres : [];
  const hasAnimation =
    genreIds.includes(TMDB_ANIMATION_GENRE_ID) ||
    genres.some(
      (genre) =>
        genre &&
        typeof genre === "object" &&
        (Number(genre.id) === TMDB_ANIMATION_GENRE_ID ||
          /animaci/i.test(asText(genre.name)))
    );

  const countries = Array.isArray(raw.origin_country)
    ? raw.origin_country
    : raw.origin_country
      ? [raw.origin_country]
      : [];
  const japaneseOrigin = countries.some(
    (code) => asText(code).toUpperCase() === "JP"
  );
  const japaneseLanguage =
    asText(raw.original_language).toLowerCase() === "ja";

  return hasAnimation || japaneseOrigin || japaneseLanguage;
}

// Duración de una película: runtime (minutos) → number | null.
export function tmdbMovieDuration(raw) {
  const runtime = raw && Number(raw.runtime);
  return Number.isFinite(runtime) && runtime > 0 ? runtime : null;
}

// Duración de una serie: episode_run_time[0] (y luego runtime)
// → number | null (AC-011).
export function tmdbTvDuration(raw) {
  if (!raw || typeof raw !== "object") return null;
  const episodes = Array.isArray(raw.episode_run_time)
    ? raw.episode_run_time
    : [];
  for (const minutes of episodes) {
    const value = Number(minutes);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const runtime = Number(raw.runtime);
  return Number.isFinite(runtime) && runtime > 0 ? runtime : null;
}

// Normaliza una película de TMDB → SearchResult (API-001/003).
export function normalizeTmdbMovie(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    source: TMDB_PROVIDER,
    externalId: source.id === null || source.id === undefined ? "" : String(source.id),
    mediaType: "movie",
    title: firstPresent(asText(source.title), asText(source.original_title)) || "",
    year: tmdbYear(source.release_date),
    posterUrl: tmdbPosterUrl(source.poster_path),
    synopsis: clampSynopsis(source.overview),
    genres: tmdbGenreNames(source.genres),
    durationMinutes: tmdbMovieDuration(source),
  };
}

// Normaliza una serie de TMDB → SearchResult (API-002/003).
// mediaType: 'anime' si es anime (D-005), si no 'series'.
export function normalizeTmdbTv(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    source: TMDB_PROVIDER,
    externalId: source.id === null || source.id === undefined ? "" : String(source.id),
    mediaType: isAnimeMedia(source) ? "anime" : "series",
    title: firstPresent(asText(source.name), asText(source.original_name)) || "",
    year: tmdbYear(source.first_air_date),
    posterUrl: tmdbPosterUrl(source.poster_path),
    synopsis: clampSynopsis(source.overview),
    genres: tmdbGenreNames(source.genres),
    durationMinutes: tmdbTvDuration(source),
  };
}

// Combina el resultado de la búsqueda con el detalle:
// el detalle rellena los campos que la búsqueda no traía
// (géneros, duración) sin perder datos de la búsqueda.
export function mergeTmdbItem(base, detail) {
  if (!detail) return base;
  if (!base) return detail;
  return {
    source: TMDB_PROVIDER,
    externalId: firstPresent(base.externalId, detail.externalId) || "",
    mediaType:
      detail.mediaType === "anime" || base.mediaType === "anime"
        ? "anime"
        : base.mediaType || detail.mediaType,
    title: firstPresent(base.title, detail.title) || "",
    year: firstPresent(base.year, detail.year),
    posterUrl: firstPresent(base.posterUrl, detail.posterUrl),
    synopsis: firstPresent(base.synopsis, detail.synopsis),
    genres:
      Array.isArray(detail.genres) && detail.genres.length > 0
        ? detail.genres
        : Array.isArray(base.genres)
          ? base.genres
          : [],
    durationMinutes: firstPresent(
      base.durationMinutes,
      detail.durationMinutes
    ),
  };
}

// URL de búsqueda: '/search/movie' o '/search/tv'
// (kind 'anime' usa /search/tv + with_genres=16, D-005).
export function tmdbSearchUrl(kind, query, options = {}) {
  const path = kind === "movie" ? "/search/movie" : "/search/tv";
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    query: asText(query),
    language: asText(options.language) || TMDB_LANGUAGE,
    include_adult: "false",
    page: "1",
  });
  if (kind === "anime") {
    params.set("with_genres", String(TMDB_ANIMATION_GENRE_ID));
  }
  return `${TMDB_BASE_URL}${path}?${params.toString()}`;
}

// URL de detalle: '/movie/{id}' o '/tv/{id}' (API-003).
export function tmdbDetailUrl(kind, id) {
  const path = kind === "movie" ? "/movie" : "/tv";
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: TMDB_LANGUAGE,
  });
  return `${TMDB_BASE_URL}${path}/${encodeURIComponent(asId(id))}?${params.toString()}`;
}

// =============================================================
// PARTE CON RED (fetch + contrato §4.1)
// =============================================================

// Traduce un status HTTP a un code del contrato §4.1.
function statusToCode(status) {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "unknown";
}

// ¿El error es una cancelación por AbortController (timeout)?
function isAbortError(err) {
  if (!err) return false;
  return err.name === "AbortError" || err.code === 20;
}

// Error normalizado §4.1.
function tmdbError(code, message) {
  return { ok: false, provider: TMDB_PROVIDER, code, message };
}

// Mensaje de error de la API de TMDB ({status_message}).
function apiErrorMessage(data) {
  if (data && typeof data === "object") {
    const message = asText(data.status_message) || asText(data.message);
    if (message) return message;
  }
  return "";
}

// Petición JSON con timeout (AbortController, ~8 s).
async function requestJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || TMDB_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body || undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: statusToCode(res.status),
        message:
          apiErrorMessage(data) ||
          `TMDB respondió HTTP ${res.status}.`,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    if (isAbortError(err)) {
      return {
        ok: false,
        status: 0,
        code: "timeout",
        message: `TMDB no respondió a tiempo (${Math.round(timeoutMs / 1000)} s).`,
      };
    }
    return {
      ok: false,
      status: 0,
      code: "unknown",
      message: `No se pudo consultar TMDB: ${err && err.message ? err.message : "error de red"}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Detalle de una película o serie (API-003).
// → { ok: true, item } | { ok: false, provider, code, message }
export async function fetchTmdbDetail(kind, id) {
  const tmdbId = asId(id);
  if (!tmdbId) {
    return tmdbError("not_found", "Falta el identificador de TMDB.");
  }
  if (!TMDB_API_KEY) {
    return tmdbError(
      "unauthorized",
      "Falta TMDB_API_KEY en js/config.js."
    );
  }
  const res = await requestJson(tmdbDetailUrl(kind, tmdbId));
  if (!res.ok) {
    return tmdbError(res.code, res.message);
  }
  const item =
    kind === "movie" ? normalizeTmdbMovie(res.data) : normalizeTmdbTv(res.data);
  return { ok: true, item };
}

// Detalle de una película (API-003).
export async function fetchTmdbMovieDetail(id) {
  return fetchTmdbDetail("movie", id);
}

// Detalle de una serie (API-003).
export async function fetchTmdbTvDetail(id) {
  return fetchTmdbDetail("tv", id);
}

// Enriquece los resultados con el detalle (géneros + duración).
// Si un detalle falla, el ítem se conserva con los datos parciales
// de la búsqueda: nunca se pierde un resultado por un fallo puntual.
async function enrichWithDetails(items, kind, options) {
  const limit = clampTmdbLimit(
    options.detailLimit === undefined ? items.length : options.detailLimit
  );
  const targets = items.slice(0, limit);
  const details = await Promise.all(
    targets.map(async (item) => {
      try {
        const res = await fetchTmdbDetail(kind, item.externalId);
        return res.ok ? res.item : null;
      } catch {
        return null;
      }
    })
  );
  return targets.map((item, index) => mergeTmdbItem(item, details[index]));
}

// Búsqueda genérica en TMDB.
// kind: 'movie' (API-001) | 'tv' (API-002) | 'anime' (API-002 + D-005).
// options: { limit = 10, withDetails = true, detailLimit = limit }
// → { ok: true, items } | { ok: false, provider, code, message }
export async function searchTmdb(kind, query, options = {}) {
  const term = asText(query);
  if (!term) return { ok: true, items: [] };
  if (!TMDB_API_KEY) {
    return tmdbError("unauthorized", "Falta TMDB_API_KEY en js/config.js.");
  }

  const res = await requestJson(tmdbSearchUrl(kind, term, options));
  if (!res.ok) {
    return tmdbError(res.code, res.message);
  }

  const results =
    res.data && Array.isArray(res.data.results) ? res.data.results : [];
  const limit = clampTmdbLimit(options.limit);
  let items = results
    .slice(0, limit)
    .map((raw) =>
      kind === "movie" ? normalizeTmdbMovie(raw) : normalizeTmdbTv(raw)
    );
  if (kind === "anime") {
    items = items.map((item) => ({ ...item, mediaType: "anime" }));
  }
  if (options.withDetails !== false) {
    items = await enrichWithDetails(items, kind === "movie" ? "movie" : "tv", options);
  }
  return { ok: true, items };
}

// Búsqueda de películas (API-001).
export async function searchTmdbMovies(query, options = {}) {
  return searchTmdb("movie", query, options);
}

// Búsqueda de series (API-002). El anime se marca solo (D-005).
export async function searchTmdbTv(query, options = {}) {
  return searchTmdb("tv", query, options);
}

// Búsqueda de anime (API-002 + D-005): /search/tv filtrado por
// animación; todos los resultados vuelven como mediaType 'anime'.
export async function searchTmdbAnime(query, options = {}) {
  return searchTmdb("anime", query, options);
}
