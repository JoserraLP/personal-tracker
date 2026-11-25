// =============================================================
// app.js — spec 001 (puerta de login) + spec 002 (catálogo).
//
// Spec 001: máquina de estados loading → { login | allowed | denied }.
//           Persistencia de denied, botones Entrar/Salir/Volver.
// Spec 002: pestañas por tipo, lista de tarjetas, filtro/orden en
//           cliente, cambio de estado y borrado.
// T-112: orquestación de las 6 vistas de la serie 00-05 desde el nav
//        principal (00 §2, 02 UI-02/03, 04 UI-20, 05 UI-30).
//        Todos los textos de UI están en español (REQ-C5).
// T-115: vista de Búsqueda (02 UI-03, REQ-102): input con debounce
//        de 300 ms, grid de `MediaCard` y estado vacío «Sin
//        resultados» (AC-112, AC-113).
// =============================================================

import { login, logout, watchAuthState } from "./firebase.js";
import { isEmailAllowed } from "./allowed-emails.js";
import {
  MEDIA_TYPES,
  ITEM_STATUSES,
  STATUS_LABELS,
  subscribeItems,
  createItem,
  updateItem,
  getItem,
  validateItem,
  normalizeItem,
  nextEpisodeLabel,
  sortSessionsByDateDesc,
  addItemSession,
  updateItemSession,
  removeItemSession,
  computeDashboardStats,
  validateMetadata,
  normalizeMetadata,
  isMetadataFresh,
  updateItemMetadata,
  METADATA_SOURCES,
  // Traducción legacy (minúsculas) → `MediaType` del modelo 00-05
  // (REQ-C6). La usa `mediaTypeLabel()`.
  legacyMediaTypeToMediaItemType,
  // Spec 02 — REQ-102: normalización del título para la búsqueda por
  // prefijo (DB-121, AC-112).
  normalizeTitle,
  // Spec 02 — DB-120: validador del alta manual (UI-04, AC-118).
  validateMediaItem,
  // Spec 004 — Favoritos y colecciones
  setItemFavorite,
  toggleItemFavorite,
  CHAPTER_PARENT_MEDIA_TYPES,
  validateFavoriteChapter,
  normalizeFavoriteChapter,
  subscribeChapters,
  listChapters,
  createChapter,
  updateChapter,
  deleteChapter,
  validateCollection,
  normalizeCollection,
  subscribeCollections,
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  addTargetToCollection,
  removeTargetFromCollection,
  computeFavoritesStats,
  MAX_COLLECTIONS_PER_TARGET,
  RECENT_FAVORITES_LIMIT,
} from "./catalog.js";
import { searchTmdbMovies, searchTmdbTv, searchTmdbAnime, fetchTmdbMovieMetadata, fetchTmdbTvMetadata, fetchTmdbMetadata } from "./api-tmdb.js";
import { searchIgdbGames, fetchIgdbGameMetadata } from "./api-games.js";
import { searchGoogleBooks, fetchGoogleBookMetadata } from "./api-books.js";
// T-116 — Puente PURO de normalización (REQ-108, REQ-E4): reutiliza
// los normalizadores de `js/api-normalize.js` (importable sin red) en
// lugar de duplicarlos aquí.
import {
  normalizeManualMediaItem,
  normalizeApiItems,
  normalizeApiFailure,
  buildMediaMetadata,
} from "./api-normalize.js";
// T-116 — Biblioteca de Steam (REQ-108: IGDB/Steam).
import { fetchOwnedSteamGames } from "./api-steam.js";
// T-114 — Vista de catálogo del modelo 00-05: `MediaCard` (componente
// único, AC-116) y `CatalogRepository` (paginación por cursor, REQ-101).
import {
  MEDIA_TYPES as CATALOG_MEDIA_TYPES,
  MEDIA_TYPE_LABELS as CATALOG_MEDIA_TYPE_LABELS,
  createMediaCard,
  mountMediaCards,
} from "./ui/media-card.js";
import {
  catalogRepository,
  DEFAULT_PAGE_SIZE as CATALOG_PAGE_SIZE,
  DEFAULT_CATALOG_SORT,
} from "./repositories/catalog-repository.js";

// =============================================================
// Spec 001 — Puerta de login (INTACTA)
// =============================================================

const views = {
  loading: document.getElementById("view-loading"),
  login: document.getElementById("view-login"),
  allowed: document.getElementById("view-allowed"),
  denied: document.getElementById("view-denied"),
};

const loginError = document.getElementById("login-error");
const btnLogin = document.getElementById("btn-login");
const btnLogout = document.getElementById("btn-logout");
const btnBack = document.getElementById("btn-back");

// True tras rechazar un correo: la vista `denied` persiste aunque
// el logout() automático dispare watchAuthState con null (esc. 3).
let deniedAccess = false;

// =============================================================
// T-112 — Navegación principal (00 §2, 02 UI-02/03, 04 UI-20,
// 05 UI-30, REQ-C5)
//
// `index.html` es el app shell y `js/app.js` orquesta las vistas
// (00 §2). El nav principal expone las 6 vistas de la serie 00-05:
// Catálogo, Búsqueda, Perfil, Colecciones, Dashboard y
// Recomendaciones. Cada pestaña del nav tiene su propio contenedor
// (`#view-*` en index.html). Las pestañas cuya vista todavía no tiene
// contenido propio (Búsqueda → 02 UI-03 y Recomendaciones → 05 UI-30)
// quedan `aria-disabled="true"` y no navegan.
// =============================================================

/** Claves de las vistas de la app, en el orden del nav (REQ-C5). */
const APP_VIEW_KEYS = Object.freeze([
  "catalog",
  "search",
  "profile",
  "collections",
  "dashboard",
  "recommendations",
]);

/**
 * Vistas sin contenido propio implementado todavía: Recomendaciones
 * (05 UI-30, T-120). Su pestaña permanece `aria-disabled="true"`.
 * Búsqueda (02 UI-03) ya tiene vista propia desde T-115.
 */
const APP_VIEW_PENDING = Object.freeze(["recommendations"]);

/** Vista inicial del nav: Dashboard (spec 003, AC-001). */
const DEFAULT_APP_VIEW = "dashboard";

/** Contenedores de las vistas (uno por pestaña del nav). */
const appViews = {
  catalog: document.getElementById("view-catalog"),
  search: document.getElementById("view-search"),
  profile: document.getElementById("view-profile"),
  collections: document.getElementById("view-collections"),
  dashboard: document.getElementById("view-dashboard"),
  recommendations: document.getElementById("view-recommendations"),
};

/** Contenedor del nav principal (`role="tablist"`). */
const navTabsContainer = document.getElementById("app-nav-tabs");

/** Vista del nav activa. */
let activeAppView = DEFAULT_APP_VIEW;

/** ¿La vista tiene contenedor y contenido propio disponible? */
function isAppViewAvailable(key) {
  return Boolean(appViews[key]) && !APP_VIEW_PENDING.includes(key);
}

/**
 * Muestra una vista de la app: oculta el resto de contenedores,
 * sincroniza el ARIA del nav y carga el contenido de la vista.
 * @param {string} key Clave de `APP_VIEW_KEYS`.
 * @returns {boolean} `true` si la vista existe y se ha mostrado.
 */
function showAppView(key) {
  if (!APP_VIEW_KEYS.includes(key) || !appViews[key]) return false;

  activeAppView = key;
  Object.entries(appViews).forEach(([viewKey, element]) => {
    if (element) element.hidden = viewKey !== key;
  });

  syncNavTabs();
  activateAppViewContent(key);
  return true;
}

/**
 * Carga y muestra el contenido que corresponde a la vista activa.
 * Cada vista cancela las suscripciones de las demás para no dejar
 * listeners huérfanos (mismo criterio que las pestañas del catálogo).
 */
function activateAppViewContent(key) {
  hideAllPanels();

  switch (key) {
    case "catalog":
      // T-114: la vista de catálogo lee la colección `catalog` con
      // cursor (UNA lectura por página, AC-111) y pinta `MediaCard`.
      mountCatalogView();
      dashboardUnsubscribeAll();
      favoritesUnsubscribeAll();
      collectionsUnsubscribeAll();
      void loadCatalogPage({ append: false });
      break;
    case "search":
      // T-115: búsqueda por prefijo del título normalizado (REQ-102).
      // Debounce de 300 ms en el input y grid de `MediaCard`.
      mountSearchView();
      dashboardUnsubscribeAll();
      favoritesUnsubscribeAll();
      collectionsUnsubscribeAll();
      if (searchView.term !== "") {
        void runSearch({ append: false });
      } else {
        renderSearchState();
      }
      break;
    case "profile":
      showPanel("favorites-panel");
      dashboardUnsubscribeAll();
      collectionsUnsubscribeAll();
      subscribeToFavorites();
      break;
    case "collections":
      showPanel("collections-panel");
      dashboardUnsubscribeAll();
      favoritesUnsubscribeAll();
      subscribeToCollections();
      break;
    case "dashboard":
      showPanel("dashboard-panel");
      favoritesUnsubscribeAll();
      collectionsUnsubscribeAll();
      subscribeToDashboard();
      break;
    default:
      // Búsqueda y Recomendaciones: contenido pendiente (T-115/T-120).
      break;
  }
}

/**
 * Sincroniza `aria-selected`, `tabindex` y `aria-disabled` de las
 * pestañas del nav principal.
 */
function syncNavTabs() {
  if (!navTabsContainer) return;
  const tabs = navTabsContainer.querySelectorAll('[role="tab"]');
  tabs.forEach((tab) => {
    const key = tab.dataset.view;
    const isActive = key === activeAppView;
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.setAttribute("tabindex", isActive ? "0" : "-1");
    if (isAppViewAvailable(key)) {
      tab.removeAttribute("aria-disabled");
    } else {
      tab.setAttribute("aria-disabled", "true");
    }
  });
}

/** Navegación por teclado del nav principal (patrón ARIA tablist). */
function handleNavKeydown(event) {
  if (!navTabsContainer) return;
  const enabledTabs = Array.from(
    navTabsContainer.querySelectorAll('[role="tab"]:not([aria-disabled="true"])')
  );
  if (enabledTabs.length === 0) return;

  const currentIndex = enabledTabs.indexOf(document.activeElement);
  if (currentIndex === -1) return;

  let newIndex = currentIndex;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      newIndex = (currentIndex + 1) % enabledTabs.length;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      newIndex = (currentIndex - 1 + enabledTabs.length) % enabledTabs.length;
      break;
    case "Home":
      newIndex = 0;
      break;
    case "End":
      newIndex = enabledTabs.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  const nextTab = enabledTabs[newIndex];
  nextTab.focus();
  showAppView(nextTab.dataset.view);
}

/** Enlaza el nav principal (una sola vez, al cargar el módulo). */
let appNavInitialized = false;

function initAppNav() {
  if (appNavInitialized || !navTabsContainer) return;
  appNavInitialized = true;

  const tabs = navTabsContainer.querySelectorAll('[role="tab"]');
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      // Las pestañas sin vista propia no navegan (aria-disabled).
      if (tab.getAttribute("aria-disabled") === "true") return;
      showAppView(tab.dataset.view);
    });
  });
  navTabsContainer.addEventListener("keydown", handleNavKeydown);
  syncNavTabs();
}

/**
 * Muestra una vista. Las vistas de la app (Catálogo, Búsqueda, Perfil,
 * Colecciones, Dashboard y Recomendaciones) se delegan en
 * `showAppView()`; loading/login/allowed/denied conservan el
 * comportamiento original (spec 001).
 * @param {string} name Nombre de la vista.
 */
function show(name) {
  if (APP_VIEW_KEYS.includes(name)) {
    showAppView(name);
    return;
  }
  Object.entries(views).forEach(([key, view]) => {
    view.hidden = key !== name;
  });
}

function renderAllowed(user) {
  const name = document.getElementById("user-name");
  const email = document.getElementById("user-email");
  const photo = document.getElementById("user-photo");
  name.textContent = user.displayName || user.email || "invitado";
  email.textContent = user.email || "";
  if (user.photoURL) {
    photo.src = user.photoURL;
    photo.hidden = false;
  } else {
    photo.hidden = true;
  }
}

btnLogin.addEventListener("click", async () => {
  loginError.hidden = true;
  btnLogin.disabled = true;
  try {
    await login();
  } catch (error) {
    loginError.textContent =
      "No se pudo iniciar sesión con Google (popup bloqueado o cancelado).";
    loginError.hidden = false;
  } finally {
    btnLogin.disabled = false;
  }
});

btnLogout.addEventListener("click", () => {
  catalogCleanup();
  logout();
});

btnBack.addEventListener("click", () => {
  deniedAccess = false;
  show("login");
});

watchAuthState(async (user) => {
  if (!user) {
    show(deniedAccess ? "denied" : "login");
    return;
  }
  if (!isEmailAllowed(user.email)) {
    deniedAccess = true;
    show("denied");
    try {
      await logout();
    } catch (error) {
      // Sesión residual: la vista de rechazo ya está activa.
    }
    return;
  }
  deniedAccess = false;
  renderAllowed(user);
  show("allowed");
  catalogInit();
});

// =============================================================
// Spec 002 — Catálogo (modelo 00-05, T-114)
// =============================================================

// Tipo de media **legacy** (minúsculas) que usan las vistas heredadas
// (ficha, alta manual y búsqueda por API). La vista de catálogo del
// modelo 00-05 tiene su propio estado (`catalogView`, 7 tipos).
let activeMediaType = MEDIA_TYPES[0];
let catalogInitialized = false;

// --- Dashboard (spec 003) -----------------------------------
let dashboardUnsubscribes = [];
let dashboardItemsByType = {};

// --- Favoritos (spec 004) -----------------------------------
let favoritesUnsubscribes = [];
let favoritesItemsByType = {};
let favoriteChapters = [];

// --- Colecciones (spec 004) ---------------------------------
let collectionsUnsubscribe = null;
let collectionsList = [];
let currentCollectionDetailId = null;
// Items/chapters suscritos para el detalle de colección
let collectionDetailUnsubscribes = [];
let collectionDetailItemsByType = {};
let collectionDetailChapters = [];

// --- Helpers de seguridad (MED #3) --------------------------

/**
 * Escapa caracteres especiales de HTML para evitar inyección
 * cuando se renderizan cadenas de origen externo (REQ-014).
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Referencias DOM ----------------------------------------
// Botón «Añadir» del catálogo heredado (spec 002). Puede no existir:
// la vista de catálogo del modelo 00-05 se construye en JS (T-114) y
// el alta manual/búsqueda pertenecen a T-115/T-116.
const btnAddItem = document.getElementById("btn-add-item");

// Dashboard DOM (spec 003)
const dashboardStatsEl = document.getElementById("dashboard-stats");
const dashboardRecentAddedEl = document.getElementById("dashboard-recent-added");
const dashboardRecentCompletedEl = document.getElementById("dashboard-recent-completed");
const dashboardErrorEl = document.getElementById("dashboard-error");
const dashboardLoadingEl = document.getElementById("dashboard-loading");

// =============================================================
// T-114 — Vista de Catálogo del modelo 00-05
// (spec 02 UI-02, REQ-101/REQ-103; AC-110, AC-111, AC-116)
//
//   - `CatalogTabs`: 7 tipos de medio (DB-101) con patrón ARIA
//     `tablist` y navegación por teclado.
//   - `FilterBar`: filtros secundarios de REQ-103 (género, rango de
//     años y `avgRating` mínimo) que se envían al repositorio.
//   - Grid de `MediaCard`: el MISMO componente de las 4 vistas
//     (AC-116).
//   - `LoadMore`: paginación por cursor opaco (API-02). Cada página
//     es UNA lectura del tipo activo (AC-111) y se CONCATENA al
//     listado sin recargar (AC-110).
//
// La vista NO se suscribe: lee páginas sueltas con `listByType` y
// mantiene el cursor para continuar.
// =============================================================

/**
 * Etiqueta en español del tipo de medio. ÚNICA fuente de etiquetas:
 * el mapa de `MediaCard` (7 tipos, DB-101). Los tipos legacy
 * (minúsculas, spec 002) se traducen con
 * `legacyMediaTypeToMediaItemType()` (REQ-C6).
 * @param {string} mediaType
 * @returns {string}
 */
function mediaTypeLabel(mediaType) {
  if (typeof mediaType !== "string" || mediaType === "") return "medio";
  const itemType = legacyMediaTypeToMediaItemType(mediaType.toLowerCase()) ?? mediaType;
  return CATALOG_MEDIA_TYPE_LABELS[itemType] ?? mediaType;
}

/**
 * Estado de la vista de catálogo (T-114).
 * @type {{
 *   mediaType: string,
 *   items: object[],
 *   cursor: string|null,
 *   hasMore: boolean,
 *   loading: boolean,
 *   requestId: number,
 *   filters: {genre: string, yearFrom: number|null, yearTo: number|null, minAvgRating: number|null},
 *   mounted: boolean
 * }}
 */
const catalogView = {
  /** Tipo de medio activo (7 tipos, DB-101). */
  mediaType: "MOVIE",
  /** Ítems de la página actual + los añadidos con «Cargar más». */
  items: [],
  /** Cursor opaco de la próxima página (`null` ⇒ fin del listado). */
  cursor: null,
  /** ¿Hay página siguiente? */
  hasMore: false,
  /** ¿Hay una consulta en vuelo? */
  loading: false,
  /** Token de petición: descarta respuestas obsoletas. */
  requestId: 0,
  /** Filtros secundarios de REQ-103. */
  filters: { genre: "", yearFrom: null, yearTo: null, minAvgRating: null },
  /** ¿La vista ya está montada en el DOM? */
  mounted: false,
};

/** Referencias DOM de la vista de catálogo (se rellenan al montar). */
const catalogViewDom = {
  root: null,
  tabs: null,
  panel: null,
  form: null,
  genreInput: null,
  genreList: null,
  yearFromInput: null,
  yearToInput: null,
  minRatingInput: null,
  grid: null,
  empty: null,
  emptyText: null,
  loading: null,
  error: null,
  count: null,
  loadMoreWrap: null,
  loadMoreBtn: null,
};

/**
 * Crea un elemento del DOM con clase y texto (sin `innerHTML`).
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function createCatalogElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

/**
 * Monta la vista de catálogo dentro de `#view-catalog` (T-114).
 * Sustituye al catálogo heredado de la spec 002 (5 tipos y store
 * `users/{uid}/…`): la vista nueva lee la colección `catalog` con
 * `CatalogRepository` (REQ-101).
 */
