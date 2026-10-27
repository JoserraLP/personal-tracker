// =============================================================
// Videogame search and extended data (genres, platforms,
// developers, publishers, ESRB rating, community score...) in IGDB (Twitch),
// through a Cloudflare Worker that acts as a proxy (IGDB has no CORS and
// its Client Secret cannot be exposed in an SPA). See cloudflare/igdb-proxy/README.md.
// IGDB documentation: https://api-docs.igdb.com/
// =============================================================

import { IGDB_PROXY_URL } from "./config.js";

const PROXY_BASE = (IGDB_PROXY_URL || "").replace(/\/+$/, "");

// The proxy is not a secret (it is the Worker's public URL), but if
// it is empty the search cannot work: a clear error
// indicates where to configure it.
function requireProxy() {
  if (!PROXY_BASE) {
    throw new Error(
      "Falta IGDB_PROXY_URL en js/config.js (ver cloudflare/igdb-proxy/README.md)."
    );
  }
}

// IGDB limits to 4 requests per second (cloudflare/igdb-proxy/README.md).
// With minimal storage the details are requested on
// demand (issue #200), so several details opened in a row could chain
// requests: they are serialized with a minimum interval of 250 ms between each
// one (equivalent to a semaphore ≤ 4 req/s), reusing the discipline
// of the daily pass pool (mapConcurrent in daily-check.js).
const IGDB_MIN_INTERVAL_MS = 250;
let igdbLastRequestAt = 0;

