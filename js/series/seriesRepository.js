// =============================================================
// Repositorio de series (DB-S01..DB-S04, SEC-S03, ALG-S03,
// ALG-S06, ALG-S08, ALG-S09, NFR-S06).
//
// Reglas del módulo:
//   - Las rutas se construyen siempre con el uid de
//     `auth.currentUser`; ninguna función pública acepta `uid`
//     (SEC-S03). Sin sesión se lanza SESSION_EXPIRED.
//   - `users/{uid}/series`, `users/{uid}/series/{id}/episodes` y
//     `users/{uid}/series_collections` son privados del dueño; las
//     reglas son owner-only sin validaciones de campos (SEC-S01/S02),
//     así que la validación de formato vive aquí (ALG-S03/ALG-S04).
//   - La única salida a red es `ensureDetailCached`, que delega en
//     `tmdbTvClient.js` y respeta la caché de 30 días (ALG-S06).
//     `addManual` no hace ninguna petición (AC-S08).
//   - Cada acción sobre episodios viaja en un `writeBatch` junto con
//     la actualización del padre; los contadores se recalculan desde
//     el conjunto de claves vistas/favoritas, nunca se incrementan a
//     ciegas (DB-S04, NFR-S06, D-S11).
//   - Toda escritura sella `updatedAt` con `serverTimestamp()`.
//   - Los errores de validación se lanzan como
//     SeriesRepositoryError con un mensaje en español listo para UI.
// =============================================================

import {
  auth,
  db,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  arrayRemove,
  runTransaction,
  Timestamp,
  writeBatch,
} from "../firebase.js";

import { getSeriesDetail } from "./tmdbTvClient.js";

import {
  computeCurrentEpisode,
  episodeKey,
  parseUserRating,
  TV_GENRES_ES,
  USER_RATING_ERROR_MESSAGE,
} from "./seriesState.js";

// -------------------------------------------------------------
// Constantes del modelo (DB-S01..DB-S04, ALG-S06, ALG-S09)
// -------------------------------------------------------------

/** Estados internos válidos; la traducción a español vive en la UI (UI-S12). */
export const SERIES_STATUSES = Object.freeze([
  "watchlist",
  "watching",
  "watched",
  "dropped",
]);

/** Tope de revisionados y de fechas guardadas (DB-S01). */
export const MAX_REWATCH_COUNT = 1000;

/** Vigencia de la caché de detalle TMDB: 30 días (ALG-S06, AC-S29). */
export const DETAIL_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

/** Máximo de escrituras de episodio por lote (ALG-S08, NFR-S06). */
const EPISODE_BATCH_SIZE = 400;

/** Firestore admite 500 operaciones por lote; se deja margen. */
const BATCH_SIZE = 450;

const MAX_ID_LENGTH = 1500;
const MAX_NAME = 200;
const MAX_EPISODE_NAME = 200;
const MAX_OVERVIEW = 2000;
const MAX_REVIEW = 2000;
const MAX_GENRE_IDS = 30;
const MAX_GENRES = 30;
const MAX_NETWORKS = 10;
const MAX_CREATORS = 10;
const MAX_CAST = 5;
const MAX_WATCH_PROVIDERS = 10;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;
const MAX_COLLECTION_IDS = 50;
const MAX_COLLECTION_NAME = 60;
const MAX_COLLECTION_DESCRIPTION = 300;
const MAX_WATCH_DATES = 1000;
const MAX_EPISODES_COUNT = 100000;
const MIN_AIR_YEAR = 1900;
const MAX_AIR_YEAR = 2100;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EPISODE_KEY_PATTERN = /^S(\d+)E(\d+)$/;

// -------------------------------------------------------------
// Error del repositorio
// -------------------------------------------------------------

/**
 * Error con `code` estable para que la UI distinga sesión caducada,
 * validaciones y documentos inexistentes.
 */
export class SeriesRepositoryError extends Error {
  /**
   * @param {"SESSION_EXPIRED"|"VALIDATION"|"NOT_FOUND"} code
   * @param {string} message Mensaje en español apto para UI.
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "SeriesRepositoryError";
    this.code = code;
  }
}

// -------------------------------------------------------------
// Sesión y rutas (SEC-S03)
// -------------------------------------------------------------

/**
 * Devuelve el uid del usuario autenticado. No existe parámetro `uid`:
 * la única fuente válida es `auth.currentUser` (SEC-S03).
 *
 * @returns {string}
 * @throws {SeriesRepositoryError} SESSION_EXPIRED si no hay sesión.
 */
function requireSession() {
  const user = auth.currentUser;
  if (!user || typeof user.uid !== "string" || user.uid.trim() === "") {
    throw new SeriesRepositoryError(
      "SESSION_EXPIRED",
      "La sesión ha caducado. Vuelve a iniciar sesión."
    );
  }
  return user.uid;
}

/** @param {string} uid */
function seriesCollectionRef(uid) {
  return collection(db, "users", uid, "series");
}

/**
 * @param {string} uid
 * @param {string} seriesId
 */
function seriesRef(uid, seriesId) {
  return doc(db, "users", uid, "series", seriesId);
}

/**
 * @param {string} uid
 * @param {string} seriesId
 */
function episodesCollectionRef(uid, seriesId) {
  return collection(db, "users", uid, "series", seriesId, "episodes");
}

/**
 * @param {string} uid
 * @param {string} seriesId
 * @param {string} key
 */
function episodeDocRef(uid, seriesId, key) {
  return doc(db, "users", uid, "series", seriesId, "episodes", key);
}

/** @param {string} uid */
function collectionsCollectionRef(uid) {
  return collection(db, "users", uid, "series_collections");
}

/**
 * @param {string} uid
 * @param {string} collectionId
 */
function collectionRef(uid, collectionId) {
  return doc(db, "users", uid, "series_collections", collectionId);
}

// -------------------------------------------------------------
// Helpers de validación y normalización
// -------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requireObject(value, message) {
  if (!isPlainObject(value)) {
    throw new SeriesRepositoryError("VALIDATION", message);
  }
  return value;
}

/**
 * Entero a partir de un número o de la cadena de un formulario.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toInteger(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Acepta un id ya existente (auto-ID o `String(tmdbId)`) o un
 * tmdbId numérico positivo (DB-S04).
 *
 * @param {unknown} value
 * @returns {string}
 */
function requireSeriesId(value) {
  let candidate = value;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0) {
      throw new SeriesRepositoryError(
        "VALIDATION",
        "El identificador de la serie no es válido."
      );
    }
    candidate = String(value);
  }

  if (typeof candidate !== "string") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El identificador de la serie no es válido."
    );
  }

  const id = candidate.trim();
  if (id === "" || id.includes("/") || id.length > MAX_ID_LENGTH) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El identificador de la serie no es válido."
    );
  }
  return id;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function requireCollectionId(value) {
  if (typeof value !== "string") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El identificador de la colección no es válido."
    );
  }

  const id = value.trim();
  if (id === "" || id.includes("/") || id.length > MAX_ID_LENGTH) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El identificador de la colección no es válido."
    );
  }
  return id;
}

function isValidStatus(value) {
  return SERIES_STATUSES.includes(value);
}

/**
 * @param {unknown} value
 * @returns {"watchlist"|"watching"|"watched"|"dropped"}
 */
function normalizeStatus(value) {
  if (!isValidStatus(value)) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El estado de la serie no es válido."
    );
  }
  return /** @type {any} */ (value);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeTmdbId(value) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El identificador de TMDB no es válido."
    );
  }
  return parsed;
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string|null}
 */
function cleanTextOrNull(value, maxLength) {
  const text = cleanText(value, maxLength);
  return text === "" ? null : text;
}

/**
 * Nombre obligatorio de un alta manual: se valida, nunca se recorta
 * en silencio (DB-S01, AC-S08).
 *
 * @param {unknown} value
 * @returns {string}
 */
function requireSeriesName(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El nombre de la serie es obligatorio."
    );
  }

  const name = value.trim();
  if (name.length > MAX_NAME) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      `El nombre no puede superar los ${MAX_NAME} caracteres.`
    );
  }
  return name;
}

/**
 * Texto opcional con longitud máxima; vacío se guarda como `null`.
 *
 * @param {unknown} value
 * @param {number} maxLength
 * @param {string} message
 * @returns {string|null}
 */
function normalizeOptionalText(value, maxLength, message) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new SeriesRepositoryError("VALIDATION", message);
  }

  const text = value.trim();
  if (text === "") return null;
  if (text.length > maxLength) {
    throw new SeriesRepositoryError("VALIDATION", message);
  }
  return text;
}

/**
 * Entero opcional (años, temporadas, episodios) de un formulario.
 *
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {string} message
 * @returns {number|null}
 */
function normalizeOptionalInteger(value, min, max, message) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const parsed =
    typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new SeriesRepositoryError("VALIDATION", message);
  }
  return parsed;
}

/**
 * Temporada de una acción de episodio (entero ≥ 1).
 *
 * @param {unknown} value
 * @returns {number}
 */
function requireSeasonNumber(value) {
  const season = toInteger(value);
  if (season === null || season < 1) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El número de temporada no es válido."
    );
  }
  return season;
}

/**
 * Episodio de una acción (entero ≥ 1).
 *
 * @param {unknown} value
 * @returns {number}
 */
function requireEpisodeNumber(value) {
  const episode = toInteger(value);
  if (episode === null || episode < 1) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El número de episodio no es válido."
    );
  }
  return episode;
}

