// =============================================================
// Servicio de dashboard y estadísticas (spec 04 API-20..API-22,
// REQ-301..REQ-306; AC-130..AC-137; spec 00 REQ-E1/E2, REQ-C1;
// spec 01 DB-101/DB-103/DB-114; spec 02 API-05; SEC-01).
//
// Todo el cálculo vive en una PARTE PURA, `computeDashboard(entries,
// mediaById)` (API-21, REQ-305): no importa Firebase, no toca red, DOM
// ni `Date.now()`; con la misma fixture devuelve siempre el mismo
// resultado y se ejecuta en O(n log n) (<50 ms, AC-135). El servicio
// solo aporta los datos:
//
//   1) entries del usuario -> tracking.listEntries(uid, {pageSize})
//      recorriendo el cursor opaco (DB-114) hasta agotarlo. Es la
//      ÚNICA query de entries, agregada en cliente (REQ-301).
//   2) catálogo de la página -> UNA lectura por lote (`getAll(...ids)`
//      o el lector batch inyectado) para resolver `mediaType` y el
//      título (API-20). Nunca es N+1: como máximo 1 lectura adicional
//      por página de entries. Sin lector batch se degrada a `getById`
//      por id (correcto, pero pensado solo para stores falsos).
//
// Contrato (spec 04 §2):
//   type DashboardStats = {
//     totals: { total, planned, inProgress, completed, dropped };
//     byType: Record<MediaType, { count, pct }>;      // pct 0-100, 1 decimal
//     scores: {
//       average: number | null;
//       count: number;
//       byType: Record<MediaType, { average: number | null; count: number }>;
//     };
//     recent: Array<{ mediaId, title, status, updatedAt /* ISO */ }>; // ≤10
//   };
//
//   computeDashboard(entries, mediaById)                  // puro, API-21
//   createDashboardService(deps?).getStats(uid)           // API-20
//   createDashboardService(deps?).subscribe(uid, onChange) // API-22
//
// Decisiones relevantes:
//   - `totals.total` cuenta TODAS las entries (incluido un estado
//     desconocido); los 4 contadores usan los estados de DB-103. Una
//     entry sin `status` se cuenta como PLANNED, igual que el valor por
//     defecto de DB-103/AC-120.
//   - `byType` siempre trae las 7 claves de `MEDIA_ITEM_TYPES` (DB-101)
//     en orden fijo; los tipos sin entries quedan `{count:0, pct:0}`
//     (AC-131). `pct` se redondea a 1 decimal por tipo (la suma es ≈100).
//   - `scores.average` ignora entries sin `score` y se redondea a 1
//     decimal (AC-132); sin ninguna puntuación es `null` (AC-133).
//     `scores.byType` aplica la misma regla por tipo.
//   - `recent` ordena `updatedAt` desc (DB-114) y corta a 10 (AC-134);
//     las entries sin `updatedAt` utilizable no entran (no se puede
//     ordenar un valor ausente). Empates: `mediaId` asc, determinista.
//   - Estado vacío (REQ-306, AC-136): `totals` a 0, `byType` a 0,
//     `scores.average = null`, `recent = []` y el mensaje
//     `EMPTY_STATE_MESSAGE` disponible para la UI. Con 0 entries NO se
//     lee el catálogo (0 lecturas adicionales).
//   - Reactividad (API-22, AC-137): `subscribe`/`watchStats` consume una
//     fuente de snapshot inyectada en `deps` (`onSnapshot`,
//     `subscribeEntries`, ...) con forma `(uid, handler) => unsub`, o un
//     método homónimo del repositorio si existiera. Cada evento entra en
//     `applySnapshot`, que recalcula con `computeDashboard` sobre el
//     índice de catálogo ya cacheado: NO se vuelve a llamar a `getStats`
//     ni se hacen lecturas (sin polling). Sin fuente, la suscripción es
//     inerte y el consumidor puede usar `getStats`/`applySnapshot`.
//     `recalculate(uid)` rehace el cálculo desde el último estado
//     cacheado, también sin I/O.
//   - Ningún método del servicio lanza: siempre devuelve `Result`
//     (REQ-E1). `subscribe` sí valida programador (uid/callback).
// =============================================================

import {
  MEDIA_ITEM_TYPES,
  isEntryStatus,
  isMediaItemType,
  legacyMediaTypeToMediaItemType,
} from "../catalog.js";
import { catalogRepository, normalizeErrorCode } from "../repositories/catalog-repository.js";
import {
  MAX_PAGE_SIZE as MAX_ENTRY_PAGE_SIZE,
  trackingRepository,
} from "../repositories/tracking-repository.js";

// -------------------------------------------------------------
// 1. Constantes del contrato (REQ-301/302/303/304/306)
// -------------------------------------------------------------

/** Nº máximo de entries en `recent` (REQ-304, AC-134). */
export const RECENT_LIMIT = 10;

/** Alias explícito del límite de actividad reciente. */
export const DASHBOARD_RECENT_LIMIT = RECENT_LIMIT;

/**
 * Mensaje del estado vacío (REQ-306, AC-136). La UI (UI-20..UI-23) lo
 * muestra cuando `totals.total === 0`.
 */
