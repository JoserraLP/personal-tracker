// =============================================================
// Repositorio de películas (DB-M01..DB-M03, SEC-M02/M03,
// ALG-M03, ALG-M06).
//
// Reglas del módulo:
//   - Las rutas se construyen siempre con el uid de
//     `auth.currentUser`; ninguna función pública acepta `uid`
//     (SEC-M03). Sin sesión se lanza SESSION_EXPIRED.
//   - `users/{uid}/movies` y `users/{uid}/movie_collections` son
//     privados del dueño; aquí solo se validan los campos que exige
//     SEC-M02 antes de escribir.
//   - La única salida a red es `ensureDetailCached`, que delega en
//     `tmdbClient.js` y respeta la caché de 30 días (ALG-M06).
//   - Toda escritura sella `updatedAt` con `serverTimestamp()`.
//   - Los errores de validación se lanzan como
//     MoviesRepositoryError con un mensaje en español listo para UI.
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
  deleteDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  arrayRemove,
  runTransaction,
  Timestamp,
  writeBatch,
} from "../firebase.js";

import { getMovieDetail } from "./tmdbClient.js";

// -------------------------------------------------------------
// Constantes del modelo (DB-M01, DB-M02, ALG-M03, ALG-M06)
// -------------------------------------------------------------

/** Estados internos válidos; la traducción a español vive en la UI (UI-M09). */
export const MOVIE_STATUSES = Object.freeze([
  "watchlist",
  "watching",
  "watched",
  "dropped",
]);

/** Tope de visionados y de fechas guardadas (DB-M01). */
export const MAX_WATCH_COUNT = 1000;

/** Vigencia de la caché de detalle TMDB: 30 días (ALG-M06, NFR-M04). */
export const DETAIL_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_WATCH_DATES = 1000;
const MAX_TITLE = 200;
const MAX_OVERVIEW = 2000;
const MAX_REVIEW = 2000;
const MAX_GENRE_IDS = 30;
const MAX_GENRES = 30;
const MAX_CAST = 10;
const MAX_WATCH_PROVIDERS = 10;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;
const MAX_COLLECTION_IDS = 50;
const MAX_COLLECTION_NAME = 60;
const MAX_COLLECTION_DESCRIPTION = 300;
const MIN_RELEASE_YEAR = 1870;
const MAX_RELEASE_YEAR = 2100;
const MAX_ID_LENGTH = 1500;

// Firestore limita cada lote a 500 operaciones; se deja margen para
// que la primera batch incluya también el borrado de la colección.
const BATCH_SIZE = 450;

const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// -------------------------------------------------------------
// Error del repositorio
// -------------------------------------------------------------

/**
 * Error con `code` estable para que la UI distinga sesión caducada,
 * validaciones y documentos inexistentes.
 */
export class MoviesRepositoryError extends Error {
  /**
   * @param {"SESSION_EXPIRED"|"VALIDATION"|"NOT_FOUND"} code
   * @param {string} message Mensaje en español apto para UI.
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "MoviesRepositoryError";
    this.code = code;
  }
}

// -------------------------------------------------------------
// Sesión y rutas (SEC-M03)
// -------------------------------------------------------------

/**
 * Devuelve el uid del usuario autenticado. No existe parámetro `uid`:
 * la única fuente válida es `auth.currentUser` (SEC-M03).
 *
 * @returns {string}
 * @throws {MoviesRepositoryError} SESSION_EXPIRED si no hay sesión.
 */
function requireSession() {
  const user = auth.currentUser;
  if (!user || typeof user.uid !== "string" || user.uid.trim() === "") {
    throw new MoviesRepositoryError(
      "SESSION_EXPIRED",
      "La sesión ha caducado. Vuelve a iniciar sesión."
    );
  }
  return user.uid;
}

/** @param {string} uid */
function moviesCollectionRef(uid) {
  return collection(db, "users", uid, "movies");
}

/**
 * @param {string} uid
 * @param {string} movieId
 */
function movieRef(uid, movieId) {
  return doc(db, "users", uid, "movies", movieId);
}

/** @param {string} uid */
function collectionsCollectionRef(uid) {
  return collection(db, "users", uid, "movie_collections");
}

/**
 * @param {string} uid
 * @param {string} collectionId
 */
function collectionRef(uid, collectionId) {
  return doc(db, "users", uid, "movie_collections", collectionId);
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
    throw new MoviesRepositoryError("VALIDATION", message);
  }
  return value;
}

