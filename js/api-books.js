// =============================================================
// Cliente de búsqueda externa de libros en Google Books
// (spec 002, T-004, API-005).
//
//   GET https://www.googleapis.com/books/v1/volumes?q=...&key=...
//
// La clave (GOOGLE_BOOKS_API_KEY) es pública y opcional: sin ella
// la API funciona con un límite de peticiones más bajo.
//
// CONTRATO COMÚN (§4.1 de spec.md):
//   éxito  → { ok: true, items: SearchResult[] }
//   vacío  → { ok: true, items: [] }
//   fallo  → { ok: false, provider, code, message }
//            code ∈ 'timeout' | 'unauthorized' | 'rate_limited'
//                  | 'not_found' | 'unknown'
//
// SearchResult (autofill parcial, REQ-006 / AC-012):
//   { source: 'googlebooks', externalId, mediaType: 'book', title,
//     author, year, posterUrl, synopsis, genres[], durationMinutes }
//   · author es un campo EXCLUSIVO de libros (AC-012).
//   · Los campos ausentes → null (nunca undefined) y nunca bloquean
//     el guardado.
//   · Un libro no tiene duración: durationMinutes es null (AC-012).
//
// Normalización PURA separada del fetch (patrón de js/api-steam.js)
// para poder testear sin red.
// =============================================================

import { GOOGLE_BOOKS_API_KEY } from "./config.js";

// -------------------------------------------------------------
// Constantes
// -------------------------------------------------------------

export const BOOKS_PROVIDER = "googlebooks";
export const GOOGLE_BOOKS_BASE_URL =
  "https://www.googleapis.com/books/v1/volumes";
export const BOOKS_TIMEOUT_MS = 8000;
export const BOOKS_DEFAULT_LIMIT = 10;
export const BOOKS_MAX_LIMIT = 40;
export const BOOKS_MAX_GENRES = 10;
export const BOOKS_SYNOPSIS_MAX = 2000;

// =============================================================
// PARTE PURA (sin red)
// =============================================================

// Normaliza un texto: null/undefined/no string → "".
function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Normaliza el límite de resultados pedido por el frontend.
export function clampBooksLimit(limit) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) return BOOKS_DEFAULT_LIMIT;
  return Math.min(Math.floor(value), BOOKS_MAX_LIMIT);
}

// "1999-05-01" (o "1999") → 1999. Valor inválido → null.
export function booksYear(publishedDate) {
  const text = asText(publishedDate);
  if (!text) return null;
  const match = /^(\d{4})/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

// Autores de Google Books (string[]) → "Autor, Otro" | null.
export function booksAuthor(authors) {
  const list = Array.isArray(authors) ? authors : [];
  const names = list
    .map((author) => asText(author))
    .filter((name) => name !== "");
  if (names.length === 0) return null;
  return names.join(", ");
}

// Categorías de Google Books → string[] (nombres, máx. 10).
export function booksCategories(categories) {
  const list = Array.isArray(categories) ? categories : [];
  const names = list
    .map((category) => asText(category))
    .filter((name) => name !== "");
  return Array.from(new Set(names)).slice(0, BOOKS_MAX_GENRES);
}

// Portada de Google Books → URL https | null.
// Prefiere la imagen más grande disponible.
export function booksCoverUrl(imageLinks) {
  const links = imageLinks && typeof imageLinks === "object" ? imageLinks : {};
  const candidates = [links.large, links.medium, links.thumbnail, links.smallThumbnail];
  for (const candidate of candidates) {
    const url = asText(candidate);
    if (!url) continue;
    return url.replace(/^http:\/\//i, "https://");
  }
  return null;
}

// Sinopsis de Google Books: quita el HTML, decodifica las
// entidades básicas y recorta al límite de DB-001 (≤ 2000).
export function booksSynopsis(description) {
  let text = asText(description);
  if (!text) return null;
  text = text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= BOOKS_SYNOPSIS_MAX) return text;
  return `${text.slice(0, BOOKS_SYNOPSIS_MAX - 1).trimEnd()}…`;
}

// Normaliza un volumen de Google Books → SearchResult (API-005).
export function normalizeBook(volume) {
  const source = volume && typeof volume === "object" ? volume : {};
  const info =
    source.volumeInfo && typeof source.volumeInfo === "object"
      ? source.volumeInfo
      : {};
  return {
    source: BOOKS_PROVIDER,
    externalId:
      source.id === null || source.id === undefined ? "" : String(source.id),
    mediaType: "book",
    title: asText(info.title) || asText(info.subtitle),
    author: booksAuthor(info.authors),
    year: booksYear(info.publishedDate),
    posterUrl: booksCoverUrl(info.imageLinks),
    synopsis: booksSynopsis(info.description),
    genres: booksCategories(info.categories),
    durationMinutes: null,
  };
}

// URL de búsqueda de volúmenes.
export function googleBooksUrl(query, options = {}) {
  const params = new URLSearchParams({
    q: asText(query),
    maxResults: String(clampBooksLimit(options.limit)),
    printType: "books",
  });
  const key = asText(GOOGLE_BOOKS_API_KEY);
  if (key) params.set("key", key);
  return `${GOOGLE_BOOKS_BASE_URL}?${params.toString()}`;
}

// =============================================================
// PARTE CON RED (fetch + contrato §4.1)
// =============================================================

// Traduce un status HTTP a un code del contrato §4.1.
function statusToCode(status) {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "unknown";
}

// ¿El error es una cancelación por AbortController (timeout)?
function isAbortError(err) {
  if (!err) return false;
  return err.name === "AbortError" || err.code === 20;
}

// Error normalizado §4.1.
function booksError(code, message) {
  return { ok: false, provider: BOOKS_PROVIDER, code, message };
}

// Mensaje de error de la API de Google Books.
function apiErrorMessage(data) {
  if (!data || typeof data !== "object") return "";
  const error = data.error;
  if (error && typeof error === "object") {
    return asText(error.message) || asText(error.status);
  }
  return asText(error) || asText(data.message);
}

// Petición JSON con timeout (AbortController, ~8 s).
async function requestJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || BOOKS_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body || undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: statusToCode(res.status),
        message:
          apiErrorMessage(data) ||
          `Google Books respondió HTTP ${res.status}.`,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    if (isAbortError(err)) {
      return {
        ok: false,
        status: 0,
        code: "timeout",
        message: `Google Books no respondió a tiempo (${Math.round(timeoutMs / 1000)} s).`,
      };
    }
    return {
      ok: false,
      status: 0,
      code: "unknown",
      message: `No se pudo consultar Google Books: ${err && err.message ? err.message : "error de red"}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Búsqueda de libros en Google Books (API-005).
// options: { limit = 10 }
// → { ok: true, items } | { ok: false, provider, code, message }
export async function searchGoogleBooks(query, options = {}) {
  const term = asText(query);
  if (!term) return { ok: true, items: [] };

  const res = await requestJson(googleBooksUrl(term, options));
  if (!res.ok) {
    return booksError(res.code, res.message);
  }

  const volumes =
    res.data && Array.isArray(res.data.items) ? res.data.items : [];
  const limit = clampBooksLimit(options.limit);
  const items = volumes
    .slice(0, limit)
    .map((volume) => normalizeBook(volume))
    .filter((item) => item.title !== "");
  return { ok: true, items };
}
