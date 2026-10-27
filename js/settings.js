// =============================================================
// Settings. Handles the settings UI and the persistence of
// preferences in localStorage + Firestore.
// =============================================================

import { syncNow, isSyncRunning } from "./daily-check.js";
import { isNotificationSupported, getPermission, requestDevicePushPermission } from "./push.js";
import { fetchOwnedSteamGames, sanitizeSteamId, steamProxyUrl, steamHoursLabel, steamLoginUrl, parseSteamCallbackHash } from "./api-steam.js";
import { todayISO } from "./dates.js";
import { showToast } from "./ui.js";
import { getLang, setLang } from "./i18n.js";

const STORAGE_KEY = "mi-registro-settings";
const DEBOUNCE_MS = 2000;

const DEFAULT_SETTINGS = {
  theme: "dark",
  notifications: {
    movie_release: true,
    new_episode: true,
    series_premiere: true,
    game_release: true,
    device_push: false,
  },
  // Weight unit of the Gimnasio section (issue #62): "kg" | "lbs".
  // The canonical weight in Firestore is ALWAYS kg; this preference
  // only changes the presentation (and the inputs) in the interface.
  unidadPeso: "kg",
  // Stored SteamID64 for the Steam integration (ADR-107): it is
  // remembered so you do not have to type it every time.
  steamId: "",
  visibleSections: { ocio: true, recetas: true, gimnasio: true },
  visibleTabs: { resumen: true, series: true, peliculas: true, libros: true, compras: true, recetas: true, ingredientes: true, menu: true, compra: true, entrenos: true, ejercicios: true },
};

// Central registry of sections and tabs of the site (issue #97).
// The key order is the sidebar order and the «first visible» order
// of each section. Adding a future section only requires adding an
// entry here: { id: { label, tabs } }, with each tab
// { label, panelId } (panelId = panel id in index.html). The rest
// of the module (helpers, guards and the Settings card render)
// adapts by itself.
export const SECTION_REGISTRY = {
  ocio: {
    label: "Ocio",
    tabs: {
      series: { label: "Series", panelId: "panel-tv" },
      peliculas: { label: "Películas", panelId: "panel-movies" },
      libros: { label: "Libros", panelId: "panel-books" },
      videojuegos: { label: "Videojuegos", panelId: "panel-games" },
      compras: { label: "Compras", panelId: "panel-wishlist" },
    },
  },
  recetas: {
    label: "Recetas",
    tabs: {
      recetas: { label: "Recetas", panelId: "panel-recipes-tab" },
      ingredientes: { label: "Ingredientes", panelId: "panel-ingredients-tab" },
      menu: { label: "Menú", panelId: "panel-menu-tab" },
      compra: { label: "Compra", panelId: "panel-shopping-tab" },
    },
  },
  gimnasio: {
    label: "Gimnasio",
    tabs: {
      // First tab = default tab of the section (#269).
      resumen: { label: "Resumen", panelId: "panel-gym-summary-tab" },
      entrenos: { label: "Entrenos", panelId: "panel-gym-workouts-tab" },
      ejercicios: { label: "Ejercicios", panelId: "panel-gym-exercises-tab" },
    },
  },
};

// ---- Load / Save (localStorage) ----

function deepMerge(defaults, overrides) {
  const result = { ...defaults };
  for (const key of Object.keys(overrides || {})) {
    if (overrides[key] !== null && typeof overrides[key] === "object" && !Array.isArray(overrides[key])) {
      result[key] = deepMerge(defaults[key] || {}, overrides[key]);
    } else {
      result[key] = overrides[key];
    }
  }
  return result;
}

