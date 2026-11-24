// =============================================================
// Repositorio de colecciones propias (spec 03 API-10, API-13,
// REQ-206, REQ-208; spec 01 DB-104, DB-117, DB-123, SEC-01;
// AC-125..AC-128; spec 00 REQ-C1/C2/C6, REQ-E1/E2/E3).
//
// Dos capas en un único módulo, igual que `tracking-repository.js`:
//
//  1) PARTE PURA (importable en Node/vitest SIN red y SIN Firebase):
//     validación de `Collection` (DB-104/DB-123 vía
//     `validateCollection` de `catalog.js`), materialización,
//     orden en memoria y query spec de `list` (DB-117).
//
//  2) PARTE STORE (Firestore): `createFirestoreCollectionStore()`
//     importa `../firebase.js` de forma perezosa (REQ-C1) dentro de
//     cada método, así que la parte pura se puede importar sin red.
//     Los tests inyectan un store falso en
//     `createCollectionRepository(storeOrGetter)`.
//
// Contrato (spec 03 §2):
//   list(uid)                       -> Result<Collection[]>  // DB-117
//   create(uid, {name, description?}) -> Result<Collection>
//   update(uid, id, {name?, description?}) -> Result<Collection>
//   delete(uid, id)                 -> Result<true>
//   addItem(uid, id, mediaId)       -> Result<Collection>    // API-13
//   removeItem(uid, id, mediaId)    -> Result<Collection>
//   get(uid, id)                    -> Result<Collection | null>
//
// Decisiones relevantes:
//   - Ruta `users/{uid}/collections/{collectionId}` (DB-104) y
//     `list` con `updatedAt` DESC + id ASC como desempate (DB-117).
//     El store Firestore consulta solo `updatedAt DESC` (único índice
//     declarado) y deja el desempate `__name__ ASC` implícito de
//     Firestore; el repositorio además reordena en memoria.
//   - Validación ANTES de escribir (DB-123): `name` 1–60,
//     `description` ≤300, `itemIds` sin duplicados y ≤50. Nunca se
//     lanza: todo devuelve `Result` (REQ-E1).
//   - `create` cuenta las colecciones existentes y rechaza la 21.ª
//     con `validation` («Máximo 20 colecciones…») SIN escribir
//     (REQ-206, AC-126). ≤20 es validación, no regla (DB-104).
//   - `addItem` es idempotente (API-13, AC-125): si el `mediaId` ya
//     está, no hay escritura; si no, la escritura es una UNIÓN (nunca
//     reemplaza la lista) y con 50 ítems se responde `validation` sin
//     escribir. El store Firestore implementa la unión con
//     lectura+fusión+`updateDoc`, porque `js/firebase.js` no
//     reexporta `arrayUnion` y este módulo no puede modificarlo;
//     `removeItem` sí usa `arrayRemove` atómico.
//   - `removeItem` (AC-127) escribe SOLO `itemIds` (+`updatedAt`):
//     `name`/`description`/`createdAt` no viajan en el patch.
//   - `delete` borra SOLO la colección: no toca `entries` ni
//     `catalog` (REQ-208, AC-128). Borrar una entry de tracking
//     tampoco toca la colección (`tracking-repository.js`).
//   - SEC-01: `firestore.rules` es la frontera real; además el
//     repositorio acepta `options.uid`/`options.getUid` y corta con
//     `permission_denied` cualquier `uid` ajeno ANTES del store.
//
// Store contract (inyectable en tests, API-14):
//   listCollections(uid, spec)      -> Promise<{docs: object[]}|object[]>
//   getCollection(uid, id)          -> Promise<object|null>
//   countCollections(uid)           -> Promise<number>   (opcional)
//   createCollection(uid, data)     -> Promise<object|void> // data.id
//   updateCollection(uid, id, patch) -> Promise<object|void>
//   deleteCollection(uid, id)       -> Promise<boolean|void>
//   addItem(uid, id, mediaId)       -> Promise<object|void> // unión
//   removeItem(uid, id, mediaId)    -> Promise<object|void>
// `createCollection` recibe `data.id` (id generado por el repositorio)
// y debe persistir el documento con ese id si lo devuelve; si el store
// devuelve `void`, el repositorio conserva el id que generó.
// =============================================================

import { tsToDate, validateCollection } from "../catalog.js";

// -------------------------------------------------------------
// 1. Constantes del contrato (DB-104, DB-117, REQ-206)
// -------------------------------------------------------------

