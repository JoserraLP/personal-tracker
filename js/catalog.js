// =============================================================
// Catálogo unificado de ocio (spec 002).
//
// Dos partes en un único módulo:
//
//  1) PARTE PURA (importable en Node/vitest SIN red y SIN firebase):
//     constantes de tipos y estados, mapa tipo→colección, validación
//     de campos (DB-001..DB-006 / REQ-014), cálculo de «siguiente
//     episodio» (DB-003 / DB-006), helpers de sesiones embebidas
//     (DB-007 / D-004), comparadores de filtro/orden (REQ-012 / Q-003),
//     metadata adicional (DB-002 / REQ-004 / REQ-009 / AC-004 / AC-008)
//     y estadísticas del dashboard (REQ-005 / AC-005).
//
//  2) PARTE STORE (Firestore): CRUD de ítems, de sesiones y de la
//     caché de metadata (updateItemMetadata).
//     Las funciones de store hacen `await import("./firebase.js")`
//     DENTRO de cada función (nunca import estático) para que este
//     fichero se pueda importar en Node/vitest sin red: el módulo de
//     Firebase (CDN) solo se carga cuando se usa el store.
//
// Colecciones (REQ-003, D-006):
//   users/{uid}/movies | series | games | books | anime
// Spec: spec.md (raíz) — REQ-001..005, REQ-008..014,
//       DB-001..DB-007, AC-002, AC-004..008, AC-010, AC-016, AC-017,
//       D-003, D-004, D-005, Q-003.
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
  // Colecciones (spec 004, DB-001..DB-003).
  COLLECTIONS_MAX: 20,
  COLLECTION_NAME_MAX: 60,
  COLLECTION_DESCRIPTION_MAX: 300,
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

/**
 * Normaliza la lista de colecciones de un ítem/capítulo (DB-001, DB-002):
 * descarta entradas no textuales o vacías y elimina duplicados.
 * NO recorta el tamaño: el límite de 20 lo bloquea la validación.
 */
function toCollectionIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!id || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * Valida `collectionIds` (DB-001, DB-002): string[] ≤20, sin duplicados.
 * Añade los mensajes de error al array recibido (mismo estilo que el resto
 * de validaciones de este módulo).
 */
function collectCollectionIdsErrors(value, errors) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    errors.push("Las colecciones (collectionIds) deben ser una lista.");
    return;
  }
  if (value.length > LIMITS.COLLECTIONS_MAX) {
    errors.push(`No se pueden guardar más de ${LIMITS.COLLECTIONS_MAX} colecciones.`);
  }
  if (value.some((id) => typeof id !== "string" || id.trim().length === 0)) {
    errors.push("Cada id de colección debe ser texto.");
    return;
  }
  if (new Set(value.map((id) => id.trim())).size !== value.length) {
    errors.push("No se pueden repetir ids de colección.");
  }
}

/**
 * Normaliza la fecha de finalización/visionado (REQ-008, AC-005):
 * ausente, null o cadena vacía → null (igual que el resto de campos
 * opcionales); el resto se convierte con el helper de fechas del store.
 */