// Sanitizes the section/tab visibility invariants (issue #97) after
// reading localStorage or the unsaved fallback:
//   (a) if no section ended up visible, all are enabled;
//   (b) if a section ended up with no visible tabs, all its tabs are
//       enabled;
//   (c) keys not in the registry are ignored (tolerant to old
//       settings or removed future sections).
function sanitizeVisibility(settings) {
  const validSectionIds = Object.keys(SECTION_REGISTRY);
  const validTabKeys = Object.values(SECTION_REGISTRY).flatMap((s) => Object.keys(s.tabs));

  const sections = {};
  const tabs = {};
  validSectionIds.forEach((id) => {
    sections[id] = settings.visibleSections[id] !== false;
  });
  validTabKeys.forEach((key) => {
    tabs[key] = settings.visibleTabs[key] !== false;
  });
  settings.visibleSections = sections;
  settings.visibleTabs = tabs;

  if (!validSectionIds.some((id) => sections[id])) {
    validSectionIds.forEach((id) => {
      sections[id] = true;
    });
  }

  Object.values(SECTION_REGISTRY).forEach((section) => {
    const keys = Object.keys(section.tabs);
    if (keys.length > 0 && !keys.some((k) => tabs[k])) {
      keys.forEach((k) => {
        tabs[k] = true;
      });
    }
  });

  return settings;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return sanitizeVisibility(deepMerge(DEFAULT_SETTINGS, parsed));
    }
  } catch (e) {
    console.warn("No se pudieron leer los ajustes:", e);
  }
  return sanitizeVisibility({
    ...DEFAULT_SETTINGS,
    notifications: { ...DEFAULT_SETTINGS.notifications },
    visibleSections: { ...DEFAULT_SETTINGS.visibleSections },
    visibleTabs: { ...DEFAULT_SETTINGS.visibleTabs },
  });
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("No se pudieron guardar los ajustes:", e);
  }
}

// ---- Sync to Firestore (debounced) ----

let debounceTimer = null;

function scheduleFirestoreSync(ctx) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      const user = ctx.getCurrentUser();
      if (user) {
        const settings = loadSettings();
        await ctx.upsertUserProfile(user.uid, {
          preferences: {
            notifications: settings.notifications,
            visibleSections: settings.visibleSections,
            visibleTabs: settings.visibleTabs,
            unidadPeso: settings.unidadPeso,
          },
        });
      }
    } catch (e) {
      console.warn("No se pudieron sincronizar ajustes con Firestore:", e);
    }
  }, DEBOUNCE_MS);
}

/** Clears the pending timer (useful on logout). */
export function cleanupSettings() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  ctxForSteam = null;
}

// ---- UI Rendering ----

// Valid values for the theme select (Settings → Appearance).
const VALID_THEMES = ["dark", "black", "light", "white"];

export function renderSettings(ctx) {
  const settings = loadSettings();

  const themeSelect = document.getElementById("settings-theme-select");
  if (themeSelect) {
    // Defensive: an old or invalid value falls back to dark mode.
    themeSelect.value = VALID_THEMES.includes(settings.theme) ? settings.theme : "dark";
  }

  // Language (ADR-110): the select mirrors the active language.
  const langSelect = document.getElementById("settings-lang-select");
  if (langSelect) langSelect.value = getLang();

  // While a sync is running, the sync button stays disabled (the flag
  // also covers it during the click).
  const syncBtn = document.getElementById("btn-sync-now");
  if (syncBtn) syncBtn.disabled = isSyncRunning();

  const checkboxMap = {
    "notif-movie-release": "movie_release",
    "notif-new-episode": "new_episode",
    "notif-series-premiere": "series_premiere",
    "notif-game-release": "game_release",
    "notif-device": "device_push",
  };

  Object.entries(checkboxMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.checked = settings.notifications[key] !== false;
  });

  // The on-device notifications toggle requires API support and a
  // permission not denied; if the permission is denied it shows
  // unchecked and disabled (the saved preference is kept: if the
  // user re-allows in the browser, the toggle shows checked again
  // when opening Settings).
  const devEl = document.getElementById("notif-device");
  if (devEl) {
    const permission = isNotificationSupported() ? getPermission() : "denied";
    if (permission === "denied") {
      devEl.checked = false;
    }
    devEl.disabled = permission === "denied";
  }

  // Card «Secciones y pestañas»: dynamic render from the registry.
  renderSectionsCard(settings);

  // Card «Integración de Steam» (ADR-107).
  renderSteamCard(settings);
}

// ---- Card «Secciones y pestañas» (issue #97) ----

// Render of the card from the registry: one row per section (with
// its tabs nested in a .settings-group). The ids are literals
// controlled by this module (no user data).
function renderSectionsCard(settings) {
  const container = document.getElementById("sections-visibility-list");
  if (container) container.innerHTML = buildSectionsHTML(settings);
}

