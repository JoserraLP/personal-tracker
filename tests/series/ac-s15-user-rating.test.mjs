// AC-S15 (ALG-S04): «7,5» se guarda como 7.5; «11» y «0,3» no se guardan y
// el error lleva el mensaje «Introduce una nota entre 0 y 10, en medios
// puntos.».

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseUserRating,
  UserRatingError,
  USER_RATING_ERROR_MESSAGE,
} from "../../js/series/seriesState.js";

test("AC-S15 · «7,5» se guarda como userRating 7.5", () => {
  assert.equal(parseUserRating("7,5"), 7.5);
  assert.equal(parseUserRating("7.5"), 7.5);
  assert.equal(parseUserRating("8"), 8);
  assert.equal(parseUserRating("10"), 10);
  assert.equal(parseUserRating("0"), 0);
});

test("AC-S15 · «11» no se guarda y muestra el mensaje exacto", () => {
  assert.throws(
    () => parseUserRating("11"),
    (error) => {
      assert.ok(error instanceof UserRatingError);
      assert.equal(
        error.message,
        "Introduce una nota entre 0 y 10, en medios puntos."
      );
      assert.equal(error.message, USER_RATING_ERROR_MESSAGE);
      return true;
    }
  );
});

test("AC-S15 · «0,3» no se guarda y muestra el mismo mensaje", () => {
  assert.throws(
    () => parseUserRating("0,3"),
    (error) =>
      error instanceof UserRatingError &&
      error.message === "Introduce una nota entre 0 y 10, en medios puntos."
  );
  // Ninguna de las inválidas produce un valor: no se guarda nada.
  assert.equal(parseUserRating(""), null);
  assert.equal(parseUserRating(null), null);
});