/**
 * Acepta un id ya existente (auto-ID o `String(tmdbId)`) o un
 * tmdbId numérico positivo.
 *
 * @param {unknown} value
 * @returns {string}
 */
function requireMovieId(value) {
  let candidate = value;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0) {
      throw new MoviesRepositoryError(
        "VALIDATION",
        "El identificador de la película no es válido."
      );
    }
    candidate = String(value);
  }

  if (typeof candidate !== "string") {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "El identificador de la película no es válido."
    );
  }

  const id = candidate.trim();
  if (id === "" || id.includes("/") || id.length > MAX_ID_LENGTH) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "El identificador de la película no es válido."
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
    throw new MoviesRepositoryError(
      "VALIDATION",
      "El identificador de la colección no es válido."
    );
  }

  const id = value.trim();
  if (id === "" || id.includes("/") || id.length > MAX_ID_LENGTH) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "El identificador de la colección no es válido."
    );
  }
  return id;
}

function isValidStatus(value) {
  return MOVIE_STATUSES.includes(value);
}

/**
 * @param {unknown} value
 * @returns {"watchlist"|"watching"|"watched"|"dropped"}
 */
function normalizeStatus(value) {
  if (!isValidStatus(value)) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "El estado de la película no es válido."
    );
  }
  return /** @type {any} */ (value);
}

/**
 * @param {unknown} value
 * @returns {number|undefined}
 */
function normalizeTmdbId(value) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new MoviesRepositoryError(
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
 * Título obligatorio de un alta manual: se valida, nunca se recorta
 * en silencio.
 *
 * @param {unknown} value
 * @returns {string}
 */
function requireTitle(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "El título de la película es obligatorio."
    );
  }

  const title = value.trim();
  if (title.length > MAX_TITLE) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      `El título no puede superar los ${MAX_TITLE} caracteres.`
    );
  }
  return title;
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
    throw new MoviesRepositoryError("VALIDATION", message);
  }

  const text = value.trim();
  if (text === "") return null;
  if (text.length > maxLength) {
    throw new MoviesRepositoryError("VALIDATION", message);
  }
  return text;
}

/**
 * Entero opcional. Acepta números y cadenas numéricas de formularios.
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
    throw new MoviesRepositoryError("VALIDATION", message);
  }
  return parsed;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeStoredYear(value) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RELEASE_YEAR &&
    value <= MAX_RELEASE_YEAR
    ? value
    : null;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeReleaseDate(value) {
  if (typeof value !== "string") return null;
  const date = value.trim();
  return RELEASE_DATE_PATTERN.test(date) ? date : null;
}

/**
 * @param {string|null} releaseDate
 * @returns {number|null}
 */
function releaseYearFrom(releaseDate) {
  if (releaseDate === null) return null;
  const year = Number(releaseDate.slice(0, 4));
  return Number.isInteger(year) &&
    year >= MIN_RELEASE_YEAR &&
    year <= MAX_RELEASE_YEAR
    ? year
    : null;
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
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeRuntime(value) {
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
function normalizeFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
    if (!Number.isInteger(item)) continue;
    if (!result.includes(item)) result.push(item);
    if (result.length >= MAX_GENRE_IDS) break;
  }
  return result;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function clampWatchCount(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) return 0;
  return Math.min(MAX_WATCH_COUNT, Math.max(0, parsed));
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeWatchCount(value) {
  const parsed =
    typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_WATCH_COUNT) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      `El número de visionados debe ser un entero entre 0 y ${MAX_WATCH_COUNT}.`
    );
  }
  return parsed;
}

/**
 * Nota personal 0–10 en medios puntos (ALG-M04). Acepta coma o punto
 * decimal para no romper si la UI entrega el valor del input.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function normalizeUserRating(value) {
  if (value === null || value === undefined || value === "") return null;

  let candidate = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    candidate = Number(trimmed.replace(",", "."));
  }

  const valid =
    typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= 0 &&
    candidate <= 10 &&
    Math.abs(candidate * 2 - Math.round(candidate * 2)) < 1e-9;

  if (!valid) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "Introduce una nota entre 0 y 10, en medios puntos."
    );
  }
  return candidate;
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
 * @param {unknown} value
 * @param {string} message
 * @returns {boolean}
 */
function normalizeBoolean(value, message) {
  if (typeof value !== "boolean") {
    throw new MoviesRepositoryError("VALIDATION", message);
  }
  return value;
}

