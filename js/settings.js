// =============================================================
// Ajustes (Settings). Maneja la UI de configuración y la
// persistencia de preferencias en localStorage + Firestore.
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
  // Unidad de peso de la sección de Gimnasio (issue #62): "kg" | "lbs".
  // El peso canónico en Firestore es SIEMPRE kg; esta preferencia solo
  // cambia la presentación (y las entradas) en la interfaz.
  unidadPeso: "kg",
  // SteamID64 guardado para la integración de Steam (ADR-107): se
  // recuerda para no estar poniéndolo en cada uso.
  steamId: "",
  visibleSections: { ocio: true, recetas: true, gimnasio: true },
  visibleTabs: { resumen: true, series: true, peliculas: true, libros: true, compras: true, recetas: true, ingredientes: true, menu: true, compra: true, entrenos: true, ejercicios: true },
};

// Registro central de secciones y pestañas de la web (issue #97).
// El orden de las claves es el orden de la barra lateral y el de la
// «primera visible» de cada sección. Añadir una sección futura solo
// requiere añadir una entrada aquí: { id: { label, tabs } }, con
// cada pestaña { label, panelId } (panelId = id del panel en
// index.html). El resto del módulo (helpers, guardas y render de la
// card de Ajustes) se adapta solo.
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
      // Primera pestaña = pestaña por defecto de la sección (#269).
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

// Sanitiza las invariantes de visibilidad de secciones/pestañas
// (issue #97) tras leer localStorage o el fallback sin guardar:
//   (a) si ninguna sección quedó visible, se activan todas;
//   (b) si una sección se quedó sin pestañas visibles, se activan todas
//       sus pestañas;
//   (c) las claves que no estén en el registro se ignoran (tolerante
//       ante ajustes antiguos o de secciones futuras ya retiradas).
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

/** Limpia el temporizador pendiente (útil al cerrar sesión). */
export function cleanupSettings() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  ctxForSteam = null;
}

// ---- UI Rendering ----

// Valores válidos para el select de tema (Ajustes → Apariencia).
const VALID_THEMES = ["dark", "black", "light", "white"];

export function renderSettings(ctx) {
  const settings = loadSettings();

  const themeSelect = document.getElementById("settings-theme-select");
  if (themeSelect) {
    // Defensivo: un valor antiguo o inválido cae al modo oscuro.
    themeSelect.value = VALID_THEMES.includes(settings.theme) ? settings.theme : "dark";
  }

  // Idioma (ADR-110): el select refleja el idioma activo.
  const langSelect = document.getElementById("settings-lang-select");
  if (langSelect) langSelect.value = getLang();

  // Mientras haya una sincronización en curso, el botón de sincronizar
  // permanece deshabilitado (también lo cubre el flag durante el clic).
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

  // El toggle de notificaciones en el dispositivo requiere soporte de
  // la API y un permiso no denegado; si el permiso está denegado se
  // muestra desmarcado y deshabilitado (la preferencia guardada se
  // conserva: si el usuario re-permite en el navegador, el toggle
  // vuelve a aparecer marcado al abrir Ajustes).
  const devEl = document.getElementById("notif-device");
  if (devEl) {
    const permission = isNotificationSupported() ? getPermission() : "denied";
    if (permission === "denied") {
      devEl.checked = false;
    }
    devEl.disabled = permission === "denied";
  }

  // Card «Secciones y pestañas»: render dinámico desde el registro.
  renderSectionsCard(settings);

  // Card «Integración de Steam» (ADR-107).
  renderSteamCard(settings);
}

// ---- Card «Secciones y pestañas» (issue #97) ----

// Render de la card desde el registro: una fila por sección (con sus
// pestañas anidadas en un .settings-group). Los ids son literales
// controlados por este módulo (sin datos de usuario).
function renderSectionsCard(settings) {
  const container = document.getElementById("sections-visibility-list");
  if (container) container.innerHTML = buildSectionsHTML(settings);
}

