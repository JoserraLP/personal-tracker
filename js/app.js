// =============================================================
// Entry point: orchestrates authentication, Firestore subscriptions,
// filters/sort and the wiring of the specialized modules.
// The business logic (search, modals, quick actions,
// daily check, profile/statistics, notifications) lives
// in its own modules that connect here via a context
// object (ctx) with access functions.
// =============================================================

import { watchAuthState, login, logout } from "./firebase.js";
import {
  subscribeToItems,
  updateItem,
  deleteItem,
  addItem,
  upsertUserProfile,
  getUserProfile,
  getItemsOnce,
  subscribeToExperiences,
  subscribeToNotifications,
  addNotification,
  deleteNotification,
  addWishlistItem,
  updateWishlistItem,
  deleteWishlistItem,
  addExperience,
  updateExperience,
  deleteExperience,
  markNotificationRead,
  subscribeToRecipes,
  addRecipe,
  updateRecipe,
  deleteRecipe,
  subscribeToIngredients,
  addIngredient,
  updateIngredient,
  deleteIngredient,
  subscribeToTags,
  addTag,
  deleteTag,
  subscribeToMenus,
  addMenu,
  updateMenu,
  deleteMenu,
  subscribeToGymWorkouts,
  addGymWorkout,
  updateGymWorkout,
  deleteGymWorkout,
  subscribeToGymExercises,
  addGymExercise,
  updateGymExercise,
  deleteGymExercise,
} from "./db.js";
import { getTvSeasonsMeta, getSeasonEpisodes, getMovieDetails, getTvExtraDetails } from "./api-movies.js";
import { getOpenLibraryDescription } from "./api-books.js";
import { todayISO, formatDateEs } from "./dates.js";
import { APP_VERSION } from "./config.js";
import { subscribeWithRetry } from "./retry.js";
import { applySort } from "./sorting.js";
import * as ui from "./ui.js";

// Extracted modules
import { setupModalCloseListeners, openItem } from "./modal-handlers.js";
import { quickAction } from "./quick-actions.js";
import { checkForUpdates } from "./daily-check.js";
import { runStorageMigration } from "./migration.js";
import { setupNotifications } from "./notifications-setup.js";
import { setupProfile } from "./profile.js";
import { initializeI18n } from "./i18n.js";
import { setupWishlist, setupExperiences, resetSectionLists } from "./section-lists.js";
import { setupSettings, syncThemeToSettings, cleanupSettings, SECTION_REGISTRY, isSectionVisible, isTabVisible, getFirstVisibleTabKey, getFirstVisibleTabPanel, normalizeTabKey, applySteamCallback, loadSettings } from "./settings.js";
import { parseSteamCallbackHash } from "./api-steam.js";
import { setupGlobalSearch, refreshExternalResults } from "./global-search.js";
import { setupSidebar, renderSidebar, setActiveSection } from "./sidebar.js";
import { initAutoHideNav } from "./auto-hide-nav.js";
import { handleNotificationsSnapshot, resetDevicePush } from "./push.js";
import { initRouter, keyForPanel, getLastOcioKey, hashForKey } from "./router.js";
import { setupRecipes, subscribeRecipesData, resetRecipesData } from "./recipes.js";
import { setupMenu, subscribeMenuData, cleanupDeletedRecipe, resetMenuData } from "./menu.js";
import { setupShoppingList, resetShoppingListState } from "./shopping-list.js";
import { setupGym, subscribeGymData, resetGymData } from "./gym.js";

// ---------- State ----------

let currentUser = null;
let unsubscribeItems = { movies: null, tv: null, books: null, games: null, wishlist: null, experiences: null };
let unsubscribeNotifications = null;
let wishlistApi = null;
let experiencesApi = null;
let unsubscribeRecipes = null; // recipes (recipes.js)
let unsubscribeMenuData = null; // menus (menu.js)
let unsubscribeGymData = null; // gym (gym.js)
const allItems = { movies: [], tv: [], books: [], games: [], wishlist: [], experiences: [] };
let notifications = [];

const activeFilters = { movies: "todos", tv: "en_curso", books: "todos", games: "todos" };
const activeSort = { movies: "añadido", tv: "añadido", books: "añadido", games: "añadido" };
const viewMode = { movies: "grid", tv: "list", books: "grid", games: "grid" };

// Snapshot-received flags per group (lazy loading, issue #178):
// they no longer condition the daily check (it reads from Firestore with
// getItemsOnce), only the repainting when a partial arrives late.
const groupReady = { movies: false, tv: false, books: false, games: false, wishlist: false, experiences: false };
let checksTriggered = false;

// ---------- Context for modules ----------