function buildSectionsHTML(settings) {
  const visibleSectionIds = Object.keys(SECTION_REGISTRY).filter((id) => settings.visibleSections[id] !== false);
  // If only one section remains visible, its switch is disabled: at
  // least one section is always kept on screen.
  const onlyOneSection = visibleSectionIds.length <= 1;

  return Object.entries(SECTION_REGISTRY)
    .map(([sectionId, section]) => {
      const sectionVisible = settings.visibleSections[sectionId] !== false;
      const sectionLocked = onlyOneSection && sectionVisible;

      const sectionRow = `
        <div class="settings-row">
          <label class="settings-row__text" for="section-visible-${sectionId}">
            ${section.label}
            ${sectionLocked ? `<p class="settings-row__hint">No puedes ocultar la última sección visible.</p>` : ""}
          </label>
          <label class="switch" aria-hidden="true">
            <input type="checkbox" id="section-visible-${sectionId}" class="switch__input"
                   data-vis-section="${sectionId}" ${sectionVisible ? "checked" : ""}
                   ${sectionLocked ? "disabled" : ""} />
            <span class="switch__slider"></span>
          </label>
        </div>`;

      const visibleTabKeys = Object.keys(section.tabs).filter((k) => settings.visibleTabs[k] !== false);
      const tabsGroup = Object.entries(section.tabs)
        .map(([tabKey, tab]) => {
          const tabVisible = settings.visibleTabs[tabKey] !== false;
          // The last visible tab of the section cannot be
          // hidden: at least one is always kept on screen.
          const tabLocked = tabVisible && visibleTabKeys.length <= 1;
          const hint = tabLocked ? `No puedes ocultar la última pestaña visible de ${section.label}.` : "";
          return `
          <div class="settings-row">
            <label class="settings-row__text" for="tab-visible-${sectionId}-${tabKey}">
              ${tab.label}
              ${hint ? `<p class="settings-row__hint">${hint}</p>` : ""}
            </label>
            <label class="switch" aria-hidden="true">
              <input type="checkbox" id="tab-visible-${sectionId}-${tabKey}" class="switch__input"
                     data-vis-tab="${tabKey}" ${tabVisible ? "checked" : ""}
                     ${tabLocked ? "disabled" : ""} />
              <span class="switch__slider"></span>
            </label>
          </div>`;
        })
        .join("");

      return `${sectionRow}
        <div class="settings-group">${tabsGroup}
        </div>`;
    })
    .join("\n");
}

// ---- Card «Integración de Steam» (ADR-107) ----

function renderSteamCard(settings) {
  const input = document.getElementById("steam-id-input");
  const linked = sanitizeSteamId(settings.steamId);
  if (input) {
    input.value = linked || "";
    // Persistence of the steamId with the same pattern as the theme.
    if (!input.dataset.steamWired) {
      input.dataset.steamWired = "1";
      input.addEventListener("change", () => {
        const s = loadSettings();
        s.steamId = sanitizeSteamId(input.value);
        saveSettings(s);
      });
    }
  }
  const proxyHint = document.getElementById("steam-proxy-hint");
  if (proxyHint) {
    proxyHint.textContent = steamProxyUrl()
      ? (linked
          ? `Cuenta vinculada con Steam (${linked}): 
            la web actualiza las horas cada día al entrar.`
          : "Vincula tu cuenta de Steam para traer tus juegos con las horas jugadas.")
      : "⚠ La integración no está configurada (falta la URL del proxy de Steam en el despliegue; ver cloudflare/steam-proxy/README.md).";
  }
  const linkBtn = document.getElementById("btn-steam-link");
  if (linkBtn) {
    linkBtn.textContent = linked ? "Re-vincular con Steam" : "Vincular mi cuenta de Steam";
    if (!linkBtn.dataset.steamWired) {
      linkBtn.dataset.steamWired = "1";
      linkBtn.addEventListener("click", () => {
        const url = steamLoginUrl();
        if (!url) {
          ctxForSteam?.showToast("Falta la URL del proxy de Steam (despliegue).");
          return;
        }
        window.location.href = url;
      });
    }
  }
  // Reload results: if the group is already in memory it repaints
  // clean (the new games are brought by the search button).
  clearSteamResults();
}

function clearSteamResults() {
  const box = document.getElementById("steam-results");
  if (box) {
    box.innerHTML = "";
    box.classList.add("hidden");
  }
}

// List of Steam results inside the card: name, played hours, day of
// the last session and add-to-record button.
// (No cover: the app does not download Steam assets; the add is a
// manual item.)
function renderSteamResults(games, appIdToAdded) {
  const box = document.getElementById("steam-results");
  if (!box) return;
  box.classList.remove("hidden");
  box.innerHTML = games
    .map((g, index) => {
      const added = appIdToAdded[g.appid];
      return `
      <div class="steam-row">
        <div class="steam-row__info">
          <div class="steam-row__name" title="${g.name}">${g.name}</div>
          <div class="steam-row__meta">${steamHoursLabel(g.playtimeHours) || "sin horas"} · jugado por última vez: ${g.lastPlayedAt || "nunca"}</div>
        </div>
        <button type="button" class="btn btn--small" data-steam-add="${index}" ${added ? "disabled" : ""}>
          ${added ? "Añadido ✓" : "Añadir"}
        </button>
      </div>`;
    })
    .join("");
}

