// =============================================================
// Quick actions (list mode and swipe): mark watched, next episode
// or advance reading without opening the modal. Extracted from
// app.js.
// =============================================================

import { addWatch, statusFromWatchLog } from "./watch-log.js";
import { startReading, finishReading, statusFromReadLog } from "./reading-log.js";
import { startPlay, finishPlay, statusFromPlayLog } from "./game-log.js";
import { setEpisodeDate, setEpisodeRating, computeProgress, normalizeEntry } from "./tv-progress.js";
import { todayISO } from "./dates.js";
import { unreleasedConfirmMessage, episodeUnreleasedMessage } from "./release.js";
import { getNextEpisodeAirInfo } from "./sorting.js";
import { openRatingModal, RATING_MODAL_UNDONE } from "./rating-modal.js";

// Season meta: for manual shows returns a single season with the
// given episode count; for the rest, it asks TMDB.
export async function getSeasonsMetaFor(item, ctx) {
  if (item.manual) {
    return [{ seasonNumber: 1, name: "Temporada 1", episodeCount: item.manualEpisodeCount || 10 }];
  }
  return ctx.getTvSeasonsMeta(item.externalId);
}

// Opens the rating window after marking a movie or a book as
// watched/read from a quick action (issue #21). It never throws:
// if something fails, the already-persisted marking stays intact.
// Returns true if the user undid the marking (issue #136).
async function maybeQuickItemRating(item, ctx, type, opts = {}) {
  try {
    const result = await openRatingModal({
      type,
      title: item.title,
      coverUrl: item.coverUrl,
      communityRating: item.communityRating ?? null,
      communityLabel: opts.communityLabel || "TMDB",
      initialRating: item.rating ?? null,
      onSave: async (rating) => {
        await ctx.updateItem(ctx.getCurrentUser().uid, type, item.id, { rating });
        item.rating = rating;
      },
      onUndo: opts.onUndo,
      undoLabel: opts.undoLabel,
    });
    return result === RATING_MODAL_UNDONE;
  } catch (err) {
    console.error("No se pudo abrir la valoración:", err);
  }
  return false;
}

async function quickMarkMovie(item, ctx) {
  const confirmMsg = unreleasedConfirmMessage(item);
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  const prevLog = item.watchLog;
  const prevAwaitingRelease = item.awaitingRelease;
  const prevStatus = item.status;
  const newLog = addWatch(item.watchLog, todayISO());
  const status = statusFromWatchLog(newLog);
  // awaitingRelease is cleared when marking as watched (idempotent,
  // same as in the detail modal): an already watched item cannot stay
  // "unreleased".
  await ctx.updateItem(ctx.getCurrentUser().uid, "movie", item.id, { watchLog: newLog, status, awaitingRelease: false });
  item.awaitingRelease = false;
  // Undo (issue #136): restores the previous watchLog/status/
  // awaitingRelease without forcing awaitingRelease:false. The status
  // is restored LITERALLY as captured (not the recomputed log one).
  const undone = await maybeQuickItemRating(item, ctx, "movie", {
    onUndo: async () => {
      await ctx.updateItem(ctx.getCurrentUser().uid, "movie", item.id, {
        watchLog: prevLog,
        status: prevStatus,
        awaitingRelease: prevAwaitingRelease,
      });
      item.watchLog = prevLog;
      item.status = prevStatus;
      item.awaitingRelease = prevAwaitingRelease;
    },
  });
  ctx.showToast(undone ? "Marcado deshecho." : `«${item.title}» marcada como vista.`);
}

async function quickMarkBook(item, ctx) {
  const isReading = item.readLog && item.readLog.length && !item.readLog[item.readLog.length - 1].finishedAt;
  const newLog = isReading ? finishReading(item.readLog, todayISO()) : startReading(item.readLog, todayISO());
  const status = statusFromReadLog(newLog);
  const prevReadLog = isReading ? item.readLog : null;
  const prevStatus = isReading ? item.status : null;
  await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, { readLog: newLog, status });
  // The rating window is only offered when finishing reading
  if (isReading) {
    // Undo (issue #136): restores the previous readLog and status.
    // The status is restored LITERALLY as captured (not the
    // recomputed log one) in case the user had a manual state.
    const undone = await maybeQuickItemRating(item, ctx, "book", {
      onUndo: async () => {
        await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, {
          readLog: prevReadLog,
          status: prevStatus,
        });
        item.readLog = prevReadLog;
        item.status = prevStatus;
      },
    });
    ctx.showToast(undone ? "Marcado deshecho." : `«${item.title}» terminado.`);
  } else {
    ctx.showToast(`Has empezado «${item.title}».`);
  }
}

