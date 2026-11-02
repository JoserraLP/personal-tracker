// =============================================================
// Catálogo unificado de ocio (spec 002).
//
// Dos partes en un único módulo:
//
//  1) PARTE PURA (importable en Node/vitest SIN red y SIN firebase):
//     constantes de tipos y estados, mapa tipo→colección, validación
//     de campos (DB-001..DB-006 / REQ-014), cálculo de «siguiente
//     episodio» (DB-003 / DB-006), helpers de sesiones embebidas
//     (DB-007 / D-004) y comparadores de filtro/orden (REQ-012 / Q-003).
//
//  2) PARTE STORE (Firestore): CRUD de ítems y de sesiones.
//     Las funciones de store hacen `await import("./firebase.js")`
//     DENTRO de cada función (nunca import estático) para que este
//     fichero se pueda importar en Node/vitest sin red: el módulo de
//     Firebase (CDN) solo se carga cuando se usa el store.
//
// Colecciones (REQ-003, D-006):
//   users/{uid}/movies | series | games | books | anime
// Spec: spec.md (raíz) — REQ-001..003, REQ-008..014,
//       DB-001..DB-007, AC-002, AC-005..008, AC-010, AC-016, AC-017,
//       D-003, D-004, Q-003.
// =============================================================

// -------------------------------------------------------------
// 1. Constantes (REQ-001, REQ-002, REQ-003, Q-003)
// -------------------------------------------------------------

/** Tipos de medio admitidos (REQ-001). */
export const MEDIA_TYPES = Object.freeze(["movie", "series", "game", "book", "anime"]);

/** Estados posibles de un ítem (REQ-002). */
export const ITEM_STATUSES = Object.freeze([
  "pending",
  "in_progress",
  "completed",
  "paused",
  "abandoned",
]);

/** Tipo de medio → nombre de la colección Firestore (REQ-003). */
export const TYPE_TO_COLLECTION = Object.freeze({
  movie: "movies",
  series: "series",
  game: "games",
  book: "books",
  anime: "anime",
});

/** Etiquetas en español para las pestañas (UI-001). */
export const MEDIA_TYPE_LABELS = Object.freeze({
  movie: "Películas",
  series: "Series",
  game: "Juegos",
  book: "Libros",
  anime: "Anime",
});

/** Etiquetas en español para los estados (UI-005). */
export const STATUS_LABELS = Object.freeze({
  pending: "Pendiente",
  in_progress: "En curso",
  completed: "Completado",
  paused: "Pausado",
  abandoned: "Abandonado",
});

/** Umbral de paginación por cursor (Q-003). */
export const DEFAULT_PAGE_SIZE = 100;

/** Orden por defecto del listado: updatedAt desc (Q-003). */
export const DEFAULT_SORT = "updatedAt";

/** Campos por los que se puede ordenar (REQ-012). */
export const SORT_FIELDS = Object.freeze(["updatedAt", "title", "rating", "year", "status"]);

/** Opciones de orden para el FilterBar (UI-005). */
export const SORT_OPTIONS = Object.freeze([
  { id: "updatedAt", label: "Actualizado", direction: "desc" },
  { id: "title", label: "Título", direction: "asc" },
  { id: "rating", label: "Valoración", direction: "desc" },
  { id: "year", label: "Año", direction: "desc" },
  { id: "status", label: "Estado", direction: "asc" },
]);

// Límites de los campos (DB-001..DB-006).
const LIMITS = Object.freeze({
  TITLE_MAX: 200,
  YEAR_MIN: 1888,
  YEAR_MAX: 2100,
  SYNOPSIS_MAX: 2000,
  REVIEW_MAX: 500,
  NOTE_MAX: 500,
  GENRES_MAX: 10,
  RATING_MIN: 1,
  RATING_MAX: 10,
  COMPLETION_MIN: 0,
  COMPLETION_MAX: 100,
  EPISODE_MIN: 1,
});

// -------------------------------------------------------------
// 2. Utilidades internas
// -------------------------------------------------------------

/** ¿Es un tipo de medio válido? (REQ-001) */
export function isMediaType(mediaType) {
  return MEDIA_TYPES.includes(mediaType);
}

/** ¿Es un estado válido? (REQ-002) */
export function isStatus(status) {
  return ITEM_STATUSES.includes(status);
}

/**
 * Nombre de la colección de un tipo de medio (REQ-003).
 * Lanza Error si el tipo no es válido.
 */
export function collectionNameFor(mediaType) {
  const name = TYPE_TO_COLLECTION[mediaType];
  if (!name) {
    throw new Error(
      `Tipo de medio no válido: "${mediaType}". Valores permitidos: ${MEDIA_TYPES.join(", ")}.`,
    );
  }
  return name;
}

