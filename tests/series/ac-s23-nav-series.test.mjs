// =============================================================
// AC-S23 — Navegación «Series» de `js/app.js` (UI-S01, REQ-D2 MOD,
// REQ-D3 MOD). Criterio: en sesión `allowed`, pulsar «Series» oculta
// `#app-empty` (conservando su texto) y `#movies-section` y muestra
// `#series-section` con sus tres pestañas; un segundo pulso vuelve a
// `#app-empty` con su texto original; `#nav-movies` sigue alternando
// de forma excluyente; la importación no genera errores de consola.
//
// `js/app.js` importa Firebase (CDN), así que no se puede cargar tal
// cual en Node. Estas pruebas lo cargan con `mock.module` (flag
// `--experimental-test-module-mocks`) sustituyendo `firebase.js`,
// `allowed-emails.js`, `moviesView.js` y `seriesView.js` por dobles,
// contra un DOM falso mínimo. No se modifica ningún fichero de la
// aplicación.
// =============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, mock } from "node:test";

// -------------------------------------------------------------
// DOM falso (suficiente para los puntos de entrada de app.js)
// -------------------------------------------------------------

class FakeElement {
  constructor(id, { hidden = false, text = "", attrs = {} } = {}) {
    this.id = id;
    this.hidden = hidden;
    this.textContent = text;
    this.disabled = false;
    this.src = "";
    this.alt = "";
    this.attrs = new Map(Object.entries(attrs));
    this.listeners = new Map();
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  click() {
    for (const handler of this.listeners.get("click") ?? []) {
      handler({ type: "click", target: this });
    }
  }
}

const EMPTY_TEXT = "Selecciona o añade una categoría para empezar";

/** @type {Map<string, FakeElement>} */
const elements = new Map();

function add(id, opts) {
  const element = new FakeElement(id, opts);
  elements.set(id, element);
  return element;
}

// Shell de acceso (máquina de estados).
add("view-loading", { hidden: true });
add("view-login", { hidden: true });
add("view-allowed", { hidden: true });
add("view-denied", { hidden: true });
add("login-error", { hidden: true });
add("btn-login");
add("btn-logout");
add("btn-back");
add("user-photo", { hidden: true });
add("user-name");
add("user-email");

// Barra superior + navegación de categorías + estado vacío, con el
// estado inicial de index.html (secciones plegadas, `aria-expanded`
// a «false», `#app-empty` oculto hasta la sesión `allowed`).
const appEmpty = add("app-empty", { hidden: true, text: EMPTY_TEXT });
const navMovies = add("nav-movies", { attrs: { "aria-expanded": "false" } });
const moviesSection = add("movies-section", { hidden: true });
const navSeries = add("nav-series", { attrs: { "aria-expanded": "false" } });
const seriesSection = add("series-section", { hidden: true });

globalThis.document = {
  getElementById: (id) => elements.get(id) ?? null,
};

// -------------------------------------------------------------
// Dobles de los módulos importados por app.js
// -------------------------------------------------------------

/** Callback capturado de `watchAuthState` (la sesión se dispara a mano). */
let authCallback = null;

/** Contadores de montaje/desmontaje (prueban el cableado de las vistas). */
const calls = { mountSeries: 0, unmountSeries: 0, mountMovies: 0, unmountMovies: 0 };

mock.module(new URL("../../js/firebase.js", import.meta.url).href, {
  namedExports: {
    login: async () => {},
    logout: async () => {},
    watchAuthState: (callback) => {
      authCallback = callback;
    },
  },
});

mock.module(new URL("../../js/allowed-emails.js", import.meta.url).href, {
  namedExports: { isEmailAllowed: () => true },
});

mock.module(new URL("../../js/series/seriesView.js", import.meta.url).href, {
  namedExports: {
    mountSeries: () => {
      calls.mountSeries += 1;
    },
    unmountSeries: () => {
      calls.unmountSeries += 1;
    },
  },
});

mock.module(new URL("../../js/movies/moviesView.js", import.meta.url).href, {
  namedExports: {
    mountMovies: () => {
      calls.mountMovies += 1;
    },
    unmountMovies: () => {
      calls.unmountMovies += 1;
    },
  },
});

// -------------------------------------------------------------
// Captura de consola + importación de app.js
// -------------------------------------------------------------

const consoleErrors = [];
const consoleWarns = [];
const originalError = console.error;
const originalWarn = console.warn;

console.error = (...args) => {
  consoleErrors.push(args.map(String).join(" "));
};
console.warn = (...args) => {
  consoleWarns.push(args.map(String).join(" "));
};

// Importación real de `js/app.js` (con `seriesView` mockeado).
await import("../../js/app.js");

after(() => {
  console.error = originalError;
  console.warn = originalWarn;
});

// Sesión `allowed`: el observador mockeado deja el callback registrado.
assert.ok(authCallback, "app.js debe registrar watchAuthState al importarse");
await authCallback({ email: "allowed@example.com", displayName: "QA" });

// -------------------------------------------------------------
// Tests
// -------------------------------------------------------------

test("AC-S23 · importa js/app.js (seriesView) sin errores de consola", () => {
  assert.deepEqual(consoleErrors, [], "sin console.error en la importación");
  assert.deepEqual(consoleWarns, [], "sin console.warn en la importación");
});

test("AC-S23 · tras la sesión, #app-empty está visible con su texto", () => {
  assert.equal(appEmpty.hidden, false);
  assert.equal(appEmpty.textContent, EMPTY_TEXT);
  assert.equal(navSeries.getAttribute("aria-expanded"), "false");
  assert.equal(seriesSection.hidden, true);
  assert.equal(moviesSection.hidden, true);
});

test("AC-S23 · pulsar «Series» oculta #app-empty y #movies-section y muestra #series-section", () => {
  navSeries.click();

  assert.equal(seriesSection.hidden, false, "#series-section visible");
  assert.equal(moviesSection.hidden, true, "#movies-section oculto (exclusión)");
  assert.equal(appEmpty.hidden, true, "#app-empty oculto");
  assert.equal(appEmpty.textContent, EMPTY_TEXT, "el texto de #app-empty no cambia");
  assert.equal(navSeries.getAttribute("aria-expanded"), "true");
  assert.equal(navMovies.getAttribute("aria-expanded"), "false");
  assert.equal(calls.mountSeries, 1, "seriesView se monta al mostrar la sección");
});

test("AC-S23 · las tres pestañas de Series viven dentro de #series-section (index.html)", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const sectionAt = html.indexOf('id="series-section"');
  assert.ok(sectionAt >= 0, "#series-section debe existir en index.html");

  for (const tab of ["series-tab-catalog", "series-tab-library", "series-tab-collections"]) {
    const at = html.indexOf(`id="${tab}"`);
    assert.ok(at > sectionAt, `#${tab} debe declararse tras el inicio de #series-section`);
  }
});

