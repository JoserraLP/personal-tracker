// =============================================================
// i18n — idioma switchable Español/English (ADR-110).
//
// Modelo: el español es la FUENTE DE VERDAD (marcados estáticos y
// strings dinámicos de la app se escriben siempre en español) y el
// inglés es un diccionario de TRADUCCIÓN APLICADA AL DOM:
//   - Nodos de texto: coincidencia exacta normalizada (espacios
//     colapsados) contra el diccionario. Si el texto ya está en
//     inglés no está en el dict y no se toca (sin bucles).
//   - Atributos translate: placeholder, aria-label y title.
// Aplicación:
//   1. Al arrancar (initializeI18n): traduce el document completo
//      y observa mutaciones (los renders dinámicos que reescriben
//      español se traducen en el acto).
//   2. Al cambiar de idioma: reaplica sobre todo el document.
// Persistencia: localStorage "mi-registro-lang" (independiente del
// usuario para permitir elegir idioma en la pantalla de acceso).
// Cobertura v1: toda la marqueta estática + etiquetas centrales de
// estado. Los mensajes dinámicos de toasts/errores siguen en
// español hasta la siguiente iteración (documentado en ADR-110).
// =============================================================

const LANG_KEY = "mi-registro-lang";
const SUPPORTED = { es: "Español", en: "English" };

