// =============================================================
// Repositorio del catálogo (spec 02 API-01..API-05, REQ-101..REQ-103;
// spec 01 DB-110..DB-113; spec 00 REQ-E1/REQ-E2).
//
// Dos capas en un único módulo:
//
//  1) PARTE PURA (importable en Node/vitest SIN red y SIN Firebase):
//     validación de opciones (pageSize 24/48, sort, filtros), cursor
//     OPACO (base64url de las claves de orden, sin exponer snapshots,
//     API-02), rango de prefijo sobre `titleNormalized` (DB-113,
//     REQ-102), materialización de `MediaItem` (DB-101) y traducción de
//     errores a `Result` (00 §4.1, REQ-E1/E2).
//
//  2) PARTE STORE (Firestore): `createFirestoreCatalogStore()` importa
//     `../firebase.js` de forma perezosa (REQ-C1), de modo que la parte
//     pura se puede importar en Node sin red. La parte pura se prueba
//     con un store falso inyectado (`createCatalogRepository(store)`).
//
//     SEC-02 / AC-101: `catalog/**` es `write:false` para clientes, así
//     que el store no escribe con `setDoc`: `save()` exige una ruta
//     privilegiada inyectada (`writeCatalogItem`: Admin SDK o Cloud
//     Function). Sin ella devuelve `permission_denied`.
//
// Contrato (spec 02 §2):
//   type Page<T> = { items: T[]; cursor: string | null };
//   listByType(mediaType, opts?)      -> Result<Page<MediaItem>>
//   searchByTitle(term, opts?)        -> Result<Page<MediaItem>>
//   getById(mediaId)                  -> Result<MediaItem | null>
//   listSeeded()                      -> Result<MediaItem[]>
//   createMediaItem(input)            -> Result<MediaItem>
//
// Notas de índices (DB-110..DB-113):
//   - listByType: `mediaType ==` + orderBy `titleNormalized` (DB-110),
//     `avgRating` (DB-111) o `releaseYear` (DB-112).
//   - searchByTitle: rango de prefijo sobre `titleNormalized` (DB-113),
//     orden fijo por título (el contrato no admite `sort` aquí).
//   - listSeeded: `seed == true` sin `orderBy` (no hay índice declarado
//     para `seed` + título); el orden se aplica en memoria.
//   Los filtros secundarios de REQ-103 (género, rango de año,
//   `avgRating` mínimo) se aplican sobre la página ya leída porque no
//   hay índices compuestos declarados para ellos; así una página sigue
//   siendo UNA lectura (AC-111).
// =============================================================

import {
  MEDIA_ITEM_TYPES,
  isMediaItemType,
  normalizeTitle,
  tsToDate,
  validateMediaItem,
} from "../catalog.js";

// -------------------------------------------------------------
// 1. Constantes del contrato
// -------------------------------------------------------------

/** Colección Firestore del catálogo (DB-101). */
export const CATALOG_COLLECTION = "catalog";

/** Tamaño de página por defecto (REQ-101, API-01). */
export const DEFAULT_PAGE_SIZE = 24;

/** Tamaño de página máximo (REQ-101: default 24, max 48). */
export const MAX_PAGE_SIZE = 48;

/** Órdenes admitidos por `listByType` (spec 02 §2). */
export const CATALOG_SORTS = Object.freeze(["title", "avgRating", "releaseYear"]);

/** Orden por defecto del catálogo (REQ-101: título ascendente). */
export const DEFAULT_CATALOG_SORT = "title";

/**
 * Carácter centinela del límite superior del prefijo (DB-113).
 *
 * DB-113 describe el rango como `>= term` y `< term\uffff`. Se usa
 * `<=` con U+F8FF (centinela convencional de prefijos en Firestore):
 * U+F8FF es el último carácter del área de uso privado del BMP y queda
 * por encima de cualquier carácter real de un título normalizado, así
 * que el rango inclusivo cubre el mismo conjunto que el exclusivo con
 * U+FFFF para los datos de DB-101/DB-121 (que no contienen U+F8FF).
 * Justificado aquí (y fijado por los tests de AC-112) para no cambiar
 * el límite publicado del contrato.
 */
export const PREFIX_UPPER_BOUND = "\uf8ff";

/**
 * Campo especial de orden por id de documento. El store lo traduce a
 * `documentId()`; nunca se envía como cadena a Firestore.
 */
export const DOCUMENT_ID_FIELD = "__name__";

/** Códigos de error admitidos por `Result` (00 §4.1). */
export const RESULT_ERROR_CODES = Object.freeze([
  "not_found",
  "permission_denied",
  "validation",
  "unavailable",
  "unknown",
]);

/** Versión del formato de cursor opaco (API-02). */
const CURSOR_VERSION = 1;