/**
 * Ruta de la colección dentro del usuario (REQ-003):
 * "users/{uid}/movies" | "series" | "games" | "books" | "anime".
 */
export function collectionPath(uid, mediaType) {
  return `users/${uid}/${collectionNameFor(mediaType)}`;
}

function toText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return String(value);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTextList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry : String(entry)))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const provider = typeof source.provider === "string" ? source.provider.trim() : "";
  if (!provider) return null;
  const externalId = typeof source.externalId === "string" ? source.externalId.trim() : "";
  return externalId ? { provider, externalId } : { provider };
}

/** Convierte un valor de fecha a milisegundos (Date, Timestamp o ISO). */
function toMillis(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

/** ¿El valor es una fecha utilizable (Date, Timestamp o ISO)? */
function isUsableDate(value) {
  if (value === null || value === undefined || value === "") return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime());
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return !Number.isNaN(Date.parse(value));
  return false;
}

function isEqualValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function validationError(errors) {
  const error = new Error(errors.join(" "));
  error.code = "validation";
  error.errors = errors;
  return error;
}

// -------------------------------------------------------------
// 3. Validación (REQ-014, DB-001..DB-006, AC-010, D-003)
// -------------------------------------------------------------

/**
 * Valida una sesión (DB-007): `date` obligatoria, `note` ≤500,
 * `rating` entero 1-10 (D-003), `progress` texto libre.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSession(session) {
  const errors = [];
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return { valid: false, errors: ["La sesión debe ser un objeto."] };
  }
  if (session.id !== undefined && session.id !== null && typeof session.id !== "string") {
    errors.push("El id de la sesión debe ser texto.");
  }
  if (!isUsableDate(session.date)) {
    errors.push("La fecha de la sesión es obligatoria.");
  }
  if (session.note !== undefined && session.note !== null) {
    if (typeof session.note !== "string") {
      errors.push("La nota de la sesión debe ser texto.");
    } else if (session.note.length > LIMITS.NOTE_MAX) {
      errors.push(`La nota de la sesión no puede superar los ${LIMITS.NOTE_MAX} caracteres.`);
    }
  }
  if (session.rating !== undefined && session.rating !== null) {
    if (typeof session.rating !== "number" || !Number.isInteger(session.rating)) {
      errors.push("La nota de la sesión debe ser un número entero.");
    } else if (session.rating < LIMITS.RATING_MIN || session.rating > LIMITS.RATING_MAX) {
      errors.push(`La nota de la sesión debe estar entre ${LIMITS.RATING_MIN} y ${LIMITS.RATING_MAX}.`);
    }
  }
  if (session.progress !== undefined && session.progress !== null && typeof session.progress !== "string") {
    errors.push("El progreso de la sesión debe ser texto.");
  }
  return { valid: errors.length === 0, errors };
}

/** Atajo booleano de validateSession(). */
export function isValidSession(session) {
  return validateSession(session).valid;
}

