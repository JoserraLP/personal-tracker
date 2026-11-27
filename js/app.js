// =============================================================
// app.js — Núcleo base del Personal Tracker.
//
// Alcance de este módulo:
//   1. Puerta de acceso con Google (spec 001): máquina de estados
//      loading → { login | allowed | denied } con los botones
//      Entrar / Salir / Volver y el aviso de acceso no autorizado.
//   2. Barra superior con los datos del usuario autenticado.
//   3. Área principal con el estado vacío inicial.
//   4. Navegación por categorías: las entradas «Películas» y
//      «Series» alternan su sección (`#movies-section` y
//      `#series-section`) de forma **excluyente**, mantienen
//      sincronizado `aria-expanded` y el estado vacío `#app-empty`
//      (UI-M01, UI-S01, REQ-D2 MOD, REQ-D3 MOD).
//
// Convenciones:
//   - Módulos ESM sin build step (specs/00-overview.md §3, REQ-C1).
//   - Textos de UI en español (REQ-C3).
//   - `js/firebase.js` es el único punto que conoce las URLs del
//     CDN de Firebase; `js/allowed-emails.js` es la lista de
//     correos autorizados (control de acceso web).
//   - `js/movies/moviesView.js` orquesta la sección de películas y
//     `js/series/seriesView.js` la de series: este módulo solo las
//     monta y las desmonta al alternar la visibilidad.
// =============================================================

import { login, logout, watchAuthState } from "./firebase.js";
import { isEmailAllowed } from "./allowed-emails.js";
import { mountMovies, unmountMovies } from "./movies/moviesView.js";
import { mountSeries, unmountSeries } from "./series/seriesView.js";

// -------------------------------------------------------------
// Referencias del DOM (app shell de index.html)
// -------------------------------------------------------------

/** Contenedores de la máquina de estados de acceso. */
const views = {
  loading: document.getElementById("view-loading"),
  login: document.getElementById("view-login"),
  allowed: document.getElementById("view-allowed"),
  denied: document.getElementById("view-denied"),
};

/** Aviso de error del login (#login-error). */
const loginError = document.getElementById("login-error");

/** Botones del shell. */
const btnLogin = document.getElementById("btn-login");
const btnLogout = document.getElementById("btn-logout");
const btnBack = document.getElementById("btn-back");

/** Datos del usuario en la barra superior. */
const userPhoto = document.getElementById("user-photo");
const userName = document.getElementById("user-name");
const userEmail = document.getElementById("user-email");

/** Estado vacío del área principal. */
const appEmpty = document.getElementById("app-empty");

/**
 * Entrada de navegación de la sección de películas (UI-M01, REQ-D2 MOD).
 * Es un `button` con `aria-expanded` que este módulo mantiene al día.
 */
const navMovies = document.getElementById("nav-movies");

/** Contenedor de la sección de películas (UI-M01). */
const moviesSection = document.getElementById("movies-section");

/**
 * Entrada de navegación de la sección de series (UI-S01, REQ-D2 MOD).
 * Es un `button` con `aria-expanded` que este módulo mantiene al día.
 */
const navSeries = document.getElementById("nav-series");

/** Contenedor de la sección de series (UI-S01). */
const seriesSection = document.getElementById("series-section");

/**
 * True tras rechazar un correo: la vista `denied` persiste aunque
 * el `logout()` automático dispare `watchAuthState` con null.
 * @type {boolean}
 */
let deniedAccess = false;

/**
 * True mientras la sección de películas está montada y visible. El
 * montaje y el desmontaje van ligados a la visibilidad: se monta al
 * mostrarla y se desmonta al ocultarla (T-M11).
 * @type {boolean}
 */
let moviesMounted = false;

/**
 * True mientras la sección de series está montada y visible. El
 * montaje y el desmontaje van ligados a la visibilidad: se monta al
 * mostrarla y se desmonta al ocultarla (T-S11).
 * @type {boolean}
 */
