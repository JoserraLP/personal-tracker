// =============================================================
// seriesView.js — Vista de la sección «Series».
//
// Alcance de esta tarea (T-S06):
//   - UI-S01: conmutación de las tres pestañas («Explorar
//     catálogo», «Mi biblioteca», «Mis colecciones») con
//     `role="tablist"`, `aria-selected` y navegación por teclado.
//   - UI-S02: barra de estadísticas siempre visible sobre las
//     pestañas, con etiquetas en español (ALG-S01, AC-S26).
//   - UI-S03: catálogo con buscador instantáneo (debounce 300 ms,
//     mínimo 2 caracteres) y las cuatro listas de la página 1 de
//     TMDB; con resultados de búsqueda las listas se ocultan.
//   - UI-S04: tarjeta de serie compartida por catálogo y biblioteca
//     (póster `w500`, título, año, `★ vote_average`, badge de
//     estado en español con `data-status`, barra «6/24 · 25%»,
//     «×N» de revisionados, «Añadir», favorito con `aria-pressed`
//     y «+1 Episodio»).
//   - ALG-S01: las estadísticas salen de `computeSeriesStats`
//     (`js/series/seriesState.js`); aquí no se recalculan.
//   - REQ-S12: la sección vive dentro de `#app-main` y se monta
//     desde la navegación principal (T-S11).
//
// Alcance de esta tarea (T-S07):
//   - UI-S05 / REQ-S13: «Mi biblioteca» con buscador instantáneo
//     (debounce 300 ms), filtros combinables (estado o favoritas,
//     género, colección y rango de nota 0–10 con paso 0,5), las
//     siete claves de orden de `SORT_OPTIONS`, «Limpiar filtros»,
//     contador «1 serie» / «N series» y dos estados vacíos
//     distintos (biblioteca vacía / sin resultados).
//   - ALG-S02: el filtrado y el orden se aplican en cliente sobre el
//     snapshot que devuelve el servidor con sus filtros; al
//     servidor solo van la igualdad (`status` o `isFavorite`) y los
//     dos `array-contains` (`genreIds`, `collectionIds`).
//   - AC-S13: el favorito de la tarjeta se actualiza de forma
//     optimista, repinta la rejilla cuando la serie deja de cumplir
//     el filtro activo y devuelve el foco al botón pulsado.
//   - AC-S24 y AC-S25: los filtros se combinan con AND y las siete
//     claves de orden respetan la colación es-ES, los nulls al
//     final y el progreso sin `numberOfEpisodes` al final.
//
// Alcance de esta tarea (T-S08):
//   - UI-S06: ficha completa en `<dialog id="series-detail">` con los
//     tres bloques de la tabla de UI-S06 (catálogo, seguimiento y
//     guardado): metadatos de TMDB (póster, backdrop, títulos, fecha
//     de estreno, «3 temporadas · 24 episodios», estado de emisión
//     traducido, cadenas, géneros, sinopsis, creadores, reparto,
//     tráiler, «Dónde ver» y «TMDB 8,4 (12.345 votos)»).
//   - ALG-S06: la ficha respeta la caché de 30 días
//     (`ensureDetailCached`); «Actualizar datos» fuerza la recarga.
//   - D-S09: estado, favorito, «+1 Episodio», revisionados y
//     colecciones se guardan de inmediato; nota, reseña, etiquetas y
//     spoilers requieren «Guardar» y avisan con
//     `series-detail-dirty-warning` mientras hay cambios pendientes.
//   - ALG-S04: la nota personal se valida con `parseUserRating`
//     (0–10 en medios puntos) y el error va en español.
//   - AC-S32: la nota de TMDB y la nota personal se muestran
//     separadas («TMDB 8,4 (12.345 votos)» y «Mi nota 8,5»).
//   - UI-S11: alta manual de series sin conexión, con avisos en
//     español y sin ninguna llamada a TMDB (AC-S08, AC-S01, AC-S06).
//
// Tareas siguientes (mismo fichero, en cadena): T-S09 (bloque de
// episodios) y T-S10 (colecciones). Por eso el módulo deja estos
// enganches: `getSeriesViewState` para el estado vivo y
// `refreshSeriesStats` para las estadísticas.
//
// Dependencias ya implementadas (se consumen, no se duplican):
//   - `js/series/seriesState.js` (T-S03): etiquetas de estado,
//     orden y `computeSeriesStats` (puros).
//   - `js/series/seriesRepository.js` (T-S02): biblioteca en
//     Firestore, altas y acciones sobre episodios.
//   - `js/series/tmdbTvClient.js` (T-S01): único punto de red.
//   - `index.html` (T-S04): esqueleto con los ids estables.
//   - `css/series.css` (T-S05): estilos de la sección.
//
// Todos los textos visibles están en español (es-ES) y el fichero va
// en UTF-8 sin BOM (NFR-S03).
// =============================================================

import {
  DEFAULT_SORT_KEY,
  LIBRARY_STATUS_OPTIONS,
  SORT_OPTIONS,
  STATUS_LABELS,
  STATUS_OPTIONS,
  TV_GENRE_OPTIONS,
  USER_RATING_ERROR_MESSAGE,
  UserRatingError,
  computeSeriesStats,
  createLibraryFilters,
  filterSeries,
  parseUserRating,
  sortSeries,
  tmdbStatusLabel,
} from "./seriesState.js";

import {
  MAX_REWATCH_COUNT,
  addFromTmdb,
  addManual,
  decRewatch,
  deleteSeries,
  ensureDetailCached,
  incRewatch,
  setCollections,
  setEpisodeWatched,
  setFavorite,
  setStatus,
  subscribeCollections,
  subscribeSeries,
  updatePersonal,
} from "./seriesRepository.js";

import {
  backdropUrl,
  fetchOnTheAir,
  fetchPopularSeries,
  fetchTopRatedSeries,
  fetchTrendingWeek,
  getSeriesDetail,
  isTmdbConfigured,
  posterUrl,
  searchSeries,
  trailerUrl,
} from "./tmdbTvClient.js";

// -------------------------------------------------------------
// Constantes de la vista
// -------------------------------------------------------------

/** Debounce del buscador instantáneo (NFR-S04). */
const SEARCH_DEBOUNCE_MS = 300;

/** Longitud mínima de la consulta para buscar en TMDB (API-S01). */
const MIN_SEARCH_CHARS = 2;

/** Tamaño de póster de las tarjetas (API-S08). */
const POSTER_SIZE = "w500";

/**
 * Pestañas de la sección (UI-S01). Los ids son estables (REQ-C2) y
 * coinciden con el esqueleto de `index.html`.
 */
export const SERIES_TABS = Object.freeze([
  Object.freeze({
    key: "catalog",
    tabId: "series-tab-catalog",
    panelId: "series-panel-catalog",
    label: "Explorar catálogo",
  }),
  Object.freeze({
    key: "library",
    tabId: "series-tab-library",
    panelId: "series-panel-library",
    label: "Mi biblioteca",
  }),
  Object.freeze({
    key: "collections",
    tabId: "series-tab-collections",
    panelId: "series-panel-collections",
    label: "Mis colecciones",
  }),
]);

/** Pestaña activa por defecto (UI-S01). */
export const DEFAULT_TAB = "catalog";

/**
 * Barra de estadísticas (UI-S02). `key` es la clave que devuelve
 * `computeSeriesStats` (ALG-S01) y `label` el texto visible en
 * español.
 */
const STAT_FIELDS = Object.freeze([
  Object.freeze({
    key: "completedCount",
    id: "series-stats-watched",
    label: "Completadas",
  }),
  Object.freeze({
    key: "watchingCount",
    id: "series-stats-watching",
    label: "En curso",
  }),
  Object.freeze({
    key: "totalEpisodes",
    id: "series-stats-episodes",
    label: "Episodios vistos",
  }),
  Object.freeze({
    key: "favoriteEpisodes",
    id: "series-stats-favorites",
    label: "Capítulos favoritos",
  }),
  Object.freeze({
    key: "totalHours",
    id: "series-stats-hours",
    label: "Horas",
  }),
  Object.freeze({
    key: "avgUserRating",
    id: "series-stats-avg-user",
    label: "Mi nota media",
  }),
  Object.freeze({
    key: "avgTmdbRating",
    id: "series-stats-avg-tmdb",
    label: "Nota media TMDB",
  }),
]);

/**
 * Las cuatro listas del catálogo (UI-S03, API-S02..S05). `fetcher` es
 * la función de `tmdbTvClient.js` que devuelve la página 1.
 */
const CATALOG_LISTS = Object.freeze([
  Object.freeze({
    key: "trending",
    label: "Tendencias de la semana",
    gridId: "series-catalog-trending",
    headingId: "series-catalog-trending-heading",
    fetcher: fetchTrendingWeek,
  }),
  Object.freeze({
    key: "popular",
    label: "Populares",
    gridId: "series-catalog-popular",
    headingId: "series-catalog-popular-heading",
    fetcher: fetchPopularSeries,
  }),
  Object.freeze({
    key: "top-rated",
    label: "Mejor valoradas",
    gridId: "series-catalog-top-rated",
    headingId: "series-catalog-top-rated-heading",
    fetcher: fetchTopRatedSeries,
  }),
  Object.freeze({
    key: "on-the-air",
    label: "En emisión",
    gridId: "series-catalog-on-the-air",
    headingId: "series-catalog-on-the-air-heading",
    fetcher: fetchOnTheAir,
  }),
]);

/**
 * Mensajes de error de TMDB en español (ALG-S05). Se exportan para
 * que T-S08 y T-S09 reutilicen el mismo texto.
 */
export const TMDB_ERROR_MESSAGES = Object.freeze({
  NO_API_KEY: "Falta la clave de TMDB: búsqueda desactivada.",
  NETWORK:
    "No se pudo conectar con TMDB. Puedes añadir la serie manualmente.",
  HTTP_401:
    "No se pudo conectar con TMDB. Puedes añadir la serie manualmente.",
  HTTP_429:
    "No se pudo conectar con TMDB. Puedes añadir la serie manualmente.",
  HTTP_404: "Serie no encontrada en TMDB. Puedes añadirla manualmente.",
  PARSE: "Respuesta no válida de TMDB. Puedes añadir la serie manualmente.",
});

/** Mensaje genérico cuando el fallo no viene de TMDB. */
const GENERIC_TMDB_MESSAGE = TMDB_ERROR_MESSAGES.NETWORK;

/** Mensaje genérico de los errores del repositorio. */
const GENERIC_REPOSITORY_MESSAGE =
  "No se pudo completar la operación en tu biblioteca de series.";

/** Estado vacío: la biblioteca no tiene ninguna serie. */
const LIBRARY_EMPTY_MESSAGE =
  "Tu biblioteca está vacía. Añade series desde «Explorar catálogo».";

/** Estado vacío: hay series, pero ninguna cumple los filtros. */
const LIBRARY_NO_RESULTS_MESSAGE =
  "No hay series que coincidan con los filtros.";

/**
 * Error del rango de nota invertido: el mínimo es mayor que el
 * máximo (UI-S05, ALG-S02).
 */
const RATING_RANGE_ORDER_ERROR =
  "La nota mínima no puede ser mayor que la nota máxima.";

/**
 * Rango de nota sin filtros: todo válido y sin extremos fijados
 * (estado inicial de la biblioteca, UI-S05).
 */
const EMPTY_RATING_RANGE = Object.freeze({
  min: null,
  max: null,
  minValid: true,
  maxValid: true,
  inverted: false,
  valid: true,
});

/** Póster de reserva cuando la serie no tiene `posterPath` (AC-S05). */
const POSTER_PLACEHOLDER =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" ' +
      'viewBox="0 0 500 750" role="presentation">' +
      '<rect width="500" height="750" fill="#2a2620"/>' +
      '<text x="250" y="382" fill="#b8b1a5" font-family="system-ui,sans-serif" ' +
      'font-size="44" text-anchor="middle">Sin póster</text>' +
      "</svg>"
  );

/** Fondo de reserva cuando la serie no tiene `backdropPath` (AC-S05). */
const BACKDROP_PLACEHOLDER =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" ' +
      'viewBox="0 0 1280 720" role="presentation">' +
      '<rect width="1280" height="720" fill="#211d18"/>' +
      '<text x="640" y="368" fill="#b8b1a5" font-family="system-ui,sans-serif" ' +
      'font-size="40" text-anchor="middle">Sin imagen de fondo</text>' +
      "</svg>"
  );

// -------------------------------------------------------------
// Constantes de la ficha y del alta manual (UI-S06, UI-S11)
// -------------------------------------------------------------

/** Confirmación del borrado de una serie (UI-S06, AC-S31). */
const DETAIL_DELETE_CONFIRM_MESSAGE =
  "¿Eliminar esta serie de tu biblioteca?";

/** Título temporal mientras se carga la ficha. */
const DETAIL_LOADING_TITLE = "Cargando…";

/** Aviso cuando la serie no se puede identificar. */
const DETAIL_UNKNOWN_SERIES_MESSAGE =
  "No se encontró la serie en tu biblioteca.";

/** Aviso de la vista de catálogo: la serie aún no está en la biblioteca. */
const DETAIL_CATALOG_HINT =
  "Esta serie todavía no está en tu biblioteca. Añádela para poder seguirla.";

/** Avisos de la ficha tras una acción correcta. */
const DETAIL_SAVED_MESSAGE = "Cambios guardados.";
const DETAIL_NOTHING_TO_SAVE_MESSAGE = "No hay cambios que guardar.";
const DETAIL_REFRESHED_MESSAGE = "Datos actualizados.";
const DETAIL_COLLECTIONS_MESSAGE = "Colecciones actualizadas.";
const DETAIL_STATUS_MESSAGE = "Estado actualizado.";
const DETAIL_EPISODE_MESSAGE = "Episodio marcado como visto.";
const DETAIL_REWATCH_UP_MESSAGE = "Revisionado añadido.";
const DETAIL_REWATCH_DOWN_MESSAGE = "Revisionado retirado.";

/** Mensajes del alta manual en español (UI-S11, AC-S08). */
const MANUAL_NAME_ERROR = "El nombre de la serie es obligatorio.";
const MANUAL_YEAR_ERROR = "El año de estreno no es válido.";
const MANUAL_SEASONS_ERROR = "El número de temporadas no es válido.";
const MANUAL_EPISODES_ERROR = "El número de episodios no es válido.";
const MANUAL_SUCCESS_MESSAGE = "Serie añadida a tu biblioteca.";

/** Límites del alta manual (coinciden con DB-S01). */
const MANUAL_MIN_YEAR = 1900;
const MANUAL_MAX_YEAR = 2100;
const MANUAL_MIN_SEASONS = 0;
const MANUAL_MAX_SEASONS = 1000;
const MANUAL_MIN_EPISODES = 0;
const MANUAL_MAX_EPISODES = 100000;

/** Fecha de estreno en formato largo es-ES («13 de marzo de 2022»). */
const longDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Fecha de visionado en formato corto es-ES («27/11/2026»). */
const shortDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

// -------------------------------------------------------------
// Formateadores (es-ES)
// -------------------------------------------------------------

const ratingFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 0,
});

/**
 * Nota con un decimal y coma es-ES («8,4»). `null` si no hay dato.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function formatRating(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return ratingFormatter.format(value);
}

/**
 * Entero con separador de miles es-ES («1.000»).
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function formatInteger(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return integerFormatter.format(value);
}

/**
 * Año de estreno a partir de una fecha «YYYY-MM-DD».
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function yearFromFirstAirDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) && year > 0 ? year : null;
}

/**
 * Identificador seguro para los ids únicos de cada tarjeta.
 *
 * @param {unknown} value
 * @returns {string}
 */
function safeIdPart(value) {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 60);
}

/**
 * Recuento de series de la biblioteca: «1 serie» en singular y
 * «N series» en plural (UI-S05).
 *
 * @param {number} count
 * @returns {string}
 */
function formatSeriesCount(count) {
  const total = formatInteger(count) ?? "0";
  return `${total} ${count === 1 ? "serie" : "series"}`;
}

// -------------------------------------------------------------
// Helpers de DOM
// -------------------------------------------------------------

/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function byId(id) {
  return document.getElementById(id);
}

/**
 * Muestra u oculta un nodo con su atributo `hidden`.
 *
 * @param {HTMLElement|null} node
 * @param {boolean} visible
 */
function setVisible(node, visible) {
  if (node) node.hidden = !visible;
}

/**
 * Escribe un mensaje en un nodo y lo oculta si el texto está vacío.
 *
 * @param {HTMLElement|null} node
 * @param {string} message
 */
function setMessage(node, message) {
  if (!node) return;
  const text = typeof message === "string" ? message : "";
  node.textContent = text;
  node.hidden = text === "";
}

/**
 * Escribe un texto en un nodo (sin tocar su visibilidad).
 *
 * @param {HTMLElement|null} node
 * @param {string} text
 */
function setText(node, text) {
  if (!node) return;
  node.textContent = typeof text === "string" ? text : "";
}

/**
 * Vacía un contenedor sin dejar nodos sueltos.
 *
 * @param {HTMLElement|null} container
 */
function clearNode(container) {
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
}

// -------------------------------------------------------------
// Estado del módulo
// -------------------------------------------------------------

