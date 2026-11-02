// Tests de regresión T-010 — fix del HIGH #1 de T-008 (REQ-008 / AC-005):
// normalizeItem debe persistir `completedAt` (helper toItemDate):
//   ISO/número/Date → Date; ausente/null/"" → null.
import { describe, it, expect } from "vitest";
import { normalizeItem } from "../js/catalog.js";

describe("AC-005 completedAt: regresión T-010 (REQ-008)", () => {
  it("AC-005: completedAt ISO string se normaliza a Date persistible", () => {
    const iso = "2025-06-01T10:00:00.000Z";
    const item = normalizeItem("movie", { title: "Origen", completedAt: iso });
    expect(item.completedAt).not.toBeNull();
    expect(item.completedAt).toBeInstanceOf(Date);
    expect(item.completedAt.getTime()).toBe(new Date(iso).getTime());
    // persistible: soporta clon estructurable (misma semántica que Firestore)
    const cloned = structuredClone(item.completedAt);
    expect(cloned.getTime()).toBe(item.completedAt.getTime());
  });

  it("AC-005: completedAt en epoch (número) y Date se normalizan a Date", () => {
    const ms = Date.UTC(2025, 5, 1);
    const fromNumber = normalizeItem("movie", { title: "A", completedAt: ms });
    expect(fromNumber.completedAt).toBeInstanceOf(Date);
    expect(fromNumber.completedAt.getTime()).toBe(ms);

    const src = new Date(ms);
    const fromDate = normalizeItem("book", { title: "B", completedAt: src });
    expect(fromDate.completedAt).toBeInstanceOf(Date);
    expect(fromDate.completedAt.getTime()).toBe(ms);
  });

  it("AC-005: completedAt ausente, null o cadena vacía se normaliza a null", () => {
    expect(normalizeItem("movie", { title: "A" }).completedAt).toBeNull();
    expect(
      normalizeItem("movie", { title: "A", completedAt: null }).completedAt
    ).toBeNull();
    expect(
      normalizeItem("movie", { title: "A", completedAt: "" }).completedAt
    ).toBeNull();
    expect(
      normalizeItem("book", { title: "B", completedAt: "" }).completedAt
    ).toBeNull();
    expect(
      normalizeItem("game", { title: "C", completedAt: null }).completedAt
    ).toBeNull();
  });

  it("AC-005: movie conserva completedAt sin alterar el resto de campos", () => {
    const iso = "2025-06-01T10:00:00.000Z";
    const item = normalizeItem("movie", {
      title: "  Origen  ",
      originalTitle: "Inception",
      year: 2010,
      posterUrl: "https://img/p.jpg",
      synopsis: "Un ladrón de sueños",
      genres: ["Ciencia ficción", "Acción"],
      status: "completed",
      rating: 9,
      review: "Obra maestra",
      completedAt: iso,
      durationMinutes: 148,
    });
    expect(item.completedAt).toBeInstanceOf(Date);
    expect(item.completedAt.toISOString()).toBe(iso);
    expect(item.mediaType).toBe("movie");
    expect(item.title).toBe("Origen");
    expect(item.originalTitle).toBe("Inception");
    expect(item.year).toBe(2010);
    expect(item.posterUrl).toBe("https://img/p.jpg");
    expect(item.synopsis).toBe("Un ladrón de sueños");
    expect(item.genres).toEqual(["Ciencia ficción", "Acción"]);
    expect(item.status).toBe("completed");
    expect(item.rating).toBe(9);
    expect(item.review).toBe("Obra maestra");
    expect(item.durationMinutes).toBe(148);
    expect(item.sessions).toEqual([]);
  });

  it("AC-005: book conserva completedAt sin alterar el resto de campos", () => {
    const iso = "2025-06-01T10:00:00.000Z";
    const item = normalizeItem("book", {
      title: "El nombre del viento",
      author: "Patrick Rothfuss",
      pagesTotal: 662,
      pagesRead: 662,
      status: "completed",
      rating: 8,
      review: "Regazo precioso",
      completedAt: iso,
    });
    expect(item.completedAt).toBeInstanceOf(Date);
    expect(item.completedAt.toISOString()).toBe(iso);
    expect(item.mediaType).toBe("book");
    expect(item.title).toBe("El nombre del viento");
    expect(item.author).toBe("Patrick Rothfuss");
    expect(item.pagesTotal).toBe(662);
    expect(item.pagesRead).toBe(662);
    expect(item.status).toBe("completed");
    expect(item.rating).toBe(8);
    expect(item.review).toBe("Regazo precioso");
    expect(item.year).toBeNull();
    expect(item.sessions).toEqual([]);
  });
});
