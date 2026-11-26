// =============================================================
// moviesView.js — Vista de la sección «Películas».
//
// Alcance de esta tarea (T-M07):
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
//   - T-M08 (UI-M05): filtros y orden de «Mi biblioteca».
//   - T-M09 (UI-M06, UI-M08): ficha en `<dialog>` y alta manual.
//   - T-M10 (UI-M07): panel «Mis colecciones».
//
// Todos los textos visibles están en español (es-ES) y el fichero va
// en UTF-8 sin BOM (NFR-M03).
// =============================================================

import {
  DEFAULT_SORT_KEY,
  DEFAULT_TAB,
  MOVIE_TABS,
  STATUS_LABELS,
  TMDB_GENRE_OPTIONS,
  computeStats,
  createLibraryFilters,
  createMoviesState,
  filterMovies,
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
 * @property {Array<Record<string, unknown>>} library
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

/** Suscriptores de Firestore activos (para poder cancelarlos). */
let unsubscribers = [];

/** Temporizadores de búsqueda pendientes. */
let searchTimer = null;

/** Token de búsqueda: descarta respuestas obsoletas. */
let searchToken = 0;

/** Temporizador de búsqueda de la biblioteca. */
let librarySearchTimer = null;

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
// Biblioteca (base compartida; T-M08 la completa con UI-M05)
// -------------------------------------------------------------

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

  if (previous) select.value = previous;
}

/**
 * Lee los controles de filtro de la biblioteca y los normaliza con
 * `createLibraryFilters` (T-M04).
 *
 * @returns {ReturnType<typeof createLibraryFilters>}
 */
function readLibraryFilters() {
  const library = dom?.library ?? {};

  return createLibraryFilters({
    query: library.search?.value ?? "",
    status: library.status?.value ?? "",
    genreId: library.genre?.value ? Number(library.genre.value) : null,
    collectionId: library.collection?.value ?? "",
    ratingMin: library.ratingMin?.value ?? null,
    ratingMax: library.ratingMax?.value ?? null,
    sort: library.sort?.value || DEFAULT_SORT_KEY,
  });
}

/**
 * Pinta la biblioteca: filtra en cliente (ALG-M02), ordena en
 * cliente (D-M03) y actualiza el recuento y el estado vacío.
 */
function renderLibrary() {
  const grid = dom?.library?.grid;
  const movies = filterMovies(state.library, state.libraryFilters);
  const sorted = sortMovies(movies, state.libraryFilters.sort);

  renderCards(grid, sorted, "library");

  const count = dom?.library?.count;
  if (count) {
    const total = formatInteger(sorted.length) ?? "0";
    count.textContent = `${total} ${sorted.length === 1 ? "película" : "películas"}`;
  }

  const empty = dom?.library?.empty;
  if (empty) {
    empty.textContent =
      state.library.length === 0
        ? "Tu biblioteca está vacía. Añade películas desde «Explorar catálogo»."
        : "No hay películas que coincidan con los filtros.";
    empty.hidden = sorted.length > 0;
  }
}

/**
 * Aplica los cambios de los controles de la biblioteca.
 */
function applyLibraryFilters() {
  state.libraryFilters = readLibraryFilters();
  renderLibrary();
}

/**
 * Restablece los controles y los filtros de la biblioteca.
 */
function clearLibraryFilters() {
  const library = dom?.library ?? {};

  if (library.search) library.search.value = "";
  if (library.status) library.status.value = "";
  if (library.genre) library.genre.value = "";
  if (library.collection) library.collection.value = "";
  if (library.ratingMin) library.ratingMin.value = "";
  if (library.ratingMax) library.ratingMax.value = "";
  if (library.sort) library.sort.value = DEFAULT_SORT_KEY;

  state.libraryFilters = createLibraryFilters();
  renderLibrary();
}

/**
 * Búsqueda instantánea de la biblioteca (mismo debounce que el
 * catálogo).
 */
function onLibrarySearchInput() {
  if (librarySearchTimer !== null) {
    clearTimeout(librarySearchTimer);
    librarySearchTimer = null;
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
 * Recibe el snapshot de la biblioteca: actualiza los índices, las
 * estadísticas (UI-M02) y la lista de la biblioteca.
 *
 * @param {Array<Record<string, unknown>>} movies
 */
function onLibrarySnapshot(movies) {
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
  renderLibrary();
  syncCatalogAddButtons();
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
 * Suscribe la biblioteca y las colecciones. Sin sesión activa se
 * avisa en español y la vista sigue operativa (SEC-M03).
 */
function subscribeLibraryData() {
  try {
    const unsubscribeMovies = subscribeMovies(onLibrarySnapshot, (error) => {
      setMessage(
        dom?.library?.error,
        `No se pudo cargar tu biblioteca de películas. ${describeRepositoryError(error)}`
      );
    });
    unsubscribers.push(unsubscribeMovies);
  } catch (error) {
    setMessage(dom?.messages?.error, describeRepositoryError(error));
  }

  try {
    const unsubscribeCollections = subscribeCollections(onCollectionsSnapshot, () => {
      // Un fallo en las colecciones no debe romper la biblioteca.
    });
    unsubscribers.push(unsubscribeCollections);
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
 * @param {HTMLElement} button
 */
async function handleToggleFavorite(button) {
  const card = button.closest('[data-movie-role="card"]');
  const model = card ? cardModels.get(card) : null;
  if (!model || model.context !== "library" || !model.docId) return;

  const next = !model.isFavorite;
  updateFavoriteButton(button, next);

  try {
    await setFavorite(model.docId, next);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    updateFavoriteButton(button, model.isFavorite);
    setMessage(dom?.messages?.error, describeRepositoryError(error));
  }
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
  unsubscribers = [];
  searchTimer = null;
  librarySearchTimer = null;
  searchToken = 0;

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

  // --- Biblioteca (base compartida con T-M08) ---------------------
  populateGenreFilter();
  dom.library.search?.addEventListener("input", onLibrarySearchInput);
  dom.library.status?.addEventListener("change", applyLibraryFilters);
  dom.library.genre?.addEventListener("change", applyLibraryFilters);
  dom.library.collection?.addEventListener("change", applyLibraryFilters);
  dom.library.ratingMin?.addEventListener("change", applyLibraryFilters);
  dom.library.ratingMax?.addEventListener("change", applyLibraryFilters);
  dom.library.sort?.addEventListener("change", applyLibraryFilters);
  dom.library.clear?.addEventListener("click", clearLibraryFilters);

  // --- Estadísticas y datos (UI-M02, ALG-M01) ---------------------
  renderStats([]);
  subscribeLibraryData();

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

  for (const unsubscribe of unsubscribers) {
    try {
      unsubscribe();
    } catch {
      // Una baja fallida no debe impedir el desmontaje.
    }
  }
  unsubscribers = [];

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
