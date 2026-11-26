// =============================================================
// app.js — Núcleo base del Personal Tracker.
//
// Alcance de este módulo:
//   1. Puerta de acceso con Google (spec 001): máquina de estados
//      loading → { login | allowed | denied } con los botones
//      Entrar / Salir / Volver y el aviso de acceso no autorizado.
//   2. Barra superior con los datos del usuario autenticado.
//   3. Área principal con el estado vacío inicial.
//
// Convenciones:
//   - Módulos ESM sin build step (specs/00-overview.md §3, REQ-C5).
//   - Textos de UI en español.
//   - `js/firebase.js` es el único punto que conoce las URLs del
//     CDN de Firebase; `js/allowed-emails.js` es la lista de
//     correos autorizados (control de acceso web).
// =============================================================

import { login, logout, watchAuthState } from "./firebase.js";
import { isEmailAllowed } from "./allowed-emails.js";

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
 * True tras rechazar un correo: la vista `denied` persiste aunque
 * el `logout()` automático dispare `watchAuthState` con null.
 * @type {boolean}
 */
let deniedAccess = false;

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

  // Área principal en su estado vacío inicial.
  if (appEmpty) appEmpty.hidden = false;
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

// -------------------------------------------------------------
// Observador de sesión
// -------------------------------------------------------------

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
    } catch {
      // Sesión residual: la vista de rechazo ya está activa.
    }
    return;
  }

  deniedAccess = false;
  renderAllowed(user);
  show("allowed");
});
