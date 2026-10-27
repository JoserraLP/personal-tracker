import { describe, it, expect } from "vitest";
import { normalizeText, translateText, translateAttr } from "../js/i18n.js";

describe("i18n.js — núcleo puro (ADR-110)", () => {
  it("normalizeText colapsa espacios y trims", () => {
    expect(normalizeText("  Aún   no hay\n nada  ")).toBe("Aún no hay nada");
    expect(normalizeText(null)).toBe("");
  });

  it("translateText: coincidencia exacta normalizada es→en", () => {
    expect(translateText("Cargando…", "en")).toBe("Loading…");
    expect(translateText("  Cargando…  ", "en")).toBe("Loading…");
    expect(translateText("Series", "en")).toBe("TV Shows");
  });

  it("translateText: sin traducción o lang es devuelve null (no toca)", () => {
    expect(translateText("Texto desconocido", "en")).toBeNull();
    expect(translateText("Cargando…", "es")).toBeNull();
    expect(translateText(null, "en")).toBeNull();
  });

  it("translateText: los IDs del diccionario no se traducen dos veces", () => {
    // The EN text must not match again in the dict (no loops)
    expect(translateText("Loading…", "en")).toBeNull();
    expect(translateText("TV Shows", "en")).toBeNull();
  });

  it("translateAttr: @placeholder #aria-label %title", () => {
    expect(translateAttr("placeholder", "Buscar películas, series, libros o videojuegos...", "en")).toBe(
      "Search movies, shows, books or video games..."
    );
    expect(translateAttr("aria-label", "Notificaciones", "en")).toBe("Notifications");
    expect(translateAttr("title", "Volver arriba", "en")).toBe("Back to top");
    expect(translateAttr("placeholder", "desconocido", "en")).toBeNull();
    expect(translateAttr("placeholder", "Cargando…", "es")).toBeNull();
  });

  it("etiquetas de estado dinámicas cubiertas (constants.js)", () => {
    for (const s of ["Pendiente", "Viendo", "Vista", "Leyendo", "Leído", "Jugando", "Jugado", "Standby", "Abandonada", "Abandonado"]) {
      expect(translateText(s, "en")).not.toBeNull();
    }
  });
});