/**
 * Clave `S01E01` validada con `episodeKey` (ALG-S03). El TypeError de
 * `seriesState` se traduce a un error de validación del repositorio.
 *
 * @param {unknown} season
 * @param {unknown} episode
 * @returns {string}
 */
function requireEpisodeKey(season, episode) {
  try {
    return episodeKey(season, episode);
  } catch (error) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El episodio no es válido.",
      { cause: error }
    );
  }
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeStoredYear(value) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_AIR_YEAR &&
    value <= MAX_AIR_YEAR
    ? value
    : null;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeFirstAirDate(value) {
  if (typeof value !== "string") return null;
  const date = value.trim();
  return DATE_PATTERN.test(date) ? date : null;
}

/**
 * @param {string|null} firstAirDate
 * @returns {number|null}
 */
function firstAirYearFrom(firstAirDate) {
  if (firstAirDate === null) return null;
  return normalizeStoredYear(Number(firstAirDate.slice(0, 4)));
}

/**
 * Ruta de imagen TMDB (nunca una URL absoluta).
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeTmdbPath(value) {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (path === "" || path.includes("://")) return null;
  return path.slice(0, 500);
}

/**
 * Minutos por episodio; `null` si no hay dato válido (DB-S01).
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeRuntime(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeTmdbRating(value) {
  const rating = normalizeFiniteNumber(value);
  return rating !== null && rating >= 0 && rating <= 10 ? rating : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeVoteCount(value) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeStoredRating(value) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10
    ? value
    : null;
}

/**
 * Nota personal 0–10 en medios puntos (ALG-S04). Reutiliza el parser
 * puro de `seriesState` y unifica el error bajo el código VALIDATION.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeUserRating(value) {
  try {
    return parseUserRating(value);
  } catch (error) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      USER_RATING_ERROR_MESSAGE,
      { cause: error }
    );
  }
}

/**
 * Contador del padre: entero no negativo acotado (DB-S01).
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {number}
 */
function storedCount(value, max = MAX_EPISODES_COUNT) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(max, Math.trunc(value));
}

/**
 * Contador opcional del padre (`numberOfSeasons`/`numberOfEpisodes`).
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function storedOptionalCount(value) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

/**
 * Posición de progreso almacenada: entero ≥ 1 o `null`.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function storedPosition(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

/**
 * @param {unknown} value
 * @param {number} maxItems
 * @param {number} maxChars
 * @returns {string[]}
 */
function normalizeStringList(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];

  const result = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text === "") continue;
    const clipped = text.slice(0, maxChars);
    if (!result.includes(clipped)) result.push(clipped);
    if (result.length >= maxItems) break;
  }
  return result;
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function normalizeGenreIds(value) {
  if (!Array.isArray(value)) return [];

  const result = [];
  for (const item of value) {
    if (!Number.isInteger(item) || item <= 0) continue;
    if (!result.includes(item)) result.push(item);
    if (result.length >= MAX_GENRE_IDS) break;
  }
  return result;
}

/**
 * Etiquetas: ≤20 elementos y ≤30 caracteres cada una (DB-S01).
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeTags(value) {
  if (!Array.isArray(value)) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "Las etiquetas no son válidas."
    );
  }

  const tags = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new SeriesRepositoryError(
        "VALIDATION",
        "Las etiquetas no son válidas."
      );
    }

    const tag = item.trim();
    if (tag === "") continue;
    if (tag.length > MAX_TAG_LENGTH) {
      throw new SeriesRepositoryError(
        "VALIDATION",
        `Cada etiqueta puede tener como máximo ${MAX_TAG_LENGTH} caracteres.`
      );
    }
    if (!tags.includes(tag)) tags.push(tag);
  }

  if (tags.length > MAX_TAGS) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      `No se pueden guardar más de ${MAX_TAGS} etiquetas.`
    );
  }
  return tags;
}

/**
 * Ids de colección: ≤50 cadenas (DB-S01).
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeCollectionIds(value) {
  if (!Array.isArray(value)) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "Las colecciones no son válidas."
    );
  }

  const ids = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new SeriesRepositoryError(
        "VALIDATION",
        "Las colecciones no son válidas."
      );
    }

    const id = item.trim();
    if (id === "") continue;
    if (!ids.includes(id)) ids.push(id);
  }

  if (ids.length > MAX_COLLECTION_IDS) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      `No se pueden asignar más de ${MAX_COLLECTION_IDS} colecciones.`
    );
  }
  return ids;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStoredCollectionIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim())
    .slice(0, MAX_COLLECTION_IDS);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStoredTags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim().slice(0, MAX_TAG_LENGTH))
    .slice(0, MAX_TAGS);
}

/**
 * @param {unknown} value
 * @param {string} message
 * @returns {boolean}
 */
function normalizeBoolean(value, message) {
  if (typeof value !== "boolean") {
    throw new SeriesRepositoryError("VALIDATION", message);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCollectionName(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El nombre de la colección es obligatorio."
    );
  }

  const name = value.trim();
  if (name.length > MAX_COLLECTION_NAME) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      `El nombre no puede superar los ${MAX_COLLECTION_NAME} caracteres.`
    );
  }
  return name;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeCollectionDescription(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "La descripción de la colección no es válida."
    );
  }

  const description = value.trim();
  if (description === "") return null;
  if (description.length > MAX_COLLECTION_DESCRIPTION) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      `La descripción no puede superar los ${MAX_COLLECTION_DESCRIPTION} caracteres.`
    );
  }
  return description;
}

/** Clave de comparación de nombres: sin espacios sobrantes ni mayúsculas. */
function collectionNameKey(value) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-ES");
}

/**
 * @param {unknown} value
 * @returns {Array<unknown>}
 */