/**
 * @typedef {Object} SeriesViewState
 * @property {string} activeTab Pestaña activa (UI-S01).
 * @property {Array<Record<string, unknown>>} library Biblioteca completa
 *   (sin filtros de servidor): alimenta las estadísticas (UI-S02).
 * @property {Array<Record<string, unknown>>} libraryFiltered Biblioteca
 *   con los filtros de servidor aplicados: alimenta la rejilla de
 *   «Mi biblioteca» (UI-S05, ALG-S02).
 * @property {Map<string, Record<string, unknown>>} libraryByDocId
 * @property {Map<string, Record<string, unknown>>} libraryByTmdbId
 * @property {ReturnType<typeof createLibraryFilters>} libraryFilters
 *   Filtros de cliente normalizados (ALG-S02).
 * @property {ReturnType<typeof readRatingRange>} libraryRatingRange
 *   Último rango de nota validado: alimenta el mensaje de error sin
 *   releer los inputs durante el render (UI-S05).
 * @property {Array<Record<string, unknown>>} collections Colecciones
 *   del usuario: opciones del filtro por colección (DB-S03).
 * @property {{
 *   loaded: boolean,
 *   loading: boolean,
 *   query: string,
 *   lists: Record<string, Array<Record<string, unknown>>>
 * }} catalog
 */

/**
 * Crea el estado de la vista.
 *
 * @returns {SeriesViewState}
 */
function createViewState() {
  /** @type {Record<string, Array<Record<string, unknown>>>} */
  const lists = {};
  for (const list of CATALOG_LISTS) lists[list.key] = [];

  return {
    activeTab: DEFAULT_TAB,
    library: [],
    libraryFiltered: [],
    libraryByDocId: new Map(),
    libraryByTmdbId: new Map(),
    libraryFilters: createLibraryFilters(),
    libraryRatingRange: EMPTY_RATING_RANGE,
    collections: [],
    catalog: {
      loaded: false,
      loading: false,
      query: "",
      lists,
    },
  };
}

/** Referencias al DOM resueltas en el montaje. */
let dom = null;

/** Estado vivo de la vista. */
let state = createViewState();

/**
 * Suscriptor de la biblioteca con los filtros de servidor: alimenta
 * la rejilla de «Mi biblioteca» (UI-S05).
 */
let libraryUnsubscribe = null;

/**
 * Suscriptor de la biblioteca sin filtros: alimenta las
 * estadísticas (UI-S02) y el índice de series ya añadidas que usa el
 * catálogo.
 */
let statsUnsubscribe = null;

/** Suscriptor de las colecciones: opciones del filtro por colección. */
let collectionsUnsubscribe = null;

/** Temporizador de búsqueda en la biblioteca pendiente. */
let librarySearchTimer = null;

/**
 * Firma de los filtros de servidor activos: evita resuscripciones
 * innecesarias (ALG-S02).
 */
let serverFiltersSignature = "";

/**
 * Foco pendiente de devolver a un botón de la biblioteca tras un
 * repintado de la rejilla (UI-S13, NFR-S02).
 *
 * @type {{ docId: string, role: string }|null}
 */
let pendingLibraryFocus = null;

/** Series visibles en la última pintada de la biblioteca. */
let libraryVisibleCount = 0;

/**
 * `true` cuando ya ha llegado el primer snapshot con los filtros de
 * servidor. Antes de eso el recuento visible todavía no es válido y
 * el estado vacío no se anuncia (UI-S05).
 */
let libraryFilteredLoaded = false;

/** Temporizador de búsqueda del catálogo pendiente. */
let searchTimer = null;

/** Token de búsqueda: descarta respuestas obsoletas. */
let searchToken = 0;

/** Último error de carga de la biblioteca. */
let libraryLoadError = "";

/** Controlador devuelto por `mountSeries`. */
let activeController = null;

/** Abridor de la ficha; lo registrará T-S08 (UI-S06). */
let detailOpener = null;

/** Modelos de tarjeta indexados por su elemento (WeakMap). */
const cardModels = new WeakMap();

/**
 * Botones «Añadir» del catálogo, indexados por la clave de la
 * tarjeta: `{ button, tmdbId }`. La clave incluye la rejilla, así
 * que la misma serie puede estar en varias listas.
 *
 * @type {Map<string, { button: HTMLElement, tmdbId: string }>}
 */
const catalogAddButtons = new Map();

/** Nodos de estado vacío de cada lista del catálogo. */
const catalogListEmptyNodes = new Map();

/** Escuchas de las pestañas, para poder retirarlas al desmontar. */
const tabListeners = new Map();

/** Nodo de aviso general de la sección (`role="status"`). */
let noticeNode = null;

// -------------------------------------------------------------
// Descripción de errores en español (ALG-S05)
// -------------------------------------------------------------

/**
 * Traduce un error de `tmdbTvClient.js` al mensaje de UI (ALG-S05).
 * Los códigos desconocidos se tratan como fallo de conexión.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function describeTmdbError(error) {
  const code =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "";

  if (code && Object.prototype.hasOwnProperty.call(TMDB_ERROR_MESSAGES, code)) {
    return TMDB_ERROR_MESSAGES[code];
  }

  return GENERIC_TMDB_MESSAGE;
}

/**
 * Traduce un error del repositorio a un mensaje apto para la UI. Los
 * errores del repositorio ya traen el mensaje en español.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function describeRepositoryError(error) {
  if (
    error &&
    typeof error === "object" &&
    typeof error.message === "string" &&
    error.message.trim() !== ""
  ) {
    return error.message;
  }
  return GENERIC_REPOSITORY_MESSAGE;
}

// -------------------------------------------------------------
// Tarjeta de serie (UI-S04)
// -------------------------------------------------------------

/**
 * @typedef {Object} CardModel
 * @property {string} key Clave única de la tarjeta.
 * @property {"catalog"|"library"} context Contexto de la tarjeta.
 * @property {string} title Título visible.
 * @property {number|null} year Año de estreno.
 * @property {number|null} rating Nota de TMDB.
 * @property {string|null} posterPath Ruta del póster en TMDB.
 * @property {string|null} status Estado interno (solo biblioteca).
 * @property {boolean} isFavorite Favorito (solo biblioteca).
 * @property {number} watchedEpisodes Episodios vistos (solo biblioteca).
 * @property {number|null} numberOfEpisodes Total de episodios.
 * @property {number} rewatchCount Revisionados (solo biblioteca).
 * @property {number} currentSeason Temporada del próximo episodio.
 * @property {number} currentEpisode Episodio siguiente.
 * @property {string|null} tmdbId Id de TMDB.
 * @property {string|null} docId Id del documento de Firestore.
 * @property {Record<string, unknown>} raw Objeto original.
 */

/**
 * Normaliza un resumen de TMDB o un documento de la biblioteca al
 * modelo que usa la tarjeta. El objeto original se conserva en `raw`
 * para poder enviarlo tal cual a `addFromTmdb`.
 *
 * @param {Record<string, unknown>} series
 * @param {"catalog"|"library"} context
 * @param {string} [gridKey] Rejilla que hospeda la tarjeta. En el
 *   catálogo la misma serie puede aparecer en varias listas, así que
 *   la clave incluye la rejilla para no duplicar ids.
 * @returns {CardModel}
 */
function buildCardModel(series, context, gridKey = "") {
  const source = series && typeof series === "object" ? series : {};

  const tmdbId =
    context === "catalog"
      ? typeof source.id === "number"
        ? String(source.id)
        : null
      : typeof source.tmdbId === "number"
        ? String(source.tmdbId)
        : null;

  const docId =
    context === "library" && typeof source.id === "string" ? source.id : null;

  const title =
    (typeof source.name === "string" && source.name.trim()) ||
    (typeof source.originalName === "string" && source.originalName.trim()) ||
    "Sin título";

  const year =
    context === "library"
      ? typeof source.firstAirYear === "number" && Number.isFinite(source.firstAirYear)
        ? source.firstAirYear
        : yearFromFirstAirDate(source.firstAirDate)
      : yearFromFirstAirDate(source.firstAirDate);

  const rating =
    context === "catalog"
      ? typeof source.voteAverage === "number"
        ? source.voteAverage
        : null
      : typeof source.tmdbRating === "number"
        ? source.tmdbRating
        : null;

  const numberOfEpisodes =
    typeof source.numberOfEpisodes === "number" &&
    Number.isInteger(source.numberOfEpisodes) &&
    source.numberOfEpisodes >= 0
      ? source.numberOfEpisodes
      : null;

  const watchedEpisodes =
    typeof source.watchedEpisodesCount === "number" &&
    Number.isFinite(source.watchedEpisodesCount)
      ? Math.max(0, Math.trunc(source.watchedEpisodesCount))
      : 0;

  return {
    key:
      context === "catalog"
        ? `tmdb-${safeIdPart(gridKey || "catalogo")}-${safeIdPart(tmdbId ?? "sin-id")}`
        : `doc-${safeIdPart(docId ?? "sin-id")}`,
    context,
    title,
    year: typeof year === "number" && Number.isFinite(year) ? year : null,
    rating: typeof rating === "number" && Number.isFinite(rating) ? rating : null,
    posterPath:
      typeof source.posterPath === "string" && source.posterPath.trim() !== ""
        ? source.posterPath
        : null,
    status: typeof source.status === "string" ? source.status : null,
    isFavorite: source.isFavorite === true,
    watchedEpisodes,
    numberOfEpisodes,
    rewatchCount:
      typeof source.rewatchCount === "number" && Number.isFinite(source.rewatchCount)
        ? Math.max(0, Math.trunc(source.rewatchCount))
        : 0,
    currentSeason:
      typeof source.currentSeason === "number" && source.currentSeason >= 1
        ? Math.trunc(source.currentSeason)
        : 1,
    currentEpisode:
      typeof source.currentEpisode === "number" && source.currentEpisode >= 1
        ? Math.trunc(source.currentEpisode)
        : 1,
    tmdbId,
    docId,
    raw: source,
  };
}

/**
 * Crea la tarjeta de una serie clonando la plantilla de `index.html`
 * (T-S04). Cada instancia recibe ids únicos para no duplicar los
 * del prototipo.
 *
 * @param {Record<string, unknown>} series
 * @param {"catalog"|"library"} context
 * @param {string} [gridKey] Rejilla que hospeda la tarjeta.
 * @returns {HTMLElement|null}
 */
function createSeriesCard(series, context, gridKey = "") {
  const template = dom?.templates?.card;
  if (!template || !template.content) return null;

  const model = buildCardModel(series, context, gridKey);
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('[data-series-role="card"]');
  if (!(card instanceof HTMLElement)) return null;

  // El modelo se registra antes de rellenar la tarjeta: las
  // etiquetas accesibles se construyen a partir de él.
  cardModels.set(card, model);

  card.id = `series-card-${model.key}`;
  card.dataset.seriesKey = model.key;
  card.dataset.seriesContext = context;

  // --- Póster (w500) y metadatos ---------------------------------
  const poster = card.querySelector('[data-series-role="poster"]');
  if (poster instanceof HTMLImageElement) {
    const url = posterUrl(model.posterPath, POSTER_SIZE);
    poster.src = url ?? POSTER_PLACEHOLDER;
    poster.alt = url ? `Póster de ${model.title}` : "Sin póster";
  }

  const titleNode = card.querySelector('[data-series-role="title"]');
  if (titleNode) titleNode.textContent = model.title;

  const yearNode = card.querySelector('[data-series-role="year"]');
  if (yearNode) {
    yearNode.textContent = model.year === null ? "" : String(model.year);
    yearNode.hidden = model.year === null;
  }

  const ratingNode = card.querySelector('[data-series-role="rating"]');
  if (ratingNode) {
    const text = formatRating(model.rating);
    ratingNode.textContent = text === null ? "" : `★ ${text}`;
    ratingNode.hidden = text === null;
  }

  // --- Badge de estado en español (UI-S12) ------------------------
  const statusNode = card.querySelector('[data-series-role="status"]');
  if (statusNode) {
    const label =
      model.status &&
      Object.prototype.hasOwnProperty.call(STATUS_LABELS, model.status)
        ? STATUS_LABELS[model.status]
        : "";
    statusNode.textContent = label;
    if (model.status) statusNode.dataset.status = model.status;
    else delete statusNode.dataset.status;
    statusNode.hidden = label === "";
  }

  // --- «×N» de revisionados (solo biblioteca) ---------------------
  const rewatchNode = card.querySelector('[data-series-role="rewatch"]');
  if (rewatchNode) {
    const show = model.context === "library" && model.rewatchCount > 1;
    rewatchNode.textContent = show ? `×${model.rewatchCount}` : "";
    rewatchNode.id = `series-card-rewatch-${model.key}`;
    rewatchNode.hidden = !show;
  }

  // --- Barra de progreso «6/24 · 25%» (UI-S04, AC-S10) -----------
  renderCardProgress(card, model);

  // --- Botón «Abrir» ----------------------------------------------
  const openButton = card.querySelector('[data-series-role="open"]');
  if (openButton instanceof HTMLElement) {
    openButton.id = `series-card-open-${model.key}`;
    openButton.setAttribute("aria-label", `Ver ficha de ${model.title}`);
  }

  // --- «Añadir» (solo catálogo) -----------------------------------
  const addButton = card.querySelector('[data-series-role="add"]');
  if (addButton instanceof HTMLElement) {
    addButton.id = `series-card-add-${model.key}`;
    if (model.context !== "catalog") {
      addButton.hidden = true;
    } else {
      const alreadyInLibrary =
        model.tmdbId !== null && state.libraryByTmdbId.has(model.tmdbId);
      updateAddButton(addButton, model, alreadyInLibrary);
      if (model.tmdbId !== null) {
        catalogAddButtons.set(model.key, {
          button: addButton,
          tmdbId: model.tmdbId,
        });
      }
    }
  }

  // --- Favorito (solo biblioteca) ---------------------------------
  const favoriteButton = card.querySelector('[data-series-role="favorite"]');
  if (favoriteButton instanceof HTMLElement) {
    favoriteButton.id = `series-card-favorite-${model.key}`;
    if (model.context !== "library") {
      favoriteButton.hidden = true;
    } else {
      // La plantilla lo trae oculto: en la biblioteca sí se muestra.
      favoriteButton.hidden = false;
      updateFavoriteButton(favoriteButton, model.isFavorite);
    }
  }

  // --- «+1 Episodio» (solo biblioteca) ----------------------------
  const nextButton = card.querySelector('[data-series-role="next"]');
  if (nextButton instanceof HTMLElement) {
    nextButton.id = `series-card-next-${model.key}`;
    if (model.context !== "library") {
      nextButton.hidden = true;
    } else {
      nextButton.hidden = false;
      updateNextButton(nextButton, model);
    }
  }

  return card;
}

/**
 * Pinta la barra de progreso de la tarjeta: «6/24 · 25%» (UI-S04,
 * AC-S10). Sin `numberOfEpisodes` la barra se oculta (solo contador).
 *
 * @param {HTMLElement} card
 * @param {CardModel} model
 */
function renderCardProgress(card, model) {
  const progress = card.querySelector('[data-series-role="progress"]');
  if (!(progress instanceof HTMLElement)) return;

  // El id del prototipo se sustituye SIEMPRE, incluso cuando la barra
  // se oculta: si no, cada tarjeta clonada repetiría
  // `id="series-card-progress"` (ids duplicados en el DOM).
  progress.id = `series-card-progress-${model.key}`;

  const total = model.numberOfEpisodes;
  const watched = model.watchedEpisodes;

  // Sin `numberOfEpisodes` la barra se oculta (solo contador):
  // DB-S01, UI-S04.
  if (total === null) {
    progress.hidden = true;
    return;
  }

  progress.hidden = false;

  const label = `${watched}/${total}`;
  const percent =
    total > 0
      ? Math.min(100, Math.max(0, Math.round((watched / total) * 100)))
      : 0;

  const labelNode = progress.querySelector('[data-series-role="progress-label"]');
  if (labelNode) labelNode.textContent = label;

  const percentNode = progress.querySelector(
    '[data-series-role="progress-percent"]'
  );
  if (percentNode) percentNode.textContent = `${percent}%`;

  const bar = progress.querySelector('[data-series-role="progress-bar"]');
  if (bar instanceof HTMLElement) {
    bar.setAttribute("aria-valuenow", String(percent));
    bar.setAttribute("aria-valuetext", `${label} · ${percent}%`);
  }

  const fill = progress.querySelector('[data-series-role="progress-fill"]');
  if (fill instanceof HTMLElement) {
    fill.style.width = `${percent}%`;
  }
}

/**
 * Estado del botón «Añadir»: «Añadir» o «En biblioteca»
 * (desactivado) (UI-S04).
 *
 * @param {HTMLElement} button
 * @param {CardModel} model
 * @param {boolean} inLibrary
 */
function updateAddButton(button, model, inLibrary) {
  button.disabled = inLibrary;
  button.textContent = inLibrary ? "En biblioteca" : "Añadir";
  button.setAttribute(
    "aria-label",
    inLibrary
      ? `${model.title} ya está en tu biblioteca`
      : `Añadir ${model.title} a tu biblioteca`
  );
}

/**
 * Estado del botón de favorito: `aria-pressed` + etiqueta (UI-S04,
 * AC-S13).
 *
 * @param {HTMLElement} button
 * @param {boolean} isFavorite
 */
