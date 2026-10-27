// =============================================================
// Search of movies and TV series, seasons/episodes, and extended
// data (runtime, cast, synopsis...) in TMDB. Free for
// non-commercial use, with attribution (see footer of index.html).
// Documentation: https://developer.themoviedb.org/docs
// =============================================================

import { TMDB_API_KEY } from "./config.js";
import { fetchJson } from "./http.js";

const BASE_URL = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w342";

export async function searchMovies(searchTerm, page = 1) {
  const url = `${BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&language=es-ES&include_adult=false&page=${page}&query=${encodeURIComponent(
    searchTerm
  )}`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => {
    throw new Error("No se pudo buscar en TMDB. Revisa tu clave de API.");
  });
  return {
    items: (data.results || []).map(mapMovieResult),
    hasMore: (data.page || 1) < (data.total_pages || 1),
  };
}

export async function searchTv(searchTerm, page = 1) {
  const url = `${BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&language=es-ES&include_adult=false&page=${page}&query=${encodeURIComponent(
    searchTerm
  )}`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => {
    throw new Error("No se pudo buscar en TMDB. Revisa tu clave de API.");
  });
  return {
    items: (data.results || []).map(mapTvResult),
    hasMore: (data.page || 1) < (data.total_pages || 1),
  };
}

function mapMovieResult(r) {
  return {
    externalId: String(r.id),
    type: "movie",
    title: r.title,
    year: (r.release_date || "").slice(0, 4),
    coverUrl: r.poster_path ? `${IMG_BASE}${r.poster_path}` : null,
    overview: r.overview || "",
  };
}

function mapTvResult(r) {
  return {
    externalId: String(r.id),
    type: "tv",
    title: r.name,
    year: (r.first_air_date || "").slice(0, 4),
    coverUrl: r.poster_path ? `${IMG_BASE}${r.poster_path}` : null,
    overview: r.overview || "",
  };
}

// Normalizes the list of seasons returned by TMDB: "specials"
// (season_number 0) are ignored and the air date is normalized to
// null when TMDB doesn't announce it (a season without air_date is NOT
// released yet; a null is real information, not an API failure).
function normalizeSeasons(seasons) {
  return (seasons || [])
    .filter((s) => s.season_number > 0)
    .map((s) => ({
      seasonNumber: s.season_number,
      name: s.name,
      episodeCount: s.episode_count,
      airDate: s.air_date || null,
    }));
}

// Map season -> air date (or null if it doesn't have an official
// date yet): { "1": "2020-01-01", "2": null, ... }. Object.fromEntries
// keeps the nulls, which are real information about a "season not
// released yet". It is persisted in the item and refreshed daily.
export function seasonAirDateMap(seasons) {
  return Object.fromEntries(
    normalizeSeasons(seasons).map((s) => [String(s.seasonNumber), s.airDate])
  );
}

// List of seasons of a TV series (name and number of episodes of each one),
// plus "live" data about the airing status and the next episode
// (useful for the "not yet released" warning).
export async function getTvSeasonsMeta(tvId) {
  const url = `${BASE_URL}/tv/${tvId}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => {
    throw new Error("No se pudo obtener la serie desde TMDB.");
  });
  return normalizeSeasons(data.seasons);
}

// Episodes (number, name, air date and community
// rating) of a specific season. They are only requested when the
// user expands that season or marks an episode, and they are cached
// in memory for 24 h (same shared cache as the watch providers).
export async function getSeasonEpisodes(tvId, seasonNumber) {
  const cacheKey = `season_${tvId}_${seasonNumber}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/tv/${tvId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => {
    throw new Error("No se pudo obtener la temporada desde TMDB.");
  });
  const episodes = (data.episodes || []).map((e) => ({
    episodeNumber: e.episode_number,
    name: e.name || `Episodio ${e.episode_number}`,
    airDate: e.air_date || null,
    episodeRating: e.vote_count > 0 ? e.vote_average : null,
  }));
  setCache(cacheKey, episodes);
  return episodes;
}

// Extracts the official YouTube trailer URL from the
// response of TMDB's /videos endpoint. Prioritizes "Trailer" over
// "Teaser" and, within the same type, the most recent one (by id).
function _extractTrailerUrl(videos) {
  if (!videos || !videos.results || !videos.results.length) return null;
  const trailers = videos.results.filter(
    (v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
  );
  if (!trailers.length) return null;
  // Prioritize "Trailer" over "Teaser"
  const best = trailers.find((v) => v.type === "Trailer") || trailers[0];
  return `https://www.youtube.com/watch?v=${best.key}`;
}

// Extended data of a movie: runtime, synopsis, genre,
// director, main cast, collection/saga and trailer. With
// minimal storage (issue #200) they are requested on demand when
// opening the detail view (and also when adding to learn the release
// date), with a 24 h in-memory cache (the same shared as
// the watch providers): a freshly added or already visited item
// does not call the API again.
export async function getMovieDetails(id) {
  const cacheKey = `details_movie_${id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/movie/${id}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,videos`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data) return {};
  const director = ((data.credits && data.credits.crew) || []).find(
    (c) => c.job === "Director"
  );
  const result = {
    runtime: data.runtime || null,
    overview: data.overview || "",
    genres: (data.genres || []).map((g) => g.name),
    cast: ((data.credits && data.credits.cast) || []).slice(0, 5).map((c) => c.name),
    director: director ? director.name : null,
    releaseDate: data.release_date || null,
    communityRating: data.vote_count > 0 ? data.vote_average : null,
    trailerUrl: _extractTrailerUrl(data.videos),
    collectionId: data.belongs_to_collection ? String(data.belongs_to_collection.id) : null,
    collectionName: data.belongs_to_collection ? data.belongs_to_collection.name : null,
    collectionPoster: data.belongs_to_collection?.poster_path
      ? `${IMG_BASE.replace("w342", "w92")}${data.belongs_to_collection.poster_path}`
      : null,
    coverUrl: data.poster_path ? `${IMG_BASE}${data.poster_path}` : null,
  };
  setCache(cacheKey, result);
  return result;
}