function readWatchDates(value) {
  return Array.isArray(value) ? value.slice(0, MAX_WATCH_DATES) : [];
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function timestampToMillis(value) {
  if (value && typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/**
 * La caché se considera válida solo si tiene menos de 30 días
 * (ALG-S06, AC-S29). Un `detailCachedAt` ausente o corrupto obliga a
 * recargar.
 *
 * @param {unknown} detailCachedAt
 * @returns {boolean}
 */
function isDetailCacheFresh(detailCachedAt) {
  const millis = timestampToMillis(detailCachedAt);
  if (millis === null) return false;
  return Date.now() - millis < DETAIL_CACHE_MS;
}

// -------------------------------------------------------------
// Normalización de documentos leídos
// -------------------------------------------------------------

/**
 * Convierte un documento de serie al objeto que consume la UI. Es
 * defensivo: los documentos antiguos o parciales no rompen la
 * biblioteca (DB-S01).
 *
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
function normalizeSeries(id, data) {
  const firstAirDate = normalizeFirstAirDate(data.firstAirDate);
  const watchDates = readWatchDates(data.watchDates);

  return {
    id,
    seriesId: id,
    source: data.source === "manual" ? "manual" : "tmdb",
    tmdbId:
      typeof data.tmdbId === "number" &&
      Number.isInteger(data.tmdbId) &&
      data.tmdbId > 0
        ? data.tmdbId
        : null,
    name: typeof data.name === "string" ? data.name : "",
    originalName:
      typeof data.originalName === "string" ? data.originalName : "",
    posterPath: normalizeTmdbPath(data.posterPath),
    backdropPath: normalizeTmdbPath(data.backdropPath),
    firstAirDate,
    firstAirYear:
      normalizeStoredYear(data.firstAirYear) ??
      firstAirYearFrom(firstAirDate),
    numberOfSeasons: storedOptionalCount(data.numberOfSeasons),
    numberOfEpisodes: storedOptionalCount(data.numberOfEpisodes),
    tmdbStatus:
      typeof data.tmdbStatus === "string" && data.tmdbStatus.trim() !== ""
        ? data.tmdbStatus.trim()
        : null,
    networks: normalizeStringList(data.networks, MAX_NETWORKS, 100),
    episodeRuntime: normalizeRuntime(data.episodeRuntime),
    genreIds: normalizeGenreIds(data.genreIds),
    genres: normalizeStringList(data.genres, MAX_GENRES, 50),
    overview:
      typeof data.overview === "string"
        ? data.overview.slice(0, MAX_OVERVIEW)
        : "",
    creators: normalizeStringList(data.creators, MAX_CREATORS, 100),
    cast: normalizeStringList(data.cast, MAX_CAST, 100),
    trailerKey: cleanTextOrNull(data.trailerKey, 100),
    watchProviders: normalizeStringList(
      data.watchProviders,
      MAX_WATCH_PROVIDERS,
      100
    ),
    tmdbRating: normalizeStoredRating(data.tmdbRating),
    tmdbVoteCount: normalizeVoteCount(data.tmdbVoteCount),
    detailCachedAt: data.detailCachedAt ?? null,
    status: isValidStatus(data.status) ? data.status : "watchlist",
    isFavorite: data.isFavorite === true,
    currentSeason: storedPosition(data.currentSeason) ?? 1,
    currentEpisode: storedPosition(data.currentEpisode) ?? 1,
    watchedEpisodesCount: storedCount(data.watchedEpisodesCount),
    favoriteEpisodesCount: storedCount(data.favoriteEpisodesCount),
    rewatchCount: storedCount(data.rewatchCount, MAX_REWATCH_COUNT),
    watchDates,
    lastWatchedAt:
      data.lastWatchedAt ??
      (watchDates.length > 0 ? watchDates[watchDates.length - 1] : null),
    userRating: normalizeStoredRating(data.userRating),
    userReview:
      typeof data.userReview === "string"
        ? data.userReview.slice(0, MAX_REVIEW)
        : null,
    tags: normalizeStoredTags(data.tags),
    hasSpoilers: data.hasSpoilers === true,
    collectionIds: normalizeStoredCollectionIds(data.collectionIds),
    addedAt: data.addedAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} data
 */
function normalizeEpisode(key, data) {
  const match = EPISODE_KEY_PATTERN.exec(key);
  const parsedSeason = match === null ? null : Number(match[1]);
  const parsedEpisode = match === null ? null : Number(match[2]);

  return {
    id: key,
    episodeKey: key,
    seasonNumber:
      storedPosition(data.seasonNumber) ??
      (Number.isInteger(parsedSeason) && parsedSeason >= 1
        ? parsedSeason
        : 1),
    episodeNumber:
      storedPosition(data.episodeNumber) ??
      (Number.isInteger(parsedEpisode) && parsedEpisode >= 1
        ? parsedEpisode
        : 1),
    episodeName:
      typeof data.episodeName === "string"
        ? data.episodeName.slice(0, MAX_EPISODE_NAME)
        : "",
    watched: data.watched === true,
    watchedAt: data.watchedAt ?? null,
    isFavorite: data.isFavorite === true,
    userRating: normalizeStoredRating(data.userRating),
    userReview:
      typeof data.userReview === "string"
        ? data.userReview.slice(0, MAX_REVIEW)
        : "",
    hasSpoilers: data.hasSpoilers === true,
    updatedAt: data.updatedAt ?? null,
  };
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
function normalizeCollection(id, data) {
  return {
    id,
    name: typeof data.name === "string" ? data.name : "",
    description:
      typeof data.description === "string" ? data.description : null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

// -------------------------------------------------------------
// Construcción de documentos (DB-S01, DB-S03, DB-S04)
// -------------------------------------------------------------

/**
 * Crea el documento de una serie a partir de un resumen o detalle de
 * TMDB. El id del documento es `String(tmdbId)` (DB-S04).
 *
 * @param {Record<string, unknown>} tmdbSeries
 */
function buildTmdbSeriesDoc(tmdbSeries) {
  const tmdbId = normalizeTmdbId(tmdbSeries.id);
  const hasDetail =
    hasOwn(tmdbSeries, "backdropPath") ||
    hasOwn(tmdbSeries, "numberOfSeasons") ||
    hasOwn(tmdbSeries, "tmdbStatus") ||
    hasOwn(tmdbSeries, "seasons");

  const originalName = cleanText(tmdbSeries.originalName, MAX_NAME);
  const name =
    cleanText(tmdbSeries.name, MAX_NAME) || originalName;

  if (name === "") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "La serie de TMDB no tiene título."
    );
  }

  const firstAirDate = normalizeFirstAirDate(tmdbSeries.firstAirDate);

  return {
    source: "tmdb",
    tmdbId,
    name,
    originalName: originalName || name,
    posterPath: normalizeTmdbPath(tmdbSeries.posterPath),
    backdropPath: hasDetail
      ? normalizeTmdbPath(tmdbSeries.backdropPath)
      : null,
    firstAirDate,
    firstAirYear: firstAirYearFrom(firstAirDate),
    numberOfSeasons: hasDetail
      ? storedOptionalCount(tmdbSeries.numberOfSeasons)
      : null,
    numberOfEpisodes: hasDetail
      ? storedOptionalCount(tmdbSeries.numberOfEpisodes)
      : null,
    tmdbStatus:
      hasDetail && typeof tmdbSeries.tmdbStatus === "string"
        ? tmdbSeries.tmdbStatus.trim() || null
        : null,
    networks: hasDetail
      ? normalizeStringList(tmdbSeries.networks, MAX_NETWORKS, 100)
      : [],
    episodeRuntime: hasDetail
      ? normalizeRuntime(tmdbSeries.episodeRuntime)
      : null,
    genreIds: normalizeGenreIds(tmdbSeries.genreIds),
    genres: hasDetail
      ? normalizeStringList(tmdbSeries.genres, MAX_GENRES, 50)
      : [],
    overview: cleanText(tmdbSeries.overview, MAX_OVERVIEW),
    creators: hasDetail
      ? normalizeStringList(tmdbSeries.creators, MAX_CREATORS, 100)
      : [],
    cast: hasDetail
      ? normalizeStringList(tmdbSeries.cast, MAX_CAST, 100)
      : [],
    trailerKey: hasDetail
      ? cleanTextOrNull(tmdbSeries.trailerKey, 100)
      : null,
    watchProviders: hasDetail
      ? normalizeStringList(
          tmdbSeries.watchProviders,
          MAX_WATCH_PROVIDERS,
          100
        )
      : [],
    tmdbRating: normalizeTmdbRating(tmdbSeries.voteAverage),
    tmdbVoteCount: normalizeVoteCount(tmdbSeries.voteCount),
    detailCachedAt: hasDetail ? serverTimestamp() : null,
    status: "watchlist",
    isFavorite: false,
    currentSeason: 1,
    currentEpisode: 1,
    watchedEpisodesCount: 0,
    favoriteEpisodesCount: 0,
    rewatchCount: 0,
    watchDates: [],
    lastWatchedAt: null,
    userRating: null,
    userReview: null,
    tags: [],
    hasSpoilers: false,
    collectionIds: [],
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/**
 * Géneros de un alta manual: acepta ids de TV, nombres o ambos y
 * completa el nombre desde `TV_GENRES_ES` (D-S08).
 *
 * @param {Record<string, unknown>} input
 */
function buildManualGenres(input) {
  const raw = Array.isArray(input.genres) ? input.genres : [];
  const extraIds = Array.isArray(input.genreIds) ? input.genreIds : [];

  const names = raw
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item !== "");

  const idsFromGenres = raw.filter((item) => Number.isInteger(item));
  const genreIds = normalizeGenreIds([...extraIds, ...idsFromGenres]);

  const namesFromIds = genreIds
    .map((id) => TV_GENRES_ES[id])
    .filter((label) => typeof label === "string");

  return {
    genreIds,
    genres: normalizeStringList(
      [...names, ...namesFromIds],
      MAX_GENRES,
      50
    ),
  };
}

/**
 * Documento de alta manual: auto-ID, `tmdbId:null`, `tmdbRating:null`
 * y cero llamadas a TMDB (DB-S04, AC-S08).
 *
 * @param {Record<string, unknown>} input
 */
function buildManualSeriesDoc(input) {
  const name = requireSeriesName(input.name);
  const { genreIds, genres } = buildManualGenres(input);

  const firstAirYear =
    normalizeOptionalInteger(
      input.year ?? input.firstAirYear,
      MIN_AIR_YEAR,
      MAX_AIR_YEAR,
      "El año de estreno no es válido."
    ) ?? null;

  const numberOfSeasons = normalizeOptionalInteger(
    input.seasons ?? input.numberOfSeasons,
    0,
    1000,
    "El número de temporadas no es válido."
  );

  const numberOfEpisodes = normalizeOptionalInteger(
    input.episodes ?? input.numberOfEpisodes,
    0,
    MAX_EPISODES_COUNT,
    "El número de episodios no es válido."
  );

  const overview =
    normalizeOptionalText(
      input.overview,
      MAX_OVERVIEW,
      `La sinopsis no puede superar los ${MAX_OVERVIEW} caracteres.`
    ) ?? "";

  return {
    source: "manual",
    tmdbId: null,
    name,
    originalName:
      normalizeOptionalText(
        input.originalName,
        MAX_NAME,
        `El título original no puede superar los ${MAX_NAME} caracteres.`
      ) ?? name,
    posterPath: null,
    backdropPath: null,
    firstAirDate: null,
    firstAirYear,
    numberOfSeasons,
    numberOfEpisodes,
    tmdbStatus: null,
    networks: [],
    episodeRuntime: null,
    genreIds,
    genres,
    overview,
    creators: [],
    cast: [],
    trailerKey: null,
    watchProviders: [],
    tmdbRating: null,
    tmdbVoteCount: null,
    detailCachedAt: null,
    status: "watchlist",
    isFavorite: false,
    currentSeason: 1,
    currentEpisode: 1,
    watchedEpisodesCount: 0,
    favoriteEpisodesCount: 0,
    rewatchCount: 0,
    watchDates: [],
    lastWatchedAt: null,
    userRating: null,
    userReview: null,
    tags: [],
    hasSpoilers: false,
    collectionIds: [],
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/**
 * Campos de metadatos que se refrescan desde un TmdbSeriesDetail.
 * Nunca incluye campos personales ni de progreso (ALG-S06).
 *
 * `episodeRuntime` se queda como `null` si TMDB no lo aporta: la
 * media con la temporada 1 aplica «una vez cargada» (DB-S01) y aquí
 * no se fuerza una petición de temporada (NFR-S04).
 *
 * @param {Record<string, unknown>} detail
 */
function buildDetailPatch(detail) {
  const name = cleanText(detail.name, MAX_NAME);
  const originalName = cleanText(detail.originalName, MAX_NAME);
  const firstAirDate = normalizeFirstAirDate(detail.firstAirDate);

  const patch = {
    posterPath: normalizeTmdbPath(detail.posterPath),
    backdropPath: normalizeTmdbPath(detail.backdropPath),
    firstAirDate,
    firstAirYear: firstAirYearFrom(firstAirDate),
    networks: normalizeStringList(detail.networks, MAX_NETWORKS, 100),
    genreIds: normalizeGenreIds(detail.genreIds),
    genres: normalizeStringList(detail.genres, MAX_GENRES, 50),
    overview: cleanText(detail.overview, MAX_OVERVIEW),
    creators: normalizeStringList(detail.creators, MAX_CREATORS, 100),
    cast: normalizeStringList(detail.cast, MAX_CAST, 100),
    trailerKey: cleanTextOrNull(detail.trailerKey, 100),
    watchProviders: normalizeStringList(
      detail.watchProviders,
      MAX_WATCH_PROVIDERS,
      100
    ),
    detailCachedAt: serverTimestamp(),
  };

  // Si TMDB no devuelve título, se conserva el que ya había.
  if (name !== "") patch.name = name;
  if (originalName !== "") patch.originalName = originalName;

  const numberOfSeasons = storedOptionalCount(detail.numberOfSeasons);
  if (numberOfSeasons !== null) patch.numberOfSeasons = numberOfSeasons;

  const numberOfEpisodes = storedOptionalCount(detail.numberOfEpisodes);
  if (numberOfEpisodes !== null) patch.numberOfEpisodes = numberOfEpisodes;

  const episodeRuntime = normalizeRuntime(detail.episodeRuntime);
  if (episodeRuntime !== null) patch.episodeRuntime = episodeRuntime;

  const tmdbRating = normalizeTmdbRating(detail.voteAverage);
  if (tmdbRating !== null) patch.tmdbRating = tmdbRating;

  const tmdbVoteCount = normalizeVoteCount(detail.voteCount);
  if (tmdbVoteCount !== null) patch.tmdbVoteCount = tmdbVoteCount;

  if (typeof detail.tmdbStatus === "string" && detail.tmdbStatus.trim() !== "") {
    patch.tmdbStatus = detail.tmdbStatus.trim();
  }

  return patch;
}

// -------------------------------------------------------------
// Consultas (ALG-S02: solo filtros al servidor, sin orden)
// -------------------------------------------------------------

/**
 * @typedef {Object} SeriesFilters
 * @property {"watchlist"|"watching"|"watched"|"dropped"} [status]
 * @property {boolean} [favorite] Solo `true` aplica el pseudofiltro.
 * @property {number} [genreId]
 * @property {string} [collectionId]
 */

/**
 * Construye la consulta con como máximo una igualdad (`status` o
 * `favorite`) y hasta dos `array-contains` (DB-S05, ALG-S02).
 *
 * @param {string} uid
 * @param {SeriesFilters} filters
 */
function buildSeriesQuery(uid, filters) {
  const input = filters ?? {};
  if (!isPlainObject(input)) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "Los filtros de la biblioteca no son válidos."
    );
  }

  const constraints = [];
  const rawStatus =
    typeof input.status === "string" ? input.status.trim() : "";
  const wantsStatus =
    rawStatus !== "" && rawStatus !== "favorites";

  const wantsFavorite =
    input.favorite === true || rawStatus === "favorites";

  if (
    input.favorite !== undefined &&
    input.favorite !== null &&
    typeof input.favorite !== "boolean"
  ) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El filtro de favoritas no es válido."
    );
  }

  if (wantsStatus && wantsFavorite) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "No se pueden combinar el filtro de estado y el de favoritas."
    );
  }

  if (wantsStatus) {
    constraints.push(where("status", "==", normalizeStatus(rawStatus)));
  } else if (wantsFavorite) {
    constraints.push(where("isFavorite", "==", true));
  }

  if (
    input.genreId !== undefined &&
    input.genreId !== null &&
    input.genreId !== ""
  ) {
    const parsed =
      typeof input.genreId === "number"
        ? input.genreId
        : Number(String(input.genreId).trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new SeriesRepositoryError(
        "VALIDATION",
        "El filtro de género no es válido."
      );
    }
    constraints.push(where("genreIds", "array-contains", parsed));
  }

  if (
    input.collectionId !== undefined &&
    input.collectionId !== null &&
    input.collectionId !== ""
  ) {
    constraints.push(
      where(
        "collectionIds",
        "array-contains",
        requireCollectionId(input.collectionId)
      )
    );
  }

  return query(seriesCollectionRef(uid), ...constraints);
}

/** @param {unknown} error */
function defaultSnapshotError(error) {
  console.error("No se pudo cargar la biblioteca de series.", error);
}

// -------------------------------------------------------------
// Lectura de series
// -------------------------------------------------------------

/**
 * Lee una serie de la biblioteca. No llama a TMDB (REQ-S04).
 *
 * @param {string} seriesId
 * @returns {Promise<ReturnType<typeof normalizeSeries>|null>}
 */
export async function getSeries(seriesId) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);
  const snapshot = await getDoc(seriesRef(uid, id));
  return snapshot.exists()
    ? normalizeSeries(id, snapshot.data() || {})
    : null;
}

