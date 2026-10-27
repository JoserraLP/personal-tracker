// =============================================================
// "Times" counters of an item (ADR-107):
//   - movie     → number of times watched  (len of watchLog, or a manual
//                  value if annotated)
//   - TV series → number of times completed (timesCompleted or manual value)
//   - book      → number of times read     (len of finished readLog, or manual)
//   - videogame → number of times played   (len of playLog, or manual)
//
// The web already records each session/view with a date in the logs; the
// counter is shown on the cards as a «×N» chip and can be
// ADJUSTED by hand from the item's edit form with the
// seenCount field (for when the user re-watches/re-reads/re-plays
// something and doesn't want to record a session for each time).
//
// Semantics of seenCount (manual annotation): if present, its
// value IS the displayed counter (always >= 1); otherwise the
// natural value of the log is used. A null/1 seenCount equals the natural one.
// Pure parts (no DOM), for tests.
// =============================================================

// Natural number of times, from the logs of the type.
export function naturalTimes(item) {
  if (!item) return 0;
  if (item.type === "movie") return (item.watchLog || []).length;
  if (item.type === "book") {
    return (item.readLog || []).filter((e) => e && e.finishedAt).length;
  }
  if (item.type === "game") return (item.playLog || []).length;
  return Number(item.timesCompleted) || 0; // TV series
}

// Counter shown on the web: the manual annotation if there is one;
// otherwise the natural value of the log. Never below 0.
export function timesCount(item) {
  if (!item) return 0;
  const raw = Number(item.seenCount);
  if (!Number.isFinite(raw)) return naturalTimes(item);
  // An annotation (>= 1) is always shown; if someone sets a
  // value lower than the natural one, the natural value wins (you can't
  // watch less than what was recorded).
  return Math.max(naturalTimes(item), Math.max(0, raw));
}

// Label of the edit question depending on the type.
export function counterFieldLabel(type) {
  if (type === "tv") return "Veces completada";
  if (type === "book") return "Veces leído";
  if (type === "game") return "Veces jugada";
  return "Veces vista";
}

// Text of the card chip: "×3", or "" if the counter is 0.
export function counterBadgeText(item) {
  const n = timesCount(item);
  return n > 0 ? `×${n}` : "";
}

// Sanitizes the value of the edit field: an integer >= 0 or null.
// "0" is equivalent to resetting the annotation (null).
export function sanitizeSeenCount(value) {
  const raw = (value || "").toString().replace(",", ".").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n === 0 ? null : n;
}
