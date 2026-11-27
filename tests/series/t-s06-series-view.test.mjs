// =============================================================
// T-S06 — QA de `js/series/seriesView.js` (UI-S01..S04, ALG-S01,
// REQ-S12). Criterios: AC-S26 (barra de estadísticas con etiquetas
// en español) y AC-S10 (barra «6/24 · 25%», «+1 Episodio», catálogo
// con 4 listas, búsqueda con debounce 300 ms / ≥2 chars, pósters
// w500 y estados de error/vacío en español).
//
// `seriesView.js` importa `seriesRepository.js` (Firebase), así que
// no se puede cargar tal cual en Node. Estas pruebas:
//   1. extraen del fuente (solo lectura) las funciones/constantes
//      puras y las ejecutan contra un DOM falso, y
//   2. comprueban de forma estática el esqueleto de `index.html` y
//      los textos en español.
// No se modifica ningún fichero de la aplicación.
// =============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { computeSeriesStats } from "../../js/series/seriesState.js";
import { posterUrl } from "../../js/series/tmdbTvClient.js";

const viewSrc = readFileSync(
  new URL("../../js/series/seriesView.js", import.meta.url),
  "utf8"
);
const htmlSrc = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

// -------------------------------------------------------------
// Extractores (el cierre de cada función/constante está en la
// columna 0 del fichero)
// -------------------------------------------------------------

function extractFunction(name) {
  const start = viewSrc.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `función no encontrada: ${name}`);
  const end = viewSrc.indexOf("\n}\n", start);
  assert.ok(end > start, `cierre no encontrado: ${name}`);
  return viewSrc.slice(start, end + 2);
}

function extractFreezeArray(name) {
  const start = viewSrc.indexOf(`const ${name} = Object.freeze([`);
  assert.ok(start >= 0, `constante no encontrada: ${name}`);
  const end = viewSrc.indexOf("]);", start);
  assert.ok(end > start, `cierre no encontrado: ${name}`);
  return viewSrc.slice(start, end + 3);
}

function extractFreezeObject(name) {
  const start = viewSrc.indexOf(`const ${name} = Object.freeze({`);
  assert.ok(start >= 0, `constante no encontrada: ${name}`);
  const end = viewSrc.indexOf("});", start);
  assert.ok(end > start, `cierre no encontrado: ${name}`);
  return viewSrc.slice(start, end + 3);
}

function extractSimpleConst(name) {
  const start = viewSrc.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `constante no encontrada: ${name}`);
  const end = viewSrc.indexOf(";", start);
  assert.ok(end > start, `cierre no encontrado: ${name}`);
  return viewSrc.slice(start, end + 1);
}

/** Evalúa `const <name> = …;` y devuelve su valor. */
function constValue(name) {
  return new Function(`${extractSimpleConst(name)}\nreturn ${name};`)();
}

/** Evalúa `const <name> = Object.freeze([…]);` y devuelve el array. */
function freezeArrayValue(name) {
  return new Function(`${extractFreezeArray(name)}\nreturn ${name};`)();
}

// -------------------------------------------------------------
// DOM falso mínimo
// -------------------------------------------------------------

class FakeElement {}

function fakeNode(props = {}) {
  const node = Object.create(FakeElement.prototype);
  Object.assign(node, {
    textContent: "",
    hidden: false,
    id: "",
    style: {},
    attrs: {},
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    getAttribute(key) {
      return key in this.attrs ? this.attrs[key] : null;
    },
    removeAttribute(key) {
      delete this.attrs[key];
    },
    querySelector() {
      return null;
    },
    closest() {
      return null;
    },
    ...props,
  });
  return node;
}

function roleOf(selector) {
  const match = /\[data-series-role="([^"]+)"\]/.exec(selector);
  return match ? match[1] : null;
}

// -------------------------------------------------------------
// AC-S26 — barra de estadísticas con etiquetas en español
// -------------------------------------------------------------

const UI_S02_LABELS = [
  ["series-stats-watched", "Completadas"],
  ["series-stats-watching", "En curso"],
  ["series-stats-episodes", "Episodios vistos"],
  ["series-stats-favorites", "Capítulos favoritos"],
  ["series-stats-hours", "Horas"],
  ["series-stats-avg-user", "Mi nota media"],
  ["series-stats-avg-tmdb", "Nota media TMDB"],
];

