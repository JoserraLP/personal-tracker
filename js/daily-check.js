// =============================================================
// Daily check: pending releases and episodes. Extracted
// from app.js to isolate the periodic review logic.
// Once a day fresh data is requested from TMDB / Open Library ONLY
// for what can generate an alert (minimal pass A5-a of the
// minimal storage study, issue #183/#200):
//   - movies waiting for release (awaitingRelease),
//   - TV series expecting a premiere or with the next episode not yet
//     released (today or in the future) — alerts and auto-standby,
//   - Open Library books (/works/) without a saved synopsis,
//   - videogames: no network (the launch alert is decided with
//     saved data, ADR-071).
// The rest of the detail metadata is NO LONGER curated daily: with the
// minimal storage the details are requested on demand when
// opening the detail view (issue #200). It also supports forced
// manual synchronization (syncNow, «Check for releases») with a
// 30 minute cooldown persisted in profile.lastManualSyncAt.
// =============================================================

import { isNextEpisodeUnreleased, getNextEpisodeAirInfo } from "./sorting.js";
import { getNotificationPrefs, loadSettings } from "./settings.js";
import { isUnreleasedDate } from "./release.js";
import { normalizeEntry } from "./tv-progress.js";
import { subtractDays } from "./dates.js";
import { sanitizeSteamId, fetchOwnedSteamGames } from "./api-steam.js";

// Cooldown between manual synchronizations (30 minutes).
const MANUAL_SYNC_COOLDOWN_MS = 30 * 60 * 1000;
// Limit of simultaneous API requests during one pass.
const REFRESH_CONCURRENCY = 4;
// If more than this number of consecutive failures per item is chained,
// the pass is aborted (the API must be down or the data plan odd).
const MAX_CONSECUTIVE_FAILURES = 5;

// Anti-concurrency flag: managed by checkForUpdates to cover both
// the automatic daily pass and the manual one (syncNow). It prevents two
// passes from running at once (duplicated API cost and duplicated
// premiere/new-episode notifications).
let isRefreshing = false;

// Does the show have any episode marked as watched (any season)?
// It walks watched (season -> episode -> { date, rating }) and also
// tolerates the old date-as-plain-text format via normalizeEntry.
function hasAnyWatchedEpisode(show) {
  if (!show.watched) return false;
  for (const seasonMap of Object.values(show.watched)) {
    if (!seasonMap) continue;
    for (const entry of Object.values(seasonMap)) {
      const n = normalizeEntry(entry);
      if (n && n.date) return true;
    }
  }
  return false;
}

// Days without activity (watching or airing) after which a TV series
// in progress automatically goes to standby (issue #48).
const AUTO_STANDBY_DAYS = 365;

// Should the TV series automatically go to standby?
// - Only status "en_curso".
// - Rule 1: if the next episode is unreleased (future date or no
//   date), the series is "waiting for new episodes": NO move.
// - Rule 2: if the most recent date between the last airing (airDate of the
//   already-aired next episode) and the last watching (lastWatchedAt)
//   is within the last year, there is activity: NO move.
// - If there is no known date, no move (conservative).
// - Comparisons of "YYYY-MM-DD" strings (canonical project format).
export function shouldAutoStandby(show, today) {
  if (!show || show.status !== "en_curso") return false;
  if (isNextEpisodeUnreleased(show)) return false;
  const info = getNextEpisodeAirInfo(show);
  const lastAirDate = info && info.airDate ? info.airDate : null;
  const lastWatched = show.lastWatchedAt || null;
  if (!lastAirDate && !lastWatched) return false;
  let activity = lastAirDate;
  if (!activity || (lastWatched && lastWatched > activity)) activity = lastWatched;
  const threshold = subtractDays(today, AUTO_STANDBY_DAYS);
  return activity <= threshold;
}