// -------------------------------------------------------------
// Diccionario: texto visible EXACTO (español) → texto EN.
// La clave se normaliza (espacios colapsados + trim) al aplicar.
// -------------------------------------------------------------
const EN_TEXT = {
  // Marca / acceso
  "Mi Registro — pelis, series, libros, videojuegos, recetas y gimnasio":
    "Mi Registro — movies, TV shows, books, video games, recipes and gym",
  "Saltar al contenido principal": "Skip to main content",
  "Ficha de socio": "Member card",
  "Un cuaderno privado para lo que ves y lo que lees.":
    "A private notebook for what you watch and read.",
  "Entrar con Google": "Sign in with Google",
  "Cargando…": "Loading…",
  "Cargando.": "Loading.",

  // Navegación y perfil
  "Notificaciones": "Notifications",
  "Borrar todas": "Clear all",
  "No tienes notificaciones.": "You have no notifications.",
  "Estadísticas": "Statistics",
  "Ajustes": "Settings",
  "Cerrar sesión": "Sign out",

  // Pestañas y paneles
  "Series": "TV Shows",
  "Películas": "Movies",
  "Libros": "Books",
  "Videojuegos": "Video Games",
  "Compras": "Shopping",

  // Estados (chips, filtros y etiquetas de estado de ui.js/constants.js)
  "Todos": "All",
  "Todas": "All",
  "Pendiente": "Pending",
  "Pendientes": "Pending",
  "En curso": "In progress",
  "Viendo": "Watching",
  "Leyendo": "Reading",
  "Jugando": "Playing",
  "Completado": "Completed",
  "Completados": "Completed",
  "Vista": "Watched",
  "Vistas": "Watched",
  "Leído": "Read",
  "Leídos": "Read",
  "Jugado": "Played",
  "Jugados": "Played",
  "Standby": "Standby",
  "Abandonada": "Abandoned",
  "Abandonado": "Abandoned",
  "Abandonadas": "Abandoned",
  "Abandonados": "Abandoned",

  // Orden/filtros de biblioteca
  "Actividad reciente": "Recent activity",
  "Fecha de visionado": "Watch date",
  "Fecha de lectura": "Reading date",
  "Fecha de juego": "Play date",
  "Alfabético": "Alphabetical",
  "Año de estreno": "Release year",
  "Año de publicación": "Publication year",
  "Año de lanzamiento": "Release year",

  // Estados vacíos
  "Aún no hay nada aquí. Busca una serie arriba y pulsa «Añadir».":
    "Nothing here yet. Search for a show above and press «Add».",
  "Aún no hay nada aquí. Busca un título arriba y pulsa «Añadir».":
    "Nothing here yet. Search for a title above and press «Add».",
  "Tu biblioteca está vacía. Busca un libro arriba y pulsa «Añadir».":
    "Your library is empty. Search for a book above and press «Add».",
  "Tu biblioteca está vacía. Busca un videojuego arriba y pulsa «Añadir».":
    "Your library is empty. Search for a video game above and press «Add».",
  "Tu lista de cosas que comprar está vacía. Pulsa «Añadir cosa» para registrar la primera.":
    "Your shopping list is empty. Press «Add item» to register the first one.",

  // Compras
  "Por comprar": "To buy",
  "Compradas": "Bought",
  "Añadir cosa": "Add item",

  // Estadísticas
  "Siempre": "All time",
  "Este año": "This year",
  "Este mes": "This month",
  "Rango personalizado…": "Custom range…",
  "Desde": "From",
  "Hasta": "To",
  "Actividad por mes": "Activity by month",
  "Estados actuales": "Current statuses",
  "Géneros": "Genres",
  "Plataformas": "Platforms",

  // Ajustes
  "Apariencia": "Appearance",
  "Tema": "Theme",
  "Idioma": "Language",
  "Oscuro": "Dark",
  "Negro puro": "True black",
  "Claro": "Light",
  "Blanco puro": "Pure white",
  "Español": "Español",
  "English": "English",
  "Secciones y pestañas": "Sections and tabs",
  "Elige qué secciones y pestañas quieres ver. Ocultar algo no borra tus datos: solo lo quita de la vista.":
    "Choose which sections and tabs you want to see. Hiding something does not delete your data: it only removes it from the view.",
  "Controla qué tipo de notificaciones quieres recibir.":
    "Choose which kinds of notifications you want to receive.",
  "Estrenos de películas": "Movie releases",
  "Nuevos episodios de series": "New TV episodes",
  "Estrenos de series": "TV premieres",
  "Estrenos de videojuegos": "Video game releases",
  "Notificaciones en el dispositivo": "Device notifications",
  "Avisos del sistema cuando la web no está en primer plano.":
    "System alerts when the web app is not in the foreground.",
  "Sincronización de datos": "Data sync",
  "Comprueba en el momento si algo se ha estrenado o ha salido un episodio nuevo (lo que la web revisa sola cada día).":
    "Check right away if anything premiered or a new episode came out (what the web checks on its own every day).",
  "Comprobar estrenos": "Check for releases",
  "Integración de Steam": "Steam integration",
  "SteamID64": "SteamID64",
  "Se rellena solo al vincular por inicio de sesión; también puedes pegarlo a mano (17 dígitos).":
    "Filled in automatically when you link by sign-in; you can also paste it manually (17 digits).",
  "Vincular mi cuenta de Steam": "Link my Steam account",
  "Buscar mis juegos de Steam": "Find my Steam games",
  "Los juegos de Steam con horas se añaden al registro como ítems manuales, con una sesión de juego que agrupa las horas.":
    "Steam games with playtime are added to the registry as manual items, with a single play session grouping the hours.",
  "Datos": "Data",
  "Exporta o importa tu copia de seguridad y descarga el calendario de estrenos.":
    "Export or import your backup and download the release calendar.",
  "Descarga una copia de seguridad completa de todos tus datos (películas, series, libros, perfil y notificaciones) en formato JSON.":
    "Download a complete JSON backup of all your data (movies, shows, books, profile and notifications).",
  "Exportar copia de seguridad": "Export backup",
  "Restaura datos desde un archivo JSON previamente exportado. Los elementos se añadirán a los existentes (no los reemplaza).":
    "Restore data from a previously exported JSON file. Items are added to the existing ones (not replaced).",
  "Importar copia de seguridad": "Import backup",
  "Descarga un archivo .ics con los próximos episodios de tus series, los estrenos de películas pendientes y los lanzamientos de tus videojuegos, para importarlo en Google Calendar, Apple Calendar u otras aplicaciones.":
    "Download an .ics file with upcoming episodes of your shows, pending movie releases and video game launches, to import into Google Calendar, Apple Calendar or other apps.",
  "Exportar calendario (.ics)": "Export calendar (.ics)",
  "Importa tu historial completo de series desde el fichero JSON que exportas en la aplicación de TV Time. Se añadirán como series manuales, sin conexión a TMDB.":
    "Import your whole TV history from the JSON file you export in the TV Time app. They are added as manual shows, without a TMDB connection.",
  "Importar desde TV Time": "Import from TV Time",

  // Recetas
  "Recetas": "Recipes",
  "Ingredientes": "Ingredients",
  "Menú": "Menu",
  "Compra": "Groceries",
  "+ Nueva receta": "+ New recipe",
  "+ Nuevo ingrediente": "+ New ingredient",
  "Todas las categorías": "All categories",
  "Todos los alérgenos": "All allergens",
  "Todos los tipos": "All types",
  "Menú semanal": "Weekly menu",
  "Comensales": "Diners",
  "Borrar semana": "Clear week",
  "+ Añadir receta": "+ Add recipe",
  "Recetas a la semana": "Recipes for the week",
  "Se añaden una vez y NO se multiplican por los comensales (p. ej. una masa de pizza para toda la semana). Añádelas con «+ Añadir receta» eligiendo «Toda la semana».":
    "They are added once and are NOT multiplied by the diners (e.g. one pizza dough for the whole week). Add them with «+ Add recipe» choosing «Whole week».",
  "+ Ítem extra": "+ Extra item",

  // Gimnasio
  "Resumen": "Summary",
  "Entrenos": "Workouts",
  "Ejercicios": "Exercises",
  "Unidad de peso": "Weight unit",
  "Semana en curso": "Current week",
  "Mes en curso": "Current month",
  "Rango": "Range",
  "Desde – Hasta": "From – To",
  "Borrar": "Delete",
  "Listo": "Done",
  "+ Nuevo entreno": "+ New workout",
  "+ Nuevo ejercicio": "+ New exercise",
  "Volver arriba": "Back to top",
};