export const EMPTY_STATE_MESSAGE = "Añade tu primer título";

/** Alias del mensaje vacío para consumidores que prefieran el sufijo. */
export const EMPTY_DASHBOARD_MESSAGE = EMPTY_STATE_MESSAGE;

/**
 * Tamaño de página de entries (DB-114). 30 = límite de ids de una
 * consulta batch de catálogo, de forma que cada página cueste como
 * máximo 1 lectura adicional (API-20). Nunca supera `MAX_PAGE_SIZE`.
 */
export const DASHBOARD_PAGE_SIZE = Math.min(30, MAX_ENTRY_PAGE_SIZE);

/** Tope de páginas recorridas (guarda contra stores que no avanzan). */
export const MAX_DASHBOARD_PAGES = 200;

/** Códigos admitidos por `Result` (spec 00 §4.1). */
export const RESULT_ERROR_CODES = Object.freeze([
  "not_found",
  "permission_denied",
  "validation",
  "unavailable",
  "unknown",
]);

/** Mensajes en español para los errores propios del servicio (REQ-E2). */
const ERROR_MESSAGES = Object.freeze({
  not_found: "No se han encontrado datos para el dashboard.",
  permission_denied:
    "No tienes permiso para consultar las estadísticas. Comprueba que has iniciado sesión con una cuenta autorizada.",
  validation: "Los datos del dashboard no son válidos.",
  unavailable:
    "Las estadísticas no están disponibles en este momento. Vuelve a intentarlo en unos segundos.",
  unknown: "Ha ocurrido un error inesperado al calcular las estadísticas.",
});

/** Variantes Firestore/SDK → códigos del contrato (REQ-E2). */
const ERROR_CODE_ALIASES = Object.freeze({
  "permission-denied": "permission_denied",
  unauthenticated: "permission_denied",
  "unauthenticated-user": "permission_denied",
  unauthorized: "permission_denied",
  "not-found": "not_found",
  "invalid-argument": "validation",
  "failed-precondition": "unavailable",
  "deadline-exceeded": "unavailable",
  "resource-exhausted": "unavailable",
});

/** Estados de entry → contador de `totals` (REQ-301, DB-103). */
const STATUS_TO_TOTAL_KEY = Object.freeze({
  PLANNED: "planned",
  IN_PROGRESS: "inProgress",
  COMPLETED: "completed",
  DROPPED: "dropped",
});

/** Estado por defecto cuando la entry no trae uno (DB-103, AC-120). */
const DEFAULT_ENTRY_STATUS = "PLANNED";

/** Métodos de lectura por lote admitidos en el catálogo (API-20). */
const CATALOG_BATCH_METHODS = Object.freeze([
  "getAll",
  "getMany",
  "getByIds",
  "getMediaByIds",
  "listByIds",
]);

/** Métodos de suscripción admitidos en el repositorio (API-22). */
const TRACKING_SUBSCRIBE_METHODS = Object.freeze([
  "subscribeEntries",
  "subscribeToEntries",
  "onEntriesChanged",
  "observeEntries",
  "watchEntries",
  "subscribe",
  "onSnapshot",
]);

/** Aviso único del respaldo N+1 `getById` (API-20). */
let warnedGetByIdFallback = false;

// -------------------------------------------------------------
// 2. Result y errores (spec 00 REQ-E1/E2/E3, API-05)
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

/** Error de entrada (`validation`) con el formato de REQ-E3. */
function inputError(message) {
  const error = new Error(message);
  error.code = "validation";
  error.errors = [message];
  return error;
}

/**
 * Código de error normalizado al contrato (§4.1). Admite los códigos
 * ya normalizados, las variantes de Firestore y cualquier otro valor
 * por medio de `normalizeErrorCode`.
 * @param {*} code
 * @returns {string}
 */
export function resolveResultCode(code) {
  if (typeof code !== "string" || code.trim() === "") return "unknown";
  const raw = code.trim();
  if (RESULT_ERROR_CODES.includes(raw)) return raw;
  const lowered = raw.toLowerCase();
  if (RESULT_ERROR_CODES.includes(lowered)) return lowered;
  return ERROR_CODE_ALIASES[lowered] ?? normalizeErrorCode(raw);
}

/**
 * Convierte un `Result` fallido de un repositorio en el `Result` del
 * servicio conservando su mensaje en español (REQ-E2).
 * @param {*} source
 * @returns {{ok: false, code: string, message: string, errors?: string[]}}
 */
function fromFailedResult(source) {
  const code = resolveResultCode(source?.code);
  const message =
    typeof source?.message === "string" && source.message.trim() !== ""
      ? source.message
      : ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown;
  const errors = Array.isArray(source?.errors)
    ? source.errors.filter((entry) => typeof entry === "string" && entry.trim() !== "")
    : [];
  return failResult(code, message, { errors });
}

/**
 * Convierte cualquier excepción en `Result` (REQ-E1). Nunca lanza.
 * @param {*} error
 * @returns {{ok: false, code: string, message: string, errors?: string[]}}
 */