/**
 * Etiquetas: ≤20 elementos y ≤30 caracteres cada una (SEC-M02).
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeTags(value) {
  if (!Array.isArray(value)) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "Las etiquetas no son válidas."
    );
  }

  const tags = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new MoviesRepositoryError(
        "VALIDATION",
        "Las etiquetas no son válidas."
      );
    }

    const tag = item.trim();
    if (tag === "") continue;
    if (tag.length > MAX_TAG_LENGTH) {
      throw new MoviesRepositoryError(
        "VALIDATION",
        `Cada etiqueta puede tener como máximo ${MAX_TAG_LENGTH} caracteres.`
      );
    }
    if (!tags.includes(tag)) tags.push(tag);
  }

  if (tags.length > MAX_TAGS) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      `No se pueden guardar más de ${MAX_TAGS} etiquetas.`
    );
  }
  return tags;
}

/**
 * Ids de colección: ≤50 cadenas (SEC-M02).
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeCollectionIds(value) {
  if (!Array.isArray(value)) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "Las colecciones no son válidas."
    );
  }

  const ids = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new MoviesRepositoryError(
        "VALIDATION",
        "Las colecciones no son válidas."
      );
    }

    const id = item.trim();
    if (id === "") continue;
    if (!ids.includes(id)) ids.push(id);
  }

  if (ids.length > MAX_COLLECTION_IDS) {
    throw new MoviesRepositoryError(
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
 * @returns {string}
 */