function mountCatalogView() {
  if (catalogView.mounted) return;
  const view = document.getElementById("view-catalog");
  if (!view) return;

  // El catálogo heredado (`#catalog-root`) queda obsoleto: el modelo
  // 00-05 usa la colección `catalog` (notas de integración de tasks).
  const legacyRoot = document.getElementById("catalog-root");
  if (legacyRoot) legacyRoot.remove();

  const root = createCatalogElement("div", "catalog-view");
  root.id = "catalog-view";

  // --- CatalogTabs (7 tipos) ---------------------------------
  const tabs = createCatalogElement("div", "catalog__tabs catalog-view__tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Tipos de catálogo");
  for (const mediaType of CATALOG_MEDIA_TYPES) {
    const tab = createCatalogElement(
      "button",
      "catalog__tab",
      CATALOG_MEDIA_TYPE_LABELS[mediaType] ?? mediaType,
    );
    tab.type = "button";
    tab.id = `catalog-view-tab-${mediaType.toLowerCase()}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "catalog-view-panel");
    tab.dataset.mediaType = mediaType;
    tab.addEventListener("click", () => selectCatalogType(mediaType));
    tabs.appendChild(tab);
  }
  tabs.addEventListener("keydown", handleCatalogTabsKeydown);

  // --- Panel -------------------------------------------------
  const panel = createCatalogElement("section", "catalog-view__panel");
  panel.id = "catalog-view-panel";
  panel.setAttribute("role", "tabpanel");

  // --- FilterBar (REQ-103) -----------------------------------
  const form = createCatalogElement("form", "catalog__toolbar catalog-view__filters");
  form.setAttribute("role", "search");
  form.setAttribute("aria-label", "Filtros del catálogo");
  form.noValidate = true;

  const genreField = createCatalogElement("label", "catalog-view__field");
  genreField.appendChild(createCatalogElement("span", "catalog-view__label", "Género"));
  const genreInput = document.createElement("input");
  genreInput.type = "search";
  genreInput.id = "catalog-view-filter-genre";
  genreInput.className = "catalog__select catalog-view__input";
  genreInput.placeholder = "Todos los géneros";
  genreInput.autocomplete = "off";
  genreInput.setAttribute("aria-label", "Filtrar por género");
  const genreList = document.createElement("datalist");
  genreList.id = "catalog-view-genres";
  genreField.append(genreInput, genreList);

  const yearFromField = createCatalogElement("label", "catalog-view__field");
  yearFromField.appendChild(createCatalogElement("span", "catalog-view__label", "Año desde"));
  const yearFromInput = document.createElement("input");
  yearFromInput.type = "number";
  yearFromInput.id = "catalog-view-filter-year-from";
  yearFromInput.className = "catalog__select catalog-view__input";
  yearFromInput.min = "1888";
  yearFromInput.max = "2100";
  yearFromInput.placeholder = "1888";
  yearFromInput.setAttribute("aria-label", "Año inicial del rango");
  yearFromField.appendChild(yearFromInput);

  const yearToField = createCatalogElement("label", "catalog-view__field");
  yearToField.appendChild(createCatalogElement("span", "catalog-view__label", "Año hasta"));
  const yearToInput = document.createElement("input");
  yearToInput.type = "number";
  yearToInput.id = "catalog-view-filter-year-to";
  yearToInput.className = "catalog__select catalog-view__input";
  yearToInput.min = "1888";
  yearToInput.max = "2100";
  yearToInput.placeholder = "2100";
  yearToInput.setAttribute("aria-label", "Año final del rango");
  yearToField.appendChild(yearToInput);

  const ratingField = createCatalogElement("label", "catalog-view__field");
  ratingField.appendChild(
    createCatalogElement("span", "catalog-view__label", "Valoración mínima"),
  );
  const minRatingInput = document.createElement("input");
  minRatingInput.type = "number";
  minRatingInput.id = "catalog-view-filter-min-rating";
  minRatingInput.className = "catalog__select catalog-view__input";
  minRatingInput.min = "0";
  minRatingInput.max = "10";
  minRatingInput.step = "0.1";
  minRatingInput.placeholder = "0";
  minRatingInput.setAttribute("aria-label", "Valoración media mínima");
  ratingField.appendChild(minRatingInput);

  const actions = createCatalogElement("div", "catalog-view__actions");
  const applyButton = createCatalogElement("button", "btn btn--secondary", "Aplicar filtros");
  applyButton.type = "submit";
  const resetButton = createCatalogElement("button", "btn", "Limpiar");
  resetButton.type = "button";
  resetButton.addEventListener("click", handleCatalogFiltersReset);
  actions.append(applyButton, resetButton);

  form.append(genreField, yearFromField, yearToField, ratingField, actions);
  form.addEventListener("submit", handleCatalogFiltersSubmit);

  // --- Estados (cargando / vacío / error) --------------------
  const error = createCatalogElement("p", "error");
  error.id = "catalog-view-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const loading = createCatalogElement("div", "catalog__state");
  loading.id = "catalog-view-loading";
  loading.hidden = true;
  loading.appendChild(createCatalogElement("p", "muted", "Cargando catálogo…"));

  const empty = createCatalogElement("div", "catalog__state");
  empty.id = "catalog-view-empty";
  empty.hidden = true;
  const emptyText = createCatalogElement("p", "muted");
  empty.appendChild(emptyText);

  const count = createCatalogElement("p", "catalog-view__count");
  count.id = "catalog-view-count";

  // --- Grid de `MediaCard` (AC-116) --------------------------
  const grid = document.createElement("ul");
  grid.id = "catalog-view-grid";
  grid.className = "media-grid";
  grid.setAttribute("aria-live", "polite");

  // --- LoadMore (cursor, AC-110) -----------------------------
  const loadMoreWrap = createCatalogElement("div", "catalog__load-more");
  loadMoreWrap.id = "catalog-view-load-more";
  loadMoreWrap.hidden = true;
  const loadMoreBtn = createCatalogElement("button", "btn btn--secondary", "Cargar más");
  loadMoreBtn.type = "button";
  loadMoreBtn.id = "catalog-view-load-more-btn";
  loadMoreBtn.setAttribute("aria-label", "Cargar más títulos del catálogo");
  loadMoreBtn.addEventListener("click", () => {
    void loadCatalogPage({ append: true });
  });
  loadMoreWrap.appendChild(loadMoreBtn);

  panel.append(form, error, loading, empty, count, grid, loadMoreWrap);
  // T-116 (UI-04): panel de alta manual dentro de la vista de
  // catálogo (se monta aquí para no depender de `index.html`).
  mountManualAddPanel(panel);
  root.append(tabs, panel);
  view.appendChild(root);

  catalogViewDom.root = root;
  catalogViewDom.tabs = tabs;
  catalogViewDom.panel = panel;
  catalogViewDom.form = form;
  catalogViewDom.genreInput = genreInput;
  catalogViewDom.genreList = genreList;
  catalogViewDom.yearFromInput = yearFromInput;
  catalogViewDom.yearToInput = yearToInput;
  catalogViewDom.minRatingInput = minRatingInput;
  catalogViewDom.grid = grid;
  catalogViewDom.empty = empty;
  catalogViewDom.emptyText = emptyText;
  catalogViewDom.loading = loading;
  catalogViewDom.error = error;
  catalogViewDom.count = count;
  catalogViewDom.loadMoreWrap = loadMoreWrap;
  catalogViewDom.loadMoreBtn = loadMoreBtn;

  catalogView.mounted = true;
  syncCatalogTabs();
  updateCatalogLoadMoreState();
  renderCatalogState();
}

/**
 * Sincroniza `aria-selected`, `tabindex` y `aria-labelledby` de las
 * pestañas de tipo y del panel (UI-02).
 */
function syncCatalogTabs() {
  const tabs = catalogViewDom.tabs;
  if (!tabs) return;
  const activeId = `catalog-view-tab-${String(catalogView.mediaType).toLowerCase()}`;
  tabs.querySelectorAll('[role="tab"]').forEach((tab) => {
    const isActive = tab.dataset.mediaType === catalogView.mediaType;
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.setAttribute("tabindex", isActive ? "0" : "-1");
  });
  if (catalogViewDom.panel) {
    catalogViewDom.panel.setAttribute("aria-labelledby", activeId);
  }
}

/** Navegación por teclado del `tablist` de tipos (patrón ARIA). */
function handleCatalogTabsKeydown(event) {
  const tabs = Array.from(
    catalogViewDom.tabs ? catalogViewDom.tabs.querySelectorAll('[role="tab"]') : [],
  );
  if (tabs.length === 0) return;
  const currentIndex = tabs.indexOf(document.activeElement);
  if (currentIndex === -1) return;

  let nextIndex = currentIndex;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      nextIndex = (currentIndex + 1) % tabs.length;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = tabs.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  const nextTab = tabs[nextIndex];
  nextTab.focus();
  selectCatalogType(nextTab.dataset.mediaType);
}

/**
 * Cambia el tipo de medio activo: reinicia filtros y paginación y
 * vuelve a leer la primera página (REQ-101).
 * @param {string} mediaType
 */
function selectCatalogType(mediaType) {
  if (!CATALOG_MEDIA_TYPES.includes(mediaType)) return;
  catalogView.mediaType = mediaType;
  // T-116: el alta manual sigue el tipo activo (DB-101).
  syncManualMediaType(mediaType);
  // El grid se vacía antes de leer la página 1 del nuevo tipo: si la
  // consulta falla, no quedan pintadas tarjetas del tipo anterior
  // (AC-111).
  resetCatalogPaging();
  resetCatalogFilters();
  syncCatalogTabs();
  void loadCatalogPage({ append: false });
}

/** Vacía los filtros de REQ-103 (estado y controles). */
function resetCatalogFilters() {
  catalogView.filters = { genre: "", yearFrom: null, yearTo: null, minAvgRating: null };
  if (catalogViewDom.genreInput) catalogViewDom.genreInput.value = "";
  if (catalogViewDom.yearFromInput) catalogViewDom.yearFromInput.value = "";
  if (catalogViewDom.yearToInput) catalogViewDom.yearToInput.value = "";
  if (catalogViewDom.minRatingInput) catalogViewDom.minRatingInput.value = "";
}

/** ¿Hay algún filtro secundario activo (REQ-103)? */
function hasCatalogFilters() {
  const filters = catalogView.filters;
  return Boolean(
    filters.genre ||
      filters.yearFrom !== null ||
      filters.yearTo !== null ||
      filters.minAvgRating !== null,
  );
}

/**
 * Lee y valida los filtros del `FilterBar` (REQ-103).
 * @returns {{ok: true, filters: object}|{ok: false, message: string}}
 */
function readCatalogFilters() {
  const genre = (catalogViewDom.genreInput ? catalogViewDom.genreInput.value : "").trim();
  const yearFromRaw = (
    catalogViewDom.yearFromInput ? catalogViewDom.yearFromInput.value : ""
  ).trim();
  const yearToRaw = (catalogViewDom.yearToInput ? catalogViewDom.yearToInput.value : "").trim();
  const minRatingRaw = (
    catalogViewDom.minRatingInput ? catalogViewDom.minRatingInput.value : ""
  ).trim();

  const filters = { genre, yearFrom: null, yearTo: null, minAvgRating: null };

  if (yearFromRaw !== "") {
    const year = Number(yearFromRaw);
    if (!Number.isInteger(year) || year < 1888 || year > 2100) {
      return { ok: false, message: "El año inicial debe estar entre 1888 y 2100." };
    }
    filters.yearFrom = year;
  }
  if (yearToRaw !== "") {
    const year = Number(yearToRaw);
    if (!Number.isInteger(year) || year < 1888 || year > 2100) {
      return { ok: false, message: "El año final debe estar entre 1888 y 2100." };
    }
    filters.yearTo = year;
  }
  if (filters.yearFrom !== null && filters.yearTo !== null && filters.yearFrom > filters.yearTo) {
    return { ok: false, message: "El año inicial no puede ser mayor que el año final." };
  }
  if (minRatingRaw !== "") {
    const rating = Number(minRatingRaw);
    if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
      return { ok: false, message: "La valoración mínima debe estar entre 0 y 10." };
    }
    filters.minAvgRating = rating;
  }
  return { ok: true, filters };
}

/** Aplica los filtros del `FilterBar` y recarga la primera página. */
function handleCatalogFiltersSubmit(event) {
  event.preventDefault();
  const result = readCatalogFilters();
  if (!result.ok) {
    showCatalogError(result.message);
    return;
  }
  hideCatalogError();
  catalogView.filters = result.filters;
  resetCatalogPaging();
  void loadCatalogPage({ append: false });
}

/** Limpia los filtros y recarga la primera página. */
function handleCatalogFiltersReset() {
  resetCatalogFilters();
  hideCatalogError();
  resetCatalogPaging();
  void loadCatalogPage({ append: false });
}

/**
 * Vacía el listado en memoria y el grid del DOM. Se llama ANTES de
 * cada lectura completa para que un error de carga no deje pintadas
 * tarjetas de otro tipo (AC-111: «solo docs del tipo filtrado»).
 */
function clearCatalogGrid() {
  catalogView.items = [];
  catalogView.cursor = null;
  catalogView.hasMore = false;
  if (catalogViewDom.grid) catalogViewDom.grid.replaceChildren();
}

/** Reinicia el listado y el cursor (nueva consulta desde la página 1). */
function resetCatalogPaging() {
  clearCatalogGrid();
  updateCatalogLoadMoreState();
  renderCatalogState();
}

/**
 * Lee UNA página del catálogo del tipo activo y la pinta.
 * @param {{append?: boolean}} [options] `append:true` concatena la
 *        página siguiente al listado ya pintado (AC-110).
 */
async function loadCatalogPage(options = {}) {
  const append = options.append === true;
  if (append && catalogView.loading) return;

  const requestId = ++catalogView.requestId;
  catalogView.loading = true;

  if (!append) {
    // AC-111: el grid se vacía ANTES de leer. Si la consulta falla,
    // no pueden quedar tarjetas de otro tipo pintadas.
    clearCatalogGrid();
    showCatalogLoading(true);
    hideCatalogError();
  }
  updateCatalogLoadMoreState();

  const filters = catalogView.filters;
  const query = {
    pageSize: CATALOG_PAGE_SIZE,
    cursor: append ? catalogView.cursor : null,
    genre: filters.genre ? filters.genre : null,
    yearFrom: filters.yearFrom,
    yearTo: filters.yearTo,
    minAvgRating: filters.minAvgRating,
    sort: DEFAULT_CATALOG_SORT,
  };

  const result = await catalogRepository.listByType(catalogView.mediaType, query);

  // Respuesta obsoleta (cambio de tipo o de filtros): se descarta.
  if (requestId !== catalogView.requestId) return;

  catalogView.loading = false;
  showCatalogLoading(false);

  if (!result || result.ok !== true) {
    showCatalogError(
      (result && result.message) || "No se ha podido cargar el catálogo.",
    );
    updateCatalogLoadMoreState();
    renderCatalogState();
    return;
  }

  hideCatalogError();
  const page = result.value || {};
  const items = Array.isArray(page.items) ? page.items : [];
  // AC-111: en la vista solo se pintan ítems del tipo activo.
  const typed = items.filter((item) => item && item.mediaType === catalogView.mediaType);

  if (append) {
    appendCatalogItems(typed);
  } else {
    catalogView.items = typed;
    renderCatalogGrid();
  }

  const cursor = typeof page.cursor === "string" && page.cursor !== "" ? page.cursor : null;
  catalogView.cursor = cursor;
  catalogView.hasMore = cursor !== null;
  updateCatalogLoadMoreState();
  renderCatalogState();
}

/**
 * Opciones compartidas de la `MediaCard` (AC-116, REQ-106): la MISMA
 * configuración en Catálogo, Búsqueda, Colecciones y Recomendaciones.
 * T-117 (AC-115/AC-117) inyectará la `entry` personal y el guardado
 * en `trackingRepository`; T-118 (UI-14) inyectará las colecciones.
 * @returns {{entry: null, collections: object[], onAdd: Function, onStatusChange: Function}}
 */
function mediaCardOptions() {
  return {
    entry: null,
    collections: [],
    onAdd: handleCatalogCardUnavailable,
    onStatusChange: handleCatalogCardUnavailable,
  };
}

/**
 * Opciones de la `MediaCard` en la vista de catálogo (AC-116: el
 * mismo componente de las 4 vistas).
 * @returns {{entry: null, collections: object[], onAdd: Function, onStatusChange: Function}}
 */
function catalogCardOptions() {
  return mediaCardOptions();
}

/**
 * Punto de integración de T-117 (AC-115/AC-117): las acciones rápidas
 * de la `MediaCard` necesitan `trackingRepository`, que se conecta en
 * T-117. Hasta entonces la acción informa en español de que el
 * seguimiento todavía no está disponible (REQ-E2, sin falso éxito).
 * @returns {{ok: false, code: string, message: string}}
 */
function handleCatalogCardUnavailable() {
  return {
    ok: false,
    code: "unavailable",
    message: "El seguimiento de títulos todavía no está disponible en el catálogo.",
  };
}

/** Pinta el grid de `MediaCard` con la página actual. */
function renderCatalogGrid() {
  const grid = catalogViewDom.grid;
  if (!grid) return;
  mountMediaCards(grid, catalogView.items, catalogCardOptions());
  updateCatalogGenreSuggestions();
}

/**
 * Concatena la página siguiente al listado SIN recargar la vista
 * (AC-110). Los duplicados por id se descartan.
 * @param {object[]} items
 */
function appendCatalogItems(items) {
  const grid = catalogViewDom.grid;
  if (!grid || items.length === 0) return;
  const known = new Set(catalogView.items.map((item) => item.id));
  const fresh = items.filter((item) => item && !known.has(item.id));
  if (fresh.length === 0) return;
  const fragment = document.createDocumentFragment();
  for (const item of fresh) {
    fragment.appendChild(createMediaCard(item, catalogCardOptions()));
  }
  grid.appendChild(fragment);
  catalogView.items = catalogView.items.concat(fresh);
  updateCatalogGenreSuggestions();
}

/** Sugiere los géneros presentes en los ítems ya cargados (REQ-103). */
function updateCatalogGenreSuggestions() {
  const list = catalogViewDom.genreList;
  if (!list) return;
  const genres = new Set();
  for (const item of catalogView.items) {
    for (const genre of Array.isArray(item.genres) ? item.genres : []) {
      if (typeof genre === "string" && genre.trim() !== "") genres.add(genre.trim());
    }
  }
  const options = [...genres]
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((genre) => {
      const option = document.createElement("option");
      option.value = genre;
      return option;
    });
  list.replaceChildren(...options);
}

/** Pinta el estado vacío y el contador de títulos. */
function renderCatalogState() {
  const hasItems = catalogView.items.length > 0;
  if (catalogViewDom.empty && catalogViewDom.emptyText) {
    catalogViewDom.emptyText.textContent = hasCatalogFilters()
      ? `No hay títulos de ${mediaTypeLabel(catalogView.mediaType)} que cumplan los filtros.`
      : `Todavía no hay títulos de ${mediaTypeLabel(catalogView.mediaType)} en el catálogo.`;
    catalogViewDom.empty.hidden = hasItems;
  }
  if (catalogViewDom.count) {
    catalogViewDom.count.textContent = hasItems
      ? `${catalogView.items.length} título${catalogView.items.length === 1 ? "" : "s"}`
      : "";
  }
}

/** Muestra u oculta el botón «Cargar más» según el cursor (API-02). */
function updateCatalogLoadMoreState() {
  if (catalogViewDom.loadMoreWrap) {
    catalogViewDom.loadMoreWrap.hidden = !catalogView.hasMore;
  }
  if (catalogViewDom.loadMoreBtn) {
    catalogViewDom.loadMoreBtn.disabled = catalogView.loading;
    catalogViewDom.loadMoreBtn.textContent = catalogView.loading ? "Cargando…" : "Cargar más";
  }
}

/** Muestra u oculta el estado de carga. */
function showCatalogLoading(visible) {
  if (catalogViewDom.loading) catalogViewDom.loading.hidden = !visible;
}

/** Muestra un error de la vista de catálogo (REQ-E2). */
function showCatalogError(message) {
  const error = catalogViewDom.error;
  if (!error) return;
  error.textContent = message;
  error.hidden = false;
}

/** Oculta el error de la vista de catálogo. */
function hideCatalogError() {
  const error = catalogViewDom.error;
  if (!error) return;
  error.hidden = true;
  error.textContent = "";
}

// --- Navegación por teclado de pestañas (§6) ----------------
// La navegación por teclado de las pestañas de tipo vive en
// `handleCatalogTabsKeydown()` (T-114, patrón ARIA `tablist`).

function hideAllPanels() {
  const panels = ["dashboard-panel", "favorites-panel", "collections-panel", "catalog-panel"];
  panels.forEach(id => {
    const panel = document.getElementById(id);
    if (panel) panel.hidden = true;
  });
}

function showPanel(panelId) {
  const panel = document.getElementById(panelId);
  if (panel) panel.hidden = false;
}

// --- Carga del catálogo (T-114) -----------------------------
// La vista de catálogo NO se suscribe: lee páginas con cursor opaco
// (`loadCatalogPage`) y concatena las siguientes con «Cargar más».

/**
 * Vacía la vista de catálogo (logout / cambio de sesión).
 * Invalida las peticiones en vuelo y reinicia listado, paginación y
 * filtros (REQ-103), de modo que la vista no conserve tarjetas ni
 * filtros del tipo anterior (AC-111).
 */
function resetCatalogView() {
  catalogView.requestId += 1;
  catalogView.loading = false;
  clearCatalogGrid();
  resetCatalogFilters();
  updateCatalogLoadMoreState();
  renderCatalogState();
}

function catalogCleanup() {
  resetCatalogView();
  // T-115: la búsqueda se invalida también (temporizador + resultados).
  resetSearchView();
  // T-116: el alta manual se vacía (formulario, estado y resultados
  // externos) para no arrastrar datos entre sesiones.
  resetManualAddPanel();
  dashboardUnsubscribeAll();
  favoritesUnsubscribeAll();
  collectionsUnsubscribeAll();
  catalogInitialized = false;
  // Tras volver a iniciar sesión se muestra la vista inicial (T-112).
  activeAppView = DEFAULT_APP_VIEW;
}

// =============================================================
// T-115 — Vista de Búsqueda del modelo 00-05
// (spec 02 UI-03, REQ-102; AC-112, AC-113)
//
//   - Input de búsqueda con DEBOUNCE de 300 ms (UI-03).
//   - Consulta `CatalogRepository.searchByTitle()`: prefijo sobre el
//     título NORMALIZADO (`normalizeTitle`, DB-121) ⇒ «el últ» y
//     «EL ÚLT» encuentran «El Último Signo» (AC-112); «ultimo sig» NO
//     es prefijo ⇒ sin resultados (AC-112).
//   - Sin coincidencias (o término vacío) ⇒ `items: []` + estado vacío
//     «Sin resultados», SIN error (AC-113, API-04).
//   - Grid con el MISMO componente `MediaCard` del catálogo
//     (AC-116, REQ-106).
// =============================================================

/** Retardo del debounce del input de búsqueda (UI-03: 300 ms). */
const SEARCH_DEBOUNCE_MS = 300;

/** Texto del estado vacío de la búsqueda (UI-03, AC-113). */
const SEARCH_EMPTY_TEXT = "Sin resultados";

/** Tamaño de página de la búsqueda (mismo criterio que el catálogo). */
const SEARCH_PAGE_SIZE = CATALOG_PAGE_SIZE;

/**
 * Estado de la vista de búsqueda (T-115).
 * @type {{
 *   term: string,
 *   items: object[],
 *   cursor: string|null,
 *   hasMore: boolean,
 *   loading: boolean,
 *   hasSearched: boolean,
 *   requestId: number,
 *   mounted: boolean,
 *   debounceTimer: *
 * }}
 */
const searchView = {
  /** Último término escrito por la persona usuaria (sin normalizar). */
  term: "",
  /** Ítems de la página actual + los añadidos con «Cargar más». */
  items: [],
  /** Cursor opaco de la próxima página (`null` ⇒ fin del listado). */
  cursor: null,
  /** ¿Hay página siguiente? */
  hasMore: false,
  /** ¿Hay una consulta en vuelo? */
  loading: false,
  /** ¿Se ha ejecutado ya alguna búsqueda? (estado vacío) */
  hasSearched: false,
  /** Token de petición: descarta respuestas obsoletas. */
  requestId: 0,
  /** ¿La vista ya está montada en el DOM? */
  mounted: false,
  /** Temporizador del debounce (UI-03: 300 ms). */
  debounceTimer: null,
};

/** Referencias DOM de la vista de búsqueda (se rellenan al montar). */
const searchViewDom = {
  view: null,
  form: null,
  input: null,
  typeSelect: null,
  status: null,
  error: null,
  loading: null,
  empty: null,
  emptyText: null,
  count: null,
  grid: null,
  loadMoreWrap: null,
  loadMoreBtn: null,
};

/**
 * Monta la vista de búsqueda dentro de `#view-search` (T-115). El
 * marcado vive en `index.html`; aquí solo se enlazan los eventos y se
 * pinta el estado.
 */
function mountSearchView() {
  if (searchView.mounted) return;
  const view = document.getElementById("view-search");
  if (!view) return;

  const form = document.getElementById("search-view-form");
  const input = document.getElementById("search-view-input");
  const grid = document.getElementById("search-view-grid");
  if (!form || !input || !grid) return;

  searchViewDom.view = view;
  searchViewDom.form = form;
  searchViewDom.input = input;
  searchViewDom.typeSelect = document.getElementById("search-view-type");
  searchViewDom.status = document.getElementById("search-view-status");
  searchViewDom.error = document.getElementById("search-view-error");
  searchViewDom.loading = document.getElementById("search-view-loading");
  searchViewDom.empty = document.getElementById("search-view-empty");
  searchViewDom.emptyText = document.getElementById("search-view-empty-text");
  searchViewDom.count = document.getElementById("search-view-count");
  searchViewDom.grid = grid;
  searchViewDom.loadMoreWrap = document.getElementById("search-view-load-more");
  searchViewDom.loadMoreBtn = document.getElementById("search-view-load-more-btn");

  // Tipos de medio (REQ-102: la búsqueda se puede acotar a un tipo).
  if (searchViewDom.typeSelect) {
    const options = [];
    for (const mediaType of CATALOG_MEDIA_TYPES) {
      const option = document.createElement("option");
      option.value = mediaType;
      option.textContent = CATALOG_MEDIA_TYPE_LABELS[mediaType] ?? mediaType;
      options.push(option);
    }
    searchViewDom.typeSelect.replaceChildren(...options);
    searchViewDom.typeSelect.addEventListener("change", handleSearchTypeChange);
  }

  // Texto del estado vacío: una única fuente (UI-03, AC-113).
  if (searchViewDom.emptyText) searchViewDom.emptyText.textContent = SEARCH_EMPTY_TEXT;

  // Debounce de 300 ms (UI-03).
  input.addEventListener("input", handleSearchInput);
  form.addEventListener("submit", handleSearchSubmit);
  if (searchViewDom.loadMoreBtn) {
    searchViewDom.loadMoreBtn.addEventListener("click", handleSearchLoadMore);
  }

  searchView.mounted = true;
  updateSearchLoadMoreState();
  renderSearchState();
}

/** Término escrito por la persona usuaria (sin normalizar). */
function readSearchTerm() {
  const input = searchViewDom.input;
  if (!input || typeof input.value !== "string") return "";
  return input.value.trim();
}

/** Tipo de medio seleccionado (`null` ⇒ todos los tipos, REQ-102). */
function readSearchMediaType() {
  const select = searchViewDom.typeSelect;
  if (!select || typeof select.value !== "string" || select.value === "") return null;
  return select.value;
}

/**
 * Cada pulsación del input programa la búsqueda con un debounce de
 * 300 ms (UI-03). La respuesta en vuelo se invalida de inmediato
 * para que no se pinte un resultado obsoleto (AC-112).
 */
function handleSearchInput() {
  searchView.term = readSearchTerm();
  // Invalida la consulta en vuelo (si la hubiera).
  searchView.requestId += 1;
  clearTimeout(searchView.debounceTimer);
  searchView.debounceTimer = setTimeout(() => {
    searchView.debounceTimer = null;
    void runSearch({ append: false });
  }, SEARCH_DEBOUNCE_MS);
}

/** Envío explícito del formulario: busca sin esperar al debounce. */
function handleSearchSubmit(event) {
  event.preventDefault();
  clearTimeout(searchView.debounceTimer);
  searchView.debounceTimer = null;
  searchView.term = readSearchTerm();
  void runSearch({ append: false });
}

/** Cambio de tipo: relanza la búsqueda con el tipo elegido. */
function handleSearchTypeChange() {
  clearTimeout(searchView.debounceTimer);
  searchView.debounceTimer = null;
  searchView.term = readSearchTerm();
  void runSearch({ append: false });
}

/** «Cargar más»: siguiente página por cursor opaco (API-02). */
function handleSearchLoadMore() {
  void runSearch({ append: true });
}

/**
 * Ejecuta la búsqueda por prefijo del título normalizado (REQ-102).
 * @param {{append?: boolean}} [options] `append:true` concatena la
 *        página siguiente al listado ya pintado.
 */
async function runSearch(options = {}) {
  const append = options.append === true;
  if (append && searchView.loading) return;

  const requestId = ++searchView.requestId;
  const rawTerm = readSearchTerm();
  // Prefijo sobre el título NORMALIZADO (DB-121): «el últ» y
  // «EL ÚLT» ⇒ «el ult» (AC-112).
  const term = normalizeTitle(rawTerm);

  searchView.loading = true;
  searchView.term = rawTerm;

  if (!append) {
    // El grid se vacía ANTES de leer: si la consulta falla, no
    // quedan pintadas tarjetas de otra búsqueda (AC-113).
    searchView.items = [];
    searchView.cursor = null;
    searchView.hasMore = false;
    clearSearchGrid();
    showSearchLoading(true);
  }
  hideSearchError();
  updateSearchLoadMoreState();

  const result = await catalogRepository.searchByTitle(term, {
    mediaType: readSearchMediaType(),
    pageSize: SEARCH_PAGE_SIZE,
    cursor: append ? searchView.cursor : null,
  });

  // Respuesta obsoleta (la persona siguió escribiendo): se descarta.
  if (requestId !== searchView.requestId) return;

  searchView.loading = false;
  showSearchLoading(false);

  if (!result || result.ok !== true) {
    // Solo un error real se muestra como error; el estado vacío es
    // para «sin coincidencias» (AC-113).
    showSearchError(
      (result && result.message) || "No se ha podido completar la búsqueda.",
    );
    if (!append) {
      searchView.items = [];
      clearSearchGrid();
    }
    searchView.hasSearched = true;
    updateSearchLoadMoreState();
    renderSearchState();
    return;
  }

  hideSearchError();
  const page = result.value || {};
  const items = Array.isArray(page.items) ? page.items : [];

  if (append) {
    appendSearchItems(items);
  } else {
    searchView.items = items;
    renderSearchGrid();
  }

  const cursor = typeof page.cursor === "string" && page.cursor !== "" ? page.cursor : null;
  searchView.cursor = cursor;
  searchView.hasMore = cursor !== null;
  searchView.hasSearched = true;
  updateSearchLoadMoreState();
  renderSearchState();
}

/** Pinta el grid de `MediaCard` con los resultados (AC-116). */
function renderSearchGrid() {
  const grid = searchViewDom.grid;
  if (!grid) return;
  // Mismo componente y mismos estilos que el catálogo (AC-116).
  mountMediaCards(grid, searchView.items, mediaCardOptions());
}

/**
 * Concatena la página siguiente al listado SIN recargar la vista.
 * Los duplicados por id se descartan.
 * @param {object[]} items
 */
function appendSearchItems(items) {
  const grid = searchViewDom.grid;
  if (!grid || items.length === 0) return;
  const known = new Set(searchView.items.map((item) => item.id));
  const fresh = items.filter((item) => item && !known.has(item.id));
  if (fresh.length === 0) return;
  const fragment = document.createDocumentFragment();
  for (const item of fresh) {
    fragment.appendChild(createMediaCard(item, mediaCardOptions()));
  }
  grid.appendChild(fragment);
  searchView.items = searchView.items.concat(fresh);
}

/** Vacía el grid de resultados. */
function clearSearchGrid() {
  if (searchViewDom.grid) searchViewDom.grid.replaceChildren();
}

/**
 * Pinta el estado de la vista: estado vacío «Sin resultados»
 * (UI-03, AC-113), contador y mensaje de estado.
 */
function renderSearchState() {
  const hasItems = searchView.items.length > 0;
  if (searchViewDom.empty) {
    // Estado vacío «Sin resultados»: visible solo tras una búsqueda
    // sin coincidencias (AC-113).
    searchViewDom.empty.hidden = hasItems || !searchView.hasSearched || searchView.loading;
    if (searchViewDom.emptyText) searchViewDom.emptyText.textContent = SEARCH_EMPTY_TEXT;
  }
  if (searchViewDom.status) {
    if (searchView.loading) {
      searchViewDom.status.textContent = "Buscando…";
    } else if (hasItems) {
      searchViewDom.status.textContent = `${searchView.items.length} resultado${
        searchView.items.length === 1 ? "" : "s"
      }`;
    } else if (searchView.hasSearched) {
      searchViewDom.status.textContent = SEARCH_EMPTY_TEXT;
    } else {
      searchViewDom.status.textContent = "Escribe un título para buscar.";
    }
  }
  if (searchViewDom.count) {
    searchViewDom.count.textContent = hasItems
      ? `${searchView.items.length} título${searchView.items.length === 1 ? "" : "s"}`
      : "";
  }
}

/** Muestra u oculta el botón «Cargar más» según el cursor (API-02). */
function updateSearchLoadMoreState() {
  if (searchViewDom.loadMoreWrap) {
    searchViewDom.loadMoreWrap.hidden = !searchView.hasMore;
  }
  if (searchViewDom.loadMoreBtn) {
    searchViewDom.loadMoreBtn.disabled = searchView.loading;
    searchViewDom.loadMoreBtn.textContent = searchView.loading ? "Cargando…" : "Cargar más";
  }
}

/** Muestra u oculta el estado de carga. */
function showSearchLoading(visible) {
  if (searchViewDom.loading) searchViewDom.loading.hidden = !visible;
}

/** Muestra un error de la vista de búsqueda (REQ-E2). */
function showSearchError(message) {
  const error = searchViewDom.error;
  if (!error) return;
  error.textContent = message;
  error.hidden = false;
}

/** Oculta el error de la vista de búsqueda. */
function hideSearchError() {
  const error = searchViewDom.error;
  if (!error) return;
  error.hidden = true;
  error.textContent = "";
}

/**
 * Vacía la vista de búsqueda (logout / cambio de sesión): cancela el
 * temporizador del debounce, invalida la consulta en vuelo y limpia
 * el grid (AC-113: no se muestran resultados de otra sesión).
 */
function resetSearchView() {
  searchView.requestId += 1;
  searchView.loading = false;
  searchView.hasSearched = false;
  searchView.term = "";
  searchView.items = [];
  searchView.cursor = null;
  searchView.hasMore = false;
  clearTimeout(searchView.debounceTimer);
  searchView.debounceTimer = null;
  clearSearchGrid();
  if (searchViewDom.input) searchViewDom.input.value = "";
  updateSearchLoadMoreState();
  renderSearchState();
}

// =============================================================
// T-116 — Alta manual de catálogo (spec 02 UI-04, REQ-105/REQ-108;
// AC-118; 00 §4.1 REQ-E1/REQ-E2/REQ-E3/REQ-E4)
//
//   - Formulario de ALTA MANUAL (UI-04) montado en JS dentro de la
//     vista de catálogo (`#view-catalog`), con un `<details>`
//     accesible (resumen + contenido) para no roba espacio al listado.
//   - Validación ANTES de escribir con `validateMediaItem` (DB-120,
//     UI-04) y mensajes INLINE en español por campo
//     (`aria-invalid` + `aria-describedby`) más un resumen
//     `role="alert"`; el foco va al primer campo con error (REQ-E3).
//   - El guardado usa `CatalogRepository.createMediaItem`
//     (spec 02 §2): el repositorio valida (DB-120) y fuerza
//     `seed: false` (AC-118). Tras guardar se refresca el listado del
//     tipo del ítem, de modo que el título aparece en el catálogo.
//   - IMPORTACIÓN desde APIs externas (REQ-108) con los
//     normalizadores PUROS de `js/api-normalize.js`
//     (`normalizeApiItems` / `normalizeManualMediaItem`): no se
//     duplica ningún normalizador.
//   - REQ-E4: un fallo de API externa NUNCA bloquea el alta manual;
//     solo se muestra un aviso en español y el formulario manual
//     sigue operativo.
// =============================================================

// --- Fuentes externas de importación (REQ-108) ---------------

/**
 * Fuentes externas disponibles para importar títulos al catálogo
 * (REQ-108: TMDB, Google Books, IGDB/Steam). `provider` es la clave
 * que usa `js/api-normalize.js` para elegir el normalizador.
 * @type {ReadonlyArray<{
 *   id: string, label: string, provider: string, mediaType: string,
 *   kind: "search"|"library", search: Function|null, queryLabel: string
 * }>}
 */
const MANUAL_API_SOURCES = Object.freeze([
  {
    id: "tmdb-movie",
    label: "TMDB · Películas",
    provider: "tmdb",
    mediaType: "MOVIE",
    kind: "search",
    search: searchTmdbMovies,
    queryLabel: "Título de la película",
  },
  {
    id: "tmdb-series",
    label: "TMDB · Series",
    provider: "tmdb",
    mediaType: "SERIES",
    kind: "search",
    search: searchTmdbTv,
    queryLabel: "Título de la serie",
  },
  {
    id: "tmdb-anime",
    label: "TMDB · Anime",
    provider: "tmdb",
    mediaType: "ANIME",
    kind: "search",
    search: searchTmdbAnime,
    queryLabel: "Título del anime",
  },
  {
    id: "googlebooks",
    label: "Google Books · Libros",
    provider: "googlebooks",
    mediaType: "BOOK",
    kind: "search",
    search: searchGoogleBooks,
    queryLabel: "Título o autor del libro",
  },
  {
    id: "igdb",
    label: "IGDB · Videojuegos",
    provider: "igdb",
    mediaType: "GAME",
    kind: "search",
    search: searchIgdbGames,
    queryLabel: "Nombre del videojuego",
  },
  {
    id: "steam",
    label: "Steam · Biblioteca",
    provider: "steam",
    mediaType: "GAME",
    kind: "library",
    search: null,
    queryLabel: "SteamID64 (17 dígitos)",
  },
]);

/**
 * Campos del formulario de alta manual por tipo de medio (DB-102):
 * cada `metadata.kind` tiene sus campos (duración, episodios,
 * páginas o plataformas).
 * @type {Readonly<Record<string, string[]>>}
 */
const MANUAL_ADD_TYPE_FIELDS = Object.freeze({
  durationMinutes: ["MOVIE", "AUDIOBOOK"],
  totalEpisodes: ["SERIES", "ANIME"],
  currentAvailable: ["SERIES", "ANIME"],
  totalPages: ["BOOK", "MANGA"],
  totalChapters: ["BOOK", "MANGA"],
  platforms: ["GAME"],
  totalHours: ["GAME"],
});

/**
 * Clave de `metadata` (DB-102) que rellena cada campo del formulario
 * de alta manual. Se listan los alias admitidos para que el prefi-
 * llenado desde una API externa (`prefillManualForm`) use la misma
 * clave que lee el formulario (`readManualInput`): `pagesTotal` y
 * `playtimeHours` son los nombres del `MediaItemInput` en bruto.
 * @type {Readonly<Record<string, string[]>>}
 */
const MANUAL_ADD_METADATA_KEYS = Object.freeze({
  durationMinutes: ["durationMinutes"],
  totalEpisodes: ["totalEpisodes"],
  currentAvailable: ["currentAvailable"],
  totalPages: ["totalPages", "pagesTotal"],
  totalChapters: ["totalChapters"],
  platforms: ["platforms"],
  totalHours: ["totalHours", "playtimeHours"],
});

/**
 * Reglas de asignación de los errores de `validateMediaItem`
 * (DB-120) a los campos del formulario. El texto de los mensajes es
 * el que produce el validador (español, REQ-C5). Cada patrón acepta
 * el nombre técnico del campo y su forma en español (`plataformas?`
 * cubre «Cada plataforma debe ser texto.»).
 * @type {ReadonlyArray<{field: string, pattern: RegExp}>}
 */
const MANUAL_ADD_ERROR_RULES = Object.freeze([
  { field: "mediaType", pattern: /mediaType|tipo de medio/i },
  { field: "title", pattern: /t[ií]tulo/i },
  { field: "coverUrl", pattern: /portada|coverUrl/i },
  { field: "releaseYear", pattern: /a[ñn]o de estreno|releaseYear/i },
  { field: "genres", pattern: /g[ée]nero/i },
  { field: "avgRating", pattern: /valoraci[óo]n media|avgRating/i },
  { field: "creator", pattern: /creador|creator/i },
  { field: "synopsis", pattern: /sinopsis/i },
  { field: "durationMinutes", pattern: /durationMinutes|duraci[óo]n/i },
  // «Episodios disponibles» es más específico: se comprueba antes que
  // el total de episodios para que el mensaje caiga en su campo.
  { field: "currentAvailable", pattern: /currentAvailable|episodios disponibles/i },
  { field: "totalEpisodes", pattern: /totalEpisodes|episodios/i },
  { field: "totalPages", pattern: /totalPages|p[áa]ginas/i },
  { field: "totalChapters", pattern: /totalChapters|cap[íi]tulos/i },
  { field: "platforms", pattern: /platforms|plataformas?/i },
  { field: "totalHours", pattern: /totalHours|horas/i },
]);

/**
 * Estado del formulario de alta manual (T-116).
 * @type {{
 *   mounted: boolean,
 *   submitting: boolean,
 *   searching: boolean,
 *   requestId: number,
 *   apiItems: object[],
 *   apiSource: object,
 *   apiImportButtons: Map<number, HTMLElement>,
 *   apiImporting: Set<number>,
 *   apiImported: Set<number>,
 *   apiImportedKeys: Set<string>,
 *   lastItem: object|null
 * }}
 */
const manualAddState = {
  /** ¿El panel ya está montado en el DOM? */
  mounted: false,
  /** ¿Hay un alta manual en curso? */
  submitting: false,
  /** ¿Hay una consulta a una API externa en curso? */
  searching: false,
  /** Token de petición: descarta respuestas obsoletas. */
  requestId: 0,
  /** `MediaItemInput[]` normalizados de la última búsqueda. */
  apiItems: [],
  /** Fuente externa seleccionada. */
  apiSource: MANUAL_API_SOURCES[0],
  /** Botón «Añadir al catálogo» de cada resultado, por índice. */
  apiImportButtons: new Map(),
  /** Índices con una importación en curso (botón deshabilitado). */
  apiImporting: new Set(),
  /** Índices ya importados (botón deshabilitado y marcado). */
  apiImported: new Set(),
  /**
   * Claves de los ítems ya importados (T-116). Es PERSISTENTE: no se
   * vacía al cambiar de búsqueda, de modo que un mismo título no se
   * vuelve a ofrecer ni a escribir. Clave: `id:<id>` si hay id y, si
   * no, `title:<mediaType>:<normalizeTitle(title)>`.
   */
  apiImportedKeys: new Set(),
  /** Último ítem guardado (acción «Ver en el listado»). */
  lastItem: null,
};

/** Referencias DOM del formulario de alta manual (se rellenan al montar). */
const manualAddDom = {
  details: null,
  form: null,
  errors: null,
  status: null,
  statusText: null,
  statusAction: null,
  submit: null,
  reset: null,
  /** Campos con su mensaje de error inline: { campo: {input, error} }. */
  fields: {},
  /** Contenedor de los campos según el tipo de medio. */
  typeFields: null,
  apiForm: null,
  apiProvider: null,
  apiQuery: null,
  apiQueryLabel: null,
  apiSubmit: null,
  apiStatus: null,
  apiWarning: null,
  apiResults: null,
};

/**
 * Crea un campo del formulario (label + control + error inline).
 * @param {{id: string, label: string, type?: string, placeholder?: string, required?: boolean, hint?: string}} options
 * @returns {{field: HTMLElement, input: HTMLElement, error: HTMLElement}}
 */
function createManualField(options) {
  const { id, label, type = "text", placeholder = "", required = false } = options;
  const field = createCatalogElement("label", "catalog-view__field catalog-view__manual-field");
  field.setAttribute("for", id);
  field.appendChild(createCatalogElement("span", "catalog-view__label", label));

  const input = document.createElement("input");
  input.type = type;
  input.id = id;
  input.className = "form-field__input catalog-view__input";
  if (placeholder !== "") input.placeholder = placeholder;
  if (required) input.required = true;

  const errorId = `${id}-error`;
  const error = createCatalogElement("span", "catalog-view__field-error");
  error.id = errorId;
  error.hidden = true;
  input.setAttribute("aria-describedby", errorId);

  field.append(input, error);
  return { field, input, error };
}

/**
 * Monta el panel de alta manual dentro del panel del catálogo (UI-04).
 * El marcado vive en JS (sin `index.html`) para no tocar el shell.
 * @param {HTMLElement} parent Contenedor del panel de catálogo.
 */
function mountManualAddPanel(parent) {
  if (manualAddState.mounted || !parent) return;

  // --- Disclosure accesible -----------------------------------
  const details = createCatalogElement("details", "catalog-view__manual");
  details.id = "catalog-manual-add";
  const summary = createCatalogElement(
    "summary",
    "catalog-view__manual-summary",
    "Alta manual de un título",
  );
  summary.id = "catalog-manual-summary";
  details.appendChild(summary);

  const body = createCatalogElement("div", "catalog-view__manual-body");
  details.appendChild(body);

  body.appendChild(
    createCatalogElement(
      "p",
      "muted catalog-view__manual-hint",
      "Da de alta un título que no exista en el catálogo ni en las APIs externas.",
    ),
  );

  // --- Formulario de alta manual (UI-04) ---------------------
  const form = document.createElement("form");
  form.id = "catalog-manual-form";
  form.className = "catalog-view__manual-form";
  form.noValidate = true;

  const errors = createCatalogElement("div", "form-errors");
  errors.id = "catalog-manual-errors";
  errors.setAttribute("role", "alert");
  errors.hidden = true;
  form.appendChild(errors);

  const grid = createCatalogElement("div", "catalog-view__manual-grid");

  // Tipo de medio (7 tipos, DB-101).
  const typeField = createCatalogElement(
    "label",
    "catalog-view__field catalog-view__manual-field",
  );
  typeField.setAttribute("for", "catalog-manual-media-type");
  typeField.appendChild(
    createCatalogElement("span", "catalog-view__label", "Tipo de medio *"),
  );
  const mediaTypeSelect = document.createElement("select");
  mediaTypeSelect.id = "catalog-manual-media-type";
  mediaTypeSelect.className = "form-field__select catalog-view__input";
  for (const mediaType of CATALOG_MEDIA_TYPES) {
    const option = document.createElement("option");
    option.value = mediaType;
    option.textContent = CATALOG_MEDIA_TYPE_LABELS[mediaType] ?? mediaType;
    mediaTypeSelect.appendChild(option);
  }
  const typeError = createCatalogElement("span", "catalog-view__field-error");
  typeError.id = "catalog-manual-media-type-error";
  typeError.hidden = true;
  mediaTypeSelect.setAttribute("aria-describedby", typeError.id);
  typeField.append(mediaTypeSelect, typeError);
  grid.appendChild(typeField);

  // Título (obligatorio, DB-101).
  const titleField = createManualField({
    id: "catalog-manual-title",
    label: "Título *",
    type: "text",
    placeholder: "El Último Signo",
    required: true,
  });
  grid.appendChild(titleField.field);

  const yearField = createManualField({
    id: "catalog-manual-release-year",
    label: "Año de estreno",
    type: "number",
    placeholder: "2020",
  });
  grid.appendChild(yearField.field);

  const ratingField = createManualField({
    id: "catalog-manual-avg-rating",
    label: "Valoración media (0-10)",
    type: "number",
    placeholder: "8.5",
  });
  grid.appendChild(ratingField.field);

  const genresField = createManualField({
    id: "catalog-manual-genres",
    label: "Géneros (separados por comas)",
    type: "text",
    placeholder: "Ciencia ficción, Drama",
  });
  grid.appendChild(genresField.field);

  const creatorField = createManualField({
    id: "catalog-manual-creator",
    label: "Creador",
    type: "text",
    placeholder: "Nombre del autor o director",
  });
  grid.appendChild(creatorField.field);

  const coverField = createManualField({
    id: "catalog-manual-cover-url",
    label: "Portada (URL)",
    type: "url",
    placeholder: "https://…",
  });
  grid.appendChild(coverField.field);

  // Campos según el tipo de medio (DB-102).
  const typeFields = createCatalogElement("div", "catalog-view__manual-grid");
  const durationField = createManualField({
    id: "catalog-manual-duration",
    label: "Duración (minutos)",
    type: "number",
    placeholder: "120",
  });
  const episodesField = createManualField({
    id: "catalog-manual-total-episodes",
    label: "Episodios totales",
    type: "number",
    placeholder: "12",
  });
  const availableField = createManualField({
    id: "catalog-manual-current-episodes",
    label: "Episodios disponibles",
    type: "number",
    placeholder: "12",
  });
  const pagesField = createManualField({
    id: "catalog-manual-total-pages",
    label: "Páginas totales",
    type: "number",
    placeholder: "320",
  });
  const chaptersField = createManualField({
    id: "catalog-manual-total-chapters",
    label: "Capítulos totales",
    type: "number",
    placeholder: "24",
  });
  const platformsField = createManualField({
    id: "catalog-manual-platforms",
    label: "Plataformas (separadas por comas)",
    type: "text",
    placeholder: "PC, Switch",
  });
  const hoursField = createManualField({
    id: "catalog-manual-total-hours",
    label: "Horas jugadas",
    type: "number",
    placeholder: "40",
  });
  typeFields.append(
    durationField.field,
    episodesField.field,
    availableField.field,
    pagesField.field,
    chaptersField.field,
    platformsField.field,
    hoursField.field,
  );

  const synopsisField = createCatalogElement(
    "label",
    "catalog-view__field catalog-view__manual-field",
  );
  synopsisField.setAttribute("for", "catalog-manual-synopsis");
  synopsisField.appendChild(
    createCatalogElement("span", "catalog-view__label", "Sinopsis"),
  );
  const synopsisInput = document.createElement("textarea");
  synopsisInput.id = "catalog-manual-synopsis";
  synopsisInput.className = "form-field__textarea catalog-view__input";
  synopsisInput.rows = 3;
  synopsisInput.placeholder = "Resumen del título";
  const synopsisError = createCatalogElement("span", "catalog-view__field-error");
  synopsisError.id = "catalog-manual-synopsis-error";
  synopsisError.hidden = true;
  synopsisInput.setAttribute("aria-describedby", synopsisError.id);
  synopsisField.append(synopsisInput, synopsisError);
  grid.appendChild(synopsisField);

  form.append(grid, typeFields);

  // Estado (éxito) + acción «Ver en el listado».
  const status = createCatalogElement("div", "catalog-view__manual-status");
  status.id = "catalog-manual-status";
  // `role="status"` ya anuncia los cambios: no hace falta `aria-live`.
  status.setAttribute("role", "status");
  status.hidden = true;
  const statusText = createCatalogElement("p", "catalog-view__manual-status-text");
  statusText.id = "catalog-manual-status-text";
  const statusAction = createCatalogElement(
    "button",
    "btn btn--secondary",
    "Ver en el listado",
  );
  statusAction.type = "button";
  statusAction.id = "catalog-manual-status-action";
  statusAction.hidden = true;
  status.append(statusText, statusAction);
  form.appendChild(status);

  const actions = createCatalogElement("div", "catalog-view__manual-actions");
  const submitButton = createCatalogElement(
    "button",
    "btn btn--primary",
    "Guardar en el catálogo",
  );
  submitButton.type = "submit";
  submitButton.id = "catalog-manual-submit";
  const resetButton = createCatalogElement("button", "btn", "Limpiar formulario");
  resetButton.type = "button";
  resetButton.id = "catalog-manual-reset";
  actions.append(submitButton, resetButton);
  form.appendChild(actions);

  body.appendChild(form);

  // --- Importación desde APIs externas (REQ-108) --------------
  const apiSection = createCatalogElement(
    "section",
    "catalog-view__manual-api",
  );
  apiSection.setAttribute("aria-labelledby", "catalog-manual-api-title");
  apiSection.appendChild(
    createCatalogElement(
      "h4",
      "catalog-view__manual-subtitle",
      "Importar desde una API externa",
    ),
  );
  apiSection.querySelector("h4").id = "catalog-manual-api-title";

  const apiForm = document.createElement("form");
  apiForm.id = "catalog-manual-api-form";
  apiForm.className = "catalog-view__manual-api-form";
  apiForm.noValidate = true;

  const providerField = createCatalogElement(
    "label",
    "catalog-view__field catalog-view__manual-field",
  );
  providerField.setAttribute("for", "catalog-manual-api-provider");
  providerField.appendChild(
    createCatalogElement("span", "catalog-view__label", "Origen"),
  );
  const providerSelect = document.createElement("select");
  providerSelect.id = "catalog-manual-api-provider";
  providerSelect.className = "form-field__select catalog-view__input";
  for (const source of MANUAL_API_SOURCES) {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.label;
    providerSelect.appendChild(option);
  }
  providerField.appendChild(providerSelect);

  const queryField = createCatalogElement(
    "label",
    "catalog-view__field catalog-view__manual-field",
  );
  queryField.setAttribute("for", "catalog-manual-api-query");
  const queryLabel = createCatalogElement(
    "span",
    "catalog-view__label",
    MANUAL_API_SOURCES[0].queryLabel,
  );
  queryField.appendChild(queryLabel);
  const queryInput = document.createElement("input");
  queryInput.type = "search";
  queryInput.id = "catalog-manual-api-query";
  queryInput.className = "form-field__input catalog-view__input";
  queryInput.autocomplete = "off";
  queryField.appendChild(queryInput);

  const apiSubmit = createCatalogElement("button", "btn btn--secondary", "Buscar");
  apiSubmit.type = "submit";
  apiSubmit.id = "catalog-manual-api-submit";

  apiForm.append(providerField, queryField, apiSubmit);

  const apiStatus = createCatalogElement("p", "catalog-view__manual-api-status");
  apiStatus.id = "catalog-manual-api-status";
  // `role="status"` ya anuncia los cambios: no hace falta `aria-live`.
  apiStatus.setAttribute("role", "status");

  const apiWarning = createCatalogElement(
    "p",
    "catalog-view__manual-api-warning",
  );
  apiWarning.id = "catalog-manual-api-warning";
  apiWarning.setAttribute("role", "alert");
  apiWarning.hidden = true;

  const apiResults = document.createElement("ul");
  apiResults.id = "catalog-manual-api-results";
  apiResults.className = "catalog-view__manual-api-results";

  apiSection.append(apiForm, apiStatus, apiWarning, apiResults);
  body.appendChild(apiSection);

  parent.appendChild(details);

  // --- Referencias y eventos ----------------------------------
  manualAddDom.details = details;
  manualAddDom.form = form;
  manualAddDom.errors = errors;
  manualAddDom.status = status;
  manualAddDom.statusText = statusText;
  manualAddDom.statusAction = statusAction;
  manualAddDom.submit = submitButton;
  manualAddDom.reset = resetButton;
  manualAddDom.typeFields = typeFields;
  manualAddDom.apiForm = apiForm;
  manualAddDom.apiProvider = providerSelect;
  manualAddDom.apiQuery = queryInput;
  manualAddDom.apiQueryLabel = queryLabel;
  manualAddDom.apiSubmit = apiSubmit;
  manualAddDom.apiStatus = apiStatus;
  manualAddDom.apiWarning = apiWarning;
  manualAddDom.apiResults = apiResults;

  manualAddDom.fields = {
    mediaType: { input: mediaTypeSelect, error: typeError },
    title: { input: titleField.input, error: titleField.error },
    releaseYear: { input: yearField.input, error: yearField.error },
    avgRating: { input: ratingField.input, error: ratingField.error },
    genres: { input: genresField.input, error: genresField.error },
    creator: { input: creatorField.input, error: creatorField.error },
    coverUrl: { input: coverField.input, error: coverField.error },
    synopsis: { input: synopsisInput, error: synopsisError },
    durationMinutes: { input: durationField.input, error: durationField.error },
    totalEpisodes: { input: episodesField.input, error: episodesField.error },
    currentAvailable: { input: availableField.input, error: availableField.error },
    totalPages: { input: pagesField.input, error: pagesField.error },
    totalChapters: { input: chaptersField.input, error: chaptersField.error },
    platforms: { input: platformsField.input, error: platformsField.error },
    totalHours: { input: hoursField.input, error: hoursField.error },
  };

  form.addEventListener("submit", handleManualSubmit);
  resetButton.addEventListener("click", handleManualReset);
  statusAction.addEventListener("click", handleManualStatusAction);
  mediaTypeSelect.addEventListener("change", handleManualTypeChange);
  providerSelect.addEventListener("change", handleManualApiSourceChange);
  apiForm.addEventListener("submit", handleManualApiSubmit);

  manualAddState.mounted = true;
  manualAddState.apiSource = MANUAL_API_SOURCES[0];
  providerSelect.value = manualAddState.apiSource.id;
  // El tipo por defecto es el de la pestaña activa del catálogo.
  syncManualMediaType(catalogView.mediaType);
}

/**
 * Mantiene el selector de tipo del formulario alineado con la
 * pestaña activa del catálogo (DB-101) y refresca los campos por
 * tipo (DB-102).
 * @param {string} mediaType
 */
function syncManualMediaType(mediaType) {
  const select = manualAddDom.fields.mediaType?.input;
  if (!select) return;
  if (typeof mediaType === "string" && CATALOG_MEDIA_TYPES.includes(mediaType)) {
    select.value = mediaType;
  }
  renderManualTypeFields(select.value);
}

/**
 * Muestra u oculta los campos del tipo de medio (DB-102).
 * @param {string} mediaType
 */
function renderManualTypeFields(mediaType) {
  for (const [field, types] of Object.entries(MANUAL_ADD_TYPE_FIELDS)) {
    const target = manualAddDom.fields[field];
    if (!target || !target.input) continue;
    const visible = types.includes(mediaType);
    target.input.hidden = !visible;
    const wrapper = target.input.closest(".catalog-view__field");
    if (wrapper) wrapper.hidden = !visible;
  }
}

/** Cambio de tipo de medio: refresca los campos específicos (DB-102). */
function handleManualTypeChange() {
  const select = manualAddDom.fields.mediaType?.input;
  if (!select) return;
  renderManualTypeFields(select.value);
}

/** Número del formulario: vacío ⇒ `null` (sin valor). */
function readManualNumber(input) {
  if (!input) return null;
  const raw = typeof input.value === "string" ? input.value.trim() : "";
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Lista del formulario: texto separado por comas. */
function readManualList(input) {
  if (!input) return [];
  const raw = typeof input.value === "string" ? input.value : "";
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * Lee el formulario de alta manual y devuelve el `MediaItemInput` en
 * bruto (sin normalizar). La normalización y la validación final son
 * de `js/api-normalize.js` y `validateMediaItem` (DB-120).
 * @returns {object}
 */
function readManualInput() {
  const fields = manualAddDom.fields;
  const mediaType = fields.mediaType?.input?.value ?? "MOVIE";
  const currentAvailable = readManualNumber(fields.currentAvailable?.input);
  const input = {
    mediaType,
    title: fields.title?.input?.value?.trim() ?? "",
    coverUrl: fields.coverUrl?.input?.value?.trim() || null,
    releaseYear: readManualNumber(fields.releaseYear?.input),
    genres: readManualList(fields.genres?.input),
    avgRating: readManualNumber(fields.avgRating?.input),
    creator: fields.creator?.input?.value?.trim() || null,
    synopsis: fields.synopsis?.input?.value?.trim() || null,
    durationMinutes: readManualNumber(fields.durationMinutes?.input),
    totalEpisodes: readManualNumber(fields.totalEpisodes?.input),
    pagesTotal: readManualNumber(fields.totalPages?.input),
    totalChapters: readManualNumber(fields.totalChapters?.input),
    platforms: readManualList(fields.platforms?.input),
    playtimeHours: readManualNumber(fields.totalHours?.input),
  };
  // `currentAvailable` solo existe en el `metadata.kind` "episodes"
  // (DB-102); se pasa explícito para que sobreviva a la normalización.
  if (currentAvailable !== null && MANUAL_ADD_TYPE_FIELDS.currentAvailable.includes(mediaType)) {
    input.currentAvailable = currentAvailable;
    input.metadata = { currentAvailable };
  }
  return input;
}

/** Limpia los errores inline de todos los campos. */
function clearManualFieldErrors() {
  for (const target of Object.values(manualAddDom.fields)) {
    if (!target) continue;
    target.error.textContent = "";
    target.error.hidden = true;
    target.input.removeAttribute("aria-invalid");
  }
}

/** Oculta el resumen de errores y los errores inline. */
function clearManualErrors() {
  if (manualAddDom.errors) {
    manualAddDom.errors.hidden = true;
    manualAddDom.errors.replaceChildren();
  }
  clearManualFieldErrors();
}

/**
 * Muestra los errores de validación EN LÍNEA y en español (REQ-E3):
 * un mensaje por campo (`aria-invalid` + `aria-describedby`), un
 * resumen con `role="alert"` y el foco en el primer campo con error.
 * @param {string[]} errors
 */
function showManualErrors(errors) {
  const messages = (Array.isArray(errors) ? errors : []).filter(
    (message) => typeof message === "string" && message.trim() !== "",
  );
  clearManualErrors();

  const byField = new Map();
  for (const message of messages) {
    const rule = MANUAL_ADD_ERROR_RULES.find((candidate) =>
      candidate.pattern.test(message),
    );
    if (!rule) continue;
    const bucket = byField.get(rule.field) ?? [];
    bucket.push(message);
    byField.set(rule.field, bucket);
  }

  for (const [field, bucket] of byField) {
    const target = manualAddDom.fields[field];
    if (!target) continue;
    target.error.textContent = bucket.join(" ");
    target.error.hidden = false;
    target.input.setAttribute("aria-invalid", "true");
  }

  if (manualAddDom.errors) {
    const list = document.createElement("ul");
    for (const message of messages) {
      const item = document.createElement("li");
      item.textContent = message;
      list.appendChild(item);
    }
    manualAddDom.errors.replaceChildren(list);
    manualAddDom.errors.hidden = messages.length === 0;
  }

  const firstField = byField.keys().next();
  const firstTarget =
    firstField.done === false ? manualAddDom.fields[firstField.value] : null;
  if (firstTarget && typeof firstTarget.input.focus === "function") {
    firstTarget.input.focus();
  }
}

/**
 * Muestra un mensaje de estado del formulario (éxito o aviso).
 * @param {string} message
 * @param {"success"|"info"|"error"} [kind]
 * @param {object|null} [item] Ítem guardado (acción «Ver en el listado»).
 */
function showManualStatus(message, kind = "info", item = null) {
  if (!manualAddDom.status || !manualAddDom.statusText) return;
  manualAddDom.statusText.textContent = message;
  manualAddDom.status.classList.remove(
    "catalog-view__manual-status--success",
    "catalog-view__manual-status--error",
  );
  if (kind === "success") {
    manualAddDom.status.classList.add("catalog-view__manual-status--success");
  } else if (kind === "error") {
    manualAddDom.status.classList.add("catalog-view__manual-status--error");
  }
  manualAddDom.status.hidden = false;

  manualAddState.lastItem = item && typeof item === "object" ? item : null;
  if (manualAddDom.statusAction) {
    manualAddDom.statusAction.hidden = manualAddState.lastItem === null;
  }
}

/** Oculta el mensaje de estado. */
function hideManualStatus() {
  if (manualAddDom.status) {
    manualAddDom.status.hidden = true;
    manualAddDom.status.classList.remove(
      "catalog-view__manual-status--success",
      "catalog-view__manual-status--error",
    );
  }
  if (manualAddDom.statusText) manualAddDom.statusText.textContent = "";
  if (manualAddDom.statusAction) {
    manualAddDom.statusAction.hidden = true;
  }
  manualAddState.lastItem = null;
}

/**
 * Envío del alta manual (UI-04, REQ-105, AC-118):
 * valida con `validateMediaItem` (DB-120), normaliza con
 * `normalizeManualMediaItem` (REQ-108) y guarda con
 * `CatalogRepository.createMediaItem` (spec 02 §2), que fuerza
 * `seed: false` (AC-118).
 * @param {Event} event
 */
async function handleManualSubmit(event) {
  event.preventDefault();
  if (manualAddState.submitting) return;

  clearManualErrors();
  hideManualStatus();

  const input = readManualInput();

  // UI-04 / DB-120: validación ANTES de escribir (REQ-E3).
  // La pre-comprobación usa el valor EN BRUTO a propósito: el
  // normalizador trunca géneros/sinopsis antes de volver a validar.
  const metadata = buildMediaMetadata(input.mediaType, input);
  const report = validateMediaItem({ ...input, metadata });
  if (!report.valid) {
    showManualErrors(report.errors);
    return;
  }

  // Normalizador PURO de `js/api-normalize.js` (sin duplicar lógica).
  const normalized = normalizeManualMediaItem(input);
  if (!normalized || normalized.ok !== true) {
    showManualErrors(
      normalized && Array.isArray(normalized.errors) && normalized.errors.length > 0
        ? normalized.errors
        : [(normalized && normalized.message) || "No se ha podido validar el título."],
    );
    return;
  }

  manualAddState.submitting = true;
  setManualSubmitting(true);
  try {
    const result = await catalogRepository.createMediaItem(normalized.value);
    if (!result || result.ok !== true) {
      showManualErrors(
        result && Array.isArray(result.errors) && result.errors.length > 0
          ? result.errors
          : [(result && result.message) || "No se ha podido guardar el título."],
      );
      return;
    }
    const saved = result.value;
    showManualStatus(
      `«${saved.title}» se ha guardado en el catálogo (${mediaTypeLabel(saved.mediaType)}).`,
      "success",
      saved,
    );
    resetManualForm();
    refreshCatalogAfterCreate(saved);
  } finally {
    manualAddState.submitting = false;
    setManualSubmitting(false);
  }
}

/** Estado visual del botón de guardado durante el alta. */
function setManualSubmitting(submitting) {
  if (!manualAddDom.submit) return;
  manualAddDom.submit.disabled = submitting;
  manualAddDom.submit.textContent = submitting ? "Guardando…" : "Guardar en el catálogo";
}

/** Vacía los campos del formulario (sin tocar el tipo elegido). */
function resetManualForm() {
  const fields = manualAddDom.fields;
  for (const [name, target] of Object.entries(fields)) {
    if (name === "mediaType" || !target || !target.input) continue;
    target.input.value = "";
  }
  clearManualErrors();
}

/** Botón «Limpiar formulario». */
function handleManualReset() {
  resetManualForm();
  hideManualStatus();
  const title = manualAddDom.fields.title?.input;
  if (title && typeof title.focus === "function") title.focus();
}

/**
 * Refresca el listado tras un alta (AC-118): el título guardado
 * aparece en el listado del catálogo (tipo activo o el tipo del
 * ítem recién creado).
 * @param {object} item
 */
function refreshCatalogAfterCreate(item) {
  const mediaType = item && typeof item.mediaType === "string" ? item.mediaType : null;
  if (
    mediaType &&
    CATALOG_MEDIA_TYPES.includes(mediaType) &&
    mediaType !== catalogView.mediaType
  ) {
    // Cambia de tipo y vuelve a leer la primera página (REQ-101).
    selectCatalogType(mediaType);
    return;
  }
  resetCatalogPaging();
  void loadCatalogPage({ append: false });
}

/** «Ver en el listado»: abre la búsqueda con el título guardado. */
function handleManualStatusAction() {
  const item = manualAddState.lastItem;
  if (!item || typeof item.title !== "string") return;
  const title = item.title.trim();
  if (title === "") return;
  searchView.term = title;
  if (searchViewDom.input) searchViewDom.input.value = title;
  showAppView("search");
}

// --- Importación desde APIs externas (REQ-108) ----------------

/** Cambia la fuente externa y actualiza la etiqueta del campo. */
function handleManualApiSourceChange() {
  const select = manualAddDom.apiProvider;
  if (!select) return;
  const source = MANUAL_API_SOURCES.find((candidate) => candidate.id === select.value);
  if (!source) return;
  manualAddState.apiSource = source;
  if (manualAddDom.apiQueryLabel) {
    manualAddDom.apiQueryLabel.textContent = source.queryLabel;
  }
  if (manualAddDom.apiQuery) {
    manualAddDom.apiQuery.type = source.kind === "library" ? "text" : "search";
    manualAddDom.apiQuery.placeholder =
      source.kind === "library" ? "76561198000000000" : "Escribe el título…";
  }
  if (manualAddDom.apiSubmit) {
    manualAddDom.apiSubmit.textContent = source.kind === "library" ? "Importar" : "Buscar";
  }
  clearManualApiResults();
}

/** Vacía los resultados de la importación anterior. */
function clearManualApiResults() {
  manualAddState.apiItems = [];
  manualAddState.apiImportButtons.clear();
  manualAddState.apiImporting.clear();
  manualAddState.apiImported.clear();
  // `apiImportedKeys` NO se vacía aquí: la guarda de duplicados es
  // persistente entre búsquedas (T-116).
  if (manualAddDom.apiResults) manualAddDom.apiResults.replaceChildren();
  if (manualAddDom.apiStatus) manualAddDom.apiStatus.textContent = "";
  if (manualAddDom.apiWarning) {
    manualAddDom.apiWarning.hidden = true;
    manualAddDom.apiWarning.textContent = "";
  }
}

/**
 * Clave estable de un resultado de API externa para detectar
 * duplicados entre búsquedas (T-116): `id:<id>` cuando el ítem trae
 * id y, si no, `title:<mediaType>:<normalizeTitle(title)>` (DB-121).
 * @param {object} input `MediaItemInput` normalizado.
 * @returns {string} clave; `""` si no hay datos suficientes.
 */
function manualApiImportKey(input) {
  if (!input || typeof input !== "object") return "";
  const rawId = input.id;
  const id =
    typeof rawId === "string"
      ? rawId.trim()
      : typeof rawId === "number" && Number.isFinite(rawId)
        ? String(rawId)
        : "";
  if (id !== "") return `id:${id}`;
  const mediaType =
    typeof input.mediaType === "string" ? input.mediaType.trim() : "";
  const title =
    typeof input.title === "string" ? normalizeTitle(input.title) : "";
  if (mediaType === "" && title === "") return "";
  return `title:${mediaType}:${title}`;
}

/**
 * Avisa de un fallo de la API externa (REQ-E4): el aviso NUNCA
 * bloquea el alta manual, que sigue disponible.
 * @param {string} message
 */
function showManualApiWarning(message) {
  if (!manualAddDom.apiWarning) return;
  manualAddDom.apiWarning.textContent = `${message} Puedes dar de alta el título manualmente.`;
  manualAddDom.apiWarning.hidden = false;
}

/**
 * Busca en la API externa elegida y normaliza los resultados con
 * `normalizeApiItems` (REQ-108). Un fallo devuelve un aviso en
 * español y NO bloquea el alta manual (REQ-E4).
 * @param {Event} event
 */
async function handleManualApiSubmit(event) {
  event.preventDefault();
  if (manualAddState.searching) return;

  const source = manualAddState.apiSource;
  const query =
    manualAddDom.apiQuery && typeof manualAddDom.apiQuery.value === "string"
      ? manualAddDom.apiQuery.value.trim()
      : "";

  clearManualApiResults();

  if (query === "") {
    showManualApiWarning(
      source.kind === "library"
        ? "Escribe tu SteamID64 para importar la biblioteca."
        : `Escribe un título para buscar en ${source.label}.`,
    );
    return;
  }
  if (source.kind === "library" && !/^\d{17}$/.test(query)) {
    showManualApiWarning("El SteamID64 debe tener 17 dígitos.");
    return;
  }
  if (source.kind === "search" && typeof source.search !== "function") {
    showManualApiWarning("Esa fuente no está disponible.");
    return;
  }

  const requestId = ++manualAddState.requestId;
  manualAddState.searching = true;
  setManualApiBusy(true);

  let response = null;
  try {
    if (source.kind === "library") {
      const library = await fetchOwnedSteamGames(query);
      response = { games: Array.isArray(library?.games) ? library.games : [] };
    } else {
      response = await source.search(query, { limit: 10 });
    }
  } catch (error) {
    const failure = normalizeApiFailure(error, source.provider);
    // Respuesta obsoleta: se descarta sin tocar el estado visible.
    if (requestId !== manualAddState.requestId) return;
    showManualApiWarning(failure.message);
    manualAddState.searching = false;
    setManualApiBusy(false);
    return;
  }

  // Respuesta obsoleta: se descarta.
  if (requestId !== manualAddState.requestId) return;
  manualAddState.searching = false;
  setManualApiBusy(false);

  // Normalización PURA a `MediaItemInput` (REQ-108): los normalizadores
  // viven en `js/api-normalize.js`, no se duplican aquí.
  const normalized = normalizeApiItems(response, {
    provider: source.provider,
    mediaType: source.mediaType,
  });
  if (!normalized || normalized.ok !== true) {
    showManualApiWarning(
      (normalized && normalized.message) || "No se ha podido consultar la API externa.",
    );
    return;
  }

  renderManualApiResults(normalized.value, normalized.skipped);
}

/** Estado visual del botón de consulta externa. */
function setManualApiBusy(busy) {
  if (manualAddDom.apiSubmit) {
    manualAddDom.apiSubmit.disabled = busy;
    const source = manualAddState.apiSource;
    const label = source.kind === "library" ? "Importar" : "Buscar";
    manualAddDom.apiSubmit.textContent = busy ? "Consultando…" : label;
  }
}

/**
 * Pinta los resultados normalizados de la API externa con dos
 * acciones: «Añadir al catálogo» (REQ-108) y «Usar estos datos»
 * (rellena el formulario de alta manual).
 * @param {object[]} items `MediaItemInput[]` ya validados.
 * @param {object[]} [skipped]
 */
function renderManualApiResults(items, skipped = []) {
  const list = manualAddDom.apiResults;
  if (!list) return;

  manualAddState.apiItems = Array.isArray(items) ? items.slice() : [];
  list.replaceChildren();

  if (manualAddState.apiItems.length === 0) {
    const empty = createCatalogElement(
      "li",
      "catalog-view__manual-api-empty",
      "Sin resultados. Puedes dar de alta el título manualmente.",
    );
    list.appendChild(empty);
    if (manualAddDom.apiStatus) {
      manualAddDom.apiStatus.textContent = "Sin resultados.";
    }
    return;
  }

  manualAddState.apiItems.forEach((input, index) => {
    const item = createCatalogElement("li", "catalog-view__manual-api-result");

    const info = createCatalogElement("div", "catalog-view__manual-api-info");
    info.appendChild(
      createCatalogElement(
        "span",
        "catalog-view__manual-api-title",
        input.title || "Sin título",
      ),
    );
    const metaParts = [];
    if (typeof input.releaseYear === "number") metaParts.push(String(input.releaseYear));
    if (Array.isArray(input.genres) && input.genres.length > 0) {
      metaParts.push(input.genres.slice(0, 2).join(", "));
    }
    metaParts.push(mediaTypeLabel(input.mediaType));
    info.appendChild(
      createCatalogElement(
        "span",
        "catalog-view__manual-api-meta",
        metaParts.join(" · "),
      ),
    );

    const actions = createCatalogElement("div", "catalog-view__manual-api-actions");
    const importButton = createCatalogElement(
      "button",
      "btn btn--primary",
      "Añadir al catálogo",
    );
    importButton.type = "button";
    importButton.addEventListener("click", () => {
      void importManualApiItem(index);
    });
    // Se guarda el botón por índice para poder deshabilitarlo y
    // marcarlo al importar (evita dobles imports).
    manualAddState.apiImportButtons.set(index, importButton);
    // T-116: si el título ya se importó en otra búsqueda, el botón
    // aparece ya marcado y no se vuelve a escribir.
    if (manualAddState.apiImportedKeys.has(manualApiImportKey(input))) {
      setManualApiImportState(index, "imported");
    }
    const prefillButton = createCatalogElement(
      "button",
      "btn btn--secondary",
      "Usar estos datos",
    );
    prefillButton.type = "button";
    prefillButton.addEventListener("click", () => {
      prefillManualForm(manualAddState.apiItems[index]);
    });
    actions.append(importButton, prefillButton);

    item.append(info, actions);
    list.appendChild(item);
  });

  if (manualAddDom.apiStatus) {
    const count = manualAddState.apiItems.length;
    const skippedCount = Array.isArray(skipped) ? skipped.length : 0;
    manualAddDom.apiStatus.textContent =
      `${count} resultado${count === 1 ? "" : "s"} para importar` +
      (skippedCount > 0 ? ` · ${skippedCount} descartado${skippedCount === 1 ? "" : "s"}` : "") +
      ".";
  }
}

/**
 * Estado del botón «Añadir al catálogo» de un resultado (T-116):
 * deshabilitado mientras importa y una vez importado.
 * @param {number} index Índice del resultado en `apiItems`.
 * @param {"idle"|"importing"|"imported"} state
 */
function setManualApiImportState(index, state) {
  const button = manualAddState.apiImportButtons.get(index);
  if (!button) return;

  if (state === "importing") {
    manualAddState.apiImporting.add(index);
    manualAddState.apiImported.delete(index);
    button.disabled = true;
    button.dataset.state = "importing";
    button.textContent = "Añadiendo…";
    return;
  }
  if (state === "imported") {
    manualAddState.apiImporting.delete(index);
    manualAddState.apiImported.add(index);
    button.disabled = true;
    button.dataset.state = "imported";
    button.textContent = "Añadido al catálogo";
    return;
  }

  manualAddState.apiImporting.delete(index);
  manualAddState.apiImported.delete(index);
  button.disabled = false;
  button.dataset.state = "idle";
  button.textContent = "Añadir al catálogo";
}

/**
 * Importa un resultado de API externa al catálogo (REQ-108): el
 * `MediaItemInput` viene normalizado, pero se valida ANTES de
 * escribir (DB-120, REQ-E3) y se descartan los duplicados (T-116).
 * @param {number} index
 */
async function importManualApiItem(index) {
  const input = manualAddState.apiItems[index];
  if (!input) return;
  // Guarda de duplicados: un mismo resultado no se importa dos veces.
  if (manualAddState.apiImporting.has(index) || manualAddState.apiImported.has(index)) {
    return;
  }

  // T-116: clave estable del título (`id:<id>` o
  // `title:<mediaType>:<normalizeTitle(title)>`). Si ya se importó en
  // otra búsqueda, NO se vuelve a escribir: se marca y se sale.
  const key = manualApiImportKey(input);
  if (key && manualAddState.apiImportedKeys.has(key)) {
    setManualApiImportState(index, "imported");
    return;
  }

  // Validación ANTES de escribir (DB-120, REQ-E3): un resultado que
  // no pasa el validador NO llega al repositorio. El mensaje es en
  // español y se muestra en línea junto a los resultados.
  const report = validateMediaItem(input);
  if (!report || report.valid !== true) {
    setManualApiImportState(index, "idle");
    const errors = report && Array.isArray(report.errors) ? report.errors : [];
    showManualApiWarning(
      errors.length > 0
        ? `«${input.title || "Sin título"}» no es válido: ${errors.join(" ")}`
        : "El título no es válido y no se ha podido añadir al catálogo.",
    );
    return;
  }

  setManualApiImportState(index, "importing");

  let result = null;
  try {
    result = await catalogRepository.createMediaItem(input);
  } catch (error) {
    setManualApiImportState(index, "idle");
    showManualApiWarning(
      normalizeApiFailure(error, manualAddState.apiSource?.provider).message,
    );
    return;
  }
  if (!result || result.ok !== true) {
    setManualApiImportState(index, "idle");
    showManualApiWarning(
      (result && result.message) || "No se ha podido guardar el título.",
    );
    return;
  }
  const saved = result.value;
  // El título queda registrado para no volver a ofrecerlo ni
  // escribirlo en otra búsqueda (T-116).
  if (key) manualAddState.apiImportedKeys.add(key);
  // El botón queda deshabilitado y marcado: no se puede repetir.
  setManualApiImportState(index, "imported");
  if (manualAddDom.apiStatus) {
    manualAddDom.apiStatus.textContent =
      `«${saved.title}» se ha añadido al catálogo.`;
  }
  showManualStatus(
    `«${saved.title}» se ha guardado en el catálogo (${mediaTypeLabel(saved.mediaType)}).`,
    "success",
    saved,
  );
  refreshCatalogAfterCreate(saved);
}

/**
 * Valor de un campo por tipo de medio: primero `input.metadata`
 * (clave canónica de `MANUAL_ADD_METADATA_KEYS`) y, como respaldo,
 * el nombre en bruto del `MediaItemInput` en el nivel superior
 * (`pagesTotal`, `playtimeHours`).
 * @param {object} input `MediaItemInput` normalizado.
 * @param {object} metadata `metadata` del ítem (o `{}`).
 * @param {string} field Campo del formulario.
 * @returns {unknown}
 */
function readManualMetadataValue(input, metadata, field) {
  const keys = MANUAL_ADD_METADATA_KEYS[field] ?? [field];
  for (const key of keys) {
    if (metadata[key] !== undefined && metadata[key] !== null) return metadata[key];
  }
  for (const key of keys) {
    if (input[key] !== undefined && input[key] !== null) return input[key];
  }
  return null;
}

/**
 * Convierte un valor de `metadata` en el texto del control del
 * formulario: números como texto y listas separadas por comas.
 * @param {unknown} value
 * @returns {string}
 */
function formatManualMetadataValue(value) {
  if (Array.isArray(value)) {
    return value
      .filter((part) => typeof part === "string")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(", ");
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();
  return "";
}

/**
 * Rellena los campos específicos del tipo de medio (duración,
 * episodios, páginas, plataformas…) con los datos de la API externa
 * (REQ-108). Los campos a rellenar los marca `MANUAL_ADD_TYPE_FIELDS`
 * y sus claves son las de `MANUAL_ADD_METADATA_KEYS`.
 * @param {object} input `MediaItemInput` normalizado.
 * @param {string} mediaType Tipo de medio activo en el formulario.
 */
function prefillManualMetadataFields(input, mediaType) {
  if (!input || typeof input !== "object" || typeof mediaType !== "string") return;
  const metadata =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata
      : {};

  for (const [field, types] of Object.entries(MANUAL_ADD_TYPE_FIELDS)) {
    if (!types.includes(mediaType)) continue;
    const target = manualAddDom.fields[field];
    if (!target || !target.input) continue;
    const value = readManualMetadataValue(input, metadata, field);
    target.input.value = value === null ? "" : formatManualMetadataValue(value);
  }
}

/**
 * Rellena el formulario de alta manual con los datos de la API
 * (el guardado sigue siendo manual y validado).
 * @param {object} input `MediaItemInput` normalizado.
 */
function prefillManualForm(input) {
  if (!input || typeof input !== "object") return;
  const fields = manualAddDom.fields;

  if (fields.mediaType?.input && typeof input.mediaType === "string") {
    fields.mediaType.input.value = input.mediaType;
    renderManualTypeFields(input.mediaType);
  }
  if (fields.title?.input) fields.title.input.value = input.title ?? "";
  if (fields.releaseYear?.input) {
    fields.releaseYear.input.value =
      typeof input.releaseYear === "number" ? String(input.releaseYear) : "";
  }
  if (fields.avgRating?.input) {
    fields.avgRating.input.value =
      typeof input.avgRating === "number" ? String(input.avgRating) : "";
  }
  if (fields.genres?.input) {
    fields.genres.input.value = Array.isArray(input.genres) ? input.genres.join(", ") : "";
  }
  if (fields.creator?.input) fields.creator.input.value = input.creator ?? "";
  if (fields.coverUrl?.input) fields.coverUrl.input.value = input.coverUrl ?? "";
  if (fields.synopsis?.input) fields.synopsis.input.value = input.synopsis ?? "";

  // Campos del tipo de medio (duración, episodios, páginas…).
  prefillManualMetadataFields(
    input,
    fields.mediaType?.input?.value ?? input.mediaType ?? "",
  );

  clearManualErrors();
  if (manualAddDom.details) manualAddDom.details.open = true;
  showManualStatus("Formulario relleno con los datos de la API: revísalo y guárdalo.");
  if (fields.title?.input && typeof fields.title.input.focus === "function") {
    fields.title.input.focus();
  }
}

/**
 * Vacía el panel de alta manual (logout / cambio de sesión): no
 * quedan datos escritos ni resultados externos (REQ-E2).
 */
function resetManualAddPanel() {
  manualAddState.requestId += 1;
  manualAddState.submitting = false;
  manualAddState.searching = false;
  resetManualForm();
  hideManualStatus();
  clearManualApiResults();
  if (manualAddDom.details) manualAddDom.details.open = false;
}

// =============================================================
// Spec 003 — Dashboard (REQ-001, UI-001, AC-001, AC-005, D-005)
// =============================================================

async function dashboardUnsubscribeAll() {
  for (const unsub of dashboardUnsubscribes) {
    if (typeof unsub === "function") {
      try { await unsub(); } catch { /* ignore */ }
    }
  }
  dashboardUnsubscribes = [];
  dashboardItemsByType = {};
  // Spec 004: cancelar suscripción a capítulos del dashboard
  if (typeof dashboardChaptersUnsubscribe === "function") {
    try { await dashboardChaptersUnsubscribe(); } catch { /* ignore */ }
    dashboardChaptersUnsubscribe = null;
  }
  dashboardFavoriteChapters = [];
}

// --- Favoritos (spec 004) -----------------------------------

const favoritesPanel = document.getElementById("favorites-panel");
const favoritesErrorEl = document.getElementById("favorites-error");
const favoritesLoadingEl = document.getElementById("favorites-loading");
const favoritesEmptyEl = document.getElementById("favorites-empty");
const favoritesItemsListEl = document.getElementById("favorites-items-list");
const favoritesChaptersListEl = document.getElementById("favorites-chapters-list");

async function favoritesUnsubscribeAll() {
  for (const unsub of favoritesUnsubscribes) {
    if (typeof unsub === "function") {
      try { await unsub(); } catch { /* ignore */ }
    }
  }
  favoritesUnsubscribes = [];
  favoritesItemsByType = {};
  favoriteChapters = [];
}

async function subscribeToFavorites() {
  await favoritesUnsubscribeAll();
  // También cancelar dashboard y colecciones
  dashboardUnsubscribeAll();
  collectionsUnsubscribeAll();

  favoritesItemsByType = {};
  favoriteChapters = [];

  if (favoritesLoadingEl) favoritesLoadingEl.hidden = false;
  if (favoritesErrorEl) favoritesErrorEl.hidden = true;
  if (favoritesEmptyEl) favoritesEmptyEl.hidden = true;
  if (favoritesItemsListEl) favoritesItemsListEl.innerHTML = "";
  if (favoritesChaptersListEl) favoritesChaptersListEl.innerHTML = "";

  let pendingCount = MEDIA_TYPES.length + 1; // 5 tipos + chapters

  // Suscribirse a cada tipo de ítem
  for (const mediaType of MEDIA_TYPES) {
    try {
      const unsub = await subscribeItems(mediaType, {
        limitCount: 1000,
        onItems(items) {
          favoritesItemsByType[mediaType] = items || [];
          pendingCount--;
          renderFavorites();
          if (favoritesLoadingEl && pendingCount <= 0) {
            favoritesLoadingEl.hidden = true;
          }
        },
        onError(error) {
          pendingCount--;
          if (favoritesErrorEl) {
            favoritesErrorEl.textContent = "Error al cargar favoritos: " + (error?.message || "desconocido");
            favoritesErrorEl.hidden = false;
          }
          if (favoritesLoadingEl && pendingCount <= 0) {
            favoritesLoadingEl.hidden = true;
          }
        },
      });
      favoritesUnsubscribes.push(unsub);
    } catch (error) {
      pendingCount--;
      if (favoritesErrorEl) {
        favoritesErrorEl.textContent = "Error al suscribirse: " + (error?.message || "desconocido");
        favoritesErrorEl.hidden = false;
      }
    }
  }

  // Suscribirse a capítulos favoritos
  try {
    const unsub = await subscribeChapters({
      limitCount: 1000,
      onItems(chapters) {
        favoriteChapters = (chapters || []).filter(ch => ch.isFavorite !== false);
        pendingCount--;
        renderFavorites();
        if (favoritesLoadingEl && pendingCount <= 0) {
          favoritesLoadingEl.hidden = true;
        }
      },
      onError(error) {
        pendingCount--;
        if (favoritesErrorEl) {
          favoritesErrorEl.textContent = "Error al cargar capítulos: " + (error?.message || "desconocido");
          favoritesErrorEl.hidden = false;
        }
        if (favoritesLoadingEl && pendingCount <= 0) {
          favoritesLoadingEl.hidden = true;
        }
      },
    });
    favoritesUnsubscribes.push(unsub);
  } catch (error) {
    pendingCount--;
    if (favoritesErrorEl) {
      favoritesErrorEl.textContent = "Error al suscribirse a capítulos: " + (error?.message || "desconocido");
      favoritesErrorEl.hidden = false;
    }
  }
}

function renderFavorites() {
  if (!favoritesItemsListEl || !favoritesChaptersListEl) return;

  // Recopilar ítems favoritos de todos los tipos
  const allFavoriteItems = [];
  for (const mediaType of MEDIA_TYPES) {
    const items = favoritesItemsByType[mediaType] || [];
    for (const item of items) {
      if (item.isFavorite) {
        allFavoriteItems.push({ ...item, mediaType });
      }
    }
  }

  // Ordenar por updatedAt desc
  allFavoriteItems.sort((a, b) => {
    const aDate = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bDate = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bDate - aDate;
  });

  // Renderizar ítems favoritos
  favoritesItemsListEl.innerHTML = "";
  if (allFavoriteItems.length === 0 && favoriteChapters.length === 0) {
    if (favoritesEmptyEl) favoritesEmptyEl.hidden = false;
    return;
  }
  if (favoritesEmptyEl) favoritesEmptyEl.hidden = true;

  for (const item of allFavoriteItems) {
    const card = createFavoriteItemCard(item);
    favoritesItemsListEl.appendChild(card);
  }

  // Renderizar capítulos favoritos
  favoritesChaptersListEl.innerHTML = "";
  for (const chapter of favoriteChapters) {
    const card = createFavoriteChapterCard(chapter);
    favoritesChaptersListEl.appendChild(card);
  }
}

function createFavoriteItemCard(item) {
  const li = document.createElement("li");
  li.className = "catalog-card";
  li.dataset.mediaType = item.mediaType;
  li.dataset.itemId = item.id;
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.setAttribute("aria-label", `Ver ficha de ${item.title || "elemento"}`);

  // Click abre la ficha
  const openDetail = (event) => {
    if (event.target.closest(".catalog-card__actions") || event.target.closest(".heart-button")) return;
    openItemDetail(item.mediaType, item.id);
  };
  li.addEventListener("click", openDetail);
  li.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(event);
    }
  });

  // Póster o placeholder
  if (item.posterUrl) {
    const img = document.createElement("img");
    img.className = "catalog-card__poster";
    img.src = item.posterUrl;
    img.alt = "";
    img.loading = "lazy";
    li.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "catalog-card__placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.textContent = "🎬";
    li.appendChild(placeholder);
  }

  // Cuerpo
  const body = document.createElement("div");
  body.className = "catalog-card__body";

  const title = document.createElement("h3");
  title.className = "catalog-card__title";
  title.textContent = item.title || "Sin título";
  body.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "catalog-card__meta";

  if (item.year) {
    const year = document.createElement("span");
    year.className = "catalog-card__year";
    year.textContent = String(item.year);
    meta.appendChild(year);
  }

  const status = item.status || "pending";
  const badge = document.createElement("span");
  badge.className = `catalog-badge catalog-badge--${status}`;
  badge.textContent = STATUS_LABELS[status] || status;
  meta.appendChild(badge);

  if (typeof item.rating === "number" && Number.isFinite(item.rating)) {
    const rating = document.createElement("span");
    rating.className = "catalog-card__rating";
    rating.textContent = `★ ${item.rating}`;
    rating.setAttribute("aria-label", `Valoración: ${item.rating} sobre 10`);
    meta.appendChild(rating);
  }

  body.appendChild(meta);
  li.appendChild(body);

  // Acciones: corazón + botón colecciones
  const actions = document.createElement("div");
  actions.className = "catalog-card__actions";

  // Botón de corazón (UI-003, AC-001, AC-004)
  const heartBtn = createHeartButton(item.mediaType, item.id, item.isFavorite);
  actions.appendChild(heartBtn);

  // Botón de colecciones
  const collectionsBtn = document.createElement("button");
  collectionsBtn.type = "button";
  collectionsBtn.className = "btn btn--secondary";
  collectionsBtn.textContent = "Colecciones";
  collectionsBtn.style.cssText = "width:auto;padding:6px 10px;font-size:0.8rem;";
  collectionsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openCollectionPicker("item", item.id, item.mediaType);
  });
  actions.appendChild(collectionsBtn);

  li.appendChild(actions);

  return li;
}

