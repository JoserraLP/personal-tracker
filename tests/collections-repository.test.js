// Tests QA T-109 (GitHub #55) — spec 03 AC-125..AC-128 / API-13, API-14;
// spec 01 DB-104, DB-117, DB-123; REQ-206/207/208.
//
// Sin red y sin Firebase (API-14): store falso en memoria definido en
// este mismo archivo e inyectado en `createCollectionRepository()`.
// Solo se importan módulos de `js/repositories/` (carga perezosa del
// SDK de Firebase, REQ-C1): nada toca `js/` ni la red.
//
// AC-128 se cubra en AMBAS direcciones que la spec y el contrato del
// módulo describen:
//   a) borrar la ENTRY de tracking ⇒ la colección sigue con el
//      `mediaId` y `catalog` intacto (wording literal de AC-128);
//   b) borrar la COLECCIÓN ⇒ solo desaparece su doc; entries y
//      catalog no se tocan (cabecera de collection-repository.js).

import { describe, expect, it } from "vitest";
import {
  MAX_COLLECTIONS_PER_USER,
  MAX_COLLECTION_ITEMS,
  SERVER_TIMESTAMP,
  createCollectionRepository,
} from "../js/repositories/collection-repository.js";
import { createTrackingRepository } from "../js/repositories/tracking-repository.js";

const BASE = Date.UTC(2026, 0, 1);
const AT = (ms) => new Date(ms);

// -------------------------------------------------------------
// Store falso en memoria (contrato de la cabecera del repositorio)
// -------------------------------------------------------------
function createFakeStore() {
  const collections = new Map(); // `${uid}/${collectionId}` -> data
  const entries = new Map(); // `${uid}/${mediaId}` -> data
  const catalog = new Map(); // mediaId -> data (catálogo, solo lectura)
  const writes = []; // escrituras sobre colecciones
  const entryWrites = []; // escrituras sobre entries

  const key = (uid, id) => `${uid}/${id}`;
  const prefix = (uid) => `${uid}/`;
  const resolveStamp = (value) =>
    value === SERVER_TIMESTAMP ? new Date() : value;
  const resolveData = (data) => {
    const copy = {};
    for (const [field, value] of Object.entries(data)) {
      copy[field] = resolveStamp(value);
    }
    return copy;
  };
  const notFound = (message = "missing") => {
    const error = new Error(message);
    error.code = "not-found";
    return error;
  };

  return {
    collections,
    entries,
    catalog,
    writes,
    entryWrites,
    lastListSpec: null,

    // --- Collection store ---
    async listCollections(uid, spec) {
      this.lastListSpec = spec;
      const docs = [];
      for (const [k, data] of collections) {
        if (k.startsWith(prefix(uid))) {
          docs.push({ id: k.slice(uid.length + 1), ...data });
        }
      }
      return { docs };
    },
    async getCollection(uid, collectionId) {
      const data = collections.get(key(uid, collectionId));
      return data ? { id: collectionId, ...data } : null;
    },
    async countCollections(uid) {
      let count = 0;
      for (const k of collections.keys()) {
        if (k.startsWith(prefix(uid))) count += 1;
      }
      return count;
    },
    async createCollection(uid, data) {
      writes.push({ op: "create", uid, id: data.id, data });
      collections.set(key(uid, data.id), resolveData(data));
      return { ...data };
    },
    async updateCollection(uid, collectionId, patch) {
      writes.push({ op: "update", uid, id: collectionId, patch });
      const prev = collections.get(key(uid, collectionId));
      if (!prev) throw notFound();
      const merged = { ...prev, ...resolveData(patch) };
      collections.set(key(uid, collectionId), merged);
      return { id: collectionId, ...resolveData(patch) };
    },
    async deleteCollection(uid, collectionId) {
      writes.push({ op: "delete", uid, id: collectionId });
      collections.delete(key(uid, collectionId));
      return true;
    },

    // --- Tracking store (solo para AC-128: borrar la entry) ---
    async getEntry(uid, mediaId) {
      const data = entries.get(key(uid, mediaId));
      return data ? { id: mediaId, ...data } : null;
    },
    async upsertEntry(uid, mediaId, data) {
      entryWrites.push({ op: "upsert", mediaId, data });
      const merged = { ...(entries.get(key(uid, mediaId)) ?? {}), ...data };
      entries.set(key(uid, mediaId), merged);
      return { id: mediaId, ...merged };
    },
    async updateEntry(uid, mediaId, patch) {
      entryWrites.push({ op: "update", mediaId, patch });
      const prev = entries.get(key(uid, mediaId));
      if (!prev) throw notFound();
      const merged = { ...prev, ...patch };
      entries.set(key(uid, mediaId), merged);
      return { id: mediaId, ...merged };
    },
    async deleteEntry(uid, mediaId) {
      entryWrites.push({ op: "delete", mediaId });
      entries.delete(key(uid, mediaId));
      return true;
    },
    async queryEntries(uid) {
      const docs = [];
      for (const [k, data] of entries) {
        if (k.startsWith(prefix(uid))) {
          docs.push({ id: k.slice(uid.length + 1), ...data });
        }
      }
      return { docs };
    },
  };
}