let seriesMounted = false;

// -------------------------------------------------------------
// Máquina de estados
// -------------------------------------------------------------

/**
 * Muestra una única vista del shell y oculta las demás.
 * @param {"loading" | "login" | "allowed" | "denied"} name
 * @returns {void}
 */
function show(name) {
  Object.entries(views).forEach(([key, view]) => {
    if (view) view.hidden = key !== name;
  });
}

/**
 * Muestra u oculta el aviso de error del login (#login-error).
 * @param {string} message Texto del error; "" lo oculta.
 * @returns {void}
 */
function setLoginError(message) {
  if (!loginError) return;
  loginError.textContent = message;
  loginError.hidden = !message;
}

/**
 * Rellena la barra superior con los datos del usuario autenticado.
 * @param {import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js").User} user
 * @returns {void}
 */
function renderAllowed(user) {
  const name = user.displayName || user.email || "invitado";

  if (userName) userName.textContent = name;
  if (userEmail) userEmail.textContent = user.email || "";

  if (userPhoto) {
    if (user.photoURL) {
      userPhoto.src = user.photoURL;
      userPhoto.alt = `Foto de ${name}`;
      userPhoto.hidden = false;
    } else {
      userPhoto.hidden = true;
    }
  }

  // El estado vacío del área principal solo se muestra cuando no hay
  // ninguna sección abierta (REQ-D3 MOD).
  if (appEmpty) appEmpty.hidden = isAnySectionVisible();
}

// -------------------------------------------------------------
// Secciones de categoría (UI-M01, UI-S01, REQ-D2 MOD, REQ-D3 MOD)
// -------------------------------------------------------------

/**
 * True si alguna sección de categoría está visible. El estado vacío
 * `#app-empty` se oculta mientras lo haya (REQ-D3 MOD).
 *
 * Una sección montada siempre está visible: el montaje y el
 * desmontaje van ligados a la visibilidad, así que basta con mirar
 * los indicadores de montaje.
 *
 * @returns {boolean}
 */
function isAnySectionVisible() {
  return moviesMounted || seriesMounted;
}

/**
 * Monta la vista de una sección de categoría.
 *
 * Un fallo de montaje no debe romper el shell: se avisa por consola
 * y la sección sigue oculta (con `#app-empty` a la vista).
 *
 * @param {"movies" | "series"} kind Sección a montar.
 * @returns {boolean} True si la vista ha quedado montada.
 */
function mountSection(kind) {
  try {
    if (kind === "movies") {
      mountMovies();
    } else {
      mountSeries();
    }
    return true;
  } catch (error) {
    console.warn(
      `No se pudo montar la sección de ${kind === "movies" ? "películas" : "series"}.`,
      error
    );
    return false;
  }
}

/**
 * Desmonta la vista de una sección de categoría para cancelar sus
 * suscripciones a Firestore y sus temporizadores.
 *
 * @param {"movies" | "series"} kind Sección a desmontar.
 * @returns {void}
 */
function unmountSection(kind) {
  try {
    if (kind === "movies") {
      unmountMovies();
    } else {
      unmountSeries();
    }
  } catch (error) {
    console.warn(
      `No se pudo desmontar la sección de ${kind === "movies" ? "películas" : "series"}.`,
      error
    );
  }
}

/**
 * Activa una sección de categoría de forma **excluyente** (REQ-D2
 * MOD): al mostrar una se pliegan las demás, se sincroniza
 * `aria-expanded` de su entrada de navegación y se actualiza el
 * estado vacío `#app-empty` (REQ-D3 MOD).
 *
 * Al mostrarse se monta la vista (`mountMovies` / `mountSeries`) y
 * al ocultarse se desmonta (`unmountMovies` / `unmountSeries`).
 *
 * @param {"movies" | "series" | null} kind Sección a mostrar; `null`
 *   pliega todas.
 * @returns {void}
 */
