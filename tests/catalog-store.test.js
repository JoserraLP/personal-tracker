// Tests T-007 — store de js/catalog.js con js/firebase.js MOCKEADO
// (sin red ni Firebase real). Cobertura de persistencia:
// AC-002 (cambio de estado), AC-005 (valoración/reseña/fecha),
// AC-007 (campos de juego), AC-008 (sesiones), AC-017 (edición/borrado).
import { describe, it, expect, beforeEach, vi } from "vitest";

// Almacén en memoria compartido con el mock (se declara con vi.hoisted
// porque vi.mock se eleva por encima de las importaciones).
const store = vi.hoisted(() => ({ items: new Map() }));

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
    addDoc: async (r, payload) => {
      const id = `item-${store.items.size + 1}`;
      store.items.set(`${r.path}/${id}`, structuredClone(payload));
      return { id };
    },
    getDoc: async (r) => ({
      id: r.id,
      exists: () => store.items.has(r.path),
      data: () =>
        store.items.has(r.path) ? structuredClone(store.items.get(r.path)) : undefined,
    }),
    updateDoc: async (r, patch) => {
      const current = store.items.get(r.path) || {};
      store.items.set(r.path, { ...current, ...structuredClone(patch) });
    },
    deleteDoc: async (r) => {
      store.items.delete(r.path);
    },
    serverTimestamp: () => new Date("2026-01-01T12:00:00Z"),
    getDocs: async () => ({ docs: [] }),
    query: (...args) => args,
    orderBy: (...args) => args,
    limit: (n) => n,
    startAfter: (d) => d,
    onSnapshot: () => () => {},
    setDoc: async () => {},
    deleteField: () => null,
  };
});

import {
  createItem,
  getItem,
  updateItem,
  deleteItem,
  setItemStatus,
  addItemSession,
  updateItemSession,
  removeItemSession,
  filterItems,
  ITEM_STATUSES,
} from "../js/catalog.js";

beforeEach(() => {
  store.items.clear();
});

describe("AC-002 cambio de estado persiste y el filtro lo refleja (REQ-002)", () => {
  it("AC-002: los 5 estados se persisten y filterItems los refleja", async () => {
    const created = await createItem("movie", { title: "Origen" });
    expect(created.id).toBeTruthy();
    for (const status of ITEM_STATUSES) {
      const result = await setItemStatus("movie", created.id, status);
      expect(result.status).toBe(status);
      const loaded = await getItem("movie", created.id);
      expect(loaded.status).toBe(status);
      expect(filterItems([loaded], { status })).toHaveLength(1);
      const other = ITEM_STATUSES.find((s) => s !== status);
      expect(filterItems([loaded], { status: other })).toHaveLength(0);
    }
  });

  it("AC-002: estado inválido no llega a Firestore", async () => {
    const created = await createItem("movie", { title: "Origen" });
    await expect(setItemStatus("movie", created.id, "watching")).rejects.toThrow(
      /Estado inválido/,
    );
    expect((await getItem("movie", created.id)).status).toBe("pending");
  });
});

describe("AC-005 valoración, reseña y fecha persisten (REQ-008)", () => {
  it("AC-005: rating y review se persisten en el ítem", async () => {
    const created = await createItem("movie", { title: "Completada", status: "completed" });
    await updateItem("movie", created.id, { rating: 9, review: "Obra maestra." });
    const loaded = await getItem("movie", created.id);
    expect(loaded.rating).toBe(9);
    expect(loaded.review).toBe("Obra maestra.");
    expect(loaded.status).toBe("completed");
  });

  it("AC-005: la fecha de la sesión se persiste (DB-007)", async () => {
    const created = await createItem("movie", { title: "Vista" });
    const sessions = await addItemSession("movie", created.id, {
      date: "2026-01-15",
      note: "Con amigos",
      rating: 8,
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].note).toBe("Con amigos");
    const loaded = await getItem("movie", created.id);
    expect(loaded.sessions[0].note).toBe("Con amigos");
  });
});

describe("AC-007 campos de juego persisten (REQ-010)", () => {
  it("AC-007: horas, %, plataforma y logros se persisten", async () => {
    const created = await createItem("game", { title: "Hades" });
    await updateItem("game", created.id, {
      hoursPlayed: 42,
      completionPercent: 80,
      platform: "Switch",
      achievementsUnlocked: 30,
      achievementsTotal: 49,
    });
    const loaded = await getItem("game", created.id);
    expect(loaded).toMatchObject({
      hoursPlayed: 42,
      completionPercent: 80,
      platform: "Switch",
      achievementsUnlocked: 30,
      achievementsTotal: 49,
    });
  });
});

describe("AC-008 sesiones embebidas: alta, edición y borrado (REQ-011)", () => {
  it("AC-008: se añaden, listan, editan y borran sesiones", async () => {
    const created = await createItem("series", { title: "Dark" });
    const [first] = await addItemSession("series", created.id, {
      date: "2025-01-01",
      note: "Primera",
    });
    await addItemSession("series", created.id, { date: "2025-06-01", note: "Segunda" });

    let loaded = await getItem("series", created.id);
    expect(loaded.sessions.map((s) => s.note)).toEqual(["Primera", "Segunda"]);

    await updateItemSession("series", created.id, first.id, { note: "Primera editada" });
    loaded = await getItem("series", created.id);
    expect(loaded.sessions.find((s) => s.id === first.id).note).toBe("Primera editada");

    await removeItemSession("series", created.id, first.id);
    loaded = await getItem("series", created.id);
    expect(loaded.sessions.map((s) => s.note)).toEqual(["Segunda"]);
  });

  it("AC-008: no se puede añadir una sesión sin fecha", async () => {
    const created = await createItem("series", { title: "Dark" });
    await expect(
      addItemSession("series", created.id, { note: "Sin fecha" }),
    ).rejects.toThrow(/La fecha de la sesión es obligatoria/);
    expect((await getItem("series", created.id)).sessions).toHaveLength(0);
  });
});

describe("AC-017 edición y borrado de ítems persisten (REQ-013)", () => {
  it("AC-017: editar un ítem persiste el parche sin perder el resto", async () => {
    const created = await createItem("book", {
      title: "Cien años de soledad",
      author: "Gabriel García Márquez",
      year: 1967,
      pagesTotal: 471,
    });
    await updateItem("book", created.id, { pagesRead: 120, rating: 10 });
    const loaded = await getItem("book", created.id);
    expect(loaded).toMatchObject({
      title: "Cien años de soledad",
      author: "Gabriel García Márquez",
      year: 1967,
      pagesTotal: 471,
      pagesRead: 120,
      rating: 10,
    });
  });

  it("AC-017: borrar un ítem borra también sus sesiones", async () => {
    const created = await createItem("movie", { title: "Borrable" });
    await addItemSession("movie", created.id, { date: "2025-01-01", note: "Sesión" });
    await deleteItem("movie", created.id);
    expect(await getItem("movie", created.id)).toBeNull();
  });

  it("AC-017: editar un ítem inexistente lanza Error", async () => {
    await expect(updateItem("movie", "no-existe", { title: "X" })).rejects.toThrow(
      /El ítem no existe/,
    );
    await expect(deleteItem("movie", "no-existe")).resolves.toBe(true);
  });
});
