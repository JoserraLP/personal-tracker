// Tests T-122 (issue #68) — AC-114 (REQ-104, API-03, DB-101/102) sobre
// js/seed/seed-catalog.js: instalación limpia con ≥1 ítem de cada uno de
// los 7 tipos y re-ejecución idempotente porque los ids de documento son
// fijos (no duplicables). REQ-C4: nombre de archivo <área>-<tema>.test.js
// y cada it() cita el ID que cubre. Módulo puro: sin red ni Firebase.
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
  isSeedDocId,
  seedCatalog,
  validateSeedItems,
} from "../js/seed/seed-catalog.js";

// -------------------------------------------------------------
// AC-114 — instalación limpia: ≥1 ítem de cada 7 tipos
// -------------------------------------------------------------

describe("AC-114 (REQ-104, API-03): instalación limpia del catálogo", () => {
  it("AC-114: el seed cubre ≥1 ítem de cada uno de los 7 tipos de DB-101", () => {
    expect(MEDIA_ITEM_TYPES).toHaveLength(7);
    expect(SEED_ITEMS.length).toBeGreaterThanOrEqual(7);
    for (const mediaType of MEDIA_ITEM_TYPES) {
      const count = SEED_ITEMS.filter((item) => item.mediaType === mediaType).length;
      expect(count, `tipo ${mediaType}`).toBeGreaterThanOrEqual(1);
    }

    // Tras ejecutar el seed, la colección contiene esos ítems.
    const written = new Map();
    return seedCatalog((docId, data) => {
      written.set(docId, data);
      return Promise.resolve();
    }).then((result) => {
      expect(result.collection).toBe(SEED_COLLECTION);
      expect(result.ids).toHaveLength(written.size);
      for (const mediaType of MEDIA_ITEM_TYPES) {
        const found = [...written.values()].filter((item) => item.mediaType === mediaType);
        expect(found.length, `tipo ${mediaType}`).toBeGreaterThanOrEqual(1);
      }
    });
  });

  it("AC-114: cada ítem sembrado cumple las invariantes de API-03/DB-120", () => {
    for (const item of SEED_ITEMS) {
      expect(item.seed, item.id).toBe(true);
      expect(SEED_DOC_ID_PATTERN.test(item.id), item.id).toBe(true);
      expect(isSeedDocId(item.id), item.id).toBe(true);
      expect(item.metadata?.kind, item.id).toBe(METADATA_KIND_BY_MEDIA_TYPE[item.mediaType]);
      const report = validateMediaItem(item);
      expect(report.valid, `${item.id}: ${report.errors.join(" ")}`).toBe(true);
    }
    const seedReport = validateSeedItems();
    expect(seedReport.valid, seedReport.errors.join(" | ")).toBe(true);
  });
});

// -------------------------------------------------------------
// AC-114 — re-ejecutar no duplica: ids de documento fijos
// -------------------------------------------------------------

describe("AC-114 (REQ-104, API-03): ids fijos no duplicables", () => {
  it("AC-114: re-ejecutar el seed escribe los mismos ids fijos y no duplica documentos", async () => {
    // Backing store tipo Firestore: las claves son los doc ids, así que
    // un id fijo hace upsert y un id automático duplicaría.
    const store = new Map();
    const writeById = (docId, data) => {
      store.set(docId, data);
      return Promise.resolve();
    };

    const first = await seedCatalog(writeById);
    expect(first.ids).toEqual(SEED_ITEMS.map((item) => item.id));
    expect(store.size).toBe(SEED_ITEMS.length);

    // Todos los ids sembrados son fijos (patrón seed-<tipo>-<n>).
    for (const id of first.ids) {
      expect(isSeedDocId(id), id).toBe(true);
    }

    // Re-ejecutar: mismos ids ⇒ mismas claves, sin documentos nuevos.
    const second = await seedCatalog(writeById);
    expect(second.ids).toEqual(first.ids);
    expect(store.size).toBe(SEED_ITEMS.length);
    for (const item of SEED_ITEMS) {
      expect(store.has(item.id), item.id).toBe(true);
    }

    // Un writer que contabiliza claves distintas confirma que la segunda
    // corrida no creó ningún id nuevo (no duplica).
    const seenKeys = new Set();
    const trackWriter = (docId) => {
      seenKeys.add(docId);
      return Promise.resolve();
    };
    await seedCatalog(trackWriter);
    await seedCatalog(trackWriter);
    expect(seenKeys.size).toBe(SEED_ITEMS.length);
    expect(new Set(SEED_ITEMS.map((item) => item.id)).size).toBe(SEED_ITEMS.length);
  });

  it("AC-114: los ids sembrados no son duplicables entre sí ni reasignables", () => {
    const ids = SEED_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length); // sin ids repetidos
    for (const id of ids) {
      expect(SEED_DOC_ID_PATTERN.test(id), id).toBe(true);
    }
    // El writer fijo recibe exactamente el id de cada ítem: no hay
    // hueco para un id autogenerado que pudiera duplicar documentos.
    const received = [];
    return seedCatalog((docId) => {
      received.push(docId);
      return Promise.resolve();
    }).then((result) => {
      expect(received).toEqual(ids);
      expect(result.ids).toEqual(ids);
    });
  });
});
