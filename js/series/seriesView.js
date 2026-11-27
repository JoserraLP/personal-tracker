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
// Tareas siguientes (mismo fichero, en cadena): T-S07 (biblioteca
// con filtros y orden), T-S08 (ficha y alta manual), T-S09
// (bloque de episodios) y T-S10 (colecciones). Por eso el módulo
// deja estos enganches: `setSeriesDetailOpener` para la ficha,
// `getSeriesViewState` para el estado vivo y `refreshSeriesStats`
// para las estadísticas.
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
  STATUS_LABELS,
  computeSeriesStats,
  sortSeries,
} from "./seriesState.js";

import {
  addFromTmdb,
  setEpisodeWatched,
  setFavorite,
  subscribeSeries,
} from "./seriesRepository.js";

import {
  fetchOnTheAir,
  fetchPopularSeries,
  fetchTopRatedSeries,
  fetchTrendingWeek,
  isTmdbConfigured,
  posterUrl,
  searchSeries,
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
 * @property {Array<Record<string, unknown>>} library Biblioteca completa.
 * @property {Map<string, Record<string, unknown>>} libraryByDocId
 * @property {Map<string, Record<string, unknown>>} libraryByTmdbId
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
    libraryByDocId: new Map(),
    libraryByTmdbId: new Map(),
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

/** Suscriptor de la biblioteca: alimenta estadísticas y tarjetas. */
let libraryUnsubscribe = null;

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
// Biblioteca (UI-S04, ALG-S01)
// -------------------------------------------------------------

/**
 * Pinta la biblioteca: las tarjetas del snapshot con el orden por
 * defecto de ALG-S02. T-S07 añadirá los filtros combinables, el
 * buscador y las siete claves de orden sobre este mismo render.
 */
function renderLibrary() {
  const grid = dom?.library?.grid;
  const sorted = sortSeries(state.library, DEFAULT_SORT_KEY);

  renderCards(grid, sorted, "library");

  // Contador «1 serie» / «N series» (UI-S05).
  const count = dom?.library?.count;
  if (count) count.textContent = formatSeriesCount(sorted.length);

  // Estados vacíos en español.
  const empty = dom?.library?.empty;
  if (empty) {
    empty.textContent =
      state.library.length === 0
        ? LIBRARY_EMPTY_MESSAGE
        : LIBRARY_NO_RESULTS_MESSAGE;
    empty.hidden = sorted.length > 0;
  }

  setMessage(dom?.library?.error, libraryLoadError);
}

/**
 * Recibe el snapshot de la biblioteca: alimenta la barra de
 * estadísticas (UI-S02) y las tarjetas de la biblioteca.
 *
 * @param {Array<Record<string, unknown>>} series
 */
function onLibrarySnapshot(series) {
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

  libraryLoadError = "";

  renderStats(list);
  syncCatalogAddButtons();
  renderLibrary();
}

/**
 * Suscribe la biblioteca del usuario. Sin sesión activa se avisa en
 * español y la vista sigue operativa (SEC-S03).
 */
function subscribeLibrary() {
  try {
    libraryUnsubscribe = subscribeSeries({}, onLibrarySnapshot, (error) => {
      libraryLoadError = `No se pudo cargar tu biblioteca de series. ${describeRepositoryError(error)}`;
      renderLibrary();
    });
  } catch (error) {
    libraryLoadError = describeRepositoryError(error);
    setMessage(dom?.messages?.error, libraryLoadError);
    renderLibrary();
  }
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
 * @param {HTMLElement} button
 */
async function handleToggleFavorite(button) {
  const card = button.closest('[data-series-role="card"]');
  const model = card ? cardModels.get(card) : null;
  if (!model || model.context !== "library" || !model.docId) return;

  const docId = model.docId;
  const previous = model.isFavorite;
  const next = !previous;

  // El modelo vivo se actualiza de inmediato: un doble clic antes
  // del snapshot de Firestore alterna sobre el valor real y no sobre
  // el valor obsoleto.
  model.isFavorite = next;

  updateFavoriteButton(button, next);
  applyLibraryFavorite(docId, next);

  try {
    await setFavorite(docId, next);
    setMessage(dom?.messages?.error, "");
  } catch (error) {
    // La reversión actúa sobre la tarjeta viva, no sobre un nodo
    // desconectado por un repintado anterior.
    model.isFavorite = previous;
    applyLibraryFavorite(docId, previous);
    updateFavoriteButton(button, previous);
    setMessage(dom?.messages?.error, describeRepositoryError(error));
  }
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
  state.library = state.library.map((item) =>
    item?.id === docId ? { ...item, isFavorite } : item
  );

  const current = state.libraryByDocId.get(docId);
  if (current) {
    state.libraryByDocId.set(docId, { ...current, isFavorite });
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
  state.libraryByDocId.set(docId, { ...current, ...patch });

  renderStats(state.library);
  renderLibrary();
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
  searchTimer = null;
  searchToken = 0;
  libraryLoadError = "";
  noticeNode = null;

  if (typeof options?.onOpenSeries === "function") {
    detailOpener = options.onOpenSeries;
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

  // --- Biblioteca (UI-S04) ----------------------------------------
  // El contador y el estado vacío se anuncian a los lectores de
  // pantalla al cambiar.
  dom.library.count?.setAttribute("aria-live", "polite");
  dom.library.empty?.setAttribute("role", "status");

  // --- Avisos de la sección (UI-S11) ------------------------------
  ensureNoticeNode();

  // --- Estadísticas y datos (UI-S02, ALG-S01) ---------------------
  renderStats([]);
  subscribeLibrary();

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

  if (typeof libraryUnsubscribe === "function") {
    try {
      libraryUnsubscribe();
    } catch {
      // Una baja fallida no debe impedir el desmontaje.
    }
  }
  libraryUnsubscribe = null;

  if (searchTimer !== null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }

  dom?.section?.removeEventListener("click", onSectionClick);
  dom?.catalog?.search?.removeEventListener("input", onCatalogSearchInput);
  dom?.catalog?.search?.removeEventListener("search", onCatalogSearchInput);

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