function createFavoriteChapterCard(chapter) {
  const li = document.createElement("li");
  li.className = "favorite-chapter-card";
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.setAttribute("aria-label", `Ver ficha del capítulo ${chapter.title || ""}`);

  // Click abre la ficha del padre
  const openDetail = () => {
    if (chapter.parentMediaType && chapter.parentItemId) {
      openItemDetail(chapter.parentMediaType, chapter.parentItemId);
    }
  };
  li.addEventListener("click", openDetail);
  li.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail();
    }
  });

  // Info
  const info = document.createElement("div");
  info.className = "favorite-chapter-card__info";

  const title = document.createElement("div");
  title.className = "favorite-chapter-card__title";
  title.textContent = chapter.title || "Sin título";
  info.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "favorite-chapter-card__meta";
  const metaParts = [];
  if (chapter.season != null && chapter.episode != null) {
    metaParts.push(`S${chapter.season}E${chapter.episode}`);
  } else if (chapter.season != null) {
    metaParts.push(`T${chapter.season}`);
  } else if (chapter.episode != null) {
    metaParts.push(`E${chapter.episode}`);
  }
  if (typeof chapter.watchCount === "number" && chapter.watchCount > 0) {
    metaParts.push(`Visto ${chapter.watchCount}x`);
  }
  // Nombre del padre
  const parentItem = findParentItem(chapter.parentMediaType, chapter.parentItemId);
  if (parentItem) {
    metaParts.push(parentItem.title || "Padre");
  }
  meta.textContent = metaParts.join(" · ");
  info.appendChild(meta);

  li.appendChild(info);

  // Botón de colecciones
  const collectionsBtn = document.createElement("button");
  collectionsBtn.type = "button";
  collectionsBtn.className = "btn btn--secondary";
  collectionsBtn.textContent = "Colecciones";
  collectionsBtn.style.cssText = "width:auto;padding:6px 10px;font-size:0.8rem;";
  collectionsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openCollectionPicker("chapter", chapter.id, null);
  });
  li.appendChild(collectionsBtn);

  return li;
}

