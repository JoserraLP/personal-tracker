// AC-S09 (UI-S12): los cuatro valores internos de estado se muestran con la
// etiqueta española «Pendiente», «Viendo», «Completada» y «Abandonada»,
// nunca el valor interno en inglés.

import assert from "node:assert/strict";
import test from "node:test";

import {
  STATUS_LABELS,
  STATUS_OPTIONS,
} from "../../js/series/seriesState.js";

test("AC-S09 · los cuatro estados internos tienen etiqueta española visible", () => {
  assert.equal(STATUS_LABELS.watchlist, "Pendiente");
  assert.equal(STATUS_LABELS.watching, "Viendo");
  assert.equal(STATUS_LABELS.watched, "Completada");
  assert.equal(STATUS_LABELS.dropped, "Abandonada");
});

test("AC-S09 · nunca se muestra el valor interno en inglés", () => {
  const internalValues = ["watchlist", "watching", "watched", "dropped"];
  for (const value of internalValues) {
    const label = STATUS_LABELS[value];
    assert.equal(typeof label, "string");
    assert.notEqual(label, value);
    assert.match(label, /[^a-z]/); // contiene tildes/español, no la clave cruda
  }
});

test("AC-S09 · el selector de estado usa las mismas etiquetas", () => {
  assert.equal(STATUS_OPTIONS.length, 4);
  for (const option of STATUS_OPTIONS) {
    assert.equal(option.label, STATUS_LABELS[option.value]);
    assert.notEqual(option.label, option.value);
  }
});
