// =============================================================
// Hash router of the application (issue #59).
// It gives each view its own, shareable URL that works the same
// deployed at the root as in per-branch subdirectories
// (_site/dev/<branch>/), because it only looks at the fragment
// (location.hash) and never at location.pathname.
//
// Two big «sections» of the site:
//   - Ocio: the four library tabs
//     (#/ocio/series, #/ocio/peliculas, #/ocio/libros,
//     #/ocio/videojuegos).
//   - Perfil: Estadísticas, Amigos (id per friend), Actividad and
//     Ajustes (#/perfil/...). The old «datos» token survives
//     as an alias of Ajustes (issue #135).
//   - Recetas (issue #64): Recetas, Menú and Lista de la compra
//     (#/recetas, #/recetas/menu, #/recetas/compra).
//   - Gimnasio (issue #62): Resumen, Entrenos and Ejercicios
//     (#/gimnasio, #/gimnasio/resumen).
//
// Besides the per-section memories (lastOcioKey, lastRecipesTab,
// lastGymTab), the router stores the last visited top-level
// section (lastSection, issue #213): it is what the back arrow of
// the profile uses to return to Ocio, Recetas or Gimnasio depending
// on where the user came from, not always to Ocio.
//
// The remaining hashes (e.g. #main-content from the skip-link) are
// considered foreign to the router and ignored without touching
// state.
// =============================================================

// Map Ocio route key → panel id in index.html. It is the
// single source of truth: adding a future tab only requires
// one entry here.
export const KEY_TO_PANEL = {
  series: "panel-tv",
  peliculas: "panel-movies",
  libros: "panel-books",
  videojuegos: "panel-games",
  compras: "panel-wishlist",
};

// Default Ocio route: the first tab (Series).
export const DEFAULT_KEY = "series";

// Map of Recetas route token → panel id in index.html.
export const RECIPES_TAB_TO_PANEL = {
  recetas: "panel-recipes-tab",
  ingredientes: "panel-ingredients-tab",
  menu: "panel-menu-tab",
  compra: "panel-shopping-tab",
};

// Default Recetas tab (#/recetas).
export const RECIPES_DEFAULT_TAB = "recetas";

// Map of Gimnasio route token → panel id in index.html
// (issue #62; #/gimnasio/resumen added in #269). Only the first
// tab «Resumen» (default) is canonicalized without a segment:
// #/gimnasio.
export const GYM_TAB_TO_PANEL = {
  resumen: "panel-gym-summary-tab",
  entrenos: "panel-gym-workouts-tab",
  ejercicios: "panel-gym-exercises-tab",
};

// Default Gimnasio tab (#/gimnasio): the first one (Resumen).
export const GYM_DEFAULT_TAB = "resumen";

// Prefixes of the top-level sections. Anything that does not
// start with one of them is considered foreign to the router.
const ROUTE_PREFIX = "/ocio";
const PROFILE_PREFIX = "/perfil";
const RECIPES_PREFIX = "/recetas";
const GYM_PREFIX = "/gimnasio";

// Map of URL token (Spanish) → internal id of the profile section.
// The public token is human and consistent with the Ocio keys; the
// internal id feeds js/profile.js.
const PROFILE_KEY_TO_SECTION = {
  estadisticas: "stats",
  // Legacy (issue #135): the «Datos» tab was unified into Ajustes,
  // but #/perfil/datos keeps working as an alias and opens Ajustes.
  // DO NOT reorder: the inverse (Object.fromEntries) lets the last
  // key win, and «ajustes» must come after «datos» so that the
  // canonical stays #/perfil/ajustes.
  datos: "settings",
  ajustes: "settings",
};

// Inverse of the previous map: internal id → URL token.
const PROFILE_SECTION_TO_KEY = Object.fromEntries(
  Object.entries(PROFILE_KEY_TO_SECTION).map(([k, v]) => [v, k])
);

// Default profile section (Estadísticas) for its aliases.
const PROFILE_DEFAULT_KEY = "estadisticas";

