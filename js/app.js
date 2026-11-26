// =============================================================
// app.js — Núcleo base del Personal Tracker.
//
// Alcance de este módulo:
//   1. Puerta de acceso con Google (spec 001): máquina de estados
//      loading → { login | allowed | denied } con los botones
//      Entrar / Salir / Volver y el aviso de acceso no autorizado.
//   2. Barra superior con los datos del usuario autenticado.
//   3. Área principal con el estado vacío inicial.
//   4. Navegación por categorías: la entrada «Películas» alterna la
//      sección `#movies-section` y mantiene sincronizado
//      `aria-expanded` y el estado vacío `#app-empty`
//      (UI-M01, REQ-D2 MOD, REQ-D3 MOD).
//
// Convenciones:
//   - Módulos ESM sin build step (specs/00-overview.md §3, REQ-C5).
//   - Textos de UI en español.
//   - `js/firebase.js` es el único punto que conoce las URLs del
//     CDN de Firebase; `js/allowed-emails.js` es la lista de
//     correos autorizados (control de acceso web).
//   - `js/movies/moviesView.js` orquesta la sección de películas: este
//     módulo solo la monta y la desmonta al alternar la visibilidad.
// =============================================================

import { login, logout, watchAuthState } from "./firebase.js";
import { isEmailAllowed } from "./allowed-emails.js";
import { mountMovies, unmountMovies } from "./movies/moviesView.js";

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
  if (appEmpty) appEmpty.hidden = moviesMounted;
}

// -------------------------------------------------------------
// Sección de películas (UI-M01, REQ-D2 MOD, REQ-D3 MOD)
// -------------------------------------------------------------

/**
 * Muestra u oculta la sección de películas y mantiene sincronizados
 * `aria-expanded` de la entrada de navegación y el estado vacío
 * `#app-empty` (AC-M17).
 *
 * Al mostrarse se monta la vista (`mountMovies`) y al ocultarse se
 * desmonta (`unmountMovies`) para cancelar sus suscripciones a
 * Firestore y sus temporizadores.
 *
 * @param {boolean} visible True para mostrar la sección.
 * @returns {void}
 */
function setMoviesVisible(visible) {
  if (visible) {
    if (!moviesMounted) {
      try {
        mountMovies();
        moviesMounted = true;
      } catch (error) {
        // Un fallo de montaje no debe romper el shell: se mantiene
        // el estado vacío y se avisa por consola.
        console.warn("No se pudo montar la sección de películas.", error);
        moviesMounted = false;
      }
    }
  } else if (moviesMounted) {
    try {
      unmountMovies();
    } catch (error) {
      console.warn("No se pudo desmontar la sección de películas.", error);
    }
    moviesMounted = false;
  }

  // La sección solo queda visible si la vista está montada.
  const shown = visible && moviesMounted;

  if (moviesSection) moviesSection.hidden = !shown;
  if (navMovies) navMovies.setAttribute("aria-expanded", shown ? "true" : "false");

  // REQ-D3 (MOD): `#app-empty` se oculta mientras la sección de
  // películas está visible y vuelve al ocultarla. Su texto no cambia.
  if (appEmpty) appEmpty.hidden = shown;
}

/**
 * Devuelve la sección de películas a su estado inicial (oculta y sin
 * montar). Se usa al empezar o terminar una sesión para no dejar
 * suscripciones vivas ni una sección abierta de la sesión anterior.
 *
 * @returns {void}
 */
function resetMoviesSection() {
  setMoviesVisible(false);
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

// «Películas»: alterna la visibilidad de `#movies-section`
// (UI-M01, REQ-D2 MOD, REQ-D3 MOD, AC-M17).
navMovies?.addEventListener("click", () => {
  const isHidden = moviesSection ? moviesSection.hidden : !moviesMounted;
  setMoviesVisible(isHidden);
});

// -------------------------------------------------------------
// Observador de sesión
// -------------------------------------------------------------

watchAuthState(async (user) => {
  if (!user) {
    // Al cerrar la sesión se desmonta la sección de películas: sus
    // suscripciones a Firestore dejan de vivir.
    resetMoviesSection();
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
  // Cada sesión empieza con el estado vacío y la sección de
  // películas plegada.
  resetMoviesSection();
  renderAllowed(user);
  show("allowed");
});