async function quickMarkGame(item, ctx) {
  const isPlaying = item.playLog && item.playLog.length && !item.playLog[item.playLog.length - 1].finishedAt;
  const newLog = isPlaying ? finishPlay(item.playLog, todayISO()) : startPlay(item.playLog, todayISO());
  const status = statusFromPlayLog(newLog);
  const prevPlayLog = isPlaying ? item.playLog : null;
  const prevStatus = isPlaying ? item.status : null;
  await ctx.updateItem(ctx.getCurrentUser().uid, "game", item.id, { playLog: newLog, status });
  // The rating window is only offered when finishing playing
  if (isPlaying) {
    // Undo (issue #136): restores the previous playLog and status.
    // The status is restored LITERALLY as captured (not the
    // recomputed log one) in case the user had a manual state.
    const undone = await maybeQuickItemRating(item, ctx, "game", {
      communityLabel: "IGDB",
      onUndo: async () => {
        await ctx.updateItem(ctx.getCurrentUser().uid, "game", item.id, {
          playLog: prevPlayLog,
          status: prevStatus,
        });
        item.playLog = prevPlayLog;
        item.status = prevStatus;
      },
    });
    ctx.showToast(undone ? "Marcado deshecho." : `«${item.title}» terminado.`);
  } else {
    ctx.showToast(`Has empezado «${item.title}».`);
  }
}

// Persists the progress of a show (marking or rating of an episode)
// and mutates the item in memory, the same way quickMarkTv does.
// nextEpisodeAirDate (optional): air date of the next unreleased
// episode ({ season, episode, airDate } or null); if passed, it is
// stored along with the progress so the "unreleased" alert can be
// shown without repeating API calls.
function saveTvProgress(item, ctx, seasonsMeta, newWatched, nextEpisodeAirDate) {
  const newProgress = computeProgress(seasonsMeta, newWatched);
  const payload = {
    watched: newWatched,
    status: newProgress.status,
    nextEpisode: newProgress.nextEpisode,
    firstWatchedAt: newProgress.firstWatchedAt,
    lastWatchedAt: newProgress.lastWatchedAt,
    // A show with watched episodes cannot stay "unreleased"
    // (idempotent, same as in the detail modal).
    awaitingRelease: false,
  };
  if (nextEpisodeAirDate !== null && nextEpisodeAirDate !== undefined) {
    payload.nextEpisodeAirDate = nextEpisodeAirDate;
  }
  return ctx
    .updateItem(ctx.getCurrentUser().uid, "tv", item.id, payload)
    .then(() => {
      item.watched = newWatched;
      item.status = newProgress.status;
      item.nextEpisode = newProgress.nextEpisode;
      item.firstWatchedAt = newProgress.firstWatchedAt;
      item.lastWatchedAt = newProgress.lastWatchedAt;
      item.awaitingRelease = false;
      if (nextEpisodeAirDate !== null && nextEpisodeAirDate !== undefined) {
        item.nextEpisodeAirDate = nextEpisodeAirDate;
      }
    });
}

// Opens the rating window of the just-marked episode from a quick
// action (issue #21). meta can be null (manual show or episode
// without data): then no community score is shown.
// Returns true if the user undid the marking (issue #136).
async function maybeQuickEpisodeRating(item, ctx, seasonsMeta, season, episode, meta, opts = {}) {
  try {
    const result = await openRatingModal({
      type: "tv",
      title: item.title,
      coverUrl: item.coverUrl,
      episodeLabel: meta ? `T${season}E${episode} · ${meta.name}` : `T${season}E${episode}`,
      communityRating: meta?.episodeRating ?? null,
      communityLabel: "TMDB · episodio",
      initialRating: normalizeEntry(item.watched?.[String(season)]?.[String(episode)])?.rating ?? null,
      onSave: async (rating) => {
        await saveTvProgress(
          item,
          ctx,
          seasonsMeta,
          setEpisodeRating(item.watched, season, episode, rating)
        );
      },
      onUndo: opts.onUndo,
      undoLabel: opts.undoLabel,
    });
    return result === RATING_MODAL_UNDONE;
  } catch (err) {
    console.error("No se pudo abrir la valoración del episodio:", err);
  }
  return false;
}

