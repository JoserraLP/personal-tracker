// =============================================================
// Servicio de recomendaciones (spec 05 REQ-401..REQ-408,
// ALG-01..ALG-08; AC-140..AC-155; spec 00 REQ-E1/E2, REQ-C1;
// spec 01 DB-101/DB-103/DB-116; spec 02 API-02/API-05; SEC-01).
//
// Todo el motor es PURO y determinista: no importa Firebase, no toca
// red ni DOM y se puede importar en Node/vitest directamente (REQ-401,
// REQ-C1). Las lecturas las hacen los repositorios ya existentes,
// inyectados o los de por defecto:
//
//   1) entries del usuario  -> tracking.listEntries(uid, {pageSize})
//      con `pageSize = MAX_PAGE_SIZE` (48, cap del contrato DB-114):
//      es la ÚNICA query que devuelve a la vez `score >= 8` y
//      `COMPLETED` sin score, así que cubre la afinidad plena y la
//      débil (REQ-402) en 1 lectura (ALG-08, AC-153).
//      Si la página viene TRUNCADA (`cursor` no nulo ⇒ más de 48
//      entries), se hace UNA lectura acotada extra con
//      `listByMinScore(uid, 8)` (DB-116, sin paginación) para que la
//      afinidad PLENA nunca pierda entries fuera de la página. Nunca
//      es N+1: como máximo +1 lectura y solo en ese caso; el
//      escenario de AC-153 (30 entries) sigue usando 2 lecturas.
//      La afinidad débil de entries fuera de la primera página no se
//      puede cubrir con el contrato actual (no existe query no
//      paginada de `COMPLETED` sin score) sin superar el presupuesto
//      de ALG-08/AC-153; se documenta como límite conocido.
//   2) candidatos           -> catalog.listSeeded()  (1 lectura).
//   Total: 2 lecturas (3 solo si hay >48 entries), sin N+1
//   (ALG-08, AC-153).
//
// Contrato (spec 05 §2):
//   type Recommendation = {
//     item: MediaItem;
//     scoreMatch: number;            // entero 0-100
//     reason: string;                // "Porque te gustó X" | "Destacados del catálogo"
//     reasonSourceId: string | null; // mediaId de la entry afinada (null en fallback)
//   };
//   interface RecommendationService {
//     getRecommendations(uid, opts?: {limit?: number})
//       : Promise<Result<Recommendation[]>>;
//   }
//   // Puro y testeable SIN I/O:
//   recommend(entries, catalog, limit): Recommendation[]
//
// Reglas implementadas:
//   - Afinidad (REQ-402, ALG-02): entry con `score >= 8` aporta
//     genres +2 y creator +3; entry `COMPLETED` sin score aporta la
//     mitad (genres +1, creator +1.5). Cualquier otro caso no aporta.
//   - Señales (REQ-403): los géneros y el `creator` de la entry se
//     toman del `catalog` (DB-101); si el ítem no está en el catálogo
//     cargado se usan `entry.genres`/`entry.creator` si existieran.
//     La comparación normaliza el texto con `normalizeTitle` (DB-121),
//     igual que las búsquedas, para que mayúsculas/acentos no importen.
//   - Exclusión (REQ-404, ALG-03): nunca se recomienda un `mediaId`
//     con entry propia (cualquier status), ni siquiera la entry que
//     generó la afinidad. Los candidatos duplicados se colapsan.
//   - Scoring (ALG-04): `match = Σ genreAffinity[g] + creatorAffinity[c]`
//     y `scoreMatch = clamp(round(100 * match / maxPossible), 0, 100)`,
//     con `maxPossible = nº de géneros del candidato × máximo de
//     genreAffinity + (candidato con creator ? máximo de
//     creatorAffinity : 0)`. Candidato con `maxPossible = 0` o
//     `match = 0` queda excluido (ALG-07). `scoreMatch` es SIEMPRE un
//     entero en 0..100 (AC-154).
//   - Orden (REQ-405, ALG-05): `match` desc → `titleNormalized` asc →
//     `mediaId` asc. Comparador total: misma fixture ⇒ misma lista
//     byte a byte (AC-145/AC-146/AC-151).
//   - Explicación (REQ-406, ALG-06): si la afinidad del creator del
//     candidato supera a la mejor afinidad de sus géneros, la razón
//     cita la entry de origen que más aportó por creator; si no, la
//     que más aportó por el mejor género. `reason` usa el título
//     ORIGINAL del ítem de origen (AC-147).
//   - Fallback (REQ-408, ALG-07): si ningún candidato puntúa, se
//     devuelven los candidatos mejor valorados por `avgRating` desc
//     (empates: título normalizado asc, mediaId asc) con
//     `reason: "Destacados del catálogo"` y `reasonSourceId: null`
//     (AC-148/AC-152). `scoreMatch` del fallback = round(avgRating×10)
//     acotado a 0..100 (0 si no hay valoración), para cumplir AC-154.
//   - Límite (REQ-407, AC-150): por defecto y máximo 20.
//   - Errores (REQ-E1/E2, AC-155): `getRecommendations` nunca lanza;
//     devuelve `Result`. Sin sesión ⇒ `permission_denied` con mensaje
//     en español; un error/Result de los repositorios (p. ej.
//     `permission_denied` de SEC-01/API-05) se propaga conservando su
//     mensaje en español. Los códigos propios se emiten SIEMPRE con
//     el formato del contrato (`permission_denied`, guion bajo) y
//     cualquier variante de Firestore (`permission-denied`,
//     `unauthenticated`) se normaliza al mismo código.
// =============================================================