/** Biblioteca A/B/C de AC-S26 (ALG-S01). */
const AC_S26_LIBRARY = [
  {
    name: "A",
    status: "watched",
    watchedEpisodesCount: 78,
    episodeRuntime: 45,
    favoriteEpisodesCount: 12,
    userRating: 8.5,
    tmdbRating: 8.4,
  },
  {
    name: "B",
    status: "watching",
    watchedEpisodesCount: 10,
    episodeRuntime: null,
    userRating: 7,
    tmdbRating: 7.6,
  },
  {
    name: "C",
    status: "watchlist",
    watchedEpisodesCount: 0,
    userRating: null,
    tmdbRating: null,
  },
];

/** Construye el `renderStats` real con un DOM falso. */
function buildRenderStats(dom) {
  const code = [
    extractSimpleConst("integerFormatter"),
    extractFunction("formatInteger"),
    extractFunction("renderStats"),
    "return renderStats;",
  ].join("\n");
  return new Function("STAT_FIELDS", "dom", "computeSeriesStats", code)(
    freezeArrayValue("STAT_FIELDS"),
    dom,
    computeSeriesStats
  );
}

function makeStatsDom() {
  const stats = {};
  const dts = {};
  for (const [id] of UI_S02_LABELS) {
    const dt = fakeNode();
    const item = { querySelector: (sel) => (sel === "dt" ? dt : null) };
    stats[id] = fakeNode({
      closest: (sel) => (sel === ".series-stats__item" ? item : null),
    });
    dts[id] = dt;
  }
  return { dom: { stats }, dts };
}

test("AC-S26 · renderStats pinta las 7 casillas con las etiquetas en español (UI-S02)", () => {
  const statFields = freezeArrayValue("STAT_FIELDS");

  // Coincidencia exacta con la tabla UI-S02 (ids y textos en español).
  assert.deepEqual(
    statFields.map((field) => [field.id, field.label]),
    UI_S02_LABELS
  );

  const { dom, dts } = makeStatsDom();
  buildRenderStats(dom)(AC_S26_LIBRARY);

  const expected = {
    "series-stats-watched": "1",
    "series-stats-watching": "1",
    "series-stats-episodes": "88",
    "series-stats-favorites": "12",
    "series-stats-hours": "66,0",
    "series-stats-avg-user": "7,8",
    "series-stats-avg-tmdb": "8,0",
  };

  for (const [id, label] of UI_S02_LABELS) {
    assert.equal(dts[id].textContent, label, `etiqueta de ${id}`);
    assert.equal(dom.stats[id].textContent, expected[id], `valor de ${id}`);
  }
});

test("AC-S26 · biblioteca vacía → las 7 casillas quedan en «—»", () => {
  const { dom } = makeStatsDom();
  buildRenderStats(dom)([]);

  for (const [id] of UI_S02_LABELS) {
    assert.equal(dom.stats[id].textContent, "—", `valor de ${id}`);
  }
});

