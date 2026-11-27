// =============================================================
// Estado y lógica pura de la sección Series.
//
// Módulo ESM puro: no toca el DOM, no hace red y no importa Firebase
// ni nada de `js/movies/*` (aislamiento por categoría). Es la capa que
// `seriesRepository.js` y `seriesView.js` comparten y pueden probar sin
// efectos secundarios.
//
//   - ALG-S01: `computeSeriesStats` calcula la barra de estadísticas.
//   - ALG-S02: `filterSeries` y `sortSeries` filtran y ordenan en cliente
//     (nulls al final, colación es-ES y progreso con `numberOfEpisodes`
//     nulo al final).
//   - ALG-S03: `episodeKey` y `computeCurrentEpisode` calculan la posición
//     del siguiente episodio.
//   - ALG-S04: `parseUserRating` valida la nota personal 0–10 (paso 0,5).
//   - UI-S12: `STATUS_LABELS` y `TMDB_STATUS_LABELS` traducen los valores
//     internos ingleses a español.
//   - D-S08: `TV_GENRES_ES` es el diccionario estático de géneros de TV.
//
// ALG-S09 (`incRewatch`/`decRewatch`) escribe `Timestamp` y
// `serverTimestamp()` en Firestore, así que vive en `seriesRepository.js`
// para no romper la pureza de este módulo.
// =============================================================

/** Texto que se muestra cuando una estadística no tiene datos. */
const DASH = "—";

/** Minutos por episodio cuando `episodeRuntime` es null/undefined (D-S13). */
const DEFAULT_EPISODE_RUNTIME = 45;

// -------------------------------------------------------------
// Etiquetas y opciones de UI (UI-S12, UI-S05)
// -------------------------------------------------------------

/**
 * Estado interno (inglés, DB-S01) → etiqueta visible (UI-S12, AC-S09).
 * Nunca debe mostrarse el valor interno en la interfaz.
 */
export const STATUS_LABELS = Object.freeze({
  watchlist: "Pendiente",
  watching: "Viendo",
  watched: "Completada",
  dropped: "Abandonada",
});

/** Estados en el orden de los selectores de la ficha (UI-S06). */
export const STATUS_OPTIONS = Object.freeze(
  ["watchlist", "watching", "watched", "dropped"].map((value) =>
    Object.freeze({ value, label: STATUS_LABELS[value] })
  )
);

/**
 * Estado crudo de TMDB → etiqueta visible (UI-S12). Cualquier valor no
 * contemplado (o `null`) se muestra como «—», nunca en inglés.
 */
export const TMDB_STATUS_LABELS = Object.freeze({
  "Returning Series": "En emisión",
  Ended: "Finalizada",
  Canceled: "Cancelada",
  "In Production": "En producción",
});

/**
 * Etiqueta española de un estado de TMDB.
 *
 * @param {unknown} raw
 * @returns {string} Etiqueta conocida o «—».
 */
export function tmdbStatusLabel(raw) {
  if (typeof raw !== "string") return DASH;
  const key = raw.trim();
  return Object.prototype.hasOwnProperty.call(TMDB_STATUS_LABELS, key)
    ? TMDB_STATUS_LABELS[key]
    : DASH;
}

/**
 * Opciones del selector de estado de «Mi biblioteca» (UI-S05).
 * `favorites` es un pseudofiltro (`isFavorite === true`), no un estado.
 */
export const LIBRARY_STATUS_OPTIONS = Object.freeze([
  Object.freeze({ value: "", label: "Todos" }),
  Object.freeze({ value: "watchlist", label: "Pendientes" }),
  Object.freeze({ value: "watching", label: "Viendo" }),
  Object.freeze({ value: "watched", label: "Completadas" }),
  Object.freeze({ value: "dropped", label: "Abandonadas" }),
  Object.freeze({ value: "favorites", label: "Favoritas" }),
]);

/** Orden por defecto de la biblioteca (UI-S05). */
export const DEFAULT_SORT_KEY = "addedAt";