import { normalizeTitle } from "../catalog.js";
import {
  catalogRepository,
  normalizeErrorCode,
} from "../repositories/catalog-repository.js";
import {
  MAX_PAGE_SIZE as MAX_ENTRY_PAGE_SIZE,
  trackingRepository,
} from "../repositories/tracking-repository.js";

// -------------------------------------------------------------
// 1. Constantes del contrato (REQ-402/407, ALG-01/02/04/07)
// -------------------------------------------------------------

/** Umbral de afinidad plena (REQ-402, ALG-01). */
export const AFFINITY_THRESHOLD = 8;

/** Nº máximo y por defecto de recomendaciones (REQ-407, AC-150). */
export const RECOMMENDATION_LIMIT = 20;

/** Alias explícito del valor por defecto (REQ-407). */
export const DEFAULT_RECOMMENDATION_LIMIT = RECOMMENDATION_LIMIT;

/** Peso de un género en la afinidad (REQ-403, ALG-02). */
export const GENRE_AFFINITY_WEIGHT = 2;

/** Peso de un creator en la afinidad (REQ-403, ALG-02). */
export const CREATOR_AFFINITY_WEIGHT = 3;

/** Factor de afinidad débil para `COMPLETED` sin score (REQ-402). */
export const WEAK_AFFINITY_FACTOR = 0.5;

/** Razón del fallback por `avgRating` (REQ-408, ALG-06). */
export const FALLBACK_REASON = "Destacados del catálogo";

/** Prefijo literal de la razón por afinidad (REQ-406, AC-147). */
export const REASON_PREFIX = "Porque te gustó";

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
  not_found: "No se han encontrado datos para generar recomendaciones.",
  permission_denied:
    "No tienes permiso para generar recomendaciones. Comprueba que has iniciado sesión con una cuenta autorizada.",
  validation: "Los datos para generar recomendaciones no son válidos.",
  unavailable:
    "Las recomendaciones no están disponibles en este momento. Vuelve a intentarlo en unos segundos.",
  unknown: "Ha ocurrido un error inesperado al generar recomendaciones.",
});

/**
 * Variantes de código (Firestore/SDK) que deben normalizarse a los
 * códigos del contrato (spec 00 §4.1). Se resuelven ANTES de delegar
 * en `normalizeErrorCode` para que un `permission-denied` con guion
 * nunca pueda degradar a `unknown` (AC-155).
 */
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