function toItemDate(value) {
  if (value === null || value === undefined || value === "") return null;
  return toStoreDate(value);
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

  // isFavorite (DB-001, REQ-001): booleano (default false).
  if (item.isFavorite !== undefined && item.isFavorite !== null) {
    if (typeof item.isFavorite !== "boolean") {
      errors.push("El campo isFavorite debe ser booleano.");
    }
  }

  // collectionIds (DB-001, REQ-007): string[] ≤20 sin duplicados.
  collectCollectionIdsErrors(item.collectionIds, errors);

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
    completedAt: toItemDate(src.completedAt),
    durationMinutes: toNumber(src.durationMinutes),
    source: normalizeSource(src.source),
    // Favoritos y colecciones (spec 004, DB-001): flags embebidos.
    isFavorite: src.isFavorite === undefined || src.isFavorite === null ? false : src.isFavorite,
    collectionIds: toCollectionIds(src.collectionIds),
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

// -------------------------------------------------------------
// 8. Metadata adicional (DB-002, REQ-004, REQ-009, AC-004, AC-008)
//
// Los campos de metadata son OPCIONALES: si no vienen, se serializan
// como null (§4.1). La validación solo comprueba tipos y rangos.
// -------------------------------------------------------------

/** Fuentes de metadata admitidas (DB-002). */
export const METADATA_SOURCES = Object.freeze(["tmdb", "igdb", "googlebooks", "manual"]);

/** Validez de la caché de metadata en días (REQ-009, AC-008). */
export const METADATA_CACHE_TTL_DAYS = 30;

/** Validez de la caché de metadata en milisegundos (REQ-009, AC-008). */
export const METADATA_CACHE_TTL_MS = METADATA_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

// Límites de los campos de metadata (DB-002).
const METADATA_LIMITS = Object.freeze({
  DIRECTOR_MAX: 200,
  CAST_MAX: 20,
  CAST_ENTRY_MAX: 100,
  TAGLINE_MAX: 300,
  PLATFORMS_MAX: 10,
  DEVELOPERS_MAX: 10,
  PUBLISHER_MAX: 200,
  AUTHORS_MAX: 10,
  LANGUAGE_MAX: 50,
});

/** Campos de metadata embebidos que se escriben en el documento (DB-002). */
const METADATA_FIELDS = Object.freeze([
  "director",
  "cast",
  "backdropUrl",
  "tagline",
  "platforms",
  "developers",
  "publisher",
  "authors",
  "pageCount",
  "seasons",
  "episodes",
  "language",
]);

/** ¿La fuente de metadata es válida? (DB-002) */
export function isMetadataSource(source) {
  return typeof source === "string" && METADATA_SOURCES.includes(source);
}

/** Texto recortado; vacío/absente/no textual → null. */
function toTrimmedText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Lista de textos recortados; si el valor no es un array → null
 * (campo ausente). Las entradas no textuales se descartan.
 */
function toMetadataList(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Valida la metadata adicional de un ítem (DB-002, REQ-004, AC-004).
 * Todos los campos son opcionales: solo se validan los presentes.
 * @param {object} metadata
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMetadata(metadata) {
  const errors = [];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { valid: false, errors: ["La metadata debe ser un objeto."] };
  }

  // director (DB-002): string ≤200
  if (metadata.director !== undefined && metadata.director !== null) {
    if (typeof metadata.director !== "string") {
      errors.push("El director debe ser texto.");
    } else if (metadata.director.trim().length > METADATA_LIMITS.DIRECTOR_MAX) {
      errors.push(
        `El director no puede superar los ${METADATA_LIMITS.DIRECTOR_MAX} caracteres.`,
      );
    }
  }

  // cast (DB-002): string[] ≤20, cada entrada ≤100
  if (metadata.cast !== undefined && metadata.cast !== null) {
    if (!Array.isArray(metadata.cast)) {
      errors.push("El reparto debe ser una lista.");
    } else {
      if (metadata.cast.length > METADATA_LIMITS.CAST_MAX) {
        errors.push(
          `No se pueden guardar más de ${METADATA_LIMITS.CAST_MAX} nombres en el reparto.`,
        );
      }
      metadata.cast.forEach((entry, index) => {
        if (typeof entry !== "string") {
          errors.push(`El reparto ${index + 1} debe ser texto.`);
        } else if (entry.trim().length > METADATA_LIMITS.CAST_ENTRY_MAX) {
          errors.push(
            `El reparto ${index + 1} no puede superar los ${METADATA_LIMITS.CAST_ENTRY_MAX} caracteres.`,
          );
        }
      });
    }
  }

  // backdropUrl (DB-002): URL válida (http/https) o null
  if (metadata.backdropUrl !== undefined && metadata.backdropUrl !== null) {
    if (typeof metadata.backdropUrl !== "string") {
      errors.push("El fondo (backdropUrl) debe ser una URL (texto).");
    } else if (
      metadata.backdropUrl.trim().length > 0 &&
      !/^https?:\/\/\S+$/i.test(metadata.backdropUrl.trim())
    ) {
      errors.push("El fondo (backdropUrl) debe ser una URL válida (http/https).");
    }
  }

  // tagline (DB-002): string ≤300
  if (metadata.tagline !== undefined && metadata.tagline !== null) {
    if (typeof metadata.tagline !== "string") {
      errors.push("El tagline debe ser texto.");
    } else if (metadata.tagline.trim().length > METADATA_LIMITS.TAGLINE_MAX) {
      errors.push(`El tagline no puede superar los ${METADATA_LIMITS.TAGLINE_MAX} caracteres.`);
    }
  }

  // platforms / developers / authors (DB-002): string[] ≤10
  for (const field of ["platforms", "developers", "authors"]) {
    const value = metadata[field];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      errors.push(`El campo ${field} debe ser una lista.`);
      continue;
    }
    const max =
      field === "platforms"
        ? METADATA_LIMITS.PLATFORMS_MAX
        : field === "developers"
          ? METADATA_LIMITS.DEVELOPERS_MAX
          : METADATA_LIMITS.AUTHORS_MAX;
    if (value.length > max) {
      errors.push(`No se pueden guardar más de ${max} elementos en ${field}.`);
    }
    if (value.some((entry) => typeof entry !== "string")) {
      errors.push(`Cada elemento de ${field} debe ser texto.`);
    }
  }

  // publisher (DB-002): string ≤200
  if (metadata.publisher !== undefined && metadata.publisher !== null) {
    if (typeof metadata.publisher !== "string") {
      errors.push("La editorial (publisher) debe ser texto.");
    } else if (metadata.publisher.trim().length > METADATA_LIMITS.PUBLISHER_MAX) {
      errors.push(
        `La editorial (publisher) no puede superar los ${METADATA_LIMITS.PUBLISHER_MAX} caracteres.`,
      );
    }
  }

  // pageCount / seasons / episodes (DB-002): number ≥0
  for (const field of ["pageCount", "seasons", "episodes"]) {
    const value = metadata[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`El campo ${field} debe ser un número.`);
    } else if (value < 0) {
      errors.push(`El campo ${field} no puede ser negativo.`);
    }
  }

  // language (DB-002): string ≤50
  if (metadata.language !== undefined && metadata.language !== null) {
    if (typeof metadata.language !== "string") {
      errors.push("El idioma (language) debe ser texto.");
    } else if (metadata.language.trim().length > METADATA_LIMITS.LANGUAGE_MAX) {
      errors.push(
        `El idioma (language) no puede superar los ${METADATA_LIMITS.LANGUAGE_MAX} caracteres.`,
      );
    }
  }

  // metadataSource (DB-002): enum
  if (metadata.metadataSource !== undefined && metadata.metadataSource !== null) {
    if (!isMetadataSource(metadata.metadataSource)) {
      errors.push(
        `Fuente de metadata inválida: "${metadata.metadataSource}". Valores permitidos: ${METADATA_SOURCES.join(", ")}.`,
      );
    }
  }

  // metadataFetchedAt (DB-002): timestamp
  if (metadata.metadataFetchedAt !== undefined && metadata.metadataFetchedAt !== null) {
    if (!isUsableDate(metadata.metadataFetchedAt)) {
      errors.push("El campo metadataFetchedAt debe ser una fecha válida.");
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Atajo booleano de validateMetadata(). */
export function isValidMetadata(metadata) {
  return validateMetadata(metadata).valid;
}

/**
 * Normaliza la metadata (ItemMetadata, §4.1): recorta textos, convierte
 * números y serializa como `null` los campos opcionales que no vienen
 * (los arrays ausentes también → null). No muta el objeto recibido.
 * @param {object} input
 * @returns {object} ItemMetadata normalizado
 */
export function normalizeMetadata(input = {}) {
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    title: toTrimmedText(src.title),
    year: toNumber(src.year),
    posterUrl: toTrimmedText(src.posterUrl),
    backdropUrl: toTrimmedText(src.backdropUrl),
    synopsis: toTrimmedText(src.synopsis),
    genres: toMetadataList(src.genres),
    durationMinutes: toNumber(src.durationMinutes),
    director: toTrimmedText(src.director),
    cast: toMetadataList(src.cast),
    platforms: toMetadataList(src.platforms),
    developers: toMetadataList(src.developers),
    publisher: toTrimmedText(src.publisher),
    authors: toMetadataList(src.authors),
    pageCount: toNumber(src.pageCount),
    seasons: toNumber(src.seasons),
    episodes: toNumber(src.episodes),
    tagline: toTrimmedText(src.tagline),
    language: toTrimmedText(src.language),
    metadataSource: isMetadataSource(src.metadataSource) ? src.metadataSource : null,
  };
}

/**
 * ¿La caché de metadata sigue vigente? (REQ-009, AC-008)
 * Solo es fresca si `metadataFetchedAt` existe y es anterior a
 * METADATA_CACHE_TTL_DAYS días. Ausente, null o ≥ TTL → false.
 * @param {object} item ítem materializado (docToItem)
 * @param {Date} now momento de referencia (por defecto, ahora)
 * @returns {boolean}
 */
export function isMetadataFresh(item, now = new Date()) {
  if (!item || typeof item !== "object") return false;
  const fetchedAt = toMillis(item.metadataFetchedAt);
  if (!fetchedAt) return false;
  const nowMs = now instanceof Date ? now.getTime() : toMillis(now);
  const reference = Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now();
  const age = reference - fetchedAt;
  if (age < 0) return true;
  return age < METADATA_CACHE_TTL_MS;
}

// -------------------------------------------------------------
// 9. Estadísticas del dashboard (REQ-005, AC-005, D-005)
//
// Función PURA: no toca Firestore ni el DOM; trabaja sobre los ítems
// ya materializados con docToItem.
// -------------------------------------------------------------

/** Número de ítems en las listas de «recientes» (AC-005). */
export const RECENT_ITEMS_LIMIT = 5;

/**
 * Calcula las estadísticas del dashboard (REQ-005, AC-005, D-005).
 * @param {object} itemsByType `{ movie:[], series:[], game:[], book:[], anime:[] }`
 * @returns {{
 *   totalsByType: object,
 *   totalsByStatus: object,
 *   averageRating: number|null,
 *   totalHoursPlayed: number,
 *   completedCount: number,
 *   recentlyAdded: object[],
 *   recentlyCompleted: object[]
 * }}
 */
export function computeDashboardStats(itemsByType = {}) {
  const source =
    itemsByType && typeof itemsByType === "object" && !Array.isArray(itemsByType)
      ? itemsByType
      : {};

  const totalsByType = {};
  for (const type of MEDIA_TYPES) totalsByType[type] = 0;
  const totalsByStatus = {};
  for (const status of ITEM_STATUSES) totalsByStatus[status] = 0;

  // Aplana los ítems manteniendo el tipo (el de la clave o el del ítem).
  const entries = [];
  for (const key of Object.keys(source)) {
    const list = Array.isArray(source[key]) ? source[key] : [];
    const bucketType = MEDIA_TYPES.includes(key) ? key : null;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const itemType =
        bucketType || (MEDIA_TYPES.includes(item.mediaType) ? item.mediaType : null);
      if (itemType) totalsByType[itemType] += 1;
      entries.push({ item, type: itemType });
    }
  }

  let ratingSum = 0;
  let ratedCount = 0;
  let totalHoursPlayed = 0;
  let completedCount = 0;

  for (const { item, type } of entries) {
    if (isStatus(item.status)) totalsByStatus[item.status] += 1;
    if (item.status === "completed") completedCount += 1;
    // AC-005: la media usa SOLO los ítems valorados (sin rating → fuera).
    if (typeof item.rating === "number" && Number.isFinite(item.rating)) {
      ratingSum += item.rating;
      ratedCount += 1;
    }
    if (type === "game") {
      const hours = toNumber(item.hoursPlayed);
      if (hours !== null && hours >= 0) totalHoursPlayed += hours;
    }
  }

  const recentlyAdded = entries
    .map((entry) => entry.item)
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, RECENT_ITEMS_LIMIT);

  const recentlyCompleted = entries
    .filter((entry) => isUsableDate(entry.item.completedAt))
    .map((entry) => entry.item)
    .sort((a, b) => toMillis(b.completedAt) - toMillis(a.completedAt))
    .slice(0, RECENT_ITEMS_LIMIT);

  return {
    totalsByType,
    totalsByStatus,
    averageRating: ratedCount > 0 ? ratingSum / ratedCount : null,
    totalHoursPlayed,
    completedCount,
    recentlyAdded,
    recentlyCompleted,
  };
}