/**
 * Lista la biblioteca aplicando solo los filtros de servidor.
 *
 * @param {SeriesFilters} [filters]
 * @returns {Promise<Array<ReturnType<typeof normalizeSeries>>>}
 */
export async function listSeries(filters = {}) {
  const uid = requireSession();
  const snapshot = await getDocs(buildSeriesQuery(uid, filters));
  return snapshot.docs.map((item) =>
    normalizeSeries(item.id, item.data() || {})
  );
}

/**
 * Suscripción en tiempo real a la biblioteca. Acepta
 * `subscribeSeries(filters, onData, onError)` o
 * `subscribeSeries(onData, onError)`.
 *
 * @param {SeriesFilters|((series: Array<ReturnType<typeof normalizeSeries>>) => void)} filters
 * @param {((series: Array<ReturnType<typeof normalizeSeries>>) => void)|((error: unknown) => void)} [onData]
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void} Cancelación de la suscripción.
 */
export function subscribeSeries(filters = {}, onData, onError) {
  let activeFilters = filters;
  let activeOnData = onData;
  let activeOnError = onError;

  if (typeof filters === "function") {
    activeOnError = /** @type {any} */ (onData);
    activeOnData = filters;
    activeFilters = {};
  }

  const uid = requireSession();
  if (typeof activeOnData !== "function") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "Falta el callback de la biblioteca."
    );
  }
  if (activeOnError !== undefined && typeof activeOnError !== "function") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El callback de error no es válido."
    );
  }

  const target = buildSeriesQuery(uid, activeFilters);
  return onSnapshot(
    target,
    (snapshot) => {
      activeOnData(
        snapshot.docs.map((item) =>
          normalizeSeries(item.id, item.data() || {})
        )
      );
    },
    activeOnError || defaultSnapshotError
  );
}

/**
 * Suscripción a una sola serie; entrega `null` si se borra.
 *
 * @param {string} seriesId
 * @param {(series: ReturnType<typeof normalizeSeries>|null) => void} onData
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void}
 */
export function subscribeSeriesDoc(seriesId, onData, onError) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);
  if (typeof onData !== "function") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "Falta el callback de la serie."
    );
  }
  if (onError !== undefined && typeof onError !== "function") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El callback de error no es válido."
    );
  }

  return onSnapshot(
    seriesRef(uid, id),
    (snapshot) => {
      onData(
        snapshot.exists()
          ? normalizeSeries(id, snapshot.data() || {})
          : null
      );
    },
    onError || defaultSnapshotError
  );
}

// -------------------------------------------------------------
// Altas (DB-S04, AC-S07, AC-S08)
// -------------------------------------------------------------

/**
 * Alta desde el catálogo TMDB con upsert por `String(tmdbId)`
 * (DB-S04). Si el documento ya existe no se escribe nada: los campos
 * personales quedan intactos y se devuelve el id existente (AC-S07).
 *
 * @param {Record<string, unknown>} tmdbSeries Resumen o detalle de tmdbTvClient.
 * @returns {Promise<string>} Id del documento.
 */
export async function addFromTmdb(tmdbSeries) {
  const uid = requireSession();
  const series = requireObject(
    tmdbSeries,
    "Los datos de la serie de TMDB no son válidos."
  );
  const data = buildTmdbSeriesDoc(series);
  const ref = seriesRef(uid, String(data.tmdbId));

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists()) return ref.id;

    transaction.set(ref, data);
    return ref.id;
  });
}

/**
 * Alta manual con auto-ID: `source:"manual"`, `tmdbId:null` y sin
 * ninguna llamada de red (DB-S04, AC-S08).
 *
 * @param {{
 *   name: string,
 *   year?: number|null,
 *   firstAirYear?: number|null,
 *   seasons?: number|null,
 *   numberOfSeasons?: number|null,
 *   episodes?: number|null,
 *   numberOfEpisodes?: number|null,
 *   overview?: string|null,
 *   genres?: Array<string|number>,
 *   genreIds?: number[],
 *   originalName?: string|null
 * }} input
 * @returns {Promise<string>} Id del documento creado.
 */
export async function addManual(input) {
  const uid = requireSession();
  const payload = requireObject(
    input,
    "Los datos de la serie manual no son válidos."
  );
  const data = buildManualSeriesDoc(payload);
  const ref = await addDoc(seriesCollectionRef(uid), data);
  return ref.id;
}

// -------------------------------------------------------------
// Escrituras de la serie (DB-S01, D-S06, D-S09)
// -------------------------------------------------------------

/**
 * Ejecuta una mutación atómica sobre una serie. La mutación recibe
 * los datos actuales y devuelve el patch a escribir, o `null` si no
 * hay cambios.
 *
 * @param {string} seriesId
 * @param {(data: Record<string, unknown>) => Record<string, unknown>|null} mutate
 * @returns {Promise<string>}
 */
