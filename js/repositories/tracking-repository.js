// =============================================================
// Repositorio de tracking (spec 03 API-10..API-12, REQ-201..REQ-205;
// spec 01 DB-103, DB-114..DB-116, SEC-01; AC-120..AC-124, AC-129;
// spec 00 REQ-E1/E2/E3, REQ-C1).
//
// Dos capas en un único módulo, igual que `catalog-repository.js`:
//
//  1) PARTE PURA (importable en Node/vitest SIN red y SIN Firebase):
//     validación de entradas y escrituras parciales (DB-122/DB-103),
//     contexto `metadata.kind` para la unidad de `progress`
//     (REQ-204), cursor opaco de `listEntries`, query specs de DB-114/
//     DB-115/DB-116 y materialización de `Entry` (DB-103).
//
//  2) PARTE STORE (Firestore): `createFirestoreTrackingStore()` importa
//     `../firebase.js` de forma perezosa (REQ-C1), de modo que la parte
//     pura se puede importar en Node sin red. Los tests inyectan un
//     store falso en `createTrackingRepository(storeOrGetter)`.
//
// Contrato (spec 03 §2):
//   type Page<T> = { items: T[]; cursor: string | null };
//   getEntry(uid, mediaId)                  -> Result<Entry | null>
//   upsertEntry(uid, mediaId, input)        -> Result<Entry>   // DB-122
//   setStatus(uid, mediaId, status)         -> Result<Entry>   // API-11
//   setScore(uid, mediaId, score | null)    -> Result<Entry>   // API-11
//   setReview(uid, mediaId, review | null)  -> Result<Entry>   // API-11
//   setProgress(uid, mediaId, progress)     -> Result<Entry>   // API-11
//   deleteEntry(uid, mediaId)               -> Result<true>
//   listEntries(uid, opts?)                 -> Result<Page<Entry>>
//   listByMinScore(uid, minScore)           -> Result<Entry[]>
//
// Decisiones relevantes:
//   - Doc id = `mediaId` (REQ-201): `upsertEntry` hace `setDoc(..., {
//     merge: true })` sobre `users/{uid}/entries/{mediaId}`, así que dos
//     clics nunca crean dos documentos (AC-120). `createdAt` solo se
//     envía al crear; en updates se conserva el existente.
//   - Las escrituras parciales envían SOLO el campo tocado +
//     `updatedAt: SERVER_TIMESTAMP` (API-11). El store Firestore traduce
//     el centinela exportado a `serverTimestamp()`; un store falso puede
//     inspeccionarlo (o inyectar su propio `serverTimestamp`).
//   - Validación ANTES de escribir (API-12, AC-122): `score` 11 o 10.5
//     devuelve `{ ok:false, code:"validation" }` sin llamar a escritura.
//   - `progress` (DB-103, REQ-204, AC-123): `current >= 0`,
//     `current <= total` y, si se conoce la metadata del ítem, unidad y
//     tope por `metadata.kind` (episodios, capítulos/páginas, minutos,
//     horas). El contexto se toma de `input.media` / `input.metadata` /
//     `input.mediaType` o de `store.getMedia(mediaId)`.
//   - Listado (DB-114/115, AC-124): `updatedAt` desc + doc id asc como
//     desempate, filtro opcional por `status`; cursor opaco.
//   - `listByMinScore` (DB-116): `score >= minScore`, orden `score`
//     desc + `updatedAt` desc, sin duplicados ni sentinels.
//   - SEC-01 / AC-129: la seguridad real la aplican `firestore.rules`;
//     además el repositorio acepta `options.uid`/`options.getUid` y
//     corta con `permission_denied` cualquier `uid` ajeno ANTES de
//     tocar el store. Los errores `permission-denied` de Firestore se
//     normalizan a `code:"permission_denied"` (REQ-E2).
//   - Ninguna función lanza: siempre devuelve `Result` (REQ-E1).
//
// Store contract (inyectable en tests, API-14):
//   getEntry(uid, mediaId) -> Promise<object|null>
//   getMedia(mediaId)      -> Promise<object|null>   (opcional; contexto)
//   upsertEntry(uid, mediaId, data) -> Promise<object|void>
//   updateEntry(uid, mediaId, patch) -> Promise<object|void>
//   deleteEntry(uid, mediaId) -> Promise<boolean|void>
//   queryEntries(uid, spec) -> Promise<{ docs: object[] }|object[]>
//   Cualquier otro nombre tipo `getMediaItem`/`getById` se acepta como
//   lector de catálogo (compatibilidad con stores existentes).
// =============================================================

import {
  ENTRY_STATUSES,
  isEntryStatus,
  tsToDate,
  validateEntry,
} from "../catalog.js";
import {
  CURSOR_VERSION,
  RESULT_ERROR_CODES,
  createResultErrorHelpers,
  decodeCursorPayload,
  encodeCursorPayload,
  failResult,
  inputError,
  normalizeErrorCode,
  okResult,
} from "./shared-result.js";

// Superficie pública histórica del módulo: los helpers viven en
// `shared-result.js` y se reexportan para no romper a los consumidores.
export { RESULT_ERROR_CODES, failResult, normalizeErrorCode, okResult };

