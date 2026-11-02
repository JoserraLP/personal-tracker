// Tests T-007 — parte pura de js/catalog.js (sin red ni Firebase).
// Cobertura: AC-008 (sesiones embebidas, DB-007 / D-004), AC-005 (fecha),
// AC-017 (edición/borrado de sesiones).
import { describe, it, expect } from "vitest";
import {
  addSession,
  updateSession,
  removeSession,
  findSession,
  sortSessionsByDateDesc,
  validateSession,
  normalizeSession,
} from "../js/catalog.js";

describe("AC-008 sesiones: alta y listado (DB-007, D-004)", () => {
  it("AC-008: addSession añade con fecha y nota y devuelve un array nuevo", () => {
    const before = [];
    const after = addSession(before, { date: "2025-03-01", note: "Con amigos", rating: 9 });
    expect(after).toHaveLength(1);
    expect(after[0].note).toBe("Con amigos");
    expect(after[0].rating).toBe(9);
    expect(typeof after[0].id).toBe("string");
    expect(after[0].id.length).toBeGreaterThan(0);
    expect(before).toHaveLength(0); // no muta el original
  });

  it("AC-008: varias sesiones se acumulan y se listan todas", () => {
    let sessions = addSession([], { date: "2024-01-01", note: "Primera" });
    sessions = addSession(sessions, { date: "2024-06-01", note: "Segunda" });
    sessions = addSession(sessions, { date: "2025-01-01", note: "Tercera" });
    expect(sessions.map((s) => s.note)).toEqual(["Primera", "Segunda", "Tercera"]);
    expect(findSession(sessions, sessions[1].id).note).toBe("Segunda");
  });

  it("AC-008: la fecha es obligatoria (se bloquea sin fecha)", () => {
    expect(() => addSession([], { note: "Sin fecha" })).toThrow(
      /La fecha de la sesión es obligatoria/,
    );
    expect(validateSession({ note: "x" }).valid).toBe(false);
    expect(validateSession({ date: "no-es-fecha" }).valid).toBe(false);
  });

  it("AC-008: el rating de la sesión debe ser entero 1-10", () => {
    expect(() => addSession([], { date: "2025-01-01", rating: 7.5 })).toThrow(
      /número entero/,
    );
    expect(() => addSession([], { date: "2025-01-01", rating: 0 })).toThrow(
      /entre 1 y 10/,
    );
    expect(() => addSession([], { date: "2025-01-01", rating: 11 })).toThrow(
      /entre 1 y 10/,
    );
    expect(() =>
      addSession([], { date: "2025-01-01", rating: 10, note: "ok" }),
    ).not.toThrow();
  });

  it("AC-008: nota de más de 500 caracteres se bloquea", () => {
    expect(() =>
      addSession([], { date: "2025-01-01", note: "x".repeat(501) }),
    ).toThrow(/no puede superar los 500 caracteres/);
  });
});

describe("AC-017 sesiones: edición y borrado persisten (REQ-013)", () => {
  it("AC-017: updateSession edita la sesión y devuelve un array nuevo", () => {
    const sessions = addSession([], { date: "2025-03-01", note: "Original", rating: 7 });
    const id = sessions[0].id;
    const edited = updateSession(sessions, id, { note: "Editada", rating: 8 });
    expect(edited).toHaveLength(1);
    expect(findSession(edited, id).note).toBe("Editada");
    expect(findSession(edited, id).rating).toBe(8);
    expect(findSession(edited, id).date).toBe("2025-03-01"); // conserva el resto
    expect(findSession(sessions, id).note).toBe("Original"); // no muta el original
  });

  it("AC-017: updateSession de una sesión inexistente lanza Error", () => {
    expect(() => updateSession([], "no-existe", { note: "x" })).toThrow(
      /No existe la sesión/,
    );
  });

  it("AC-017: removeSession borra la sesión y el cambio persiste", () => {
    let sessions = addSession([], { date: "2025-01-01", note: "Uno" });
    sessions = addSession(sessions, { date: "2025-02-01", note: "Dos" });
    const id = sessions[0].id;
    const after = removeSession(sessions, id);
    expect(after).toHaveLength(1);
    expect(findSession(after, id)).toBeNull();
    expect(after[0].note).toBe("Dos");
    expect(sessions).toHaveLength(2); // no muta el original
  });

  it("AC-017: removeSession es idempotente con id desconocido", () => {
    const sessions = addSession([], { date: "2025-01-01", note: "Uno" });
    expect(removeSession(sessions, "desconocida")).toHaveLength(1);
    expect(removeSession([], "desconocida")).toHaveLength(0);
  });
});

describe("AC-008 sesiones: ordenación por fecha (sortSessionsByDateDesc)", () => {
  it("AC-008: la sesión más reciente aparece primero", () => {
    const sessions = [
      normalizeSession({ date: "2023-01-01", note: "Vieja" }),
      normalizeSession({ date: new Date("2025-06-01T00:00:00Z"), note: "Nueva" }),
      normalizeSession({ date: "2024-01-01", note: "Media" }),
    ];
    const sorted = sortSessionsByDateDesc(sessions);
    expect(sorted.map((s) => s.note)).toEqual(["Nueva", "Media", "Vieja"]);
    expect(sessions.map((s) => s.note)).toEqual(["Vieja", "Nueva", "Media"]); // sin mutar
  });

  it("AC-008: acepta mezcla de Date, ISO y timestamp numérico", () => {
    const sessions = [
      normalizeSession({ date: 1704067200000, note: "ts" }), // 2024-01-01
      normalizeSession({ date: "2025-01-01", note: "iso" }),
      normalizeSession({ date: new Date("2026-01-01"), note: "date" }),
    ];
    const sorted = sortSessionsByDateDesc(sessions);
    expect(sorted.map((s) => s.note)).toEqual(["date", "iso", "ts"]);
  });
});

describe("AC-005 sesión: fecha de visionado (REQ-008)", () => {
  it("AC-005: una sesión con fecha, nota y valoración es válida", () => {
    const result = validateSession({
      date: "2025-05-20",
      note: "Repetición",
      rating: 8,
      progress: "1080p",
    });
    expect(result.valid).toBe(true);
  });
});