// =============================================================
// 10. STORE (Firestore) — REQ-003, REQ-013, AC-002, AC-017, Q-003
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

/**
 * Convierte un valor de fecha a un objeto `Date` de JS (CAMINO DE LECTURA,
 * REQ-008 / AC-005 / DB-007): los `Timestamp` de Firestore llegan con
 * `.toDate()`; los `Date`, las cadenas ISO y los epoch se reconstruyen.
 * Valores ausentes, nulos o inválidos (NaN) → null.
 * @param {*} value
 * @returns {Date|null}
 */
export function tsToDate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** Campos de fecha del documento que se normalizan al leer. */
const READ_DATE_FIELDS = Object.freeze([
  "completedAt",
  "createdAt",
  "updatedAt",
  "metadataFetchedAt",
]);

/**
 * Materializa un documento de Firestore como ítem del catálogo: convierte
 * TODOS los campos de fecha (`completedAt`, `createdAt`, `updatedAt` y el
 * `date` de cada sesión embebida) a objetos `Date` de JS, para que la UI
 * pueda hacer `new Date(...).toISOString()` sin RangeError.
 * No muta el documento original.
 */
export function docToItem(snapshot) {
  const data = snapshot.data() || {};
  const item = { id: snapshot.id, ...data };
  for (const field of READ_DATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(item, field)) {
      item[field] = tsToDate(item[field]);
    }
  }
  if (Array.isArray(item.sessions)) {
    item.sessions = item.sessions.map((session) => {
      if (!session || typeof session !== "object" || Array.isArray(session)) return session;
      return { ...session, date: tsToDate(session.date) };
    });
  }
  // Favoritos y colecciones (spec 004, DB-001): migración perezosa — si el
  // documento aún no tiene los campos, se materializan con su default.
  item.isFavorite = item.isFavorite === true;
  item.collectionIds = toCollectionIds(item.collectionIds);
  return item;
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

/**
 * Resuelve la fuente de metadata (DB-002): `source` explícito → la del
 * propio metadata → "manual". Lanza Error (con .errors) si el valor
 * no pertenece al enum.
 */
function resolveMetadataSource(source, fallback) {
  let candidate = source;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    candidate = candidate.provider ?? candidate.metadataSource ?? null;
  }
  if (candidate === undefined || candidate === null || candidate === "") {
    candidate = fallback;
  }
  if (candidate === undefined || candidate === null || candidate === "") {
    return "manual";
  }
  if (!isMetadataSource(candidate)) {
    throw validationError([
      `Fuente de metadata inválida: "${candidate}". Valores permitidos: ${METADATA_SOURCES.join(", ")}.`,
    ]);
  }
  return candidate;
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
  const { db, auth, collection, doc, getDoc, addDoc, serverTimestamp } = await import(
    "./firebase.js"
  );
  const uid = requireUid(auth);
  const item = normalizeItem(mediaType, { ...(data || {}), mediaType });
  const result = validateItem(item);
  if (!result.valid) throw validationError(result.errors);
  // §4.1 «Reglas»: los collectionIds deben existir.
  await assertCollectionsExist(uid, item.collectionIds, { db, doc, getDoc });
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
  // Lectura normalizada (Timestamps → Date) antes de fusionar el parche.
  const current = docToItem(snapshot);
  const merged = { ...current, ...(patch || {}) };
  delete merged.id;
  const item = normalizeItem(mediaType, merged);
  const result = validateItem(item);
  if (!result.valid) throw validationError(result.errors);
  // §4.1 «Reglas»: solo se comprueban los ids de colección NUEVOS (los ya
  // presentes no bloquean una edición por un id obsoleto).
  await assertCollectionsExist(
    uid,
    newCollectionIds(current.collectionIds, item.collectionIds),
    { db, doc, getDoc },
  );
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

/**
 * Guarda (cachea) la metadata adicional de un ítem (DB-002, REQ-004,
 * REQ-009, AC-004, AC-008):
 *  - valida con validateMetadata() (lanza Error con `.errors`);
 *  - normaliza con normalizeMetadata();
 *  - escribe los campos de metadata + `metadataSource` +
 *    `metadataFetchedAt` (Date) + `updatedAt`;
 *  - devuelve el ítem materializado (docToItem).
 * Los campos base del ítem (title/year/posterUrl/synopsis/genres/
 * durationMinutes) solo se escriben si vienen informados, para no
 * borrar los existentes con un null.
 * @returns {Promise<object>} el ítem con la metadata ya guardada
 */