/**
 * Valida un ítem del catálogo (DB-001..DB-006, REQ-014, AC-010).
 * `mediaType` es opcional (si viene, debe ser válido); los campos
 * propios de cada tipo solo se comprueban si están presentes.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateItem(item) {
  const errors = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { valid: false, errors: ["El ítem debe ser un objeto."] };
  }

  // mediaType (DB-001, REQ-001)
  if (item.mediaType !== undefined && item.mediaType !== null && !isMediaType(item.mediaType)) {
    errors.push(
      `mediaType inválido: "${item.mediaType}". Valores permitidos: ${MEDIA_TYPES.join(", ")}.`,
    );
  }

  // title (DB-001): obligatorio, 1-200
  if (typeof item.title !== "string" || item.title.trim().length === 0) {
    errors.push("El título es obligatorio.");
  } else if (item.title.length > LIMITS.TITLE_MAX) {
    errors.push(`El título no puede superar los ${LIMITS.TITLE_MAX} caracteres.`);
  }

  // originalTitle (string libre)
  if (
    item.originalTitle !== undefined &&
    item.originalTitle !== null &&
    typeof item.originalTitle !== "string"
  ) {
    errors.push("El título original debe ser texto.");
  }

  // year (DB-001): 1888-2100
  if (item.year !== undefined && item.year !== null) {
    if (typeof item.year !== "number" || !Number.isFinite(item.year)) {
      errors.push("El año debe ser un número.");
    } else if (item.year < LIMITS.YEAR_MIN || item.year > LIMITS.YEAR_MAX) {
      errors.push(`El año debe estar entre ${LIMITS.YEAR_MIN} y ${LIMITS.YEAR_MAX}.`);
    }
  }

  // posterUrl (DB-001): URL
  if (item.posterUrl !== undefined && item.posterUrl !== null) {
    if (typeof item.posterUrl !== "string") {
      errors.push("El póster debe ser una URL (texto).");
    } else if (item.posterUrl.trim().length > 0 && !/^https?:\/\/\S+$/i.test(item.posterUrl.trim())) {
      errors.push("El póster debe ser una URL válida (http/https).");
    }
  }

  // synopsis (DB-001): ≤2000
  if (item.synopsis !== undefined && item.synopsis !== null) {
    if (typeof item.synopsis !== "string") {
      errors.push("La sinopsis debe ser texto.");
    } else if (item.synopsis.length > LIMITS.SYNOPSIS_MAX) {
      errors.push(`La sinopsis no puede superar los ${LIMITS.SYNOPSIS_MAX} caracteres.`);
    }
  }

  // genres (DB-001): string[] ≤10
  if (item.genres !== undefined && item.genres !== null) {
    if (!Array.isArray(item.genres)) {
      errors.push("Los géneros deben ser una lista.");
    } else {
      if (item.genres.length > LIMITS.GENRES_MAX) {
        errors.push(`No se pueden guardar más de ${LIMITS.GENRES_MAX} géneros.`);
      }
      if (item.genres.some((genre) => typeof genre !== "string")) {
        errors.push("Cada género debe ser texto.");
      }
    }
  }

  // status (DB-001, REQ-002)
  if (item.status !== undefined && item.status !== null && !isStatus(item.status)) {
    errors.push(
      `Estado inválido: "${item.status}". Valores permitidos: ${ITEM_STATUSES.join(", ")}.`,
    );
  }

  // rating (DB-001, D-003): entero 1-10
  if (item.rating !== undefined && item.rating !== null) {
    if (typeof item.rating !== "number" || !Number.isInteger(item.rating)) {
      errors.push("La valoración debe ser un número entero.");
    } else if (item.rating < LIMITS.RATING_MIN || item.rating > LIMITS.RATING_MAX) {
      errors.push(`La valoración debe estar entre ${LIMITS.RATING_MIN} y ${LIMITS.RATING_MAX}.`);
    }
  }

  // review (DB-001): ≤500
  if (item.review !== undefined && item.review !== null) {
    if (typeof item.review !== "string") {
      errors.push("La reseña debe ser texto.");
    } else if (item.review.length > LIMITS.REVIEW_MAX) {
      errors.push(`La reseña no puede superar los ${LIMITS.REVIEW_MAX} caracteres.`);
    }
  }

  // durationMinutes (DB-001/DB-002): ≥0
  if (item.durationMinutes !== undefined && item.durationMinutes !== null) {
    if (typeof item.durationMinutes !== "number" || !Number.isFinite(item.durationMinutes)) {
      errors.push("La duración debe ser un número de minutos.");
    } else if (item.durationMinutes < 0) {
      errors.push("La duración no puede ser negativa.");
    }
  }

  // source (DB-001): { provider, externalId? }
  if (item.source !== undefined && item.source !== null) {
    if (typeof item.source !== "object" || Array.isArray(item.source)) {
      errors.push("La fuente debe ser un objeto { provider, externalId }.");
    } else {
      if (typeof item.source.provider !== "string" || !item.source.provider.trim()) {
        errors.push("La fuente necesita un proveedor (provider).");
      }
      if (item.source.externalId !== undefined && item.source.externalId !== null) {
        if (typeof item.source.externalId !== "string") {
          errors.push("El externalId de la fuente debe ser texto.");
        }
      }
    }
  }

  // currentSeason / currentEpisode (DB-003, DB-006): ≥1
  for (const field of ["currentSeason", "currentEpisode"]) {
    const value = item[field];
    if (value !== undefined && value !== null) {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`El campo ${field} debe ser un número entero.`);
      } else if (value < LIMITS.EPISODE_MIN) {
        errors.push(`El campo ${field} debe ser mayor o igual que ${LIMITS.EPISODE_MIN}.`);
      }
    }
  }

  // totalSeasons / totalEpisodes (DB-003, DB-006): enteros ≥0
  for (const field of ["totalSeasons", "totalEpisodes"]) {
    const value = item[field];
    if (value !== undefined && value !== null) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        errors.push(`El campo ${field} debe ser un número entero mayor o igual que 0.`);
      }
    }
  }

  // hoursPlayed (DB-004): ≥0
  if (item.hoursPlayed !== undefined && item.hoursPlayed !== null) {
    if (typeof item.hoursPlayed !== "number" || !Number.isFinite(item.hoursPlayed)) {
      errors.push("Las horas jugadas deben ser un número.");
    } else if (item.hoursPlayed < 0) {
      errors.push("Las horas jugadas no pueden ser negativas.");
    }
  }

  // completionPercent (DB-004): 0-100
  if (item.completionPercent !== undefined && item.completionPercent !== null) {
    if (typeof item.completionPercent !== "number" || !Number.isFinite(item.completionPercent)) {
      errors.push("El porcentaje de completado debe ser un número.");
    } else if (
      item.completionPercent < LIMITS.COMPLETION_MIN ||
      item.completionPercent > LIMITS.COMPLETION_MAX
    ) {
      errors.push(
        `El porcentaje de completado debe estar entre ${LIMITS.COMPLETION_MIN} y ${LIMITS.COMPLETION_MAX}.`,
      );
    }
  }

  // platform / author (DB-004, DB-005): texto libre
  for (const field of ["platform", "author"]) {
    const value = item[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      errors.push(`El campo ${field} debe ser texto.`);
    }
  }

  // achievementsUnlocked / achievementsTotal (DB-004): ≥0
  for (const field of ["achievementsUnlocked", "achievementsTotal"]) {
    const value = item[field];
    if (value !== undefined && value !== null) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        errors.push(`El campo ${field} debe ser un número mayor o igual que 0.`);
      }
    }
  }

  // pagesTotal (DB-005): ≥0
  if (item.pagesTotal !== undefined && item.pagesTotal !== null) {
    if (typeof item.pagesTotal !== "number" || !Number.isFinite(item.pagesTotal)) {
      errors.push("El total de páginas debe ser un número.");
    } else if (item.pagesTotal < 0) {
      errors.push("El total de páginas no puede ser negativo.");
    }
  }

  // pagesRead (DB-005): 0..pagesTotal (si hay total); si no, ≥0
  if (item.pagesRead !== undefined && item.pagesRead !== null) {
    if (typeof item.pagesRead !== "number" || !Number.isFinite(item.pagesRead)) {
      errors.push("Las páginas leídas deben ser un número.");
    } else if (item.pagesRead < 0) {
      errors.push("Las páginas leídas no pueden ser negativas.");
    } else if (
      typeof item.pagesTotal === "number" &&
      Number.isFinite(item.pagesTotal) &&
      item.pagesRead > item.pagesTotal
    ) {
      errors.push("Las páginas leídas no pueden superar el total de páginas.");
    }
  }

  // sessions (DB-001, DB-007, D-004)
  if (item.sessions !== undefined && item.sessions !== null) {
    if (!Array.isArray(item.sessions)) {
      errors.push("Las sesiones deben ser una lista.");
    } else {
      item.sessions.forEach((session, index) => {
        const result = validateSession(session);
        result.errors.forEach((message) => errors.push(`Sesión ${index + 1}: ${message}`));
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Atajo booleano de validateItem(). */
export function isValidItem(item) {
  return validateItem(item).valid;
}