/** Repo con ids deterministas (`col-01`, `col-02`, …). */
function makeRepo(store, options = {}) {
  let counter = 0;
  return createCollectionRepository(store, {
    newId: () => `col-${String(++counter).padStart(2, "0")}`,
    ...options,
  });
}

/** Siembra una colección directamente en el store (sin escritura registrada). */
function seedCollection(store, uid, collectionId, overrides = {}) {
  store.collections.set(keyOf(uid, collectionId), {
    name: collectionId,
    description: null,
    itemIds: [],
    createdAt: AT(BASE),
    updatedAt: AT(BASE),
    ...overrides,
  });
}

function keyOf(uid, collectionId) {
  return `${uid}/${collectionId}`;
}

// -------------------------------------------------------------
// AC-125 (REQ-206 / API-13): addItem idempotente, sin duplicados
// -------------------------------------------------------------
describe("AC-125 addItem idempotente (arrayUnion)", () => {
  it("AC-125: crear Favoritos, añadir 2 ítems y reañadir id1 ⇒ sigue con 2, sin escritura", async () => {
    const store = createFakeStore(); // 0 colecciones
    const repo = makeRepo(store);

    const created = await repo.create("u1", { name: "Favoritos" });
    expect(created.ok).toBe(true);
    expect(created.value.name).toBe("Favoritos");
    expect(created.value.itemIds).toEqual([]);

    const collectionId = created.value.id;
    const first = await repo.addItem("u1", collectionId, "id1");
    expect(first.ok).toBe(true);
    expect(first.value.itemIds).toEqual(["id1"]);

    const second = await repo.addItem("u1", collectionId, "id2");
    expect(second.ok).toBe(true);
    expect(second.value.itemIds).toEqual(["id1", "id2"]);

    // Reañadir id1: arrayUnion no duplica y no vuelve a escribir.
    const writesBefore = store.writes.length;
    const repeat = await repo.addItem("u1", collectionId, "id1");
    expect(repeat.ok).toBe(true);
    expect(repeat.value.itemIds).toEqual(["id1", "id2"]);
    expect(repeat.value.itemIds).toHaveLength(2);
    expect(store.writes.length).toBe(writesBefore);
    expect(store.collections.get(keyOf("u1", collectionId)).itemIds).toEqual([
      "id1",
      "id2",
    ]);

    // La lectura posterior también devuelve 2 ítems sin duplicados.
    const read = await repo.get("u1", collectionId);
    expect(read.ok).toBe(true);
    expect(read.value.itemIds).toEqual(["id1", "id2"]);
  });
});

// -------------------------------------------------------------
// AC-126 (REQ-206 / DB-104): la 21.ª colección ⇒ validación sin escritura
// -------------------------------------------------------------
describe("AC-126 máximo de 20 colecciones", () => {
  it("AC-126: con 20 colecciones, la 21.ª ⇒ validation «Máximo 20 colecciones» y cero escrituras", async () => {
    const store = createFakeStore();
    for (let i = 1; i < MAX_COLLECTIONS_PER_USER; i += 1) {
      seedCollection(store, "u1", `col-${i}`);
    }
    const repo = makeRepo(store);

    // La 20.ª sigue siendo válida (el límite es 20, no 19).
    const twentieth = await repo.create("u1", { name: "La 20.ª" });
    expect(twentieth.ok).toBe(true);
    expect(store.writes).toHaveLength(1);
    expect(store.collections.size).toBe(MAX_COLLECTIONS_PER_USER);

    // La 21.ª: validación, sin escritura.
    const writesBefore = store.writes.length;
    const twentyFirst = await repo.create("u1", { name: "La 21.ª" });
    expect(twentyFirst.ok).toBe(false);
    expect(twentyFirst.code).toBe("validation");
    expect(twentyFirst.message).toMatch(/Máximo 20 colecciones/);
    expect(store.writes.length).toBe(writesBefore);
    expect(store.collections.size).toBe(MAX_COLLECTIONS_PER_USER);
    expect(store.collections.has(keyOf("u1", "col-21"))).toBe(false);
  });
});