// Especificación de orden por `sort` (DB-110..DB-112). El id de
// documento rompe empates y hace el cursor determinista.
const SORT_ORDER_BY = Object.freeze({
  title: Object.freeze([
    Object.freeze({ field: "titleNormalized", direction: "asc" }),
    Object.freeze({ field: DOCUMENT_ID_FIELD, direction: "asc" }),
  ]),
  avgRating: Object.freeze([
    Object.freeze({ field: "avgRating", direction: "desc" }),
    Object.freeze({ field: DOCUMENT_ID_FIELD, direction: "asc" }),
  ]),
  releaseYear: Object.freeze([
    Object.freeze({ field: "releaseYear", direction: "desc" }),
    Object.freeze({ field: DOCUMENT_ID_FIELD, direction: "asc" }),
  ]),
});

// -------------------------------------------------------------
// 2. Result y errores (00 §4.1, REQ-E1, REQ-E2, API-05)
// -------------------------------------------------------------

/** Resultado correcto. */
export function okResult(value) {
  return { ok: true, value };
}

/** Resultado con error normalizado. */
export function failResult(code, message, extra = {}) {
  const result = { ok: false, code, message };
  if (extra && Array.isArray(extra.errors) && extra.errors.length > 0) {
    result.errors = extra.errors.slice();
  }
  return result;
}

/** Mensajes en español por código (REQ-E2; API-05 allowlist visible). */
const ERROR_MESSAGES = Object.freeze({
  not_found: "No se ha encontrado el ítem del catálogo.",
  permission_denied:
    "Tu cuenta no tiene permiso para leer el catálogo. Comprueba que estás en la lista de personas autorizadas.",
  validation: "Los datos del catálogo no son válidos.",
  unavailable:
    "El catálogo no está disponible en este momento. Vuelve a intentarlo en unos segundos.",
  unknown: "Ha ocurrido un error inesperado al consultar el catálogo.",
});

/** Códigos de Firestore → códigos de `Result` (REQ-E2). */
const FIREBASE_CODE_MAP = Object.freeze({
  "not-found": "not_found",
  "permission-denied": "permission_denied",
  unauthenticated: "permission_denied",
  "invalid-argument": "validation",
  "failed-precondition": "unavailable",
  unavailable: "unavailable",
  "deadline-exceeded": "unavailable",
  "resource-exhausted": "unavailable",
  aborted: "unavailable",
  cancelled: "unknown",
  internal: "unknown",
  unknown: "unknown",
});

/** Error de entrada (validación) con el formato de REQ-E3. */
function inputError(message, errors = [message]) {
  const error = new Error(errors.join(" "));
  error.code = "validation";
  error.errors = errors.slice();
  return error;
}

/** Normaliza cualquier `code` de Firestore/JS a los de `Result`. */
export function normalizeErrorCode(code) {
  if (typeof code !== "string" || code === "") return "unknown";
  if (RESULT_ERROR_CODES.includes(code)) return code;
  return FIREBASE_CODE_MAP[code.toLowerCase()] ?? "unknown";
}

/**
 * Convierte un error en `{ ok:false, code, message, errors? }` (REQ-E1,
 * REQ-E2, REQ-E3). Nunca lanza.
 * @param {*} error
 * @returns {{ ok: false, code: string, message: string, errors?: string[] }}
 */
export function toResultError(error) {
  const code = normalizeErrorCode(error?.code);
  const rawErrors =
    error && Array.isArray(error.errors)
      ? error.errors.filter((message) => typeof message === "string" && message.trim() !== "")
      : [];
  const message =
    code === "validation" && rawErrors.length > 0
      ? rawErrors.join(" ")
      : ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown;
  return failResult(code, message, { errors: rawErrors });
}

// -------------------------------------------------------------
// 3. Cursor opaco (API-02)
// -------------------------------------------------------------