const ATTR_PREFIX_RE = /^([@#%])([\s\S]+)$/;

// Diccionario de atributos (@placeholder, #aria-label, %title).
const EN_ATTR = {
  "@Buscar películas, series, libros o videojuegos...":
    "Search movies, shows, books or video games...",
  "#Cerrar menú": "Close menu",
  "#Abrir menú de navegación": "Open navigation menu",
  "#Abrir ajustes": "Open settings",
  "#Buscar en tu registro de ocio": "Search your entertainment log",
  "#Limpiar y cerrar la búsqueda": "Clear and close the search",
  "#Notificaciones": "Notifications",
  "#Abrir menú de perfil": "Open profile menu",
  "#Volver": "Back",
  "#Periodo de estadísticas": "Statistics period",
  "#Semana anterior": "Previous week",
  "#Semana siguiente": "Next week",
  "#Borrar el menú de esta semana": "Delete this week's menu",
  "#Semanas anteriores": "Previous weeks",
  "#Semanas siguientes": "Next weeks",
  "#Unidad de peso": "Weight unit",
  "#Mes anterior": "Previous month",
  "#Mes siguiente": "Next month",
  "#Cerrar": "Close",
  "#Volver arriba": "Back to top",
  "%Volver arriba": "Back to top",
  "#Vista en cuadrícula": "Grid view",
  "#Vista en lista": "List view",
};

// -------------------------------------------------------------
// Núcleo puro (testeable sin DOM)
// -------------------------------------------------------------

/** Normaliza una cadena para matching: colapsa espacios y trims. */
export function normalizeText(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** Índices normalizados de los diccionarios (se precompilan). */
const TEXT_INDEX = new Map();
for (const [es, en] of Object.entries(EN_TEXT)) {
  TEXT_INDEX.set(normalizeText(es), en);
}
const ATTR_INDEX = new Map();
for (const [key, en] of Object.entries(EN_ATTR)) {
  const norm = ATTR_PREFIX_RE.exec(key);
  if (!norm) continue;
  ATTR_INDEX.set(`${norm[1]}|${normalizeText(norm[2])}`, en);
}

/**
 * Traduce un valor de nodo de texto (o null si no hay traducción).
 * Función pura para los tests.
 */
export function translateText(raw, lang = "en") {
  if (lang !== "en") return null;
  return TEXT_INDEX.get(normalizeText(raw)) || null;
}

// Prefijo de diccionario por atributo translate.
const ATTR_FOR = { placeholder: "@", "aria-label": "#", title: "%" };

/**
 * Traduce un par (attr, valor) o null. attr: "placeholder" |
 * "aria-label" | "title".
 */
export function translateAttr(attr, raw, lang = "en") {
  if (lang !== "en") return null;
  const prefix = ATTR_FOR[attr];
  if (!prefix) return null;
  return ATTR_INDEX.get(`${prefix}|${normalizeText(raw)}`) || null;
}

// -------------------------------------------------------------
// Aplicación al DOM
// -------------------------------------------------------------

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "SVG", "NOSVG", "CODE"]);

/** Aplica el idioma activo a un subárbol (por defecto todo el doc). */
export function applyI18n(root = document, lang = getLang()) {
  if (!root || typeof document === "undefined" || lang === "es") return false;
  let changed = false;

  // Nodos de texto (TreeWalker por eficiencia).
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.closest("svg, script, style");
      return tag ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let textNode = walker.nextNode();
  while (textNode) {
    const t = translateText(textNode.nodeValue, lang);
    if (t) {
      textNode.nodeValue = t;
      changed = true;
    }
    textNode = walker.nextNode();
  }

  // Atributos translate: el subárbol y el propio root.
  const ATTR_SELECTOR = "[placeholder], [aria-label], [title]";
  let els = [];
  if (root.querySelector) {
    els = [...root.querySelectorAll(ATTR_SELECTOR)];
    if (root !== document && root.matches?.(ATTR_SELECTOR)) els.push(root);
  }
  for (const el of els) {
    for (const attr of ["placeholder", "aria-label", "title"]) {
      const val = el.getAttribute(attr);
      if (!val) continue;
      const t = translateAttr(attr, val, lang);
      if (t) {
        el.setAttribute(attr, t);
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Idioma activo: localStorage. Solo "es" | "en"; cualquier otro
 * valor cae a "es" (defensivo, mismo patrón que el tema).
 */
export function getLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return SUPPORTED[v] ? v : "es";
  } catch {
    return "es";
  }
}

/** Cambia el idioma (persistente) y lo aplica a todo el document. */
export function setLang(lang, root = document) {
  if (!SUPPORTED[lang]) return false;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* sin storage: se aplica igualmente en memoria */
  }
  applyI18n(root, lang);
  return true;
}

let observer = null;

/**
 * Arranca i18n: aplica el idioma guardado y observa mutaciones para
 * que los renders dinámicos (español, fuente de verdad) se traduzcan
 * en el acto si el usuario eligió English.
 */
export function initializeI18n() {
  if (typeof document === "undefined") return;
  applyI18n(document, getLang());
  if (getLang() !== "en" || observer) return;
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      // Nodos añadidos (subárbol) y nodos de texto reescritos.
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === Node.ELEMENT_NODE) applyI18n(n, "en");
          else if (n.nodeType === Node.TEXT_NODE) {
            const t = translateText(n.nodeValue, "en");
            if (t) n.nodeValue = t;
          }
        });
      } else if (m.type === "characterData") {
        const t = translateText(m.target.nodeValue, "en");
        if (t) m.target.nodeValue = t;
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

/** Como vite: detiene el observador (tests / logout). */
export function stopI18n() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}
