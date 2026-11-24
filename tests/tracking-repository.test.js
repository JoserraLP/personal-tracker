// Tests de aceptación de js/repositories/tracking-repository.js
// (spec 03 AC-120..AC-124, AC-129 / API-11, API-12; spec 01 SEC-01).
// Sin red: store falso inyectado en createTrackingRepository().

import { describe, expect, it } from "vitest";
import {
  SERVER_TIMESTAMP,
  createTrackingRepository,
} from "../js/repositories/tracking-repository.js";

/** Normaliza un valor para comparar: `Date` → ms; null/undefined → null. */
function comparable(value) {
  if (value instanceof Date) return value.getTime();
  if (value === null || value === undefined) return null;
  return value;
}

/** Comparación genérica; `null` va primero en ascendente (como Firestore). */
function compareValues(left, right) {
  const a = comparable(left);
  const b = comparable(right);
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Aplica la spec de la query como haría Firestore: filtros → orderBy →
 * startAfter → limit. Así el test verifica de verdad que el repositorio
 * pide filtrado/ordenado server-side en vez de confiar solo en el
 * reordenado en memoria.
 * @param {string} uid
 * @param {Map<string, object>} docs
 * @param {object} spec
 * @returns {object[]}
 */
function applyQuerySpec(uid, docs, spec) {
  let items = [];
  for (const [key, value] of docs) {
    if (key.startsWith(`${uid}/`)) items.push({ id: key.slice(uid.length + 1), ...value });
  }

  for (const filter of spec?.filters ?? []) {
    items = items.filter((doc) => {
      const left = filter.field === "__name__" ? doc.id : doc[filter.field];
      if (filter.op === "==") return left === filter.value;
      if (filter.op === ">=") {
        const value = comparable(left);
        return value !== null && value >= filter.value;
      }
      throw new Error(`queryEntries: filtro no soportado "${filter.op}".`);
    });
  }

  const orders = spec?.orderBy ?? [];
  if (orders.length > 0) {
    items.sort((a, b) => {
      for (const order of orders) {
        const left = order.field === "__name__" ? a.id : a[order.field];
        const right = order.field === "__name__" ? b.id : b[order.field];
        const cmp = compareValues(left, right);
        if (cmp !== 0) return order.direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }

  if (spec?.startAfter) {
    const { updatedAt, id } = spec.startAfter;
    items = items.filter((doc) => {
      const ms = comparable(doc.updatedAt);
      if (ms === null) return true; // sin updatedAt ⇒ al final (repo lo reordena)
      if (ms !== updatedAt) return ms < updatedAt; // orden desc: estrictamente después
      return String(doc.id) > id;
    });
  }

  if (typeof spec?.limit === "number") items = items.slice(0, spec.limit);
  return items;
}

/**
 * Store falso en memoria con el contrato de la cabecera del módulo.
 * Registra cada lectura/escritura, aplica `spec.filters`/`orderBy`/
 * `startAfter`/`limit` en `queryEntries` y traduce el centinela
 * `SERVER_TIMESTAMP` a `Date` al persistir (como hace el store real).
 */
function createFakeStore() {
  const docs = new Map(); // `${uid}/${mediaId}` -> data
  const mediaById = new Map(); // mediaId -> media (contexto de progress)
  const calls = { get: 0, upsert: 0, update: 0, del: 0, query: 0, getMedia: 0 };
  calls.writes = []; // payloads CRUDADOS (con centinela, para inspección)
  calls.specs = [];

  const total = () =>
    calls.get + calls.upsert + calls.update + calls.del + calls.query + calls.getMedia;

  const resolve = (data) => {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
      out[key] = value === SERVER_TIMESTAMP ? new Date() : value;
    }
    return out;
  };

  return {
    docs,
    mediaById,
    calls,
    total,
    async getEntry(uid, mediaId) {
      calls.get += 1;
      const doc = docs.get(`${uid}/${mediaId}`);
      return doc ? { id: mediaId, ...doc } : null;
    },
    async getMedia(mediaId) {
      calls.getMedia += 1;
      return mediaById.get(mediaId) ?? null;
    },
    async upsertEntry(uid, mediaId, data) {
      calls.upsert += 1;
      calls.writes.push({ op: "upsert", uid, mediaId, data });
      const merged = { ...(docs.get(`${uid}/${mediaId}`) ?? {}), ...resolve(data) };
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
      const merged = { ...prev, ...resolve(patch) };
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
      calls.specs.push(spec);
      return { docs: applyQuerySpec(uid, docs, spec) };
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
  it("crea la entry con status PLANNED y el segundo clic no duplica el doc", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);

    const first = await repo.upsertEntry("u1", "seed-42", {});
    expect(first.ok).toBe(true);
    expect(first.value.mediaId).toBe("seed-42");
    expect(first.value.status).toBe("PLANNED");

    const second = await repo.upsertEntry("u1", "seed-42", {});
    expect(second.ok).toBe(true);
    expect(second.value.status).toBe("PLANNED");

    // Doc id = mediaId: un solo documento, nunca dos.
    expect(store.docs.size).toBe(1);
    expect(store.docs.has("u1/seed-42")).toBe(true);
    expect(store.calls.upsert).toBe(2);

    const read = await repo.getEntry("u1", "seed-42");
    expect(read.ok).toBe(true);
    expect(read.value.mediaId).toBe("seed-42");
    expect(read.value.status).toBe("PLANNED");
  });
});

// -------------------------------------------------------------
// AC-121 (REQ-202): cambio de estado persiste y filtra
// -------------------------------------------------------------
describe("AC-121", () => {
  it("setStatus PLANNED -> COMPLETED persiste y el filtro por estado lo lista", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);
    await repo.upsertEntry("u1", "m1", {});

    const changed = await repo.setStatus("u1", "m1", "COMPLETED");
    expect(changed.ok).toBe(true);
    expect(changed.value.status).toBe("COMPLETED");
    expect(store.docs.get("u1/m1").status).toBe("COMPLETED");

    const completed = await repo.listEntries("u1", { status: "COMPLETED" });
    expect(completed.ok).toBe(true);
    expect(completed.value.items.map((entry) => entry.mediaId)).toEqual(["m1"]);
    expect(store.calls.specs.at(-1).filters).toEqual([
      { field: "status", op: "==", value: "COMPLETED" },
    ]);

    const planned = await repo.listEntries("u1", { status: "PLANNED" });
    expect(planned.ok).toBe(true);
    expect(planned.value.items).toEqual([]);
  });
});