// -------------------------------------------------------------
// 4. Normalización (autofill de la API + formularios)
// -------------------------------------------------------------

/**
 * Normaliza un ítem: recorta textos, convierte números, aplica los
 * valores por defecto y calcula `nextEpisode` en series/anime.
 * No muta el objeto recibido.
 */
export function normalizeItem(mediaType, data = {}) {
  const src = data && typeof data === "object" ? data : {};
  const type = mediaType || src.mediaType || null;
  const item = {
    mediaType: type,
    title: typeof src.title === "string" ? src.title.trim() : "",
    originalTitle: toText(src.originalTitle),
    year: toNumber(src.year),
    posterUrl: toText(src.posterUrl),
    synopsis: toText(src.synopsis),
    genres: toTextList(src.genres),
    status: typeof src.status === "string" && src.status ? src.status : "pending",
    rating: toNumber(src.rating),
    review: toText(src.review),
    durationMinutes: toNumber(src.durationMinutes),
    source: normalizeSource(src.source),
  };

  if (type === "series" || type === "anime") {
    item.currentSeason = toNumber(src.currentSeason);
    item.currentEpisode = toNumber(src.currentEpisode);
    item.totalSeasons = toNumber(src.totalSeasons);
    item.totalEpisodes = toNumber(src.totalEpisodes);
    item.nextEpisode = nextEpisodeLabel(item);
  } else if (type === "game") {
    item.hoursPlayed = toNumber(src.hoursPlayed);
    item.completionPercent = toNumber(src.completionPercent);
    item.platform = toText(src.platform);
    item.achievementsUnlocked = toNumber(src.achievementsUnlocked);
    item.achievementsTotal = toNumber(src.achievementsTotal);
  } else if (type === "book") {
    item.author = toText(src.author);
    item.pagesTotal = toNumber(src.pagesTotal);
    item.pagesRead = toNumber(src.pagesRead);
  }

  item.sessions = Array.isArray(src.sessions) ? src.sessions.map(normalizeSession) : [];
  return item;
}

// -------------------------------------------------------------
// 5. «Siguiente episodio» (DB-003, DB-006)
// -------------------------------------------------------------

