// =============================================================
// Opening of detail / edit modals for each item type (movie,
// show, book). Extracted from app.js to decouple presentation logic
// from the general state logic.
// =============================================================

import { addWatch, removeWatch, updateWatch, statusFromWatchLog } from "./watch-log.js";
import { startReading, finishReading, removeReadEntry, updateReadEntry, statusFromReadLog } from "./reading-log.js";
import { startPlay, finishPlay, removePlayEntry, updatePlayEntry, statusFromPlayLog } from "./game-log.js";
import { computeProgress, setEpisodeDate, setEpisodeRating, setSeasonWatched, startRewatch, normalizeEntry, markEpisodeSeenAgain } from "./tv-progress.js";
import { getSeasonsMetaFor } from "./quick-actions.js";
import { todayISO, formatDateEs } from "./dates.js";
import { isUnreleasedDate } from "./release.js";
import * as ui from "./ui.js";
import { scheduleDeletion } from "./undo-delete.js";
import { getCollectionDetails, getMovieDetails, getSimilarMovies, getSimilarTv, getTvExtraDetails, getTvSeasonsMeta, getWatchProviders } from "./api-movies.js";
import { getGameDetails } from "./api-games.js";
import { minimalStoredFields } from "./search.js";
import { openRatingModal, closeRatingModal, RATING_MODAL_UNDONE } from "./rating-modal.js";
import { closeEpisodeActionsModal } from "./episode-actions-modal.js";
import { addItem } from "./db.js";
import { needsDetailFetch, loadItemDetails } from "./item-details.js";

// Detail view on demand (issue #200, minimal storage): if the
// document does not carry the detail (only card + alerts), the modal
// opens immediately with a placeholder and the details load in the
// background (24 h in-memory cache). On arrival, the whole modal is
// re-rendered and the saved card is revalidated (cover and community
// rating, stale-while-revalidate of study §9 R3: 1 write only if they
// change). If the network fails, the detail stays "card only"
// (graceful degradation) and is not retried in that session.
function loadDetailsForModal(item, ctx, rerender) {
  const prevCoverUrl = item.coverUrl;
  const prevCommunityRating = item.communityRating;
  loadItemDetails(item).then((details) => {
    if (!details) {
      item._detailsFailed = true;
      rerender();
      return;
    }
    const changes = {};
    if (item.coverUrl && item.coverUrl !== prevCoverUrl) changes.coverUrl = item.coverUrl;
    if (item.communityRating != null && item.communityRating !== prevCommunityRating) {
      changes.communityRating = item.communityRating;
    }
    if (Object.keys(changes).length) {
      ctx
        .updateItem(ctx.getCurrentUser().uid, item.type, item.id, changes)
        .catch((err) => console.error("No se pudo revalidar la tarjeta:", item.title, err));
    }
    rerender();
  });
}