/**
 * Código de error normalizado al contrato (§4.1). Admite los códigos
 * ya normalizados (guion bajo), las variantes de Firestore (guion) y
 * cualquier otro valor por medio de `normalizeErrorCode`.
 * @param {*} code
 * @returns {string}
 */
export function resolveResultCode(code) {
  if (typeof code !== "string" || code.trim() === "") return "unknown";
  const raw = code.trim();
  if (RESULT_ERROR_CODES.includes(raw)) return raw;
  const lowered = raw.toLowerCase();
  // "permission_denied" ya es el código del contrato; las variantes
  // con guion o en mayúsculas ("permission-denied", "PERMISSION_DENIED")
  // también se resuelven aquí para no degradar a `unknown` (AC-155).
  if (RESULT_ERROR_CODES.includes(lowered)) return lowered;
  return ERROR_CODE_ALIASES[lowered] ?? normalizeErrorCode(raw);
}

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
 * Convierte un `Result` fallido de un repositorio en el `Result` del
 * servicio conservando su mensaje en español (AC-155) y normalizando
 * el código (REQ-E2).
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

/** Clave de comparación de una señal (DB-121: sin acentos ni mayúsculas). */
function signalKey(value) {
  return normalizeTitle(value);
}

/** Id de un `MediaItem`/`Entry`, o `null`. */
function mediaIdOf(item) {
  return nonEmptyText(item?.id) ?? nonEmptyText(item?.mediaId) ?? null;
}

/** Título normalizado de un ítem, calculado si falta (DB-101). */
function normalizedTitleOf(item) {
  return nonEmptyText(item?.titleNormalized) ?? normalizeTitle(item?.title);
}

/** Índice `mediaId -> MediaItem` del catálogo cargado (sin duplicados). */
function indexCatalog(catalog) {
  const index = new Map();
  for (const item of catalog) {
    if (!isPlainObject(item)) continue;
    const id = mediaIdOf(item);
    if (id === null || index.has(id)) continue;
    index.set(id, item);
  }
  return index;
}

