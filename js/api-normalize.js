// =============================================================
// Normalizadores de APIs externas → `MediaItemInput` (puente puro).
//
// Specs:
//   · specs/02-catalog-search.md — REQ-108 (alta/importación desde
//     TMDB, Google Books, IGDB/Steam) y API-001..005 de la spec 002
//     (contrato §4.1: { ok:true, items } | { ok:false, provider,
//     code, message }).
//   · specs/01-data-model.md — DB-120 (`validateMediaItem`) +
//     DB-101/DB-102 (campos de `MediaItem` y `MediaMetadata`).
//   · specs/00-overview.md — REQ-E1/E2/E4 (`Result<T>` en §4.1;
//     un fallo de API externa NUNCA bloquea el alta manual).
//
// Diseño:
//   1) Reutiliza los normalizadores crudos ya existentes
//      (`normalizeTmdbMovie/Tv`, `normalizeBook`, `normalizeIgdbGame`)
//      y solo adapta su `SearchResult` al modelo `catalog`.
//   2) Todo es PURO: sin red, sin Firebase y sin DOM; se importa en
//      Node/vitest directamente.
//   3) Ninguna función lanza: cada una devuelve un `Result`
//      ({ ok:true, value } | { ok:false, code, message }), de modo
//      que la UI puede seguir con el alta manual (REQ-E4).
//
// `MediaItemInput` (DB-101/DB-102) construido aquí:
//   { mediaType, title, coverUrl, releaseYear, genres, avgRating,
//     creator, synopsis, metadata, seed:false }
//   · `metadata.kind` SIEMPRE coherente con `mediaType` (DB-102).
//   · Los campos opcionales inválidos → null/[] (nunca bloquean).
//   · `title` y `metadata` son obligatorios: si faltan, `validation`.
//
// Uso típico:
//   const res = await searchTmdbMovies("dune");
//   const normalized = normalizeApiItems(res, { provider: "tmdb" });
//   // fallo de red → { ok:false, code:"unavailable" } y el formulario
//   // de alta manual sigue disponible (REQ-E4).
// =============================================================

import {
  MEDIA_ITEM_TYPES,
  metadataKindFor,
  validateMediaItem,
} from "./catalog.js";

import {
  isAnimeMedia,
  normalizeTmdbMovie,
  normalizeTmdbTv,
  tmdbDirectorName,
  tmdbTvCreator,
} from "./api-tmdb.js";

import { normalizeBook } from "./api-books.js";

import {
  igdbCompanyNames,
  igdbPublisherName,
  normalizeIgdbGame,
} from "./api-games.js";

// -------------------------------------------------------------
// 1. Constantes y límites (DB-101, DB-102)
// -------------------------------------------------------------

/** Proveedores externos soportados (REQ-108). */
export const API_NORMALIZE_PROVIDERS = Object.freeze([
  "tmdb",
  "googlebooks",
  "igdb",
  "steam",
]);

/** Códigos de `Result` de 00-overview §4.1. */
export const API_RESULT_CODES = Object.freeze([
  "not_found",
  "permission_denied",
  "validation",
  "unavailable",
  "unknown",
]);

/** Límites del modelo `catalog` (DB-101/DB-102). */
const LIMITS = Object.freeze({
  TITLE_MAX: 200,
  YEAR_MIN: 1888,
  YEAR_MAX: 2100,
  GENRES_MAX: 10,
  AVG_RATING_MIN: 0,
  AVG_RATING_MAX: 10,
  CREATOR_MAX: 120,
  SYNOPSIS_MAX: 2000,
  PLATFORMS_MAX: 8,
});

/**
 * Equivalencias con el enum legacy de la spec 002 (§1) y alias
 * habituales de las APIs (`tv`). `MEDIA_ITEM_TYPES` es la fuente
 * única (REQ-C6): este mapa solo traduce datos de entrada.
 */
const MEDIA_TYPE_ALIASES = Object.freeze({
  movie: "MOVIE",
  series: "SERIES",
  tv: "SERIES",
  show: "SERIES",
  anime: "ANIME",
  game: "GAME",
  videogame: "GAME",
  book: "BOOK",
  manga: "MANGA",
  audiobook: "AUDIOBOOK",
});

