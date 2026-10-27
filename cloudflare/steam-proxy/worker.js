// =============================================================
// Steam Web API proxy for the Registro-personal app.
//
// The Steam API (api.steampowered.com) requires a STEAM_API_KEY
// that CANNOT be exposed in a SPA, and its responses DO NOT carry the
// CORS the browser requires. This Worker (same pattern as
// cloudflare/igdb-proxy):
//   1. Stores STEAM_API_KEY as a Cloudflare secret.
//   2. Exposes GET /owned?steamid=<id64> which queries
//      IPlayerService/GetOwnedGames (owned games + playtime
//      minutes + last played day) and returns a normalized list
//      with CORS.
//   3. Stores nothing: only in-memory caching of the result per
//      isolation (changes in hours/accounts arrive on the next
//      request of the isolation).
//
// The app only knows the public URL (STEAM_PROXY_URL in
// js/config.js), never the API key.
//
// Steam documentation: https://steamcommunity.com/dev
// (getting the key) and
// https://developer.valvesoftware.com/wiki/Steam_Web_API
// =============================================================

const STEAM_BASE = "https://api.steampowered.com";
const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";

// -------------------------------------------------------------
// Steam OpenID 2.0 ("Sign in through Steam" login, ADR-108)
// -------------------------------------------------------------
// It is Steam's standard way for a website to know WHICH user it is:
// the browser jumps to Steam, the user signs in with THEIR Steam
// account and Steam redirects back with the signed identity to the
// Worker's callback, which VERIFIES it server-to-server
// (check_authentication) before accepting it. The Worker stores no
// accounts nor cookies: it only translates the round trip and returns
// the SteamID64 to the app via URL.

/**
 * URL of the worker's /callback (the one Steam uses as return_to).
 */
export function callbackUrl(workerOrigin) {
  return `${workerOrigin.replace(/\/+$/, "")}/callback`;
}

/**
 * Builds the Steam [auth-request URL with return_to pointing to the worker's
 * callback and final recall of the app. Pure, testable.
 * @param {string} workerOrigin - Origin of the worker itself (https://…).
 * @param {string} returnTo - URL of the app to return to once the login finishes.
 */
export function buildLoginRedirect(workerOrigin, returnTo) {
  const params = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": `${callbackUrl(workerOrigin)}?return_to=${encodeURIComponent(returnTo)}`,
    "openid.realm": workerOrigin.replace(/\/+$/, ""),
    "openid.identity": `${OPENID_NS}/identifier_select`,
    "openid.claimed_id": `${OPENID_NS}/identifier_select`,
  });
  return `${STEAM_OPENID}?${params.toString()}`;
}

/**
 * Validates the return_to (the app to return the steamid to): https only,
 * and if the worker defines ALLOWED_ORIGIN it must match its host.
 * Returns the app's origin (path kept so the doc URL is not lost) or null.
 */