function encodeBase64Url(text) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64url");
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(token) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(token, "base64url").toString("utf8");
  }
  const padded = token.padEnd(token.length + ((4 - (token.length % 4)) % 4), "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Valor de orden de un doc para el cursor (nunca snapshots, API-02). */
function cursorValueFor(order, doc) {
  if (order.field === DOCUMENT_ID_FIELD) {
    return typeof doc?.id === "string" && doc.id !== "" ? doc.id : null;
  }
  if (order.field === "titleNormalized") {
    if (typeof doc?.titleNormalized === "string" && doc.titleNormalized !== "") {
      return doc.titleNormalized;
    }
    const fallback = normalizeTitle(doc?.title);
    return fallback === "" ? null : fallback;
  }
  const value = doc?.[order.field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Serializa la posición de un documento como cursor OPACO para la UI
 * (API-02). Si alguna clave de orden falta (`avgRating`/`releaseYear`
 * son opcionales, DB-101), el cursor apunta al DOCUMENTO (`d`) para que
 * el store reanude con su snapshot y el listado no se trunque.
 * @param {ReadonlyArray<{field: string, direction: string}>} orderBy
 * @param {object} doc
 * @returns {string|null}
 */
export function encodeCursor(orderBy, doc) {
  const fields = orderBy.map((order) => order.field);
  const keys = orderBy.map((order) => cursorValueFor(order, doc));
  const idIndex = orderBy.findIndex((order) => order.field === DOCUMENT_ID_FIELD);
  const docId = idIndex >= 0 ? keys[idIndex] : null;

  if (keys.some((key) => key === null)) {
    if (typeof docId !== "string" || docId === "") return null;
    return encodeBase64Url(
      JSON.stringify({ v: CURSOR_VERSION, f: fields, k: keys, d: docId }),
    );
  }

  return encodeBase64Url(JSON.stringify({ v: CURSOR_VERSION, f: fields, k: keys }));
}

/**
 * Decodifica y valida un cursor opaco. Lanza `validation` si está
 * corrupto o no corresponde al orden esperado (nunca confiar en la UI).
 * Los huecos (`null`) solo son válidos cuando el cursor trae el id del
 * documento (`d`) con el que reanudar.
 * @param {string} token
 * @param {ReadonlyArray<{field: string}>} [orderBy]
 * @returns {Array<string|number|null>}
 */
export function decodeCursor(token, orderBy) {
  if (typeof token !== "string" || token.trim() === "") {
    throw inputError("El cursor no es válido.", ["El cursor no es válido."]);
  }
  const trimmed = token.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw inputError("El cursor no es válido.", ["El cursor no es válido."]);
  }

  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(trimmed));
  } catch {
    throw inputError("El cursor no es válido.", ["El cursor no es válido."]);
  }

  const keys = payload?.k;
  if (
    !payload ||
    payload.v !== CURSOR_VERSION ||
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.some(
      (key) => key !== null && typeof key !== "string" && typeof key !== "number",
    ) ||
    !Array.isArray(payload.f) ||
    payload.f.length !== keys.length
  ) {
    throw inputError("El cursor no es válido.", ["El cursor no es válido."]);
  }

  // Un hueco solo se puede reanudar por documento (DB-101): el cursor
  // debe traer un id válido (API-02).
  if (keys.includes(null) && (typeof payload.d !== "string" || payload.d === "")) {
    throw inputError("El cursor no es válido.", ["El cursor no es válido."]);
  }

  if (Array.isArray(orderBy)) {
    if (
      orderBy.length !== keys.length ||
      orderBy.some((order, index) => order.field !== payload.f[index])
    ) {
      throw inputError("El cursor no corresponde a este listado.", [
        "El cursor no corresponde a este listado.",
      ]);
    }
  }

  return keys;
}

// -------------------------------------------------------------
// 4. Opciones y queries (REQ-101..REQ-103)
// -------------------------------------------------------------

/** @returns {object} */
function asOptions(options) {
  if (options === undefined || options === null) return {};
  if (typeof options !== "object" || Array.isArray(options)) {
    throw inputError("Las opciones de consulta deben ser un objeto.", [
      "Las opciones de consulta deben ser un objeto.",
    ]);
  }
  return options;
}

/**
 * Resuelve `pageSize`: por defecto 24, como máximo 48 (REQ-101). Lanza
 * `validation` si no es un entero ≥1.
 * @param {*} pageSize
 * @returns {number}
 */
export function resolvePageSize(pageSize) {
  if (pageSize === undefined || pageSize === null) return DEFAULT_PAGE_SIZE;
  if (typeof pageSize !== "number" || !Number.isInteger(pageSize)) {
    throw inputError("El tamaño de página debe ser un número entero.", [
      "El tamaño de página debe ser un número entero.",
    ]);
  }
  if (pageSize < 1) {
    throw inputError("El tamaño de página debe ser mayor o igual que 1.", [
      "El tamaño de página debe ser mayor o igual que 1.",
    ]);
  }
  return Math.min(pageSize, MAX_PAGE_SIZE);
}

/** Valida y normaliza el `mediaType` (DB-101). */
function requireMediaType(mediaType) {
  if (mediaType === undefined || mediaType === null) {
    throw inputError("El tipo de medio es obligatorio.", ["El tipo de medio es obligatorio."]);
  }
  if (!isMediaItemType(mediaType)) {
    throw inputError(`mediaType inválido: "${mediaType}".`, [
      `mediaType inválido: "${mediaType}". Valores permitidos: ${MEDIA_ITEM_TYPES.join(", ")}.`,
    ]);
  }
  return mediaType;
}

/** Valida el orden y devuelve sus claves (DB-110..DB-112). */
function requireSort(sort) {
  const value = sort === undefined || sort === null ? DEFAULT_CATALOG_SORT : sort;
  if (!CATALOG_SORTS.includes(value)) {
    throw inputError(`Orden no válido: "${value}".`, [
      `Orden no válido: "${value}". Valores permitidos: ${CATALOG_SORTS.join(", ")}.`,
    ]);
  }
  return value;
}