// Runs fn over each item with a pool of `limit` simultaneous
// promises. Returns the results in order.
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// Minimal pass (A5-a): does a movie need to query the API today?
// Only the ones waiting for release: the awaitingRelease flag (set on
// creation) or a future release date not yet alerted (covers
// old items saved before the flag existed).
function movieNeedsCheck(movie) {
  if (movie.manual || !movie.externalId) return false;
  if (movie.awaitingRelease) return true;
  return (
    !!movie.releaseDate &&
    isUnreleasedDate(movie.releaseDate) &&
    !(movie.watchLog && movie.watchLog.length)
  );
}

// Minimal pass (A5-a): does a TV series need to query the API today?
// The ones expecting a premiere (awaitingRelease), the ones that haven't
// premiered yet (old flag pending backfill) or whose next
// episode is unreleased TODAY or in the future (source of the
// new-episode alerts and of the auto-standby with fresh data).
// Series whose next episode already aired are not queried:
// their auto-standby is evaluated offline with the saved data.
function showNeedsCheck(show, today) {
  if (show.manual || !show.externalId) return false;
  if (show.awaitingRelease) return true;
  // Pending premiere to happen: same treatment as a
  // movie waiting for release (covers old items saved
  // before the awaitingRelease flag existed).
  if (!hasAnyWatchedEpisode(show) && isUnreleasedDate(show.firstAirDate)) return true;
  const info = getNextEpisodeAirInfo(show);
  // info.airDate >= today: it airs today or later → it is watched. The
  // comparison is of "YYYY-MM-DD" strings (canonical format).
  return !!info && (!info.airDate || info.airDate >= today);
}

// Truthy-only policy for books: the synopsis is overwritten only if
// the new one is non-empty (the Open Library API sometimes doesn't return it).
function buildBookUpdates(book, description) {
  if (!description) return {};
  return { description };
}

// Fills nextEpisodeAirDate when neither nextEpisodeToAir nor the saved
// data matches the user's next episode (e.g. series between seasons
// with no announced date). Fail-open: if the
// season query fails, the pass is not aborted.
async function ensureNextEpisodeAirDate(show, fresh, getSeasonEpisodes) {
  if (show.manual || !show.nextEpisode) return null;
  if (
    getNextEpisodeAirInfo({
      ...show,
      nextEpisodeToAir: fresh.nextEpisodeToAir,
      seasonAirDates: fresh.seasonAirDates,
    })
  ) {
    return null;
  }
  try {
    const episodes = await getSeasonEpisodes(show.externalId, show.nextEpisode.season);
    const ep = episodes.find((e) => e.episodeNumber === show.nextEpisode.episode);
    return {
      season: show.nextEpisode.season,
      episode: show.nextEpisode.episode,
      airDate: ep ? ep.airDate : null,
    };
  } catch (err) {
    console.error("No se pudo verificar el estreno del siguiente episodio:", show.title, err);
    return null;
  }
}

/**
 * Reviews all the non-manual items and refreshes their metadata from
 * TMDB / Open Library, plus the historical alerts logic
 * (premieres, new episodes, unlocking of blocked episodes).
 *
 * Concurrency management: the isRefreshing flag is set when entering
 * the real pass (synchronously, with no awaits between the check and the
 * set) and is cleared in finally. If there is already a pass in progress (daily
 * or manual), this call exits with { aborted: true } without stamping
 * lastReleaseCheckAt.
 *
 * Daily guard: if it was already done today (profile.lastReleaseCheckAt === today)
 * and it is not a forced refresh (force), it exits without doing anything.
 *
 * @param {object} ctx              - Context with injected dependencies
 * @param {object} [options]
 * @param {boolean} [options.force] - true to ignore the daily guard
 *                                     (manual synchronization)
 * @returns {Promise<{aborted: boolean}>} - State of the pass; aborted is
 *   true if it was aborted due to consecutive failures or reentrancy.
 */