// -------------------------------------------------------------
// AC-127 (REQ-207): "Quitar" solo actualiza itemIds (+updatedAt)
// -------------------------------------------------------------
describe("AC-127 removeItem solo toca itemIds", () => {
  it("AC-127: el patch de removeItem contiene SOLO itemIds y updatedAt", async () => {
    const store = createFakeStore();
    seedCollection(store, "u1", "c1", {
      name: "Favoritos",
      description: "mis cosas",
      itemIds: ["m1", "m2"],
    });
    store.entries.set("u1/m1", { mediaId: "m1", status: "PLANNED" });
    store.catalog.set("m1", { id: "m1", title: "Origen" });
    const repo = makeRepo(store);

    const result = await repo.removeItem("u1", "c1", "m1");
    expect(result.ok).toBe(true);
    expect(result.value.itemIds).toEqual(["m2"]);
    expect(result.value.name).toBe("Favoritos");

    // Única escritura: SOLO itemIds (+updatedAt con serverTimestamp).
    expect(store.writes).toHaveLength(1);
    const write = store.writes[0];
    expect(write.op).toBe("update");
    expect(Object.keys(write.patch).sort()).toEqual(["itemIds", "updatedAt"]);
    expect(write.patch.updatedAt).toBe(SERVER_TIMESTAMP);
    expect(write.patch).not.toHaveProperty("name");
    expect(write.patch).not.toHaveProperty("description");
    expect(write.patch).not.toHaveProperty("createdAt");

    // name/description/createdAt intactos en el doc persistido.
    const doc = store.collections.get(keyOf("u1", "c1"));
    expect(doc.name).toBe("Favoritos");
    expect(doc.description).toBe("mis cosas");
    expect(doc.createdAt).toEqual(AT(BASE));
    expect(doc.itemIds).toEqual(["m2"]);

    // REQ-207: quitar el ítem NO borra su entry de tracking ni toca catalog.
    expect(store.entries.has("u1/m1")).toBe(true);
    expect(store.catalog.get("m1")).toEqual({ id: "m1", title: "Origen" });
  });

  it("AC-127: con store.removeItem atómico solo se delega (uid, id, mediaId)", async () => {
    const store = createFakeStore();
    seedCollection(store, "u1", "c1", {
      name: "Favoritos",
      itemIds: ["m1", "m2"],
    });
    const atomicCalls = [];
    store.removeItem = async (uid, collectionId, mediaId) => {
      atomicCalls.push([uid, collectionId, mediaId]);
      const doc = store.collections.get(keyOf(uid, collectionId));
      doc.itemIds = doc.itemIds.filter((id) => id !== mediaId);
      doc.updatedAt = new Date();
    };
    const repo = makeRepo(store);

    const result = await repo.removeItem("u1", "c1", "m1");
    expect(result.ok).toBe(true);
    expect(result.value.itemIds).toEqual(["m2"]);
    expect(result.value.name).toBe("Favoritos");
    expect(atomicCalls).toEqual([["u1", "c1", "m1"]]);
    // La ruta atómica no pasa por updateCollection: nada más se toca.
    expect(store.writes).toHaveLength(0);
    expect(store.collections.get(keyOf("u1", "c1")).name).toBe("Favoritos");
    expect(store.collections.get(keyOf("u1", "c1")).itemIds).toEqual(["m2"]);
  });
});