/**
 * Calcula la etiqueta del siguiente episodio (DB-003 / DB-006).
 * Contrato estricto: hacen falta TODOS los datos (currentSeason,
 * currentEpisode, totalSeasons y totalEpisodes); si falta cualquiera
 * de ellos → null.
 *   - si currentEpisode < totalEpisodes → "S{cs}E{ce+1}"
 *   - si no y currentSeason < totalSeasons → "S{cs+1}E1"
 *   - si no → "Finalizado"
 * @returns {string|null}
 */
export function nextEpisodeLabel(item) {
  if (!item || typeof item !== "object") return null;
  const currentSeason = toNumber(item.currentSeason);
  const currentEpisode = toNumber(item.currentEpisode);
  const totalSeasons = toNumber(item.totalSeasons);
  const totalEpisodes = toNumber(item.totalEpisodes);

  // Sin progreso actual no se puede calcular nada.
  if (currentSeason === null || currentEpisode === null) return null;
  // DB-003: si faltan los totales (o alguno de ellos) → null.
  if (totalSeasons === null || totalEpisodes === null) return null;

  if (currentEpisode < totalEpisodes) {
    return `S${currentSeason}E${currentEpisode + 1}`;
  }
  if (currentSeason < totalSeasons) {
    return `S${currentSeason + 1}E1`;
  }
  return "Finalizado";
}

// -------------------------------------------------------------
// 6. Sesiones embebidas (DB-007, D-004, AC-008)
// -------------------------------------------------------------

/** Genera un id de sesión. */
export function createSessionId() {
  const globalCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Normaliza una sesión (rellena id, quita campos no válidos). */
export function normalizeSession(session) {
  const src = session && typeof session === "object" ? session : {};
  const id = typeof src.id === "string" && src.id.trim() ? src.id.trim() : createSessionId();
  return {
    id,
    date: src.date === undefined ? null : src.date,
    note: typeof src.note === "string" ? src.note : null,
    rating: typeof src.rating === "number" && Number.isFinite(src.rating) ? src.rating : null,
    progress: typeof src.progress === "string" ? src.progress : null,
  };
}

/**
 * Añade una sesión al array embebido (D-004). Devuelve un array NUEVO.
 * Lanza Error (con .errors) si la sesión no es válida (DB-007).
 */
export function addSession(sessions, session) {
  const list = Array.isArray(sessions) ? sessions.slice() : [];
  const normalized = normalizeSession(session);
  const result = validateSession(normalized);
  if (!result.valid) throw validationError(result.errors);
  list.push(normalized);
  return list;
}

/**
 * Edita una sesión del array embebido (D-004). Devuelve un array NUEVO.
 * Lanza Error (con .errors) si la sesión no existe o no es válida.
 */
export function updateSession(sessions, sessionId, patch = {}) {
  const list = Array.isArray(sessions) ? sessions.slice() : [];
  const index = list.findIndex((session) => session && session.id === sessionId);
  if (index === -1) throw new Error(`No existe la sesión "${sessionId}".`);
  const merged = { ...list[index], ...(patch || {}), id: sessionId };
  const normalized = normalizeSession(merged);
  const result = validateSession(normalized);
  if (!result.valid) throw validationError(result.errors);
  list[index] = normalized;
  return list;
}

/**
 * Elimina una sesión del array embebido (D-004). Devuelve un array NUEVO.
 * Si la sesión no existe, devuelve el array sin cambios (idempotente).
 */
export function removeSession(sessions, sessionId) {
  const list = Array.isArray(sessions) ? sessions.slice() : [];
  const index = list.findIndex((session) => session && session.id === sessionId);
  if (index === -1) return list;
  list.splice(index, 1);
  return list;
}

/** Busca una sesión por id (devuelve null si no existe). */
export function findSession(sessions, sessionId) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list.find((session) => session && session.id === sessionId) || null;
}

/** Ordena las sesiones por fecha descendente (la más reciente primero). */
export function sortSessionsByDateDesc(sessions) {
  const list = Array.isArray(sessions) ? sessions.slice() : [];
  return list.sort((a, b) => toMillis(b?.date) - toMillis(a?.date));
}

// -------------------------------------------------------------
// 7. Filtro y orden (REQ-012, AC-016, Q-003)
// -------------------------------------------------------------

/**
 * Comprueba si un ítem cumple los filtros.
 * Filtros admitidos (todos opcionales):
 *   { status, mediaType, search, minRating, maxRating, year, minYear, maxYear }
 * `status` y `mediaType` admiten un valor o una lista de valores.
 */