/**
 * Claves y etiquetas de orden (ALG-S02, UI-S05). El primer elemento es
 * el orden por defecto. `direction` describe el sentido primario; los
 * nulls siempre quedan al final.
 */
export const SORT_OPTIONS = Object.freeze([
  Object.freeze({
    value: "addedAt",
    label: "Fecha de añadido",
    direction: "desc",
  }),
  Object.freeze({
    value: "lastWatchedAt",
    label: "Último episodio visto",
    direction: "desc",
  }),
  Object.freeze({
    value: "progress",
    label: "Progreso",
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
    value: "firstAirYear",
    label: "Año de estreno",
    direction: "desc",
  }),
  Object.freeze({
    value: "name",
    label: "Título (A-Z)",
    direction: "asc",
  }),
]);

const SORT_KEYS = new Set(SORT_OPTIONS.map((option) => option.value));

const SORT_DIRECTIONS = new Map(
  SORT_OPTIONS.map((option) => [option.value, option.direction])
);

// -------------------------------------------------------------
// Diccionario de géneros de TV (D-S08)
// -------------------------------------------------------------

/**
 * Diccionario estático id de género de TV de TMDB → nombre es-ES
 * (D-S08). Son ids de TV, distintos de los de cine. Se usa tanto en el
 * filtro de la biblioteca como en el alta manual.
 */
export const TV_GENRES_ES = Object.freeze({
  10759: "Acción y aventura",
  16: "Animación",
  35: "Comedia",
  80: "Crimen",
  99: "Documental",
  18: "Drama",
  10751: "Familia",
  10765: "Ciencia ficción y fantasía",
  10764: "Realidad",
  10767: "Programas de entrevistas",
  10768: "Guerra y política",
  37: "Western",
});

/** El mismo diccionario como lista de `{ id, label }` para los selectores. */
export const TV_GENRE_OPTIONS = Object.freeze(
  [
    10759, 16, 35, 80, 99, 18, 10751, 10765, 10764, 10767, 10768, 37,
  ].map((id) => Object.freeze({ id, label: TV_GENRES_ES[id] }))
);

/** Etiqueta española de un género de TV o `null` si no está en el mapa. */
export function genreLabel(genreId) {
  const id = toOptionalInteger(genreId);
  if (id === null) return null;
  return Object.prototype.hasOwnProperty.call(TV_GENRES_ES, id)
    ? TV_GENRES_ES[id]
    : null;
}

// -------------------------------------------------------------
// Filtros por defecto (UI-S05)
// -------------------------------------------------------------

/** Filtros de la biblioteca sin aplicar (UI-S05). */
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
// Helpers de normalización
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

/** Contador defensivo: entero no negativo; cualquier otra cosa cuenta 0. */
function toCount(value) {
  const parsed = toSortableNumber(value);
  if (parsed === null || parsed < 0) return 0;
  return Math.trunc(parsed);
}

/**
 * Texto de búsqueda comparable: NFD, sin marcas diacríticas, en
 * minúsculas y sin espacios en los extremos (ALG-S02).
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

/** Nombre no vacío o `null` (los nombres vacíos también van al final). */
function normalizeName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name === "" ? null : name;
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
 * números o cadenas ISO a milisegundos ordenables. Lo no reconocido se
 * considera null.
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

/**
 * Formatea con un decimal y coma decimal española (ALG-S01). Se
 * redondea comercialmente antes de formatear para que 7,75 se muestre
 * como «7,8» y 8 como «8,0» (AC-S26).
 *
 * @param {number} value
 * @returns {string}
 */
const oneDecimalFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatOneDecimal(value) {
  const rounded = Math.round(value * 10) / 10;
  return oneDecimalFormatter.format(rounded);
}

const nameCollator = new Intl.Collator("es-ES");

/** Compara dos nombres con la colación es-ES; los vacíos van al final. */
function compareNames(a, b) {
  const nameA = normalizeName(a?.name);
  const nameB = normalizeName(b?.name);

  if (nameA === null && nameB === null) return 0;
  if (nameA === null) return 1;
  if (nameB === null) return -1;
  return nameCollator.compare(nameA, nameB);
}