// -------------------------------------------------------------
// 1. Constantes del contrato
// -------------------------------------------------------------

/** Subcolección de tracking dentro de `users/{uid}` (DB-103). */
export const ENTRIES_COLLECTION = "entries";

/** Colección de catálogo leída para el contexto de `progress` (DB-101). */
export const CATALOG_COLLECTION = "catalog";

/** Tamaño de página por defecto de `listEntries` (DB-114). */
export const DEFAULT_ENTRY_PAGE_SIZE = 24;

/**
 * Tamaño de página máximo de `listEntries`, alineado con el catálogo
 * (48, spec 02 API-01) para evitar páginas desmedidas.
 */
export const MAX_PAGE_SIZE = 48;

/** Órdenes admitidos por `listEntries` (spec 03 §2). */
export const ENTRY_SORTS = Object.freeze(["updatedAt"]);

/** Orden por defecto de `listEntries` (DB-114). */
export const DEFAULT_ENTRY_SORT = "updatedAt";

/** Estado con el que nace una entry (REQ-201, AC-120). */
export const DEFAULT_ENTRY_STATUS = "PLANNED";

/** Campo especial de orden por id de documento (DB-114). */
export const DOCUMENT_ID_FIELD = "__name__";

/**
 * Centinela de `serverTimestamp()` (API-11). El store Firestore lo
 * sustituye por `serverTimestamp()` dentro de `updateDoc`/`setDoc`; la
 * parte pura nunca importa Firebase. Es un objeto congelado y se
 * compara por identidad.
 */
export const SERVER_TIMESTAMP = Object.freeze({ __serverTimestamp: true });

/** Orden de `listEntries` (DB-114): updatedAt desc + id asc. */
const ENTRY_ORDER_BY = Object.freeze([
  Object.freeze({ field: "updatedAt", direction: "desc" }),
  Object.freeze({ field: DOCUMENT_ID_FIELD, direction: "asc" }),
]);

/** Orden de `listByMinScore` (DB-116): score desc + updatedAt desc + id. */
const MIN_SCORE_ORDER_BY = Object.freeze([
  Object.freeze({ field: "score", direction: "desc" }),
  Object.freeze({ field: "updatedAt", direction: "desc" }),
  Object.freeze({ field: DOCUMENT_ID_FIELD, direction: "asc" }),
]);

// -------------------------------------------------------------
// 2. Result y errores (00 §4.1, REQ-E1/E2/E3, API-12)
// -------------------------------------------------------------

/** Mensajes en español por código (REQ-E2). */
const ERROR_MESSAGES = Object.freeze({
  not_found: "No se ha encontrado la entry de seguimiento.",
  permission_denied:
    "No tienes permiso para acceder a las entries de este usuario.",
  validation: "Los datos de la entry no son válidos.",
  unavailable:
    "El seguimiento no está disponible en este momento. Vuelve a intentarlo en unos segundos.",
  unknown: "Ha ocurrido un error inesperado al consultar el seguimiento.",
});

const { notFoundError, toResultError } = createResultErrorHelpers(ERROR_MESSAGES);

export { toResultError };

// -------------------------------------------------------------
// 3. Helpers puros
// -------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Valida un `uid` de Firestore (SEC-01): texto no vacío sin `/`.
 * @param {*} uid
 * @returns {string}
 */
export function requireUid(uid) {
  if (typeof uid !== "string" || uid.trim() === "") {
    throw inputError("El usuario (uid) es obligatorio.", ["El usuario (uid) es obligatorio."]);
  }
  const value = uid.trim();
  if (value.includes("/")) {
    throw inputError(`uid inválido: "${uid}".`, [`uid inválido: "${uid}".`]);
  }
  return value;
}

/**
 * Valida un `mediaId` (doc id = mediaId, REQ-201): texto no vacío sin
 * `/` ni segmentos especiales.
 * @param {*} mediaId
 * @returns {string}
 */
export function requireMediaId(mediaId) {
  if (typeof mediaId !== "string" || mediaId.trim() === "") {
    throw inputError("El id del ítem (mediaId) es obligatorio.", [
      "El id del ítem (mediaId) es obligatorio.",
    ]);
  }
  const value = mediaId.trim();
  if (value.includes("/") || value === "." || value === "..") {
    throw inputError(`mediaId inválido: "${mediaId}".`, [`mediaId inválido: "${mediaId}".`]);
  }
  return value;
}

/** Milisegundos de un timestamp de Firestore/Date/ISO, o `null`. */
export function timestampToMs(value) {
  const date = tsToDate(value);
  return date === null ? null : date.getTime();
}

/**
 * Convierte el doc leído (plano o snapshot) en `Entry` (DB-103):
 * `mediaId` como id, `score`/`review`/`progress` `null` si faltan y
 * fechas como `Date`. No inventa valores no persistidos.
 * @param {*} doc
 * @param {string|null} [fallbackMediaId]
 * @returns {object}
 */