function normalizeCollectionName(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "El nombre de la colección es obligatorio."
    );
  }

  const name = value.trim();
  if (name.length > MAX_COLLECTION_NAME) {
    throw new MoviesRepositoryError(
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
    throw new MoviesRepositoryError(
      "VALIDATION",
      "La descripción de la colección no es válida."
    );
  }

  const description = value.trim();
  if (description === "") return null;
  if (description.length > MAX_COLLECTION_DESCRIPTION) {
    throw new MoviesRepositoryError(
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
 * @returns {number[]}
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
 * (ALG-M06). Un `detailCachedAt` ausente o corrupto obliga a recargar.
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
 * Convierte un documento de Firestore al objeto que consume la UI.
 * Es defensivo: los documentos antiguos o parciales no rompen la
 * biblioteca (DB-M01).
 *
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
function normalizeMovie(id, data) {
  const releaseDate = normalizeReleaseDate(data.releaseDate);
  const watchDates = readWatchDates(data.watchDates);

  return {
    id,
    source: data.source === "manual" ? "manual" : "tmdb",
    tmdbId:
      typeof data.tmdbId === "number" &&
      Number.isInteger(data.tmdbId) &&
      data.tmdbId > 0
        ? data.tmdbId
        : null,
    title: typeof data.title === "string" ? data.title : "",
    originalTitle:
      typeof data.originalTitle === "string" ? data.originalTitle : "",
    posterPath: normalizeTmdbPath(data.posterPath),
    backdropPath: normalizeTmdbPath(data.backdropPath),
    releaseDate,
    releaseYear:
      normalizeStoredYear(data.releaseYear) ?? releaseYearFrom(releaseDate),
    runtime: normalizeRuntime(data.runtime),
    genreIds: normalizeGenreIds(data.genreIds),
    genres: normalizeStringList(data.genres, MAX_GENRES, 50),
    overview:
      typeof data.overview === "string"
        ? data.overview.slice(0, MAX_OVERVIEW)
        : "",
    director: cleanTextOrNull(data.director, 200),
    cast: normalizeStringList(data.cast, MAX_CAST, 100),
    trailerKey: cleanTextOrNull(data.trailerKey, 100),
    watchProviders: normalizeStringList(
      data.watchProviders,
      MAX_WATCH_PROVIDERS,
      100
    ),
    tmdbRating: normalizeFiniteNumber(data.tmdbRating),
    tmdbVoteCount: normalizeVoteCount(data.tmdbVoteCount),
    detailCachedAt: data.detailCachedAt ?? null,
    status: isValidStatus(data.status) ? data.status : "watchlist",
    isFavorite: data.isFavorite === true,
    watchCount: clampWatchCount(data.watchCount),
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
// Construcción de documentos (DB-M01, DB-M03)
// -------------------------------------------------------------

/**
 * Crea el documento de una película a partir de un resumen o detalle
 * de TMDB. El id del documento es `String(tmdbId)` (D-M02).
 *
 * @param {Record<string, unknown>} tmdbMovie
 */
function buildTmdbMovieDoc(tmdbMovie) {
  const tmdbId = normalizeTmdbId(tmdbMovie.id);

  // Un TmdbMovieDetail trae estos campos; un TmdbMovieSummary no.
  const hasDetail =
    hasOwn(tmdbMovie, "runtime") ||
    hasOwn(tmdbMovie, "genres") ||
    hasOwn(tmdbMovie, "cast") ||
    hasOwn(tmdbMovie, "backdropPath") ||
    hasOwn(tmdbMovie, "watchProviders");

  const originalTitle = cleanText(tmdbMovie.originalTitle, MAX_TITLE);
  const title =
    cleanText(tmdbMovie.title, MAX_TITLE) || originalTitle;

  if (title === "") {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "La película de TMDB no tiene título."
    );
  }

  const releaseDate = normalizeReleaseDate(tmdbMovie.releaseDate);

  return {
    source: "tmdb",
    tmdbId,
    title,
    originalTitle: originalTitle || title,
    posterPath: normalizeTmdbPath(tmdbMovie.posterPath),
    backdropPath: hasDetail
      ? normalizeTmdbPath(tmdbMovie.backdropPath)
      : null,
    releaseDate,
    releaseYear: releaseYearFrom(releaseDate),
    runtime: hasDetail ? normalizeRuntime(tmdbMovie.runtime) : null,
    genreIds: normalizeGenreIds(tmdbMovie.genreIds),
    genres: hasDetail
      ? normalizeStringList(tmdbMovie.genres, MAX_GENRES, 50)
      : [],
    overview: cleanText(tmdbMovie.overview, MAX_OVERVIEW),
    director: hasDetail
      ? cleanTextOrNull(tmdbMovie.director, 200)
      : null,
    cast: hasDetail
      ? normalizeStringList(tmdbMovie.cast, MAX_CAST, 100)
      : [],
    trailerKey: hasDetail
      ? cleanTextOrNull(tmdbMovie.trailerKey, 100)
      : null,
    watchProviders: hasDetail
      ? normalizeStringList(tmdbMovie.watchProviders, MAX_WATCH_PROVIDERS, 100)
      : [],
    tmdbRating: normalizeFiniteNumber(tmdbMovie.voteAverage),
    tmdbVoteCount: normalizeVoteCount(tmdbMovie.voteCount),
    detailCachedAt: hasDetail ? serverTimestamp() : null,
    status: "watchlist",
    isFavorite: false,
    watchCount: 0,
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
 * Documento de alta manual: auto-ID, sin TMDB y sin red (DB-M03,
 * AC-M08).
 *
 * @param {Record<string, unknown>} input
 */
function buildManualMovieDoc(input) {
  const title = requireTitle(input.title);
  const releaseDate = normalizeReleaseDate(input.releaseDate);
  const releaseYear =
    releaseYearFrom(releaseDate) ??
    normalizeOptionalInteger(
      input.releaseYear,
      MIN_RELEASE_YEAR,
      MAX_RELEASE_YEAR,
      "El año de estreno no es válido."
    );

  const overview =
    normalizeOptionalText(
      input.overview,
      MAX_OVERVIEW,
      `La sinopsis no puede superar los ${MAX_OVERVIEW} caracteres.`
    ) ?? "";

  const runtime = normalizeOptionalInteger(
    input.runtime,
    1,
    10000,
    "La duración no es válida."
  );

  return {
    source: "manual",
    tmdbId: null,
    title,
    originalTitle:
      normalizeOptionalText(
        input.originalTitle,
        MAX_TITLE,
        `El título original no puede superar los ${MAX_TITLE} caracteres.`
      ) ?? title,
    posterPath: null,
    backdropPath: null,
    releaseDate,
    releaseYear,
    runtime,
    genreIds: normalizeGenreIds(input.genreIds),
    genres: normalizeStringList(input.genres, MAX_GENRES, 50),
    overview,
    director: null,
    cast: [],
    trailerKey: null,
    watchProviders: [],
    tmdbRating: null,
    tmdbVoteCount: null,
    detailCachedAt: null,
    status: "watchlist",
    isFavorite: false,
    watchCount: 0,
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
 * Campos de metadatos que se refrescan desde un TmdbMovieDetail.
 * Nunca incluye campos personales (SEC-M02, ALG-M06).
 *
 * @param {Record<string, unknown>} detail
 */
function buildDetailPatch(detail) {
  const title = cleanText(detail.title, MAX_TITLE);
  const originalTitle = cleanText(detail.originalTitle, MAX_TITLE);
  const releaseDate = normalizeReleaseDate(detail.releaseDate);

  const patch = {
    posterPath: normalizeTmdbPath(detail.posterPath),
    backdropPath: normalizeTmdbPath(detail.backdropPath),
    releaseDate,
    releaseYear: releaseYearFrom(releaseDate),
    runtime: normalizeRuntime(detail.runtime),
    genreIds: normalizeGenreIds(detail.genreIds),
    genres: normalizeStringList(detail.genres, MAX_GENRES, 50),
    overview: cleanText(detail.overview, MAX_OVERVIEW),
    director: cleanTextOrNull(detail.director, 200),
    cast: normalizeStringList(detail.cast, MAX_CAST, 100),
    trailerKey: cleanTextOrNull(detail.trailerKey, 100),
    watchProviders: normalizeStringList(
      detail.watchProviders,
      MAX_WATCH_PROVIDERS,
      100
    ),
    tmdbRating: normalizeFiniteNumber(detail.voteAverage),
    tmdbVoteCount: normalizeVoteCount(detail.voteCount),
    detailCachedAt: serverTimestamp(),
  };

  // Si TMDB no devuelve título, se conserva el que ya había.
  if (title !== "") patch.title = title;
  if (originalTitle !== "") patch.originalTitle = originalTitle;

  return patch;
}

// -------------------------------------------------------------
// Consultas (ALG-M02: solo filtros al servidor, sin orden)
// -------------------------------------------------------------

/**
 * @typedef {Object} MovieFilters
 * @property {"watchlist"|"watching"|"watched"|"dropped"} [status]
 * @property {boolean} [favorite] Solo `true` aplica el pseudofiltro.
 * @property {number} [genreId]
 * @property {string} [collectionId]
 */

/**
 * Construye la consulta con como máximo una igualdad (`status` o
 * `favorite`) y hasta dos `array-contains` (DB-M04).
 *
 * @param {string} uid
 * @param {MovieFilters} filters
 */
function buildMoviesQuery(uid, filters) {
  const input = filters ?? {};
  if (!isPlainObject(input)) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "Los filtros de la biblioteca no son válidos."
    );
  }

  const constraints = [];

  const wantsStatus =
    input.status !== undefined &&
    input.status !== null &&
    input.status !== "";

  if (
    input.favorite !== undefined &&
    input.favorite !== null &&
    typeof input.favorite !== "boolean"
  ) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "El filtro de favoritas no es válido."
    );
  }

  if (wantsStatus && input.favorite === true) {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "No se pueden combinar el filtro de estado y el de favoritas."
    );
  }

  if (wantsStatus) {
    constraints.push(where("status", "==", normalizeStatus(input.status)));
  } else if (input.favorite === true) {
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
      throw new MoviesRepositoryError(
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

  return query(moviesCollectionRef(uid), ...constraints);
}

/**
 * @param {{ code?: string }} error
 */
function defaultSnapshotError(error) {
  console.error("No se pudo cargar la biblioteca de películas.", error);
}

// -------------------------------------------------------------
// Lectura de películas
// -------------------------------------------------------------

/**
 * Lee una película de la biblioteca. No llama a TMDB (REQ-M04).
 *
 * @param {string} movieId
 * @returns {Promise<ReturnType<typeof normalizeMovie>|null>}
 */
export async function getMovie(movieId) {
  const uid = requireSession();
  const id = requireMovieId(movieId);
  const snapshot = await getDoc(movieRef(uid, id));
  return snapshot.exists()
    ? normalizeMovie(id, snapshot.data() || {})
    : null;
}

/**
 * Lista la biblioteca aplicando solo los filtros de servidor.
 *
 * @param {MovieFilters} [filters]
 */
export async function listMovies(filters = {}) {
  const uid = requireSession();
  const snapshot = await getDocs(buildMoviesQuery(uid, filters));
  return snapshot.docs.map((item) =>
    normalizeMovie(item.id, item.data() || {})
  );
}

/**
 * Suscripción en tiempo real a la biblioteca. Acepta
 * `subscribeMovies(filters, onData, onError)` o
 * `subscribeMovies(onData, onError)`.
 *
 * @param {MovieFilters|((movies: Array<ReturnType<typeof normalizeMovie>>) => void)} filters
 * @param {((movies: Array<ReturnType<typeof normalizeMovie>>) => void)|((error: unknown) => void)} [onData]
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void} Cancelación de la suscripción.
 */
export function subscribeMovies(filters = {}, onData, onError) {
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
    throw new MoviesRepositoryError(
      "VALIDATION",
      "Falta el callback de la biblioteca."
    );
  }
  if (activeOnError !== undefined && typeof activeOnError !== "function") {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "El callback de error no es válido."
    );
  }

  const target = buildMoviesQuery(uid, activeFilters);
  return onSnapshot(
    target,
    (snapshot) => {
      activeOnData(
        snapshot.docs.map((item) =>
          normalizeMovie(item.id, item.data() || {})
        )
      );
    },
    activeOnError || defaultSnapshotError
  );
}

/**
 * Suscripción a una sola película; entrega `null` si se borra.
 *
 * @param {string} movieId
 * @param {(movie: ReturnType<typeof normalizeMovie>|null) => void} onData
 * @param {(error: unknown) => void} [onError]
 * @returns {() => void}
 */
export function subscribeMovie(movieId, onData, onError) {
  const uid = requireSession();
  const id = requireMovieId(movieId);
  if (typeof onData !== "function") {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "Falta el callback de la película."
    );
  }
  if (onError !== undefined && typeof onError !== "function") {
    throw new MoviesRepositoryError(
      "VALIDATION",
      "El callback de error no es válido."
    );
  }

  return onSnapshot(
    movieRef(uid, id),
    (snapshot) => {
      onData(
        snapshot.exists()
          ? normalizeMovie(id, snapshot.data() || {})
          : null
      );
    },
    onError || defaultSnapshotError
  );
}

// -------------------------------------------------------------
// Altas (DB-M03)
// -------------------------------------------------------------

/**
 * Alta desde el catálogo TMDB con upsert por `String(tmdbId)`
 * (D-M02). Si el documento ya existe no se escribe nada: los campos
 * personales quedan intactos y se devuelve el id existente (DB-M03).
 *
 * @param {Record<string, unknown>} tmdbMovie Resumen o detalle de tmdbClient.
 * @returns {Promise<string>} Id del documento.
 */
export async function addFromTmdb(tmdbMovie) {
  const uid = requireSession();
  const movie = requireObject(
    tmdbMovie,
    "Los datos de la película de TMDB no son válidos."
  );
  const data = buildTmdbMovieDoc(movie);
  const ref = movieRef(uid, String(data.tmdbId));

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists()) return ref.id;

    transaction.set(ref, data);
    return ref.id;
  });
}