// Returns the Ocio route key for a panel id, or null if there is
// none (unknown data-human).
export function keyForPanel(panelId) {
  const entry = Object.entries(KEY_TO_PANEL).find(([, id]) => id === panelId);
  return entry ? entry[0] : null;
}

// Canonical Ocio hash for a key: #/ocio/<key>. If the key
// is not valid, we sanitize to the default key.
export function hashForKey(key = DEFAULT_KEY) {
  return `#${ROUTE_PREFIX}/${KEY_TO_PANEL[key] ? key : DEFAULT_KEY}`;
}

// Canonical Ocio hash for a panel id (e.g. "panel-movies").
export function hashForPanel(panelId) {
  return hashForKey(keyForPanel(panelId) || DEFAULT_KEY);
}

// Canonical Recetas hash for a tab: #/recetas/<tab>. If the
// tab is not valid, we sanitize to the default tab.
export function recipesHashFor(tab = RECIPES_DEFAULT_TAB) {
  const safe = RECIPES_TAB_TO_PANEL[tab] ? tab : RECIPES_DEFAULT_TAB;
  // The default tab is canonicalized as #/recetas (no segment).
  return safe === RECIPES_DEFAULT_TAB ? `#${RECIPES_PREFIX}` : `#${RECIPES_PREFIX}/${safe}`;
}

// Canonical Gimnasio hash for a tab: #/gimnasio/<tab>. If the
// tab is not valid, we sanitize to the default tab.
export function gymHashFor(tab = GYM_DEFAULT_TAB) {
  const safe = GYM_TAB_TO_PANEL[tab] ? tab : GYM_DEFAULT_TAB;
  // The default tab is canonicalized as #/gimnasio (no segment).
  return safe === GYM_DEFAULT_TAB ? `#${GYM_PREFIX}` : `#${GYM_PREFIX}/${safe}`;
}

// Canonical Perfil hash for a section (internal id). An unknown
// id falls back to the default section (Estadísticas).
export function profileHashKey(profileSection) {
  const token = PROFILE_SECTION_TO_KEY[profileSection] || PROFILE_DEFAULT_KEY;
  return `#${PROFILE_PREFIX}/${token}`;
}