test("AC-S26 · la etiqueta visible se fija en español y los ids viven en index.html", () => {
  const renderStatsSrc = extractFunction("renderStats");

  assert.match(renderStatsSrc, /computeSeriesStats\(/, "usa ALG-S01");
  assert.match(
    renderStatsSrc,
    /label\.textContent = field\.label/,
    "escribe la etiqueta en español en el <dt>"
  );

  for (const [id, label] of UI_S02_LABELS) {
    assert.ok(htmlSrc.includes(`id="${id}"`), `falta id ${id} en index.html`);
    assert.ok(htmlSrc.includes(`>${label}</dt>`), `falta etiqueta «${label}» en index.html`);
  }

  // La barra va siempre visible sobre las pestañas (UI-S02). El
  // ancla es el tablist de Series: `index.html` contiene otro
  // `role="tablist"` previo (sección de películas).
  const statsIndex = htmlSrc.indexOf('id="series-stats"');
  const seriesTablistIndex = htmlSrc.indexOf(
    '<div class="series-tabs" role="tablist"'
  );
  assert.ok(seriesTablistIndex >= 0, "falta el tablist de Series en index.html");
  assert.ok(
    statsIndex >= 0 && statsIndex < seriesTablistIndex,
    "series-stats debe ir antes del tablist de Series"
  );
});

// -------------------------------------------------------------
// AC-S10 — barra de progreso «6/24 · 25%» y «+1 Episodio»
// -------------------------------------------------------------

function loadRenderCardProgress() {
  const code = extractFunction("renderCardProgress") + "\nreturn renderCardProgress;";
  return new Function("HTMLElement", code)(FakeElement);
}

function makeProgressCard() {
  const label = fakeNode();
  const percent = fakeNode();
  const bar = fakeNode();
  const fill = fakeNode();
  const progress = fakeNode({
    querySelector(selector) {
      const map = {
        "progress-label": label,
        "progress-percent": percent,
        "progress-bar": bar,
        "progress-fill": fill,
      };
      const role = roleOf(selector);
      return role ? (map[role] ?? null) : null;
    },
  });
  const card = fakeNode({
    querySelector(selector) {
      return roleOf(selector) === "progress" ? progress : null;
    },
  });
  return { card, progress, label, percent, bar, fill };
}

test("AC-S10 · barra de progreso «6/24» y «25%» (aria-valuetext «6/24 · 25%»)", () => {
  const renderCardProgress = loadRenderCardProgress();
  const { card, progress, label, percent, bar, fill } = makeProgressCard();

  renderCardProgress(card, { numberOfEpisodes: 24, watchedEpisodes: 6 });

  assert.equal(progress.hidden, false);
  assert.equal(label.textContent, "6/24");
  assert.equal(percent.textContent, "25%");
  assert.equal(bar.getAttribute("aria-valuenow"), "25");
  assert.equal(bar.getAttribute("aria-valuetext"), "6/24 · 25%");
  assert.equal(fill.style.width, "25%");
});

test("AC-S10 · sin numberOfEpisodes la barra se oculta (DB-S01)", () => {
  const renderCardProgress = loadRenderCardProgress();
  const { card, progress } = makeProgressCard();

  renderCardProgress(card, { numberOfEpisodes: null, watchedEpisodes: 6 });

  assert.equal(progress.hidden, true);
});

test("AC-S10 · el porcentaje se redondea y se acota a 0–100", () => {
  const renderCardProgress = loadRenderCardProgress();

  const over = makeProgressCard();
  renderCardProgress(over.card, { numberOfEpisodes: 24, watchedEpisodes: 30 });
  assert.equal(over.percent.textContent, "100%");

  const partial = makeProgressCard();
  renderCardProgress(partial.card, { numberOfEpisodes: 24, watchedEpisodes: 23 });
  assert.equal(partial.percent.textContent, "96%");
  assert.equal(partial.label.textContent, "23/24");
});

test("AC-S10 · «+1 Episodio» y etiqueta «Completada» desactivada (UI-S04)", () => {
  const code = extractFunction("updateNextButton") + "\nreturn updateNextButton;";
  const updateNextButton = new Function(code)();

  const button = fakeNode();
  updateNextButton(button, { numberOfEpisodes: 24, watchedEpisodes: 6 });
  assert.equal(button.textContent, "+1 Episodio");
  assert.equal(button.disabled, false);

  updateNextButton(button, { numberOfEpisodes: 24, watchedEpisodes: 24 });
  assert.equal(button.textContent, "Completada");
  assert.equal(button.disabled, true);

  // Sin total conocido nunca se bloquea.
  updateNextButton(button, { numberOfEpisodes: null, watchedEpisodes: 999 });
  assert.equal(button.textContent, "+1 Episodio");
  assert.equal(button.disabled, false);

  // La plantilla trae el botón y los roles de progreso.
  assert.ok(htmlSrc.includes('data-series-role="next"'));
  assert.ok(htmlSrc.includes(">+1 Episodio<"));
  for (const role of ["progress-label", "progress-percent", "progress-bar", "progress-fill"]) {
    assert.ok(
      htmlSrc.includes(`data-series-role="${role}"`),
      `falta el rol ${role} en la plantilla de tarjeta`
    );
  }
});

// -------------------------------------------------------------
// AC-S10 — búsqueda instantánea: debounce 300 ms y ≥2 caracteres
// -------------------------------------------------------------

/** Construye el entorno de `onCatalogSearchInput` con relojes falsos. */
function buildSearchHarness() {
  const scheduled = [];
  const cleared = [];
  const runCalls = [];

  const dom = {
    catalog: {
      search: { value: "" },
      error: fakeNode(),
      sections: fakeNode({ hidden: false }),
      results: fakeNode({ hidden: true }),
      empty: fakeNode({ hidden: true }),
    },
  };
  const state = { catalog: { query: "" } };

  const factory = new Function(
    "dom",
    "state",
    "runCatalogSearch",
    "MIN_SEARCH_CHARS",
    "SEARCH_DEBOUNCE_MS",
    "scheduled",
    "cleared",
    `
    const setTimeout = (fn, ms) => {
      const id = { fn, ms };
      scheduled.push(id);
      return id;
    };
    const clearTimeout = (id) => {
      cleared.push(id);
    };
    ${extractFunction("setVisible")}
    ${extractFunction("setMessage")}
    ${extractFunction("showCatalogSections")}
    let searchTimer = null;
    let searchToken = 0;
    ${extractFunction("onCatalogSearchInput")}
    return {
      onCatalogSearchInput,
      getTimer: () => searchTimer,
      getToken: () => searchToken,
    };
    `
  );

  const harness = factory(
    dom,
    state,
    (query) => {
      runCalls.push(query);
    },
    constValue("MIN_SEARCH_CHARS"),
    constValue("SEARCH_DEBOUNCE_MS"),
    scheduled,
    cleared
  );

  return { ...harness, dom, state, scheduled, cleared, runCalls };
}

test("AC-S10 · debounce de 300 ms y guard de ≥2 caracteres", () => {
  const { onCatalogSearchInput, getToken, dom, state, scheduled, cleared, runCalls } =
    buildSearchHarness();

  // Menos de 2 caracteres: no se agenda nada y se restauran las listas.
  dom.catalog.search.value = "d";
  onCatalogSearchInput();
  assert.equal(scheduled.length, 0, "no debe programar con 1 carácter");
  assert.equal(getToken(), 1, "invalida respuestas en vuelo");
  assert.equal(state.catalog.query, "");
  assert.equal(dom.catalog.sections.hidden, false);
  assert.equal(dom.catalog.results.hidden, true);

  // 2 caracteres o más: se agenda con retardo de 300 ms.
  dom.catalog.search.value = "da";
  onCatalogSearchInput();
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 300, "debounce de 300 ms (NFR-S04)");
  assert.equal(runCalls.length, 0, "la búsqueda no es inmediata");

  // Volver a escribir cancela el temporizador anterior.
  dom.catalog.search.value = "dar";
  onCatalogSearchInput();
  assert.equal(scheduled.length, 2);
  assert.ok(cleared.includes(scheduled[0]), "cancela el debounce previo");

  // Al vencer el temporizador se ejecuta la búsqueda con la consulta.
  scheduled[1].fn();
  assert.deepEqual(runCalls, ["dar"]);

  // Borrado a 0 caracteres: se restauran las cuatro listas.
  dom.catalog.search.value = "";
  onCatalogSearchInput();
  assert.equal(dom.catalog.sections.hidden, false);
  assert.equal(dom.catalog.results.hidden, true);
});