function createCtx() {
  return {
    getCurrentUser: () => currentUser,
    getItemsByGroup: (group) => allItems[group] || [],
    // Read of a group that never fails because of lazy loading (issue
    // #178): if the in-memory state is complete (snapshot received)
    // it is returned as is; otherwise (tab not visited yet), it is read
    // on the spot from Firestore. It is used by the duplicate checks
    // (adding from the global search, recommendations of the modal).
    getGroupItemsResolved: async (group) => {
      if (groupReady[group]) return allItems[group] || [];
      if (currentUser && GROUP_CONFIG[group]) {
        try {
          return await getItemsOnce(currentUser.uid, GROUP_CONFIG[group].type);
        } catch {
          // fallback: if the one-time read fails, whatever is in
          // memory is used (it may be empty: it's a best-effort check).
        }
      }
      return allItems[group] || [];
    },
    getAllItems: () => allItems,
    getNotifications: () => notifications,
    updateItem,
    deleteItem,
    addItem,
    addNotification,
    markNotificationRead,
    deleteNotification,
    upsertUserProfile,
    getUserProfile,
    getItemsOnce,
    addWishlistItem,
    updateWishlistItem,
    deleteWishlistItem,
    addExperience,
    updateExperience,
    deleteExperience,
    getMovieDetails,
    getTvExtraDetails,
    getTvSeasonsMeta,
    getSeasonEpisodes,
    getOpenLibraryDescription,
    subscribeToRecipes,
    addRecipe,
    updateRecipe,
    deleteRecipe,
    subscribeToIngredients,
    addIngredient,
    updateIngredient,
    deleteIngredient,
    subscribeToTags,
    addTag,
    deleteTag,
    subscribeToMenus,
    addMenu,
    updateMenu,
    deleteMenu,
    subscribeToGymWorkouts,
    addGymWorkout,
    updateGymWorkout,
    deleteGymWorkout,
    subscribeToGymExercises,
    addGymExercise,
    updateGymExercise,
    deleteGymExercise,
    todayISO,
    formatDateEs,
    setTheme,
    showToast: ui.showToast,
  };
}

// ---------- Helpers ----------

function itemsByGroup(group) {
  return allItems[group] || [];
}

function applyFilter(items, status) {
  if (status === "todos") return items;
  return items.filter((i) => i.status === status);
}

const GRID_IDS = {
  movies: ["library-movies", "empty-movies"],
  tv: ["library-tv", "empty-tv"],
  books: ["library-books", "empty-books"],
  games: ["library-games", "empty-games"],
};

function renderLibraryFor(group) {
  const [gridId, emptyId] = GRID_IDS[group];
  const gridEl = document.getElementById(gridId);
  // The group's partial has not been loaded yet (lazy, issue #178):
  // there is nothing to paint; when loading finishes, loadOcioPartial
  // calls here again if the group already has a snapshot.
  if (!gridEl) return;
  // The data (or the empty state) replaces the loading marker
  // of the panel. querySelector is used: the panel can only have one
  // .panel-loading (the one loadOcioPartial prepends when injecting).
  const panelEl = gridEl.closest(".panel");
  panelEl?.querySelector(".panel-loading")?.remove();
  panelEl?.querySelector(".panel-error")?.remove();
  let items = applyFilter(itemsByGroup(group), activeFilters[group]);
  items = applySort(items, activeSort[group]);
  const ctx = createCtx();
  ui.renderLibrary(gridEl, document.getElementById(emptyId), items, viewMode[group], {
    onOpen: (item) => openItem(item, ctx),
    onQuickAction: (item, btn) => quickAction(item, btn, ctx),
  });
}

function maybeTriggerDailyCheck() {
  if (checksTriggered) return;
  checksTriggered = true;
  // Fire-and-forget with defensive catch: daily-check reads from
  // Firestore (getItemsOnce) and a failure must not break the flow.
  checkForUpdates(createCtx()).catch((err) => {
    console.error("No se pudo completar la comprobación diaria:", err);
  });
}

function stopAllSubscriptions() {
  Object.values(unsubscribeItems).forEach((fn) => fn && fn());
  unsubscribeItems = { movies: null, tv: null, books: null, games: null, wishlist: null };
  if (unsubscribeNotifications) unsubscribeNotifications();
  unsubscribeNotifications = null;
  if (unsubscribeRecipes) unsubscribeRecipes();
  unsubscribeRecipes = null;
  if (unsubscribeMenuData) unsubscribeMenuData();
  unsubscribeMenuData = null;
  if (unsubscribeGymData) unsubscribeGymData();
  unsubscribeGymData = null;
}

// ---------- Firestore subscriptions (lazy, issue #178) ----------

// Config per group: type in Firestore and the toast error message.
const GROUP_CONFIG = {
  movies: { type: "movie", error: "No se pudieron cargar tus películas." },
  tv: { type: "tv", error: "No se pudieron cargar tus series." },
  books: { type: "book", error: "No se pudieron cargar tus libros." },
  games: { type: "game", error: "No se pudieron cargar tus videojuegos." },
  // The wishlist (Shopping) is not a media group: its
  // subscription uses subscribeToWishlist (private collection).
  wishlist: {
    custom: true,
    error: "No se pudo cargar tu lista de compras.",
  },
  // Experiences (done or to do): private list, the same as the
  // wishlist: subscription by subscribeToExperiences.
  experiences: {
    custom: true,
    error: "No se pudo cargar tu lista de experiencias.",
  },
};

// Reference of the subscribeFn of the wishlist: each custom group
// pulls its own subscription (wishlist vs experiences).
function customSubscribeFn(groupKey) {
  return ({ onChange, onError }) =>
    groupKey === "wishlist"
      ? subscribeToWishlist(uidForCustom(), onChange, onError)
      : subscribeToExperiences(uidForCustom(), onChange, onError);
}
let _customUid = null;
function uidForCustom() {
  return _customUid;
}

