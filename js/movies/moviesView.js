// =============================================================
// moviesView.js — Vista de la sección «Películas».
//
// Alcance de esta tarea (T-M07), de su ampliación (T-M08), de la
// ficha de película (T-M09) y del panel de colecciones (T-M10):
//   - UI-M01: conmutación de las tres pestañas («Explorar
//     catálogo», «Mi biblioteca», «Mis colecciones») con
//     `role="tablist"`, `aria-selected` y navegación por teclado.
//   - UI-M02: barra de estadísticas siempre visible sobre las
//     pestañas, con etiquetas en español.
//   - UI-M03: catálogo con buscador instantáneo (debounce 300 ms,
//     mínimo 2 caracteres) y cuatro listas de exploración de la
//     página 1 de TMDB.
//   - UI-M04: tarjeta de película compartida por catálogo y
//     biblioteca (póster `w500`, título, año, `★ vote_average`,
//     badge de estado en español, «×N» visionados, «Añadir» y
//     favorito con `aria-pressed`).
//   - ALG-M01: las estadísticas salen de `computeStats`
//     (`js/movies/moviesState.js`), no se recalculan aquí.
//   - UI-M05: «Mi biblioteca» con buscador instantáneo, filtros
//     combinables (estado/favoritas, género, colección y rango de
//     nota), botón «Limpiar filtros», selector de orden con las
//     siete claves de `SORT_OPTIONS`, contador «N películas» y
//     estados vacíos en español.
//   - ALG-M02: el filtrado y el orden de la biblioteca se delegan
//     en `filterMovies` y `sortMovies` (`js/movies/moviesState.js`):
//     aquí solo se leen los controles y se pinta el resultado.
//   - UI-M06: ficha completa en `<dialog id="movie-detail">` con
//     el bloque «catálogo» (póster, backdrop, títulos, fecha,
//     duración, géneros, sinopsis, director, reparto, tráiler y
//     «Dónde ver») y el bloque «seguimiento» (estado, favorito,
//     visionados con fechas, nota personal 0–10 con medios
//     puntos, reseña con spoilers, etiquetas y colecciones). La
//     nota de TMDB se muestra separada de la personal (AC-M24).
//   - UI-M08: alta manual de películas (sin TMDB) con avisos en
//     español y degradación cuando falta la clave o falla la red
//     (AC-M01, AC-M06, AC-M08).
//   - ALG-M03: las escrituras de visionado delegan en el
//     repositorio (`watch`, `unwatch`, `setStatus`,
//     `setWatchCount`).
//   - ALG-M04: la nota personal se valida con `parseUserRating`.
//   - ALG-M06: la ficha usa `ensureDetailCached` (caché de 30
//     días) y «Actualizar datos» fuerza la recarga.
//   - D-M09: favorito, estado, visionados y colecciones se guardan
//     de inmediato; nota, reseña, etiquetas y spoilers requieren
//     «Guardar» y «Cerrar» descarta lo pendiente (AC-M26).
//   - UI-M07: panel «Mis colecciones» con alta, renombrado,
//     descripción, borrado y el acceso «Ver películas» al filtro por
//     colección. El recuento de películas se calcula en cliente a partir
//     de `collectionIds` (DB-M02, AC-M15, AC-M16).
//
// Dependencias ya implementadas (se consumen, no se duplican):
//   - `js/movies/moviesState.js` (T-M04): etiquetas de estado,
//     opciones, filtros, orden y `computeStats` (puros).
//   - `js/movies/moviesRepository.js` (T-M03): biblioteca y
//     colecciones en Firestore (sin llamadas a TMDB al renderizar).
//   - `js/movies/tmdbClient.js` (T-M01): único punto de red.
//   - `index.html` (T-M05): esqueleto con los ids estables.
//
// Tarea completada en este mismo módulo:
//   - T-M10 (UI-M07): panel «Mis colecciones».
//
// Todos los textos visibles están en español (es-ES) y el fichero va
// en UTF-8 sin BOM (NFR-M03).
// =============================================================

import {
  DEFAULT_SORT_KEY,
  DEFAULT_TAB,
  LIBRARY_STATUS_OPTIONS,
  MOVIE_TABS,
  SORT_OPTIONS,
  STATUS_LABELS,
  TMDB_GENRE_OPTIONS,
  TMDB_GENRES_ES,
  USER_RATING_ERROR_MESSAGE,
  UserRatingError,
  computeStats,
  createLibraryFilters,
  createMoviesState,
  filterMovies,
  hasActiveLibraryFilters,
  parseUserRating,
  sortMovies,
} from "./moviesState.js";

import {
  addFromTmdb,
  addManual,
  createCollection,
  deleteCollection,
  deleteMovie,
  ensureDetailCached,
  setCollections,
  setFavorite,
  setStatus,
  setWatchCount,
  subscribeCollections,
  subscribeMovies,
  unwatch,
  updateCollection,
  updatePersonal,
  watch,
} from "./moviesRepository.js";

import {
  backdropUrl,
  fetchPopular,
  fetchTopRated,
  fetchTrendingWeek,
  fetchUpcoming,
  getMovieDetail,
  isTmdbConfigured,
  posterUrl,
  searchMovies,
  trailerUrl,
} from "./tmdbClient.js";

// -------------------------------------------------------------
// Constantes de la vista
// -------------------------------------------------------------

/** Debounce del buscador instantáneo (NFR-M04). */
const SEARCH_DEBOUNCE_MS = 300;

/** Longitud mínima de la consulta para buscar en TMDB (API-M01). */
const MIN_SEARCH_CHARS = 2;

/** Tamaño de póster de las tarjetas (API-M07). */
const POSTER_SIZE = "w500";

/**
 * Mensajes de error de TMDB en español (ALG-M05). Se exportan para
 * que T-M09 reutilice el mismo texto en `movies-tmdb-warning`.
 */
export const TMDB_ERROR_MESSAGES = Object.freeze({
  NO_API_KEY: "Falta la clave de TMDB: búsqueda desactivada.",
  NETWORK:
    "No se pudo conectar con TMDB. Puedes añadir la película manualmente.",
  HTTP_401:
    "No se pudo conectar con TMDB. Puedes añadir la película manualmente.",
  HTTP_429:
    "No se pudo conectar con TMDB. Puedes añadir la película manualmente.",
  HTTP_404: "Película no encontrada en TMDB. Puedes añadirla manualmente.",
  PARSE: "Respuesta no válida de TMDB. Puedes añadir la película manualmente.",
});

/** Mensaje genérico cuando el fallo no viene de TMDB. */
const GENERIC_TMDB_MESSAGE = TMDB_ERROR_MESSAGES.NETWORK;

/** Mensaje genérico de los errores del repositorio. */
const GENERIC_REPOSITORY_MESSAGE =
  "No se pudo completar la operación en tu biblioteca de películas.";

/**
 * Barra de estadísticas (UI-M02). `key` es la clave que devuelve
 * `computeStats` (ALG-M01) y `label` el texto visible en español.
 */
const STAT_FIELDS = Object.freeze([
  Object.freeze({ key: "totalWatched", id: "movies-stats-watched", label: "Vistas" }),
  Object.freeze({
    key: "totalRewatches",
    id: "movies-stats-rewatches",
    label: "Visionados",
  }),
  Object.freeze({ key: "totalHours", id: "movies-stats-hours", label: "Horas" }),
  Object.freeze({
    key: "pendingCount",
    id: "movies-stats-pending",
    label: "Pendientes",
  }),
  Object.freeze({
    key: "avgUserRating",
    id: "movies-stats-avg-user",
    label: "Mi nota media",
  }),
  Object.freeze({
    key: "avgTmdbRating",
    id: "movies-stats-avg-tmdb",
    label: "Nota media TMDB",
  }),
]);

/**
 * Las cuatro listas del catálogo (UI-M03). `fetcher` es la función
 * de `tmdbClient.js` que devuelve la página 1.
 */
const CATALOG_LISTS = Object.freeze([
  Object.freeze({
    key: "trending",
    label: "Tendencias de la semana",
    gridId: "movies-catalog-trending",
    headingId: "movies-catalog-trending-heading",
    fetcher: fetchTrendingWeek,
  }),
  Object.freeze({
    key: "popular",
    label: "Populares",
    gridId: "movies-catalog-popular",
    headingId: "movies-catalog-popular-heading",
    fetcher: fetchPopular,
  }),
  Object.freeze({
    key: "top-rated",
    label: "Mejor valoradas",
    gridId: "movies-catalog-top-rated",
    headingId: "movies-catalog-top-rated-heading",
    fetcher: fetchTopRated,
  }),
  Object.freeze({
    key: "upcoming",
    label: "Próximos estrenos",
    gridId: "movies-catalog-upcoming",
    headingId: "movies-catalog-upcoming-heading",
    fetcher: fetchUpcoming,
  }),
]);

/** Póster de reserva cuando la película no tiene `posterPath` (AC-M05). */
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

// -------------------------------------------------------------
// Constantes de «Mi biblioteca» (UI-M05)
// -------------------------------------------------------------

/** Estado vacío: la biblioteca no tiene ninguna película. */
const LIBRARY_EMPTY_MESSAGE =
  "Tu biblioteca está vacía. Añade películas desde «Explorar catálogo».";

/** Estado vacío: hay películas, pero ninguna cumple los filtros (AC-M18). */
const LIBRARY_NO_RESULTS_MESSAGE =
  "No hay películas que coincidan con los filtros.";

/** Límites del filtro de nota personal (UI-M05: 0–10, paso 0.5). */
const RATING_MIN = 0;
const RATING_MAX = 10;
const RATING_STEP = 0.5;

/**
 * Aviso en español cuando el rango de nota no es válido (UI-M05).
 */
const RATING_RANGE_ERROR =
  "Las notas deben estar entre 0 y 10 y en medios puntos (0,5).";

/** Aviso en español cuando el rango de nota está invertido (UI-M05). */
const RATING_RANGE_ORDER_ERROR =
  "La nota mínima no puede ser mayor que la nota máxima.";

// -------------------------------------------------------------
// Constantes de la ficha y del alta manual (UI-M06, UI-M08)
// -------------------------------------------------------------

/** Confirmación de borrado de una película (AC-M27). */
const DELETE_CONFIRM_MESSAGE =
  "¿Eliminar esta película de tu biblioteca?";

/** Aviso del contador de visionados (ALG-M03). */
const WATCH_COUNT_ERROR_MESSAGE =
  "El número de visionados debe ser un entero entre 0 y 1000.";

/** Tope de visionados (DB-M01). */
const MAX_WATCH_COUNT = 1000;

/** Aviso cuando la ficha se abre para una película que no está en la biblioteca. */
const DETAIL_CATALOG_HINT =
  "Esta película no está en tu biblioteca: añádela desde el catálogo " +
  "para poder seguirla.";

/** Mensaje de éxito del alta manual (UI-M08). */
const MANUAL_SUCCESS_MESSAGE = "Película añadida a tu biblioteca.";

/** Título provisional mientras llegan los datos de la ficha. */
const DETAIL_LOADING_TITLE = "Cargando…";

/** Mensaje cuando la película no tiene datos suficientes. */
const DETAIL_UNKNOWN_MOVIE_MESSAGE =
  "No se ha podido cargar la ficha de la película.";

/** Límites del alta manual (coinciden con DB-M01). */
const MANUAL_MIN_YEAR = 1870;
const MANUAL_MAX_YEAR = 2100;
const MANUAL_MIN_RUNTIME = 1;
const MANUAL_MAX_RUNTIME = 10000;

/** Avisos del alta manual en español (UI-M08). */
const MANUAL_TITLE_ERROR = "El título es obligatorio.";
const MANUAL_YEAR_ERROR = "El año de estreno no es válido.";
const MANUAL_RUNTIME_ERROR = "La duración no es válida.";

// -------------------------------------------------------------
// Constantes de «Mis colecciones» (UI-M07, DB-M02)
// -------------------------------------------------------------

/** Longitud máxima del nombre de una colección (DB-M02). */
const COLLECTION_NAME_MAX = 60;

/** Longitud máxima de la descripción de una colección (DB-M02). */
const COLLECTION_DESCRIPTION_MAX = 300;

/** Aviso cuando el nombre de la colección está vacío (DB-M02). */
const COLLECTION_NAME_REQUIRED_MESSAGE =
  "El nombre de la colección es obligatorio.";

/** Aviso cuando el nombre de la colección es demasiado largo (DB-M02). */
const COLLECTION_NAME_TOO_LONG_MESSAGE =
  "El nombre no puede superar los 60 caracteres.";

/** Aviso cuando la descripción es demasiado larga (DB-M02). */
const COLLECTION_DESCRIPTION_TOO_LONG_MESSAGE =
  "La descripción no puede superar los 300 caracteres.";

/** Estado vacío de «Mis colecciones» (UI-M07). */
const COLLECTIONS_EMPTY_MESSAGE = "Aún no tienes colecciones.";

/** Texto del botón de envío en modo «crear» (UI-M07). */
const COLLECTION_SUBMIT_CREATE_LABEL = "Crear colección";

/** Texto del botón de envío en modo «editar» (UI-M07). */
const COLLECTION_SUBMIT_EDIT_LABEL = "Guardar cambios";

/** Título del formulario en modo «crear» (UI-M07). */
const COLLECTION_FORM_CREATE_TITLE = "Nueva colección";

/** Título del formulario en modo «editar» (UI-M07). */
const COLLECTION_FORM_EDIT_TITLE = "Editar colección";

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