// -------------------------------------------------------------
// AC-128 (REQ-208): borrados sin daños colaterales
// -------------------------------------------------------------
describe("AC-128 borrado de entry/collection sin tocar el resto", () => {
  it("AC-128: borrar la entry deja la colección con el mediaId y el catalog intacto", async () => {
    const store = createFakeStore();
    seedCollection(store, "u1", "c1", { name: "Favoritos", itemIds: ["m1"] });
    store.entries.set("u1/m1", { mediaId: "m1", status: "IN_PROGRESS", score: 8 });
    store.catalog.set("m1", { id: "m1", title: "Origen", year: 2010 });

    const tracking = createTrackingRepository(store);
    const deleted = await tracking.deleteEntry("u1", "m1");
    expect(deleted.ok).toBe(true);
    expect(deleted.value).toBe(true);

    // La entry desaparece…
    expect(store.entries.has("u1/m1")).toBe(false);
    expect(store.entryWrites.map((w) => w.op)).toEqual(["delete"]);

    // …la colección sigue con el mediaId…
    expect(store.collections.get(keyOf("u1", "c1")).itemIds).toEqual(["m1"]);
    expect(store.writes).toHaveLength(0); // ni una escritura en colecciones
    const repo = makeRepo(store);
    const read = await repo.get("u1", "c1");
    expect(read.ok).toBe(true);
    expect(read.value.itemIds).toEqual(["m1"]);

    // …y el catalog intacto.
    expect(store.catalog.get("m1")).toEqual({ id: "m1", title: "Origen", year: 2010 });
  });

  it("AC-128: borrar la colección solo borra su doc; entries y catalog intactos", async () => {
    const store = createFakeStore();
    seedCollection(store, "u1", "c1", { name: "Favoritos", itemIds: ["m1"] });
    seedCollection(store, "u1", "c2", { name: "Pendientes", itemIds: ["m2"] });
    store.entries.set("u1/m1", { mediaId: "m1", status: "PLANNED" });
    store.catalog.set("m1", { id: "m1", title: "Origen" });
    const repo = makeRepo(store);

    const result = await repo.delete("u1", "c1");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);

    expect(store.collections.has(keyOf("u1", "c1"))).toBe(false);
    expect(store.collections.has(keyOf("u1", "c2"))).toBe(true);
    expect(store.entries.has("u1/m1")).toBe(true);
    expect(store.catalog.get("m1")).toEqual({ id: "m1", title: "Origen" });
    expect(store.writes.map((w) => w.op)).toEqual(["delete"]);
    expect(store.entryWrites).toHaveLength(0);
  });
});

// -------------------------------------------------------------
// DB-117 (API-10): list ordenado por updatedAt DESC + id ASC
// -------------------------------------------------------------
describe("DB-117 list ordenado updatedAt DESC", () => {
  it("list(...) ordena updatedAt DESC con desempate por id ASC y limit 20", async () => {
    const store = createFakeStore();
    seedCollection(store, "u1", "a", { updatedAt: AT(BASE + 1000) });
    seedCollection(store, "u1", "b", { updatedAt: AT(BASE + 3000) });
    seedCollection(store, "u1", "c", { updatedAt: AT(BASE + 2000) });
    // Empate de updatedAt ⇒ desempata por id ASC (d antes que e).
    seedCollection(store, "u1", "e", { updatedAt: AT(BASE + 4000) });
    seedCollection(store, "u1", "d", { updatedAt: AT(BASE + 4000) });
    const repo = makeRepo(store);

    const result = await repo.list("u1");
    expect(result.ok).toBe(true);
    expect(result.value.map((collection) => collection.id)).toEqual([
      "d",
      "e",
      "b",
      "c",
      "a",
    ]);

    expect(store.lastListSpec.orderBy).toEqual([
      { field: "updatedAt", direction: "desc" },
      { field: "__name__", direction: "asc" },
    ]);
    expect(store.lastListSpec.limit).toBe(MAX_COLLECTIONS_PER_USER);
    expect(store.lastListSpec.filters).toEqual([]);
  });
});

// -------------------------------------------------------------
// API-13 (DB-104, DB-123): itemIds ≤ 50
// -------------------------------------------------------------
describe("API-13 addItem no excede 50 ítems", () => {
  it("API-13: con 50 ítems, añadir uno nuevo ⇒ validation sin escritura; reañadir uno existente sigue ok", async () => {
    const store = createFakeStore();
    const ids50 = Array.from({ length: MAX_COLLECTION_ITEMS }, (_, i) => `m${i}`);
    seedCollection(store, "u1", "c1", { name: "Favoritos", itemIds: ids50 });
    seedCollection(store, "u1", "c2", { name: "Casi lleno", itemIds: ids50.slice(0, 49) });
    const repo = makeRepo(store);

    // 50 ya llenos ⇒ el 51.º es validación y no escribe.
    const overflow = await repo.addItem("u1", "c1", "m-nuevo");
    expect(overflow.ok).toBe(false);
    expect(overflow.code).toBe("validation");
    expect(overflow.message).toMatch(/más de 50 ítems/);
    expect(store.writes).toHaveLength(0);
    expect(store.collections.get(keyOf("u1", "c1")).itemIds).toHaveLength(50);

    // Idempotencia también al límite: reañadir m0 no duplica ni escribe.
    const repeat = await repo.addItem("u1", "c1", "m0");
    expect(repeat.ok).toBe(true);
    expect(repeat.value.itemIds).toHaveLength(50);
    expect(store.writes).toHaveLength(0);

    // 49 → 50 sí está permitido.
    const fiftieth = await repo.addItem("u1", "c2", "m49");
    expect(fiftieth.ok).toBe(true);
    expect(fiftieth.value.itemIds).toHaveLength(50);
    expect(store.collections.get(keyOf("u1", "c2")).itemIds).toHaveLength(50);
  });
});
