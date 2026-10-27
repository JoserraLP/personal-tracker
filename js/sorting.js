// =============================================================
// Sorting and comparison functions. Extracted from app.js to be
// reusable both in app.js (list sorting) and in ui.js (badges for
// unreleased episodes).
// =============================================================

import { isUnreleasedDate } from "./release.js";

// Air info of the next episode that is the user's turn to watch:
// { season, episode, airDate, source } or null when unknown.
// Documented source precedence:
//   1. nextEpisodeToAir (live TMDB) when it matches the user's next
//      episode (source "toAir").
//   2. seasonAirDates[season] (refreshed daily; null = season not yet
//      released) when the episode belongs to that season
//      (source "season").
//   3. nextEpisodeAirDate (persisted historical backfill)
//      (source "stored").
// The `source` tag is purely informational for the predicate: it is
// never persisted (paths that build persisted objects build them
// without the tag).
export function getNextEpisodeAirInfo(item) {
  const ne = item.nextEpisode;
  if (item.type !== "tv" || item.manual || !ne) return null;
  const toAir = item.nextEpisodeToAir;
  if (toAir && toAir.season === ne.season && toAir.episode === ne.episode) {
    return { ...toAir, source: "toAir" };
  }
  const seasonAir = item.seasonAirDates && item.seasonAirDates[String(ne.season)];
  if (seasonAir !== undefined) {
    return { season: ne.season, episode: ne.episode, airDate: seasonAir, source: "season" };
  }
  const stored = item.nextEpisodeAirDate;
  if (stored && stored.season === ne.season && stored.episode === ne.episode) {
    return { ...stored, source: "stored" };
  }
  return null;
}

// Checks whether the next episode that is the user's turn to watch
// matches the upcoming episode TMDB says has not aired yet (or whose
// locally stored episode has no date or a future one).
export function isNextEpisodeUnreleased(item) {
  const info = getNextEpisodeAirInfo(item);
  return !!info && isUnreleasedDate(info.airDate);
}

// An item is "unreleased" if its next content (movie premiere, next
// episode or series premiere) has no official date or the date is in
// the future. Manual shows are excluded.
export function isItemUnreleased(item) {
  if (item.manual) return false;
  if (item.type === "movie") {
    return !(item.watchLog && item.watchLog.length) && isUnreleasedDate(item.releaseDate);
  }
  if (item.type === "tv") {
    if (!item.nextEpisode) return false; // finished: never "unreleased"
    return item.awaitingRelease === true || isNextEpisodeUnreleased(item);
  }
  return false;
}

// Normalizes to comparable text both the "YYYY-MM-DD" dates we
// store and Firestore Timestamps (addedAt), so they can be compared
// with each other in the same order.
export function toComparableTime(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  return null;
}

// Last real activity (last episode watched, last watch/read);
// if there is none yet, the date the item was added is used.
function getActivityOrAddedTime(item) {
  return toComparableTime(getSortDate(item)) || toComparableTime(item.addedAt);
}

// Last activity depending on the item type (to sort by recent
// activity date).
export function getSortDate(item) {
  let activity = null;
  if (item.type === "movie") {
    activity = item.watchLog && item.watchLog.length ? item.watchLog[item.watchLog.length - 1] : null;
  } else if (item.type === "tv") {
    activity = item.lastWatchedAt || null;
  } else if (item.type === "book") {
    const log = item.readLog || [];
    if (log.length) {
      const last = log[log.length - 1];
      activity = last.finishedAt || last.startedAt || null;
    }
  } else if (item.type === "game") {
    const log = item.playLog || [];
    if (log.length) {
      const last = log[log.length - 1];
      activity = last.finishedAt || last.startedAt || null;
    }
  }
  // If it was just detected that it has been released (movies and
  // shows that were awaiting release), that also counts as activity,
  // so it moves up in the order even if it has not been watched yet.
  if (item.releasedNoticedAt && (!activity || item.releasedNoticedAt > activity)) {
    activity = item.releasedNoticedAt;
  }
  return activity;
}

export function compareAlphabetical(a, b) {
  return a.title.localeCompare(b.title, "es", { sensitivity: "base" });
}

export function compareByYearDesc(a, b) {
  return (Number(b.year) || 0) - (Number(a.year) || 0);
}

export function compareByDateDesc(a, b) {
  const da = getSortDate(a);
  const db = getSortDate(b);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return db.localeCompare(da);
}

export function compareByActivityDesc(a, b) {
  const aBlocked = isItemUnreleased(a);
  const bBlocked = isItemUnreleased(b);
  if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
  const da = getActivityOrAddedTime(a);
  const db = getActivityOrAddedTime(b);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return db.localeCompare(da);
}

export function applySort(items, sortKey) {
  if (sortKey === "alfabetico") return [...items].sort(compareAlphabetical);
  if (sortKey === "anio") return [...items].sort(compareByYearDesc);
  if (sortKey === "fecha") return [...items].sort(compareByDateDesc);
  // "añadido" (default): what was watched/read most recently moves up;
  // what has not been started yet is sorted by when it was added.
  return [...items].sort(compareByActivityDesc);
}
