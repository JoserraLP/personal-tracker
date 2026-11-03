// =============================================================
// app.js — spec 001 (puerta de login) + spec 002 (catálogo).
//
// Spec 001: máquina de estados loading → { login | allowed | denied }.
//           Persistencia de denied, botones Entrar/Salir/Volver.
// Spec 002: pestañas por tipo, lista de tarjetas, filtro/orden en
//           cliente, cambio de estado y borrado.
// =============================================================

import { login, logout, watchAuthState } from "./firebase.js";
import { isEmailAllowed } from "./allowed-emails.js";
import {
  MEDIA_TYPES,
  MEDIA_TYPE_LABELS,
  ITEM_STATUSES,
  STATUS_LABELS,
  SORT_OPTIONS,
  DEFAULT_SORT,
  subscribeItems,
  listItems,
  setItemStatus,
  deleteItem,
  filterItems,
  sortItems,
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

function show(name) {
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
// Spec 002 — Catálogo
// =============================================================

// --- Estado del catálogo ------------------------------------
const DASHBOARD_KEY = "dashboard";
const FAVORITES_KEY = "favorites";
const COLLECTIONS_KEY = "collections";
let activeMediaType = DASHBOARD_KEY;
let currentItems = [];
let unsubscribeFn = null;
let catalogInitialized = false;

// Paginación por cursor (Q-003 / MED #2)
let paginationHasMore = false;
let paginationLastDoc = null;
let isLoadingMore = false;

// Filtros en memoria
let filterStatus = "";
let filterMinRating = "";
let filterYear = "";
let sortOption = DEFAULT_SORT;

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
const tabsContainer = document.getElementById("catalog-tabs");
const panel = document.getElementById("catalog-panel");
const filterStatusEl = document.getElementById("catalog-filter-status");
const filterRatingEl = document.getElementById("catalog-filter-rating");
const filterYearEl = document.getElementById("catalog-filter-year");
const sortEl = document.getElementById("catalog-sort");
const listEl = document.getElementById("catalog-list");
const loadingEl = document.getElementById("catalog-loading");
const emptyEl = document.getElementById("catalog-empty");
const errorEl = document.getElementById("catalog-error");
const btnAddItem = document.getElementById("btn-add-item");
const loadMoreWrapEl = document.getElementById("catalog-load-more-wrap");
const btnLoadMore = document.getElementById("btn-load-more");

// Dashboard DOM (spec 003)
const dashboardPanel = document.getElementById("dashboard-panel");
const dashboardStatsEl = document.getElementById("dashboard-stats");
const dashboardRecentAddedEl = document.getElementById("dashboard-recent-added");
const dashboardRecentCompletedEl = document.getElementById("dashboard-recent-completed");
const dashboardErrorEl = document.getElementById("dashboard-error");
const dashboardLoadingEl = document.getElementById("dashboard-loading");

// --- Inicialización de controles estáticos ------------------

function buildTabs() {
  tabsContainer.innerHTML = "";

  // Spec 004 (D-005): orden Dashboard, Favoritos, Colecciones, <5 tipos>
  const allTabs = [DASHBOARD_KEY, FAVORITES_KEY, COLLECTIONS_KEY, ...MEDIA_TYPES];
  const tabLabels = {
    [DASHBOARD_KEY]: "Dashboard",
    [FAVORITES_KEY]: "Favoritos",
    [COLLECTIONS_KEY]: "Colecciones",
    ...MEDIA_TYPE_LABELS,
  };

  allTabs.forEach((type) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "catalog__tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", type === activeMediaType ? "true" : "false");
    tab.setAttribute("tabindex", type === activeMediaType ? "0" : "-1");
    tab.id = type === activeMediaType ? "tab-active" : `tab-${type}`;
    tab.setAttribute("aria-controls", getPanelIdForTab(type));
    tab.textContent = tabLabels[type];
    tab.dataset.mediaType = type;
    tab.addEventListener("click", () => switchTab(type));
    tabsContainer.appendChild(tab);
  });

  // Navegación por teclado (ARIA tablist, §6)
  tabsContainer.addEventListener("keydown", handleTabsKeydown);
}

function getPanelIdForTab(type) {
  switch (type) {
    case DASHBOARD_KEY: return "dashboard-panel";
    case FAVORITES_KEY: return "favorites-panel";
    case COLLECTIONS_KEY: return "collections-panel";
    default: return "catalog-panel";
  }
}

function buildStatusFilter() {
  // Mantener la opción "Todos" y añadir los 5 estados
  filterStatusEl.innerHTML = '<option value="">Todos los estados</option>';
  ITEM_STATUSES.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = STATUS_LABELS[status];
    filterStatusEl.appendChild(option);
  });
}

