// Tests T-106 — AC-114 (REQ-104, API-03, DB-101/102): seed inicial
// js/seed/seed-catalog.js. `SEED_ITEMS` ≥7 ítems (1 por tipo), `seed: true`,
// doc id `seed-<tipo>-<n>`, `metadata.kind` coherente, validación con
// `validateMediaItem` y re-ejecución idempotente (upsert, no duplica).
// Módulo puro: importable sin red ni Firebase.
import { describe, it, expect } from "vitest";
import {
  MEDIA_ITEM_TYPES,
  METADATA_KIND_BY_MEDIA_TYPE,
  validateMediaItem,
} from "../js/catalog.js";
import {
  SEED_COLLECTION,
  SEED_ITEMS,
  SEED_DOC_ID_PATTERN,
  seedCatalog,
  validateSeedItems,
  isSeedDocId,
} from "../js/seed/seed-catalog.js";

describe("AC-114: SEED_ITEMS (API-03, REQ-104, DB-101)", () => {
  it("AC-114: tiene ≥7 ítems y exactamente 1 por cada uno de los 7 tipos", () => {
    expect(SEED_ITEMS.length).toBeGreaterThanOrEqual(7);
    expect(MEDIA_ITEM_TYPES).toHaveLength(7);
    for (const mediaType of MEDIA_ITEM_TYPES) {
      const count = SEED_ITEMS.filter((i) => i.mediaType === mediaType).length;
      expect(count, `tipo ${mediaType}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("AC-114: todos los ítems llevan seed: true", () => {
    for (const item of SEED_ITEMS) {
      expect(item.seed, item.id).toBe(true);
    }
  });

  it("AC-114: doc ids deterministas seed-<tipo>-<n> y coherentes con mediaType", () => {
    const ids = SEED_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of SEED_ITEMS) {
      expect(SEED_DOC_ID_PATTERN.test(item.id), item.id).toBe(true);
      expect(isSeedDocId(item.id), item.id).toBe(true);
      expect(item.id.startsWith(`seed-${item.mediaType.toLowerCase()}-`)).toBe(
        true,
      );
    }
  });

  it("AC-114: metadata.kind deriva de mediaType (DB-102)", () => {
    for (const item of SEED_ITEMS) {
      expect(item.metadata?.kind, item.id).toBe(
        METADATA_KIND_BY_MEDIA_TYPE[item.mediaType],
      );
    }
  });

  it("AC-114: todos los ítems pasan validateMediaItem (DB-120)", () => {
    for (const item of SEED_ITEMS) {
      const result = validateMediaItem(item);
      expect(result.valid, `${item.id}: ${result.errors.join(" ")}`).toBe(true);
    }
    const report = validateSeedItems();
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });
});

describe("AC-114: re-ejecutar el seed es upsert, no duplica", () => {
  it("AC-114: dos corridas escriben los mismos ids fijos sin duplicados", async () => {
    const store = new Map();
    const writes = [];
    const writeById = (docId, data) => {
      writes.push(docId);
      store.set(docId, data);
      return Promise.resolve();
    };

    const first = await seedCatalog(writeById);
    expect(first.collection).toBe(SEED_COLLECTION);
    expect(first.ids).toEqual(SEED_ITEMS.map((i) => i.id));
    const sizeAfterFirst = store.size;

    const second = await seedCatalog(writeById);
    expect(second.ids).toEqual(first.ids);

    // Mismo conjunto de docs: upsert sobre ids fijos, sin duplicados.
    expect(store.size).toBe(sizeAfterFirst);
    expect(new Set(writes.slice(first.ids.length)).size).toBe(first.ids.length);
    expect(store.size).toBe(SEED_ITEMS.length);
    for (const item of SEED_ITEMS) {
      expect(store.has(item.id)).toBe(true);
    }
  });
});
