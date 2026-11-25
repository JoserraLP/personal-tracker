// Tests T-129 (issue #75) — SEC-03 / AC-129: paridad de enum de estados.
//
// Given: la app escribe `status` con las claves de ENTRY_STATUSES
//        (js/catalog.js, MAYÚSCULAS) y firestore.rules valida el campo
//        con `data.status in [...]` en isValidEntry().
// When:  ambos orígenes se comparan sin deploy ni red (regex sobre el
//        archivo de reglas).
// Then:  las listas son idénticas (mismo conjunto, mismas mayúsculas),
//        de modo que una divergencia tipo SEC-03 («la app escribe en
//        MAYÚSCULAS pero las reglas lo niegan») nunca pueda volver a
//        colarse en silencio.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ENTRY_STATUSES } from "../js/catalog.js";

const RULES_SOURCE = readFileSync(
  fileURLToPath(new URL("../firestore.rules", import.meta.url)),
  "utf8",
);

/**
 * Extrae el enum de `status` del `isValidEntry()` de firestore.rules.
 * Si el patrón de las reglas cambia, devuelve [] y el test falla en
 * lugar de pasar en silencio.
 */
function rulesStatusEnum(source) {
  const match = source.match(/data\.status\s+in\s*\[([^\]]*)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const RULES_STATUSES = rulesStatusEnum(RULES_SOURCE);

describe("SEC-03/AC-129: ENTRY_STATUSES de la app == enum de status en firestore.rules", () => {
  it("SEC-03: firestore.rules expone el enum de status en isValidEntry()", () => {
    expect(RULES_SOURCE).toContain("function isValidEntry()");
    expect(RULES_STATUSES.length).toBeGreaterThan(0);
  });

  it("SEC-03: el enum de las reglas contiene exactamente ENTRY_STATUSES", () => {
    expect([...RULES_STATUSES].sort()).toEqual([...ENTRY_STATUSES].sort());
    expect(RULES_STATUSES).toHaveLength(ENTRY_STATUSES.length);
  });

  it("SEC-03: ambas listas usan solo claves en MAYÚSCULAS", () => {
    const uppercase = (list) =>
      list.every((s) => s === s.toUpperCase() && s === s.trim());
    expect(uppercase(ENTRY_STATUSES)).toBe(true);
    expect(uppercase(RULES_STATUSES)).toBe(true);
  });
});