function optionalInteger(value, label, min, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw inputError(`${label} debe ser un número entero.`, [
      `${label} debe ser un número entero.`,
    ]);
  }
  if (value < min || value > max) {
    throw inputError(`${label} debe estar entre ${min} y ${max}.`, [
      `${label} debe estar entre ${min} y ${max}.`,
    ]);
  }
  return value;
}

/**
 * Normaliza los filtros secundarios de REQ-103. Devuelve `null` en los
 * filtros ausentes. Lanza `validation` si algún valor es inválido.
 * @param {object} [options]
 * @returns {{genre: string|null, yearFrom: number|null, yearTo: number|null, minAvgRating: number|null}}
 */
export function resolveSecondaryFilters(options = {}) {
  const opts = asOptions(options);
  const filters = {
    genre: null,
    yearFrom: optionalInteger(opts.yearFrom, "El año inicial (yearFrom)", 1888, 2100),
    yearTo: optionalInteger(opts.yearTo, "El año final (yearTo)", 1888, 2100),
    minAvgRating: null,
  };

  if (opts.genre !== undefined && opts.genre !== null) {
    if (typeof opts.genre !== "string" || opts.genre.trim() === "") {
      throw inputError("El filtro de género debe ser texto no vacío.", [
        "El filtro de género debe ser texto no vacío.",
      ]);
    }
    filters.genre = opts.genre.trim();
  }

  if (opts.minAvgRating !== undefined && opts.minAvgRating !== null) {
    if (typeof opts.minAvgRating !== "number" || !Number.isFinite(opts.minAvgRating)) {
      throw inputError("La valoración mínima (minAvgRating) debe ser un número.", [
        "La valoración mínima (minAvgRating) debe ser un número.",
      ]);
    }
    if (opts.minAvgRating < 0 || opts.minAvgRating > 10) {
      throw inputError("La valoración mínima debe estar entre 0 y 10.", [
        "La valoración mínima debe estar entre 0 y 10.",
      ]);
    }
    filters.minAvgRating = opts.minAvgRating;
  }

  if (
    filters.yearFrom !== null &&
    filters.yearTo !== null &&
    filters.yearFrom > filters.yearTo
  ) {
    throw inputError("El rango de años no es válido: yearFrom supera yearTo.", [
      "El rango de años no es válido: yearFrom no puede superar yearTo.",
    ]);
  }

  return filters;
}

/** ¿Hay algún filtro secundario activo? (REQ-103) */
export function hasSecondaryFilters(filters) {
  return Boolean(
    filters &&
      (filters.genre !== null ||
        filters.yearFrom !== null ||
        filters.yearTo !== null ||
        filters.minAvgRating !== null),
  );
}

/** Compara textos como `normalizeTitle` (acentos/mayúsculas irrelevantes). */
function sameNormalizedText(a, b) {
  return normalizeTitle(a) === normalizeTitle(b);
}

/**
 * Filtros secundarios sobre un doc ya leído (REQ-103). Se aplican en
 * memoria porque no hay índices compuestos declarados para ellos.
 * @param {object} doc
 * @param {object} filters resultado de `resolveSecondaryFilters`
 * @returns {boolean}
 */
export function matchesSecondaryFilters(doc, filters) {
  if (!doc || typeof doc !== "object" || !hasSecondaryFilters(filters)) return true;

  if (filters.genre !== null) {
    const genres = Array.isArray(doc.genres) ? doc.genres : [];
    if (!genres.some((genre) => sameNormalizedText(genre, filters.genre))) return false;
  }

  if (filters.yearFrom !== null || filters.yearTo !== null) {
    if (typeof doc.releaseYear !== "number" || !Number.isFinite(doc.releaseYear)) return false;
    if (filters.yearFrom !== null && doc.releaseYear < filters.yearFrom) return false;
    if (filters.yearTo !== null && doc.releaseYear > filters.yearTo) return false;
  }

  if (filters.minAvgRating !== null) {
    if (typeof doc.avgRating !== "number" || !Number.isFinite(doc.avgRating)) return false;
    if (doc.avgRating < filters.minAvgRating) return false;
  }

  return true;
}

/**
 * Construye la query de `listByType` (REQ-101, DB-110..DB-112):
 * `mediaType == tipo` + orden + `limit(pageSize + 1)` + cursor.
 * @param {string} mediaType
 * @param {object} [options]
 * @returns {{spec: object, filters: object, pageSize: number}}
 */