function findParentItem(mediaType, itemId) {
  if (!mediaType || !itemId) return null;
  const items = favoritesItemsByType[mediaType] || [];
  return items.find(i => i.id === itemId) || null;
}

// --- Heart button (UI-003, AC-001, AC-004) ------------------

function createHeartButton(mediaType, itemId, isFavorite) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "heart-button";
  btn.setAttribute("aria-pressed", isFavorite ? "true" : "false");
  btn.setAttribute("aria-label", isFavorite ? "Quitar de favoritos" : "Añadir a favoritos");
  btn.textContent = isFavorite ? "♥" : "♡";

  btn.addEventListener("click", async (event) => {
    event.stopPropagation();
    btn.disabled = true;
    try {
      await toggleItemFavorite(mediaType, itemId);
      // La suscripción en vivo actualizará la UI
    } catch (error) {
      console.error("Error al alternar favorito:", error);
    } finally {
      btn.disabled = false;
    }
  });

  return btn;
}

// --- Colecciones (spec 004) ---------------------------------

const collectionsPanel = document.getElementById("collections-panel");
const collectionsErrorEl = document.getElementById("collections-error");
const collectionsLoadingEl = document.getElementById("collections-loading");
const collectionsEmptyEl = document.getElementById("collections-empty");
const collectionsListEl = document.getElementById("collections-list");
const collectionsListView = document.getElementById("collections-list-view");
const collectionDetailView = document.getElementById("collection-detail-view");
const collectionDetailHeaderEl = document.getElementById("collection-detail-header");
const collectionDetailContentEl = document.getElementById("collection-detail-content");
const btnNewCollection = document.getElementById("btn-new-collection");
const btnBackCollections = document.getElementById("btn-back-collections");