// Generic subscription of a group. It is wrapped with subscribeWithRetry
// (issue #147): if on entering a subscription fails due to a transient error,
// it retries on its own with backoff instead of leaving the
// library empty until closing and reopening the web.
function subscribeGroup(uid, groupKey) {
  const cfg = GROUP_CONFIG[groupKey];
  if (!cfg || unsubscribeItems[groupKey]) return;
  const subscribeFn = cfg.custom
    ? (() => { _customUid = uid; return customSubscribeFn(groupKey); })()
    : ({ onChange, onError }) => subscribeToItems(uid, cfg.type, onChange, onError);
  unsubscribeItems[groupKey] = subscribeWithRetry({
    subscribe: subscribeFn,
    onChange: (items) => {
      allItems[groupKey] = items;
      groupReady[groupKey] = true;
      if (groupKey === "wishlist" && wishlistApi) {
        wishlistApi.setWishlistItems(items);
      } else if (groupKey === "experiences" && experiencesApi) {
        experiencesApi.setExperienceItems(items);
      } else {
        renderLibraryFor(groupKey);
        refreshExternalResults(createCtx());
      }
    },
    onError: (err) => {
      ui.showToast(cfg.error);
      showPanelLoadError(groupKey, cfg.error);
    },
    onRetrying: () => ui.showToast("Hay problemas de conexión. Reintentando…"),
  });
}

// Starts the group's subscription if not already active (requires
// a session). The daily check no longer depends on this: daily-check
// reads from Firestore with getItemsOnce.
function ensureGroupSubscribed(groupKey) {
  if (!currentUser || unsubscribeItems[groupKey]) return;
  subscribeGroup(currentUser.uid, groupKey);
}

// ---------- Partial loading (lazy, issue #178) ----------

// Data group associated with each Leisure panel (each group's
// subscription only starts when its tab is activated for the first time).
const PANEL_TO_GROUP = {
  "panel-tv": "tv",
  "panel-movies": "movies",
  "panel-books": "books",
  "panel-games": "games",
  "panel-wishlist": "wishlist",
  "panel-experiences": "experiences",
};

// Inverse of PANEL_TO_GROUP: showPanelLoadError/retryPanelLoad use it
// to locate the panel of a group (issue #286).
const GROUP_TO_PANEL = {
  tv: "panel-tv",
  movies: "panel-movies",
  books: "panel-books",
  games: "panel-games",
  wishlist: "panel-wishlist",
  experiences: "panel-experiences",
};

// Partial already injected per panel: each tab loads its HTML only the
// first time it is activated; subsequent activations don't re-fetch.
const loadedPartials = new Set();

// Timeout of the partials fetch (issue #286): a hanging network
// must not leave the panel without content (or the eternal «Loading…»); the
// AbortController turns the hang into an AbortError that falls into
// the panel's error state.
const PARTIAL_FETCH_TIMEOUT_MS = 8000;

// Loading marker of a panel (issue #178). It is prepended to the
// content of each partial when injected, so the indicator
// persists while the group's snapshot doesn't arrive; renderLibraryFor
// removes it when painting data (or the empty state).
function panelLoadingHtml() {
  return `
    <div class="panel-loading" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span>Cargando…</span>
    </div>`;
}

// Final error state of a Leisure panel (issue #286): when the retries of the
// group's subscription are exhausted (or the partial fetch
// fails), the .panel-loading marker is removed and a
// warning with a «Reintentar» button is shown. Idempotent: if there is already an error or a
// pending loading, they are cleaned before painting the new state.
function showPanelLoadError(groupKey, message, { force = false } = {}) {
  const panelEl = document.getElementById(GROUP_TO_PANEL[groupKey]);
  if (!panelEl) return;
  // The snapshot arrived late (the group is already ready): the data is
  // painted (or will be painted) and the subscription error no longer
  // makes sense. The partial route uses `force`: even if the group has
  // data, without the panel's HTML there is nothing to paint, so the
  // error with its «Reintentar» button is the only visible and useful thing.
  if (!force && groupReady[groupKey]) return;
  panelEl.querySelector(".panel-loading")?.remove();
  panelEl.querySelector(".panel-error")?.remove();
  panelEl.insertAdjacentHTML(
    "afterbegin",
    `<div class="panel-error" role="alert">
      <p class="panel-error__message">${message}</p>
      <button type="button" class="btn btn--small">Reintentar</button>
    </div>`
  );
  panelEl.querySelector(".panel-error button").addEventListener("click", () => retryPanelLoad(groupKey));
}

// Restarts the loading of a Leisure group from its error state:
// removes the warning, restores the loading marker, cancels the
// exhausted subscription (REQUIRED: otherwise subscribeGroup's guard
// ignores the new one), removes the partial from `loadedPartials` (REQUIRED:
// otherwise loadOcioPartial doesn't re-fetch) and starts again the
// subscription and the partial fetch.
function retryPanelLoad(groupKey) {
  const panelEl = document.getElementById(GROUP_TO_PANEL[groupKey]);
  if (!panelEl) return;
  panelEl.querySelector(".panel-error")?.remove();
  if (!panelEl.querySelector(".panel-loading")) {
    panelEl.insertAdjacentHTML("afterbegin", panelLoadingHtml());
  }
  if (unsubscribeItems[groupKey]) {
    unsubscribeItems[groupKey]();
    unsubscribeItems[groupKey] = null;
  }
  loadedPartials.delete(panelEl.id);
  loadOcioPartial(panelEl);
  if (currentUser) ensureGroupSubscribed(groupKey);
}