/** Fecha larga en español («15 de noviembre de 2010»). */
const longDateFormatter = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
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
function yearFromReleaseDate(value) {
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

// -------------------------------------------------------------
// Estado del módulo
// -------------------------------------------------------------

/**
 * @typedef {Object} MoviesViewState
 * @property {string} activeTab
 * @property {ReturnType<typeof createLibraryFilters>} libraryFilters
 * @property {Array<Record<string, unknown>>} library Biblioteca completa.
 * @property {Array<Record<string, unknown>>} libraryFiltered Biblioteca que
 *   devuelve el servidor con los filtros de servidor aplicados.
 * @property {Map<string, Record<string, unknown>>} libraryByDocId
 * @property {Map<string, Record<string, unknown>>} libraryByTmdbId
 * @property {Array<Record<string, unknown>>} collections
 * @property {{
 *   loaded: boolean,
 *   loading: boolean,
 *   query: string,
 *   lists: Record<string, Array<Record<string, unknown>>>
 * }} catalog
 */

/**
 * Crea el estado de la vista a partir del estado puro de
 * `moviesState.js` (T-M04).
 *
 * @returns {MoviesViewState}
 */
function createViewState() {
  const base = createMoviesState({ activeTab: DEFAULT_TAB });

  return {
    activeTab: base.activeTab,
    libraryFilters: base.libraryFilters,
    library: [],
    libraryFiltered: [],
    libraryByDocId: new Map(),
    libraryByTmdbId: new Map(),
    collections: [],
    catalog: {
      loaded: false,
      loading: false,
      query: "",
      lists: {
        trending: [],
        popular: [],
        "top-rated": [],
        upcoming: [],
      },
    },
  };
}

/** Referencias al DOM resueltas en el montaje. */
let dom = null;

/** Estado vivo de la vista. */
let state = createViewState();

/** Suscriptor de la biblioteca con los filtros de servidor (UI-M05). */
let moviesUnsubscribe = null;

/** Suscriptor de la biblioteca sin filtros: alimenta las estadísticas (UI-M02). */
let statsUnsubscribe = null;

/** Suscriptor de las colecciones (DB-M02). */
let collectionsUnsubscribe = null;

/** Firma de los filtros de servidor suscritos (evita resuscripciones inútiles). */
let serverFiltersSignature = "";

/** Temporizadores de búsqueda pendientes. */
let searchTimer = null;

/** Token de búsqueda: descarta respuestas obsoletas. */
let searchToken = 0;

/** Temporizador de búsqueda de la biblioteca. */
let librarySearchTimer = null;

/** Último error de carga de la biblioteca (se muestra en `movies-library-error`). */
let libraryLoadError = "";

/** Controlador devuelto por `mountMovies`. */
let activeController = null;

/** Abridor de la ficha; lo registrará T-M09 (UI-M06). */
let detailOpener = null;

/** Modelos de tarjeta indexados por su elemento (WeakMap). */
const cardModels = new WeakMap();

/**
 * Botones «Añadir» del catálogo, indexados por la clave de la
 * tarjeta: `{ button, tmdbId }`. La clave incluye la rejilla, así
 * que la misma película puede estar en varias listas.
 */
const catalogAddButtons = new Map();

/** Nodos de estado vacío de cada lista del catálogo. */
const catalogListEmptyNodes = new Map();

/** Escuchas de las pestañas, para poder retirarlas al desmontar. */
const tabListeners = new Map();

// -------------------------------------------------------------
// Estado de la ficha de película (UI-M06)
// -------------------------------------------------------------

/**
 * Valores de la parte personal de la ficha en el momento del último
 * guardado. Sirven para detectar cambios pendientes (D-M09, AC-M26).
 *
 * @typedef {Object} DetailPersonal
 * @property {string} userRating Texto escrito en el campo de nota.
 * @property {string} userReview Texto escrito en la reseña.
 * @property {string} tags Texto escrito en el campo de etiquetas.
 * @property {boolean} hasSpoilers Estado de la casilla de spoilers.
 */

/**
 * @typedef {Object} DetailState
 * @property {string|null} docId Id del documento en la biblioteca.
 * @property {string|null} tmdbId Id de TMDB (null si es manual).
 * @property {boolean} inLibrary `true` si la película está en la biblioteca.
 * @property {Record<string, unknown>|null} movie Modelo pintado.
 * @property {DetailPersonal} saved Últimos valores guardados.
 * @property {boolean} spoilerRevealed `true` si la reseña se ha revelado.
 * @property {boolean} busy `true` mientras hay una escritura en curso.
 * @property {HTMLElement|null} trigger Elemento que abrió la ficha.
 */

/**
 * Estado inicial de la ficha.
 *
 * @returns {DetailState}
 */
function createDetailState() {
  return {
    docId: null,
    tmdbId: null,
    inLibrary: false,
    movie: null,
    saved: { userRating: "", userReview: "", tags: "", hasSpoilers: false },
    spoilerRevealed: false,
    busy: false,
    trigger: null,
  };
}

/** Estado vivo de la ficha. */
let detailState = createDetailState();

/** Nodo de error creado dentro del diálogo (role="alert"). */
let detailErrorNode = null;

/** Nodo de aviso creado dentro del diálogo (role="status"). */
let detailStatusNode = null;

/** Aviso de la ficha cuando la película no está en la biblioteca. */
let detailHintNode = null;

/** Nodo de aviso del alta manual (role="status"). */
let manualStatusNode = null;

/** Copia del texto literal escrito en el campo de nota (ALG-M04). */
let userRatingTracker = null;

// -------------------------------------------------------------
// Estado del panel «Mis colecciones» (UI-M07)
// -------------------------------------------------------------

/** Modo del formulario de colecciones: `"create"` o `"edit"`. */
let collectionFormMode = "create";

/** Id de la colección que se está editando (`null` en modo «create»). */
let collectionEditingId = null;

/** Botón dinámico «Cancelar» (solo visible en modo «editar»). */
let collectionCancelButton = null;

/** Nodo de error del formulario de colecciones (role="alert"). */
let collectionErrorNode = null;

/** Nodo de aviso del formulario de colecciones (role="status"). */
let collectionStatusNode = null;

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
 * Vacía un contenedor sin dejar nodos sueltos.
 *
 * @param {HTMLElement|null} container
 */
function clearNode(container) {
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);
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

  for (const tab of MOVIE_TABS) {
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
    section: byId("movies-section"),
    tabs,
    panels,
    stats,
    statsRoot: byId("movies-stats"),
    catalog: {
      search: byId("movies-catalog-search"),
      error: byId("movies-catalog-error"),
      results: byId("movies-catalog-results"),
      resultsGrid: byId("movies-catalog-grid"),
      empty: byId("movies-catalog-empty"),
      sections: byId("movies-catalog-sections"),
      grids: catalogGrids,
    },
    library: {
      search: byId("movies-library-search"),
      status: byId("movies-library-status"),
      genre: byId("movies-library-genre"),
      collection: byId("movies-library-collection"),
      ratingMin: byId("movies-library-rating-min"),
      ratingMax: byId("movies-library-rating-max"),
      sort: byId("movies-library-sort"),
      clear: byId("movies-library-clear"),
      count: byId("movies-library-count"),
      error: byId("movies-library-error"),
      grid: byId("movies-library-grid"),
      empty: byId("movies-library-empty"),
    },
    collections: {
      form: byId("movies-collections-form"),
      name: byId("movies-collection-name"),
      description: byId("movies-collection-description"),
      submit: byId("movies-collection-submit"),
      list: byId("movies-collections-list"),
      empty: byId("movies-collections-empty"),
    },
    messages: {
      error: byId("movies-error"),
      tmdbWarning: byId("movies-tmdb-warning"),
    },
    detail: {
      dialog: byId("movie-detail"),
      title: byId("movie-detail-title"),
      originalTitle: byId("movie-detail-original-title"),
      poster: byId("movie-detail-poster"),
      backdrop: byId("movie-detail-backdrop"),
      release: byId("movie-detail-release"),
      runtime: byId("movie-detail-runtime"),
      genres: byId("movie-detail-genres"),
      overview: byId("movie-detail-overview"),
      director: byId("movie-detail-director"),
      cast: byId("movie-detail-cast"),
      trailer: byId("movie-detail-trailer"),
      providers: byId("movie-detail-providers"),
      providersList: byId("movie-detail-providers-list"),
      tmdbRating: byId("movie-detail-tmdb-rating"),
      status: byId("movie-detail-status"),
      favorite: byId("movie-detail-favorite"),
      watchCount: byId("movie-detail-watch-count"),
      watchInc: byId("movie-detail-watch-inc"),
      watchDec: byId("movie-detail-watch-dec"),
      watchInput: byId("movie-detail-watch-input"),
      watchDates: byId("movie-detail-watch-dates"),
      userRating: byId("movie-detail-user-rating"),
      userRatingDisplay: byId("movie-detail-user-rating-display"),
      review: byId("movie-detail-review"),
      spoilers: byId("movie-detail-spoilers"),
      spoilerWarning: byId("movie-detail-spoiler-warning"),
      spoilerReveal: byId("movie-detail-spoiler-reveal"),
      tags: byId("movie-detail-tags"),
      collections: byId("movie-detail-collections"),
      save: byId("movie-detail-save"),
      refresh: byId("movie-detail-refresh"),
      remove: byId("movie-detail-delete"),
      close: byId("movie-detail-close"),
      dirtyWarning: byId("movie-detail-dirty-warning"),
    },
    manual: {
      open: byId("movies-manual-open"),
      form: byId("movies-manual-form"),
      title: byId("movies-manual-title"),
      year: byId("movies-manual-year"),
      runtime: byId("movies-manual-runtime"),
      overview: byId("movies-manual-overview"),
      genres: byId("movies-manual-genres"),
      submit: byId("movies-manual-submit"),
      error: byId("movies-manual-error"),
    },
    templates: {
      card: byId("movie-card-template"),
      collection: byId("movies-collection-item-template"),
    },
  };
}

// -------------------------------------------------------------
// Descripción de errores en español (ALG-M05)
// -------------------------------------------------------------

/**
 * Traduce un error de `tmdbClient.js` al mensaje de UI (ALG-M05).
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
// Tarjeta de película (UI-M04)
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
 * @property {number} watchCount Visionados (solo biblioteca).
 * @property {string|null} tmdbId Id de TMDB.
 * @property {string|null} docId Id del documento de Firestore.
 * @property {Record<string, unknown>} raw Objeto original.
 */

/**
 * Normaliza un resumen de TMDB o un documento de la biblioteca al
 * modelo que usa la tarjeta. El objeto original se conserva en
 * `raw` para poder enviarlo tal cual a `addFromTmdb`.
 *
 * @param {Record<string, unknown>} movie
 * @param {"catalog"|"library"} context
 * @param {string} [gridKey] Rejilla que hospeda la tarjeta. En el
 *   catálogo la misma película puede aparecer en varias listas, así
 *   que la clave incluye la rejilla para no duplicar ids.
 * @returns {CardModel}
 */
function buildCardModel(movie, context, gridKey = "") {
  const source = movie && typeof movie === "object" ? movie : {};

  const tmdbId =
    context === "catalog"
      ? typeof source.id === "number"
        ? String(source.id)
        : null
      : typeof source.tmdbId === "number"
        ? String(source.tmdbId)
        : null;

  const docId = context === "library" && typeof source.id === "string" ? source.id : null;

  const title =
    (typeof source.title === "string" && source.title.trim()) ||
    (typeof source.originalTitle === "string" && source.originalTitle.trim()) ||
    "Sin título";

  const year =
    context === "library" && typeof source.releaseYear === "number"
      ? source.releaseYear
      : yearFromReleaseDate(source.releaseDate);

  const rating =
    context === "catalog"
      ? typeof source.voteAverage === "number"
        ? source.voteAverage
        : null
      : typeof source.tmdbRating === "number"
        ? source.tmdbRating
        : null;

  const watchCount =
    typeof source.watchCount === "number" && Number.isFinite(source.watchCount)
      ? source.watchCount
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
    watchCount,
    tmdbId,
    docId,
    raw: source,
  };
}

/**
 * Crea la tarjeta de una película clonando la plantilla de
 * `index.html` (T-M05). Cada instancia recibe ids únicos para no
 * duplicar los del prototipo.
 *
 * @param {Record<string, unknown>} movie
 * @param {"catalog"|"library"} context
 * @param {string} [gridKey] Rejilla que hospeda la tarjeta.
 * @returns {HTMLElement|null}
 */
function createMovieCard(movie, context, gridKey = "") {
  const template = dom?.templates?.card;
  if (!template || !template.content) return null;

  const model = buildCardModel(movie, context, gridKey);
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('[data-movie-role="card"]');
  if (!(card instanceof HTMLElement)) return null;

  // El modelo se registra antes de rellenar la tarjeta: las etiquetas
  // accesibles se construyen a partir de él.
  cardModels.set(card, model);

  card.id = `movie-card-${model.key}`;
  card.dataset.movieKey = model.key;
  card.dataset.movieContext = context;

  // --- Póster (w500) y metadatos ---------------------------------
  const poster = card.querySelector('[data-movie-role="poster"]');
  if (poster instanceof HTMLImageElement) {
    const url = posterUrl(model.posterPath, POSTER_SIZE);
    poster.src = url ?? POSTER_PLACEHOLDER;
    poster.alt = model.title;
  }

  const titleNode = card.querySelector('[data-movie-role="title"]');
  if (titleNode) titleNode.textContent = model.title;

  const yearNode = card.querySelector('[data-movie-role="year"]');
  if (yearNode) {
    yearNode.textContent = model.year === null ? "" : String(model.year);
    yearNode.hidden = model.year === null;
  }

  const ratingNode = card.querySelector('[data-movie-role="rating"]');
  if (ratingNode) {
    const text = formatRating(model.rating);
    ratingNode.textContent = text === null ? "" : `★ ${text}`;
    ratingNode.hidden = text === null;
  }

  // --- Badge de estado en español (UI-M09) ------------------------
  const statusNode = card.querySelector('[data-movie-role="status"]');
  if (statusNode) {
    const label =
      model.status && Object.prototype.hasOwnProperty.call(STATUS_LABELS, model.status)
        ? STATUS_LABELS[model.status]
        : "";
    statusNode.textContent = label;
    if (model.status) statusNode.dataset.status = model.status;
    else delete statusNode.dataset.status;
    statusNode.hidden = label === "";
  }

  // --- Visionados: «×N» solo si se ha visto más de una vez --------
  const watchNode = card.querySelector('[data-movie-role="watchcount"]');
  if (watchNode) {
    const show = model.context === "library" && model.watchCount > 1;
    watchNode.textContent = show ? `×${model.watchCount}` : "";
    watchNode.id = `movie-card-watchcount-${model.key}`;
    watchNode.hidden = !show;
  }

  // --- Botón «Abrir» ----------------------------------------------
  const openButton = card.querySelector('[data-movie-role="open"]');
  if (openButton instanceof HTMLElement) {
    openButton.id = `movie-card-open-${model.key}`;
    openButton.setAttribute(
      "aria-label",
      `Ver ficha de ${model.title}`
    );
  }

  // --- «Añadir» (solo catálogo) -----------------------------------
  const addButton = card.querySelector('[data-movie-role="add"]');
  if (addButton instanceof HTMLElement) {
    addButton.id = `movie-card-add-${model.key}`;
    if (model.context !== "catalog") {
      addButton.hidden = true;
    } else {
      const alreadyInLibrary =
        model.tmdbId !== null && state.libraryByTmdbId.has(model.tmdbId);
      updateAddButton(addButton, model, alreadyInLibrary);
      if (model.tmdbId !== null) {
        catalogAddButtons.set(model.key, { button: addButton, tmdbId: model.tmdbId });
      }
    }
  }

  // --- Favorito (solo biblioteca) ---------------------------------
  const favoriteButton = card.querySelector('[data-movie-role="favorite"]');
  if (favoriteButton instanceof HTMLElement) {
    favoriteButton.id = `movie-card-favorite-${model.key}`;
    if (model.context !== "library") {
      favoriteButton.hidden = true;
    } else {
      // La plantilla lo trae oculto: en la biblioteca sí se muestra.
      favoriteButton.hidden = false;
      updateFavoriteButton(favoriteButton, model.isFavorite);
    }
  }

  return card;
}

/**
 * Estado del botón «Añadir»: «Añadir» o «En biblioteca» (desactivado).
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
 * Estado del botón de favorito: `aria-pressed` + etiqueta.
 *
 * @param {HTMLElement} button
 * @param {boolean} isFavorite
 */
function updateFavoriteButton(button, isFavorite) {
  button.setAttribute("aria-pressed", isFavorite ? "true" : "false");
  const label = button.querySelector('[data-movie-role="favorite-label"]');
  if (label) label.textContent = isFavorite ? "Favorita" : "Marcar favorita";
  const card = button.closest('[data-movie-role="card"]');
  const model = card ? cardModels.get(card) : null;
  button.setAttribute(
    "aria-label",
    isFavorite
      ? `Quitar ${model ? model.title : "la película"} de favoritas`
      : `Marcar ${model ? model.title : "la película"} como favorita`
  );
}

/**
 * Pinta una lista de tarjetas en una rejilla. La clave de la
 * tarjeta incluye el id de la rejilla: en el catálogo la misma
 * película puede aparecer en varias listas y sus ids deben ser
 * únicos (UI-M04).
 *
 * @param {HTMLElement|null} container
 * @param {Array<Record<string, unknown>>} movies
 * @param {"catalog"|"library"} context
 */
