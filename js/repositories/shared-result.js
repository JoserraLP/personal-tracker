// =============================================================
// Helpers compartidos de `Result`, errores y cursor opaco
// (spec 00 §4.1 REQ-E1/E2/E3; spec 02 API-02, API-05; spec 03
// API-10..API-12).
//
// Este módulo es PURO: no importa Firebase ni toca la red, así que
// puede importarse en Node/vitest. Lo reutilizan
// `catalog-repository.js` y `tracking-repository.js` para no
// duplicar (DRY):
//
//   - `okResult` / `failResult`: forma única de `Result`.
//   - `inputError` / `notFoundError`: errores internos con `code`.
//   - `normalizeErrorCode` / `createResultErrorHelpers`: traducción
//     de códigos de Firestore a 00 §4.1, con tabla de mensajes por
//     dominio (catálogo vs. seguimiento) inyectada.
//   - `encodeBase64Url` / `decodeBase64Url` y el par
//     `encodeCursorPayload` / `decodeCursorPayload`: cursor OPACO
//     para la UI (API-02), sin exponer snapshots.
//
// Los repositorios siguen exportando estos símbolos para conservar
// su superficie pública.
// =============================================================

/** Códigos de error admitidos por `Result` (00 §4.1). */
export const RESULT_ERROR_CODES = Object.freeze([
  "not_found",
  "permission_denied",
  "validation",
  "unavailable",
  "unknown",
]);

/** Códigos de Firestore → códigos de `Result` (REQ-E2). */
export const FIREBASE_CODE_MAP = Object.freeze({
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

/** Versión del formato de cursor opaco (API-02). */
export const CURSOR_VERSION = 1;

/** Mensajes genéricos de reserva; cada dominio inyecta los suyos. */
export const DEFAULT_ERROR_MESSAGES = Object.freeze({
  not_found: "No se ha encontrado el recurso.",
  permission_denied: "No tienes permiso para acceder a este recurso.",
  validation: "Los datos no son válidos.",
  unavailable:
    "El recurso no está disponible en este momento. Vuelve a intentarlo en unos segundos.",
  unknown: "Ha ocurrido un error inesperado.",
});

// -------------------------------------------------------------
// Result y errores
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

/** Error de entrada (validación) con el formato de REQ-E3. */
export function inputError(message, errors = [message]) {
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
 * Crea los helpers de error de un dominio con su tabla de mensajes
 * en español (REQ-E2: `permission_denied` mantiene visible el aviso
 * de allowlist). Nunca lanzan.
 * @param {Record<string, string>} [messages]
 */
export function createResultErrorHelpers(messages = {}) {
  const table = Object.freeze({ ...DEFAULT_ERROR_MESSAGES, ...messages });

  /** Error de recurso ausente (sin escritura). */
  function notFoundError(message = table.not_found) {
    const error = new Error(message);
    error.code = "not-found";
    return error;
  }

  /**
   * Convierte un error en `{ ok:false, code, message, errors? }`
   * (REQ-E1, REQ-E2, REQ-E3). Nunca lanza.
   * @param {*} error
   * @returns {{ ok: false, code: string, message: string, errors?: string[] }}
   */
  function toResultError(error) {
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
        : table[code] ?? table.unknown;
    return failResult(code, message, { errors: rawErrors });
  }

  return Object.freeze({ notFoundError, toResultError, ERROR_MESSAGES: table });
}

// -------------------------------------------------------------
// Cursor opaco (API-02)
// -------------------------------------------------------------

export function encodeBase64Url(text) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64url");
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(token) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(token, "base64url").toString("utf8");
  }
  const padded = token.padEnd(token.length + ((4 - (token.length % 4)) % 4), "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Serializa un payload como cursor base64url opaco. */
export function encodeCursorPayload(payload) {
  return encodeBase64Url(JSON.stringify(payload));
}

/**
 * Decodifica un cursor opaco: valida forma (base64url + JSON) y
 * lanza `validation` con `message` si está corrupto (nunca se confía
 * en la UI). La validación semántica queda en cada repositorio.
 * @param {string} token
 * @param {string} [message]
 * @returns {*}
 */
export function decodeCursorPayload(token, message = "El cursor no es válido.") {
  const invalid = () => inputError(message, [message]);
  if (typeof token !== "string" || token.trim() === "") throw invalid();
  const trimmed = token.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) throw invalid();
  try {
    return JSON.parse(decodeBase64Url(trimmed));
  } catch {
    throw invalid();
  }
}