export function resolveListByTypeQuery(mediaType, options) {
  const opts = asOptions(options);
  const type = requireMediaType(mediaType);
  const sort = requireSort(opts.sort);
  const pageSize = resolvePageSize(opts.pageSize);
  const orderBy = SORT_ORDER_BY[sort];
  const filters = resolveSecondaryFilters(opts);
  const startAfter =
    opts.cursor === undefined || opts.cursor === null
      ? null
      : decodeCursor(opts.cursor, orderBy);

  return {
    pageSize,
    filters,
    spec: {
      collection: CATALOG_COLLECTION,
      filters: [{ field: "mediaType", op: "==", value: type }],
      orderBy,
      // +1 para saber si hay página siguiente sin una lectura extra.
      limit: pageSize + 1,
      startAfter,
    },
  };
}

/**
 * Construye la query de `searchByTitle` (REQ-102, DB-113): prefijo
 * sobre el título normalizado completo (DB-121).
 *
 * El contrato de `searchByTitle` (spec 02 §2) NO admite `sort`: el
 * orden es siempre `titleNormalized` asc + id (DB-113, rango+orderBy),
 * igual que el orden por defecto de `listByType`. `term`
 * vacío/insignificante → `spec: null` y página vacía (API-04).
 * @param {string} term
 * @param {object} [options]
 * @returns {{term: string, spec: object|null, filters: object, pageSize: number}}
 */
export function resolveSearchByTitleQuery(term, options) {
  const opts = asOptions(options);
  if (typeof term !== "string") {
    throw inputError("El término de búsqueda debe ser texto.", [
      "El término de búsqueda debe ser texto.",
    ]);
  }
  const normalized = normalizeTitle(term);
  const pageSize = resolvePageSize(opts.pageSize);
  const filters = resolveSecondaryFilters(opts);

  if (normalized === "") {
    return { term: normalized, spec: null, filters, pageSize };
  }

  const mediaType =
    opts.mediaType === undefined || opts.mediaType === null
      ? null
      : requireMediaType(opts.mediaType);
  const orderBy = SORT_ORDER_BY.title;
  const startAfter =
    opts.cursor === undefined || opts.cursor === null
      ? null
      : decodeCursor(opts.cursor, orderBy);

  const queryFilters = [];
  if (mediaType !== null) queryFilters.push({ field: "mediaType", op: "==", value: mediaType });
  queryFilters.push({ field: "titleNormalized", op: ">=", value: normalized });
  queryFilters.push({
    field: "titleNormalized",
    op: "<=",
    value: normalized + PREFIX_UPPER_BOUND,
  });

  return {
    term: normalized,
    filters,
    pageSize,
    spec: {
      collection: CATALOG_COLLECTION,
      filters: queryFilters,
      orderBy,
      limit: pageSize + 1,
      startAfter,
    },
  };
}

// -------------------------------------------------------------
// 5. Materialización de `MediaItem` (DB-101)
// -------------------------------------------------------------

/**
 * Convierte un doc del catálogo en `MediaItem`: normaliza `id`,
 * `titleNormalized` (calculado si falta), `genres`, `seed` y las fechas.
 * Acepta tanto un objeto plano `{ id, ...data }` como un snapshot con
 * `data()`.
 * @param {*} doc
 * @returns {object}
 */
export function materializeMediaItem(doc) {
  if (!doc || typeof doc !== "object") {
    throw inputError("El documento del catálogo no es válido.", [
      "El documento del catálogo no es válido.",
    ]);
  }
  const data =
    typeof doc.data === "function" ? doc.data() || {} : { ...doc };
  const id = typeof doc.id === "string" ? doc.id : data.id;
  if (typeof id !== "string" || id === "") {
    throw inputError("El documento del catálogo no tiene id.", [
      "El documento del catálogo no tiene id.",
    ]);
  }

  const item = { ...data, id };
  item.titleNormalized =
    typeof data.titleNormalized === "string" && data.titleNormalized !== ""
      ? data.titleNormalized
      : normalizeTitle(data.title);
  item.genres = Array.isArray(data.genres)
    ? data.genres.filter((genre) => typeof genre === "string")
    : [];
  item.seed = data.seed === true;
  item.metadata =
    data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? data.metadata
      : null;
  for (const field of ["createdAt", "updatedAt"]) {
    if (Object.prototype.hasOwnProperty.call(item, field)) {
      item[field] = tsToDate(item[field]);
    }
  }
  return item;
}

// -------------------------------------------------------------
// 6. Alta manual de `MediaItem` (REQ-105, DB-101, AC-118)
// -------------------------------------------------------------

/** Slug estable a partir de un título normalizado (DB-101). */
function slugify(text) {
  const slug = normalizeTitle(text).replace(/\s+/g, "-").slice(0, 60).replace(/-+$/, "");
  return slug === "" ? "item" : slug;
}

/**
 * Doc id determinista `tipo-titulo-año` (DB-101). No incluye el año si
 * falta o si ya aparece en el título.
 * @param {{mediaType: string, title: string, releaseYear?: number|null}} input
 * @returns {string}
 */