function setActiveSection(kind) {
  const moviesWanted = kind === "movies";
  const seriesWanted = kind === "series";

  // --- Montaje y desmontaje -------------------------------------
  if (moviesWanted) {
    if (!moviesMounted) moviesMounted = mountSection("movies");
  } else if (moviesMounted) {
    unmountSection("movies");
    moviesMounted = false;
  }

  if (seriesWanted) {
    if (!seriesMounted) seriesMounted = mountSection("series");
  } else if (seriesMounted) {
    unmountSection("series");
    seriesMounted = false;
  }

  // --- Visibilidad y `aria-expanded` ----------------------------
  // La sección solo queda visible si su vista está montada.
  const moviesShown = moviesWanted && moviesMounted;
  const seriesShown = seriesWanted && seriesMounted;

  if (moviesSection) moviesSection.hidden = !moviesShown;
  if (navMovies) navMovies.setAttribute("aria-expanded", moviesShown ? "true" : "false");

  if (seriesSection) seriesSection.hidden = !seriesShown;
  if (navSeries) navSeries.setAttribute("aria-expanded", seriesShown ? "true" : "false");

  // REQ-D3 (MOD): `#app-empty` se oculta mientras `#movies-section`
  // o `#series-section` estén visibles y vuelve al plegarlas. Su
  // texto no cambia.
  if (appEmpty) appEmpty.hidden = moviesShown || seriesShown;
}

/**
 * Devuelve las secciones de categoría a su estado inicial (ocultas y
 * sin montar). Se usa al empezar o terminar una sesión para no dejar
 * suscripciones vivas ni una sección abierta de la sesión anterior.
 *
 * @returns {void}
 */
function resetSections() {
  setActiveSection(null);
}

// -------------------------------------------------------------
// Handlers
// -------------------------------------------------------------

btnLogin?.addEventListener("click", async () => {
  setLoginError("");
  if (btnLogin) btnLogin.disabled = true;
  try {
    await login();
  } catch {
    setLoginError("No se pudo iniciar sesión con Google (popup bloqueado o cancelado).");
  } finally {
    if (btnLogin) btnLogin.disabled = false;
  }
});

btnLogout?.addEventListener("click", () => {
  logout().catch(() => {
    // La sesión ya puede estar cerrada: la vista de login se
    // muestra igualmente desde el observador de estado.
  });
});

btnBack?.addEventListener("click", () => {
  deniedAccess = false;
  show("login");
});

// «Películas»: alterna la visibilidad de `#movies-section` de forma
// excluyente con `#series-section` (UI-M01, REQ-D2 MOD, REQ-D3 MOD,
// AC-M17).
navMovies?.addEventListener("click", () => {
  const isHidden = moviesSection ? moviesSection.hidden : !moviesMounted;
  setActiveSection(isHidden ? "movies" : null);
});

// «Series»: alterna la visibilidad de `#series-section` de forma
// excluyente con `#movies-section` (UI-S01, REQ-D2 MOD, REQ-D3 MOD,
// AC-S23).
navSeries?.addEventListener("click", () => {
  const isHidden = seriesSection ? seriesSection.hidden : !seriesMounted;
  setActiveSection(isHidden ? "series" : null);
});

// -------------------------------------------------------------
// Observador de sesión
// -------------------------------------------------------------

watchAuthState(async (user) => {
  if (!user) {
    // Al cerrar la sesión se desmontan las secciones de categoría:
    // sus suscripciones a Firestore dejan de vivir.
    resetSections();
    show(deniedAccess ? "denied" : "login");
    return;
  }

  if (!isEmailAllowed(user.email)) {
    deniedAccess = true;
    show("denied");
    try {
      await logout();
    } catch {
      // Sesión residual: la vista de rechazo ya está activa.
    }
    return;
  }

  deniedAccess = false;
  // Cada sesión empieza con el estado vacío y las secciones de
  // categoría plegadas.
  resetSections();
  renderAllowed(user);
  show("allowed");
});
