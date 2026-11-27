// AC-S25 (ALG-S02): ordenar por «Título (A-Z)» respeta la colación es-ES;
// por «Mi puntuación» ninguna serie desaparece y las sin nota quedan al
// final; por «Progreso» las series con numberOfEpisodes: null quedan al final.

import assert from "node:assert/strict";
import test from "node:test";

import {
  sortSeries,
  SORT_OPTIONS,
} from "../../js/series/seriesState.js";

test("AC-S25 · «Título (A-Z)» usa colación es-ES (acentos ordenados como letras)", () => {
  const library = [
    { name: "Zapata" },
    { name: "Dark" },
    { name: "Ámbar" },
    { name: "dark" },
    { name: "Árbol" },
  ];

  const sorted = sortSeries(library, "name").map((s) => s.name);

  // Orden de letras es-ES: a < d < z, sin discriminar por código UTF-16.
  assert.deepEqual(sorted, ["Ámbar", "Árbol", "dark", "Dark", "Zapata"]);
});

test("AC-S25 · «Título (A-Z)» es una opción de orden con su etiqueta", () => {
  const option = SORT_OPTIONS.find((o) => o.value === "name");
  assert.equal(option.label, "Título (A-Z)");
  assert.equal(option.direction, "asc");
});

test("AC-S25 · «Mi puntuación» no descarta series y las sin nota van al final", () => {
  const library = [
    { name: "SinNota", userRating: null },
    { name: "Diez", userRating: 10 },
    { name: "Ocho", userRating: 8 },
    { name: "TambiénSinNota", userRating: undefined },
    { name: "SieteMedio", userRating: 7.5 },
  ];

  const sorted = sortSeries(library, "userRating");

  // Ninguna serie desaparece.
  assert.equal(sorted.length, library.length);
  // Descendente primero, luego las dos sin nota al final (desempate a-z).
  assert.deepEqual(
    sorted.map((s) => s.name),
    ["Diez", "Ocho", "SieteMedio", "SinNota", "TambiénSinNota"]
  );
});

test("AC-S25 · «Progreso» deja numberOfEpisodes null al final", () => {
  const library = [
    { name: "SinEpisodios", numberOfEpisodes: null, watchedEpisodesCount: 5 },
    { name: "Mitad", numberOfEpisodes: 24, watchedEpisodesCount: 6 },
    { name: "Casi", numberOfEpisodes: 10, watchedEpisodesCount: 9 },
    { name: "SinTotal", numberOfEpisodes: undefined, watchedEpisodesCount: 3 },
  ];

  const sorted = sortSeries(library, "progress");

  assert.equal(sorted.length, library.length);
  // Descendente por razón de progreso; los null al final.
  assert.deepEqual(
    sorted.map((s) => s.name),
    ["Casi", "Mitad", "SinEpisodios", "SinTotal"]
  );
});