export async function checkForUpdates(ctx, { force = false } = {}) {
  const {
    getCurrentUser,
    getItemsOnce,
    updateItem,
    addNotification,
    upsertUserProfile,
    getUserProfile,
    getMovieDetails,
    getTvExtraDetails,
    getSeasonEpisodes,
    getOpenLibraryDescription,
    todayISO,
    formatDateEs,
  } = ctx;

  const user = getCurrentUser();
  if (!user) return { aborted: true };

  // Anti-concurrency: the check and the set are synchronous and contiguous,
  // so two calls never cross the guard at once.
  if (isRefreshing) return { aborted: true };
  isRefreshing = true;
  try {
    let profile;
    try {
      profile = await getUserProfile(user.uid);
    } catch (err) {
      profile = null;
    }
    const today = todayISO();
    if (!force && profile && profile.lastReleaseCheckAt === today) {
      return { aborted: false };
    }

    // One-time read of each group (issue #178): tabs no longer
    // all subscribe on entering (lazy loading), so the in-memory
    // state may be incomplete. It is read from Firestore on
    // demand. Videogames don't refresh metadata in the pass
    // (IGDB is not queried), but they participate in the launch alert
    // (issue #175), so they are also read from Firestore.
    const [allMovies, allTv, allBooks, allGames] = await Promise.all([
      getItemsOnce(user.uid, "movie"),
      getItemsOnce(user.uid, "tv"),
      getItemsOnce(user.uid, "book"),
      getItemsOnce(user.uid, "game"),
    ]);
    const prefs = getNotificationPrefs();

    // Consecutive failures: if too many are chained (e.g. API down),
    // the pass is aborted to avoid continuing to make useless requests.
    let consecutiveFailures = 0;
    let aborted = false;

    // Movies: minimal pass (A5-a) — only the ones waiting for release.
    // Detail metadata is no longer curated (with minimal storage
    // they are requested on demand when opening the detail view, issue #200).
    const movies = allMovies.filter((m) => movieNeedsCheck(m));
    await mapConcurrent(movies, REFRESH_CONCURRENCY, async (movie) => {
      if (aborted) return;
      try {
        const fresh = await getMovieDetails(movie.externalId);
        const updates = {};

        // The release date is kept up to date: if it changed, it is
        // refreshed (the "not released" badge and the alert depend
        // on it).
        if (fresh.releaseDate && fresh.releaseDate !== movie.releaseDate) {
          updates.releaseDate = fresh.releaseDate;
        }

        if (!movie.awaitingRelease && fresh.releaseDate !== undefined && !(movie.watchLog && movie.watchLog.length) && isUnreleasedDate(fresh.releaseDate)) {
          updates.awaitingRelease = true;
        }

        if (prefs.movie_release !== false && movie.awaitingRelease && fresh.releaseDate && fresh.releaseDate <= today) {
          await addNotification(user.uid, {
            message: `«${movie.title}» ya se ha estrenado (${formatDateEs(fresh.releaseDate)}).`,
          });
          updates.awaitingRelease = false;
          updates.releasedNoticedAt = today;
        }

        if (Object.keys(updates).length) {
          await updateItem(user.uid, "movie", movie.id, updates);
        }
        consecutiveFailures = 0;
      } catch (err) {
        console.error("No se pudo comprobar/actualizar", movie.title, err);
        consecutiveFailures += 1;
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          aborted = true;
          console.error(
            "Sincronización abortada: demasiados fallos consecutivos (¿API caída?). Se reintentará en la próxima pasada."
          );
        }
      }
    });
    if (aborted) return { aborted: true };

    // TV series: minimal pass (A5-a) — only the ones waiting for a premiere or whose
    // next episode is yet to air. The alerts logic
    // (premiere, new episode, unlocking of blocked one) and the auto-standby
    // evaluated with the fresh episode data are kept.
    const shows = allTv.filter((s) => showNeedsCheck(s, today));
    await mapConcurrent(shows, REFRESH_CONCURRENCY, async (show) => {
      if (aborted) return;
      try {
        const wasEpisodeBlocked = isNextEpisodeUnreleased(show);
        const fresh = await getTvExtraDetails(show.externalId);
        const updates = {};

        // Airing fields that feed badges and alerts: they are
        // overwritten when the API returns them (nextEpisodeToAir
        // always; seasonAirDates as long as the call succeeds,
        // because a null inside the map is real information).
        if (fresh.nextEpisodeToAir) {
          updates.nextEpisodeToAir = fresh.nextEpisodeToAir;
          updates.nextEpisodeAirDate = {
            season: fresh.nextEpisodeToAir.season,
            episode: fresh.nextEpisodeToAir.episode,
            airDate: fresh.nextEpisodeToAir.airDate || null,
          };
        }
        if (fresh.firstAirDate && fresh.firstAirDate !== show.firstAirDate) {
          updates.firstAirDate = fresh.firstAirDate;
        }
        if (fresh.seasonAirDates && Object.keys(fresh.seasonAirDates).length) {
          updates.seasonAirDates = fresh.seasonAirDates;
        }

        // Backfill of nextEpisodeAirDate: if neither next_episode_to_air nor
        // the saved data matches the next episode (series
        // between seasons), the season is queried to learn its
        // date (or its absence) and keep alerting of "not
        // released". Fail-open: it never aborts the pass nor increments
        // consecutiveFailures.
        const airInfo = await ensureNextEpisodeAirDate(show, fresh, getSeasonEpisodes);
        if (airInfo) updates.nextEpisodeAirDate = airInfo;

        let justPremiered = false;

        if (prefs.series_premiere !== false && show.awaitingRelease && fresh.firstAirDate && fresh.firstAirDate <= today) {
          await addNotification(user.uid, { message: `«${show.title}» ya se ha estrenado.` });
          updates.awaitingRelease = false;
          updates.releasedNoticedAt = today;
          justPremiered = true;
        }

        if (
          prefs.new_episode !== false &&
          !justPremiered &&
          fresh.nextEpisodeToAir &&
          fresh.nextEpisodeToAir.airDate &&
          fresh.nextEpisodeToAir.airDate <= today
        ) {
          const key = `${fresh.nextEpisodeToAir.season}x${fresh.nextEpisodeToAir.episode}`;
          if (show.lastNotifiedEpisode !== key) {
            await addNotification(user.uid, {
              message: `Nuevo episodio disponible de «${show.title}»: T${fresh.nextEpisodeToAir.season}E${fresh.nextEpisodeToAir.episode}.`,
            });
            updates.lastNotifiedEpisode = key;
          }
        }

        if (
          !justPremiered &&
          wasEpisodeBlocked &&
          !isNextEpisodeUnreleased({
            ...show,
            nextEpisodeToAir: fresh.nextEpisodeToAir,
            seasonAirDates: fresh.seasonAirDates,
          })
        ) {
          updates.releasedNoticedAt = today;
        }

        if (!show.awaitingRelease && fresh.firstAirDate !== undefined && !hasAnyWatchedEpisode(show) && isUnreleasedDate(fresh.firstAirDate)) {
          updates.awaitingRelease = true;
        }

        // Auto-standby by inactivity (issue #48): evaluated with the
        // fresh data of this pass (including the just-computed backfill).
        const evaluatedShow = {
          ...show,
          nextEpisodeToAir: fresh.nextEpisodeToAir,
          seasonAirDates: fresh.seasonAirDates,
          ...(airInfo ? { nextEpisodeAirDate: airInfo } : {}),
        };
        if (shouldAutoStandby(evaluatedShow, today)) {
          updates.status = "standby";
          updates.autoStandbyAt = today;
        }

        if (Object.keys(updates).length) {
          await updateItem(user.uid, "tv", show.id, updates);
        }
        consecutiveFailures = 0;
      } catch (err) {
        console.error("No se pudo comprobar/actualizar", show.title, err);
        consecutiveFailures += 1;
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          aborted = true;
          console.error(
            "Sincronización abortada: demasiados fallos consecutivos (¿API caída?). Se reintentará en la próxima pasada."
          );
        }
      }
    });
    if (aborted) return { aborted: true };

    // TV series not included in the minimal pass (their next episode already
    // aired or they don't expect a premiere): the auto-standby by inactivity
    // (ADR-033) is evaluated WITHOUT network, with the saved data. Fail-open: a
    // write error does not abort the pass nor count as an API failure.
    const offlineStandbyShows = allTv.filter(
      (s) => !s.manual && s.externalId && s.status === "en_curso" && !showNeedsCheck(s, today)
    );
    for (const show of offlineStandbyShows) {
      if (aborted) break;
      try {
        if (shouldAutoStandby(show, today)) {
          await updateItem(user.uid, "tv", show.id, { status: "standby", autoStandbyAt: today });
        }
      } catch (err) {
        console.error("No se pudo pausar automáticamente", show.title, err);
      }
    }

    // Manual TV series in progress: same auto-standby, evaluated only with saved
    // data (there are no TMDB data). No network. Fail-open: a write
    // error does not abort the pass nor count as an API failure.
    const manualShows = allTv.filter((s) => s.manual && s.status === "en_curso");
    for (const show of manualShows) {
      if (aborted) break;
      try {
        if (shouldAutoStandby(show, today)) {
          await updateItem(user.uid, "tv", show.id, { status: "standby", autoStandbyAt: today });
        }
      } catch (err) {
        console.error("No se pudo pausar automáticamente", show.title, err);
      }
    }

    // Books: synopsis only for the Open Library ones that don't have it
    // saved yet (minimal pass A5-a). Truthy-only: the new
    // synopsis is only overwritten if it is non-empty.
    const books = allBooks.filter(
      (b) => !b.manual && b.externalId && b.externalId.startsWith("/works/") && !b.description
    );
    await mapConcurrent(books, REFRESH_CONCURRENCY, async (book) => {
      if (aborted) return;
      try {
        const description = await getOpenLibraryDescription(book.externalId);
        const updates = buildBookUpdates(book, description);
        if (Object.keys(updates).length) {
          await updateItem(user.uid, "book", book.id, updates);
        }
        consecutiveFailures = 0;
      } catch (err) {
        console.error("No se pudo completar la sinopsis de", book.title, err);
        consecutiveFailures += 1;
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          aborted = true;
          console.error(
            "Sincronización abortada: demasiados fallos consecutivos (¿API caída?). Se reintentará en la próxima pasada."
          );
        }
      }
    });
    if (aborted) return { aborted: true };

    // Videogames: launch alert with the saved data (no
    // network, IGDB is not queried in the pass). All non-manual
    // ones are reviewed. Fail-open: a write error does not abort the pass nor
    // count as an API failure (same pattern as the manual series
    // block).
    const games = allGames.filter((g) => !g.manual);
    for (const g of games) {
      if (aborted) break;
      try {
        const updates = {};

        // Backfill of the flag for games saved before issue
        // #175 (without awaitingRelease). The truthy releaseDate guard is
        // MANDATORY: without a date there is no launch to wait for.
        if (!g.awaitingRelease && g.releaseDate && isUnreleasedDate(g.releaseDate) && !(g.playLog && g.playLog.length)) {
          updates.awaitingRelease = true;
        }

        // Launch alert. The playLog guard is needed:
        // quick-actions.js and modal-handlers.js don't clear awaitingRelease
        // when marking as played.
        if (prefs.game_release !== false && g.awaitingRelease && g.releaseDate && g.releaseDate <= today && !(g.playLog && g.playLog.length)) {
          await addNotification(user.uid, {
            message: `«${g.title}» ya está a la venta (${formatDateEs(g.releaseDate)}).`,
          });
          updates.awaitingRelease = false;
          updates.releasedNoticedAt = today;
        }

        if (Object.keys(updates).length) {
          await updateItem(user.uid, "game", g.id, updates);
        }
      } catch (err) {
        console.error("No se pudo comprobar el lanzamiento de", g.title, err);
      }
    }

    // Steam (ADR-108): with the linked account, refresh the played
    // hours of the registry games that came from Steam. Nothing new is
    // auto-added (it avoids flooding the registry with the whole
    // library; adding is manual from Settings). Fail-open and
    // silent for the main flow: a Steam failure does
    // not abort the pass nor touch lastReleaseCheckAt.
    try {
      const steamId = sanitizeSteamId(loadSettings().steamId);
      const linkedGames = allGames.filter((game) => game.steamAppId);
      if (steamId && linkedGames.length) {
        const steam = await fetchOwnedSteamGames(steamId);
        const byAppId = new Map(steam.games.map((entry) => [entry.appid, entry]));
        for (const game of linkedGames) {
          const fresh = byAppId.get(game.steamAppId);
          if (!fresh) continue; // no longer in the library
          const updates = { steamPlaytimeHours: fresh.playtimeHours };
          let log = (game.playLog || []).map((session) =>
            session && session.source === "steam"
              ? { ...session, hours: fresh.playtimeHours > 0 ? fresh.playtimeHours : null }
              : session
          );
          // Backfill: games added to Steam without a session marked yet.
          if (
            !(game.playLog || []).some((session) => session && session.source === "steam") &&
            fresh.playtimeHours > 0
          ) {
            const day = fresh.lastPlayedAt || today;
            log = [...log, { startedAt: day, finishedAt: day, hours: fresh.playtimeHours, source: "steam" }];
          }
          updates.playLog = log;
          await updateItem(user.uid, "game", game.id, updates);
        }
      }
    } catch (err) {
      console.error("Steam: no se pudo actualizar la biblioteca:", err);
    }

    try {
      await upsertUserProfile(user.uid, { lastReleaseCheckAt: today });
    } catch (err) {
      console.error(err);
    }
    return { aborted: false };
  } finally {
    isRefreshing = false;
  }
}

