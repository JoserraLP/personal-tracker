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