function updateFavoriteButton(button, isFavorite) {
  button.setAttribute("aria-pressed", isFavorite ? "true" : "false");
  const label = button.querySelector('[data-series-role="favorite-label"]');
  if (label) label.textContent = isFavorite ? "Favorita" : "Marcar favorita";
  const card = button.closest('[data-series-role="card"]');
  const model = card ? cardModels.get(card) : null;
  button.setAttribute(
    "aria-label",
    isFavorite
      ? `Quitar ${model ? model.title : "la serie"} de favoritas`
      : `Marcar ${model ? model.title : "la serie"} como favorita`
  );
}

/**
 * Estado del botón «+1 Episodio» (UI-S04): deshabilitado con la
 * etiqueta «Completada» cuando ya se han visto todos los episodios
 * conocidos.
 *
 * @param {HTMLElement} button
 * @param {CardModel} model
 */
function updateNextButton(button, model) {
  const total = model.numberOfEpisodes;
  // UI-S04: deshabilitado con la etiqueta «Completada» cuando
  // `numberOfEpisodes != null` y `watchedEpisodesCount >= numberOfEpisodes`.
  const completed = total !== null && model.watchedEpisodes >= total;

  button.disabled = completed;
  button.textContent = completed ? "Completada" : "+1 Episodio";
  button.setAttribute(
    "aria-label",
    completed
      ? `${model.title} está completada: no quedan episodios por marcar`
      : `Marcar el siguiente episodio como visto de ${model.title}`
  );
}

/**
 * Pinta una lista de tarjetas en una rejilla. La clave de la
 * tarjeta incluye el id de la rejilla: en el catálogo la misma serie
 * puede aparecer en varias listas y sus ids deben ser únicos
 * (UI-S04).
 *
 * @param {HTMLElement|null} container
 * @param {Array<Record<string, unknown>>} series
 * @param {"catalog"|"library"} context
 */
function renderCards(container, series, context) {
  if (!container) return;

  if (context === "catalog") {
    // Se olvidan los botones de las tarjetas que se van a sustituir.
    for (const [key, entry] of catalogAddButtons) {
      const grid = entry.button.closest(".series-grid");
      if (grid === container || !entry.button.isConnected) {
        catalogAddButtons.delete(key);
      }
    }
  }

  clearNode(container);

  const gridKey = container.id || "";
  const fragment = document.createDocumentFragment();
  for (const seriesItem of Array.isArray(series) ? series : []) {
    const card = createSeriesCard(seriesItem, context, gridKey);
    if (card) fragment.append(card);
  }
  container.append(fragment);
}

/**
 * Refleja en los botones del catálogo las series que ya están en la
 * biblioteca (UI-S04: «En biblioteca», botón desactivado).
 */
function syncCatalogAddButtons() {
  for (const [key, entry] of catalogAddButtons) {
    const { button, tmdbId } = entry;
    const card = button.closest('[data-series-role="card"]');
    const model = card ? cardModels.get(card) : null;
    if (!model) {
      catalogAddButtons.delete(key);
      continue;
    }
    updateAddButton(button, model, state.libraryByTmdbId.has(tmdbId));
  }
}

// -------------------------------------------------------------
// Estadísticas (UI-S02, ALG-S01, AC-S26)
// -------------------------------------------------------------

/**
 * Pinta la barra de estadísticas con los valores de
 * `computeSeriesStats` (ALG-S01). Con la biblioteca vacía todas las
 * cifras son «—».
 *
 * @param {Array<Record<string, unknown>>} series
 */
function renderStats(series) {
  const stats = computeSeriesStats(series);

  for (const field of STAT_FIELDS) {
    const node = dom?.stats?.[field.id];
    if (!node) continue;

    const value = stats[field.key];
    node.textContent =
      typeof value === "number" ? (formatInteger(value) ?? "—") : String(value ?? "—");

    // La etiqueta visible se fija en español (UI-S02).
    const item = node.closest(".series-stats__item");
    const label = item ? item.querySelector("dt") : null;
    if (label) label.textContent = field.label;
  }
}

// -------------------------------------------------------------
// Catálogo (UI-S03)
// -------------------------------------------------------------

/**
 * Estado vacío de una lista del catálogo (se crea una sola vez).
 *
 * @param {string} key
 * @param {string} label
 * @returns {HTMLElement|null}
 */
function ensureCatalogListEmpty(key, label) {
  const cached = catalogListEmptyNodes.get(key);
  if (cached) return cached;

  const grid = dom?.catalog?.grids?.[key];
  const section = grid ? grid.parentElement : null;
  if (!section) return null;

  const node = document.createElement("p");
  node.className = "series-empty";
  node.textContent = `No hay series en «${label}».`;
  node.hidden = true;
  section.append(node);

  catalogListEmptyNodes.set(key, node);
  return node;
}

/**
 * Carga una de las cuatro listas del catálogo (página 1).
 *
 * @param {typeof CATALOG_LISTS[number]} list
 * @returns {Promise<boolean>} `true` si la lista se ha cargado bien.
 */
async function loadCatalogList(list) {
  const grid = dom?.catalog?.grids?.[list.key];
  const emptyNode = ensureCatalogListEmpty(list.key, list.label);

  if (grid) grid.setAttribute("aria-busy", "true");

  try {
    const result = await list.fetcher(1);
    const series = Array.isArray(result?.results) ? result.results : [];
    state.catalog.lists[list.key] = series;
    renderCards(grid, series, "catalog");
    if (emptyNode) emptyNode.hidden = series.length > 0;
    return true;
  } catch (error) {
    state.catalog.lists[list.key] = [];
    clearNode(grid);
    if (emptyNode) emptyNode.hidden = true;
    const message = describeTmdbError(error);
    setMessage(dom?.catalog?.error, message);
    // El aviso general recuerda que el alta manual sigue operativa
    // (UI-S11, ALG-S05, AC-S06).
    setTmdbWarning(message);
    return false;
  } finally {
    if (grid) grid.removeAttribute("aria-busy");
  }
}

/**
 * Carga el catálogo la primera vez que se abre la pestaña. Sin clave
 * de TMDB no hay peticiones de red y se avisa en español (AC-S01).
 *
 * Si alguna lista falla, el catálogo queda «reintentable»: la
 * siguiente vez que se abre la pestaña se vuelve a pedir.
 *
 * @returns {Promise<void>}
 */
async function loadCatalog() {
  if (state.catalog.loaded || state.catalog.loading) return;

  if (!isTmdbConfigured()) {
    // Sin clave no hay peticiones de red (AC-S01, ALG-S05): el aviso
    // se muestra en el catálogo y en el aviso general de la sección.
    setMessage(dom?.catalog?.error, TMDB_ERROR_MESSAGES.NO_API_KEY);
    setTmdbWarning(TMDB_ERROR_MESSAGES.NO_API_KEY);
    return;
  }

  state.catalog.loading = true;
  try {
    const results = await Promise.all(
      CATALOG_LISTS.map((list) => loadCatalogList(list))
    );
    // Solo se marca como cargado si todas las listas respondieron.
    state.catalog.loaded = results.every((ok) => ok === true);
    if (state.catalog.loaded) setTmdbWarning("");
  } finally {
    state.catalog.loading = false;
  }
}

/**
 * Vuelve a la vista de listas (sin búsqueda activa).
 */
function showCatalogSections() {
  setVisible(dom?.catalog?.sections, true);
  setVisible(dom?.catalog?.results, false);
  setVisible(dom?.catalog?.empty, false);
}

/**
 * Muestra los resultados de búsqueda y oculta las cuatro listas
 * (UI-S03: «con resultados de búsqueda las listas se ocultan»).
 */
function showCatalogResults() {
  setVisible(dom?.catalog?.sections, false);
  setVisible(dom?.catalog?.results, true);
}

/**
 * Búsqueda instantánea del catálogo (debounce 300 ms, mínimo 2
 * caracteres; NFR-S04).
 */
function onCatalogSearchInput() {
  const query = dom?.catalog?.search?.value?.trim() ?? "";

  if (searchTimer !== null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }

  if (query.length < MIN_SEARCH_CHARS) {
    // Búsqueda cancelada: se descarta cualquier respuesta en vuelo.
    searchToken += 1;
    state.catalog.query = "";
    setMessage(dom?.catalog?.error, "");
    showCatalogSections();
    return;
  }

  setMessage(dom?.catalog?.error, "");
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void runCatalogSearch(query);
  }, SEARCH_DEBOUNCE_MS);
}

/**
 * Ejecuta la búsqueda en TMDB y pinta los resultados.
 *
 * @param {string} query
 * @returns {Promise<void>}
 */
async function runCatalogSearch(query) {
  const token = ++searchToken;
  state.catalog.query = query;

  showCatalogResults();
  const grid = dom?.catalog?.resultsGrid;
  if (grid) grid.setAttribute("aria-busy", "true");

  try {
    const result = await searchSeries(query, null, 1);
    if (token !== searchToken) return;

    const series = Array.isArray(result?.results) ? result.results : [];
    renderCards(grid, series, "catalog");

    const emptyNode = dom?.catalog?.empty;
    if (emptyNode) {
      emptyNode.textContent = `Sin resultados para «${query}».`;
      emptyNode.hidden = series.length > 0;
    }
    setMessage(dom?.catalog?.error, "");
    setTmdbWarning("");
  } catch (error) {
    if (token !== searchToken) return;

    clearNode(grid);
    setVisible(dom?.catalog?.empty, false);
    const message = describeTmdbError(error);
    setMessage(dom?.catalog?.error, message);
    // Aviso general: la app sigue operativa y el alta manual continúa
    // disponible (AC-S06).
    setTmdbWarning(message);
  } finally {
    if (token === searchToken && grid) grid.removeAttribute("aria-busy");
  }
}

// -------------------------------------------------------------
// Biblioteca: buscador, filtros combinables y orden (UI-S05,
// ALG-S02, REQ-S13)
// -------------------------------------------------------------

/**
 * Rellena el filtro de estado con las opciones de `seriesState.js`
 * (UI-S05): «Todos», «Pendientes», «Viendo», «Completadas»,
 * «Abandonadas» y «Favoritas» (pseudofiltro `isFavorite`).
 */
function populateStatusFilter() {
  const select = dom?.library?.status;
  if (!select) return;

  clearNode(select);

  for (const option of LIBRARY_STATUS_OPTIONS) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  }

  select.value = "";
}

/**
 * Rellena el selector de orden con las siete claves de `SORT_OPTIONS`
 * (UI-S05, ALG-S02). El orden por defecto es «Fecha de añadido».
 */
function populateSortFilter() {
  const select = dom?.library?.sort;
  if (!select) return;

  clearNode(select);

  for (const option of SORT_OPTIONS) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  }

  select.value = DEFAULT_SORT_KEY;
}

/**
 * Rellena el filtro de género con el diccionario estático de TV
 * (D-S08, UI-S05).
 */
function populateGenreFilter() {
  const select = dom?.library?.genre;
  if (!select) return;

  clearNode(select);

  const first = document.createElement("option");
  first.value = "";
  first.textContent = "Todos los géneros";
  select.append(first);

  for (const genre of TV_GENRE_OPTIONS) {
    const option = document.createElement("option");
    option.value = String(genre.id);
    option.textContent = genre.label;
    select.append(option);
  }
}

/**
 * Rellena el filtro de colección con los nombres del usuario
 * (DB-S03, UI-S05). «Todas» es la opción por defecto.
 *
 * Si la colección seleccionada ya no existe (por ejemplo, porque se
 * ha borrado), el filtro vuelve a «Todas» y se reaplican los filtros.
 *
 * @param {Array<Record<string, unknown>>} collections
 */
function populateCollectionFilter(collections) {
  const select = dom?.library?.collection;
  if (!select) return;

  const previous = select.value;
  clearNode(select);

  const first = document.createElement("option");
  first.value = "";
  first.textContent = "Todas";
  select.append(first);

  for (const collection of collections) {
    const option = document.createElement("option");
    option.value = String(collection.id);
    option.textContent = String(collection.name ?? "");
    select.append(option);
  }

  const stillExists = collections.some(
    (collection) => String(collection.id) === previous
  );

  if (previous !== "" && stillExists) {
    select.value = previous;
    return;
  }

  // La colección seleccionada ya no existe: el filtro vuelve a «Todas».
  select.value = "";
  if (previous !== "") applyLibraryFilters();
}

/**
 * Valor de un filtro de nota: `null` si el campo está vacío.
 *
 * Lanza `UserRatingError` si el valor no cumple 0–10 con pasos de
 * medio punto (ALG-S04); el mensaje va en español.
 *
 * @param {HTMLInputElement|null|undefined} input
 * @returns {number|null}
 */
function readRatingValue(input) {
  if (!input) return null;

  const raw = typeof input.value === "string" ? input.value.trim() : "";
  if (raw === "") return null;

  return parseUserRating(raw);
}

/**
 * Estado del rango de nota (UI-S05, ALG-S02, ALG-S04).
 *
 * Los extremos son inclusivos (ALG-S02) y se validan con
 * `parseUserRating` (0–10, paso 0,5). Un extremo inválido **no** se
 * aplica: el filtro se deja sin fijar. Un rango invertido (mínimo >
 * máximo) tampoco se aplica y se avisa en español.
 *
 * Esta lectura es **pura**: no toca el DOM. El marcado `aria-invalid`
 * lo aplica `applyRatingRangeState` en el camino de la acción del
 * usuario, nunca durante un render (los renderes no deben mutar el
 * estado de los inputs).
 *
 * @returns {{
 *   min: number|null,
 *   max: number|null,
 *   minValid: boolean,
 *   maxValid: boolean,
 *   inverted: boolean,
 *   valid: boolean
 * }}
 */
function readRatingRange() {
  const library = dom?.library ?? {};

  let min = null;
  let max = null;
  let minValid = true;
  let maxValid = true;

  try {
    min = readRatingValue(library.ratingMin);
  } catch {
    minValid = false;
    min = null;
  }

  try {
    max = readRatingValue(library.ratingMax);
  } catch {
    maxValid = false;
    max = null;
  }

  const inverted =
    minValid && maxValid && min !== null && max !== null && min > max;

  return {
    min: minValid && !inverted ? min : null,
    max: maxValid && !inverted ? max : null,
    minValid,
    maxValid,
    inverted,
    valid: minValid && maxValid && !inverted,
  };
}

/**
 * Marca los campos de nota como inválidos cuando su valor no cumple
 * el rango (UI-S13, NFR-S02). Se llama desde el camino de la acción
 * del usuario (`applyLibraryFilters`), nunca desde un render.
 *
 * @param {ReturnType<typeof readRatingRange>} range
 */
function applyRatingRangeState(range) {
  const library = dom?.library ?? {};
  if (!range) return;

  // Cada campo se marca por separado; un rango invertido invalida
  // los dos extremos porque ninguno es aplicable.
  const minInvalid = !range.minValid || range.inverted;
  const maxInvalid = !range.maxValid || range.inverted;

  if (library.ratingMin) {
    library.ratingMin.setAttribute("aria-invalid", minInvalid ? "true" : "false");
  }
  if (library.ratingMax) {
    library.ratingMax.setAttribute("aria-invalid", maxInvalid ? "true" : "false");
  }
}

/**
 * Mensaje de error del rango de nota (o `null` si es válido).
 *
 * @param {ReturnType<typeof readRatingRange>} range
 * @returns {string|null}
 */
function readRatingError(range) {
  if (!range) return null;
  if (!range.minValid || !range.maxValid) return USER_RATING_ERROR_MESSAGE;
  if (range.inverted) return RATING_RANGE_ORDER_ERROR;

  return null;
}

/**
 * Muestra en `series-library-error` el aviso que corresponda: primero
 * el del rango de nota y, si no hay, el error de carga de la
 * biblioteca (UI-S05).
 *
 * Solo escribe en el nodo de error: no relee ni muta los inputs.
 *
 * @param {ReturnType<typeof readRatingRange>} [range]
 */
function renderLibraryError(range) {
  const current = range ?? state.libraryRatingRange;
  setMessage(dom?.library?.error, readRatingError(current) ?? libraryLoadError);
}

/**
 * Lee los controles de filtro de la biblioteca y los normaliza con
 * `createLibraryFilters` (ALG-S02). Los filtros se combinan con AND
 * (AC-S24): estado o favoritas, género, colección, rango de nota y
 * búsqueda.
 *
 * @param {ReturnType<typeof readRatingRange>} [range] Rango de nota ya
 *   validado en este mismo paso; si no se pasa, se lee aquí.
 * @returns {ReturnType<typeof createLibraryFilters>}
 */
function readLibraryFilters(range) {
  const library = dom?.library ?? {};
  const status = library.status?.value ?? "";
  const ratingRange = range ?? readRatingRange();

  return createLibraryFilters({
    query: library.search?.value ?? "",
    status,
    // «Favoritas» es un pseudofiltro: `isFavorite === true`.
    favorite: status === "favorites",
    genreId: library.genre?.value ? Number(library.genre.value) : null,
    collectionId: library.collection?.value ?? "",
    // Un extremo inválido o invertido no se aplica: el filtro se
    // deja sin fijar (ALG-S02).
    ratingMin: ratingRange.min,
    ratingMax: ratingRange.max,
    sort: library.sort?.value || DEFAULT_SORT_KEY,
  });
}

/**
 * Pinta la biblioteca: filtra en cliente (ALG-S02), ordena en cliente
 * (D-S03) y actualiza el recuento y el estado vacío.
 *
 * El origen es el snapshot que devuelve el servidor con los filtros
 * de servidor aplicados; el filtrado en cliente se mantiene para la
 * búsqueda y el rango de nota, y vuelve a comprobar los filtros de
 * servidor para que la lista nunca muestre series que no los
 * cumplan.
 */
