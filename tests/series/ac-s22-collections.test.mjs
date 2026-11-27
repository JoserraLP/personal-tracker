// =============================================================
// AC-S22 (UI-S10, DB-S03) — «Mis colecciones»: crear / renombrar /
// describir / eliminar, recuento «N series», filtro por colección
// al pulsar «Ver series» y limpieza de `collectionIds` al borrar.
//
// Como en T-S06/T-S07, `seriesView.js` importa Firebase y no puede
// cargarse en Node: las funciones puras se extraen del fuente (solo
// lectura) y se ejecutan contra un DOM falso; el CRUD de colecciones
// se prueba sobre el repositorio real con los dobles de
// `repository-helpers.mjs`. No se modifica ningún fichero de la
// aplicación.
// =============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { beforeEach } from "node:test";

import {
  loadRepository,
  resetStore,
  setUser,
  seedSeries,
  getStoredSeries,
  baseSeriesDoc,
} from "./repository-helpers.mjs";

const repo = await loadRepository();

const viewSrc = readFileSync(
  new URL("../../js/series/seriesView.js", import.meta.url),
  "utf8"
);
const htmlSrc = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

beforeEach(() => {
  resetStore();
  setUser("test-uid");
});

// -------------------------------------------------------------
// Extractores (el cierre de cada función está en columna 0)
// -------------------------------------------------------------

function extractFunction(name) {
  const start = viewSrc.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `función no encontrada: ${name}`);
  const end = viewSrc.indexOf("\n}\n", start);
  assert.ok(end > start, `cierre no encontrado: ${name}`);
  return viewSrc.slice(start, end + 2);
}

function extractSimpleConst(name) {
  const start = viewSrc.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `constante no encontrada: ${name}`);
  const end = viewSrc.indexOf(";", start);
  assert.ok(end > start, `cierre no encontrado: ${name}`);
  return viewSrc.slice(start, end + 1);
}

function constValue(name) {
  return new Function(`${extractSimpleConst(name)}\nreturn ${name};`)();
}

// -------------------------------------------------------------
// DOM falso mínimo
// -------------------------------------------------------------

class FakeElement {}

class FakeSelect extends FakeElement {}

