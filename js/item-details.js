// =============================================================
// ON-DEMAND item details (minimal storage A2, issue
// #200). With the new model documents store only the card
// + alert fields; the synopsis, cast, trailer, saga,
// platforms, etc. are requested from the API when opening the detail
// view, with the 24 h in-memory cache of api-movies.js (a freshly
// added or already visited item does not repeat the call) and with
// graceful degradation to «card only» if the network fails.
// =============================================================

import { getMovieDetails, getTvExtraDetails } from "./api-movies.js";
import { getGameDetails } from "./api-games.js";

// Does the item need to load its details? Books
// keep the synopsis in the document (exception of the study,
// section 8.1), so they never apply. Manual items don't
// either: their externalId is synthetic and does not exist in the APIs.
export function needsDetailFetch(item) {
  if (!item || item.manual || !item.externalId) return false;
  if (item.type === "movie" || item.type === "tv") return !item.overview;
  if (item.type === "game") return !item.description;
  return false;
}

// Loads the item's details (movie, TV series, or
// videogame) and merges them into the object itself (in memory). It never
// throws: any failure returns null and the detail stays «card
// only». Returns the details object on success (so
// the caller can compare it with what was saved before the merge,
// e.g. in the card's stale-while-revalidate).
export async function loadItemDetails(item) {
  if (!needsDetailFetch(item)) return null;
  try {
    let details;
    if (item.type === "movie") {
      details = await getMovieDetails(item.externalId);
      if (!details.overview && !details.genres) return null; // API without data
    } else if (item.type === "tv") {
      details = await getTvExtraDetails(item.externalId);
      if (!details.overview && !details.genres) return null;
    } else {
      details = await getGameDetails(item.externalId);
      if (!details.description && !details.genres) return null;
    }
    Object.assign(item, details);
    return details;
  } catch (err) {
    console.error("No se pudieron cargar los detalles de la ficha:", item.title, err);
    return null;
  }
}