export function materializeEntry(doc, fallbackMediaId = null) {
  if (!isPlainObject(doc) && typeof doc?.data !== "function") {
    throw inputError("El documento de la entry no es válido.", [
      "El documento de la entry no es válido.",
    ]);
  }
  const data = typeof doc.data === "function" ? doc.data() ?? {} : { ...doc };
  const docId = typeof doc?.id === "string" && doc.id !== "" ? doc.id : null;
  const dataId = typeof data.mediaId === "string" && data.mediaId !== "" ? data.mediaId : null;
  const mediaId = docId ?? dataId ?? fallbackMediaId;
  if (typeof mediaId !== "string" || mediaId === "") {
    throw inputError("El documento de la entry no tiene mediaId.", [
      "El documento de la entry no tiene mediaId.",
    ]);
  }

  const entry = { ...data, mediaId };
  entry.status = data.status ?? DEFAULT_ENTRY_STATUS;
  entry.score = data.score ?? null;
  entry.review = data.review ?? null;
  entry.progress = isPlainObject(data.progress) ? { ...data.progress } : null;
  entry.createdAt = tsToDate(data.createdAt);
  entry.updatedAt = tsToDate(data.updatedAt);
  return entry;
}

/**
 * Tope de progreso que impone la metadata del ítem (DB-102/DB-103,
 * REQ-204): episodios → `totalEpisodes`; páginas → `totalChapters` (o
 * `totalPages`); duración → `durationMinutes`; juegos → `totalHours`.
 * @param {*} metadata
 * @returns {number|null}
 */
