// =============================================================
// Fakes en memoria para tests (T-121 — GitHub issue #67).
//
// Cubren tres contratos de las specs, SIEMPRE sin red ni Firebase
// (REQ-C1, API-14): todo vive en `Map`/arrays y cada método devuelve
// `Result` sin lanzar (REQ-E1).
//
//   - spec 03 API-14  → `FakeTrackingRepository` y
//     `FakeCollectionRepository` implementan los contratos de §2
//     (getEntry/upsertEntry/set*/delete/listEntries/listByMinScore y
//     list/get/create/update/delete/addItem/removeItem).
//   - spec 05 AC-153  → `FakeCatalogRepository` y
//     `FakeTrackingRepository` instrumentados con CONTADOR DE
//     LECTURAS (`reads` + `readLog`) para medir el presupuesto
//     `reads ≤ 2` de `getRecommendations` (ALG-08, sin N+1).
//   - spec 04 AC-137  → `FakeTrackingRepository` expone
//     `subscribeEntries(uid, cb)` + `emitSnapshot()` (evento de
//     snapshot simulado, sin emulador Firestore) para que el
//     dashboard recalcule con `computeDashboard` sin nuevas lecturas
//     (API-22).
//
// Decisiones comunes:
//   - Son REPOSITORIOS (no stores): la superficie es la de los
//     contratos de las specs; los servicios se inyectan tal cual.
//   - `reads`/`writes` cuentan las operaciones de lectura/escritura
//     del contrato; `readLog`/`writeLog` guardan el nombre de cada
//     método. `resetReads()`/`resetWrites()` limpian los contadores
//     entre fases. Las miradas internas de un `set*`/`addItem` (p. ej.
//     comprobar existencia) forman parte de la escritura y NO suman
//     lecturas; una validación fallida no suma NI lectura NI escritura.
//   - `emitSnapshot()` es un evento simulado: tampoco lee.
//   - Cada lectura/escritura devuelve una COPIA: el consumidor no
//     puede mutar el estado interno por accidente.
//   - El reloj es monotónico y se adelanta al máximo `updatedAt`
//     sembrado: una escritura nueva siempre ordena después de los
//     datos iniciales.
//
// Exportaciones ESM con nombre:
//   FakeCatalogRepository, FakeTrackingRepository,
//   FakeCollectionRepository, y las fixtures compartidas de AC-137
//   (AC137_TRACKING_FIXTURE, AC137_CATALOG_FIXTURE,
//   AC137_TOTALS_BEFORE, AC137_TOTALS_AFTER).
// =============================================================

import {
  ENTRY_STATUSES,
  MEDIA_ITEM_TYPES,
  isEntryStatus,
  isMediaItemType,
  normalizeTitle,
  tsToDate,
  validateCollection,
  validateEntry,
  validateMediaItem,
} from "../js/catalog.js";
import {
  DEFAULT_PAGE_SIZE as CATALOG_DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE as CATALOG_MAX_PAGE_SIZE,
  buildMediaItemId,
} from "../js/repositories/catalog-repository.js";
import {
  DEFAULT_ENTRY_PAGE_SIZE,
  MAX_PAGE_SIZE as ENTRY_MAX_PAGE_SIZE,
} from "../js/repositories/tracking-repository.js";
import {
  MAX_COLLECTION_ITEMS,
  MAX_COLLECTIONS_PER_USER,
} from "../js/repositories/collection-repository.js";

// -------------------------------------------------------------
// 1. Result y errores (spec 00 §4.1, REQ-E1/E2)
// -------------------------------------------------------------

/** Códigos admitidos por `Result`. */
const RESULT_ERROR_CODES = Object.freeze([
  "not_found",
  "permission_denied",
  "validation",
  "unavailable",
  "unknown",
]);

/** Variantes de código → códigos del contrato. */
const ERROR_CODE_ALIASES = Object.freeze({
  "not-found": "not_found",
  "permission-denied": "permission_denied",
  unauthenticated: "permission_denied",
  "invalid-argument": "validation",
});

/** Mensajes en español por código (REQ-E2). */
const ERROR_MESSAGES = Object.freeze({
  not_found: "No se ha encontrado el recurso solicitado.",
  permission_denied: "No tienes permiso para acceder a estos datos.",
  validation: "Los datos no son válidos.",
  unavailable: "El servicio no está disponible en este momento.",
  unknown: "Ha ocurrido un error inesperado.",
});

/** `Result` correcto. */
function okResult(value) {
  return { ok: true, value };
}

/** `Result` fallido con código del contrato. */
function failResult(code, message, errors = []) {
  const result = { ok: false, code, message };
  if (errors.length > 0) result.errors = errors.slice();
  return result;
}

/** Error de validación (REQ-E3). */
function inputError(message) {
  const error = new Error(message);
  error.code = "validation";
  error.errors = [message];
  return error;
}

/** Error de recurso ausente (REQ-E2). */
function notFoundError(message = ERROR_MESSAGES.not_found) {
  const error = new Error(message);
  error.code = "not_found";
  return error;
}

/**
 * Convierte cualquier excepción en `Result` (REQ-E1): ningún método
 * de los fakes lanza hacia el consumidor.
 * @param {*} error
 * @returns {{ok: false, code: string, message: string, errors?: string[]}}
 */
function toResultError(error) {
  const raw = typeof error?.code === "string" ? error.code : "";
  const code = RESULT_ERROR_CODES.includes(raw)
    ? raw
    : (ERROR_CODE_ALIASES[raw] ?? "unknown");
  const errors = Array.isArray(error?.errors)
    ? error.errors.filter(
        (entry) => typeof entry === "string" && entry.trim() !== "",
      )
    : [];
  const message =
    code === "validation" && errors.length > 0
      ? errors.join(" ")
      : typeof error?.message === "string" && error.message.trim() !== ""
        ? error.message
        : ERROR_MESSAGES[code];
  return failResult(code, message, errors);
}

// -------------------------------------------------------------
// 2. Reloj, copias y utilidades generales
// -------------------------------------------------------------

/** Reloj monotónico compartido por todos los fakes. */
let clockMs = 0;

/** Adelanta el reloj hasta `ms` (p. ej. un `updatedAt` sembrado). */
function bumpClock(ms) {
  if (Number.isFinite(ms) && ms > clockMs) clockMs = ms;
}

