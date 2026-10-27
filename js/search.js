// =============================================================
// Search of movies, shows and books + adding from results
// + manual adding. Extracted from app.js to decouple all search
// logic from the general orchestration.
//
// Since issue #82 this module is stateless: it does not touch the
// DOM nor stores results. The dropdown UI (including the catalog
// search) lives in global-search.js, which imports the adding,
// preview and API call functions from here.
// =============================================================

import { addItem, updateItem, deleteItem } from "./db.js";
import { getMovieDetails, getTvExtraDetails, getTvSeasonsMeta, searchMovies as apiSearchMovies, searchTv as apiSearchTv } from "./api-movies.js";
import { searchBooks as apiSearchBooks, getOpenLibraryDescription } from "./api-books.js";
import { searchGames as apiSearchGames, getGameDetails } from "./api-games.js";
import { seenActionLabels } from "./constants.js";
import { isUnreleasedDate, unreleasedConfirmMessage } from "./release.js";
import { todayISO } from "./dates.js";
import { computeProgress, markAllSeasonsWatched } from "./tv-progress.js";
import { openRatingModal, RATING_MODAL_UNDONE } from "./rating-modal.js";
import * as ui from "./ui.js";

// Search in the catalog of a group (stateless: it only returns
// data, without touching the DOM). group: "movies" | "tv" | "books" | "games".
// Returns { items, hasMore, source } (source only for books:
// "googlebooks" | "openlibrary").
export async function searchExternal(group, query, page = 1) {
  if (group === "movies") return apiSearchMovies(query, page);
  if (group === "tv") return apiSearchTv(query, page);
  if (group === "games") return apiSearchGames(query, page);
  // Books: always in Spanish (the "Solo en español" checkbox was
  // removed in issue #82).
  return apiSearchBooks(query, page, null, true);
}

export function existingIdsFor(group, ctx) {
  return new Set(ctx.getItemsByGroup(group).map((i) => i.externalId));
}

// For books: detects whether they are already added by externalId OR
// by title+author (cross-reference between sources: a book added via
// Open Library with ID "/works/..." is also detected in Google Books
// results and vice versa).
export function existingBookKeys(ctx) {
  const books = ctx.getItemsByGroup("books");
  const keys = new Set();
  for (const b of books) {
    const key = `${(b.title || "").trim().toLowerCase()}|${(b.author || "").trim().toLowerCase()}`;
    keys.add(key);
  }
  return keys;
}

export function isBookAlreadyAdded(item, idsSet, keysSet) {
  if (idsSet.has(item.externalId)) return true;
  const key = `${(item.title || "").trim().toLowerCase()}|${(item.author || "").trim().toLowerCase()}`;
  return keysSet.has(key);
}

// Minimal storage (issue #200, study A2 sections 8.1-8.2):
// from the extended snapshot of the API only the fields the UI
// consumes WITHOUT network are persisted — card (coverUrl), alerts
// (releaseDate, firstAirDate, nextEpisodeToAir, seasonAirDates) and
// community rating (the card paints it). The rest of the detail view
// (synopsis, cast, trailer, saga, platforms...) is requested on
// demand when opening the detail; getMovieDetails/getTvExtraDetails
// keep that snapshot in their 24 h cache, so a freshly added detail
// view does not repeat the call.
export function minimalStoredFields(details, type) {
  const keep = {};
  if (type === "movie") {
    if (details.releaseDate !== undefined) keep.releaseDate = details.releaseDate;
    if (details.communityRating != null) keep.communityRating = details.communityRating;
    if (details.coverUrl) keep.coverUrl = details.coverUrl;
  } else if (type === "tv") {
    if (details.firstAirDate !== undefined) keep.firstAirDate = details.firstAirDate;
    if (details.tmdbStatus) keep.tmdbStatus = details.tmdbStatus;
    if (details.nextEpisodeToAir) keep.nextEpisodeToAir = details.nextEpisodeToAir;
    if (details.seasonAirDates && Object.keys(details.seasonAirDates).length) {
      keep.seasonAirDates = details.seasonAirDates;
    }
    if (details.communityRating != null) keep.communityRating = details.communityRating;
    if (details.coverUrl) keep.coverUrl = details.coverUrl;
  } else if (type === "game") {
    if (details.year) keep.year = details.year;
    if (details.releaseDate !== undefined) keep.releaseDate = details.releaseDate;
    if (details.communityRating != null) keep.communityRating = details.communityRating;
    if (details.coverUrl) keep.coverUrl = details.coverUrl;
  }
  return keep;
}

