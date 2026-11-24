// Tests de aceptación de js/repositories/tracking-repository.js
// (spec 03 AC-120..AC-124, AC-129 / API-10..API-12; spec 01 DB-103,
// DB-114..DB-116, SEC-01). Sin red: store falso inyectado.

import { describe, expect, it } from "vitest";
import {
  SERVER_TIMESTAMP,
  createTrackingRepository,
} from "../js/repositories/tracking-repository.js";

/** Store falso en memoria con contrato de la cabecera del módulo. */
function createFakeStore() {
  const docs = new Map(); // `${uid}/${mediaId}` -> data
  const calls = { get: 0, upsert: 0, update: 0, del: 0, query: 0, writes: [] };
  return {
    docs,
    calls,
    async getEntry(uid, mediaId) {
      calls.get += 1;
      const doc = docs.get(`${uid}/${mediaId}`);
      return doc ? { id: mediaId, ...doc } : null;
    },
    async getMedia(mediaId) {
      return null;
    },
    async upsertEntry(uid, mediaId, data) {
      calls.upsert += 1;
      calls.writes.push({ op: "upsert", uid, mediaId, data });
      const prev = docs.get(`${uid}/${mediaId}`) ?? {};
      const merged = { ...prev, ...data };
      docs.set(`${uid}/${mediaId}`, merged);
      return { id: mediaId, ...merged };
    },
    async updateEntry(uid, mediaId, patch) {
      calls.update += 1;
      calls.writes.push({ op: "update", uid, mediaId, data: patch });
      const prev = docs.get(`${uid}/${mediaId}`);
      if (!prev) {
        const error = new Error("missing");
        error.code = "not-found";
        throw error;
      }
      const merged = { ...prev, ...patch };
      docs.set(`${uid}/${mediaId}`, merged);
      return { id: mediaId, ...merged };
    },
    async deleteEntry(uid, mediaId) {
      calls.del += 1;
      docs.delete(`${uid}/${mediaId}`);
      return true;
    },
    async queryEntries(uid, spec) {
      calls.query += 1;
      calls.lastSpec = spec;
      const items = [];
      for (const [key, value] of docs) {
        if (key.startsWith(`${uid}/`)) {
          items.push({ id: key.slice(uid.length + 1), ...value });
        }
      }
      return { docs: items };
    },
  };
}

function makeRepo(store, options = {}) {
  return createTrackingRepository(store, options);
}

// -------------------------------------------------------------
// AC-120 (REQ-201): upsert crea exactamente 1 doc por mediaId
// -------------------------------------------------------------
describe("AC-120", () => {
  it("crea una única entry con status PLANNED y el segundo clic no duplica", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);

    const first = await repo.upsertEntry("u1", "seed-42", {});
    expect(first.ok).toBe(true);
    expect(first.value.status).toBe("PLANNED");
    expect(first.value.mediaId).toBe("seed-42");

    const second = await repo.upsertEntry("u1", "seed-42", {});
    expect(second.ok).toBe(true);

    expect(store.docs.size).toBe(1);
    expect(store.docs.has("u1/seed-42")).toBe(true);
    expect(store.calls.upsert).toBe(2);
    expect(store.docs.get("u1/seed-42").status).toBe("PLANNED");

    const read = await repo.getEntry("u1", "seed-42");
    expect(read.ok).toBe(true);
    expect(read.value.mediaId).toBe("seed-42");
  });
});

// -------------------------------------------------------------
// AC-121 (REQ-202): cambio de estado persiste
// -------------------------------------------------------------
describe("AC-121", () => {
  it("setStatus PLANNED -> COMPLETED persiste en el store", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);
    await repo.upsertEntry("u1", "m1", {});

    const changed = await repo.setStatus("u1", "m1", "COMPLETED");
    expect(changed.ok).toBe(true);
    expect(changed.value.status).toBe("COMPLETED");
    expect(store.docs.get("u1/m1").status).toBe("COMPLETED");

    const list = await repo.listEntries("u1", { status: "COMPLETED" });
    expect(list.ok).toBe(true);
    expect(list.value.items.map((entry) => entry.mediaId)).toEqual(["m1"]);
  });
});

