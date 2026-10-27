// =============================================================
// Logic of "not yet released". TMDB returns an empty date as null
// (normalized in api-movies.js); for us an item without an official
// release date is treated the same as one with a future date: it is
// NOT released. The single criterion lives here, along with the
// confirmation messages when marking an unreleased item as watched.
// =============================================================

import { todayISO, formatDateEs } from "./dates.js";

// An item is unreleased if it has no official date or if the date
// is in the future (string comparison "YYYY-MM-DD").
export function isUnreleasedDate(dateStr) {
  return !dateStr || dateStr > todayISO();
}

// Confirmation message when marking as watched a specific episode
// (S{season}E{episode}) whose air date is known (or known to be
// missing). Covers the case where TMDB does not return
// next_episode_to_air but the episode exists in its season.
// Returns null when the episode is already released.
export function episodeUnreleasedMessage(title, season, episode, airDate) {
  if (!isUnreleasedDate(airDate)) return null;
  if (airDate) {
    return `Según TMDB este episodio (T${season}E${episode}) se estrena el ${formatDateEs(
      airDate
    )}, todavía no ha pasado. ¿Marcarlo igualmente como visto?`;
  }
  return `«${title}» (T${season}E${episode}) no tiene fecha de estreno oficial en TMDB; suponemos que aún no está estrenado. ¿Marcarlo igualmente como visto?`;
}

// Confirmation message when marking an unreleased item as watched.
// Returns null when it does not apply (manual, released, no match
// for the next episode, unsupported type).
// airInfo (optional): result of getNextEpisodeAirInfo (sorting.js)
// with the `source` tag; it is injected as a parameter to avoid an
// import cycle (release.js only imports dates.js). For shows, if
// airInfo is not passed (or does not match the next episode) null
// is returned: without information there is no confirmation.
export function unreleasedConfirmMessage(item, airInfo = null) {
  if (item.type === "movie") {
    if (item.manual) return null;
    if (!isUnreleasedDate(item.releaseDate)) return null;
    if (item.releaseDate) {
      return `Según TMDB esta película se estrena el ${formatDateEs(
        item.releaseDate
      )}, todavía no ha pasado. ¿Marcarla igualmente como vista?`;
    }
    return `«${item.title}» no tiene fecha de estreno oficial en TMDB; suponemos que aún no está estrenada. ¿Marcarla igualmente como vista?`;
  }

  if (item.type === "tv") {
    // Manual shows have no real TMDB dates: they are excluded from
    // every "unreleased" confirmation.
    if (item.manual) return null;
    const { nextEpisode } = item;
    if (!nextEpisode) return null;
    const info =
      airInfo && airInfo.season === nextEpisode.season && airInfo.episode === nextEpisode.episode
        ? airInfo
        : null;
    if (!info) return null;
    if (!isUnreleasedDate(info.airDate)) return null;
    // Source "season": the whole season is not released yet (its
    // air_date is null or in the future), even if the specific
    // episode exists.
    if (info.source === "season") {
      return `Según TMDB la temporada ${info.season} de «${item.title}» aún no está estrenada${
        info.airDate ? ` (se estrena el ${formatDateEs(info.airDate)})` : " (sin fecha oficial)"
      }. ¿Marcarlo igualmente como visto?`;
    }
    if (info.airDate) {
      return `Según TMDB este episodio se estrena el ${formatDateEs(
        info.airDate
      )}. ¿Marcarlo igualmente como visto?`;
    }
    return `«${item.title}» no tiene fecha de estreno oficial en TMDB; suponemos que aún no está estrenado. ¿Marcarlo igualmente como visto?`;
  }

  return null;
}