/**
 * Siguiente `Date` del reloj: SIEMPRE estrictamente posterior al
 * estado actual (y a cualquier fecha sembrada), para que una
 * escritura nueva quede la más reciente en los órdenes `updatedAt`
 * desc.
 * @returns {Date}
 */
function nextTimestamp() {
  clockMs = Math.max(clockMs + 1, Date.now());
  return new Date(clockMs);
}

/** Milisegundos de un timestamp Date/ISO/epoch/`.toDate()`, o `null`. */
function toMs(value) {
  const date = tsToDate(value);
  return date === null ? null : date.getTime();
}

/**
 * Copia profunda defensiva: los consumidores reciben siempre copias
 * y no pueden mutar el estado interno del fake.
 * @param {*} value
 * @returns {*}
 */
function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Valor no clonable (p. ej. con funciones) → copia manual.
    }
  }
  if (Array.isArray(value)) return value.map(clone);
  const copy = {};
  for (const [key, entry] of Object.entries(value)) copy[key] = clone(entry);
  return copy;
}

/** Texto no vacío recortado, o `null`. */
function nonEmptyText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Texto obligatorio sin `/` (doc ids de las specs). Lanza
 * `validation` si no encaja.
 * @param {*} value
 * @param {string} message
 * @returns {string}
 */
function requireText(value, message) {
  const text = nonEmptyText(value);
  if (text === null || text.includes("/")) throw inputError(message);
  return text;
}

/** ¿Objeto plano (no array, no null)? */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Normaliza las opciones de consulta; lanza `validation` si no valen. */
function asOptions(options) {
  if (options === undefined || options === null) return {};
  if (!isPlainObject(options)) {
    throw inputError("Las opciones de consulta deben ser un objeto.");
  }
  return options;
}

/**
 * Resuelve `pageSize`: por defecto `defaultSize`, como máximo
 * `maxSize`; lanza `validation` si no es un entero ≥1.
 * @param {*} pageSize
 * @param {number} defaultSize
 * @param {number} maxSize
 * @returns {number}
 */
function resolvePageSize(pageSize, defaultSize, maxSize) {
  if (pageSize === undefined || pageSize === null) return defaultSize;
  if (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1) {
    throw inputError("El tamaño de página debe ser un número entero mayor o igual que 1.");
  }
  return Math.min(pageSize, maxSize);
}

// -------------------------------------------------------------
// 3. Cursor opaco por desplazamiento (DB-114/DB-113 en memoria)
// -------------------------------------------------------------

/** Versión del formato de cursor. */
const CURSOR_VERSION = 1;

/** Serializa la posición de página como cursor OPACO. */
function encodeOffsetCursor(offset) {
  const payload = JSON.stringify({ v: CURSOR_VERSION, o: offset });
  if (typeof Buffer !== "undefined") {
    return Buffer.from(payload, "utf8").toString("base64url");
  }
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodifica el cursor; lanza `validation` si está corrupto (nunca se
 * confía en la UI).
 * @param {string} token
 * @returns {number} desplazamiento (≥0)
 */
function decodeOffsetCursor(token) {
  const invalid = () => inputError("El cursor no es válido.");
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+$/.test(token.trim())) {
    throw invalid();
  }
  const trimmed = token.trim();
  let payload = null;
  try {
    if (typeof Buffer !== "undefined") {
      payload = JSON.parse(Buffer.from(trimmed, "base64url").toString("utf8"));
    } else {
      const padded = trimmed.padEnd(
        trimmed.length + ((4 - (trimmed.length % 4)) % 4),
        "=",
      );
      const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      payload = JSON.parse(new TextDecoder().decode(bytes));
    }
  } catch {
    throw invalid();
  }
  if (
    !isPlainObject(payload) ||
    payload.v !== CURSOR_VERSION ||
    !Number.isInteger(payload.o) ||
    payload.o < 0
  ) {
    throw invalid();
  }
  return payload.o;
}

// -------------------------------------------------------------
// 4. Comparadores y normalizadores de docs
// -------------------------------------------------------------

/** Desempate por id (`mediaId` de entries, `id` del catálogo). */
function compareIds(a, b) {
  const idA = String(a?.mediaId ?? a?.id ?? "");
  const idB = String(b?.mediaId ?? b?.id ?? "");
  if (idA === idB) return 0;
  return idA < idB ? -1 : 1;
}

/** Orden por defecto de `listEntries` (DB-114): updatedAt desc + id. */
function compareUpdatedAtDesc(a, b) {
  const ta = toMs(a?.updatedAt);
  const tb = toMs(b?.updatedAt);
  if (ta === null && tb === null) return compareIds(a, b);
  if (ta === null) return 1;
  if (tb === null) return -1;
  if (ta === tb) return compareIds(a, b);
  return tb - ta;
}

/** Orden de `listByMinScore` (DB-116): score desc + updatedAt desc. */
function compareScoreDesc(a, b) {
  const sa = typeof a?.score === "number" && Number.isFinite(a.score) ? a.score : null;
  const sb = typeof b?.score === "number" && Number.isFinite(b.score) ? b.score : null;
  if (sa === null && sb === null) return compareUpdatedAtDesc(a, b);
  if (sa === null) return 1;
  if (sb === null) return -1;
  if (sa !== sb) return sb - sa;
  return compareUpdatedAtDesc(a, b);
}

/** Orden de título normalizado + id (DB-110/DB-113, REQ-405). */
function compareTitleThenId(a, b) {
  const titleA = a?.titleNormalized ?? normalizeTitle(a?.title);
  const titleB = b?.titleNormalized ?? normalizeTitle(b?.title);
  if (titleA !== titleB) return titleA < titleB ? -1 : 1;
  return compareIds(a, b);
}

/** Orden `avgRating` desc (sin valoración al final) + título + id. */
function compareRatingDesc(a, b) {
  const ratingA =
    typeof a?.avgRating === "number" && Number.isFinite(a.avgRating) ? a.avgRating : null;
  const ratingB =
    typeof b?.avgRating === "number" && Number.isFinite(b.avgRating) ? b.avgRating : null;
  if (ratingA === null && ratingB === null) return compareTitleThenId(a, b);
  if (ratingA === null) return 1;
  if (ratingB === null) return -1;
  if (ratingA !== ratingB) return ratingB - ratingA;
  return compareTitleThenId(a, b);
}

