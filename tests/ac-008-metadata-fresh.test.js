// Tests T-006 — AC-008 (REQ-009): isMetadataFresh de js/catalog.js.
// La caché de metadata es fresca solo si metadataFetchedAt existe y tiene
// menos de METADATA_CACHE_TTL_DAYS días; null/ausente o ≥ TTL → false.
import { describe, it, expect } from "vitest";
import { isMetadataFresh, METADATA_CACHE_TTL_DAYS } from "../js/catalog.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-03T12:00:00.000Z");

describe("AC-008 isMetadataFresh: metadataFetchedAt null o ausente (REQ-009)", () => {
  it("AC-008: metadataFetchedAt null → false", () => {
    expect(isMetadataFresh({ metadataFetchedAt: null }, NOW)).toBe(false);
  });

  it("AC-008: metadataFetchedAt ausente → false", () => {
    expect(isMetadataFresh({}, NOW)).toBe(false);
  });

  it("AC-008: item nulo o no objeto → false", () => {
    expect(isMetadataFresh(null, NOW)).toBe(false);
    expect(isMetadataFresh(undefined, NOW)).toBe(false);
    expect(isMetadataFresh("x", NOW)).toBe(false);
  });
});

describe("AC-008 isMetadataFresh: antigüedad menor que el TTL (REQ-009)", () => {
  it("AC-008: metadataFetchedAt hace < 30 días → true", () => {
    const fetchedAt = new Date(NOW.getTime() - 29 * DAY_MS);
    expect(isMetadataFresh({ metadataFetchedAt: fetchedAt }, NOW)).toBe(true);
  });

  it("AC-008: metadataFetchedAt reciente (1 hora) → true", () => {
    const fetchedAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(isMetadataFresh({ metadataFetchedAt: fetchedAt }, NOW)).toBe(true);
  });

  it("AC-008: acepta ISO string y Timestamp (.toDate())", () => {
    const iso = new Date(NOW.getTime() - 2 * DAY_MS).toISOString();
    expect(isMetadataFresh({ metadataFetchedAt: iso }, NOW)).toBe(true);
    const timestamp = { toDate: () => new Date(NOW.getTime() - 2 * DAY_MS) };
    expect(isMetadataFresh({ metadataFetchedAt: timestamp }, NOW)).toBe(true);
  });
});

describe("AC-008 isMetadataFresh: antigüedad igual o mayor que el TTL (REQ-009)", () => {
  it("AC-008: exactamente METADATA_CACHE_TTL_DAYS días → false", () => {
    expect(METADATA_CACHE_TTL_DAYS).toBe(30);
    const fetchedAt = new Date(NOW.getTime() - METADATA_CACHE_TTL_DAYS * DAY_MS);
    expect(isMetadataFresh({ metadataFetchedAt: fetchedAt }, NOW)).toBe(false);
  });

  it("AC-008: más de 30 días → false", () => {
    const fetchedAt = new Date(NOW.getTime() - 31 * DAY_MS);
    expect(isMetadataFresh({ metadataFetchedAt: fetchedAt }, NOW)).toBe(false);
  });

  it("AC-008: justo por debajo del TTL (TTL - 1 s) → true", () => {
    const fetchedAt = new Date(NOW.getTime() - METADATA_CACHE_TTL_DAYS * DAY_MS + 1000);
    expect(isMetadataFresh({ metadataFetchedAt: fetchedAt }, NOW)).toBe(true);
  });
});