export function buildMediaItemId(input) {
  const mediaType = String(input?.mediaType ?? "").toLowerCase() || "item";
  const title = typeof input?.title === "string" ? input.title : "";
  const year = Number.isInteger(input?.releaseYear) ? input.releaseYear : null;
  const base = `${mediaType}-${slugify(title)}`;
  if (year === null) return base;
  const slug = slugify(title);
  return slug.includes(String(year)) ? base : `${base}-${year}`;
}

/**
 * Valida el alta manual (DB-120/DB-121) y construye `{ id, data }`
 * listo para `setDoc` (DB-101). Lanza `validation` si no es válido.
 * @param {object} input
 * @returns {{id: string, data: object}}
 */
export function buildCreatePayload(input) {
  const report = validateMediaItem(input);
  if (!report.valid) throw inputError(report.errors.join(" "), report.errors);

  const mediaType = input.mediaType;
  const title = input.title.trim();
  const releaseYear = input.releaseYear ?? null;
  const id =
    typeof input.id === "string" && input.id.trim() !== ""
      ? input.id.trim()
      : buildMediaItemId({ mediaType, title, releaseYear });

  return {
    id,
    data: {
      mediaType,
      title,
      titleNormalized: normalizeTitle(title),
      coverUrl: input.coverUrl ?? null,
      releaseYear,
      genres: Array.isArray(input.genres) ? input.genres.slice() : [],
      avgRating: input.avgRating ?? null,
      creator: input.creator ?? null,
      synopsis: input.synopsis ?? null,
      metadata: { ...input.metadata },
      // AC-118: el alta manual NUNCA marca `seed` (aunque el input lo
      // pida); `seed:true` queda reservado al seed privilegiado (API-03).
      seed: false,
    },
  };
}

// -------------------------------------------------------------
// 7. Parte store: Firestore (REQ-C1, API-01)
// -------------------------------------------------------------

// El SDK modular llega SIEMPRE por `js/firebase.js`, que reexporta las
// funciones de Firestore (`where`, `documentId`, ...). No se importa el
// CDN aquí: una única URL/instancia (REQ-C1, sin duplicar URLs).
// El import es dinámico y solo ocurre al usar el store, así que la parte
// pura se puede importar en Node/vitest sin red.
let firestoreSdkPromise = null;

function loadFirestoreSdk() {
  if (!firestoreSdkPromise) {
    firestoreSdkPromise = import("../firebase.js").catch((error) => {
      firestoreSdkPromise = null;
      throw error;
    });
  }
  return firestoreSdkPromise;
}

/** Constraint de orden: `__name__` se traduce a `documentId()`. */
function buildOrderByConstraint(sdk, order) {
  const field = order.field === DOCUMENT_ID_FIELD ? sdk.documentId() : order.field;
  return sdk.orderBy(field, order.direction);
}

/**
 * Constraint `startAfter` (API-02). El cursor opaco transporta el id de
 * documento como cadena, pero `documentId()` exige una referencia: se
 * mapea con `doc(collectionRef, id)` antes de cursorear la página 2+.
 *
 * Si el cursor tiene un hueco (`avgRating`/`releaseYear` son opcionales,
 * DB-101) no hay valor que enviar en esa posición: se reanuda con el
 * snapshot del documento, válido para cualquier `orderBy`. Esa ruta
 * cuesta una lectura extra, pero solo ocurre con docs sin clave de orden.
 */
async function buildStartAfterConstraint(sdk, collectionRef, orderBy, keys) {
  const idIndex = orderBy.findIndex((order) => order.field === DOCUMENT_ID_FIELD);
  const cursorId = idIndex >= 0 ? keys[idIndex] : null;

  if (keys.some((key) => key === null)) {
    if (typeof cursorId !== "string" || cursorId === "") {
      throw inputError("El cursor no es válido.", ["El cursor no es válido."]);
    }
    const cursorSnapshot = await sdk.getDoc(sdk.doc(collectionRef, cursorId));
    if (!cursorSnapshot.exists()) {
      throw inputError("El cursor ya no es válido.", [
        "El cursor ya no es válido: el documento de origen no existe.",
      ]);
    }
    return sdk.startAfter(cursorSnapshot);
  }

  const values = keys.map((key, index) => {
    const order = orderBy[index];
    if (order?.field === DOCUMENT_ID_FIELD) {
      if (typeof key !== "string" || key === "") {
        throw inputError("El cursor no es válido.", ["El cursor no es válido."]);
      }
      return sdk.doc(collectionRef, key);
    }
    return key;
  });
  return sdk.startAfter(...values);
}