// Opens the rating window after marking a movie or a book as
// watched/read (issue #21). Never throws: if something fails, it is
// logged to console and the already-persisted marking stays intact.
// Returns true if the user undid the marking (issue #136).
async function maybeOpenItemRatingWindow(item, ctx, type, opts = {}) {
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

function confirmDelete(item, kind, ctx) {
  return () => {
    scheduleDeletion(item, ctx.getCurrentUser().uid, kind, ctx);
    ui.closeModal();
  };
}

function saveMeta(item, kind, ctx) {
  return async (changes) => {
    try {
      await ctx.updateItem(ctx.getCurrentUser().uid, kind, item.id, changes);
      ui.showToast("Guardado.");
      ui.closeModal();
    } catch (err) {
      ui.showToast("No se pudo guardar: " + err.message);
    }
  };
}

function editHandlerFor(item, kind, reopen, ctx) {
  return () => {
    ui.openEditModal(item, {
      onSave: async (changes) => {
        try {
          await ctx.updateItem(ctx.getCurrentUser().uid, kind, item.id, changes);
          Object.assign(item, changes);
          ui.showToast("Información actualizada.");
          reopen();
        } catch (err) {
          ui.showToast("No se pudo guardar: " + err.message);
        }
      },
      onCancel: reopen,
    });
  };
}

function progressWithStatus(seasonsMeta, item) {
  const base = computeProgress(seasonsMeta, item.watched);
  if (item.status === "standby" || item.status === "abandonado") {
    return { ...base, status: item.status };
  }
  return base;
}

function getUserCountry() {
  return localStorage.getItem("watch-provider-country")
    || (navigator.language && navigator.language.split("-")[1]?.toUpperCase())
    || "ES";
}

async function openMovieItem(item, ctx, isRerender = false) {
  const reopen = () => openMovieItem(item, ctx, true);
  async function persist(newLog) {
    const status = statusFromWatchLog(newLog);
    // awaitingRelease is always cleared when marking as watched: an
    // already watched item cannot stay "unreleased" (idempotent).
    await ctx.updateItem(ctx.getCurrentUser().uid, "movie", item.id, { watchLog: newLog, status, awaitingRelease: false });
    item.watchLog = newLog;
    item.status = status;
    item.awaitingRelease = false;
  }

  // Fetch watch providers (not critical, if it fails it shows without providers)
  if (item.externalId) {
    try {
      item.watchProviders = await getWatchProviders(item.externalId, "movie", getUserCountry());
    } catch {
      item.watchProviders = null;
    }
  }

  // --- Load recommendations (similar) ---
  let recommendations = [];
  let existingIds = new Set();
  if (item.externalId) {
    try {
      recommendations = await getSimilarMovies(item.externalId);
      recommendations = recommendations.slice(0, 10);
    } catch {
      recommendations = [];
    }
    existingIds = new Set((await ctx.getGroupItemsResolved("movies")).map((m) => m.externalId));
  }

  // --- Load saga movies (issue #280) ---
  // If the query fails we do not block the detail view: the section
  // is hidden (graceful degradation) and the saga banner stays
  // visible.
  let sagaParts = null;
  if (item.collectionId) {
    try {
      const collection = await getCollectionDetails(item.collectionId);
      sagaParts = (collection && collection.parts.length) ? collection.parts : null;
    } catch {
      sagaParts = null;
    }
  }

  ui.openMovieModal(item, {
    onAddWatch: async (date) => {
      const prevLog = item.watchLog;
      const prevAwaitingRelease = item.awaitingRelease;
      const prevStatus = item.status;
      await persist(addWatch(item.watchLog, date));
      // Undo (issue #136): restores the previous watchLog and status
      // without going through persist(), which forces
      // awaitingRelease:false. The status is restored LITERALLY as
      // captured (not the recomputed log one) in case the user had a
      // manual state.
      await maybeOpenItemRatingWindow(item, ctx, "movie", {
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
    },
    onUpdateWatch: (index, date) => persist(updateWatch(item.watchLog, index, date)),
    onRemoveWatch: (index) => persist(removeWatch(item.watchLog, index)),
    onSaveMeta: saveMeta(item, "movie", ctx),
    onDelete: confirmDelete(item, "movie", ctx),
    onEdit: editHandlerFor(item, "movie", reopen, ctx),
    onAddSaga: item.collectionId ? () => openSagaSelector(item, ctx) : undefined,
    // When adding a recommendation, existingIds is updated (Set
    // shared with the render): after a re-render the card keeps
    // showing "Añadido" and no duplicate can be created (issue #280).
    onAddRecommendation: async (recItem, btn) => {
      if (await addFromRecommendation(recItem, btn, ctx)) {
        existingIds.add(String(recItem.externalId));
      }
    },
    // Direct add of a saga movie from its card
    // (issue #280). existingIds is a Set shared with the render,
    // so later rerenders of the modal show it as
    // "Añadida".
    onAddSagaMovie: item.collectionId
      ? async (movie, btn) => {
          btn.disabled = true;
          btn.textContent = "Añadiendo…";
          try {
            await addSagaMovie(movie, ctx);
            existingIds.add(String(movie.externalId));
            btn.textContent = "Añadida";
            ui.showToast(`«${movie.title}» añadida a tu registro.`);
          } catch (err) {
            btn.disabled = false;
            btn.textContent = "Añadir";
            ui.showToast("No se pudo añadir: " + err.message);
          }
        }
      : undefined,
    // Preview of a saga movie when pressing its card
    // (issue #280, iteration): it opens the preview (issue #22
    // pattern) and on close or add restores the detail view with
    // reopen; the shared existingIds Set makes the card come back
    // as «Añadida».
    onOpenSagaMovie: item.collectionId
      ? (movie) => openSagaMoviePreview(movie, ctx, reopen, existingIds)
      : undefined,
    // Preview of a recommendation when pressing its card (issue
    // #280, iteration): same pattern as the saga cards — it opens
    // the preview (issue #22) and on close or add restores the
    // detail view with reopen; the shared existingIds Set makes the
    // card come back as «Añadida».
    onOpenRecommendation: (recItem) =>
      openRecommendationPreview(recItem, ctx, reopen, existingIds),
  }, recommendations, existingIds, sagaParts);

  // Detail on demand: load extended details in the background
  // (only first open; re-renders do not ask again).
  if (!isRerender && needsDetailFetch(item)) {
    item._detailsFailed = false;
    loadDetailsForModal(item, ctx, reopen);
  }
}

/* ---------- Collection/saga logic ---------- */

async function addSagaMovie(movie, ctx) {
  const details = await getMovieDetails(movie.externalId);
  const draft = {
    externalId: movie.externalId,
    type: "movie",
    title: movie.title,
    year: movie.year || "",
    coverUrl: movie.posterUrl || null,
    status: "pendiente",
    rating: null,
    notes: "",
    watchLog: [],
    // Minimal storage (issue #200): card + alerts + community rating
    // only; the rest of the detail view is requested on demand.
    ...minimalStoredFields(details, "movie"),
  };
  if (details.releaseDate !== undefined && isUnreleasedDate(details.releaseDate)) {
    draft.awaitingRelease = true;
  }
  await addItem(ctx.getCurrentUser().uid, "movie", draft);
}

/**
 * Shared preview of an external item from the detail view (issue
 * #280): used by the «Otras películas de la saga» cards and the
 * recommendation ones (movies and shows), with the same pattern as
 * the search preview (issue #22). On closing the preview or after
 * adding the item, the detail view being seen is restored
 * (restoreModal). The existingIds Set shared with the render means
 * that, when restoring the detail view, the card comes back as
 * «Añadida».
 * @param {Object}   previewItem  - {externalId, type, title, year, coverUrl, overview}
 * @param {Object}   ctx          - User data context
 * @param {Function} restoreModal - Reopens the detail of the original item
 * @param {Set}      existingIds  - Set of already added externalIds (shared with the render)
 * @param {Function} performAdd   - async (item) => adds the item (throws on failure)
 */
async function openExternalPreview(previewItem, ctx, restoreModal, existingIds, performAdd) {
  ui.closeModal(); // clears the detail modal's trap/focus before opening the preview
  ui.openSearchPreviewModal(previewItem, {
    added: existingIds.has(String(previewItem.externalId)),
    onClose: () => {
      ui.closeModal(); // clears the preview's trap/focus...
      restoreModal();  // ...and restores the detail view
    },
    onAdd: async (item, btn) => {
      btn.disabled = true;
      btn.textContent = "Añadiendo…";
      try {
        await performAdd(item);
        existingIds.add(String(item.externalId));
        ui.showToast(`«${item.title}» añadida a tu registro.`);
        ui.closeModal();
        restoreModal(); // the restored detail view shows the card as «Añadida»
        return true;
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Añadir";
        ui.showToast("No se pudo añadir: " + err.message);
        return false;
      }
    },
    onEnrich: (item) => enrichExternalPreview(item),
  });
}

/**
 * Enrichment of the external preview (issue #280): movies with
 * getMovieDetails; shows with getTvExtraDetails + seasons
 * (getTvSeasonsMeta, non-blocking). Never throws: returns {} on
 * failure.
 */
async function enrichExternalPreview(item) {
  if (item.type === "tv") {
    try {
      const details = await getTvExtraDetails(item.externalId);
      try {
        details.seasonsMeta = await getTvSeasonsMeta(item.externalId);
      } catch (err) {
        // we do not block the preview if the seasons fail
      }
      return details;
    } catch (err) {
      return {};
    }
  }
  try {
    return await getMovieDetails(item.externalId);
  } catch (err) {
    return {};
  }
}

/**
 * Preview of a saga movie (issue #280, iteration): when pressing a
 * card of «Otras películas de la saga», its information is shown
 * before adding it.
 * @param {Object}   movie        - Saga part ({externalId, title, year, posterUrl, overview})
 * @param {Object}   ctx          - User data context
 * @param {Function} restoreModal - Reopens the detail of the original movie
 * @param {Set}      existingIds  - Set of already added externalIds (shared with the render)
 */
function openSagaMoviePreview(movie, ctx, restoreModal, existingIds) {
  const previewItem = {
    externalId: String(movie.externalId),
    type: "movie",
    title: movie.title,
    year: movie.year || "",
    coverUrl: movie.posterUrl || null,
    posterUrl: movie.posterUrl || null, // addSagaMovie expects posterUrl
    overview: movie.overview || "",
  };
  // addSagaMovie throws if the add fails; openExternalPreview
  // catches it and restores the button without closing the preview
  // (issue #280).
  return openExternalPreview(previewItem, ctx, restoreModal, existingIds, (item) =>
    addSagaMovie(item, ctx)
  );
}

/**
 * Preview of a recommendation (issue #280, iteration): when pressing
 * a card of «Si te gustó esto…» (movie or show) its extended
 * information is shown before adding it, same as the saga cards and
 * the search preview (issue #22).
 * @param {Object}   recItem      - Recommendation ({externalId, type, title, year, coverUrl, overview})
 * @param {Object}   ctx          - User data context
 * @param {Function} restoreModal - Reopens the detail of the original item
 * @param {Set}      existingIds  - Set of already added externalIds (shared with the render)
 */
function openRecommendationPreview(recItem, ctx, restoreModal, existingIds) {
  const previewItem = {
    externalId: String(recItem.externalId),
    type: recItem.type === "tv" ? "tv" : "movie",
    title: recItem.title,
    year: recItem.year || "",
    coverUrl: recItem.coverUrl || null,
    overview: recItem.overview || "",
  };
  return openExternalPreview(previewItem, ctx, restoreModal, existingIds, (item) =>
    addRecommendationItem(item, ctx)
  );
}

/**
 * Adds a recommended item (movie or show) to the user's record.
 * Core without button state: it reuses the same flow as handleAdd in
 * search.js for movies/TV. Does not throw: returns true/false.
 * @returns {Promise<boolean>} true if added correctly.
 */
async function addRecommendationItem(item, ctx) {
  const draft = {
    externalId: item.externalId,
    type: item.type,
    title: item.title,
    year: item.year || "",
    coverUrl: item.coverUrl || null,
    status: "pendiente",
    rating: null,
    notes: "",
  };

  if (item.type === "movie") {
    draft.watchLog = [];
    try {
      const details = await getMovieDetails(item.externalId);
      // Minimal storage: card + alerts + community rating only.
      Object.assign(draft, minimalStoredFields(details, "movie"));
      if (details.releaseDate !== undefined && isUnreleasedDate(details.releaseDate)) {
        draft.awaitingRelease = true;
      }
    } catch (err) {
      // we do not block the add if fetching extra details fails
    }
  } else {
    // TV
    draft.watched = {};
    draft.nextEpisode = { season: 1, episode: 1 };
    draft.firstWatchedAt = null;
    draft.lastWatchedAt = null;
    draft.timesCompleted = 0;
    draft.history = [];
    try {
      const details = await getTvExtraDetails(item.externalId);
      // Minimal storage: the alert fields are persisted.
      Object.assign(draft, minimalStoredFields(details, "tv"));
      if (details.firstAirDate !== undefined && isUnreleasedDate(details.firstAirDate)) {
        draft.awaitingRelease = true;
      }
    } catch (err) {
      // see above
    }
  }

  await addItem(ctx.getCurrentUser().uid, item.type, draft);
  return true;
}

/**
 * Adds a recommended item (movie or show) to the user's record,
 * handling the state of the card's button. Wraps
 * addRecommendationItem.
 * @returns {Promise<boolean>} true if added correctly.
 */
async function addFromRecommendation(item, btn, ctx) {
  btn.disabled = true;
  btn.textContent = "Añadiendo…";
  try {
    const ok = await addRecommendationItem(item, ctx);
    if (!ok) throw new Error("No se pudo añadir el ítem");
    btn.textContent = "Añadido";
    ui.showToast(`«${item.title}» añadido a tu registro.`);
    return true;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + err.message);
    return false;
  }
}

async function openSagaSelector(item, ctx) {
  if (!item.collectionId) return;
  try {
    const collection = await getCollectionDetails(item.collectionId);
    if (!collection || !collection.parts.length) {
      ui.showToast("No se pudo obtener la información de la saga.");
      return;
    }

    const existingIds = new Set(
      (await ctx.getGroupItemsResolved("movies")).map((m) => m.externalId)
    );

    const missingMovies = collection.parts.filter(
      (p) => !existingIds.has(p.externalId)
    );

    if (!missingMovies.length) {
      ui.showToast("Ya tienes todas las películas de esta saga.");
      return;
    }

    ui.closeModal();

    ui.openSagaSelectionModal(collection.name, missingMovies, {
      onConfirm: async (selectedMovies) => {
        ui.closeModal();
        let added = 0;
        let failed = 0;

        for (const movie of selectedMovies) {
          try {
            await addSagaMovie(movie, ctx);
            added++;
          } catch (err) {
            console.error("Error al añadir", movie.title, err);
            failed++;
          }
        }

        if (added > 0) {
          ui.showToast(`${added} película${added !== 1 ? "s" : ""} añadida${added !== 1 ? "s" : ""} de ${collection.name}.`);
        }
        if (failed > 0) {
          ui.showToast(`${failed} película${failed !== 1 ? "s" : ""} no pudieron añadirse.`);
        }
      },
      onCancel: () => ui.closeModal(),
    });
  } catch (err) {
    ui.showToast("Error al consultar la saga: " + err.message);
  }
}

function openBookItem(item, ctx) {
  const reopen = () => openBookItem(item, ctx);
  async function persist(newLog) {
    const status = statusFromReadLog(newLog);
    await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, { readLog: newLog, status });
    item.readLog = newLog;
    item.status = status;
  }

  ui.openBookModal(item, {
    onStartReading: (date) => persist(startReading(item.readLog, date)),
    onFinishReading: async (date) => {
      const prevLog = item.readLog;
      const prevStatus = item.status;
      await persist(finishReading(item.readLog, date));
      // Undo (issue #136): restores the previous readLog and status.
      // The status is restored LITERALLY as captured (not the
      // recomputed log one) in case the user had a manual state.
      await maybeOpenItemRatingWindow(item, ctx, "book", {
        onUndo: async () => {
          await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, {
            readLog: prevLog,
            status: prevStatus,
          });
          item.readLog = prevLog;
          item.status = prevStatus;
        },
      });
    },
    onUpdateEntry: (index, changes) => persist(updateReadEntry(item.readLog, index, changes)),
    onRemoveEntry: (index) => persist(removeReadEntry(item.readLog, index)),
    onSetStatus: async (newStatusOrNull) => {
      const status = newStatusOrNull || statusFromReadLog(item.readLog);
      await ctx.updateItem(ctx.getCurrentUser().uid, "book", item.id, { status });
      item.status = status;
    },
    onSaveMeta: saveMeta(item, "book", ctx),
    onDelete: confirmDelete(item, "book", ctx),
    onEdit: editHandlerFor(item, "book", reopen, ctx),
  });
}

