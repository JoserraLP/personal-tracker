// Tests QA T-006 - AC-009 (REQ-006, D-004, regresi\u00f3n del fix T-003):
// deleteCollection y removeTargetFromCollection con js/firebase.js MOCKEADO.
// Un doc con collectionIds ["a","b"] queda en ["b"] al desvincular "a"
// (NO se pierden el resto de ids) y arrayRemove NO se usa.
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock de Firebase en memoria + registro de llamadas (vi.hoisted porque
// vi.mock se eleva por encima de las importaciones).
const mock = vi.hoisted(() => ({
  docs: new Map(),
  updateCalls: [],
  deleteCalls: [],
  arrayRemoveCalls: [],
  failUpdatePaths: new Set(),
}));

vi.mock("../js/firebase.js", () => {
  const ref = (...segments) => ({
    path: segments.map(String).join("/"),
    id: String(segments[segments.length - 1]),
  });
  return {
    db: {},
    auth: { currentUser: { uid: "qa-user" } },
    collection: (_db, ...segments) => ref(...segments),
    doc: (_db, ...segments) => ref(...segments),
    query: (q) => q,
    getDoc: async (r) => ({
      id: r.id,
      exists: () => mock.docs.has(r.path),
      data: () => (mock.docs.has(r.path) ? structuredClone(mock.docs.get(r.path)) : undefined),
    }),
    getDocs: async (q) => {
      const prefix = `${q.path}/`;
      const docs = [...mock.docs.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => structuredClone(data) }));
      return { docs };
    },
    updateDoc: async (r, patch) => {
      mock.updateCalls.push({ path: r.path, patch: structuredClone(patch) });
      if (mock.failUpdatePaths.has(r.path)) throw new Error("update denegado");
      const current = mock.docs.get(r.path) || {};
      mock.docs.set(r.path, { ...current, ...structuredClone(patch) });
    },
    deleteDoc: async (r) => {
      mock.deleteCalls.push(r.path);
      mock.docs.delete(r.path);
    },
    serverTimestamp: () => new Date("2026-01-01T12:00:00Z"),
    // arrayRemove se expone SOLO para poder afirmar que no se usa (T-003).
    arrayRemove: (...args) => {
      mock.arrayRemoveCalls.push(args);
      return { __arrayRemove: args };
    },
  };
});

import { deleteCollection, removeTargetFromCollection } from "../js/catalog.js";

const MOVIES = "users/qa-user/movies";
const SERIES = "users/qa-user/series";
const CHAPTERS = "users/qa-user/chapters";
const COLLECTIONS = "users/qa-user/collections";

beforeEach(() => {
  mock.docs.clear();
  mock.updateCalls.length = 0;
  mock.deleteCalls.length = 0;
  mock.arrayRemoveCalls.length = 0;
  mock.failUpdatePaths.clear();
});

describe("AC-009 removeTargetFromCollection: desvincular sin perder ids (T-003)", () => {
  it("AC-009: un \u00edtem con [\"a\",\"b\"] queda en [\"b\"] al desvincular \"a\"", async () => {
    mock.docs.set(`${MOVIES}/m1`, { title: "Origen", collectionIds: ["a", "b"] });
    const result = await removeTargetFromCollection("item", "m1", "a", "movie");
    expect(result.collectionIds).toEqual(["b"]);
    const update = mock.updateCalls.find((call) => call.path === `${MOVIES}/m1`);
    expect(update.patch.collectionIds).toEqual(["b"]);
  });

  it("AC-009: un cap\u00edtulo con [\"a\",\"b\"] queda en [\"b\"] al desvincular \"a\"", async () => {
    mock.docs.set(`${CHAPTERS}/c1`, { title: "Cap", collectionIds: ["a", "b"] });
    const result = await removeTargetFromCollection("chapter", "c1", "a");
    expect(result.collectionIds).toEqual(["b"]);
    const update = mock.updateCalls.find((call) => call.path === `${CHAPTERS}/c1`);
    expect(update.patch.collectionIds).toEqual(["b"]);
  });

  it("AC-009: arrayRemove no se usa en removeTargetFromCollection", async () => {
    mock.docs.set(`${MOVIES}/m1`, { title: "Origen", collectionIds: ["a", "b"] });
    await removeTargetFromCollection("item", "m1", "a", "movie");
    expect(mock.arrayRemoveCalls).toHaveLength(0);
  });
});

describe("AC-009 deleteCollection: desvincula sin borrar (D-004)", () => {
  it("AC-009: al borrar \"a\" los docs [\"a\",\"b\"] quedan en [\"b\"] y la colecci\u00f3n desaparece", async () => {
    mock.docs.set(`${MOVIES}/m1`, { title: "Origen", collectionIds: ["a", "b"] });
    mock.docs.set(`${SERIES}/s1`, { title: "Lost", collectionIds: ["b"] });
    mock.docs.set(`${CHAPTERS}/c1`, { title: "Cap", collectionIds: ["a", "b"] });
    mock.docs.set(`${COLLECTIONS}/a`, { name: "Terror" });

    const result = await deleteCollection("a");

    expect(result.deleted).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.unlinkedItems).toBe(1);
    expect(result.unlinkedChapters).toBe(1);
    // El resto de ids NO se pierde.
    expect(mock.docs.get(`${MOVIES}/m1`).collectionIds).toEqual(["b"]);
    expect(mock.docs.get(`${CHAPTERS}/c1`).collectionIds).toEqual(["b"]);
    // Los que no pertenec\u00edan no se tocan.
    expect(mock.updateCalls.some((call) => call.path === `${SERIES}/s1`)).toBe(false);
    // Solo se borra el doc de la colecci\u00f3n, nunca los \u00edtems/cap\u00edtulos (D-004).
    expect(mock.deleteCalls).toEqual([`${COLLECTIONS}/a`]);
    expect(mock.docs.has(`${MOVIES}/m1`)).toBe(true);
    expect(mock.docs.has(`${CHAPTERS}/c1`)).toBe(true);
  });

  it("AC-009: failures se reporta si alg\u00fan updateDoc rechaza", async () => {
    mock.docs.set(`${MOVIES}/m1`, { title: "Origen", collectionIds: ["a"] });
    mock.docs.set(`${MOVIES}/m2`, { title: "Dune", collectionIds: ["a"] });
    mock.docs.set(`${COLLECTIONS}/a`, { name: "Terror" });
    mock.failUpdatePaths.add(`${MOVIES}/m2`);

    const result = await deleteCollection("a");

    expect(result.deleted).toBe(true);
    expect(result.unlinkedItems).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ kind: "item", id: "m2", mediaType: "movie" });
    expect(result.failures[0].error).toBeInstanceOf(Error);
    // El doc que fall\u00f3 conserva sus ids originales (reintento posible).
    expect(mock.docs.get(`${MOVIES}/m2`).collectionIds).toEqual(["a"]);
  });

  it("AC-009: arrayRemove no se usa en deleteCollection", async () => {
    mock.docs.set(`${MOVIES}/m1`, { title: "Origen", collectionIds: ["a"] });
    mock.docs.set(`${COLLECTIONS}/a`, { name: "Terror" });
    await deleteCollection("a");
    expect(mock.arrayRemoveCalls).toHaveLength(0);
    const update = mock.updateCalls.find((call) => call.path === `${MOVIES}/m1`);
    expect(Array.isArray(update.patch.collectionIds)).toBe(true);
    expect(update.patch.collectionIds).not.toContain("a");
  });
});