/** Query spec → query de Firestore (una sola lectura, AC-111). */
async function runFirestoreQuery(spec) {
  const sdk = await loadFirestoreSdk();
  const collectionRef = sdk.collection(sdk.db, CATALOG_COLLECTION);
  const constraints = [];
  for (const filter of spec.filters ?? []) {
    constraints.push(sdk.where(filter.field, filter.op, filter.value));
  }
  for (const order of spec.orderBy ?? []) {
    constraints.push(buildOrderByConstraint(sdk, order));
  }
  if (typeof spec.limit === "number" && Number.isFinite(spec.limit)) {
    constraints.push(sdk.limit(spec.limit));
  }
  if (Array.isArray(spec.startAfter) && spec.startAfter.length > 0) {
    constraints.push(
      await buildStartAfterConstraint(sdk, collectionRef, spec.orderBy ?? [], spec.startAfter),
    );
  }
  const snapshot = await sdk.getDocs(sdk.query(collectionRef, ...constraints));
  return {
    docs: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
  };
}

/**
 * Store respaldado por Firestore. Cada método hace su propio import
 * dinámico del SDK (REQ-C1), de modo que este módulo se puede importar
 * sin red.
 *
 * SEC-02 / AC-101: `catalog/**` es `allow write: if false` para
 * clientes. Por eso este store NUNCA escribe con `setDoc` desde el
 * navegador: las altas (REQ-105) y el seed (API-03) usan una ruta
 * privilegiada inyectada (`writeCatalogItem`, p. ej. Cloud Function
 * callable o script con Admin SDK). Sin ella, `save()` devuelve
 * `permission_denied` en vez de un `setDoc` condenado a fallar.
 *
 * @param {{
 *   writeCatalogItem?: (docId: string|null, data: object) => Promise<{id?: string}|void>
 * }} [options] `writeCatalogItem` recibe el id determinista (o `null`
 *        para id automático) y los datos completos, y los persiste con
 *        privilegios de administrador; puede devolver `{ id }`.
 * @returns {{query: Function, getById: Function, save: Function}}
 */
export function createFirestoreCatalogStore(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const writeCatalogItem =
    typeof opts.writeCatalogItem === "function" ? opts.writeCatalogItem : null;

  return {
    /** Ejecuta una query del catálogo (una lectura, AC-111). */
    async query(spec) {
      if (!spec || typeof spec !== "object") {
        throw inputError("La consulta del catálogo no es válida.", [
          "La consulta del catálogo no es válida.",
        ]);
      }
      return runFirestoreQuery(spec);
    },

    /** Lee un ítem por id; `null` si no existe (API-05). */
    async getById(mediaId) {
      const sdk = await loadFirestoreSdk();
      const snapshot = await sdk.getDoc(sdk.doc(sdk.db, CATALOG_COLLECTION, mediaId));
      if (!snapshot.exists()) return null;
      return { id: snapshot.id, ...snapshot.data() };
    },

    /**
     * Upsert por ruta privilegiada (id determinista) o alta con id
     * automático. Añade `createdAt`/`updatedAt` como `Date` reales
     * (DB-101) y devuelve el `MediaItem` guardado, nunca sentinelas
     * `serverTimestamp()`.
     */
    async save(mediaId, payload) {
      if (!writeCatalogItem) {
        const error = new Error(
          "El catálogo es de solo lectura desde el cliente (SEC-02): falta la ruta de escritura privilegiada.",
        );
        error.code = "permission-denied";
        throw error;
      }

      const id =
        typeof mediaId === "string" && mediaId.trim() !== "" ? mediaId.trim() : null;
      const now = new Date();
      const data = { ...payload, createdAt: now, updatedAt: now };
      const written = await writeCatalogItem(id, data);
      const finalId =
        written && typeof written.id === "string" && written.id !== "" ? written.id : id;
      if (typeof finalId !== "string" || finalId === "") {
        throw inputError("La ruta de escritura no devolvió un id válido.", [
          "La ruta de escritura no devolvió un id válido.",
        ]);
      }
      return { id: finalId, ...data };
    },
  };
}

/** ¿El objeto cumple la interfaz mínima de store? */
function isCatalogStore(candidate) {
  return Boolean(
    candidate &&
      typeof candidate.query === "function" &&
      typeof candidate.getById === "function" &&
      typeof candidate.save === "function",
  );
}

// -------------------------------------------------------------
// 8. Repositorio (API-01..API-05)
// -------------------------------------------------------------

/**
 * Construye el repositorio del catálogo. Ninguna función lanza: todas
 * devuelven `Result` (REQ-E1).
 *
 * @param {object|Function} storeOrGetter store Firestore o fábrica
 *        perezosa (`() => store`) con `query(spec)`, `getById(id)` y
 *        `save(id, data)`. Los tests inyectan un store en memoria.
 * @returns {{
 *   listByType: Function,
 *   searchByTitle: Function,
 *   getById: Function,
 *   listSeeded: Function,
 *   createMediaItem: Function
 * }}
 */