export function progressTotalFromMetadata(metadata) {
  if (!isPlainObject(metadata)) return null;
  let value = null;
  if (metadata.kind === "episodes") value = metadata.totalEpisodes;
  else if (metadata.kind === "pages") {
    value = metadata.totalChapters ?? metadata.totalPages;
  } else if (metadata.kind === "duration") value = metadata.durationMinutes;
  else if (metadata.kind === "platforms") value = metadata.totalHours;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Contexto de validación (`mediaType`/`metadata`) tomado del propio
 * input, sin I/O. Acepta `input.media`, `input.metadata`,
 * `input.mediaType` y `input.metadataKind`.
 * @param {object} input
 * @returns {{mediaType: string|null, metadata: object|null}|null}
 */
export function inlineMediaContext(input) {
  if (!isPlainObject(input)) return null;
  const media = isPlainObject(input.media) ? input.media : null;
  const metadata = isPlainObject(input.metadata)
    ? input.metadata
    : isPlainObject(media?.metadata)
      ? media.metadata
      : null;
  const mediaType = input.mediaType ?? media?.mediaType ?? null;
  if (metadata === null && mediaType === null) return null;
  return { mediaType, metadata };
}

/**
 * Valida `progress` (DB-122, DB-103, AC-123) reutilizando
 * `validateEntry` y aplicando el tope de la metadata conocida.
 * @param {*} progress
 * @param {{mediaType?: string|null, metadata?: object|null}|null} [context]
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateProgress(progress, context = null) {
  if (progress === null || progress === undefined) return { valid: true, errors: [] };
  const report = validateEntry({ status: DEFAULT_ENTRY_STATUS, progress }, context);
  if (!report.valid) return report;

  const errors = [];
  const mediaTotal = progressTotalFromMetadata(context?.metadata);
  if (mediaTotal !== null) {
    const total =
      typeof progress.total === "number" && Number.isFinite(progress.total)
        ? progress.total
        : mediaTotal;
    // AC-123: con `totalEpisodes: 12`, `{current:13,total:12}` (o
    // `{current:13}` sin total) se rechaza; `{current:12,total:12}`
    // se acepta.
    if (progress.current > total) {
      errors.push(`El progreso actual no puede superar el total (${total}).`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Resuelve el contexto de metadata de un ítem del catálogo. Primero el
 * inline del input (sin red); si no, `store.getMedia` (o alias) UNA
 * lectura. Si el store no expone lector de catálogo, `null` y la parte
 * pura sigue validando lo estructural.
 * @param {object} store
 * @param {string} mediaId
 * @param {object} input
 * @returns {Promise<{mediaType: string|null, metadata: object|null}|null>}
 */
async function resolveMediaContext(store, mediaId, input) {
  const inline = inlineMediaContext(input);
  if (inline) return inline;

  const readerNames = ["getMedia", "getMediaItem", "getCatalogItem", "getById"];
  for (const name of readerNames) {
    if (typeof store?.[name] !== "function") continue;
    const media = await store[name](mediaId);
    if (!isPlainObject(media)) return null;
    const data = typeof media.data === "function" ? media.data() ?? {} : media;
    if (!isPlainObject(data.metadata) && typeof data.mediaType !== "string") return null;
    return {
      mediaType: typeof data.mediaType === "string" ? data.mediaType : null,
      metadata: isPlainObject(data.metadata) ? data.metadata : null,
    };
  }
  return null;
}

// -------------------------------------------------------------
// 4. Cursor opaco de `listEntries` (DB-114)
// -------------------------------------------------------------

/**
 * Serializa la posición de una entry como cursor OPACO (updatedAt +
 * id). Devuelve `null` si el doc no tiene `updatedAt` utilizable, para
 * cerrar la paginación en vez de reanudar mal.
 * @param {object} doc `{ id, updatedAt }`
 * @returns {string|null}
 */
export function encodeEntriesCursor(doc) {
  const ms = timestampToMs(doc?.updatedAt);
  const rawId =
    typeof doc?.id === "string" && doc.id !== ""
      ? doc.id
      : typeof doc?.mediaId === "string" && doc.mediaId !== ""
        ? doc.mediaId
        : null;
  const id = rawId;
  if (ms === null || id === null) return null;
  return encodeCursorPayload({ v: CURSOR_VERSION, t: ms, i: id });
}

/**
 * Decodifica y valida un cursor opaco. Lanza `validation` si está
 * corrupto (nunca se confía en la UI).
 * @param {string} token
 * @returns {{updatedAt: number, id: string}}
 */
export function decodeEntriesCursor(token) {
  const invalid = () => inputError("El cursor no es válido.", ["El cursor no es válido."]);
  const payload = decodeCursorPayload(token);

  if (
    !isPlainObject(payload) ||
    payload.v !== CURSOR_VERSION ||
    typeof payload.t !== "number" ||
    !Number.isFinite(payload.t) ||
    typeof payload.i !== "string" ||
    payload.i === ""
  ) {
    throw invalid();
  }
  return { updatedAt: payload.t, id: payload.i };
}

// -------------------------------------------------------------
// 5. Opciones y query specs (DB-114/DB-115, AC-124)
// -------------------------------------------------------------

function asOptions(options) {
  if (options === undefined || options === null) return {};
  if (!isPlainObject(options)) {
    throw inputError("Las opciones de consulta deben ser un objeto.", [
      "Las opciones de consulta deben ser un objeto.",
    ]);
  }
  return options;
}

/**
 * Resuelve `pageSize`: por defecto 24, como máximo `MAX_PAGE_SIZE` (48).
 * Lanza `validation` si no es un entero ≥1.
 * @param {*} pageSize
 * @returns {number}
 */
export function resolveEntryPageSize(pageSize) {
  if (pageSize === undefined || pageSize === null) return DEFAULT_ENTRY_PAGE_SIZE;
  if (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1) {
    throw inputError("El tamaño de página debe ser un número entero mayor o igual que 1.", [
      "El tamaño de página debe ser un número entero mayor o igual que 1.",
    ]);
  }
  return Math.min(pageSize, MAX_PAGE_SIZE);
}

/**
 * Construye la query de `listEntries` (DB-114/DB-115, AC-124):
 * filtro opcional `status ==` + `updatedAt` desc + id asc +
 * `limit(pageSize + 1)` + cursor. Lanza `validation` si algo no encaja.
 * @param {*} [options]
 * @returns {{status: string|null, pageSize: number, sort: string, spec: object}}
 */
export function resolveListEntriesQuery(options) {
  const opts = asOptions(options);

  let status = null;
  if (opts.status !== undefined && opts.status !== null) {
    if (!isEntryStatus(opts.status)) {
      throw inputError(`Estado inválido: "${opts.status}".`, [
        `Estado inválido: "${opts.status}". Valores permitidos: ${ENTRY_STATUSES.join(", ")}.`,
      ]);
    }
    status = opts.status;
  }

  const sort = opts.sort === undefined || opts.sort === null ? DEFAULT_ENTRY_SORT : opts.sort;
  if (!ENTRY_SORTS.includes(sort)) {
    throw inputError(`Orden no válido: "${sort}".`, [
      `Orden no válido: "${sort}". Valores permitidos: ${ENTRY_SORTS.join(", ")}.`,
    ]);
  }

  const pageSize = resolveEntryPageSize(opts.pageSize);
  const startAfter =
    opts.cursor === undefined || opts.cursor === null
      ? null
      : decodeEntriesCursor(opts.cursor);

  return {
    status,
    pageSize,
    sort,
    spec: {
      collection: ENTRIES_COLLECTION,
      filters: status === null ? [] : [{ field: "status", op: "==", value: status }],
      orderBy: ENTRY_ORDER_BY,
      limit: pageSize + 1,
      startAfter,
    },
  };
}

// -------------------------------------------------------------
// 6. Orden en memoria (defensa ante stores falsos simples)
// -------------------------------------------------------------

function compareIds(a, b) {
  const idA = String(a?.mediaId ?? a?.id ?? "");
  const idB = String(b?.mediaId ?? b?.id ?? "");
  if (idA === idB) return 0;
  return idA < idB ? -1 : 1;
}

function compareUpdatedAtDesc(a, b) {
  const ta = timestampToMs(a?.updatedAt);
  const tb = timestampToMs(b?.updatedAt);
  if (ta === null && tb === null) return compareIds(a, b);
  if (ta === null) return 1;
  if (tb === null) return -1;
  if (ta === tb) return compareIds(a, b);
  return tb - ta;
}

function compareScoreDesc(a, b) {
  const sa = typeof a?.score === "number" && Number.isFinite(a.score) ? a.score : null;
  const sb = typeof b?.score === "number" && Number.isFinite(b.score) ? b.score : null;
  if (sa === null && sb === null) return compareUpdatedAtDesc(a, b);
  if (sa === null) return 1;
  if (sb === null) return -1;
  if (sa !== sb) return sb - sa;
  return compareUpdatedAtDesc(a, b);
}

/**
 * ¿El doc queda ESTRICTAMENTE después del cursor en el orden de
 * `listEntries` (updatedAt desc + id asc)? Se aplica en memoria para
 * que un store falso que ignore `startAfter` no repita la misma página
 * indefinidamente (DB-114, AC-124).
 * @param {object} doc
 * @param {{updatedAt: number, id: string}|null} cursor
 * @returns {boolean}
 */
function isAfterEntriesCursor(doc, cursor) {
  if (!cursor) return true;
  const ms = timestampToMs(doc?.updatedAt);
  if (ms === null) return true; // sin updatedAt ⇒ al final del orden desc
  if (ms !== cursor.updatedAt) return ms < cursor.updatedAt;
  const id = String(doc?.id ?? doc?.mediaId ?? "");
  return id > cursor.id;
}

/** Extrae los docs de la respuesta de un store (`{docs}` o array). */
function readDocs(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.docs)) return response.docs;
  return [];
}