async function collectionsUnsubscribeAll() {
  if (typeof collectionsUnsubscribe === "function") {
    try { await collectionsUnsubscribe(); } catch { /* ignore */ }
    collectionsUnsubscribe = null;
  }
  for (const unsub of collectionDetailUnsubscribes) {
    if (typeof unsub === "function") {
      try { await unsub(); } catch { /* ignore */ }
    }
  }
  collectionDetailUnsubscribes = [];
  collectionDetailItemsByType = {};
  collectionDetailChapters = [];
  collectionsList = [];
  currentCollectionDetailId = null;
}

async function subscribeToCollections() {
  await collectionsUnsubscribeAll();
  dashboardUnsubscribeAll();
  favoritesUnsubscribeAll();

  if (collectionsLoadingEl) collectionsLoadingEl.hidden = false;
  if (collectionsErrorEl) collectionsErrorEl.hidden = true;
  if (collectionsEmptyEl) collectionsEmptyEl.hidden = true;
  if (collectionsListEl) collectionsListEl.innerHTML = "";

  // Mostrar vista de listado
  showCollectionsListView();

  try {
    collectionsUnsubscribe = await subscribeCollections({
      limitCount: 1000,
      onItems(collections) {
        collectionsList = collections || [];
        if (collectionsLoadingEl) collectionsLoadingEl.hidden = true;
        renderCollectionsList();
        // Si estamos viendo el detalle de una colección, actualizar
        if (currentCollectionDetailId) {
          renderCollectionDetail();
        }
      },
      onError(error) {
        if (collectionsLoadingEl) collectionsLoadingEl.hidden = true;
        if (collectionsErrorEl) {
          collectionsErrorEl.textContent = "Error al cargar colecciones: " + (error?.message || "desconocido");
          collectionsErrorEl.hidden = false;
        }
      },
    });
  } catch (error) {
    if (collectionsLoadingEl) collectionsLoadingEl.hidden = true;
    if (collectionsErrorEl) {
      collectionsErrorEl.textContent = "Error al suscribirse: " + (error?.message || "desconocido");
      collectionsErrorEl.hidden = false;
    }
  }
}

function renderCollectionsList() {
  if (!collectionsListEl) return;
  collectionsListEl.innerHTML = "";

  if (collectionsList.length === 0) {
    if (collectionsEmptyEl) collectionsEmptyEl.hidden = false;
    return;
  }
  if (collectionsEmptyEl) collectionsEmptyEl.hidden = true;

  for (const collection of collectionsList) {
    const card = createCollectionCard(collection);
    collectionsListEl.appendChild(card);
  }
}

function createCollectionCard(collection) {
  const li = document.createElement("li");
  li.className = "collection-card";
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.setAttribute("aria-label", `Ver colección ${collection.name || ""}`);

  const openDetail = () => {
    openCollectionDetailView(collection.id);
  };
  li.addEventListener("click", openDetail);
  li.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail();
    }
  });

  // Header con punto de color y nombre
  const header = document.createElement("div");
  header.className = "collection-card__header";

  if (collection.color) {
    const dot = document.createElement("span");
    dot.className = "collection-card__color-dot";
    dot.style.backgroundColor = collection.color;
    header.appendChild(dot);
  }

  const name = document.createElement("h3");
  name.className = "collection-card__name";
  name.textContent = collection.name || "Sin nombre";
  header.appendChild(name);

  li.appendChild(header);

  // Descripción
  if (collection.description) {
    const desc = document.createElement("p");
    desc.className = "collection-card__description";
    desc.textContent = collection.description;
    li.appendChild(desc);
  }

  return li;
}

function showCollectionsListView() {
  if (collectionsListView) collectionsListView.hidden = false;
  if (collectionDetailView) collectionDetailView.hidden = true;
  currentCollectionDetailId = null;
}

function showCollectionDetailView() {
  if (collectionsListView) collectionsListView.hidden = true;
  if (collectionDetailView) collectionDetailView.hidden = false;
}

async function openCollectionDetailView(collectionId) {
  currentCollectionDetailId = collectionId;
  showCollectionDetailView();

  // Cancelar suscripciones previas del detalle
  for (const unsub of collectionDetailUnsubscribes) {
    if (typeof unsub === "function") {
      try { await unsub(); } catch { /* ignore */ }
    }
  }
  collectionDetailUnsubscribes = [];
  collectionDetailItemsByType = {};
  collectionDetailChapters = [];

  if (collectionDetailHeaderEl) collectionDetailHeaderEl.innerHTML = "";
  if (collectionDetailContentEl) collectionDetailContentEl.innerHTML = '<p class="muted">Cargando…</p>';

  // Suscribirse a ítems de todos los tipos
  let pendingCount = MEDIA_TYPES.length + 1;

  for (const mediaType of MEDIA_TYPES) {
    try {
      const unsub = await subscribeItems(mediaType, {
        limitCount: 1000,
        onItems(items) {
          collectionDetailItemsByType[mediaType] = items || [];
          pendingCount--;
          renderCollectionDetail();
        },
        onError() {
          pendingCount--;
          renderCollectionDetail();
        },
      });
      collectionDetailUnsubscribes.push(unsub);
    } catch {
      pendingCount--;
    }
  }

  // Suscribirse a capítulos
  try {
    const unsub = await subscribeChapters({
      limitCount: 1000,
      onItems(chapters) {
        collectionDetailChapters = chapters || [];
        pendingCount--;
        renderCollectionDetail();
      },
      onError() {
        pendingCount--;
        renderCollectionDetail();
      },
    });
    collectionDetailUnsubscribes.push(unsub);
  } catch {
    pendingCount--;
  }
}

function renderCollectionDetail() {
  if (!collectionDetailHeaderEl || !collectionDetailContentEl || !currentCollectionDetailId) return;

  const collection = collectionsList.find(c => c.id === currentCollectionDetailId);
  if (!collection) {
    collectionDetailHeaderEl.innerHTML = '<p class="muted">Colección no encontrada.</p>';
    collectionDetailContentEl.innerHTML = "";
    return;
  }

  // Header
  let headerHtml = '';
  if (collection.color) {
    headerHtml += `<span class="collection-detail__color-dot" style="background-color:${escapeHtml(collection.color)}"></span>`;
  }
  headerHtml += `<div class="collection-detail__info">`;
  headerHtml += `<h3 class="collection-detail__name">${escapeHtml(collection.name)}</h3>`;
  if (collection.description) {
    headerHtml += `<p class="collection-detail__description">${escapeHtml(collection.description)}</p>`;
  }
  headerHtml += `</div>`;
  headerHtml += `<div class="collection-detail__actions">`;
  headerHtml += `<button type="button" class="btn btn--secondary" id="btn-edit-collection">Editar</button>`;
  headerHtml += `</div>`;
  collectionDetailHeaderEl.innerHTML = headerHtml;

  // Botón editar
  const btnEdit = document.getElementById("btn-edit-collection");
  if (btnEdit) {
    btnEdit.addEventListener("click", () => {
      openCollectionForm(collection);
    });
  }

  // Contenido: ítems y capítulos de esta colección
  const itemsInCollection = [];
  for (const mediaType of MEDIA_TYPES) {
    const items = collectionDetailItemsByType[mediaType] || [];
    for (const item of items) {
      if (Array.isArray(item.collectionIds) && item.collectionIds.includes(currentCollectionDetailId)) {
        itemsInCollection.push({ ...item, mediaType });
      }
    }
  }

  const chaptersInCollection = collectionDetailChapters.filter(ch =>
    Array.isArray(ch.collectionIds) && ch.collectionIds.includes(currentCollectionDetailId)
  );

  let contentHtml = '';

  // Sección de ítems
  contentHtml += '<section class="favorites__section">';
  contentHtml += '<h4 class="collection-detail__section-title">Ítems</h4>';
  if (itemsInCollection.length === 0) {
    contentHtml += '<p class="collection-detail__empty">No hay ítems en esta colección.</p>';
  } else {
    contentHtml += '<ul class="catalog__list">';
    for (const item of itemsInCollection) {
      contentHtml += renderCollectionItemCard(item);
    }
    contentHtml += '</ul>';
  }
  contentHtml += '</section>';

  // Sección de capítulos
  contentHtml += '<section class="favorites__section">';
  contentHtml += '<h4 class="collection-detail__section-title">Capítulos</h4>';
  if (chaptersInCollection.length === 0) {
    contentHtml += '<p class="collection-detail__empty">No hay capítulos en esta colección.</p>';
  } else {
    contentHtml += '<ul class="favorites__chapters-list">';
    for (const chapter of chaptersInCollection) {
      contentHtml += renderCollectionChapterCard(chapter);
    }
    contentHtml += '</ul>';
  }
  contentHtml += '</section>';

  collectionDetailContentEl.innerHTML = contentHtml;

  // Attach event listeners to cards
  attachCollectionCardListeners();
}

function renderCollectionItemCard(item) {
  let html = '<li class="catalog-card" data-media-type="' + escapeHtml(item.mediaType) + '" data-item-id="' + escapeHtml(item.id) + '" tabindex="0" role="button">';

  if (item.posterUrl) {
    html += `<img class="catalog-card__poster" src="${escapeHtml(item.posterUrl)}" alt="" loading="lazy">`;
  } else {
    html += '<div class="catalog-card__placeholder" aria-hidden="true">🎬</div>';
  }

  html += '<div class="catalog-card__body">';
  html += `<h3 class="catalog-card__title">${escapeHtml(item.title || "Sin título")}</h3>`;
  html += '<div class="catalog-card__meta">';
  if (item.year) {
    html += `<span class="catalog-card__year">${escapeHtml(String(item.year))}</span>`;
  }
  const status = item.status || "pending";
  html += `<span class="catalog-badge catalog-badge--${escapeHtml(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
  html += '</div></div></li>';

  return html;
}

function renderCollectionChapterCard(chapter) {
  let html = '<li class="favorite-chapter-card" tabindex="0" role="button">';
  html += '<div class="favorite-chapter-card__info">';
  html += `<div class="favorite-chapter-card__title">${escapeHtml(chapter.title || "Sin título")}</div>`;
  html += '<div class="favorite-chapter-card__meta">';
  const metaParts = [];
  if (chapter.season != null && chapter.episode != null) {
    metaParts.push(`S${chapter.season}E${chapter.episode}`);
  }
  if (typeof chapter.watchCount === "number" && chapter.watchCount > 0) {
    metaParts.push(`Visto ${chapter.watchCount}x`);
  }
  html += escapeHtml(metaParts.join(" · "));
  html += '</div></div></li>';
  return html;
}

function attachCollectionCardListeners() {
  if (!collectionDetailContentEl) return;

  // Item cards
  collectionDetailContentEl.querySelectorAll(".catalog-card[data-media-type][data-item-id]").forEach(card => {
    const mediaType = card.dataset.mediaType;
    const itemId = card.dataset.itemId;
    const openDetail = () => openItemDetail(mediaType, itemId);
    card.addEventListener("click", openDetail);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail();
      }
    });
  });

  // Chapter cards
  collectionDetailContentEl.querySelectorAll(".favorite-chapter-card").forEach((card, index) => {
    const chaptersInCollection = collectionDetailChapters.filter(ch =>
      Array.isArray(ch.collectionIds) && ch.collectionIds.includes(currentCollectionDetailId)
    );
    const chapter = chaptersInCollection[index];
    if (chapter) {
      const openDetail = () => {
        if (chapter.parentMediaType && chapter.parentItemId) {
          openItemDetail(chapter.parentMediaType, chapter.parentItemId);
        }
      };
      card.addEventListener("click", openDetail);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetail();
        }
      });
    }
  });
}

// --- Collection Form (AC-006) --------------------------------

const collectionFormModal = document.getElementById("collection-form-modal");
const collectionForm = document.getElementById("collection-form");
const collectionFormErrors = document.getElementById("collection-form-errors");
const collectionFormTitle = document.getElementById("collection-form-modal-title");
const collectionFormDeleteSection = document.getElementById("collection-form-delete-section");
const collectionDeleteError = document.getElementById("collection-delete-error");
const btnDeleteCollection = document.getElementById("btn-delete-collection");

let editingCollectionId = null;

function openCollectionForm(collection = null) {
  editingCollectionId = collection ? collection.id : null;

  if (collectionFormTitle) {
    collectionFormTitle.textContent = collection ? "Editar colección" : "Nueva colección";
  }

  if (collectionForm) {
    collectionForm.reset();
    if (collection) {
      collectionForm.name.value = collection.name || "";
      collectionForm.description.value = collection.description || "";
      collectionForm.color.value = collection.color || "";
      if (collectionForm.colorPicker) {
        collectionForm.colorPicker.value = collection.color || "#8ab4f8";
      }
    } else {
      if (collectionForm.colorPicker) {
        collectionForm.colorPicker.value = "#8ab4f8";
      }
    }
  }

  if (collectionFormErrors) {
    collectionFormErrors.hidden = true;
    collectionFormErrors.innerHTML = "";
  }

  if (collectionFormDeleteSection) {
    collectionFormDeleteSection.hidden = !collection;
  }
  if (collectionDeleteError) {
    collectionDeleteError.hidden = true;
    collectionDeleteError.textContent = "";
  }

  openModal("collection-form-modal");
}

// Sync color picker with text input
if (collectionForm) {
  const colorPicker = collectionForm.querySelector('input[name="colorPicker"]');
  const colorText = collectionForm.querySelector('input[name="color"]');
  if (colorPicker && colorText) {
    colorPicker.addEventListener("input", () => {
      colorText.value = colorPicker.value;
    });
    colorText.addEventListener("input", () => {
      const val = colorText.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        colorPicker.value = val;
      }
    });
  }
}

if (collectionForm) {
  collectionForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(collectionForm);
    const data = {
      name: formData.get("name") || "",
      description: formData.get("description") || null,
      color: formData.get("color") || null,
    };

    // Validar color
    if (data.color && !/^#[0-9A-Fa-f]{6}$/.test(data.color)) {
      data.color = null;
    }

    const normalized = normalizeCollection(data);
    const validation = validateCollection(normalized);

    if (!validation.valid) {
      if (collectionFormErrors) {
        collectionFormErrors.innerHTML = `<ul>${validation.errors.map(e => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
        collectionFormErrors.hidden = false;
      }
      return;
    }

    try {
      if (editingCollectionId) {
        await updateCollection(editingCollectionId, data);
      } else {
        await createCollection(data);
      }
      closeModal("collection-form-modal");
    } catch (error) {
      if (collectionFormErrors) {
        collectionFormErrors.innerHTML = `<ul><li>${escapeHtml(error.message || "No se pudo guardar la colección.")}</li></ul>`;
        collectionFormErrors.hidden = false;
      }
    }
  });
}