function renderLibrary() {
  const grid = dom?.library?.grid;
  const filtered = filterSeries(state.libraryFiltered, state.libraryFilters);
  const sorted = sortSeries(filtered, state.libraryFilters.sort);

  renderCards(grid, sorted, "library");
  libraryVisibleCount = sorted.length;

  // Contador «1 serie» / «N series» (UI-S05).
  const count = dom?.library?.count;
  if (count) count.textContent = formatSeriesCount(sorted.length);

  // El estado vacío solo se anuncia cuando ya ha llegado el primer
  // snapshot filtrado: antes de eso no se sabe si la biblioteca está
  // vacía o si los filtros no dejan pasar ninguna serie.
  if (libraryFilteredLoaded) {
    updateLibraryEmptyState();
  } else {
    setVisible(dom?.library?.empty, false);
  }

  renderLibraryError();
  flushPendingLibraryFocus();
}

/**
 * Estado vacío de la biblioteca, en dos variantes distintas
 * (UI-S05): «biblioteca vacía» cuando el usuario no tiene ninguna
 * serie y «sin resultados» cuando tiene series pero ninguna cumple
 * los filtros.
 */
function updateLibraryEmptyState() {
  const empty = dom?.library?.empty;
  if (!empty) return;

  const libraryIsEmpty = state.library.length === 0;

  empty.textContent = libraryIsEmpty
    ? LIBRARY_EMPTY_MESSAGE
    : LIBRARY_NO_RESULTS_MESSAGE;
  empty.hidden = libraryVisibleCount > 0;
}

/**
 * Aplica los cambios de los controles de la biblioteca.
 *
 * El rango de nota se valida **una sola vez** en este paso: el
 * resultado se reutiliza para los filtros, para `aria-invalid` y
 * para el mensaje de error.
 */
function applyLibraryFilters() {
  const range = readRatingRange();

  applyRatingRangeState(range);
  state.libraryRatingRange = range;
  state.libraryFilters = readLibraryFilters(range);

  syncServerSubscription();
  renderLibrary();
}

/**
 * Restablece los controles y los filtros de la biblioteca
 * («Limpiar filtros» de UI-S05): la lista completa vuelve a pintarse
 * (AC-S24).
 */
function clearLibraryFilters() {
  const library = dom?.library ?? {};

  if (librarySearchTimer !== null) {
    clearTimeout(librarySearchTimer);
    librarySearchTimer = null;
  }

  if (library.search) library.search.value = "";
  if (library.status) library.status.value = "";
  if (library.genre) library.genre.value = "";
  if (library.collection) library.collection.value = "";
  if (library.ratingMin) library.ratingMin.value = "";
  if (library.ratingMax) library.ratingMax.value = "";
  if (library.sort) library.sort.value = DEFAULT_SORT_KEY;

  // Los controles ya están vacíos: `applyLibraryFilters` relee los
  // valores por defecto y renueva la suscripción sin filtros.
  applyLibraryFilters();
}

/**
 * Búsqueda instantánea de la biblioteca (mismo debounce que el
 * catálogo: 300 ms, NFR-S04). Al vaciar el buscador se aplica al
 * momento.
 */
function onLibrarySearchInput() {
  if (librarySearchTimer !== null) {
    clearTimeout(librarySearchTimer);
    librarySearchTimer = null;
  }

  const query = dom?.library?.search?.value?.trim() ?? "";

  if (query === "") {
    applyLibraryFilters();
    return;
  }

  librarySearchTimer = setTimeout(() => {
    librarySearchTimer = null;
    applyLibraryFilters();
  }, SEARCH_DEBOUNCE_MS);
}

// -------------------------------------------------------------
// Datos de la biblioteca y de las colecciones
// -------------------------------------------------------------

/**
 * Recibe el snapshot de la biblioteca **sin** filtros: alimenta la
 * barra de estadísticas (UI-S02) y el índice de series ya añadidas
 * que usa el catálogo.
 *
 * @param {Array<Record<string, unknown>>} series
 */
function onLibraryStatsSnapshot(series) {
  const list = Array.isArray(series) ? series : [];

  state.library = list;
  state.libraryByDocId = new Map();
  state.libraryByTmdbId = new Map();

  for (const item of list) {
    if (typeof item?.id === "string") state.libraryByDocId.set(item.id, item);
    if (typeof item?.tmdbId === "number") {
      state.libraryByTmdbId.set(String(item.tmdbId), item);
    }
  }

  renderStats(list);
  syncCatalogAddButtons();

  // El estado vacío depende de si la biblioteca tiene alguna serie:
  // solo se actualiza cuando ya hay una pintada de la rejilla. Sin
  // ese dato, el recuento visible aún no es válido y el mensaje
  // podría ser incorrecto («biblioteca vacía» cuando los filtros
  // simplemente no dejan pasar ninguna serie).
  if (libraryFilteredLoaded) {
    updateLibraryEmptyState();
  }
}

/**
 * Recibe el snapshot de la biblioteca **con** los filtros de
 * servidor: es la lista que se pinta en la rejilla (UI-S05).
 *
 * @param {Array<Record<string, unknown>>} series
 */
function onLibrarySnapshot(series) {
  state.libraryFiltered = Array.isArray(series) ? series : [];
  libraryFilteredLoaded = true;

  // El snapshot llegó bien: se descarta cualquier error de carga
  // anterior para que el aviso no se quede pegado.
  libraryLoadError = "";
  renderLibraryError();

  const grid = dom?.library?.grid;
  if (grid) grid.removeAttribute("aria-busy");

  renderLibrary();
}

/**
 * Recibe el snapshot de las colecciones: repuebla el filtro por
 * colección (UI-S05, DB-S03).
 *
 * @param {Array<Record<string, unknown>>} collections
 */
function onCollectionsSnapshot(collections) {
  state.collections = Array.isArray(collections) ? collections : [];
  populateCollectionFilter(state.collections);
}

/**
 * Filtros que el servidor puede aplicar (ALG-S02, DB-S05): una
 * igualdad (`status` o `isFavorite`) y hasta dos `array-contains`
 * (`genreIds`, `collectionIds`).
 *
 * «Favoritas» no es un estado interno: se traduce al pseudofiltro
 * `isFavorite === true` para no mezclar ambas condiciones en la
 * consulta.
 *
 * @returns {{
 *   status: string,
 *   favorite: boolean,
 *   genreId: number|null,
 *   collectionId: string
 * }}
 */
function readServerFilters() {
  const library = dom?.library ?? {};
  const status = library.status?.value ?? "";
  const isFavorites = status === "favorites";

  return {
    status: isFavorites ? "" : normalizeServerStatus(status),
    favorite: isFavorites,
    genreId: library.genre?.value ? Number(library.genre.value) : null,
    collectionId: library.collection?.value ?? "",
  };
}

/**
 * Traduce el valor del selector de estado al estado interno válido
 * para el servidor (DB-S01). Cualquier valor desconocido se ignora.
 *
 * @param {string} status
 * @returns {string}
 */
function normalizeServerStatus(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status)
    ? status
    : "";
}

/**
 * Firma comparable de los filtros de servidor: permite detectar un
 * cambio real y evitar resuscripciones innecesarias.
 *
 * @param {{ status: string, favorite: boolean, genreId: number|null, collectionId: string }} filters
 * @returns {string}
 */
function computeServerFiltersSignature(filters) {
  return [
    filters.status,
    filters.favorite,
    filters.genreId ?? "",
    filters.collectionId,
  ].join("|");
}

/**
 * Suscribe la biblioteca con los filtros de servidor (UI-S05). Cada
 * cambio de filtro renueva la suscripción para que Firestore use los
 * índices correspondientes (DB-S05).
 *
 * @param {{ status: string, favorite: boolean, genreId: number|null, collectionId: string }} serverFilters
 */
function subscribeLibraryData(serverFilters) {
  serverFiltersSignature = computeServerFiltersSignature(serverFilters);

  if (typeof libraryUnsubscribe === "function") {
    try {
      libraryUnsubscribe();
    } catch {
      // Una baja fallida no debe impedir la nueva suscripción.
    }
    libraryUnsubscribe = null;
  }

  const grid = dom?.library?.grid;
  if (grid) grid.setAttribute("aria-busy", "true");

  try {
    libraryUnsubscribe = subscribeSeries(
      serverFilters,
      onLibrarySnapshot,
      (error) => {
        libraryLoadError = `No se pudo cargar tu biblioteca de series. ${describeRepositoryError(error)}`;
        renderLibraryError();
      }
    );
  } catch (error) {
    libraryLoadError = describeRepositoryError(error);
    setMessage(dom?.messages?.error, libraryLoadError);
    renderLibraryError();
  }
}

/**
 * Renueva la suscripción de la biblioteca cuando cambian los filtros
 * que el servidor puede aplicar (estado/favoritas, género y
 * colección).
 */
function syncServerSubscription() {
  const serverFilters = readServerFilters();
  if (
    computeServerFiltersSignature(serverFilters) === serverFiltersSignature
  ) {
    return;
  }

  subscribeLibraryData(serverFilters);
}

/**
 * Suscribe las fuentes auxiliares: la biblioteca sin filtros (para
 * las estadísticas, UI-S02) y las colecciones (DB-S03). Sin sesión
 * activa se avisa en español y la vista sigue operativa (SEC-S03).
 */
function subscribeLibrarySources() {
  try {
    statsUnsubscribe = subscribeSeries({}, onLibraryStatsSnapshot, (error) => {
      libraryLoadError = `No se pudo cargar tu biblioteca de series. ${describeRepositoryError(error)}`;
      renderLibraryError();
    });
  } catch (error) {
    setMessage(dom?.messages?.error, describeRepositoryError(error));
  }

  try {
    collectionsUnsubscribe = subscribeCollections(onCollectionsSnapshot, () => {
      // Un fallo en las colecciones no debe romper la biblioteca.
    });
  } catch {
    // Sin colecciones no hay filtro por colección; el resto funciona.
  }
}

// -------------------------------------------------------------
// Ficha de serie (UI-S06, ALG-S04, ALG-S06, D-S09)
// -------------------------------------------------------------

/**
 * Valores de la parte personal de la ficha en el momento del último
 * guardado: sirven para detectar cambios pendientes (D-S09, AC-S31).
 *
 * @typedef {Object} DetailPersonal
 * @property {string} userRating Texto escrito en el campo de nota.
 * @property {string} userReview Texto escrito en la reseña.
 * @property {string} tags Texto escrito en el campo de etiquetas.
 * @property {boolean} hasSpoilers Estado de la casilla de spoilers.
 */

/**
 * @typedef {Object} SeriesDetailState
 * @property {string|null} docId Id del documento en la biblioteca.
 * @property {string|null} tmdbId Id de TMDB (`null` si es manual).
 * @property {boolean} inLibrary `true` si la serie está en la biblioteca.
 * @property {Record<string, unknown>|null} series Modelo pintado.
 * @property {DetailPersonal} saved Últimos valores guardados.
 * @property {boolean} spoilerRevealed `true` si la reseña se ha revelado.
 * @property {boolean} busy `true` mientras hay una escritura en curso.
 * @property {HTMLElement|null} trigger Elemento que abrió la ficha.
 */

/**
 * Estado inicial de la ficha.
 *
 * @returns {SeriesDetailState}
 */
function createDetailState() {
  return {
    docId: null,
    tmdbId: null,
    inLibrary: false,
    series: null,
    saved: { userRating: "", userReview: "", tags: "", hasSpoilers: false },
    spoilerRevealed: false,
    busy: false,
    trigger: null,
  };
}

/** Estado vivo de la ficha. */
let detailState = createDetailState();

/** Nodo de error creado dentro del diálogo (`role="alert"`). */
let detailErrorNode = null;

/** Nodo de aviso creado dentro del diálogo (`role="status"`). */
let detailStatusNode = null;

/** Nodo de aviso informativo de la vista de catálogo. */
let detailHintNode = null;

/** Nodo de aviso del alta manual (`role="status"`). */
let manualStatusNode = null;

/**
 * Convierte un valor de fecha (cadena «YYYY-MM-DD», `Date` o
 * `Timestamp` de Firestore) en `Date`. `null` si no se reconoce.
 *
 * @param {unknown} value
 * @returns {Date|null}
 */
function toDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (value && typeof value === "object" && typeof value.toDate === "function") {
    try {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    } catch {
      return null;
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    const date = new Date(`${trimmed}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

/**
 * «3 temporadas · 24 episodios» (UI-S06, AC-S04).
 *
 * @param {unknown} seasons
 * @param {unknown} episodes
 * @returns {string}
 */
function formatCounts(seasons, episodes) {
  const parts = [];

  if (typeof seasons === "number" && Number.isFinite(seasons)) {
    parts.push(`${seasons} ${seasons === 1 ? "temporada" : "temporadas"}`);
  }

  if (typeof episodes === "number" && Number.isFinite(episodes)) {
    parts.push(`${episodes} ${episodes === 1 ? "episodio" : "episodios"}`);
  }

  return parts.join(" · ");
}

/**
 * Lista de nombres separada por comas («Netflix, HBO Max»).
 *
 * @param {unknown} values
 * @returns {string}
 */
function formatNameList(values) {
  if (!Array.isArray(values)) return "";

  return values
    .filter((item) => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim())
    .join(", ");
}

/**
 * «TMDB 8,4 (12.345 votos)» (AC-S04). La nota de TMDB nunca se
 * mezcla con la nota personal (AC-S32).
 *
 * @param {unknown} rating
 * @param {unknown} voteCount
 * @returns {string}
 */
function formatTmdbRating(rating, voteCount) {
  const value = formatRating(rating);
  if (value === null) return "";

  const votes = formatInteger(voteCount);
  return votes === null ? `TMDB ${value}` : `TMDB ${value} (${votes} votos)`;
}

/**
 * Traduce un error de la ficha: los códigos de TMDB siguen el mapa de
 * ALG-S05 y el resto usa el mensaje del repositorio (ya en español).
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeDetailError(error) {
  if (
    error &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    Object.prototype.hasOwnProperty.call(TMDB_ERROR_MESSAGES, error.code)
  ) {
    return TMDB_ERROR_MESSAGES[error.code];
  }

  return describeRepositoryError(error);
}

/**
 * Convierte un detalle de TMDB en el modelo que pinta la ficha. Los
 * campos personales quedan vacíos: la vista de catálogo no sigue
 * ninguna serie (UI-S06).
 *
 * @param {Record<string, unknown>} detail
 * @returns {Record<string, unknown>}
 */
function tmdbDetailToSeries(detail) {
  const data = detail && typeof detail === "object" ? detail : {};

  return {
    id: null,
    source: "tmdb",
    tmdbId: typeof data.id === "number" ? data.id : null,
    name: typeof data.name === "string" ? data.name : "",
    originalName: typeof data.originalName === "string" ? data.originalName : "",
    posterPath: typeof data.posterPath === "string" ? data.posterPath : null,
    backdropPath:
      typeof data.backdropPath === "string" ? data.backdropPath : null,
    firstAirDate:
      typeof data.firstAirDate === "string" ? data.firstAirDate : null,
    numberOfSeasons:
      typeof data.numberOfSeasons === "number" ? data.numberOfSeasons : null,
    numberOfEpisodes:
      typeof data.numberOfEpisodes === "number" ? data.numberOfEpisodes : null,
    tmdbStatus: typeof data.tmdbStatus === "string" ? data.tmdbStatus : null,
    networks: Array.isArray(data.networks) ? data.networks : [],
    episodeRuntime:
      typeof data.episodeRuntime === "number" ? data.episodeRuntime : null,
    genreIds: Array.isArray(data.genreIds) ? data.genreIds : [],
    genres: Array.isArray(data.genres) ? data.genres : [],
    overview: typeof data.overview === "string" ? data.overview : "",
    creators: Array.isArray(data.creators) ? data.creators : [],
    cast: Array.isArray(data.cast) ? data.cast : [],
    trailerKey: typeof data.trailerKey === "string" ? data.trailerKey : null,
    watchProviders: Array.isArray(data.watchProviders)
      ? data.watchProviders
      : [],
    tmdbRating: typeof data.voteAverage === "number" ? data.voteAverage : null,
    tmdbVoteCount: typeof data.voteCount === "number" ? data.voteCount : null,
    status: "watchlist",
    isFavorite: false,
    currentSeason: 1,
    currentEpisode: 1,
    watchedEpisodesCount: 0,
    favoriteEpisodesCount: 0,
    rewatchCount: 0,
    watchDates: [],
    lastWatchedAt: null,
    userRating: null,
    userReview: null,
    tags: [],
    hasSpoilers: false,
    collectionIds: [],
  };
}

/**
 * Crea (una sola vez) los nodos de aviso del diálogo: error
 * (`role="alert"`), aviso (`role="status"`) e indicación de la vista
 * de catálogo.
 */
function ensureDetailNodes() {
  const body = dom?.detail?.dialog?.querySelector(".series-detail__body");
  if (!body) return;

  if (!detailStatusNode || !detailStatusNode.isConnected) {
    detailStatusNode = document.createElement("p");
    detailStatusNode.className = "series-message";
    detailStatusNode.setAttribute("role", "status");
    detailStatusNode.hidden = true;
    body.insertAdjacentElement("afterbegin", detailStatusNode);
  }

  if (!detailErrorNode || !detailErrorNode.isConnected) {
    detailErrorNode = document.createElement("p");
    detailErrorNode.className = "series-message series-message--error";
    detailErrorNode.setAttribute("role", "alert");
    detailErrorNode.hidden = true;
    body.insertAdjacentElement("afterbegin", detailErrorNode);
  }

  if (!detailHintNode || !detailHintNode.isConnected) {
    detailHintNode = document.createElement("p");
    detailHintNode.className = "series-message";
    detailHintNode.hidden = true;
    body.insertAdjacentElement("afterbegin", detailHintNode);
  }
}

/**
 * Muestra un error dentro de la ficha (mensaje en español).
 *
 * @param {string} message
 */
function showDetailError(message) {
  ensureDetailNodes();
  setMessage(detailErrorNode, message);
}

/**
 * Muestra un aviso dentro de la ficha.
 *
 * @param {string} message
 */
function showDetailStatus(message) {
  ensureDetailNodes();
  setMessage(detailStatusNode, message);
}

/** Limpia los avisos de la ficha. */
function clearDetailMessages() {
  setMessage(detailErrorNode, "");
  setMessage(detailStatusNode, "");
  setMessage(detailHintNode, "");
}

/**
 * Título visible de la serie en la ficha (para los `aria-label`).
 *
 * @returns {string}
 */
function detailTitle() {
  const name = dom?.detail?.title?.textContent?.trim() ?? "";
  return name === "" ? "la serie" : name;
}

/**
 * Pinta los metadatos de TMDB de la ficha (AC-S04, AC-S05, AC-S32).
 *
 * @param {Record<string, unknown>|null} series
 */
function renderDetailMeta(series) {
  const d = dom?.detail;
  if (!d) return;

  const data = series ?? {};

  const title =
    typeof data.name === "string" && data.name.trim() !== ""
      ? data.name.trim()
      : "Sin título";
  setText(d.title, title);

  const originalName =
    typeof data.originalName === "string" ? data.originalName.trim() : "";
  setText(d.originalTitle, originalName === title ? "" : originalName);
  setVisible(d.originalTitle, originalName !== "" && originalName !== title);

  // Póster (w500) y fondo (w1280); sin ruta, imagen de reserva.
  if (d.poster instanceof HTMLImageElement) {
    const url = posterUrl(
      typeof data.posterPath === "string" ? data.posterPath : null,
      POSTER_SIZE
    );
    d.poster.src = url ?? POSTER_PLACEHOLDER;
    d.poster.alt = url ? `Póster de ${title}` : "Sin póster";
    d.poster.hidden = false;
  }

  if (d.backdrop instanceof HTMLImageElement) {
    const url = backdropUrl(
      typeof data.backdropPath === "string" ? data.backdropPath : null,
      "w1280"
    );
    d.backdrop.src = url ?? BACKDROP_PLACEHOLDER;
    d.backdrop.alt = url ? `Fondo de ${title}` : "";
    d.backdrop.hidden = false;
  }

  // Fecha de estreno en español.
  const firstAirDate = toDate(data.firstAirDate);
  const firstAirText =
    firstAirDate === null ? "" : `Estreno: ${longDateFormatter.format(firstAirDate)}`;
  setText(d.firstAir, firstAirText);
  setVisible(d.firstAir, firstAirText !== "");

  // «3 temporadas · 24 episodios».
  const counts = formatCounts(data.numberOfSeasons, data.numberOfEpisodes);
  setText(d.counts, counts);
  setVisible(d.counts, counts !== "");

  // Estado de emisión traducido (UI-S12).
  const rawStatus = typeof data.tmdbStatus === "string" ? data.tmdbStatus : "";
  const statusLabel = rawStatus === "" ? "" : tmdbStatusLabel(rawStatus);
  setText(d.tmdbStatus, statusLabel);
  setVisible(d.tmdbStatus, statusLabel !== "");

  // La nota de TMDB se muestra separada de la nota personal (AC-S32).
  const tmdbText = formatTmdbRating(data.tmdbRating, data.tmdbVoteCount);
  setText(d.tmdbRating, tmdbText);
  setVisible(d.tmdbRating, tmdbText !== "");

  const networks = formatNameList(data.networks);
  setText(d.networks, networks === "" ? "" : `Cadenas: ${networks}`);
  setVisible(d.networks, networks !== "");

  const genres = formatNameList(data.genres);
  setText(d.genres, genres === "" ? "" : `Géneros: ${genres}`);
  setVisible(d.genres, genres !== "");

  const overview =
    typeof data.overview === "string" ? data.overview.trim() : "";
  setText(d.overview, overview);
  setVisible(d.overview, overview !== "");

  const creators = formatNameList(data.creators);
  setText(d.creators, creators);
  setVisible(d.creators, creators !== "");

  const cast = formatNameList(data.cast);
  setText(d.cast, cast);
  setVisible(d.cast, cast !== "");

  // Tráiler (API-S09): enlace externo seguro.
  const trailer = trailerUrl(
    typeof data.trailerKey === "string" ? data.trailerKey : null
  );
  if (d.trailer instanceof HTMLAnchorElement) {
    if (trailer) {
      d.trailer.href = trailer;
      d.trailer.hidden = false;
    } else {
      d.trailer.removeAttribute("href");
      d.trailer.hidden = true;
    }
  }

  // «Dónde ver»: la sección se oculta si no hay proveedores (UI-S06).
  const providers = Array.isArray(data.watchProviders)
    ? data.watchProviders.filter(
        (item) => typeof item === "string" && item.trim() !== ""
      )
    : [];
  clearNode(d.providersList);
  for (const provider of providers) {
    const item = document.createElement("li");
    item.textContent = provider;
    d.providersList?.append(item);
  }
  setVisible(d.providers, providers.length > 0);
}

/**
 * Pinta la barra de progreso de la ficha: «6/24 · 25%» (AC-S10).
 * Sin `numberOfEpisodes` se muestra solo el contador.
 *
 * @param {Record<string, unknown>|null} series
 */
function renderDetailProgress(series) {
  const d = dom?.detail;
  if (!d) return;

  const data = series ?? {};
  const total =
    typeof data.numberOfEpisodes === "number" &&
    Number.isFinite(data.numberOfEpisodes)
      ? data.numberOfEpisodes
      : null;
  const watched =
    typeof data.watchedEpisodesCount === "number" &&
    Number.isFinite(data.watchedEpisodesCount)
      ? Math.max(0, Math.trunc(data.watchedEpisodesCount))
      : 0;

  const label = total === null ? String(watched) : `${watched}/${total}`;
  const percent =
    total !== null && total > 0
      ? Math.min(100, Math.max(0, Math.round((watched / total) * 100)))
      : 0;

  const labelNode = d.progress?.querySelector(
    '[data-series-role="progress-label"]'
  );
  if (labelNode) labelNode.textContent = label;

  const percentNode = d.progress?.querySelector(
    '[data-series-role="progress-percent"]'
  );
  if (percentNode) {
    percentNode.textContent = `${percent}%`;
    percentNode.hidden = total === null;
  }

  const bar = d.progress?.querySelector('[data-series-role="progress-bar"]');
  if (bar instanceof HTMLElement) {
    bar.setAttribute("aria-valuenow", String(percent));
    bar.setAttribute("aria-valuetext", `${label} · ${percent}%`);
    bar.hidden = total === null;
  }

  const fill = d.progress?.querySelector('[data-series-role="progress-fill"]');
  if (fill instanceof HTMLElement) fill.style.width = `${percent}%`;
}

/**
 * Estado del botón de favorito de la ficha (`aria-pressed`).
 *
 * @param {HTMLElement|null|undefined} button
 * @param {boolean} isFavorite
 * @param {string} title
 */
function updateDetailFavoriteButton(button, isFavorite, title) {
  if (!(button instanceof HTMLElement)) return;

  button.setAttribute("aria-pressed", isFavorite ? "true" : "false");

  const label = button.querySelector('[data-series-role="favorite-label"]');
  if (label) {
    label.textContent = isFavorite ? "Favorita" : "Marcar como favorita";
  }

  // El `aria-labelledby` del esqueleto daría un nombre genérico
  // («Favorito»): se sustituye por un `aria-label` descriptivo
  // (UI-S13, NFR-S02).
  button.removeAttribute("aria-labelledby");
  button.setAttribute(
    "aria-label",
    isFavorite
      ? `Quitar ${title} de favoritas`
      : `Marcar ${title} como favorita`
  );
}

/**
 * Estado del botón «+1 Episodio» de la ficha: «Completada» y
 * desactivado cuando ya se han visto todos los episodios conocidos.
 *
 * @param {HTMLElement|null|undefined} button
 * @param {Record<string, unknown>|null} series
 * @param {boolean} [editable]
 */
function updateDetailNextButton(button, series, editable = true) {
  if (!(button instanceof HTMLElement)) return;

  const data = series ?? {};
  const total =
    typeof data.numberOfEpisodes === "number" &&
    Number.isFinite(data.numberOfEpisodes)
      ? data.numberOfEpisodes
      : null;
  const watched =
    typeof data.watchedEpisodesCount === "number" &&
    Number.isFinite(data.watchedEpisodesCount)
      ? data.watchedEpisodesCount
      : 0;

  const completed = total !== null && watched >= total;
  button.disabled = !editable || completed;
  button.textContent = completed ? "Completada" : "+1 Episodio";
  button.setAttribute(
    "aria-label",
    completed
      ? "La serie está completada: no quedan episodios por marcar"
      : "Marcar el siguiente episodio como visto"
  );
}

/**
 * Pinta las fechas de visionado (revisionados) en es-ES (AC-S14).
 *
 * @param {unknown} watchDates
 */
function renderDetailWatchDates(watchDates) {
  const container = dom?.detail?.watchDates;
  if (!container) return;

  clearNode(container);

  const dates = Array.isArray(watchDates) ? watchDates : [];

  if (dates.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Sin fechas de visionado.";
    container.append(item);
    return;
  }

  for (const value of dates) {
    const date = toDate(value);
    const item = document.createElement("li");
    item.textContent = date === null ? "" : shortDateFormatter.format(date);
    container.append(item);
  }
}

/**
 * Pinta el bloque de seguimiento: estado, favorito, progreso,
 * «+1 Episodio», revisionados y fechas (UI-S06).
 *
 * @param {Record<string, unknown>|null} series
 */
function renderDetailTracking(series) {
  const d = dom?.detail;
  if (!d) return;

  const data = series ?? {};

  // Estado: las cuatro opciones con etiqueta en español (UI-S12).
  if (d.status instanceof HTMLSelectElement) {
    const status =
      typeof data.status === "string" &&
      Object.prototype.hasOwnProperty.call(STATUS_LABELS, data.status)
        ? data.status
        : "watchlist";
    d.status.value = status;
  }

  updateDetailFavoriteButton(d.favorite, data.isFavorite === true, detailTitle());
  renderDetailProgress(data);
  updateDetailNextButton(d.next, data, detailState.inLibrary);

  const rewatch =
    typeof data.rewatchCount === "number" && Number.isFinite(data.rewatchCount)
      ? Math.max(0, Math.trunc(data.rewatchCount))
      : 0;
  setText(d.rewatchCount, String(rewatch));

  renderDetailWatchDates(data.watchDates);
}

/**
 * Pinta un checkbox por colección del usuario (DB-S03, AC-S22). La
 * asignación es múltiple: una serie puede estar en varias.
 *
 * @param {Record<string, unknown>|null} series
 */
function renderDetailCollections(series) {
  const container = dom?.detail?.collections;
  if (!container) return;

  clearNode(container);

  const selected = new Set(
    Array.isArray(series?.collectionIds)
      ? series.collectionIds.map((id) => String(id))
      : []
  );

  for (const collection of state.collections) {
    const id = String(collection?.id ?? "");
    if (id === "") continue;

    const label = document.createElement("label");
    label.className = "series-checkbox";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = id;
    input.checked = selected.has(id);
    input.dataset.collectionId = id;

    label.append(input, document.createTextNode(` ${String(collection.name ?? "")}`));
    container.append(label);
  }

  if (state.collections.length === 0) {
    const hint = document.createElement("p");
    hint.className = "series-hint";
    hint.textContent = "Aún no tienes colecciones.";
    container.append(hint);
  }
}

/**
 * Muestra la nota personal formateada («Mi nota 8,5»), separada de la
 * nota de TMDB (AC-S32).
 *
 * @param {unknown} value
 */
function renderDetailUserRatingDisplay(value) {
  const node = dom?.detail?.userRatingDisplay;
  if (!node) return;

  const text = formatRating(value);
  node.textContent = text === null ? "Mi nota —" : `Mi nota ${text}`;
}

/**
 * Oculta la reseña cuando tiene spoilers y el usuario no la ha
 * revelado (AC-S16).
 */
function renderDetailSpoilerState() {
  const d = dom?.detail;
  if (!d) return;

  const hasSpoilers =
    d.spoilers instanceof HTMLInputElement ? d.spoilers.checked : false;
  const reviewText =
    d.review instanceof HTMLTextAreaElement ? d.review.value.trim() : "";

  const hidden = hasSpoilers && reviewText !== "" && !detailState.spoilerRevealed;

  if (d.review instanceof HTMLTextAreaElement) d.review.hidden = hidden;
  setVisible(d.spoilerWarning, hidden);
}

/**
 * Pinta la parte personal de la ficha: nota, reseña, spoilers,
 * etiquetas y colecciones (D-S09).
 *
 * @param {Record<string, unknown>|null} series
 */
function renderDetailPersonal(series) {
  const d = dom?.detail;
  if (!d) return;

  const data = series ?? {};

  const userRating =
    typeof data.userRating === "number" && Number.isFinite(data.userRating)
      ? data.userRating
      : null;

  if (d.userRating instanceof HTMLInputElement) {
    d.userRating.value = userRating === null ? "" : String(userRating);
    d.userRating.setAttribute("aria-invalid", "false");
  }
  renderDetailUserRatingDisplay(userRating);

  const userReview = typeof data.userReview === "string" ? data.userReview : "";
  if (d.review instanceof HTMLTextAreaElement) d.review.value = userReview;

  const hasSpoilers = data.hasSpoilers === true;
  if (d.spoilers instanceof HTMLInputElement) d.spoilers.checked = hasSpoilers;

  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag) => typeof tag === "string")
    : [];
  if (d.tags instanceof HTMLInputElement) d.tags.value = tags.join(", ");

  // Últimos valores guardados: base del aviso «Cambios sin guardar».
  detailState.saved = {
    userRating: userRating === null ? "" : String(userRating),
    userReview,
    tags: tags.join(", "),
    hasSpoilers,
  };

  detailState.spoilerRevealed = false;

  renderDetailCollections(data);
  renderDetailSpoilerState();
  updateDetailDirtyWarning();
}

/**
 * Lee los campos de la parte personal de la ficha.
 *
 * @returns {DetailPersonal}
 */
function readDetailPersonalForm() {
  const d = dom?.detail ?? {};

  return {
    userRating:
      d.userRating instanceof HTMLInputElement
        ? d.userRating.value.trim()
        : "",
    userReview: d.review instanceof HTMLTextAreaElement ? d.review.value : "",
    tags: d.tags instanceof HTMLInputElement ? d.tags.value : "",
    hasSpoilers:
      d.spoilers instanceof HTMLInputElement ? d.spoilers.checked : false,
  };
}

/**
 * `true` si hay cambios pendientes de nota, reseña, etiquetas o
 * spoilers (D-S09, AC-S31).
 *
 * @returns {boolean}
 */
function isDetailDirty() {
  const current = readDetailPersonalForm();
  const saved = detailState.saved;

  return (
    current.userRating !== saved.userRating ||
    current.userReview !== saved.userReview ||
    current.tags !== saved.tags ||
    current.hasSpoilers !== saved.hasSpoilers
  );
}

/**
 * Muestra u oculta el aviso «Cambios sin guardar» (AC-S31).
 */
function updateDetailDirtyWarning() {
  const node = dom?.detail?.dirtyWarning;
  if (!node) return;

  node.textContent = "Cambios sin guardar";
  node.hidden = !isDetailDirty();
}

/**
 * Divide el texto de las etiquetas en una lista (≤20 etiquetas de ≤30
 * caracteres; el repositorio lo valida).
 *
 * @param {string} value
 * @returns {string[]}
 */
function parseDetailTags(value) {
  if (typeof value !== "string") return [];

  const tags = [];
  for (const raw of value.split(",")) {
    const tag = raw.trim();
    if (tag === "") continue;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/**
 * Habilita o deshabilita los controles de la ficha según el contexto
 * (biblioteca o catálogo) y la escritura en curso.
 */
function updateDetailControls() {
  const d = dom?.detail;
  if (!d) return;

  const editable =
    detailState.inLibrary && Boolean(detailState.docId) && !detailState.busy;

  if (d.status instanceof HTMLSelectElement) d.status.disabled = !editable;
  if (d.favorite instanceof HTMLButtonElement) d.favorite.disabled = !editable;
  if (d.rewatchInc instanceof HTMLButtonElement) d.rewatchInc.disabled = !editable;
  if (d.rewatchDec instanceof HTMLButtonElement) d.rewatchDec.disabled = !editable;
  if (d.save instanceof HTMLButtonElement) d.save.disabled = !editable;
  if (d.remove instanceof HTMLButtonElement) d.remove.disabled = !editable;
  if (d.userRating instanceof HTMLInputElement) d.userRating.disabled = !editable;
  if (d.review instanceof HTMLTextAreaElement) d.review.disabled = !editable;
  if (d.spoilers instanceof HTMLInputElement) d.spoilers.disabled = !editable;
  if (d.tags instanceof HTMLInputElement) d.tags.disabled = !editable;
  if (d.collections) d.collections.hidden = !editable;

  updateDetailNextButton(d.next, detailState.series ?? {}, editable);

  setMessage(detailHintNode, editable ? "" : DETAIL_CATALOG_HINT);
}

/**
 * Marca la ficha como ocupada (o libre) mientras hay una escritura.
 *
 * @param {boolean} busy
 */
function setDetailBusy(busy) {
  detailState.busy = busy;
  updateDetailControls();
}

/**
 * Vacía la ficha y deja los controles en su estado inicial.
 */
function renderDetailSkeleton() {
  const d = dom?.detail;
  if (!d) return;

  setText(d.title, DETAIL_LOADING_TITLE);
  setText(d.originalTitle, "");
  setVisible(d.originalTitle, false);

  if (d.poster instanceof HTMLImageElement) {
    d.poster.removeAttribute("src");
    d.poster.hidden = true;
  }
  if (d.backdrop instanceof HTMLImageElement) {
    d.backdrop.removeAttribute("src");
    d.backdrop.hidden = true;
  }

  for (const node of [
    d.firstAir,
    d.counts,
    d.tmdbStatus,
    d.tmdbRating,
    d.networks,
    d.genres,
    d.overview,
    d.creators,
    d.cast,
  ]) {
    setText(node, "");
    setVisible(node, false);
  }

  if (d.trailer instanceof HTMLAnchorElement) {
    d.trailer.removeAttribute("href");
    d.trailer.hidden = true;
  }

  clearNode(d.providersList);
  setVisible(d.providers, false);

  if (d.status instanceof HTMLSelectElement) d.status.value = "watchlist";
  updateDetailFavoriteButton(d.favorite, false, "la serie");

  clearNode(d.watchDates);
  setText(d.rewatchCount, "0");

  if (d.userRating instanceof HTMLInputElement) {
    d.userRating.value = "";
    d.userRating.setAttribute("aria-invalid", "false");
  }
  if (d.review instanceof HTMLTextAreaElement) {
    d.review.value = "";
    d.review.hidden = false;
  }
  if (d.spoilers instanceof HTMLInputElement) d.spoilers.checked = false;
  if (d.tags instanceof HTMLInputElement) d.tags.value = "";

  clearNode(d.collections);
  setVisible(d.spoilerWarning, false);

  renderDetailUserRatingDisplay(null);
  updateDetailDirtyWarning();
  updateDetailControls();
}

/**
 * Abre la ficha de una serie (UI-S06).
 *
 * @param {CardModel} model
 * @returns {Promise<void>}
 */
async function openSeriesDetailDialog(model) {
  const d = dom?.detail;
  if (!d?.dialog) return;

  const docId = model?.context === "library" ? (model?.docId ?? null) : null;
  const trigger =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  detailState = {
    ...createDetailState(),
    docId,
    tmdbId: model?.tmdbId ?? null,
    inLibrary: Boolean(docId),
    trigger,
  };

  ensureDetailNodes();
  renderDetailSkeleton();
  clearDetailMessages();

  if (!d.dialog.open) {
    try {
      d.dialog.showModal();
    } catch {
      // Navegador sin diálogo modal: se abre igualmente.
      d.dialog.setAttribute("open", "");
    }
  }

  // Foco inicial en el título del diálogo (UI-S13, NFR-S02).
  d.title?.focus?.();

  if (docId) {
    await loadLibraryDetail(docId, false);
    return;
  }

  await loadCatalogDetail(model?.tmdbId ?? null);
}

/**
 * Carga la ficha de una serie de la biblioteca respetando la caché
 * de 30 días (ALG-S06, AC-S29).
 *
 * @param {string} docId
 * @param {boolean} force `true` para «Actualizar datos».
 * @returns {Promise<boolean>}
 */
async function loadLibraryDetail(docId, force) {
  setDetailBusy(true);

  try {
    const result = await ensureDetailCached(docId, { force });
    if (detailState.docId !== docId) return false;

    detailState.series = result.series;
    detailState.inLibrary = true;
    renderDetailMeta(result.series);
    renderDetailTracking(result.series);
    renderDetailPersonal(result.series);
    updateDetailControls();
    clearDetailMessages();
    return true;
  } catch (error) {
    // Si hay datos previos se muestran con un aviso en español
    // (ALG-S06): la app sigue operativa.
    const cached = state.libraryByDocId.get(docId);
    if (cached) {
      detailState.series = cached;
      detailState.inLibrary = true;
      renderDetailMeta(cached);
      renderDetailTracking(cached);
      renderDetailPersonal(cached);
      updateDetailControls();
      showDetailError(describeDetailError(error));
      return false;
    }

    showDetailError(describeDetailError(error));
    return false;
  } finally {
    setDetailBusy(false);
    updateDetailControls();
  }
}

/**
 * Carga la ficha de una serie del catálogo (sin biblioteca): una sola
 * petición de detalle a TMDB (API-S06, AC-S04).
 *
 * @param {string|null} tmdbId
 * @returns {Promise<boolean>}
 */
async function loadCatalogDetail(tmdbId) {
  if (!tmdbId) {
    showDetailError(DETAIL_UNKNOWN_SERIES_MESSAGE);
    return false;
  }

  if (!isTmdbConfigured()) {
    showDetailError(TMDB_ERROR_MESSAGES.NO_API_KEY);
    setTmdbWarning(TMDB_ERROR_MESSAGES.NO_API_KEY);
    return false;
  }

  setDetailBusy(true);

  try {
    const detail = await getSeriesDetail(Number(tmdbId));
    if (detailState.tmdbId !== String(tmdbId)) return false;

    const series = tmdbDetailToSeries(detail);
    detailState.series = series;
    detailState.inLibrary = false;
    renderDetailMeta(series);
    renderDetailTracking(series);
    renderDetailPersonal(series);
    updateDetailControls();
    clearDetailMessages();
    return true;
  } catch (error) {
    const message = describeTmdbError(error);
    showDetailError(message);
    setTmdbWarning(message);
    return false;
  } finally {
    setDetailBusy(false);
    updateDetailControls();
  }
}

/**
 * Cierra la ficha.
 */
function closeSeriesDetail() {
  const dialog = dom?.detail?.dialog;
  if (dialog?.open) dialog.close();
}

/**
 * Al cerrarse la ficha: se descartan los cambios pendientes y el foco
 * vuelve al elemento que la abrió (UI-S13, AC-S31).
 */
function onSeriesDetailClosed() {
  const trigger = detailState.trigger;

  detailState = createDetailState();
  clearDetailMessages();
  setMessage(dom?.messages?.error, "");

  // Los valores sin guardar se descartan: la próxima apertura vuelve
  // a mostrar los valores guardados (AC-S31).
  renderDetailPersonal(null);

  if (trigger && trigger.isConnected && typeof trigger.focus === "function") {
    trigger.focus();
  }
}

/**
 * Cambio manual de estado: se guarda de inmediato (D-S09).
 */
async function handleDetailStatusChange() {
  const d = dom?.detail;
  const docId = detailState.docId;
  if (!(d?.status instanceof HTMLSelectElement) || !docId) return;

  const value = d.status.value;
  if (!Object.prototype.hasOwnProperty.call(STATUS_LABELS, value)) return;

  setDetailBusy(true);
  try {
    await setStatus(docId, value);
    if (detailState.series) {
      detailState.series = { ...detailState.series, status: value };
    }
    showDetailStatus(DETAIL_STATUS_MESSAGE);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    showDetailError(describeDetailError(error));
    renderDetailTracking(detailState.series ?? {});
  } finally {
    setDetailBusy(false);
    updateDetailControls();
  }
}

/**
 * Favorito de la serie: se guarda de inmediato (D-S09, AC-S13).
 */
async function handleDetailFavorite() {
  const d = dom?.detail;
  const docId = detailState.docId;
  if (!(d?.favorite instanceof HTMLButtonElement) || !docId) return;

  const previous = detailState.series?.isFavorite === true;
  const next = !previous;

  updateDetailFavoriteButton(d.favorite, next, detailTitle());
  if (detailState.series) {
    detailState.series = { ...detailState.series, isFavorite: next };
  }

  try {
    await setFavorite(docId, next);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    updateDetailFavoriteButton(d.favorite, previous, detailTitle());
    if (detailState.series) {
      detailState.series = { ...detailState.series, isFavorite: previous };
    }
    showDetailError(describeDetailError(error));
  }
}

/**
 * «+1 Episodio»: marca el siguiente episodio como visto (ALG-S03,
 * AC-S11). Se guarda de inmediato (D-S09).
 */
async function handleDetailNext() {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  const season = Number(detailState.series?.currentSeason ?? 1);
  const episode = Number(detailState.series?.currentEpisode ?? 1);

  setDetailBusy(true);
  try {
    const result = await setEpisodeWatched(docId, season, episode);

    if (detailState.series) {
      detailState.series = {
        ...detailState.series,
        watchedEpisodesCount: result.watchedEpisodesCount,
        favoriteEpisodesCount: result.favoriteEpisodesCount,
        currentSeason: result.currentSeason,
        currentEpisode: result.currentEpisode,
        status: result.status,
      };
    }

    renderDetailTracking(detailState.series ?? {});
    showDetailStatus(DETAIL_EPISODE_MESSAGE);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    showDetailError(describeDetailError(error));
  } finally {
    setDetailBusy(false);
    updateDetailControls();
  }
}

/**
 * Revisionados: «+1» y «−1» con su lista de fechas (ALG-S09, AC-S14).
 *
 * @param {number} delta `1` suma, `-1` resta.
 */
async function handleDetailRewatch(delta) {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  const current = detailState.series ?? {};
  const count =
    typeof current.rewatchCount === "number" &&
    Number.isFinite(current.rewatchCount)
      ? Math.max(0, Math.trunc(current.rewatchCount))
      : 0;
  const dates = Array.isArray(current.watchDates)
    ? [...current.watchDates]
    : [];

  setDetailBusy(true);
  try {
    if (delta > 0) await incRewatch(docId);
    else await decRewatch(docId);

    // El repositorio devuelve el id del documento ya escrito: el
    // recuento y las fechas se aplican sobre el documento en memoria
    // con las mismas reglas de ALG-S09, así la ficha se repinta sin
    // volver a leer el documento (D-S09).
    const nextCount =
      delta > 0
        ? Math.min(MAX_REWATCH_COUNT, count + 1)
        : Math.max(0, count - 1);

    if (delta > 0) {
      dates.push(new Date());
    } else if (dates.length > 0) {
      dates.pop();
    }
    // `watchDates` nunca queda con más entradas que `rewatchCount`.
    while (dates.length > nextCount) dates.shift();

    if (detailState.series) {
      detailState.series = {
        ...detailState.series,
        rewatchCount: nextCount,
        watchDates: dates,
        lastWatchedAt:
          dates.length > 0 ? dates[dates.length - 1] : null,
      };
    }

    renderDetailTracking(detailState.series ?? {});
    showDetailStatus(
      delta > 0 ? DETAIL_REWATCH_UP_MESSAGE : DETAIL_REWATCH_DOWN_MESSAGE
    );
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    showDetailError(describeDetailError(error));
  } finally {
    setDetailBusy(false);
    updateDetailControls();
  }
}

/** «+1» de revisionados (AC-S14). */
function onDetailRewatchInc() {
  void handleDetailRewatch(1);
}

/** «−1» de revisionados (AC-S14). */
function onDetailRewatchDec() {
  void handleDetailRewatch(-1);
}

/**
 * Asigna las colecciones marcadas: se guarda de inmediato (D-S09,
 * AC-S22).
 *
 * @param {Event} event
 */
async function handleDetailCollectionsChange(event) {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input || input.type !== "checkbox") return;

  const container = dom?.detail?.collections;
  const ids = [];
  for (const node of container?.querySelectorAll('input[type="checkbox"]') ?? []) {
    if (node instanceof HTMLInputElement && node.checked) ids.push(node.value);
  }

  setDetailBusy(true);
  try {
    await setCollections(docId, ids);
    if (detailState.series) {
      detailState.series = { ...detailState.series, collectionIds: ids };
    }
    showDetailStatus(DETAIL_COLLECTIONS_MESSAGE);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    showDetailError(describeDetailError(error));
    renderDetailCollections(detailState.series ?? {});
  } finally {
    setDetailBusy(false);
    updateDetailControls();
  }
}

/**
 * «Guardar»: persiste nota, reseña, etiquetas y spoilers (D-S09,
 * AC-S15, AC-S16).
 */
async function handleDetailSave() {
  const d = dom?.detail;
  const docId = detailState.docId;
  if (!d || !docId || !detailState.inLibrary) return;

  let userRating = null;
  try {
    const raw = readDetailRatingRaw(d.userRating);
    userRating = parseUserRating(raw === "" ? null : raw);
  } catch (error) {
    const message =
      error instanceof UserRatingError ? error.message : USER_RATING_ERROR_MESSAGE;
    if (d.userRating instanceof HTMLInputElement) {
      d.userRating.setAttribute("aria-invalid", "true");
    }
    showDetailError(message);
    return;
  }

  if (d.userRating instanceof HTMLInputElement) {
    d.userRating.setAttribute("aria-invalid", "false");
  }

  const review = d.review instanceof HTMLTextAreaElement ? d.review.value.trim() : "";
  const tags = parseDetailTags(d.tags instanceof HTMLInputElement ? d.tags.value : "");
  const hasSpoilers = d.spoilers instanceof HTMLInputElement ? d.spoilers.checked : false;

  const current = readDetailPersonalForm();
  const changed =
    current.userRating !== detailState.saved.userRating ||
    current.userReview !== detailState.saved.userReview ||
    current.tags !== detailState.saved.tags ||
    current.hasSpoilers !== detailState.saved.hasSpoilers;

  if (!changed) {
    updateDetailDirtyWarning();
    showDetailStatus(DETAIL_NOTHING_TO_SAVE_MESSAGE);
    return;
  }

  setDetailBusy(true);
  try {
    await updatePersonal(docId, {
      userRating,
      userReview: review === "" ? null : review,
      tags,
      hasSpoilers,
    });

    detailState.saved = { ...current };
    if (detailState.series) {
      detailState.series = {
        ...detailState.series,
        userRating,
        userReview: review === "" ? null : review,
        tags,
        hasSpoilers,
      };
    }

    renderDetailUserRatingDisplay(userRating);
    renderDetailSpoilerState();
    updateDetailDirtyWarning();
    showDetailStatus(DETAIL_SAVED_MESSAGE);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    showDetailError(describeDetailError(error));
  } finally {
    setDetailBusy(false);
    updateDetailControls();
  }
}

/**
 * Texto escrito en el campo de nota. El campo se pinta como texto
 * (no número) para que se pueda escribir la coma decimal es-ES
 * («7,5»), que `parseUserRating` acepta (ALG-S04).
 *
 * @param {HTMLInputElement|null|undefined} input
 * @returns {string}
 */
function readDetailRatingRaw(input) {
  if (!(input instanceof HTMLInputElement)) return "";
  return typeof input.value === "string" ? input.value.trim() : "";
}

/**
 * «Actualizar datos»: fuerza la recarga de TMDB (ALG-S06, AC-S29).
 */
async function handleDetailRefresh() {
  if (detailState.inLibrary && detailState.docId) {
    const ok = await loadLibraryDetail(detailState.docId, true);
    if (ok) showDetailStatus(DETAIL_REFRESHED_MESSAGE);
    return;
  }

  if (detailState.tmdbId) {
    await loadCatalogDetail(detailState.tmdbId);
  }
}

/**
 * «Eliminar»: borra la serie tras confirmar (AC-S31). Si se cancela
 * la confirmación, el documento sigue en la biblioteca.
 */
async function handleDetailDelete() {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  const confirmed = window.confirm(DETAIL_DELETE_CONFIRM_MESSAGE);
  if (!confirmed) return;

  setDetailBusy(true);
  try {
    await deleteSeries(docId);
    closeSeriesDetail();
    showNotice("Serie eliminada de tu biblioteca.");
  } catch (error) {
    showDetailError(describeDetailError(error));
  } finally {
    setDetailBusy(false);
    updateDetailControls();
  }
}

/**
 * «Mostrar reseña»: revela el texto con spoilers (AC-S16).
 */
function onDetailSpoilerReveal() {
  detailState.spoilerRevealed = true;
  renderDetailSpoilerState();
  dom?.detail?.review?.focus?.();
}

/**
 * Cualquier cambio en la parte personal actualiza el aviso de cambios
 * pendientes y el estado de spoilers (D-S09, AC-S31).
 */
function onDetailPersonalInput() {
  renderDetailSpoilerState();
  updateDetailDirtyWarning();
}

// -------------------------------------------------------------
// Alta manual de series (UI-S11, REQ-S02, AC-S08)
// -------------------------------------------------------------

/**
 * Rellena el multi-select de géneros con el diccionario estático de TV
 * (D-S08): así el filtro por género siempre funciona.
 */
function populateManualGenres() {
  const select = dom?.manual?.genres;
  if (!(select instanceof HTMLSelectElement)) return;

  clearNode(select);
  for (const genre of TV_GENRE_OPTIONS) {
    const option = document.createElement("option");
    option.value = String(genre.id);
    option.textContent = genre.label;
    select.append(option);
  }
}

/**
 * «Añadir manualmente»: muestra u oculta el formulario de alta
 * manual (UI-S11). Sigue operativo sin TMDB (AC-S01, AC-S06).
 */
function onManualOpen() {
  const form = dom?.manual?.form;
  if (!form) return;

  setManualFormVisible(form.hidden);
}

/**
 * Muestra u oculta el formulario de alta manual.
 *
 * @param {boolean} visible
 */
function setManualFormVisible(visible) {
  const form = dom?.manual?.form;
  if (!form) return;

  form.hidden = !visible;
  if (visible) dom?.manual?.name?.focus?.();
}

/**
 * Lee un entero opcional de un input: `null` si está vacío y
 * `undefined` si el valor no es válido.
 *
 * @param {HTMLInputElement|null|undefined} input
 * @param {number} min
 * @param {number} max
 * @returns {number|null|undefined}
 */
function readOptionalInteger(input, min, max) {
  if (!(input instanceof HTMLInputElement)) return null;

  const raw = input.value.trim();
  if (raw === "") return null;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return undefined;

  return parsed;
}

/**
 * Géneros marcados en el multi-select del alta manual.
 *
 * @returns {{ genreIds: number[], genres: string[] }}
 */
function readManualGenres() {
  const select = dom?.manual?.genres;
  const genreIds = [];
  const genres = [];

  if (select instanceof HTMLSelectElement) {
    for (const option of select.selectedOptions) {
      const id = Number(option.value);
      if (!Number.isInteger(id)) continue;
      genreIds.push(id);
      const label = TV_GENRE_OPTIONS.find((genre) => genre.id === id)?.label;
      if (label) genres.push(label);
    }
  }

  return { genreIds, genres };
}

/**
 * Alta manual de una serie (UI-S11, REQ-S02, AC-S08). No hace
 * ninguna llamada a TMDB: funciona sin conexión y sin clave.
 *
 * @param {SubmitEvent} event
 */
async function handleManualSubmit(event) {
  event.preventDefault();

  const manual = dom?.manual ?? {};

  const name = manual.name?.value?.trim() ?? "";
  if (name === "") {
    setMessage(manual.error, MANUAL_NAME_ERROR);
    manual.name?.focus?.();
    return;
  }

  const year = readOptionalInteger(manual.year, MANUAL_MIN_YEAR, MANUAL_MAX_YEAR);
  if (year === undefined) {
    setMessage(manual.error, MANUAL_YEAR_ERROR);
    manual.year?.focus?.();
    return;
  }

  const seasons = readOptionalInteger(
    manual.seasons,
    MANUAL_MIN_SEASONS,
    MANUAL_MAX_SEASONS
  );
  if (seasons === undefined) {
    setMessage(manual.error, MANUAL_SEASONS_ERROR);
    manual.seasons?.focus?.();
    return;
  }

  const episodes = readOptionalInteger(
    manual.episodes,
    MANUAL_MIN_EPISODES,
    MANUAL_MAX_EPISODES
  );
  if (episodes === undefined) {
    setMessage(manual.error, MANUAL_EPISODES_ERROR);
    manual.episodes?.focus?.();
    return;
  }

  const overview = manual.overview?.value?.trim() ?? "";
  const { genreIds, genres } = readManualGenres();

  try {
    await addManual({
      name,
      firstAirYear: year ?? null,
      numberOfSeasons: seasons ?? null,
      numberOfEpisodes: episodes ?? null,
      overview: overview === "" ? null : overview,
      genreIds,
      genres,
    });

    if (manual.form instanceof HTMLFormElement) manual.form.reset();
    setMessage(manual.error, "");
    setManualFormVisible(false);
    showManualStatus(MANUAL_SUCCESS_MESSAGE);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    setMessage(manual.error, describeRepositoryError(error));
  }
}

/**
 * Muestra el aviso de éxito del alta manual.
 *
 * @param {string} message
 */
function showManualStatus(message) {
  const form = dom?.manual?.form;
  if (!form) return;

  if (!manualStatusNode || !manualStatusNode.isConnected) {
    const node = document.createElement("p");
    node.className = "series-message";
    node.setAttribute("role", "status");
    manualStatusNode = node;
    form.insertAdjacentElement("afterend", node);
  }

  setMessage(manualStatusNode, message);
}

// -------------------------------------------------------------
// Acciones de las tarjetas (UI-S04)
// -------------------------------------------------------------

/**
 * Abre la ficha de una serie. Si hay un abridor externo registrado
 * (`setSeriesDetailOpener`) se delega en él; la ficha en `<dialog>`
 * la implementa T-S08 (UI-S06).
 *
 * @param {CardModel} model
 */
function openSeriesDetail(model) {
  if (typeof detailOpener === "function") {
    detailOpener(model);
  }
}

/**
 * «Añadir»: alta inmediata con `status:"watchlist"` (DB-S04,
 * AC-S07).
 *
 * @param {HTMLElement} button
 */
async function handleAddSeries(button) {
  const card = button.closest('[data-series-role="card"]');
  const model = card ? cardModels.get(card) : null;
  if (!model || model.context !== "catalog") return;

  button.disabled = true;
  button.textContent = "Añadiendo…";

  try {
    await addFromTmdb(model.raw);
    updateAddButton(button, model, true);
    setMessage(dom?.messages?.error, "");
    showNotice(`«${model.title}» añadida a tu biblioteca.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Añadir";
    setMessage(dom?.messages?.error, describeRepositoryError(error));
  }
}

/**
 * Favorito de la tarjeta de biblioteca (UI-S04, AC-S13).
 *
 * El cambio se aplica de forma optimista: el estado en memoria y la
 * tarjeta se actualizan al instante. Si la escritura falla, se
 * revierte sobre los nodos vivos.
 *
 * Si la serie deja de cumplir el filtro activo (por ejemplo, con el
 * filtro «Favoritas»), la rejilla se repinta y la tarjeta desaparece
 * de la lista (UI-S05).
 *
 * @param {HTMLElement} button
 */
async function handleToggleFavorite(button) {
  const card = button.closest('[data-series-role="card"]');
  const model = card ? cardModels.get(card) : null;
  if (!model || model.context !== "library" || !model.docId) return;

  const docId = model.docId;
  const previous = model.isFavorite;
  const next = !previous;

  // El foco vuelve al botón de favorito aunque la rejilla se
  // repinte durante la operación (UI-S13, NFR-S02).
  pendingLibraryFocus = { docId, role: "favorite" };

  // El modelo vivo se actualiza de inmediato: un doble clic antes
  // del snapshot de Firestore alterna sobre el valor real y no sobre
  // el valor obsoleto.
  model.isFavorite = next;

  updateFavoriteButton(button, next);
  applyLibraryFavorite(docId, next);
  syncLibraryCard(docId, next);

  try {
    await setFavorite(docId, next);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    // La reversión actúa sobre la tarjeta viva, no sobre un nodo
    // desconectado por un repintado anterior.
    model.isFavorite = previous;
    applyLibraryFavorite(docId, previous);
    syncLibraryCard(docId, previous);
    setMessage(dom?.messages?.error, describeRepositoryError(error));
  }

  // Tras el repintado, el foco vuelve al botón de favorito; si la
  // serie ya no está en la lista, a la rejilla (UI-S13, NFR-S02).
  restoreLibraryCardFocus(docId, "favorite");
}

/**
 * Aplica en memoria el nuevo estado de favorito de una serie
 * (AC-S13). No repinta: el parcheo de la tarjeta y el repintado los
 * hace `renderLibrary`.
 *
 * @param {string} docId
 * @param {boolean} isFavorite
 */
function applyLibraryFavorite(docId, isFavorite) {
  const patchList = (list) =>
    list.map((item) => (item?.id === docId ? { ...item, isFavorite } : item));

  state.library = patchList(state.library);
  state.libraryFiltered = patchList(state.libraryFiltered);

  const current = state.libraryByDocId.get(docId);
  if (current) {
    state.libraryByDocId.set(docId, { ...current, isFavorite });
  }
}

/**
 * Refleja el nuevo estado de favorito en la tarjeta de la biblioteca.
 * Si el filtro activo deja de incluir la serie (por ejemplo, con el
 * filtro «Favoritas»), la rejilla se repinta y la tarjeta desaparece
 * de la lista (UI-S05, AC-S13).
 *
 * @param {string} docId
 * @param {boolean} isFavorite
 */
function syncLibraryCard(docId, isFavorite) {
  const card = findLibraryCard(docId);
  const series = state.libraryFiltered.find((item) => item?.id === docId);

  if (!card || !series) {
    renderLibrary();
    return;
  }

  const button = card.querySelector('[data-series-role="favorite"]');
  if (button instanceof HTMLElement) {
    updateFavoriteButton(button, isFavorite);
  }

  const stillVisible = filterSeries([series], state.libraryFilters).length > 0;
  if (!stillVisible) {
    renderLibrary();
  }
}

/**
 * «+1 Episodio»: marca el siguiente episodio como visto (ALG-S03,
 * AC-S11). El repositorio recalcula los contadores y aplica las
 * transiciones de estado; aquí solo se refleja el resultado.
 *
 * @param {HTMLElement} button
 */
async function handleNextEpisode(button) {
  const card = button.closest('[data-series-role="card"]');
  const model = card ? cardModels.get(card) : null;
  if (!model || model.context !== "library" || !model.docId) return;

  const docId = model.docId;
  button.disabled = true;

  try {
    const result = await setEpisodeWatched(
      docId,
      model.currentSeason,
      model.currentEpisode
    );

    applyLocalEpisodeProgress(docId, result);
    setMessage(dom?.messages?.error, "");
    showNotice(`Episodio marcado en «${model.title}».`);
  } catch (error) {
    setMessage(dom?.messages?.error, describeRepositoryError(error));

    // El botón vuelve a su estado anterior: si la tarjeta sigue en
    // la rejilla (no hubo repintado) se restaura tal cual.
    const live = cardModels.get(card);
    if (live && card.isConnected) updateNextButton(button, live);
    else button.disabled = false;
  } finally {
    // El repintado de la rejilla sustituye la tarjeta: el foco
    // vuelve al botón «+1 Episodio» equivalente (UI-S13, NFR-S02).
    restoreLibraryCardFocus(docId, "next");
  }
}

/**
 * Tarjeta viva de una serie de la biblioteca dentro de la rejilla.
 *
 * @param {string} docId
 * @returns {HTMLElement|null}
 */
function findLibraryCard(docId) {
  const grid = dom?.library?.grid;
  if (!grid) return null;

  for (const node of grid.children) {
    if (!(node instanceof HTMLElement)) continue;
    const model = cardModels.get(node);
    if (model && model.docId === docId) return node;
  }

  return null;
}

/**
 * Devuelve el foco al botón indicado de la tarjeta de una serie
 * tras repintar la rejilla. Si la serie ya no está en la lista o el
 * botón está desactivado (por ejemplo, la serie ya está completa),
 * el foco vuelve a la rejilla para no perderse (UI-S13, NFR-S02).
 *
 * @param {string} docId
 * @param {string} role Rol del botón dentro de la tarjeta.
 */
function restoreLibraryCardFocus(docId, role) {
  const card = findLibraryCard(docId);
  const target = card
    ? card.querySelector(`[data-series-role="${role}"]`)
    : null;

  if (target instanceof HTMLElement && !target.disabled) {
    target.focus();
    return;
  }

  const grid = dom?.library?.grid;
  if (grid instanceof HTMLElement) {
    if (!grid.hasAttribute("tabindex")) grid.setAttribute("tabindex", "-1");
    grid.focus();
  }
}

/**
 * Aplica en memoria el resultado de «+1 Episodio» y repinta la
 * biblioteca y las estadísticas.
 *
 * @param {string} docId
 * @param {Record<string, unknown>} result
 */
function applyLocalEpisodeProgress(docId, result) {
  if (!result || typeof result !== "object") return;

  const current = state.libraryByDocId.get(docId);
  if (!current) return;

  const patch = {
    watchedEpisodesCount:
      typeof result.watchedEpisodesCount === "number"
        ? result.watchedEpisodesCount
        : current.watchedEpisodesCount,
    currentSeason:
      typeof result.currentSeason === "number"
        ? result.currentSeason
        : current.currentSeason,
    currentEpisode:
      typeof result.currentEpisode === "number"
        ? result.currentEpisode
        : current.currentEpisode,
    status:
      typeof result.status === "string" ? result.status : current.status,
  };

  state.library = state.library.map((item) =>
    item?.id === docId ? { ...item, ...patch } : item
  );
  state.libraryFiltered = state.libraryFiltered.map((item) =>
    item?.id === docId ? { ...item, ...patch } : item
  );
  state.libraryByDocId.set(docId, { ...current, ...patch });

  renderStats(state.library);
  renderLibrary();
}

/**
 * Devuelve el foco al botón pendiente tras un repintado de la
 * rejilla (UI-S13, NFR-S02).
 *
 * Solo se restaura si el foco se ha perdido (el repintado ha
 * sustituido la tarjeta) o si sigue dentro de la rejilla: si el
 * usuario ha movido el foco a otro control, no se le quita.
 */
function flushPendingLibraryFocus() {
  if (!pendingLibraryFocus) return;

  const active = document.activeElement;
  const grid = dom?.library?.grid;

  const focusLost = active === null || active === document.body;
  const insideGrid =
    grid instanceof HTMLElement &&
    active instanceof Node &&
    grid.contains(active);

  if (!focusLost && !insideGrid) return;

  const { docId, role } = pendingLibraryFocus;
  pendingLibraryFocus = null;
  restoreLibraryCardFocus(docId, role);
}

/**
 * Delegación de los clics de las tarjetas.
 *
 * @param {Event} event
 */
function onSectionClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const openButton = target.closest('[data-series-role="open"]');
  if (openButton) {
    const card = openButton.closest('[data-series-role="card"]');
    const model = card ? cardModels.get(card) : null;
    if (model) openSeriesDetail(model);
    return;
  }

  const addButton = target.closest('[data-series-role="add"]');
  if (addButton instanceof HTMLElement && !addButton.disabled) {
    void handleAddSeries(addButton);
    return;
  }

  const favoriteButton = target.closest('[data-series-role="favorite"]');
  if (favoriteButton instanceof HTMLElement) {
    void handleToggleFavorite(favoriteButton);
    return;
  }

  const nextButton = target.closest('[data-series-role="next"]');
  if (nextButton instanceof HTMLElement && !nextButton.disabled) {
    void handleNextEpisode(nextButton);
  }
}