// -------------------------------------------------------------
// AC-122 (REQ-203): score 7 + review persisten; 11 / 10.5 validan
// -------------------------------------------------------------
describe("AC-122", () => {
  it("score 7 y review válidos persisten", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);
    await repo.upsertEntry("u1", "m1", {});

    const result = await repo.upsertEntry("u1", "m1", {
      score: 7,
      review: "Muy buena",
    });
    expect(result.ok).toBe(true);
    expect(result.value.score).toBe(7);
    expect(result.value.review).toBe("Muy buena");
    expect(store.docs.get("u1/m1").score).toBe(7);
    expect(store.docs.get("u1/m1").review).toBe("Muy buena");
  });

  it("score 11 y 10.5 => validation SIN escritura (API-12)", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);
    await repo.upsertEntry("u1", "m1", {});
    const writesBefore = store.calls.writes.length;

    const eleven = await repo.upsertEntry("u1", "m1", { score: 11 });
    expect(eleven.ok).toBe(false);
    expect(eleven.code).toBe("validation");

    const tenAndAHalf = await repo.upsertEntry("u1", "m1", { score: 10.5 });
    expect(tenAndAHalf.ok).toBe(false);
    expect(tenAndAHalf.code).toBe("validation");

    const viaSetter = await repo.setScore("u1", "m1", 11);
    expect(viaSetter.ok).toBe(false);
    expect(viaSetter.code).toBe("validation");

    expect(store.calls.writes.length).toBe(writesBefore);
    expect(store.docs.get("u1/m1").score).toBeNull();
  });
});

// -------------------------------------------------------------
// AC-123 (REQ-204 / DB-103): progress según metadata.kind
// -------------------------------------------------------------
describe("AC-123", () => {
  const metadata = { kind: "episodes", totalEpisodes: 12 };

  it("progress {current:13,total:12} rechazado sin escritura", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);
    const writesBefore = store.calls.writes.length;

    const result = await repo.upsertEntry("u1", "m1", {
      metadata,
      progress: { current: 13, total: 12 },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("validation");
    expect(store.calls.writes.length).toBe(writesBefore);
    expect(store.docs.has("u1/m1")).toBe(false);
  });

  it("progress {current:12,total:12} aceptado", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);

    const result = await repo.upsertEntry("u1", "m1", {
      metadata,
      progress: { current: 12, total: 12 },
    });
    expect(result.ok).toBe(true);
    expect(result.value.progress).toEqual({ current: 12, total: 12 });
    expect(store.docs.get("u1/m1").progress).toEqual({ current: 12, total: 12 });
  });

  it("setProgress usa store.getMedia como contexto y respeta el tope", async () => {
    const store = createFakeStore();
    store.getMedia = async (mediaId) => ({
      id: mediaId,
      metadata: { kind: "episodes", totalEpisodes: 12 },
    });
    const repo = makeRepo(store);
    await repo.upsertEntry("u1", "m1", {});

    const bad = await repo.setProgress("u1", "m1", { current: 13, total: 12 });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("validation");

    const good = await repo.setProgress("u1", "m1", { current: 12, total: 12 });
    expect(good.ok).toBe(true);
    expect(good.value.progress).toEqual({ current: 12, total: 12 });
  });
});

// -------------------------------------------------------------
// AC-124 (REQ-205 / DB-114/115): orden updatedAt desc + filtros
// -------------------------------------------------------------
describe("AC-124", () => {
  async function seedThree() {
    const store = createFakeStore();
    const repo = makeRepo(store);
    const base = Date.UTC(2026, 0, 1);
    const rows = [
      { id: "a", updatedAt: new Date(base), status: "PLANNED" },
      { id: "b", updatedAt: new Date(base + 2000), status: "COMPLETED" },
      { id: "c", updatedAt: new Date(base + 1000), status: "COMPLETED" },
    ];
    for (const row of rows) {
      store.docs.set(`u1/${row.id}`, { ...row });
    }
    return { store, repo };
  }

  it("listEntries({}) ordena updatedAt DESC", async () => {
    const { store, repo } = await seedThree();
    const result = await repo.listEntries("u1", {});
    expect(result.ok).toBe(true);
    expect(result.value.items.map((entry) => entry.mediaId)).toEqual(["b", "c", "a"]);
    expect(store.calls.lastSpec.orderBy[0]).toEqual({
      field: "updatedAt",
      direction: "desc",
    });
    expect(store.calls.lastSpec.filters).toEqual([]);
  });

  it("con status COMPLETED devuelve solo esas entries (DB-115)", async () => {
    const { store, repo } = await seedThree();
    const result = await repo.listEntries("u1", { status: "COMPLETED" });
    expect(result.ok).toBe(true);
    expect(result.value.items.map((entry) => entry.mediaId)).toEqual(["b", "c"]);
    expect(store.calls.lastSpec.filters).toEqual([
      { field: "status", op: "==", value: "COMPLETED" },
    ]);
  });

  it("listByMinScore ordena score DESC (DB-116)", async () => {
    const store = createFakeStore();
    const base = Date.UTC(2026, 0, 1);
    store.docs.set("u1/a", { score: 8, updatedAt: new Date(base) });
    store.docs.set("u1/b", { score: 9, updatedAt: new Date(base) });
    store.docs.set("u1/c", { score: null, updatedAt: new Date(base) });
    const repo = makeRepo(store);

    const result = await repo.listByMinScore("u1", 8);
    expect(result.ok).toBe(true);
    expect(result.value.map((entry) => entry.mediaId)).toEqual(["b", "a"]);
    expect(store.calls.lastSpec.filters).toEqual([
      { field: "score", op: ">=", value: 8 },
    ]);
  });
});