/* ---------- Adding from results ---------- */

async function doAddBook(item, btn, ctx, choices) {
  btn.disabled = true;
  btn.textContent = "Añadiendo…";
  try {
    const draft = {
      externalId: item.externalId,
      type: "book",
      title: item.title,
      year: item.year || "",
      coverUrl: choices.coverUrl || null,
      author: item.author || null,
      pages: item.pages || null,
      status: "pendiente",
      rating: null,
      notes: "",
      description: choices.description || "",
      progress: null,
      readLog: [],
    };

    // For Open Library books (ID "/works/..."), look up the synopsis
    // if none was provided.
    if (!draft.description && item.externalId && item.externalId.startsWith("/works/")) {
      try {
        draft.description = await getOpenLibraryDescription(item.externalId);
      } catch (err) {
        // we do not block the add
      }
    }

    await addItem(ctx.getCurrentUser().uid, "book", draft);
    ui.closeModal();
    ui.showToast(`«${item.title}» añadido a tu registro.`);
    return true;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + err.message);
    return false;
  }
}

export async function handleAdd(item, btn, ctx) {
  if (!ctx.getCurrentUser()) return;

  // Defense in depth against duplicates with lazy loading (issue
  // #178): the group may not be loaded in memory yet (tab not
  // visited) and the «Añadir» button may have been shown anyway.
  // Before adding, it is checked by externalId with a read that falls
  // back to Firestore if the in-memory state is not complete.
  if (item.externalId) {
    const typeToGroup = { movie: "movies", tv: "tv", book: "books", game: "games" };
    const group = typeToGroup[item.type] || "movies";
    const resolved = await ctx.getGroupItemsResolved(group);
    if (resolved.some((i) => i.externalId === item.externalId)) {
      btn.disabled = false;
      ui.showToast(`«${item.title}» ya está en tu registro.`);
      return false;
    }
  }

  // For books with multiple covers or synopses, open a selection
  // modal before adding.
  if (
    item.type === "book" &&
    ((item.allCovers && item.allCovers.length > 1) ||
      (item.allDescriptions && item.allDescriptions.length > 1))
  ) {
    ui.openBookConfirmModal(item, {
      onConfirm: (choices) => doAddBook(item, btn, ctx, choices),
      onCancel: () => ui.closeModal(),
    });
    return;
  }

  // Quick path: no options to choose (or Open Library source with one cover).
  if (item.type === "book") {
    return await doAddBook(item, btn, ctx, {
      coverUrl: item.coverUrl,
      description: item.description || "",
    });
  }

  // --- Video games (IGDB via proxy) ---
  if (item.type === "game") {
    btn.disabled = true;
    btn.textContent = "Añadiendo…";
    try {
      const draft = {
        externalId: item.externalId,
        type: "game",
        title: item.title,
        year: item.year || "",
        coverUrl: item.coverUrl || null,
        status: "pendiente",
        rating: null,
        notes: "",
        playLog: [],
      };
      try {
        const details = await getGameDetails(item.externalId);
        // Minimal storage: card + alerts + community rating only
        // (synopsis, platforms, etc. go on demand).
        Object.assign(draft, minimalStoredFields(details, "game"));
        if (!draft.coverUrl) draft.coverUrl = item.coverUrl || null;
        // Mandatory truthy releaseDate save: isUnreleasedDate(null)
        // returns true and a game without a date would stay
        // awaitingRelease forever (there is no daily refresh to
        // resolve it).
        if (details.releaseDate && isUnreleasedDate(details.releaseDate)) draft.awaitingRelease = true;
      } catch (err) {
        // we do not block the add if this extra step fails
      }
      await addItem(ctx.getCurrentUser().uid, "game", draft);
      ui.showToast(`«${item.title}» añadido a tu registro.`);
      return true;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Añadir";
      ui.showToast("No se pudo añadir: " + err.message);
      return false;
    }
  }

  // --- Movies / shows (unchanged) ---
  btn.disabled = true;
  btn.textContent = "Añadiendo…";
  try {
    const draft = {
      externalId: item.externalId,
      type: item.type,
      title: item.title,
      year: item.year || "",
      coverUrl: item.coverUrl || null,
      author: item.author || null,
      pages: item.pages || null,
      status: "pendiente",
      rating: null,
      notes: "",
    };

    if (item.type === "movie") {
      draft.watchLog = [];
      try {
        const details = await getMovieDetails(item.externalId);
        // Minimal storage: card + alerts + community rating only
        // (synopsis, cast, trailer, saga... on demand).
        Object.assign(draft, minimalStoredFields(details, "movie"));
        if (details.releaseDate !== undefined && isUnreleasedDate(details.releaseDate)) draft.awaitingRelease = true;
      } catch (err) {
        // we do not block the add if this extra step fails
      }
    } else if (item.type === "tv") {
      draft.watched = {};
      draft.nextEpisode = { season: 1, episode: 1 };
      draft.firstWatchedAt = null;
      draft.lastWatchedAt = null;
      draft.timesCompleted = 0;
      draft.history = [];
      try {
        const details = await getTvExtraDetails(item.externalId);
        // Minimal storage: the alert fields (dates and next episode)
        // are persisted; the rest of the detail view, on demand.
        Object.assign(draft, minimalStoredFields(details, "tv"));
        if (details.firstAirDate !== undefined && isUnreleasedDate(details.firstAirDate)) draft.awaitingRelease = true;
      } catch (err) {
        // see above
      }
    }

    await addItem(ctx.getCurrentUser().uid, item.type, draft);
    ui.showToast(`«${item.title}» añadido a tu registro.`);
    return true;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Añadir";
    ui.showToast("No se pudo añadir: " + err.message);
    return false;
  }
}