// Wiring of the controls of a panel (filters, sort and view).
// It runs when injecting each partial (loadedPartials' guard
// guarantees each panel is wired once). It replaces the global
// querySelectorAll at boot: before, it only covered the
// partials already injected and didn't serve the lazy loading.
function wirePanelControls(panelEl) {
  const filters = panelEl.querySelector(".filter-chips");
  if (filters) {
    const scope = filters.dataset.scope;
    filters.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        filters.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        activeFilters[scope] = chip.dataset.status;
        renderLibraryFor(scope);
      });
    });
  }

  const sortSelect = panelEl.querySelector(".sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      activeSort[sortSelect.dataset.scope] = sortSelect.value;
      renderLibraryFor(sortSelect.dataset.scope);
    });
  }

  const viewToggle = panelEl.querySelector(".view-toggle");
  if (viewToggle) {
    const scope = viewToggle.dataset.scope;
    viewToggle.querySelectorAll(".view-toggle__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        viewToggle.querySelectorAll(".view-toggle__btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        viewMode[scope] = btn.dataset.view;
        renderLibraryFor(scope);
      });
    });
  }
}

// On-demand loading of a panel's partial (ocio/*.html). It does
// nothing if the panel was already loaded. After injecting the HTML, it wires its
// controls and, if the group already has a snapshot (it arrived before the
// HTML), paints the library immediately; otherwise renderLibraryFor
// will do it when the snapshot arrives (or the loading stays visible).
async function loadOcioPartial(panelEl) {
  if (!panelEl || loadedPartials.has(panelEl.id)) return;
  loadedPartials.add(panelEl.id);
  const src = panelEl.dataset.ocioSrc;
  // Fetch timeout (issue #286): if the network hangs, abort and
  // fall into the panel's error state. Declared outside the try
  // so the finally can clean the timer in all paths.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PARTIAL_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(src + "?v=" + APP_VERSION, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    panelEl.innerHTML = panelLoadingHtml() + html;
    wirePanelControls(panelEl);
    // The Shopping tab (wishlist): its «Añadir» button and chips
    // live in the partial; they are wired here (the setup can't do it
    // at boot: the markup doesn't exist yet).
    if (panelEl.id === "panel-experiences" && experiencesApi) {
      experiencesApi.wireControls();
      if (groupReady.experiences) experiencesApi.setExperienceItems(allItems.experiences);
    }
    if (panelEl.id === "panel-wishlist" && wishlistApi) {
      wishlistApi.wireControls();
      if (groupReady.wishlist) wishlistApi.setWishlistItems(allItems.wishlist);
    }
    const group = panelEl.dataset.typeGroup;
    // "wishlist" is painted with its own API (setWishlistItems), not
    // by renderLibraryFor (GRID_IDS doesn't cover it).
    if (group && group !== "wishlist" && group !== "experiences" && groupReady[group]) {
      renderLibraryFor(group);
    }
  } catch (err) {
    // It is removed from the loaded set to retry on the next
    // activation (e.g. after fixing the failure's source) or with the
    // «Reintentar» button of the error state.
    loadedPartials.delete(panelEl.id);
    const mensaje =
      err?.name === "AbortError"
        ? "Esta sección tardó demasiado en cargarse."
        : "No se pudo cargar esta sección.";
    showPanelLoadError(panelEl.dataset.typeGroup, mensaje, { force: true });
    console.error("No se pudo cargar", src, err);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------- Theme (light / dark / pure black / pure white modes) ----------

const STORAGE_KEY_THEME = "mi-registro-theme";

// Real background color of each mode for the <meta name="theme-color">:
// dark #171512, pure black #000000, light #f5f0e8, pure white #ffffff.
const THEME_META_COLORS = {
  dark: "#171512",
  black: "#000000",
  light: "#f5f0e8",
  white: "#ffffff",
};

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY_THEME, theme);
  // Update theme-color meta tag
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_META_COLORS[theme] || THEME_META_COLORS.dark;
}

function getSavedTheme() {
  const saved = localStorage.getItem(STORAGE_KEY_THEME);
  // Defensive: old or invalid values fall to dark mode.
  return Object.prototype.hasOwnProperty.call(THEME_META_COLORS, saved) ? saved : "dark";
}

// ---------- Initialization ----------