async function transactSeries(seriesId, mutate) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);
  const ref = seriesRef(uid, id);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      throw new SeriesRepositoryError(
        "NOT_FOUND",
        "La serie ya no existe en tu biblioteca."
      );
    }

    const patch = mutate(snapshot.data() || {});
    if (patch !== null) {
      transaction.update(ref, {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    }
  });

  return id;
}

/**
 * Cambio manual de estado, permitido en cualquier momento (D-S06).
 *
 * @param {string} seriesId
 * @param {"watchlist"|"watching"|"watched"|"dropped"} status
 * @returns {Promise<string>}
 */
export async function setStatus(seriesId, status) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);
  const nextStatus = normalizeStatus(status);

  await updateDoc(seriesRef(uid, id), {
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });
  return id;
}

/**
 * Favorito de serie inmediato (UI-S04, UI-S06, AC-S13).
 *
 * @param {string} seriesId
 * @param {boolean} isFavorite
 * @returns {Promise<string>}
 */
export async function setFavorite(seriesId, isFavorite) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);
  const favorite = normalizeBoolean(
    isFavorite,
    "El valor de favorito no es válido."
  );

  await updateDoc(seriesRef(uid, id), {
    isFavorite: favorite,
    updatedAt: serverTimestamp(),
  });
  return id;
}

/**
 * Guarda la parte personal que exige «Guardar» en la ficha
 * (D-S09): nota, reseña, etiquetas y spoilers de la serie.
 *
 * @param {string} seriesId
 * @param {{ userRating?: number|string|null, userReview?: string|null, tags?: string[], hasSpoilers?: boolean }} fields
 * @returns {Promise<string>}
 */
export async function updatePersonal(seriesId, fields) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);
  const input = requireObject(fields, "No hay cambios que guardar.");

  const patch = {};

  if (hasOwn(input, "userRating")) {
    patch.userRating = normalizeUserRating(input.userRating);
  }
  if (hasOwn(input, "userReview")) {
    patch.userReview = normalizeOptionalText(
      input.userReview,
      MAX_REVIEW,
      `La reseña no puede superar los ${MAX_REVIEW} caracteres.`
    );
  }
  if (hasOwn(input, "tags")) {
    patch.tags = normalizeTags(input.tags);
  }
  if (hasOwn(input, "hasSpoilers")) {
    patch.hasSpoilers = normalizeBoolean(
      input.hasSpoilers,
      "El aviso de spoilers no es válido."
    );
  }

  if (Object.keys(patch).length === 0) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "No hay cambios que guardar."
    );
  }

  await updateDoc(seriesRef(uid, id), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
  return id;
}

/**
 * Asigna el conjunto completo de colecciones de una serie
 * (multi-asignación, DB-S01/DB-S03).
 *
 * @param {string} seriesId
 * @param {string[]} collectionIds
 * @returns {Promise<string>}
 */
export async function setCollections(seriesId, collectionIds) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);
  const ids = normalizeCollectionIds(collectionIds);

  await updateDoc(seriesRef(uid, id), {
    collectionIds: ids,
    updatedAt: serverTimestamp(),
  });
  return id;
}

// -------------------------------------------------------------
// ALG-S09 — Revisionados (AC-S14)
// -------------------------------------------------------------

/**
 * «+1» de revisionados: `rewatchCount+1` (tope 1000), añade la fecha
 * actual mantenida en orden ascendente y actualiza `lastWatchedAt`
 * (ALG-S09). No toca episodios ni estado.
 *
 * @param {string} seriesId
 * @returns {Promise<string>}
 */
export async function incRewatch(seriesId) {
  return transactSeries(seriesId, (data) => {
    const count = storedCount(data.rewatchCount, MAX_REWATCH_COUNT);
    if (count >= MAX_REWATCH_COUNT) return null;

    const nextCount = Math.min(MAX_REWATCH_COUNT, count + 1);
    const now = Timestamp.now();
    const dates = readWatchDates(data.watchDates);
    dates.push(now);
    dates.sort(
      (a, b) => (timestampToMillis(a) ?? 0) - (timestampToMillis(b) ?? 0)
    );
    // `watchDates` nunca queda con más entradas que `rewatchCount`
    // (ALG-S09); se descartan las más antiguas por delante.
    if (dates.length > MAX_WATCH_DATES) {
      dates.splice(0, dates.length - MAX_WATCH_DATES);
    }
    if (dates.length > nextCount) {
      dates.splice(0, dates.length - nextCount);
    }

    return {
      rewatchCount: nextCount,
      watchDates: dates,
      lastWatchedAt: now,
    };
  });
}

/**
 * «−1» de revisionados: `rewatchCount−1` (mínimo 0), elimina la última
 * fecha y recalcula `lastWatchedAt` (ALG-S09, AC-S14). `watchDates`
 * nunca queda con más entradas que `rewatchCount`.
 *
 * @param {string} seriesId
 * @returns {Promise<string>}
 */
export async function decRewatch(seriesId) {
  return transactSeries(seriesId, (data) => {
    const count = storedCount(data.rewatchCount, MAX_REWATCH_COUNT);
    if (count <= 0) return null;

    const nextCount = count - 1;
    const dates = readWatchDates(data.watchDates);
    if (dates.length > 0) dates.pop();
    if (dates.length > nextCount) {
      dates.splice(0, dates.length - nextCount);
    }

    return {
      rewatchCount: nextCount,
      watchDates: dates,
      lastWatchedAt: dates.length > 0 ? dates[dates.length - 1] : null,
    };
  });
}

// -------------------------------------------------------------
// ALG-S03 — Reglas automáticas de estado
// -------------------------------------------------------------

/**
 * Aplica las transiciones automáticas de estado de ALG-S03 (AC-S12):
 *
 * - Marcar: con ≥1 episodio visto y `watchlist` ⇒ `watching`; si el
 *   contador alcanza `numberOfEpisodes` ⇒ `watched`.
 * - Desmarcar: si baja de `numberOfEpisodes` y estaba `watched` ⇒
 *   `watching`; si llega a 0 y estaba `watched`/`watching` ⇒
 *   `watchlist`.
 * - `dropped` nunca cambia automáticamente (D-S06).
 *
 * @param {unknown} status Estado actual.
 * @param {unknown} watchedCount Episodios vistos tras la acción.
 * @param {unknown} numberOfEpisodes Total conocido o `null`.
 * @param {"mark"|"unmark"} action
 * @returns {"watchlist"|"watching"|"watched"|"dropped"}
 */
export function applyStatusRules(
  status,
  watchedCount,
  numberOfEpisodes,
  action = "mark"
) {
  const current = isValidStatus(status) ? status : "watchlist";
  if (current === "dropped") return current;

  const count = storedCount(watchedCount);
  const total =
    typeof numberOfEpisodes === "number" &&
    Number.isInteger(numberOfEpisodes) &&
    numberOfEpisodes > 0
      ? numberOfEpisodes
      : null;

  if (action === "unmark") {
    if (count === 0) {
      return current === "watched" || current === "watching"
        ? "watchlist"
        : current;
    }
    if (total !== null && count < total && current === "watched") {
      return "watching";
    }
    return current;
  }

  let next = current;
  if (count >= 1 && next === "watchlist") next = "watching";
  if (total !== null && count >= total) next = "watched";
  return next;
}

// -------------------------------------------------------------
// Episodios: lote único + contadores recalculados (DB-S02, DB-S04,
// ALG-S03, ALG-S08, NFR-S06)
// -------------------------------------------------------------

/**
 * @typedef {Object} EpisodeModelEntry
 * @property {import("../firebase.js").DocumentReference} ref
 * @property {boolean} watched
 * @property {boolean} favorite
 * @property {string} episodeName
 */

/**
 * Construye el payload de un episodio respetando la creación perezosa
 * (D-S10): un doc nuevo recibe los campos de DB-S02 con valores
 * neutros; uno existente solo se toca con `merge` (conserva favoritos,
 * nota y comentario).
 *
 * @param {EpisodeModelEntry|undefined} entry
 * @param {number} seasonNumber
 * @param {number} episodeNumber
 * @param {string|undefined} episodeName
 * @param {Record<string, unknown>} changes
 */
function episodePayload(
  entry,
  seasonNumber,
  episodeNumber,
  episodeName,
  changes
) {
  const payload = {};

  if (entry === undefined) {
    payload.episodeName = "";
    payload.isFavorite = false;
    payload.userRating = null;
    payload.userReview = "";
    payload.hasSpoilers = false;
    payload.watched = false;
    payload.watchedAt = null;
  }

  payload.seasonNumber = seasonNumber;
  payload.episodeNumber = episodeNumber;

  if (typeof episodeName === "string" && episodeName.trim() !== "") {
    payload.episodeName = episodeName.trim().slice(0, MAX_EPISODE_NAME);
  }

  Object.assign(payload, changes);
  return payload;
}

/**
 * Resuelve `(season, episode)` u objeto `{ seasonNumber, episodeNumber }`
 * para las acciones de episodio.
 *
 * @param {unknown} seasonOrTarget
 * @param {unknown} episodeOrOptions
 * @param {unknown} maybeOptions
 */
function readEpisodeTarget(seasonOrTarget, episodeOrOptions, maybeOptions) {
  if (isPlainObject(seasonOrTarget)) {
    const target = seasonOrTarget;
    const options = isPlainObject(episodeOrOptions)
      ? episodeOrOptions
      : {};
    return {
      seasonNumber: target.seasonNumber ?? target.season_number,
      episodeNumber: target.episodeNumber ?? target.episode_number,
      episodeName: target.episodeName ?? target.name,
      seasonLengths: target.seasonLengths ?? options.seasonLengths,
      options,
    };
  }

  const options = isPlainObject(maybeOptions) ? maybeOptions : {};
  return {
    seasonNumber: seasonOrTarget,
    episodeNumber: episodeOrOptions,
    episodeName: options.episodeName,
    seasonLengths: options.seasonLengths,
    options,
  };
}

