// =============================================================
// Steam integration (Settings → Steam Integration): it offers the
// user the list of games they own on their Steam account with the
// PLAYED HOURS (from the steam-proxy proxy, a Cloudflare worker; see
// cloudflare/steam-proxy/).
//
// The client is thin and PURE where possible: normalizing the worker
// response and conversions are separated so they can be tested
// without network. Steam is not used to search for games (the
// catalog search with IGDB/IGDB-proxy handles that), only to fetch
// the user's library with their hours.
//
// NOTE: Epic Games does not offer a public API for the user's
// library or its hours (it requires store OAuth with developer
// permissions and there is no playtime endpoint), so it is NOT
// synced and this is documented in ADR-107.
// =============================================================

import { STEAM_PROXY_URL } from "./config.js";

// -------------------------------------------------------------
// Pure parts
// -------------------------------------------------------------

// Steam hours ("134.7") → Spanish text "134,7 h". Empty string
// if there are no recorded hours.
export function steamHoursLabel(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return "";
  return h.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + " h";
}

// Validates a SteamID64 from the form: 17 digits (modern ids).
// Returns the clean value or "".
export function sanitizeSteamId(value) {
  const v = (value || "").trim();
  return /^\d{17}$/.test(v) ? v : "";
}

// Validates that the proxy is configured: the app cannot call
// Steam without it. Returns the URL or null.
export function steamProxyUrl() {
  return STEAM_PROXY_URL && /^https:\/\//.test(STEAM_PROXY_URL) ? STEAM_PROXY_URL : null;
}

// URL of the /owned endpoint for a steamid (or null if there is no
// proxy). Separated so it can be tested without fetch.
export function ownedUrl(steamId) {
  const base = steamProxyUrl();
  if (!base) return null;
  const sid = sanitizeSteamId(steamId);
  if (!sid) return null;
  return `${base.replace(/\/+$/, "")}/owned?steamid=${encodeURIComponent(sid)}`;
}

// -------------------------------------------------------------
// OpenID login ("Sign in through Steam", ADR-108)
// -------------------------------------------------------------

// URL to start the linking login: the browser goes to the
// /login worker (which redirects to Steam) and comes back with the
// verified steamid to the current site (hash #/steam-callback). With the
// proxy unconfigured it returns null.
export function steamLoginUrl() {
  const base = steamProxyUrl();
  if (!base) return null;
  // In environments without window (tests in Node) there is nowhere to return from.
  if (typeof window === "undefined" || !window.location) return null;
  const returnTo = window.location.origin + window.location.pathname;
  return `${base.replace(/\/+$/, "")}/login?return_to=${encodeURIComponent(returnTo)}`;
}

/**
 * Interprets the return hash `#/steam-callback?steamid=...` (or
 * `...?error=verify`). Returns null if the hash is not from this flow.
 * @param {string} hash - current location.hash.
 */
export function parseSteamCallbackHash(hash) {
  const frag = (hash || "").replace(/^#\/?/, "");
  if (!frag.startsWith("steam-callback")) return null;
  try {
    const query = frag.slice("steam-callback".length).replace(/^\??/, "");
    const params = new URLSearchParams(query);
    const steamid = sanitizeSteamId(params.get("steamid"));
    if (steamid) return { steamid };
    return { error: params.get("error") || "unknown" };
  } catch {
    return { error: "unknown" };
  }
}

// -------------------------------------------------------------
// Client (fetch to the Worker)
// -------------------------------------------------------------

/**
 * Asks the proxy for the user's library and normalizes it.
 * @param {string} steamId - user's SteamID64 (17 digits).
 * @returns {Promise<{ total: number, games: Array<{appid, name, playtimeHours, lastPlayedAt}> }>}
 *          Throws with clear messages if the configuration or the network fails.
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
