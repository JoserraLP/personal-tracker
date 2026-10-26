// =============================================================
// Proxy de Steam Web API para la app Registro-personal.
//
// La API de Steam (api.steampowered.com) exige una STEAM_API_KEY
// que NO puede exponerse en una SPA, y sus respuestas NO llevan los
// CORS que exige el navegador. Este Worker (mismo patrón que
// cloudflare/igdb-proxy):
//   1. Guarda STEAM_API_KEY como secreto de Cloudflare.
//   2. Expone GET /owned?steamid=<id64> que consulta
//      IPlayerService/GetOwnedGames (juegos poseídos + minutos de
//      juego + último día jugado) y devuelve una lista normalizada
//      con CORS.
//   3. No guarda nada: solo caché en memoria del resultado por
//      aislamiento (los cambios en las horas/cuentas van llegando
//      en la siguiente petición del aislamiento).
//
// La app solo conoce la URL pública (STEAM_PROXY_URL en
// js/config.js), nunca la clave de la API.
//
// Documentación de Steam: https://steamcommunity.com/dev
// (obtención de la clave) y
// https://developer.valvesoftware.com/wiki/Steam_Web_API
// =============================================================

const STEAM_BASE = "https://api.steampowered.com";
const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";

// -------------------------------------------------------------
// OpenID 2.0 de Steam (login "Sign in through Steam", ADR-108)
// -------------------------------------------------------------
// Es el modo estándar de Steam para que una web sepa QUÉ usuario es:
// el navegador salta a Steam, el usuario inicia sesión TU cuenta de
// Steam y Steam redirige de vuelta con la identidad firmada al
// callback del Worker, que la VERIFICA servidor-a-servidor
// (check_authentication) antes de aceptarla. El Worker no guarda
// cuentas ni cookies: solo traduce el ida y vuelta y devuelve el
// SteamID64 a la app por URL.

/**
 * URL de /callback del worker (la que Steam usa como return_to).
 */
export function callbackUrl(workerOrigin) {
  return `${workerOrigin.replace(/\/+$/, "")}/callback`;
}

/**
 * Construye la URL [auth-request de Steam con return_to hacia el callback
 * del worker y recall final de la app. Puro, testeable.
 * @param {string} workerOrigin - Origen del propio worker (https://…).
 * @param {string} returnTo - URL de la app a la que volver DRM terminar el login.
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
 * Valida el return_to (la app a la que devolver el steamid): solo https
 * y, si el worker define ALLOWED_ORIGIN, debe coincidir con su host.
 * Devuelve el origin de la app (sin path:hz que docstreamulaş) o null.
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
  return parsed.origin;
}

/**
 * Extrae el SteamID64 de una identidad OpenID verificada
 * ("https://steamcommunity.com/openid/id/7656119...").
 */
export function steamidFromIdentity(identity) {
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(identity || "");
  return m ? m[1] : null;
}

// -------------------------------------------------------------
// CORS (idéntico patrón que el igdb-proxy)
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
// Normalización
// -------------------------------------------------------------

/**
 * Convierte la respuesta de GetOwnedGames en una lista lista para la
 * app: { games: [{ appid, name, playtimeHours, lastPlayedAt }] }.
 * Exportada para poder testearla sin Cloudflare (el worker se compila
   * como módulo ESM y vitest la importa).
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
        // Los minutos de Steam → horas con 1 decimal ("134,7 h").
        playtimeHours: Math.round((Number(g.playtime_forever) || 0) / 60 * 10) / 10,
        // rtime_last_played: epoch seconds; null si nunca se jugó.
        lastPlayedAt:
          g.rtime_last_played && g.rtime_last_played > 0
            ? new Date(g.rtime_last_played * 1000).toISOString().slice(0, 10)
            : null,
      }))
      .sort((a, b) => b.playtimeHours - a.playtimeHours),
  };
}

// -------------------------------------------------------------
// Handler principal
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

    // GET / — verificación del despliegue (paso 4 del README).
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

    // GET /login?return_to=<url de la app>: arranca el login OpenID
    // de Steam (redirige 302 a steamcommunity.com).
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

    // GET /callback?return_to=<app>&openid.* → verificación
    // check_authentication contra Steam y devolución del SteamID64
    // a la app por fragmento (#/steam-callback?steamid=...).
    if (request.method === "GET" && url.pathname === "/callback") {
      const returnTo = validateReturnTo(url.searchParams.get("return_to"), env);
      if (!returnTo) {
        return new Response(
          JSON.stringify({ error: "return_to ausente o no permitido." }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      try {
        // check_authentication: Steam exige reenviar TODOS los parámetros
        // openid.* con mode=check_authentication por POST.
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
          // Sin verificación válida: volver a la app con error.
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
          // Steam devuelve sin error si el perfil es privado o no tiene
          // juegos: se informa sin fallo para que el UI lo presente.
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