/* ---------- Direct add as watched from the catalog (issue #115) ---------- */

// Restores the «Marcar visto» button (or «Marcar leído»/«Marcar jugado»
// depending on the type, issue #177) to its initial state (after
// aborting, failing or undoing the add-as-watched flow).
function restoreSeenBtn(btn, type) {
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = seenActionLabels(type).action;
}

// Adds the item as watched and opens the rating window right away
// (pattern maybeQuickItemRating from quick-actions.js). Never
// throws: if the window cannot open, the already-persisted add stays
// intact. Returns true only if the flow finished without undo; false
// if the user undid the marking (the toast already informed of it).
async function openSeenRating(uid, type, ref, opts) {
  try {
    const result = await openRatingModal({
      type,
      title: opts.title,
      coverUrl: opts.coverUrl,
      communityRating: opts.communityRating ?? null,
      communityLabel: opts.communityLabel || "TMDB",
      initialRating: null,
      onSave: async (rating) => {
        await updateItem(uid, type, ref.id, { rating });
      },
      onUndo: async () => {
        await deleteItem(uid, type, ref.id);
      },
    });
    const undone = result === RATING_MODAL_UNDONE;
    if (undone) {
      ui.showToast("Marcado deshecho.");
      // false = the button must be restored: after the undo, the
      // Firestore snapshot re-renders the row with both buttons active
      // and meanwhile the button must not stay at «Visto» (issue #115).
      return false;
    }
    ui.showToast(opts.doneToast);
    return true;
  } catch (err) {
    console.error("No se pudo abrir la valoración:", err);
    return false;
  }
}

