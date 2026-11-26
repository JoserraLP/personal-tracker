// =============================================================
// Estado y lógica pura de la sección Películas.
//
// Este módulo no importa Firebase ni toca la red: es la capa que la
// vista puede probar y reutilizar sin efectos secundarios.
//
//   - ALG-M01: `computeStats` calcula la barra de estadísticas.
//   - ALG-M02: `filterMovies` y `sortMovies` filtran y ordenan en
//     cliente (nulls al final y colación es-ES).
//   - ALG-M04: `parseUserRating` valida la nota personal.
//   - UI-M09: `STATUS_LABELS` traduce los estados internos al español.
//   - D-M08: `TMDB_GENRES_ES` es el diccionario estático de géneros.
//
// También exporta las opciones de pestañas y el estado inicial de los
// filtros de «Mi biblioteca» (UI-M01, UI-M05).
// =============================================================

/** Texto que se muestra cuando una estadística no tiene datos. */
const DASH = "—";

// -------------------------------------------------------------
// Etiquetas y opciones de UI (UI-M05, UI-M06, UI-M09)
// -------------------------------------------------------------

/**
 * Estado interno (inglés, DB-M01) → etiqueta visible (UI-M09).
 * Nunca debe mostrarse el valor interno en la interfaz (AC-M09).
 */
export const STATUS_LABELS = Object.freeze({
  watchlist: "Pendiente",
  watching: "Viendo",
  watched: "Vista",
  dropped: "Abandonada",
});

/** Estados en el orden de los selectores de la ficha (UI-M06). */
export const STATUS_OPTIONS = Object.freeze(
  ["watchlist", "watching", "watched", "dropped"].map((value) =>
    Object.freeze({ value, label: STATUS_LABELS[value] })
  )
);

/**
 * Opciones del selector de estado de «Mi biblioteca» (UI-M05).
 * `favorites` es un pseudofiltro (`isFavorite === true`), no un estado.
 */
export const LIBRARY_STATUS_OPTIONS = Object.freeze([
  Object.freeze({ value: "", label: "Todos" }),
  Object.freeze({ value: "watchlist", label: "Pendientes" }),
  Object.freeze({ value: "watching", label: "Viendo" }),
  Object.freeze({ value: "watched", label: "Vistas" }),
  Object.freeze({ value: "dropped", label: "Abandonadas" }),
  Object.freeze({ value: "favorites", label: "Favoritas" }),
]);

/** Orden por defecto de la biblioteca (UI-M05). */
export const DEFAULT_SORT_KEY = "addedAt";

/**
 * Claves y etiquetas de orden (ALG-M02, UI-M05). El primer elemento
 * es el orden por defecto. `direction` describe el sentido primario;
 * los nulls siempre quedan al final.
 */
export const SORT_OPTIONS = Object.freeze([
  Object.freeze({
    value: "addedAt",
    label: "Fecha de añadido",
    direction: "desc",
  }),
  Object.freeze({
    value: "lastWatchedAt",
    label: "Último visionado",
    direction: "desc",
  }),
  Object.freeze({
    value: "userRating",
    label: "Mi puntuación",
    direction: "desc",
  }),
  Object.freeze({
    value: "tmdbRating",
    label: "Puntuación TMDB",
    direction: "desc",
  }),
  Object.freeze({
    value: "watchCount",
    label: "Veces vista",
    direction: "desc",
  }),
  Object.freeze({
    value: "releaseYear",
    label: "Año de estreno",
    direction: "desc",
  }),
  Object.freeze({
    value: "title",
    label: "Título (A-Z)",
    direction: "asc",
  }),
]);

const SORT_KEYS = new Set(SORT_OPTIONS.map((option) => option.value));

// -------------------------------------------------------------
// Diccionario de géneros TMDB (D-M08)
// -------------------------------------------------------------

/**
 * Diccionario estático id de TMDB → nombre en español. Se usa tanto
 * en el filtro de la biblioteca como en el alta manual (D-M08).
 */
export const TMDB_GENRES_ES = Object.freeze({
  28: "Acción",
  12: "Aventura",
  16: "Animación",
  35: "Comedia",
  80: "Crimen",
  99: "Documental",
  18: "Drama",
  10751: "Familia",
  14: "Fantasía",
  36: "Historia",
  27: "Terror",
  10402: "Música",
  9648: "Misterio",
  10749: "Romance",
  878: "Ciencia ficción",
  10770: "Película de TV",
  53: "Suspense",
  10752: "Guerra",
  37: "Western",
});