function buildRatingFilter() {
  // LOW #5: filtro de valoración mínima (REQ-012).
  filterRatingEl.innerHTML = '<option value="">Cualquier valoración</option>';
  for (let n = 1; n <= 10; n++) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = `≥ ${n}`;
    filterRatingEl.appendChild(option);
  }
}

function buildYearFilter() {
  // LOW #5: filtro de año (REQ-012). Input libre (number) en el HTML.
  filterYearEl.value = "";
}

function buildSortSelect() {
  sortEl.innerHTML = "";
  SORT_OPTIONS.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.id;
    option.textContent = opt.label;
    sortEl.appendChild(option);
  });
  sortEl.value = DEFAULT_SORT;
}

// --- Navegación por teclado de pestañas (§6) ----------------

function handleTabsKeydown(event) {
  const tabs = Array.from(tabsContainer.querySelectorAll('[role="tab"]'));
  const currentIndex = tabs.indexOf(document.activeElement);
  if (currentIndex === -1) return;

  let newIndex = currentIndex;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      newIndex = (currentIndex + 1) % tabs.length;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      break;
    case "Home":
      newIndex = 0;
      break;
    case "End":
      newIndex = tabs.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  tabs[newIndex].focus();
  switchTab(tabs[newIndex].dataset.mediaType);
}

// --- Cambio de pestaña --------------------------------------

function switchTab(mediaType) {
  const validTabs = [DASHBOARD_KEY, FAVORITES_KEY, COLLECTIONS_KEY, ...MEDIA_TYPES];
  if (!validTabs.includes(mediaType) || mediaType === activeMediaType) return;
  activeMediaType = mediaType;

  // Actualizar ARIA en pestañas (LOW #4: mantener id="tab-active" en la activa)
  const tabs = tabsContainer.querySelectorAll('[role="tab"]');
  tabs.forEach((tab) => {
    const isActive = tab.dataset.mediaType === mediaType;
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.setAttribute("tabindex", isActive ? "0" : "-1");
    if (isActive) tab.id = "tab-active";
    else if (tab.id === "tab-active") tab.id = `tab-${tab.dataset.mediaType}`;
  });

  // Ocultar todos los paneles primero
  hideAllPanels();

  if (mediaType === DASHBOARD_KEY) {
    // Mostrar dashboard
    showPanel("dashboard-panel");
    subscribeToDashboard();
  } else if (mediaType === FAVORITES_KEY) {
    // Mostrar favoritos
    showPanel("favorites-panel");
    subscribeToFavorites();
  } else if (mediaType === COLLECTIONS_KEY) {
    // Mostrar colecciones
    showPanel("collections-panel");
    subscribeToCollections();
  } else {
    // Mostrar catálogo por tipo
    showPanel("catalog-panel");
    // Cancelar suscripciones de otros paneles
    dashboardUnsubscribeAll();
    favoritesUnsubscribeAll();
    collectionsUnsubscribeAll();

    // Resetear filtros al cambiar de pestaña
    filterStatus = "";
    filterStatusEl.value = "";
    filterMinRating = "";
    filterRatingEl.value = "";
    filterYear = "";
    filterYearEl.value = "";
    sortOption = DEFAULT_SORT;
    sortEl.value = DEFAULT_SORT;

    // Resetear paginación
    paginationHasMore = false;
    paginationLastDoc = null;
    updateLoadMoreVisibility();

    // Re-suscribir a la nueva colección
    subscribeToCurrentTab();
  }
}

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

// --- Suscripción al store -----------------------------------

async function subscribeToCurrentTab() {
  // Cancelar suscripción previa (evitar fugas)
  await catalogUnsubscribe();

  currentItems = [];
  paginationHasMore = false;
  paginationLastDoc = null;
  updateLoadMoreVisibility();
  renderList();
  showLoading(true);
  hideError();

  try {
    unsubscribeFn = await subscribeItems(activeMediaType, {
      onItems(items, meta) {
        const incoming = items || [];
        // LOW #4 (Q-003): si el usuario cargó páginas extra vía "Cargar más",
        // preservar esos ítems adicionales; reemplazar solo la primera página.
        const hadExtraItems = currentItems.length > incoming.length;
        if (hadExtraItems) {
          currentItems = incoming.concat(currentItems.slice(incoming.length));
        } else {
          currentItems = incoming;
        }
        // MED #2: capturar cursor de paginación (Q-003/§6)
        // F-001: NO resetear paginationLastDoc si preservamos ítems extra
        if (meta && typeof meta === "object") {
          paginationHasMore = Boolean(meta.hasMore);
          if (!hadExtraItems) {
            paginationLastDoc = meta.lastDoc || null;
          }
        } else {
          paginationHasMore = false;
          if (!hadExtraItems) {
            paginationLastDoc = null;
          }
        }
        updateLoadMoreVisibility();
        showLoading(false);
        renderList();
      },
      onError(error) {
        showLoading(false);
        showError("Error al cargar los elementos: " + (error?.message || "desconocido"));
      },
    });
  } catch (error) {
    showLoading(false);
    showError("Error al suscribirse: " + (error?.message || "desconocido"));
  }
}