if (btnDeleteCollection) {
  btnDeleteCollection.addEventListener("click", async () => {
    if (!editingCollectionId) return;

    const confirmed = window.confirm("¿Seguro que quieres borrar esta colección? Los ítems no se borrarán, solo se desvincularán.");
    if (!confirmed) return;

    btnDeleteCollection.disabled = true;
    if (collectionDeleteError) {
      collectionDeleteError.hidden = true;
    }

    try {
      const result = await deleteCollection(editingCollectionId);
      if (result.failures && result.failures.length > 0) {
        // AC-009: mostrar mensaje inline con botón de reintento
        if (collectionDeleteError) {
          collectionDeleteError.textContent = `Error al desvincular ${result.failures.length} elemento(s).`;
          collectionDeleteError.hidden = false;
          // Añadir botón de reintento
          const retryBtn = document.createElement("button");
          retryBtn.type = "button";
          retryBtn.className = "btn btn--secondary";
          retryBtn.textContent = "Reintentar";
          retryBtn.style.cssText = "margin-top:8px;width:auto;padding:6px 12px;font-size:0.85rem;";
          retryBtn.addEventListener("click", async () => {
            retryBtn.disabled = true;
            try {
              await deleteCollection(editingCollectionId);
              closeModal("collection-form-modal");
            } catch (err) {
              retryBtn.disabled = false;
            }
          });
          collectionDeleteError.appendChild(document.createElement("br"));
          collectionDeleteError.appendChild(retryBtn);
        }
      } else {
        closeModal("collection-form-modal");
        // Si estábamos viendo el detalle, volver al listado
        if (currentCollectionDetailId === editingCollectionId) {
          showCollectionsListView();
        }
      }
    } catch (error) {
      if (collectionDeleteError) {
        collectionDeleteError.textContent = error.message || "No se pudo borrar la colección.";
        collectionDeleteError.hidden = false;
      }
    } finally {
      btnDeleteCollection.disabled = false;
    }
  });
}

// --- Collection Picker (UI-005, AC-007) ----------------------

const collectionPickerModal = document.getElementById("collection-picker-modal");
const collectionPickerList = document.getElementById("collection-picker-list");
const collectionPickerEmpty = document.getElementById("collection-picker-empty");
const collectionPickerLimitWarning = document.getElementById("collection-picker-limit-warning");
const btnPickerNewCollection = document.getElementById("btn-picker-new-collection");

let pickerTarget = null; // { kind, id, mediaType }

async function openCollectionPicker(kind, id, mediaType) {
  pickerTarget = { kind, id, mediaType };

  if (collectionPickerList) collectionPickerList.innerHTML = "";
  if (collectionPickerEmpty) collectionPickerEmpty.hidden = true;
  if (collectionPickerLimitWarning) collectionPickerLimitWarning.hidden = true;

  // Obtener el target actual para saber sus collectionIds
  let currentCollectionIds = [];
  try {
    if (kind === "item") {
      const item = await getItem(mediaType, id);
      currentCollectionIds = item?.collectionIds || [];
    } else {
      // Para capítulos, necesitamos listar y encontrar
      const result = await listChapters({ limitCount: 1000 });
      const chapter = (result.chapters || []).find(ch => ch.id === id);
      currentCollectionIds = chapter?.collectionIds || [];
    }
  } catch {
    // Ignorar error, asumir vacío
  }

  // Verificar límite
  if (currentCollectionIds.length >= MAX_COLLECTIONS_PER_TARGET) {
    if (collectionPickerLimitWarning) collectionPickerLimitWarning.hidden = false;
  }

  // Renderizar lista de colecciones
  if (collectionsList.length === 0) {
    if (collectionPickerEmpty) collectionPickerEmpty.hidden = false;
  } else {
    for (const collection of collectionsList) {
      const isChecked = currentCollectionIds.includes(collection.id);
      const isDisabled = !isChecked && currentCollectionIds.length >= MAX_COLLECTIONS_PER_TARGET;

      const li = document.createElement("li");
      li.className = "collection-picker__item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isChecked;
      checkbox.disabled = isDisabled;
      checkbox.setAttribute("aria-label", `Añadir a ${collection.name}`);

      checkbox.addEventListener("change", async () => {
        checkbox.disabled = true;
        try {
          if (checkbox.checked) {
            await addTargetToCollection(kind, id, collection.id, mediaType);
          } else {
            await removeTargetFromCollection(kind, id, collection.id, mediaType);
          }
        } catch (error) {
          console.error("Error al actualizar colección:", error);
          checkbox.checked = !checkbox.checked;
        } finally {
          checkbox.disabled = false;
        }
      });

      li.appendChild(checkbox);

      if (collection.color) {
        const dot = document.createElement("span");
        dot.className = "collection-picker__item-color";
        dot.style.backgroundColor = collection.color;
        li.appendChild(dot);
      }

      const name = document.createElement("span");
      name.className = "collection-picker__item-name";
      name.textContent = collection.name;
      li.appendChild(name);

      collectionPickerList.appendChild(li);
    }
  }

  openModal("collection-picker-modal");
}

if (btnPickerNewCollection) {
  btnPickerNewCollection.addEventListener("click", () => {
    closeModal("collection-picker-modal");
    openCollectionForm(null);
  });
}

if (btnNewCollection) {
  btnNewCollection.addEventListener("click", () => {
    openCollectionForm(null);
  });
}

if (btnBackCollections) {
  btnBackCollections.addEventListener("click", () => {
    showCollectionsListView();
  });
}

async function subscribeToDashboard() {
  await dashboardUnsubscribeAll();
  dashboardItemsByType = {};
  dashboardFavoriteChapters = [];

  if (dashboardLoadingEl) dashboardLoadingEl.hidden = false;
  if (dashboardErrorEl) dashboardErrorEl.hidden = true;
  if (dashboardStatsEl) dashboardStatsEl.innerHTML = "";
  if (dashboardRecentAddedEl) dashboardRecentAddedEl.innerHTML = "";
  if (dashboardRecentCompletedEl) dashboardRecentCompletedEl.innerHTML = "";

  let pendingCount = MEDIA_TYPES.length + 1; // 5 tipos + chapters

  for (const mediaType of MEDIA_TYPES) {
    try {
      // MED #1 (REQ-005/AC-005): límite alto para que las estadísticas no queden
      // truncadas cuando hay >100 ítems por tipo (el default es 100).
      const unsub = await subscribeItems(mediaType, {
        limitCount: 1000,
        onItems(items) {
          dashboardItemsByType[mediaType] = items || [];
          pendingCount--;
          renderDashboard();
          if (dashboardLoadingEl && pendingCount <= 0) {
            dashboardLoadingEl.hidden = true;
          }
        },
        onError(error) {
          pendingCount--;
          if (dashboardErrorEl) {
            dashboardErrorEl.textContent = "Error al cargar estadísticas: " + (error?.message || "desconocido");
            dashboardErrorEl.hidden = false;
          }
          if (dashboardLoadingEl && pendingCount <= 0) {
            dashboardLoadingEl.hidden = true;
          }
        },
      });
      dashboardUnsubscribes.push(unsub);
    } catch (error) {
      pendingCount--;
      if (dashboardErrorEl) {
        dashboardErrorEl.textContent = "Error al suscribirse: " + (error?.message || "desconocido");
        dashboardErrorEl.hidden = false;
      }
    }
  }

  // Spec 004 (AC-005, D-007): suscripción a capítulos favoritos para el dashboard
  try {
    dashboardChaptersUnsubscribe = await subscribeChapters({
      limitCount: 1000,
      onItems(chapters) {
        dashboardFavoriteChapters = (chapters || []).filter(ch => ch.isFavorite !== false);
        pendingCount--;
        renderDashboard();
        if (dashboardLoadingEl && pendingCount <= 0) {
          dashboardLoadingEl.hidden = true;
        }
      },
      onError(error) {
        pendingCount--;
        if (dashboardErrorEl) {
          dashboardErrorEl.textContent = "Error al cargar capítulos: " + (error?.message || "desconocido");
          dashboardErrorEl.hidden = false;
        }
        if (dashboardLoadingEl && pendingCount <= 0) {
          dashboardLoadingEl.hidden = true;
        }
      },
    });
  } catch (error) {
    pendingCount--;
    if (dashboardErrorEl) {
      dashboardErrorEl.textContent = "Error al suscribirse a capítulos: " + (error?.message || "desconocido");
      dashboardErrorEl.hidden = false;
    }
  }
}

function renderDashboard() {
  const stats = computeDashboardStats(dashboardItemsByType);

  // --- StatCards (D-005, D-007) ---
  if (dashboardStatsEl) {
    let html = "";

    // Totales por tipo
    html += `<h4 class="dashboard__section-title">Por tipo</h4>`;
    html += `<div class="dashboard__stats-grid">`;
    for (const type of MEDIA_TYPES) {
      const count = stats.totalsByType[type] || 0;
      html += `
        <div class="stat-card">
          <span class="stat-card__label">${escapeHtml(mediaTypeLabel(type))}</span>
          <span class="stat-card__value">${count}</span>
        </div>`;
    }
    html += `</div>`;

    // Totales por estado
    html += `<h4 class="dashboard__section-title">Por estado</h4>`;
    html += `<div class="dashboard__stats-grid">`;
    for (const status of ITEM_STATUSES) {
      const count = stats.totalsByStatus[status] || 0;
      html += `
        <div class="stat-card">
          <span class="stat-card__label">${escapeHtml(STATUS_LABELS[status])}</span>
          <span class="stat-card__value">${count}</span>
        </div>`;
    }
    html += `</div>`;

    // Media de valoración, horas jugadas, completados
    html += `<h4 class="dashboard__section-title">Resumen</h4>`;
    html += `<div class="dashboard__stats-grid">`;
    const avgRating = stats.averageRating !== null
      ? stats.averageRating.toFixed(1)
      : "—";
    html += `
      <div class="stat-card">
        <span class="stat-card__label">Media valoración</span>
        <span class="stat-card__value stat-card__value--rating">${escapeHtml(avgRating)}</span>
      </div>`;
    html += `
      <div class="stat-card">
        <span class="stat-card__label">Horas jugadas</span>
        <span class="stat-card__value stat-card__value--accent">${stats.totalHoursPlayed}</span>
      </div>`;
    html += `
      <div class="stat-card">
        <span class="stat-card__label">Completados</span>
        <span class="stat-card__value stat-card__value--accent">${stats.completedCount}</span>
      </div>`;
    html += `</div>`;

    dashboardStatsEl.innerHTML = html;
  }

  // --- Listas recientes (D-005) ---
  renderRecentList(dashboardRecentAddedEl, stats.recentlyAdded, "createdAt");
  renderRecentList(dashboardRecentCompletedEl, stats.recentlyCompleted, "completedAt");
  
  // Spec 004 (AC-005, D-007): bloque de favoritos
  renderDashboardFavoritesBlock();
}

function renderRecentList(container, items, dateField) {
  if (!container) return;
  container.innerHTML = "";

  if (!items || items.length === 0) {
    const li = document.createElement("li");
    li.className = "dashboard__recent-empty";
    li.textContent = "Nada por aquí todavía.";
    container.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "dashboard__recent-item";
    li.dataset.mediaType = item.mediaType || "";
    li.dataset.itemId = item.id || "";
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-label", `Ver ficha de ${item.title || "elemento"}`);

    // Click abre la ficha existente (mismo flujo que las tarjetas)
    const openDetail = () => {
      if (item.mediaType && item.id) {
        openItemDetail(item.mediaType, item.id);
      }
    };
    li.addEventListener("click", openDetail);
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail();
      }
    });

    // Póster mini o placeholder
    if (item.posterUrl) {
      const img = document.createElement("img");
      img.className = "dashboard__recent-poster";
      img.src = item.posterUrl;
      img.alt = "";
      img.loading = "lazy";
      li.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "dashboard__recent-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.textContent = "🎬";
      li.appendChild(placeholder);
    }

    // Info
    const info = document.createElement("div");
    info.className = "dashboard__recent-info";

    const name = document.createElement("span");
    name.className = "dashboard__recent-name";
    name.textContent = item.title || "Sin título";
    info.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "dashboard__recent-meta";
    const metaParts = [];
    if (item.year) metaParts.push(String(item.year));
    const statusLabel = STATUS_LABELS[item.status] || item.status;
    metaParts.push(statusLabel);
    if (typeof item.rating === "number" && Number.isFinite(item.rating)) {
      metaParts.push(`★ ${item.rating}`);
    }
    meta.textContent = metaParts.join(" · ");
    info.appendChild(meta);

    li.appendChild(info);
    container.appendChild(li);
  }
}

// --- Init del catálogo --------------------------------------

function catalogInit() {
  if (catalogInitialized) return;
  catalogInitialized = true;
  mountCatalogView();
  syncCatalogTabs();
  updateCatalogLoadMoreState();
  renderCatalogState();

  // Vista inicial: Dashboard (spec 003, AC-001), reached desde el nav
  // principal (T-112). El resto de vistas se cargan al seleccionarlas.
  showAppView(DEFAULT_APP_VIEW);
}

// =============================================================
// Spec 002 — Modales (UI-002, UI-003, UI-004, REQ-005..011)
// =============================================================

// --- Utilidades de modales ----------------------------------

const modalState = {
  activeModal: null,
  previousFocus: null,
};

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  // Guard early: evitar registrar listeners duplicados si el modal ya está activo
  if (modalState.activeModal === modal) return;
  
  modalState.previousFocus = document.activeElement;
  modalState.activeModal = modal;
  modal.hidden = false;
  
  // Focus trap: encontrar el primer elemento enfocable
  const focusable = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length > 0) {
    setTimeout(() => focusable[0].focus(), 50);
  }
  
  // Cerrar con Escape
  const handleEscape = (event) => {
    if (event.key === "Escape") {
      closeModal(modalId);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  modal._handleEscape = handleEscape;
  document.addEventListener("keydown", handleEscape);
  
  // Focus trap: Tab/Shift+Tab
  const handleTab = (event) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;
    
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  modal.addEventListener("keydown", handleTab);
  modal._handleTab = handleTab;
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  
  modal.hidden = true;
  modalState.activeModal = null;
  
  // Limpiar event listeners
  if (modal._handleTab) {
    modal.removeEventListener("keydown", modal._handleTab);
    delete modal._handleTab;
  }
  if (modal._handleEscape) {
    document.removeEventListener("keydown", modal._handleEscape);
    delete modal._handleEscape;
  }
  
  // Restaurar foco
  if (modalState.previousFocus) {
    modalState.previousFocus.focus();
    modalState.previousFocus = null;
  }
}

// Cerrar modal al hacer click en el backdrop o botones de cierre
document.addEventListener("click", (event) => {
  const closeBtn = event.target.closest("[data-close-modal]");
  if (closeBtn && modalState.activeModal) {
    closeModal(modalState.activeModal.id);
  }
});

// --- SearchModal (UI-003) -----------------------------------

const searchModal = document.getElementById("search-modal");
const searchInput = document.getElementById("search-input");
const searchStatus = document.getElementById("search-status");
const searchResults = document.getElementById("search-results");
const btnManualForm = document.getElementById("btn-manual-form");

let searchDebounceTimer = null;

// Mapa pestaña → proveedor (REQ-005)
const SEARCH_PROVIDERS = {
  movie: searchTmdbMovies,
  series: searchTmdbTv,
  anime: searchTmdbAnime,
  game: searchIgdbGames,
  book: searchGoogleBooks,
};

if (btnAddItem) {
  btnAddItem.addEventListener("click", () => {
    openSearchModal();
  });
}

btnManualForm.addEventListener("click", () => {
  closeModal("search-modal");
  openManualForm();
});

function openSearchModal() {
  searchInput.value = "";
  searchStatus.textContent = "";
  searchStatus.className = "search-status";
  searchResults.innerHTML = "";
  openModal("search-modal");
  searchInput.focus();
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  const query = searchInput.value.trim();
  
  if (query.length < 2) {
    searchStatus.textContent = "";
    searchResults.innerHTML = "";
    return;
  }
  
  searchStatus.textContent = "Buscando…";
  searchStatus.className = "search-status";
  
  searchDebounceTimer = setTimeout(() => {
    performSearch(query);
  }, 400);
});

async function performSearch(query) {
  const provider = SEARCH_PROVIDERS[activeMediaType];
  if (!provider) {
    searchStatus.textContent = "Búsqueda no disponible para este tipo.";
    searchStatus.className = "search-status search-status--error";
    return;
  }
  
  try {
    const result = await provider(query, { limit: 10 });
    
    if (!result.ok) {
      searchStatus.textContent = `Error: ${result.message || "No se pudo completar la búsqueda."}`;
      searchStatus.className = "search-status search-status--error";
      searchResults.innerHTML = "";
      return;
    }
    
    if (result.items.length === 0) {
      searchStatus.textContent = "No se encontraron resultados. Prueba con otro término o usa el alta manual.";
      searchStatus.className = "search-status";
      searchResults.innerHTML = "";
      return;
    }
    
    searchStatus.textContent = `${result.items.length} resultado${result.items.length !== 1 ? "s" : ""}`;
    searchStatus.className = "search-status";
    renderSearchResults(result.items);
  } catch (error) {
    searchStatus.textContent = `Error: ${error.message || "No se pudo completar la búsqueda."}`;
    searchStatus.className = "search-status search-status--error";
    searchResults.innerHTML = "";
  }
}

function renderSearchResults(items) {
  searchResults.innerHTML = "";
  
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "search-result";
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-label", `Añadir ${item.title}`);
    
    if (item.posterUrl) {
      const img = document.createElement("img");
      img.className = "search-result__poster";
      img.src = item.posterUrl;
      img.alt = "";
      li.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "search-result__poster search-result__poster--placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.textContent = "🎬";
      li.appendChild(placeholder);
    }
    
    const body = document.createElement("div");
    body.className = "search-result__body";
    
    const title = document.createElement("h3");
    title.className = "search-result__title";
    title.textContent = item.title || "Sin título";
    body.appendChild(title);
    
    const meta = document.createElement("div");
    meta.className = "search-result__meta";
    const metaParts = [];
    if (item.year) metaParts.push(String(item.year));
    if (item.author) metaParts.push(item.author);
    if (item.genres && item.genres.length > 0) {
      metaParts.push(item.genres.slice(0, 2).join(", "));
    }
    meta.textContent = metaParts.join(" · ");
    body.appendChild(meta);
    
    li.appendChild(body);
    
    const selectItem = () => {
      createItemFromSearch(item);
    };
    li.addEventListener("click", selectItem);
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectItem();
      }
    });
    
    searchResults.appendChild(li);
  });
}

async function createItemFromSearch(searchResult) {
  // Mapear SearchResult a datos de ítem (AC-003, AC-011, AC-012, AC-013)
  const data = {
    title: searchResult.title || "",
    year: searchResult.year,
    posterUrl: searchResult.posterUrl,
    synopsis: searchResult.synopsis,
    genres: searchResult.genres || [],
    durationMinutes: searchResult.durationMinutes,
    status: "pending",
  };
  
  // Autor exclusivo de libros (AC-012)
  if (searchResult.author) {
    data.author = searchResult.author;
  }
  
  // Fuente externa
  if (searchResult.source && searchResult.externalId) {
    data.source = {
      provider: searchResult.source,
      externalId: searchResult.externalId,
    };
  }
  
  try {
    await createItem(activeMediaType, data);
    closeModal("search-modal");
    // La suscripción en vivo refrescará la lista automáticamente
  } catch (error) {
    alert(`No se pudo crear el ítem: ${error.message || "error desconocido"}`);
  }
}

// --- ManualForm (UI-004) ------------------------------------

const manualModal = document.getElementById("manual-modal");
const manualForm = document.getElementById("manual-form");
const manualErrors = document.getElementById("manual-errors");
const manualTypeFields = document.getElementById("manual-type-fields");

function openManualForm(prefillData = {}) {
  manualForm.reset();
  manualErrors.hidden = true;
  manualErrors.innerHTML = "";
  
  // Rellenar campos específicos del tipo (AC-004)
  renderTypeSpecificFields(activeMediaType, prefillData);
  
  // Prefill si viene de búsqueda con error (AC-015)
  if (prefillData.title) {
    manualForm.title.value = prefillData.title;
  }
  if (prefillData.year) {
    manualForm.year.value = prefillData.year;
  }
  if (prefillData.posterUrl) {
    manualForm.posterUrl.value = prefillData.posterUrl;
  }
  if (prefillData.synopsis) {
    manualForm.synopsis.value = prefillData.synopsis;
  }
  if (prefillData.genres && prefillData.genres.length > 0) {
    manualForm.genres.value = prefillData.genres.join(", ");
  }
  
  openModal("manual-modal");
}

function renderTypeSpecificFields(mediaType, data = {}) {
  manualTypeFields.innerHTML = "";
  
  if (mediaType === "series" || mediaType === "anime") {
    // Temporada/episodio actuales y totales (AC-006)
    // MED #3: escapar valores dinámicos para evitar XSS (REQ-014).
    const eCurrentSeason = escapeHtml(data.currentSeason ?? "");
    const eCurrentEpisode = escapeHtml(data.currentEpisode ?? "");
    const eTotalSeasons = escapeHtml(data.totalSeasons ?? "");
    const eTotalEpisodes = escapeHtml(data.totalEpisodes ?? "");
    manualTypeFields.innerHTML = `
      <label class="form-field">
        <span class="form-field__label">Temporada actual</span>
        <input type="number" name="currentSeason" class="form-field__input" min="1" value="${eCurrentSeason}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Episodio actual</span>
        <input type="number" name="currentEpisode" class="form-field__input" min="1" value="${eCurrentEpisode}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Total de temporadas</span>
        <input type="number" name="totalSeasons" class="form-field__input" min="0" value="${eTotalSeasons}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Total de episodios</span>
        <input type="number" name="totalEpisodes" class="form-field__input" min="0" value="${eTotalEpisodes}">
      </label>
    `;
  } else if (mediaType === "game") {
    // Horas, % completado, plataforma, logros (AC-007)
    // MED #3: escapar valores dinámicos para evitar XSS (REQ-014).
    const eHoursPlayed = escapeHtml(data.hoursPlayed ?? "");
    const eCompletionPercent = escapeHtml(data.completionPercent ?? "");
    const ePlatform = escapeHtml(data.platform || "");
    const eAchievementsUnlocked = escapeHtml(data.achievementsUnlocked ?? "");
    const eAchievementsTotal = escapeHtml(data.achievementsTotal ?? "");
    manualTypeFields.innerHTML = `
      <label class="form-field">
        <span class="form-field__label">Horas jugadas</span>
        <input type="number" name="hoursPlayed" class="form-field__input" min="0" step="0.1" value="${eHoursPlayed}">
      </label>
      <label class="form-field">
        <span class="form-field__label">% completado</span>
        <input type="number" name="completionPercent" class="form-field__input" min="0" max="100" value="${eCompletionPercent}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Plataforma</span>
        <input type="text" name="platform" class="form-field__input" value="${ePlatform}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Logros desbloqueados</span>
        <input type="number" name="achievementsUnlocked" class="form-field__input" min="0" value="${eAchievementsUnlocked}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Total de logros</span>
        <input type="number" name="achievementsTotal" class="form-field__input" min="0" value="${eAchievementsTotal}">
      </label>
    `;
  } else if (mediaType === "book") {
    // Autor y páginas (AC-012)
    // MED #3: escapar valores dinámicos para evitar XSS (REQ-014).
    const eAuthor = escapeHtml(data.author || "");
    const ePagesRead = escapeHtml(data.pagesRead ?? "");
    const ePagesTotal = escapeHtml(data.pagesTotal ?? "");
    manualTypeFields.innerHTML = `
      <label class="form-field">
        <span class="form-field__label">Autor</span>
        <input type="text" name="author" class="form-field__input" value="${eAuthor}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Páginas leídas</span>
        <input type="number" name="pagesRead" class="form-field__input" min="0" value="${ePagesRead}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Total de páginas</span>
        <input type="number" name="pagesTotal" class="form-field__input" min="0" value="${ePagesTotal}">
      </label>
    `;
  }
}

manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  
  const formData = new FormData(manualForm);
  const data = {
    title: formData.get("title"),
    year: formData.get("year") ? Number(formData.get("year")) : null,
    genres: formData.get("genres")
      ? formData.get("genres").split(",").map((g) => g.trim()).filter((g) => g)
      : [],
    durationMinutes: formData.get("durationMinutes") ? Number(formData.get("durationMinutes")) : null,
    posterUrl: formData.get("posterUrl") || null,
    synopsis: formData.get("synopsis") || null,
    status: "pending",
  };
  
  // Campos específicos del tipo
  if (activeMediaType === "series" || activeMediaType === "anime") {
    data.currentSeason = formData.get("currentSeason") ? Number(formData.get("currentSeason")) : null;
    data.currentEpisode = formData.get("currentEpisode") ? Number(formData.get("currentEpisode")) : null;
    data.totalSeasons = formData.get("totalSeasons") ? Number(formData.get("totalSeasons")) : null;
    data.totalEpisodes = formData.get("totalEpisodes") ? Number(formData.get("totalEpisodes")) : null;
  } else if (activeMediaType === "game") {
    data.hoursPlayed = formData.get("hoursPlayed") ? Number(formData.get("hoursPlayed")) : null;
    data.completionPercent = formData.get("completionPercent") ? Number(formData.get("completionPercent")) : null;
    data.platform = formData.get("platform") || null;
    data.achievementsUnlocked = formData.get("achievementsUnlocked") ? Number(formData.get("achievementsUnlocked")) : null;
    data.achievementsTotal = formData.get("achievementsTotal") ? Number(formData.get("achievementsTotal")) : null;
  } else if (activeMediaType === "book") {
    data.author = formData.get("author") || null;
    data.pagesRead = formData.get("pagesRead") ? Number(formData.get("pagesRead")) : null;
    data.pagesTotal = formData.get("pagesTotal") ? Number(formData.get("pagesTotal")) : null;
  }
  
  // Validar antes de crear (AC-010)
  const itemToValidate = normalizeItem(activeMediaType, data);
  const validation = validateItem(itemToValidate);
  
  if (!validation.valid) {
    // MED #3: escapar mensajes de error para evitar XSS (REQ-014).
    manualErrors.innerHTML = `<ul>${validation.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
    manualErrors.hidden = false;
    return;
  }
  
  try {
    await createItem(activeMediaType, data);
    closeModal("manual-modal");
  } catch (error) {
    // MED #3: escapar mensajes de error para evitar XSS (REQ-014).
    manualErrors.innerHTML = `<ul><li>${escapeHtml(error.message || "No se pudo crear el ítem.")}</li></ul>`;
    manualErrors.hidden = false;
  }
});

// --- ItemDetail (UI-002) ------------------------------------

const detailModal = document.getElementById("detail-modal");
const detailContent = document.getElementById("detail-content");
const detailTitle = document.getElementById("detail-modal-title");

let currentDetailItem = null;

async function openItemDetail(mediaType, itemId) {
  try {
    const item = await getItem(mediaType, itemId);
    if (!item) {
      alert("No se encontró el ítem.");
      return;
    }
    
    currentDetailItem = item;
    detailTitle.textContent = item.title || "Ficha";
    renderDetail(item);
    openModal("detail-modal");
  } catch (error) {
    alert(`No se pudo cargar la ficha: ${error.message || "error desconocido"}`);
  }
}

function renderDetail(item) {
  const mediaType = item.mediaType || activeMediaType;
  
  // MED #3: escapar todos los valores dinámicos para evitar XSS (REQ-014).
  const eTitle = escapeHtml(item.title || "Sin título");
  const eAuthor = escapeHtml(item.author || "");
  const eSynopsis = escapeHtml(item.synopsis || "");
  const eReview = escapeHtml(item.review || "");
  const eStatus = escapeHtml(item.status || "pending");
  const ePosterUrl = escapeHtml(item.posterUrl || "");
  const eBackdropUrl = escapeHtml(item.backdropUrl || "");
  const eYear = escapeHtml(item.year ?? "");
  const eRatingValue = item.rating !== undefined && item.rating !== null ? escapeHtml(item.rating) : "";
  const eCompletedAt = item.completedAt ? escapeHtml(new Date(item.completedAt).toISOString().split("T")[0]) : "";
  const eCurrentSeason = escapeHtml(item.currentSeason ?? "");
  const eCurrentEpisode = escapeHtml(item.currentEpisode ?? "");
  const eTotalSeasons = escapeHtml(item.totalSeasons ?? "");
  const eTotalEpisodes = escapeHtml(item.totalEpisodes ?? "");
  const eHoursPlayed = escapeHtml(item.hoursPlayed ?? "");
  const eCompletionPercent = escapeHtml(item.completionPercent ?? "");
  const ePlatform = escapeHtml(item.platform || "");
  const eAchievementsUnlocked = escapeHtml(item.achievementsUnlocked ?? "");
  const eAchievementsTotal = escapeHtml(item.achievementsTotal ?? "");
  const ePagesRead = escapeHtml(item.pagesRead ?? "");
  const ePagesTotal = escapeHtml(item.pagesTotal ?? "");
  
  // Géneros como chips (UI-003)
  const genres = item.genres && Array.isArray(item.genres) ? item.genres : [];
  const genresHtml = genres.length > 0 
    ? `<div class="detail__genres">${genres.map(g => `<span class="detail__genre-chip">${escapeHtml(g)}</span>`).join("")}</div>`
    : "";
  
  // Tagline si existe
  const tagline = item.tagline ? `<p class="detail__tagline">${escapeHtml(item.tagline)}</p>` : "";
  
  // Spec 004 (AC-004): botones de corazón y colecciones en la cabecera
  const isFavorite = item.isFavorite === true;
  const heartIcon = isFavorite ? "♥" : "♡";
  const heartLabel = isFavorite ? "Quitar de favoritos" : "Añadir a favoritos";
  const heartPressed = isFavorite ? "true" : "false";
  
  let html = `
    <div class="detail">
      <div class="detail__hero">
        ${item.backdropUrl ? `<div class="detail__backdrop" style="background-image: url('${eBackdropUrl}')"></div>` : ""}
        <div class="detail__hero-content">
          ${
            item.posterUrl
              ? `<img src="${ePosterUrl}" alt="" class="detail__poster">`
              : `<div class="detail__poster detail__poster--placeholder" aria-hidden="true">🎬</div>`
          }
          <div class="detail__info">
            <div class="detail__header-actions">
              <h3 class="detail__title">${eTitle}${item.year ? ` <span class="detail__year">(${eYear})</span>` : ""}</h3>
              <div class="detail__action-buttons">
                <button type="button" class="heart-button" id="btn-detail-heart" aria-pressed="${heartPressed}" aria-label="${heartLabel}">${heartIcon}</button>
                <button type="button" class="btn btn--secondary" id="btn-detail-collections" style="width:auto;padding:6px 12px;font-size:0.85rem;">Colecciones</button>
              </div>
            </div>
            ${genresHtml}
            ${tagline}
            <div class="detail__meta">
              ${item.author ? `<span>${eAuthor}</span>` : ""}
              <span class="catalog-badge catalog-badge--${eStatus}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>
              ${typeof item.rating === "number" ? `<span class="detail__rating">★ ${eRatingValue}/10</span>` : ""}
            </div>
            ${item.synopsis ? `<p class="detail__synopsis">${eSynopsis}</p>` : ""}
          </div>
        </div>
      </div>
      
      <div id="metadata-section" class="detail__section"></div>
      
      <form id="detail-form" class="form" novalidate>
        <div id="detail-errors" class="form-errors" hidden role="alert"></div>
        
        <label class="form-field">
          <span class="form-field__label">Estado</span>
          <select name="status" class="form-field__select">
            ${ITEM_STATUSES.map((s) => `<option value="${escapeHtml(s)}" ${s === item.status ? "selected" : ""}>${escapeHtml(STATUS_LABELS[s])}</option>`).join("")}
          </select>
        </label>
        
        <div class="form-field">
          <span class="form-field__label">Valoración (1-10)</span>
          <div class="rating-scale" role="group" aria-label="Valoración">
            ${Array.from({ length: 10 }, (_, i) => i + 1)
              .map((n) => `<button type="button" class="rating-scale__button" data-rating="${n}" aria-pressed="${item.rating === n}" aria-label="${n} de 10">${n}</button>`)
              .join("")}
          </div>
          <input type="hidden" name="rating" value="${eRatingValue}">
        </div>
        
        <label class="form-field">
          <span class="form-field__label">Reseña (máx. 500 caracteres)</span>
          <textarea name="review" class="form-field__textarea" maxlength="500" rows="3">${eReview}</textarea>
        </label>
        
        <label class="form-field">
          <span class="form-field__label">Fecha de finalización</span>
          <input type="date" name="completedAt" class="form-field__input" value="${eCompletedAt}">
        </label>
  `;
  
  // Campos específicos por tipo (AC-005, AC-006, AC-007)
  if (mediaType === "series" || mediaType === "anime") {
    const nextEp = nextEpisodeLabel(item);
    html += `
      ${nextEp ? `<div class="detail__progress"><div class="detail__progress-label">Siguiente episodio:</div><div>${escapeHtml(nextEp)}</div></div>` : ""}
      <label class="form-field">
        <span class="form-field__label">Temporada actual</span>
        <input type="number" name="currentSeason" class="form-field__input" min="1" value="${eCurrentSeason}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Episodio actual</span>
        <input type="number" name="currentEpisode" class="form-field__input" min="1" value="${eCurrentEpisode}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Total de temporadas</span>
        <input type="number" name="totalSeasons" class="form-field__input" min="0" value="${eTotalSeasons}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Total de episodios</span>
        <input type="number" name="totalEpisodes" class="form-field__input" min="0" value="${eTotalEpisodes}">
      </label>
    `;
  } else if (mediaType === "game") {
    html += `
      <label class="form-field">
        <span class="form-field__label">Horas jugadas</span>
        <input type="number" name="hoursPlayed" class="form-field__input" min="0" step="0.1" value="${eHoursPlayed}">
      </label>
      <label class="form-field">
        <span class="form-field__label">% completado</span>
        <input type="number" name="completionPercent" class="form-field__input" min="0" max="100" value="${eCompletionPercent}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Plataforma</span>
        <input type="text" name="platform" class="form-field__input" value="${ePlatform}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Logros desbloqueados</span>
        <input type="number" name="achievementsUnlocked" class="form-field__input" min="0" value="${eAchievementsUnlocked}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Total de logros</span>
        <input type="number" name="achievementsTotal" class="form-field__input" min="0" value="${eAchievementsTotal}">
      </label>
    `;
  } else if (mediaType === "book") {
    html += `
      <label class="form-field">
        <span class="form-field__label">Páginas leídas</span>
        <input type="number" name="pagesRead" class="form-field__input" min="0" value="${ePagesRead}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Total de páginas</span>
        <input type="number" name="pagesTotal" class="form-field__input" min="0" value="${ePagesTotal}">
      </label>
    `;
  }
  
  html += `
      <div class="modal__footer">
        <button type="submit" class="btn btn--primary">Guardar cambios</button>
        <button type="button" class="btn" data-close-modal>Cancelar</button>
      </div>
    </form>
  `;
  
  // Spec 004 (AC-002, AC-014): capítulos favoritos para series/anime/book
  if (CHAPTER_PARENT_MEDIA_TYPES.includes(mediaType)) {
    html += `
      <div class="detail__section" id="chapters-section">
        <h4 class="detail__section-title">Capítulos favoritos</h4>
        <div id="chapters-list" class="chapters-list"></div>
        <button type="button" id="btn-add-chapter" class="btn btn--secondary">+ Añadir capítulo</button>
      </div>
    `;
  }
  
  // Sesiones (REQ-011, AC-008)
  html += `
    <div class="detail__section">
      <h4 class="detail__section-title">Sesiones de visionado/juego</h4>
      <div id="sessions-list" class="sessions"></div>
      <button type="button" id="btn-add-session" class="btn btn--secondary">Añadir sesión</button>
    </div>
  `;
  
  html += `</div>`;
  
  detailContent.innerHTML = html;
  
  // Spec 004 (AC-004): event listeners para corazón y colecciones en la ficha
  const btnDetailHeart = document.getElementById("btn-detail-heart");
  if (btnDetailHeart) {
    btnDetailHeart.addEventListener("click", async () => {
      btnDetailHeart.disabled = true;
      try {
        await toggleItemFavorite(mediaType, item.id);
        // Refrescar la ficha para reflejar el nuevo estado
        const updated = await getItem(mediaType, item.id);
        currentDetailItem = updated;
        renderDetail(updated);
      } catch (error) {
        console.error("Error al alternar favorito:", error);
      } finally {
        btnDetailHeart.disabled = false;
      }
    });
  }
  
  const btnDetailCollections = document.getElementById("btn-detail-collections");
  if (btnDetailCollections) {
    btnDetailCollections.addEventListener("click", () => {
      openCollectionPicker("item", item.id, mediaType);
    });
  }
  
  // Spec 004 (AC-002): renderizar capítulos favoritos
  if (CHAPTER_PARENT_MEDIA_TYPES.includes(mediaType)) {
    renderChaptersSection(item);
    
    const btnAddChapter = document.getElementById("btn-add-chapter");
    if (btnAddChapter) {
      btnAddChapter.addEventListener("click", () => {
        openChapterForm(mediaType, item.id, null);
      });
    }
  }
  
  // Render metadata section (T-005)
  renderMetadataSection(item);
  
  // Rating scale interaction
  const ratingButtons = detailContent.querySelectorAll(".rating-scale__button");
  const ratingInput = detailContent.querySelector('input[name="rating"]');
  ratingButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = Number(btn.dataset.rating);
      ratingInput.value = value;
      ratingButtons.forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
    });
  });
  
  // Render sessions
  renderSessions(item);
  
  // Add session button
  const btnAddSession = document.getElementById("btn-add-session");
  btnAddSession.addEventListener("click", () => {
    openSessionForm(item.mediaType, item.id, null);
  });
  
  // Form submit
  const detailForm = document.getElementById("detail-form");
  detailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveDetail(item.mediaType, item.id);
  });
}

// =============================================================
// T-005 — Metadata Section (REQ-004, AC-004, AC-008, AC-009)
// =============================================================

function renderMetadataSection(item, forceRefresh) {
  const metadataSection = document.getElementById("metadata-section");
  if (!metadataSection) return;
  
  const mediaType = item.mediaType || activeMediaType;
  const provider = item.source?.provider;
  const externalId = item.source?.externalId;
  
  // MED #3 (REQ-009): si se fuerza refetch, omitir isMetadataFresh
  if (!forceRefresh && isMetadataFresh(item)) {
    // Render cached metadata
    renderMetadataContent(item, item, null);
    return;
  }
  
  // Check if we can fetch metadata
  if (provider && externalId && provider !== "manual") {
    // Show loading state
    metadataSection.innerHTML = `
      <div class="metadata-loading">
        <p class="muted">Cargando información adicional…</p>
      </div>
    `;
    
    // Fetch metadata
    fetchMetadataForItem(item, mediaType, provider, externalId);
  } else {
    // No provider or manual source - show manual form directly
    renderMetadataContent(item, null, null);
  }
}

async function fetchMetadataForItem(item, mediaType, provider, externalId) {
  const metadataSection = document.getElementById("metadata-section");
  if (!metadataSection) return;
  
  try {
    let result;
    
    // Route to appropriate fetch function based on provider
    if (provider === "tmdb") {
      if (mediaType === "movie") {
        result = await fetchTmdbMovieMetadata(externalId);
      } else if (mediaType === "series" || mediaType === "anime") {
        result = await fetchTmdbTvMetadata(externalId);
      } else {
        result = await fetchTmdbMetadata(mediaType, externalId);
      }
    } else if (provider === "igdb") {
      result = await fetchIgdbGameMetadata(externalId);
    } else if (provider === "googlebooks") {
      result = await fetchGoogleBookMetadata(externalId);
    } else {
      // Unknown provider - show manual form
      renderMetadataContent(item, null, null);
      return;
    }
    
    if (!result.ok) {
      // Handle error
      renderMetadataError(item, result);
      return;
    }
    
    // Success - render metadata
    const metadata = result.item;
    const isPartial = result.partial === true;
    
    // Try to cache metadata (non-blocking, AC-009)
    let cacheWriteFailed = false;
    try {
      await updateItemMetadata(mediaType, item.id, metadata, provider);
      // Update currentDetailItem with cached metadata
      const updated = await getItem(mediaType, item.id);
      currentDetailItem = updated;
    } catch (cacheError) {
      // MED #2 (REQ-010/AC-009, §4.1 «fallo de escritura de caché»):
      // aviso visible con botón de reintento.
      cacheWriteFailed = true;
      console.warn("No se pudo cachear la metadata:", cacheError);
    }
    
    renderMetadataContent(item, metadata, isPartial ? "partial" : null, cacheWriteFailed ? { mediaType, provider, itemId: item.id } : null);
    
  } catch (error) {
    // Unexpected error
    renderMetadataError(item, { ok: false, provider, code: "unknown", message: error.message || "Error desconocido" });
  }
}

function renderMetadataError(item, errorResult) {
  const metadataSection = document.getElementById("metadata-section");
  if (!metadataSection) return;
  
  const code = errorResult.code || "unknown";
  let message = "No se pudo cargar la información adicional.";
  
  if (code === "not_found") {
    message = "No se encontró en la base de datos externa.";
  } else if (code === "rate_limited") {
    message = "Demasiadas solicitudes. Inténtalo de nuevo en unos minutos.";
  } else if (code === "unauthorized") {
    message = "Error de autenticación con el proveedor externo.";
  } else if (code === "timeout") {
    message = "La solicitud tardó demasiado. Inténtalo de nuevo.";
  }
  
  metadataSection.innerHTML = `
    <div class="metadata-error">
      <p class="metadata-error__message">${escapeHtml(message)}</p>
      <div class="metadata-error__actions">
        <button type="button" class="btn btn--secondary" id="btn-retry-metadata">Reintentar</button>
        <button type="button" class="btn btn--secondary" id="btn-manual-metadata">Añadir manualmente</button>
      </div>
    </div>
  `;
  
  // Retry button
  const btnRetry = document.getElementById("btn-retry-metadata");
  if (btnRetry) {
    btnRetry.addEventListener("click", () => {
      const provider = item.source?.provider;
      const externalId = item.source?.externalId;
      if (provider && externalId) {
        renderMetadataSection(item);
      }
    });
  }
  
  // Manual form button
  const btnManual = document.getElementById("btn-manual-metadata");
  if (btnManual) {
    btnManual.addEventListener("click", () => {
      openMetadataForm(item, null);
    });
  }
}

function renderMetadataContent(item, metadata, warning, cacheFailureInfo) {
  const metadataSection = document.getElementById("metadata-section");
  if (!metadataSection) return;
  
  const mediaType = item.mediaType || activeMediaType;
  
  // Use metadata if available, otherwise use item fields
  const data = metadata || item;
  
  let html = "";
  
  // MED #2 (REQ-010/AC-009): aviso visible si falló la escritura de caché
  if (cacheFailureInfo) {
    html += `
      <div class="metadata-error" style="margin-bottom:12px;">
        <p class="metadata-error__message">No se pudo guardar la información en caché.</p>
        <div class="metadata-error__actions">
          <button type="button" class="btn btn--secondary" id="btn-retry-cache">Reintentar</button>
        </div>
      </div>
    `;
  }
  
  // Warning for partial data
  if (warning === "partial") {
    html += `<div class="metadata-warning">Información incompleta.</div>`;
  }
  
  // Progress info by type
  const progressHtml = renderProgressInfo(item, mediaType);
  if (progressHtml) {
    html += progressHtml;
  }
  
  // Director (movies, series, anime)
  if (data.director && (mediaType === "movie" || mediaType === "series" || mediaType === "anime")) {
    html += `
      <div class="metadata-field">
        <span class="metadata-field__label">Director</span>
        <span class="metadata-field__value">${escapeHtml(data.director)}</span>
      </div>
    `;
  }
  
  // Cast list
  if (data.cast && Array.isArray(data.cast) && data.cast.length > 0) {
    html += `
      <div class="metadata-field metadata-field--cast">
        <span class="metadata-field__label">Reparto</span>
        <div class="metadata-cast-list">
          ${data.cast.slice(0, 10).map(name => `<span class="metadata-cast-item">${escapeHtml(name)}</span>`).join("")}
        </div>
      </div>
    `;
  }
  
  // Publishers/Developers/Platforms (games)
  if (mediaType === "game") {
    if (data.developers && Array.isArray(data.developers) && data.developers.length > 0) {
      html += `
        <div class="metadata-field">
          <span class="metadata-field__label">Desarrollador</span>
          <span class="metadata-field__value">${escapeHtml(data.developers.join(", "))}</span>
        </div>
      `;
    }
    if (data.publisher) {
      html += `
        <div class="metadata-field">
          <span class="metadata-field__label">Editorial</span>
          <span class="metadata-field__value">${escapeHtml(data.publisher)}</span>
        </div>
      `;
    }
    if (data.platforms && Array.isArray(data.platforms) && data.platforms.length > 0) {
      html += `
        <div class="metadata-field">
          <span class="metadata-field__label">Plataformas</span>
          <span class="metadata-field__value">${escapeHtml(data.platforms.join(", "))}</span>
        </div>
      `;
    }
  }
  
  // Authors (books)
  if (mediaType === "book" && data.authors && Array.isArray(data.authors) && data.authors.length > 0) {
    html += `
      <div class="metadata-field">
        <span class="metadata-field__label">Autores</span>
        <span class="metadata-field__value">${escapeHtml(data.authors.join(", "))}</span>
      </div>
    `;
  }
  
  // Page count (books)
  if (mediaType === "book" && data.pageCount) {
    html += `
      <div class="metadata-field">
        <span class="metadata-field__label">Páginas</span>
        <span class="metadata-field__value">${escapeHtml(data.pageCount)}</span>
      </div>
    `;
  }
  
  // Seasons/Episodes (series, anime)
  if ((mediaType === "series" || mediaType === "anime") && (data.seasons || data.episodes)) {
    const parts = [];
    if (data.seasons) parts.push(`${data.seasons} temporada${data.seasons !== 1 ? "s" : ""}`);
    if (data.episodes) parts.push(`${data.episodes} episodio${data.episodes !== 1 ? "s" : ""}`);
    html += `
      <div class="metadata-field">
        <span class="metadata-field__label">Episodios</span>
        <span class="metadata-field__value">${escapeHtml(parts.join(", "))}</span>
      </div>
    `;
  }
  
  // Language
  if (data.language) {
    html += `
      <div class="metadata-field">
        <span class="metadata-field__label">Idioma</span>
        <span class="metadata-field__value">${escapeHtml(data.language)}</span>
      </div>
    `;
  }
  
  // Edit metadata button
  html += `
    <div class="metadata-actions">
      <button type="button" class="btn btn--secondary" id="btn-edit-metadata">Editar metadata</button>
    </div>
  `;
  
  if (html) {
    metadataSection.innerHTML = `
      <h4 class="detail__section-title">Información adicional</h4>
      <div class="metadata-content">
        ${html}
      </div>
      <div class="metadata-actions">
        <button type="button" class="btn btn--secondary" id="btn-refresh-metadata">Refrescar metadata</button>
      </div>
    `;
  } else {
    metadataSection.innerHTML = `
      <h4 class="detail__section-title">Información adicional</h4>
      <div class="metadata-content">
        <p class="muted">Sin información adicional.</p>
        <button type="button" class="btn btn--secondary" id="btn-edit-metadata">Añadir manualmente</button>
      </div>
      <div class="metadata-actions">
        <button type="button" class="btn btn--secondary" id="btn-refresh-metadata">Refrescar metadata</button>
      </div>
    `;
  }
  
  // MED #3 (REQ-009): botón «Refrescar metadata» siempre visible
  const btnRefresh = document.getElementById("btn-refresh-metadata");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => {
      renderMetadataSection(item, true);
    });
  }
  
  // Edit metadata button
  const btnEdit = document.getElementById("btn-edit-metadata");
  if (btnEdit) {
    btnEdit.addEventListener("click", () => {
      openMetadataForm(item, metadata);
    });
  }
  
  // MED #2: botón de reintento de escritura de caché
  const btnRetryCache = document.getElementById("btn-retry-cache");
  if (btnRetryCache && cacheFailureInfo) {
    btnRetryCache.addEventListener("click", async () => {
      btnRetryCache.disabled = true;
      btnRetryCache.textContent = "Reintentando…";
      try {
        await updateItemMetadata(cacheFailureInfo.mediaType, cacheFailureInfo.itemId, metadata || item, cacheFailureInfo.provider);
        const updated = await getItem(cacheFailureInfo.mediaType, cacheFailureInfo.itemId);
        currentDetailItem = updated;
        renderMetadataContent(updated, metadata || item, warning, null);
      } catch (err) {
        btnRetryCache.disabled = false;
        btnRetryCache.textContent = "Reintentar";
        console.warn("Reintento de caché falló:", err);
      }
    });
  }
}

function renderProgressInfo(item, mediaType) {
  const parts = [];
  
  if (mediaType === "movie" && item.durationMinutes) {
    parts.push(`${item.durationMinutes} min`);
  }
  
  if ((mediaType === "series" || mediaType === "anime")) {
    const nextEp = nextEpisodeLabel(item);
    if (nextEp) {
      return `
        <div class="metadata-progress">
          <span class="metadata-progress__label">Siguiente episodio:</span>
          <span class="metadata-progress__value">${escapeHtml(nextEp)}</span>
        </div>
      `;
    }
  }
  
  if (mediaType === "game") {
    if (item.hoursPlayed) parts.push(`${item.hoursPlayed}h jugadas`);
    if (item.completionPercent) parts.push(`${item.completionPercent}% completado`);
    if (item.platform) parts.push(item.platform);
    if (item.achievementsUnlocked && item.achievementsTotal) {
      parts.push(`${item.achievementsUnlocked}/${item.achievementsTotal} logros`);
    }
  }
  
  if (mediaType === "book") {
    if (item.pagesRead && item.pagesTotal) {
      parts.push(`${item.pagesRead}/${item.pagesTotal} páginas`);
    }
  }
  
  if (parts.length > 0) {
    return `
      <div class="metadata-progress">
        <span class="metadata-progress__value">${escapeHtml(parts.join(" · "))}</span>
      </div>
    `;
  }
  
  return "";
}

function openMetadataForm(item, existingMetadata) {
  const mediaType = item.mediaType || activeMediaType;
  const data = existingMetadata || {};
  
  // Pre-fill form with existing metadata or item fields
  const formData = {
    director: data.director || "",
    cast: data.cast && Array.isArray(data.cast) ? data.cast.join("\n") : "",
    backdropUrl: data.backdropUrl || item.backdropUrl || "",
    tagline: data.tagline || "",
    platforms: data.platforms && Array.isArray(data.platforms) ? data.platforms.join("\n") : "",
    developers: data.developers && Array.isArray(data.developers) ? data.developers.join("\n") : "",
    publisher: data.publisher || "",
    authors: data.authors && Array.isArray(data.authors) ? data.authors.join("\n") : "",
    pageCount: data.pageCount || "",
    seasons: data.seasons || "",
    episodes: data.episodes || "",
    language: data.language || "",
  };
  
  const formHtml = `
    <form id="metadata-form" class="form" novalidate>
      <div id="metadata-form-errors" class="form-errors" hidden role="alert"></div>
      
      <label class="form-field">
        <span class="form-field__label">Director</span>
        <input type="text" name="director" class="form-field__input" value="${escapeHtml(formData.director)}" maxlength="200">
      </label>
      
      <label class="form-field">
        <span class="form-field__label">Reparto (un nombre por línea)</span>
        <textarea name="cast" class="form-field__textarea" rows="4">${escapeHtml(formData.cast)}</textarea>
      </label>
      
      <label class="form-field">
        <span class="form-field__label">URL del backdrop</span>
        <input type="url" name="backdropUrl" class="form-field__input" value="${escapeHtml(formData.backdropUrl)}" placeholder="https://…">
      </label>
      
      <label class="form-field">
        <span class="form-field__label">Tagline</span>
        <input type="text" name="tagline" class="form-field__input" value="${escapeHtml(formData.tagline)}" maxlength="300">
      </label>
      
      ${mediaType === "game" ? `
        <label class="form-field">
          <span class="form-field__label">Plataformas (una por línea)</span>
          <textarea name="platforms" class="form-field__textarea" rows="3">${escapeHtml(formData.platforms)}</textarea>
        </label>
        
        <label class="form-field">
          <span class="form-field__label">Desarrolladores (uno por línea)</span>
          <textarea name="developers" class="form-field__textarea" rows="3">${escapeHtml(formData.developers)}</textarea>
        </label>
        
        <label class="form-field">
          <span class="form-field__label">Editorial</span>
          <input type="text" name="publisher" class="form-field__input" value="${escapeHtml(formData.publisher)}" maxlength="200">
        </label>
      ` : ""}
      
      ${mediaType === "book" ? `
        <label class="form-field">
          <span class="form-field__label">Autores (uno por línea)</span>
          <textarea name="authors" class="form-field__textarea" rows="3">${escapeHtml(formData.authors)}</textarea>
        </label>
        
        <label class="form-field">
          <span class="form-field__label">Número de páginas</span>
          <input type="number" name="pageCount" class="form-field__input" value="${escapeHtml(formData.pageCount)}" min="0">
        </label>
      ` : ""}
      
      ${(mediaType === "series" || mediaType === "anime") ? `
        <label class="form-field">
          <span class="form-field__label">Temporadas</span>
          <input type="number" name="seasons" class="form-field__input" value="${escapeHtml(formData.seasons)}" min="0">
        </label>
        
        <label class="form-field">
          <span class="form-field__label">Episodios</span>
          <input type="number" name="episodes" class="form-field__input" value="${escapeHtml(formData.episodes)}" min="0">
        </label>
      ` : ""}
      
      <label class="form-field">
        <span class="form-field__label">Idioma</span>
        <input type="text" name="language" class="form-field__input" value="${escapeHtml(formData.language)}" maxlength="50">
      </label>
      
      <div class="modal__footer">
        <button type="submit" class="btn btn--primary">Guardar</button>
        <button type="button" class="btn" id="btn-cancel-metadata">Cancelar</button>
      </div>
    </form>
  `;
  
  const metadataSection = document.getElementById("metadata-section");
  if (!metadataSection) return;
  
  metadataSection.innerHTML = `
    <h4 class="detail__section-title">Editar metadata</h4>
    ${formHtml}
  `;
  
  const metadataForm = document.getElementById("metadata-form");
  const metadataFormErrors = document.getElementById("metadata-form-errors");
  
  // Cancel button
  document.getElementById("btn-cancel-metadata").addEventListener("click", () => {
    renderMetadataSection(item);
  });
  
  // Form submit
  metadataForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    
    const formData = new FormData(metadataForm);
    
    // Parse textarea fields (one per line)
    const parseLines = (text) => text.split("\n").map(l => l.trim()).filter(l => l);
    
    const metadata = {
      director: formData.get("director") || null,
      cast: parseLines(formData.get("cast") || ""),
      backdropUrl: formData.get("backdropUrl") || null,
      tagline: formData.get("tagline") || null,
      platforms: parseLines(formData.get("platforms") || ""),
      developers: parseLines(formData.get("developers") || ""),
      publisher: formData.get("publisher") || null,
      authors: parseLines(formData.get("authors") || ""),
      pageCount: formData.get("pageCount") ? Number(formData.get("pageCount")) : null,
      seasons: formData.get("seasons") ? Number(formData.get("seasons")) : null,
      episodes: formData.get("episodes") ? Number(formData.get("episodes")) : null,
      language: formData.get("language") || null,
    };
    
    // Validate metadata
    const validation = validateMetadata(metadata);
    if (!validation.valid) {
      metadataFormErrors.innerHTML = `<ul>${validation.errors.map(e => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
      metadataFormErrors.hidden = false;
      return;
    }
    
    try {
      await updateItemMetadata(mediaType, item.id, metadata, "manual");
      const updated = await getItem(mediaType, item.id);
      currentDetailItem = updated;
      renderDetail(updated);
    } catch (error) {
      metadataFormErrors.innerHTML = `<ul><li>${escapeHtml(error.message || "No se pudo guardar la metadata.")}</li></ul>`;
      metadataFormErrors.hidden = false;
    }
  });
}