async function openGameItem(item, ctx, isRerender = false) {
  const reopen = () => openGameItem(item, ctx, true);
  async function persist(newLog) {
    const status = statusFromPlayLog(newLog);
    await ctx.updateItem(ctx.getCurrentUser().uid, "game", item.id, { playLog: newLog, status });
    item.playLog = newLog;
    item.status = status;
  }

  ui.openGameModal(item, {
    onStartPlay: (date) => persist(startPlay(item.playLog, date)),
    onFinishPlay: async (date) => {
      const prevLog = item.playLog;
      const prevStatus = item.status;
      await persist(finishPlay(item.playLog, date));
      // Undo (issue #136): restores the previous playLog and status.
      // The status is restored LITERALLY as captured (not the
      // recomputed log one) in case the user had a manual state.
      await maybeOpenItemRatingWindow(item, ctx, "game", {
        communityLabel: "IGDB",
        onUndo: async () => {
          await ctx.updateItem(ctx.getCurrentUser().uid, "game", item.id, {
            playLog: prevLog,
            status: prevStatus,
          });
          item.playLog = prevLog;
          item.status = prevStatus;
        },
      });
    },
    onUpdateEntry: (index, changes) => persist(updatePlayEntry(item.playLog, index, changes)),
    onRemoveEntry: (index) => persist(removePlayEntry(item.playLog, index)),
    onSetStatus: async (newStatusOrNull) => {
      const status = newStatusOrNull || statusFromPlayLog(item.playLog);
      await ctx.updateItem(ctx.getCurrentUser().uid, "game", item.id, { status });
      item.status = status;
    },
    onSaveMeta: saveMeta(item, "game", ctx),
    onDelete: confirmDelete(item, "game", ctx),
    onEdit: editHandlerFor(item, "game", reopen, ctx),
  });

  // Detail on demand: load extended details in the background
  // (only first open; re-renders do not ask again).
  if (!isRerender && needsDetailFetch(item)) {
    item._detailsFailed = false;
    loadDetailsForModal(item, ctx, reopen);
  }
}

