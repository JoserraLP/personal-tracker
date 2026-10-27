import { describe, it, expect } from "vitest";
import { validateWishlistDraft, sanitizeListUrl, formatWishlistPrice } from "../js/section-lists.js";

describe("sanitizeListUrl", () => {
  it("deja pasar las URLs http(s) explícitas", () => {
    expect(sanitizeListUrl("https://ejemplo.com/pc?x=1")).toBe("https://ejemplo.com/pc?x=1");
    expect(sanitizeListUrl("http://ejemplo.com")).toBe("http://ejemplo.com");
  });

  it("anteponen https:// a dominios sin esquema", () => {
    expect(sanitizeListUrl("www.dominio.com/producto")).toBe("https://www.dominio.com/producto");
    expect(sanitizeListUrl("dominio.es")).toBe("https://dominio.es");
  });

  it("devuelve null para basura o vacío", () => {
    expect(sanitizeListUrl(null)).toBeNull();
    expect(sanitizeListUrl("")).toBeNull();
    expect(sanitizeListUrl("no es una url")).toBeNull();
  });
});

describe("validateWishlistDraft", () => {
  it("título obligatorio", () => {
    const r = validateWishlistDraft("  ", "", "", "");
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("El título es obligatorio.");
  });

  it("precio coma decimal se normaliza a número", () => {
    const r = validateWishlistDraft("Teclado", "12,99", "", "");
    expect(r.ok).toBe(true);
    expect(r.data.price).toBeCloseTo(12.99);
  });

  it("precio inválido da error y queda a null", () => {
    const r = validateWishlistDraft("Cosa", "abc", "", "");
    expect(r.ok).toBe(false);
    expect(r.data.price).toBeNull();
  });

  it("precio negativo no se admite", () => {
    expect(validateWishlistDraft("Cosa", "-3", "", "").ok).toBe(false);
  });

  it("URLs válidas pasan y se normalizan", () => {
    const r = validateWishlistDraft("Monitor", "", "www.dominio.com/monitor", "https://imgs.test/foto.jpg");
    expect(r.ok).toBe(true);
    expect(r.data.url).toBe("https://www.dominio.com/monitor");
    expect(r.data.photoUrl).toBe("https://imgs.test/foto.jpg");
  });

  it("conjunto completo sin opcionales", () => {
    const r = validateWishlistDraft("Monitor", "", "", "");
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ title: "Monitor", price: null, url: null, photoUrl: null });
  });
});

describe("formatWishlistPrice", () => {
  it("convierte a texto español con €", () => {
    expect(formatWishlistPrice(12.5)).toBe("12,5 €");
    expect(formatWishlistPrice(100)).toBe("100 €");
  });

  it("sin precio devuelve cadena vacía", () => {
    expect(formatWishlistPrice(null)).toBe("");
    expect(formatWishlistPrice(0)).toBe("");
    expect(formatWishlistPrice("nada")).toBe("");
  });
});
