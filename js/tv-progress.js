// =============================================================
// Progress of a TV show from:
// - seasonsMeta: seasons and episode counts, fetched live from TMDB
// - watched: per-episode data of the current watch, with shape
//   { "1": { "1": { date: "2026-01-05", rating: 4, times: 2 }, "2": {...} }, "2": {...} }
//   (season -> episode -> { date of the last time watched,
//   rating 1-5 (0.5 steps since issue #276) or null, watched times
//   defaulting to 1 })
// It does not depend on the DOM or Firebase: it is pure logic,
// reusable both from ui.js (to refresh the view on the fly) and from
// app.js (to decide what to save).
// =============================================================

// Compatibility with old data: previously each episode stored only
// the date as plain text ("2026-01-05"), with no object and no
// rating, and the times field (number of times watched) did not
// exist (issue #133).
// Normalizes the entry to the { date, rating, times } format without
// mutating the original: objects that already have times are
// returned as-is.
export function normalizeEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return { date: entry, rating: null, times: 1 };
  if (entry.date && entry.times == null) return { ...entry, times: 1 };
  return entry;
}

// Average rating of the rated episodes of a show (issue #80).
// Unrated episodes are not taken into account: a watched episode
// without a rating (rating null) never counts as 0. Since issue #276
// the minimum valid rating is half a star (0.5).
// Input: full item.watched ({ season: { episode: {date, rating} } }).
// Output: null if there is no episode with a valid rating; otherwise
// { count, average } with average unrounded (total/count).
export function computeEpisodeAverageRating(watched) {
  let count = 0;
  let total = 0;
  for (const seasonMap of Object.values(watched || {})) {
    if (!seasonMap || typeof seasonMap !== "object") continue;
    for (const raw of Object.values(seasonMap)) {
      const entry = normalizeEntry(raw);
      const r = Number(entry?.rating);
      // Half-star ratings (0.5) are valid since issue #276.
      if (!Number.isFinite(r) || r < 0.5 || r > 5) continue;
      count++;
      total += r;
    }
  }
  if (count === 0) return null;
  return { count, average: total / count };
}

export function computeProgress(seasonsMeta, watched) {
  const totalEpisodes = seasonsMeta.reduce((sum, s) => sum + s.episodeCount, 0);
  let totalWatched = 0;
  let firstWatchedAt = null;
  let lastWatchedAt = null;

  for (const s of seasonsMeta) {
    const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
    for (const raw of Object.values(seasonWatched)) {
      const entry = normalizeEntry(raw);
      if (!entry || !entry.date) continue;
      totalWatched++;
      if (!firstWatchedAt || entry.date < firstWatchedAt) firstWatchedAt = entry.date;
      if (!lastWatchedAt || entry.date > lastWatchedAt) lastWatchedAt = entry.date;
    }
  }

  let nextEpisode = null;
  seasonsLoop: for (const s of seasonsMeta) {
    const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
    for (let ep = 1; ep <= s.episodeCount; ep++) {
      const entry = normalizeEntry(seasonWatched[String(ep)]);
      if (!entry || !entry.date) {
        nextEpisode = { season: s.seasonNumber, episode: ep };
        break seasonsLoop;
      }
    }
  }

  let status = "pendiente";
  if (totalEpisodes > 0 && totalWatched >= totalEpisodes) {
    status = "completado";
  } else if (totalWatched > 0) {
    status = "en_curso";
  }

  return { totalEpisodes, totalWatched, nextEpisode, status, firstWatchedAt, lastWatchedAt };
}

// dateOrNull: "YYYY-MM-DD" date to mark watched, or null to unmark.
// If it already had a rating or a watched counter, they are kept.
export function setEpisodeDate(watched, seasonNumber, episodeNumber, dateOrNull) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  const epKey = String(episodeNumber);
  if (dateOrNull) {
    const existing = normalizeEntry(seasonMap[epKey]) || {};
    seasonMap[epKey] = {
      date: dateOrNull,
      rating: existing.rating ?? null,
      times: existing.times || 1,
    };
  } else {
    delete seasonMap[epKey];
  }
  return { ...(watched || {}), [key]: seasonMap };
}

// Marks an ALREADY watched episode as watched again: keeps the
// rating and adds 1 to the watched counter (issue #133).
export function markEpisodeSeenAgain(watched, seasonNumber, episodeNumber, date) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  const epKey = String(episodeNumber);
  const existing = normalizeEntry(seasonMap[epKey]) || {};
  seasonMap[epKey] = {
    date,
    rating: existing.rating ?? null,
    times: (existing.times || 1) + 1,
  };
  return { ...(watched || {}), [key]: seasonMap };
}

// Only an episode already marked as watched can be rated.
// The watched counter is kept when re-rating (issue #133).
export function setEpisodeRating(watched, seasonNumber, episodeNumber, rating) {
  const key = String(seasonNumber);
  const seasonMap = { ...((watched && watched[key]) || {}) };
  const epKey = String(episodeNumber);
  const existing = normalizeEntry(seasonMap[epKey]);
  if (!existing || !existing.date) return { ...(watched || {}), [key]: seasonMap };
  seasonMap[epKey] = { date: existing.date, rating, times: existing.times || 1 };
  return { ...(watched || {}), [key]: seasonMap };
}

export function setSeasonWatched(watched, seasonNumber, episodeCount, allWatched, date) {
  const key = String(seasonNumber);
  const previous = (watched && watched[key]) || {};
  const seasonMap = {};
  if (allWatched) {
    for (let ep = 1; ep <= episodeCount; ep++) {
      const existing = normalizeEntry(previous[String(ep)]);
      seasonMap[String(ep)] = {
        date,
        rating: existing ? existing.rating : null,
        times: existing ? existing.times || 1 : 1,
      };
    }
  }
  return { ...(watched || {}), [key]: seasonMap };
}

// Marks as watched ALL the seasons of a show (issue #115):
// applies setSeasonWatched(allWatched=true) to each season.
export function markAllSeasonsWatched(watched, seasonsMeta, date) {
  return seasonsMeta.reduce(
    (acc, s) => setSeasonWatched(acc, s.seasonNumber, s.episodeCount, true, date),
    watched || {}
  );
}

// Archives the current watch (if any) into the history and leaves
// the show ready to be watched again from scratch, without losing
// the number of times watched or the previous dates.
export function startRewatch(item) {
  const history = [...(item.history || [])];
  if (item.firstWatchedAt || item.lastWatchedAt) {
    history.push({ startedAt: item.firstWatchedAt, finishedAt: item.lastWatchedAt });
  }
  return {
    watched: {},
    firstWatchedAt: null,
    lastWatchedAt: null,
    status: "pendiente",
    nextEpisode: { season: 1, episode: 1 },
    timesCompleted: (item.timesCompleted || 0) + (item.status === "completado" ? 1 : 0),
    history,
  };
}
