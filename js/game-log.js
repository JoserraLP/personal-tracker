// =============================================================
// Play session history of a videogame: an array of
// segments { startedAt, finishedAt }. finishedAt is null while
// the play session is in progress. It allows replaying without losing the
// record of previous play sessions.
// =============================================================

export function startPlay(playLog, date) {
  return [...(playLog || []), { startedAt: date, finishedAt: null }];
}

export function finishPlay(playLog, date) {
  const log = [...(playLog || [])];
  if (log.length && !log[log.length - 1].finishedAt) {
    log[log.length - 1] = { ...log[log.length - 1], finishedAt: date };
  } else {
    log.push({ startedAt: date, finishedAt: date });
  }
  return log;
}

export function removePlayEntry(playLog, index) {
  const log = [...(playLog || [])];
  log.splice(index, 1);
  return log;
}

export function updatePlayEntry(playLog, index, changes) {
  const log = [...(playLog || [])];
  log[index] = { ...log[index], ...changes };
  return log;
}

export function statusFromPlayLog(playLog) {
  if (!playLog || !playLog.length) return "pendiente";
  const last = playLog[logIndex(playLog)];
  return last.finishedAt ? "completado" : "en_curso";
}

function logIndex(playLog) {
  return playLog.length - 1;
}

/**
 * Total played hours of a videogame (ADR-111): the SUM of the
 * hours of the history's sessions when it exists (the web's
 * source of truth); if there are no sessions but Steam already
 * provided hours (steamPlaytimeHours, backfill session), that
 * figure is used. Returns
 * null when nothing is computable (the line is not shown).
 * Pure and tested.
 */
export function totalPlayHours(item) {
  if (!item) return null;
  const log = Array.isArray(item.playLog) ? item.playLog : [];
  const sum = log.reduce((acc, e) => {
    const h = Number(e && e.hours);
    return acc + (Number.isFinite(h) && h > 0 ? h : 0);
  }, 0);
  if (sum > 0) return Math.round(sum * 10) / 10;
  const steam = Number(item.steamPlaytimeHours);
  if (Number.isFinite(steam) && steam > 0) return Math.round(steam * 10) / 10;
  return null;
}