// -------------------------------------------------------------
// AC-122 (REQ-203): score 7 + review persisten; 11 / 10.5 validan
// -------------------------------------------------------------
describe("AC-122", () => {
  it("score 7 y review 'Muy buena' persisten", async () => {
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

  it("review de 500 caracteres aceptada; 501 => validation SIN escritura", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);
    await repo.upsertEntry("u1", "m1", {});

    const atLimit = await repo.upsertEntry("u1", "m1", { review: "x".repeat(500) });
    expect(atLimit.ok).toBe(true);
    expect(atLimit.value.review).toHaveLength(500);
    expect(store.docs.get("u1/m1").review).toHaveLength(500);

    const writesBefore = store.calls.writes.length;
    const readsBefore = store.total();

    const overLimit = await repo.upsertEntry("u1", "m1", { review: "x".repeat(501) });
    expect(overLimit.ok).toBe(false);
    expect(overLimit.code).toBe("validation");

    const viaSetter = await repo.setReview("u1", "m1", "y".repeat(501));
    expect(viaSetter.ok).toBe(false);
    expect(viaSetter.code).toBe("validation");

    expect(store.calls.writes.length).toBe(writesBefore);
    expect(store.total()).toBe(readsBefore);
    expect(store.docs.get("u1/m1").review).toHaveLength(500);
  });

  it("score 11 o 10.5 => code validation SIN escritura (API-12)", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);
    await repo.upsertEntry("u1", "m1", {});
    const writesBefore = store.calls.writes.length;
    const readsBefore = store.total();

    const eleven = await repo.upsertEntry("u1", "m1", { score: 11 });
    expect(eleven.ok).toBe(false);
    expect(eleven.code).toBe("validation");

    const tenAndAHalf = await repo.upsertEntry("u1", "m1", { score: 10.5 });
    expect(tenAndAHalf.ok).toBe(false);
    expect(tenAndAHalf.code).toBe("validation");

    const viaSetter = await repo.setScore("u1", "m1", 11);
    expect(viaSetter.ok).toBe(false);
    expect(viaSetter.code).toBe("validation");

    // Ninguna llamada al store: ni lectura ni escritura.
    expect(store.calls.writes.length).toBe(writesBefore);
    expect(store.total()).toBe(readsBefore);
    expect(store.docs.get("u1/m1").score).toBeNull();
  });
});