function wireSteamIntegration(ctx) {
  const btn = document.getElementById("btn-steam-fetch");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const settings = loadSettings();
    const steamId = sanitizeSteamId((document.getElementById("steam-id-input") || {}).value || settings.steamId);
    if (!steamId) {
      ctx.showToast("El SteamID debe tener 17 dígitos (SteamID64).");
      return;
    }
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Buscando…";
    try {
      const result = await fetchOwnedSteamGames(steamId);
      if (!result.games.length) {
        ctx.showToast(result.hint || "Steam no devolvió ningún juego.");
        return;
      }
      // Duplicates: games already added from Steam.
      const addedIds = new Set(
        (await ctx.getGroupItemsResolved("games"))
          .filter((item) => item.steamAppId)
          .map((item) => item.steamAppId)
      );
      const appIdToAdded = {};
      result.games.forEach((g) => {
        if (addedIds.has(g.appid)) appIdToAdded[g.appid] = true;
      });
      renderSteamResults(result.games, appIdToAdded);
      // Connect adds:
      wireSteamAddButtons(ctx, result.games);
    } catch (err) {
      ctx.showToast("No se pudo consultar Steam: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

// Add of a Steam game to the record: manual item with ONE play
// session with the Steam hours (they add to the "hours played"
// profile statistic; the date is the last played day or today).
// The session carries source: "steam" so the daily pass recognizes
// it and refreshes its hours. Exported for tests.
export function steamGameDraft(g) {
  const day = g.lastPlayedAt || todayISO();
  const hours = g.playtimeHours > 0 ? g.playtimeHours : null;
  return {
    externalId: null,
    type: "game",
    title: g.name,
    year: null,
    coverUrl: null,
    author: null,
    pages: null,
    status: "completado",
    rating: null,
    notes: "",
    steamAppId: g.appid,
    steamPlaytimeHours: g.playtimeHours,
    playLog: [{ startedAt: day, finishedAt: day, hours, source: "steam" }],
  };
}

async function wireSteamAddButtons(ctx, games) {
  const box = document.getElementById("steam-results");
  if (!box) return;
  box.querySelectorAll("[data-steam-add]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const game = games[Number(btn.dataset.steamAdd)];
      if (!game) return;
      btn.disabled = true;
      btn.textContent = "Añadiendo…";
      try {
        await ctx.addItem(ctx.getCurrentUser().uid, "game", steamGameDraft(game));
        btn.textContent = "Añadido ✓";
        ctx.showToast(`«${game.name}» añadido a tu registro de videojuegos.`);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Añadir";
        ctx.showToast("No se pudo añadir: " + (err.message || err));
      }
    });
  });
}

// ---- Event Wiring ----

// Button "Comprobar estrenos" (issue #200): the minimal pass A5-a
// no longer curates metadata, it only reviews pending releases/
// episodes. It calls syncNow (daily-check.js) with a 30 minute
// cooldown and toast feedback. It restores the button in finally so
// it never stays blocked if something fails.
function wireSyncButton(ctx) {
  const btn = document.getElementById("btn-sync-now");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Comprobando…";
    try {
      const result = await syncNow(ctx);
      if (result.ok) {
        ctx.showToast("Estrenos comprobados.");
      } else if (result.reason === "cooldown") {
        ctx.showToast("Comprobación reciente, inténtalo en un rato.");
      } else if (result.reason === "running") {
        ctx.showToast("Ya hay una comprobación en curso.");
      } else {
        ctx.showToast("No se pudo comprobar: " + (result.message || "error desconocido."));
      }
    } catch (err) {
      ctx.showToast("No se pudo comprobar: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

function wireThemeSelect(ctx) {
  const select = document.getElementById("settings-theme-select");
  if (!select) return;
  select.addEventListener("change", () => {
    const s = loadSettings();
    s.theme = select.value;
    saveSettings(s);

    if (ctx.setTheme) {
      ctx.setTheme(s.theme);
    }

    scheduleFirestoreSync(ctx);
  });
}

function wireNotificationToggles(ctx) {
  const map = {
    "notif-movie-release": "movie_release",
    "notif-new-episode": "new_episode",
    "notif-series-premiere": "series_premiere",
    "notif-game-release": "game_release",
  };

  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const s = loadSettings();
      s.notifications[key] = el.checked;
      saveSettings(s);
      scheduleFirestoreSync(ctx);
    });
  });

  // On-device notifications toggle: its own wiring (outside the
  // generic loop) because enabling it requires asking the browser for
  // permission first. The first instruction of the handler is the
  // requestPermission: that way the user gesture counts as a
  // "user gesture" for the API.
  const devEl = document.getElementById("notif-device");
  if (devEl) {
    devEl.addEventListener("change", async () => {
      if (devEl.checked) {
        const result = await requestDevicePushPermission();
        if (result !== "granted") {
          devEl.checked = false;
          ctx.showToast(result === "denied" ? "Permiso denegado. Actívalo en los ajustes del navegador." : "No se pudo activar: permiso no concedido.");
          return;
        }
      }
      const s = loadSettings();
      s.notifications.device_push = devEl.checked;
      saveSettings(s);
      scheduleFirestoreSync(ctx);
    });
  }
}

