// AC-S24 (ALG-S02): combinando estado «Completadas» + género «Drama» +
// una colección + rango 8–10 solo se listan las series que cumplen los
// cuatro; «Limpiar filtros» (valores por defecto) restaura la lista completa.

import assert from "node:assert/strict";
import test from "node:test";

import {
  filterSeries,
  createLibraryFilters,
  DEFAULT_LIBRARY_FILTERS,
  TV_GENRES_ES,
} from "../../js/series/seriesState.js";

const DRAMA_ID = 18; // D-S08: «Drama»
const COLLECTION = "col-miniseries";

const library = [
  { id: "all", name: "Cumple los 4", status: "watched", genreIds: [DRAMA_ID], collectionIds: [COLLECTION], userRating: 9 },
  { id: "rating", name: "Nota 7", status: "watched", genreIds: [DRAMA_ID], collectionIds: [COLLECTION], userRating: 7 },
  { id: "genre", name: "Comedia", status: "watched", genreIds: [35], collectionIds: [COLLECTION], userRating: 9 },
  { id: "status", name: "En curso", status: "watching", genreIds: [DRAMA_ID], collectionIds: [COLLECTION], userRating: 9 },
  { id: "collection", name: "Sin colección", status: "watched", genreIds: [DRAMA_ID], collectionIds: [], userRating: 9 },
  { id: "no-rating", name: "Sin nota", status: "watched", genreIds: [DRAMA_ID], collectionIds: [COLLECTION], userRating: null },
];

const combined = {
  status: "watched",
  genreId: DRAMA_ID,
  collectionId: COLLECTION,
  ratingMin: 8,
  ratingMax: 10,
};

test("AC-S24 · estado + género + colección + rango 8–10 solo deja las 4 condiciones", () => {
  assert.equal(TV_GENRES_ES[DRAMA_ID], "Drama"); // diccionario D-S08

  const result = filterSeries(library, combined);
  assert.deepEqual(
    result.map((s) => s.id),
    ["all"]
  );
});

test("AC-S24 · al quitar un filtro solo entra la serie que ese filtro excluía", () => {
  const ids = (filters) => filterSeries(library, filters).map((s) => s.id);

  // Sin rango 8–10 entran las dos series que solo fallaban por la nota.
  assert.deepEqual(
    ids({ status: "watched", genreId: DRAMA_ID, collectionId: COLLECTION }),
    ["all", "rating", "no-rating"]
  );
  // Sin colección entra la serie sin colección (nota 9).
  assert.deepEqual(ids({ ...combined, collectionId: "" }), ["all", "collection"]);
  // Sin género entra la de Comedia (resto correcto).
  assert.deepEqual(ids({ ...combined, genreId: null }), ["all", "genre"]);
  // Sin estado entra la que está «en curso».
  assert.deepEqual(ids({ ...combined, status: "" }), ["all", "status"]);
  // Género distinto (Comedia) → solo la comedia, no las dramas.
  assert.deepEqual(ids({ ...combined, genreId: 35 }), ["genre"]);
});

test("AC-S24 · «Limpiar filtros» restaura la lista completa", () => {
  const cleared = filterSeries(library, DEFAULT_LIBRARY_FILTERS);
  assert.equal(cleared.length, library.length);
  assert.deepEqual(
    cleared.map((s) => s.id),
    library.map((s) => s.id)
  );

  // El estado por defecto de createLibraryFilters equivale a limpiar.
  const defaults = createLibraryFilters(combined).status === "watched"
    ? createLibraryFilters()
    : createLibraryFilters();
  assert.deepEqual(
    filterSeries(library, defaults).map((s) => s.id),
    library.map((s) => s.id)
  );
});