/**
 * @typedef {Object} EpisodeMutationPlan
 * @property {Array<{ key: string, ref: import("../firebase.js").DocumentReference, payload: Record<string, unknown> }>} writes
 * @property {"mark"|"unmark"|"none"} action
 * @property {boolean} applyStatus
 * @property {unknown} [lastWatchedAt]
 * @property {Record<string, number>|Map<number, number>} [seasonLengths]
 */

/**
 * Ejecuta un plan de escritura de episodios en un `writeBatch` (o en
 * lotes sucesivos si supera 400, ALG-S08) junto con la actualización
 * del padre. Los contadores se recalculan a partir del conjunto de
 * claves vistas/favoritas (NFR-S06).
 *
 * @param {string} seriesId
 * @param {(model: Map<string, EpisodeModelEntry>, seriesData: Record<string, unknown>, context: { uid: string, seriesId: string }) => EpisodeMutationPlan} planner
 */
async function runEpisodeMutation(seriesId, planner) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);
  const parentRef = seriesRef(uid, id);

  const [seriesSnapshot, episodesSnapshot] = await Promise.all([
    getDoc(parentRef),
    getDocs(episodesCollectionRef(uid, id)),
  ]);

  if (!seriesSnapshot.exists()) {
    throw new SeriesRepositoryError(
      "NOT_FOUND",
      "La serie ya no existe en tu biblioteca."
    );
  }

  const seriesData = seriesSnapshot.data() || {};

  /** @type {Map<string, EpisodeModelEntry>} */
  const model = new Map();
  for (const episodeDoc of episodesSnapshot.docs) {
    const data = episodeDoc.data() || {};
    model.set(episodeDoc.id, {
      ref: episodeDoc.ref,
      watched: data.watched === true,
      favorite: data.isFavorite === true,
      episodeName:
        typeof data.episodeName === "string" ? data.episodeName : "",
    });
  }

  const plan = planner(model, seriesData, { uid, seriesId: id });
  const writes = Array.isArray(plan.writes) ? plan.writes : [];

  const watchedKeys = [];
  const favoriteKeys = [];
  for (const [key, entry] of model) {
    if (entry.watched) watchedKeys.push(key);
    if (entry.favorite) favoriteKeys.push(key);
  }

  const watchedCount = watchedKeys.length;
  const favoriteCount = favoriteKeys.length;
  const position = computeCurrentEpisode(
    watchedKeys,
    plan.seasonLengths
  );

  const currentStatus = isValidStatus(seriesData.status)
    ? seriesData.status
    : "watchlist";

  const nextStatus = plan.applyStatus
    ? applyStatusRules(
        currentStatus,
        watchedCount,
        storedOptionalCount(seriesData.numberOfEpisodes),
        plan.action === "unmark" ? "unmark" : "mark"
      )
    : currentStatus;

  const parentPatch = {
    watchedEpisodesCount: watchedCount,
    favoriteEpisodesCount: favoriteCount,
    updatedAt: serverTimestamp(),
  };

  if (plan.applyStatus) {
    parentPatch.status = nextStatus;
    parentPatch.currentSeason = position.currentSeason;
    parentPatch.currentEpisode = position.currentEpisode;

    if (plan.action === "mark") {
      parentPatch.lastWatchedAt =
        plan.lastWatchedAt ?? Timestamp.now();
    } else if (watchedCount === 0) {
      // Desmarcar hasta 0 revierte también la última fecha (ALG-S03).
      parentPatch.lastWatchedAt = null;
    }
  }

  let index = 0;
  do {
    const chunk = writes.slice(index, index + EPISODE_BATCH_SIZE);
    index += chunk.length;

    const batch = writeBatch(db);
    for (const write of chunk) {
      batch.set(
        write.ref,
        {
          ...write.payload,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    // La actualización del padre viaja en el último lote (ALG-S08).
    if (index >= writes.length) {
      batch.update(parentRef, parentPatch);
    }

    await batch.commit();
  } while (index < writes.length);

  return {
    seriesId: id,
    watchedEpisodesCount: watchedCount,
    favoriteEpisodesCount: favoriteCount,
    currentSeason: plan.applyStatus
      ? position.currentSeason
      : storedPosition(seriesData.currentSeason) ?? 1,
    currentEpisode: plan.applyStatus
      ? position.currentEpisode
      : storedPosition(seriesData.currentEpisode) ?? 1,
    status: nextStatus,
  };
}

/**
 * Marca un episodio como visto y crea `episodes/{S01E01}` la primera
 * vez (ALG-S03, AC-S11). Escribe el doc y el padre en un único lote.
 *
 * Acepta `setEpisodeWatched(seriesId, season, episode, options)` o
 * `setEpisodeWatched(seriesId, { seasonNumber, episodeNumber }, options)`.
 *
 * @param {string} seriesId
 * @param {number|{ seasonNumber?: number, episodeNumber?: number, episodeName?: string }} season
 * @param {number|{ episodeName?: string, seasonLengths?: Record<string, number>|Map<number, number> }} [episode]
 * @param {{ episodeName?: string, seasonLengths?: Record<string, number>|Map<number, number> }} [options]
 */
export async function setEpisodeWatched(
  seriesId,
  season,
  episode,
  options
) {
  const target = readEpisodeTarget(season, episode, options);
  const seasonNumber = requireSeasonNumber(target.seasonNumber);
  const episodeNumber = requireEpisodeNumber(target.episodeNumber);
  const key = requireEpisodeKey(seasonNumber, episodeNumber);

  return runEpisodeMutation(
    seriesId,
    (model, _seriesData, context) => {
      const entry = model.get(key);
      const ref =
        entry?.ref ??
        episodeDocRef(context.uid, context.seriesId, key);
      const now = Timestamp.now();

      model.set(key, {
        ref,
        watched: true,
        favorite: entry?.favorite === true,
        episodeName: entry?.episodeName ?? "",
      });

      return {
        writes: [
          {
            key,
            ref,
            payload: episodePayload(
              entry,
              seasonNumber,
              episodeNumber,
              target.episodeName,
              { watched: true, watchedAt: now }
            ),
          },
        ],
        action: "mark",
        applyStatus: true,
        lastWatchedAt: now,
        seasonLengths: target.seasonLengths,
      };
    }
  );
}

/**
 * Desmarca un episodio: `watched:false`, `watchedAt:null` y reglas de
 * ALG-S03 (AC-S12). No elimina el documento porque conserva favoritos,
 * notas y comentarios (ALG-S08).
 *
 * @param {string} seriesId
 * @param {number|{ seasonNumber?: number, episodeNumber?: number }} season
 * @param {number} [episode]
 * @param {{ seasonLengths?: Record<string, number>|Map<number, number> }} [options]
 */
export async function unmarkEpisode(
  seriesId,
  season,
  episode,
  options
) {
  const target = readEpisodeTarget(season, episode, options);
  const seasonNumber = requireSeasonNumber(target.seasonNumber);
  const episodeNumber = requireEpisodeNumber(target.episodeNumber);
  const key = requireEpisodeKey(seasonNumber, episodeNumber);

  return runEpisodeMutation(
    seriesId,
    (model, _seriesData, context) => {
      const entry = model.get(key);
      const writes = [];

      // Sin documento no hay nada que desmarcar (creación perezosa).
      if (entry !== undefined) {
        model.set(key, { ...entry, watched: false });
        writes.push({
          key,
          ref: entry.ref,
          payload: episodePayload(
            entry,
            seasonNumber,
            episodeNumber,
            undefined,
            { watched: false, watchedAt: null }
          ),
        });
      }

      return {
        writes,
        action: "unmark",
        applyStatus: true,
        seasonLengths: target.seasonLengths,
      };
    }
  );
}

/**
 * Normaliza la lista de episodios de una temporada: números, cadenas o
 * `TmdbEpisodeSummary` (`episodeNumber`, `name`).
 *
 * @param {number} seasonNumber
 * @param {unknown} episodes
 * @returns {Array<{ episodeNumber: number, episodeName: string }>}
 */
function normalizeSeasonEpisodes(seasonNumber, episodes) {
  // Se acepta tanto la lista directa como un `TmdbSeasonDetail`.
  const source =
    isPlainObject(episodes) && Array.isArray(episodes.episodes)
      ? episodes.episodes
      : episodes;

  if (!Array.isArray(source)) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "La lista de episodios de la temporada no es válida."
    );
  }

  /** @type {Map<number, string>} */
  const byNumber = new Map();
  for (const item of source) {
    let episodeNumber = null;
    let episodeName = "";

    if (typeof item === "number" || typeof item === "string") {
      episodeNumber = toInteger(item);
    } else if (isPlainObject(item)) {
      episodeNumber = toInteger(item.episodeNumber ?? item.episode_number);
      if (typeof item.name === "string") episodeName = item.name;
      else if (typeof item.episodeName === "string") {
        episodeName = item.episodeName;
      }
    }

    const valid = requireEpisodeNumber(episodeNumber);
    const name = episodeName.trim().slice(0, MAX_EPISODE_NAME);
    if (!byNumber.has(valid) || (byNumber.get(valid) === "" && name !== "")) {
      byNumber.set(valid, name);
    }
    // `requireEpisodeNumber` valida también la temporada implícita.
    requireEpisodeKey(seasonNumber, valid);
  }

  if (byNumber.size === 0) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "No hay episodios que marcar en esta temporada."
    );
  }

  return [...byNumber.entries()]
    .map(([episodeNumber, episodeName]) => ({
      episodeNumber,
      episodeName,
    }))
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
}