// -------------------------------------------------------------
// ALG-S01 — Estadísticas de la biblioteca (AC-S26)
// -------------------------------------------------------------

/**
 * Calcula la barra de estadísticas a partir del snapshot de la
 * biblioteca (ALG-S01, AC-S26).
 *
 * Los recuentos son números; las horas y ambas medias se devuelven ya
 * redondeadas a 1 decimal y formateadas con coma es-ES para pintarlas
 * tal cual. Con la biblioteca vacía todas las cifras son «—».
 *
 * Horas: `watchedEpisodesCount × (episodeRuntime ?? 45) / 60`. El
 * respaldo de 45 min aplica solo si `episodeRuntime` es null o
 * undefined; un 0, un negativo o NaN se usan tal cual (ALG-S01).
 *
 * @param {Array<Record<string, unknown>>} series
 * @returns {{
 *   completedCount: number|string,
 *   watchingCount: number|string,
 *   totalEpisodes: number|string,
 *   favoriteEpisodes: number|string,
 *   totalHours: string,
 *   pendingCount: number|string,
 *   avgUserRating: string,
 *   avgTmdbRating: string
 * }}
 */
export function computeSeriesStats(series) {
  const list = Array.isArray(series) ? series : [];

  if (list.length === 0) {
    return {
      completedCount: DASH,
      watchingCount: DASH,
      totalEpisodes: DASH,
      favoriteEpisodes: DASH,
      totalHours: DASH,
      pendingCount: DASH,
      avgUserRating: DASH,
      avgTmdbRating: DASH,
    };
  }

  let completedCount = 0;
  let watchingCount = 0;
  let pendingCount = 0;
  let totalEpisodes = 0;
  let favoriteEpisodes = 0;
  let runtimeMinutes = 0;
  let userRatingSum = 0;
  let userRatingCount = 0;
  let tmdbRatingSum = 0;
  let tmdbRatingCount = 0;

  for (const item of list) {
    if (!isPlainObject(item)) continue;

    if (item.status === "watched") completedCount += 1;
    else if (item.status === "watching") watchingCount += 1;
    else if (item.status === "watchlist") pendingCount += 1;

    const watchedEpisodes = toCount(item.watchedEpisodesCount);
    totalEpisodes += watchedEpisodes;
    favoriteEpisodes += toCount(item.favoriteEpisodesCount);

    // Regla estricta de ALG-S01: `episodeRuntime ?? 45`. El valor por
    // defecto solo aplica a null/undefined; 0, negativos o NaN se
    // respetan tal cual y no se sustituyen por 45.
    const runtime = item.episodeRuntime ?? DEFAULT_EPISODE_RUNTIME;
    runtimeMinutes += watchedEpisodes * runtime;

    if (typeof item.userRating === "number" && Number.isFinite(item.userRating)) {
      userRatingSum += item.userRating;
      userRatingCount += 1;
    }

    if (typeof item.tmdbRating === "number" && Number.isFinite(item.tmdbRating)) {
      tmdbRatingSum += item.tmdbRating;
      tmdbRatingCount += 1;
    }
  }

  return {
    completedCount,
    watchingCount,
    totalEpisodes,
    favoriteEpisodes,
    totalHours: formatOneDecimal(runtimeMinutes / 60),
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
// ALG-S02 — Filtros de cliente (AC-S24)
// -------------------------------------------------------------

/**
 * @typedef {Object} SeriesLibraryFilters
 * @property {string} [query] Búsqueda sobre `name` y `originalName`.
 * @property {string} [status] Estado interno, "" o "favorites".
 * @property {boolean} [favorite] Pseudofiltro equivalente a "favorites".
 * @property {number|string|null} [genreId] Id de género de TV.
 * @property {string} [collectionId] Id de colección.
 * @property {number|string|null} [ratingMin] Extremo inferior 0–10.
 * @property {number|string|null} [ratingMax] Extremo superior 0–10.
 */

/**
 * Filtra en cliente la biblioteca (ALG-S02, AC-S24). Los filtros se
 * combinan con AND. Los extremos del rango de nota son inclusivos; si
 * alguno está fijado, las series con `userRating` nulo se excluyen.
 *
 * @param {Array<Record<string, unknown>>} series
 * @param {SeriesLibraryFilters} [filters]
 * @returns {Array<Record<string, unknown>>}
 */
export function filterSeries(series, filters = {}) {
  const list = Array.isArray(series) ? series : [];
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

  return list.filter((item) => {
    if (!isPlainObject(item)) return false;

    if (statusFilter !== null && item.status !== statusFilter) return false;

    if (wantsFavorite && item.isFavorite !== true) return false;

    if (genreId !== null) {
      const genreIds = Array.isArray(item.genreIds)
        ? item.genreIds.map((id) => toOptionalInteger(id))
        : [];
      if (!genreIds.includes(genreId)) return false;
    }

    if (collectionId !== "") {
      const collectionIds = Array.isArray(item.collectionIds)
        ? item.collectionIds
        : [];
      if (!collectionIds.includes(collectionId)) return false;
    }

    if (hasRatingRange) {
      const rating =
        typeof item.userRating === "number" && Number.isFinite(item.userRating)
          ? item.userRating
          : null;

      if (rating === null) return false;
      if (ratingMin !== null && rating < ratingMin) return false;
      if (ratingMax !== null && rating > ratingMax) return false;
    }

    if (query !== "") {
      const haystack = normalizeSearchText(
        `${item.name ?? ""} ${item.originalName ?? ""}`
      );
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

// -------------------------------------------------------------
// ALG-S02 — Orden de cliente (AC-S25)
// -------------------------------------------------------------

/**
 * Razón de progreso `watchedEpisodesCount / numberOfEpisodes`
 * (ALG-S02). Sin `numberOfEpisodes` válido no hay valor ordenable:
 * devuelve `null` y la serie queda al final (AC-S25).
 *
 * @param {Record<string, unknown>} item
 * @returns {number|null}
 */
function progressValue(item) {
  const numberOfEpisodes = toSortableNumber(item.numberOfEpisodes);
  if (
    numberOfEpisodes === null ||
    numberOfEpisodes <= 0 ||
    !Number.isFinite(numberOfEpisodes)
  ) {
    return null;
  }
  return toCount(item.watchedEpisodesCount) / numberOfEpisodes;
}

/** Valor primario de ordenación para una clave de ALG-S02. */
function sortableValue(item, key) {
  if (!isPlainObject(item)) return null;

  if (key === "addedAt" || key === "lastWatchedAt") {
    return toSortableMillis(item[key]);
  }

  if (key === "progress") return progressValue(item);

  return toSortableNumber(item[key]);
}

/**
 * Ordena una copia de la biblioteca (ALG-S02, AC-S25).
 *
 * - `addedAt`, `lastWatchedAt`, `progress`, `userRating`, `tmdbRating` y
 *   `firstAirYear`: descendente.
 * - `name`: ascendente con `Intl.Collator("es-ES")`.
 * - Los valores ausentes o null quedan siempre al final, también en
 *   `progress` cuando `numberOfEpisodes` es nulo.
 * - Desempate: nombre ascendente con colación es-ES.
 *
 * @param {Array<Record<string, unknown>>} series
 * @param {string} [sortKey]
 * @returns {Array<Record<string, unknown>>}
 */
export function sortSeries(series, sortKey = DEFAULT_SORT_KEY) {
  const list = Array.isArray(series) ? series.slice() : [];
  const key = SORT_KEYS.has(sortKey) ? sortKey : DEFAULT_SORT_KEY;
  const direction = SORT_DIRECTIONS.get(key) ?? "desc";

  return list.sort((a, b) => {
    if (key === "name") return compareNames(a, b);

    const valueA = sortableValue(a, key);
    const valueB = sortableValue(b, key);

    // Nulls siempre al final, en ambos sentidos.
    if (valueA === null && valueB === null) return compareNames(a, b);
    if (valueA === null) return 1;
    if (valueB === null) return -1;

    if (valueA === valueB) return compareNames(a, b);

    const ascending = valueA < valueB ? -1 : 1;
    return direction === "asc" ? ascending : -ascending;
  });
}

// -------------------------------------------------------------
// ALG-S03 — Clave de episodio y posición actual (AC-S11, AC-S12)
// -------------------------------------------------------------

/** Temporada/episodio con dos dígitos (los números mayores conservan cifras). */
function pad2(value) {
  return String(value).padStart(2, "0");
}

const EPISODE_KEY_PATTERN = /^S(\d+)E(\d+)$/;

/**
 * Clave estándar de un episodio: `S` + temporada a 2 dígitos + `E` +
 * episodio a 2 dígitos, en mayúsculas (ALG-S03). Es el id del documento
 * `episodes/{episodeKey}`.
 *
 * @param {number|string} season
 * @param {number|string} episode
 * @returns {string}
 * @throws {TypeError} Si temporada o episodio no son enteros ≥ 1.
 */
export function episodeKey(season, episode) {
  const seasonNumber = toOptionalInteger(season);
  const episodeNumber = toOptionalInteger(episode);

  if (seasonNumber === null || seasonNumber < 1) {
    throw new TypeError("Número de temporada no válido.");
  }
  if (episodeNumber === null || episodeNumber < 1) {
    throw new TypeError("Número de episodio no válido.");
  }

  return `S${pad2(seasonNumber)}E${pad2(episodeNumber)}`;
}

/**
 * @typedef {Object} EpisodePosition
 * @property {number} season Temporada del siguiente episodio.
 * @property {number} episode Episodio del siguiente episodio.
 * @property {number} currentSeason Alias de `season` (DB-S01).
 * @property {number} currentEpisode Alias de `episode` (DB-S01).
 */

/**
 * Primera posición `(temporada, episodio)` en orden natural que no está
 * vista (ALG-S03, AC-S11, AC-S12).
 *
 * - Sin episodios vistos devuelve `(1, 1)`.
 * - Si todo está visto devuelve la posición siguiente a la última.
 * - `seasonLengths` es el número de episodios conocidos por temporada
 *   (objeto o `Map` con la temporada como clave). Si una temporada no
 *   aparece, se usa el máximo episodio visto de esa temporada.
 * - Las claves vistas se aceptan como `Set`, array o cualquier iterable,
 *   en formato `S01E01` (también se tolera `S1E1`).
 *
 * @param {Iterable<string>} watchedKeys
 * @param {Record<string|number, number>|Map<number, number>} [seasonLengths]
 * @returns {EpisodePosition}
 */
export function computeCurrentEpisode(watchedKeys, seasonLengths) {
  /** @type {Map<number, Set<number>>} */
  const watchedBySeason = new Map();
  let maxWatchedSeason = 0;

  const iterable =
    watchedKeys !== null &&
    watchedKeys !== undefined &&
    typeof watchedKeys !== "string" &&
    typeof watchedKeys[Symbol.iterator] === "function"
      ? watchedKeys
      : [];

  for (const rawKey of iterable) {
    if (typeof rawKey !== "string") continue;
    const match = EPISODE_KEY_PATTERN.exec(rawKey.trim().toUpperCase());
    if (match === null) continue;

    const season = Number(match[1]);
    const episode = Number(match[2]);
    if (!Number.isInteger(season) || !Number.isInteger(episode)) continue;
    if (season < 1 || episode < 1) continue;

    let episodes = watchedBySeason.get(season);
    if (episodes === undefined) {
      episodes = new Set();
      watchedBySeason.set(season, episodes);
    }
    episodes.add(episode);
    if (season > maxWatchedSeason) maxWatchedSeason = season;
  }

  if (watchedBySeason.size === 0) {
    return { season: 1, episode: 1, currentSeason: 1, currentEpisode: 1 };
  }

  /** Longitud conocida por temporada, normalizada. */
  const knownLengths = new Map();
  const lengthEntries =
    seasonLengths instanceof Map
      ? [...seasonLengths.entries()]
      : isPlainObject(seasonLengths) || Array.isArray(seasonLengths)
        ? Object.entries(seasonLengths)
        : [];

  for (const [rawSeason, rawLength] of lengthEntries) {
    const season = toOptionalInteger(rawSeason);
    const length = toOptionalInteger(rawLength);
    if (season === null || season < 1 || length === null || length < 0) {
      continue;
    }
    knownLengths.set(season, length);
  }

  const maxKnownSeason = knownLengths.size > 0
    ? Math.max(...knownLengths.keys())
    : 0;
  const lastSeason = Math.max(1, maxWatchedSeason, maxKnownSeason);

  /** Longitud efectiva: la de TMDB o el máximo episodio visto. */
  function seasonLength(season) {
    const known = knownLengths.get(season);
    if (known !== undefined) return known;
    const episodes = watchedBySeason.get(season);
    if (episodes === undefined) return 0;
    return Math.max(...episodes);
  }

  for (let season = 1; season <= lastSeason; season += 1) {
    const length = seasonLength(season);
    const episodes = watchedBySeason.get(season);

    for (let episode = 1; episode <= length; episode += 1) {
      if (episodes === undefined || !episodes.has(episode)) {
        return { season, episode, currentSeason: season, currentEpisode: episode };
      }
    }
  }

  // Todo visto: posición siguiente a la última.
  const finalEpisode = seasonLength(lastSeason) + 1;
  return {
    season: lastSeason,
    episode: finalEpisode,
    currentSeason: lastSeason,
    currentEpisode: finalEpisode,
  };
}

// -------------------------------------------------------------
// ALG-S04 — Nota personal 0–10 con paso 0,5 (AC-S15)
// -------------------------------------------------------------

/** Mensaje exacto que la UI muestra al rechazar una nota (ALG-S04). */
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
 * Convierte el valor de un campo de nota a `number | null` (ALG-S04,
 * AC-S15).
 *
 * Acepta «7,5» y «7.5». Vacío, `null` o `undefined` devuelven `null`.
 * Un valor no numérico, fuera de 0–10 o que no sea múltiplo de 0,5
 * lanza `UserRatingError` con el mensaje en español; en ese caso no se
 * guarda nada.
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
// Filtros normalizados (UI-S05)
// -------------------------------------------------------------

/**
 * Crea una copia normalizada de los filtros de la biblioteca. Los
 * valores desconocidos vuelven a su valor por defecto.
 *
 * @param {Partial<SeriesLibraryFilters & { sort?: string }>} [overrides]
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

// -------------------------------------------------------------
// NFR-S01 — Benchmark de rendimiento (solo desarrollo)
//
// Mide `computeSeriesStats` + `filterSeries` + `sortSeries` con 500
// documentos sintéticos: 20 repeticiones y p95 ≤ 100 ms. No amplía la
// API pública del módulo: se ejecuta a mano con
// `SERIES_BENCH=1 node js/series/seriesState.js` y no tiene efecto
// alguno al importar el módulo desde la vista o desde los tests.
//
// Valores de referencia registrados (27/11/2026, Node v24.14.1 en
// Windows y Chrome headless a 1280×900): p95 = 1,63 ms con 500
// documentos y 20 repeticiones; render inicial de `#series-section`
// tras pulsar «Series» = 47,2 ms con 500 tarjetas (repositorio
// sustituido por un stub sin red). Ambos valores están anotados en el
// PR de T-S15 (#112).
// -------------------------------------------------------------

/** Documentos sintéticos del benchmark (NFR-S01). */
const BENCHMARK_DOCUMENTS = 500;

/** Repeticiones del benchmark (NFR-S01). */
const BENCHMARK_REPETITIONS = 20;

/** Presupuesto de p95 en milisegundos (NFR-S01). */
const BENCHMARK_P95_BUDGET_MS = 100;

/**
 * Géneros de TV usados por los documentos sintéticos (D-S08): solo
 * ids presentes en `TV_GENRES_ES`.
 */
const BENCHMARK_GENRES = Object.freeze([18, 35, 80, 99, 10765]);

/** Estados internos barajados en la biblioteca sintética (DB-S01). */
const BENCHMARK_STATUSES = Object.freeze([
  "watched",
  "watching",
  "watchlist",
  "dropped",
]);

/**
 * Generador pseudoaleatorio determinista (LCG): el benchmark da el
 * mismo conjunto de documentos en cada ejecución.
 *
 * @param {number} [seed]
 * @returns {() => number} Número en [0, 1).
 */
function createBenchmarkRandom(seed = 20261127) {
  let value = seed >>> 0;

  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/**
 * Crea la biblioteca sintética de NFR-S01 con la forma de una serie
 * normalizada (`seriesRepository.normalizeSeries`).
 *
 * @param {number} [count]
 * @returns {Array<Record<string, unknown>>}
 */
function createBenchmarkSeries(count = BENCHMARK_DOCUMENTS) {
  const random = createBenchmarkRandom();
  const pick = (list) => list[Math.floor(random() * list.length)];
  const baseMillis = 1764547200000; // 2025-12-01T00:00:00Z
  const dayMillis = 86400000;
  const library = [];

  for (let index = 0; index < count; index += 1) {
    const numberOfEpisodes =
      random() < 0.15 ? null : 8 + Math.floor(random() * 80);
    const watchedEpisodesCount =
      numberOfEpisodes === null
        ? Math.floor(random() * 40)
        : Math.floor(random() * (numberOfEpisodes + 1));

    library.push({
      id: `bench-${String(index).padStart(4, "0")}`,
      name: `Serie ${index} ${pick(["Ámbar", "Ñandú", "Zeta", "Índigo"])}`,
      originalName: `Show ${index}`,
      status: pick(BENCHMARK_STATUSES),
      isFavorite: random() < 0.25,
      genreIds: [
        random() < 0.5 ? 18 : pick(BENCHMARK_GENRES),
        pick(BENCHMARK_GENRES),
      ],
      collectionIds: random() < 0.5 ? [`col-${1 + Math.floor(random() * 2)}`] : [],
      userRating: random() < 0.3 ? null : Math.round(random() * 20) / 2,
      tmdbRating: random() < 0.2 ? null : Math.round(random() * 100) / 10,
      addedAt: baseMillis - index * dayMillis,
      lastWatchedAt: random() < 0.3 ? null : baseMillis - index * dayMillis / 2,
      firstAirYear: 1990 + Math.floor(random() * 35),
      watchedEpisodesCount,
      favoriteEpisodesCount: Math.floor(random() * 10),
      numberOfEpisodes,
      episodeRuntime: random() < 0.3 ? null : 22 + Math.floor(random() * 40),
    });
  }

  return library;
}

/**
 * Percentil por rango más cercano (nearest-rank), sin interpolación
 * entre muestras. Sin muestras es un error: un p95 = 0 daría un PASS
 * falso.
 *
 * @param {number[]} values
 * @param {number} fraction 0–1.
 * @returns {number}
 * @throws {Error} Si no hay muestras.
 */
function benchmarkPercentile(values, fraction) {
  if (values.length === 0) {
    throw new Error("El benchmark no tiene muestras que medir.");
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[index];
}

/**
 * Una pasada completa del pipeline de NFR-S01: estadísticas de la
 * biblioteca completa, filtro combinado (AC-S24) y orden por progreso
 * (AC-S25) sobre los 500 documentos.
 *
 * @param {Array<Record<string, unknown>>} library
 * @returns {{stats: Record<string, unknown>, filtered: number, sorted: number}}
 */
function runBenchmarkPipeline(library) {
  const stats = computeSeriesStats(library);

  // AC-S24: estado + género + colección + rango 8–10 (los cuatro a la vez).
  const combined = filterSeries(library, {
    status: "watched",
    genreId: 18,
    collectionId: "col-1",
    ratingMin: 8,
    ratingMax: 10,
  });

  // AC-S24: «Limpiar filtros» devuelve la lista completa.
  const cleared = filterSeries(library, {});

  // Búsqueda sobre `name` + `originalName` (normalización NFD).
  const searched = filterSeries(library, { query: "serie 4" });

  const sorted = sortSeries(library, "progress");

  return {
    stats,
    filtered: combined.length + cleared.length + searched.length,
    sorted: sorted.length,
  };
}

/**
 * Ejecuta el benchmark de NFR-S01 y devuelve las muestras en ms.
 *
 * @param {number} [repetitions]
 * @returns {{
 *   documents: number,
 *   repetitions: number,
 *   samples: number[],
 *   p95: number,
 *   max: number,
 *   median: number,
 *   budget: number,
 *   passed: boolean,
 *   filtered: number,
 *   sortVariants: number
 * }}
 */
function runSeriesBenchmark(repetitions = BENCHMARK_REPETITIONS) {
  const library = createBenchmarkSeries();

  // Sin `performance.now()` no hay resolución sub-milisegundo: usar
  // `Date.now()` falsearía las muestras, así que el benchmark aborta.
  if (
    typeof performance === "undefined" ||
    typeof performance.now !== "function"
  ) {
    throw new Error(
      "El benchmark de NFR-S01 requiere performance.now()."
    );
  }

  const now = () => performance.now();

  // Una pasada de calentamiento (JIT) que no entra en la muestra.
  const warmup = runBenchmarkPipeline(library);

  const samples = [];
  let lastResult = warmup;

  for (let index = 0; index < repetitions; index += 1) {
    const start = now();
    lastResult = runBenchmarkPipeline(library);
    samples.push(now() - start);
  }

  const p95 = benchmarkPercentile(samples, 0.95);
  const budget = BENCHMARK_P95_BUDGET_MS;

  return {
    documents: library.length,
    repetitions: samples.length,
    samples,
    p95,
    max: benchmarkPercentile(samples, 1),
    median: benchmarkPercentile(samples, 0.5),
    budget,
    passed: samples.length === BENCHMARK_REPETITIONS && p95 <= budget,
    filtered: lastResult.filtered,
    sortVariants: SORT_OPTIONS.length,
  };
}

/**
 * Punto de entrada manual del benchmark (NFR-S01). No se exporta: la
 * API pública del módulo no cambia.
 *
 * @returns {void}
 */
function reportSeriesBenchmark() {
  const result = runSeriesBenchmark();
  const label = result.passed ? "PASS" : "FAIL";
  const round = (value) => Math.round(value * 1000) / 1000;

  console.log(
    `[NFR-S01] ${label} p95=${round(result.p95)} ms ` +
      `(≤ ${result.budget} ms), mediana=${round(result.median)} ms, ` +
      `máx=${round(result.max)} ms, ${result.documents} documentos, ` +
      `${result.repetitions} repeticiones`
  );
  console.log(
    `[NFR-S01-JSON] ${JSON.stringify({
      documents: result.documents,
      repetitions: result.repetitions,
      p95Ms: round(result.p95),
      medianMs: round(result.median),
      maxMs: round(result.max),
      budgetMs: result.budget,
      passed: result.passed,
      filteredCount: result.filtered,
      samplesMs: result.samples.map(round),
    })}`
  );
}

// El benchmark solo se ejecuta al lanzar este módulo como script
// principal (`SERIES_BENCH=1 node js/series/seriesState.js`). La
// comprobación de `process.argv[1]` impide que se dispare al importarlo
// desde `seriesView.js`, los tests u otra herramienta.
const benchmarkEntryFile =
  typeof process !== "undefined" &&
  process &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === "string"
    ? process.argv[1]
    : "";

if (
  benchmarkEntryFile.endsWith("seriesState.js") &&
  process.env &&
  process.env.SERIES_BENCH === "1"
) {
  reportSeriesBenchmark();
}
