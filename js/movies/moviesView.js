// =============================================================
// moviesView.js — Vista de la sección «Películas».
//
// Alcance de esta tarea (T-M07) y de su ampliación (T-M08):
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
//
// Dependencias ya implementadas (se consumen, no se duplican):
//   - `js/movies/moviesState.js` (T-M04): etiquetas de estado,
//     opciones, filtros, orden y `computeStats` (puros).
//   - `js/movies/moviesRepository.js` (T-M03): biblioteca y
//     colecciones en Firestore (sin llamadas a TMDB al renderizar).
//   - `js/movies/tmdbClient.js` (T-M01): único punto de red.
//   - `index.html` (T-M05): esqueleto con los ids estables.
//
// Tareas posteriores que amplían este mismo módulo:
//   - T-M09 (UI-M06, UI-M08): ficha en `<dialog>` y alta manual.
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
  computeStats,
  createLibraryFilters,
  createMoviesState,
  filterMovies,
  hasActiveLibraryFilters,
  sortMovies,
} from "./moviesState.js";

import {
  addFromTmdb,
  setFavorite,
  subscribeCollections,
  subscribeMovies,
} from "./moviesRepository.js";

import {
  fetchPopular,
  fetchTopRated,
  fetchTrendingWeek,
  fetchUpcoming,
  isTmdbConfigured,
  posterUrl,
  searchMovies,
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
    messages: {
      error: byId("movies-error"),
      tmdbWarning: byId("movies-tmdb-warning"),
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
    setMessage(dom?.catalog?.error, describeTmdbError(error));
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
    setMessage(dom?.catalog?.error, TMDB_ERROR_MESSAGES.NO_API_KEY);
    return;
  }

  state.catalog.loading = true;
  try {
    const results = await Promise.all(
      CATALOG_LISTS.map((list) => loadCatalogList(list))
    );
    // Solo se marca como cargado si todas las listas respondieron.
    state.catalog.loaded = results.every((ok) => ok === true);
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
  } catch (error) {
    if (token !== searchToken) return;

    clearNode(grid);
    setVisible(dom?.catalog?.empty, false);
    setMessage(dom?.catalog?.error, describeTmdbError(error));
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
 * colección (UI-M05). El panel «Mis colecciones» es de T-M10.
 *
 * @param {Array<Record<string, unknown>>} collections
 */
function onCollectionsSnapshot(collections) {
  state.collections = Array.isArray(collections) ? collections : [];
  populateCollectionFilter(state.collections);
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
 * Abre la ficha de una película. T-M09 registrará el abridor con
 * `setMovieDetailOpener`; mientras tanto se emite el evento
 * `movies:open-detail` para que la ficha pueda engancharse.
 *
 * @param {CardModel} model
 */
function openMovieDetail(model) {
  if (typeof detailOpener === "function") {
    detailOpener(model);
    return;
  }

  dom?.section?.dispatchEvent(
    new CustomEvent("movies:open-detail", {
      bubbles: true,
      detail: {
        movie: model.raw,
        tmdbId: model.tmdbId,
        docId: model.docId,
        context: model.context,
      },
    })
  );
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
 * Delegación de los clics de las tarjetas.
 *
 * @param {Event} event
 */
function onSectionClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

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