/** Orden `releaseYear` desc (sin año al final) + título + id. */
function compareYearDesc(a, b) {
  const yearA = typeof a?.releaseYear === "number" ? a.releaseYear : null;
  const yearB = typeof b?.releaseYear === "number" ? b.releaseYear : null;
  if (yearA === null && yearB === null) return compareTitleThenId(a, b);
  if (yearA === null) return 1;
  if (yearB === null) return -1;
  if (yearA !== yearB) return yearB - yearA;
  return compareTitleThenId(a, b);
}

/** Orden por defecto de colecciones (DB-117): updatedAt desc + id. */
function compareCollectionsDesc(a, b) {
  const ta = toMs(a?.updatedAt);
  const tb = toMs(b?.updatedAt);
  if (ta === null && tb === null) return compareIds(a, b);
  if (ta === null) return 1;
  if (tb === null) return -1;
  if (ta === tb) return compareIds(a, b);
  return tb - ta;
}

/**
 * Normaliza un doc de entry (DB-103): `mediaId` obligatorio,
 * `status` PLANNED por defecto, `score`/`review`/`progress` `null` y
 * fechas como `Date`. Lanza `validation` si el doc no sirve.
 * @param {*} raw
 * @returns {object}
 */
function normalizeEntryDoc(raw) {
  if (!isPlainObject(raw)) throw inputError("La entry no es un objeto.");
  const mediaId = nonEmptyText(raw.mediaId) ?? nonEmptyText(raw.id);
  if (mediaId === null) throw inputError("La entry necesita un mediaId.");

  const entry = { ...raw, mediaId };
  delete entry.id;
  entry.status = isEntryStatus(raw.status) ? raw.status : "PLANNED";
  entry.score =
    typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : null;
  entry.review = typeof raw.review === "string" ? raw.review : null;
  entry.progress = isPlainObject(raw.progress) ? clone(raw.progress) : null;
  entry.createdAt = tsToDate(raw.createdAt) ?? nextTimestamp();
  entry.updatedAt = tsToDate(raw.updatedAt) ?? nextTimestamp();
  bumpClock(toMs(entry.createdAt));
  bumpClock(toMs(entry.updatedAt));
  return entry;
}

/**
 * Normaliza un `MediaItem` (DB-101): `id` obligatorio,
 * `titleNormalized`, `genres`, `seed` y fechas. Lanza `validation`.
 * @param {*} raw
 * @returns {object}
 */
function normalizeMediaItemDoc(raw) {
  if (!isPlainObject(raw)) throw inputError("El ítem del catálogo no es un objeto.");
  const id = nonEmptyText(raw.id) ?? nonEmptyText(raw.mediaId);
  if (id === null) throw inputError("El ítem del catálogo necesita un id.");

  const item = { ...raw, id };
  delete item.mediaId;
  item.title = typeof raw.title === "string" ? raw.title : "";
  item.titleNormalized =
    typeof raw.titleNormalized === "string" && raw.titleNormalized !== ""
      ? raw.titleNormalized
      : normalizeTitle(item.title);
  item.genres = Array.isArray(raw.genres)
    ? raw.genres.filter((genre) => typeof genre === "string")
    : [];
  item.seed = raw.seed === true;
  item.metadata = isPlainObject(raw.metadata) ? clone(raw.metadata) : null;
  bumpClock(toMs(raw.createdAt));
  bumpClock(toMs(raw.updatedAt));
  return item;
}

/**
 * Normaliza un doc de colección (DB-104): `id` obligatorio,
 * `itemIds` sin duplicados, `description` `null` si falta y fechas
 * como `Date`.
 * @param {*} raw
 * @returns {object}
 */
function normalizeCollectionDoc(raw) {
  if (!isPlainObject(raw)) throw inputError("La colección no es un objeto.");
  const id = nonEmptyText(raw.id) ?? nonEmptyText(raw.collectionId);
  if (id === null) throw inputError("La colección necesita un id.");

  const collection = { ...raw, id };
  delete collection.collectionId;
  collection.name = typeof raw.name === "string" ? raw.name : "";
  collection.description =
    typeof raw.description === "string" && raw.description.trim() !== ""
      ? raw.description
      : null;
  collection.itemIds = Array.isArray(raw.itemIds)
    ? [...new Set(raw.itemIds.filter((entry) => nonEmptyText(entry) !== null))]
    : [];
  collection.createdAt = tsToDate(raw.createdAt) ?? nextTimestamp();
  collection.updatedAt = tsToDate(raw.updatedAt) ?? nextTimestamp();
  bumpClock(toMs(collection.createdAt));
  bumpClock(toMs(collection.updatedAt));
  return collection;
}

// -------------------------------------------------------------
// 5. Filtros secundarios del catálogo (REQ-103, en memoria)
// -------------------------------------------------------------

/** Entero opcional acotado; lanza `validation` si no encaja. */
function optionalInteger(value, label, min, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw inputError(`${label} debe ser un número entero.`);
  }
  if (value < min || value > max) {
    throw inputError(`${label} debe estar entre ${min} y ${max}.`);
  }
  return value;
}

/**
 * Normaliza los filtros secundarios de REQ-103 (género, rango de
 * años y `avgRating` mínimo). Lanza `validation` si algo no encaja.
 * @param {object} opts
 * @returns {{genre: string|null, yearFrom: number|null, yearTo: number|null, minAvgRating: number|null}}
 */
function resolveSecondaryFilters(opts) {
  const filters = {
    genre: null,
    yearFrom: optionalInteger(opts.yearFrom, "El año inicial (yearFrom)", 1888, 2100),
    yearTo: optionalInteger(opts.yearTo, "El año final (yearTo)", 1888, 2100),
    minAvgRating: null,
  };

  if (opts.genre !== undefined && opts.genre !== null) {
    const genre = nonEmptyText(opts.genre);
    if (genre === null) throw inputError("El filtro de género debe ser texto no vacío.");
    filters.genre = normalizeTitle(genre);
  }

  if (opts.minAvgRating !== undefined && opts.minAvgRating !== null) {
    if (typeof opts.minAvgRating !== "number" || !Number.isFinite(opts.minAvgRating)) {
      throw inputError("La valoración mínima (minAvgRating) debe ser un número.");
    }
    if (opts.minAvgRating < 0 || opts.minAvgRating > 10) {
      throw inputError("La valoración mínima debe estar entre 0 y 10.");
    }
    filters.minAvgRating = opts.minAvgRating;
  }

  if (
    filters.yearFrom !== null &&
    filters.yearTo !== null &&
    filters.yearFrom > filters.yearTo
  ) {
    throw inputError("El rango de años no es válido: yearFrom supera yearTo.");
  }

  return filters;
}