// -------------------------------------------------------------
// AC-123 (REQ-204 / DB-103): progress según metadata.kind
// -------------------------------------------------------------
describe("AC-123", () => {
  const metadata = { kind: "episodes", totalEpisodes: 12 };

  it("progress {current:13,total:12} rechazado sin tocar el store", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);

    const bad = await repo.upsertEntry("u1", "m1", {
      metadata,
      progress: { current: 13, total: 12 },
    });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("validation");
    expect(store.total()).toBe(0);
    expect(store.docs.has("u1/m1")).toBe(false);
  });

  it("progress {current:12,total:12} aceptado y persistido", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);

    const good = await repo.upsertEntry("u1", "m1", {
      metadata,
      progress: { current: 12, total: 12 },
    });
    expect(good.ok).toBe(true);
    expect(good.value.progress).toEqual({ current: 12, total: 12 });
    expect(store.docs.get("u1/m1").progress).toEqual({ current: 12, total: 12 });
  });

  it("setProgress lee el contexto de store.getMedia y respeta el tope", async () => {
    const store = createFakeStore();
    store.mediaById.set("m1", {
      id: "m1",
      metadata: { kind: "episodes", totalEpisodes: 12 },
    });
    const repo = makeRepo(store);
    await repo.upsertEntry("u1", "m1", {});
    const writesBefore = store.calls.writes.length;

    const bad = await repo.setProgress("u1", "m1", { current: 13, total: 12 });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("validation");
    expect(store.calls.writes.length).toBe(writesBefore);
    expect(store.calls.getMedia).toBe(1);

    const good = await repo.setProgress("u1", "m1", { current: 12, total: 12 });
    expect(good.ok).toBe(true);
    expect(good.value.progress).toEqual({ current: 12, total: 12 });
  });
});