/**
 * Longitudes de temporada para `computeCurrentEpisode`: la de la
 * temporada marcada manda, sin perder las que aporte el llamante.
 *
 * @param {number} seasonNumber
 * @param {number} maxEpisode
 * @param {unknown} provided
 */
function buildSeasonLengths(seasonNumber, maxEpisode, provided) {
  if (provided instanceof Map) return provided;
  if (isPlainObject(provided)) {
    const known = toInteger(provided[seasonNumber]) ?? 0;
    return { ...provided, [seasonNumber]: Math.max(known, maxEpisode) };
  }
  return { [seasonNumber]: maxEpisode };
}

/**
 * Marca una temporada completa como vista (ALG-S08, AC-S20). Un único
 * `writeBatch` con los upserts y el padre; si la temporada supera 400
 * episodios se divide en lotes sucesivos.
 *
 * @param {string} seriesId
 * @param {number} seasonNumber
 * @param {Array<number|string|{ episodeNumber?: number, name?: string }>} episodes
 * @param {{ seasonLengths?: Record<string, number>|Map<number, number> }} [options]
 */
export async function markSeason(
  seriesId,
  seasonNumber,
  episodes,
  options = {}
) {
  const season = requireSeasonNumber(seasonNumber);
  const list = normalizeSeasonEpisodes(season, episodes);
  const maxEpisode = list[list.length - 1].episodeNumber;
  const seasonLengths = buildSeasonLengths(
    season,
    maxEpisode,
    isPlainObject(options) ? options.seasonLengths : undefined
  );

  return runEpisodeMutation(
    seriesId,
    (model, _seriesData, context) => {
      const now = Timestamp.now();
      const writes = [];

      for (const item of list) {
        const key = requireEpisodeKey(season, item.episodeNumber);
        const entry = model.get(key);
        const ref =
          entry?.ref ??
          episodeDocRef(context.uid, context.seriesId, key);

        model.set(key, {
          ref,
          watched: true,
          favorite: entry?.favorite === true,
          episodeName: item.episodeName || entry?.episodeName || "",
        });

        writes.push({
          key,
          ref,
          payload: episodePayload(
            entry,
            season,
            item.episodeNumber,
            item.episodeName,
            { watched: true, watchedAt: now }
          ),
        });
      }

      return {
        writes,
        action: "mark",
        applyStatus: true,
        lastWatchedAt: now,
        seasonLengths,
      };
    }
  );
}

/**
 * Desmarca una temporada completa (ALG-S08, AC-S20): `watched:false`,
 * `watchedAt:null`, contadores recalculados y reglas de ALG-S03. Los
 * favoritos, notas y comentarios de los episodios se conservan.
 *
 * @param {string} seriesId
 * @param {number} seasonNumber
 * @param {Array<number|string|{ episodeNumber?: number }>} episodes
 * @param {{ seasonLengths?: Record<string, number>|Map<number, number> }} [options]
 */
export async function unmarkSeason(
  seriesId,
  seasonNumber,
  episodes,
  options = {}
) {
  const season = requireSeasonNumber(seasonNumber);
  const list = normalizeSeasonEpisodes(season, episodes);
  const maxEpisode = list[list.length - 1].episodeNumber;
  const seasonLengths = buildSeasonLengths(
    season,
    maxEpisode,
    isPlainObject(options) ? options.seasonLengths : undefined
  );

  return runEpisodeMutation(
    seriesId,
    (model, _seriesData, _context) => {
      const writes = [];

      for (const item of list) {
        const key = requireEpisodeKey(season, item.episodeNumber);
        const entry = model.get(key);
        if (entry === undefined) continue;

        model.set(key, { ...entry, watched: false });
        writes.push({
          key,
          ref: entry.ref,
          payload: episodePayload(
            entry,
            season,
            item.episodeNumber,
            undefined,
            { watched: false, watchedAt: null }
          ),
        });
      }

      return {
        writes,
        action: "unmark",
        applyStatus: true,
        seasonLengths,
      };
    }
  );
}

/**
 * Alterna el favorito de un episodio y recalcula
 * `favoriteEpisodesCount` en el mismo lote (DB-S02, DB-S04, AC-S19).
 *
 * @param {string} seriesId
 * @param {number|{ seasonNumber?: number, episodeNumber?: number, episodeName?: string }} season
 * @param {boolean|number} [episode]
 * @param {boolean} [isFavorite]
 */
export async function setEpisodeFavorite(
  seriesId,
  season,
  episode,
  isFavorite
) {
  let target;
  let favorite;

  if (isPlainObject(season)) {
    target = readEpisodeTarget(season, episode, undefined);
    favorite = normalizeBoolean(
      typeof episode === "boolean" ? episode : isFavorite,
      "El valor de favorito no es válido."
    );
  } else {
    target = readEpisodeTarget(season, episode, undefined);
    favorite = normalizeBoolean(
      isFavorite,
      "El valor de favorito no es válido."
    );
  }

  const seasonNumber = requireSeasonNumber(target.seasonNumber);
  const episodeNumber = requireEpisodeNumber(target.episodeNumber);
  const key = requireEpisodeKey(seasonNumber, episodeNumber);

  return runEpisodeMutation(
    seriesId,
    (model, _seriesData, context) => {
      const entry = model.get(key);
      const ref =
        entry?.ref ??
        episodeDocRef(context.uid, context.seriesId, key);

      model.set(key, {
        ref,
        watched: entry?.watched === true,
        favorite,
        episodeName: entry?.episodeName ?? "",
      });

      return {
        writes: [
          {
            key,
            ref,
            payload: episodePayload(
              entry,
              seasonNumber,
              episodeNumber,
              target.episodeName,
              { isFavorite: favorite }
            ),
          },
        ],
        action: "none",
        applyStatus: false,
      };
    }
  );
}

/**
 * Guarda la parte personal de un episodio (nota, comentario y
 * spoilers) en el mismo lote que el padre (DB-S02, ALG-S08).
 * «Eliminar comentario» se expresa con `userReview:""` y
 * `hasSpoilers:false` (AC-S18).
 *
 * @param {string} seriesId
 * @param {number|{ seasonNumber?: number, episodeNumber?: number, episodeName?: string }} season
 * @param {number} [episode]
 * @param {{
 *   userRating?: number|string|null,
 *   userReview?: string|null,
 *   hasSpoilers?: boolean
 * }} [fields]
 */
export async function updateEpisodePersonal(
  seriesId,
  season,
  episode,
  fields
) {
  /** @type {Record<string, unknown>} */
  let input;
  let target;

  if (isPlainObject(season)) {
    target = readEpisodeTarget(season, episode, undefined);
    input = requireObject(episode, "No hay cambios que guardar.");
  } else {
    target = readEpisodeTarget(season, episode, undefined);
    input = requireObject(fields, "No hay cambios que guardar.");
  }

  const seasonNumber = requireSeasonNumber(target.seasonNumber);
  const episodeNumber = requireEpisodeNumber(target.episodeNumber);
  const key = requireEpisodeKey(seasonNumber, episodeNumber);

  const patch = {};
  if (hasOwn(input, "userRating")) {
    patch.userRating = normalizeUserRating(input.userRating);
  }
  if (hasOwn(input, "userReview")) {
    patch.userReview =
      normalizeOptionalText(
        input.userReview,
        MAX_REVIEW,
        `El comentario no puede superar los ${MAX_REVIEW} caracteres.`
      ) ?? "";
  }
  if (hasOwn(input, "hasSpoilers")) {
    patch.hasSpoilers = normalizeBoolean(
      input.hasSpoilers,
      "El aviso de spoilers no es válido."
    );
  }

  if (Object.keys(patch).length === 0) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "No hay cambios que guardar."
    );
  }

  return runEpisodeMutation(
    seriesId,
    (model, _seriesData, context) => {
      const entry = model.get(key);
      const ref =
        entry?.ref ??
        episodeDocRef(context.uid, context.seriesId, key);

      model.set(key, {
        ref,
        watched: entry?.watched === true,
        favorite: entry?.favorite === true,
        episodeName: entry?.episodeName ?? "",
      });

      return {
        writes: [
          {
            key,
            ref,
            payload: episodePayload(
              entry,
              seasonNumber,
              episodeNumber,
              target.episodeName,
              patch
            ),
          },
        ],
        action: "none",
        applyStatus: false,
      };
    }
  );
}

// -------------------------------------------------------------
// Lectura de episodios (DB-S02, ALG-S07)
// -------------------------------------------------------------

/**
 * Lista todos los documentos de episodio de una serie en una única
 * consulta de colección (D-S05), ordenados por temporada/episodio.
 *
 * @param {string} seriesId
 * @returns {Promise<Array<ReturnType<typeof normalizeEpisode>>>}
 */
export async function listEpisodes(seriesId) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);
  const snapshot = await getDocs(episodesCollectionRef(uid, id));

  return snapshot.docs
    .map((item) => normalizeEpisode(item.id, item.data() || {}))
    .sort(
      (a, b) =>
        a.seasonNumber - b.seasonNumber ||
        a.episodeNumber - b.episodeNumber
    );
}