/**
 * El mismo diccionario como lista ordenada de `{ id, label }`, lista
 * para rellenar directamente un `<select>` o un multi-select.
 */
export const TMDB_GENRE_OPTIONS = Object.freeze(
  [
    28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878,
    10770, 53, 10752, 37,
  ].map((id) => Object.freeze({ id, label: TMDB_GENRES_ES[id] }))
);

/** Etiqueta española de un género o `null` si no está en el diccionario. */
export function genreLabel(genreId) {
  const id = toOptionalInteger(genreId);
  if (id === null) return null;
  return Object.prototype.hasOwnProperty.call(TMDB_GENRES_ES, id)
    ? TMDB_GENRES_ES[id]
    : null;
}

// -------------------------------------------------------------
// Pestañas y estado inicial (UI-M01, UI-M05)
// -------------------------------------------------------------

/** Pestañas de la sección, en el orden de la barra (UI-M01). */
export const MOVIE_TABS = Object.freeze([
  Object.freeze({
    key: "catalog",
    label: "Explorar catálogo",
    tabId: "movies-tab-catalog",
    panelId: "movies-panel-catalog",
  }),
  Object.freeze({
    key: "library",
    label: "Mi biblioteca",
    tabId: "movies-tab-library",
    panelId: "movies-panel-library",
  }),
  Object.freeze({
    key: "collections",
    label: "Mis colecciones",
    tabId: "movies-tab-collections",
    panelId: "movies-panel-collections",
  }),
]);

const TAB_KEYS = new Set(MOVIE_TABS.map((tab) => tab.key));

/** Pestaña activa al abrir la sección. */
export const DEFAULT_TAB = "catalog";

/** Filtros de la biblioteca sin aplicar (UI-M05). */
export const DEFAULT_LIBRARY_FILTERS = Object.freeze({
  query: "",
  status: "",
  favorite: false,
  genreId: null,
  collectionId: "",
  ratingMin: null,
  ratingMax: null,
  sort: DEFAULT_SORT_KEY,
});

// -------------------------------------------------------------
// Helpers de normalización numérica y de texto
// -------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Número opcional de un control de formulario. Acepta coma decimal
 * («7,5») además de punto. Vacío o inválido se trata como no fijado.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toOptionalNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Entero opcional (por ejemplo el id de género de un `<select>`).
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toOptionalInteger(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Texto de búsqueda comparable: NFD, sin marcas diacríticas, en
 * minúsculas y sin espacios en los extremos (ALG-M02, AC-M19).
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .trim();
}

/** Título no vacío o `null` (los títulos vacíos también van al final). */
function normalizeTitle(value) {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title === "" ? null : title;
}

/** Año, nota o contador ordenable; valores no numéricos cuentan como null. */
function toSortableNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Convierte timestamps de Firestore (`toMillis`/`toDate`), `Date`,
 * números o cadenas ISO a milisegundos ordenables. Lo no reconocido
 * se considera null.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toSortableMillis(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (isPlainObject(value)) {
    if (typeof value.toMillis === "function") {
      try {
        const millis = value.toMillis();
        return Number.isFinite(millis) ? millis : null;
      } catch {
        return null;
      }
    }
    if (typeof value.toDate === "function") {
      try {
        const millis = value.toDate().getTime();
        return Number.isFinite(millis) ? millis : null;
      } catch {
        return null;
      }
    }
    if (Number.isFinite(value.seconds)) {
      const fraction = Number.isFinite(value.nanoseconds)
        ? value.nanoseconds / 1e6
        : 0;
      return value.seconds * 1000 + fraction;
    }
  }

  return null;
}

/** Cuenta de visionados defensiva: 0 si no es un número válido. */
function toWatchCount(value) {
  const parsed = toSortableNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : 0;
}

/**
 * Formatea con un decimal y coma decimal española (ALG-M01). Se
 * redondea antes de formatear para que 7,75 se muestre como «7,8» y
 * 8 como «8,0» (AC-M20).
 *
 * @param {number} value
 * @returns {string}
 */
const oneDecimalFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatOneDecimal(value) {
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return oneDecimalFormatter.format(rounded);
}

// -------------------------------------------------------------
// ALG-M01 — Estadísticas de la biblioteca
// -------------------------------------------------------------

/**
 * Calcula la barra de estadísticas a partir del snapshot de la
 * biblioteca (ALG-M01, AC-M20).
 *
 * Los recuentos son números; las horas y las medias se devuelven ya
 * formateadas con un decimal y coma es-ES para pintarlas tal cual.
 * Con la biblioteca vacía todas las cifras son «—».
 *
 * @param {Array<Record<string, unknown>>} movies
 * @returns {{
 *   totalWatched: number|string,
 *   totalRewatches: number|string,
 *   totalHours: string,
 *   pendingCount: number|string,
 *   avgUserRating: string,
 *   avgTmdbRating: string
 * }}
 */
export function computeStats(movies) {
  const list = Array.isArray(movies) ? movies : [];

  if (list.length === 0) {
    return {
      totalWatched: DASH,
      totalRewatches: DASH,
      totalHours: DASH,
      pendingCount: DASH,
      avgUserRating: DASH,
      avgTmdbRating: DASH,
    };
  }

  let totalWatched = 0;
  let totalRewatches = 0;
  let pendingCount = 0;
  let hoursSum = 0;
  let hasRuntime = false;
  let userRatingSum = 0;
  let userRatingCount = 0;
  let tmdbRatingSum = 0;
  let tmdbRatingCount = 0;

  for (const movie of list) {
    if (!isPlainObject(movie)) continue;

    if (movie.status === "watched") totalWatched += 1;
    if (movie.status === "watchlist") pendingCount += 1;

    const watchCount = toWatchCount(movie.watchCount);
    totalRewatches += watchCount;

    // Solo las películas con duración aportan horas (ALG-M01).
    if (
      typeof movie.runtime === "number" &&
      Number.isFinite(movie.runtime)
    ) {
      hoursSum += movie.runtime * watchCount;
      hasRuntime = true;
    }

    if (
      typeof movie.userRating === "number" &&
      Number.isFinite(movie.userRating)
    ) {
      userRatingSum += movie.userRating;
      userRatingCount += 1;
    }

    if (
      typeof movie.tmdbRating === "number" &&
      Number.isFinite(movie.tmdbRating)
    ) {
      tmdbRatingSum += movie.tmdbRating;
      tmdbRatingCount += 1;
    }
  }

  return {
    totalWatched,
    totalRewatches,
    totalHours: hasRuntime ? formatOneDecimal(hoursSum / 60) : DASH,
    pendingCount,
    avgUserRating:
      userRatingCount > 0
        ? formatOneDecimal(userRatingSum / userRatingCount)
        : DASH,
    avgTmdbRating:
      tmdbRatingCount > 0
        ? formatOneDecimal(tmdbRatingSum / tmdbRatingCount)
        : DASH,
  };
}

// -------------------------------------------------------------
// ALG-M02 — Filtros de cliente (AC-M18)
// -------------------------------------------------------------

/**
 * @typedef {Object} LibraryFilters
 * @property {string} [query] Búsqueda sobre título y título original.
 * @property {string} [status] Estado interno, "" o "favorites".
 * @property {boolean} [favorite] Pseudofiltro equivalente a "favorites".
 * @property {number|string|null} [genreId] Id TMDB del género.
 * @property {string} [collectionId] Id de colección.
 * @property {number|string|null} [ratingMin] Extremo inferior 0–10.
 * @property {number|string|null} [ratingMax] Extremo superior 0–10.
 */

/**
 * Filtra en cliente la biblioteca (ALG-M02, AC-M18). Los filtros se
 * combinan con AND. Si se fija algún extremo de la nota, las
 * películas sin `userRating` se excluyen (AC-M19).
 *
 * @param {Array<Record<string, unknown>>} movies
 * @param {LibraryFilters} [filters]
 * @returns {Array<Record<string, unknown>>}
 */