async function openTvItem(item, ctx, isRerender = false) {
  const reopen = () => openTvItem(item, ctx, true);
  let seasonsMeta;
  try {
    seasonsMeta = await getSeasonsMetaFor(item, ctx);
  } catch (err) {
    ui.showToast(err.message);
    return;
  }
  if (!seasonsMeta.length) {
    ui.showToast("TMDB no devuelve temporadas para esta serie todavía.");
  }

  // Live enrichment of season dates (issue #27): if the freshly
  // fetched meta differs from the persisted one, it is assigned in
  // memory (the modal badge via upcomingBadge paints right away)
  // and stored fire-and-forget; a failure here does not break the
  // modal. Manual shows have no real TMDB dates: they are excluded.
  if (!item.manual && seasonsMeta.length) {
    const seasonAirDates = Object.fromEntries(
      seasonsMeta.filter((s) => !s.manual).map((s) => [String(s.seasonNumber), s.airDate])
    );
    if (JSON.stringify(seasonAirDates) !== JSON.stringify(item.seasonAirDates)) {
      item.seasonAirDates = seasonAirDates;
      ctx
        .updateItem(ctx.getCurrentUser().uid, "tv", item.id, { seasonAirDates })
        .catch((err) => console.error("No se pudieron guardar las fechas de temporada:", err));
    }
  }

  const progress = progressWithStatus(seasonsMeta, item);

  // Fetch watch providers
  if (item.externalId) {
    try {
      item.watchProviders = await getWatchProviders(item.externalId, "tv", getUserCountry());
    } catch {
      item.watchProviders = null;
    }
  }

  async function persistWatched(newWatched) {
    const newProgress = computeProgress(seasonsMeta, newWatched);
    // awaitingRelease is always cleared when marking an episode: a
    // show with watched episodes cannot stay "unreleased"
    // (idempotent).
    await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, {
      watched: newWatched,
      status: newProgress.status,
      nextEpisode: newProgress.nextEpisode,
      firstWatchedAt: newProgress.firstWatchedAt,
      lastWatchedAt: newProgress.lastWatchedAt,
      awaitingRelease: false,
    });
    item.watched = newWatched;
    item.status = newProgress.status;
    item.nextEpisode = newProgress.nextEpisode;
    item.firstWatchedAt = newProgress.firstWatchedAt;
    item.lastWatchedAt = newProgress.lastWatchedAt;
    item.awaitingRelease = false;
    return newProgress;
  }

  // Opens the rating window of a just-marked episode (issue #21).
  // It shows the community score OF THE EPISODE (TMDB), not the show's.
  // Never throws: the already-persisted marking stays intact even if
  // the metadata query or the save fails.
  // Returns true if the user undid the marking (issue #136).
  async function maybeOpenEpisodeRatingWindow(item, ctx, seasonNumber, episodeNumber, opts = {}) {
    try {
      let meta = null;
      if (!item.manual && item.externalId) {
        const episodes = await ctx.getSeasonEpisodes(item.externalId, seasonNumber);
        meta = episodes.find((e) => e.episodeNumber === episodeNumber) || null;
      }
      const entry = normalizeEntry(
        (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
      ) || {};
      const result = await openRatingModal({
        type: "tv",
        title: item.title,
        coverUrl: item.coverUrl,
        episodeLabel: meta ? `T${seasonNumber}E${episodeNumber} · ${meta.name}` : `T${seasonNumber}E${episodeNumber}`,
        communityRating: meta ? meta.episodeRating : null,
        communityLabel: "TMDB · episodio",
        initialRating: entry.rating || null,
        onSave: async (rating) => {
          await persistWatched(setEpisodeRating(item.watched, seasonNumber, episodeNumber, rating));
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

  // --- Load recommendations (similar) ---
  let recommendations = [];
  let existingIds = new Set();
  if (item.externalId) {
    try {
      recommendations = await getSimilarTv(item.externalId);
      recommendations = recommendations.slice(0, 10);
    } catch {
      recommendations = [];
    }
    existingIds = new Set((await ctx.getGroupItemsResolved("tv")).map((t) => t.externalId));
  }

  ui.openTvModal(item, seasonsMeta, progress, {
    onExpandSeason: (seasonNumber) =>
      item.manual
        ? Promise.resolve(
            Array.from(
              { length: (seasonsMeta.find((s) => s.seasonNumber === seasonNumber) || seasonsMeta[0]).episodeCount },
              (_, i) => ({
                episodeNumber: i + 1,
                name: `Episodio ${i + 1}`,
                airDate: null,
              })
            )
          )
        : ctx.getSeasonEpisodes(item.externalId, seasonNumber),

    onSetEpisodeDate: async (seasonNumber, episodeNumber, dateOrNull) => {
      const prevEntry = normalizeEntry(
        (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
      );
      const wasWatched = Boolean(prevEntry && prevEntry.date);
      const prevAwaitingRelease = item.awaitingRelease;
      const prevStatus = item.status;
      const newProgress = await persistWatched(
        setEpisodeDate(item.watched, seasonNumber, episodeNumber, dateOrNull)
      );
      if (!wasWatched && dateOrNull) {
        // Undo (issue #136): if the just-made marking is undone, it
        // goes back to the previous progress so the UI below paints
        // the checkbox/stars/date correctly (item already mutated).
        const undone = await maybeOpenEpisodeRatingWindow(item, ctx, seasonNumber, episodeNumber, {
          onUndo: async () => {
            await persistWatched(setEpisodeDate(item.watched, seasonNumber, episodeNumber, null));
            // persistWatched forces awaitingRelease:false and the
            // recomputed status; the second update restores the
            // previous flag/state. Transient window in a
            // self-repairing DB (idempotent, issue #136).
            if (prevAwaitingRelease) {
              await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, { awaitingRelease: true });
              item.awaitingRelease = true;
            }
            await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, { status: prevStatus });
            item.status = prevStatus;
          },
        });
        if (undone) return computeProgress(seasonsMeta, item.watched); // REVERTED progress
      }
      return newProgress;
    },

    onSetEpisodeRating: (seasonNumber, episodeNumber, rating) =>
      persistWatched(setEpisodeRating(item.watched, seasonNumber, episodeNumber, rating)),

    // Episode ALREADY watched watched again (issue #133): adds 1 to
    // the watched counter and sets the date to today, keeping the
    // rating.
    onSetEpisodeSeenAgain: (seasonNumber, episodeNumber) =>
      persistWatched(markEpisodeSeenAgain(item.watched, seasonNumber, episodeNumber, todayISO())),

    onToggleSeason: (seasonNumber, allWatched) => {
      const seasonMeta = seasonsMeta.find((s) => s.seasonNumber === seasonNumber);
      return persistWatched(
        setSeasonWatched(item.watched, seasonNumber, seasonMeta.episodeCount, allWatched, todayISO())
      );
    },

    // Fire-and-forget: stores the air date of the next episode
    // ({ season, episode, airDate } or null) to be able to warn about
    // "unreleased" even if TMDB stops returning next_episode_to_air
    // (issue #27). A failure does not break the modal.
    onUpdateNextEpisodeAirDate: (info) => {
      item.nextEpisodeAirDate = info;
      return ctx
        .updateItem(ctx.getCurrentUser().uid, "tv", item.id, { nextEpisodeAirDate: info })
        .catch((err) => console.error("No se pudo guardar la fecha del próximo episodio:", err));
    },

    onRewatch: async () => {
      const changes = startRewatch(item);
      await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, changes);
      Object.assign(item, changes);
      ui.closeModal();
      ui.showToast("Nuevo visionado empezado. ¡A por ello!");
    },

    onSetStatus: async (newStatusOrNull) => {
      const status = newStatusOrNull || computeProgress(seasonsMeta, item.watched).status;
      await ctx.updateItem(ctx.getCurrentUser().uid, "tv", item.id, { status });
      item.status = status;
      return progressWithStatus(seasonsMeta, item);
    },

    onSaveMeta: saveMeta(item, "tv", ctx),
    onDelete: confirmDelete(item, "tv", ctx),
    onEdit: editHandlerFor(item, "tv", reopen, ctx),
    onAddRecommendation: async (recItem, btn) => {
      if (await addFromRecommendation(recItem, btn, ctx)) {
        existingIds.add(String(recItem.externalId));
      }
    },
    // Preview of a recommendation when pressing its card (issue
    // #280, iteration): same pattern as in the movie detail view —
    // it opens the preview (issue #22) and on close or add restores
    // the detail view with reopen; the shared existingIds Set makes
    // the card come back as «Añadida».
    onOpenRecommendation: (recItem) =>
      openRecommendationPreview(recItem, ctx, reopen, existingIds),
  }, recommendations, existingIds);

  // Detail on demand: load extended details in the background
  // (only first open; re-renders do not ask again).
  if (!isRerender && needsDetailFetch(item)) {
    item._detailsFailed = false;
    loadDetailsForModal(item, ctx, reopen);
  }
}

export function openItem(item, ctx) {
  if (item.type === "tv") openTvItem(item, ctx);
  else if (item.type === "movie") openMovieItem(item, ctx);
  else if (item.type === "game") openGameItem(item, ctx);
  else openBookItem(item, ctx);
}

export function setupModalCloseListeners() {
  // Closes the active modal respecting a registered custom close
  // (modal._onClose, used by the saga preview —issue #280— to
  // restore the detail view; it is consumed before invoking it). If
  // there is no custom one, normal close.
  const closeActiveModal = () => {
    const modal = document.getElementById("item-modal");
    if (modal._onClose) {
      const onClose = modal._onClose;
      modal._onClose = null;
      onClose();
    } else {
      ui.closeModal();
    }
  };

  document.getElementById("modal-close").addEventListener("click", () => {
    closeActiveModal();
  });
  document.getElementById("modal-backdrop").addEventListener("click", () => {
    closeActiveModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const episodeActionsModal = document.getElementById("episode-actions-modal");
      const ratingModal = document.getElementById("rating-modal");
      const modal = document.getElementById("item-modal");
      const notifDropdown = document.getElementById("notif-dropdown");

      // Priority: seen-again-episode > rating window > active modal
      // > notifications. (The global search is no longer a modal
      // since issue #46: its results dropdown handles its own Escape
      // with stopPropagation, so it never reaches here.)
      if (episodeActionsModal && !episodeActionsModal.classList.contains("hidden")) {
        e.preventDefault();
        closeEpisodeActionsModal();
        return;
      }
      if (ratingModal && !ratingModal.classList.contains("hidden")) {
        e.preventDefault();
        closeRatingModal();
        return;
      }
      if (!modal.classList.contains("hidden")) {
        e.preventDefault();
        closeActiveModal();
      } else if (notifDropdown && !notifDropdown.classList.contains("hidden")) {
        e.preventDefault();
        notifDropdown.classList.add("hidden");
        // Restore focus to the notifications button
        const notifBtn = document.getElementById("btn-notifications");
        if (notifBtn) notifBtn.focus();
      }
    }
  });
}