// -------------------------------------------------------------
// Pestañas (UI-S01)
// -------------------------------------------------------------

/**
 * Activa una pestaña: actualiza `aria-selected`, `tabindex` y la
 * visibilidad de los paneles.
 *
 * @param {string} key
 */
function activateTab(key) {
  const tab = SERIES_TABS.find((item) => item.key === key);
  if (!tab) return;

  state.activeTab = tab.key;

  for (const item of SERIES_TABS) {
    const button = dom?.tabs?.[item.key];
    const panel = dom?.panels?.[item.key];
    const selected = item.key === tab.key;

    if (button) {
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    }
    if (panel) panel.hidden = !selected;
  }

  if (tab.key === "catalog") {
    void loadCatalog();
  }
}

/**
 * Navegación por teclado del `tablist` (flechas, Inicio y Fin).
 *
 * @param {KeyboardEvent} event
 * @param {string} currentKey
 */
function onTabKeydown(event, currentKey) {
  const index = SERIES_TABS.findIndex((item) => item.key === currentKey);
  if (index < 0) return;

  let nextIndex = index;

  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      nextIndex = (index + 1) % SERIES_TABS.length;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      nextIndex = (index - 1 + SERIES_TABS.length) % SERIES_TABS.length;
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = SERIES_TABS.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  const next = SERIES_TABS[nextIndex];
  activateTab(next.key);
  dom?.tabs?.[next.key]?.focus();
}

