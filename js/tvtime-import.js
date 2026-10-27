// =============================================================
// Import of the full history from a TV Time JSON file. The TV Time
// export is an array of shows with their seasons/episodes and the
// watch state of each one (is_watched + watched_at). This module is
// PURE (parsing and transformation) so it can be tested without
// DOM/Firebase, and the setupTvTimeImport function wires the
// Settings button with the real flow (file → confirm → creation in
// Firestore).
//
// Each show is imported as an item with `type: "tv"` and `manual:
// true`: TV Time identified shows by TVDB and the TMDB id does not
// exist here, so it is excluded from the "unreleased" flow (which
// depends on TMDB dates) and the detail view is edited as a manual
// show. "Special" seasons (season 0) are not imported. The favorite
// mark is not imported either (the app has no favorites).
// =============================================================

import * as ui from "./ui.js";

// The incoming ctx object rules (repo pattern: modules do not talk
// to Firebase directly; app.js injects into the context the data
// access functions that are needed).

// -------------------------------------------------------------
// Pure utilities
// -------------------------------------------------------------

// TV Time watched_at ("2023-01-12 20:20:32") → day ISO
// ("2023-01-12"), the site's canonical format. Returns null if the
// value is not a reasonable date.
export function tvTimeDateToIso(watchedAt) {
  if (!watchedAt || typeof watchedAt !== "string") return null;
  const day = watchedAt.trim().split(" ")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

// Original TV Time state (status) + progress data → record state
// (pendiente/en_curso/completado/abandonado/standby):
//   up_to_date    → completado if everything registered is finished; otherwise en_curso
//   not_started_yet → pendiente
//   continuing    → en_curso (or pendiente if nothing has been watched)
//   stopped       → abandonado (or pendiente if nothing has been watched)
//   unknown       → pendiente
export function statusFromTvTime(status, watchedCount, episodeCount) {
  switch (status) {
    case "up_to_date":
      return episodeCount > 0 && watchedCount >= episodeCount ? "completado" : "en_curso";
    case "continuing":
      return watchedCount > 0 ? "en_curso" : "pendiente";
    case "stopped":
      return watchedCount > 0 ? "abandonado" : "pendiente";
    default:
      return "pendiente";
  }
}

// NON-special seasons (content), in order, with their episode
// count: the shape the app uses as seasonsMeta in the detail view.
export function tvTimeSeasonsMeta(entry) {
  const seasons = Array.isArray(entry?.seasons) ? entry.seasons : [];
  return seasons
    .filter((s) => s && s.is_specials === false && typeof s.number === "number" && s.number >= 1)
    .sort((a, b) => a.number - b.number)
    .map((s) => ({ seasonNumber: s.number, episodeCount: Number(s.episodes?.length) || 0 }));
}

// watched by season/episode with the dates from the file: the
// canonical shape #{ season: { episode: { date, rating, times } } }
// (js/tv-progress.js). Non-special seasons only; an episode counted
// several times is stored with times = rewatch_count + watched_count
// when there is data, or with the minimum (1).
export function tvTimeWatchedMap(entry) {
  const watched = {};
  let firstDate = null;
  let lastDate = null;
  let episodesWatched = 0;

  const seasons = Array.isArray(entry?.seasons) ? entry.seasons : [];
  for (const season of seasons) {
    if (!season || season.is_specials !== false || typeof season.number !== "number") continue;
    const episodes = Array.isArray(season.episodes) ? season.episodes : [];
    for (const ep of episodes) {
      if (!ep || typeof ep.number !== "number" || ep.number < 1 || !ep.is_watched) continue;
      const date = tvTimeDateToIso(ep.watched_at);
      const times = Math.max(1, (Number(ep.rewatch_count) || 0) + (Number(ep.watched_count) || 0));
      const key = String(season.number);
      const epKey = String(ep.number);
      watched[key] = watched[key] || {};
      watched[key][epKey] = { date: date || null, rating: null, times };
      episodesWatched++;
      if (date && (!firstDate || date < firstDate)) firstDate = date;
      if (date && (!lastDate || date > lastDate)) lastDate = date;
    }
  }
  return { watched, firstWatchedAt: firstDate, lastWatchedAt: lastDate, episodesWatched };
}

// Next pending episode: the first episode NOT watched (in order
// season → number) of the non-special seasons. null if the show is
// complete according to the file.
export function tvTimeNextEpisode(entry) {
  const seasons = tvTimeSeasonsMeta(entry);
  const fileEpisodes = new Map();
  for (const season of entry?.seasons || []) {
    if (season && season.is_specials === false && typeof season.number === "number") {
      fileEpisodes.set(season.number, season.episodes || []);
    }
  }
  for (const { seasonNumber } of seasons) {
    for (const ep of fileEpisodes.get(seasonNumber) || []) {
      if (ep && typeof ep.number === "number" && ep.number >= 1 && !ep.is_watched) {
        return { season: seasonNumber, episode: ep.number };
      }
    }
  }
  return null;
}

// Converts ONE TV Time entry to a show item draft (`type: "tv"`).
// Returns null if the entry is not valid (no title or missing
// minimum structure: the flow informs and skips it).
export function buildTvTimeItem(entry) {
  if (!entry || !entry.title) return null;

  const seasonsMeta = tvTimeSeasonsMeta(entry);
  const totalEpisodes = seasonsMeta.reduce((acc, s) => acc + s.episodeCount, 0);
  const { watched, firstWatchedAt, lastWatchedAt, episodesWatched } = tvTimeWatchedMap(entry);
  const nextEpisode = tvTimeNextEpisode(entry);
  const completed = nextEpisode === null && episodesWatched > 0;

  return {
    externalId: null,
    type: "tv",
    title: String(entry.title),
    year: null,
    coverUrl: null,
    author: null,
    pages: null,
    status: completed ? "completado" : statusFromTvTime(entry.status, episodesWatched, totalEpisodes),
    rating: null,
    notes: "",
    manual: true,
    watched,
    nextEpisode: completed ? null : nextEpisode,
    firstWatchedAt,
    lastWatchedAt,
    timesCompleted: completed ? 1 : 0,
    history: [],
    seasonsMeta,
  };
}

// Parses the full export and returns the drafts + error counters.
// Throws (Error with a clear message) if the file does not look as
// expected: the UI flow shows the reason.
export function parseTvTimeExport(json) {
  if (!Array.isArray(json)) {
    throw new Error("El fichero no tiene el formato del export de TV Time (se esperaba una lista de series).");
  }

  const items = [];
  let skipped = 0;
  for (const entry of json) {
    const item = buildTvTimeItem(entry);
    if (item) {
      items.push(item);
    } else {
      skipped++;
    }
  }

  return {
    ok: items.length > 0,
    items,
    skipped,
    totalEpisodesWatched: items.reduce(
      (acc, it) => acc + Object.values(it.watched).reduce(
        (acc2, ses) => acc2 + Object.keys(ses).length,
        0
      ),
      0
    ),
  };
}

// -------------------------------------------------------------
// UI flow (several files file → confirm → create)
// -------------------------------------------------------------

let _tvTimeFileInput = null;
function getTvTimeFileInput() {
  if (!_tvTimeFileInput) {
    _tvTimeFileInput = document.createElement("input");
    _tvTimeFileInput.type = "file";
    _tvTimeFileInput.accept = ".json,application/json";
    _tvTimeFileInput.style.display = "none";
    document.body.appendChild(_tvTimeFileInput);
  }
  return _tvTimeFileInput;
}

/**
 * Imports a file from the TV Time export:
 *   asks for the file → parses → shows a summary and asks for
 *   confirmation → creates all the shows in Firestore.
 * If a show already exists in the record it is imported again (it
 * may be duplicated): it is warned in the confirmation.
 * @param {Object} ctx - Application context (ctx from app.js).
 */
export function importTvTime(ctx) {
  const user = ctx.getCurrentUser();
  if (!user) {
    ui.showToast("No has iniciado sesión.");
    return;
  }

  const input = getTvTimeFileInput();
  const fresh = input.cloneNode(false);
  input.parentNode.replaceChild(fresh, input);
  _tvTimeFileInput = fresh;

  fresh.addEventListener("change", async () => {
    const file = fresh.files && fresh.files[0];
    if (!file) return;

    try {
      const parsed = parseTvTimeExport(JSON.parse(await file.text()));

      if (!parsed.ok) {
        ui.showToast("En el fichero no hay ninguna serie importable.");
        return;
      }

      const confirmMessage =
        `Se van a importar ${parsed.items.length} serie(s) con un total de ` +
        `${parsed.totalEpisodesWatched} episodios vistos` +
        (parsed.skipped ? ` (${parsed.skipped} entrada(s) inválidas se saltarán).` : ".") +
        "\n\nSe AÑADIRÁN a tu registro sin sustituir lo que ya tienes: si una serie ya estaba, quedará duplicada.";
      if (!confirm(confirmMessage)) return;

      const uid = user.uid;
      let added = 0;
      let errors = 0;

      ui.showToast(`Importando ${parsed.items.length} serie(s)…`);

      for (const item of parsed.items) {
        try {
          await ctx.addItem(uid, "tv", item);
          added++;
        } catch (err) {
          errors++;
          console.warn("Error importando serie de TV Time:", item.title, err);
        }
      }

      const msg = `Importadas ${added} serie(s).`;
      if (errors > 0) {
        ui.showToast(`${msg} ${errors} error(es) (ver consola).`);
      } else {
        ui.showToast(msg);
      }
    } catch (err) {
      console.error("Error importando TV Time:", err);
      ui.showToast("No se pudo importar: " + (err.message || err));
    }
  });

  fresh.click();
}

/**
 * Connects the Settings button with the import flow.
 * @param {Object} ctx - Application context (ctx from app.js).
 */
export function setupTvTimeImport(ctx) {
  const btn = document.getElementById("btn-import-tvtime");
  if (btn) btn.addEventListener("click", () => importTvTime(ctx));
}