// ---- Public API ----

// Module callback injected by app.js via
// setupSettings({ onVisibilityChange }): it is called after saving a
// visibility change so the navigation refreshes
// (applyTabVisibility + renderSidebar).
let onVisibilityChange = null;

export function setupSettings(ctx, { onVisibilityChange: onChange = null } = {}) {
  onVisibilityChange = onChange;
  appCtx = ctx;
  ctxForSteam = ctx;
  wireThemeSelect(ctx);
  wireLangSelect(ctx);
  wireNotificationToggles(ctx);
  wireSyncButton(ctx);
  wireVisibilityToggles(ctx);
  wireSteamIntegration(ctx);
}

// Wiring of the language select (ADR-110): persists and re-applies the
// translation to the WHOLE document (includes already-loaded Ocio
// partials). Toast in the target language.
function wireLangSelect(ctx) {
  const select = document.getElementById("settings-lang-select");
  if (!select) return;
  select.addEventListener("change", () => {
    const lang = setLang(select.value);
    select.value = getLang();
    ctx?.showToast?.(lang === "en" ? "Language set to English." : "Idioma cambiado a Español.");
  });
}

// App context captured in setupSettings: used by setUnit and
// setTheme to sync with Firestore (pattern of scheduleFirestoreSync).
let appCtx = null;
// Context for the Steam card (tokens/toast) — it goes back to null
// when unsubscribing (same life cycle).
let ctxForSteam = null;

// Saves the linked SteamID (localStorage) — used by the OpenID link
// flow and the manual setting. Returns the saved settings.
export function saveSteamId(steamId) {
  const s = loadSettings();
  s.steamId = sanitizeSteamId(steamId);
  saveSettings(s);
  return s;
}

/**
 * Processes a return from the Steam login (#/steam-callback?...):
 * saves the linked steamid or reports the error. app.js calls it on
 * startup BEFORE routing; it returns true if the hash belonged to
 * this flow (the app must ignore it and re-establish the clean
 * hash).
 * @param {string} hash - Current location.hash.
 * @returns {boolean}
 */
export function applySteamCallback(hash) {
  const callback = parseSteamCallbackHash(hash);
  if (!callback) return false;
  if (callback.steamid) {
    saveSteamId(callback.steamid);
    showToast(`Cuenta de Steam vinculada: ${callback.steamid}`);
  } else {
    showToast("No se pudo completar el inicio de sesión de Steam.");
  }
  return true;
}

// ---- Weight unit of Gimnasio (issue #62) ----

// Active weight unit ("kg" | "lbs"), ALWAYS read fresh from
// localStorage (pattern of the visibility helpers). gym.js uses it
// on each render: the values stored in Firestore do not change when
// toggling, only the presentation.
export function getUnit() {
  return loadSettings().unidadPeso === "lbs" ? "lbs" : "kg";
}

// Changes the weight unit and persists it (localStorage + sync to
// Firestore preferences with the same debounce as the rest of the
// settings). Called by #gym-unit-select on change.
export function setUnit(unit) {
  if (unit !== "kg" && unit !== "lbs") return;
  const s = loadSettings();
  s.unidadPeso = unit;
  saveSettings(s);
  if (appCtx) scheduleFirestoreSync(appCtx);
}

