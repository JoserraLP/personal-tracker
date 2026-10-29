// =============================================================
// Puerta de acceso de la app (spec 001): login con Google y
// control por lista de correos autorizados (js/allowed-emails.js).
// Máquina de estados: loading → { login | allowed | denied }.
// =============================================================

import { login, logout, watchAuthState } from "./firebase.js";
import { isEmailAllowed } from "./allowed-emails.js";

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

btnLogout.addEventListener("click", () => logout());

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
});