/**
 * Alta manual con auto-ID: `source:"manual"`, `tmdbId:null` y sin
 * ninguna llamada de red (DB-M03, AC-M08).
 *
 * @param {{ title: string, releaseYear?: number|null, runtime?: number|null, overview?: string|null, genres?: string[], genreIds?: number[], originalTitle?: string|null, releaseDate?: string|null }} input
 * @returns {Promise<string>} Id del documento creado.
 */
export async function addManual(input) {
  const uid = requireSession();
  const payload = requireObject(
    input,
    "Los datos de la película manual no son válidos."
  );
  const data = buildManualMovieDoc(payload);
  const ref = await addDoc(moviesCollectionRef(uid), data);
  return ref.id;
}

// -------------------------------------------------------------
// Escrituras ALG-M03 (rewatches y estado)
// -------------------------------------------------------------

/**
 * Ejecuta una mutación atómica sobre una película. La mutación recibe
 * los datos actuales y devuelve el patch a escribir, o `null` si no
 * hay cambios.
 *
 * @param {string} uid
 * @param {string} id
 * @param {(data: Record<string, unknown>) => Record<string, unknown>|null} mutate
 * @returns {Promise<string>}
 */
async function transactMovie(uid, id, mutate) {
  const ref = movieRef(uid, id);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      throw new MoviesRepositoryError(
        "NOT_FOUND",
        "La película ya no existe en tu biblioteca."
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
 * «+1»: incrementa `watchCount` (tope 1000), añade la fecha actual y
 * actualiza `lastWatchedAt` (ALG-M03, AC-M10).
 *
 * @param {string} movieId
 * @returns {Promise<string>}
 */
export async function watch(movieId) {
  const uid = requireSession();
  const id = requireMovieId(movieId);

  return transactMovie(uid, id, (data) => {
    const count = clampWatchCount(data.watchCount);
    if (count >= MAX_WATCH_COUNT) return null;

    const now = Timestamp.now();
    const dates = readWatchDates(data.watchDates);
    dates.push(now);
    if (dates.length > MAX_WATCH_DATES) {
      dates.splice(0, dates.length - MAX_WATCH_DATES);
    }

    return {
      watchCount: count + 1,
      watchDates: dates,
      lastWatchedAt: now,
    };
  });
}

/**
 * «−1»: reduce `watchCount` (mínimo 0), elimina la última fecha y
 * recalcula `lastWatchedAt` (ALG-M03, AC-M10).
 *
 * @param {string} movieId
 * @returns {Promise<string>}
 */
export async function unwatch(movieId) {
  const uid = requireSession();
  const id = requireMovieId(movieId);

  return transactMovie(uid, id, (data) => {
    const count = clampWatchCount(data.watchCount);
    if (count <= 0) return null;

    const dates = readWatchDates(data.watchDates);
    dates.pop();

    return {
      watchCount: count - 1,
      watchDates: dates,
      lastWatchedAt: dates.length > 0 ? dates[dates.length - 1] : null,
    };
  });
}

/**
 * Edición manual de `watchCount` (ALG-M03): trunca `watchDates` a las
 * últimas N fechas si N baja; si N sube, no inventa fechas.
 *
 * @param {string} movieId
 * @param {number} count
 * @returns {Promise<string>}
 */
export async function setWatchCount(movieId, count) {
  const uid = requireSession();
  const id = requireMovieId(movieId);
  const nextCount = normalizeWatchCount(count);

  return transactMovie(uid, id, (data) => {
    const dates = readWatchDates(data.watchDates);
    const trimmed =
      nextCount === 0
        ? []
        : dates.length > nextCount
          ? dates.slice(dates.length - nextCount)
          : dates;

    return {
      watchCount: nextCount,
      watchDates: trimmed,
      lastWatchedAt: trimmed.length > 0 ? trimmed[trimmed.length - 1] : null,
    };
  });
}

/**
 * Cambia el estado. La transición a `watched` cuenta un visionado
 * (ALG-M03, AC-M11); al resto de estados solo cambia `status`.
 *
 * @param {string} movieId
 * @param {"watchlist"|"watching"|"watched"|"dropped"} status
 * @returns {Promise<string>}
 */
export async function setStatus(movieId, status) {
  const uid = requireSession();
  const id = requireMovieId(movieId);
  const nextStatus = normalizeStatus(status);

  return transactMovie(uid, id, (data) => {
    const currentStatus = isValidStatus(data.status) ? data.status : null;
    if (currentStatus === nextStatus) return null;

    if (nextStatus !== "watched" || currentStatus === "watched") {
      return { status: nextStatus };
    }

    const now = Timestamp.now();
    const count = clampWatchCount(data.watchCount);
    const dates = readWatchDates(data.watchDates);
    if (dates.length < MAX_WATCH_DATES) dates.push(now);

    return {
      status: nextStatus,
      watchCount: Math.min(MAX_WATCH_COUNT, count + 1),
      watchDates: dates,
      lastWatchedAt: now,
    };
  });
}

// -------------------------------------------------------------
// Resto de escrituras de la película
// -------------------------------------------------------------

/**
 * Favorito inmediato (UI-M04, UI-M06).
 *
 * @param {string} movieId
 * @param {boolean} isFavorite
 * @returns {Promise<string>}
 */
export async function setFavorite(movieId, isFavorite) {
  const uid = requireSession();
  const id = requireMovieId(movieId);
  const favorite = normalizeBoolean(
    isFavorite,
    "El valor de favorito no es válido."
  );

  await updateDoc(movieRef(uid, id), {
    isFavorite: favorite,
    updatedAt: serverTimestamp(),
  });
  return id;
}

/**
 * Guarda la parte personal que exige «Guardar» en la ficha
 * (D-M09): nota, reseña, etiquetas y spoilers.
 *
 * @param {string} movieId
 * @param {{ userRating?: number|null, userReview?: string|null, tags?: string[], hasSpoilers?: boolean }} fields
 * @returns {Promise<string>}
 */
export async function updatePersonal(movieId, fields) {
  const uid = requireSession();
  const id = requireMovieId(movieId);
  const input = requireObject(
    fields,
    "No hay cambios que guardar."
  );

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
    throw new MoviesRepositoryError(
      "VALIDATION",
      "No hay cambios que guardar."
    );
  }

  await updateDoc(movieRef(uid, id), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
  return id;
}

/**
 * Asigna el conjunto completo de colecciones de una película
 * (multi-asignación, DB-M01/DB-M02).
 *
 * @param {string} movieId
 * @param {string[]} collectionIds
 * @returns {Promise<string>}
 */
export async function setCollections(movieId, collectionIds) {
  const uid = requireSession();
  const id = requireMovieId(movieId);
  const ids = normalizeCollectionIds(collectionIds);

  await updateDoc(movieRef(uid, id), {
    collectionIds: ids,
    updatedAt: serverTimestamp(),
  });
  return id;
}

/**
 * Borra una película del usuario (AC-M27).
 *
 * @param {string} movieId
 * @returns {Promise<string>}
 */
export async function deleteMovie(movieId) {
  const uid = requireSession();
  const id = requireMovieId(movieId);
  await deleteDoc(movieRef(uid, id));
  return id;
}

// -------------------------------------------------------------
// Caché de detalle TMDB (ALG-M06)
// -------------------------------------------------------------

/**
 * Devuelve la ficha con metadatos frescos.
 *
 * - Si `detailCachedAt` tiene menos de 30 días, no hay red (AC-M21).
 * - `force:true` («Actualizar datos») recarga exactamente una vez.
 * - Si la recarga falla, el TmdbError se propaga sin escribir y la UI
 *   puede seguir mostrando los datos cacheados (ALG-M06).
 * - Una película manual nunca hace red.
 *
 * @param {string} movieId
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ movie: ReturnType<typeof normalizeMovie>, fromCache: boolean, refreshed: boolean }>}
 */
export async function ensureDetailCached(movieId, options = {}) {
  const uid = requireSession();
  const id = requireMovieId(movieId);
  const force = Boolean(options && options.force === true);

  const ref = movieRef(uid, id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new MoviesRepositoryError(
      "NOT_FOUND",
      "La película ya no existe en tu biblioteca."
    );
  }

  const data = snapshot.data() || {};
  const movie = normalizeMovie(id, data);

  if (movie.source !== "tmdb" || !Number.isInteger(movie.tmdbId)) {
    return { movie, fromCache: false, refreshed: false };
  }

  if (!force && isDetailCacheFresh(movie.detailCachedAt)) {
    return { movie, fromCache: true, refreshed: false };
  }

  const detail = await getMovieDetail(movie.tmdbId);
  const patch = buildDetailPatch(detail);

  await updateDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
  });

  // `serverTimestamp()` es un centinela; para la respuesta inmediata se
  // usa la hora local, que es la que verá la UI hasta el siguiente snapshot.
  const detailCachedAt = Timestamp.now();

  return {
    movie: normalizeMovie(id, { ...data, ...patch, detailCachedAt }),
    fromCache: false,
    refreshed: true,
  };
}

