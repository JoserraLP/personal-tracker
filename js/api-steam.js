// =============================================================
// Integración de Steam (Ajustes → Integración de Steam): le
// ofrece al usuario la lista de juegos que posee en su cuenta de
// Steam con las HORAS JUGADAS (del proxy steam-proxy, worker de
// Cloudflare; ver cloudflare/steam-proxy/).
//
// El cliente es delgado y PURO donde se pueda: normalizar la
// respuesta del worker y conversiones están separadas para poder
// testearlas sin red. Steam no se usa para buscar juegos (de eso
// se encarga la búsqueda del catálogo con IGDB/IGDB-proxy), solo
// para traer la biblioteca del usuario con sus horas.
//
// NOTA: Epic Games no ofrece una API pública para la biblioteca del
// usuario ni sus horas (requiere OAuth de tienda con permisos de
// desarrollador y no hay endpoint de tiempo de juego), así que NO se
// sincroniza y se documenta en el ADR-107.
// =============================================================

import { STEAM_PROXY_URL } from "./config.js";

// -------------------------------------------------------------
// Partes puras
// -------------------------------------------------------------

// Horas de Steam ("134.7") → texto español "134,7 h". Cadena vacía
// si no hay horas registradas.
export function steamHoursLabel(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return "";
  return h.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + " h";
}

// Valida un SteamID64 del formulario: 17 dígitos (los id modernos).
// Devuelve el valor limpio o "".
export function sanitizeSteamId(value) {
  const v = (value || "").trim();
  return /^\d{17}$/.test(v) ? v : "";
}

// Valida que el proxy esté configurado: la app no puede llamar a
// Steam sin él. Devuelve la URL o null.
export function steamProxyUrl() {
  return STEAM_PROXY_URL && /^https:\/\//.test(STEAM_PROXY_URL) ? STEAM_PROXY_URL : null;
}

// URL del endpoint /owned de un steamid (o null si no hay proxy).
// Se separa para testear sin fetch.
export function ownedUrl(steamId) {
  const base = steamProxyUrl();
  if (!base) return null;
  const sid = sanitizeSteamId(steamId);
  if (!sid) return null;
  return `${base.replace(/\/+$/, "")}/owned?steamid=${encodeURIComponent(sid)}`;
}

// -------------------------------------------------------------
// Cliente (fetch al Worker)
// -------------------------------------------------------------

/**
 * Pide al proxy la biblioteca del usuario y la normaliza.
 * @param {string} steamId - SteamID64 del usuario (17 dígitos).
 * @returns {Promise<{ total: number, games: Array<{appid, name, playtimeHours, lastPlayedAt}> }>} 
 *          Lanza con mensajes claros si falla la configuración o la red.
 */
export async function fetchOwnedSteamGames(steamId) {
  const url = ownedUrl(steamId);
  if (!url) {
    throw new Error(
      !steamProxyUrl()
        ? "Falta la URL del proxy de Steam (STEAM_PROXY_URL en js/config.js)."
        : "El SteamID debe tener 17 dígitos (SteamID64)."
    );
  }
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || `El proxy respondió HTTP ${res.status}.`);
  }
  return {
    total: data.total || 0,
    games: data.games || [],
    hint: data.hint || null,
  };
}
