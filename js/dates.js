// =============================================================
// Date utilities. All dates are stored as "YYYY-MM-DD" strings
// (the same format produced by <input type="date">),
// so they can be sorted as text without conversions.
// =============================================================

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDateEs(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Subtracts days from a "YYYY-MM-DD" date and returns another date in the same
// canonical format. It is used to compute activity thresholds (e.g.
// "a year ago") comparable as text.
export function subtractDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
