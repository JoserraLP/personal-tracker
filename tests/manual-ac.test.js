// Tests T-128 (issue #74) — ACs MANUALES: se listan como it.todo para que
// aparezcan en el reporte de Vitest hasta verificarse a mano.
//
// Por qué son manuales (spec 00 §2: los tests no usan red ni Firebase):
//   - AC-100 / AC-101 / AC-129: exigen Firestore rules EN VIVO (usuarios
//     reales contra firestore.rules), no el fake store de tests/fakes.js.
//     La parte simulable ya está cubierta: AC-129 en
//     tests/ac-120-tracking-repository.test.js y tests/tracking-repository.test.js.
//   - AC-116 UI / AC-117 UI / AC-127 UI: verificación visual/DOM en navegador
//     real (4 vistas con el mismo MediaCard, menú de estado de la tarjeta,
//     apertura de colección). La parte de import/paridad de código ya está en
//     tests/ac-116-media-card-shared.test.js y la de "Quitar" (solo itemIds)
//     en tests/collections-repository.test.js.
//
// REQ-C4 (spec 00): nombre tests/manual-ac.test.js = <área>-<tema>.test.js y
// cada it() cita el ID que cubre.

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";

describe("ACs manuales pendientes de verificación manual (T-128)", () => {
  it.todo(
    "AC-100 (SEC-01): Usuario A autenticado intenta leer/escribir users/{B}/entries/* ⇒ " +
      "Firestore rechaza con permission_denied; A solo accede a users/{A}/** (rules en vivo)",
  );

  it.todo(
    "AC-101 (SEC-02): Usuario autenticado intenta setDoc sobre catalog/{id} ⇒ " +
      "Rechazado (write: false); lectura permitida si está en allowlist (rules en vivo)",
  );

  it.todo(
    "AC-116 UI (REQ-106): Las 4 vistas (Catálogo, Búsqueda, Colecciones, Recomendaciones) " +
      "renderizan tarjetas con el mismo componente MediaCard (mismo DOM/estilos) en el navegador",
  );

  it.todo(
    "AC-117 UI (REQ-107): Tarjeta con entry IN_PROGRESS → Menú → COMPLETED: " +
      "entry persiste con updatedAt nuevo; puntuación personal visible en la tarjeta (DOM real)",
  );

  it.todo(
    "AC-127 UI (REQ-207): Colección con 2 ítems se abre ⇒ renderiza 2 MediaCard; " +
      "«Quitar» solo actualiza itemIds (verificación visual en navegador)",
  );

  it.todo(
    "AC-129 (SEC-01) manual: Usuario A intenta upsertEntry en users/{B}/entries/x ⇒ " +
      "permission_denied real de Firestore rules, sin datos modificados (rules en vivo)",
  );

  it("REQ-C4: este archivo cumple el patrón tests/<área>-<tema>.test.js y cita su ID", () => {
    const basename = path.basename(fileURLToPath(import.meta.url));
    expect(basename).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.test\.js$/);
    // REQ-C4 exige que cada it() cite el ID que cubre: los it.todo de arriba
    // citan AC-100/101/116/117/127/129 y este cita REQ-C4.
    expect(basename).toBe("manual-ac.test.js");
  });
});