// -------------------------------------------------------------
// Avisos de la sección
// -------------------------------------------------------------

/**
 * Muestra un aviso de TMDB en `series-tmdb-warning` (UI-S11,
 * ALG-S05). El alta manual sigue operativa aunque se avise.
 *
 * @param {string} message
 */
function setTmdbWarning(message) {
  setMessage(dom?.messages?.tmdbWarning, message);
}

/**
 * Crea (una sola vez) el nodo de aviso general de la sección
 * (`role="status"`).
 *
 * @returns {HTMLElement|null}
 */
function ensureNoticeNode() {
  if (noticeNode && noticeNode.isConnected) return noticeNode;

  const anchor = dom?.messages?.error;
  if (!anchor) return null;

  const node = document.createElement("p");
  node.className = "series-message";
  node.setAttribute("role", "status");
  node.hidden = true;

  anchor.insertAdjacentElement("afterend", node);

  noticeNode = node;
  return node;
}

/**
 * Muestra un aviso informativo en español (por ejemplo, «serie
 * añadida a tu biblioteca»).
 *
 * @param {string} message
 */
function showNotice(message) {
  const node = ensureNoticeNode();
  if (node) setMessage(node, message);
}

// -------------------------------------------------------------
// Montaje
// -------------------------------------------------------------