// Add of an already-read book (issue #115): same skeleton as
// doAddBook, but with status "completado" and the readLog with start
// and end today.
async function doAddBookSeen(item, btn, ctx, choices) {
  btn.disabled = true;
  btn.textContent = "Marcando…";
  try {
    const draft = {
      externalId: item.externalId,
      type: "book",
      title: item.title,
      year: item.year || "",
      coverUrl: choices.coverUrl || null,
      author: item.author || null,
      pages: item.pages || null,
      status: "completado",
      rating: null,
      notes: "",
      description: choices.description || "",
      progress: null,
      readLog: [{ startedAt: todayISO(), finishedAt: todayISO() }],
    };

    // For Open Library books (ID "/works/..."), look up the synopsis
    // if none was provided (same backfill as doAddBook).
    if (!draft.description && item.externalId && item.externalId.startsWith("/works/")) {
      try {
        draft.description = await getOpenLibraryDescription(item.externalId);
      } catch (err) {
        // we do not block the add
      }
    }

    const ref = await addItem(ctx.getCurrentUser().uid, "book", draft);
    ui.closeModal();
    const ok = await openSeenRating(ctx.getCurrentUser().uid, "book", ref, {
      title: item.title,
      coverUrl: choices.coverUrl,
      communityRating: null,
      doneToast: `«${item.title}» añadido y marcado como leído.`,
    });
    // The multi-cover path has no listener consuming the promise
    // (the flow continued in the confirmation modal): the final state
    // of the button is set right here, like the dropdown listener does.
    if (ok) {
      btn.disabled = true;
      btn.textContent = seenActionLabels("book").done;
    } else {
      restoreSeenBtn(btn, "book");
    }
    return ok;
  } catch (err) {
    restoreSeenBtn(btn, "book");
    ui.showToast("No se pudo añadir: " + err.message);
    return false;
  }
}