function renderCards(container, movies, context) {
  if (!container) return;

  if (context === "catalog") {
    // Se olvidan los botones de las tarjetas que se van a sustituir.
    for (const [key, entry] of catalogAddButtons) {
      const grid = entry.button.closest(".movies-grid");
      if (grid === container || !entry.button.isConnected) {
        catalogAddButtons.delete(key);
      }
    }
  }

  clearNode(container);

  const gridKey = container.id || "";
  const fragment = document.createDocumentFragment();
  for (const movie of Array.isArray(movies) ? movies : []) {
    const card = createMovieCard(movie, context, gridKey);
    if (card) fragment.append(card);
  }
  container.append(fragment);
}

/**
 * Refleja en los botones del catálogo las películas que ya están en la
 * biblioteca (UI-M04: «En biblioteca», botón desactivado).
 */
function syncCatalogAddButtons() {
  for (const [key, entry] of catalogAddButtons) {
    const { button, tmdbId } = entry;
    const card = button.closest('[data-movie-role="card"]');
    const model = card ? cardModels.get(card) : null;
    if (!model) {
      catalogAddButtons.delete(key);
      continue;
    }
    updateAddButton(button, model, state.libraryByTmdbId.has(tmdbId));
  }
}

// -------------------------------------------------------------
// Estadísticas (UI-M02, ALG-M01, AC-M20)
// -------------------------------------------------------------

/**
 * Pinta la barra de estadísticas con los valores de `computeStats`
 * (ALG-M01). Con la biblioteca vacía todas las cifras son «—».
 *
 * @param {Array<Record<string, unknown>>} movies
 */
function renderStats(movies) {
  const stats = computeStats(movies);

  for (const field of STAT_FIELDS) {
    const node = dom?.stats?.[field.id];
    if (!node) continue;

    const value = stats[field.key];
    node.textContent = typeof value === "number" ? formatInteger(value) : String(value ?? "—");

    // La etiqueta visible se fija en español (UI-M02).
    const item = node.closest(".movies-stats__item");
    const label = item ? item.querySelector("dt") : null;
    if (label) label.textContent = field.label;
  }
}

// -------------------------------------------------------------
// Catálogo (UI-M03)
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
  node.className = "movies-empty";
  node.textContent = `No hay películas en «${label}».`;
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
    const movies = Array.isArray(result?.results) ? result.results : [];
    state.catalog.lists[list.key] = movies;
    renderCards(grid, movies, "catalog");
    if (emptyNode) emptyNode.hidden = movies.length > 0;
    return true;
  } catch (error) {
    state.catalog.lists[list.key] = [];
    clearNode(grid);
    if (emptyNode) emptyNode.hidden = true;
    const message = describeTmdbError(error);
    setMessage(dom?.catalog?.error, message);
    // El aviso general recuerda que el alta manual sigue operativa
    // (UI-M08, ALG-M05, AC-M06).
    setTmdbWarning(message);
    return false;
  } finally {
    if (grid) grid.removeAttribute("aria-busy");
  }
}

/**
 * Carga el catálogo la primera vez que se abre la pestaña. Sin clave
 * de TMDB no hay peticiones de red y se avisa en español (AC-M01).
 *
 * Si alguna lista falla, el catálogo queda «reintentable»: la
 * siguiente vez que se abre la pestaña se vuelve a pedir.
 *
 * @returns {Promise<void>}
 */