/** Subcolección de colecciones dentro de `users/{uid}` (DB-104). */
export const COLLECTIONS_COLLECTION = "collections";

/** Máximo de colecciones por usuario (DB-104, REQ-206, AC-126). */
export const MAX_COLLECTIONS_PER_USER = 20;

/** Máximo de ítems por colección (DB-104, API-13). */
export const MAX_COLLECTION_ITEMS = 50;

/** Longitud máxima de `name` (DB-104, DB-123). */
export const COLLECTION_NAME_MAX = 60;

/** Longitud máxima de `description` (DB-104, DB-123). */
export const COLLECTION_DESCRIPTION_MAX = 300;

/** Campo especial de orden por id de documento (DB-117). */
export const DOCUMENT_ID_FIELD = "__name__";

/**
 * Orden del listado (DB-117): `updatedAt` desc + id asc.
 *
 * Es el orden LÓGICO del contrato (lo aplica el repositorio en memoria
 * y lo usan los stores falsos). El store Firestore NO envía la cláusula
 * `__name__`: el índice declarado es solo `updatedAt DESC`
 * (`firestore.indexes.json`), una query con dos `orderBy` explícitos
 * exigiría un índice compuesto y fallaría con `failed-precondition`;
 * Firestore ya añade `__name__ ASC` como desempate implícito de toda
 * query, así que el resultado coincide.
 */
export const COLLECTION_ORDER_BY = Object.freeze([
  Object.freeze({ field: "updatedAt", direction: "desc" }),
  Object.freeze({ field: DOCUMENT_ID_FIELD, direction: "asc" }),
]);

/**
 * Centinela de `serverTimestamp()`. El store Firestore lo traduce a
 * `serverTimestamp()`; la parte pura nunca importa Firebase. Es un
 * objeto congelado y se compara por identidad.
 */
export const SERVER_TIMESTAMP = Object.freeze({ __serverTimestamp: true });

/** Códigos de error admitidos por `Result` (00 §4.1). */
export const RESULT_ERROR_CODES = Object.freeze([
  "not_found",
  "permission_denied",
  "validation",
  "unavailable",
  "unknown",
]);

// -------------------------------------------------------------
// 2. Result y errores (00 §4.1, REQ-E1/E2/E3)
// -------------------------------------------------------------

/** Resultado correcto. */
export function okResult(value) {
  return { ok: true, value };
}

/** Resultado con error normalizado. */
export function failResult(code, message, extra = {}) {
  const result = { ok: false, code, message };
  if (Array.isArray(extra?.errors) && extra.errors.length > 0) {
    result.errors = extra.errors.slice();
  }
  return result;
}

/** Mensajes en español por código (REQ-E2). */
const ERROR_MESSAGES = Object.freeze({
  not_found: "No se ha encontrado la colección.",
  permission_denied:
    "No tienes permiso para acceder a las colecciones de este usuario.",
  validation: "Los datos de la colección no son válidos.",
  unavailable:
    "Las colecciones no están disponibles en este momento. Vuelve a intentarlo en unos segundos.",
  unknown: "Ha ocurrido un error inesperado al consultar las colecciones.",
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

/** Error de recurso ausente (sin escritura). */
function notFoundError(message = ERROR_MESSAGES.not_found) {
  const error = new Error(message);
  error.code = "not-found";
  return error;
}

/** Normaliza cualquier `code` de Firestore/JS a los de `Result`. */
export function normalizeErrorCode(code) {
  if (typeof code !== "string" || code === "") return "unknown";
  if (RESULT_ERROR_CODES.includes(code)) return code;
  return FIREBASE_CODE_MAP[code.toLowerCase()] ?? "unknown";
}

/**
 * Convierte un error en `{ ok:false, code, message, errors? }`
 * (REQ-E1/E2/E3). Nunca lanza.
 * @param {*} error
 * @returns {{ ok: false, code: string, message: string, errors?: string[] }}
 */
export function toResultError(error) {
  const code = normalizeErrorCode(error?.code);
  const rawErrors =
    error && Array.isArray(error.errors)
      ? error.errors.filter(
          (message) => typeof message === "string" && message.trim() !== "",
        )
      : [];
  const message =
    code === "validation" && rawErrors.length > 0
      ? rawErrors.join(" ")
      : ERROR_MESSAGES[code] ?? ERROR_MESSAGES.unknown;
  return failResult(code, message, { errors: rawErrors });
}

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
    throw inputError("El usuario (uid) es obligatorio.", [
      "El usuario (uid) es obligatorio.",
    ]);
  }
  const value = uid.trim();
  if (value.includes("/")) {
    throw inputError(`uid inválido: "${uid}".`, [`uid inválido: "${uid}".`]);
  }
  return value;
}