/**
 * Forced manual synchronization ("Check for releases" in Settings).
 * Applies the MANUAL_SYNC_COOLDOWN_MS cooldown persisted in
 * profile.lastManualSyncAt. The anti-concurrency flag isRefreshing
 * is managed by checkForUpdates (it also covers the daily pass), so
 * here it is only checked and its state return is trusted.
 *
 * If the pass is aborted (consecutive failures or reentrancy) lastManualSyncAt
 * is NOT stamped: the cooldown is not burned and the user
 * can retry.
 *
 * @param {object} ctx - Context with injected dependencies
 * @returns {Promise<{ok: boolean, reason?: string, message?: string}>}
 */
export async function syncNow(ctx) {
  if (isRefreshing) return { ok: false, reason: "running" };

  const user = ctx.getCurrentUser();
  if (!user) return { ok: false, reason: "error", message: "Sesión no iniciada." };

  // The profile is read BEFORE forcing the pass to respect the cooldown.
  let profile = null;
  try {
    profile = await ctx.getUserProfile(user.uid);
  } catch (err) {
    profile = null;
  }
  if (profile && profile.lastManualSyncAt) {
    const elapsed = Date.now() - new Date(profile.lastManualSyncAt).getTime();
    if (elapsed < MANUAL_SYNC_COOLDOWN_MS) {
      return { ok: false, reason: "cooldown" };
    }
  }

  // Second check: the daily pass might have started while the
  // profile was being read. Between this check and checkForUpdates's
  // internal set there are no awaits, so there is no race window.
  if (isRefreshing) return { ok: false, reason: "running" };

  try {
    const result = await checkForUpdates(ctx, { force: true });
    if (!result || result.aborted) {
      return {
        ok: false,
        reason: "error",
        message: "La sincronización se abortó. Revisa tu conexión e inténtalo de nuevo.",
      };
    }
    await ctx.upsertUserProfile(user.uid, { lastManualSyncAt: new Date().toISOString() });
    return { ok: true };
  } catch (err) {
    console.error("No se pudo sincronizar los datos:", err);
    return { ok: false, reason: "error", message: err.message || String(err) };
  }
}

/**
 * Indicates whether a synchronization is in progress (daily or manual). settings.js
 * uses it to disable the "Check for releases" button.
 */
export function isSyncRunning() {
  return isRefreshing;
}