/** Géneros únicos del candidato/origen, como claves normalizadas. */
function genreKeysOf(genres) {
  const keys = [];
  const seen = new Set();
  if (!Array.isArray(genres)) return keys;
  for (const genre of genres) {
    const key = signalKey(genre);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** Lista primaria si tiene elementos; si no, la secundaria. */
function firstNonEmptyList(primary, secondary) {
  if (Array.isArray(primary) && primary.length > 0) return primary;
  return Array.isArray(secondary) ? secondary : [];
}

/** Creator primario si es texto; si no, el secundario. */
function firstText(primary, secondary) {
  return nonEmptyText(primary) ?? nonEmptyText(secondary);
}

/** Comparador de aportaciones a una señal (ALG-06 determinista). */
function compareContributors(a, b) {
  if (a.weight !== b.weight) return b.weight - a.weight;
  if (a.titleNormalized !== b.titleNormalized) {
    return a.titleNormalized < b.titleNormalized ? -1 : 1;
  }
  if (a.mediaId !== b.mediaId) return a.mediaId < b.mediaId ? -1 : 1;
  return 0;
}

/** Mejor aportación de una señal, o `null` (ALG-06). */
function topContributor(contributors) {
  if (!contributors || contributors.size === 0) return null;
  let best = null;
  for (const contributor of contributors.values()) {
    if (best === null || compareContributors(contributor, best) < 0) best = contributor;
  }
  return best;
}

/** Valor máximo de un mapa de afinidad (0 si está vacío). */
function maxAffinity(map) {
  let max = 0;
  for (const value of map.values()) {
    if (value > max) max = value;
  }
  return max;
}

/** Pesos de afinidad de una entry, o `null` si no aporta (REQ-402). */
export function affinityWeightsFor(entry) {
  const score =
    typeof entry?.score === "number" && Number.isFinite(entry.score) ? entry.score : null;
  if (score !== null && score >= AFFINITY_THRESHOLD) {
    return { genre: GENRE_AFFINITY_WEIGHT, creator: CREATOR_AFFINITY_WEIGHT };
  }
  if (score === null && entry?.status === "COMPLETED") {
    return {
      genre: GENRE_AFFINITY_WEIGHT * WEAK_AFFINITY_FACTOR,
      creator: CREATOR_AFFINITY_WEIGHT * WEAK_AFFINITY_FACTOR,
    };
  }
  return null;
}

/** Ítem de origen (título original) de una entry afinada (AC-147). */
function sourceForEntry(entry, itemById) {
  const mediaId = mediaIdOf(entry);
  if (mediaId === null) return null;
  const item = itemById.get(mediaId) ?? null;
  const title = firstText(item?.title, entry?.title) ?? mediaId;
  return { mediaId, title, titleNormalized: normalizeTitle(title) };
}

/** Suma una aportación a una señal y registra su entry de origen. */
function addContribution(affinity, contributorsByKey, key, source, weight) {
  affinity.set(key, (affinity.get(key) ?? 0) + weight);
  let contributors = contributorsByKey.get(key);
  if (!contributors) {
    contributors = new Map();
    contributorsByKey.set(key, contributors);
  }
  const existing = contributors.get(source.mediaId);
  if (existing) {
    existing.weight += weight;
    return;
  }
  contributors.set(source.mediaId, {
    mediaId: source.mediaId,
    title: source.title,
    titleNormalized: source.titleNormalized,
    weight,
  });
}

/**
 * Construye el modelo de afinidad (REQ-402/REQ-403, ALG-02).
 *
 * @param {ReadonlyArray<object>} [entries] entries del usuario (DB-103)
 * @param {ReadonlyArray<object>} [catalog] ítems ya cargados (DB-101)
 * @returns {{
 *   genreAffinity: Map<string, number>,
 *   creatorAffinity: Map<string, number>,
 *   genreContributors: Map<string, Map<string, object>>,
 *   creatorContributors: Map<string, Map<string, object>>
 * }}
 */
export function buildAffinity(entries = [], catalog = []) {
  const entryList = Array.isArray(entries) ? entries : [];
  const itemList = Array.isArray(catalog) ? catalog : [];
  const itemById = indexCatalog(itemList);

  const model = {
    genreAffinity: new Map(),
    creatorAffinity: new Map(),
    genreContributors: new Map(),
    creatorContributors: new Map(),
  };

  for (const entry of entryList) {
    if (!isPlainObject(entry)) continue;
    const weights = affinityWeightsFor(entry);
    if (weights === null) continue;
    const source = sourceForEntry(entry, itemById);
    if (source === null) continue;

    const item = itemById.get(source.mediaId) ?? null;
    const genres = firstNonEmptyList(item?.genres, entry.genres);
    const creator = firstText(item?.creator, entry.creator);

    for (const key of genreKeysOf(genres)) {
      addContribution(
        model.genreAffinity,
        model.genreContributors,
        key,
        source,
        weights.genre,
      );
    }
    const creatorKey = creator === null ? "" : signalKey(creator);
    if (creatorKey !== "") {
      addContribution(
        model.creatorAffinity,
        model.creatorContributors,
        creatorKey,
        source,
        weights.creator,
      );
    }
  }

  return model;
}

/**
 * Valida y acota el límite de resultados (REQ-407, AC-150): entero ≥1,
 * como máximo 20.
 * @param {*} [limit]
 * @returns {number}
 */
export function resolveRecommendationLimit(limit) {
  if (limit === undefined || limit === null) return RECOMMENDATION_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    throw inputError(
      "El límite de recomendaciones debe ser un número entero mayor o igual que 1.",
    );
  }
  return Math.min(limit, RECOMMENDATION_LIMIT);
}

/** Mejor señal de género del candidato (ALG-04/ALG-06). */
function bestGenreSignal(signals) {
  let best = null;
  for (const signal of signals) {
    if (signal.value <= 0) continue;
    if (
      best === null ||
      signal.value > best.value ||
      (signal.value === best.value && signal.key < best.key)
    ) {
      best = signal;
    }
  }
  return best;
}

/**
 * Evalúa un candidato (ALG-04/ALG-06). Devuelve `null` si queda
 * excluido (`match = 0` o `maxPossible = 0`, ALG-07).
 */
function evaluateCandidate(item, context) {
  const { model, maxGenreAffinity, maxCreatorAffinity } = context;
  const genreKeys = genreKeysOf(item?.genres);
  const creatorText = nonEmptyText(item?.creator);
  const creatorKey = creatorText === null ? "" : signalKey(creatorText);

  const signals = genreKeys.map((key) => ({
    key,
    value: model.genreAffinity.get(key) ?? 0,
  }));
  const genreMatch = signals.reduce((total, signal) => total + signal.value, 0);
  const creatorValue = creatorKey === "" ? 0 : (model.creatorAffinity.get(creatorKey) ?? 0);
  const match = genreMatch + creatorValue;

  const maxPossible =
    signals.length * maxGenreAffinity + (creatorKey === "" ? 0 : maxCreatorAffinity);
  if (match <= 0 || maxPossible <= 0) return null;

  // AC-154: entero garantizado, nunca fuera de 0..100.
  const scoreMatch = Math.min(
    100,
    Math.max(0, Math.round((100 * match) / maxPossible)),
  );

  const bestGenre = bestGenreSignal(signals);
  let source = null;
  if (creatorValue > 0 && creatorValue > (bestGenre?.value ?? 0)) {
    source = topContributor(model.creatorContributors.get(creatorKey));
  } else if (bestGenre !== null) {
    source = topContributor(model.genreContributors.get(bestGenre.key));
  }

  return {
    scoreMatch,
    reason: source === null ? FALLBACK_REASON : `${REASON_PREFIX} ${source.title}`,
    reasonSourceId: source === null ? null : source.mediaId,
    match,
  };
}

/** Comparador del orden de afinidad (ALG-05): match desc → título → id. */
function compareScored(a, b) {
  if (a.match !== b.match) return b.match - a.match;
  if (a.titleNormalized !== b.titleNormalized) {
    return a.titleNormalized < b.titleNormalized ? -1 : 1;
  }
  if (a.mediaId !== b.mediaId) return a.mediaId < b.mediaId ? -1 : 1;
  return 0;
}

/** Valoración numérica válida de un ítem, o `null` (DB-101). */
function numericRating(item) {
  const value = item?.avgRating;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `scoreMatch` del fallback a partir de `avgRating` (AC-154). */
function ratingScore(rating) {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return 0;
  return Math.min(100, Math.max(0, Math.round(rating * 10)));
}

/** Comparador del fallback (REQ-408): avgRating desc → título → id. */
function compareFallback(a, b) {
  const ratingA = a.rating === null ? -1 : a.rating;
  const ratingB = b.rating === null ? -1 : b.rating;
  if (ratingA !== ratingB) return ratingB - ratingA;
  if (a.titleNormalized !== b.titleNormalized) {
    return a.titleNormalized < b.titleNormalized ? -1 : 1;
  }
  if (a.mediaId !== b.mediaId) return a.mediaId < b.mediaId ? -1 : 1;
  return 0;
}

/** Normaliza los argumentos de `recommend` (acepta también un objeto). */
function normalizeRecommendArguments(entries, catalog, limit) {
  let entryList = entries;
  let catalogList = catalog;
  let rawLimit = limit;

  if (
    !Array.isArray(entries) &&
    isPlainObject(entries) &&
    (Array.isArray(entries.entries) || Array.isArray(entries.catalog))
  ) {
    entryList = entries.entries;
    catalogList = entries.catalog;
    rawLimit = entries.limit === undefined ? limit : entries.limit;
  }

  if (!Array.isArray(entryList)) {
    throw inputError("Las entries de recomendación deben ser un array.");
  }
  if (!Array.isArray(catalogList)) {
    throw inputError("El catálogo de recomendación debe ser un array.");
  }
  return {
    entries: entryList,
    catalog: catalogList,
    limit: resolveRecommendationLimit(rawLimit),
  };
}

/**
 * Motor puro de recomendaciones (ALG-01..ALG-07). Sin I/O y sin
 * mutar las entradas; misma fixture ⇒ mismo resultado byte a byte
 * (REQ-405, AC-151). Lanza `validation` solo si los argumentos no son
 * arrays válidos o el límite no es un entero ≥1.
 *
 * @param {ReadonlyArray<object>|{entries: object[], catalog: object[], limit?: number}} entries
 * @param {ReadonlyArray<object>} [catalog]
 * @param {number} [limit] por defecto 20, máximo 20 (REQ-407)
 * @returns {Array<{item: object, scoreMatch: number, reason: string, reasonSourceId: string|null}>}
 */
export function recommend(entries, catalog, limit) {
  const args = normalizeRecommendArguments(entries, catalog, limit);
  const itemById = indexCatalog(args.catalog);
  const model = buildAffinity(args.entries, args.catalog);
  const context = {
    model,
    maxGenreAffinity: maxAffinity(model.genreAffinity),
    maxCreatorAffinity: maxAffinity(model.creatorAffinity),
  };

  // ALG-03 / REQ-404: cualquier mediaId con entry propia queda fuera.
  const excluded = new Set();
  for (const entry of args.entries) {
    const id = mediaIdOf(entry);
    if (id !== null) excluded.add(id);
  }

  const candidates = [];
  const seen = new Set();
  for (const item of args.catalog) {
    if (!isPlainObject(item)) continue;
    const id = mediaIdOf(item);
    if (id === null || seen.has(id) || excluded.has(id)) continue;
    seen.add(id);
    candidates.push(item);
  }

  // ALG-04/ALG-07: solo puntúan los candidatos con match > 0.
  const scored = [];
  for (const item of candidates) {
    const evaluated = evaluateCandidate(item, context);
    if (evaluated === null) continue;
    scored.push({
      item,
      scoreMatch: evaluated.scoreMatch,
      reason: evaluated.reason,
      reasonSourceId: evaluated.reasonSourceId,
      match: evaluated.match,
      titleNormalized: normalizedTitleOf(item),
      mediaId: mediaIdOf(item),
    });
  }

  if (scored.length > 0) {
    scored.sort(compareScored);
    return scored.slice(0, args.limit).map((entry) => ({
      item: entry.item,
      scoreMatch: entry.scoreMatch,
      reason: entry.reason,
      reasonSourceId: entry.reasonSourceId,
    }));
  }

  // REQ-408 / ALG-07: fallback por avgRating (AC-148/AC-152).
  return candidates
    .map((item) => ({
      item,
      rating: numericRating(item),
      titleNormalized: normalizedTitleOf(item),
      mediaId: mediaIdOf(item),
    }))
    .sort(compareFallback)
    .slice(0, args.limit)
    .map((entry) => ({
      item: entry.item,
      scoreMatch: ratingScore(entry.rating),
      reason: FALLBACK_REASON,
      reasonSourceId: null,
    }));
}

// -------------------------------------------------------------
// 4. Servicio con I/O mínimo (ALG-08, AC-153, AC-155)
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

/**
 * Valida el uid (SEC-01). Sin sesión ⇒ `permission_denied` con
 * mensaje en español (AC-155); un uid con `/` ⇒ `validation`.
 * @param {*} uid
 * @returns {string}
 */
function requireSessionUid(uid) {
  if (typeof uid !== "string" || uid.trim() === "") {
    const error = new Error(
      "No hay una sesión autenticada: inicia sesión para recibir recomendaciones.",
    );
    // SIEMPRE el código del contrato (guion bajo, spec 00 §4.1): un
    // "permission-denied" con guion podría degradar a `unknown` según
    // la tabla de normalización (AC-155).
    error.code = "permission_denied";
    throw error;
  }
  const value = uid.trim();
  if (value.includes("/")) {
    throw inputError(`uid inválido: "${uid}".`);
  }
  return value;
}

/** Normaliza las dependencias inyectadas (posicional o por nombre). */
function normalizeServiceOptions(deps, maybeCatalogRepository) {
  if (maybeCatalogRepository !== undefined && maybeCatalogRepository !== null) {
    return {
      trackingRepository: deps ?? null,
      catalogRepository: maybeCatalogRepository,
      readEntries: null,
      readCandidates: null,
    };
  }
  if (!isPlainObject(deps)) {
    return {
      trackingRepository: null,
      catalogRepository: null,
      readEntries: null,
      readCandidates: null,
    };
  }
  return {
    trackingRepository:
      deps.trackingRepository ?? deps.tracking ?? deps.entriesRepository ?? null,
    catalogRepository: deps.catalogRepository ?? deps.catalog ?? deps.catalogRepo ?? null,
    readEntries: typeof deps.readEntries === "function" ? deps.readEntries : null,
    readCandidates: typeof deps.readCandidates === "function" ? deps.readCandidates : null,
  };
}

/**
 * Indica si una respuesta de `listEntries` está TRUNCADA (hay más
 * entries de las devueltas). El contrato devuelve `cursor: null` al
 * terminar (DB-114); los stores/fakes simples sin cursor se consideran
 * completos.
 * @param {*} response
 * @returns {boolean}
 */
function isTruncatedPage(response) {
  const result = asResult(response);
  if (!result.ok) return false;
  const value = result.value;
  if (!isPlainObject(value)) return false;
  if (value.hasMore === true) return true;
  return (
    value.cursor !== undefined && value.cursor !== null && value.cursor !== ""
  );
}

/**
 * Une la página de entries con la lectura acotada de `listByMinScore`,
 * sin duplicar `mediaId`. La página va primero (incluye la afinidad
 * débil); la segunda lectura solo añade entries que faltaban.
 * @param {ReadonlyArray<object>} pageEntries
 * @param {ReadonlyArray<object>} extraEntries
 * @returns {object[]}
 */
function mergeEntrySets(pageEntries, extraEntries) {
  const merged = [];
  const seen = new Set();
  for (const list of [pageEntries, extraEntries]) {
    for (const entry of list) {
      if (!isPlainObject(entry)) continue;
      const mediaId = mediaIdOf(entry);
      if (mediaId !== null) {
        if (seen.has(mediaId)) continue;
        seen.add(mediaId);
      }
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * Lectura de entries con cobertura máxima dentro del presupuesto
 * (ALG-08, REQ-402, AC-153):
 *
 *   1. `listEntries` con `pageSize = MAX_PAGE_SIZE` (48): la única
 *      query que trae a la vez `score >= 8` y `COMPLETED` sin score.
 *   2. SOLO si la página viene truncada (>48 entries), UNA lectura
 *      acotada extra con `listByMinScore(uid, 8)` (DB-116, sin
 *      paginación) para que la afinidad PLENA no pierda entries fuera
 *      de la página. No es N+1: como máximo +1 y solo en ese caso; el
 *      escenario de AC-153 (30 entries) sigue en 2 lecturas totales.
 *
 * La afinidad débil fuera de la primera página es un límite conocido
 * del contrato (no hay query no paginada de `COMPLETED` sin score) y
 * no se puede cubrir sin superar ALG-08/AC-153.
 *
 * Devuelve el `Result` de la primera lectura (para propagar errores
 * con su mensaje en español, AC-155) y las entries ya fusionadas.
 *
 * @returns {Promise<{result: object, entries: object[], truncated: boolean}>}
 */
async function readEntries(uid, tracking, options) {
  if (options.readEntries) {
    const result = asResult(await options.readEntries(uid));
    return {
      result,
      entries: result.ok ? pageItems(result.value) : [],
      truncated: false,
    };
  }

  if (tracking && typeof tracking.listEntries === "function") {
    const response = await tracking.listEntries(uid, { pageSize: MAX_ENTRY_PAGE_SIZE });
    const result = asResult(response);
    if (!result.ok) return { result, entries: [], truncated: false };

    let entries = pageItems(result.value);
    const truncated = isTruncatedPage(response);
    if (truncated && typeof tracking.listByMinScore === "function") {
      // Lectura acotada de refuerzo: completa la afinidad PLENA. Si
      // falla, se conserva la página ya leída (nunca rompe el servicio
      // por un refuerzo best-effort).
      try {
        const supplement = asResult(await tracking.listByMinScore(uid, AFFINITY_THRESHOLD));
        if (supplement.ok) entries = mergeEntrySets(entries, pageItems(supplement.value));
      } catch {
        // best-effort: la página de 48 sigue siendo válida.
      }
    }
    return { result, entries, truncated };
  }

  if (tracking && typeof tracking.listByMinScore === "function") {
    const result = asResult(await tracking.listByMinScore(uid, AFFINITY_THRESHOLD));
    return {
      result,
      entries: result.ok ? pageItems(result.value) : [],
      truncated: false,
    };
  }
  throw inputError("El repositorio de seguimiento no permite leer las entries.");
}

/** UNA lectura de candidatos (ALG-08): seed del catálogo (REQ-104). */
async function readCandidates(catalog, options) {
  if (options.readCandidates) return options.readCandidates();
  if (catalog && typeof catalog.listSeeded === "function") {
    return catalog.listSeeded();
  }
  if (catalog && typeof catalog.listCandidates === "function") {
    return catalog.listCandidates();
  }
  throw inputError("El repositorio del catálogo no permite leer los candidatos.");
}

/**
 * Crea el servicio de recomendaciones. Todas las lecturas se delegan
 * en los repositorios inyectados (o en los de por defecto), así que
 * los tests pueden contar lecturas sin red (AC-153).
 *
 * @param {object|object} [deps] `{trackingRepository, catalogRepository}`
 *        o `(trackingRepository, catalogRepository)` en forma posicional.
 * @param {object} [maybeCatalogRepository]
 * @returns {{getRecommendations: Function}}
 */
export function createRecommendationService(deps, maybeCatalogRepository) {
  const options = normalizeServiceOptions(deps, maybeCatalogRepository);

  async function getRecommendations(uid, opts) {
    try {
      const owner = requireSessionUid(uid);

      if (opts !== undefined && opts !== null && !isPlainObject(opts)) {
        throw inputError("Las opciones de recomendaciones deben ser un objeto.");
      }
      const limit = resolveRecommendationLimit(opts?.limit);

      const tracking = options.trackingRepository ?? trackingRepository;
      const catalog = options.catalogRepository ?? catalogRepository;

      // Lectura 1: entries (ALG-08) + posible lectura acotada si la
      // página de 48 viene truncada (ver readEntries).
      const entriesRead = await readEntries(owner, tracking, options);
      if (!entriesRead.result.ok) return fromFailedResult(entriesRead.result);

      // Lectura 2: candidatos (ALG-08).
      const candidatesResult = asResult(await readCandidates(catalog, options));
      if (!candidatesResult.ok) return fromFailedResult(candidatesResult);

      return okResult(
        recommend(entriesRead.entries, pageItems(candidatesResult.value), limit),
      );
    } catch (error) {
      return toResultError(error);
    }
  }

  return { getRecommendations };
}

// -------------------------------------------------------------
// 5. Instancia por defecto (repositorios ya existentes, sin red extra)
// -------------------------------------------------------------

/** Servicio por defecto sobre los repositorios de tracking y catálogo. */
export const recommendationService = createRecommendationService({
  trackingRepository,
  catalogRepository,
});

/** Atajo con la API plana del contrato (spec 05 §2). */
export const getRecommendations = (uid, opts) =>
  recommendationService.getRecommendations(uid, opts);

export default recommendationService;