/**
 * Valida un id de colección (doc id de DB-104): texto no vacío sin
 * `/` ni segmentos especiales.
 * @param {*} collectionId
 * @returns {string}
 */
export function requireCollectionId(collectionId) {
  if (typeof collectionId !== "string" || collectionId.trim() === "") {
    throw inputError("El id de la colección es obligatorio.", [
      "El id de la colección es obligatorio.",
    ]);
  }
  const value = collectionId.trim();
  if (value.includes("/") || value === "." || value === "..") {
    throw inputError(`collectionId inválido: "${collectionId}".`, [
      `collectionId inválido: "${collectionId}".`,
    ]);
  }
  return value;
}

/**
 * Valida un `mediaId` que se guarda en `itemIds` (ref a `catalog`).
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
    throw inputError(`mediaId inválido: "${mediaId}".`, [
      `mediaId inválido: "${mediaId}".`,
    ]);
  }
  return value;
}

/** Milisegundos de un timestamp de Firestore/Date/ISO, o `null`. */
export function timestampToMs(value) {
  const date = tsToDate(value);
  return date === null ? null : date.getTime();
}

/**
 * Lista de `itemIds` limpia: solo textos no vacíos y sin duplicados
 * (DB-104). Preserva el orden e identidad de los ids originales.
 * @param {*} value
 * @returns {string[]}
 */
export function normalizeItemIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const ids = [];
  for (const id of value) {
    if (typeof id !== "string" || id.trim() === "") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Convierte el doc leído (plano o snapshot) en `Collection` (DB-104):
 * `itemIds` sin duplicados, `description` `null` si falta y fechas
 * como `Date`. No inventa valores no persistidos.
 * @param {*} doc
 * @returns {object}
 */
export function materializeCollection(doc) {
  if (!isPlainObject(doc) && typeof doc?.data !== "function") {
    throw inputError("El documento de la colección no es válido.", [
      "El documento de la colección no es válido.",
    ]);
  }
  const data = typeof doc.data === "function" ? doc.data() ?? {} : { ...doc };
  const docId = typeof doc?.id === "string" && doc.id !== "" ? doc.id : null;
  const dataId = typeof data.id === "string" && data.id !== "" ? data.id : null;
  const id = docId ?? dataId;
  if (typeof id !== "string" || id === "") {
    throw inputError("El documento de la colección no tiene id.", [
      "El documento de la colección no tiene id.",
    ]);
  }

  const description =
    typeof data.description === "string" && data.description.trim() !== ""
      ? data.description
      : null;

  return {
    ...data,
    id,
    name: typeof data.name === "string" ? data.name : "",
    description,
    itemIds: normalizeItemIds(data.itemIds),
    createdAt: tsToDate(data.createdAt),
    updatedAt: tsToDate(data.updatedAt),
  };
}

// -------------------------------------------------------------
// 4. Validación de `Collection` (DB-104, DB-123, AC-126)
// -------------------------------------------------------------

/**
 * Valida los campos de una colección (DB-123) reutilizando
 * `validateCollection` de `catalog.js`: `name` 1–60, `description`
 * ≤300, `itemIds` sin duplicados y ≤50. Los textos se validan ya
 * recortados para no rechazar espacios accidentales.
 * @param {*} input
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateCollectionInput(input) {
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["La colección debe ser un objeto."] };
  }
  return validateCollection({
    name:
      typeof input.name === "string" ? input.name.trim() : input.name,
    description:
      typeof input.description === "string"
        ? input.description.trim()
        : input.description,
    itemIds: input.itemIds === undefined || input.itemIds === null ? [] : input.itemIds,
  });
}

/**
 * Construye los datos de `create` (DB-104): `name`, `description` y
 * `itemIds: []`. Lanza `validation` si no cumplen DB-123 (sin I/O).
 * @param {*} input
 * @returns {{name: string, description: string|null, itemIds: []}}
 */
export function buildCollectionCreatePayload(input) {
  if (!isPlainObject(input)) {
    throw inputError("Los datos de la colección deben ser un objeto.", [
      "Los datos de la colección deben ser un objeto.",
    ]);
  }
  const report = validateCollectionInput({ ...input, itemIds: [] });
  if (!report.valid) throw inputError(report.errors.join(" "), report.errors);

  return {
    name: input.name.trim(),
    description:
      typeof input.description === "string" ? input.description.trim() || null : null,
    itemIds: [],
  };
}

/**
 * Normaliza el patch de `update`: solo `name`/`description` (los
 * `itemIds` se tocan con `addItem`/`removeItem`). Lanza `validation`
 * si el patch no es válido.
 * @param {*} patch
 * @returns {{name?: string, description?: string|null}}
 */
export function buildCollectionUpdatePayload(patch) {
  if (!isPlainObject(patch)) {
    throw inputError("Los datos de la colección deben ser un objeto.", [
      "Los datos de la colección deben ser un objeto.",
    ]);
  }
  const payload = {};

  if (patch.name !== undefined) {
    if (typeof patch.name !== "string") {
      throw inputError("El nombre de la colección debe ser texto.", [
        "El nombre de la colección debe ser texto.",
      ]);
    }
    payload.name = patch.name.trim();
  }

  if (patch.description !== undefined) {
    if (patch.description === null) payload.description = null;
    else if (typeof patch.description !== "string") {
      throw inputError("La descripción debe ser texto.", [
        "La descripción debe ser texto.",
      ]);
    } else {
      payload.description = patch.description.trim() || null;
    }
  }

  return payload;
}

// -------------------------------------------------------------
// 5. Query spec de `list` (DB-117)
// -------------------------------------------------------------

/**
 * Query spec de `list` (DB-117): `updatedAt` desc + id asc. Una sola
 * lectura; el máximo de 20 colecciones acota el resultado.
 * @returns {object}
 */
export function resolveListCollectionsQuery() {
  return {
    collection: COLLECTIONS_COLLECTION,
    filters: [],
    orderBy: COLLECTION_ORDER_BY,
    limit: MAX_COLLECTIONS_PER_USER,
    startAfter: null,
  };
}

// -------------------------------------------------------------
// 6. Orden en memoria (defensa ante stores falsos simples)
// -------------------------------------------------------------

function compareIds(a, b) {
  const idA = String(a?.id ?? "");
  const idB = String(b?.id ?? "");
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

/** Extrae los docs de la respuesta de un store (`{docs}` o array). */
function readDocs(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.docs)) return response.docs;
  return [];
}