export function createCatalogRepository(storeOrGetter) {
  let cachedStore = null;

  async function resolveStore() {
    if (cachedStore) return cachedStore;
    const candidate =
      typeof storeOrGetter === "function" ? await storeOrGetter() : await storeOrGetter;
    if (!isCatalogStore(candidate)) {
      const error = new Error(
        "El store del catálogo debe implementar query(), getById() y save().",
      );
      // Entrada inválida del consumidor → `validation` (REQ-E2), no
      // `unknown` (que se reserva a fallos inesperados).
      error.code = "validation";
      throw error;
    }
    cachedStore = candidate;
    return cachedStore;
  }

  /** Lee UNA página; el cursor se calcula antes de filtrar (REQ-103). */
  async function readPage(spec, filters) {
    const store = await resolveStore();
    const response = await store.query(spec);
    const docs = Array.isArray(response?.docs) ? response.docs : [];
    const window = docs.slice(0, spec.limit - 1);
    const hasMore = docs.length > window.length;

    const items = [];
    for (const doc of window) {
      if (!matchesSecondaryFilters(doc, filters)) continue;
      items.push(materializeMediaItem(doc));
    }

    let cursor = null;
    if (hasMore && window.length > 0) {
      cursor = encodeCursor(spec.orderBy, window[window.length - 1]);
    }
    // Sin cursor no se puede continuar: se cierra el listado.
    if (cursor === null) return okResult({ items, cursor: null });
    return okResult({ items, cursor });
  }

  async function listByType(mediaType, options) {
    try {
      const { spec, filters } = resolveListByTypeQuery(mediaType, options);
      return await readPage(spec, filters);
    } catch (error) {
      return toResultError(error);
    }
  }

  async function searchByTitle(term, options) {
    try {
      const { spec, filters } = resolveSearchByTitleQuery(term, options);
      // API-04 / AC-113: término vacío o sin coincidencias → página vacía.
      if (spec === null) return okResult({ items: [], cursor: null });
      return await readPage(spec, filters);
    } catch (error) {
      return toResultError(error);
    }
  }

  async function getById(mediaId) {
    try {
      if (typeof mediaId !== "string" || mediaId.trim() === "") {
        throw inputError("El id del ítem es obligatorio.", ["El id del ítem es obligatorio."]);
      }
      const store = await resolveStore();
      const doc = await store.getById(mediaId.trim());
      return okResult(doc ? materializeMediaItem(doc) : null);
    } catch (error) {
      return toResultError(error);
    }
  }

  async function listSeeded() {
    try {
      const store = await resolveStore();
      // Una sola lectura: `seed == true` (API-03, REQ-104). Sin
      // `orderBy`: DB-110..DB-113 no declaran un índice compuesto
      // `seed` + `titleNormalized`; se ordena en memoria con el mismo
      // criterio que `SORT_ORDER_BY.title` (título, luego id).
      const response = await store.query({
        collection: CATALOG_COLLECTION,
        filters: [{ field: "seed", op: "==", value: true }],
        orderBy: null,
        limit: null,
        startAfter: null,
      });
      const docs = Array.isArray(response?.docs) ? response.docs : [];
      const sorted = docs.slice().sort((a, b) => {
        const titleA =
          typeof a?.titleNormalized === "string" ? a.titleNormalized : normalizeTitle(a?.title);
        const titleB =
          typeof b?.titleNormalized === "string" ? b.titleNormalized : normalizeTitle(b?.title);
        if (titleA !== titleB) return titleA < titleB ? -1 : 1;
        const idA = String(a?.id ?? "");
        const idB = String(b?.id ?? "");
        if (idA === idB) return 0;
        return idA < idB ? -1 : 1;
      });
      return okResult(sorted.map((doc) => materializeMediaItem(doc)));
    } catch (error) {
      return toResultError(error);
    }
  }

  async function createMediaItem(input) {
    try {
      const { id, data } = buildCreatePayload(input);
      const store = await resolveStore();
      const existing = await store.getById(id);
      if (existing) {
        throw inputError(`Ya existe un ítem del catálogo con el id "${id}".`, [
          `Ya existe un ítem del catálogo con el id "${id}".`,
        ]);
      }
      const saved = await store.save(id, data);
      return okResult(materializeMediaItem(saved));
    } catch (error) {
      return toResultError(error);
    }
  }

  return { listByType, searchByTitle, getById, listSeeded, createMediaItem };
}

/**
 * Repositorio por defecto (Firestore, carga perezosa del SDK).
 * @type {ReturnType<typeof createCatalogRepository>}
 */
export const catalogRepository = createCatalogRepository(createFirestoreCatalogStore);

/** Atajos con la API plana del contrato (spec 02 §2). */
export const listByType = (mediaType, options) =>
  catalogRepository.listByType(mediaType, options);

export const searchByTitle = (term, options) => catalogRepository.searchByTitle(term, options);

export const getById = (mediaId) => catalogRepository.getById(mediaId);

export const listSeeded = () => catalogRepository.listSeeded();

export const createMediaItem = (input) => catalogRepository.createMediaItem(input);

export default catalogRepository;