test("AC-S10 · con resultados de búsqueda las cuatro listas se ocultan (UI-S03)", () => {
  const sections = fakeNode();
  const results = fakeNode({ hidden: true });
  const empty = fakeNode({ hidden: true });
  const code = [
    extractFunction("setVisible"),
    extractFunction("showCatalogSections"),
    extractFunction("showCatalogResults"),
    "return { showCatalogSections, showCatalogResults };",
  ].join("\n");
  const { showCatalogSections, showCatalogResults } = new Function("dom", code)({
    catalog: { sections, results, empty },
  });

  showCatalogResults();
  assert.equal(sections.hidden, true);
  assert.equal(results.hidden, false);

  showCatalogSections();
  assert.equal(sections.hidden, false);
  assert.equal(results.hidden, true);
  assert.equal(empty.hidden, true);
});

// -------------------------------------------------------------
// AC-S10 — estados de error y vacío en español
// -------------------------------------------------------------

test("AC-S10 · los errores de TMDB se describen en español (ALG-S05)", () => {
  const code = [
    extractFreezeObject("TMDB_ERROR_MESSAGES"),
    extractFunction("describeTmdbError"),
    "return describeTmdbError;",
  ].join("\n");
  const describeTmdbError = new Function("GENERIC_TMDB_MESSAGE", code)(
    "No se pudo conectar con TMDB. Puedes añadir la serie manualmente."
  );

  const cases = [
    ["NO_API_KEY", "Falta la clave de TMDB: búsqueda desactivada."],
    ["NETWORK", "No se pudo conectar con TMDB. Puedes añadir la serie manualmente."],
    ["HTTP_404", "Serie no encontrada en TMDB. Puedes añadirla manualmente."],
    ["PARSE", "Respuesta no válida de TMDB. Puedes añadir la serie manualmente."],
  ];

  for (const [codeName, message] of cases) {
    assert.equal(describeTmdbError({ code: codeName }), message, codeName);
    assert.ok(/[áéíóúñ¿¡]/.test(message), `mensaje en español para ${codeName}`);
  }
  // Código desconocido → fallo de conexión (en español).
  assert.match(describeTmdbError(new Error("boom")), /No se pudo conectar con TMDB/);
});