/**
 * Suscripción en tiempo real a los episodios de una serie.
 *
 * @param {string} seriesId
 * @param {(episodes: Array<ReturnType<typeof normalizeEpisode>>) => void} onData
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void}
 */
export function subscribeEpisodes(seriesId, onData, onError) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);
  if (typeof onData !== "function") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "Falta el callback de episodios."
    );
  }
  if (onError !== undefined && typeof onError !== "function") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El callback de error no es válido."
    );
  }

  return onSnapshot(
    episodesCollectionRef(uid, id),
    (snapshot) => {
      onData(
        snapshot.docs
          .map((item) => normalizeEpisode(item.id, item.data() || {}))
          .sort(
            (a, b) =>
              a.seasonNumber - b.seasonNumber ||
              a.episodeNumber - b.episodeNumber
          )
      );
    },
    onError || defaultSnapshotError
  );
}

/**
 * Lee un episodio por temporada/episodio o por clave (`"S01E01"`).
 * La clave se canoniza con `episodeKey` (ALG-S03): se aceptan tanto
 * `S1E1` como `S01E01` y siempre se consulta la variante con dos
 * dígitos, que es la que usa el id del documento (DB-S02).
 *
 * @param {string} seriesId
 * @param {number|string} seasonOrKey
 * @param {number} [episode]
 * @returns {Promise<ReturnType<typeof normalizeEpisode>|null>}
 */
export async function getEpisode(seriesId, seasonOrKey, episode) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);

  const rawKey = typeof seasonOrKey === "string" ? seasonOrKey.trim() : null;
  const match = rawKey === null ? null : /^S(\d+)E(\d+)$/i.exec(rawKey);

  const key =
    match !== null
      ? requireEpisodeKey(Number(match[1]), Number(match[2]))
      : requireEpisodeKey(
          requireSeasonNumber(seasonOrKey),
          requireEpisodeNumber(episode)
        );

  const snapshot = await getDoc(episodeDocRef(uid, id, key));
  return snapshot.exists()
    ? normalizeEpisode(key, snapshot.data() || {})
    : null;
}

// -------------------------------------------------------------
// Caché de detalle TMDB (ALG-S06, AC-S29)
// -------------------------------------------------------------

/**
 * Devuelve la ficha con metadatos frescos.
 *
 * - Si `detailCachedAt` tiene menos de 30 días, no hay red (AC-S29).
 * - `force:true` («Actualizar datos») recarga exactamente una vez.
 * - Si la recarga falla, el TmdbError se propaga sin escribir y la UI
 *   puede seguir mostrando los datos cacheados (ALG-S06).
 * - Una serie manual nunca hace red.
 *
 * @param {string} seriesId
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ series: ReturnType<typeof normalizeSeries>, fromCache: boolean, refreshed: boolean }>}
 */
export async function ensureDetailCached(seriesId, options = {}) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);
  const force = Boolean(options && options.force === true);

  const ref = seriesRef(uid, id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new SeriesRepositoryError(
      "NOT_FOUND",
      "La serie ya no existe en tu biblioteca."
    );
  }

  const data = snapshot.data() || {};
  const series = normalizeSeries(id, data);

  if (series.source !== "tmdb" || !Number.isInteger(series.tmdbId)) {
    return { series, fromCache: false, refreshed: false };
  }

  if (!force && isDetailCacheFresh(series.detailCachedAt)) {
    return { series, fromCache: true, refreshed: false };
  }

  const detail = await getSeriesDetail(series.tmdbId);
  const patch = buildDetailPatch(detail);

  await updateDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
  });

  // `serverTimestamp()` es un centinela; para la respuesta inmediata se
  // usa la hora local, que es la que verá la UI hasta el siguiente snapshot.
  const detailCachedAt = Timestamp.now();

  return {
    series: normalizeSeries(id, { ...data, ...patch, detailCachedAt }),
    fromCache: false,
    refreshed: true,
  };
}

// -------------------------------------------------------------
// Borrado de una serie (CRUD, DB-S01/DB-S02)
// -------------------------------------------------------------

/**
 * Elimina una serie y sus episodios en lotes de 450 operaciones. El
 * borrado del padre viaja en el primer lote.
 *
 * @param {string} seriesId
 * @returns {Promise<string>}
 */
export async function deleteSeries(seriesId) {
  const uid = requireSession();
  const id = requireSeriesId(seriesId);

  const episodes = await getDocs(episodesCollectionRef(uid, id));
  const refs = episodes.docs.map((item) => item.ref);

  let first = true;
  let index = 0;

  do {
    const batch = writeBatch(db);
    if (first) batch.delete(seriesRef(uid, id));

    const chunk = refs.slice(index, index + BATCH_SIZE);
    index += chunk.length;
    for (const ref of chunk) batch.delete(ref);

    await batch.commit();
    first = false;
  } while (index < refs.length);

  return id;
}

// -------------------------------------------------------------
// Colecciones (DB-S03, AC-S22)
// -------------------------------------------------------------

/**
 * Lista las colecciones del usuario.
 *
 * @returns {Promise<Array<ReturnType<typeof normalizeCollection>>>}
 */
export async function listCollections() {
  const uid = requireSession();
  const snapshot = await getDocs(collectionsCollectionRef(uid));
  return snapshot.docs.map((item) =>
    normalizeCollection(item.id, item.data() || {})
  );
}

/**
 * Suscripción en tiempo real a las colecciones.
 *
 * @param {(collections: Array<ReturnType<typeof normalizeCollection>>) => void} onData
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void}
 */
export function subscribeCollections(onData, onError) {
  const uid = requireSession();
  if (typeof onData !== "function") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "Falta el callback de colecciones."
    );
  }
  if (onError !== undefined && typeof onError !== "function") {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "El callback de error no es válido."
    );
  }

  return onSnapshot(
    collectionsCollectionRef(uid),
    (snapshot) => {
      onData(
        snapshot.docs.map((item) =>
          normalizeCollection(item.id, item.data() || {})
        )
      );
    },
    onError || defaultSnapshotError
  );
}

/**
 * Comprueba la unicidad de nombre por usuario (DB-S03). La comparación
 * ignora mayúsculas y espacios repetidos para evitar duplicados
 * visualmente idénticos.
 *
 * @param {string} uid
 * @param {string} name
 * @param {string|null} ignoreId
 */
async function assertCollectionNameAvailable(uid, name, ignoreId) {
  const snapshot = await getDocs(collectionsCollectionRef(uid));
  const key = collectionNameKey(name);

  for (const item of snapshot.docs) {
    if (item.id === ignoreId) continue;
    const data = item.data() || {};
    if (
      typeof data.name === "string" &&
      collectionNameKey(data.name) === key
    ) {
      throw new SeriesRepositoryError(
        "VALIDATION",
        `Ya existe una colección llamada «${name}».`
      );
    }
  }
}

/**
 * Crea una colección. No guarda `seriesIds`: las series referencian
 * la colección con `collectionIds` (DB-S03).
 *
 * @param {{ name: string, description?: string|null }} input
 * @returns {Promise<string>}
 */
export async function createCollection(input) {
  const uid = requireSession();
  const payload = requireObject(
    input,
    "Los datos de la colección no son válidos."
  );
  const name = normalizeCollectionName(payload.name);
  const description = normalizeCollectionDescription(payload.description);

  await assertCollectionNameAvailable(uid, name, null);

  const ref = await addDoc(collectionsCollectionRef(uid), {
    name,
    description,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Renombra y/o cambia la descripción de una colección.
 *
 * @param {string} collectionId
 * @param {{ name?: string, description?: string|null }} input
 * @returns {Promise<string>}
 */
export async function updateCollection(collectionId, input) {
  const uid = requireSession();
  const id = requireCollectionId(collectionId);
  const payload = requireObject(
    input,
    "Los datos de la colección no son válidos."
  );

  const ref = collectionRef(uid, id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new SeriesRepositoryError(
      "NOT_FOUND",
      "La colección ya no existe."
    );
  }

  const patch = {};

  if (hasOwn(payload, "name")) {
    const name = normalizeCollectionName(payload.name);
    await assertCollectionNameAvailable(uid, name, id);
    patch.name = name;
  }
  if (hasOwn(payload, "description")) {
    patch.description = normalizeCollectionDescription(payload.description);
  }

  if (Object.keys(patch).length === 0) {
    throw new SeriesRepositoryError(
      "VALIDATION",
      "No hay cambios que guardar."
    );
  }

  await updateDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
  });
  return id;
}

/**
 * Elimina una colección y limpia su id de `collectionIds` en todas las
 * series afectadas, en lotes de 450 para no superar el límite de 500
 * operaciones de Firestore (DB-S03, AC-S22).
 *
 * @param {string} collectionId
 * @returns {Promise<number>} Número de series actualizadas.
 */
export async function deleteCollection(collectionId) {
  const uid = requireSession();
  const id = requireCollectionId(collectionId);

  const affected = await getDocs(
    query(
      seriesCollectionRef(uid),
      where("collectionIds", "array-contains", id)
    )
  );

  const remaining = [...affected.docs];
  let firstBatch = true;

  do {
    const batch = writeBatch(db);

    // El borrado de la colección viaja en el primer lote, junto con
    // hasta 450 series: 451 operaciones, por debajo del límite.
    if (firstBatch) {
      batch.delete(collectionRef(uid, id));
    }

    const chunk = remaining.splice(0, BATCH_SIZE);
    for (const seriesDoc of chunk) {
      batch.update(seriesDoc.ref, {
        collectionIds: arrayRemove(id),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    firstBatch = false;
  } while (remaining.length > 0);

  return affected.size;
}