// Visibility toggles of the card «Secciones y pestañas» (issue
// #97). The `change` delegation lives in the container (the checks
// are re-rendered after each change; the listener is registered ONCE,
// here, because the container is never rebuilt).
function wireVisibilityToggles(ctx) {
  const list = document.getElementById("sections-visibility-list");
  if (!list) return;

  list.addEventListener("change", (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.dataset.visSection && !input.dataset.visTab) return;

    const settings = loadSettings();
    const componentKey = input.dataset.visSection || input.dataset.visTab;

    if (input.dataset.visSection) {
      settings.visibleSections[componentKey] = input.checked;
      // Defense in depth: 0 visible sections can never remain.
      const visibleCount = Object.keys(SECTION_REGISTRY).filter((id) => settings.visibleSections[id] !== false).length;
      if (visibleCount === 0) {
        input.checked = true;
        return;
      }
    } else {
      settings.visibleTabs[componentKey] = input.checked;
      // Defense in depth: 0 visible tabs can never remain
      // in the affected section.
      const sectionId = Object.keys(SECTION_REGISTRY).find((id) => SECTION_REGISTRY[id].tabs[componentKey]);
      if (sectionId) {
        const visibleTabs = Object.keys(SECTION_REGISTRY[sectionId].tabs).filter((k) => settings.visibleTabs[k] !== false);
        if (visibleTabs.length === 0) {
          input.checked = true;
          return;
        }
      }
    }

    saveSettings(settings);
    scheduleFirestoreSync(ctx);
    // Refresh guards and notices: after the change another row may
    // become the last visible one (and end up disabled).
    // The focused input is replaced by the re-render: restore focus
    // to the re-rendered equivalent (ids are deterministic:
    // section-visible-<id> / tab-visible-<section>-<tab>).
    const focusedId = document.activeElement instanceof HTMLInputElement ? document.activeElement.id : null;
    renderSectionsCard(loadSettings());
    if (focusedId) {
      const restored = document.getElementById(focusedId);
      if (restored) restored.focus();
    }
    if (onVisibilityChange) onVisibilityChange();
  });
}

/**
 * Syncs the theme into the localStorage settings key
 * when it is changed from the header toggle, to keep
 * both keys consistent.
 */
export function syncThemeToSettings(theme) {
  const s = loadSettings();
  s.theme = theme;
  saveSettings(s);
}

/**
 * Returns the current notification preferences (synchronous,
 * from localStorage). daily-check.js uses it to know which
 * notifications to create.
 */
export function getNotificationPrefs() {
  const settings = loadSettings();
  return settings.notifications || {};
}

// ---- Visibility of sections and tabs (issue #97) ----
// The helpers read loadSettings() fresh on each call (never
// mutate) so they always reflect the saved state. Used by
// sidebar.js (via injection), app.js and profile.js.

// Is the section visible? It also returns false if the id does not
// exist in the registry (removed future section).
export function isSectionVisible(sectionId) {
  if (!SECTION_REGISTRY[sectionId]) return false;
  return loadSettings().visibleSections[sectionId] !== false;
}

// Ids of the visible sections, in registry order (the sidebar and
// «first visible» order).
export function getVisibleSectionIds() {
  return Object.keys(SECTION_REGISTRY).filter((id) => loadSettings().visibleSections[id] !== false);
}

// Integer number of visible sections (sidebar.js uses it to
// choose between sidebar ☰ and Settings button).
export function countVisibleSections() {
  return getVisibleSectionIds().length;
}

// Is the tab visible (global key, e.g. "series")?
export function isTabVisible(tabKey) {
  return loadSettings().visibleTabs[tabKey] !== false;
}

// First visible key of a section's tabs, according to the
// registry; null if none.
export function getFirstVisibleTabKey(sectionId) {
  const section = SECTION_REGISTRY[sectionId];
  if (!section) return null;
  const settings = loadSettings();
  const key = Object.keys(section.tabs).find((k) => settings.visibleTabs[k] !== false);
  return key || null;
}

// panelId of the first visible key of the section (or null).
export function getFirstVisibleTabPanel(sectionId) {
  const key = getFirstVisibleTabKey(sectionId);
  const section = SECTION_REGISTRY[sectionId];
  return key && section ? section.tabs[key].panelId : null;
}

// Normalizes a tab key: it returns it if known and visible; if not,
// the first visible one of the section. Used by the flows that
// navigate to a tab («Ocio» entry, back from the profile) so they
// never land on a hidden one.
export function normalizeTabKey(sectionId, key) {
  const section = SECTION_REGISTRY[sectionId];
  const settings = loadSettings();
  if (section && section.tabs[key] && settings.visibleTabs[key] !== false) return key;
  return getFirstVisibleTabKey(sectionId);
}