export function validateReturnTo(returnTo, env) {
  if (!returnTo) return null;
  let parsed;
  try {
    parsed = new URL(returnTo);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const allowed = env && env.ALLOWED_ORIGIN;
  if (allowed) {
    try {
      if (new URL(allowed).host !== parsed.host) return null;
    } catch {
      return null;
    }
  }
  // Returns the FULL URL (origin + path): the callback redirects to
  // this same URL with #/steam-callback. Returning only the origin
  // lost the GitHub Pages deploy subdirectory
  // (/personal-tracker/) and landed on a 404 of the root domain.
  return parsed.origin + parsed.pathname;
}

/**
 * Extracts the SteamID64 from a verified OpenID identity
 * ("https://steamcommunity.com/openid/id/7656119...").
 */
export function steamidFromIdentity(identity) {
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(identity || "");
  return m ? m[1] : null;
}

// -------------------------------------------------------------
// CORS (identical pattern to the igdb-proxy)
// -------------------------------------------------------------

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin");
  let allowOrigin = env.ALLOWED_ORIGIN || "*";
  if (origin && env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) {
    allowOrigin = env.ALLOWED_ORIGIN;
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function isAllowedOrigin(env, request) {
  if (!env.ALLOWED_ORIGIN) return true;
  const origin = request.headers.get("Origin");
  return !origin || origin === env.ALLOWED_ORIGIN;
}

// -------------------------------------------------------------
// Normalization
// -------------------------------------------------------------

/**
 * Converts the GetOwnedGames response into a list ready for the
 * app: { games: [{ appid, name, playtimeHours, lastPlayedAt }] }.
 * Exported so it can be tested without Cloudflare (the worker is
 * compiled as an ESM module and vitest imports it).
 */
export function normalizeOwnedGames(data) {
  const games = Array.isArray(data?.response?.games) ? data.response.games : [];
  return {
    total: games.length,
    games: games
      .filter((g) => g && typeof g.appid === "number")
      .map((g) => ({
        appid: g.appid,
        name: g.name || `App ${g.appid}`,
        // Steam's minutes → hours with 1 decimal ("134,7 h").
        playtimeHours: Math.round((Number(g.playtime_forever) || 0) / 60 * 10) / 10,
        // rtime_last_played: epoch seconds; null if never played.
        lastPlayedAt:
          g.rtime_last_played && g.rtime_last_played > 0
            ? new Date(g.rtime_last_played * 1000).toISOString().slice(0, 10)
            : null,
      }))
      .sort((a, b) => b.playtimeHours - a.playtimeHours),
  };
}

// -------------------------------------------------------------
// Main handler
// -------------------------------------------------------------

export default {
  async fetch(request, env) {
    if (!isAllowedOrigin(env, request)) {
      return new Response(JSON.stringify({ error: "Origen no permitido" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    const url = new URL(request.url);

    // GET / — deployment verification (step 4 of the README).
    if (request.method === "GET" && url.pathname === "/") {
      const secretsConfigured = Boolean(env.STEAM_API_KEY);
      return new Response(
        JSON.stringify(
          {
            ok: true,
            service: "steam-proxy",
            secretsConfigured,
            hint: secretsConfigured
              ? "Secretos OK. Prueba GET /owned?steamid=<tu-steamid>."
              : "Falta el secreto: wrangler secret put STEAM_API_KEY",
          },
          null,
          2
        ),
        {
          status: 200,
          headers: {
            ...corsHeaders(env, request),
            "Content-Type": "application/json",
          },
        }
      );
    }

    // GET /login?return_to=<app url>: starts the OpenID login
    // of Steam (302 redirect to steamcommunity.com).
    if (request.method === "GET" && url.pathname === "/login") {
      const returnTo = validateReturnTo(url.searchParams.get("return_to"), env);
      if (!returnTo) {
        return new Response(
          JSON.stringify({ error: "return_to ausente o no permitido (solo https y el origen de ALLOWED_ORIGIN si está configurado)." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: buildLoginRedirect(url.origin, returnTo),
          "Cache-Control": "no-store",
        },
      });
    }

    // GET /callback?return_to=<app>&openid.* → check_authentication
    // verification against Steam and return of the SteamID64
    // to the app via fragment (#/steam-callback?steamid=...).
    if (request.method === "GET" && url.pathname === "/callback") {
      const returnTo = validateReturnTo(url.searchParams.get("return_to"), env);
      if (!returnTo) {
        return new Response(
          JSON.stringify({ error: "return_to ausente o no permitido." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      try {
        // check_authentication: Steam requires re-sending ALL the openid.*
        // params with mode=check_authentication via POST.
        const params = new URLSearchParams();
        for (const [k, v] of url.searchParams) {
          if (k.startsWith("openid.")) params.set(k, v);
        }
        params.set("openid.mode", "check_authentication");
        const verifyRes = await fetch(STEAM_OPENID, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        const verifyText = await verifyRes.text();
        const isValid = /is_valid\s*:\s*true/.test(verifyText);
        const identity = url.searchParams.get("openid.identity") || "";
        const steamid = isValid ? steamidFromIdentity(identity) : null;

        if (!steamid) {
          // Without valid verification: back to the app with an error.
          return Response.redirect(`${returnTo}#/steam-callback?error=verify`, 302);
        }
        return Response.redirect(
          `${returnTo}#/steam-callback?steamid=${encodeURIComponent(steamid)}`,
          302
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // GET /owned?steamid=<steamid64>
    if (request.method === "GET" && url.pathname === "/owned") {
      const steamid = (url.searchParams.get("steamid") || "").trim();
      if (!/^\d{17}$/.test(steamid)) {
        return new Response(
          JSON.stringify({ error: "steamid inválido: debe ser el SteamID64 de 17 dígitos." }),
          { status: 400, headers: { ...corsHeaders(env, request), "Content-Type": "application/json" } }
        );
      }
      if (!env.STEAM_API_KEY) {
        return new Response(
          JSON.stringify({ error: "Falta STEAM_API_KEY: wrangler secret put STEAM_API_KEY" }),
          { status: 500, headers: { ...corsHeaders(env, request), "Content-Type": "application/json" } }
        );
      }

      const target =
        `${STEAM_BASE}/IPlayerService/GetOwnedGames/v0001/` +
        `?key=${encodeURIComponent(env.STEAM_API_KEY)}` +
        `&steamid=${encodeURIComponent(steamid)}` +
        `&include_appinfo=true&include_played_free_games=true`;

      try {
        const res = await fetch(target);
        if (!res.ok) {
          return new Response(
            JSON.stringify({ error: `Steam respondió HTTP ${res.status}.` }),
            { status: 502, headers: { ...corsHeaders(env, request), "Content-Type": "application/json" } }
          );
        }
        const parsed = normalizeOwnedGames(await res.json());
        if (parsed.total === 0) {
          // Steam returns without an error if the profile is private or it
          // has no games: reported without failure so the UI can present it.
          return new Response(
            JSON.stringify({
              games: [],
              total: 0,
              hint: "0 juegos: revisa que el perfil esté público en Steam (Detalles del juego → Privacidad → Público) y que el steamid sea correcto.",
            }),
            {
              status: 200,
              headers: { ...corsHeaders(env, request), "Content-Type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify(parsed), {
          status: 200,
          headers: { ...corsHeaders(env, request), "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 502,
          headers: { ...corsHeaders(env, request), "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({ error: `Ruta no soportada: ${url.pathname} (usa /owned?steamid=...)` }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  },
};
