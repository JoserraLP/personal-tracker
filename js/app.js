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

  // Dashboard tab (spec 003, REQ-001, AC-001) — primera pestaña
  const allTabs = [DASHBOARD_KEY, ...MEDIA_TYPES];
  const tabLabels = { [DASHBOARD_KEY]: "Dashboard", ...MEDIA_TYPE_LABELS };

  allTabs.forEach((type) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "catalog__tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", type === activeMediaType ? "true" : "false");
    tab.setAttribute("tabindex", type === activeMediaType ? "0" : "-1");
    tab.id = type === activeMediaType ? "tab-active" : `tab-${type}`;
    tab.setAttribute("aria-controls", type === DASHBOARD_KEY ? "dashboard-panel" : "catalog-panel");
    tab.textContent = tabLabels[type];
    tab.dataset.mediaType = type;
    tab.addEventListener("click", () => switchTab(type));
    tabsContainer.appendChild(tab);
  });

  // Navegación por teclado (ARIA tablist, §6)
  tabsContainer.addEventListener("keydown", handleTabsKeydown);
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
  const validTabs = [DASHBOARD_KEY, ...MEDIA_TYPES];
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

  if (mediaType === DASHBOARD_KEY) {
    // Mostrar dashboard, ocultar catálogo por tipo
    showDashboardView(true);
    subscribeToDashboard();
  } else {
    // Mostrar catálogo por tipo, ocultar dashboard
    showDashboardView(false);
    // Cancelar suscripciones del dashboard
    dashboardUnsubscribeAll();

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
}

async function subscribeToDashboard() {
  await dashboardUnsubscribeAll();
  dashboardItemsByType = {};

  if (dashboardLoadingEl) dashboardLoadingEl.hidden = false;
  if (dashboardErrorEl) dashboardErrorEl.hidden = true;
  if (dashboardStatsEl) dashboardStatsEl.innerHTML = "";
  if (dashboardRecentAddedEl) dashboardRecentAddedEl.innerHTML = "";
  if (dashboardRecentCompletedEl) dashboardRecentCompletedEl.innerHTML = "";

  let pendingCount = MEDIA_TYPES.length;

  for (const mediaType of MEDIA_TYPES) {
    try {
      const unsub = await subscribeItems(mediaType, {
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
}

function renderDashboard() {
  const stats = computeDashboardStats(dashboardItemsByType);

  // --- StatCards (D-005, D-007) ---
  if (dashboardStatsEl) {
    let html = "";

    // Totales por tipo
    html += `<h4 class="dashboard__section-title">Por tipo</h4>`;
    html += `<div class="dashboard__stats">`;
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
    html += `<div class="dashboard__stats">`;
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
    html += `<div class="dashboard__stats">`;
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
            <h3 class="detail__title">${eTitle}${item.year ? ` <span class="detail__year">(${eYear})</span>` : ""}</h3>
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

function renderMetadataSection(item) {
  const metadataSection = document.getElementById("metadata-section");
  if (!metadataSection) return;
  
  const mediaType = item.mediaType || activeMediaType;
  const provider = item.source?.provider;
  const externalId = item.source?.externalId;
  
  // Check if metadata is fresh (cached)
  if (isMetadataFresh(item)) {
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
    try {
      await updateItemMetadata(mediaType, item.id, metadata, provider);
      // Update currentDetailItem with cached metadata
      const updated = await getItem(mediaType, item.id);
      currentDetailItem = updated;
    } catch (cacheError) {
      // Cache write failed - show warning but don't block (AC-009)
      console.warn("No se pudo cachear la metadata:", cacheError);
    }
    
    renderMetadataContent(item, metadata, isPartial ? "partial" : null);
    
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

function renderMetadataContent(item, metadata, warning) {
  const metadataSection = document.getElementById("metadata-section");
  if (!metadataSection) return;
  
  const mediaType = item.mediaType || activeMediaType;
  
  // Use metadata if available, otherwise use item fields
  const data = metadata || item;
  
  let html = "";
  
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
    `;
  } else {
    metadataSection.innerHTML = `
      <h4 class="detail__section-title">Información adicional</h4>
      <div class="metadata-content">
        <p class="muted">Sin información adicional.</p>
        <button type="button" class="btn btn--secondary" id="btn-edit-metadata">Añadir manualmente</button>
      </div>
    `;
  }
  
  // Edit metadata button
  const btnEdit = document.getElementById("btn-edit-metadata");
  if (btnEdit) {
    btnEdit.addEventListener("click", () => {
      openMetadataForm(item, metadata);
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
