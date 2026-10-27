// =============================================================
// Export of the releases calendar to .ics format (iCalendar).
// Generates an RFC 5545 compatible file that includes the
// upcoming episodes of airing TV series, the release dates
// of pending movies and the pending launches of
// videogames, to import into Google Calendar, Apple Calendar
// and others.
// =============================================================

import { todayISO } from "./dates.js";
import * as ui from "./ui.js";

// ---------- ICS helpers ----------

/**
  * Escapes special characters for TEXT values in iCalendar.
  * Per RFC 5545, the following must be escaped: \, ; , and line breaks.
  */
function escapeIcsText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

/**
  * Converts an ISO "YYYY-MM-DD" date to the iCalendar DATE format: YYYYMMDD.
  */
function formatIcsDate(isoString) {
  if (!isoString) return null;
  const match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}${match[2]}${match[3]}`;
}

/**
  * Applies RFC 5545 line folding: maximum 75 octets per line.
  * Lines that exceed are continued with a space at the beginning of the
  * next line (continuation line).
  */
function foldLine(line) {
  const maxLen = 75;
  if (line.length <= maxLen) return line;

  const parts = [];
  let remaining = line;
  while (remaining.length > 0) {
    if (parts.length === 0) {
      parts.push(remaining.slice(0, maxLen));
      remaining = remaining.slice(maxLen);
    } else {
      // Continuation lines start with a space (1 octet)
      const avail = maxLen - 1;
      parts.push(" " + remaining.slice(0, avail));
      remaining = remaining.slice(avail);
    }
  }
  return parts.join("\r\n");
}

/**
  * Generates a unique and stable UID for each event.
  */
function generateUid(type, itemId) {
  return `mi-registro-${type}-${itemId}@registro-personal`;
}

// ---------- ICS generation ----------

/**
  * Builds the complete content of an .ics file from
  * a list of events.
  *
  * @param {Array<{uid:string, dtstart:string, summary:string, description?:string}>} events
  * @returns {string} ICS file content (with CRLF)
  */
function generateIcsString(events) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Personal Tracker//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const ev of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTART;VALUE=DATE:${ev.dtstart}`);
    lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
    if (ev.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    }
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  // Join with CRLF (iCalendar standard) and fold long lines
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ---------- Data collection ----------

/**
  * Collects the upcoming events (TV series episodes, movie
  * releases and videogame launches) from the user's
  * data.
  *
  * Groups are read from Firestore on demand (getItemsOnce) and not
  * from the in-memory state (issue #178): with per-tab lazy
  * loading, a group the user hasn't visited yet is not
  * subscribed and the export would be left without those events.
  *
  * @param {Object} ctx - Application context
  * @param {boolean} includeMovies - Include movie releases
  * @param {boolean} includeTv - Include upcoming TV series episodes
  * @param {boolean} includeGames - Include videogame launches
  * @returns {Promise<Array<{uid:string, dtstart:string, summary:string, description?:string}>>}
  */
async function collectUpcomingEvents(ctx, includeMovies, includeTv, includeGames) {
  const events = [];
  const today = todayISO();
  const user = ctx.getCurrentUser();

  if (includeTv) {
    const tvSeries = (user && (await ctx.getItemsOnce(user.uid, "tv"))) || [];
    for (const item of tvSeries) {
      const episode = item.nextEpisodeToAir;
      if (!episode || !episode.airDate) continue;
      if (episode.airDate < today) continue;

      const epLabel = episode.episode != null ? `E${episode.episode}` : "";
      const seasonLabel = episode.season != null ? `T${episode.season}` : "";
      const epSuffix = seasonLabel || epLabel ? ` (${seasonLabel}${epLabel})` : "";

      events.push({
        uid: generateUid("tv", item.id),
        dtstart: formatIcsDate(episode.airDate),
        summary: `Nuevo episodio: ${item.title}${epSuffix}`,
        description: episode.airDate
          ? `Próximo episodio de la serie ${item.title} que se estrena el ${episode.airDate}.`
          : undefined,
      });
    }
  }

  if (includeMovies) {
    const movies = (user && (await ctx.getItemsOnce(user.uid, "movie"))) || [];
    for (const item of movies) {
      // Include pending movies or with awaitingRelease, as long as they have a future date
      const isPending = item.status === "pendiente" || item.awaitingRelease === true;
      if (!isPending) continue;
      if (!item.releaseDate) continue;
      if (item.releaseDate < today) continue;

      events.push({
        uid: generateUid("movie", item.id),
        dtstart: formatIcsDate(item.releaseDate),
        summary: `Estreno: ${item.title}`,
        description: item.overview
          ? item.overview.slice(0, 250)
          : `Próximo estreno de ${item.title} el ${item.releaseDate}.`,
      });
    }
  }

  if (includeGames) {
    const games = (user && (await ctx.getItemsOnce(user.uid, "game"))) || [];
    for (const item of games) {
      // Pending launch: future date and no play history.
      // Direct criterion (issue #176): awaitingRelease alone is not trusted,
      // quick-actions.js/modal-handlers.js don't clear it when marking a game
      // as played (see daily-check.js), so the playLog is the source
      // of truth to exclude already-played games. Manual games do
      // not have releaseDate and are excluded by the first guard.
      if (!item.releaseDate) continue;
      if (item.releaseDate < today) continue;
      if (item.playLog && item.playLog.length) continue;

      const dtstart = formatIcsDate(item.releaseDate);
      if (!dtstart) continue; // defense: unparseable date

      events.push({
        uid: generateUid("game", item.id),
        dtstart,
        summary: `Lanzamiento: ${item.title}`,
        description: item.overview
          ? item.overview.slice(0, 250)
          : `Lanzamiento del videojuego ${item.title} el ${item.releaseDate}.`,
      });
    }
  }

  // Sort by date
  events.sort((a, b) => a.dtstart.localeCompare(b.dtstart));

  return events;
}

// ---------- Download ----------

/**
  * Generates and downloads the .ics file.
  *
  * @param {Object} ctx - Application context
  * @param {{includeMovies?:boolean, includeTv?:boolean, includeGames?:boolean}} options
  */
export async function downloadIcs(ctx, options = {}) {
  const user = ctx.getCurrentUser();
  if (!user) {
    ui.showToast("No has iniciado sesión.");
    return;
  }

  const includeMovies = options.includeMovies !== false;
  const includeTv = options.includeTv !== false;
  const includeGames = options.includeGames !== false;

  ui.showToast("Preparando calendario…");

  try {
const events = await collectUpcomingEvents(ctx, includeMovies, includeTv, includeGames);

    if (events.length === 0) {
      ui.showToast("No hay estrenos próximos que exportar.");
      return;
    }

    const icsContent = generateIcsString(events);
    const blob = new Blob([icsContent], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `calendario-estrenos-${todayISO()}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    ui.showToast(`Calendario descargado (${events.length} evento${events.length !== 1 ? "s" : ""}).`);
  } catch (err) {
    console.error("Error al exportar calendario:", err);
    ui.showToast("No se pudo exportar el calendario: " + err.message);
  }
}

// ---------- Button setup ----------

/**
  * Configures the calendar export buttons in the profile view.
  *
  * @param {Object} ctx - Application context
  */
export function setupExportIcs(ctx) {
  const btn = document.getElementById("btn-export-ics");
  if (!btn) return;

  btn.addEventListener("click", () => {
    downloadIcs(ctx, { includeMovies: true, includeTv: true, includeGames: true });
  });
}