export function toResultError(error) {
  const code = resolveResultCode(error?.code);
  const errors = Array.isArray(error?.errors)
    ? error.errors.filter((entry) => typeof entry === "string" && entry.trim() !== "")
    : [];
  const message =
    code === "validation" && errors.length > 0
      ? errors.join(" ")
      : ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown;
  return failResult(code, message, { errors });
}

// -------------------------------------------------------------
// 3. Helpers puros
// -------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Texto no vacío (trim) o `null`. */
function nonEmptyText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Redondeo a 1 decimal (REQ-302/303, AC-131/AC-132). */
function round1(value) {
  const rounded = Math.round(value * 10) / 10;
  // Evita `-0` en porcentajes/medias.
  return rounded === 0 ? 0 : rounded;
}

/** ¿Número finito? */
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Id de una entry/media (`mediaId` o `id`) o `null`. */
function mediaIdOf(item) {
  return nonEmptyText(item?.mediaId) ?? nonEmptyText(item?.id) ?? null;
}

/**
 * Materializa una entry leída de un repositorio o fake: acepta
 * `{ id, ...data }`, un snapshot con `data()` o una entry ya
 * materializada. Devuelve `null` si no tiene id.
 * @param {*} doc
 * @returns {object|null}
 */
export function toDashboardEntry(doc) {
  if (doc === null || typeof doc !== "object") return null;
  const isSnapshot = typeof doc.data === "function";
  const data = isSnapshot ? doc.data() ?? {} : doc;
  if (!isPlainObject(data)) return null;
  const id = isSnapshot
    ? nonEmptyText(doc.id) ?? nonEmptyText(data.mediaId) ?? nonEmptyText(data.id)
    : nonEmptyText(data.mediaId) ?? nonEmptyText(doc.id) ?? nonEmptyText(data.id);
  if (id === null) return null;
  return { ...data, mediaId: id };
}

/**
 * Materializa un `MediaItem` del catálogo (DB-101), con `id` resuelto.
 * Devuelve `null` si no tiene id.
 * @param {*} doc
 * @returns {object|null}
 */
export function toDashboardMedia(doc) {
  if (doc === null || typeof doc !== "object") return null;
  const data = typeof doc.data === "function" ? doc.data() ?? {} : doc;
  if (!isPlainObject(data)) return null;
  const id =
    nonEmptyText(doc.id) ?? nonEmptyText(data.id) ?? nonEmptyText(data.mediaId);
  if (id === null) return null;
  return { ...data, id };
}

/**
 * Índice `mediaId -> MediaItem` (API-21). Acepta `Map`, array o un
 * objeto plano indexado por id (también un único `MediaItem`). Nunca
 * lanza: los valores inválidos se ignoran.
 * @param {*} source
 * @returns {Map<string, object>}
 */
export function normalizeMediaIndex(source) {
  const index = new Map();
  if (source === null || source === undefined) return index;

  if (source instanceof Map) {
    for (const [key, value] of source) {
      const media = toDashboardMedia(value);
      const id = nonEmptyText(key) ?? media?.id ?? null;
      if (media && id !== null) index.set(id, media);
    }
    return index;
  }

  if (Array.isArray(source)) {
    for (const value of source) {
      const media = toDashboardMedia(value);
      if (media && !index.has(media.id)) index.set(media.id, media);
    }
    return index;
  }

  if (!isPlainObject(source)) return index;

  // Un único `MediaItem` (tiene id y alguna señal de catálogo).
  if (
    nonEmptyText(source.id) &&
    (source.mediaType !== undefined || source.title !== undefined)
  ) {
    const media = toDashboardMedia(source);
    if (media) index.set(media.id, media);
    return index;
  }

  for (const [key, value] of Object.entries(source)) {
    const media = toDashboardMedia(value);
    const id = media?.id ?? nonEmptyText(key);
    if (media && id !== null && !index.has(id)) index.set(id, media);
  }
  return index;
}

/**
 * Tipo de medio efectivo de una entry (REQ-302): `catalog.mediaType`
 * (DB-101), con `entry.mediaType` como respaldo y traducción de datos
 * legacy (REQ-C6). `null` si no pertenece a los 7 tipos.
 * @param {object|null} media
 * @param {object} entry
 * @returns {string|null}
 */
function resolveMediaType(media, entry) {
  for (const candidate of [media?.mediaType, entry?.mediaType]) {
    if (isMediaItemType(candidate)) return candidate;
    if (typeof candidate === "string") {
      const legacy = legacyMediaTypeToMediaItemType(candidate);
      if (legacy !== null) return legacy;
    }
  }
  return null;
}

/** Estado efectivo de una entry para `totals` (DB-103, AC-120). */
function resolveStatus(entry) {
  return isEntryStatus(entry?.status) ? entry.status : DEFAULT_ENTRY_STATUS;
}

/**
 * Estado tal cual viene en la entry para `recent` (REQ-304): conserva
 * un valor desconocido en vez de disfrazarlo de PLANNED; solo un estado
 * ausente/no textual cae al valor por defecto de DB-103.
 */
function rawStatus(entry) {
  return nonEmptyText(entry?.status) ?? DEFAULT_ENTRY_STATUS;
}