export async function updateItemMetadata(mediaType, itemId, metadata, source) {
  const { db, auth, doc, getDoc, updateDoc, serverTimestamp } = await import("./firebase.js");
  const uid = requireUid(auth);
  const result = validateMetadata(metadata);
  if (!result.valid) throw validationError(result.errors);
  const normalized = normalizeMetadata(metadata);
  const metadataSource = resolveMetadataSource(source, normalized.metadataSource);
  const ref = doc(db, "users", uid, collectionNameFor(mediaType), itemId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("El ítem no existe.");

  const payload = {
    metadataSource,
    metadataFetchedAt: new Date(),
    updatedAt: typeof serverTimestamp === "function" ? serverTimestamp() : new Date(),
  };
  for (const field of METADATA_FIELDS) payload[field] = normalized[field];
  // Campos base del ítem: solo si vienen informados.
  if (normalized.title !== null) payload.title = normalized.title;
  if (normalized.year !== null) payload.year = normalized.year;
  if (normalized.posterUrl !== null) payload.posterUrl = normalized.posterUrl;
  if (normalized.synopsis !== null) payload.synopsis = normalized.synopsis;
  if (normalized.genres !== null) payload.genres = normalized.genres;
  if (normalized.durationMinutes !== null) payload.durationMinutes = normalized.durationMinutes;

  await updateDoc(ref, payload);
  const updated = await getDoc(ref);
  return docToItem(updated);
}

// =============================================================
// 11. FAVORITOS, CAPÍTULOS FAVORITOS Y COLECCIONES (spec 004)
//
//  DB-001 → `isFavorite` + `collectionIds` en CatalogItem (integrados en
//           validateItem / normalizeItem / docToItem, más abajo).
//  DB-002 → FavoriteChapter  → users/{uid}/chapters/{chapterId}
//  DB-003 → UserCollection   → users/{uid}/collections/{collectionId}
//
//  REQ-001 (toggle de favorito), REQ-002 (capítulos favoritos),
//  REQ-006 (colecciones), REQ-007 (pertenencia), REQ-012 (paginación),
//  AC-001, AC-002, AC-005, AC-006, AC-007, AC-009, AC-014.
//
//  11.1 PARTE PURA (sin red): validación/normalización de capítulos
//       favoritos y colecciones + estadísticas de favoritos (AC-005).
//  11.2 STORE (Firestore): favoritos de ítems, CRUD de capítulos y
//       colecciones, pertenencia a colecciones y borrado de colección con
//       desvinculación best-effort (AC-009). Import DINÁMICO de
//       "./firebase.js" (el módulo sigue siendo importable en Node sin red).
// =============================================================

// -------------------------------------------------------------
// 11.1 Constantes y helpers (DB-002, DB-003, AC-005)
// -------------------------------------------------------------

/**
 * Tipos de medio admitidos como padre de un capítulo favorito (DB-002).
 * El catálogo NO tiene podcasts (spec 002 los eliminó), así que el enum
 * efectivo es series|anime|book (tasks.md «Residuo 1»).
 */
export const CHAPTER_PARENT_MEDIA_TYPES = Object.freeze(["series", "anime", "book"]);

/** Máximo de colecciones por ítem o capítulo (DB-001, DB-002). */
export const MAX_COLLECTIONS_PER_TARGET = 20;

/** Máximo de favoritos recientes que muestra el dashboard (AC-005). */
export const RECENT_FAVORITES_LIMIT = 5;

/** Colección Firestore de los capítulos favoritos (DB-002). */
const CHAPTERS_COLLECTION = "chapters";

/** Colección Firestore de las colecciones propias (DB-003). */
const COLLECTIONS_COLLECTION = "collections";

/** ¿Es un tipo de medio válido como padre de un capítulo favorito? */
export function isChapterParentMediaType(value) {
  return typeof value === "string" && CHAPTER_PARENT_MEDIA_TYPES.includes(value);
}

// -------------------------------------------------------------
// 11.2 Capítulos favoritos — parte pura (DB-002, REQ-002)
// -------------------------------------------------------------

/**
 * Valida un capítulo/episodio favorito (DB-002, REQ-002, AC-002):
 *  - `parentMediaType`: enum obligatorio (series|anime|book);
 *  - `parentItemId`: obligatorio;
 *  - `season` / `episode`: opcionales, ≥1;
 *  - `title`: obligatorio, 1-200;
 *  - `notes`: opcional, ≤500;
 *  - `rating`: opcional, entero 1-10;
 *  - `watchCount`: opcional, ≥0 (default 0);
 *  - `isFavorite`: booleano (default true);
 *  - `collectionIds`: string[] ≤20 sin duplicados.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateFavoriteChapter(chapter) {
  const errors = [];
  if (!chapter || typeof chapter !== "object" || Array.isArray(chapter)) {
    return { valid: false, errors: ["El capítulo favorito debe ser un objeto."] };
  }

  // parentMediaType (DB-002): enum obligatorio.
  if (typeof chapter.parentMediaType !== "string" || chapter.parentMediaType.trim().length === 0) {
    errors.push("El tipo de medio padre (parentMediaType) es obligatorio.");
  } else if (!isChapterParentMediaType(chapter.parentMediaType)) {
    errors.push(
      `parentMediaType inválido: "${chapter.parentMediaType}". Valores permitidos: ${CHAPTER_PARENT_MEDIA_TYPES.join(", ")}.`,
    );
  }

  // parentItemId (DB-002): obligatorio.
  if (typeof chapter.parentItemId !== "string" || chapter.parentItemId.trim().length === 0) {
    errors.push("El ítem padre (parentItemId) es obligatorio.");
  }

  // season / episode (DB-002): opcionales, ≥1.
  for (const field of ["season", "episode"]) {
    const value = chapter[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`El campo ${field} debe ser un número.`);
    } else if (value < LIMITS.EPISODE_MIN) {
      errors.push(`El campo ${field} debe ser mayor o igual que ${LIMITS.EPISODE_MIN}.`);
    }
  }

  // title (DB-002): obligatorio, 1-200.
  if (typeof chapter.title !== "string" || chapter.title.trim().length === 0) {
    errors.push("El título es obligatorio.");
  } else if (chapter.title.length > LIMITS.TITLE_MAX) {
    errors.push(`El título no puede superar los ${LIMITS.TITLE_MAX} caracteres.`);
  }

  // notes (DB-002): opcional, ≤500.
  if (chapter.notes !== undefined && chapter.notes !== null) {
    if (typeof chapter.notes !== "string") {
      errors.push("Las notas deben ser texto.");
    } else if (chapter.notes.length > LIMITS.NOTE_MAX) {
      errors.push(`Las notas no pueden superar los ${LIMITS.NOTE_MAX} caracteres.`);
    }
  }

  // rating (DB-002): entero 1-10, opcional.
  if (chapter.rating !== undefined && chapter.rating !== null) {
    if (typeof chapter.rating !== "number" || !Number.isInteger(chapter.rating)) {
      errors.push("La valoración debe ser un número entero.");
    } else if (chapter.rating < LIMITS.RATING_MIN || chapter.rating > LIMITS.RATING_MAX) {
      errors.push(
        `La valoración debe estar entre ${LIMITS.RATING_MIN} y ${LIMITS.RATING_MAX}.`,
      );
    }
  }

  // watchCount (DB-002): ≥0.
  if (chapter.watchCount !== undefined && chapter.watchCount !== null) {
    if (typeof chapter.watchCount !== "number" || !Number.isFinite(chapter.watchCount)) {
      errors.push("El contador de visionados debe ser un número.");
    } else if (chapter.watchCount < 0) {
      errors.push("El contador de visionados no puede ser negativo.");
    }
  }

  // isFavorite (DB-002): booleano (default true).
  if (
    chapter.isFavorite !== undefined &&
    chapter.isFavorite !== null &&
    typeof chapter.isFavorite !== "boolean"
  ) {
    errors.push("El campo isFavorite debe ser booleano.");
  }

  // collectionIds (DB-001, DB-002): string[] ≤20 sin duplicados.
  collectCollectionIdsErrors(chapter.collectionIds, errors);

  return { valid: errors.length === 0, errors };
}

/** Atajo booleano de validateFavoriteChapter(). */
export function isValidFavoriteChapter(chapter) {
  return validateFavoriteChapter(chapter).valid;
}

/**
 * Normaliza un capítulo favorito (DB-002): recorta textos, convierte
 * números y aplica los defaults (watchCount 0, isFavorite true,
 * collectionIds []). Los campos opcionales ausentes → null.
 * No muta el objeto recibido.
 */
export function normalizeFavoriteChapter(data = {}) {
  const src =
    data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const watchCount = toNumber(src.watchCount);
  return {
    parentMediaType:
      typeof src.parentMediaType === "string" ? src.parentMediaType.trim() : null,
    parentItemId:
      typeof src.parentItemId === "string" ? src.parentItemId.trim() || null : null,
    season: toNumber(src.season),
    episode: toNumber(src.episode),
    title: typeof src.title === "string" ? src.title.trim() : "",
    notes: typeof src.notes === "string" ? src.notes.trim() || null : null,
    rating: toNumber(src.rating),
    watchCount: watchCount === null ? 0 : watchCount,
    isFavorite:
      src.isFavorite === undefined || src.isFavorite === null ? true : src.isFavorite,
    collectionIds: toCollectionIds(src.collectionIds),
  };
}

// -------------------------------------------------------------
// 11.3 Colecciones propias — parte pura (DB-003, REQ-006)
// -------------------------------------------------------------

/**
 * Valida una colección propia (DB-003, REQ-006, AC-006):
 *  - `name`: obligatorio, 1-60;
 *  - `description`: opcional, ≤300;
 *  - `color`: opcional, `#RRGGBB` (hex) o null.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCollection(collection) {
  const errors = [];
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    return { valid: false, errors: ["La colección debe ser un objeto."] };
  }

  // name (DB-003): obligatorio, 1-60.
  if (typeof collection.name !== "string" || collection.name.trim().length === 0) {
    errors.push("El nombre de la colección es obligatorio.");
  } else if (collection.name.length > LIMITS.COLLECTION_NAME_MAX) {
    errors.push(
      `El nombre no puede superar los ${LIMITS.COLLECTION_NAME_MAX} caracteres.`,
    );
  }

  // description (DB-003): opcional, ≤300.
  if (collection.description !== undefined && collection.description !== null) {
    if (typeof collection.description !== "string") {
      errors.push("La descripción debe ser texto.");
    } else if (collection.description.length > LIMITS.COLLECTION_DESCRIPTION_MAX) {
      errors.push(
        `La descripción no puede superar los ${LIMITS.COLLECTION_DESCRIPTION_MAX} caracteres.`,
      );
    }
  }

  // color (DB-003): `#RRGGBB` o null.
  if (collection.color !== undefined && collection.color !== null) {
    if (typeof collection.color !== "string") {
      errors.push("El color debe ser texto.");
    } else if (!/^#[0-9a-fA-F]{6}$/.test(collection.color.trim())) {
      errors.push("El color debe tener el formato #RRGGBB.");
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Atajo booleano de validateCollection(). */
export function isValidCollection(collection) {
  return validateCollection(collection).valid;
}

/**
 * Normaliza una colección propia (DB-003): recorta textos y serializa
 * como `null` los campos opcionales ausentes. No muta el objeto recibido.
 */
export function normalizeCollection(data = {}) {
  const src =
    data && typeof data === "object" && !Array.isArray(data) ? data : {};
  return {
    name: typeof src.name === "string" ? src.name.trim() : "",
    description:
      typeof src.description === "string" ? src.description.trim() || null : null,
    color: typeof src.color === "string" ? src.color.trim() || null : null,
  };
}

// -------------------------------------------------------------
// 11.4 Estadísticas de favoritos — parte pura (REQ-005, AC-005)
// -------------------------------------------------------------

/**
 * Calcula las estadísticas de favoritos del dashboard (REQ-005, AC-005).
 * Función PURA: no toca Firestore ni el DOM.
 * @param {object[]} favoriteItems ítems con `isFavorite` (materializados)
 * @param {object[]} favoriteChapters capítulos favoritos (materializados)
 * @returns {{ count: number, recent: object[] }}
 *   `count` = total de favoritos; `recent` = hasta 5 entradas mezcladas
 *   ordenadas por `updatedAt` desc y, en empate, por `createdAt` desc.
 *   Cada entrada: `{ kind, mediaType, id, title, posterUrl?, parentItemId? }`.
 */
export function computeFavoritesStats(favoriteItems = [], favoriteChapters = []) {
  const items = Array.isArray(favoriteItems)
    ? favoriteItems.filter((entry) => entry && typeof entry === "object")
    : [];
  const chapters = Array.isArray(favoriteChapters)
    ? favoriteChapters.filter((entry) => entry && typeof entry === "object")
    : [];

  const entries = [];
  for (const item of items) {
    const entry = {
      kind: "item",
      mediaType: item.mediaType ?? null,
      id: item.id ?? null,
      title: item.title ?? "",
    };
    if (typeof item.posterUrl === "string" && item.posterUrl.trim().length > 0) {
      entry.posterUrl = item.posterUrl;
    }
    entries.push({ entry, source: item });
  }
  for (const chapter of chapters) {
    const entry = {
      kind: "chapter",
      mediaType: chapter.parentMediaType ?? null,
      id: chapter.id ?? null,
      title: chapter.title ?? "",
    };
    if (typeof chapter.parentItemId === "string" && chapter.parentItemId.length > 0) {
      entry.parentItemId = chapter.parentItemId;
    }
    entries.push({ entry, source: chapter });
  }

  entries.sort((a, b) => {
    const byUpdatedAt = toMillis(b.source.updatedAt) - toMillis(a.source.updatedAt);
    if (byUpdatedAt !== 0) return byUpdatedAt;
    return toMillis(b.source.createdAt) - toMillis(a.source.createdAt);
  });

  return {
    count: entries.length,
    recent: entries.slice(0, RECENT_FAVORITES_LIMIT).map((entry) => entry.entry),
  };
}

// -------------------------------------------------------------
// 11.5 STORE — favoritos de ítems (REQ-001, AC-001)
// -------------------------------------------------------------

/**
 * Marca / desmarca un ítem como favorito (REQ-001, AC-001, DB-001):
 * escribe `isFavorite`, refresca `updatedAt` y devuelve el ítem
 * materializado (docToItem).
 * @returns {Promise<object>} el ítem materializado
 */
export async function setItemFavorite(mediaType, itemId, isFavorite) {
  if (typeof isFavorite !== "boolean") {
    throw new Error("El valor de isFavorite debe ser booleano.");
  }
  const { db, auth, doc, getDoc, updateDoc, serverTimestamp } = await import(
    "./firebase.js"
  );
  const uid = requireUid(auth);
  const ref = doc(db, "users", uid, collectionNameFor(mediaType), itemId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("El ítem no existe.");
  await updateDoc(ref, { isFavorite, updatedAt: serverTimestamp() });
  const updated = await getDoc(ref);
  return docToItem(updated);
}

/**
 * Alterna el favorito de un ítem (REQ-001, AC-001): lee el estado actual,
 * lo invierte, refresca `updatedAt` y devuelve el ítem materializado.
 * @returns {Promise<object>} el ítem materializado
 */
export async function toggleItemFavorite(mediaType, itemId) {
  const { db, auth, doc, getDoc, updateDoc, serverTimestamp } = await import(
    "./firebase.js"
  );
  const uid = requireUid(auth);
  const ref = doc(db, "users", uid, collectionNameFor(mediaType), itemId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("El ítem no existe.");
  const current = docToItem(snapshot);
  const isFavorite = current.isFavorite !== true;
  await updateDoc(ref, { isFavorite, updatedAt: serverTimestamp() });
  const updated = await getDoc(ref);
  return docToItem(updated);
}

// -------------------------------------------------------------
// 11.6 STORE — capítulos favoritos (DB-002, REQ-002, AC-002, AC-014)
// -------------------------------------------------------------

/**
 * Materializa un documento de capítulo favorito: convierte `createdAt` y
 * `updatedAt` a `Date` (tsToDate) y aplica los defaults de DB-002.
 * No muta el documento original.
 */
export function docToChapter(snapshot) {
  const data = snapshot.data() || {};
  const chapter = { id: snapshot.id, ...data };
  chapter.createdAt = tsToDate(chapter.createdAt);
  chapter.updatedAt = tsToDate(chapter.updatedAt);
  chapter.isFavorite = chapter.isFavorite !== false;
  chapter.watchCount =
    typeof chapter.watchCount === "number" && Number.isFinite(chapter.watchCount)
      ? chapter.watchCount
      : 0;
  chapter.collectionIds = toCollectionIds(chapter.collectionIds);
  return chapter;
}

/**
 * Lista los capítulos favoritos (DB-002, REQ-012): orderBy("updatedAt",
 * "desc") + limit(100) y cursor opcional `startAfter`.
 * @returns {Promise<{items: object[], chapters: object[], lastDoc: object|null, hasMore: boolean}>}
 */
export async function listChapters(options = {}) {
  const { limitCount = DEFAULT_PAGE_SIZE, startAfter: cursor = null } = options || {};
  const { db, auth, collection, getDocs, query, orderBy, limit, startAfter } =
    await import("./firebase.js");
  const uid = requireUid(auth);
  const chaptersRef = collection(db, "users", uid, CHAPTERS_COLLECTION);
  const constraints = [orderBy("updatedAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(limitCount));
  const snapshot = await getDocs(query(chaptersRef, ...constraints));
  const docs = snapshot?.docs || [];
  const items = docs.map(docToChapter);
  return {
    items,
    chapters: items,
    lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore: docs.length >= limitCount,
  };
}

/**
 * Suscripción en vivo a los capítulos favoritos (DB-002, REQ-012).
 * @param {object|Function} optionsOrCallback `{ limitCount, startAfter, onItems, onError }` o la función onItems
 * @param {object} extraOptions opciones si el 2º parámetro es la función onItems
 * @returns {Promise<Function>} unsubscribe
 */
export async function subscribeChapters(optionsOrCallback = {}, extraOptions = {}) {
  const options =
    typeof optionsOrCallback === "function"
      ? { ...(extraOptions || {}), onItems: optionsOrCallback }
      : { ...(optionsOrCallback || {}) };
  const { limitCount = DEFAULT_PAGE_SIZE, startAfter: cursor = null, onItems, onError } =
    options;
  const { db, auth, collection, onSnapshot, query, orderBy, limit, startAfter } =
    await import("./firebase.js");
  const uid = requireUid(auth);
  const chaptersRef = collection(db, "users", uid, CHAPTERS_COLLECTION);
  const constraints = [orderBy("updatedAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(limitCount));
  const chaptersQuery = query(chaptersRef, ...constraints);
  return onSnapshot(chaptersQuery, {
    next: (snapshot) => {
      const docs = snapshot?.docs || [];
      const items = docs.map(docToChapter);
      if (typeof onItems === "function") {
        onItems(items, {
          items,
          chapters: items,
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

/**
 * Crea un capítulo favorito (DB-002, REQ-002, AC-002): valida, comprueba
 * que el ítem padre y las colecciones existen (§4.1 «Reglas»), guarda
 * createdAt/updatedAt con serverTimestamp y devuelve el capítulo con su id.
 * @returns {Promise<object>}
 */
export async function createChapter(data = {}) {
  const { db, auth, collection, doc, getDoc, addDoc, serverTimestamp } =
    await import("./firebase.js");
  const uid = requireUid(auth);
  const chapter = normalizeFavoriteChapter(data);
  const result = validateFavoriteChapter(chapter);
  if (!result.valid) throw validationError(result.errors);
  await assertParentItemExists(uid, chapter.parentMediaType, chapter.parentItemId, {
    db,
    doc,
    getDoc,
  });
  await assertCollectionsExist(uid, chapter.collectionIds, { db, doc, getDoc });
  const payload = {
    ...chapter,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, "users", uid, CHAPTERS_COLLECTION), payload);
  return { id: ref.id, ...chapter };
}

/**
 * Edita un capítulo favorito (DB-002, REQ-002): lee, fusiona el parche,
 * normaliza, valida, refresca `updatedAt` y devuelve el capítulo.
 * @returns {Promise<object>}
 */
export async function updateChapter(chapterId, patch = {}) {
  const { db, auth, doc, getDoc, updateDoc, serverTimestamp } = await import(
    "./firebase.js"
  );
  const uid = requireUid(auth);
  const ref = doc(db, "users", uid, CHAPTERS_COLLECTION, chapterId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("El capítulo favorito no existe.");
  const current = docToChapter(snapshot);
  const merged = { ...current, ...(patch || {}) };
  delete merged.id;
  const chapter = normalizeFavoriteChapter(merged);
  const result = validateFavoriteChapter(chapter);
  if (!result.valid) throw validationError(result.errors);
  await assertParentItemExists(uid, chapter.parentMediaType, chapter.parentItemId, {
    db,
    doc,
    getDoc,
  });
  await assertCollectionsExist(
    uid,
    newCollectionIds(current.collectionIds, chapter.collectionIds),
    { db, doc, getDoc },
  );
  const payload = buildUpdatePayload(current, chapter);
  for (const key of Object.keys(payload)) {
    if (payload[key] === null && !Object.prototype.hasOwnProperty.call(current, key)) {
      delete payload[key];
    }
  }
  payload.updatedAt = serverTimestamp();
  await updateDoc(ref, payload);
  return { id: chapterId, ...chapter };
}

/**
 * Borra un capítulo favorito (DB-002, AC-014): borrarlo elimina el
 * favorito y NO afecta al ítem padre.
 * @returns {Promise<boolean>}
 */
export async function deleteChapter(chapterId) {
  const { db, auth, doc, deleteDoc } = await import("./firebase.js");
  const uid = requireUid(auth);
  await deleteDoc(doc(db, "users", uid, CHAPTERS_COLLECTION, chapterId));
  return true;
}

// -------------------------------------------------------------
// 11.7 STORE — colecciones propias (DB-003, REQ-006, AC-006, AC-009)
// -------------------------------------------------------------

/**
 * Materializa un documento de colección: convierte `createdAt` y
 * `updatedAt` a `Date` (tsToDate). No muta el documento original.
 */
export function docToCollection(snapshot) {
  const data = snapshot.data() || {};
  const collection = { id: snapshot.id, ...data };
  collection.createdAt = tsToDate(collection.createdAt);
  collection.updatedAt = tsToDate(collection.updatedAt);
  if (collection.description === undefined) collection.description = null;
  if (collection.color === undefined) collection.color = null;
  return collection;
}

/**
 * Lista las colecciones propias (DB-003, REQ-012).
 * @returns {Promise<{items: object[], collections: object[], lastDoc: object|null, hasMore: boolean}>}
 */
export async function listCollections(options = {}) {
  const { limitCount = DEFAULT_PAGE_SIZE, startAfter: cursor = null } = options || {};
  const { db, auth, collection, getDocs, query, orderBy, limit, startAfter } =
    await import("./firebase.js");
  const uid = requireUid(auth);
  const collectionsRef = collection(db, "users", uid, COLLECTIONS_COLLECTION);
  const constraints = [orderBy("updatedAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(limitCount));
  const snapshot = await getDocs(query(collectionsRef, ...constraints));
  const docs = snapshot?.docs || [];
  const items = docs.map(docToCollection);
  return {
    items,
    collections: items,
    lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore: docs.length >= limitCount,
  };
}

/**
 * Suscripción en vivo a las colecciones propias (DB-003, REQ-012).
 * @param {object|Function} optionsOrCallback `{ limitCount, startAfter, onItems, onError }` o la función onItems
 * @param {object} extraOptions opciones si el 2º parámetro es la función onItems
 * @returns {Promise<Function>} unsubscribe
 */
export async function subscribeCollections(optionsOrCallback = {}, extraOptions = {}) {
  const options =
    typeof optionsOrCallback === "function"
      ? { ...(extraOptions || {}), onItems: optionsOrCallback }
      : { ...(optionsOrCallback || {}) };
  const { limitCount = DEFAULT_PAGE_SIZE, startAfter: cursor = null, onItems, onError } =
    options;
  const { db, auth, collection, onSnapshot, query, orderBy, limit, startAfter } =
    await import("./firebase.js");
  const uid = requireUid(auth);
  const collectionsRef = collection(db, "users", uid, COLLECTIONS_COLLECTION);
  const constraints = [orderBy("updatedAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(limitCount));
  const collectionsQuery = query(collectionsRef, ...constraints);
  return onSnapshot(collectionsQuery, {
    next: (snapshot) => {
      const docs = snapshot?.docs || [];
      const items = docs.map(docToCollection);
      if (typeof onItems === "function") {
        onItems(items, {
          items,
          collections: items,
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

/**
 * Crea una colección propia (DB-003, REQ-006, AC-006): valida, guarda
 * createdAt/updatedAt con serverTimestamp y devuelve la colección con su id.
 * @returns {Promise<object>}
 */
export async function createCollection(data = {}) {
  const { db, auth, collection, addDoc, serverTimestamp } = await import(
    "./firebase.js"
  );
  const uid = requireUid(auth);
  const entity = normalizeCollection(data);
  const result = validateCollection(entity);
  if (!result.valid) throw validationError(result.errors);
  const payload = {
    ...entity,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, "users", uid, COLLECTIONS_COLLECTION), payload);
  return { id: ref.id, ...entity };
}

/**
 * Edita una colección propia (DB-003, REQ-006, AC-006): lee, fusiona el
 * parche, normaliza, valida, refresca `updatedAt` y la devuelve.
 * @returns {Promise<object>}
 */
export async function updateCollection(collectionId, patch = {}) {
  const { db, auth, doc, getDoc, updateDoc, serverTimestamp } = await import(
    "./firebase.js"
  );
  const uid = requireUid(auth);
  const ref = doc(db, "users", uid, COLLECTIONS_COLLECTION, collectionId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("La colección no existe.");
  const current = docToCollection(snapshot);
  const merged = { ...current, ...(patch || {}) };
  delete merged.id;
  const entity = normalizeCollection(merged);
  const result = validateCollection(entity);
  if (!result.valid) throw validationError(result.errors);
  const payload = buildUpdatePayload(current, entity);
  payload.updatedAt = serverTimestamp();
  await updateDoc(ref, payload);
  return { id: collectionId, ...entity };
}

/**
 * Lee los `collectionIds` actuales de un documento para el unlink
 * best-effort (AC-009): toma los datos del snapshot de la consulta y, si el
 * snapshot no trae el campo, refresca con `getDoc`.
 * El unlink es read-modify-write (leer → filtrar → escribir el array
 * completo): nunca se persiste un "sentinel" de borrado que pise el resto
 * de ids del documento.
 * @returns {Promise<string[]>}
 */
async function readCollectionIdsForUnlink(ref, docSnapshot, getDoc) {
  const snapshotData =
    (typeof docSnapshot?.data === "function" ? docSnapshot.data() : null) || {};
  const snapshotIds = Array.isArray(snapshotData.collectionIds)
    ? [...snapshotData.collectionIds]
    : [];
  if (snapshotIds.length > 0) return snapshotIds;
  if (typeof getDoc !== "function") return snapshotIds;
  try {
    const fresh = await getDoc(ref);
    const data = (typeof fresh?.data === "function" ? fresh.data() : null) || {};
    return Array.isArray(data.collectionIds) ? [...data.collectionIds] : [];
  } catch {
    return snapshotIds;
  }
}

/**
 * Borra una colección y DESVINCULA (sin borrar) los ítems y capítulos que
 * la tenían (DB-003, REQ-006, AC-009, D-004).
 * La desvinculación es best-effort: si algún documento falla, se informa
 * en `failures` para que la UI lo reporte y pueda reintentar.
 * @returns {Promise<{
 *   deleted: boolean,
 *   unlinkedItems: number,
 *   unlinkedChapters: number,
 *   failures: Array<{ kind: string, id: string, error: Error }>
 * }>}
 */
export async function deleteCollection(collectionId) {
  const { db, auth, collection, doc, getDoc, getDocs, query, updateDoc, deleteDoc, serverTimestamp } =
    await import("./firebase.js");
  const uid = requireUid(auth);
  const failures = [];
  let unlinkedItems = 0;
  let unlinkedChapters = 0;

  // Ítems de las 5 colecciones de tipo (movies, series, games, books, anime).
  for (const mediaType of MEDIA_TYPES) {
    const collectionName = TYPE_TO_COLLECTION[mediaType];
    let docs = [];
    try {
      const snapshot = await getDocs(query(collection(db, "users", uid, collectionName)));
      docs = snapshot?.docs || [];
    } catch (error) {
      failures.push({ kind: "item", id: mediaType, scope: "collection", error });
      continue;
    }
    for (const docSnapshot of docs) {
      const ref = doc(db, "users", uid, collectionName, docSnapshot.id);
      const ids = await readCollectionIdsForUnlink(ref, docSnapshot, getDoc);
      if (!ids.includes(collectionId)) continue;
      try {
        await updateDoc(ref, {
          collectionIds: ids.filter((id) => id !== collectionId),
          updatedAt: serverTimestamp(),
        });
        unlinkedItems += 1;
      } catch (error) {
        failures.push({ kind: "item", id: docSnapshot.id, mediaType, error });
      }
    }
  }

  // Capítulos favoritos.
  try {
    const snapshot = await getDocs(query(collection(db, "users", uid, CHAPTERS_COLLECTION)));
    const docs = snapshot?.docs || [];
    for (const docSnapshot of docs) {
      const ref = doc(db, "users", uid, CHAPTERS_COLLECTION, docSnapshot.id);
      const ids = await readCollectionIdsForUnlink(ref, docSnapshot, getDoc);
      if (!ids.includes(collectionId)) continue;
      try {
        await updateDoc(ref, {
          collectionIds: ids.filter((id) => id !== collectionId),
          updatedAt: serverTimestamp(),
        });
        unlinkedChapters += 1;
      } catch (error) {
        failures.push({ kind: "chapter", id: docSnapshot.id, error });
      }
    }
  } catch (error) {
    failures.push({ kind: "chapter", id: CHAPTERS_COLLECTION, scope: "collection", error });
  }

  await deleteDoc(doc(db, "users", uid, COLLECTIONS_COLLECTION, collectionId));
  return { deleted: true, unlinkedItems, unlinkedChapters, failures };
}

// -------------------------------------------------------------
// 11.8 STORE — pertenencia a colecciones (REQ-007, AC-007)
// -------------------------------------------------------------

/**
 * Añade un objetivo (ítem o capítulo favorito) a una colección
 * (REQ-007, AC-007): deduplica, respeta el límite de 20 colecciones,
 * refresca `updatedAt` y devuelve el objetivo ya actualizado.
 * @param {"item"|"chapter"} kind
 * @param {string} id id del ítem o del capítulo
 * @param {string} collectionId id de la colección
 * @param {string} [mediaType] obligatorio si `kind` es "item"
 * @returns {Promise<object>} el objetivo materializado y actualizado
 */
export async function addTargetToCollection(kind, id, collectionId, mediaType) {
  const targetId = assertTargetId(kind, id, mediaType);
  const collectionRef = assertCollectionId(collectionId);
  const { db, auth, doc, getDoc, updateDoc, serverTimestamp } = await import(
    "./firebase.js"
  );
  const uid = requireUid(auth);
  const isItem = kind === "item";
  const ref = isItem
    ? doc(db, "users", uid, collectionNameFor(mediaType), targetId)
    : doc(db, "users", uid, CHAPTERS_COLLECTION, targetId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new Error(isItem ? "El ítem no existe." : "El capítulo favorito no existe.");
  }
  const current = isItem ? docToItem(snapshot) : docToChapter(snapshot);
  const currentIds = toCollectionIds(current.collectionIds);
  const nextIds = currentIds.includes(collectionRef)
    ? currentIds.slice()
    : [...currentIds, collectionRef];
  if (nextIds.length > MAX_COLLECTIONS_PER_TARGET) {
    throw validationError([
      `No se pueden guardar más de ${MAX_COLLECTIONS_PER_TARGET} colecciones.`,
    ]);
  }
  await updateDoc(ref, { collectionIds: nextIds, updatedAt: serverTimestamp() });
  const updated = await getDoc(ref);
  return isItem ? docToItem(updated) : docToChapter(updated);
}

/**
 * Quita un objetivo (ítem o capítulo favorito) de una colección
 * (REQ-007, AC-007): actualiza `collectionIds`, refresca `updatedAt` y
 * devuelve el objetivo ya actualizado.
 * @param {"item"|"chapter"} kind
 * @param {string} id id del ítem o del capítulo
 * @param {string} collectionId id de la colección
 * @param {string} [mediaType] obligatorio si `kind` es "item"
 * @returns {Promise<object>} el objetivo materializado y actualizado
 */
export async function removeTargetFromCollection(kind, id, collectionId, mediaType) {
  const targetId = assertTargetId(kind, id, mediaType);
  const collectionRef = assertCollectionId(collectionId);
  const { db, auth, doc, getDoc, updateDoc, serverTimestamp } = await import(
    "./firebase.js"
  );
  const uid = requireUid(auth);
  const isItem = kind === "item";
  const ref = isItem
    ? doc(db, "users", uid, collectionNameFor(mediaType), targetId)
    : doc(db, "users", uid, CHAPTERS_COLLECTION, targetId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new Error(isItem ? "El ítem no existe." : "El capítulo favorito no existe.");
  }
  const current = isItem ? docToItem(snapshot) : docToChapter(snapshot);
  const nextIds = toCollectionIds(current.collectionIds).filter(
    (entry) => entry !== collectionRef,
  );
  await updateDoc(ref, { collectionIds: nextIds, updatedAt: serverTimestamp() });
  const updated = await getDoc(ref);
  return isItem ? docToItem(updated) : docToChapter(updated);
}

/** Alias de addTargetToCollection() (tasks.md T-003). */
export function addToCollection(kind, id, collectionId, mediaType) {
  return addTargetToCollection(kind, id, collectionId, mediaType);
}

/** Alias de removeTargetFromCollection() (tasks.md T-003). */
export function removeFromCollection(kind, id, collectionId, mediaType) {
  return removeTargetFromCollection(kind, id, collectionId, mediaType);
}

// -------------------------------------------------------------
// 11.9 Helpers internos del store de favoritos/colecciones
// -------------------------------------------------------------

/** Valida el `kind` del objetivo y devuelve su id normalizado. */
function assertTargetId(kind, id, mediaType) {
  if (kind !== "item" && kind !== "chapter") {
    throw new Error(`Tipo de objetivo no válido: "${kind}". Valores permitidos: item, chapter.`);
  }
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("El id del objetivo es obligatorio.");
  }
  if (kind === "item") {
    if (!mediaType) {
      throw new Error("Se necesita el mediaType del ítem para gestionarlo en colecciones.");
    }
    collectionNameFor(mediaType); // valida el tipo (lanza si no es válido)
  }
  return id.trim();
}

/** Valida el id de la colección y lo devuelve normalizado. */
function assertCollectionId(collectionId) {
  if (typeof collectionId !== "string" || collectionId.trim().length === 0) {
    throw new Error("El id de la colección es obligatorio.");
  }
  return collectionId.trim();
}

/** Ids de colección NUEVOS (los que no estaban antes) — §4.1 «Reglas». */
function newCollectionIds(currentIds, nextIds) {
  const current = toCollectionIds(currentIds);
  return toCollectionIds(nextIds).filter((entry) => !current.includes(entry));
}

/**
 * Comprueba que el ítem padre de un capítulo exista (§4.1 «Reglas»:
 * «parentItemId inexistente» bloquea la escritura).
 */
async function assertParentItemExists(uid, parentMediaType, parentItemId, fb) {
  if (!isChapterParentMediaType(parentMediaType) || !parentItemId) return;
  const { db, doc, getDoc } = fb;
  const snapshot = await getDoc(
    doc(db, "users", uid, TYPE_TO_COLLECTION[parentMediaType], parentItemId),
  );
  const exists = typeof snapshot?.exists === "function" ? snapshot.exists() : false;
  if (!exists) {
    throw validationError([`El ítem padre "${parentItemId}" no existe.`]);
  }
}

/**
 * Comprueba que las colecciones referenciadas existan (§4.1 «Reglas»:
 * «collectionIds con ... id inexistente» bloquea la escritura).
 */
async function assertCollectionsExist(uid, collectionIds, fb) {
  const ids = toCollectionIds(collectionIds);
  if (ids.length === 0) return;
  const { db, doc, getDoc } = fb;
  const missing = [];
  for (const id of ids) {
    const snapshot = await getDoc(doc(db, "users", uid, COLLECTIONS_COLLECTION, id));
    const exists = typeof snapshot?.exists === "function" ? snapshot.exists() : false;
    if (!exists) missing.push(id);
  }
  if (missing.length > 0) {
    throw validationError([`No existen las colecciones: ${missing.join(", ")}.`]);
  }
}