test("AC-S23 · segundo pulso en «Series» devuelve #app-empty con su texto original", () => {
  navSeries.click();

  assert.equal(seriesSection.hidden, true, "#series-section vuelve a ocultarse");
  assert.equal(appEmpty.hidden, false, "#app-empty vuelve a mostrarse");
  assert.equal(appEmpty.textContent, EMPTY_TEXT, "el texto de #app-empty se conserva");
  assert.equal(navSeries.getAttribute("aria-expanded"), "false");
  assert.equal(calls.unmountSeries, 1, "seriesView se desmonta al ocultar la sección");
});

test("AC-S23 · #nav-movies sigue alternando en exclusión con #series-section", () => {
  // Películas visible, series plegadas.
  navMovies.click();

  assert.equal(moviesSection.hidden, false);
  assert.equal(seriesSection.hidden, true);
  assert.equal(appEmpty.hidden, true);
  assert.equal(navMovies.getAttribute("aria-expanded"), "true");
  assert.equal(navSeries.getAttribute("aria-expanded"), "false");
  assert.equal(calls.mountMovies, 1);

  // Series desde películas: exclusión mutua (una sola visible).
  navSeries.click();

  assert.equal(seriesSection.hidden, false);
  assert.equal(moviesSection.hidden, true, "#movies-section se pliega al abrir series");
  assert.equal(appEmpty.hidden, true);
  assert.equal(navMovies.getAttribute("aria-expanded"), "false");
  assert.equal(navSeries.getAttribute("aria-expanded"), "true");
  assert.equal(calls.unmountMovies, 1);

  // Cerrar series: estado vacío de nuevo.
  navSeries.click();

  assert.equal(seriesSection.hidden, true);
  assert.equal(moviesSection.hidden, true);
  assert.equal(appEmpty.hidden, false);
  assert.equal(appEmpty.textContent, EMPTY_TEXT);
});

test("AC-S23 · ninguna interacción ha emitido errores de consola", () => {
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(consoleWarns, []);
});