test("AC-S10 · estados vacíos del catálogo y de la biblioteca en español", () => {
  // Resultado de búsqueda sin coincidencias (UI-S03).
  assert.match(viewSrc, /Sin resultados para «\$\{query\}»\./);

  // Lista individual sin resultados.
  assert.match(viewSrc, /No hay series en «\$\{label\}»\./);

  // Biblioteca vacía / sin coincidencias con los filtros.
  assert.match(viewSrc, /Tu biblioteca está vacía\. Añade series desde «Explorar catálogo»\./);
  assert.match(viewSrc, /No hay series que coincidan con los filtros\./);

  // El esqueleto trae los nodos con sus roles de accesibilidad.
  assert.ok(htmlSrc.includes('id="series-catalog-error"'));
  assert.match(
    htmlSrc,
    /<p id="series-catalog-error"[^>]*role="alert"/,
    "el error del catálogo usa role=alert"
  );
  assert.ok(htmlSrc.includes('id="series-catalog-empty"'));
  assert.match(htmlSrc, /Sin resultados para «X»\./);
  assert.ok(htmlSrc.includes('id="series-library-empty"'));
  assert.ok(htmlSrc.includes('id="series-library-error"'));
});

// -------------------------------------------------------------
// T-S06 — catálogo: 4 listas de página 1, w500 y montaje
// -------------------------------------------------------------

const CATALOG_FETCHERS = [
  "fetchTrendingWeek",
  "fetchPopularSeries",
  "fetchTopRatedSeries",
  "fetchOnTheAir",
];

test("T-S06 · el catálogo renderiza las cuatro listas de la página 1", () => {
  const catalogLists = new Function(
    ...CATALOG_FETCHERS,
    `${extractFreezeArray("CATALOG_LISTS")}\nreturn CATALOG_LISTS;`
  )(
    ...CATALOG_FETCHERS.map((name) => () => name)
  );

  assert.equal(catalogLists.length, 4);
  assert.deepEqual(
    catalogLists.map((list) => list.label),
    ["Tendencias de la semana", "Populares", "Mejor valoradas", "En emisión"]
  );

  for (const list of catalogLists) {
    assert.equal(typeof list.fetcher, "function", list.key);
    assert.ok(htmlSrc.includes(`id="${list.gridId}"`), `falta rejilla ${list.gridId}`);
    assert.ok(htmlSrc.includes(`id="${list.headingId}"`), `falta título ${list.headingId}`);
  }

  // Página 1 en cada carga (API-S02..S05).
  assert.match(viewSrc, /list\.fetcher\(1\)/);
  // Las cuatro funciones del cliente TMDB están importadas.
  for (const name of CATALOG_FETCHERS) {
    assert.match(viewSrc, new RegExp(`\\b${name}\\b`));
  }
});

