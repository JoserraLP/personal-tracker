// Tests QA T-006 - AC-014 (REQ-002): deleteChapter con js/firebase.js MOCKEADO.
// Borrar el cap\u00edtulo elimina solo su doc y NO toca el \u00edtem padre.
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock de Firebase en memoria + registro de llamadas (vi.hoisted porque
// vi.mock se eleva por encima de las importaciones).
const mock = vi.hoisted(() => ({
  docs: new Map(),
  getDocCalls: [],
  getDocsCalls: [],
  updateCalls: [],
  deleteCalls: [],
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
    getDoc: async (r) => {
      mock.getDocCalls.push(r.path);
      return {
        id: r.id,
        exists: () => mock.docs.has(r.path),
        data: () => (mock.docs.has(r.path) ? structuredClone(mock.docs.get(r.path)) : undefined),
      };
    },
    getDocs: async (q) => {
      mock.getDocsCalls.push(q.path);
      return { docs: [] };
    },
    updateDoc: async (r, patch) => {
      mock.updateCalls.push({ path: r.path, patch: structuredClone(patch) });
      const current = mock.docs.get(r.path) || {};
      mock.docs.set(r.path, { ...current, ...structuredClone(patch) });
    },
    deleteDoc: async (r) => {
      mock.deleteCalls.push(r.path);
      mock.docs.delete(r.path);
    },
    serverTimestamp: () => new Date("2026-01-01T12:00:00Z"),
  };
});

import { deleteChapter } from "../js/catalog.js";

const CHAPTERS = "users/qa-user/chapters";
const SERIES = "users/qa-user/series";

beforeEach(() => {
  mock.docs.clear();
  mock.getDocCalls.length = 0;
  mock.getDocsCalls.length = 0;
  mock.updateCalls.length = 0;
  mock.deleteCalls.length = 0;
});

describe("AC-014 deleteChapter: borra el cap\u00edtulo sin tocar al padre", () => {
  it("AC-014: deleteDoc va sobre la ruta chapters y no se toca el doc del padre", async () => {
    mock.docs.set(`${SERIES}/s1`, { title: "Lost", isFavorite: true, collectionIds: ["a"] });
    mock.docs.set(`${CHAPTERS}/c1`, {
      title: "Cap 1",
      parentItemId: "s1",
      isFavorite: true,
      collectionIds: ["a"],
    });

    const result = await deleteChapter("c1");

    expect(result).toBe(true);
    expect(mock.deleteCalls).toEqual([`${CHAPTERS}/c1`]);
    expect(mock.updateCalls).toHaveLength(0);
    expect(mock.getDocCalls).toHaveLength(0);
    expect(mock.getDocsCalls).toHaveLength(0);
    // El \u00edtem padre queda intacto (incluido su favorito).
    expect(mock.docs.get(`${SERIES}/s1`)).toEqual({
      title: "Lost",
      isFavorite: true,
      collectionIds: ["a"],
    });
    expect(mock.docs.has(`${CHAPTERS}/c1`)).toBe(false);
  });
});