export function filterMovies(movies, filters = {}) {
  const list = Array.isArray(movies) ? movies : [];
  const input = isPlainObject(filters) ? filters : {};

  const query = normalizeSearchText(input.query);

  const rawStatus =
    typeof input.status === "string" ? input.status.trim() : "";
  const statusFilter =
    rawStatus !== "" && rawStatus !== "favorites" ? rawStatus : null;
  const wantsFavorite = input.favorite === true || rawStatus === "favorites";

  const genreId = toOptionalInteger(input.genreId);
  const collectionId =
    typeof input.collectionId === "string" ? input.collectionId.trim() : "";
  const ratingMin = toOptionalNumber(input.ratingMin);
  const ratingMax = toOptionalNumber(input.ratingMax);
  const hasRatingRange = ratingMin !== null || ratingMax !== null;

  return list.filter((movie) => {
    if (!isPlainObject(movie)) return false;

    if (statusFilter !== null && movie.status !== statusFilter) {
      return false;
    }

    if (wantsFavorite && movie.isFavorite !== true) {
      return false;
    }

    if (genreId !== null) {
      const genreIds = Array.isArray(movie.genreIds)
        ? movie.genreIds.map((id) => toOptionalInteger(id))
        : [];
      if (!genreIds.includes(genreId)) return false;
    }

    if (collectionId !== "") {
      const collectionIds = Array.isArray(movie.collectionIds)
        ? movie.collectionIds
        : [];
      if (!collectionIds.includes(collectionId)) return false;
    }

    if (hasRatingRange) {
      const rating =
        typeof movie.userRating === "number" &&
        Number.isFinite(movie.userRating)
          ? movie.userRating
          : null;

      if (rating === null) return false;
      if (ratingMin !== null && rating < ratingMin) return false;
      if (ratingMax !== null && rating > ratingMax) return false;
    }

    if (query !== "") {
      const haystack = normalizeSearchText(
        `${movie.title ?? ""} ${movie.originalTitle ?? ""}`
      );
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

// -------------------------------------------------------------
// ALG-M02 — Orden de cliente (AC-M19)
// -------------------------------------------------------------

const titleCollator = new Intl.Collator("es-ES");

/** Compara dos títulos con la colación es-ES; los vacíos van al final. */
function compareTitles(a, b) {
  const titleA = normalizeTitle(a?.title);
  const titleB = normalizeTitle(b?.title);

  if (titleA === null && titleB === null) return 0;
  if (titleA === null) return 1;
  if (titleB === null) return -1;
  return titleCollator.compare(titleA, titleB);
}

/** Valor primario de ordenación para una clave de ALG-M02. */
function sortableValue(movie, key) {
  if (!isPlainObject(movie)) return null;

  if (key === "addedAt" || key === "lastWatchedAt") {
    return toSortableMillis(movie[key]);
  }

  return toSortableNumber(movie[key]);
}

/**
 * Ordena una copia de la biblioteca (ALG-M02, AC-M19).
 *
 * - `addedAt`, `lastWatchedAt`, `userRating`, `tmdbRating`,
 *   `watchCount` y `releaseYear`: descendente.
 * - `title`: ascendente con `Intl.Collator("es-ES")`.
 * - Los valores ausentes o null quedan siempre al final.
 * - Desempate: título ascendente.
 *
 * @param {Array<Record<string, unknown>>} movies
 * @param {string} [sortKey]
 * @returns {Array<Record<string, unknown>>}
 */
export function sortMovies(movies, sortKey = DEFAULT_SORT_KEY) {
  const list = Array.isArray(movies) ? movies.slice() : [];
  const key = SORT_KEYS.has(sortKey) ? sortKey : DEFAULT_SORT_KEY;

  return list.sort((a, b) => {
    if (key === "title") return compareTitles(a, b);

    const valueA = sortableValue(a, key);
    const valueB = sortableValue(b, key);

    // Nulls siempre al final, en ambos sentidos.
    if (valueA === null && valueB === null) return compareTitles(a, b);
    if (valueA === null) return 1;
    if (valueB === null) return -1;

    // Resto de claves: descendente.
    if (valueA < valueB) return 1;
    if (valueA > valueB) return -1;

    // Desempate: título ascendente.
    return compareTitles(a, b);
  });
}

// -------------------------------------------------------------
// ALG-M04 — Nota personal (AC-M12)
// -------------------------------------------------------------

/** Mensaje exacto que la UI muestra al rechazar una nota (ALG-M04). */
export const USER_RATING_ERROR_MESSAGE =
  "Introduce una nota entre 0 y 10, en medios puntos.";

/** Error de validación de la nota personal, con `code` estable. */
export class UserRatingError extends Error {
  /**
   * @param {string} [message]
   */
  constructor(message = USER_RATING_ERROR_MESSAGE) {
    super(message);
    this.name = "UserRatingError";
    this.code = "INVALID_USER_RATING";
  }
}

/**
 * Convierte el valor de un campo de nota a `number | null`
 * (ALG-M04, AC-M12).
 *
 * Acepta «7,5» y «7.5». Vacío, `null` o `undefined` devuelven
 * `null`. Un valor no numérico, fuera de 0–10 o que no sea múltiplo
 * de 0,5 lanza `UserRatingError` con el mensaje en español; en ese
 * caso no se guarda nada.
 *
 * @param {unknown} raw
 * @returns {number|null}
 * @throws {UserRatingError}
 */
export function parseUserRating(raw) {
  if (raw === null || raw === undefined) return null;

  let candidate;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    candidate = Number(trimmed.replace(",", "."));
  } else if (typeof raw === "number") {
    candidate = raw;
  } else {
    throw new UserRatingError();
  }

  const isValid =
    Number.isFinite(candidate) &&
    candidate >= 0 &&
    candidate <= 10 &&
    Math.abs(candidate * 2 - Math.round(candidate * 2)) < 1e-9;

  if (!isValid) throw new UserRatingError();

  return candidate;
}

// -------------------------------------------------------------
// Estado inicial de pestañas y filtros (UI-M01, UI-M05)
// -------------------------------------------------------------

/**
 * Crea una copia normalizada de los filtros de la biblioteca.
 * Los valores desconocidos vuelven a su valor por defecto.
 *
 * @param {Partial<LibraryFilters>} [overrides]
 * @returns {{
 *   query: string,
 *   status: string,
 *   favorite: boolean,
 *   genreId: number|null,
 *   collectionId: string,
 *   ratingMin: number|null,
 *   ratingMax: number|null,
 *   sort: string
 * }}
 */
export function createLibraryFilters(overrides = {}) {
  const input = isPlainObject(overrides) ? overrides : {};

  const rawStatus =
    typeof input.status === "string" ? input.status.trim() : "";
  const status = LIBRARY_STATUS_OPTIONS.some(
    (option) => option.value === rawStatus
  )
    ? rawStatus
    : "";

  return {
    query: typeof input.query === "string" ? input.query : "",
    status,
    favorite: input.favorite === true,
    genreId: toOptionalInteger(input.genreId),
    collectionId:
      typeof input.collectionId === "string"
        ? input.collectionId.trim()
        : "",
    ratingMin: toOptionalNumber(input.ratingMin),
    ratingMax: toOptionalNumber(input.ratingMax),
    sort: SORT_KEYS.has(input.sort) ? input.sort : DEFAULT_SORT_KEY,
  };
}

/**
 * `true` si hay algún filtro activo (el orden no cuenta). La vista lo
 * usa para decidir si «Limpiar filtros» tiene algo que limpiar.
 *
 * @param {Partial<LibraryFilters>} [filters]
 * @returns {boolean}
 */
export function hasActiveLibraryFilters(filters = {}) {
  const normalized = createLibraryFilters(filters);

  return (
    normalized.query.trim() !== "" ||
    normalized.status !== "" ||
    normalized.favorite ||
    normalized.genreId !== null ||
    normalized.collectionId !== "" ||
    normalized.ratingMin !== null ||
    normalized.ratingMax !== null
  );
}

/**
 * Estado inicial de la sección: pestaña activa y filtros de la
 * biblioteca. La vista puede mutar su propia copia sin afectar al
 * módulo.
 *
 * @param {{ activeTab?: string, libraryFilters?: Partial<LibraryFilters> }} [overrides]
 * @returns {{
 *   activeTab: string,
 *   libraryFilters: ReturnType<typeof createLibraryFilters>
 * }}
 */
export function createMoviesState(overrides = {}) {
  const input = isPlainObject(overrides) ? overrides : {};
  const activeTab = TAB_KEYS.has(input.activeTab)
    ? input.activeTab
    : DEFAULT_TAB;

  return {
    activeTab,
    libraryFilters: createLibraryFilters(input.libraryFilters),
  };
}