// -------------------------------------------------------------
// API-11: escrituras parciales selladas con serverTimestamp
// -------------------------------------------------------------
describe("API-11", () => {
  it("setStatus/setScore/setReview/setProgress envían SOLO el campo + updatedAt:SERVER_TIMESTAMP", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);
    await repo.upsertEntry("u1", "m1", {});
    store.calls.writes.length = 0;

    await repo.setStatus("u1", "m1", "IN_PROGRESS");
    const statusWrite = store.calls.writes.at(-1);
    expect(statusWrite.op).toBe("update");
    expect(Object.keys(statusWrite.data).sort()).toEqual(["status", "updatedAt"]);
    expect(statusWrite.data.updatedAt).toBe(SERVER_TIMESTAMP);

    await repo.setScore("u1", "m1", 9);
    const scoreWrite = store.calls.writes.at(-1);
    expect(Object.keys(scoreWrite.data).sort()).toEqual(["score", "updatedAt"]);
    expect(scoreWrite.data.updatedAt).toBe(SERVER_TIMESTAMP);

    await repo.setReview("u1", "m1", "Genial");
    const reviewWrite = store.calls.writes.at(-1);
    expect(Object.keys(reviewWrite.data).sort()).toEqual(["review", "updatedAt"]);
    expect(reviewWrite.data.updatedAt).toBe(SERVER_TIMESTAMP);

    await repo.setProgress("u1", "m1", { current: 1, total: 2 });
    const progressWrite = store.calls.writes.at(-1);
    expect(Object.keys(progressWrite.data).sort()).toEqual(["progress", "updatedAt"]);
    expect(progressWrite.data.updatedAt).toBe(SERVER_TIMESTAMP);

    // Nunca se reescribe la entry completa (API-11).
    for (const write of store.calls.writes) {
      expect(write.data).not.toHaveProperty("createdAt");
      expect(write.data).not.toHaveProperty("mediaId");
    }

    // upsert también sella updatedAt con el centinela.
    const upsertResult = await repo.upsertEntry("u1", "m2", { score: 5 });
    expect(upsertResult.ok).toBe(true);
    const upsertWrite = store.calls.writes.at(-1);
    expect(upsertWrite.data.updatedAt).toBe(SERVER_TIMESTAMP);
    expect(upsertWrite.data.createdAt).toBe(SERVER_TIMESTAMP);
    // La UI nunca recibe el centinela.
    expect(upsertResult.value.updatedAt).toBeInstanceOf(Date);
    expect(upsertResult.value.createdAt).toBeInstanceOf(Date);
  });
});

// -------------------------------------------------------------
// AC-129 (SEC-01): permission_denied sin datos modificados
// -------------------------------------------------------------
describe("AC-129", () => {
  it("uid ajeno => permission_denied y el store no se toca", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store, { uid: "userA" });

    const result = await repo.upsertEntry("userB", "x", { score: 5 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("permission_denied");
    expect(store.calls.writes.length).toBe(0);
    expect(store.calls.get).toBe(0);
    expect(store.docs.size).toBe(0);

    const read = await repo.getEntry("userB", "x");
    expect(read.ok).toBe(false);
    expect(read.code).toBe("permission_denied");

    const listed = await repo.listEntries("userB", {});
    expect(listed.ok).toBe(false);
    expect(listed.code).toBe("permission_denied");

    // El dueño sí puede escribir.
    const owner = await repo.upsertEntry("userA", "x", { score: 5 });
    expect(owner.ok).toBe(true);
    expect(store.docs.has("userA/x")).toBe(true);
    expect(store.docs.has("userB/x")).toBe(false);
  });

  it("normaliza permission-denied de Firestore a permission_denied", async () => {
    const store = createFakeStore();
    store.getEntry = async () => {
      const error = new Error("denied");
      error.code = "permission-denied";
      throw error;
    };
    const repo = makeRepo(store);
    const result = await repo.getEntry("u1", "m1");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("permission_denied");
  });
});