function fakeNode(props = {}) {
  const node = Object.create(FakeElement.prototype);
  Object.assign(node, {
    textContent: "",
    hidden: false,
    id: "",
    value: "",
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

// -------------------------------------------------------------
// (a) crear / renombrar / describir + validación en español
// -------------------------------------------------------------

test("AC-S22 · crear, renombrar y describir colecciones (DB-S03)", async () => {
  const miniseriesId = await repo.createCollection({
    name: "Miniseries",
    description: "Cortas y intensas.",
  });
  const pairId = await repo.createCollection({ name: "Para ver en pareja" });

  let collections = await repo.listCollections();
  assert.equal(collections.length, 2, "aparecen las dos colecciones");

  const miniseries = collections.find((item) => item.id === miniseriesId);
  assert.equal(miniseries.name, "Miniseries");
  assert.equal(miniseries.description, "Cortas y intensas.");
  const pair = collections.find((item) => item.id === pairId);
  assert.equal(pair.name, "Para ver en pareja");
  assert.equal(pair.description, null, "sin descripción ⇒ null");

  // Renombrar y describir a la vez.
  await repo.updateCollection(miniseriesId, {
    name: "Miniseries de la casa",
    description: "Otras cortas.",
  });

  collections = await repo.listCollections();
  const renamed = collections.find((item) => item.id === miniseriesId);
  assert.equal(renamed.name, "Miniseries de la casa");
  assert.equal(renamed.description, "Otras cortas.");
  assert.equal(collections.length, 2, "renombrar no crea otra colección");
});

test("AC-S22 · el nombre de la colección es obligatorio (validación en español)", async () => {
  await assert.rejects(
    repo.createCollection({ name: "   " }),
    (error) =>
      error.name === "SeriesRepositoryError" &&
      error.code === "VALIDATION" &&
      error.message === "El nombre de la colección es obligatorio."
  );
});

// -------------------------------------------------------------
// (b) el filtro por colección lista exactamente las series asignadas
// -------------------------------------------------------------

test("AC-S22 · listSeries({collectionId}) lista exactamente las asignadas y una serie puede estar en varias", async () => {
  const miniseriesId = await repo.createCollection({ name: "Miniseries" });
  const pairId = await repo.createCollection({ name: "Para ver en pareja" });

  seedSeries("s1", baseSeriesDoc({ name: "Dark" }));
  seedSeries("s2", baseSeriesDoc({ name: "Chernóbil" }));
  seedSeries("s3", baseSeriesDoc({ name: "The Wire" }));

  // s1 en ambas colecciones, s2 solo en la primera, s3 en ninguna.
  await repo.setCollections("s1", [miniseriesId, pairId]);
  await repo.setCollections("s2", [miniseriesId]);

  const ids = (list) => list.map((series) => series.id).sort();

  const inMiniseries = await repo.listSeries({ collectionId: miniseriesId });
  assert.deepEqual(ids(inMiniseries), ["s1", "s2"], "exactamente las dos");

  const inPair = await repo.listSeries({ collectionId: pairId });
  assert.deepEqual(ids(inPair), ["s1"], "exactamente la primera");

  const inNone = await repo.listSeries({ collectionId: "no-existe" });
  assert.deepEqual(ids(inNone), [], "una colección vacía no lista nada");

  // Una serie puede pertenecer a varias a la vez.
  assert.deepEqual(getStoredSeries("s1").collectionIds, [
    miniseriesId,
    pairId,
  ]);
});

// -------------------------------------------------------------
// (c) recuento «N series» en cliente
// -------------------------------------------------------------

test("AC-S22 · «N series»: el recuento se calcula en cliente desde collectionIds (UI-S10)", () => {
  const integerFormatter = new Intl.NumberFormat("es-ES");

  const formatInteger = new Function(
    "integerFormatter",
    `${extractFunction("formatInteger")}\nreturn formatInteger;`
  )(integerFormatter);

  const formatCollectionCount = new Function(
    "formatInteger",
    `${extractFunction("formatCollectionCount")}\nreturn formatCollectionCount;`
  )(formatInteger);

  const state = {
    library: [
      { id: "s1", collectionIds: ["c1", "c2"] },
      { id: "s2", collectionIds: ["c1"] },
      { id: "s3", collectionIds: [] },
    ],
  };

  const countCollectionSeries = new Function(
    "state",
    `${extractFunction("countCollectionSeries")}\nreturn countCollectionSeries;`
  )(state);

  assert.equal(countCollectionSeries("c1"), 2);
  assert.equal(countCollectionSeries("c2"), 1);
  assert.equal(countCollectionSeries("c3"), 0, "sin series ⇒ 0");
  assert.equal(countCollectionSeries(""), 0, "id vacío ⇒ 0");
  assert.equal(
    countCollectionSeries("c1", [{ collectionIds: ["c2"] }]),
    0,
    "ignora series de otra colección"
  );

  assert.equal(formatCollectionCount(1), "1 serie", "singular");
  assert.equal(formatCollectionCount(2), "2 series", "plural");
  assert.equal(formatCollectionCount(0), "0 series");
});

// -------------------------------------------------------------
// (d) eliminar la colección
// -------------------------------------------------------------

test("AC-S22 · eliminar la colección la retira de «Mis colecciones» y de collectionIds", async () => {
  const miniseriesId = await repo.createCollection({ name: "Miniseries" });
  const pairId = await repo.createCollection({ name: "Para ver en pareja" });

  seedSeries("s1", baseSeriesDoc({ name: "Dark" }));
  seedSeries("s2", baseSeriesDoc({ name: "Chernóbil" }));
  seedSeries("s3", baseSeriesDoc({ name: "The Wire" }));
  await repo.setCollections("s1", [miniseriesId, pairId]);
  await repo.setCollections("s2", [miniseriesId]);

  const affected = await repo.deleteCollection(miniseriesId);
  assert.equal(affected, 2, "afecta a las dos series de la colección");

  const collections = await repo.listCollections();
  assert.deepEqual(
    collections.map((item) => item.id),
    [pairId],
    "desaparece de «Mis colecciones» y la otra se conserva"
  );

  // Su id sale de `collectionIds` de las series afectadas…
  assert.deepEqual(getStoredSeries("s1").collectionIds, [pairId]);
  assert.deepEqual(getStoredSeries("s2").collectionIds, []);
  // …sin tocar a las series que no pertenecían.
  assert.deepEqual(getStoredSeries("s3").collectionIds, []);
});

// -------------------------------------------------------------
// (e) «Ver series» filtra la biblioteca y abre la pestaña
// -------------------------------------------------------------

test("AC-S22 · «Ver series» fija el filtro por colección, repinta la biblioteca y activa la pestaña", () => {
  const select = Object.create(FakeSelect.prototype);
  select.options = [{ value: "" }];
  select.value = "";
  select.append = (option) => {
    select.options.push(option);
  };

  const state = {
    collections: [{ id: "c1", name: "Miniseries" }],
  };
  let filterCalls = 0;
  let activeTab = null;

  const document = {
    createElement: () => ({ value: "", textContent: "" }),
  };

  const handleCollectionOpen = new Function(
    "dom",
    "state",
    "document",
    "HTMLSelectElement",
    "applyLibraryFilters",
    "activateTab",
    `${extractFunction("handleCollectionOpen")}\nreturn handleCollectionOpen;`
  )(
    { library: { collection: select } },
    state,
    document,
    FakeSelect,
    () => {
      filterCalls += 1;
    },
    (key) => {
      activeTab = key;
    }
  );

  handleCollectionOpen("c1");

  assert.equal(select.value, "c1", "el selector de la biblioteca queda en la colección");
  const option = select.options.find((item) => item.value === "c1");
  assert.ok(option, "añade la opción si faltaba");
  assert.equal(option.textContent, "Miniseries", "la opción usa el nombre visible");
  assert.equal(filterCalls, 1, "aplica el filtro de la biblioteca");
  assert.equal(activeTab, "library", "abre la pestaña «Mi biblioteca»");

  // Id desconocido o vacío: no cambia de pestaña ni repinta.
  activeTab = null;
  filterCalls = 0;
  handleCollectionOpen("");
  assert.equal(filterCalls, 0);
  assert.equal(activeTab, null);
});

// -------------------------------------------------------------
// (f) esqueleto estático de «Mis colecciones» (UI-S10)
// -------------------------------------------------------------

test("AC-S22 · index.html trae el esqueleto de «Mis colecciones» y el filtro de biblioteca", () => {
  for (const id of [
    "series-collections-form",
    "series-collection-name",
    "series-collection-description",
    "series-collection-submit",
    "series-collections-list",
    "series-collections-empty",
    "series-library-collection",
  ]) {
    assert.ok(htmlSrc.includes(`id="${id}"`), `falta id ${id}`);
  }

  assert.match(
    htmlSrc,
    /<button id="series-collection-submit"[^>]*>Crear colección<\/button>/,
    "el botón de envío dice «Crear colección»"
  );
  assert.match(
    htmlSrc,
    /id="series-collections-empty"[^>]*>Aún no tienes colecciones\.</,
    "estado vacío en español"
  );

  for (const role of [
    "collection-item",
    "collection-name",
    "collection-count",
    "collection-description",
    "collection-open",
    "collection-rename",
    "collection-delete",
  ]) {
    assert.ok(
      htmlSrc.includes(`data-series-role="${role}"`),
      `falta data-series-role=${role}`
    );
  }

  // La vista pinta la lista al cambiar de pestaña y al recibir datos.
  assert.equal(constValue("COLLECTIONS_EMPTY_MESSAGE"), "Aún no tienes colecciones.");
  assert.match(viewSrc, /renderCollections\(\);/);
  assert.match(viewSrc, /function renderCollections\(/);
  assert.match(viewSrc, /function handleCollectionOpen\(/);
});