/** Aplica los filtros secundarios a un item ya leído (REQ-103). */
function matchesSecondaryFilters(item, filters) {
  if (filters.genre !== null) {
    if (!item.genres.some((genre) => normalizeTitle(genre) === filters.genre)) {
      return false;
    }
  }
  if (filters.yearFrom !== null) {
    if (typeof item.releaseYear !== "number" || item.releaseYear < filters.yearFrom) {
      return false;
    }
  }
  if (filters.yearTo !== null) {
    if (typeof item.releaseYear !== "number" || item.releaseYear > filters.yearTo) {
      return false;
    }
  }
  if (filters.minAvgRating !== null) {
    if (typeof item.avgRating !== "number" || item.avgRating < filters.minAvgRating) {
      return false;
    }
  }
  return true;
}

// -------------------------------------------------------------
// 6. FakeTrackingRepository (spec 03 API-14, spec 05 AC-153,
//    spec 04 AC-137)
// -------------------------------------------------------------

/**
 * Repositorio de tracking en memoria (spec 03 §2). Sin red ni
 * Firebase: todo se guarda en un `Map<mediaId, Entry>` y cada
 * operación expone su contador (`reads`/`writes`).
 *
 * Además de la API del contrato ofrece el evento de snapshot
 * simulado de API-22/AC-137:
 *
 *   const unsub = service.subscribe("u", cb);
 *   await fake.setStatus("u", "m-1", "COMPLETED");
 *   fake.emitSnapshot();   // ⇒ cb(stats) SIN nuevas lecturas
 *
 * @example
 * const tracking = new FakeTrackingRepository([
 *   { mediaId: "m-1", status: "PLANNED", updatedAt: "2026-04-01T10:00:00Z" },
 * ]);
 * const service = createRecommendationService({ trackingRepository: tracking });
 */
export class FakeTrackingRepository {
  /** @param {ReadonlyArray<object>} [entries] fixtures iniciales (DB-103) */
  constructor(entries = []) {
    /** @type {Map<string, object>} */
    this._entries = new Map();
    /** @type {Set<Function>} oyentes de `subscribeEntries`. */
    this._listeners = new Set();
    this.reads = 0;
    this.readLog = [];
    this.writes = 0;
    this.writeLog = [];
    this.seed(entries);
  }

  /**
   * Reemplaza las entries en memoria. NO cuenta como lectura ni
   * escritura (es carga de fixture).
   * @param {ReadonlyArray<object>} [entries]
   * @returns {this}
   */
  seed(entries = []) {
    this._entries.clear();
    for (const raw of Array.isArray(entries) ? entries : []) {
      const entry = normalizeEntryDoc(raw);
      this._entries.set(entry.mediaId, entry);
    }
    return this;
  }

  /** Copias de las entries actuales (para snapshots/asserteros). */
  get entries() {
    return [...this._entries.values()].map(clone);
  }

  /** Limpia el contador de lecturas (presupuesto AC-153/API-20). */
  resetReads() {
    this.reads = 0;
    this.readLog = [];
    return this;
  }

  /** Limpia el contador de escrituras. */
  resetWrites() {
    this.writes = 0;
    this.writeLog = [];
    return this;
  }

  _read(method) {
    this.reads += 1;
    this.readLog.push(method);
  }

  _write(method) {
    this.writes += 1;
    this.writeLog.push(method);
  }

  /** Lee una entry materializada (copia) o `null`. */
  _readEntry(mediaId) {
    const entry = this._entries.get(mediaId);
    return entry ? clone(entry) : null;
  }