// -------------------------------------------------------------
// Colecciones (DB-M02)
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
    throw new MoviesRepositoryError(
      "VALIDATION",
      "Falta el callback de colecciones."
    );
  }
  if (onError !== undefined && typeof onError !== "function") {
    throw new MoviesRepositoryError(
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
 * Comprueba la unicidad de nombre por usuario (DB-M02). La comparación
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
      throw new MoviesRepositoryError(
        "VALIDATION",
        `Ya existe una colección llamada «${name}».`
      );
    }
  }
}

/**
 * Crea una colección. No guarda `movieIds`: las películas referencian
 * la colección con `collectionIds` (DB-M02).
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
    throw new MoviesRepositoryError(
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
    throw new MoviesRepositoryError(
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
 * películas afectadas, en lotes de 450 para no superar el límite de
 * 500 operaciones de Firestore (DB-M02, AC-M16).
 *
 * @param {string} collectionId
 * @returns {Promise<number>} Número de películas actualizadas.
 */
export async function deleteCollection(collectionId) {
  const uid = requireSession();
  const id = requireCollectionId(collectionId);

  const affected = await getDocs(
    query(
      moviesCollectionRef(uid),
      where("collectionIds", "array-contains", id)
    )
  );

  const remaining = [...affected.docs];
  let firstBatch = true;

  do {
    const batch = writeBatch(db);

    // El borrado de la colección viaja en el primer lote, junto con
    // hasta 450 películas: 451 operaciones, por debajo del límite.
    if (firstBatch) {
      batch.delete(collectionRef(uid, id));
    }

    const chunk = remaining.splice(0, BATCH_SIZE);
    for (const movie of chunk) {
      batch.update(movie.ref, {
        collectionIds: arrayRemove(id),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    firstBatch = false;
  } while (remaining.length > 0);

  return affected.size;
}