// Data of a TMDB collection/saga: name, poster and list of
// movies that compose it. It is used when pressing "Add the rest of the
// saga" from a movie's detail view, and also to show
// "Other movies from the saga" in the modal (issue #280). With a
// 24 h in-memory cache (the one shared with getMovieDetails and the
// watch providers): an already fetched collection does not repeat the call. Only
// correct responses are cached; a transient network failure
// does not hide the section for 24 h.
export async function getCollectionDetails(collectionId) {
  const cacheKey = `collection_${collectionId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/collection/${collectionId}?api_key=${TMDB_API_KEY}&language=es-ES`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data) return null;
  const result = {
    id: data.id,
    name: data.name,
    posterPath: data.poster_path || null,
    parts: (data.parts || []).map((p) => ({
      externalId: String(p.id),
      title: p.title,
      year: (p.release_date || "").slice(0, 4),
      posterUrl: p.poster_path
        ? `${IMG_BASE.replace("w342", "w185")}${p.poster_path}`
        : null,
      overview: p.overview || "",
      releaseDate: p.release_date || null,
    })),
  };
  setCache(cacheKey, result);
  return result;
}

// Extended data of a TV series: episode runtime, synopsis,
// genre, creators, main cast, airing status, next
// episode to air (if any) and trailer. With the
// minimal storage (issue #200) they are requested on demand when opening
// the detail view (and also when adding to learn releases/season dates), with a
// 24 h in-memory cache (same shared cache as the watch providers).
export async function getTvExtraDetails(id) {
  const cacheKey = `details_tv_${id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/tv/${id}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,videos`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data) return {};
  const result = {
    episodeRuntime: (data.episode_run_time && data.episode_run_time[0]) || null,
    overview: data.overview || "",
    genres: (data.genres || []).map((g) => g.name),
    cast: ((data.credits && data.credits.cast) || []).slice(0, 5).map((c) => c.name),
    creators: (data.created_by || []).map((c) => c.name),
    tmdbStatus: data.status || null,
    firstAirDate: data.first_air_date || null,
    nextEpisodeToAir: data.next_episode_to_air
      ? {
          season: data.next_episode_to_air.season_number,
          episode: data.next_episode_to_air.episode_number,
          airDate: data.next_episode_to_air.air_date || null,
        }
      : null,
    communityRating: data.vote_count > 0 ? data.vote_average : null,
    trailerUrl: _extractTrailerUrl(data.videos),
    coverUrl: data.poster_path ? `${IMG_BASE}${data.poster_path}` : null,
    // Air dates per season (null = season not released yet).
    // It is persisted along with the item so the "not released"
    // warning still works even if TMDB stops returning next_episode_to_air.
    seasonAirDates: seasonAirDateMap(data.seasons),
  };
  setCache(cacheKey, result);
  return result;
}

// =============================================================
// Streaming platforms (watch providers) from TMDB.
// Returns the streaming, rent and buy providers for
// a title (movie or TV series) in a specific country.
// Results are cached in memory to avoid redundant calls
// during the same session.
// =============================================================

const IMG_LOGO = "https://image.tmdb.org/t/p/w92";
const providersCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getCached(key) {
  const entry = providersCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    providersCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  providersCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Gets the watch providers of a movie or TV series in TMDB.
 * @param {string|number} id          - External ID from TMDB
 * @param {'movie'|'tv'}  type        - Content type
 * @param {string}        countryCode - ISO 3166-1 alpha-2 code (e.g.: "ES", "US")
 * @returns {Promise<{flatrate:Array, rent:Array, buy:Array, link:string|null}|null>}
 */
export async function getWatchProviders(id, type, countryCode = "ES") {
  const cacheKey = `wp_${type}_${id}_${countryCode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const endpoint = type === "tv" ? "tv" : "movie";
  const url = `${BASE_URL}/${endpoint}/${id}/watch/providers?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data || !data.results || !data.results[countryCode]) {
    setCache(cacheKey, null);
    return null;
  }

  const country = data.results[countryCode];
  const result = {
    flatrate: (country.flatrate || []).map(normalizeProvider),
    rent: (country.rent || []).map(normalizeProvider),
    buy: (country.buy || []).map(normalizeProvider),
    link: country.link || null,
  };

  setCache(cacheKey, result);
  return result;
}

// =============================================================
// Recommendations (similar content) from TMDB. Returns
// lists of similar movies or TV series using TMDB's
// /similar endpoint. Results have the same shape as
// search results (externalId, title, year, coverUrl, overview).
// =============================================================

export async function getSimilarMovies(id) {
  const url = `${BASE_URL}/movie/${id}/similar?api_key=${TMDB_API_KEY}&language=es-ES&page=1`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data || !data.results) return [];
  return data.results.map(mapMovieResult);
}

export async function getSimilarTv(id) {
  const url = `${BASE_URL}/tv/${id}/similar?api_key=${TMDB_API_KEY}&language=es-ES&page=1`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data || !data.results) return [];
  return data.results.map(mapTvResult);
}

function normalizeProvider(p) {
  return {
    providerId: p.provider_id,
    providerName: p.provider_name,
    logoUrl: p.logo_path ? `${IMG_LOGO}${p.logo_path}` : null,
    displayPriority: p.display_priority || 99,
  };
}
