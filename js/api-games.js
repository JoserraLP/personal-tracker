// =============================================================
// Cliente de búsqueda externa de videojuegos en IGDB (spec 002,
// T-004, API-004).
//
// IGDB (Twitch) no tiene CORS y exige un Client Secret que no
// puede exponerse en una SPA, así que se busca a través del proxy
// público de Cloudflare (cloudflare/igdb-proxy/worker.js):
//
//   POST {IGDB_PROXY_URL}/v4/games
//   Content-Type: text/plain
//   body: search "nombre"; fields name, first_release_date,
//          cover.image_id, summary, story; limit 10;
//
// El Worker reenvía el cuerpo tal cual a https://api.igdb.com/v4/
// games (sintaxis Apicalypse) y devuelve el JSON de IGDB.
//
// CONTRATO COMÚN (§4.1 de spec.md):
//   éxito  → { ok: true, items: SearchResult[] }
//   vacío  → { ok: true, items: [] }
//   fallo  → { ok: false, provider, code, message }
//            code ∈ 'timeout' | 'unauthorized' | 'rate_limited'
//                  | 'not_found' | 'unknown'
//
// SearchResult (autofill parcial, REQ-006 / AC-013):
//   { source: 'igdb', externalId, mediaType: 'game', title, year,
//     posterUrl, synopsis, genres[], durationMinutes }
//   · Los campos ausentes → null (nunca undefined) y nunca bloquean
//     el guardado.
//   · IGDB no da duración de juego: durationMinutes es null.
//   · Los géneros de IGDB son ids: se piden los nombres aparte, así
//     que genres[] queda vacío (autofill parcial).
//
// Normalización PURA separada del fetch (patrón de js/api-steam.js)
// para poder testear sin red.
// =============================================================

import { IGDB_PROXY_URL } from "./config.js";

// -------------------------------------------------------------
// Constantes
// -------------------------------------------------------------

export const IGDB_PROVIDER = "igdb";
export const IGDB_TIMEOUT_MS = 8000;
export const IGDB_COVER_BASE_URL =
  "https://images.igdb.com/igdb/image/upload/t_cover_big/";
export const IGDB_DEFAULT_LIMIT = 10;
export const IGDB_MAX_LIMIT = 25;
export const IGDB_SYNOPSIS_MAX = 2000;

// =============================================================
// PARTE PURA (sin red)
// =============================================================

// Normaliza un texto: null/undefined/no string → "".
function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Recorta un texto largo al límite de DB-001 (sinopsis ≤ 2000).
function clampSynopsis(text) {
  const value = asText(text);
  if (!value) return null;
  if (value.length <= IGDB_SYNOPSIS_MAX) return value;
  return `${value.slice(0, IGDB_SYNOPSIS_MAX - 1).trimEnd()}…`;
}

// Normaliza el límite de resultados pedido por el frontend.
export function clampIgdbLimit(limit) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) return IGDB_DEFAULT_LIMIT;
  return Math.min(Math.floor(value), IGDB_MAX_LIMIT);
}

// URL base del proxy (o null si no está configurado / no es https).
export function igdbProxyUrl() {
  const url = asText(IGDB_PROXY_URL).replace(/\/+$/, "");
  if (!url || !/^https:\/\//i.test(url)) return null;
  return url;
}

// Endpoint de búsqueda de juegos del proxy (o null si falta).
export function igdbGamesEndpoint() {
  const base = igdbProxyUrl();
  return base ? `${base}/v4/games` : null;
}

// Limpia el texto de búsqueda: IGDB no acepta comillas sueltas en
// la sintaxis Apicalypse, así que se eliminan (nunca rompen la
// consulta).
export function sanitizeIgdbQuery(query) {
  return asText(query).replace(/["`\\]/g, " ").replace(/\s+/g, " ").trim();
}

// Construye la consulta Apicalypse que entiende IGDB.
// Ejemplo: search "zelda"; fields name, first_release_date,
//          cover.image_id, summary, story; limit 10;
export function buildIgdbQuery(query, options = {}) {
  const term = sanitizeIgdbQuery(query);
  const limit = clampIgdbLimit(options.limit);
  const fields = [
    "name",
    "first_release_date",
    "cover.image_id",
    "summary",
    "story",
  ].join(", ");
  return `search "${term}"; fields ${fields}; limit ${limit};`;
}

// Timestamp de IGDB (segundos Unix) → año (number) | null.
export function igdbYear(timestamp) {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCFullYear();
}

// image_id de la portada de IGDB → URL de la imagen | null.
export function igdbCoverUrl(imageId) {
  const id = asText(imageId);
  if (!id) return null;
  if (/^https?:\/\//i.test(id)) return id;
  return `${IGDB_COVER_BASE_URL}${id}.jpg`;
}

// Normaliza un juego de IGDB → SearchResult (API-004).
export function normalizeIgdbGame(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const cover =
    source.cover && typeof source.cover === "object" ? source.cover : {};
  return {
    source: IGDB_PROVIDER,
    externalId:
      source.id === null || source.id === undefined ? "" : String(source.id),
    mediaType: "game",
    title: asText(source.name),
    year: igdbYear(source.first_release_date),
    posterUrl: igdbCoverUrl(cover.image_id),
    synopsis: clampSynopsis(source.summary || source.story),
    genres: [],
    durationMinutes: null,
  };
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
function igdbError(code, message) {
  return { ok: false, provider: IGDB_PROVIDER, code, message };
}

// Mensaje de error del proxy ({error}) o de IGDB.
function apiErrorMessage(data) {
  if (!data || typeof data !== "object") return "";
  return asText(data.error) || asText(data.message) || asText(data.title);
}

// Petición JSON al proxy con timeout (AbortController, ~8 s).
async function requestJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || IGDB_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: options.method || "POST",
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
          apiErrorMessage(data) || `El proxy de IGDB respondió HTTP ${res.status}.`,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    if (isAbortError(err)) {
      return {
        ok: false,
        status: 0,
        code: "timeout",
        message: `IGDB no respondió a tiempo (${Math.round(timeoutMs / 1000)} s).`,
      };
    }
    return {
      ok: false,
      status: 0,
      code: "unknown",
      message: `No se pudo consultar IGDB: ${err && err.message ? err.message : "error de red"}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Búsqueda de videojuegos vía el proxy de IGDB (API-004).
// options: { limit = 10 }
// → { ok: true, items } | { ok: false, provider, code, message }
export async function searchIgdbGames(query, options = {}) {
  const term = sanitizeIgdbQuery(query);
  if (!term) return { ok: true, items: [] };

  const endpoint = igdbGamesEndpoint();
  if (!endpoint) {
    return igdbError(
      "unknown",
      "Falta IGDB_PROXY_URL en js/config.js: configura el proxy de IGDB (cloudflare/igdb-proxy/README.md)."
    );
  }

  const res = await requestJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: buildIgdbQuery(term, options),
  });
  if (!res.ok) {
    return igdbError(res.code, res.message);
  }

  const results = Array.isArray(res.data) ? res.data : [];
  const limit = clampIgdbLimit(options.limit);
  const items = results
    .slice(0, limit)
    .map((raw) => normalizeIgdbGame(raw))
    .filter((item) => item.title !== "");
  return { ok: true, items };
}