// Marks a catalog result as watched directly and opens the rating
// right away, skipping the intermediate add→mark step (issue #115).
// For shows it marks ALL the episodes of ALL the seasons and rates
// the show as a whole.
// Returns Promise<boolean>: true = added and flow completed,
// false = aborted, error or undone.
export async function handleAddSeen(item, btn, ctx) {
  if (!ctx.getCurrentUser()) return false;

  // Defense in depth against duplicates with lazy loading (issue
  // #178): the group may not be loaded in memory yet (tab not
  // visited) and the «Marcar visto/leído/jugado» button may have been
  // shown anyway. Before adding, it is checked by externalId with a
  // read that falls back to Firestore if the in-memory state is not
  // complete.
  if (item.externalId) {
    const typeToGroup = { movie: "movies", tv: "tv", book: "books", game: "games" };
    const group = typeToGroup[item.type] || "movies";
    const resolved = await ctx.getGroupItemsResolved(group);
    if (resolved.some((i) => i.externalId === item.externalId)) {
      restoreSeenBtn(btn, item.type);
      ui.showToast(`«${item.title}» ya está en tu registro.`);
      return false;
    }
  }

  // For books with multiple covers or synopses, open a selection
  // modal before adding (same predicate as handleAdd). It is not
  // awaited: the result arrives via doAddBookSeen.
  if (
    item.type === "book" &&
    ((item.allCovers && item.allCovers.length > 1) ||
      (item.allDescriptions && item.allDescriptions.length > 1))
  ) {
    ui.openBookConfirmModal(item, {
      onConfirm: (choices) => doAddBookSeen(item, btn, ctx, choices),
      onCancel: () => ui.closeModal(),
    });
    return;
  }

  // Quick path: no options to choose (or Open Library source with one cover).
  if (item.type === "book") {
    return await doAddBookSeen(item, btn, ctx, {
      coverUrl: item.coverUrl,
      description: item.description || "",
    });
  }

  // --- Video games (IGDB via proxy) ---
  if (item.type === "game") {
    btn.disabled = true;
    btn.textContent = "Marcando…";
    try {
      const draft = {
        externalId: item.externalId,
        type: "game",
        title: item.title,
        year: item.year || "",
        coverUrl: item.coverUrl || null,
        status: "completado",
        rating: null,
        notes: "",
        playLog: [{ startedAt: todayISO(), finishedAt: todayISO() }],
        awaitingRelease: false,
      };
      let details = {};
      try {
        details = await getGameDetails(item.externalId);
        // Minimal storage: card + alerts + community rating only
        // (the detail view is requested on demand at open).
        Object.assign(draft, minimalStoredFields(details, "game"));
        // IGDB may return cover null: do not override the
        // cover of the search result (same pattern as TMDB).
        draft.coverUrl = draft.coverUrl || item.coverUrl;
      } catch (err) {
        // we do not block the add if this extra step fails
      }

      const ref = await addItem(ctx.getCurrentUser().uid, "game", draft);
      return await openSeenRating(ctx.getCurrentUser().uid, "game", ref, {
        title: item.title,
        coverUrl: item.coverUrl,
        communityRating: details.communityRating ?? null,
        communityLabel: "IGDB",
        doneToast: `«${item.title}» añadido y marcado como jugado.`,
      });
    } catch (err) {
      restoreSeenBtn(btn, "game");
      ui.showToast("No se pudo añadir: " + err.message);
      return false;
    }
  }

  // --- Movies / shows ---
  btn.disabled = true;
  btn.textContent = "Marcando…";
  try {
    if (item.type === "movie") {
      let details = {};
      try {
        details = await getMovieDetails(item.externalId);
      } catch (err) {
        // we do not block the add if this extra step fails
      }

      // Unreleased confirmation: search results do not carry
      // releaseDate, so the one from the details is used (with a
      // null fallback, which the message treats as "no official date").
      const msg = unreleasedConfirmMessage({
        type: "movie",
        manual: false,
        releaseDate: details.releaseDate || null,
        title: item.title,
      });
      if (msg && !window.confirm(msg)) {
        restoreSeenBtn(btn, "movie");
        return false;
      }

      const draft = {
        externalId: item.externalId,
        type: "movie",
        title: item.title,
        year: item.year || "",
        coverUrl: item.coverUrl || null,
        author: item.author || null,
        pages: item.pages || null,
        status: "completado",
        rating: null,
        notes: "",
        watchLog: [todayISO()],
        awaitingRelease: false,
      };
      // Minimal storage: card + alerts + community rating only.
      Object.assign(draft, minimalStoredFields(details, "movie"));

      // TMDB may return poster_path null: do not override the cover of
      // the search result (QA review pattern, issue #115).
      draft.coverUrl = draft.coverUrl || item.coverUrl;

      const ref = await addItem(ctx.getCurrentUser().uid, "movie", draft);
      return await openSeenRating(ctx.getCurrentUser().uid, "movie", ref, {
        title: item.title,
        coverUrl: item.coverUrl,
        communityRating: details.communityRating ?? null,
        doneToast: `«${item.title}» añadida y marcada como vista.`,
      });
    }

    // Show: mandatory GATE — without seasons there is no partial add.
    let seasonsMeta = [];
    try {
      seasonsMeta = await getTvSeasonsMeta(item.externalId);
    } catch (err) {
      seasonsMeta = [];
    }
    if (!seasonsMeta.length) {
      ui.showToast(`No se pudo marcar «${item.title}»: no se pudieron obtener sus temporadas.`);
      restoreSeenBtn(btn, "tv");
      return false;
    }

    // Confirmation if there are seasons not released yet.
    const unreleasedSeasons = seasonsMeta.filter((s) => isUnreleasedDate(s.airDate));
    if (unreleasedSeasons.length) {
      const msg = `«${item.title}» · ${unreleasedSeasons.length} de ${seasonsMeta.length} temporadas aún no están estrenadas. ¿Marcarlas todas igualmente como vistas?`;
      if (!window.confirm(msg)) {
        restoreSeenBtn(btn, "tv");
        return false;
      }
    }

    let tvDetails = {};
    try {
      tvDetails = await getTvExtraDetails(item.externalId);
    } catch (err) {
        // we do not block the add if this extra step fails
    }

    const draft = {
      externalId: item.externalId,
      type: "tv",
      title: item.title,
      year: item.year || "",
      coverUrl: item.coverUrl || null,
      author: item.author || null,
      pages: item.pages || null,
      status: "completado",
      rating: null,
      notes: "",
    };
    // Minimal storage: card + alerts + community rating only.
    Object.assign(draft, minimalStoredFields(tvDetails, "tv"));
    // All episodes of all seasons, marked today.
    const watched = markAllSeasonsWatched({}, seasonsMeta, todayISO());
    const progress = computeProgress(seasonsMeta, watched);
    draft.watched = watched;
    draft.nextEpisode = null;
    draft.firstWatchedAt = progress.firstWatchedAt;
    draft.lastWatchedAt = progress.lastWatchedAt;
    draft.timesCompleted = 0;
    draft.history = [];
    draft.awaitingRelease = false;
    draft.coverUrl = draft.coverUrl || item.coverUrl;

    const ref = await addItem(ctx.getCurrentUser().uid, "tv", draft);
    return await openSeenRating(ctx.getCurrentUser().uid, "tv", ref, {
      title: item.title,
      coverUrl: item.coverUrl,
      communityRating: tvDetails.communityRating ?? null,
      // Without episodeLabel: the rating is for the show as a whole.
      doneToast: `«${item.title}» añadida y marcada como vista.`,
    });
  } catch (err) {
    restoreSeenBtn(btn, item.type);
    ui.showToast("No se pudo añadir: " + err.message);
    return false;
  }
}