// -------------------------------------------------------------
// 7. Parte store: Firestore (REQ-C1, API-10)
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

/** Referencia de la subcolección `users/{uid}/collections` (DB-104). */
function collectionsRef(sdk, uid) {
  return sdk.collection(sdk.db, "users", uid, COLLECTIONS_COLLECTION);
}

/** Ruta `users/{uid}/collections/{collectionId}` (DB-104). */
function collectionRef(sdk, uid, collectionId) {
  return sdk.doc(sdk.db, "users", uid, COLLECTIONS_COLLECTION, collectionId);
}

/** Traduce el centinela `SERVER_TIMESTAMP` a `serverTimestamp()`. */
function toFirestorePayload(sdk, data) {
  const payload = {};
  for (const [key, value] of Object.entries(data)) {
    payload[key] = value === SERVER_TIMESTAMP ? sdk.serverTimestamp() : value;
  }
  return payload;
}

/** Devuelve los datos locales con las fechas resueltas (nunca sentinels). */
function resolveLocalTimestamps(data, now = new Date()) {
  const copy = { ...data };
  for (const field of ["createdAt", "updatedAt"]) {
    if (copy[field] === SERVER_TIMESTAMP) copy[field] = new Date(now.getTime());
  }
  return copy;
}

/**
 * Store respaldado por Firestore. Cada método hace su propio import
 * dinámico del SDK (REQ-C1). Implementa el contrato documentado en la
 * cabecera.
 * @returns {object}
 */