async function saveDetail(mediaType, itemId) {
  const form = document.getElementById("detail-form");
  const errorsEl = document.getElementById("detail-errors");
  const formData = new FormData(form);
  
  const patch = {
    status: formData.get("status"),
    rating: formData.get("rating") ? Number(formData.get("rating")) : null,
    review: formData.get("review") || null,
    completedAt: formData.get("completedAt") || null,
  };
  
  // Campos específicos por tipo
  if (mediaType === "series" || mediaType === "anime") {
    patch.currentSeason = formData.get("currentSeason") ? Number(formData.get("currentSeason")) : null;
    patch.currentEpisode = formData.get("currentEpisode") ? Number(formData.get("currentEpisode")) : null;
    patch.totalSeasons = formData.get("totalSeasons") ? Number(formData.get("totalSeasons")) : null;
    patch.totalEpisodes = formData.get("totalEpisodes") ? Number(formData.get("totalEpisodes")) : null;
  } else if (mediaType === "game") {
    patch.hoursPlayed = formData.get("hoursPlayed") ? Number(formData.get("hoursPlayed")) : null;
    patch.completionPercent = formData.get("completionPercent") ? Number(formData.get("completionPercent")) : null;
    patch.platform = formData.get("platform") || null;
    patch.achievementsUnlocked = formData.get("achievementsUnlocked") ? Number(formData.get("achievementsUnlocked")) : null;
    patch.achievementsTotal = formData.get("achievementsTotal") ? Number(formData.get("achievementsTotal")) : null;
  } else if (mediaType === "book") {
    patch.pagesRead = formData.get("pagesRead") ? Number(formData.get("pagesRead")) : null;
    patch.pagesTotal = formData.get("pagesTotal") ? Number(formData.get("pagesTotal")) : null;
  }
  
  // Validar (AC-010)
  const itemToValidate = normalizeItem(mediaType, { ...currentDetailItem, ...patch });
  const validation = validateItem(itemToValidate);
  
  if (!validation.valid) {
    // MED #3: escapar mensajes de error para evitar XSS (REQ-014).
    errorsEl.innerHTML = `<ul>${validation.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
    errorsEl.hidden = false;
    return;
  }
  
  try {
    const updated = await updateItem(mediaType, itemId, patch);
    currentDetailItem = updated;
    renderDetail(updated);
    errorsEl.hidden = true;
  } catch (error) {
    // MED #3: escapar mensajes de error para evitar XSS (REQ-014).
    errorsEl.innerHTML = `<ul><li>${escapeHtml(error.message || "No se pudo guardar.")}</li></ul>`;
    errorsEl.hidden = false;
  }
}

function renderSessions(item) {
  const sessionsList = document.getElementById("sessions-list");
  if (!sessionsList) return;
  
  const sessions = sortSessionsByDateDesc(item.sessions || []);
  
  if (sessions.length === 0) {
    sessionsList.innerHTML = '<p class="muted">No hay sesiones registradas.</p>';
    return;
  }
  
  // MED #3: escapar valores dinámicos (nota, fecha, rating, progreso).
  sessionsList.innerHTML = sessions
    .map((session) => {
      const date = session.date ? new Date(session.date).toLocaleDateString("es-ES") : "Sin fecha";
      const eDate = escapeHtml(date);
      const eSessionId = escapeHtml(session.id || "");
      const eNote = escapeHtml(session.note || "");
      const eRating = session.rating !== undefined && session.rating !== null ? escapeHtml(session.rating) : "";
      const eProgress = escapeHtml(session.progress || "");
      return `
        <div class="session" data-session-id="${eSessionId}">
          <div class="session__header">
            <span class="session__date">${eDate}</span>
            <div class="session__actions">
              <button type="button" class="btn-edit-session" data-session-id="${eSessionId}">Editar</button>
              <button type="button" class="btn-delete-session" data-session-id="${eSessionId}">Borrar</button>
            </div>
          </div>
          <div class="session__body">
            ${session.note ? `<p class="session__note">${eNote}</p>` : ""}
            <div class="session__meta">
              ${session.rating ? `<span>★ ${eRating}/10</span>` : ""}
              ${session.progress ? `<span>${eProgress}</span>` : ""}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
  
  // Edit session buttons
  sessionsList.querySelectorAll(".btn-edit-session").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sessionId = btn.dataset.sessionId;
      const session = sessions.find((s) => s.id === sessionId);
      if (session) {
        openSessionForm(item.mediaType, item.id, session);
      }
    });
  });
  
  // Delete session buttons
  sessionsList.querySelectorAll(".btn-delete-session").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessionId = btn.dataset.sessionId;
      const confirmed = window.confirm("¿Seguro que quieres borrar esta sesión?");
      if (!confirmed) return;
      
      try {
        await removeItemSession(item.mediaType, item.id, sessionId);
        const updated = await getItem(item.mediaType, item.id);
        currentDetailItem = updated;
        renderDetail(updated);
      } catch (error) {
        alert(`No se pudo borrar la sesión: ${error.message || "error desconocido"}`);
      }
    });
  });
}

function openSessionForm(mediaType, itemId, session = null) {
  const isEdit = session !== null;
  const title = isEdit ? "Editar sesión" : "Añadir sesión";
  
  // MED #3: escapar valores dinámicos para evitar XSS (REQ-014).
  const eDate = session && session.date ? escapeHtml(new Date(session.date).toISOString().split("T")[0]) : "";
  const eNote = escapeHtml(session?.note || "");
  const eRatingValue = session?.rating !== undefined && session?.rating !== null ? escapeHtml(session.rating) : "";
  const eProgress = escapeHtml(session?.progress || "");
  
  const formHtml = `
    <form id="session-form" class="form" novalidate>
      <div id="session-errors" class="form-errors" hidden role="alert"></div>
      <label class="form-field">
        <span class="form-field__label">Fecha *</span>
        <input type="date" name="date" class="form-field__input" required value="${eDate}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Nota (máx. 500 caracteres)</span>
        <textarea name="note" class="form-field__textarea" maxlength="500" rows="3">${eNote}</textarea>
      </label>
      <div class="form-field">
        <span class="form-field__label">Valoración (1-10)</span>
        <div class="rating-scale" role="group" aria-label="Valoración de sesión">
          ${Array.from({ length: 10 }, (_, i) => i + 1)
            .map((n) => `<button type="button" class="rating-scale__button" data-rating="${n}" aria-pressed="${session?.rating === n}" aria-label="${n} de 10">${n}</button>`)
            .join("")}
        </div>
        <input type="hidden" name="rating" value="${eRatingValue}">
      </div>
      <label class="form-field">
        <span class="form-field__label">Progreso</span>
        <input type="text" name="progress" class="form-field__input" value="${eProgress}">
      </label>
      <div class="modal__footer">
        <button type="submit" class="btn btn--primary">${isEdit ? "Guardar" : "Añadir"}</button>
        <button type="button" class="btn" id="btn-cancel-session">Cancelar</button>
      </div>
    </form>
  `;
  
  // Reemplazar el contenido de sesiones con el formulario
  const sessionsSection = detailContent.querySelector(".detail__section:last-child");
  const originalContent = sessionsSection.innerHTML;
  sessionsSection.innerHTML = formHtml;
  
  const sessionForm = document.getElementById("session-form");
  const sessionErrors = document.getElementById("session-errors");
  const ratingButtons = sessionForm.querySelectorAll(".rating-scale__button");
  const ratingInput = sessionForm.querySelector('input[name="rating"]');
  
  // Rating scale interaction
  ratingButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = Number(btn.dataset.rating);
      ratingInput.value = value;
      ratingButtons.forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
    });
  });
  
  // Cancel button
  document.getElementById("btn-cancel-session").addEventListener("click", () => {
    sessionsSection.innerHTML = originalContent;
    renderSessions(currentDetailItem);
    const btnAddSession = document.getElementById("btn-add-session");
    if (btnAddSession) {
      btnAddSession.addEventListener("click", () => {
        openSessionForm(currentDetailItem.mediaType, currentDetailItem.id, null);
      });
    }
  });
  
  // Form submit
  sessionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    
    const formData = new FormData(sessionForm);
    const sessionData = {
      date: formData.get("date"),
      note: formData.get("note") || null,
      rating: formData.get("rating") ? Number(formData.get("rating")) : null,
      progress: formData.get("progress") || null,
    };
    
    if (!sessionData.date) {
      sessionErrors.innerHTML = "<ul><li>La fecha es obligatoria.</li></ul>";
      sessionErrors.hidden = false;
      return;
    }
    
    try {
      if (isEdit) {
        await updateItemSession(mediaType, itemId, session.id, sessionData);
      } else {
        await addItemSession(mediaType, itemId, sessionData);
      }
      
      const updated = await getItem(mediaType, itemId);
      currentDetailItem = updated;
      renderDetail(updated);
    } catch (error) {
      // MED #3: escapar mensajes de error para evitar XSS (REQ-014).
      sessionErrors.innerHTML = `<ul><li>${escapeHtml(error.message || "No se pudo guardar la sesión.")}</li></ul>`;
      sessionErrors.hidden = false;
    }
  });
}

// =============================================================
// Spec 004 — Capítulos favoritos en ficha (AC-002, AC-014)
// =============================================================

let chaptersUnsubscribe = null;
let chaptersForCurrentItem = [];

async function renderChaptersSection(item) {
  const chaptersList = document.getElementById("chapters-list");
  if (!chaptersList) return;
  
  // Cancelar suscripción previa
  if (typeof chaptersUnsubscribe === "function") {
    try { await chaptersUnsubscribe(); } catch { /* ignore */ }
    chaptersUnsubscribe = null;
  }
  chaptersForCurrentItem = [];
  chaptersList.innerHTML = '<p class="muted">Cargando capítulos…</p>';
  
  try {
    chaptersUnsubscribe = await subscribeChapters({
      limitCount: 1000,
      onItems(chapters) {
        // Filtrar por parentItemId
        chaptersForCurrentItem = (chapters || []).filter(
          ch => ch.parentItemId === item.id
        );
        renderChaptersList(item);
      },
      onError(error) {
        chaptersList.innerHTML = `<p class="error">Error al cargar capítulos: ${escapeHtml(error?.message || "desconocido")}</p>`;
      },
    });
  } catch (error) {
    chaptersList.innerHTML = `<p class="error">Error al suscribirse a capítulos: ${escapeHtml(error?.message || "desconocido")}</p>`;
  }
}

function renderChaptersList(item) {
  const chaptersList = document.getElementById("chapters-list");
  if (!chaptersList) return;
  
  chaptersList.innerHTML = "";
  
  if (chaptersForCurrentItem.length === 0) {
    chaptersList.innerHTML = '<p class="muted">No hay capítulos favoritos todavía.</p>';
    return;
  }
  
  for (const chapter of chaptersForCurrentItem) {
    const card = createChapterCard(chapter, item);
    chaptersList.appendChild(card);
  }
}

function createChapterCard(chapter, parentItem) {
  const div = document.createElement("div");
  div.className = "chapter-card";
  div.dataset.chapterId = chapter.id;
  
  // Título
  const title = document.createElement("div");
  title.className = "chapter-card__title";
  title.textContent = chapter.title || "Sin título";
  div.appendChild(title);
  
  // Meta info
  const meta = document.createElement("div");
  meta.className = "chapter-card__meta";
  const metaParts = [];
  
  if (chapter.season != null && chapter.episode != null) {
    metaParts.push(`S${chapter.season}E${chapter.episode}`);
  } else if (chapter.season != null) {
    metaParts.push(`T${chapter.season}`);
  } else if (chapter.episode != null) {
    metaParts.push(`E${chapter.episode}`);
  }
  
  if (typeof chapter.rating === "number" && Number.isFinite(chapter.rating)) {
    metaParts.push(`${chapter.rating}/10`);
  }
  
  if (typeof chapter.watchCount === "number" && chapter.watchCount > 0) {
    metaParts.push(`Visto ${chapter.watchCount} ${chapter.watchCount === 1 ? "vez" : "veces"}`);
  }
  
  meta.textContent = metaParts.join(" · ");
  div.appendChild(meta);
  
  // Notas truncadas
  if (chapter.notes) {
    const notes = document.createElement("div");
    notes.className = "chapter-card__notes";
    const truncated = chapter.notes.length > 100 ? chapter.notes.substring(0, 100) + "…" : chapter.notes;
    notes.textContent = truncated;
    div.appendChild(notes);
  }
  
  // Acciones
  const actions = document.createElement("div");
  actions.className = "chapter-card__actions";
  
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn btn--secondary";
  editBtn.textContent = "Editar";
  editBtn.style.cssText = "width:auto;padding:4px 10px;font-size:0.8rem;";
  editBtn.addEventListener("click", () => {
    openChapterForm(parentItem.mediaType || activeMediaType, parentItem.id, chapter);
  });
  actions.appendChild(editBtn);
  
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn--danger";
  deleteBtn.textContent = "Borrar";
  deleteBtn.style.cssText = "width:auto;padding:4px 10px;font-size:0.8rem;";
  deleteBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(`¿Seguro que quieres borrar el capítulo «${chapter.title || "este capítulo"}»? Desaparecerá de Favoritos pero no afectará a la serie/libro.`);
    if (!confirmed) return;
    deleteBtn.disabled = true;
    try {
      await deleteChapter(chapter.id);
      // La suscripción en vivo actualizará la lista
    } catch (error) {
      console.error("Error al borrar capítulo:", error);
      deleteBtn.disabled = false;
    }
  });
  actions.appendChild(deleteBtn);
  
  div.appendChild(actions);
  
  return div;
}

function openChapterForm(parentMediaType, parentItemId, chapter = null) {
  const isEdit = chapter !== null;
  const title = isEdit ? "Editar capítulo" : "Nuevo capítulo";
  
  // Pre-fill values
  const eTitle = escapeHtml(chapter?.title || "");
  const eSeason = chapter?.season != null ? escapeHtml(chapter.season) : "";
  const eEpisode = chapter?.episode != null ? escapeHtml(chapter.episode) : "";
  const eNotes = escapeHtml(chapter?.notes || "");
  const eRating = chapter?.rating != null ? escapeHtml(chapter.rating) : "";
  const eWatchCount = chapter?.watchCount != null ? escapeHtml(chapter.watchCount) : "0";
  
  const formHtml = `
    <form id="chapter-form" class="form" novalidate>
      <div id="chapter-form-errors" class="form-errors" hidden role="alert"></div>
      <label class="form-field">
        <span class="form-field__label">Título *</span>
        <input type="text" name="title" class="form-field__input" required maxlength="200" value="${eTitle}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Temporada</span>
        <input type="number" name="season" class="form-field__input" min="1" value="${eSeason}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Episodio</span>
        <input type="number" name="episode" class="form-field__input" min="1" value="${eEpisode}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Notas (máx. 500 caracteres)</span>
        <textarea name="notes" class="form-field__textarea" maxlength="500" rows="3">${eNotes}</textarea>
      </label>
      <label class="form-field">
        <span class="form-field__label">Valoración (1-10)</span>
        <input type="number" name="rating" class="form-field__input" min="1" max="10" value="${eRating}">
      </label>
      <label class="form-field">
        <span class="form-field__label">Veces visto</span>
        <input type="number" name="watchCount" class="form-field__input" min="0" value="${eWatchCount}">
      </label>
      <div class="modal__footer">
        <button type="submit" class="btn btn--primary">${isEdit ? "Guardar" : "Añadir"}</button>
        <button type="button" class="btn" id="btn-cancel-chapter">Cancelar</button>
      </div>
    </form>
  `;
  
  // Reemplazar la sección de capítulos con el formulario
  const chaptersSection = document.getElementById("chapters-section");
  if (!chaptersSection) return;
  const originalContent = chaptersSection.innerHTML;
  chaptersSection.innerHTML = `<h4 class="detail__section-title">${escapeHtml(title)}</h4>${formHtml}`;
  
  const chapterForm = document.getElementById("chapter-form");
  const chapterErrors = document.getElementById("chapter-form-errors");
  
  // Cancel button
  document.getElementById("btn-cancel-chapter").addEventListener("click", () => {
    chaptersSection.innerHTML = originalContent;
    // Re-render chapters
    const item = currentDetailItem;
    if (item) {
      renderChaptersSection(item);
      const btnAddChapter = document.getElementById("btn-add-chapter");
      if (btnAddChapter) {
        btnAddChapter.addEventListener("click", () => {
          openChapterForm(item.mediaType || activeMediaType, item.id, null);
        });
      }
    }
  });
  
  // Form submit
  chapterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    
    const formData = new FormData(chapterForm);
    const data = {
      parentMediaType: parentMediaType,
      parentItemId: parentItemId,
      title: formData.get("title") || "",
      season: formData.get("season") ? Number(formData.get("season")) : null,
      episode: formData.get("episode") ? Number(formData.get("episode")) : null,
      notes: formData.get("notes") || null,
      rating: formData.get("rating") ? Number(formData.get("rating")) : null,
      watchCount: formData.get("watchCount") ? Number(formData.get("watchCount")) : 0,
    };
    
    // Validar
    const normalized = normalizeFavoriteChapter(data);
    const validation = validateFavoriteChapter(normalized);
    
    if (!validation.valid) {
      chapterErrors.innerHTML = `<ul>${validation.errors.map(e => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`;
      chapterErrors.hidden = false;
      return;
    }
    
    try {
      if (isEdit) {
        await updateChapter(chapter.id, data);
      } else {
        await createChapter(data);
      }
      // La suscripción en vivo actualizará la lista
      chaptersSection.innerHTML = originalContent;
      const item = currentDetailItem;
      if (item) {
        renderChaptersSection(item);
        const btnAddChapter = document.getElementById("btn-add-chapter");
        if (btnAddChapter) {
          btnAddChapter.addEventListener("click", () => {
            openChapterForm(item.mediaType || activeMediaType, item.id, null);
          });
        }
      }
    } catch (error) {
      chapterErrors.innerHTML = `<ul><li>${escapeHtml(error.message || "No se pudo guardar el capítulo.")}</li></ul>`;
      chapterErrors.hidden = false;
    }
  });
}

// =============================================================
// Spec 004 — Bloque Favoritos en Dashboard (AC-005, D-007, REQ-005)
// =============================================================

let dashboardChaptersUnsubscribe = null;
let dashboardFavoriteChapters = [];

function renderDashboardFavoritesBlock() {
  const dashboardFavoritesBlock = document.getElementById("dashboard-favorites-block");
  if (!dashboardFavoritesBlock) return;
  
  // Recopilar ítems favoritos de todos los tipos
  const allFavoriteItems = [];
  for (const mediaType of MEDIA_TYPES) {
    const items = dashboardItemsByType[mediaType] || [];
    for (const item of items) {
      if (item.isFavorite) {
        allFavoriteItems.push({ ...item, mediaType });
      }
    }
  }
  
  const stats = computeFavoritesStats(allFavoriteItems, dashboardFavoriteChapters);
  
  let html = `<h4 class="dashboard__section-title">Favoritos</h4>`;
  html += `<div class="dashboard__favorites-summary">`;
  html += `<span class="dashboard__favorites-count">${stats.count} favorito${stats.count !== 1 ? "s" : ""}</span>`;
  html += `</div>`;
  
  if (stats.recent.length === 0) {
    html += `<p class="muted">Aún no tienes favoritos.</p>`;
  } else {
    html += `<ul class="dashboard__favorites-list">`;
    for (const entry of stats.recent) {
      const typeLabel = entry.kind === "chapter" ? "Capítulo" : mediaTypeLabel(entry.mediaType);
      html += `<li class="dashboard__favorites-item" data-kind="${escapeHtml(entry.kind)}" data-media-type="${escapeHtml(entry.mediaType || "")}" data-id="${escapeHtml(entry.id || "")}" data-parent-item-id="${escapeHtml(entry.parentItemId || "")}" tabindex="0" role="button">`;
      html += `<span class="dashboard__favorites-item-title">${escapeHtml(entry.title || "Sin título")}</span>`;
      html += `<span class="dashboard__favorites-item-type">${escapeHtml(typeLabel)}</span>`;
      html += `</li>`;
    }
    html += `</ul>`;
  }
  
  dashboardFavoritesBlock.innerHTML = html;
  
  // Attach click listeners
  dashboardFavoritesBlock.querySelectorAll(".dashboard__favorites-item").forEach(li => {
    const openDetail = () => {
      const kind = li.dataset.kind;
      const mediaType = li.dataset.mediaType;
      const id = li.dataset.id;
      const parentItemId = li.dataset.parentItemId;
      
      if (kind === "chapter" && mediaType && parentItemId) {
        openItemDetail(mediaType, parentItemId);
      } else if (kind === "item" && mediaType && id) {
        openItemDetail(mediaType, id);
      }
    };
    li.addEventListener("click", openDetail);
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail();
      }
    });
  });
}

// =============================================================
// T-112 — Arranque del nav principal (00 §2, REQ-C5).
// Se enlaza una sola vez al cargar el módulo; las vistas se
// activan después desde `show()` / `showAppView()`.
// =============================================================

initAppNav();