async function igdbThrottle() {
  const now = Date.now();
  const wait = Math.max(0, igdbLastRequestAt + IGDB_MIN_INTERVAL_MS - now);
  igdbLastRequestAt = now + wait; // reserves the slot for the next one
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

// POST request to the proxy, which forwards it to api.igdb.com/v4 with the
// Client-ID and Authorization headers already set. Normalizes
// transport errors (network down, unreachable proxy, CORS
// blocked) and parsing errors into a clear Spanish message, just like
// the other API clients do (fetchJson), and retries once
// transport failures (proxy failures are usually
// transient; IGDB's limit is 4 req/s, one retry is safe).
async function igdbPost(endpoint, body) {
  requireProxy();
  await igdbThrottle();
  const doFetch = () =>
    fetch(`${PROXY_BASE}/v4/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    });
  let res;
  try {
    res = await doFetch();
  } catch {
    try {
      res = await doFetch(); // a single retry on transient failures
    } catch {
      // Network down, unreachable proxy or CORS blocked: there is no
      // HTTP response to inspect.
      throw new Error("No se pudo conectar con IGDB. Inténtalo de nuevo.");
    }
  }
  if (!res.ok) {
    // HTTP 401/403 = invalid Twitch credentials or expired
    // token; 403 can also be the proxy's "origin not allowed".
    // Any other failure (5xx...) is temporary and it is worth
    // distinguishing it from the credentials error.
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "IGDB rechazó la petición. Revisa las credenciales del proxy (cloudflare/igdb-proxy/README.md)."
      );
    }
    throw new Error("No se pudo conectar con IGDB. Inténtalo de nuevo.");
  }
  try {
    return await res.json();
  } catch {
    // Non-JSON body (e.g. HTML error page from the host).
    throw new Error("No se pudo conectar con IGDB. Inténtalo de nuevo.");
  }
}

const SEARCH_FIELDS = [
  "name",
  "first_release_date",
  "cover.image_id",
  "summary",
  "total_rating",
  "aggregated_rating",
  "genres.name",
  "platforms.name",
].join(", ");

const DETAIL_FIELDS = [
  "name",
  "first_release_date",
  "cover.image_id",
  "summary",
  "total_rating",
  "aggregated_rating",
  "genres.name",
  "platforms.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "age_ratings.rating",
  "age_ratings.category",
].join(", ");

// Fields of IGDB's game_videos endpoint (YouTube trailer).
const GAME_VIDEO_FIELDS = ["video_id", "name"].join(", ");

// IGDB age ratings: category 1 = ESRB.
const ESRB_RATINGS = {
  1: "RP", 2: "EC", 3: "E", 4: "E10+", 5: "T", 6: "M", 7: "AO",
};

// IGDB scores 0–100; the app shows the community score on the
// same 0–10 scale as TMDB (see user manual §10).
function toCommunityRating(r) {
  const value = r.total_rating ?? r.aggregated_rating;
  if (value == null || value <= 0) return null;
  return Math.round((value / 10) * 10) / 10;
}

function yearFromTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime()) ? "" : String(d.getFullYear());
}

// Release date in the canonical "YYYY-MM-DD" format with LOCAL date
// parts: toISOString() would use UTC and shift the day near
// midnight (same local criterion as yearFromTimestamp).
function dateFromTimestamp(ts) {
  if (!ts) return null;
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function coverUrl(imageId) {
  return imageId
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`
    : null;
}

function esrbName(r) {
  const esrb = (r.age_ratings || []).find((a) => a.category === 1);
  return esrb && ESRB_RATINGS[esrb.rating] ? ESRB_RATINGS[esrb.rating] : null;
}

function mapGameResult(r) {
  return {
    externalId: String(r.id),
    type: "game",
    title: r.name,
    year: yearFromTimestamp(r.first_release_date),
    releaseDate: dateFromTimestamp(r.first_release_date),
    coverUrl: coverUrl(r.cover && r.cover.image_id),
    overview: r.summary || "",
    genres: (r.genres || []).map((g) => g.name),
    platforms: (r.platforms || []).map((p) => p.name),
    metacritic: null, // IGDB has no Metacritic
    communityRating: toCommunityRating(r),
    esrbName: esrbName(r),
  };
}

// Paginated search in the IGDB catalog (via proxy).
export async function searchGames(searchTerm, page = 1) {
  const offset = (page - 1) * 20;
  const body = `search "${searchTerm.replace(/"/g, '\\"')}"; fields ${SEARCH_FIELDS}; limit 20; offset ${offset};`;
  const data = await igdbPost("games", body);
  const items = Array.isArray(data) ? data.map(mapGameResult) : [];
  // IGDB doesn't explicitly return "has more": if 20
  // results come back (the maximum requested), there are most likely more.
  return { items, hasMore: items.length === 20 };
}

// Extracts the YouTube trailer URL from the response of the
// game_videos endpoint of IGDB. Prioritizes the video with "trailer" in the
// name; otherwise, the first one with a non-empty video_id. null if there
// is none (same pattern as _extractTrailerUrl from api-movies.js).
function extractTrailerUrl(videos) {
  if (!Array.isArray(videos) || !videos.length) return null;
  const withId = videos.filter((v) => v && v.video_id);
  if (!withId.length) return null;
  const best =
    withId.find((v) => (v.name || "").toLowerCase().includes("trailer")) ||
    withId[0];
  return `https://www.youtube.com/watch?v=${best.video_id}`;
}

// Trailer URL of the game (or null). The trailer is a non-critical
// extra: it never throws, any failure returns null.
async function getGameTrailerUrl(id) {
  try {
    const body = `fields ${GAME_VIDEO_FIELDS}; where game = ${Number(id)}; limit 5;`;
    const data = await igdbPost("game_videos", body);
    return extractTrailerUrl(Array.isArray(data) ? data : []);
  } catch {
    return null;
  }
}

// Extended data of a game: full synopsis, genres,
// platforms, developers, publishers, ESRB rating,
// community score and trailer. They are requested once,
// when adding it (and to enrich the catalog preview).
export async function getGameDetails(id) {
  const body = `fields ${DETAIL_FIELDS}; where id = ${Number(id)};`;
  const data = await igdbPost("games", body);
  const r = Array.isArray(data) && data.length ? data[0] : null;
  if (!r) return {};

  const companies = r.involved_companies || [];
  return {
    description: r.summary || "",
    genres: (r.genres || []).map((g) => g.name),
    platforms: (r.platforms || []).map((p) => p.name),
    developers: companies
      .filter((c) => c.developer && c.company)
      .map((c) => c.company.name),
    publishers: companies
      .filter((c) => c.publisher && c.company)
      .map((c) => c.company.name),
    metacritic: null,
    playtime: null, // IGDB has no average playtime
    esrbName: esrbName(r),
    communityRating: toCommunityRating(r),
    coverUrl: coverUrl(r.cover && r.cover.image_id),
    year: yearFromTimestamp(r.first_release_date),
    releaseDate: dateFromTimestamp(r.first_release_date),
    trailerUrl: await getGameTrailerUrl(id),
  };
}