/** Milisegundos de `updatedAt` (Date, ISO, epoch o Timestamp), o `null`. */
export function timestampToMs(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value.toDate === "function") {
    try {
      const date = value.toDate();
      const ms = date instanceof Date ? date.getTime() : Number.NaN;
      return Number.isNaN(ms) ? null : ms;
    } catch {
      return null;
    }
  }
  if (isFiniteNumber(value.seconds)) {
    const nanoseconds = isFiniteNumber(value.nanoseconds) ? value.nanoseconds : 0;
    return value.seconds * 1000 + nanoseconds / 1e6;
  }
  return null;
}

/** Registro vacío con las 7 claves de `MEDIA_ITEM_TYPES` (AC-131). */
function emptyTypeRecord(factory) {
  const record = {};
  for (const mediaType of MEDIA_ITEM_TYPES) record[mediaType] = factory();
  return record;
}

/** Comparador de actividad reciente: updatedAt desc + mediaId asc. */
function compareRecent(a, b) {
  if (a.ms !== b.ms) return b.ms - a.ms;
  if (a.mediaId === b.mediaId) return 0;
  return a.mediaId < b.mediaId ? -1 : 1;
}

// -------------------------------------------------------------
// 4. Parte pura: computeDashboard (API-21, REQ-305, AC-130..AC-136)
// -------------------------------------------------------------

/**
 * Calcula `DashboardStats` a partir de las entries y del índice de
 * catálogo (API-21). Función PURA y determinista: sin red, sin
 * Firebase, sin reloj y sin mutar las entradas (AC-135, <50 ms).
 *
 * @param {ReadonlyArray<object>|null|undefined} entries
 * @param {Map<string, object>|object[]|object|null} [mediaById]
 * @returns {{
 *   totals: {total: number, planned: number, inProgress: number, completed: number, dropped: number},
 *   byType: Record<string, {count: number, pct: number}>,
 *   scores: {average: number|null, count: number, byType: Record<string, {average: number|null, count: number}>},
 *   recent: Array<{mediaId: string, title: string, status: string, updatedAt: string}>
 * }}
 */
export function computeDashboard(entries, mediaById) {
  const list = entries === null || entries === undefined ? [] : entries;
  if (!Array.isArray(list)) {
    throw inputError("Las entries del dashboard deben ser un array.");
  }
  const mediaIndex = normalizeMediaIndex(mediaById);

  const totals = {
    total: 0,
    planned: 0,
    inProgress: 0,
    completed: 0,
    dropped: 0,
  };
  const typeCounts = emptyTypeRecord(() => 0);
  const scoreSums = emptyTypeRecord(() => ({ sum: 0, count: 0 }));
  const recentCandidates = [];

  let scoreSum = 0;
  let scoreCount = 0;

  for (const raw of list) {
    const entry = toDashboardEntry(raw);
    if (entry === null) continue;

    const mediaId = entry.mediaId;
    totals.total += 1;
    const statusKey = STATUS_TO_TOTAL_KEY[resolveStatus(entry)];
    if (statusKey !== undefined) totals[statusKey] += 1;

    const media = mediaIndex.get(mediaId) ?? null;
    const mediaType = resolveMediaType(media, entry);
    if (mediaType !== null) typeCounts[mediaType] += 1;

    if (isFiniteNumber(entry.score)) {
      scoreSum += entry.score;
      scoreCount += 1;
      if (mediaType !== null) {
        scoreSums[mediaType].sum += entry.score;
        scoreSums[mediaType].count += 1;
      }
    }

    const ms = timestampToMs(entry.updatedAt);
    if (ms !== null) {
      const title =
        nonEmptyText(media?.title) ?? nonEmptyText(entry.title) ?? mediaId;
      recentCandidates.push({
        mediaId,
        title,
        status: rawStatus(entry),
        updatedAt: new Date(ms).toISOString(),
        ms,
      });
    }
  }

  const byType = emptyTypeRecord(() => ({ count: 0, pct: 0 }));
  for (const mediaType of MEDIA_ITEM_TYPES) {
    const count = typeCounts[mediaType];
    byType[mediaType] = {
      count,
      pct: totals.total === 0 || count === 0 ? 0 : round1((count / totals.total) * 100),
    };
  }

  const scoresByType = emptyTypeRecord(() => ({ average: null, count: 0 }));
  for (const mediaType of MEDIA_ITEM_TYPES) {
    const bucket = scoreSums[mediaType];
    scoresByType[mediaType] = {
      average: bucket.count === 0 ? null : round1(bucket.sum / bucket.count),
      count: bucket.count,
    };
  }

  const recent = recentCandidates
    .slice()
    .sort(compareRecent)
    .slice(0, RECENT_LIMIT)
    .map(({ mediaId, title, status, updatedAt }) => ({
      mediaId,
      title,
      status,
      updatedAt,
    }));

  return {
    totals,
    byType,
    scores: {
      average: scoreCount === 0 ? null : round1(scoreSum / scoreCount),
      count: scoreCount,
      byType: scoresByType,
    },
    recent,
  };
}