// -------------------------------------------------------------
// 7. Parte store: Firestore (REQ-C1, API-10, API-11)
// -------------------------------------------------------------

// Import dinámico: la parte pura se puede importar en Node/vitest sin
// red (REQ-C1).
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

/** Ruta `users/{uid}/entries/{mediaId}` (DB-103). */
function entryRef(sdk, uid, mediaId) {
  return sdk.doc(sdk.db, "users", uid, ENTRIES_COLLECTION, mediaId);
}

/** Traduce el centinela `SERVER_TIMESTAMP` a `serverTimestamp()` (API-11). */
function toFirestorePayload(sdk, data) {
  const payload = {};
  for (const [key, value] of Object.entries(data)) {
    payload[key] = value === SERVER_TIMESTAMP ? sdk.serverTimestamp() : value;
  }
  return payload;
}

/** Devuelve la entry local con las fechas resueltas (nunca sentinels). */
function resolveLocalTimestamps(data, now = new Date()) {
  const copy = { ...data };
  for (const field of ["createdAt", "updatedAt"]) {
    if (copy[field] === SERVER_TIMESTAMP) copy[field] = new Date(now.getTime());
  }
  return copy;
}

/**
 * Store respaldado por Firestore. Cada método hace su propio import
 * dinámico del SDK (REQ-C1). Implementa el contrato documentado arriba.
 * @returns {{
 *   getEntry: Function, getMedia: Function, upsertEntry: Function,
 *   updateEntry: Function, deleteEntry: Function, queryEntries: Function
 * }}
 */
export function createFirestoreTrackingStore() {
  return {
    /** Lee `users/{uid}/entries/{mediaId}` (SEC-01). */
    async getEntry(uid, mediaId) {
      const sdk = await loadFirestoreSdk();
      const snapshot = await sdk.getDoc(entryRef(sdk, uid, mediaId));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    },

    /** Lee `catalog/{mediaId}` para validar la unidad de `progress`. */
    async getMedia(mediaId) {
      const sdk = await loadFirestoreSdk();
      const snapshot = await sdk.getDoc(sdk.doc(sdk.db, CATALOG_COLLECTION, mediaId));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    },

    /**
     * Upsert por doc id determinista (REQ-201, AC-120): `merge: true`
     * sobre `mediaId`; nunca crea un segundo documento.
     */
    async upsertEntry(uid, mediaId, data) {
      const sdk = await loadFirestoreSdk();
      const payload = toFirestorePayload(sdk, data);
      await sdk.setDoc(entryRef(sdk, uid, mediaId), payload, { merge: true });
      return { id: mediaId, ...resolveLocalTimestamps(data) };
    },

    /** Escritura parcial: SOLO el patch + `serverTimestamp()` (API-11). */
    async updateEntry(uid, mediaId, patch) {
      const sdk = await loadFirestoreSdk();
      const payload = toFirestorePayload(sdk, patch);
      try {
        await sdk.updateDoc(entryRef(sdk, uid, mediaId), payload);
      } catch (error) {
        // `updateDoc` sobre un doc inexistente → not-found (REQ-E2).
        throw error;
      }
      return resolveLocalTimestamps(patch);
    },

    /** Borra la entry; NO toca `catalog` ni colecciones (REQ-208). */
    async deleteEntry(uid, mediaId) {
      const sdk = await loadFirestoreSdk();
      await sdk.deleteDoc(entryRef(sdk, uid, mediaId));
      return true;
    },

    /**
     * Ejecuta una query de entries con la spec pura (DB-114/DB-115).
     * `startAfter` se reconstruye con `Date` + referencia de documento.
     */
    async queryEntries(uid, spec) {
      const sdk = await loadFirestoreSdk();
      const collectionRef = sdk.collection(sdk.db, "users", uid, ENTRIES_COLLECTION);
      const constraints = [];

      for (const filter of spec?.filters ?? []) {
        constraints.push(sdk.where(filter.field, filter.op, filter.value));
      }
      for (const order of spec?.orderBy ?? []) {
        const field = order.field === DOCUMENT_ID_FIELD ? sdk.documentId() : order.field;
        constraints.push(sdk.orderBy(field, order.direction));
      }
      if (typeof spec?.limit === "number" && Number.isFinite(spec.limit)) {
        constraints.push(sdk.limit(spec.limit));
      }
      if (spec?.startAfter && typeof spec.startAfter === "object") {
        constraints.push(
          sdk.startAfter(
            new Date(spec.startAfter.updatedAt),
            sdk.doc(collectionRef, spec.startAfter.id),
          ),
        );
      }

      const snapshot = await sdk.getDocs(sdk.query(collectionRef, ...constraints));
      return { docs: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })) };
    },
  };
}