async function init() {
  // Restore theme preference before painting anything
  setTheme(getSavedTheme());
  syncThemeToSettings(getSavedTheme());

  // Steam login return (ADR-108): if we arrive with the hash
  // #/steam-callback?... the router doesn't understand it, so we process it
  // BEFORE creating the router: it saves the linked SteamID and resets
  // the hash to a neutral route within the same page (without reload).
  const steamCb = parseSteamCallbackHash(location.hash);
  if (steamCb) {
    applySteamCallback(location.hash);
    history.replaceState(null, "", location.pathname + location.search + "#/ocio");
  }

  // Language (ADR-110): applies the saved language and watches mutations
  // to translate the dynamic renders. Fail-open: without a DOM/lang it
  // doesn't break the boot.
  try {
    initializeI18n();
  } catch (e) {
    console.warn("No se pudo aplicar el idioma:", e);
  }

  const ctx = createCtx();

  // Leisure tabs and routing (issue #59): each tab has
  // its own URL (#/ocio/series, #/ocio/peliculas, #/ocio/libros)
  // managed by the hash router. The manual click replicates the
  // classic behavior (activate tab, move focus to the title)
  // and also syncs the URL; activations coming from the
  // router (direct load, reload, back/forward) never steal
  // the focus. Only the Leisure data tabs (data-panel) are wired:
  // Recipes and Gym have their own wiring (issues #64
  // and #62) and their own data-*.
  const tabs = document.querySelectorAll(".tab[data-panel]");
  const panels = {
    "panel-movies": document.getElementById("panel-movies"),
    "panel-tv": document.getElementById("panel-tv"),
    "panel-books": document.getElementById("panel-books"),
    "panel-games": document.getElementById("panel-games"),
    "panel-wishlist": document.getElementById("panel-wishlist"),
    "panel-experiences": document.getElementById("panel-experiences"),
  };
  // Currently active Leisure panel (watchAuthState uses it after the
  // login to know which tab must load partial and subscription).
  let activePanelId = null;

  function activatePanel(panelId, { moveFocus = false } = {}) {
    // Tabs hidden by the user (issue #97): if the requested tab
    // is not visible (direct URL, reload, back/forward or
    // a hidden tab), it falls back to the first visible one of the section and
    // normalizes the URL in-place. replaceState doesn't fire hashchange,
    // so there is no loop. (The router is not used here: at initial
    // load this guard runs inside initRouter, before the
    // const router is assigned — TDZ.)
    const panelKey = keyForPanel(panelId);
    if (panelKey && !isTabVisible(panelKey)) {
      panelId = getFirstVisibleTabPanel("ocio");
      const fallbackKey = getFirstVisibleTabKey("ocio");
      if (fallbackKey) history.replaceState(null, "", hashForKey(fallbackKey));
    }

    tabs.forEach((t) => {
      t.classList.remove("is-active");
      t.setAttribute("aria-selected", "false");
    });
    Object.values(panels).forEach((p) => p && p.classList.add("hidden"));

    // Defensive: if the panel doesn't exist (an outdated data-panel),
    // it falls to the default state (Series) instead of breaking.
    const targetId = panels[panelId] ? panelId : "panel-tv";
    const activeTab = Array.from(tabs).find((t) => t.dataset.panel === targetId);
    if (activeTab) {
      activeTab.classList.add("is-active");
      activeTab.setAttribute("aria-selected", "true");
    }
    panels[targetId].classList.remove("hidden");
    activePanelId = targetId;

    // Lazy loading (issue #178): the panel's partial is only loaded
    // the first time it is activated, and its group's subscription only
    // starts if there is a session (after login, watchAuthState
    // handles the active tab's group if this activation happened
    // before the session).
    const activeGroup = PANEL_TO_GROUP[targetId];
    if (activeGroup) {
      loadOcioPartial(panels[targetId]);
      if (currentUser) ensureGroupSubscribed(activeGroup);
    }

    if (moveFocus) {
      // Move focus to the active section's title (only on manual click).
      const heading = panels[targetId].querySelector("h2");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus();
      }
    }
  }

  // Tabs hidden by the user (issue #97): remove from the bar
  // and from the view. Subscriptions and data loads stay
  // active (tabs are hidden and shown with the hidden class, without
  // unmounting anything). If the hidden tab was the active one, activatePanel
  // already falls back to the first visible one via its guard.
  function applyTabVisibility() {
    Object.entries(SECTION_REGISTRY.ocio.tabs).forEach(([tabKey, tab]) => {
      const tabEl = document.querySelector(`.tab[data-panel="${tab.panelId}"]`);
      if (tabEl) tabEl.classList.toggle("hidden", !isTabVisible(tabKey));
      // The visible panel is controlled exclusively by activatePanel: here
      // hidden is only ADDED to the hidden tabs, never removed
      // (a toggle with false used to reveal all the visible panels at
      // once; issue #178).
      const panelEl = panels[tab.panelId];
      if (panelEl && !isTabVisible(tabKey)) panelEl.classList.add("hidden");
    });
    // Recipes tabs (issue #208): the Recipes tab bar is
    // already the same component as the Leisure one, so hidden
    // tabs in Settings also come out of its bar. The
    // Recipes panels are re-toggled by openRecipes when opening the
    // section (with normalizeTabKey, which already falls to the first visible
    // if the requested one is hidden), so here hidden is only added.
    Object.entries(SECTION_REGISTRY.recetas.tabs).forEach(([tabKey, tab]) => {
      const tabEl = document.querySelector(`.tab[data-recipes-tab="${tabKey}"]`);
      if (tabEl) tabEl.classList.toggle("hidden", !isTabVisible(tabKey));
      const panelEl = document.getElementById(tab.panelId);
      if (panelEl && !isTabVisible(tabKey)) panelEl.classList.add("hidden");
    });
    // Gym tabs (issue #62): same pattern as Recipes,
    // with data-gym-tab. The panels are re-toggled by openGym when opening
    // the section (with normalizeTabKey), so here hidden is only
    // added (never removed; issue #178).
    Object.entries(SECTION_REGISTRY.gimnasio.tabs).forEach(([tabKey, tab]) => {
      const tabEl = document.querySelector(`.tab[data-gym-tab="${tabKey}"]`);
      if (tabEl) tabEl.classList.toggle("hidden", !isTabVisible(tabKey));
      const panelEl = document.getElementById(tab.panelId);
      if (panelEl && !isTabVisible(tabKey)) panelEl.classList.add("hidden");
    });
    // If the active tab became hidden, fall back to the first visible
    // (the same activatePanel guard, issue #97): without this the content
    // area would be blank when hiding the active tab.
    if (activePanelId && !isTabVisible(keyForPanel(activePanelId))) {
      activatePanel(getFirstVisibleTabPanel("ocio") || "panel-tv");
    }
  }

  // Full refresh of the navigation after a visibility change
  // (issue #97): Leisure tabs + sidebar/☰↔⚙ of the header.
  function refreshNavigation() {
    applyTabVisibility();
    renderSidebar();
  }

  // Router (issue #59): on direct load or reload it activates the view
  // indicated by the URL (Leisure tab or profile section) without
  // stealing the focus (only the manual click moves it).
  const profileView = document.getElementById("profile-view");
  // Declared before creating the router: onRoute runs during
  // initRouter() with the initial load's route, and profileApi doesn't
  // exist yet (nor does the session). The guard allows ignoring it: after
  // login, watchAuthState calls router.applyRoute() to resume it.
  let profileApi = null;
  let recipesApi = null;
  let gymApi = null;
  let wishlistApi = null;
  let experiencesApi = null;
  const router = initRouter({
    onRoute: (route) => {
      // Top search scoped to the section (issue #206): the
      // placeholder of the bar reflects where the user is searching.
      ui.setSearchSection(route.section);

      // Global header (issue #206, iteration 2026-08-11): in the
      // profile it is NOT shown (the user prefers the back arrow
      // and the tabs in the same row); in Leisure and Recipes it is. With
      // an active session only (the login screen always hides it).
      const appHeader = document.getElementById("app-header");
      if (route.section === "perfil") {
        appHeader?.classList.add("hidden");
      } else if (currentUser) {
        appHeader?.classList.remove("hidden");
      }

      // Highlighting of the active section in the sidebar (issue #206,
      // iteration 2026-08-11): the highlight follows the route. In the
      // profile only «Settings» (pinned entry) is highlighted when in
      // that subsection; the rest of the profile has no entry.
      setActiveSection(
        route.section === "perfil"
          ? route.profileSection === "settings"
            ? "settings"
            : null
          : route.section
      );

      if (route.section === "perfil") {
        // Profile route: opens the requested section (profile.js decides
        // the render and, if it comes with a uid, the friend's detail).
        document.getElementById("recipes-view")?.classList.add("hidden");
        document.getElementById("gym-view")?.classList.add("hidden");
        if (profileApi) {
          profileApi.openProfileSection(route.profileSection, ctx, {
          fromRouter: true,
        });
        }
      } else if (route.section === "recetas") {
        // Recipes route (issue #64): opens the section with the requested
        // tab (#/recetas, #/recetas/menu, #/recetas/compra). If the
        // tab is hidden in Settings, it is normalized to the first
        // visible one and the URL is rewritten (same guard as Leisure, #97).
        document.getElementById("gym-view")?.classList.add("hidden");
        if (recipesApi) {
          const tab = normalizeTabKey("recetas", route.tab);
          if (tab !== route.tab) {
            router.navigate({ section: "recetas", tab }, { replace: true });
          }
          recipesApi.openRecipes({ tab, fromRouter: true });
        }
      } else if (route.section === "gimnasio") {
        // Gym route (issue #62): opens the section with the requested
        // tab (#/gimnasio, #/gimnasio/ejercicios). Same
        // normalization guard as Leisure/Recipes (#97): if the
        // tab is hidden in Settings, it falls to the first
        // visible one and the URL is rewritten. Without a session nothing is
        // revealed: on entering, watchAuthState calls router.applyRoute().
        if (profileView) profileView.classList.add("hidden");
        document.getElementById("recipes-view")?.classList.add("hidden");
        if (gymApi) {
          const tab = normalizeTabKey("gimnasio", route.tab);
          if (tab !== route.tab) {
            router.navigate({ section: "gimnasio", tab }, { replace: true });
          }
          gymApi.openGym({ tab, fromRouter: true });
        }
      } else if (route.section === "ocio") {
        // Leisure route: close the profile if it was open and activate
        // the tab (lastOcioKey is updated by the router internally).
        if (profileView) profileView.classList.add("hidden");
        document.getElementById("recipes-view")?.classList.add("hidden");
        document.getElementById("gym-view")?.classList.add("hidden");
        activatePanel(route.panelId);
        // Without a session, #app stays hidden (login screen): don't
        // reveal the interface nor its controls. On entering, ui.showApp
        // shows it (issue #178). REGRESSION (issue #208): the merge of
        // content/issue-64-seccion-recetas re-introduced an
        // unconditional classList.remove("hidden") over #app that
        // revealed the tab bar over the login screen
        // (and the rest of the interface) until Firebase resolved the
        // session. The only path revealing #app is ui.showApp after the
        // login: this conditional remove is the only one allowed.
        if (currentUser) document.getElementById("app").classList.remove("hidden");
      }
    },
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const panelId = tab.dataset.panel;
      activatePanel(panelId, { moveFocus: true });
      router.navigate(keyForPanel(panelId));
    });
  });

    // Authentication
  document.getElementById("btn-login").addEventListener("click", () => {
    ui.setAuthError(null);
    login().catch((err) => {
      if (err.code !== "auth/popup-closed-by-user") {
        ui.setAuthError("No se pudo iniciar sesión: " + err.message);
      }
    });
  });

  // Specialized modules. profileApi (declared before the router
  // for its use in onRoute) is assigned here. The wiring of the
  // controls of each panel (filters, sort, view) is no longer done
  // here: wirePanelControls runs it when injecting each partial
  // (lazy loading, issue #178).
  setupModalCloseListeners();
  setupNotifications(ctx);
  profileApi = setupProfile(ctx);
  // Wishlist (Shopping): wiring of the «Añadir» button and chips;
  // the subscription goes through the lazy panels flow (subscribeGroup).
  wishlistApi = setupWishlist(ctx);
  experiencesApi = setupExperiences(ctx);
  // Recipes section (issue #64): opening API for the router and
  // menu cleanup when deleting a recipe.
  recipesApi = setupRecipes({
    ctx,
    onRecipeDeleted: (recipeId) => cleanupDeletedRecipe(recipeId),
  });
  setupMenu({ ctx });
  setupShoppingList({ ctx });
  // The visibility changes in Settings refresh tabs and
  // the sidebar immediately (issue #97).
  setupSettings(ctx, { onVisibilityChange: refreshNavigation });
  setupSidebar({
    // «Settings» entry: navigates to the profile route so the URL
    // syncs (the router opens the section).
    onOpenSettings: () => router.navigate({ section: "perfil", profileSection: "settings" }),
    // «Leisure» entry: besides the scroll to top, it returns to the last
    // active Leisure tab and syncs the URL with the router.
    // If that tab became hidden, the key is normalized to the
    // first visible one (issue #97).
    onGoOcio: () => router.navigate(normalizeTabKey("ocio", getLastOcioKey())),
    // Section visibility (issue #97): with only one section
    // visible, the sidebar is replaced by the header's ⚙.
    isSectionVisible: (id) => isSectionVisible(id),
  });
  setupGlobalSearch(ctx);
  // Reflect the hidden tabs saved in the initial state
  // (the sidebar was already re-rendered inside setupSidebar).
  applyTabVisibility();
  // Hide the header and tabs when scrolling in the leisure lists,
  // with a floating "Back to top" button (issue #137).
  initAutoHideNav();

  // Real-time subscriptions
  watchAuthState(async (user) => {
    stopAllSubscriptions();
    groupReady.movies = false;
    groupReady.tv = false;
    groupReady.books = false;
    groupReady.games = false;
    groupReady.wishlist = false;
    groupReady.experiences = false;
    checksTriggered = false;

    if (!user) {
      currentUser = null;
      allItems.movies = [];
      allItems.tv = [];
      allItems.books = [];
      allItems.games = [];
      notifications = [];
      // Recipes (issue #64): the previous user's data must not be
      // shown to the next one if another account logs in.
      resetRecipesData();
      resetMenuData();
      resetShoppingListState();
      resetSectionLists();
      // Gym (issue #62): same pattern, and it also hides the
      // view if the session was closed from it (it would stay over the
      // login screen).
      resetGymData();
      document.getElementById("gym-view")?.classList.add("hidden");
      cleanupSettings();
      resetDevicePush();
      // Restore the loading indicator in the panels with an injected partial
      // (issue #178): renderLibraryFor removed it when painting
      // the data; on logout and re-login, the
      // subscriptions start again and the «Loading…» must
      // reappear until the first snapshot.
      Object.values(panels).forEach((p) => {
        if (p && loadedPartials.has(p.id) && !p.querySelector(".panel-loading")) {
          p.querySelector(".panel-error")?.remove();
          p.insertAdjacentHTML("afterbegin", panelLoadingHtml());
        }
      });
      ui.showAuthScreen();
      return;
    }

    // Access controlled SOLELY by the Firestore rules (issue #195):
    // the authorized emails list lives only in isAllowedUser()
    // of firestore.rules (js/allowed-emails.js was removed: it duplicated
    // the list and desynced). To know whether this user can log in,
    // we ask Firestore for their own profile: if the rules
    // reject it (permission-denied), the user is warned and signed out.
    // Any other error (e.g. no connection) doesn't block entry:
    // the subscriptions already retry on their own (issue #147).
    try {
      await getUserProfile(user.uid);
    } catch (err) {
      if (err?.code === "permission-denied") {
        ui.setAuthError("Tu correo no está en la lista de invitados. Pide que te añadan.");
        logout();
        return;
      }
      console.error("No se pudo comprobar el acceso del usuario:", err);
    }

    currentUser = user;
    ui.showApp(user);

    // Gym (issue #62): opening API for the router. setupGym
    // is idempotent (it only wires the DOM the first time), so it
    // can be called on each login without accumulating listeners.
    gymApi = setupGym({ ctx });

    // If the initial load requested a profile route (#/perfil/...) without
    // a session, onRoute ignored it (profileApi didn't exist yet). On
    // entering, we resume it to open the requested section.
    if (router.getCurrentSection() === "perfil") {
      router.applyRoute();
    }
    // Same for the Recipes section (issue #64): if the reload requested
    // #/recetas/... and there was no session, we resume it on entering.
    if (router.getCurrentSection() === "recetas") {
      router.applyRoute();
    }
    // And with Gym (issue #62): if the reload requested #/gimnasio/...
    // without a session, the section opens on entering.
    if (router.getCurrentSection() === "gimnasio") {
      router.applyRoute();
    }

    try {
      await upsertUserProfile(user.uid, {
        email: user.email,
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
      });
    } catch (err) {
      console.error("No se pudo guardar el perfil de usuario:", err);
    }

    // Minimal storage migration (issue #200): prunes once per
    // user the detail fields that stopped being persisted.
    // Best-effort and fail-open: if it fails, it doesn't block entry and is
    // retried in the next session.
    runStorageMigration(user.uid, createCtx()).catch((err) => {
      console.error("No se pudo ejecutar la migración de almacenamiento:", err);
    });

    // Real-time subscriptions, lazy per tab (issue #178):
    // only the active Leisure tab's group starts; the
    // others subscribe when their tab is activated (activatePanel →
    // ensureGroupSubscribed). Each subscription is wrapped with
    // subscribeWithRetry (issue #147): if on entering it fails due to a
    // transient error, it retries on its own with backoff instead of
    // leaving the library empty until closing and reopening the web.
    // The active tab's partial is also ensured here (the
    // activation may have happened without a session or with a route foreign to the router).
    const panelId = activePanelId && panels[activePanelId] ? activePanelId : (getFirstVisibleTabPanel("ocio") || "panel-tv");
    loadOcioPartial(panels[panelId]);
    ensureGroupSubscribed(PANEL_TO_GROUP[panelId] || "tv");

    // Daily check: once per session. It no longer waits for the
    // four groups' subscriptions to arrive (daily-check
    // reads from Firestore on demand with getItemsOnce).
    maybeTriggerDailyCheck();

    // Notifications: same retry, but silently (like its current onError
    // behavior, which didn't bother). The badge is filled when the retry
    // succeeds.
    unsubscribeNotifications = subscribeWithRetry({
      subscribe: ({ onChange, onError }) =>
        subscribeToNotifications(user.uid, onChange, onError),
      onChange: (items) => {
        notifications = items;
        ui.renderNotifications(
          document.getElementById("notif-list"),
          document.getElementById("notif-badge"),
          document.getElementById("notif-empty"),
          notifications,
          { onDelete: (n) => deleteNotification(currentUser.uid, n.id) }
        );
        // Forward to the OS the new notifications when the app is
        // in the background (bell → system notification).
        handleNotificationsSnapshot(notifications);
      },
      onError: () => {},
    });

    // Recipes (issue #64): real-time subscriptions of recipes,
    // ingredient catalog, own tags and weekly menus,
    // with the same retry with backoff as the rest (issue #147).
    unsubscribeRecipes = subscribeWithRetry({
      subscribe: ({ onChange, onError }) => subscribeRecipesData(user.uid, onChange, onError),
      // The render is already managed by recipes.js with each snapshot; the
      // onChange here only serves so subscribeWithRetry resets
      // its retry counter (no-op).
      onChange: () => {},
      onError: () => ui.showToast("No se pudieron cargar tus recetas."),
      onRetrying: () => ui.showToast("Hay problemas de conexión. Reintentando…"),
    });
    unsubscribeMenuData = subscribeWithRetry({
      subscribe: ({ onChange, onError }) => subscribeMenuData(user.uid, onChange, onError),
      // Same as recipes: menu.js does the render; no-op.
      onChange: () => {},
      onError: () => ui.showToast("No se pudo cargar tu menú semanal."),
      onRetrying: () => ui.showToast("Hay problemas de conexión. Reintentando…"),
    });

    // Gym (issue #62): real-time subscriptions of workouts
    // and exercises, with the same retry with backoff (issue #147).
    // gym.js does the render with each snapshot; no-op.
    unsubscribeGymData = subscribeWithRetry({
      subscribe: ({ onChange, onError }) => subscribeGymData(user.uid, onChange, onError),
      onChange: () => {},
      onError: () => ui.showToast("No se pudieron cargar tus datos de gimnasio."),
      onRetrying: () => ui.showToast("Hay problemas de conexión. Reintentando…"),
    });
  });
}

init().catch((err) => {
  console.error("No se pudo iniciar la aplicación:", err);
});