// -------------------------------------------------------------
// 5. Lectura de repositorios (API-20, presupuesto de lecturas)
// -------------------------------------------------------------

/** `Result` de un repositorio, o el valor tal cual si no lo envuelve. */
function asResult(response) {
  if (isPlainObject(response) && typeof response.ok === "boolean") return response;
  return okResult(response);
}

/** Items de un valor de repositorio (`Page<T>`, `T[]` o `undefined`). */
function pageItems(value) {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value) && Array.isArray(value.items)) return value.items;
  return [];
}

/** Cursor de la página (DB-114), o `null` si no hay más. */
function nextCursor(value) {
  if (!isPlainObject(value)) return null;
  const cursor = value.cursor;
  if (typeof cursor !== "string" || cursor.trim() === "") return null;
  return cursor;
}

/**
 * Valida el uid (SEC-01). Un uid vacío ⇒ `permission_denied`; uno con
 * `/` ⇒ `validation`.
 * @param {*} uid
 * @returns {string}
 */
function requireSessionUid(uid) {
  if (typeof uid !== "string" || uid.trim() === "") {
    const error = new Error(
      "No hay una sesión autenticada: inicia sesión para ver el dashboard.",
    );
    error.code = "permission_denied";
    throw error;
  }
  const value = uid.trim();
  if (value.includes("/")) {
    throw inputError(`uid inválido: "${uid}".`);
  }
  return value;
}

/**
 * Índice de catálogo a partir de la respuesta de un lector por lote.
 * Acepta `Result`, `Map`, array, `{items}`, `{docs}` u objeto por id.
 * @param {*} value
 * @returns {Map<string, object>}
 */
function mediaIndexFromBatch(value) {
  if (value === null || value === undefined) return new Map();
  if (value instanceof Map) return normalizeMediaIndex(value);
  if (Array.isArray(value)) return normalizeMediaIndex(value);
  if (isPlainObject(value)) {
    if (typeof value.ok === "boolean") return mediaIndexFromBatch(value.value);
    if (Array.isArray(value.items)) return normalizeMediaIndex(value.items);
    if (Array.isArray(value.docs)) return normalizeMediaIndex(value.docs);
    if (value.value !== undefined) return mediaIndexFromBatch(value.value);
    if (nonEmptyText(value.id)) return normalizeMediaIndex([value]);
  }
  return normalizeMediaIndex(value);
}

/**
 * Lee el catálogo de UNA página en 1 sola llamada (API-20). Orden:
 *   1) `options.readMediaBatch(ids, catalog)` inyectado (tests).
 *   2) método batch del repositorio (`getAll(...ids)`, `getMany`, ...).
 *   3) respaldo `getById` por id (solo stores falsos: N lecturas); se
 *      avisa UNA vez por consola porque rompe el presupuesto de 1
 *      lectura adicional por página.
 * Sin ningún lector devuelve un índice vacío: los totales, medias y
 * recientes siguen siendo correctos (títulos caen a `mediaId`).
 * @param {object|null} catalog
 * @param {string[]} ids
 * @param {object} options
 * @returns {Promise<{ok: true, value: Map<string, object>}|{ok: false}>}
 */
async function readMediaBatch(catalog, ids, options) {
  if (ids.length === 0) return okResult(new Map());

  if (typeof options.readMediaBatch === "function") {
    const result = asResult(await options.readMediaBatch(ids, catalog));
    if (!result.ok) return result;
    return okResult(mediaIndexFromBatch(result.value));
  }

  for (const name of CATALOG_BATCH_METHODS) {
    if (typeof catalog?.[name] !== "function") continue;
    let response;
    try {
      // Contrato de la spec: `getAll(...ids)`. Algunos fakes aceptan el
      // array posicional; si la forma expandida falla, se reintenta una
      // sola vez con el array (mismo presupuesto: 1 lectura).
      response = await catalog[name](...ids);
    } catch {
      response = await catalog[name](ids);
    }
    const result = asResult(response);
    if (!result.ok) return result;
    return okResult(mediaIndexFromBatch(result.value));
  }

  if (typeof catalog?.getById === "function") {
    if (!warnedGetByIdFallback && typeof console !== "undefined" && typeof console.warn === "function") {
      warnedGetByIdFallback = true;
      console.warn(
        "[dashboard-service] El catálogo no ofrece lectura por lote (getAll/getMany/...): " +
          "se usa getById por id, lo que rompe el presupuesto de 1 lectura adicional por página (API-20).",
      );
    }
    const index = new Map();
    for (const id of ids) {
      const result = asResult(await catalog.getById(id));
      if (!result.ok) {
        if (resolveResultCode(result.code) === "not_found") continue;
        return result;
      }
      const media = toDashboardMedia(result.value);
      if (media !== null) index.set(id, media);
    }
    return okResult(index);
  }

  return okResult(new Map());
}

/**
 * Recorre todas las páginas de entries (REQ-301) y resuelve el catálogo
 * de cada página con 1 lectura adicional como máximo (API-20). Deduplica
 * por `mediaId` para tolerar stores falsos que ignoran el cursor.
 * @param {string} uid
 * @param {object|null} tracking
 * @param {object|null} catalog
 * @param {object} options
 * @returns {Promise<object>} `Result<{entries, mediaById}>`
 */