export function createFirestoreCollectionStore() {
  return {
    /** Lista las colecciones del usuario (DB-117). */
    async listCollections(uid, spec) {
      const sdk = await loadFirestoreSdk();
      const ref = collectionsRef(sdk, uid);
      const constraints = [];
      for (const order of spec?.orderBy ?? []) {
        // DB-117: solo `updatedAt DESC` tiene índice declarado. La
        // cláusula explícita `__name__` se omite a propósito: exigiría
        // un índice compuesto inexistente (`failed-precondition`) y
        // Firestore ya desempata por `__name__ ASC` de forma implícita.
        if (order.field === DOCUMENT_ID_FIELD) continue;
        constraints.push(sdk.orderBy(order.field, order.direction));
      }
      if (typeof spec?.limit === "number" && Number.isFinite(spec.limit)) {
        constraints.push(sdk.limit(spec.limit));
      }
      const snapshot = await sdk.getDocs(sdk.query(ref, ...constraints));
      return {
        docs: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
      };
    },

    /** Lee una colección; `null` si no existe. */
    async getCollection(uid, collectionId) {
      const sdk = await loadFirestoreSdk();
      const snapshot = await sdk.getDoc(collectionRef(sdk, uid, collectionId));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    },

    /**
     * Cuenta colecciones con UNA lectura acotada (se corta en 20):
     * para la validación de AC-126 basta saber si se llegó al máximo.
     */
    async countCollections(uid) {
      const sdk = await loadFirestoreSdk();
      const snapshot = await sdk.getDocs(
        sdk.query(collectionsRef(sdk, uid), sdk.limit(MAX_COLLECTIONS_PER_USER)),
      );
      return typeof snapshot.size === "number"
        ? snapshot.size
        : snapshot.docs.length;
    },

    /**
     * Crea el documento en `data.id` (id generado por el repositorio).
     * Sin `data.id` cae a `addDoc` y devuelve el id autogenerado.
     */
    async createCollection(uid, data) {
      const sdk = await loadFirestoreSdk();
      const { id, ...rest } = data ?? {};
      const payload = toFirestorePayload(sdk, rest);

      if (typeof id === "string" && id !== "") {
        await sdk.setDoc(collectionRef(sdk, uid, id), payload);
        return { id, ...resolveLocalTimestamps(rest) };
      }
      const ref = await sdk.addDoc(collectionsRef(sdk, uid), payload);
      return { id: ref.id, ...resolveLocalTimestamps(rest) };
    },

    /** Escritura parcial (`updateDoc`) con lo aportado por el repositorio. */
    async updateCollection(uid, collectionId, patch) {
      const sdk = await loadFirestoreSdk();
      await sdk.updateDoc(
        collectionRef(sdk, uid, collectionId),
        toFirestorePayload(sdk, patch),
      );
      return { id: collectionId, ...resolveLocalTimestamps(patch) };
    },

    /** Borra SOLO la colección (REQ-208, AC-128). */
    async deleteCollection(uid, collectionId) {
      const sdk = await loadFirestoreSdk();
      await sdk.deleteDoc(collectionRef(sdk, uid, collectionId));
      return true;
    },

    /**
     * Unión idempotente de `mediaId` en `itemIds` (API-13, AC-125).
     *
     * Se relee el documento justo antes de escribir para no duplicar
     * ni rebasar 50 aunque el repositorio ya lo haya comprobado.
     * `js/firebase.js` no reexporta `arrayUnion` (este módulo no puede
     * modificarlo), así que la unión se materializa aquí; `removeItem`
     * sí usa `arrayRemove` atómico.
     */
    async addItem(uid, collectionId, mediaId) {
      const sdk = await loadFirestoreSdk();
      const ref = collectionRef(sdk, uid, collectionId);
      const snapshot = await sdk.getDoc(ref);
      if (!snapshot.exists()) throw notFoundError();

      const current = normalizeItemIds(snapshot.data()?.itemIds);
      if (current.includes(mediaId)) {
        return { id: collectionId, itemIds: current };
      }
      if (current.length >= MAX_COLLECTION_ITEMS) {
        throw inputError(
          `No se pueden guardar más de ${MAX_COLLECTION_ITEMS} ítems en una colección.`,
          [
            `No se pueden guardar más de ${MAX_COLLECTION_ITEMS} ítems en una colección.`,
          ],
        );
      }

      const next = [...current, mediaId];
      await sdk.updateDoc(ref, {
        itemIds: next,
        updatedAt: sdk.serverTimestamp(),
      });
      return { id: collectionId, itemIds: next, updatedAt: new Date() };
    },

    /**
     * Quita `mediaId` con `arrayRemove`: SOLO `itemIds` (+`updatedAt`)
     * viaja en el patch (AC-127), nunca `name`/`description`.
     */
    async removeItem(uid, collectionId, mediaId) {
      const sdk = await loadFirestoreSdk();
      await sdk.updateDoc(collectionRef(sdk, uid, collectionId), {
        itemIds: sdk.arrayRemove(mediaId),
        updatedAt: sdk.serverTimestamp(),
      });
      return { id: collectionId, updatedAt: new Date() };
    },
  };
}

