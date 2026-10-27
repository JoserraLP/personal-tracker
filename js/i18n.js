// =============================================================
// i18n — switchable Spanish/English language (ADR-110).
//
// Model: Spanish is the SOURCE OF TRUTH (the app's static markers and
// dynamic strings are always written in Spanish) and
// English is a dictionary of TRANSLATION APPLIED TO THE DOM:
//   - Text nodes: exact match normalized (collapsed spaces)
//     against the dictionary. If the text is already in
//     English it is not in the dict and is not touched (no loops).
//   - Translated attributes: placeholder, aria-label and title.
// Application:
//   1. On boot (initializeI18n): translates the whole document
//      and watches mutations (dynamic renders that rewrite
//      Spanish are translated on the spot).
//   2. On language change: re-applies over the whole document.
// Persistence: localStorage "mi-registro-lang" (independent of the
// user so the language can be chosen on the login screen).
// v1 coverage: all the static chrome + core status labels.
// Dynamic toast/error messages remain in
// Spanish until the next iteration (documented in ADR-110).
// =============================================================

const LANG_KEY = "mi-registro-lang";
const SUPPORTED = { es: "Español", en: "English" };

// -------------------------------------------------------------
// Dictionary: EXACT visible text (Spanish) → EN text.
// The key is normalized (collapsed spaces + trim) when applying.
// -------------------------------------------------------------
const EN_TEXT = {
  // Brand / login
  "Personal Tracker — pelis, series, libros, videojuegos, recetas y gimnasio":
    "Personal Tracker — movies, TV shows, books, video games, recipes and gym",
  "Saltar al contenido principal": "Skip to main content",
  "Ficha de socio": "Member card",
  "Un cuaderno privado para lo que ves y lo que lees.":
    "A private notebook for what you watch and read.",
  "Entrar con Google": "Sign in with Google",
  "Cargando…": "Loading…",
  "Cargando.": "Loading.",

  // Navigation and profile
  "Notificaciones": "Notifications",
  "Borrar todas": "Clear all",
  "No tienes notificaciones.": "You have no notifications.",
  "Estadísticas": "Statistics",
  "Ajustes": "Settings",
  "Cerrar sesión": "Sign out",

  // Tabs and panels
  "Series": "TV Shows",
  "Películas": "Movies",
  "Libros": "Books",
  "Videojuegos": "Video Games",
  "Compras": "Shopping",

  // Statuses (chips, filters and status labels of ui.js/constants.js)
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

  // Library sort/filters
  "Actividad reciente": "Recent activity",
  "Fecha de visionado": "Watch date",
  "Fecha de lectura": "Reading date",
  "Fecha de juego": "Play date",
  "Alfabético": "Alphabetical",
  "Año de estreno": "Release year",
  "Año de publicación": "Publication year",
  "Año de lanzamiento": "Release year",

  // Empty states
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

  // Shopping
  "Por comprar": "To buy",
  "Compradas": "Bought",
  "Añadir cosa": "Add item",

  // Statistics
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

  // Settings
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

  // Recipes
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

  // Gym
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

/* Dynamic UI strings — v2 (ADR-113): detail modals, toasts, gym,
   recipes and menu. Same rule: never translate the string literals
   of the app (source of truth), only extend this dictionary. */
const EN_TEXT_EXTRA = {
  "Vista ✓": "Watched ✓",
  "Completa ✓": "Completed ✓",
  "Terminar ✓": "Finish ✓",
  "Rejugar ↺": "Replay ↺",
  "Empezar ✓": "Start ✓",
  "Añadido ✓": "Added ✓",
  "Releer ↺": "Re-read ↺",
  "Película": "Movie",
  "Serie": "TV Show",
  "Videojuego": "Video game",
  "Libro": "Book",
  "Ver tráiler en YouTube": "Watch trailer on YouTube",
  "Ya añadido": "Already added",
  "En pausa": "On pause",
  "Impresiones...": "Thoughts...",
  "Streaming": "Streaming",
  "Alquiler": "Rental",
  "Marcar como vista": "Mark as watched",
  "¿Quitar este visionado del historial?": "Remove this watch from the history?",
  "Selecciona al menos una película.": "Select at least one movie.",
  "Horas": "Hours",
  "Horas jugadas": "Hours played",
  "Terminar de leer": "Finish reading",
  "Empezar a leer": "Start reading",
  "¿Quitar esta lectura del historial?": "Remove this reading from the history?",
  "Terminar partida": "Finish play session",
  "Empezar partida": "Start play session",
  "¿Quitar esta sesión del historial?": "Remove this session from the history?",
  "Desmarcar todo": "Uncheck all",
  "Marcar todo": "Check all",
  "¡Serie completada!": "Show completed!",
  "¡Película completada!": "Movie completed!",
  "¡Libro completado!": "Book completed!",
  "Borrar": "Delete",
  "Deshacer": "Undo",
  "Sin puntuaciones": "No ratings yet",
  "Vincula tu cuenta de Steam para traer tus juegos con las horas jugadas.": "Link your Steam account to bring your games with their playtime.",
  "Re-vincular con Steam": "Re-link with Steam",
  "Falta la URL del proxy de Steam (despliegue).": "Steam proxy URL missing (deployment).",
  "Añadir": "Add",
  "El SteamID debe tener 17 dígitos (SteamID64).": "SteamID must have 17 digits (SteamID64).",
  "Buscando…": "Searching…",
  "Steam no devolvió ningún juego.": "Steam returned no games.",
  "Añadiendo…": "Adding…",
  "Comprobando…": "Checking…",
  "Estrenos comprobados.": "Releases checked.",
  "Comprobación reciente, inténtalo en un rato.": "Checked recently, try again in a while.",
  "Ya hay una comprobación en curso.": "A check is already running.",
  "Permiso denegado. Actívalo en los ajustes del navegador.": "Permission denied. Enable it in your browser settings.",
  "No se pudo activar: permiso no concedido.": "Could not enable: permission not granted.",
  "No se pudo completar el inicio de sesión de Steam.": "Could not complete Steam sign-in.",
  "El título es obligatorio.": "Title is required.",
  "El precio debe ser un número mayor o igual que 0.": "Price must be a number greater than or equal to 0.",
  "La URL del producto no es válida.": "Product URL is not valid.",
  "La URL de la foto no es válida.": "Photo URL is not valid.",
  "No hay ninguna cosa con ese filtro.": "No items match this filter.",
  "Editar compra": "Edit item",
  "Añadir a la lista de compras": "Add to shopping list",
  "Actividad": "Activity",
  "Juegos": "Games",
  "Pecho": "Chest",
  "Espalda": "Back",
  "Hombros": "Shoulders",
  "Bíceps": "Biceps",
  "Tríceps": "Triceps",
  "Antebrazos": "Forearms",
  "Piernas": "Legs",
  "Glúteos": "Glutes",
  "Core": "Core",
  "Tráiler": "Trailer",
  "Sin imagen": "No image",
  "Cargando detalles…": "Loading details…",
  "Valoración": "Rating",
  "Media episodios: ": "Episode average: ",
  "Notas": "Notes",
  "Abandonar": "Abandon",
  "Retomar": "Resume",
  "Director:": "Director:",
  "Reparto:": "Cast:",
  "Metacritic:": "Metacritic:",
  "Duración media:": "Average length:",
  "Clasificación:": "Rated:",
  "Temporadas": "Seasons",
  "Secciones": "Sections",
  "Páginas:": "Pages:",
  "Título *": "Title *",
  "Autor": "Author",
  "Año": "Year",
  "Páginas": "Pages",
  "URL de portada (opcional)": "Cover URL (optional)",
  "Editar información": "Edit details",
  "Cancelar": "Cancel",
  "Guardar cambios": "Save changes",
  "Guardar": "Save",
  "Número de episodios": "Number of episodes",
  "Sin info. de streaming para este país": "No streaming info for this country",
  "Disponible en:": "Available on:",
  "Ver opciones en TMDB": "Watch options on TMDB",
  "Plataformas:": "Platforms:",
  "Ver información": "View details",
  "Si te gustó esto, quizá te guste...": "If you liked this, you might also like...",
  "Otras películas de la saga": "Other movies of the saga",
  "Aún no la has visto.": "You haven't watched it yet.",
  "Quitar": "Remove",
  "Saga:": "Saga:",
  "Visionados": "Watches",
  "Eliminar": "Delete",
  "Sesiones de juego": "Play sessions",
  "Historial de lecturas": "Reading history",
  "Historial de visionados": "Watch history",
  "Sesiones": "Sessions",
  "Nombre *": "Name *",
  "Categoría *": "Category *",
  "Porciones *": "Servings *",
  "Descripción": "Description",
  "Ingredientes de la receta": "Recipe ingredients",
  "Paso": "Step",
  "Pasos de la receta": "Recipe steps",
  "Ingredientes y pasos": "Ingredients and steps",
  "Leer más": "Read more",
  "Sinopsis": "Plot",
  "Notas y edición": "Notes and editing",
  "Etiquetas": "Tags",
  "Categoría": "Category",
  "Alérgenos": "Allergens",
  "Ver receta": "View recipe",
  "También está en el menú": "Also on the menu",

  "Cardio": "Cardio",
  "Cuerpo completo": "Full body",
  "Otro": "Other",
  "Entreno": "Workout",
  "Sin nombre": "Unnamed",
  "Nuevo entreno": "New workout",
  "Ejercicio": "Exercise",
  "Sin fecha": "No date",
  "Entreno eliminado.": "Workout deleted.",
  "Editar entreno": "Edit workout",
  "P. ej. Push day": "e.g. Push day",
  "Cómo fue el entreno, sensaciones, progreso…": "How the workout went, sensations, progress…",
  "Unidad de peso del entreno": "Workout weight unit",
  "Elige un ejercicio…": "Choose an exercise…",
  "Añade al menos un ejercicio con una serie (reps ≥ 1).": "Add at least one exercise with a set (reps ≥ 1).",
  "No hay ninguna serie que duplicar.": "There is no set to duplicate.",
  "Entreno actualizado.": "Workout updated.",
  "Entreno guardado.": "Workout saved.",
  "Nuevo ejercicio": "New exercise",
  "Sin notas.": "No notes.",
  "Ejercicio eliminado (los entrenos guardados conservan su nombre).": "Exercise deleted (saved workouts keep its name).",
  "Editar ejercicio": "Edit exercise",
  "P. ej. press banca": "e.g. bench press",
  "Grupo muscular del ejercicio": "Exercise muscle group",
  "Técnica, anotaciones, variantes…": "Technique, notes, variations…",
  "Ejercicio actualizado.": "Exercise updated.",
  "Ejercicio añadido al catálogo.": "Exercise added to the catalog.",
  "Importada desde una URL, pendiente de revisar": "Imported from a URL, pending review",
  "Receta eliminada.": "Recipe deleted.",
  "Cantidad": "Amount",
  "Unidad de la cantidad del paquete": "Package amount unit",
  "Nuevo ingrediente": "New ingredient",
  "Sin indicar": "Not specified",
  "Sin categoría": "No category",
  "P. ej. azúcar moreno": "e.g. brown sugar",
  "Categoría del nuevo ingrediente": "New ingredient category",
  "P. ej. 250": "e.g. 250",
  "Añadido a la lista de la compra.": "Added to the shopping list.",
  "Ingrediente eliminado del catálogo.": "Ingredient removed from the catalog.",
  "Ingrediente actualizado.": "Ingredient updated.",
  "Ese ingrediente ya existe en el catálogo.": "That ingredient already exists in the catalog.",
  "Ingrediente añadido al catálogo.": "Ingredient added to the catalog.",
  "Receta": "Recipe",
  "Editar receta": "Edit recipe",
  "Nueva receta": "New recipe",
  "Nueva etiqueta propia…": "New custom tag…",
  "Nueva etiqueta": "New tag",
  "Buscar ingrediente…": "Search ingredient…",
  "Cant.": "Amt.",
  "Unidad de medida": "Unit of measure",
  "Quitar ingrediente": "Remove ingredient",
  "Sin coincidencias. Crea el ingrediente con «Nuevo ingrediente».": "No matches. Create the ingredient with «New ingredient».",
  "Quitar paso": "Remove step",
  "Etiqueta añadida.": "Tag added.",
  "El nombre es obligatorio.": "Name is required.",
  "Las porciones son obligatorias.": "Servings are required.",
  "Receta actualizada.": "Recipe updated.",
  "Receta guardada (pendiente de revisar).": "Recipe saved (pending review).",
  "Receta guardada.": "Recipe saved.",
  "Pega una URL de la receta.": "Paste the recipe URL.",
  "La URL debe empezar por http:// o https://.": "URL must start with http:// or https://.",
  "Importando…": "Importing…",
  "Datos extraídos. Repasa los campos y guarda (quedará marcada como «Revisar»).": "Data extracted. Review the fields and save (it will be marked as «Review»).",
  "No se pudo extraer la receta de esa web; se guardará la URL y la revisarás después.": "Could not extract the recipe from that site; the URL will be saved for later review.",
  "Importar": "Import",
  "El menú de esta semana todavía no tiene datos guardados.": "This week's menu has no saved data yet.",
  "Menú de la semana borrado.": "Weekly menu cleared.",
  "Día": "Day",
  "Buscar receta…": "Search recipe…",
  "Buscar receta": "Search recipe",
  "Ya están todas tus recetas en la semana.": "All your recipes are already in this week.",
  "Ya están todas tus recetas en esta comida.": "All your recipes are already in this meal.",
  "Aún no hay recetas. Crea la primera en la pestaña Recetas.": "No recipes yet. Create the first one in the Recipes tab.",
  "Ninguna receta coincide con la búsqueda o los filtros.": "No recipe matches the search or filters.",
  "Esa receta ya está en la semana.": "That recipe is already in this week.",
  "Receta añadida a la semana.": "Recipe added to the week.",
  "Esa receta ya está en esa comida.": "That recipe is already in that meal.",
  "Receta añadida al menú.": "Recipe added to the menu.",
  "Ítem de vuelta en la lista.": "Item back on the list.",
  "Receta de vuelta en la lista.": "Recipe back on the list.",
  "Sin coincidencias. Crea el ingrediente en la pestaña Ingredientes.": "No matches. Create the ingredient in the Ingredients tab.",
  "Elige el ingrediente del desplegable (o créalo en la pestaña Ingredientes).": "Choose the ingredient from the dropdown (or create it in the Ingredients tab).",
  "Ítem añadido a la lista.": "Item added to the list.",
  "Ahora no": "Not now",
  "Elige una valoración (de 1 a 5 estrellas, con medias).": "Choose a rating (1 to 5 stars, with halves).",
  "No se pudo abrir la valoración:": "Could not open the rating:",
  "Marcado deshecho.": "Mark undone.",
  "Desmarcado.": "Unmarked.",
  "Está en pausa/abandonada. Ábrela para retomarla.": "It is on pause/abandoned. Open it to resume.",
  "Esta serie ya está completa.": "This show is already complete.",
  "No has iniciado sesión.": "You are not signed in.",
  "En el fichero no hay ninguna serie importable.": "The file has no importable shows.",
  "No se pudo comprobar/actualizar": "Could not check/update",
  "No se pudo pausar automáticamente": "Could not pause automatically",
  "Steam: no se pudo actualizar la biblioteca:": "Steam: could not update the library:",
  "Sesión no iniciada.": "No active session.",
  "La sincronización se abortó. Revisa tu conexión e inténtalo de nuevo.": "The sync was aborted. Check your connection and try again.",
  "Preparando copia de seguridad…": "Preparing backup…",
  "Copia de seguridad descargada.": "Backup downloaded.",
  "El archivo no tiene el formato de copia de seguridad de Personal Tracker.": "The file does not have the Personal Tracker backup format.",
  "Restaurando datos…": "Restoring data…",
  "Preparando calendario…": "Preparing calendar…",
  "No hay estrenos próximos que exportar.": "There are no upcoming releases to export.",
  "¿No la encuentras? Añadir manualmente una serie": "Can't find it? Add a show manually",
  "¿No la encuentras? Añadir manualmente una película": "Can't find it? Add a movie manually",
  "¿No lo encuentras? Añadir manualmente un libro": "Can't find it? Add a book manually",
  "¿No lo encuentras? Añadir manualmente un videojuego": "Can't find it? Add a video game manually",
  "Abrir menú de navegación": "Open navigation menu",
  "Escribe al menos 2 caracteres para buscar en tus recetas.": "Type at least 2 characters to search your recipes.",
  "Escribe al menos 2 caracteres para buscar en tu gimnasio.": "Type at least 2 characters to search your gym.",
  "Escribe al menos 2 caracteres para buscar en tus películas, series, libros y videojuegos.": "Type at least 2 characters to search your movies, shows, books and video games.",
  "Añadido": "Added",
  "Sin título": "Untitled",
  "Marcando…": "Marking…",
  "Error: contexto no disponible.": "Error: context unavailable.",
  "Cerrar búsqueda": "Close search",
  "Selección": "Selection",
  "Media de": "Average of",
  "Ocio": "Entertainment",
  "Gimnasio": "Gym",
};

Object.assign(EN_TEXT, EN_TEXT_EXTRA);
/* Experiences tab (ADR-113) */
Object.assign(EN_TEXT, {
  "Experiencias": "Experiences",
  "Filtrar la lista de experiencias": "Filter the experience list",
  "Todas": "All",
  "Por hacer": "To do",
  "Hechas": "Done",
  "Añadir experiencia": "Add experience",
  "Tu lista de experiencias está vacía. Pulsa «Añadir experiencia» para registrar la primera.":
    "Your experience list is empty. Press «Add experience» to register the first one.",
  "No hay ninguna experiencia con ese filtro.": "No experiences match this filter.",
  "Editar experiencia": "Edit experience",
  "Añadir a la lista de experiencias": "Add to the experience list",
  "¿Hecha?": "Done?",
  "Pendiente": "Pending",
  "Hecha": "Done",
  "La fecha no es válida (formato yyyy-mm-dd).": "The date is not valid (yyyy-mm-dd format).",
  "No se pudo actualizar la experiencia.": "Could not update the experience.",
  "No se pudo guardar la experiencia:": "Could not save the experience:",
  "¿Borrar «": "Delete «",
  "» de la lista de experiencias?": "» from the experience list?",
});
;
const ATTR_PREFIX_RE = /^([@#%])([\s\S]+)$/;

// Attribute dictionary (@placeholder, #aria-label, %title).
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
// Pure core (testable without DOM)
// -------------------------------------------------------------

/** Normalizes a string for matching: collapses spaces and trims. */
export function normalizeText(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** Normalized indexes of the dictionaries (precompiled). */
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
 * Translates a text node value (or null if there is no translation).
 * Pure function for the tests.
 */
export function translateText(raw, lang = "en") {
  if (lang !== "en") return null;
  return TEXT_INDEX.get(normalizeText(raw)) || null;
}

// Dictionary prefix per translated attribute.
const ATTR_FOR = { placeholder: "@", "aria-label": "#", title: "%" };

/**
 * Translates an (attr, value) pair or null. attr: "placeholder" |
 * "aria-label" | "title".
 */
export function translateAttr(attr, raw, lang = "en") {
  if (lang !== "en") return null;
  const prefix = ATTR_FOR[attr];
  if (!prefix) return null;
  return ATTR_INDEX.get(`${prefix}|${normalizeText(raw)}`) || null;
}

// -------------------------------------------------------------
// Application to the DOM
// -------------------------------------------------------------

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "SVG", "NOSVG", "CODE"]);

/** Applies the active language to a subtree (the whole doc by default). */
export function applyI18n(root = document, lang = getLang()) {
  if (!root || typeof document === "undefined" || lang === "es") return false;
  let changed = false;

  // Text nodes (TreeWalker for efficiency).
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

  // Translated attributes: the subtree and the root itself.
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
 * Active language: localStorage. Only "es" | "en"; any other
 * value falls back to "es" (defensive, same pattern as the theme).
 */
export function getLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return SUPPORTED[v] ? v : "es";
  } catch {
    return "es";
  }
}

/** Changes the language (persisted) and applies it to the whole document. */
export function setLang(lang, root = document) {
  if (!SUPPORTED[lang]) return false;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* no storage: applied anyway in memory */
  }
  applyI18n(root, lang);
  return true;
}

let observer = null;

const observerCallback = (mutations) => {
  if (getLang() !== "en") return;
  for (const m of mutations) {
    // Added nodes (subtree) and rewritten text nodes.
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
};

/** Watch mutations so dynamic renders are translated on the spot. */
function ensureObserver() {
  if (observer || typeof document === "undefined") return;
  observer = new MutationObserver(observerCallback);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

/**
 * Boots i18n: applies the saved language and watches mutations so
 * dynamic renders (Spanish, source of truth) are translated on the
 * spot if the user chose English — also when they switch later from
 * Settings (the observer lives forever and checks the active
 * language on every callback).
 */
export function initializeI18n() {
  if (typeof document === "undefined") return;
  applyI18n(document, getLang());
  ensureObserver();
}

/** Stops the observer (tests / logout). */
export function stopI18n() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}