function buildSectionsHTML(settings) {
  const visibleSectionIds = Object.keys(SECTION_REGISTRY).filter((id) => settings.visibleSections[id] !== false);
  // Si solo queda una sección visible, su switch se deshabilita: se
  // mantiene siempre al menos una sección a la vista.
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
          // La última pestaña visible de la sección no se puede
          // ocultar: se mantiene siempre al menos una a la vista.
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
    // Persistencia del steamId con el mismo patrón del tema.
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
  // Recargar resultados: si el grupo ya está en memoria se repinta
  // limpio (los juegos nuevos los trae el botón de buscar).
  clearSteamResults();
}

function clearSteamResults() {
  const box = document.getElementById("steam-results");
  if (box) {
    box.innerHTML = "";
    box.classList.add("hidden");
  }
}

// Lista de resultados de Steam dentro de la card: nombre, horas
// jugadas, día del último juego y botón de alta en el registro.
// (Sin portada: la app no descarga assets de Steam; el alta es un
// ítem manual.)
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
      // Duplicados: los juegos ya añadidos desde Steam.
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
      // Conectar altos:
      wireSteamAddButtons(ctx, result.games);
    } catch (err) {
      ctx.showToast("No se pudo consultar Steam: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

// Alta de un juego de Steam en el registro: ítem manual con UNA
// sesión de juego con las horas de Steam (suman a la estadística de
// "horas jugadas" del perfil; la fecha es la del último juego o hoy).
// La sesión lleva source: "steam" para que la pasada diaria la
// reconozca y refresque sus horas. Exportado para tests.
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

// Botón "Comprobar estrenos" (issue #200): la pasada mínima A5-a
// ya no cura metadatos, solo revisa estrenos/episodios pendientes.
// Lanza syncNow (daily-check.js) con cooldown de 30 minutos y
// feedback vía toast. Restaura el botón en finally para que nunca
// quede bloqueado si algo falla.
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

  // Toggle de notificaciones en el dispositivo: wiring propio (fuera
  // del bucle genérico) porque al activarlo hay que pedir primero el
  // permiso al navegador. La primera instrucción del handler es el
  // requestPermission: así el gesto del usuario cuenta como
  // "user gesture" para la API.
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

// Callback de módulo inyectado por app.js vía
// setupSettings({ onVisibilityChange }): se invoca tras guardar un
// cambio de visibilidad para que la navegación se refresque
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

// Wiring del select de idioma (ADR-110): persiste y reaplica la traducción
// a TODO el document (incluye partials de Ocio ya cargados). Toast en el
// idioma destino.
function wireLangSelect(ctx) {
  const select = document.getElementById("settings-lang-select");
  if (!select) return;
  select.addEventListener("change", () => {
    const lang = setLang(select.value);
    select.value = getLang();
    ctx?.showToast?.(lang === "en" ? "Language set to English." : "Idioma cambiado a Español.");
  });
}

// Contexto de la app capturado en setupSettings: lo usan setUnit y
// setTheme para sincronizar con Firestore (patrón de scheduleFirestoreSync).
let appCtx = null;
// Contexto para la card de Steam (tokens/toast) — vuelve a null al
// desuscribirse (mismo ciclo de vida).
let ctxForSteam = null;

// Guarda el SteamID vinculado (localStorage) — lo usan el flujo de
// vinculación OpenID y el ajuste manual. Devuelve el settings guardado.
export function saveSteamId(steamId) {
  const s = loadSettings();
  s.steamId = sanitizeSteamId(steamId);
  saveSettings(s);
  return s;
}

/**
 * Procesa un retorno del login de Steam (#/steam-callback?...):
 * guarda el steamid vinculado o informa del error. Lo llama app.js
 * en el arranque ANTES del enrutamiento; devuelve true si el hash
 * era de este flujo (la app debe ignorarlo y re-establecer el hash
 * limpio).
 * @param {string} hash - location.hash actual.
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

// ---- Unidad de peso de Gimnasio (issue #62) ----

// Unidad de peso activa ("kg" | "lbs"), leída SIEMPRE fresco desde
// localStorage (patrón de los helpers de visibilidad). Lo usa gym.js
// en cada render: los valores guardados en Firestore no cambian al
// alternar, solo la presentación.
export function getUnit() {
  return loadSettings().unidadPeso === "lbs" ? "lbs" : "kg";
}

// Cambia la unidad de peso y la persiste (localStorage + sync a
// Firestore preferences con el mismo debounce que el resto de
// ajustes). Lo llama el select #gym-unit-select al cambiar.
export function setUnit(unit) {
  if (unit !== "kg" && unit !== "lbs") return;
  const s = loadSettings();
  s.unidadPeso = unit;
  saveSettings(s);
  if (appCtx) scheduleFirestoreSync(appCtx);
}

// Toggles de visibilidad de la card «Secciones y pestañas» (issue
// #97). La delegación de `change` vive en el contenedor (los checks
// se re-renderizan tras cada cambio; el listener se registra UNA vez,
// aquí, porque el contenedor nunca se reconstruye).
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
      // Defensa en profundidad: nunca puede quedar 0 secciones visibles.
      const visibleCount = Object.keys(SECTION_REGISTRY).filter((id) => settings.visibleSections[id] !== false).length;
      if (visibleCount === 0) {
        input.checked = true;
        return;
      }
    } else {
      settings.visibleTabs[componentKey] = input.checked;
      // Defensa en profundidad: nunca puede quedar 0 pestañas visibles
      // en la sección afectada.
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
    // Refrescar guardas y avisos: tras el cambio puede quedar otra
    // fila como última visible (y quedar deshabilitada).
    // El input en foco se reemplaza por el re-render: restaurar el
    // foco al equivalente re-renderizado (los ids son deterministas:
    // section-visible-<id> / tab-visible-<sección>-<pestaña>).
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
 * Sincroniza el tema en la clave de localStorage de ajustes
 * cuando se cambia desde el toggle del header, para mantener
 * ambas claves consistentes.
 */
export function syncThemeToSettings(theme) {
  const s = loadSettings();
  s.theme = theme;
  saveSettings(s);
}

/**
 * Devuelve las preferencias de notificación actuales (síncrono,
 * desde localStorage). Lo usa daily-check.js para saber qué
 * notificaciones crear.
 */
export function getNotificationPrefs() {
  const settings = loadSettings();
  return settings.notifications || {};
}

// ---- Visibilidad de secciones y pestañas (issue #97) ----
// Los helpers leen loadSettings() fresco en cada llamada (nunca
// mutan) para que reflejen siempre el estado guardado. Los usa
// sidebar.js (vía inyección), app.js y profile.js.

// ¿Está visible la sección? También devuelve false si el id no
// existe en el registro (sección futura retirada).
export function isSectionVisible(sectionId) {
  if (!SECTION_REGISTRY[sectionId]) return false;
  return loadSettings().visibleSections[sectionId] !== false;
}

// Ids de las secciones visibles, en el orden del registro (el orden
// de la barra lateral y de la «primera visible»).
export function getVisibleSectionIds() {
  return Object.keys(SECTION_REGISTRY).filter((id) => loadSettings().visibleSections[id] !== false);
}

// Número entero de secciones visibles (lo usa sidebar.js para
// decidir entre barra lateral ☰ y botón de Ajustes).
export function countVisibleSections() {
  return getVisibleSectionIds().length;
}

// ¿Está visible la pestaña (clave global, p. ej. "series")?
export function isTabVisible(tabKey) {
  return loadSettings().visibleTabs[tabKey] !== false;
}

// Primera clave visible de las pestañas de una sección, según el
// registro; null si ninguna.
export function getFirstVisibleTabKey(sectionId) {
  const section = SECTION_REGISTRY[sectionId];
  if (!section) return null;
  const settings = loadSettings();
  const key = Object.keys(section.tabs).find((k) => settings.visibleTabs[k] !== false);
  return key || null;
}

// panelId de la primera clave visible de la sección (o null).
export function getFirstVisibleTabPanel(sectionId) {
  const key = getFirstVisibleTabKey(sectionId);
  const section = SECTION_REGISTRY[sectionId];
  return key && section ? section.tabs[key].panelId : null;
}

// Normaliza una clave de pestaña: la devuelve si es conocida y
// visible; si no, la primera visible de la sección. Lo usan los
// flujos que navegan a una pestaña (entrada «Ocio», volver del
// perfil) para que nunca aterricen en una oculta.
export function normalizeTabKey(sectionId, key) {
  const section = SECTION_REGISTRY[sectionId];
  const settings = loadSettings();
  if (section && section.tabs[key] && settings.visibleTabs[key] !== false) return key;
  return getFirstVisibleTabKey(sectionId);
}