// -------------------------------------------------------------
// 8. Repositorio (API-10, API-13, REQ-206/208)
// -------------------------------------------------------------

/** ¿El objeto cumple la interfaz mínima de store? */
function isCollectionStore(candidate) {
  return Boolean(
    candidate &&
      typeof candidate.listCollections === "function" &&
      typeof candidate.getCollection === "function" &&
      typeof candidate.createCollection === "function" &&
      typeof candidate.updateCollection === "function" &&
      typeof candidate.deleteCollection === "function",
  );
}

/**
 * Id de colección generado en el cliente (DB-104 no impone formato):
 * UUID si el entorno lo ofrece; si no, marca temporal + azar.
 * @returns {string}
 */
export function buildCollectionId() {
  const cryptoObject = globalThis?.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
    return cryptoObject.randomUUID();
  }
  return `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Construye el repositorio de colecciones. Ninguna función lanza:
 * todas devuelven `Result` (REQ-E1).
 *
 * @param {object|Function} storeOrGetter store Firestore o fábrica
 *        perezosa (`() => store`) con el contrato de la cabecera.
 * @param {{
 *   uid?: string|Function|null,
 *   getUid?: string|Function|null,
 *   serverTimestamp?: () => *,
 *   newId?: () => string
 * }} [options] `uid`/`getUid` activan la comprobación owner-only
 *        SEC-01 antes de tocar el store; `serverTimestamp` permite a
 *        un store falso observar el sello; `newId` inyecta el
 *        generador de ids de `create`.
 * @returns {object} CollectionRepository
 */
export function createCollectionRepository(storeOrGetter, options = {}) {
  const opts = isPlainObject(options) ? options : {};
  const expectedUidSource = opts.uid ?? opts.getUid ?? null;
  const stamp =
    typeof opts.serverTimestamp === "function"
      ? opts.serverTimestamp
      : () => SERVER_TIMESTAMP;
  const newId = typeof opts.newId === "function" ? opts.newId : buildCollectionId;

  let cachedStore = null;

  async function resolveStore() {
    if (cachedStore) return cachedStore;
    const candidate =
      typeof storeOrGetter === "function" ? await storeOrGetter() : await storeOrGetter;
    if (!isCollectionStore(candidate)) {
      const error = new Error(
        "El store de colecciones debe implementar listCollections(), getCollection(), createCollection(), updateCollection() y deleteCollection().",
      );
      error.code = "validation";
      throw error;
    }
    cachedStore = candidate;
    return cachedStore;
  }

  /** SEC-01: corta el acceso cruzado ANTES de cualquier escritura. */
  async function assertOwner(uid) {
    if (!expectedUidSource) return;
    const expected =
      typeof expectedUidSource === "function"
        ? await expectedUidSource()
        : expectedUidSource;
    // Guard configurado pero sin sesión válida ⇒ no se toca el store.
    if (typeof expected !== "string" || expected === "") {
      const error = new Error(
        "No hay una sesión autenticada para acceder a las colecciones (SEC-01).",
      );
      error.code = "permission-denied";
      throw error;
    }
    if (expected !== uid) {
      const error = new Error(
        "No puedes acceder a las colecciones de otro usuario (SEC-01).",
      );
      error.code = "permission-denied";
      throw error;
    }
  }

  /** Lee y materializa una colección; `not_found` si no existe. */
  async function readCollection(store, uid, collectionId) {
    const doc = await store.getCollection(uid, collectionId);
    if (!doc) throw notFoundError();
    return materializeCollection(doc);
  }

  /** Fusiona la escritura del store con el estado local y normaliza fechas. */
  function mergeWrite(current, patch, written) {
    const merged = {
      ...current,
      ...patch,
      ...(isPlainObject(written) ? written : {}),
      id: current.id,
    };
    if (timestampToMs(merged.updatedAt) === null) merged.updatedAt = new Date();
    if (timestampToMs(merged.createdAt) === null) {
      merged.createdAt = current.createdAt ?? null;
    }
    return materializeCollection(merged);
  }

  /** Nº de colecciones del usuario (store opcional o `listCollections`). */
  async function countCollections(store, uid) {
    if (typeof store.countCollections === "function") {
      const count = await store.countCollections(uid);
      if (typeof count === "number" && Number.isFinite(count)) return count;
    }
    const response = await store.listCollections(uid, resolveListCollectionsQuery());
    return readDocs(response).length;
  }

  /**
   * Lista las colecciones (DB-117): `updatedAt` desc + id asc. Se
   * reordena en memoria para no depender de stores falsos.
   */
  async function list(uid) {
    try {
      const owner = requireUid(uid);
      await assertOwner(owner);
      const store = await resolveStore();
      const response = await store.listCollections(
        owner,
        resolveListCollectionsQuery(),
      );

      const collections = [];
      for (const doc of readDocs(response)) {
        if (doc === null || typeof doc !== "object") continue;
        try {
          collections.push(materializeCollection(doc));
        } catch {
          // Un doc corrupto no tumba el listado completo.
        }
      }
      collections.sort(compareUpdatedAtDesc);
      return okResult(collections);
    } catch (error) {
      return toResultError(error);
    }
  }

  /** Lee una colección por id (detalle de UI-14). */
  async function get(uid, collectionId) {
    try {
      const owner = requireUid(uid);
      const id = requireCollectionId(collectionId);
      await assertOwner(owner);
      const store = await resolveStore();
      const doc = await store.getCollection(owner, id);
      return okResult(doc ? materializeCollection(doc) : null);
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Crea una colección (REQ-206, DB-104). Valida DB-123 y el máximo
   * de 20 ANTES de escribir (AC-126: la 21.ª ⇒ `validation` sin
   * escritura). `itemIds` nace vacío; los ítems se añaden con
   * `addItem`.
   */
  async function create(uid, input) {
    try {
      const owner = requireUid(uid);
      await assertOwner(owner);
      const payload = buildCollectionCreatePayload(input);
      const store = await resolveStore();

      const existing = await countCollections(store, owner);
      if (existing >= MAX_COLLECTIONS_PER_USER) {
        throw inputError(
          `Máximo ${MAX_COLLECTIONS_PER_USER} colecciones por usuario. Elimina alguna antes de crear otra.`,
          [
            `Máximo ${MAX_COLLECTIONS_PER_USER} colecciones por usuario. Elimina alguna antes de crear otra.`,
          ],
        );
      }

      const id = newId();
      const data = {
        id,
        ...payload,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      const saved = await store.createCollection(owner, data);
      const merged = {
        ...data,
        ...(isPlainObject(saved) ? saved : {}),
      };
      if (typeof merged.id !== "string" || merged.id === "") merged.id = id;
      if (timestampToMs(merged.createdAt) === null) merged.createdAt = new Date();
      if (timestampToMs(merged.updatedAt) === null) merged.updatedAt = new Date();
      return okResult(materializeCollection(merged));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Edita `name`/`description` (REQ-206). Los `itemIds` NO se tocan
   * aquí: se gestionan con `addItem`/`removeItem`.
   */
  async function update(uid, collectionId, patch) {
    try {
      const owner = requireUid(uid);
      const id = requireCollectionId(collectionId);
      await assertOwner(owner);
      const store = await resolveStore();
      const current = await readCollection(store, owner, id);

      const payload = buildCollectionUpdatePayload(patch);
      const merged = {
        name: payload.name !== undefined ? payload.name : current.name,
        description:
          payload.description !== undefined ? payload.description : current.description,
        itemIds: current.itemIds,
      };
      const report = validateCollection(merged);
      if (!report.valid) throw inputError(report.errors.join(" "), report.errors);

      // Patch vacío: no-op sin escritura.
      if (Object.keys(payload).length === 0) return okResult(current);

      const data = { ...payload, updatedAt: stamp() };
      const saved = await store.updateCollection(owner, id, data);
      return okResult(mergeWrite(current, data, saved));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Borra SOLO la colección (REQ-208, AC-128): no toca `entries` ni
   * `catalog`.
   */
  async function remove(uid, collectionId) {
    try {
      const owner = requireUid(uid);
      const id = requireCollectionId(collectionId);
      await assertOwner(owner);
      const store = await resolveStore();
      await store.deleteCollection(owner, id);
      return okResult(true);
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Añade un `mediaId` de forma IDEMPOTENTE (API-13, AC-125):
   *  - ya presente ⇒ `ok` sin escritura (nunca duplica);
   *  - colección con 50 ítems ⇒ `validation` sin escritura;
   *  - si no, escritura de UNIÓN (solo `itemIds` + `updatedAt`).
   */
  async function addItem(uid, collectionId, mediaId) {
    try {
      const owner = requireUid(uid);
      const id = requireCollectionId(collectionId);
      const media = requireMediaId(mediaId);
      await assertOwner(owner);
      const store = await resolveStore();
      const current = await readCollection(store, owner, id);

      // AC-125: arrayUnion no duplica; reañadir es un no-op.
      if (current.itemIds.includes(media)) return okResult(current);

      if (current.itemIds.length >= MAX_COLLECTION_ITEMS) {
        throw inputError(
          `No se pueden guardar más de ${MAX_COLLECTION_ITEMS} ítems en una colección.`,
          [
            `No se pueden guardar más de ${MAX_COLLECTION_ITEMS} ítems en una colección.`,
          ],
        );
      }

      const nextIds = [...current.itemIds, media];
      const data = { itemIds: nextIds, updatedAt: stamp() };

      const saved =
        typeof store.addItem === "function"
          ? await store.addItem(owner, id, media)
          : await store.updateCollection(owner, id, data);

      const merged = {
        ...current,
        ...data,
        ...(isPlainObject(saved) ? saved : {}),
      };
      merged.id = current.id;
      if (!Array.isArray(merged.itemIds)) merged.itemIds = nextIds;
      if (timestampToMs(merged.updatedAt) === null) merged.updatedAt = new Date();
      return okResult(materializeCollection(merged));
    } catch (error) {
      return toResultError(error);
    }
  }

  /**
   * Quita un `mediaId` (REQ-207, AC-127): escribe SOLO `itemIds`
   * (+`updatedAt`), sin tocar `name`/`description`/`createdAt` ni la
   * entry de tracking del ítem. Quitar algo ausente es un no-op.
   */
  async function removeItem(uid, collectionId, mediaId) {
    try {
      const owner = requireUid(uid);
      const id = requireCollectionId(collectionId);
      const media = requireMediaId(mediaId);
      await assertOwner(owner);
      const store = await resolveStore();
      const current = await readCollection(store, owner, id);

      if (!current.itemIds.includes(media)) return okResult(current);

      const nextIds = current.itemIds.filter((item) => item !== media);
      const data = { itemIds: nextIds, updatedAt: stamp() };

      const saved =
        typeof store.removeItem === "function"
          ? await store.removeItem(owner, id, media)
          : await store.updateCollection(owner, id, data);

      const merged = {
        ...current,
        ...data,
        ...(isPlainObject(saved) ? saved : {}),
      };
      merged.id = current.id;
      merged.itemIds = nextIds;
      if (timestampToMs(merged.updatedAt) === null) merged.updatedAt = new Date();
      return okResult(materializeCollection(merged));
    } catch (error) {
      return toResultError(error);
    }
  }

  return {
    list,
    get,
    create,
    update,
    delete: remove,
    remove,
    addItem,
    removeItem,
  };
}

// -------------------------------------------------------------
// 9. Instancia por defecto (Firestore, carga perezosa)
// -------------------------------------------------------------

/**
 * SEC-01: `getUid` se cablea a la sesión real de Firebase. El import
 * es dinámico y ocurre solo al usar un método, así que este módulo
 * sigue siendo importable en Node sin red (REQ-C1); sin sesión (o en
 * Node) el guard responde `permission_denied` y no escribe.
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
 * @type {ReturnType<typeof createCollectionRepository>}
 */
export const collectionRepository = createCollectionRepository(
  createFirestoreCollectionStore,
  { getUid: getCurrentUid },
);

/** Atajos con la API plana del contrato (spec 03 §2). */
export const listCollections = (uid) => collectionRepository.list(uid);

export const getCollection = (uid, collectionId) =>
  collectionRepository.get(uid, collectionId);

export const createCollection = (uid, input) =>
  collectionRepository.create(uid, input);

export const updateCollection = (uid, collectionId, patch) =>
  collectionRepository.update(uid, collectionId, patch);

export const deleteCollection = (uid, collectionId) =>
  collectionRepository.delete(uid, collectionId);

export const addItem = (uid, collectionId, mediaId) =>
  collectionRepository.addItem(uid, collectionId, mediaId);

export const removeItem = (uid, collectionId, mediaId) =>
  collectionRepository.removeItem(uid, collectionId, mediaId);

export default collectionRepository;