// Interprets a fragment (location.hash by default). Contract:
// - Ocio    → { section:"ocio", key, panelId } (+ default/invalid).
// - Perfil  → { section:"perfil", profileSection, uid? } (+default/invalid).
// - Recetas → { section:"recetas", tab, panelId } (+ default/invalid).
// - Gimnasio→ { section:"gimnasio", tab, panelId } (+ default/invalid).
// - Empty   → global default route (Ocio Series).
// - Foreign → { section:null } (ignored at runtime).
export function parseHash(hash = location.hash) {
  const fragment = (hash || "").replace(/^#/, "");

  // Without hash, "#" or "#/": fall back to the global default state.
  if (fragment === "" || fragment === "/") {
    return { section: "ocio", key: DEFAULT_KEY, panelId: KEY_TO_PANEL[DEFAULT_KEY], default: true };
  }

  const segments = fragment.split("/").filter(Boolean);
  const first = segments[0];

  // Hashes foreign to the sections: they are not site routes.
  if (first !== "ocio" && first !== "perfil" && first !== "recetas" && first !== "gimnasio") {
    return { section: null };
  }

  // ---------- RECETAS ----------
  // #/recetas and #/recetas/ are aliases of the first tab.
  if (first === "recetas") {
    if (segments.length === 1) {
      return { section: "recetas", tab: RECIPES_DEFAULT_TAB, panelId: RECIPES_TAB_TO_PANEL[RECIPES_DEFAULT_TAB], default: true };
    }
    // #/recetas/<tab>: only known tabs are valid.
    if (segments.length === 2 && RECIPES_TAB_TO_PANEL[segments[1]]) {
      if (segments[1] === RECIPES_DEFAULT_TAB) {
        // #/recetas/recetas is not canonical: it is normalized to #/recetas.
        return { section: "recetas", tab: RECIPES_DEFAULT_TAB, panelId: RECIPES_TAB_TO_PANEL[RECIPES_DEFAULT_TAB], default: true, invalid: true };
      }
      return { section: "recetas", tab: segments[1], panelId: RECIPES_TAB_TO_PANEL[segments[1]] };
    }
    // Inside the prefix but with an unknown segment (or too many).
    return { section: "recetas", tab: RECIPES_DEFAULT_TAB, panelId: RECIPES_TAB_TO_PANEL[RECIPES_DEFAULT_TAB], default: true, invalid: true };
  }

  // ---------- GIMNASIO ----------
  // #/gimnasio and #/gimnasio/ are aliases of the first tab.
  if (first === "gimnasio") {
    if (segments.length === 1) {
      return { section: "gimnasio", tab: GYM_DEFAULT_TAB, panelId: GYM_TAB_TO_PANEL[GYM_DEFAULT_TAB], default: true };
    }
    // #/gimnasio/<tab>: only known tabs are valid.
    if (segments.length === 2 && GYM_TAB_TO_PANEL[segments[1]]) {
      if (segments[1] === GYM_DEFAULT_TAB) {
        // #/gimnasio/resumen is not canonical: it is normalized to #/gimnasio.
        return { section: "gimnasio", tab: GYM_DEFAULT_TAB, panelId: GYM_TAB_TO_PANEL[GYM_DEFAULT_TAB], default: true, invalid: true };
      }
      return { section: "gimnasio", tab: segments[1], panelId: GYM_TAB_TO_PANEL[segments[1]] };
    }
    // Inside the prefix but with an unknown segment (or too many).
    return { section: "gimnasio", tab: GYM_DEFAULT_TAB, panelId: GYM_TAB_TO_PANEL[GYM_DEFAULT_TAB], default: true, invalid: true };
  }

  // ---------- PERFIL ----------
  if (first === "perfil") {
    // #/perfil and #/perfil/ are aliases of Estadísticas.
    if (segments.length === 1) {
      return { section: "perfil", profileSection: "stats", default: true };
    }
    const profileSection = PROFILE_KEY_TO_SECTION[segments[1]];
    // Unknown section token or too many segments → sanitized to
    // the default section.
    if (!profileSection || segments.length > 2) {
      return { section: "perfil", profileSection: "stats", default: true, invalid: true };
    }
    return { section: "perfil", profileSection };
  }

  // ---------- OCIO ----------
  // #/ocio and #/ocio/ are aliases of the first tab.
  if (segments.length === 1) {
    return { section: "ocio", key: DEFAULT_KEY, panelId: KEY_TO_PANEL[DEFAULT_KEY], default: true };
  }
  // #/ocio/<key>: only the four known keys are valid.
  if (segments.length === 2 && KEY_TO_PANEL[segments[1]]) {
    return { section: "ocio", key: segments[1], panelId: KEY_TO_PANEL[segments[1]] };
  }
  // Inside the prefix but with an unknown segment (or too many).
  return { section: "ocio", key: DEFAULT_KEY, panelId: KEY_TO_PANEL[DEFAULT_KEY], default: true, invalid: true };
}

// Canonical hash for a route (ocio, perfil, recetas or gimnasio)
// based on its shape. Used by navigate() to normalize.
function canonicalHashFor(route) {
  if (route?.section === "perfil") {
    return profileHashKey(route.profileSection, route.uid);
  }
  if (route?.section === "recetas") {
    return recipesHashFor(route.tab);
  }
  if (route?.section === "gimnasio") {
    return gymHashFor(route.tab);
  }
  return hashForKey(route?.key || DEFAULT_KEY);
}

// Memory of the last Ocio key of the session: «Volver» from the
// profile and the «Ocio» sidebar entry go back to that tab.
let lastOcioKey = DEFAULT_KEY;

export function getLastOcioKey() {
  return lastOcioKey || DEFAULT_KEY;
}

// Memory of the last Recetas tab of the session: the «Recetas»
// sidebar entry goes back to that tab (issue #64).
let lastRecipesTab = RECIPES_DEFAULT_TAB;

export function getLastRecipesTab() {
  return RECIPES_TAB_TO_PANEL[lastRecipesTab] ? lastRecipesTab : RECIPES_DEFAULT_TAB;
}

// Memory of the last Gimnasio tab of the session: the «Gimnasio»
// sidebar entry goes back to that tab (issue #62).
let lastGymTab = GYM_DEFAULT_TAB;

export function getLastGymTab() {
  return GYM_TAB_TO_PANEL[lastGymTab] ? lastGymTab : GYM_DEFAULT_TAB;
}

// Memory of the last top-level section (ocio | recetas |
// gimnasio) of the session: the profile's back arrow returns to
// that section (issue #213). Profile routes deliberately do NOT
// update it: only content sections leave a trace when entering the
// profile.
let lastSection = "ocio";

export function getLastSection() {
  return lastSection || "ocio";
}

// Changes to the hash of a target. target can be:
//   - string: Ocio key (backwards compatibility, "series").
//   - object { section:"perfil", profileSection, uid? } (or Ocio's).
// With replace:true it replaces the current history entry
// (normalization of non-canonical URLs) instead of adding one. If
// the hash is already the target, it does nothing (avoids a
// redundant hashchange).
export function navigate(routeOrKey, { replace = false } = {}) {
  const target = canonicalHashFor(
    typeof routeOrKey === "string" ? { key: routeOrKey } : routeOrKey
  );
  if (location.hash === target) return;
  if (replace) {
    history.replaceState(null, "", target);
  } else {
    location.hash = target;
  }
}

// Starts the router: applies the hash of the initial load, registers
// the hashchange listener (back/forward and navigation) and returns
// the API. onRoute receives the interpreted route (see parseHash).
export function initRouter({ onRoute }) {
  // Applies a route: normalizes with replaceState if non-canonical
  // and notifies the consumer (who decides how to paint). Without
  // arguments it re-reads location.hash (e.g. after login, to resume
  // the profile route requested by the reload).
  function applyRoute(route = parseHash()) {
    if (!route?.section) return; // foreign: do not touch state
    if (route.section === "ocio") {
      lastSection = "ocio";
      lastOcioKey = route.key || DEFAULT_KEY;
    } else if (route.section === "recetas") {
      lastSection = "recetas";
      lastRecipesTab = route.tab || RECIPES_DEFAULT_TAB;
    } else if (route.section === "gimnasio") {
      lastSection = "gimnasio";
      lastGymTab = route.tab || GYM_DEFAULT_TAB;
    }
    if (route.default || route.invalid) {
      history.replaceState(null, "", canonicalHashFor(route));
    }
    onRoute(route);
  }

  // Initial load: the URL hash decides the first state.
  applyRoute(parseHash());

  // Runtime: back/forward and the user's manual navigation.
  const handleHashChange = () => applyRoute(parseHash());

  window.addEventListener("hashchange", handleHashChange);

  return {
    // Current Ocio key (or the default one if the hash is foreign).
    getCurrentKey: () => {
      const s = parseHash();
      return s.section === "ocio" || !s.section ? (s.key || lastOcioKey || DEFAULT_KEY) : lastOcioKey;
    },
    // Top-level section of the current route: "ocio" | "perfil" |
    // "recetas" | "gimnasio" | null (foreign / not applicable).
    // Foreign hashes return null.
    getCurrentSection: () => {
      const s = parseHash();
      return s.section === null ? null : s.section;
    },
    // Re-syncs the state with the URL hash (e.g. after login, to
    // open the profile route requested by the reload).
    applyRoute,
    parseHash,
    hashForKey,
    hashForPanel,
    keyForPanel,
    profileHashKey,
    recipesHashFor,
    gymHashFor,
    getLastOcioKey,
    getLastRecipesTab,
    getLastGymTab,
    getLastSection,
    navigate,
    destroy: () => window.removeEventListener("hashchange", handleHashChange),
  };
}