// -------------------------------------------------------------
// 8. Repositorio (API-10..API-12, REQ-201..REQ-205)
// -------------------------------------------------------------

function isTrackingStore(candidate) {
  return Boolean(
    candidate &&
      typeof candidate.getEntry === "function" &&
      typeof candidate.upsertEntry === "function" &&
      typeof candidate.updateEntry === "function" &&
      typeof candidate.deleteEntry === "function" &&
      typeof candidate.queryEntries === "function",
  );
}

/**
 * Construye el repositorio de tracking. Ninguna función lanza: todas
 * devuelven `Result` (REQ-E1).
 *
 * @param {object|Function} storeOrGetter store Firestore o fábrica
 *        perezosa (`() => store`) con el contrato de la cabecera.
 * @param {{
 *   uid?: string|Function|null,
 *   getUid?: string|Function|null,
 *   serverTimestamp?: () => *
 * }} [options] `uid`/`getUid` activan la comprobación owner-only
 *        SEC-01 antes de tocar el store (AC-129); `serverTimestamp`
 *        permite a un store falso observar el sello (por defecto
 *        `SERVER_TIMESTAMP`).
 * @returns {object} TrackingRepository
 */
export function createTrackingRepository(storeOrGetter, options = {}) {
  const opts = isPlainObject(options) ? options : {};
  const expectedUidSource = opts.uid ?? opts.getUid ?? null;
  const stamp =
    typeof opts.serverTimestamp === "function"
      ? opts.serverTimestamp
      : () => SERVER_TIMESTAMP;

  let cachedStore = null;

  async function resolveStore() {
    if (cachedStore) return cachedStore;
    const candidate =
      typeof storeOrGetter === "function" ? await storeOrGetter() : await storeOrGetter;
    if (!isTrackingStore(candidate)) {
      const error = new Error(
        "El store de tracking debe implementar getEntry(), upsertEntry(), updateEntry(), deleteEntry() y queryEntries().",
      );
      error.code = "validation";
      throw error;
    }
    cachedStore = candidate;
    return cachedStore;
  }

  /** SEC-01 / AC-129: corta el acceso cruzado ANTES de la escritura. */
  async function assertOwner(uid) {
    if (!expectedUidSource) return;
    const expected =
      typeof expectedUidSource === "function"
        ? await expectedUidSource()
        : expectedUidSource;
    // Guard configurado pero sin sesión válida ⇒ no se toca el store.
    if (typeof expected !== "string" || expected === "") {
      const error = new Error(
        "No hay una sesión autenticada para acceder a las entries (SEC-01).",
      );
      error.code = "permission-denied";
      throw error;
    }
    if (expected !== uid) {
      const error = new Error(
        "No puedes acceder a las entries de otro usuario (SEC-01).",
      );
      error.code = "permission-denied";
      throw error;
    }
  }

  async function getEntry(uid, mediaId) {
    try {
      const owner = requireUid(uid);
      const id = requireMediaId(mediaId);
      await assertOwner(owner);
      const store = await resolveStore();
      const doc = await store.getEntry(owner, id);
      return okResult(doc ? materializeEntry(doc, id) : null);
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Crea o actualiza la entry con doc id = mediaId (REQ-201, AC-120).
   * `input` admite `status`, `score`, `review`, `progress` y, para el
   * contexto de `progress`, `media`/`metadata`/`mediaType` (si no se
   * da, se lee `catalog/{mediaId}`). Valida DB-122 ANTES de escribir
   * (API-12).
   */
  async function upsertEntry(uid, mediaId, input = {}) {
    try {
      const owner = requireUid(uid);
      const id = requireMediaId(mediaId);
      await assertOwner(owner);
      if (!isPlainObject(input)) {
        throw inputError("Los datos de la entry deben ser un objeto.", [
          "Los datos de la entry deben ser un objeto.",
        ]);
      }

      // 1) Validación pura de los campos aportados (sin I/O ni
      //    escritura): AC-122 (score 11 / 10.5) corta aquí. `progress`
      //    se valida UNA sola vez más abajo, con su contexto de ítem.
      const probe = { status: input.status === undefined ? DEFAULT_ENTRY_STATUS : input.status };
      if (input.score !== undefined) probe.score = input.score;
      if (input.review !== undefined) probe.review = input.review;
      const inlineContext = inlineMediaContext(input);
      const probeReport = validateEntry(probe, inlineContext);
      if (!probeReport.valid) {
        throw inputError(probeReport.errors.join(" "), probeReport.errors);
      }

      // 2) Única pasada de `progress` con el mejor contexto
      //    disponible: inline (sin red) o `catalog/{mediaId}` (REQ-204,
      //    AC-123).
      let context = inlineContext;
      let store = null;
      if (input.progress !== undefined) {
        if (context === null) {
          store = await resolveStore();
          context = await resolveMediaContext(store, id, input);
        }
        const progressReport = validateProgress(input.progress, context);
        if (!progressReport.valid) {
          throw inputError(progressReport.errors.join(" "), progressReport.errors);
        }
      }

      if (store === null) store = await resolveStore();

      // 3) Merge con la entry existente (upsert sin perder campos).
      const existingDoc = await store.getEntry(owner, id);
      const existing = existingDoc ? materializeEntry(existingDoc, id) : null;
      const entry = {
        mediaId: id,
        status: input.status ?? existing?.status ?? DEFAULT_ENTRY_STATUS,
        score: input.score !== undefined ? input.score : existing?.score ?? null,
        review: input.review !== undefined ? input.review : existing?.review ?? null,
        progress:
          input.progress !== undefined ? input.progress : existing?.progress ?? null,
      };

      // 4) Gate final del resto de campos (DB-122). `progress` ya se
      //    validó una sola vez en el paso 2; no se repite.
      const finalReport = validateEntry({ ...entry, progress: null }, context);
      if (!finalReport.valid) {
        throw inputError(finalReport.errors.join(" "), finalReport.errors);
      }

      const data = { ...entry, updatedAt: stamp() };
      // `createdAt` se conserva en updates (DB-103) y solo se sella al
      // crear (REQ-201). Se envía explícitamente para que cualquier
      // store (también falsos con reemplazo total) lo mantenga.
      data.createdAt = existing?.createdAt ?? stamp();

      const saved = await store.upsertEntry(owner, id, data);
      const merged = {
        ...(existing ?? {}),
        ...(isPlainObject(saved) ? saved : {}),
        ...entry,
        createdAt: existing?.createdAt ?? saved?.createdAt ?? data.createdAt,
        updatedAt:
          isPlainObject(saved) && saved.updatedAt !== undefined
            ? saved.updatedAt
            : data.updatedAt,
      };
      // Nunca devolver el centinela `serverTimestamp()` a la UI.
      if (timestampToMs(merged.createdAt) === null) merged.createdAt = new Date();
      if (timestampToMs(merged.updatedAt) === null) merged.updatedAt = new Date();
      return okResult(materializeEntry(merged, id));
    } catch (error) {
      return toResultError(error);
    }
  }

  /** Escritura parcial común (API-11): lee, parchea y sella updatedAt. */
  async function applyPartial(owner, id, patch) {
    const store = await resolveStore();
    const currentDoc = await store.getEntry(owner, id);
    if (!currentDoc) throw notFoundError();
    const current = materializeEntry(currentDoc, id);

    const data = { ...patch, updatedAt: stamp() };
    const saved = await store.updateEntry(owner, id, data);
    const merged = {
      ...current,
      ...patch,
      ...(isPlainObject(saved) ? saved : {}),
      mediaId: id,
      updatedAt:
        isPlainObject(saved) && saved.updatedAt !== undefined
          ? saved.updatedAt
          : data.updatedAt,
    };
    if (timestampToMs(merged.updatedAt) === null) merged.updatedAt = new Date();
    return okResult(materializeEntry(merged, id));
  }

  async function setStatus(uid, mediaId, status) {
    try {
      const owner = requireUid(uid);
      const id = requireMediaId(mediaId);
      await assertOwner(owner);
      if (!isEntryStatus(status)) {
        throw inputError(`Estado inválido: "${status}".`, [
          `Estado inválido: "${status}". Valores permitidos: ${ENTRY_STATUSES.join(", ")}.`,
        ]);
      }
      return await applyPartial(owner, id, { status });
    } catch (error) {
      return toResultError(error);
    }
  }

  async function setScore(uid, mediaId, score) {
    try {
      const owner = requireUid(uid);
      const id = requireMediaId(mediaId);
      await assertOwner(owner);
      const value = score === undefined ? null : score;
      const report = validateEntry({ status: DEFAULT_ENTRY_STATUS, score: value });
      if (!report.valid) throw inputError(report.errors.join(" "), report.errors);
      return await applyPartial(owner, id, { score: value });
    } catch (error) {
      return toResultError(error);
    }
  }

  async function setReview(uid, mediaId, review) {
    try {
      const owner = requireUid(uid);
      const id = requireMediaId(mediaId);
      await assertOwner(owner);
      const value = review === undefined ? null : review;
      const report = validateEntry({ status: DEFAULT_ENTRY_STATUS, review: value });
      if (!report.valid) throw inputError(report.errors.join(" "), report.errors);
      return await applyPartial(owner, id, { review: value });
    } catch (error) {
      return toResultError(error);
    }
  }

  async function setProgress(uid, mediaId, progress) {
    try {
      const owner = requireUid(uid);
      const id = requireMediaId(mediaId);
      await assertOwner(owner);
      const value = progress === undefined ? null : progress;
      const store = await resolveStore();
      const context = value === null ? null : await resolveMediaContext(store, id, {});
      const report = validateProgress(value, context);
      if (!report.valid) throw inputError(report.errors.join(" "), report.errors);
      return await applyPartial(owner, id, { progress: value });
    } catch (error) {
      return toResultError(error);
    }
  }

  async function deleteEntry(uid, mediaId) {
    try {
      const owner = requireUid(uid);
      const id = requireMediaId(mediaId);
      await assertOwner(owner);
      const store = await resolveStore();
      await store.deleteEntry(owner, id);
      return okResult(true);
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Lista entries (DB-114/DB-115, AC-124): `updatedAt` desc, filtro
   * opcional por `status`, cursor opaco. Se reordena/filtra también en
   * memoria para no depender de stores falsos.
   */
  async function listEntries(uid, opts) {
    try {
      const owner = requireUid(uid);
      await assertOwner(owner);
      const { status, pageSize, spec } = resolveListEntriesQuery(opts);
      const store = await resolveStore();
      const response = await store.queryEntries(owner, spec);

      let docs = readDocs(response).filter(
        (doc) => doc !== null && typeof doc === "object",
      );
      // Filtro materializado: una entry sin `status` implica PLANNED
      // (REQ-201/AC-120) y debe seguir apareciendo al filtrar por ese
      // estado (AC-124).
      if (status !== null) {
        docs = docs.filter(
          (doc) => (doc.status ?? DEFAULT_ENTRY_STATUS) === status,
        );
      }
      const sorted = docs.slice().sort(compareUpdatedAtDesc);

      // Cursor aplicado también en memoria: un store que ignore
      // `startAfter` no puede repetir la misma página para siempre
      // (DB-114, AC-124).
      const page = spec.startAfter
        ? sorted.filter((doc) => isAfterEntriesCursor(doc, spec.startAfter))
        : sorted;

      const window = page.slice(0, pageSize);
      const hasMore = page.length > window.length;
      const items = window.map((doc) => materializeEntry(doc));
      let cursor = null;
      if (hasMore && window.length > 0) {
        cursor = encodeEntriesCursor(window[window.length - 1]);
      }
      return okResult({ items, cursor });
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Entries con `score >= minScore` (DB-116): orden `score` desc +
   * `updatedAt` desc. Sin paginación en el contrato.
   */
  async function listByMinScore(uid, minScore) {
    try {
      const owner = requireUid(uid);
      await assertOwner(owner);
      if (
        typeof minScore !== "number" ||
        !Number.isFinite(minScore) ||
        minScore < 0 ||
        minScore > 10
      ) {
        throw inputError("La puntuación mínima debe estar entre 0 y 10.", [
          "La puntuación mínima debe estar entre 0 y 10.",
        ]);
      }
      const store = await resolveStore();
      const response = await store.queryEntries(owner, {
        collection: ENTRIES_COLLECTION,
        filters: [{ field: "score", op: ">=", value: minScore }],
        orderBy: MIN_SCORE_ORDER_BY,
        limit: null,
        startAfter: null,
      });

      const scored = readDocs(response).filter(
        (doc) =>
          doc &&
          typeof doc.score === "number" &&
          Number.isFinite(doc.score) &&
          doc.score >= minScore,
      );
      const sorted = scored.slice().sort(compareScoreDesc);
      return okResult(sorted.map((doc) => materializeEntry(doc)));
    } catch (error) {
      return toResultError(error);
    }
  }

  return {
    getEntry,
    upsertEntry,
    setStatus,
    setScore,
    setReview,
    setProgress,
    deleteEntry,
    listEntries,
    listByMinScore,
  };
}

// -------------------------------------------------------------
// 9. Instancia por defecto (Firestore, carga perezosa)
// -------------------------------------------------------------

/**
 * Repositorio por defecto sobre Firestore.
 *
 * SEC-01 / AC-129: `getUid` se cablea a la sesión real de Firebase. El
 * import es dinámico y ocurre solo al usar un método, así que este
 * módulo sigue siendo importable en Node sin red (REQ-C1); sin sesión
 * (o en Node) el guard responde `permission_denied` y no escribe.
 */
async function getCurrentUid() {
  try {
    const { auth } = await import("../firebase.js");
    return auth?.currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

/**
 * @type {ReturnType<typeof createTrackingRepository>}
 */
export const trackingRepository = createTrackingRepository(createFirestoreTrackingStore, {
  getUid: getCurrentUid,
});

/** Atajos con la API plana del contrato (spec 03 §2). */
export const getEntry = (uid, mediaId) => trackingRepository.getEntry(uid, mediaId);

export const upsertEntry = (uid, mediaId, input) =>
  trackingRepository.upsertEntry(uid, mediaId, input);

export const setStatus = (uid, mediaId, status) =>
  trackingRepository.setStatus(uid, mediaId, status);

export const setScore = (uid, mediaId, score) =>
  trackingRepository.setScore(uid, mediaId, score);

export const setReview = (uid, mediaId, review) =>
  trackingRepository.setReview(uid, mediaId, review);

export const setProgress = (uid, mediaId, progress) =>
  trackingRepository.setProgress(uid, mediaId, progress);

export const deleteEntry = (uid, mediaId) => trackingRepository.deleteEntry(uid, mediaId);

export const listEntries = (uid, opts) => trackingRepository.listEntries(uid, opts);

export const listByMinScore = (uid, minScore) =>
  trackingRepository.listByMinScore(uid, minScore);

export default trackingRepository;