/**
 * Registra el abridor de la ficha (UI-S06, T-S08).
 *
 * @param {((model: CardModel) => void)|null} opener
 */
export function setSeriesDetailOpener(opener) {
  detailOpener = typeof opener === "function" ? opener : null;
}

/**
 * Recoge todas las referencias del esqueleto de `index.html`.
 *
 * @returns {Record<string, any>}
 */
function collectDom() {
  /** @type {Record<string, HTMLElement|null>} */
  const tabs = {};
  /** @type {Record<string, HTMLElement|null>} */
  const panels = {};
  /** @type {Record<string, HTMLElement|null>} */
  const stats = {};

  for (const tab of SERIES_TABS) {
    tabs[tab.key] = byId(tab.tabId);
    panels[tab.key] = byId(tab.panelId);
  }

  for (const field of STAT_FIELDS) {
    stats[field.id] = byId(field.id);
  }

  /** @type {Record<string, HTMLElement|null>} */
  const catalogGrids = {};
  for (const list of CATALOG_LISTS) {
    catalogGrids[list.key] = byId(list.gridId);
  }

  return {
    section: byId("series-section"),
    tabs,
    panels,
    stats,
    statsRoot: byId("series-stats"),
    catalog: {
      search: byId("series-catalog-search"),
      error: byId("series-catalog-error"),
      results: byId("series-catalog-results"),
      resultsGrid: byId("series-catalog-grid"),
      empty: byId("series-catalog-empty"),
      sections: byId("series-catalog-sections"),
      grids: catalogGrids,
    },
    library: {
      search: byId("series-library-search"),
      status: byId("series-library-status"),
      genre: byId("series-library-genre"),
      collection: byId("series-library-collection"),
      ratingMin: byId("series-library-rating-min"),
      ratingMax: byId("series-library-rating-max"),
      sort: byId("series-library-sort"),
      clear: byId("series-library-clear"),
      count: byId("series-library-count"),
      error: byId("series-library-error"),
      grid: byId("series-library-grid"),
      empty: byId("series-library-empty"),
    },
    detail: {
      dialog: byId("series-detail"),
      title: byId("series-detail-title"),
      originalTitle: byId("series-detail-original-title"),
      poster: byId("series-detail-poster"),
      backdrop: byId("series-detail-backdrop"),
      firstAir: byId("series-detail-first-air"),
      counts: byId("series-detail-counts"),
      tmdbStatus: byId("series-detail-tmdb-status"),
      tmdbRating: byId("series-detail-tmdb-rating"),
      networks: byId("series-detail-networks"),
      genres: byId("series-detail-genres"),
      overview: byId("series-detail-overview"),
      creators: byId("series-detail-creators"),
      cast: byId("series-detail-cast"),
      trailer: byId("series-detail-trailer"),
      providers: byId("series-detail-providers"),
      providersList: byId("series-detail-providers-list"),
      status: byId("series-detail-status"),
      favorite: byId("series-detail-favorite"),
      progress: byId("series-detail-progress"),
      next: byId("series-detail-next"),
      rewatchCount: byId("series-detail-rewatch-count"),
      rewatchInc: byId("series-detail-rewatch-inc"),
      rewatchDec: byId("series-detail-rewatch-dec"),
      watchDates: byId("series-detail-watch-dates"),
      userRating: byId("series-detail-user-rating"),
      userRatingDisplay: byId("series-detail-user-rating-display"),
      review: byId("series-detail-review"),
      spoilers: byId("series-detail-spoilers"),
      spoilerWarning: byId("series-detail-spoiler-warning"),
      spoilerReveal: byId("series-detail-spoiler-reveal"),
      tags: byId("series-detail-tags"),
      collections: byId("series-detail-collections"),
      dirtyWarning: byId("series-detail-dirty-warning"),
      save: byId("series-detail-save"),
      refresh: byId("series-detail-refresh"),
      remove: byId("series-detail-delete"),
      close: byId("series-detail-close"),
    },
    collections: {
      form: byId("series-collections-form"),
      name: byId("series-collection-name"),
      description: byId("series-collection-description"),
      submit: byId("series-collection-submit"),
      list: byId("series-collections-list"),
      empty: byId("series-collections-empty"),
    },
    messages: {
      error: byId("series-error"),
      tmdbWarning: byId("series-tmdb-warning"),
    },
    manual: {
      open: byId("series-manual-open"),
      form: byId("series-manual-form"),
      name: byId("series-manual-name"),
      year: byId("series-manual-year"),
      seasons: byId("series-manual-seasons"),
      episodes: byId("series-manual-episodes"),
      overview: byId("series-manual-overview"),
      genres: byId("series-manual-genres"),
      submit: byId("series-manual-submit"),
      error: byId("series-manual-error"),
    },
    templates: {
      card: byId("series-card-template"),
      collection: byId("series-collection-item-template"),
    },
  };
}

/**
 * Monta la sección de series: pestañas, estadísticas, catálogo con
 * buscador instantáneo y tarjetas compartidas con la biblioteca.
 *
 * Es idempotente: si la sección ya está montada devuelve el mismo
 * controlador.
 *
 * @param {{ onOpenSeries?: (model: CardModel) => void }} [options]
 * @returns {{ destroy: () => void, state: SeriesViewState }}
 */
export function mountSeries(options = {}) {
  if (activeController) return activeController;

  dom = collectDom();
  if (!dom.section) {
    throw new Error("No se encontró la sección de series (#series-section).");
  }

  state = createViewState();
  catalogAddButtons.clear();
  catalogListEmptyNodes.clear();
  tabListeners.clear();
  clearAllGrids();
  libraryUnsubscribe = null;
  statsUnsubscribe = null;
  collectionsUnsubscribe = null;
  librarySearchTimer = null;
  serverFiltersSignature = "";
  pendingLibraryFocus = null;
  libraryVisibleCount = 0;
  libraryFilteredLoaded = false;
  searchTimer = null;
  searchToken = 0;
  libraryLoadError = "";
  noticeNode = null;
  detailState = createDetailState();

  if (typeof options?.onOpenSeries === "function") {
    detailOpener = options.onOpenSeries;
  } else {
    // La ficha vive en este módulo (UI-S06, T-S08).
    detailOpener = (model) => {
      void openSeriesDetailDialog(model);
    };
  }

  // --- Pestañas (UI-S01) ------------------------------------------
  for (const tab of SERIES_TABS) {
    const button = dom.tabs[tab.key];
    if (!button) continue;

    // Escuchas con nombre para poder retirarlas en `unmountSeries`.
    const onClick = () => activateTab(tab.key);
    const onKeyDown = (event) => onTabKeydown(event, tab.key);

    button.addEventListener("click", onClick);
    button.addEventListener("keydown", onKeyDown);
    tabListeners.set(tab.key, { click: onClick, keydown: onKeyDown });
  }

  // --- Catálogo (UI-S03) -----------------------------------------
  dom.catalog.search?.addEventListener("input", onCatalogSearchInput);
  dom.catalog.search?.addEventListener("search", onCatalogSearchInput);

  // --- Tarjetas (UI-S04) -----------------------------------------
  dom.section.addEventListener("click", onSectionClick);

  // --- Ficha de serie (UI-S06, D-S09) ------------------------------
  // Las opciones de estado se rellenan desde `seriesState.js` para
  // que las etiquetas en español no se dupliquen en la vista.
  const detailStatus = dom.detail?.status;
  if (detailStatus instanceof HTMLSelectElement) {
    clearNode(detailStatus);
    for (const option of STATUS_OPTIONS) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      detailStatus.append(node);
    }
    detailStatus.value = "watchlist";
  }

  // El campo de nota se usa como texto para admitir la coma decimal
  // es-ES («7,5»); el rango 0–10 en medios puntos lo valida
  // `parseUserRating` (ALG-S04).
  if (dom.detail?.userRating instanceof HTMLInputElement) {
    dom.detail.userRating.type = "text";
    dom.detail.userRating.setAttribute("inputmode", "decimal");
  }

  dom.detail?.dialog?.addEventListener("close", onSeriesDetailClosed);
  dom.detail?.close?.addEventListener("click", closeSeriesDetail);
  dom.detail?.status?.addEventListener("change", handleDetailStatusChange);
  dom.detail?.favorite?.addEventListener("click", handleDetailFavorite);
  dom.detail?.next?.addEventListener("click", handleDetailNext);
  dom.detail?.rewatchInc?.addEventListener("click", onDetailRewatchInc);
  dom.detail?.rewatchDec?.addEventListener("click", onDetailRewatchDec);
  dom.detail?.collections?.addEventListener(
    "change",
    handleDetailCollectionsChange
  );
  dom.detail?.save?.addEventListener("click", handleDetailSave);
  dom.detail?.refresh?.addEventListener("click", handleDetailRefresh);
  dom.detail?.remove?.addEventListener("click", handleDetailDelete);
  dom.detail?.spoilerReveal?.addEventListener("click", onDetailSpoilerReveal);
  dom.detail?.userRating?.addEventListener("input", onDetailPersonalInput);
  dom.detail?.review?.addEventListener("input", onDetailPersonalInput);
  dom.detail?.tags?.addEventListener("input", onDetailPersonalInput);
  dom.detail?.spoilers?.addEventListener("change", onDetailPersonalInput);

  // --- Alta manual (UI-S11, REQ-S02, AC-S08) -----------------------
  populateManualGenres();
  dom.manual?.open?.addEventListener("click", onManualOpen);
  dom.manual?.form?.addEventListener("submit", handleManualSubmit);

  // --- Biblioteca (UI-S04, UI-S05) --------------------------------
  // Los selectores de estado, género y orden se rellenan desde
  // `seriesState.js` para que las opciones y las etiquetas no se
  // dupliquen en la vista.
  populateStatusFilter();
  populateGenreFilter();
  populateSortFilter();

  // El contador y el estado vacío se anuncian a los lectores de
  // pantalla al cambiar.
  dom.library.count?.setAttribute("aria-live", "polite");
  dom.library.empty?.setAttribute("role", "status");

  // Búsqueda instantánea (debounce 300 ms) y filtros combinables.
  dom.library.search?.addEventListener("input", onLibrarySearchInput);
  dom.library.search?.addEventListener("search", onLibrarySearchInput);
  dom.library.status?.addEventListener("change", applyLibraryFilters);
  dom.library.genre?.addEventListener("change", applyLibraryFilters);
  dom.library.collection?.addEventListener("change", applyLibraryFilters);
  dom.library.ratingMin?.addEventListener("change", applyLibraryFilters);
  dom.library.ratingMax?.addEventListener("change", applyLibraryFilters);
  dom.library.sort?.addEventListener("change", applyLibraryFilters);
  dom.library.clear?.addEventListener("click", clearLibraryFilters);

  // --- Avisos de la sección (UI-S11) ------------------------------
  ensureNoticeNode();

  // --- Estadísticas y datos (UI-S02, ALG-S01) ---------------------
  renderStats([]);
  // La biblioteca se suscribe con los filtros de servidor (ALG-S02);
  // las estadísticas usan la biblioteca completa.
  subscribeLibrarySources();
  subscribeLibraryData(readServerFilters());

  // --- Estado inicial ---------------------------------------------
  activateTab(state.activeTab);

  const controller = {
    state,
    destroy: () => unmountSeries(),
  };

  activeController = controller;
  return controller;
}

/**
 * Desmonta la sección: cancela suscripciones, temporizadores y
 * escuchas.
 *
 * @returns {void}
 */
export function unmountSeries() {
  if (!activeController) return;

  // Bajas de las suscripciones: biblioteca filtrada (rejilla),
  // biblioteca completa (estadísticas) y colecciones.
  for (const unsubscribe of [
    libraryUnsubscribe,
    statsUnsubscribe,
    collectionsUnsubscribe,
  ]) {
    if (typeof unsubscribe !== "function") continue;
    try {
      unsubscribe();
    } catch {
      // Una baja fallida no debe impedir el desmontaje.
    }
  }
  libraryUnsubscribe = null;
  statsUnsubscribe = null;
  collectionsUnsubscribe = null;
  serverFiltersSignature = "";

  if (searchTimer !== null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }

  if (librarySearchTimer !== null) {
    clearTimeout(librarySearchTimer);
    librarySearchTimer = null;
  }

  dom?.section?.removeEventListener("click", onSectionClick);
  dom?.catalog?.search?.removeEventListener("input", onCatalogSearchInput);
  dom?.catalog?.search?.removeEventListener("search", onCatalogSearchInput);
  dom?.library?.search?.removeEventListener("input", onLibrarySearchInput);
  dom?.library?.search?.removeEventListener("search", onLibrarySearchInput);
  dom?.library?.status?.removeEventListener("change", applyLibraryFilters);
  dom?.library?.genre?.removeEventListener("change", applyLibraryFilters);
  dom?.library?.collection?.removeEventListener("change", applyLibraryFilters);
  dom?.library?.ratingMin?.removeEventListener("change", applyLibraryFilters);
  dom?.library?.ratingMax?.removeEventListener("change", applyLibraryFilters);
  dom?.library?.sort?.removeEventListener("change", applyLibraryFilters);
  dom?.library?.clear?.removeEventListener("click", clearLibraryFilters);

  // --- Ficha de serie (UI-S06) --------------------------------------
  dom?.detail?.dialog?.removeEventListener("close", onSeriesDetailClosed);
  dom?.detail?.close?.removeEventListener("click", closeSeriesDetail);
  dom?.detail?.status?.removeEventListener("change", handleDetailStatusChange);
  dom?.detail?.favorite?.removeEventListener("click", handleDetailFavorite);
  dom?.detail?.next?.removeEventListener("click", handleDetailNext);
  dom?.detail?.rewatchInc?.removeEventListener("click", onDetailRewatchInc);
  dom?.detail?.rewatchDec?.removeEventListener("click", onDetailRewatchDec);
  dom?.detail?.collections?.removeEventListener(
    "change",
    handleDetailCollectionsChange
  );
  dom?.detail?.save?.removeEventListener("click", handleDetailSave);
  dom?.detail?.refresh?.removeEventListener("click", handleDetailRefresh);
  dom?.detail?.remove?.removeEventListener("click", handleDetailDelete);
  dom?.detail?.spoilerReveal?.removeEventListener(
    "click",
    onDetailSpoilerReveal
  );
  dom?.detail?.userRating?.removeEventListener("input", onDetailPersonalInput);
  dom?.detail?.review?.removeEventListener("input", onDetailPersonalInput);
  dom?.detail?.tags?.removeEventListener("input", onDetailPersonalInput);
  dom?.detail?.spoilers?.removeEventListener("change", onDetailPersonalInput);

  // --- Alta manual (UI-S11) -----------------------------------------
  dom?.manual?.open?.removeEventListener("click", onManualOpen);
  dom?.manual?.form?.removeEventListener("submit", handleManualSubmit);

  for (const tab of SERIES_TABS) {
    const button = dom?.tabs?.[tab.key];
    const listeners = tabListeners.get(tab.key);
    if (!button || !listeners) continue;
    button.removeEventListener("click", listeners.click);
    button.removeEventListener("keydown", listeners.keydown);
  }
  tabListeners.clear();

  // Nodos auxiliares creados en tiempo de ejecución: se retiran del
  // DOM para no dejar restos.
  noticeNode?.remove();
  noticeNode = null;

  // La ficha se cierra para no dejar un `<dialog>` modal abierto y
  // sus nodos auxiliares se retiran del DOM.
  if (dom?.detail?.dialog?.open) dom.detail.dialog.close();
  detailErrorNode?.remove();
  detailErrorNode = null;
  detailStatusNode?.remove();
  detailStatusNode = null;
  detailHintNode?.remove();
  detailHintNode = null;
  manualStatusNode?.remove();
  manualStatusNode = null;
  detailState = createDetailState();

  // Los nodos de estado vacío de las listas se crean en tiempo de
  // ejecución: se retiran del DOM para no dejar restos.
  for (const node of catalogListEmptyNodes.values()) {
    node.remove();
  }

  // Se vacían las rejillas: si la sección se vuelve a montar, no
  // pueden quedar tarjetas de la instancia anterior.
  clearAllGrids();

  catalogAddButtons.clear();
  catalogListEmptyNodes.clear();
  dom = null;
  state = createViewState();
  libraryLoadError = "";
  pendingLibraryFocus = null;
  libraryVisibleCount = 0;
  libraryFilteredLoaded = false;
  // El abridor de la ficha (UI-S06) lo registrará T-S08 en el
  // siguiente montaje: no se conserva entre montajes.
  detailOpener = null;
  activeController = null;
}

/**
 * Vacía todas las rejillas de tarjetas (catálogo, resultados de
 * búsqueda y biblioteca).
 */
function clearAllGrids() {
  const catalog = dom?.catalog;
  for (const list of CATALOG_LISTS) {
    clearNode(catalog?.grids?.[list.key]);
  }
  clearNode(catalog?.resultsGrid);
  clearNode(dom?.library?.grid);
}

// -------------------------------------------------------------
// Utilidades para las tareas siguientes
// -------------------------------------------------------------

/**
 * Estado vivo de la vista (biblioteca y catálogo). Útil para las
 * tareas T-S07..T-S10.
 *
 * @returns {SeriesViewState}
 */
export function getSeriesViewState() {
  return state;
}

/**
 * Recalcula la barra de estadísticas con la biblioteca actual.
 *
 * @returns {void}
 */
export function refreshSeriesStats() {
  renderStats(state.library);
}