test("T-S06 · los pósters de las tarjetas se piden en w500 (API-S08)", () => {
  assert.equal(constValue("POSTER_SIZE"), "w500");
  assert.match(viewSrc, /posterUrl\(model\.posterPath, POSTER_SIZE\)/);

  // El cliente construye la URL base con el tamaño indicado.
  assert.equal(posterUrl("/darkPoster.jpg"), "https://image.tmdb.org/t/p/w500/darkPoster.jpg");
  assert.equal(posterUrl(null), null);
});

test("T-S06 · mountSeries monta la sección y conmuta las tres pestañas (UI-S01, REQ-S12)", () => {
  // Exports y enganche de la navegación.
  assert.match(viewSrc, /export function mountSeries\(/);
  assert.match(viewSrc, /export function unmountSeries\(/);
  assert.match(viewSrc, /activateTab\(state\.activeTab\)/, "activa la pestaña por defecto");
  assert.match(viewSrc, /addEventListener\("click", onClick\)/);
  assert.match(viewSrc, /#series-section/, "la sección vive en #series-section");
  assert.ok(htmlSrc.includes('id="series-section"'));

  // Comportamiento real de `activateTab` sobre un DOM falso.
  const tabs = {
    catalog: fakeNode(),
    library: fakeNode(),
    collections: fakeNode(),
  };
  const panels = {
    catalog: fakeNode({ hidden: false }),
    library: fakeNode({ hidden: true }),
    collections: fakeNode({ hidden: true }),
  };
  const state = { activeTab: "catalog" };
  let catalogLoads = 0;
  let collectionRenders = 0;

  const code = extractFunction("activateTab") + "\nreturn activateTab;";
  const activateTab = new Function(
    "SERIES_TABS",
    "state",
    "dom",
    "loadCatalog",
    "renderCollections",
    code
  )(
    freezeArrayValue("SERIES_TABS"),
    state,
    { tabs, panels },
    () => {
      catalogLoads += 1;
    },
    () => {
      collectionRenders += 1;
    }
  );

  activateTab("library");
  assert.equal(state.activeTab, "library");
  assert.equal(tabs.library.getAttribute("aria-selected"), "true");
  assert.equal(tabs.catalog.getAttribute("aria-selected"), "false");
  assert.equal(tabs.library.tabIndex, 0);
  assert.equal(tabs.catalog.tabIndex, -1);
  assert.equal(panels.library.hidden, false);
  assert.equal(panels.catalog.hidden, true);
  assert.equal(catalogLoads, 0, "no carga el catálogo al abrir la biblioteca");
  assert.equal(collectionRenders, 0, "no repinta colecciones al abrir la biblioteca");

  activateTab("catalog");
  assert.equal(tabs.catalog.getAttribute("aria-selected"), "true");
  assert.equal(tabs.library.getAttribute("aria-selected"), "false");
  assert.equal(panels.catalog.hidden, false);
  assert.equal(panels.library.hidden, true);
  assert.equal(catalogLoads, 1, "abrir el catálogo dispara su carga");

  activateTab("collections");
  assert.equal(tabs.collections.getAttribute("aria-selected"), "true");
  assert.equal(panels.collections.hidden, false);
  assert.equal(panels.catalog.hidden, true);
  assert.equal(
    collectionRenders,
    1,
    "abrir «Mis colecciones» repinta la lista (UI-S10)"
  );

  // Esqueleto: tablist con role/aria-selected y los tres paneles.
  assert.match(htmlSrc, /role="tablist"/);
  for (const id of [
    "series-tab-catalog",
    "series-tab-library",
    "series-tab-collections",
    "series-panel-catalog",
    "series-panel-library",
    "series-panel-collections",
  ]) {
    assert.ok(htmlSrc.includes(`id="${id}"`), `falta id ${id}`);
  }
  assert.match(htmlSrc, /id="series-tab-catalog"[^>]*aria-selected="true"/);
});