async function readDashboardData(uid, tracking, catalog, options) {
  if (typeof options.readEntries === "function") {
    const result = asResult(await options.readEntries(uid));
    if (!result.ok) return result;
    const entries = pageItems(result.value)
      .map(toDashboardEntry)
      .filter((entry) => entry !== null);
    const media = await readMediaBatch(
      catalog,
      [...new Set(entries.map((entry) => entry.mediaId))],
      options,
    );
    if (!media.ok) return media;
    return okResult({ entries, mediaById: media.value });
  }

  if (typeof tracking?.listEntries !== "function") {
    throw inputError("El repositorio de seguimiento no permite leer las entries.");
  }

  const entries = [];
  const mediaById = new Map();
  const seen = new Set();
  let cursor = null;
  let previousCursor = null;
  let pages = 0;

  do {
    const queryOptions = { pageSize: options.pageSize };
    if (cursor !== null) queryOptions.cursor = cursor;
    const response = await tracking.listEntries(uid, queryOptions);
    const result = asResult(response);
    if (!result.ok) return result;

    const pageRaw = pageItems(result.value);
    const pageIds = [];
    for (const raw of pageRaw) {
      const entry = toDashboardEntry(raw);
      if (entry === null || seen.has(entry.mediaId)) continue;
      seen.add(entry.mediaId);
      entries.push(entry);
      pageIds.push(entry.mediaId);
    }

    // Lectura adicional ÚNICA de la página (API-20).
    if (pageIds.length > 0) {
      const media = await readMediaBatch(catalog, pageIds, options);
      if (!media.ok) return media;
      for (const [id, item] of media.value) {
        if (!mediaById.has(id)) mediaById.set(id, item);
      }
    }

    previousCursor = cursor;
    cursor = nextCursor(result.value);
    pages += 1;
    if (cursor !== null && cursor === previousCursor) break;
  } while (cursor !== null && pages < MAX_DASHBOARD_PAGES);

  return okResult({ entries, mediaById });
}

// -------------------------------------------------------------
// 6. Lectura batch por defecto del catálogo (API-20)
// -------------------------------------------------------------

/** Colección del catálogo (DB-101). */
const CATALOG_COLLECTION = "catalog";

/** Límite de ids de una consulta `documentId() in [...]` de Firestore. */
const DOC_ID_IN_LIMIT = 30;

/**
 * Equivalente en el SDK web de `getAll(...ids)`: una consulta por lote
 * `where(documentId(), "in", ids)` sobre `catalog` (DB-101). Importa
 * Firebase de forma perezosa (REQ-C1): importar este módulo en Node no
 * toca la red. Con `DASHBOARD_PAGE_SIZE` (30) la página siempre cabe en
 * UNA consulta, respetando el presupuesto de API-20.
 * @param {string[]} ids
 * @returns {Promise<Map<string, object>>}
 */
async function readCatalogBatchFromFirestore(ids) {
  const sdk = await import("../firebase.js");
  const index = new Map();
  for (let offset = 0; offset < ids.length; offset += DOC_ID_IN_LIMIT) {
    const chunk = ids.slice(offset, offset + DOC_ID_IN_LIMIT);
    const ref = sdk.query(
      sdk.collection(sdk.db, CATALOG_COLLECTION),
      sdk.where(sdk.documentId(), "in", chunk),
    );
    const snapshot = await sdk.getDocs(ref);
    for (const doc of snapshot.docs) {
      const media = toDashboardMedia({ id: doc.id, ...doc.data() });
      if (media !== null) index.set(media.id, media);
    }
  }
  return index;
}

// -------------------------------------------------------------
// 7. Servicio con I/O mínimo (API-20, API-22, AC-137)
// -------------------------------------------------------------

/**
 * Normaliza las dependencias inyectadas (posicional o por nombre).
 * @param {object} deps
 * @param {object} [maybeCatalogRepository]
 * @returns {object}
 */
function normalizeServiceOptions(deps, maybeCatalogRepository) {
  if (maybeCatalogRepository !== undefined && maybeCatalogRepository !== null) {
    return {
      trackingRepository: deps ?? null,
      catalogRepository: maybeCatalogRepository,
      readEntries: null,
      readMediaBatch: null,
      snapshotSource: null,
      pageSize: DASHBOARD_PAGE_SIZE,
    };
  }
  if (!isPlainObject(deps)) {
    return {
      trackingRepository: null,
      catalogRepository: null,
      readEntries: null,
      readMediaBatch: null,
      snapshotSource: null,
      pageSize: DASHBOARD_PAGE_SIZE,
    };
  }
  const pageSize =
    isFiniteNumber(deps.pageSize) && deps.pageSize >= 1
      ? Math.min(Math.floor(deps.pageSize), DASHBOARD_PAGE_SIZE)
      : DASHBOARD_PAGE_SIZE;
  const snapshotSource =
    (typeof deps.subscribeEntries === "function" && deps.subscribeEntries) ||
    (typeof deps.subscribeToEntries === "function" && deps.subscribeToEntries) ||
    (typeof deps.onSnapshot === "function" && deps.onSnapshot) ||
    (typeof deps.watchEntries === "function" && deps.watchEntries) ||
    (typeof deps.snapshotSource === "function" && deps.snapshotSource) ||
    null;
  return {
    trackingRepository:
      deps.trackingRepository ?? deps.tracking ?? deps.entriesRepository ?? null,
    catalogRepository: deps.catalogRepository ?? deps.catalog ?? deps.catalogRepo ?? null,
    readEntries: typeof deps.readEntries === "function" ? deps.readEntries : null,
    readMediaBatch:
      typeof deps.readMediaBatch === "function" ? deps.readMediaBatch : null,
    snapshotSource,
    pageSize,
  };
}