async function loadCatalog() {
  if (state.catalog.loaded || state.catalog.loading) return;

  if (!isTmdbConfigured()) {
    // Sin clave no hay peticiones de red (AC-M01, ALG-M05): el aviso
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
 * (UI-M03: «con resultados de búsqueda las listas se ocultan»).
 */
function showCatalogResults() {
  setVisible(dom?.catalog?.sections, false);
  setVisible(dom?.catalog?.results, true);
}

/**
 * Búsqueda instantánea del catálogo (debounce 300 ms, mínimo 2
 * caracteres; NFR-M04).
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
    const result = await searchMovies(query, null, 1);
    if (token !== searchToken) return;

    const movies = Array.isArray(result?.results) ? result.results : [];
    renderCards(grid, movies, "catalog");

    const emptyNode = dom?.catalog?.empty;
    if (emptyNode) {
      emptyNode.textContent = `Sin resultados para «${query}».`;
      emptyNode.hidden = movies.length > 0;
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
    // disponible (AC-M06).
    setTmdbWarning(message);
  } finally {
    if (token === searchToken && grid) grid.removeAttribute("aria-busy");
  }
}

// -------------------------------------------------------------
// Biblioteca: buscador, filtros combinables y orden (UI-M05)
// -------------------------------------------------------------

/**
 * Rellena el filtro de estado con las opciones de `moviesState.js`
 * (UI-M05): «Todos», «Pendientes», «Viendo», «Vistas»,
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
 * (UI-M05, ALG-M02). El orden por defecto es «Fecha de añadido».
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
 * Rellena el filtro de género con el diccionario estático (D-M08).
 */
function populateGenreFilter() {
  const select = dom?.library?.genre;
  if (!select) return;

  clearNode(select);
  const first = document.createElement("option");
  first.value = "";
  first.textContent = "Todos los géneros";
  select.append(first);

  for (const genre of TMDB_GENRE_OPTIONS) {
    const option = document.createElement("option");
    option.value = String(genre.id);
    option.textContent = genre.label;
    select.append(option);
  }
}

/**
 * Rellena el filtro de colección con los nombres del usuario
 * (DB-M02). «Todas» es la opción por defecto.
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
 * Valor numérico escrito en un filtro de nota. Acepta coma decimal
 * («7,5»). Vacío o no numérico se trata como «sin fijar».
 *
 * @param {HTMLInputElement|null|undefined} input
 * @returns {number|null}
 */
function readRatingValue(input) {
  if (!input) return null;

  const raw = typeof input.value === "string" ? input.value.trim() : "";
  if (raw === "") return null;

  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `true` si una nota está dentro del rango y del paso válidos.
 *
 * @param {number|null} value
 * @returns {boolean}
 */
function isValidRatingValue(value) {
  if (value === null) return true;
  if (value < RATING_MIN || value > RATING_MAX) return false;
  return (
    Math.abs(value / RATING_STEP - Math.round(value / RATING_STEP)) < 1e-9
  );
}

/**
 * Estado del filtro de nota (UI-M05: 0–10, paso 0.5).
 *
 * Un valor inválido **no** se aplica: el filtro correspondiente se
 * deja sin fijar y el input se marca con `aria-invalid` para que el
 * error se anuncie en lugar de «corregir» en silencio lo que ha
 * escrito el usuario.
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

  const min = readRatingValue(library.ratingMin);
  const max = readRatingValue(library.ratingMax);

  const minValid = isValidRatingValue(min);
  const maxValid = isValidRatingValue(max);
  const inverted = min !== null && max !== null && min > max;

  if (library.ratingMin) {
    library.ratingMin.setAttribute("aria-invalid", minValid ? "false" : "true");
  }
  if (library.ratingMax) {
    library.ratingMax.setAttribute("aria-invalid", maxValid ? "false" : "true");
  }

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
 * Mensaje de error del rango de nota (o `null` si es válido).
 *
 * @returns {string|null}
 */
function readRatingError() {
  const range = readRatingRange();

  if (!range.minValid || !range.maxValid) return RATING_RANGE_ERROR;
  if (range.inverted) return RATING_RANGE_ORDER_ERROR;

  return null;
}

/**
 * Muestra en `movies-library-error` el aviso que corresponda: primero
 * el del rango de nota y, si no hay, el error de carga de la
 * biblioteca.
 */
function renderLibraryError() {
  setMessage(dom?.library?.error, readRatingError() ?? libraryLoadError);
}

/**
 * Lee los controles de filtro de la biblioteca y los normaliza con
 * `createLibraryFilters` (T-M04). Los filtros se combinan con AND
 * (AC-M18): estado/favoritas, género, colección, rango de nota y
 * búsqueda.
 *
 * @returns {ReturnType<typeof createLibraryFilters>}
 */
function readLibraryFilters() {
  const library = dom?.library ?? {};
  const status = library.status?.value ?? "";
  const range = readRatingRange();

  return createLibraryFilters({
    query: library.search?.value ?? "",
    status,
    // «Favoritas» es un pseudofiltro: `isFavorite === true`.
    favorite: status === "favorites",
    genreId: library.genre?.value ? Number(library.genre.value) : null,
    collectionId: library.collection?.value ?? "",
    // Un extremo inválido no se aplica: el filtro se deja sin fijar.
    ratingMin: range.min,
    ratingMax: range.max,
    sort: library.sort?.value || DEFAULT_SORT_KEY,
  });
}

/**
 * Pinta la biblioteca: filtra en cliente (ALG-M02), ordena en
 * cliente (D-M03) y actualiza el recuento y el estado vacío.
 *
 * El origen es el snapshot que devuelve el servidor con los filtros
 * de servidor aplicados; el filtrado en cliente se mantiene para la
 * búsqueda y el rango de nota.
 */
function renderLibrary() {
  const grid = dom?.library?.grid;
  const movies = filterMovies(state.libraryFiltered, state.libraryFilters);
  const sorted = sortMovies(movies, state.libraryFilters.sort);

  renderCards(grid, sorted, "library");

  // Contador «N películas» (UI-M05).
  const count = dom?.library?.count;
  if (count) {
    const total = formatInteger(sorted.length) ?? "0";
    count.textContent = `${total} ${sorted.length === 1 ? "película" : "películas"}`;
  }

  // Estados vacíos en español: biblioteca vacía o sin resultados.
  const empty = dom?.library?.empty;
  if (empty) {
    const libraryIsEmpty =
      state.library.length === 0 && !hasActiveLibraryFilters(state.libraryFilters);

    empty.textContent = libraryIsEmpty
      ? LIBRARY_EMPTY_MESSAGE
      : LIBRARY_NO_RESULTS_MESSAGE;
    empty.hidden = sorted.length > 0;
  }
}

/**
 * Aplica los cambios de los controles de la biblioteca.
 */
function applyLibraryFilters() {
  state.libraryFilters = readLibraryFilters();
  syncServerSubscription();
  renderLibraryError();
  renderLibrary();
}

/**
 * Restablece los controles y los filtros de la biblioteca
 * («Limpiar filtros» de UI-M05): la lista completa vuelve a pintarse.
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
 * catálogo). Al vaciar el buscador se aplica al momento.
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
 * Aplica en memoria el nuevo estado de favorito de una película
 * (AC-M14). No repinta: el parcheo de la tarjeta y el repintado (si
 * el filtro deja de incluir la película) los hace `syncLibraryCard`.
 *
 * @param {string} docId
 * @param {boolean} isFavorite
 * @returns {boolean} `true` si la película estaba en la biblioteca.
 */
function applyLibraryFavorite(docId, isFavorite) {
  let patched = false;

  const patchList = (list) =>
    list.map((movie) => {
      if (movie?.id !== docId) return movie;
      patched = true;
      return { ...movie, isFavorite };
    });

  state.library = patchList(state.library);
  state.libraryFiltered = patchList(state.libraryFiltered);

  const current = state.libraryByDocId.get(docId);
  if (current) {
    const byDocId = new Map(state.libraryByDocId);
    byDocId.set(docId, { ...current, isFavorite });
    state.libraryByDocId = byDocId;
  }

  return patched;
}

/**
 * Tarjeta viva de una película de la biblioteca dentro de la rejilla.
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
 * Refleja el nuevo estado de favorito en la tarjeta, sin repintar la
 * rejilla entera (AC-M14). Si el filtro activo deja de incluir la
 * película (por ejemplo, con el filtro «Favoritas»), se repinta la
 * rejilla y la tarjeta desaparece de la lista.
 *
 * @param {string} docId
 * @param {boolean} isFavorite
 * @returns {HTMLElement|null} Botón de favorito vivo, o `null` si la
 *   película ya no está en la lista.
 */
function syncLibraryCard(docId, isFavorite) {
  const card = findLibraryCard(docId);
  const movie = state.libraryByDocId.get(docId);

  if (!card || !movie) {
    renderLibrary();
    return null;
  }

  const button = card.querySelector('[data-movie-role="favorite"]');
  if (button instanceof HTMLElement) {
    updateFavoriteButton(button, isFavorite);
  }

  const stillVisible = filterMovies([movie], state.libraryFilters).length > 0;
  if (!stillVisible) {
    renderLibrary();
    return null;
  }

  return button instanceof HTMLElement ? button : null;
}

/**
 * Devuelve el foco al botón de favorito tras un repintado (AC-M14).
 * Si la película ya no está en la lista, el foco vuelve a la rejilla.
 *
 * @param {string} docId
 */
function restoreLibraryFavoriteFocus(docId) {
  const grid = dom?.library?.grid;
  const button = byId(`movie-card-favorite-doc-${safeIdPart(docId)}`);

  if (button instanceof HTMLElement) {
    button.focus();
    return;
  }

  if (grid instanceof HTMLElement) {
    if (!grid.hasAttribute("tabindex")) grid.setAttribute("tabindex", "-1");
    grid.focus();
  }
}

/**
 * Recibe el snapshot de la biblioteca **sin** filtros: alimenta la
 * barra de estadísticas (UI-M02) y el índice de películas ya añadidas
 * que usa el catálogo.
 *
 * @param {Array<Record<string, unknown>>} movies
 */
function onLibraryStatsSnapshot(movies) {
  const list = Array.isArray(movies) ? movies : [];

  state.library = list;
  state.libraryByDocId = new Map();
  state.libraryByTmdbId = new Map();

  for (const movie of list) {
    if (typeof movie?.id === "string") {
      state.libraryByDocId.set(movie.id, movie);
    }
    if (typeof movie?.tmdbId === "number") {
      state.libraryByTmdbId.set(String(movie.tmdbId), movie);
    }
  }

  renderStats(list);
  syncCatalogAddButtons();

  // El recuento de películas de cada colección sale de la biblioteca
  // completa (DB-M02, AC-M16).
  updateCollectionCounts();

  // Si hay una ficha abierta, sus campos de seguimiento se refrescan
  // con el snapshot sin tocar la parte personal (D-M09, AC-M26).
  refreshOpenDetailTracking();
}

/**
 * Recibe el snapshot de la biblioteca **con** los filtros de servidor:
 * es la lista que se pinta en la rejilla (UI-M05).
 *
 * @param {Array<Record<string, unknown>>} movies
 */
function onLibrarySnapshot(movies) {
  state.libraryFiltered = Array.isArray(movies) ? movies : [];

  // El snapshot llegó bien: se descarta cualquier error de carga
  // anterior para que el aviso no se quede pegado.
  libraryLoadError = "";
  renderLibraryError();

  renderLibrary();
}

/**
 * Recibe el snapshot de las colecciones: repuebla el filtro por
 * colección (UI-M05) y repinta el panel «Mis colecciones» (UI-M07).
 *
 * @param {Array<Record<string, unknown>>} collections
 */
function onCollectionsSnapshot(collections) {
  state.collections = Array.isArray(collections) ? collections : [];
  populateCollectionFilter(state.collections);
  renderCollections();
}

/**
 * Filtros que el servidor puede aplicar (ALG-M02): una igualdad
 * (`status` o `isFavorite`) y hasta dos `array-contains`
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
 * para el servidor (DB-M01). Cualquier valor desconocido se ignora.
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
 * Suscribe la biblioteca con los filtros de servidor (UI-M05). Cada
 * cambio de filtro renueva la suscripción para que Firestore use los
 * índices correspondientes.
 *
 * @param {{ status: string, favorite: boolean, genreId: number|null, collectionId: string }} serverFilters
 */
function subscribeLibraryData(serverFilters) {
  serverFiltersSignature = computeServerFiltersSignature(serverFilters);

  if (typeof moviesUnsubscribe === "function") {
    try {
      moviesUnsubscribe();
    } catch {
      // Una baja fallida no debe impedir la nueva suscripción.
    }
    moviesUnsubscribe = null;
  }

  try {
    moviesUnsubscribe = subscribeMovies(
      serverFilters,
      onLibrarySnapshot,
      (error) => {
        libraryLoadError = `No se pudo cargar tu biblioteca de películas. ${describeRepositoryError(error)}`;
        renderLibraryError();
      }
    );
  } catch (error) {
    setMessage(dom?.messages?.error, describeRepositoryError(error));
  }
}

/**
 * Renueva la suscripción de la biblioteca cuando cambian los filtros
 * que el servidor puede aplicar (estado/favoritas, género y
 * colección).
 */
function syncServerSubscription() {
  const serverFilters = readServerFilters();
  if (computeServerFiltersSignature(serverFilters) === serverFiltersSignature) {
    return;
  }

  subscribeLibraryData(serverFilters);
}

/**
 * Suscribe las fuentes auxiliares: la biblioteca sin filtros (para
 * las estadísticas, UI-M02) y las colecciones (DB-M02). Sin sesión
 * activa se avisa en español y la vista sigue operativa (SEC-M03).
 */
function subscribeLibrarySources() {
  try {
    statsUnsubscribe = subscribeMovies({}, onLibraryStatsSnapshot, (error) => {
      libraryLoadError = `No se pudo cargar tu biblioteca de películas. ${describeRepositoryError(error)}`;
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
// Acciones de las tarjetas (UI-M04)
// -------------------------------------------------------------

/**
 * Abre la ficha de una película. Si hay un abridor externo
 * registrado (`setMovieDetailOpener`) se delega en él; si no, se
 * abre la ficha de `<dialog id="movie-detail">` (UI-M06).
 *
 * @param {CardModel} model
 */
function openMovieDetail(model) {
  if (typeof detailOpener === "function") {
    detailOpener(model);
    return;
  }

  void openMovieDetailDialog(model);
}

/**
 * «Añadir»: alta inmediata con `status:"watchlist"` (DB-M03).
 *
 * @param {HTMLElement} button
 */
async function handleAddMovie(button) {
  const card = button.closest('[data-movie-role="card"]');
  const model = card ? cardModels.get(card) : null;
  if (!model || model.context !== "catalog") return;

  button.disabled = true;
  button.textContent = "Añadiendo…";

  try {
    await addFromTmdb(model.raw);
    updateAddButton(button, model, true);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Añadir";
    setMessage(dom?.messages?.error, describeRepositoryError(error));
  }
}

/**
 * Favorito de la tarjeta de biblioteca (UI-M04, AC-M14).
 *
 * El cambio se aplica de forma optimista: el estado en memoria y la
 * tarjeta se actualizan al instante, de modo que el filtro
 * «Favoritas» refleja el nuevo estado sin esperar al snapshot. Si la
 * escritura falla, se revierte sobre los nodos vivos.
 *
 * @param {HTMLElement} button
 */
async function handleToggleFavorite(button) {
  const card = button.closest('[data-movie-role="card"]');
  const model = card ? cardModels.get(card) : null;
  if (!model || model.context !== "library" || !model.docId) return;

  const docId = model.docId;
  const previous = model.isFavorite;
  const next = !previous;

  updateFavoriteButton(button, next);
  applyLibraryFavorite(docId, next);
  syncLibraryCard(docId, next);

  try {
    await setFavorite(docId, next);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    // La reversión actúa sobre la tarjeta viva, no sobre un nodo
    // desconectado por un repintado anterior.
    applyLibraryFavorite(docId, previous);
    syncLibraryCard(docId, previous);
    setMessage(dom?.messages?.error, describeRepositoryError(error));
  }

  // Tras el repintado, el foco vuelve al botón de favorito.
  restoreLibraryFavoriteFocus(docId);
}

/**
 * Delegación de los clics de las tarjetas y de las colecciones.
 *
 * @param {Event} event
 */
function onSectionClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  // --- Colecciones (UI-M07) ----------------------------------------
  const collectionItem = target.closest('[data-movie-role="collection-item"]');
  if (collectionItem instanceof HTMLElement) {
    const collectionId = collectionItem.dataset.collectionId ?? "";

    const collectionOpen = target.closest('[data-movie-role="collection-open"]');
    if (collectionOpen instanceof HTMLElement) {
      handleCollectionOpen(collectionId);
      return;
    }

    const collectionRename = target.closest('[data-movie-role="collection-rename"]');
    if (collectionRename instanceof HTMLElement) {
      handleCollectionRename(collectionId);
      return;
    }

    const collectionDelete = target.closest('[data-movie-role="collection-delete"]');
    if (collectionDelete instanceof HTMLElement) {
      void handleCollectionDelete(collectionId);
      return;
    }
  }

  const openButton = target.closest('[data-movie-role="open"]');
  if (openButton) {
    const card = openButton.closest('[data-movie-role="card"]');
    const model = card ? cardModels.get(card) : null;
    if (model) openMovieDetail(model);
    return;
  }

  const addButton = target.closest('[data-movie-role="add"]');
  if (addButton instanceof HTMLElement && !addButton.disabled) {
    void handleAddMovie(addButton);
    return;
  }

  const favoriteButton = target.closest('[data-movie-role="favorite"]');
  if (favoriteButton instanceof HTMLElement) {
    void handleToggleFavorite(favoriteButton);
  }
}

// -------------------------------------------------------------
// Pestañas (UI-M01)
// -------------------------------------------------------------

/**
 * Activa una pestaña: actualiza `aria-selected`, `tabindex` y la
 * visibilidad de los paneles.
 *
 * @param {string} key
 */
function activateTab(key) {
  const tab = MOVIE_TABS.find((item) => item.key === key);
  if (!tab) return;

  state.activeTab = tab.key;

  for (const item of MOVIE_TABS) {
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
  const index = MOVIE_TABS.findIndex((item) => item.key === currentKey);
  if (index < 0) return;

  let nextIndex = index;

  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      nextIndex = (index + 1) % MOVIE_TABS.length;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      nextIndex = (index - 1 + MOVIE_TABS.length) % MOVIE_TABS.length;
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = MOVIE_TABS.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  const next = MOVIE_TABS[nextIndex];
  activateTab(next.key);
  dom?.tabs?.[next.key]?.focus();
}

// -------------------------------------------------------------
// Ficha de película (UI-M06, ALG-M03, ALG-M04, ALG-M06, D-M09)
// -------------------------------------------------------------

/**
 * Normaliza una fecha (cadena ISO, `Date`, `Timestamp` de Firestore o
 * número de milisegundos) a milisegundos. Lo no reconocido es `null`.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toMillis(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value === "string") {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value === "object") {
    const candidate = /** @type {{ toMillis?: () => number, toDate?: () => Date, seconds?: number, nanoseconds?: number }} */ (
      value
    );

    if (typeof candidate.toMillis === "function") {
      try {
        const millis = candidate.toMillis();
        return Number.isFinite(millis) ? millis : null;
      } catch {
        return null;
      }
    }

    if (typeof candidate.toDate === "function") {
      try {
        const millis = candidate.toDate().getTime();
        return Number.isFinite(millis) ? millis : null;
      } catch {
        return null;
      }
    }

    if (
      typeof candidate.seconds === "number" &&
      Number.isFinite(candidate.seconds)
    ) {
      const fraction =
        typeof candidate.nanoseconds === "number" &&
        Number.isFinite(candidate.nanoseconds)
          ? candidate.nanoseconds / 1e6
          : 0;
      return candidate.seconds * 1000 + fraction;
    }
  }

  return null;
}

/**
 * Fecha en formato largo es-ES («15 de noviembre de 2010»).
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function formatDateEs(value) {
  const millis = toMillis(value);
  if (millis === null) return null;

  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;

  return longDateFormatter.format(date);
}

/**
 * Fecha de estreno «YYYY-MM-DD» en formato largo es-ES. Se construye
 * en hora local para que el día no se desplace por el uso horario.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function formatReleaseDateEs(value) {
  if (typeof value !== "string") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;

  return longDateFormatter.format(date);
}

/**
 * Adapta el detalle de TMDB al modelo de película que pinta la ficha.
 * Los campos personales se dejan vacíos: una película del catálogo
 * todavía no está en la biblioteca.
 *
 * @param {Record<string, unknown>} tmdbDetail Detalle de `tmdbClient.js`.
 * @returns {Record<string, unknown>}
 */
function tmdbDetailToMovie(tmdbDetail) {
  const source =
    tmdbDetail && typeof tmdbDetail === "object" ? tmdbDetail : {};

  const genreIds = Array.isArray(source.genreIds)
    ? source.genreIds.filter((id) => typeof id === "number")
    : [];

  const genres =
    Array.isArray(source.genres) && source.genres.length > 0
      ? source.genres.filter((name) => typeof name === "string")
      : genreIds.map((id) => TMDB_GENRES_ES[id]).filter(Boolean);

  return {
    id: null,
    source: "tmdb",
    tmdbId: typeof source.id === "number" ? source.id : null,
    title: typeof source.title === "string" ? source.title : "",
    originalTitle:
      typeof source.originalTitle === "string" ? source.originalTitle : "",
    posterPath:
      typeof source.posterPath === "string" ? source.posterPath : null,
    backdropPath:
      typeof source.backdropPath === "string" ? source.backdropPath : null,
    releaseDate:
      typeof source.releaseDate === "string" ? source.releaseDate : null,
    releaseYear: yearFromReleaseDate(source.releaseDate),
    runtime: typeof source.runtime === "number" ? source.runtime : null,
    genreIds,
    genres,
    overview: typeof source.overview === "string" ? source.overview : "",
    director:
      typeof source.director === "string" && source.director !== ""
        ? source.director
        : null,
    cast: Array.isArray(source.cast)
      ? source.cast.filter((name) => typeof name === "string")
      : [],
    trailerKey:
      typeof source.trailerKey === "string" ? source.trailerKey : null,
    watchProviders: Array.isArray(source.watchProviders)
      ? source.watchProviders.filter((name) => typeof name === "string")
      : [],
    tmdbRating:
      typeof source.voteAverage === "number" ? source.voteAverage : null,
    tmdbVoteCount:
      typeof source.voteCount === "number" ? source.voteCount : null,
    detailCachedAt: null,
    status: "watchlist",
    isFavorite: false,
    watchCount: 0,
    watchDates: [],
    lastWatchedAt: null,
    userRating: null,
    userReview: null,
    tags: [],
    hasSpoilers: false,
    collectionIds: [],
    addedAt: null,
    updatedAt: null,
  };
}

/**
 * Traduce un error de la ficha al mensaje de UI. Los errores de TMDB
 * usan el mapeo de ALG-M05; los del repositorio, su propio mensaje en
 * español.
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeDetailError(error) {
  const code =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "";

  if (code && Object.prototype.hasOwnProperty.call(TMDB_ERROR_MESSAGES, code)) {
    return describeTmdbError(error);
  }

  return describeRepositoryError(error);
}

// -------------------------------------------------------------
// Ficha: aviso de TMDB y mensajes internos
// -------------------------------------------------------------

/**
 * Muestra un aviso de TMDB en `movies-tmdb-warning` (UI-M08,
 * ALG-M05). El alta manual sigue operativa aunque se avise.
 *
 * @param {string} message
 */
function setTmdbWarning(message) {
  setMessage(dom?.messages?.tmdbWarning, message);
}

/**
 * Crea (una sola vez) el nodo de error del diálogo.
 *
 * @returns {HTMLElement|null}
 */
function ensureDetailErrorNode() {
  if (detailErrorNode && detailErrorNode.isConnected) return detailErrorNode;

  const dialog = dom?.detail?.dialog;
  if (!dialog) return null;

  const node = document.createElement("p");
  node.className = "movies-message movies-message--error";
  node.setAttribute("role", "alert");
  node.hidden = true;

  const body = dialog.querySelector(".movie-detail__body");
  if (body) body.prepend(node);

  detailErrorNode = node;
  return node;
}

/**
 * Crea (una sola vez) el nodo de aviso del diálogo.
 *
 * @returns {HTMLElement|null}
 */
function ensureDetailStatusNode() {
  if (detailStatusNode && detailStatusNode.isConnected) return detailStatusNode;

  const dialog = dom?.detail?.dialog;
  if (!dialog) return null;

  const node = document.createElement("p");
  node.className = "movies-message";
  node.setAttribute("role", "status");
  node.hidden = true;

  const body = dialog.querySelector(".movie-detail__body");
  if (body) body.prepend(node);

  detailStatusNode = node;
  return node;
}

/**
 * Crea (una sola vez) el nodo de aviso del diálogo cuando la película
 * no está en la biblioteca: el bloque «seguimiento» queda deshabilitado
 * y se explica por qué (UI-M06).
 *
 * @returns {HTMLElement|null}
 */
function ensureDetailHintNode() {
  if (detailHintNode && detailHintNode.isConnected) return detailHintNode;

  const dialog = dom?.detail?.dialog;
  if (!dialog) return null;

  const node = document.createElement("p");
  node.className = "movies-hint";
  node.setAttribute("role", "status");
  node.textContent = DETAIL_CATALOG_HINT;
  node.hidden = true;

  const body = dialog.querySelector(".movie-detail__body");
  if (body) body.prepend(node);

  detailHintNode = node;
  return node;
}

/**
 * Muestra u oculta el aviso «no está en tu biblioteca» según el
 * contexto de la ficha.
 *
 * @param {boolean} inLibrary
 */
function setDetailHintVisible(inLibrary) {
  if (detailHintNode) detailHintNode.hidden = inLibrary === true;
}

/**
 * Escribe un error en el diálogo y en el aviso general de la sección.
 *
 * @param {string} message
 */
function showDetailError(message) {
  const text = typeof message === "string" ? message : "";
  const node = ensureDetailErrorNode();
  if (node) setMessage(node, text);
  setMessage(dom?.messages?.error, text);
}

/**
 * Escribe un aviso informativo en el diálogo.
 *
 * @param {string} message
 */
function showDetailStatus(message) {
  const text = typeof message === "string" ? message : "";
  const node = ensureDetailStatusNode();
  if (node) setMessage(node, text);
}

/**
 * Limpia los mensajes del diálogo.
 */
function clearDetailMessages() {
  for (const node of [detailErrorNode, detailStatusNode]) {
    if (node) setMessage(node, "");
  }
}

// -------------------------------------------------------------
// Ficha: painting (UI-M06)
// -------------------------------------------------------------

/**
 * Pinta el bloque «catálogo» de la ficha (UI-M06, AC-M04).
 *
 * @param {Record<string, unknown>} movie
 */
function renderDetailMeta(movie) {
  const d = dom?.detail;
  if (!d) return;

  const data = movie ?? {};
  const title =
    typeof data.title === "string" && data.title !== ""
      ? data.title
      : "Sin título";

  setText(d.title, title);

  const originalTitle =
    typeof data.originalTitle === "string" ? data.originalTitle : "";
  setText(d.originalTitle, originalTitle);
  setVisible(d.originalTitle, originalTitle !== "");

  // Póster (w500) y backdrop (w1280).
  const posterSrc = posterUrl(
    typeof data.posterPath === "string" ? data.posterPath : null,
    POSTER_SIZE
  );
  if (d.poster instanceof HTMLImageElement) {
    d.poster.src = posterSrc ?? POSTER_PLACEHOLDER;
    d.poster.alt = posterSrc ? `Póster de ${title}` : "Sin póster";
    d.poster.hidden = false;
  }

  const backdropSrc = backdropUrl(
    typeof data.backdropPath === "string" ? data.backdropPath : null
  );
  if (d.backdrop instanceof HTMLImageElement) {
    if (backdropSrc) {
      d.backdrop.src = backdropSrc;
      d.backdrop.alt = "";
      d.backdrop.hidden = false;
    } else {
      d.backdrop.removeAttribute("src");
      d.backdrop.hidden = true;
    }
  }

  // Fecha de estreno (es-ES).
  const release = formatReleaseDateEs(data.releaseDate);
  const releaseYear =
    typeof data.releaseYear === "number" ? data.releaseYear : null;
  setText(d.release, release ?? (releaseYear === null ? "" : String(releaseYear)));
  setVisible(d.release, release !== null || releaseYear !== null);

  // Duración en minutos («148 min»).
  const runtime =
    typeof data.runtime === "number" && Number.isFinite(data.runtime)
      ? data.runtime
      : null;
  setText(d.runtime, runtime === null ? "" : `${runtime} min`);
  setVisible(d.runtime, runtime !== null);

  // Géneros: los del documento o, si no hay, los del diccionario.
  const genres =
    Array.isArray(data.genres) && data.genres.length > 0
      ? data.genres.filter((name) => typeof name === "string")
      : (Array.isArray(data.genreIds)
          ? data.genreIds
              .map((id) => TMDB_GENRES_ES[id])
              .filter((name) => typeof name === "string")
          : []);
  setText(d.genres, genres.join(", "));
  setVisible(d.genres, genres.length > 0);

  // Sinopsis, director y reparto.
  const overview = typeof data.overview === "string" ? data.overview : "";
  setText(d.overview, overview);
  setVisible(d.overview, overview !== "");

  const director =
    typeof data.director === "string" && data.director !== ""
      ? data.director
      : null;
  setText(d.director, director ?? "—");

  const cast = Array.isArray(data.cast)
    ? data.cast.filter((name) => typeof name === "string" && name !== "")
    : [];
  setText(d.cast, cast.length > 0 ? cast.join(", ") : "—");

  // Tráiler (API-M08).
  const trailer = trailerUrl(
    typeof data.trailerKey === "string" ? data.trailerKey : null
  );
  if (d.trailer instanceof HTMLAnchorElement) {
    if (trailer) {
      d.trailer.href = trailer;
      d.trailer.textContent = "Ver tráiler";
      d.trailer.hidden = false;
    } else {
      d.trailer.removeAttribute("href");
      d.trailer.hidden = true;
    }
  }

  // «Dónde ver»: la sección se oculta si no hay proveedores (UI-M06).
  const providers = Array.isArray(data.watchProviders)
    ? data.watchProviders.filter((name) => typeof name === "string" && name !== "")
    : [];
  clearNode(d.providersList);
  for (const provider of providers) {
    const item = document.createElement("li");
    item.textContent = provider;
    d.providersList?.append(item);
  }
  setVisible(d.providers, providers.length > 0);

  // Nota de TMDB, siempre separada de la nota personal (AC-M24).
  const tmdbRating = formatRating(data.tmdbRating);
  const tmdbVotes = formatInteger(data.tmdbVoteCount);
  let tmdbText = "";
  if (tmdbRating !== null) {
    tmdbText =
      tmdbVotes === null
        ? `TMDB ${tmdbRating}`
        : `TMDB ${tmdbRating} (${tmdbVotes} votos)`;
  }
  setText(d.tmdbRating, tmdbText);
  setVisible(d.tmdbRating, tmdbText !== "");
}

/**
 * Pinta el bloque «seguimiento»: estado, favorito y visionados
 * (UI-M06, AC-M10, AC-M11).
 *
 * @param {Record<string, unknown>} movie
 */
function renderDetailTracking(movie) {
  const d = dom?.detail;
  if (!d) return;

  const data = movie ?? {};

  const status = typeof data.status === "string" ? data.status : "watchlist";
  if (d.status instanceof HTMLSelectElement) {
    d.status.value = Object.prototype.hasOwnProperty.call(STATUS_LABELS, status)
      ? status
      : "watchlist";
  }

  setDetailFavorite(data.isFavorite === true);

  const watchCount =
    typeof data.watchCount === "number" && Number.isFinite(data.watchCount)
      ? Math.max(0, Math.trunc(data.watchCount))
      : 0;
  setText(d.watchCount, String(watchCount));
  if (d.watchInput instanceof HTMLInputElement) {
    d.watchInput.value = String(watchCount);
  }

  // Fechas de visionado en español.
  clearNode(d.watchDates);
  const dates = Array.isArray(data.watchDates) ? data.watchDates : [];
  for (const value of dates) {
    const text = formatDateEs(value);
    if (!text) continue;
    const item = document.createElement("li");
    item.textContent = text;
    d.watchDates?.append(item);
  }
  if (dates.length === 0) {
    const item = document.createElement("li");
    item.className = "movies-hint";
    item.textContent = "Sin visionados registrados.";
    d.watchDates?.append(item);
  }
}

/**
 * Pinta el estado del botón de favorito de la ficha (`aria-pressed`).
 *
 * @param {boolean} isFavorite
 */
function setDetailFavorite(isFavorite) {
  const button = dom?.detail?.favorite;
  if (!(button instanceof HTMLElement)) return;

  button.setAttribute("aria-pressed", isFavorite ? "true" : "false");
  const label = button.querySelector('[data-movie-role="favorite-label"]');
  if (label) label.textContent = isFavorite ? "Favorita" : "Marcar como favorita";
}

/**
 * Muestra la nota personal junto a la de TMDB, sin mezclarlas
 * (AC-M24).
 *
 * @param {unknown} value
 */
function renderUserRatingDisplay(value) {
  const node = dom?.detail?.userRatingDisplay;
  if (!node) return;

  const text = formatRating(value);
  node.textContent = text === null ? "Mi nota —" : `Mi nota ${text}`;
}

/**
 * Pinta la parte personal de la ficha: nota, reseña, spoilers,
 * etiquetas y colecciones (UI-M06, D-M09).
 *
 * @param {Record<string, unknown>} movie
 */
function renderDetailPersonal(movie) {
  const d = dom?.detail;
  if (!d) return;

  const data = movie ?? {};

  const userRating =
    typeof data.userRating === "number" && Number.isFinite(data.userRating)
      ? data.userRating
      : null;

  if (d.userRating instanceof HTMLInputElement) {
    d.userRating.value = userRating === null ? "" : String(userRating);
    d.userRating.setAttribute("aria-invalid", "false");
    setUserRatingRaw(userRating === null ? "" : String(userRating));
  }
  renderUserRatingDisplay(userRating);

  const userReview = typeof data.userReview === "string" ? data.userReview : "";
  if (d.review instanceof HTMLTextAreaElement) d.review.value = userReview;

  const hasSpoilers = data.hasSpoilers === true;
  if (d.spoilers instanceof HTMLInputElement) d.spoilers.checked = hasSpoilers;

  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag) => typeof tag === "string")
    : [];
  if (d.tags instanceof HTMLInputElement) d.tags.value = tags.join(", ");

  // Últimos valores guardados: punto de partida del aviso «Cambios sin
  // guardar» (D-M09, AC-M26).
  detailState.saved = {
    userRating: userRating === null ? "" : String(userRating),
    userReview,
    tags: tags.join(", "),
    hasSpoilers,
  };

  detailState.spoilerRevealed = false;

  renderDetailCollections(data);
  renderSpoilerState();
  updateDirtyWarning();
}

/**
 * Pinta un checkbox por colección del usuario (DB-M02, AC-M15).
 *
 * @param {Record<string, unknown>} movie
 */
function renderDetailCollections(movie) {
  const container = dom?.detail?.collections;
  if (!container) return;

  clearNode(container);

  const selected = new Set(
    Array.isArray(movie?.collectionIds)
      ? movie.collectionIds.map((id) => String(id))
      : []
  );

  for (const collection of state.collections) {
    const id = String(collection?.id ?? "");
    if (id === "") continue;

    const label = document.createElement("label");
    label.className = "movies-checkbox";

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
    hint.className = "movies-hint";
    hint.textContent = "Aún no tienes colecciones.";
    container.append(hint);
  }
}

/**
 * Oculta la reseña cuando tiene spoilers y el usuario no la ha
 * revelado (AC-M13).
 */
function renderSpoilerState() {
  const d = dom?.detail;
  if (!d) return;

  const hasSpoilers =
    d.spoilers instanceof HTMLInputElement ? d.spoilers.checked : false;
  const reviewText =
    d.review instanceof HTMLTextAreaElement ? d.review.value.trim() : "";

  const hidden =
    hasSpoilers && reviewText !== "" && !detailState.spoilerRevealed;

  if (d.review instanceof HTMLTextAreaElement) d.review.hidden = hidden;
  setVisible(d.spoilerWarning, hidden);
}

/**
 * Lee los campos de la parte personal de la ficha.
 *
 * @returns {DetailPersonal}
 */
function readPersonalForm() {
  const d = dom?.detail ?? {};

  return {
    userRating: readUserRatingInput(),
    userReview: d.review instanceof HTMLTextAreaElement ? d.review.value : "",
    tags: d.tags instanceof HTMLInputElement ? d.tags.value : "",
    hasSpoilers:
      d.spoilers instanceof HTMLInputElement ? d.spoilers.checked : false,
  };
}

/**
 * `true` si hay cambios pendientes de nota, reseña, etiquetas o
 * spoilers (D-M09, AC-M26).
 *
 * @returns {boolean}
 */
function isDetailDirty() {
  const current = readPersonalForm();
  const saved = detailState.saved;

  return (
    current.userRating !== saved.userRating ||
    current.userReview !== saved.userReview ||
    current.tags !== saved.tags ||
    current.hasSpoilers !== saved.hasSpoilers
  );
}

/**
 * Muestra u oculta el aviso «Cambios sin guardar» (AC-M26).
 */
function updateDirtyWarning() {
  const node = dom?.detail?.dirtyWarning;
  if (!node) return;

  const dirty = isDetailDirty();
  node.textContent = "Cambios sin guardar";
  node.hidden = !dirty;
}

/**
 * Divide el texto de las etiquetas en una lista (DB-M01: ≤20
 * etiquetas de ≤30 caracteres; el repositorio lo valida).
 *
 * @param {string} value
 * @returns {string[]}
 */
function parseTagsInput(value) {
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

// -------------------------------------------------------------
// Ficha: nota personal y texto literal (ALG-M04, AC-M12)
// -------------------------------------------------------------

/**
 * Mantiene una copia del texto literal escrito en el campo de nota.
 *
 * Los inputs de tipo `number` devuelven "" cuando el contenido no es
 * un número válido para el campo («7,5» con coma decimal), así que se
 * conserva el texto escrito para poder interpretarlo (ALG-M04).
 *
 * @param {HTMLInputElement|null} input
 * @returns {{ read: () => string, reset: (value: string) => void }}
 */
function createRawTextTracker(input) {
  let raw = "";

  const sync = () => {
    if (!input) return;
    if (input.value !== "") {
      raw = input.value;
      return;
    }
    if (!input.validity || input.validity.badInput !== true) raw = "";
  };

  const onBeforeInput = (event) => {
    if (!input) return;

    const start = input.selectionStart ?? raw.length;
    const end = input.selectionEnd ?? start;

    if (typeof event.data === "string") {
      raw = raw.slice(0, start) + event.data + raw.slice(end);
      return;
    }

    if (event.inputType === "deleteContentBackward") {
      raw =
        start === end && start > 0
          ? raw.slice(0, start - 1)
          : raw.slice(0, start) + raw.slice(end);
      return;
    }

    if (event.inputType === "deleteContentForward") {
      raw =
        start === end
          ? raw.slice(0, start) + raw.slice(end + 1)
          : raw.slice(0, start) + raw.slice(end);
      return;
    }

    if (event.inputType.startsWith("delete")) {
      raw = raw.slice(0, start) + raw.slice(end);
    }
  };

  input?.addEventListener("beforeinput", onBeforeInput);
  input?.addEventListener("input", sync);
  input?.addEventListener("change", sync);

  return {
    read: () => raw,
    reset: (value) => {
      raw = typeof value === "string" ? value : "";
    },
    /** Retira las escuchas: el input vive en `index.html` y sobrevive al desmontaje. */
    destroy: () => {
      input?.removeEventListener("beforeinput", onBeforeInput);
      input?.removeEventListener("input", sync);
      input?.removeEventListener("change", sync);
    },
  };
}

/**
 * Texto escrito en el campo de nota personal. Si el navegador ha
 * rechazado el contenido (coma decimal), se devuelve la copia literal.
 *
 * @returns {string}
 */
function readUserRatingInput() {
  const input = dom?.detail?.userRating;
  if (!(input instanceof HTMLInputElement)) return "";

  if (input.value !== "") return input.value.trim();

  if (input.validity && input.validity.badInput === true) {
    return userRatingTracker ? userRatingTracker.read().trim() : "";
  }

  return "";
}

/**
 * Actualiza la copia literal del campo de nota.
 *
 * @param {string} value
 */
function setUserRatingRaw(value) {
  if (userRatingTracker) userRatingTracker.reset(value);
}

// -------------------------------------------------------------
// Ficha: apertura, carga y cierre (UI-M06, ALG-M06)
// -------------------------------------------------------------

/**
 * Devuelve el id del documento de la biblioteca que corresponde a la
 * película de la tarjeta. Una película del catálogo que ya está en la
 * biblioteca se resuelve a su documento.
 *
 * @param {CardModel} model
 * @returns {string|null}
 */
function resolveDetailDocId(model) {
  if (model?.docId) return model.docId;

  if (model?.tmdbId) {
    const movie = state.libraryByTmdbId.get(model.tmdbId);
    if (movie && typeof movie.id === "string") return movie.id;
  }

  return null;
}

/**
 * Deja la ficha en blanco mientras llegan los datos.
 */
function renderDetailSkeleton() {
  const d = dom?.detail;
  if (!d) return;

  setText(d.title, DETAIL_LOADING_TITLE);
  setText(d.originalTitle, "");
  setVisible(d.originalTitle, false);
  setText(d.release, "");
  setVisible(d.release, false);
  setText(d.runtime, "");
  setVisible(d.runtime, false);
  setText(d.genres, "");
  setVisible(d.genres, false);
  setText(d.overview, "");
  setVisible(d.overview, false);
  setText(d.director, "—");
  setText(d.cast, "—");
  setText(d.tmdbRating, "");
  setVisible(d.tmdbRating, false);
  setText(d.watchCount, "0");

  clearNode(d.watchDates);
  clearNode(d.providersList);
  clearNode(d.collections);
  setVisible(d.providers, false);
  setVisible(d.trailer, false);

  if (d.userRating instanceof HTMLInputElement) {
    d.userRating.value = "";
    setUserRatingRaw("");
  }
  if (d.review instanceof HTMLTextAreaElement) d.review.value = "";
  if (d.tags instanceof HTMLInputElement) d.tags.value = "";
  if (d.spoilers instanceof HTMLInputElement) d.spoilers.checked = false;

  renderUserRatingDisplay(null);
  updateDirtyWarning();
  updateDetailControls();
}

/**
 * Abre la ficha de una película (UI-M06).
 *
 * @param {CardModel} model
 * @returns {Promise<void>}
 */
async function openMovieDetailDialog(model) {
  const d = dom?.detail;
  if (!d?.dialog) return;

  const docId = resolveDetailDocId(model);
  const trigger =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  detailState = {
    ...createDetailState(),
    docId,
    tmdbId: model?.tmdbId ?? null,
    inLibrary: Boolean(docId),
    trigger,
  };

  renderDetailSkeleton();
  clearDetailMessages();

  if (!d.dialog.open) {
    try {
      d.dialog.showModal();
    } catch {
      // Navegador sin soporte de diálogo modal: se abre igualmente.
      d.dialog.setAttribute("open", "");
    }
  }

  // Foco inicial en el título del diálogo (UI-M10, NFR-M02).
  d.title?.focus?.();

  if (docId) {
    await loadLibraryDetail(docId, false);
    return;
  }

  await loadCatalogDetail(model?.tmdbId ?? null);
}

/**
 * Carga la ficha de una película de la biblioteca respetando la caché
 * de 30 días (ALG-M06, AC-M21).
 *
 * @param {string} docId
 * @param {boolean} force `true` para «Actualizar datos».
 * @returns {Promise<boolean>} `true` si los datos se han cargado.
 */
async function loadLibraryDetail(docId, force) {
  setDetailBusy(true);

  try {
    const result = await ensureDetailCached(docId, { force });
    if (detailState.docId !== docId) return false;

    detailState.movie = result.movie;
    detailState.inLibrary = true;
    renderDetailMeta(result.movie);
    renderDetailTracking(result.movie);
    renderDetailPersonal(result.movie);
    updateDetailControls();
    clearDetailMessages();
    return true;
  } catch (error) {
    // Si hay caché previa se muestra y se avisa en español (ALG-M06).
    const cached = state.libraryByDocId.get(docId);
    if (cached) {
      detailState.movie = cached;
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
  }
}

/**
 * Carga la ficha de una película del catálogo (sin biblioteca). Solo
 * hay una petición a TMDB: la del detalle.
 *
 * @param {string|null} tmdbId
 * @returns {Promise<boolean>}
 */
async function loadCatalogDetail(tmdbId) {
  if (!tmdbId) {
    showDetailError(DETAIL_UNKNOWN_MOVIE_MESSAGE);
    return false;
  }

  if (!isTmdbConfigured()) {
    showDetailError(TMDB_ERROR_MESSAGES.NO_API_KEY);
    setTmdbWarning(TMDB_ERROR_MESSAGES.NO_API_KEY);
    return false;
  }

  setDetailBusy(true);

  try {
    const tmdbDetail = await getMovieDetail(Number(tmdbId));
    if (detailState.tmdbId !== String(tmdbId)) return false;

    const movie = tmdbDetailToMovie(tmdbDetail);
    detailState.movie = movie;
    detailState.inLibrary = false;
    renderDetailMeta(movie);
    renderDetailTracking(movie);
    renderDetailPersonal(movie);
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
  }
}

/**
 * Cierra la ficha.
 */
function closeMovieDetail() {
  const dialog = dom?.detail?.dialog;
  if (dialog?.open) dialog.close();
}

/**
 * Al cerrarse la ficha: se descartan los cambios pendientes y el foco
 * vuelve al elemento que la abrió (UI-M10, AC-M26).
 */
function onDetailDialogClose() {
  const trigger = detailState.trigger;

  detailState = createDetailState();
  clearDetailMessages();
  setMessage(dom?.messages?.error, "");

  if (trigger && trigger.isConnected && typeof trigger.focus === "function") {
    trigger.focus();
  }
}

/**
 * Habilita o deshabilita los controles según el contexto y el estado
 * de la escritura en curso.
 */
function updateDetailControls() {
  const d = dom?.detail;
  if (!d) return;

  const busy = detailState.busy;
  const library = detailState.inLibrary;

  if (d.status instanceof HTMLSelectElement) d.status.disabled = !library || busy;
  if (d.favorite instanceof HTMLButtonElement) {
    d.favorite.disabled = !library || busy;
  }
  if (d.watchInc instanceof HTMLButtonElement) {
    d.watchInc.disabled = !library || busy;
  }
  if (d.watchDec instanceof HTMLButtonElement) {
    d.watchDec.disabled = !library || busy;
  }
  if (d.watchInput instanceof HTMLInputElement) {
    d.watchInput.disabled = !library || busy;
  }
  if (d.userRating instanceof HTMLInputElement) {
    d.userRating.disabled = !library || busy;
  }
  if (d.review instanceof HTMLTextAreaElement) {
    d.review.disabled = !library || busy;
  }
  if (d.spoilers instanceof HTMLInputElement) {
    d.spoilers.disabled = !library || busy;
  }
  if (d.tags instanceof HTMLInputElement) {
    d.tags.disabled = !library || busy;
  }
  if (d.save instanceof HTMLButtonElement) d.save.disabled = !library || busy;
  if (d.remove instanceof HTMLButtonElement) d.remove.disabled = !library || busy;
  if (d.refresh instanceof HTMLButtonElement) d.refresh.disabled = busy;

  for (const input of dom.detail.collections?.querySelectorAll(
    'input[type="checkbox"]'
  ) ?? []) {
    if (input instanceof HTMLInputElement) input.disabled = !library || busy;
  }

  setDetailHintVisible(library);
}

/**
 * Marca la ficha como ocupada (o no) y actualiza los controles.
 *
 * @param {boolean} busy
 */
function setDetailBusy(busy) {
  detailState.busy = busy === true;
  updateDetailControls();
}

/**
 * Refresca el bloque «seguimiento» de la ficha abierta con el
 * snapshot de la biblioteca sin filtros.
 *
 * Solo se actualizan los campos de seguimiento (estado, favorito,
 * visionados y fechas). La parte personal —nota, reseña, etiquetas y
 * spoilers— **no** se toca: las ediciones sin guardar se conservan
 * (D-M09, AC-M26).
 *
 * @returns {void}
 */
function refreshOpenDetailTracking() {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  // Con una escritura en curso la ficha refleja el estado local: el
  // snapshot todavía puede traer el valor anterior.
  if (detailState.busy) return;

  const movie = state.libraryByDocId.get(docId);
  if (!movie) return;

  const current = detailState.movie ?? {};

  detailState.movie = {
    ...current,
    status: typeof movie.status === "string" ? movie.status : current.status,
    isFavorite: movie.isFavorite === true,
    watchCount:
      typeof movie.watchCount === "number" && Number.isFinite(movie.watchCount)
        ? Math.max(0, Math.trunc(movie.watchCount))
        : typeof current.watchCount === "number"
          ? current.watchCount
          : 0,
    watchDates: Array.isArray(movie.watchDates)
      ? movie.watchDates
      : Array.isArray(current.watchDates)
        ? current.watchDates
        : [],
    lastWatchedAt:
      movie.lastWatchedAt ?? current.lastWatchedAt ?? null,
  };

  // Si el usuario está escribiendo el contador no se repinta: su texto
  // se perdería.
  const watchInput = dom?.detail?.watchInput;
  if (watchInput && document.activeElement === watchInput) return;

  renderDetailTracking(detailState.movie);
}

// -------------------------------------------------------------
// Ficha: escrituras (ALG-M03, D-M09)
// -------------------------------------------------------------

/**
 * Aplica en memoria el nuevo estado y repinta el bloque de
 * seguimiento. La escritura real la hace el repositorio.
 *
 * @param {string} status
 */
function applyLocalStatus(status) {
  const movie = detailState.movie;
  if (!movie) return;

  const current = typeof movie.status === "string" ? movie.status : "watchlist";
  if (current === status) return;

  const next = { ...movie, status };

  // La transición a «Vista» cuenta un visionado (ALG-M03, AC-M11).
  if (status === "watched" && current !== "watched") {
    const now = new Date();
    const dates = Array.isArray(movie.watchDates) ? movie.watchDates.slice() : [];
    dates.push(now);
    const count =
      typeof movie.watchCount === "number" && Number.isFinite(movie.watchCount)
        ? movie.watchCount
        : 0;

    next.watchCount = Math.min(MAX_WATCH_COUNT, count + 1);
    next.watchDates = dates;
    next.lastWatchedAt = now;
  }

  detailState.movie = next;
  renderDetailTracking(next);
}

/**
 * Aplica en memoria un cambio del contador de visionados.
 *
 * @param {number} count
 */
function applyLocalWatchCount(count) {
  const movie = detailState.movie;
  if (!movie) return;

  const dates = Array.isArray(movie.watchDates) ? movie.watchDates.slice() : [];
  const trimmed =
    count === 0 ? [] : dates.length > count ? dates.slice(dates.length - count) : dates;

  detailState.movie = {
    ...movie,
    watchCount: count,
    watchDates: trimmed,
    lastWatchedAt: trimmed.length > 0 ? trimmed[trimmed.length - 1] : null,
  };

  renderDetailTracking(detailState.movie);
}

/**
 * Cambia el estado de la película (guardado inmediato, D-M09).
 */
async function handleDetailStatusChange() {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  const status = dom?.detail?.status?.value ?? "";
  if (!Object.prototype.hasOwnProperty.call(STATUS_LABELS, status)) return;

  setDetailBusy(true);
  try {
    await setStatus(docId, status);
    applyLocalStatus(status);
    showDetailStatus("Estado actualizado.");
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    showDetailError(describeDetailError(error));
  } finally {
    setDetailBusy(false);
  }
}

/**
 * Alterna el favorito de la ficha (guardado inmediato, D-M09,
 * AC-M14).
 */
async function handleDetailFavoriteToggle() {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  const button = dom?.detail?.favorite;
  const previous = button?.getAttribute("aria-pressed") === "true";
  const next = !previous;

  setDetailFavorite(next);
  if (detailState.movie) {
    detailState.movie = { ...detailState.movie, isFavorite: next };
  }

  try {
    await setFavorite(docId, next);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    setDetailFavorite(previous);
    if (detailState.movie) {
      detailState.movie = { ...detailState.movie, isFavorite: previous };
    }
    showDetailError(describeDetailError(error));
  }
}

/**
 * «+1»: suma un visionado (ALG-M03, AC-M10).
 */
async function handleDetailWatchInc() {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  setDetailBusy(true);
  try {
    await watch(docId);
    const movie = detailState.movie;
    const count =
      movie && typeof movie.watchCount === "number" ? movie.watchCount : 0;
    if (count < MAX_WATCH_COUNT) applyLocalWatchCount(count + 1);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    showDetailError(describeDetailError(error));
  } finally {
    setDetailBusy(false);
  }
}

/**
 * «−1»: resta un visionado (ALG-M03, AC-M10).
 */
async function handleDetailWatchDec() {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  setDetailBusy(true);
  try {
    await unwatch(docId);
    const movie = detailState.movie;
    const count =
      movie && typeof movie.watchCount === "number" ? movie.watchCount : 0;
    if (count > 0) applyLocalWatchCount(count - 1);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    showDetailError(describeDetailError(error));
  } finally {
    setDetailBusy(false);
  }
}

/**
 * Edición manual del número de visionados (ALG-M03).
 */
async function handleDetailWatchInputChange() {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  const input = dom?.detail?.watchInput;
  const raw = input?.value?.trim() ?? "";

  if (raw === "") {
    renderDetailTracking(detailState.movie ?? {});
    return;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_WATCH_COUNT) {
    showDetailError(WATCH_COUNT_ERROR_MESSAGE);
    renderDetailTracking(detailState.movie ?? {});
    return;
  }

  setDetailBusy(true);
  try {
    await setWatchCount(docId, parsed);
    applyLocalWatchCount(parsed);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    showDetailError(describeDetailError(error));
  } finally {
    setDetailBusy(false);
  }
}

/**
 * Asigna las colecciones marcadas (guardado inmediato, D-M09,
 * AC-M15).
 */
async function handleDetailCollectionsChange() {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  const container = dom?.detail?.collections;
  const ids = [];
  for (const input of container?.querySelectorAll('input[type="checkbox"]') ??
    []) {
    if (input instanceof HTMLInputElement && input.checked) {
      ids.push(input.value);
    }
  }

  setDetailBusy(true);
  try {
    await setCollections(docId, ids);
    if (detailState.movie) {
      detailState.movie = { ...detailState.movie, collectionIds: ids };
    }
    showDetailStatus("Colecciones actualizadas.");
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    showDetailError(describeDetailError(error));
  } finally {
    setDetailBusy(false);
  }
}

/**
 * «Guardar»: persiste nota, reseña, etiquetas y spoilers (D-M09).
 * La nota se valida con `parseUserRating` (ALG-M04, AC-M12).
 */
async function handleDetailSave() {
  const d = dom?.detail;
  if (!d || !detailState.inLibrary || !detailState.docId) return;

  const raw = readUserRatingInput();

  let userRating = null;
  try {
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
  const tags = parseTagsInput(d.tags instanceof HTMLInputElement ? d.tags.value : "");
  const hasSpoilers = d.spoilers instanceof HTMLInputElement ? d.spoilers.checked : false;

  const current = readPersonalForm();
  const changed =
    current.userRating !== detailState.saved.userRating ||
    current.userReview !== detailState.saved.userReview ||
    current.tags !== detailState.saved.tags ||
    current.hasSpoilers !== detailState.saved.hasSpoilers;

  if (!changed) {
    updateDirtyWarning();
    showDetailStatus("No hay cambios que guardar.");
    return;
  }

  setDetailBusy(true);
  try {
    await updatePersonal(detailState.docId, {
      userRating,
      userReview: review === "" ? null : review,
      tags,
      hasSpoilers,
    });

    detailState.saved = { ...current };
    if (detailState.movie) {
      detailState.movie = {
        ...detailState.movie,
        userRating,
        userReview: review === "" ? null : review,
        tags,
        hasSpoilers,
      };
    }

    renderUserRatingDisplay(userRating);
    updateDirtyWarning();
    showDetailStatus("Cambios guardados.");
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    showDetailError(describeDetailError(error));
  } finally {
    setDetailBusy(false);
  }
}

/**
 * «Actualizar datos»: fuerza la recarga desde TMDB (ALG-M06, AC-M21).
 */
async function handleDetailRefresh() {
  if (detailState.inLibrary && detailState.docId) {
    const ok = await loadLibraryDetail(detailState.docId, true);
    if (ok) showDetailStatus("Datos actualizados.");
    return;
  }

  if (detailState.tmdbId) {
    await loadCatalogDetail(detailState.tmdbId);
  }
}

/**
 * «Eliminar»: borra la película tras confirmar (AC-M27).
 */
async function handleDetailDelete() {
  const docId = detailState.docId;
  if (!docId || !detailState.inLibrary) return;

  const confirmed = window.confirm(DELETE_CONFIRM_MESSAGE);
  if (!confirmed) return;

  setDetailBusy(true);
  try {
    await deleteMovie(docId);
    closeMovieDetail();
  } catch (error) {
    showDetailError(describeDetailError(error));
  } finally {
    setDetailBusy(false);
  }
}

/**
 * «Mostrar reseña»: revela el texto con spoilers (AC-M13).
 */
function onDetailSpoilerReveal() {
  detailState.spoilerRevealed = true;
  renderSpoilerState();
  dom?.detail?.review?.focus?.();
}

/**
 * Cualquier cambio en la parte personal actualiza el aviso de cambios
 * pendientes y el estado de spoilers (D-M09).
 */
function onDetailPersonalInput() {
  renderSpoilerState();
  updateDirtyWarning();
}

// -------------------------------------------------------------
// Alta manual (UI-M08, AC-M08)
// -------------------------------------------------------------

/**
 * «Añadir manualmente»: muestra u oculta el formulario de alta manual
 * (UI-M08). El alta sigue operativa aunque TMDB no esté disponible
 * (AC-M01, AC-M06).
 */
function onManualOpen() {
  const form = dom?.manual?.form;
  if (!form) return;

  setManualFormVisible(form.hidden);
}

/**
 * Rellena el multi-select de géneros con el diccionario estático
 * (D-M08).
 */
function populateManualGenres() {
  const select = dom?.manual?.genres;
  if (!(select instanceof HTMLSelectElement)) return;

  clearNode(select);
  for (const genre of TMDB_GENRE_OPTIONS) {
    const option = document.createElement("option");
    option.value = String(genre.id);
    option.textContent = genre.label;
    select.append(option);
  }
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
  if (visible) dom?.manual?.title?.focus?.();
}

/**
 * Lee un entero opcional de un input. Devuelve `null` si está vacío y
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
      const label = TMDB_GENRES_ES[id];
      if (label) genres.push(label);
    }
  }

  return { genreIds, genres };
}

/**
 * Alta manual de una película (UI-M08, AC-M08). No hace ninguna
 * llamada a TMDB.
 */
async function handleManualSubmit(event) {
  event.preventDefault();

  const manual = dom?.manual ?? {};

  const title = manual.title?.value?.trim() ?? "";
  if (title === "") {
    setMessage(manual.error, MANUAL_TITLE_ERROR);
    manual.title?.focus?.();
    return;
  }

  const year = readOptionalInteger(manual.year, MANUAL_MIN_YEAR, MANUAL_MAX_YEAR);
  if (year === undefined) {
    setMessage(manual.error, MANUAL_YEAR_ERROR);
    manual.year?.focus?.();
    return;
  }

  const runtime = readOptionalInteger(
    manual.runtime,
    MANUAL_MIN_RUNTIME,
    MANUAL_MAX_RUNTIME
  );
  if (runtime === undefined) {
    setMessage(manual.error, MANUAL_RUNTIME_ERROR);
    manual.runtime?.focus?.();
    return;
  }

  const overview = manual.overview?.value?.trim() ?? "";
  const { genreIds, genres } = readManualGenres();

  try {
    await addManual({
      title,
      releaseYear: year ?? null,
      runtime: runtime ?? null,
      overview: overview === "" ? null : overview,
      genres,
      genreIds,
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
    node.className = "movies-message";
    node.setAttribute("role", "status");
    manualStatusNode = node;
    form.insertAdjacentElement("afterend", node);
  }

  setMessage(manualStatusNode, message);
}

// -------------------------------------------------------------
// «Mis colecciones» (UI-M07, DB-M02)
// -------------------------------------------------------------

/**
 * Crea (una sola vez) el nodo de error del formulario de colecciones.
 * Los errores se anuncian con `role="alert"` (UI-M10).
 *
 * @returns {HTMLElement|null}
 */
function ensureCollectionErrorNode() {
  if (collectionErrorNode && collectionErrorNode.isConnected) {
    return collectionErrorNode;
  }

  const form = dom?.collections?.form;
  if (!form) return null;

  const node = document.createElement("p");
  node.className = "movies-message movies-message--error";
  node.setAttribute("role", "alert");
  node.hidden = true;

  form.insertAdjacentElement("afterend", node);

  collectionErrorNode = node;
  return node;
}

/**
 * Crea (una sola vez) el nodo de aviso del formulario de colecciones.
 * Los avisos se anuncian con `role="status"` (UI-M10).
 *
 * @returns {HTMLElement|null}
 */
function ensureCollectionStatusNode() {
  if (collectionStatusNode && collectionStatusNode.isConnected) {
    return collectionStatusNode;
  }

  const form = dom?.collections?.form;
  if (!form) return null;

  const node = document.createElement("p");
  node.className = "movies-message";
  node.setAttribute("role", "status");
  node.hidden = true;

  const anchor = collectionErrorNode?.isConnected ? collectionErrorNode : form;
  anchor.insertAdjacentElement("afterend", node);

  collectionStatusNode = node;
  return node;
}

/**
 * Crea (una sola vez) el botón «Cancelar» del formulario de
 * colecciones. Solo se muestra en modo «editar» (UI-M07).
 *
 * @returns {HTMLElement|null}
 */
function ensureCollectionCancelButton() {
  if (collectionCancelButton && collectionCancelButton.isConnected) {
    return collectionCancelButton;
  }

  const submit = dom?.collections?.submit;
  const form = dom?.collections?.form;
  if (!submit || !form) return null;

  const button = document.createElement("button");
  button.className = "btn btn--secondary";
  button.type = "button";
  button.textContent = "Cancelar";
  button.hidden = true;

  submit.insertAdjacentElement("afterend", button);

  collectionCancelButton = button;
  return button;
}

/**
 * Escribe un error en el nodo de error del formulario (creándolo si
 * hace falta).
 *
 * @param {string} message
 */
function showCollectionError(message) {
  const node = ensureCollectionErrorNode();
  if (node) setMessage(node, message);
}

/**
 * Escribe un aviso en el nodo de aviso del formulario (creándolo si
 * hace falta).
 *
 * @param {string} message
 */
function showCollectionStatus(message) {
  const node = ensureCollectionStatusNode();
  if (node) setMessage(node, message);
}

/**
 * Cambia el formulario entre los modos «crear» y «editar»: cambia el
 * título, la etiqueta del botón de envío y muestra u oculta el botón
 * «Cancelar» (UI-M07).
 *
 * @param {"create"|"edit"} mode
 */
function setCollectionFormMode(mode) {
  collectionFormMode = mode === "edit" ? "edit" : "create";

  const form = dom?.collections?.form;
  if (form) {
    const title =
      form.querySelector(".movies-panel__subtitle") ?? form.querySelector("h3");
    if (title) {
      title.textContent =
        collectionFormMode === "edit"
          ? COLLECTION_FORM_EDIT_TITLE
          : COLLECTION_FORM_CREATE_TITLE;
    }
  }

  const submit = dom?.collections?.submit;
  if (submit) {
    submit.textContent =
      collectionFormMode === "edit"
        ? COLLECTION_SUBMIT_EDIT_LABEL
        : COLLECTION_SUBMIT_CREATE_LABEL;
  }

  const cancel = ensureCollectionCancelButton();
  if (cancel) cancel.hidden = collectionFormMode !== "edit";
}

/**
 * Vacía el formulario y vuelve al modo «crear» (UI-M07).
 */
function resetCollectionForm() {
  collectionEditingId = null;

  const form = dom?.collections?.form;
  if (form instanceof HTMLFormElement) form.reset();

  const name = dom?.collections?.name;
  if (name instanceof HTMLInputElement) {
    name.value = "";
    name.setAttribute("aria-invalid", "false");
  }

  const description = dom?.collections?.description;
  if (description instanceof HTMLTextAreaElement) description.value = "";

  setCollectionFormMode("create");

  if (collectionErrorNode) setMessage(collectionErrorNode, "");
  if (collectionStatusNode) setMessage(collectionStatusNode, "");
}

/**
 * Lee los valores del formulario de colecciones (sin validar).
 *
 * @returns {{ name: string, description: string }}
 */
function readCollectionForm() {
  const name = dom?.collections?.name;
  const description = dom?.collections?.description;

  return {
    name: typeof name?.value === "string" ? name.value.trim() : "",
    description:
      typeof description?.value === "string" ? description.value.trim() : "",
  };
}

/**
 * Valida los valores del formulario de colecciones (DB-M02): el
 * nombre es obligatorio (1–60 caracteres) y la descripción no puede
 * superar los 300 caracteres.
 *
 * @param {{ name: string, description: string }} values
 * @returns {{ valid: boolean, error: string }}
 */
function validateCollectionForm(values) {
  const name = typeof values?.name === "string" ? values.name : "";
  const description =
    typeof values?.description === "string" ? values.description : "";

  if (name === "") {
    return { valid: false, error: COLLECTION_NAME_REQUIRED_MESSAGE };
  }

  if (name.length > COLLECTION_NAME_MAX) {
    return { valid: false, error: COLLECTION_NAME_TOO_LONG_MESSAGE };
  }

  if (description.length > COLLECTION_DESCRIPTION_MAX) {
    return { valid: false, error: COLLECTION_DESCRIPTION_TOO_LONG_MESSAGE };
  }

  return { valid: true, error: "" };
}

/**
 * Recuento de películas de una colección. Se calcula en cliente a partir
 * de `collectionIds` de cada película de la biblioteca (DB-M02,
 * AC-M15, AC-M16).
 *
 * @param {string} collectionId
 * @param {Array<Record<string, unknown>>} [movies]
 * @returns {number}
 */
function countCollectionMovies(collectionId, movies = state.library) {
  const id = String(collectionId ?? "");
  if (id === "") return 0;

  let count = 0;

  for (const movie of Array.isArray(movies) ? movies : []) {
    const ids = Array.isArray(movie?.collectionIds) ? movie.collectionIds : [];
    if (ids.some((value) => String(value) === id)) count += 1;
  }

  return count;
}

/**
 * Texto del recuento («2 películas», «1 película»).
 *
 * @param {number} count
 * @returns {string}
 */
function formatCollectionCount(count) {
  const total = formatInteger(count) ?? "0";
  return `${total} ${count === 1 ? "película" : "películas"}`;
}

/**
 * Actualiza el recuento de películas de cada colección pintada. Se llama
 * cuando llega la biblioteca completa, que es la fuente de los
 * `collectionIds` (DB-M02).
 */
function updateCollectionCounts() {
  const list = dom?.collections?.list;
  if (!list) return;

  for (const node of list.querySelectorAll('[data-movie-role="collection-item"]')) {
    if (!(node instanceof HTMLElement)) continue;

    const countNode = node.querySelector('[data-movie-role="collection-count"]');
    if (!countNode) continue;

    countNode.textContent = formatCollectionCount(
      countCollectionMovies(node.dataset.collectionId ?? "")
    );
  }
}

/**
 * Crea el elemento de una colección clonando la plantilla de
 * `index.html`. Cada instancia recibe ids únicos (UI-M07).
 *
 * @param {Record<string, unknown>} collection
 * @returns {HTMLElement|null}
 */
function createCollectionItem(collection) {
  const template = dom?.templates?.collection;
  if (!template || !template.content) return null;

  const id = String(collection?.id ?? "");
  if (id === "") return null;

  const fragment = template.content.cloneNode(true);
  const item = fragment.querySelector('[data-movie-role="collection-item"]');
  if (!(item instanceof HTMLElement)) return null;

  const key = safeIdPart(id);
  const name = String(collection?.name ?? "");

  item.id = `movies-collection-item-${key}`;
  item.dataset.collectionId = id;

  const nameNode = item.querySelector('[data-movie-role="collection-name"]');
  if (nameNode) nameNode.textContent = name;

  const descriptionNode = item.querySelector(
    '[data-movie-role="collection-description"]'
  );
  if (descriptionNode) {
    const text =
      typeof collection?.description === "string" ? collection.description : "";
    descriptionNode.textContent = text;
    descriptionNode.hidden = text === "";
  }

  const countNode = item.querySelector('[data-movie-role="collection-count"]');
  if (countNode) {
    countNode.textContent = formatCollectionCount(
      countCollectionMovies(id)
    );
  }

  // Los ids de la plantilla se sustituyen por ids únicos: sin ellos
  // se duplicarían en cada colección (UI-M04, UI-M07).
  const openButton = item.querySelector('[data-movie-role="collection-open"]');
  if (openButton instanceof HTMLElement) {
    openButton.id = `movies-collection-open-${key}`;
    openButton.setAttribute("aria-label", `Ver las películas de la colección ${name}`);
  }

  const renameButton = item.querySelector('[data-movie-role="collection-rename"]');
  if (renameButton instanceof HTMLElement) {
    renameButton.id = `movies-collection-rename-${key}`;
    renameButton.setAttribute(
      "aria-label",
      `Renombrar o describir la colección ${name}`
    );
  }

  const deleteButton = item.querySelector('[data-movie-role="collection-delete"]');
  if (deleteButton instanceof HTMLElement) {
    deleteButton.id = `movies-collection-delete-${key}`;
    deleteButton.setAttribute("aria-label", `Eliminar la colección ${name}`);
  }

  return item;
}

/**
 * Pinta la lista de colecciones (UI-M07). Si el foco estaba en una
 * acción de una colección, se devuelve al botón equivalente tras el
 * repintado (UI-M10).
 */
function renderCollections() {
  const list = dom?.collections?.list;
  if (!list) return;

  // Se memoriza el foco antes de repintar la lista.
  const active =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const activeItem = active?.closest?.('[data-movie-role="collection-item"]');
  const focusedCollectionId =
    activeItem instanceof HTMLElement ? activeItem.dataset.collectionId ?? "" : "";
  const focusedRole = active?.dataset?.movieRole ?? "";

  clearNode(list);

  const collections = state.collections;
  const fragment = document.createDocumentFragment();

  for (const collection of collections) {
    const item = createCollectionItem(collection);
    if (item) fragment.append(item);
  }

  list.append(fragment);

  // Estado vacío en español (UI-M07).
  const empty = dom?.collections?.empty;
  if (empty) {
    empty.textContent = COLLECTIONS_EMPTY_MESSAGE;
    empty.hidden = collections.length > 0;
  }

  updateCollectionCounts();

  // El foco vuelve al botón equivalente; si la colección ya no existe,
  // se deja en la lista para no perder el hilo (UI-M10).
  if (focusedCollectionId === "" || focusedRole === "") return;

  for (const node of list.querySelectorAll(
    '[data-movie-role="collection-item"]'
  )) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.dataset.collectionId !== focusedCollectionId) continue;

    const target = node.querySelector(`[data-movie-role="${focusedRole}"]`);
    if (target instanceof HTMLElement) {
      target.focus();
      return;
    }
  }

  if (!list.hasAttribute("tabindex")) list.setAttribute("tabindex", "-1");
  list.focus();
}

/**
 * Envía el formulario de colecciones: crea una colección nueva o
 * guarda los cambios de la que se está editando (UI-M07, DB-M02).
 *
 * @param {SubmitEvent} event
 */
async function handleCollectionsSubmit(event) {
  event.preventDefault();

  const values = readCollectionForm();
  const validation = validateCollectionForm(values);

  const nameInput = dom?.collections?.name;

  if (!validation.valid) {
    if (nameInput instanceof HTMLElement) {
      nameInput.setAttribute("aria-invalid", "true");
    }
    showCollectionError(validation.error);
    if (collectionStatusNode) setMessage(collectionStatusNode, "");
    nameInput?.focus?.();
    return;
  }

  if (nameInput instanceof HTMLElement) {
    nameInput.setAttribute("aria-invalid", "false");
  }
  if (collectionErrorNode) setMessage(collectionErrorNode, "");

  const submit = dom?.collections?.submit;
  if (submit instanceof HTMLButtonElement) submit.disabled = true;

  const description = values.description === "" ? null : values.description;
  const editing = collectionFormMode === "edit" && collectionEditingId !== null;

  try {
    if (editing) {
      await updateCollection(collectionEditingId, {
        name: values.name,
        description,
      });
    } else {
      await createCollection({ name: values.name, description });
    }

    resetCollectionForm();
    showCollectionStatus(
      editing ? "Colección actualizada." : "Colección creada."
    );
  } catch (error) {
    showCollectionError(describeRepositoryError(error));
  } finally {
    if (submit instanceof HTMLButtonElement) submit.disabled = false;
  }
}

/**
 * «Renombrar»: pasa el formulario al modo «editar» con los datos de
 * la colección (UI-M07).
 *
 * @param {string} collectionId
 */
function handleCollectionRename(collectionId) {
  const id = String(collectionId ?? "");
  if (id === "") return;

  const collection = state.collections.find(
    (item) => String(item?.id) === id
  );
  if (!collection) return;

  collectionEditingId = id;

  const nameInput = dom?.collections?.name;
  if (nameInput instanceof HTMLInputElement) {
    nameInput.value = String(collection.name ?? "");
    nameInput.setAttribute("aria-invalid", "false");
  }

  const descriptionInput = dom?.collections?.description;
  if (descriptionInput instanceof HTMLTextAreaElement) {
    descriptionInput.value =
      typeof collection.description === "string" ? collection.description : "";
  }

  setCollectionFormMode("edit");
  if (collectionErrorNode) setMessage(collectionErrorNode, "");

  showCollectionStatus(
    `Editando «${String(collection.name ?? "")}». Guarda los cambios o cancela.`
  );

  nameInput?.focus?.();
}

/**
 * «Eliminar»: borra la colección tras confirmar. El repositorio
 * quita su id de `collectionIds` en las películas afectadas (DB-M02,
 * AC-M16).
 *
 * @param {string} collectionId
 */
async function handleCollectionDelete(collectionId) {
  const id = String(collectionId ?? "");
  if (id === "") return;

  const collection = state.collections.find(
    (item) => String(item?.id) === id
  );
  const name = collection ? String(collection.name ?? "") : "";

  const confirmed = window.confirm(
    `¿Eliminar la colección «${name}»? Las películas de tu biblioteca dejarán de pertenecer a ella.`
  );
  if (!confirmed) return;

  try {
    await deleteCollection(id);

    if (collectionEditingId === id) resetCollectionForm();

    showCollectionStatus("Colección eliminada.");
    if (collectionErrorNode) setMessage(collectionErrorNode, "");
  } catch (error) {
    showCollectionError(describeRepositoryError(error));
  }
}

/**
 * «Ver películas»: filtra la biblioteca por la colección y abre la
 * pestaña «Mi biblioteca» (UI-M07, AC-M15).
 *
 * @param {string} collectionId
 */
function handleCollectionOpen(collectionId) {
  const id = String(collectionId ?? "");
  if (id === "") return;

  const select = dom?.library?.collection;
  if (select instanceof HTMLSelectElement) {
    const exists = Array.from(select.options).some(
      (option) => option.value === id
    );

    if (!exists) {
      const collection = state.collections.find(
        (item) => String(item?.id) === id
      );
      const option = document.createElement("option");
      option.value = id;
      option.textContent = collection ? String(collection.name ?? "") : id;
      select.append(option);
    }

    select.value = id;
  }

  applyLibraryFilters();
  activateTab("library");
}

/**
 * «Cancelar»: descarta la edición en curso y vuelve al modo
 * «crear» (UI-M07).
 */
function handleCollectionCancel() {
  resetCollectionForm();
  dom?.collections?.name?.focus?.();
}

// -------------------------------------------------------------
// Montaje
// -------------------------------------------------------------

/**
 * Registra el abridor de la ficha (UI-M06, T-M09).
 *
 * @param {((model: CardModel) => void)|null} opener
 */
export function setMovieDetailOpener(opener) {
  detailOpener = typeof opener === "function" ? opener : null;
}

/**
 * Monta la sección de películas: pestañas, estadísticas, catálogo con
 * buscador instantáneo, tarjetas y biblioteca.
 *
 * Es idempotente: si la sección ya está montada devuelve el mismo
 * controlador.
 *
 * @param {{ onOpenMovie?: (model: CardModel) => void }} [options]
 * @returns {{ destroy: () => void, state: MoviesViewState }}
 */
export function mountMovies(options = {}) {
  if (activeController) return activeController;

  dom = collectDom();
  if (!dom.section) {
    throw new Error("No se encontró la sección de películas (#movies-section).");
  }

  state = createViewState();
  catalogAddButtons.clear();
  catalogListEmptyNodes.clear();
  tabListeners.clear();
  // Se limpian las rejillas por si quedaran tarjetas de un montaje
  // anterior.
  clearAllGrids();
  moviesUnsubscribe = null;
  statsUnsubscribe = null;
  collectionsUnsubscribe = null;
  serverFiltersSignature = "";
  searchTimer = null;
  librarySearchTimer = null;
  searchToken = 0;
  libraryLoadError = "";
  detailState = createDetailState();
  detailHintNode = null;
  detailErrorNode = null;
  detailStatusNode = null;
  manualStatusNode = null;
  userRatingTracker = null;
  collectionFormMode = "create";
  collectionEditingId = null;
  collectionCancelButton = null;
  collectionErrorNode = null;
  collectionStatusNode = null;

  if (typeof options?.onOpenMovie === "function") {
    detailOpener = options.onOpenMovie;
  }

  // --- Pestañas (UI-M01) ------------------------------------------
  for (const tab of MOVIE_TABS) {
    const button = dom.tabs[tab.key];
    if (!button) continue;

    // Escuchas con nombre para poder retirarlas en `unmountMovies`.
    const onClick = () => activateTab(tab.key);
    const onKeyDown = (event) => onTabKeydown(event, tab.key);

    button.addEventListener("click", onClick);
    button.addEventListener("keydown", onKeyDown);
    tabListeners.set(tab.key, { click: onClick, keydown: onKeyDown });
  }

  // --- Catálogo (UI-M03) -----------------------------------------
  dom.catalog.search?.addEventListener("input", onCatalogSearchInput);
  dom.catalog.search?.addEventListener("search", onCatalogSearchInput);

  // --- Tarjetas (UI-M04) -----------------------------------------
  dom.section.addEventListener("click", onSectionClick);

  // --- Biblioteca (UI-M05) ----------------------------------------
  // Los selectores de estado y de orden se rellenan desde
  // `moviesState.js` para que las opciones y las etiquetas no se
  // dupliquen en la vista.
  populateStatusFilter();
  populateGenreFilter();
  populateSortFilter();

  // El contador y los estados vacíos se anuncian a los lectores de
  // pantalla al cambiar.
  dom.library.count?.setAttribute("aria-live", "polite");
  dom.library.empty?.setAttribute("role", "status");

  dom.library.search?.addEventListener("input", onLibrarySearchInput);
  dom.library.search?.addEventListener("search", onLibrarySearchInput);
  dom.library.status?.addEventListener("change", applyLibraryFilters);
  dom.library.genre?.addEventListener("change", applyLibraryFilters);
  dom.library.collection?.addEventListener("change", applyLibraryFilters);
  dom.library.ratingMin?.addEventListener("change", applyLibraryFilters);
  dom.library.ratingMax?.addEventListener("change", applyLibraryFilters);
  dom.library.sort?.addEventListener("change", applyLibraryFilters);
  dom.library.clear?.addEventListener("click", clearLibraryFilters);

  // --- Ficha de película (UI-M06) ---------------------------------
  // Los nodos auxiliares (aviso, error y estado) se crean una sola
  // vez por montaje y se retiran al desmontar.
  ensureDetailHintNode();

  // Copia literal del texto del campo de nota: permite leer «7,5»
  // aunque el navegador rechace la coma decimal (ALG-M04, AC-M12).
  userRatingTracker = createRawTextTracker(dom.detail?.userRating ?? null);

  // Cierre del diálogo (botón «Cerrar» y ESC): descarta los cambios
  // pendientes y devuelve el foco al disparador (UI-M10, AC-M26).
  dom.detail?.dialog?.addEventListener("close", onDetailDialogClose);
  dom.detail?.close?.addEventListener("click", closeMovieDetail);

  // Seguimiento: estado, favorito y visionados se guardan de
  // inmediato (D-M09, ALG-M03).
  dom.detail?.status?.addEventListener("change", handleDetailStatusChange);
  dom.detail?.favorite?.addEventListener("click", handleDetailFavoriteToggle);
  dom.detail?.watchInc?.addEventListener("click", handleDetailWatchInc);
  dom.detail?.watchDec?.addEventListener("click", handleDetailWatchDec);
  dom.detail?.watchInput?.addEventListener("change", handleDetailWatchInputChange);

  // Colecciones: se delegan en el contenedor porque los checkboxes se
  // repintan al abrir la ficha (AC-M15).
  dom.detail?.collections?.addEventListener("change", handleDetailCollectionsChange);

  // Parte personal: nota, reseña, etiquetas y spoilers requieren
  // «Guardar» (D-M09, AC-M26).
  dom.detail?.save?.addEventListener("click", handleDetailSave);
  dom.detail?.userRating?.addEventListener("input", onDetailPersonalInput);
  dom.detail?.review?.addEventListener("input", onDetailPersonalInput);
  dom.detail?.tags?.addEventListener("input", onDetailPersonalInput);
  dom.detail?.spoilers?.addEventListener("change", onDetailPersonalInput);

  // «Mostrar reseña» (AC-M13), «Actualizar datos» (ALG-M06) y
  // «Eliminar» (AC-M27).
  dom.detail?.spoilerReveal?.addEventListener("click", onDetailSpoilerReveal);
  dom.detail?.refresh?.addEventListener("click", handleDetailRefresh);
  dom.detail?.remove?.addEventListener("click", handleDetailDelete);

  // --- Alta manual (UI-M08, AC-M08) -------------------------------
  populateManualGenres();
  dom.manual?.open?.addEventListener("click", onManualOpen);
  dom.manual?.form?.addEventListener("submit", handleManualSubmit);

  // --- Colecciones (UI-M07, DB-M02) --------------------------------
  // Los nodos auxiliares (error, aviso y «Cancelar») se crean una sola
  // vez por montaje y se retiran al desmontar.
  ensureCollectionErrorNode();
  ensureCollectionStatusNode();
  const collectionCancel = ensureCollectionCancelButton();

  dom.collections?.form?.addEventListener("submit", handleCollectionsSubmit);
  collectionCancel?.addEventListener("click", handleCollectionCancel);

  // El estado vacío se anuncia a los lectores de pantalla al cambiar.
  dom.collections?.empty?.setAttribute("role", "status");

  setCollectionFormMode("create");

  // --- Estadísticas y datos (UI-M02, ALG-M01) ---------------------
  renderStats([]);
  // La biblioteca se suscribe con los filtros de servidor (ALG-M02);
  // las estadísticas usan la biblioteca completa.
  subscribeLibrarySources();
  subscribeLibraryData(readServerFilters());

  // --- Estado inicial ---------------------------------------------
  activateTab(state.activeTab);

  const controller = {
    state,
    destroy: () => unmountMovies(),
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
export function unmountMovies() {
  if (!activeController) return;

  // Bajas de las suscripciones: biblioteca filtrada, biblioteca
  // completa (estadísticas) y colecciones.
  for (const unsubscribe of [
    moviesUnsubscribe,
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
  moviesUnsubscribe = null;
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

  // --- Ficha de película (UI-M06) ---------------------------------
  // La ficha se cierra para no dejar un `<dialog>` modal abierto al
  // desmontar la sección. La escucha «close» se retira antes de que
  // se dispare el evento para que no restaure el foco.
  closeMovieDetail();

  dom?.detail?.dialog?.removeEventListener("close", onDetailDialogClose);
  dom?.detail?.close?.removeEventListener("click", closeMovieDetail);
  dom?.detail?.status?.removeEventListener("change", handleDetailStatusChange);
  dom?.detail?.favorite?.removeEventListener("click", handleDetailFavoriteToggle);
  dom?.detail?.watchInc?.removeEventListener("click", handleDetailWatchInc);
  dom?.detail?.watchDec?.removeEventListener("click", handleDetailWatchDec);
  dom?.detail?.watchInput?.removeEventListener("change", handleDetailWatchInputChange);
  dom?.detail?.collections?.removeEventListener("change", handleDetailCollectionsChange);
  dom?.detail?.save?.removeEventListener("click", handleDetailSave);
  dom?.detail?.userRating?.removeEventListener("input", onDetailPersonalInput);
  dom?.detail?.review?.removeEventListener("input", onDetailPersonalInput);
  dom?.detail?.tags?.removeEventListener("input", onDetailPersonalInput);
  dom?.detail?.spoilers?.removeEventListener("change", onDetailPersonalInput);
  dom?.detail?.spoilerReveal?.removeEventListener("click", onDetailSpoilerReveal);
  dom?.detail?.refresh?.removeEventListener("click", handleDetailRefresh);
  dom?.detail?.remove?.removeEventListener("click", handleDetailDelete);

  // La copia literal de la nota deja de escuchar el input: el nodo
  // vive en `index.html` y sobrevive al desmontaje.
  userRatingTracker?.destroy?.();
  userRatingTracker = null;

  // --- Alta manual (UI-M08) ---------------------------------------
  dom?.manual?.open?.removeEventListener("click", onManualOpen);
  dom?.manual?.form?.removeEventListener("submit", handleManualSubmit);

  // --- Colecciones (UI-M07) ----------------------------------------
  dom?.collections?.form?.removeEventListener("submit", handleCollectionsSubmit);
  collectionCancelButton?.removeEventListener("click", handleCollectionCancel);

  // Nodos auxiliares creados en tiempo de ejecución: se retiran del
  // DOM para no dejar restos.
  collectionCancelButton?.remove();
  collectionErrorNode?.remove();
  collectionStatusNode?.remove();
  collectionCancelButton = null;
  collectionErrorNode = null;
  collectionStatusNode = null;
  collectionFormMode = "create";
  collectionEditingId = null;

  // Nodos auxiliares creados en tiempo de ejecución: se retiran del
  // DOM para no dejar restos.
  detailHintNode?.remove();
  detailErrorNode?.remove();
  detailStatusNode?.remove();
  manualStatusNode?.remove();
  detailHintNode = null;
  detailErrorNode = null;
  detailStatusNode = null;
  manualStatusNode = null;
  detailState = createDetailState();

  for (const tab of MOVIE_TABS) {
    const button = dom?.tabs?.[tab.key];
    const listeners = tabListeners.get(tab.key);
    if (!button || !listeners) continue;
    button.removeEventListener("click", listeners.click);
    button.removeEventListener("keydown", listeners.keydown);
  }
  tabListeners.clear();

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
  // El abridor de la ficha (UI-M06) lo registrará T-M09 en el
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
 * Estado vivo de la vista (biblioteca, filtros y catálogo). Útil
 * para las tareas T-M09 y T-M10.
 *
 * @returns {MoviesViewState}
 */
export function getMoviesViewState() {
  return state;
}

/**
 * Recalcula la barra de estadísticas con la biblioteca actual.
 *
 * @returns {void}
 */
export function refreshMoviesStats() {
  renderStats(state.library);
}