// --- Paginación por cursor (MED #2 / Q-003) -----------------

function updateLoadMoreVisibility() {
  if (!loadMoreWrapEl || !btnLoadMore) return;
  loadMoreWrapEl.hidden = !paginationHasMore;
  btnLoadMore.disabled = isLoadingMore;
  btnLoadMore.textContent = isLoadingMore ? "Cargando…" : "Cargar más";
}

async function loadMoreItems() {
  if (!paginationHasMore || !paginationLastDoc || isLoadingMore) return;
  isLoadingMore = true;
  updateLoadMoreVisibility();
  try {
    const result = await listItems(activeMediaType, { startAfter: paginationLastDoc });
    const newItems = result.items || [];
    // F-001: deduplicar por id al concatenar (evitar ítems repetidos)
    const existingIds = new Set(currentItems.map((item) => item.id));
    const uniqueNewItems = newItems.filter((item) => !existingIds.has(item.id));
    currentItems = currentItems.concat(uniqueNewItems);
    paginationHasMore = Boolean(result.hasMore);
    paginationLastDoc = result.lastDoc || null;
    updateLoadMoreVisibility();
    renderList();
  } catch (error) {
    showError("No se pudo cargar la siguiente página: " + (error?.message || "error"));
  } finally {
    isLoadingMore = false;
    updateLoadMoreVisibility();
  }
}

if (btnLoadMore) {
  btnLoadMore.addEventListener("click", loadMoreItems);
}

async function catalogUnsubscribe() {
  if (typeof unsubscribeFn === "function") {
    try {
      await unsubscribeFn();
    } catch {
      // Ignorar errores al cancelar
    }
    unsubscribeFn = null;
  }
}

function catalogCleanup() {
  catalogUnsubscribe();
  dashboardUnsubscribeAll();
  favoritesUnsubscribeAll();
  collectionsUnsubscribeAll();
  catalogInitialized = false;
}

// =============================================================
// Spec 003 — Dashboard (REQ-001, UI-001, AC-001, AC-005, D-005)
// =============================================================

function showDashboardView(visible) {
  if (dashboardPanel) dashboardPanel.hidden = !visible;
  if (panel) panel.hidden = visible;
}

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
          <span class="stat-card__label">${escapeHtml(MEDIA_TYPE_LABELS[type])}</span>
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

// --- Render de la lista -------------------------------------