async function quickMarkTv(item, ctx) {
  if (item.status === "standby" || item.status === "abandonado") {
    ctx.showToast("Está en pausa/abandonada. Ábrela para retomarla.");
    return;
  }
  if (!item.nextEpisode) {
    ctx.showToast("Esta serie ya está completa.");
    return;
  }
  const { season, episode } = item.nextEpisode;
  // Base confirmation (any source: live nextEpisodeToAir,
  // seasonAirDates refreshed daily or persisted backfill). If it does
  // not apply and the show is not manual, the season is queried to
  // verify the specific episode's release: TMDB may not return
  // next_episode_to_air (e.g. a show between seasons with no
  // announced date) even though the episode is not released.
  // Fail-open: if the API fails, it marks without confirmation.
  let confirmMsg = unreleasedConfirmMessage(item, getNextEpisodeAirInfo(item));
  let episodes = null;
  if (!confirmMsg && !item.manual && item.externalId) {
    try {
      episodes = await ctx.getSeasonEpisodes(item.externalId, season);
      const ep = episodes.find((e) => e.episodeNumber === episode);
      if (ep) confirmMsg = episodeUnreleasedMessage(item.title, season, episode, ep.airDate);
    } catch (err) {
      console.error("No se pudo verificar el estreno del episodio:", err);
    }
  }
  if (confirmMsg && !window.confirm(confirmMsg)) return;
  const seasonsMeta = await getSeasonsMetaFor(item, ctx);
  // Season date refresh (issue #27): if the freshly fetched meta
  // differs from the persisted one, it is updated in memory and
  // stored fire-and-forget (same pattern as
  // onUpdateNextEpisodeAirDate). A failure here does not break the
  // action. Manual shows have no real TMDB dates: they are excluded.
  if (!item.manual && seasonsMeta.length) {
    const seasonAirDates = Object.fromEntries(
      seasonsMeta.filter((s) => !s.manual).map((s) => [String(s.seasonNumber), s.airDate])
    );
    if (JSON.stringify(seasonAirDates) !== JSON.stringify(item.seasonAirDates)) {
      item.seasonAirDates = seasonAirDates;
      ctx
        .updateItem(ctx.getCurrentUser().uid, "tv", item.id, { seasonAirDates })
        .catch((err) => console.error("No se pudo guardar las fechas de temporada:", err));
    }
  }
  const newWatched = setEpisodeDate(item.watched, season, episode, todayISO());

  // If the next episode (after marking this one) is still in the same
  // season and we already have its data, we store its air date (or
  // null if TMDB does not have it) so we can warn about "unreleased"
  // without further calls.
  let nextEpisodeAirDate = null;
  if (episodes) {
    const newProgress = computeProgress(seasonsMeta, newWatched);
    if (newProgress.nextEpisode && newProgress.nextEpisode.season === season) {
      const nextEp = episodes.find((e) => e.episodeNumber === newProgress.nextEpisode.episode);
      nextEpisodeAirDate = {
        season,
        episode: newProgress.nextEpisode.episode,
        airDate: nextEp ? nextEp.airDate : null,
      };
    }
  }
  const prevWatched = item.watched;
  const prevAwaitingRelease = item.awaitingRelease;
  const prevStatus = item.status;
  const prevNextEpisodeAirDate = item.nextEpisodeAirDate;
  await saveTvProgress(item, ctx, seasonsMeta, newWatched, nextEpisodeAirDate);
  // Episode rating: with TMDB data the episode community score is
  // shown; in manual shows meta is null, so the window appears anyway
  // with "Sin puntuaciones" (same as in the detail modal, issue #21).
  // If the episode was already fetched to verify the release, it is
  // reused without repeating the call.
  let meta = null;
  if (episodes) {
    meta = episodes.find((e) => e.episodeNumber === episode) || null;
  } else if (!item.manual && item.externalId) {
    try {
      const eps = await ctx.getSeasonEpisodes(item.externalId, season);
      meta = eps.find((e) => e.episodeNumber === episode) || null;
    } catch (err) {
      console.error("No se pudo obtener el episodio para valorarlo:", err);
    }
  }
  // Undo (issue #136): restores the show's previous progress
  // (watched, status literally as captured, nextEpisode, dates and
  // awaitingRelease; saveTvProgress recomputes the status and this
  // payload overwrites it with the previous one in case it was a
  // manual state).
  const undone = await maybeQuickEpisodeRating(item, ctx, seasonsMeta, season, episode, meta, {
    onUndo: async () => {
      const prevProgress = computeProgress(seasonsMeta, prevWatched);
      const payload = {
        watched: prevWatched,
        status: prevStatus,
        nextEpisode: prevProgress.nextEpisode,
        firstWatchedAt: prevProgress.firstWatchedAt,
        lastWatchedAt: prevProgress.lastWatchedAt,
        awaitingRelease: prevAwaitingRelease,
        nextEpisodeAirDate: prevNextEpisodeAirDate === undefined ? null : prevNextEpisodeAirDate,
      };
      await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, payload);
      item.watched = prevWatched;
      item.status = payload.status;
      item.nextEpisode = payload.nextEpisode;
      item.firstWatchedAt = payload.firstWatchedAt;
      item.lastWatchedAt = payload.lastWatchedAt;
      item.awaitingRelease = prevAwaitingRelease;
      item.nextEpisodeAirDate = payload.nextEpisodeAirDate;
    },
  });
  ctx.showToast(undone ? "Desmarcado." : `T${season}E${episode} marcado como visto.`);
}

export async function quickAction(item, btn, ctx) {
  if (btn) btn.disabled = true;
  try {
    if (item.type === "movie") await quickMarkMovie(item, ctx);
    else if (item.type === "tv") await quickMarkTv(item, ctx);
    else if (item.type === "game") await quickMarkGame(item, ctx);
    else await quickMarkBook(item, ctx);
  } catch (err) {
    ctx.showToast("No se pudo actualizar: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}