  /**
   * Escritura parcial común (API-11): SOLO el campo tocado +
   * `updatedAt`. `not_found` si no existe; `validation` si el merge
   * no cumple DB-122 (sin escritura).
   * @param {*} mediaId
   * @param {object} patch
   * @param {string} method nombre para el log de escrituras
   * @returns {Promise<object>} `Result<Entry>`
   */
  async _partial(mediaId, patch, method) {
    try {
      const id = requireText(mediaId, "El id del ítem (mediaId) es obligatorio.");
      const existing = this._entries.get(id);
      if (!existing) throw notFoundError();

      const merged = { ...existing, ...patch, mediaId: id };
      const report = validateEntry({
        mediaId: id,
        status: merged.status,
        score: merged.score,
        review: merged.review,
        progress: merged.progress,
      });
      if (!report.valid) throw inputError(report.errors.join(" "));

      this._write(method);
      merged.updatedAt = nextTimestamp();
      this._entries.set(id, merged);
      return okResult(clone(merged));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Lee una entry (DB-103). 1 lectura.
   * @param {string} uid ignorado: el fake vive en una única memoria
   * @param {string} mediaId
   * @returns {Promise<object>} `Result<Entry | null>`
   */
  async getEntry(uid, mediaId) {
    try {
      const id = requireText(mediaId, "El id del ítem (mediaId) es obligatorio.");
      this._read("getEntry");
      return okResult(this._readEntry(id));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Upsert por doc id = `mediaId` (REQ-201, AC-120): dos llamadas
   * nunca crean dos entries. Valida DB-122 ANTES de escribir
   * (API-12): `score: 11` ⇒ `validation` sin escritura (AC-122).
   * @param {string} uid
   * @param {string} mediaId
   * @param {object} [input]
   * @returns {Promise<object>} `Result<Entry>`
   */
  async upsertEntry(uid, mediaId, input = {}) {
    try {
      const id = requireText(mediaId, "El id del ítem (mediaId) es obligatorio.");
      if (!isPlainObject(input)) {
        throw inputError("Los datos de la entry deben ser un objeto.");
      }

      const existing = this._entries.get(id) ?? null;
      const merged = { ...(existing ?? {}), mediaId: id };
      merged.status =
        input.status !== undefined ? input.status : (existing?.status ?? "PLANNED");
      merged.score = input.score !== undefined ? input.score : (existing?.score ?? null);
      merged.review =
        input.review !== undefined ? input.review : (existing?.review ?? null);
      merged.progress =
        input.progress !== undefined ? input.progress : (existing?.progress ?? null);

      const report = validateEntry({
        mediaId: id,
        status: merged.status,
        score: merged.score,
        review: merged.review,
        progress: merged.progress,
      });
      if (!report.valid) throw inputError(report.errors.join(" "));

      this._write("upsertEntry");
      const now = nextTimestamp();
      merged.createdAt = existing?.createdAt ?? now;
      merged.updatedAt = now;
      this._entries.set(id, merged);
      return okResult(clone(merged));
    } catch (error) {
      return toResultError(error);
    }
  }

  /** Cambia SOLO `status` + `updatedAt` (API-11, REQ-202). */
  setStatus(uid, mediaId, status) {
    return this._partial(mediaId, { status }, "setStatus");
  }

  /** Cambia SOLO `score` + `updatedAt` (API-11, REQ-203). */
  setScore(uid, mediaId, score) {
    return this._partial(
      mediaId,
      { score: score === undefined ? null : score },
      "setScore",
    );
  }

  /** Cambia SOLO `review` + `updatedAt` (API-11, REQ-203). */
  setReview(uid, mediaId, review) {
    return this._partial(
      mediaId,
      { review: review === undefined ? null : review },
      "setReview",
    );
  }

  /** Cambia SOLO `progress` + `updatedAt` (API-11, REQ-204). */
  setProgress(uid, mediaId, progress) {
    return this._partial(
      mediaId,
      { progress: progress === undefined ? null : progress },
      "setProgress",
    );
  }

  /**
   * Borra la entry (REQ-208): NO toca `catalog` ni colecciones.
   * Idempotente como `deleteDoc` (AC-128).
   * @returns {Promise<object>} `Result<true>`
   */
  async deleteEntry(uid, mediaId) {
    try {
      const id = requireText(mediaId, "El id del ítem (mediaId) es obligatorio.");
      this._write("deleteEntry");
      this._entries.delete(id);
      return okResult(true);
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Lista entries (DB-114/DB-115, AC-124): `updatedAt` desc + id
   * asc, filtro opcional por `status`, `pageSize` por defecto 24
   * (máx. 48) y cursor opaco. 1 lectura.
   * @param {string} uid
   * @param {object} [options]
   * @returns {Promise<object>} `Result<Page<Entry>>`
   */
  async listEntries(uid, options) {
    try {
      const opts = asOptions(options);
      const pageSize = resolvePageSize(
        opts.pageSize,
        DEFAULT_ENTRY_PAGE_SIZE,
        ENTRY_MAX_PAGE_SIZE,
      );
      const sort = opts.sort === undefined || opts.sort === null ? "updatedAt" : opts.sort;
      if (sort !== "updatedAt") {
        throw inputError(`Orden no válido: "${sort}". Valores permitidos: updatedAt.`);
      }

      let status = null;
      if (opts.status !== undefined && opts.status !== null) {
        if (!isEntryStatus(opts.status)) {
          throw inputError(
            `Estado inválido: "${opts.status}". Valores permitidos: ${ENTRY_STATUSES.join(", ")}.`,
          );
        }
        status = opts.status;
      }

      const offset =
        opts.cursor === undefined || opts.cursor === null
          ? 0
          : decodeOffsetCursor(opts.cursor);

      this._read("listEntries");
      let list = [...this._entries.values()];
      if (status !== null) list = list.filter((entry) => entry.status === status);
      list.sort(compareUpdatedAtDesc);

      const page = list.slice(offset, offset + pageSize);
      const nextOffset = offset + page.length;
      const cursor = nextOffset < list.length ? encodeOffsetCursor(nextOffset) : null;
      return okResult({ items: page.map(clone), cursor });
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Entries con `score >= minScore` (DB-116, ALG-08): orden `score`
   * desc + `updatedAt` desc. 1 lectura.
   * @param {string} uid
   * @param {number} minScore
   * @returns {Promise<object>} `Result<Entry[]>`
   */
  async listByMinScore(uid, minScore) {
    try {
      if (
        typeof minScore !== "number" ||
        !Number.isFinite(minScore) ||
        minScore < 0 ||
        minScore > 10
      ) {
        throw inputError("La puntuación mínima debe estar entre 0 y 10.");
      }
      this._read("listByMinScore");
      const list = [...this._entries.values()]
        .filter(
          (entry) =>
            typeof entry.score === "number" &&
            Number.isFinite(entry.score) &&
            entry.score >= minScore,
        )
        .sort(compareScoreDesc);
      return okResult(list.map(clone));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Suscripción al snapshot de entries (API-22, AC-137). El handler
   * recibe una copia de las entries actuales.
   * @param {string} uid
   * @param {(entries: object[]) => void} onChange
   * @returns {Function} `unsubscribe`
   */
  subscribeEntries(uid, onChange) {
    if (typeof onChange !== "function") {
      throw inputError("La suscripción necesita un callback.");
    }
    this._listeners.add(onChange);
    return () => {
      this._listeners.delete(onChange);
    };
  }

  /**
   * Evento de snapshot SIMULADO (AC-137): reemite las entries a los
   * oyentes. No es una lectura: el dashboard recalcula con
   * `computeDashboard` sobre su estado cacheado.
   * @returns {object[]} copia de las entries emitidas
   */
  emitSnapshot() {
    const payload = this.entries;
    for (const listener of [...this._listeners]) listener(payload);
    return payload;
  }
}

// -------------------------------------------------------------
// 7. FakeCatalogRepository (spec 05 AC-153, spec 02 API-01..API-05)
// -------------------------------------------------------------

/**
 * Repositorio del catálogo en memoria (spec 02 §2). Contador de
 * lecturas para el presupuesto de AC-153 (`listSeeded` = 1 lectura)
 * y de API-20 (`getAll(...ids)` = 1 lectura por página del dashboard).
 *
 * @example
 * const catalog = new FakeCatalogRepository([
 *   { id: "seed-1", title: "Alpha", mediaType: "SERIES", seed: true },
 * ]);
 * const service = createRecommendationService({ catalogRepository: catalog });
 * await catalog.listSeeded();  // ⇒ catalog.reads === 1
 */
export class FakeCatalogRepository {
  /** @param {ReadonlyArray<object>} [items] fixtures iniciales (DB-101) */
  constructor(items = []) {
    /** @type {Map<string, object>} */
    this._items = new Map();
    this.reads = 0;
    this.readLog = [];
    this.writes = 0;
    this.writeLog = [];
    this.seed(items);
  }

  /**
   * Reemplaza los items en memoria (sin contar lecturas).
   * @param {ReadonlyArray<object>} [items]
   * @returns {this}
   */
  seed(items = []) {
    this._items.clear();
    for (const raw of Array.isArray(items) ? items : []) {
      const item = normalizeMediaItemDoc(raw);
      this._items.set(item.id, item);
    }
    return this;
  }

  /** Copias de los items actuales. */
  get items() {
    return [...this._items.values()].map(clone);
  }

  /** Limpia el contador de lecturas (AC-153). */
  resetReads() {
    this.reads = 0;
    this.readLog = [];
    return this;
  }

  /** Limpia el contador de escrituras. */
  resetWrites() {
    this.writes = 0;
    this.writeLog = [];
    return this;
  }

  _read(method) {
    this.reads += 1;
    this.readLog.push(method);
  }

  _write(method) {
    this.writes += 1;
    this.writeLog.push(method);
  }

  /** Aplica el desplazamiento del cursor y devuelve la página. */
  _page(list, offset, pageSize) {
    const page = list.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    const cursor = nextOffset < list.length ? encodeOffsetCursor(nextOffset) : null;
    return { items: page.map(clone), cursor };
  }

  /**
   * Items `seed == true` ordenados por título (API-03, REQ-104).
   * Es la lectura de candidatos de ALG-08/AC-153: 1 sola.
   * @returns {Promise<object>} `Result<MediaItem[]>`
   */
  async listSeeded() {
    this._read("listSeeded");
    const seeded = [...this._items.values()]
      .filter((item) => item.seed === true)
      .sort(compareTitleThenId);
    return okResult(seeded.map(clone));
  }

  /**
   * Item por id (API-05). 1 lectura.
   * @param {string} mediaId
   * @returns {Promise<object>} `Result<MediaItem | null>`
   */
  async getById(mediaId) {
    try {
      const id = requireText(mediaId, "El id del ítem es obligatorio.");
      this._read("getById");
      const item = this._items.get(id);
      return okResult(item ? clone(item) : null);
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Lectura por lote `getAll(...ids)` (API-20, dashboard): 1 sola
   * lectura por página, nunca N+1. Acepta también un array
   * posicional (`getAll([a, b])`).
   * @param {...(string|string[])} ids
   * @returns {Promise<object>} `Result<MediaItem[]>`
   */
  async getAll(...ids) {
    try {
      const wanted =
        ids.length === 1 && Array.isArray(ids[0]) ? ids[0] : ids;
      const list = wanted.map((id) =>
        requireText(id, "El id del ítem es obligatorio."),
      );
      this._read("getAll");
      const found = [];
      const seen = new Set();
      for (const id of list) {
        if (seen.has(id)) continue;
        seen.add(id);
        const item = this._items.get(id);
        if (item) found.push(clone(item));
      }
      return okResult(found);
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Listado por tipo (REQ-101, DB-110..DB-112): orden `title`
   * (por defecto), `avgRating` o `releaseYear`, filtros secundarios
   * de REQ-103 y cursor. 1 lectura.
   * @param {string} mediaType
   * @param {object} [options]
   * @returns {Promise<object>} `Result<Page<MediaItem>>`
   */
  async listByType(mediaType, options) {
    try {
      const opts = asOptions(options);
      if (!isMediaItemType(mediaType)) {
        throw inputError(
          `mediaType inválido: "${mediaType}". Valores permitidos: ${MEDIA_ITEM_TYPES.join(", ")}.`,
        );
      }
      const sort = opts.sort === undefined || opts.sort === null ? "title" : opts.sort;
      const comparators = {
        title: compareTitleThenId,
        avgRating: compareRatingDesc,
        releaseYear: compareYearDesc,
      };
      if (!Object.hasOwn(comparators, sort)) {
        throw inputError(`Orden no válido: "${sort}". Valores permitidos: title, avgRating, releaseYear.`);
      }
      const pageSize = resolvePageSize(
        opts.pageSize,
        CATALOG_DEFAULT_PAGE_SIZE,
        CATALOG_MAX_PAGE_SIZE,
      );
      const filters = resolveSecondaryFilters(opts);
      const offset =
        opts.cursor === undefined || opts.cursor === null
          ? 0
          : decodeOffsetCursor(opts.cursor);

      this._read("listByType");
      const list = [...this._items.values()]
        .filter(
          (item) => item.mediaType === mediaType && matchesSecondaryFilters(item, filters),
        )
        .sort(comparators[sort]);
      return okResult(this._page(list, offset, pageSize));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Búsqueda por prefijo de título normalizado (REQ-102, DB-113).
   * Término vacío ⇒ página vacía SIN lectura (API-04).
   * @param {string} term
   * @param {object} [options]
   * @returns {Promise<object>} `Result<Page<MediaItem>>`
   */
  async searchByTitle(term, options) {
    try {
      const opts = asOptions(options);
      if (typeof term !== "string") {
        throw inputError("El término de búsqueda debe ser texto.");
      }
      const normalized = normalizeTitle(term);
      const pageSize = resolvePageSize(
        opts.pageSize,
        CATALOG_DEFAULT_PAGE_SIZE,
        CATALOG_MAX_PAGE_SIZE,
      );
      if (normalized === "") return okResult({ items: [], cursor: null });

      const mediaType =
        opts.mediaType === undefined || opts.mediaType === null
          ? null
          : opts.mediaType;
      if (mediaType !== null && !isMediaItemType(mediaType)) {
        throw inputError(
          `mediaType inválido: "${mediaType}". Valores permitidos: ${MEDIA_ITEM_TYPES.join(", ")}.`,
        );
      }
      const filters = resolveSecondaryFilters(opts);
      const offset =
        opts.cursor === undefined || opts.cursor === null
          ? 0
          : decodeOffsetCursor(opts.cursor);

      this._read("searchByTitle");
      const list = [...this._items.values()]
        .filter(
          (item) =>
            item.titleNormalized.startsWith(normalized) &&
            (mediaType === null || item.mediaType === mediaType) &&
            matchesSecondaryFilters(item, filters),
        )
        .sort(compareTitleThenId);
      return okResult(this._page(list, offset, pageSize));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Alta manual (REQ-105, AC-118): valida DB-120 ANTES de escribir
   * y nunca marca `seed`. Id determinista `tipo-titulo-año`.
   * @param {object} input
   * @returns {Promise<object>} `Result<MediaItem>`
   */
  async createMediaItem(input) {
    try {
      const report = validateMediaItem(input);
      if (!report.valid) throw inputError(report.errors.join(" "));

      const title = input.title.trim();
      const id =
        nonEmptyText(input.id) ??
        buildMediaItemId({
          mediaType: input.mediaType,
          title,
          releaseYear: input.releaseYear ?? null,
        });
      if (this._items.has(id)) {
        throw inputError(`Ya existe un ítem del catálogo con el id "${id}".`);
      }

      this._write("createMediaItem");
      const now = nextTimestamp();
      const item = normalizeMediaItemDoc({
        ...input,
        id,
        title,
        titleNormalized: normalizeTitle(title),
        genres: Array.isArray(input.genres) ? input.genres.slice() : [],
        avgRating: input.avgRating ?? null,
        creator: input.creator ?? null,
        synopsis: input.synopsis ?? null,
        metadata: isPlainObject(input.metadata) ? input.metadata : null,
        seed: false,
        createdAt: now,
        updatedAt: now,
      });
      this._items.set(id, item);
      return okResult(clone(item));
    } catch (error) {
      return toResultError(error);
    }
  }
}

// -------------------------------------------------------------
// 8. FakeCollectionRepository (spec 03 API-14, API-13, REQ-206/207)
// -------------------------------------------------------------

/**
 * Construye los datos de `create` validando DB-123 (name 1–60,
 * description ≤300). Lanza `validation` sin escribir.
 * @param {*} input
 * @returns {{name: string, description: string|null, itemIds: []}}
 */
function buildCollectionCreatePayload(input) {
  if (!isPlainObject(input)) {
    throw inputError("Los datos de la colección deben ser un objeto.");
  }
  const name = typeof input.name === "string" ? input.name.trim() : input.name;
  const rawDescription =
    input.description === undefined || input.description === null
      ? null
      : typeof input.description === "string"
        ? input.description.trim()
        : input.description;
  const report = validateCollection({
    name,
    description: rawDescription === "" ? null : rawDescription,
    itemIds: [],
  });
  if (!report.valid) throw inputError(report.errors.join(" "));
  return {
    name,
    description: rawDescription === "" || rawDescription == null ? null : rawDescription,
    itemIds: [],
  };
}

/**
 * Repositorio de colecciones en memoria (spec 03 §2). Sin red ni
 * Firebase; respeta los límites de DB-104/DB-123: ≤20 colecciones
 * por usuario (AC-126), `addItem` idempotente y ≤50 ítems (API-13,
 * AC-125).
 *
 * @example
 * const collections = new FakeCollectionRepository();
 * const { value } = await collections.create("u", { name: "Favoritos" });
 * await collections.addItem("u", value.id, "seed-1");
 */
export class FakeCollectionRepository {
  /** @param {ReadonlyArray<object>} [collections] fixtures (DB-104) */
  constructor(collections = []) {
    /** @type {Map<string, object>} */
    this._collections = new Map();
    this.reads = 0;
    this.readLog = [];
    this.writes = 0;
    this.writeLog = [];
    this.seed(collections);
  }

  /**
   * Reemplaza las colecciones en memoria (sin contar lecturas).
   * @param {ReadonlyArray<object>} [collections]
   * @returns {this}
   */
  seed(collections = []) {
    this._collections.clear();
    for (const raw of Array.isArray(collections) ? collections : []) {
      const collection = normalizeCollectionDoc(raw);
      this._collections.set(collection.id, collection);
    }
    return this;
  }

  /** Copias de las colecciones actuales. */
  get collections() {
    return [...this._collections.values()].map(clone);
  }

  /** Limpia el contador de lecturas. */
  resetReads() {
    this.reads = 0;
    this.readLog = [];
    return this;
  }

  /** Limpia el contador de escrituras. */
  resetWrites() {
    this.writes = 0;
    this.writeLog = [];
    return this;
  }

  _read(method) {
    this.reads += 1;
    this.readLog.push(method);
  }

  _write(method) {
    this.writes += 1;
    this.writeLog.push(method);
  }

  /** Id determinista `col-NNN` libre (DB-104 no impone formato). */
  _nextId() {
    let index = this._collections.size + 1;
    let id = `col-${String(index).padStart(3, "0")}`;
    while (this._collections.has(id)) {
      index += 1;
      id = `col-${String(index).padStart(3, "0")}`;
    }
    return id;
  }

  /**
   * Lee y materializa una colección; `not_found` si no existe.
   * (Mirada interna de un write: no suma lecturas.)
   * @param {string} id
   * @returns {object}
   */
  _requireCollection(id) {
    const collection = this._collections.get(id);
    if (!collection) throw notFoundError("No se ha encontrado la colección.");
    return collection;
  }

  /**
   * Colecciones del usuario (DB-117): `updatedAt` desc + id asc.
   * 1 lectura.
   * @param {string} uid
   * @returns {Promise<object>} `Result<Collection[]>`
   */
  async list(uid) {
    try {
      this._read("list");
      const list = [...this._collections.values()].sort(compareCollectionsDesc);
      return okResult(list.map(clone));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Colección por id (detalle UI-14). 1 lectura.
   * @param {string} uid
   * @param {string} collectionId
   * @returns {Promise<object>} `Result<Collection | null>`
   */
  async get(uid, collectionId) {
    try {
      const id = requireText(collectionId, "El id de la colección es obligatorio.");
      this._read("get");
      const collection = this._collections.get(id);
      return okResult(collection ? clone(collection) : null);
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Crea una colección (REQ-206). Valida DB-123 y el máximo de 20
   * ANTES de escribir: la 21.ª ⇒ `validation` sin escritura (AC-126).
   * @param {string} uid
   * @param {{name: string, description?: string}} input
   * @returns {Promise<object>} `Result<Collection>`
   */
  async create(uid, input) {
    try {
      const payload = buildCollectionCreatePayload(input);
      if (this._collections.size >= MAX_COLLECTIONS_PER_USER) {
        throw inputError(
          `Máximo ${MAX_COLLECTIONS_PER_USER} colecciones por usuario. Elimina alguna antes de crear otra.`,
        );
      }

      this._write("create");
      const id = this._nextId();
      const now = nextTimestamp();
      const collection = {
        ...payload,
        id,
        createdAt: now,
        updatedAt: now,
      };
      this._collections.set(id, collection);
      return okResult(clone(collection));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Edita `name`/`description` (REQ-206). Los `itemIds` NO se tocan
   * aquí: se gestionan con `addItem`/`removeItem`.
   * @param {string} uid
   * @param {string} collectionId
   * @param {{name?: string, description?: string|null}} patch
   * @returns {Promise<object>} `Result<Collection>`
   */
  async update(uid, collectionId, patch) {
    try {
      const id = requireText(collectionId, "El id de la colección es obligatorio.");
      if (!isPlainObject(patch)) {
        throw inputError("Los datos de la colección deben ser un objeto.");
      }
      const existing = clone(this._requireCollection(id));

      const payload = {};
      if (patch.name !== undefined) {
        if (typeof patch.name !== "string") {
          throw inputError("El nombre de la colección debe ser texto.");
        }
        payload.name = patch.name.trim();
      }
      if (patch.description !== undefined) {
        if (patch.description === null) payload.description = null;
        else if (typeof patch.description !== "string") {
          throw inputError("La descripción debe ser texto.");
        } else payload.description = patch.description.trim() || null;
      }

      const merged = {
        name: payload.name !== undefined ? payload.name : existing.name,
        description:
          payload.description !== undefined ? payload.description : existing.description,
        itemIds: existing.itemIds,
      };
      const report = validateCollection(merged);
      if (!report.valid) throw inputError(report.errors.join(" "));

      // Patch vacío: no-op sin escritura.
      if (Object.keys(payload).length === 0) return okResult(existing);

      this._write("update");
      const updated = {
        ...existing,
        ...payload,
        updatedAt: nextTimestamp(),
      };
      this._collections.set(id, updated);
      return okResult(clone(updated));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Borra SOLO la colección (REQ-208, AC-128): no toca `entries`
   * ni `catalog`. Idempotente como `deleteDoc`.
   * @param {string} uid
   * @param {string} collectionId
   * @returns {Promise<object>} `Result<true>`
   */
  async delete(uid, collectionId) {
    try {
      const id = requireText(collectionId, "El id de la colección es obligatorio.");
      this._write("delete");
      this._collections.delete(id);
      return okResult(true);
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Añade un `mediaId` de forma IDEMPOTENTE (API-13, AC-125):
   * ya presente ⇒ `ok` sin escritura; con 50 ítems ⇒ `validation`
   * sin escritura; si no, unión y `updatedAt`.
   * @param {string} uid
   * @param {string} collectionId
   * @param {string} mediaId
   * @returns {Promise<object>} `Result<Collection>`
   */
  async addItem(uid, collectionId, mediaId) {
    try {
      const id = requireText(collectionId, "El id de la colección es obligatorio.");
      const media = requireText(mediaId, "El id del ítem (mediaId) es obligatorio.");
      const existing = this._requireCollection(id);

      if (existing.itemIds.includes(media)) return okResult(clone(existing));
      if (existing.itemIds.length >= MAX_COLLECTION_ITEMS) {
        throw inputError(
          `No se pueden guardar más de ${MAX_COLLECTION_ITEMS} ítems en una colección.`,
        );
      }

      this._write("addItem");
      const updated = {
        ...existing,
        itemIds: [...existing.itemIds, media],
        updatedAt: nextTimestamp(),
      };
      this._collections.set(id, updated);
      return okResult(clone(updated));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Quita un `mediaId` (REQ-207, AC-127): escribe SOLO `itemIds`
   * (+`updatedAt`) y NO toca la entry de tracking del ítem. Quitar
   * algo ausente es un no-op sin escritura.
   * @param {string} uid
   * @param {string} collectionId
   * @param {string} mediaId
   * @returns {Promise<object>} `Result<Collection>`
   */
  async removeItem(uid, collectionId, mediaId) {
    try {
      const id = requireText(collectionId, "El id de la colección es obligatorio.");
      const media = requireText(mediaId, "El id del ítem (mediaId) es obligatorio.");
      const existing = this._requireCollection(id);

      if (!existing.itemIds.includes(media)) return okResult(clone(existing));

      this._write("removeItem");
      const updated = {
        ...existing,
        itemIds: existing.itemIds.filter((entry) => entry !== media),
        updatedAt: nextTimestamp(),
      };
      this._collections.set(id, updated);
      return okResult(clone(updated));
    } catch (error) {
      return toResultError(error);
    }
  }
}

// -------------------------------------------------------------
// 9. Fixtures compartidas de AC-137 (spec 04) — UN solo hogar
// -------------------------------------------------------------

/**
 * Fixtures del escenario de recálculo por snapshot (AC-137/API-22):
 * las usan `tests/fakes.test.js` y `tests/dashboard-stats.test.js`
 * para no duplicar datos entre archivos. Son de solo lectura: los
 * fakes siempre materializan copias.
 */

/** Entries de partida: m-1 y m-4 en PLANNED. */
export const AC137_TRACKING_FIXTURE = Object.freeze([
  Object.freeze({
    mediaId: "m-1",
    title: "Alpha",
    status: "PLANNED",
    updatedAt: "2026-04-01T10:00:00.000Z",
  }),
  Object.freeze({
    mediaId: "m-2",
    title: "Beta",
    status: "IN_PROGRESS",
    updatedAt: "2026-04-02T10:00:00.000Z",
  }),
  Object.freeze({
    mediaId: "m-3",
    title: "Gamma",
    status: "COMPLETED",
    updatedAt: "2026-04-03T10:00:00.000Z",
  }),
  Object.freeze({
    mediaId: "m-4",
    title: "Delta",
    status: "PLANNED",
    updatedAt: "2026-04-04T10:00:00.000Z",
  }),
]);

/** Catálogo correspondiente (SERIES, GAME, MOVIE, BOOK). */
export const AC137_CATALOG_FIXTURE = Object.freeze([
  Object.freeze({ id: "m-1", title: "Alpha", mediaType: "SERIES" }),
  Object.freeze({ id: "m-2", title: "Beta", mediaType: "GAME" }),
  Object.freeze({ id: "m-3", title: "Gamma", mediaType: "MOVIE" }),
  Object.freeze({ id: "m-4", title: "Delta", mediaType: "BOOK" }),
]);

/** Totales antes del cambio de estado. */
export const AC137_TOTALS_BEFORE = Object.freeze({
  total: 4,
  planned: 2,
  inProgress: 1,
  completed: 1,
  dropped: 0,
});

/** Totales tras pasar m-1 de PLANNED a COMPLETED (AC-137). */
export const AC137_TOTALS_AFTER = Object.freeze({
  total: 4,
  planned: 1,
  inProgress: 1,
  completed: 2,
  dropped: 0,
});

export default {
  FakeCatalogRepository,
  FakeTrackingRepository,
  FakeCollectionRepository,
  AC137_TRACKING_FIXTURE,
  AC137_CATALOG_FIXTURE,
  AC137_TOTALS_BEFORE,
  AC137_TOTALS_AFTER,
};