export function matchesFilter(item, filters = {}) {
  if (!item || typeof item !== "object") return false;
  const f = filters && typeof filters === "object" ? filters : {};

  if (f.status) {
    const wanted = Array.isArray(f.status) ? f.status : [f.status];
    if (wanted.length > 0 && !wanted.includes(item.status)) return false;
  }

  if (f.mediaType) {
    const wanted = Array.isArray(f.mediaType) ? f.mediaType : [f.mediaType];
    if (wanted.length > 0 && !wanted.includes(item.mediaType)) return false;
  }

  const text = f.search ?? f.query ?? f.text;
  if (text !== undefined && text !== null && String(text).trim() !== "") {
    const needle = String(text).trim().toLowerCase();
    const haystack = [
      item.title ?? "",
      item.originalTitle ?? "",
      item.author ?? "",
      item.platform ?? "",
      Array.isArray(item.genres) ? item.genres.join(" ") : "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  if (f.minRating !== undefined && f.minRating !== null) {
    if (typeof item.rating !== "number" || item.rating < f.minRating) return false;
  }
  if (f.maxRating !== undefined && f.maxRating !== null) {
    if (typeof item.rating !== "number" || item.rating > f.maxRating) return false;
  }
  if (f.year !== undefined && f.year !== null && item.year !== f.year) return false;
  if (f.minYear !== undefined && f.minYear !== null) {
    if (typeof item.year !== "number" || item.year < f.minYear) return false;
  }
  if (f.maxYear !== undefined && f.maxYear !== null) {
    if (typeof item.year !== "number" || item.year > f.maxYear) return false;
  }

  return true;
}

/** Filtra una lista de ítems (REQ-012). Devuelve un array NUEVO. */
export function filterItems(items, filters = {}) {
  const list = Array.isArray(items) ? items : [];
  return list.filter((item) => matchesFilter(item, filters));
}

/** Compara por updatedAt (Q-003: desc por defecto). */
export function compareByUpdatedAt(a, b, direction = "desc") {
  const ma = toMillis(a?.updatedAt);
  const mb = toMillis(b?.updatedAt);
  return direction === "asc" ? ma - mb : mb - ma;
}

/** Compara por updatedAt descendente (Q-003). */
export function compareByUpdatedAtDesc(a, b) {
  return compareByUpdatedAt(a, b, "desc");
}

/** Compara por título (asc por defecto, insensible a mayúsculas). */
export function compareByTitle(a, b, direction = "asc") {
  const result = String(a?.title ?? "").localeCompare(String(b?.title ?? ""), "es", {
    sensitivity: "base",
    numeric: true,
  });
  return direction === "asc" ? result : -result;
}

/** Compara por título ascendente. */
export function compareByTitleAsc(a, b) {
  return compareByTitle(a, b, "asc");
}

/** Compara por valoración (desc por defecto; los vacíos van al final). */
export function compareByRating(a, b, direction = "desc") {
  const ra = typeof a?.rating === "number" ? a.rating : null;
  const rb = typeof b?.rating === "number" ? b.rating : null;
  if (ra === null && rb === null) return 0;
  if (ra === null) return 1;
  if (rb === null) return -1;
  return direction === "asc" ? ra - rb : rb - ra;
}

/** Compara por valoración descendente. */
export function compareByRatingDesc(a, b) {
  return compareByRating(a, b, "desc");
}

/** Compara por estado (orden canónico de ITEM_STATUSES). */
export function compareByStatus(a, b, direction = "asc") {
  const ia = ITEM_STATUSES.indexOf(a?.status);
  const ib = ITEM_STATUSES.indexOf(b?.status);
  const na = ia === -1 ? ITEM_STATUSES.length : ia;
  const nb = ib === -1 ? ITEM_STATUSES.length : ib;
  if (na === nb) return 0;
  return direction === "asc" ? na - nb : nb - na;
}

/** Compara por estado ascendente. */
export function compareByStatusAsc(a, b) {
  return compareByStatus(a, b, "asc");
}

/** Compara por año descendente (los vacíos van al final). */
export function compareByYearDesc(a, b) {
  const ya = typeof a?.year === "number" ? a.year : null;
  const yb = typeof b?.year === "number" ? b.year : null;
  if (ya === null && yb === null) return 0;
  if (ya === null) return 1;
  if (yb === null) return -1;
  return yb - ya;
}

const SORT_DEFAULTS = Object.freeze({
  updatedAt: "desc",
  title: "asc",
  rating: "desc",
  year: "desc",
  status: "asc",
});

/**
 * Ordena una lista de ítems (REQ-012). Devuelve un array NUEVO.
 * `sortBy` por defecto: "updatedAt" desc (Q-003).
 */
export function sortItems(items, sortBy = DEFAULT_SORT, direction) {
  const list = Array.isArray(items) ? items.slice() : [];
  const field = SORT_FIELDS.includes(sortBy) ? sortBy : DEFAULT_SORT;
  const dir = direction === "asc" || direction === "desc" ? direction : SORT_DEFAULTS[field];
  switch (field) {
    case "title":
      return list.sort((a, b) => compareByTitle(a, b, dir));
    case "rating":
      return list.sort((a, b) => compareByRating(a, b, dir));
    case "year":
      return list.sort((a, b) =>
        dir === "asc"
          ? compareByYearDesc(b, a)
          : compareByYearDesc(a, b),
      );
    case "status":
      return list.sort((a, b) => compareByStatus(a, b, dir));
    case "updatedAt":
    default:
      return list.sort((a, b) => compareByUpdatedAt(a, b, dir));
  }
}

// =============================================================
// 8. STORE (Firestore) — REQ-003, REQ-013, AC-002, AC-017, Q-003
//
// Import DINÁMICO de "./firebase.js" dentro de cada función: este
// módulo se puede importar en Node/vitest sin red; el SDK de
// Firebase (CDN) solo se descarga cuando se usa el store.
// =============================================================

function requireUid(auth) {
  const uid = auth?.currentUser?.uid;
  if (!uid) {
    throw new Error("No hay usuario autenticado: inicia sesión antes de usar el catálogo.");
  }
  return uid;
}

function docToItem(snapshot) {
  const data = snapshot.data() || {};
  return { id: snapshot.id, ...data };
}

function buildUpdatePayload(current, next) {
  const payload = {};
  for (const key of Object.keys(next)) {
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      payload[key] = next[key];
      continue;
    }
    if (!isEqualValue(current[key], next[key])) payload[key] = next[key];
  }
  return payload;
}