// -------------------------------------------------------------
// 2. Utilidades internas (puras)
// -------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(obj, key) {
  return isPlainObject(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function firstPresent(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const num = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

/** Texto recortado y truncado a `max`; vacío/no textual → null. */
function toTrimmedText(value, max = LIMITS.TITLE_MAX) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Lista de textos recortados, sin duplicados, máx. `max`. */
function toStringList(value, max) {
  if (!Array.isArray(value)) return [];
  const list = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const text = entry.trim();
    if (!text || list.includes(text)) continue;
    list.push(text);
    if (list.length >= max) break;
  }
  return list;
}

/** URL http/https válida o null (DB-101). */
function toHttpUrl(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^https?:\/\/\S+$/i.test(text) ? text : null;
}

/** Entero dentro de [min, max] o null (ausente → null). */
function toIntInRange(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  const int = Math.trunc(num);
  return int >= min && int <= max ? int : null;
}

/**
 * Número finito en (0, 10], redondeado a 1 decimal, o null.
 * `0` se trata como «sin valoración» (TMDB devuelve 0 sin votos).
 */
function toRating(value) {
  const num = firstFiniteNumber(value);
  if (num === null || num <= LIMITS.AVG_RATING_MIN || num > LIMITS.AVG_RATING_MAX) {
    return null;
  }
  return Math.round(num * 10) / 10;
}

/**
 * Normaliza cualquier variante de tipo de medio al enum `MediaType`
 * del modelo (7 tipos). Desconocido → null.
 * @param {*} value
 * @returns {string|null}
 */
export function toMediaItemType(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (MEDIA_ITEM_TYPES.includes(upper)) return upper;
  return MEDIA_TYPE_ALIASES[text.toLowerCase()] ?? null;
}

/**
 * `Result` de fallo (00-overview §4.1 + contrato §4.1 de la spec 002,
 * REQ-E2). `provider` queda siempre presente (REQ-E4: la UI sabe qué
 * API falló y puede ofrecer el alta manual).
 */
export function apiFailure(code, message, errors, provider) {
  const normalizedCode = API_RESULT_CODES.includes(code) ? code : "unknown";
  const providerName =
    typeof provider === "string" && provider.trim() ? provider.trim() : "unknown";
  const result = {
    ok: false,
    provider: providerName,
    code: normalizedCode,
    message:
      typeof message === "string" && message.trim()
        ? message.trim()
        : "No se pudo normalizar el resultado de la API externa.",
  };
  if (Array.isArray(errors) && errors.length > 0) result.errors = errors.slice();
  return result;
}

/** `Result` de éxito (00-overview §4.1). */
export function apiSuccess(value, extra) {
  return { ok: true, value, ...(isPlainObject(extra) ? extra : {}) };
}

/**
 * Traduce los códigos del contrato de las APIs (§4.1 de la spec 002)
 * a los códigos de `Result` de 00-overview §4.1.
 */
export function toApiResultCode(code) {
  const key = typeof code === "string" ? code.trim().toLowerCase() : "";
  switch (key) {
    case "timeout":
    case "rate_limited":
    case "network":
    case "offline":
    case "unavailable":
      return "unavailable";
    case "unauthorized":
    case "forbidden":
    case "permission_denied":
      return "permission_denied";
    case "not_found":
      return "not_found";
    case "validation":
      return "validation";
    case "unknown":
      return "unknown";
    default:
      return "unknown";
  }
}

// -------------------------------------------------------------
// 3. `SearchResult` → `MediaItemInput` (DB-101/DB-102)
// -------------------------------------------------------------

/**
 * `metadata` discriminada por tipo (DB-102, AC-104), con defaults que
 * siempre pasan `validateMediaItem`:
 *   SERIES/ANIME → episodes · MANGA/BOOK → pages ·
 *   MOVIE/AUDIOBOOK → duration (durationMinutes 0 si desconocida) ·
 *   GAME → platforms.
 */
export function buildMediaMetadata(mediaType, result = {}) {
  const kind = metadataKindFor(mediaType);
  const source = isPlainObject(result) ? result : {};

  if (kind === "episodes") {
    const metadata = { kind };
    const totalEpisodes = toIntInRange(
      firstPresent(source.totalEpisodes, source.number_of_episodes),
      1,
      Number.MAX_SAFE_INTEGER,
    );
    if (totalEpisodes !== null) metadata.totalEpisodes = totalEpisodes;
    const currentAvailable = toIntInRange(source.currentAvailable, 1, Number.MAX_SAFE_INTEGER);
    if (currentAvailable !== null) metadata.currentAvailable = currentAvailable;
    return metadata;
  }

  if (kind === "pages") {
    const metadata = { kind };
    const totalPages = toIntInRange(
      firstPresent(source.pagesTotal, source.pageCount, source.totalPages),
      0,
      Number.MAX_SAFE_INTEGER,
    );
    if (totalPages !== null) metadata.totalPages = totalPages;
    const totalChapters = toIntInRange(source.totalChapters, 1, Number.MAX_SAFE_INTEGER);
    if (totalChapters !== null) metadata.totalChapters = totalChapters;
    return metadata;
  }

  if (kind === "duration") {
    // DB-102: durationMinutes es OBLIGATORIO para kind "duration";
    // si la API no lo trae se usa 0 (dato pendiente de completar).
    const minutes = firstFiniteNumber(
      source.durationMinutes,
      source.runtime,
      source.audiobookMinutes,
    );
    return { kind, durationMinutes: minutes !== null && minutes >= 0 ? minutes : 0 };
  }

  if (kind === "platforms") {
    const hours = firstFiniteNumber(source.playtimeHours, source.totalHours);
    return {
      kind,
      platforms: toPlatformList(source.platforms),
      ...(hours !== null ? { totalHours: Math.max(0, hours) } : {}),
    };
  }

  // Tipo inválido: validateMediaItem reportará el error.
  return { kind: null };
}

/** Plataformas de `metadata` (DB-102): ≤8, sin duplicados. */
function toPlatformList(value) {
  if (Array.isArray(value) && value.length > 0) {
    return toStringList(value, LIMITS.PLATFORMS_MAX);
  }
  return [];
}

/**
 * Resuelve el `creator` (DB-101, ≤120) de un resultado:
 * `creator` explícito → autor → director → publisher.
 */
function resolveCreator(result, fallback) {
  const candidate = firstPresent(
    result.creator,
    result.author,
    typeof result.director === "string" ? result.director : null,
    fallback,
  );
  return toTrimmedText(candidate, LIMITS.CREATOR_MAX);
}

/**
 * Convierte un `SearchResult` (contrato §4.1 de la spec 002) en un
 * `MediaItemInput` validado con `validateMediaItem` (DB-120).
 * Nunca lanza (REQ-E1/E4).
 *
 * @param {object} result
 * @param {{ mediaType?: string, creator?: string }} [options]
 * @returns {{ok:true, value:object}|{ok:false, code:string, message:string, errors?:string[]}}
 */
export function toMediaItemInput(result, options = {}) {
  const opts = isPlainObject(options) ? options : {};
  if (!isPlainObject(result)) {
    return apiFailure(
      "validation",
      "El resultado de la API debe ser un objeto.",
      ["El resultado de la API debe ser un objeto."],
      opts.provider,
    );
  }
  const mediaType = toMediaItemType(opts.mediaType ?? result.mediaType);
  const title = toTrimmedText(firstPresent(result.title, result.name), LIMITS.TITLE_MAX);
  const genres = toStringList(result.genres, LIMITS.GENRES_MAX);

  const input = {
    ...(mediaType ? { mediaType } : {}),
    ...(title ? { title } : {}),
    coverUrl: toHttpUrl(firstPresent(result.coverUrl, result.posterUrl, result.cover)),
    releaseYear: toIntInRange(
      firstPresent(result.releaseYear, result.year),
      LIMITS.YEAR_MIN,
      LIMITS.YEAR_MAX,
    ),
    genres,
    avgRating: toRating(firstPresent(result.avgRating, result.vote_average)),
    creator: resolveCreator(result, opts.creator),
    synopsis: toTrimmedText(
      firstPresent(result.synopsis, result.overview, result.description),
      LIMITS.SYNOPSIS_MAX,
    ),
    seed: false,
  };

  if (mediaType) {
    const generated = buildMediaMetadata(mediaType, result);
    // `metadata` explícita (alta manual) completa los defaults; si no
    // es coherente, `validateMediaItem` la rechaza (DB-102).
    input.metadata = isPlainObject(result.metadata)
      ? { ...generated, ...result.metadata }
      : generated;
  }

  // DB-120: validación final; cualquier fallo se devuelve como
  // `Result` (nunca se lanza a la UI, REQ-E1).
  const report = validateMediaItem(input);
  if (!report.valid) {
    return apiFailure("validation", report.errors.join(" "), report.errors, opts.provider);
  }
  return apiSuccess(input);
}

// -------------------------------------------------------------
// 4. TMDB (API-001..003 de la spec 002)
// -------------------------------------------------------------

/** ¿El objeto ya es un `SearchResult` normalizado? */
function isNormalizedSearchResult(raw) {
  return (
    isPlainObject(raw) &&
    typeof raw.mediaType === "string" &&
    (typeof raw.externalId === "string" ||
      hasOwn(raw, "posterUrl") ||
      raw.source === "tmdb" ||
      raw.source === "googlebooks" ||
      raw.source === "igdb")
  );
}

/** Tipo TMDB efectivo: `movie` | `series` | `anime`. */
function tmdbKind(raw, forcedType) {
  if (forcedType) return forcedType;
  const looksTv =
    hasOwn(raw, "first_air_date") ||
    hasOwn(raw, "number_of_episodes") ||
    hasOwn(raw, "number_of_seasons") ||
    hasOwn(raw, "episode_run_time") ||
    (!hasOwn(raw, "title") && hasOwn(raw, "name"));
  if (!looksTv) return "MOVIE";
  return isAnimeMedia(raw) ? "ANIME" : "SERIES";
}

/**
 * Normaliza un resultado de TMDB (búsqueda o detalle de película o
 * serie/anime) a `MediaItemInput` (REQ-108, API-001..003).
 *
 * Acepta tanto la respuesta cruda de TMDB (`title`/`name`,
 * `release_date`, `poster_path`, `credits`…) como un `SearchResult`
 * ya normalizado por `js/api-tmdb.js`.
 *
 * @param {object} raw
 * @param {{ mediaType?: string }} [options]
 * @returns {object} `Result<MediaItemInput>`
 */
export function normalizeTmdbToMediaItem(raw, options = {}) {
  if (!isPlainObject(raw)) {
    return apiFailure(
      "validation",
      "El resultado de TMDB debe ser un objeto.",
      null,
      "tmdb",
    );
  }
  try {
    const opts = isPlainObject(options) ? options : {};
    const withProvider = { ...opts, provider: firstPresent(opts.provider, "tmdb") };
    if (isNormalizedSearchResult(raw)) {
      return toMediaItemInput(raw, withProvider);
    }

    const mediaType = tmdbKind(raw, toMediaItemType(opts.mediaType));
    const isMovie = mediaType === "MOVIE";
    const result = isMovie ? normalizeTmdbMovie(raw) : normalizeTmdbTv(raw);
    result.mediaType = mediaType;
    result.vote_average = raw.vote_average;
    result.totalEpisodes = raw.number_of_episodes;
    result.totalSeasons = raw.number_of_seasons;
    // Créditos embebidos (append_to_response=credits) → creator.
    result.creator = isMovie ? tmdbDirectorName(raw.credits ?? raw) : tmdbTvCreator(raw);
    return toMediaItemInput(result, withProvider);
  } catch (error) {
    return normalizeApiFailure(error, "tmdb");
  }
}

// -------------------------------------------------------------
// 5. Google Books (API-005 de la spec 002)
// -------------------------------------------------------------

/**
 * Normaliza un volumen de Google Books (o un `SearchResult` ya
 * normalizado) a `MediaItemInput` (REQ-108, API-004/005).
 * @param {object} raw
 * @param {{ mediaType?: string }} [options]
 * @returns {object} `Result<MediaItemInput>`
 */
export function normalizeBookToMediaItem(raw, options = {}) {
  if (!isPlainObject(raw)) {
    return apiFailure(
      "validation",
      "El resultado de Google Books debe ser un objeto.",
      null,
      "googlebooks",
    );
  }
  try {
    const opts = isPlainObject(options) ? options : {};
    const result = isNormalizedSearchResult(raw) ? raw : normalizeBook(raw);
    // `normalizeBook` devuelve el `SearchResult` de búsqueda (sin
    // páginas); el alta sí aprovecha `volumeInfo.pageCount` (DB-102).
    if (!isNormalizedSearchResult(raw) && isPlainObject(raw.volumeInfo)) {
      result.pagesTotal = raw.volumeInfo.pageCount;
      result.totalChapters = raw.volumeInfo.chapterCount;
      result.creator = firstPresent(result.author, raw.volumeInfo.authors?.[0]);
    }
    return toMediaItemInput(result, {
      ...opts,
      provider: firstPresent(opts.provider, "googlebooks"),
      creator: firstPresent(opts.creator, result.creator, result.author),
    });
  } catch (error) {
    return normalizeApiFailure(error, "googlebooks");
  }
}

// -------------------------------------------------------------
// 6. IGDB (API-003 de la spec 002)
// -------------------------------------------------------------

/**
 * Normaliza un juego de IGDB (o un `SearchResult` ya normalizado) a
 * `MediaItemInput` (REQ-108, API-003).
 * @param {object} raw
 * @param {{ mediaType?: string }} [options]
 * @returns {object} `Result<MediaItemInput>`
 */
export function normalizeIgdbToMediaItem(raw, options = {}) {
  if (!isPlainObject(raw)) {
    return apiFailure(
      "validation",
      "El resultado de IGDB debe ser un objeto.",
      null,
      "igdb",
    );
  }
  try {
    const opts = isPlainObject(options) ? options : {};
    const withProvider = { ...opts, provider: firstPresent(opts.provider, "igdb") };
    if (isNormalizedSearchResult(raw)) {
      return toMediaItemInput(raw, withProvider);
    }

    const result = normalizeIgdbGame(raw);
    const involved = Array.isArray(raw.involved_companies) ? raw.involved_companies : [];
    result.creator =
      firstPresent(
        igdbCompanyNames(involved, "developer")[0],
        igdbPublisherName(raw),
        raw.name,
      ) ?? null;
    result.platforms = Array.isArray(raw.platforms)
      ? raw.platforms
          .map((platform) =>
            isPlainObject(platform) ? platform.name : platform,
          )
          .filter((name) => typeof name === "string" && name.trim() !== "")
      : [];
    return toMediaItemInput({ ...result, mediaType: "GAME" }, withProvider);
  } catch (error) {
    return normalizeApiFailure(error, "igdb");
  }
}

// -------------------------------------------------------------
// 7. Steam (biblioteca del usuario; REQ-108)
// -------------------------------------------------------------

/**
 * Normaliza un juego de la biblioteca de Steam
 * (`{ appid, name, playtimeHours, lastPlayedAt }`) a `MediaItemInput`.
 * @param {object} raw
 * @param {{ mediaType?: string }} [options]
 * @returns {object} `Result<MediaItemInput>`
 */
export function normalizeSteamToMediaItem(raw, options = {}) {
  if (!isPlainObject(raw)) {
    return apiFailure(
      "validation",
      "El juego de Steam debe ser un objeto.",
      null,
      "steam",
    );
  }
  try {
    const opts = isPlainObject(options) ? options : {};
    const withProvider = { ...opts, provider: firstPresent(opts.provider, "steam") };
    if (isNormalizedSearchResult(raw)) {
      return toMediaItemInput(raw, withProvider);
    }
    const title = firstPresent(raw.name, raw.title);
    const externalId = firstPresent(raw.appid, raw.externalId);
    const result = {
      mediaType: "GAME",
      title: typeof title === "string" ? title : "",
      externalId: externalId === null ? "" : String(externalId),
      genres: [],
      // La biblioteca de Steam es de PC (DB-102, platforms ≤8).
      platforms: ["PC"],
      playtimeHours: raw.playtimeHours,
    };
    return toMediaItemInput(result, withProvider);
  } catch (error) {
    return normalizeApiFailure(error, "steam");
  }
}

// -------------------------------------------------------------
// 8. Despacho genérico + respuesta completa (REQ-108, REQ-E4)
// -------------------------------------------------------------

/** Normalizador por proveedor (sin red). */
export function normalizeForProvider(provider) {
  const key = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  if (key.includes("tmdb")) return normalizeTmdbToMediaItem;
  if (key.includes("book") || key.includes("google")) return normalizeBookToMediaItem;
  if (key.includes("igdb") || key.includes("game")) return normalizeIgdbToMediaItem;
  if (key.includes("steam")) return normalizeSteamToMediaItem;
  return toMediaItemInput;
}

/**
 * Normaliza cualquier resultado de API externa, detectando el
 * proveedor por `options.provider`/`source` o por la forma del objeto.
 * @param {object} raw
 * @param {{ provider?: string, mediaType?: string }} [options]
 * @returns {object} `Result<MediaItemInput>`
 */
export function normalizeApiToMediaItem(raw, options = {}) {
  const opts = isPlainObject(options) ? options : {};
  if (!isPlainObject(raw)) {
    return apiFailure(
      "validation",
      "El resultado de la API debe ser un objeto.",
      null,
      opts.provider,
    );
  }
  const provider = firstPresent(opts.provider, raw.provider, raw.source);
  if (typeof provider === "string" && provider.trim()) {
    return normalizeForProvider(provider)(raw, opts);
  }
  // Heurísticas de forma (sin red).
  if (hasOwn(raw, "volumeInfo")) return normalizeBookToMediaItem(raw, opts);
  if (
    hasOwn(raw, "first_release_date") ||
    hasOwn(raw, "involved_companies") ||
    hasOwn(raw, "cover")
  ) {
    return normalizeIgdbToMediaItem(raw, opts);
  }
  if (hasOwn(raw, "appid") || hasOwn(raw, "playtimeHours")) {
    return normalizeSteamToMediaItem(raw, opts);
  }
  if (
    hasOwn(raw, "release_date") ||
    hasOwn(raw, "first_air_date") ||
    hasOwn(raw, "poster_path")
  ) {
    return normalizeTmdbToMediaItem(raw, opts);
  }
  return toMediaItemInput(raw, opts);
}

/**
 * Convierte cualquier error de una API externa (throw o rechazo de
 * promesa) en un `Result` de fallo. Garantiza REQ-E4: la UI conserva
 * el formulario de alta manual y solo muestra un aviso.
 *
 * @param {*} error
 * @param {string} [provider]
 * @returns {{ok:false, provider:string, code:string, message:string}}
 */
export function normalizeApiFailure(error, provider = "") {
  const name = typeof provider === "string" && provider.trim() ? provider.trim() : "la API externa";
  const source = isPlainObject(error) ? error : {};
  const rawCode = firstPresent(
    source.code,
    error?.name === "AbortError" ? "timeout" : null,
    typeof error?.status === "number" ? String(error.status) : null,
  );
  const status = Number(source.status);
  let code = toApiResultCode(rawCode);
  if (Number.isFinite(status)) {
    if (status === 401 || status === 403) code = "permission_denied";
    else if (status === 404) code = "not_found";
    else if (status === 429 || status >= 500) code = "unavailable";
  }
  const message = firstPresent(source.message, error?.message);
  return apiFailure(
    code,
    typeof message === "string" && message.trim()
      ? message.trim()
      : `No se pudo consultar ${name}. Puedes dar de alta el ítem manualmente.`,
    null,
    provider,
  );
}

/**
 * Normaliza la respuesta completa de una API externa:
 *   { ok:true, items:[...] }  → { ok:true, value: MediaItemInput[] }
 *   { ok:false, code, message } → { ok:false, provider, code, message }
 *   Array                      → { ok:true, value: [...] }
 *   { games:[...] } (Steam)    → { ok:true, value: [...] }
 *
 * Los ítems que no pasan `validateMediaItem` se descartan y se
 * informan en `skipped` (nunca rompen el lote). Un fallo de API se
 * devuelve como `Result` de error y NO bloquea el alta manual
 * (REQ-E4); una respuesta vacía legítima es `{ ok:true, value: [] }`
 * (API-04) y una respuesta con formato desconocido es
 * `{ ok:false, code:"unknown" }`.
 *
 * @param {*} response
 * @param {{ provider?: string, mediaType?: string, normalize?: Function }} [options]
 * @returns {object} `Result<object[]>`
 */
export function normalizeApiItems(response, options = {}) {
  const opts = isPlainObject(options) ? options : {};
  if (response === null || response === undefined) {
    return apiFailure(
      "unknown",
      "La API externa no devolvió respuesta.",
      null,
      opts.provider,
    );
  }
  if (isPlainObject(response) && response.ok === false) {
    return apiFailure(
      toApiResultCode(response.code),
      firstPresent(response.message, `No se pudo consultar ${opts.provider || "la API externa"}.`),
      null,
      firstPresent(opts.provider, response.provider),
    );
  }

  try {
    let list;
    if (Array.isArray(response)) {
      list = response;
    } else if (isPlainObject(response) && Array.isArray(response.items)) {
      list = response.items;
    } else if (isPlainObject(response) && Array.isArray(response.games)) {
      list = response.games;
    } else if (isPlainObject(response) && Array.isArray(response.value)) {
      list = response.value;
    } else if (
      isPlainObject(response) &&
      response.ok === true &&
      !hasOwn(response, "items") &&
      !hasOwn(response, "games") &&
      !hasOwn(response, "value")
    ) {
      // `{ ok:true }` sin lista = respuesta vacía legítima (API-04).
      list = [];
    } else {
      // Payload basura (p. ej. "boom"): nunca fingir un éxito vacío.
      return apiFailure(
        "unknown",
        "La respuesta de la API externa no tiene un formato reconocible.",
        null,
        opts.provider,
      );
    }

    const normalize =
      typeof opts.normalize === "function"
        ? opts.normalize
        : opts.provider
          ? normalizeForProvider(opts.provider)
          : (item) => normalizeApiToMediaItem(item, opts);

    const value = [];
    const skipped = [];
    list.forEach((item, index) => {
      let result;
      try {
        result = normalize(item, opts);
      } catch (error) {
        result = normalizeApiFailure(error, opts.provider);
      }
      if (result && result.ok) {
        value.push(result.value);
      } else {
        skipped.push({
          index,
          code: result?.code || "unknown",
          message: result?.message || "Ítem descartado por no ser válido.",
        });
      }
    });

    return apiSuccess(value, { skipped, total: list.length });
  } catch (error) {
    return normalizeApiFailure(error, opts.provider);
  }
}

/**
 * Alta manual (REQ-105/REQ-E4): construye y valida un `MediaItemInput`
 * a partir del formulario. El fallo de cualquier API externa no
 * afecta a esta ruta.
 * @param {object} input
 * @returns {object} `Result<MediaItemInput>`
 */
export function normalizeManualMediaItem(input) {
  if (!isPlainObject(input)) {
    return apiFailure(
      "validation",
      "El ítem manual debe ser un objeto.",
      null,
      "manual",
    );
  }
  try {
    const mediaType = toMediaItemType(input.mediaType);
    return toMediaItemInput(
      {
        mediaType: mediaType ?? input.mediaType,
        title: input.title,
        coverUrl: input.coverUrl,
        releaseYear: input.releaseYear,
        genres: input.genres,
        avgRating: input.avgRating,
        creator: input.creator,
        synopsis: input.synopsis,
        durationMinutes: input.durationMinutes,
        pagesTotal: input.pagesTotal,
        totalChapters: input.totalChapters,
        totalEpisodes: input.totalEpisodes,
        platforms: input.platforms,
        playtimeHours: input.playtimeHours,
        ...(isPlainObject(input.metadata) ? { metadata: input.metadata } : {}),
      },
      { mediaType: mediaType ?? input.mediaType, provider: "manual" },
    );
  } catch (error) {
    return normalizeApiFailure(error, "manual");
  }
}

// Alias cortos (mismo contrato `Result<MediaItemInput>`).
export const normalizeTmdbMediaItem = normalizeTmdbToMediaItem;
export const normalizeTmdbMovieToMediaItem = normalizeTmdbToMediaItem;
export const normalizeTmdbTvToMediaItem = normalizeTmdbToMediaItem;
export const normalizeBookMediaItem = normalizeBookToMediaItem;
export const normalizeGoogleBooksToMediaItem = normalizeBookToMediaItem;
export const normalizeIgdbMediaItem = normalizeIgdbToMediaItem;
export const normalizeIgdbGameToMediaItem = normalizeIgdbToMediaItem;
export const normalizeSteamMediaItem = normalizeSteamToMediaItem;
export const normalizeSteamGameToMediaItem = normalizeSteamToMediaItem;