// -------------------------------------------------------------
// AC-124 (REQ-205 / DB-114/115): orden updatedAt desc + filtro
// -------------------------------------------------------------
describe("AC-124", () => {
  function seedThree() {
    const store = createFakeStore();
    const base = Date.UTC(2026, 0, 1);
    // Insertadas en orden ascendente: sin ordenar, el resultado sería a,b,c.
    store.docs.set("u1/a", { status: "PLANNED", updatedAt: new Date(base) });
    store.docs.set("u1/b", { status: "COMPLETED", updatedAt: new Date(base + 2000) });
    store.docs.set("u1/c", { status: "COMPLETED", updatedAt: new Date(base + 1000) });
    return { store, repo: makeRepo(store) };
  }

  it("listEntries({}) ordena por updatedAt DESC (DB-114)", async () => {
    const { store, repo } = seedThree();
    const result = await repo.listEntries("u1", {});
    expect(result.ok).toBe(true);
    expect(result.value.items.map((entry) => entry.mediaId)).toEqual(["b", "c", "a"]);
    expect(store.calls.specs.at(-1).orderBy[0]).toEqual({
      field: "updatedAt",
      direction: "desc",
    });
    expect(store.calls.specs.at(-1).filters).toEqual([]);
  });

  it("con status COMPLETED devuelve solo esas entries (DB-115)", async () => {
    const { store, repo } = seedThree();
    const result = await repo.listEntries("u1", { status: "COMPLETED" });
    expect(result.ok).toBe(true);
    expect(result.value.items.map((entry) => entry.mediaId)).toEqual(["b", "c"]);
    expect(store.calls.specs.at(-1).filters).toEqual([
      { field: "status", op: "==", value: "COMPLETED" },
    ]);
    // El filtro es server-side: el store ya devuelve solo b y c.
    expect(store.calls.specs.at(-1).orderBy).toEqual([
      { field: "updatedAt", direction: "desc" },
      { field: "__name__", direction: "asc" },
    ]);
  });

  it("paginación: página de 24 con cursor y pageSize > MAX recortado a 48 (DB-114)", async () => {
    const store = createFakeStore();
    const base = Date.UTC(2026, 0, 1);
    // 30 entries con updatedAt ascendente (desc = a29..a00).
    for (let i = 0; i < 30; i += 1) {
      store.docs.set(`u1/a${String(i).padStart(2, "0")}`, {
        status: "PLANNED",
        updatedAt: new Date(base + i * 1000),
      });
    }
    const repo = makeRepo(store);

    // Página 1: DEFAULT_ENTRY_PAGE_SIZE = 24 (spec pide limit 25).
    const page1 = await repo.listEntries("u1", {});
    expect(page1.ok).toBe(true);
    expect(page1.value.items).toHaveLength(24);
    expect(page1.value.items[0].mediaId).toBe("a29");
    expect(page1.value.items[23].mediaId).toBe("a06");
    expect(page1.value.cursor).toEqual(expect.any(String));
    expect(store.calls.specs.at(-1).limit).toBe(25);

    // Página 2 reanuda con el cursor opaco: startAfter a06 ⇒ a05..a00.
    const page2 = await repo.listEntries("u1", { cursor: page1.value.cursor });
    expect(page2.ok).toBe(true);
    expect(page2.value.items.map((entry) => entry.mediaId)).toEqual([
      "a05",
      "a04",
      "a03",
      "a02",
      "a01",
      "a00",
    ]);
    expect(page2.value.cursor).toBeNull();
    expect(store.calls.specs.at(-1).startAfter).toEqual({
      updatedAt: base + 6 * 1000,
      id: "a06",
    });

    // pageSize > MAX_PAGE_SIZE (48) se recorta: spec.limit = 49.
    const capped = await repo.listEntries("u1", { pageSize: 100 });
    expect(capped.ok).toBe(true);
    expect(store.calls.specs.at(-1).limit).toBe(49);
    expect(capped.value.items).toHaveLength(30);
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
    let write = store.calls.writes.at(-1);
    expect(write.op).toBe("update");
    expect(Object.keys(write.data).sort()).toEqual(["status", "updatedAt"]);
    expect(write.data.updatedAt).toBe(SERVER_TIMESTAMP);

    await repo.setScore("u1", "m1", 9);
    write = store.calls.writes.at(-1);
    expect(Object.keys(write.data).sort()).toEqual(["score", "updatedAt"]);
    expect(write.data.updatedAt).toBe(SERVER_TIMESTAMP);

    await repo.setReview("u1", "m1", "Genial");
    write = store.calls.writes.at(-1);
    expect(Object.keys(write.data).sort()).toEqual(["review", "updatedAt"]);
    expect(write.data.updatedAt).toBe(SERVER_TIMESTAMP);

    await repo.setProgress("u1", "m1", { current: 1, total: 2 });
    write = store.calls.writes.at(-1);
    expect(Object.keys(write.data).sort()).toEqual(["progress", "updatedAt"]);
    expect(write.data.updatedAt).toBe(SERVER_TIMESTAMP);

    // Nunca se reescribe la entry completa.
    for (const item of store.calls.writes) {
      expect(item.data).not.toHaveProperty("createdAt");
      expect(item.data).not.toHaveProperty("mediaId");
      // `status` solo puede viajar en el write de setStatus, y nunca con
      // un valor ajeno al que se está cambiando (AC-121 usa IN_PROGRESS).
      expect("status" in item.data && item.data.status !== "IN_PROGRESS").toBe(false);
    }
  });
});

// -------------------------------------------------------------
// API-12: validación sin ninguna escritura en red
// -------------------------------------------------------------
describe("API-12", () => {
  it("status/score inválidos => { ok:false, code:'validation' } y cero llamadas al store", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store);

    const badStatus = await repo.upsertEntry("u1", "m1", { status: "BOGUS" });
    expect(badStatus.ok).toBe(false);
    expect(badStatus.code).toBe("validation");

    const badScore = await repo.upsertEntry("u1", "m1", { score: 11 });
    expect(badScore.ok).toBe(false);
    expect(badScore.code).toBe("validation");

    const badSetScore = await repo.setScore("u1", "m1", 4.5);
    expect(badSetScore.ok).toBe(false);
    expect(badSetScore.code).toBe("validation");

    const badSetStatus = await repo.setStatus("u1", "m1", "BOGUS");
    expect(badSetStatus.ok).toBe(false);
    expect(badSetStatus.code).toBe("validation");

    // Sin red: ni lecturas ni escrituras en el store.
    expect(store.total()).toBe(0);
    expect(store.docs.size).toBe(0);
  });
});

// -------------------------------------------------------------
// AC-129 (SEC-01): permission_denied sin datos modificados
// -------------------------------------------------------------
describe("AC-129", () => {
  it("uid ajeno => permission_denied en upsertEntry y el store no se toca", async () => {
    const store = createFakeStore();
    const repo = makeRepo(store, { uid: "userA" });

    const result = await repo.upsertEntry("userB", "x", { score: 5 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("permission_denied");
    expect(store.total()).toBe(0);
    expect(store.docs.size).toBe(0);

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