function renderList() {
  // Aplicar filtro y orden en cliente (AC-016, LOW #5)
  const filters = {};
  if (filterStatus) filters.status = filterStatus;
  if (filterMinRating) filters.minRating = Number(filterMinRating);
  if (filterYear) filters.year = Number(filterYear);

  const filtered = filterItems(currentItems, filters);
  const sorted = sortItems(filtered, sortOption);

  listEl.innerHTML = "";

  if (sorted.length === 0) {
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;

  sorted.forEach((item) => {
    const li = createCard(item);
    listEl.appendChild(li);
  });
}

function createCard(item) {
  const li = document.createElement("li");
  li.className = "catalog-card";
  li.dataset.mediaType = item.mediaType || activeMediaType;
  li.dataset.itemId = item.id;
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.setAttribute("aria-label", `Ver ficha de ${item.title || "elemento"}`);

  // Click en la tarjeta abre la ficha (UI-002)
  const openDetail = (event) => {
    // No abrir si se hizo click en los controles de la tarjeta
    if (event.target.closest(".catalog-card__actions")) return;
    if (event.target.closest(".heart-button")) return;
    openItemDetail(item.mediaType || activeMediaType, item.id);
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

  // Badge de estado
  const status = item.status || "pending";
  const badge = document.createElement("span");
  badge.className = `catalog-badge catalog-badge--${status}`;
  badge.textContent = STATUS_LABELS[status] || status;
  meta.appendChild(badge);

  // Rating si existe
  if (typeof item.rating === "number" && Number.isFinite(item.rating)) {
    const rating = document.createElement("span");
    rating.className = "catalog-card__rating";
    rating.textContent = `★ ${item.rating}`;
    rating.setAttribute("aria-label", `Valoración: ${item.rating} sobre 10`);
    meta.appendChild(rating);
  }

  body.appendChild(meta);
  li.appendChild(body);

  // Corazón (spec 004, UI-003, AC-001, AC-004)
  const heartContainer = document.createElement("div");
  heartContainer.className = "catalog-card__heart";
  const heartBtn = createHeartButton(item.mediaType || activeMediaType, item.id, item.isFavorite);
  heartContainer.appendChild(heartBtn);
  li.appendChild(heartContainer);

  // Acciones
  const actions = document.createElement("div");
  actions.className = "catalog-card__actions";

  // Select de estado
  const statusSelect = document.createElement("select");
  statusSelect.className = "catalog-card__status-select";
  statusSelect.setAttribute("aria-label", "Cambiar estado");
  ITEM_STATUSES.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = STATUS_LABELS[s];
    if (s === status) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusSelect.addEventListener("change", async () => {
    const newStatus = statusSelect.value;
    statusSelect.disabled = true;
    try {
      await setItemStatus(item.mediaType || activeMediaType, item.id, newStatus);
    } catch (error) {
      showInlineError(li, "No se pudo cambiar el estado: " + (error?.message || "error"));
      // Restaurar el valor anterior
      statusSelect.value = status;
    } finally {
      statusSelect.disabled = false;
    }
  });
  actions.appendChild(statusSelect);

  // Botón borrar
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "catalog-card__delete";
  deleteBtn.textContent = "Borrar";
  deleteBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(
      `¿Seguro que quieres borrar «${item.title || "este elemento"}»? Esta acción no se puede deshacer.`
    );
    if (!confirmed) return;
    deleteBtn.disabled = true;
    try {
      await deleteItem(item.mediaType || activeMediaType, item.id);
    } catch (error) {
      showInlineError(li, "No se pudo borrar: " + (error?.message || "error"));
      deleteBtn.disabled = false;
    }
  });
  actions.appendChild(deleteBtn);

  li.appendChild(actions);

  return li;
}

// --- Helpers de UI ------------------------------------------

function showLoading(visible) {
  loadingEl.hidden = !visible;
  if (visible) {
    emptyEl.hidden = true;
    listEl.innerHTML = "";
  }
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function hideError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function showInlineError(cardEl, message) {
  // Eliminar error inline previo en esta tarjeta
  const prev = cardEl.querySelector(".catalog-card__inline-error");
  if (prev) prev.remove();

  const p = document.createElement("p");
  p.className = "catalog-card__inline-error";
  p.textContent = message;
  p.setAttribute("role", "alert");
  // Insertar antes de las acciones
  const actions = cardEl.querySelector(".catalog-card__actions");
  if (actions) {
    cardEl.insertBefore(p, actions);
  } else {
    cardEl.appendChild(p);
  }

  // Auto-ocultar tras 5s
  setTimeout(() => {
    if (p.parentNode) p.remove();
  }, 5000);
}

// --- Filtros y orden ----------------------------------------

filterStatusEl.addEventListener("change", () => {
  filterStatus = filterStatusEl.value;
  renderList();
});

filterRatingEl.addEventListener("change", () => {
  filterMinRating = filterRatingEl.value;
  renderList();
});

// LOW #5: filtro de año con debounce para no re-renderizar en cada tecla.
let filterYearDebounce = null;
filterYearEl.addEventListener("input", () => {
  clearTimeout(filterYearDebounce);
  filterYearDebounce = setTimeout(() => {
    const raw = filterYearEl.value.trim();
    filterYear = raw;
    renderList();
  }, 300);
});

sortEl.addEventListener("change", () => {
  sortOption = sortEl.value;
  renderList();
});

// --- Init del catálogo --------------------------------------

function catalogInit() {
  if (catalogInitialized) return;
  catalogInitialized = true;
  buildTabs();
  buildStatusFilter();
  buildRatingFilter();
  buildYearFilter();
  buildSortSelect();
  updateLoadMoreVisibility();

  // Dashboard es la pestaña inicial (spec 003, AC-001)
  if (activeMediaType === DASHBOARD_KEY) {
    showDashboardView(true);
    subscribeToDashboard();
  } else {
    showDashboardView(false);
    subscribeToCurrentTab();
  }
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

btnAddItem.addEventListener("click", () => {
  openSearchModal();
});

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
      const typeLabel = entry.kind === "chapter" ? "Capítulo" : (MEDIA_TYPE_LABELS[entry.mediaType] || entry.mediaType);
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