/* ---------- Preview of search results (issue #22) ---------- */

// Loads the extended details of a search result for the preview.
// Returns {} when there is nothing to enrich or when the API call
// fails (never throws).
export async function enrichSearchItem(item) {
  if (item.type === "movie") {
    try {
      return await getMovieDetails(item.externalId);
    } catch (err) {
      return {};
    }
  }
  if (item.type === "tv") {
    try {
      const details = await getTvExtraDetails(item.externalId);
      // Seasons are requested separately: if they fail, the details
      // are returned without seasonsMeta (the preview does not get
      // blocked).
      try {
        details.seasonsMeta = await getTvSeasonsMeta(item.externalId);
      } catch (err) {
        // we do not block the preview
      }
      return details;
    } catch (err) {
      return {};
    }
  }
  // Video game: extended IGDB data (synopsis, platforms,
  // developers, Metacritic, ESRB...).
  if (item.type === "game") {
    try {
      return await getGameDetails(item.externalId);
    } catch (err) {
      return {};
    }
  }
  // Book: synopsis only, and only for Open Library sources
  // ("/works/...") that do not carry it in the search result yet.
  if (item.externalId && item.externalId.startsWith("/works/") && !item.description) {
    try {
      return { description: await getOpenLibraryDescription(item.externalId) };
    } catch (err) {
      return {};
    }
  }
  return {};
}

// Opens the preview of a search result. It recomputes `added` with
// the current ctx state as defense against changes between render
// and click (the group is mapped to plural because ctx uses the
// "movies"/"tv"/"books"/"games" keys).
export function openSearchPreviewFromResults(item, added, ctx) {
  const typeToGroup = { movie: "movies", tv: "tv", book: "books", game: "games" };
  const group = typeToGroup[item.type] || "movies";
  const currentAdded =
    item.type === "book"
      ? isBookAlreadyAdded(item, existingIdsFor("books", ctx), existingBookKeys(ctx))
      : existingIdsFor(group, ctx).has(item.externalId);

  ui.openSearchPreviewModal(item, {
    added: currentAdded,
    onAdd: async (item, btn) => {
      const ok = await handleAdd(item, btn, ctx);
      // closeModal is idempotent: books already closed in doAddBook
      if (ok) ui.closeModal();
      return ok;
    },
    onEnrich: enrichSearchItem,
  });
}

/* ---------- Manual add ---------- */

function manualExternalId() {
  return "manual-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function handleManualAdd(type, data, ctx) {
  if (!ctx.getCurrentUser()) return;
  const draft = {
    externalId: manualExternalId(),
    type,
    manual: true,
    title: data.title,
    year: data.year || "",
    coverUrl: data.coverUrl || null,
    author: data.author || null,
    pages: data.pages || null,
    status: "pendiente",
    rating: null,
    notes: "",
  };
  if (type === "movie") {
    draft.watchLog = [];
  } else if (type === "tv") {
    draft.watched = {};
    draft.nextEpisode = { season: 1, episode: 1 };
    draft.firstWatchedAt = null;
    draft.lastWatchedAt = null;
    draft.timesCompleted = 0;
    draft.history = [];
    draft.manualEpisodeCount = data.episodeCount || 10;
  } else if (type === "game") {
    draft.progress = null;
    draft.playLog = [];
  } else {
    // Books
    draft.progress = null;
    draft.readLog = [];
  }
  try {
    await addItem(ctx.getCurrentUser().uid, type, draft);
    ui.showToast(`«${data.title}» añadido manualmente.`);
    ui.closeModal();
  } catch (err) {
    ui.showToast("No se pudo añadir: " + err.message);
  }
}