function toStoreDate(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  if (typeof value === "number") return new Date(value);
  return value;
}

function toStoreSessions(sessions) {
  return sessions.map((session) => ({ ...session, date: toStoreDate(session.date) }));
}

/** Uid del usuario autenticado actual (null si no hay sesión). */
export async function getCurrentUserId() {
  const { auth } = await import("./firebase.js");
  return auth?.currentUser?.uid ?? null;
}

/**
 * Lista los ítems de un tipo (Q-003): orderBy("updatedAt","desc") +
 * limit(100) y cursor opcional `startAfter`.
 * @returns {Promise<{items: object[], lastDoc: object|null, hasMore: boolean}>}
 */
export async function listItems(mediaType, options = {}) {
  const { limitCount = DEFAULT_PAGE_SIZE, startAfter: cursor = null } = options || {};
  const { db, auth, collection, getDocs, query, orderBy, limit, startAfter } = await import(
    "./firebase.js"
  );
  const uid = requireUid(auth);
  const itemsRef = collection(db, "users", uid, collectionNameFor(mediaType));
  const constraints = [orderBy("updatedAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(limitCount));
  const snapshot = await getDocs(query(itemsRef, ...constraints));
  const docs = snapshot.docs;
  return {
    items: docs.map(docToItem),
    lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore: docs.length >= limitCount,
  };
}

/**
 * Suscripción en vivo a los ítems de un tipo (Q-003).
 * Devuelve la función para cancelar la suscripción (unsubscribe).
 * @param {string} mediaType
 * @param {object|Function} optionsOrCallback `{ limitCount, startAfter, onItems, onError }` o la función onItems
 * @param {object} extraOptions opciones si el 2º parámetro es la función onItems
 * @returns {Promise<Function>} unsubscribe
 */
export async function subscribeItems(mediaType, optionsOrCallback = {}, extraOptions = {}) {
  const options =
    typeof optionsOrCallback === "function"
      ? { ...(extraOptions || {}), onItems: optionsOrCallback }
      : { ...(optionsOrCallback || {}) };
  const { limitCount = DEFAULT_PAGE_SIZE, startAfter: cursor = null, onItems, onError } = options;
  const { db, auth, collection, onSnapshot, query, orderBy, limit, startAfter } = await import(
    "./firebase.js"
  );
  const uid = requireUid(auth);
  const itemsRef = collection(db, "users", uid, collectionNameFor(mediaType));
  const constraints = [orderBy("updatedAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(limitCount));
  const itemsQuery = query(itemsRef, ...constraints);
  return onSnapshot(itemsQuery, {
    next: (snapshot) => {
      const docs = snapshot.docs;
      if (typeof onItems === "function") {
        onItems(docs.map(docToItem), {
          lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
          hasMore: docs.length >= limitCount,
          error: null,
        });
      }
    },
    error: (error) => {
      if (typeof onError === "function") onError(error);
    },
  });
}

/** Lee un ítem concreto (null si no existe). */
export async function getItem(mediaType, itemId) {
  const { db, auth, doc, getDoc } = await import("./firebase.js");
  const uid = requireUid(auth);
  const ref = doc(db, "users", uid, collectionNameFor(mediaType), itemId);
  const snapshot = await getDoc(ref);
  return snapshot.exists() ? docToItem(snapshot) : null;
}

/**
 * Crea un ítem (AC-004, AC-010): valida, guarda createdAt/updatedAt con
 * serverTimestamp y devuelve el ítem con su id.
 */
export async function createItem(mediaType, data = {}) {
  const { db, auth, collection, addDoc, serverTimestamp } = await import("./firebase.js");
  const uid = requireUid(auth);
  const item = normalizeItem(mediaType, { ...(data || {}), mediaType });
  const result = validateItem(item);
  if (!result.valid) throw validationError(result.errors);
  const payload = {
    ...item,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, "users", uid, collectionNameFor(mediaType)), payload);
  return { id: ref.id, ...item };
}

/**
 * Edita un ítem (AC-017): lee, fusiona el parche, normaliza, valida y
 * refresca updatedAt con serverTimestamp.
 */
export async function updateItem(mediaType, itemId, patch = {}) {
  const { db, auth, doc, getDoc, updateDoc, serverTimestamp } = await import("./firebase.js");
  const uid = requireUid(auth);
  const ref = doc(db, "users", uid, collectionNameFor(mediaType), itemId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("El ítem no existe.");
  const current = { id: snapshot.id, ...(snapshot.data() || {}) };
  const merged = { ...current, ...(patch || {}) };
  delete merged.id;
  const item = normalizeItem(mediaType, merged);
  const result = validateItem(item);
  if (!result.valid) throw validationError(result.errors);
  const payload = buildUpdatePayload(current, item);
  payload.updatedAt = serverTimestamp();
  await updateDoc(ref, payload);
  return { id: itemId, ...item };
}

/** Cambia el estado de un ítem (AC-002) y refresca updatedAt. */
export async function setItemStatus(mediaType, itemId, status) {
  if (!isStatus(status)) {
    throw new Error(
      `Estado inválido: "${status}". Valores permitidos: ${ITEM_STATUSES.join(", ")}.`,
    );
  }
  const { db, auth, doc, updateDoc, serverTimestamp } = await import("./firebase.js");
  const uid = requireUid(auth);
  await updateDoc(doc(db, "users", uid, collectionNameFor(mediaType), itemId), {
    status,
    updatedAt: serverTimestamp(),
  });
  return { id: itemId, status };
}

/** Borra un ítem (con sus sesiones embebidas) (AC-017). */
export async function deleteItem(mediaType, itemId) {
  const { db, auth, doc, deleteDoc } = await import("./firebase.js");
  const uid = requireUid(auth);
  await deleteDoc(doc(db, "users", uid, collectionNameFor(mediaType), itemId));
  return true;
}

/**
 * Añade una sesión al array embebido del ítem (DB-007, D-004, AC-008).
 * @returns {Promise<object[]>} el array de sesiones ya guardado
 */
export async function addItemSession(mediaType, itemId, session = {}) {
  const { db, auth, doc, getDoc, updateDoc, serverTimestamp } = await import("./firebase.js");
  const uid = requireUid(auth);
  const ref = doc(db, "users", uid, collectionNameFor(mediaType), itemId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("El ítem no existe.");
  const current = snapshot.data() || {};
  const sessions = toStoreSessions(addSession(current.sessions || [], session));
  await updateDoc(ref, { sessions, updatedAt: serverTimestamp() });
  return sessions;
}

/**
 * Edita una sesión del array embebido (DB-007, D-004, AC-008).
 * @returns {Promise<object[]>} el array de sesiones ya guardado
 */
export async function updateItemSession(mediaType, itemId, sessionId, patch = {}) {
  const { db, auth, doc, getDoc, updateDoc, serverTimestamp } = await import("./firebase.js");
  const uid = requireUid(auth);
  const ref = doc(db, "users", uid, collectionNameFor(mediaType), itemId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("El ítem no existe.");
  const current = snapshot.data() || {};
  const sessions = toStoreSessions(updateSession(current.sessions || [], sessionId, patch));
  await updateDoc(ref, { sessions, updatedAt: serverTimestamp() });
  return sessions;
}

/**
 * Elimina una sesión del array embebido (DB-007, D-004, AC-008).
 * @returns {Promise<object[]>} el array de sesiones ya guardado
 */
export async function removeItemSession(mediaType, itemId, sessionId) {
  const { db, auth, doc, getDoc, updateDoc, serverTimestamp } = await import("./firebase.js");
  const uid = requireUid(auth);
  const ref = doc(db, "users", uid, collectionNameFor(mediaType), itemId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("El ítem no existe.");
  const current = snapshot.data() || {};
  const sessions = toStoreSessions(removeSession(current.sessions || [], sessionId));
  await updateDoc(ref, { sessions, updatedAt: serverTimestamp() });
  return sessions;
}