/**
 * Crea el servicio del dashboard. Todas las lecturas se delegan en los
 * repositorios inyectados (o en los de por defecto), de modo que los
 * tests pueden contar lecturas sin red (AC-135, AC-137).
 *
 * @param {object} [deps] `{trackingRepository, catalogRepository,
 *        readEntries?, readMediaBatch?, onSnapshot?/subscribeEntries?,
 *        pageSize?}` o `(trackingRepository, catalogRepository)` en
 *        forma posicional. `pageSize` se acota siempre a 30
 *        (`DASHBOARD_PAGE_SIZE`) para que cada página cueste como
 *        máximo 1 lectura batch de catálogo (API-20). `onSnapshot`
 *        (o `subscribeEntries`/`subscribeToEntries`/`watchEntries`/
 *        `snapshotSource`) es `(uid, handler) => unsubscribe` y
 *        alimenta `applySnapshot` sin lecturas (API-22, AC-137).
 * @param {object} [maybeCatalogRepository]
 * @returns {{
 *   getStats: Function,
 *   subscribe: Function,
 *   watchStats: Function,
 *   subscribeStats: Function,
 *   applySnapshot: Function,
 *   updateFromSnapshot: Function,
 *   recalculate: Function
 * }}
 */
export function createDashboardService(deps, maybeCatalogRepository) {
  const options = normalizeServiceOptions(deps, maybeCatalogRepository);

  /**
   * Último estado calculado por uid: entries + índice de catálogo. Es lo
   * que permite recalcular con `onSnapshot` sin volver a leer (AC-137).
   * @type {Map<string, {entries: object[], mediaById: Map<string, object>}>}
   */
  const cache = new Map();

  function cachedState(uid) {
    const state = cache.get(uid);
    if (state) return state;
    return { entries: [], mediaById: new Map() };
  }

  function storeState(uid, entries, mediaById) {
    const state = { entries, mediaById };
    cache.set(uid, state);
    return state;
  }

  /**
   * Estadísticas completas del usuario (API-20). 1 query de entries por
   * página + 1 lectura batch de catálogo por página (API-20). Nunca
   * lanza: devuelve `Result<DashboardStats>` (REQ-E1).
   * @param {string} uid
   * @returns {Promise<object>}
   */
  async function getStats(uid) {
    try {
      const owner = requireSessionUid(uid);
      const tracking = options.trackingRepository ?? trackingRepository;
      const catalog = options.catalogRepository ?? catalogRepository;
      const data = await readDashboardData(owner, tracking, catalog, options);
      if (!data.ok) return fromFailedResult(data);
      const { entries, mediaById } = data.value;
      storeState(owner, entries, mediaById);
      return okResult(computeDashboard(entries, mediaById));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Recalcula a partir de un snapshot de entries ya recibido (API-22,
   * AC-137): cálculo PURO con `computeDashboard`, sin `getStats`, sin
   * lecturas y sin polling. Si no se pasa `mediaById` se reutiliza el
   * índice cacheado por `getStats`/snapshots anteriores.
   * @param {string} uid
   * @param {ReadonlyArray<object>} entries
   * @param {Map<string, object>|object[]|object|null} [mediaById]
   * @returns {object} `Result<DashboardStats>`
   */
  function applySnapshot(uid, entries, mediaById) {
    try {
      const owner = requireSessionUid(uid);
      if (!Array.isArray(entries)) {
        throw inputError("El snapshot de entries debe ser un array.");
      }
      const normalized = entries
        .map(toDashboardEntry)
        .filter((entry) => entry !== null);
      const mediaIndex =
        mediaById === undefined || mediaById === null
          ? new Map(cachedState(owner).mediaById)
          : normalizeMediaIndex(mediaById);
      storeState(owner, normalized, mediaIndex);
      return okResult(computeDashboard(normalized, mediaIndex));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Recalcula con el último estado cacheado (entries + catálogo) sin
   * I/O. Útil tras un `applySnapshot` manual o un evento del store.
   * @param {string} uid
   * @returns {object} `Result<DashboardStats>`
   */
  function recalculate(uid) {
    try {
      const owner = requireSessionUid(uid);
      const state = cachedState(owner);
      return okResult(computeDashboard(state.entries, state.mediaById));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Normaliza el payload de un snapshot simulado/Firestore a entries.
   * Acepta arrays, `Result`, `Page<T>`, `QuerySnapshot.docs` y
   * `{entries|items|docs}`. Nunca lanza.
   * @param {*} payload
   * @returns {object[]}
   */
  function snapshotEntries(payload) {
    if (payload === null || payload === undefined) return [];
    if (Array.isArray(payload)) return payload;
    if (!isPlainObject(payload)) return [];
    if (typeof payload.ok === "boolean") return snapshotEntries(payload.value);
    if (Array.isArray(payload.entries)) return payload.entries;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.docs)) return payload.docs;
    if (payload.value !== undefined) return snapshotEntries(payload.value);
    if (nonEmptyText(payload.mediaId) ?? nonEmptyText(payload.id)) return [payload];
    return [];
  }

  /**
   * Suscripción reactiva al snapshot de entries (API-22, AC-137).
   *
   * Fuente del snapshot, por orden:
   *   1) una función inyectada en `deps` (`onSnapshot`, `subscribeEntries`,
   *      `subscribeToEntries`, `watchEntries` o `snapshotSource`) con la
   *      forma `(uid, handler) => unsubscribe`. Es la vía recomendada:
   *      `tracking-repository` no expone suscripción propia.
   *   2) un método homónimo del repositorio de tracking, si existiera.
   *   3) sin fuente: la suscripción es INERTE (devuelve un `unsubscribe`
   *      no-op); el consumidor puede llamar a `getStats`/`applySnapshot`.
   *
   * Cada evento se normaliza a entries y se entrega a `applySnapshot`,
   * que recalcula con `computeDashboard` sobre el índice de catálogo ya
   * cacheado: NO se vuelve a llamar a `getStats`, no hay lecturas ni
   * polling. Si el snapshot trae un segundo argumento (`mediaById`), se
   * usa como índice; si no, se reutiliza el cacheado.
   *
   * El callback recibe el objeto `DashboardStats` (no `Result`); los
   * errores del snapshot se entregan por `onError(result)`.
   *
   * @param {string} uid
   * @param {(stats: object) => void} onChange
   * @param {{onError?: Function, immediate?: boolean, mediaById?: *}|Function} [opts]
   * @returns {Function} `unsubscribe` (también con `.unsubscribe`).
   */
  function subscribe(uid, onChange, opts = {}) {
    const owner = requireSessionUid(uid);
    if (typeof onChange !== "function") {
      throw inputError("La suscripción del dashboard necesita un callback.");
    }
    const settings = typeof opts === "function" ? { onError: opts } : isPlainObject(opts) ? opts : {};
    const onErrorLabel =
      typeof settings.onError === "function" ? settings.onError : null;

    // Un único camino de recálculo: snapshot -> applySnapshot (puro).
    const emit = (payload, mediaMaybe) => {
      const result = applySnapshot(owner, snapshotEntries(payload), mediaMaybe);
      if (!result.ok) {
        if (onErrorLabel) onErrorLabel(result);
        return;
      }
      try {
        onChange(result.value);
      } catch (error) {
        if (onErrorLabel) onErrorLabel(toResultError(error));
      }
    };

    const tracking = options.trackingRepository ?? trackingRepository;
    let source = options.snapshotSource;
    if (typeof source !== "function") {
      for (const name of TRACKING_SUBSCRIBE_METHODS) {
        if (typeof tracking?.[name] !== "function") continue;
        source = tracking[name].bind(tracking);
        break;
      }
    }

    let unsubscribe = null;
    if (typeof source === "function") {
      const returned = source(owner, emit);
      if (typeof returned === "function") {
        unsubscribe = returned;
      } else if (returned && typeof returned.unsubscribe === "function") {
        unsubscribe = () => returned.unsubscribe();
      }
    }

    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (typeof unsubscribe === "function") unsubscribe();
    };
    dispose.unsubscribe = dispose;

    if (settings.immediate === true && !disposed) {
      const state = cachedState(owner);
      onChange(computeDashboard(state.entries, state.mediaById));
    }
    return dispose;
  }

  return {
    getStats,
    subscribe,
    watchStats: subscribe,
    subscribeStats: subscribe,
    applySnapshot,
    updateFromSnapshot: applySnapshot,
    handleSnapshot: applySnapshot,
    recalculate,
    recompute: recalculate,
  };
}

// -------------------------------------------------------------
// 8. Instancia por defecto (repositorios existentes, sin red extra)
// -------------------------------------------------------------

/**
 * Servicio por defecto sobre los repositorios de tracking y catálogo.
 * La lectura batch usa el equivalente web de `getAll(...ids)` sobre
 * `catalog` (import perezoso de Firebase, REQ-C1).
 */
export const dashboardService = createDashboardService({
  trackingRepository,
  catalogRepository,
  readMediaBatch: readCatalogBatchFromFirestore,
});

/** Atajo con la API plana del contrato (spec 04 §2). */
export const getStats = (uid) => dashboardService.getStats(uid);

/** Suscripción por defecto (API-22). */
export const subscribeStats = (uid, onChange, opts) =>
  dashboardService.subscribe(uid, onChange, opts);

export default dashboardService;
